import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Asset, AssetCondition } from "@/lib/types";
import { fetchActiveUsersByRoles, writeAssetLog } from "@/lib/firestore-helpers";
import { createAssetNotification } from "@/lib/notifications";
import { isBorrowingLate } from "@/lib/utils";

async function notifyManagers(params: {
  title: string;
  message: string;
  type: "asset_borrowed" | "asset_returned";
  relatedId: string;
  createdByUid?: string;
  createdByName?: string;
}) {
  const managers = await fetchActiveUsersByRoles(["asset_admin", "super_admin"]);
  await Promise.all(
    managers.map((m) =>
      createAssetNotification({
        recipientUid: m.uid,
        recipientName: m.name,
        recipientRole: m.role,
        title: params.title,
        message: params.message,
        type: params.type,
        priority: "low",
        linkUrl: `/borrowings`,
        relatedType: "borrowing",
        relatedId: params.relatedId,
        createdByUid: params.createdByUid,
        createdByName: params.createdByName,
      })
    )
  );
}

export async function borrowAsset(params: {
  asset: Asset;
  userUid: string;
  userName: string;
  userEmail: string;
  estimatedReturnAt: string;
  borrowNotes: string;
}) {
  const { asset, userUid, userName, userEmail, estimatedReturnAt, borrowNotes } =
    params;

  const borrowingRef = await addDoc(collection(db, "asset_borrowings"), {
    assetId: asset.id,
    assetName: asset.assetName,
    assetCode: asset.assetCode,
    // Section F/H — snapshot lokasi SAAT DIPINJAM, supaya riwayat tetap
    // menampilkan lokasi yang benar walau asetnya dipindah belakangan.
    locationText: asset.locationText || asset.location || "",
    borrowedByUid: userUid,
    borrowedByName: userName,
    borrowedByEmail: userEmail,
    borrowedAt: serverTimestamp(),
    estimatedReturnAt: estimatedReturnAt || null,
    returnedAt: null,
    status: "borrowed",
    borrowNotes: borrowNotes || "",
  });

  // Section D — tulis KEDUA skema sekaligus (assetStatus/currentBorrower*
  // lama DAN currentUsageStatus/currentHolder* yang dibaca assets list,
  // /asset-action, dan firestore.rules) supaya tidak ada lagi dua sumber
  // kebenaran status peminjaman yang bisa saling tidak sinkron — itu akar
  // masalah "Pinjam Asset gagal" sebelumnya.
  await updateDoc(doc(db, "assets", asset.id), {
    assetStatus: "borrowed",
    currentBorrowingId: borrowingRef.id,
    currentBorrowerUid: userUid,
    currentBorrowerName: userName,
    currentUsageStatus: "borrowed",
    currentUsageStatusLabel: "Dipinjam",
    currentHolderUid: userUid,
    currentHolderName: userName,
    currentHolderEmail: userEmail || null,
    // Section E — dipakai halaman Peminjaman Saya untuk "Dipinjam pada" /
    // "Estimasi kembali" / badge terlambat, TANPA harus query asset_borrowings
    // terpisah tiap kali render daftar aset yang sedang dipinjam.
    currentUsageStartedAt: serverTimestamp(),
    currentUsageExpectedReturnAt: estimatedReturnAt || null,
    updatedAt: serverTimestamp(),
    updatedByUid: userUid,
    updatedByName: userName,
  });

  await writeAssetLog({
    assetId: asset.id,
    assetName: asset.assetName,
    assetCode: asset.assetCode,
    action: "borrow",
    userUid,
    userName,
    detail: borrowNotes || "Aset dipinjam",
  });

  await notifyManagers({
    title: "Asset Dipinjam",
    message: `${userName} meminjam ${asset.assetName}.`,
    type: "asset_borrowed",
    relatedId: borrowingRef.id,
    createdByUid: userUid,
    createdByName: userName,
  });

  return borrowingRef.id;
}

