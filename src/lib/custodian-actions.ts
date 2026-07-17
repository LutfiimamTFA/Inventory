import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Asset } from "@/lib/types";
import { cleanFirestoreData, writeAssetLog } from "@/lib/firestore-helpers";
import { createAssetNotification } from "@/lib/notifications";

// ── Custodian / pemakaian harian ────────────────────────────────────────
// Alur untuk aset "assigned_daily" (mis. HP sosial media, laptop kerja):
// Asset Admin/QHSE menetapkan custodian sekali → custodian TIDAK perlu
// scan/pinjam setiap hari. Kalau aset dipegang orang lain sementara, itu
// WAJIB lewat handoverTemporary (bukan asal pakai), dan begitu selesai
// harus lewat returnToCustodian supaya currentHolder selalu akurat.
//
// Perbedaan dengan alur "shared_pool" (assetStatus/currentBorrower* lama):
// custodian model ini tidak menyentuh asset_borrowings sama sekali — semua
// state disimpan langsung di document assets (lihat field baru di types.ts).

interface ActorInfo {
  uid: string;
  name: string;
}

export async function assignCustodian(params: {
  asset: Asset;
  custodianUid: string;
  custodianName: string;
  custodianEmail: string;
  custodianDivision?: string;
  custodianRole?: string;
  performedBy: ActorInfo;
}) {
  const { asset, custodianUid, custodianName, custodianEmail, custodianDivision, custodianRole, performedBy } =
    params;
  const isChange = !!asset.custodianUid && asset.custodianUid !== custodianUid;

  await updateDoc(
    doc(db, "assets", asset.id),
    cleanFirestoreData({
      usageType: "assigned_daily",
      usageTypeLabel: "Ditugaskan Tetap",
      custodianUid,
      custodianName,
      custodianEmail,
      custodianDivision: custodianDivision || null,
      custodianRole: custodianRole || null,
      currentHolderUid: custodianUid,
      currentHolderName: custodianName,
      currentHolderEmail: custodianEmail,
      currentHolderDivision: custodianDivision || null,
      currentUsageStatus: "with_custodian",
      currentUsageStatusLabel: "Bersama Custodian",
      currentUsageStartedAt: serverTimestamp(),
      // Alias legacy — supaya tampilan/laporan lama yang masih baca
      // responsiblePerson*/pic* tetap konsisten dengan custodian baru.
      responsiblePersonUid: custodianUid,
      responsiblePersonName: custodianName,
      responsiblePersonEmail: custodianEmail,
      responsiblePersonDivision: custodianDivision || null,
      picUid: custodianUid,
      picName: custodianName,
      picEmail: custodianEmail,
      // Serah-terima sementara sebelumnya (kalau ada) dianggap selesai —
      // custodian baru mulai dari kondisi bersih.
      temporaryUseStartedAt: null,
      temporaryUseExpectedReturnAt: null,
      temporaryUseEndedAt: null,
      temporaryUsePurpose: null,
      temporaryUseNote: null,
      updatedAt: serverTimestamp(),
    }) as Record<string, unknown>
  );

  await writeAssetLog({
    assetId: asset.id,
    assetName: asset.assetName,
    assetCode: asset.assetCode,
    action: isChange ? "custodian_changed" : "assigned_to_custodian",
    userUid: performedBy.uid,
    userName: performedBy.name,
    fromUid: asset.custodianUid || undefined,
    fromName: asset.custodianName || undefined,
    toUid: custodianUid,
    toName: custodianName,
    custodianUid,
    custodianName,
    detail: isChange
      ? `Custodian diganti dari ${asset.custodianName || "-"} ke ${custodianName}`
      : `${custodianName} ditetapkan sebagai custodian`,
  });

  await createAssetNotification({
    recipientUid: custodianUid,
    recipientName: custodianName,
    recipientRole: "staff",
    title: "Anda Menjadi PIC Aset",
    message: `${asset.assetName} ditetapkan sebagai aset yang menjadi tanggung jawab Anda.`,
    type: "asset_custodian_assigned",
    priority: "medium",
    linkUrl: `/assets/${asset.id}`,
    relatedType: "asset",
    relatedId: asset.id,
    relatedNumber: asset.assetCode,
    createdByUid: performedBy.uid,
    createdByName: performedBy.name,
  });
}

