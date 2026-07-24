import { addDoc, collection, doc, serverTimestamp, writeBatch } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Asset } from "@/lib/types";
import { fetchActiveUsersByRoles } from "@/lib/firestore-helpers";
import { createAssetNotification } from "@/lib/notifications";
import { getAssetConditionLabel } from "@/lib/utils";

// Section 8 — audit trail SETIAP scan QR. Dipisah dari verifikasi fisik
// (lihat submitAssetVerification) karena scan hanya berarti "QR dibaca",
// BUKAN "barang sudah dicek langsung" (Section 9).
//
// Dedupe React Strict Mode: effect di komponen bisa terpanggil dua kali di
// dev untuk asset+user yang sama pada mount yang sama — Set in-memory ini
// mencegah dua dokumen log untuk kombinasi assetId+scannedByUid+menit yang
// sama tanpa perlu baca ulang Firestore. Reset hanya saat reload penuh
// (module state), yang cukup karena tujuannya cuma menghindari duplikasi
// akibat Strict Mode, bukan mencegah scan ulang yang sah di sesi lain.
const recentScanKeys = new Set<string>();

export async function logAssetQrScan(params: {
  asset: Asset;
  usageStatus: string;
  holderUid?: string | null;
  holderName?: string | null;
  scannedByUid: string;
  scannedByName: string;
}): Promise<void> {
  const minuteBucket = Math.floor(Date.now() / 60000);
  const key = `${params.asset.id}|${params.scannedByUid}|${minuteBucket}`;
  if (recentScanKeys.has(key)) return;
  recentScanKeys.add(key);

  try {
    await addDoc(collection(db, "asset_qr_scan_logs"), {
      assetId: params.asset.id,
      assetCode: params.asset.assetCode,
      qrTagId: params.asset.qrTagId || null,
      scannedByUid: params.scannedByUid,
      scannedByName: params.scannedByName,
      scannedAt: serverTimestamp(),
      usageStatusAtScan: params.usageStatus,
      conditionAtScan: getAssetConditionLabel(params.asset),
      holderUidAtScan: params.holderUid || null,
      holderNameAtScan: params.holderName || null,
      location: params.asset.location || params.asset.locationText || null,
    });
  } catch (error) {
    const err = error as { code?: string; message?: string; name?: string };
    console.warn("[Asset QR Scan Log] gagal mencatat riwayat scan (non-fatal)", {
      collection: "asset_qr_scan_logs",
      assetId: params.asset.id,
      scannedByUid: params.scannedByUid,
      errorCode: err?.code,
      errorMessage: err?.message,
      errorName: err?.name,
    });
  }
}

export interface VerificationChecklist {
  photoMatches: boolean;
  codeMatches: boolean;
  serialMatches: boolean;
  qrOnRightItem: boolean;
  locationAndHolderMatch: boolean;
}

// Section 7 — "Konfirmasi Aset Sesuai": SATU-SATUNYA jalur yang boleh
// mengubah verificationStatus jadi "verified". writeBatch supaya log +
// update dokumen asset selalu konsisten (kalau salah satu gagal, keduanya
// batal, tidak ada status "verified" tanpa log pendukung).
export async function submitAssetVerification(params: {
  asset: Asset;
  checklist: VerificationChecklist;
  performedByUid: string;
  performedByName: string;
}): Promise<void> {
  const batch = writeBatch(db);
  const logRef = doc(collection(db, "asset_verification_logs"));
  batch.set(logRef, {
    assetId: params.asset.id,
    assetCode: params.asset.assetCode,
    type: "verified",
    checklist: params.checklist,
    performedByUid: params.performedByUid,
    performedByName: params.performedByName,
    performedAt: serverTimestamp(),
  });
  batch.update(doc(db, "assets", params.asset.id), {
    verificationStatus: "verified",
    lastVerifiedAt: serverTimestamp(),
    lastVerifiedByUid: params.performedByUid,
    lastVerifiedByName: params.performedByName,
  });
  await batch.commit();
}

// Section 6 — "Laporkan Ketidaksesuaian" SENGAJA terpisah dari
// asset_issue_tickets (laporan kerusakan): ini soal identitas/kecocokan
// barang (foto beda, QR pindah, dsb), bukan kondisi rusak. Notifikasi QHSE
// dikirim best-effort SETELAH log tersimpan — kegagalan notifikasi tidak
// boleh membatalkan laporan (pola yang sama dipakai di alur Kembalikan Aset).
export async function submitAssetMismatchReport(params: {
  asset: Asset;
  reasons: string[];
  note?: string;
  performedByUid: string;
  performedByName: string;
}): Promise<void> {
  const logRef = await addDoc(collection(db, "asset_verification_logs"), {
    assetId: params.asset.id,
    assetCode: params.asset.assetCode,
    type: "mismatch",
    mismatchReasons: params.reasons,
    note: params.note || "",
    performedByUid: params.performedByUid,
    performedByName: params.performedByName,
    performedAt: serverTimestamp(),
  });

  try {
    const qhseUsers = await fetchActiveUsersByRoles(["asset_admin", "super_admin"]);
    await Promise.all(
      qhseUsers.map(async (qhse) => {
        try {
          await createAssetNotification({
            recipientUid: qhse.uid,
            recipientName: qhse.name || qhse.email,
            recipientRole: qhse.role,
            title: "Ketidaksesuaian Aset Dilaporkan",
            message: `${params.performedByName} melaporkan ketidaksesuaian pada ${params.asset.assetName} (${params.asset.assetCode}): ${params.reasons.join(", ")}.`,
            type: "asset_mismatch_reported",
            priority: "high",
            linkUrl: `/assets/${params.asset.id}`,
            relatedType: "asset",
            relatedId: params.asset.id,
            relatedNumber: params.asset.assetCode,
            createdByUid: params.performedByUid,
            createdByName: params.performedByName,
            assetId: params.asset.id,
          });
        } catch (err) {
          const e = err as { code?: string; message?: string; name?: string };
          console.error("[Asset Mismatch Report] gagal kirim notifikasi QHSE (non-fatal)", {
            collection: "asset_notifications",
            recipientUid: qhse.uid,
            assetId: params.asset.id,
            errorCode: e?.code,
            errorMessage: e?.message,
            errorName: e?.name,
          });
        }
      })
    );
  } catch (error) {
    const err = error as { code?: string; message?: string; name?: string };
    console.error("[Asset Mismatch Report] gagal memuat daftar penerima notifikasi QHSE (non-fatal)", {
      collection: "asset_users",
      assetId: params.asset.id,
      errorCode: err?.code,
      errorMessage: err?.message,
      errorName: err?.name,
    });
  }

  void logRef;
}