// Section B.2 — dipakai Super Admin/Asset Admin dari /asset-action ketika
// status asset "Dipinjam" tapi tidak ada satu pun penanda pemegangnya
// (hasBrokenBorrowState di lib/utils.ts) — reset paksa ke "available"
// alih-alih memaksa user coba pinjam/kembalikan di atas data yang rusak.
export async function repairBrokenBorrowState(params: {
  asset: Asset;
  performedBy: { uid: string; name: string };
}) {
  const { asset, performedBy } = params;

  await updateDoc(doc(db, "assets", asset.id), {
    assetStatus: "available",
    currentBorrowingId: null,
    currentBorrowerUid: null,
    currentBorrowerName: null,
    currentUsageStatus: "available",
    currentUsageStatusLabel: "Tersedia",
    currentHolderUid: null,
    currentHolderName: null,
    currentHolderEmail: null,
    updatedAt: serverTimestamp(),
    updatedByUid: performedBy.uid,
    updatedByName: performedBy.name,
  });

  await writeAssetLog({
    assetId: asset.id,
    assetName: asset.assetName,
    assetCode: asset.assetCode,
    action: "status_repaired",
    userUid: performedBy.uid,
    userName: performedBy.name,
    detail: `${performedBy.name} memperbaiki status peminjaman yang tidak sinkron (dipaksa kembali ke Tersedia).`,
  });
}