export async function handoverTemporary(params: {
  asset: Asset;
  toUid: string;
  toName: string;
  toEmail?: string;
  toDivision?: string;
  purpose: string;
  expectedReturnAt?: string;
  note?: string;
  performedBy: ActorInfo;
}) {
  const { asset, toUid, toName, toEmail, toDivision, purpose, expectedReturnAt, note, performedBy } = params;

  await updateDoc(
    doc(db, "assets", asset.id),
    cleanFirestoreData({
      currentUsageStatus: "temporary_used_by_other",
      currentUsageStatusLabel: "Dipakai Sementara",
      currentHolderUid: toUid,
      currentHolderName: toName,
      currentHolderEmail: toEmail || null,
      currentHolderDivision: toDivision || null,
      temporaryUseStartedAt: serverTimestamp(),
      temporaryUseExpectedReturnAt: expectedReturnAt || null,
      temporaryUseEndedAt: null,
      temporaryUsePurpose: purpose,
      temporaryUseNote: note || null,
      handedOverByUid: performedBy.uid,
      handedOverByName: performedBy.name,
      updatedAt: serverTimestamp(),
    }) as Record<string, unknown>
  );

  await writeAssetLog({
    assetId: asset.id,
    assetName: asset.assetName,
    assetCode: asset.assetCode,
    action: "temporary_handover",
    userUid: performedBy.uid,
    userName: performedBy.name,
    fromUid: asset.currentHolderUid || asset.custodianUid || undefined,
    fromName: asset.currentHolderName || asset.custodianName || undefined,
    toUid,
    toName,
    custodianUid: asset.custodianUid || undefined,
    custodianName: asset.custodianName || undefined,
    purpose,
    expectedReturnAt: expectedReturnAt || undefined,
    note: note || undefined,
    detail: `Diserahkan sementara ke ${toName} untuk ${purpose}`,
  });

  const recipients = [{ uid: toUid, name: toName }];
  if (asset.custodianUid && asset.custodianUid !== toUid) {
    recipients.push({ uid: asset.custodianUid, name: asset.custodianName || "" });
  }
  await Promise.all(
    recipients.map((r) =>
      createAssetNotification({
        recipientUid: r.uid,
        recipientName: r.name,
        recipientRole: "staff",
        title: "Aset Dipakai Sementara",
        message: `${asset.assetName} sedang dipakai sementara oleh ${toName} untuk ${purpose}.`,
        type: "asset_temporary_handover",
        priority: "medium",
        linkUrl: `/assets/${asset.id}`,
        relatedType: "asset",
        relatedId: asset.id,
        relatedNumber: asset.assetCode,
        createdByUid: performedBy.uid,
        createdByName: performedBy.name,
      })
    )
  );
}

