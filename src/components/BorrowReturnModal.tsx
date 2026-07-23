"use client";

import { useState } from "react";
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
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Asset, AssetCondition } from "@/lib/types";
import { borrowAsset } from "@/lib/borrow-actions";
import { useAuth } from "@/lib/auth-context";
import ConfirmModal from "@/components/ConfirmModal";

// Section A — error dari Firestore (FirebaseError) atau apa pun yang
// dilempar HARUS dibongkar jadi name/message/stack yang eksplisit, supaya
// console.error tidak pernah tampil kosong "{}" lagi seperti sebelumnya.
function logReturnError(
  step: string,
  err: unknown,
  asset: Asset | null,
  firebaseUser?: { uid?: string | null; email?: string | null } | null,
  assetUser?: { uid?: string | null; email?: string | null } | null
) {
  const rawError =
    err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : err;
  const code = (err as { code?: string } | null)?.code;
  const message = (err as { message?: string } | null)?.message;
  const name = (err as { name?: string } | null)?.name;

  console.error(`[My Borrowings Return Error] FAILED ${step}`, {
    assetId: asset?.id,
    assetCode: asset?.assetCode,

    firebaseUid: firebaseUser?.uid,
    firebaseEmail: firebaseUser?.email,

    assetUserUid: assetUser?.uid,
    assetUserEmail: assetUser?.email,

    currentHolderUid: asset?.currentHolderUid,
    currentHolderName: asset?.currentHolderName,
    currentUsageStatus: asset?.currentUsageStatus,

    errorCode: code,
    errorMessage: message,
    errorName: name,
    rawError,
  });
}

function returnErrorMessage(err: unknown): string {
  const code = (err as { code?: string } | null)?.code;
  const message = (err as { message?: string } | null)?.message;
  if (code === "permission-denied") {
    return "Anda belum memiliki izin untuk mengembalikan aset ini.";
  }
  return message || "Gagal mengembalikan aset. Coba lagi atau hubungi admin.";
}