export async function returnAsset(params: {
  asset: Asset;
  userUid: string;
  userName: string;
  returnCondition: AssetCondition;
  returnNotes: string;
}) {
  const { asset, userUid, userName, returnCondition, returnNotes } = params;

  // Section G — cari borrowing aktif kalau currentBorrowingId tidak ada
  // (mis. holder didapat lewat jalur lain, bukan borrowAsset() legacy).
  // Best-effort: kalau tetap tidak ketemu, lanjutkan update asset saja
  // supaya user tidak stuck cuma karena riwayat peminjamannya tidak lengkap.
  let borrowingId = asset.currentBorrowingId || null;
  if (!borrowingId) {
    const activeSnap = await getDocs(
      query(
        collection(db, "asset_borrowings"),
        where("assetId", "==", asset.id),
        where("borrowedByUid", "==", userUid),
        where("status", "==", "borrowed"),
        limit(1)
      )
    );
    borrowingId = activeSnap.empty ? null : activeSnap.docs[0].id;
  }

  const isDamaged =
    returnCondition === "minor_damage" || returnCondition === "heavy_damage";

  // Section C — asset_borrowings (returned) dan assets (available/kosongkan
  // holder) HARUS berubah bersamaan lewat satu writeBatch, BUKAN dua
  // updateDoc terpisah — kalau update kedua (assets) gagal setelah update
  // pertama (asset_borrowings) sudah ter-commit, asetnya akan "returned" di
  // riwayat tapi TETAP "borrowed" di assets (nyangkut di dua tempat
  // sekaligus, tepat seperti bug yang dilaporkan). Semua reads (getDoc/
  // getDocs di bawah) dilakukan DULU, baru batch berisi write-write saja.
  let isLate = false;
  let estimatedReturnAtForLate: string | undefined;
  if (borrowingId) {
    const borrowingSnap = await getDoc(doc(db, "asset_borrowings", borrowingId));
    estimatedReturnAtForLate = borrowingSnap.data()?.estimatedReturnAt as string | undefined;
    isLate = isBorrowingLate({ estimatedReturnAt: estimatedReturnAtForLate });
  } else {
    isLate = isBorrowingLate({ currentUsageExpectedReturnAt: asset.currentUsageExpectedReturnAt });
  }

  const batch = writeBatch(db);

  if (borrowingId) {
    batch.update(doc(db, "asset_borrowings", borrowingId), {
      returnedAt: serverTimestamp(),
      returnedByUid: userUid,
      returnedByName: userName,
      status: "returned",
      statusLabel: "Sudah Dikembalikan",
      returnCondition,
      returnNotes: returnNotes || "",
      isLate,
    });
  } else {
    // Section G — tidak ada record asset_borrowings aktif sama sekali
    // (mis. aset jadi "sedang dipakai" lewat jalur custodian/PIC, bukan
    // borrowAsset() di atas). Buat record "returned" langsung supaya
    // Riwayat Pengembalian di Peminjaman Saya tidak kosong walau
    // riwayat peminjamnya tidak pernah tercatat.
    const recoveryRef = doc(collection(db, "asset_borrowings"));
    batch.set(recoveryRef, {
      assetId: asset.id,
      assetCode: asset.assetCode,
      assetName: asset.assetName,
      locationText: asset.locationText || asset.location || "",
      borrowedByUid: userUid,
      borrowedByName: userName,
      borrowedByEmail: asset.currentHolderEmail || "",
      status: "returned",
      statusLabel: "Sudah Dikembalikan",
      borrowedAt: asset.currentUsageStartedAt || null,
      estimatedReturnAt: asset.currentUsageExpectedReturnAt || null,
      returnedAt: serverTimestamp(),
      returnedByUid: userUid,
      returnedByName: userName,
      returnCondition,
      returnNotes: returnNotes || "",
      isLate,
      source: "my_borrowings_return_recovery",
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    borrowingId = recoveryRef.id;
  }

  // Section B/E — currentHolderUid WAJIB null dan currentUsageStatus WAJIB
  // "available", jejak pemegang TERAKHIR (sebelum dikosongkan) disimpan ke
  // lastHolder* supaya admin tetap bisa lihat siapa yang terakhir pegang
  // aset ini walau statusnya sudah "available" lagi.
  const assetReturnPayload = {
    assetStatus: isDamaged ? "maintenance" : "available",
    condition: returnCondition,
    currentBorrowingId: null,
    currentBorrowerUid: null,
    currentBorrowerName: null,
    currentUsageStatus: isDamaged ? "maintenance" : "available",
    currentUsageStatusLabel: isDamaged ? "Maintenance" : "Tersedia",
    lastHolderUid: asset.currentHolderUid || asset.currentBorrowerUid || userUid,
    lastHolderName: asset.currentHolderName || asset.currentBorrowerName || userName,
    lastHolderEmail: asset.currentHolderEmail || null,
    lastHeldAt: asset.currentUsageStartedAt || null,
    lastReturnedAt: serverTimestamp(),
    currentHolderUid: null,
    currentHolderName: null,
    currentHolderEmail: null,
    currentHolderDivision: null,
    currentUsageExpectedReturnAt: null,
    returnedAt: serverTimestamp(),
    returnedByUid: userUid,
    returnedByName: userName,
    updatedAt: serverTimestamp(),
    updatedByUid: userUid,
    updatedByName: userName,
  };

  console.log("[Return Asset Debug]", {
    assetId: asset.id,
    assetCode: asset.assetCode,
    statusBefore: asset.currentUsageStatus,
    holderBefore: asset.currentHolderUid,
    borrowingId,
    updateAssetPayload: assetReturnPayload,
  });

  batch.update(doc(db, "assets", asset.id), assetReturnPayload);

  await batch.commit();

  console.log("[Return Asset Success]", {
    assetId: asset.id,
    assetCode: asset.assetCode,
    borrowingId,
  });

  await writeAssetLog({
    assetId: asset.id,
    assetName: asset.assetName,
    assetCode: asset.assetCode,
    action: "return",
    userUid,
    userName,
    detail: returnNotes || (isLate ? "Aset dikembalikan (terlambat)" : "Aset dikembalikan"),
  });

  await notifyManagers({
    title: "Asset Dikembalikan",
    message: `${userName} mengembalikan ${asset.assetName}${isLate ? " (terlambat)" : ""}.`,
    type: "asset_returned",
    relatedId: borrowingId || asset.id,
    createdByUid: userUid,
    createdByName: userName,
  });
}