export async function returnToCustodian(params: { asset: Asset; performedBy: ActorInfo }) {
  const { asset, performedBy } = params;
  if (!asset.custodianUid) {
    throw new Error("Aset ini belum punya custodian.");
  }

  await updateDoc(
    doc(db, "assets", asset.id),
    cleanFirestoreData({
      currentUsageStatus: "with_custodian",
      currentUsageStatusLabel: "Bersama Custodian",
      currentHolderUid: asset.custodianUid,
      currentHolderName: asset.custodianName,
      currentHolderEmail: asset.custodianEmail || null,
      currentHolderDivision: asset.custodianDivision || null,
      temporaryUseEndedAt: serverTimestamp(),
      returnedByUid: performedBy.uid,
      returnedByName: performedBy.name,
      updatedAt: serverTimestamp(),
    }) as Record<string, unknown>
  );

  await writeAssetLog({
    assetId: asset.id,
    assetName: asset.assetName,
    assetCode: asset.assetCode,
    action: "temporary_returned",
    userUid: performedBy.uid,
    userName: performedBy.name,
    fromUid: asset.currentHolderUid || undefined,
    fromName: asset.currentHolderName || undefined,
    toUid: asset.custodianUid,
    toName: asset.custodianName || undefined,
    custodianUid: asset.custodianUid,
    custodianName: asset.custodianName || undefined,
    detail: `Dikembalikan ke custodian ${asset.custodianName || "-"}`,
  });

  await createAssetNotification({
    recipientUid: asset.custodianUid,
    recipientName: asset.custodianName || "",
    recipientRole: "staff",
    title: "Aset Dikembalikan",
    message: `${asset.assetName} sudah dikembalikan ke ${asset.custodianName || "Anda"}.`,
    type: "asset_returned_to_custodian",
    priority: "low",
    linkUrl: `/assets/${asset.id}`,
    relatedType: "asset",
    relatedId: asset.id,
    relatedNumber: asset.assetCode,
    createdByUid: performedBy.uid,
    createdByName: performedBy.name,
  });
}

// Asset Admin/Super Admin — dipakai kalau data salah atau barang tidak
// dikembalikan. Tanpa correctedHolder* -> paksa kembali ke custodian
// ("forced_return"). Dengan correctedHolder* -> koreksi currentHolder ke
// orang yang sebenarnya sedang pegang barang ("holder_corrected"), TANPA
// mengubah custodian tetapnya.
export async function forceReturnOrCorrectHolder(params: {
  asset: Asset;
  correctedHolderUid?: string;
  correctedHolderName?: string;
  correctedHolderEmail?: string;
  note: string;
  performedBy: ActorInfo;
}) {
  const { asset, correctedHolderUid, correctedHolderName, correctedHolderEmail, note, performedBy } = params;

  const isCorrection = !!correctedHolderUid && correctedHolderUid !== asset.custodianUid;
  const nextHolderUid = isCorrection ? correctedHolderUid! : asset.custodianUid || null;
  const nextHolderName = isCorrection ? correctedHolderName || "" : asset.custodianName || null;
  const nextHolderEmail = isCorrection ? correctedHolderEmail || null : asset.custodianEmail || null;

  await updateDoc(
    doc(db, "assets", asset.id),
    cleanFirestoreData({
      currentUsageStatus: isCorrection ? "temporary_used_by_other" : "with_custodian",
      currentHolderUid: nextHolderUid,
      currentHolderName: nextHolderName,
      currentHolderEmail: nextHolderEmail,
      temporaryUseEndedAt: isCorrection ? asset.temporaryUseEndedAt || null : serverTimestamp(),
      currentUsageNote: note,
      returnedByUid: performedBy.uid,
      returnedByName: performedBy.name,
      updatedAt: serverTimestamp(),
    }) as Record<string, unknown>
  );

  await writeAssetLog({
    assetId: asset.id,
    assetName: asset.assetName,
    assetCode: asset.assetCode,
    action: isCorrection ? "holder_corrected" : "forced_return",
    userUid: performedBy.uid,
    userName: performedBy.name,
    fromUid: asset.currentHolderUid || undefined,
    fromName: asset.currentHolderName || undefined,
    toUid: nextHolderUid || undefined,
    toName: nextHolderName || undefined,
    custodianUid: asset.custodianUid || undefined,
    custodianName: asset.custodianName || undefined,
    note,
    detail: isCorrection
      ? `Pemakai dikoreksi menjadi ${nextHolderName} oleh ${performedBy.name}`
      : `Aset dipaksa kembali ke custodian oleh ${performedBy.name}`,
  });
}