export function BorrowModal({
  asset,
  open,
  onClose,
  onDone,
}: {
  asset: Asset;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { assetUser, firebaseUser } = useAuth();
  const [estimatedReturnDate, setEstimatedReturnDate] = useState("");
  const [estimatedReturnTime, setEstimatedReturnTime] = useState("");
  const [borrowNotes, setBorrowNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleConfirm = async () => {
    if (!assetUser || !firebaseUser) return;
    setSaving(true);
    setError("");
    try {
      // Section C/E — tanpa jam, simpan tanggal SAJA ("YYYY-MM-DD") supaya
      // normalizeExpectedReturnDate (lib/utils.ts) menganggapnya berlaku
      // sampai akhir hari, bukan otomatis jam 00:00 dini hari.
      const estimatedReturnAt = estimatedReturnDate
        ? estimatedReturnTime
          ? `${estimatedReturnDate}T${estimatedReturnTime}:00`
          : estimatedReturnDate
        : "";
      await borrowAsset({
        asset,
        userUid: assetUser.uid,
        userName: assetUser.name,
        userEmail: assetUser.email || firebaseUser.email || "",
        estimatedReturnAt,
        borrowNotes,
      });
      onDone();
    } catch (err) {
      const code = (err as { code?: string })?.code;
      console.error("[Asset Action Borrow Error]", {
        assetId: asset?.id,
        assetCode: asset?.assetCode,
        currentUsageStatus: asset?.currentUsageStatus,
        currentHolderUid: asset?.currentHolderUid,
        userUid: assetUser?.uid,
        errorCode: code,
        errorMessage: (err as { message?: string })?.message,
      });
      setError(
        code === "permission-denied"
          ? "Anda belum punya izin untuk meminjam asset ini."
          : "Gagal memproses pinjaman. Coba lagi atau hubungi admin."
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <ConfirmModal
      open={open}
      title={`Pinjam ${asset.assetName}`}
      confirmLabel={saving ? "Memproses..." : "Pinjam Aset"}
      onConfirm={handleConfirm}
      onCancel={onClose}
    >
      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Estimasi Tanggal Kembali
          </label>
          <input
            type="date"
            value={estimatedReturnDate}
            onChange={(e) => setEstimatedReturnDate(e.target.value)}
            className="input"
          />
          <p className="mt-1 text-xs text-slate-400">
            Jika jam tidak diisi, batas kembali dihitung sampai akhir hari.
          </p>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Jam Kembali (opsional)
          </label>
          <input
            type="time"
            value={estimatedReturnTime}
            onChange={(e) => setEstimatedReturnTime(e.target.value)}
            className="input"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Catatan
          </label>
          <textarea
            value={borrowNotes}
            onChange={(e) => setBorrowNotes(e.target.value)}
            className="input"
            rows={2}
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </ConfirmModal>
  );
}

export function ReturnModal({
  asset,
  open,
  onClose,
  onDone,
}: {
  asset: Asset;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { assetUser, firebaseUser } = useAuth();
  const [returnCondition, setReturnCondition] =
    useState<AssetCondition>("good");
  const [returnNotes, setReturnNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const handleConfirm = async () => {
    if (!asset) {
      setError("Aset tidak ditemukan.");
      return;
    }

    // Section B — UID dari Firebase Auth dulu (sumber kebenaran login),
    // assetUser cuma fallback kalau firebaseUser belum sempat termuat.
    const userUid = firebaseUser?.uid || assetUser?.uid;
    const userEmail = firebaseUser?.email || assetUser?.email || "";
    const currentUserName =
      assetUser?.name || firebaseUser?.displayName || firebaseUser?.email || "User";

    if (!userUid) {
      setError("Sesi login tidak ditemukan. Silakan login ulang.");
      return;
    }

    // Section C — dicek di sini dulu (bukan cuma diserahkan ke Firestore
    // rules) supaya pesannya spesifik "aset ini tidak sedang Anda pinjam",
    // bukan permission-denied generik.
    const isCurrentHolder =
      asset.currentHolderUid === userUid ||
      (!!userEmail && asset.currentHolderEmail === userEmail) ||
      asset.currentBorrowerUid === userUid;
    if (!isCurrentHolder) {
      setError("Aset ini tidak sedang Anda pinjam.");
      return;
    }

    setSaving(true);
    setError("");

    const isDamaged = returnCondition === "minor_damage" || returnCondition === "heavy_damage";

    // Section D — payload MINIMAL, cuma field yang memang perlu berubah
    // saat pengembalian (bukan seluruh object asset).
    const assetReturnPayload = {
      assetStatus: isDamaged ? "maintenance" : "available",
      condition: returnCondition,
      currentUsageStatus: isDamaged ? "maintenance" : "available",
      currentUsageStatusLabel: isDamaged ? "Maintenance" : "Tersedia",

      lastHolderUid: asset.currentHolderUid || userUid,
      lastHolderName: asset.currentHolderName || currentUserName,
      lastHolderEmail: asset.currentHolderEmail || userEmail || null,
      lastHeldAt: asset.currentUsageStartedAt || null,
      lastReturnedAt: serverTimestamp(),

      currentBorrowingId: null,
      currentBorrowerUid: null,
      currentBorrowerName: null,

      currentHolderUid: null,
      currentHolderName: null,
      currentHolderEmail: null,
      currentHolderDivision: null,
      currentUsageExpectedReturnAt: null,

      returnedAt: serverTimestamp(),
      returnedByUid: userUid,
      returnedByName: currentUserName,

      updatedAt: serverTimestamp(),
      updatedByUid: userUid,
      updatedByName: currentUserName,
    };

    // Section F — dua langkah dipisah try/catch masing-masing supaya kalau
    // ada yang gagal, log-nya jelas MENUNJUK ke langkah mana yang gagal,
    // bukan satu catch besar yang bisa menyamarkan error jadi kosong.
    try {
      console.log("[Return Asset] START update asset", {
        assetId: asset.id,
        assetCode: asset.assetCode,
        currentHolderUid: asset.currentHolderUid,
        userUid,
        payloadKeys: Object.keys(assetReturnPayload),
      });

      await updateDoc(doc(db, "assets", asset.id), assetReturnPayload);

      console.log("[Return Asset] SUCCESS update asset");

      // Section F — baca ulang dokumennya supaya kita YAKIN update benar-
      // benar tersimpan (bukan cuma "tidak error"), bukan asumsi.
      const updatedAssetSnap = await getDoc(doc(db, "assets", asset.id));
      console.log("[Return Asset] VERIFY updated asset", {
        id: updatedAssetSnap.id,
        exists: updatedAssetSnap.exists(),
        currentUsageStatus: updatedAssetSnap.data()?.currentUsageStatus,
        currentHolderUid: updatedAssetSnap.data()?.currentHolderUid,
        currentBorrowerUid: updatedAssetSnap.data()?.currentBorrowerUid,
      });
    } catch (err) {
      logReturnError("update asset", err, asset, firebaseUser, assetUser);
      setSaving(false);
      setError(returnErrorMessage(err));
      return;
    }

    try {
      console.log("[Return Asset] START update/create borrowing history");

      const activeSnap = await getDocs(
        query(
          collection(db, "asset_borrowings"),
          where("assetId", "==", asset.id),
          where("borrowedByUid", "==", userUid),
          where("status", "==", "borrowed"),
          limit(1)
        )
      );

      if (!activeSnap.empty) {
        await updateDoc(doc(db, "asset_borrowings", activeSnap.docs[0].id), {
          status: "returned",
          statusLabel: "Sudah Dikembalikan",
          returnedAt: serverTimestamp(),
          returnedByUid: userUid,
          returnedByName: currentUserName,
          returnCondition,
          returnNotes: returnNotes || "",
          updatedAt: serverTimestamp(),
        });
      } else {
        // Section B — cek dulu apakah sudah ada riwayat "returned" untuk
        // aset+user ini dalam 5 menit terakhir (mis. klik ganda, atau retry
        // setelah step sebelumnya sempat gagal) SEBELUM membuat recovery
        // history baru, supaya Riwayat Pengembalian tidak dobel.
        const recentReturnedSnap = await getDocs(
          query(
            collection(db, "asset_borrowings"),
            where("assetId", "==", asset.id),
            where("borrowedByUid", "==", userUid),
            where("status", "==", "returned")
          )
        );
        const alreadyReturnedRecently = recentReturnedSnap.docs.some((d) => {
          const data = d.data();
          const returnedDate =
            (data.returnedAt as { toDate?: () => Date })?.toDate?.() ||
            new Date((data.returnedAt as string) || 0);
          return Date.now() - returnedDate.getTime() < 5 * 60 * 1000;
        });

        if (!alreadyReturnedRecently) {
          // Section G — tidak ada record asset_borrowings aktif sama sekali
          // (mis. aset jadi "sedang dipakai" lewat jalur custodian/PIC) — buat
          // recovery history supaya Riwayat Pengembalian tidak kosong.
          await addDoc(collection(db, "asset_borrowings"), {
            assetId: asset.id,
            assetCode: asset.assetCode,
            assetName: asset.assetName,
            locationText: asset.locationText || asset.location || "",
            borrowedByUid: userUid,
            borrowedByName: currentUserName,
            borrowedByEmail: userEmail,
            status: "returned",
            statusLabel: "Sudah Dikembalikan",
            borrowedAt: asset.currentUsageStartedAt || null,
            estimatedReturnAt: asset.currentUsageExpectedReturnAt || null,
            returnedAt: serverTimestamp(),
            returnedByUid: userUid,
            returnedByName: currentUserName,
            returnCondition,
            returnNotes: returnNotes || "",
            source: "my_borrowings_return_recovery",
            createdAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
          });
        } else {
          console.log("[Return Asset] SKIP recovery history — sudah ada riwayat returned baru-baru ini", {
            assetId: asset.id,
          });
        }
      }

      console.log("[Return Asset] SUCCESS borrowing history");
    } catch (err) {
      logReturnError("update/create borrowing history", err, asset, firebaseUser, assetUser);
      setSaving(false);
      setError(returnErrorMessage(err));
      return;
    }

    setSaving(false);
    onDone();
  };

  return (
    <ConfirmModal
      open={open}
      title="Kembalikan Aset"
      confirmLabel={saving ? "Memproses..." : "Konfirmasi Pengembalian"}
      onConfirm={handleConfirm}
      onCancel={onClose}
    >
      <div className="space-y-3">
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
          <p className="mb-1.5 text-slate-500">Anda akan mengembalikan aset berikut:</p>
          <p className="font-semibold text-slate-800">{asset.assetName}</p>
          <p className="font-mono text-xs text-slate-500">{asset.assetCode}</p>
          <p className="mt-1 text-xs text-slate-500">
            Lokasi: {asset.location || asset.locationText || "-"}
          </p>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Kondisi Saat Dikembalikan
          </label>
          <select
            value={returnCondition}
            onChange={(e) =>
              setReturnCondition(e.target.value as AssetCondition)
            }
            className="input"
          >
            <option value="new">Baru</option>
            <option value="good">Baik</option>
            <option value="fair">Cukup</option>
            <option value="minor_damage">Rusak Ringan</option>
            <option value="heavy_damage">Rusak Berat</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1">
            Catatan Pengembalian (opsional)
          </label>
          <textarea
            value={returnNotes}
            onChange={(e) => setReturnNotes(e.target.value)}
            className="input"
            rows={2}
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </div>
    </ConfirmModal>
  );
}
