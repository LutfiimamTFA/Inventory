import { Asset, AssetBorrowing, AssetIssueTicket } from "@/lib/types";
import {
  ASSET_STATUS_COLOR,
  ASSET_STATUS_LABEL,
  getAssetConditionColor,
  getAssetConditionLabel,
  isProblemAsset,
  normalizeAssetUsageStatus,
} from "@/lib/utils";

// AssetBorrowing (types.ts) tidak punya index signature, jadi tidak bisa
// langsung diintersect dengan Record<string, unknown> — union longgar ini
// dipakai supaya helper bisa terima dokumen AssetBorrowing asli MAUPUN
// object generik (mis. dari query fallback/backfill) sekaligus.
type BorrowingLike = AssetBorrowing | Record<string, unknown>;

// Section 1 — SATU sumber kebenaran untuk status PEMAKAIAN aset, dipakai
// bareng oleh Scan QR, Assets, Borrowings, My Borrowings, detail aset,
// Dashboard, dan Aksi Cepat. Akar masalah bug "Tersedia" + "sedang dipinjam
// oleh user lain" + "Belum tercatat" muncul BERSAMAAN di Aksi Cepat adalah
// karena badge halaman itu membaca `asset.assetStatus` MENTAH langsung,
// sementara pesan warning "dipinjam oleh user lain" membaca lewat
// isBorrowedByOne()/normalizeAssetUsageStatus() (lib/utils.ts) yang
// memprioritaskan `currentUsageStatus` — dua field yang bisa berbeda kalau
// datanya belum sinkron. Helper di file ini SELALU melalui satu jalur yang
// sama (normalizeAssetUsageStatus + activeBorrowing kalau ada), supaya
// badge dan warning tidak pernah lagi saling bertentangan.

export type AssetUsageState = "available" | "borrowed" | "in_use" | "inspection_required" | "maintenance" | "inactive";

const USAGE_STATE_LABEL: Record<AssetUsageState, string> = {
  available: "Tersedia",
  borrowed: "Sedang Dipinjam",
  in_use: "Sedang Dipakai",
  inspection_required: "Menunggu Pemeriksaan QHSE",
  maintenance: "Maintenance",
  inactive: "Tidak Aktif",
};

const USAGE_STATE_COLOR: Record<AssetUsageState, string> = {
  available: "bg-emerald-50 text-emerald-700 border-emerald-200",
  borrowed: "bg-amber-50 text-amber-700 border-amber-200",
  in_use: "bg-blue-50 text-blue-700 border-blue-200",
  inspection_required: "bg-amber-50 text-amber-700 border-amber-200",
  maintenance: "bg-purple-50 text-purple-700 border-purple-200",
  inactive: "bg-slate-100 text-slate-500 border-slate-200",
};

// Status yang dianggap SUDAH SELESAI (bukan aktif) — status lain (termasuk
// "borrowed"/"active"/"approved"/"in_use"/"sedang_dipinjam"/"sedang_dipakai"/
// "temporary_use" dari data lama, atau kosong) dianggap MASIH AKTIF selama
// belum ada returnedAt.
const CLOSED_BORROWING_STATUSES = ["returned", "completed", "cancelled", "rejected"];

// Section 4 — definisi "borrowing aktif" dipusatkan di sini: belum
// returned/completed/cancelled/rejected, dan (kalau status-nya dikenal)
// harus salah satu status aktif di atas — data lama tanpa status sama
// sekali dianggap aktif selama belum ada returnedAt.
export function isActiveBorrowing(
  borrowing: BorrowingLike | null | undefined
): boolean {
  if (!borrowing) return false;
  if (borrowing.returnedAt) return false;
  const status = String(borrowing.status || "").toLowerCase();
  if (!status) return true;
  if (CLOSED_BORROWING_STATUSES.includes(status)) return false;
  return true;
}

// Section 1 — prioritas: (1) borrowing aktif yang benar-benar ditemukan di
// asset_borrowings, (2) penanda pemegang pada dokumen assets itu sendiri
// (skema lama/baru sekaligus, lewat normalizeAssetUsageStatus), (3)
// maintenance/inactive dari assetStatus, (4) available.
export function getAssetUsageState(
  asset: Pick<
    Asset,
    "currentUsageStatus" | "assetStatus" | "currentHolderUid" | "currentHolderName" | "currentBorrowerUid" | "currentBorrowerName"
  >,
  activeBorrowing?: BorrowingLike | null
): AssetUsageState {
  if (isActiveBorrowing(activeBorrowing)) return "borrowed";

  if (
    asset.currentUsageStatus === "inspection_required" ||
    (asset as { assetStatus?: string }).assetStatus === "inspection_required"
  ) {
    return "inspection_required";
  }

  const normalized = normalizeAssetUsageStatus(asset);
  if (normalized === "borrowed") {
    // normalizeAssetUsageStatus tidak membedakan "dipinjam formal" vs
    // "dipakai tetap" — pakai currentBorrowingId/currentBorrowerUid sebagai
    // penanda "dipinjam", selain itu anggap "sedang dipakai" (custodian/PIC).
    const hasBorrowMarker = !!(asset.currentBorrowerUid || (asset as { currentBorrowingId?: unknown }).currentBorrowingId);
    return hasBorrowMarker ? "borrowed" : "in_use";
  }
  if (normalized === "maintenance") return "maintenance";

  const rawStatus = String(asset.assetStatus || "").toLowerCase();
  if (["inactive", "disposed", "lost"].includes(rawStatus)) return "inactive";

  return "available";
}

export function getAssetUsageLabel(
  asset: Parameters<typeof getAssetUsageState>[0],
  activeBorrowing?: Parameters<typeof getAssetUsageState>[1]
): string {
  return USAGE_STATE_LABEL[getAssetUsageState(asset, activeBorrowing)];
}

export function getAssetUsageColor(
  asset: Parameters<typeof getAssetUsageState>[0],
  activeBorrowing?: Parameters<typeof getAssetUsageState>[1]
): string {
  return USAGE_STATE_COLOR[getAssetUsageState(asset, activeBorrowing)];
}

export interface AssetHolderInfo {
  uid: string | null;
  name: string | null;
  email: string | null;
  // true kalau sistem TAHU ada pemegang (uid/borrowing aktif ada), terlepas
  // dari apakah namanya sudah ketemu atau belum — dipakai untuk membedakan
  // "Tidak ada" (memang tidak ada) dari "Data pemegang belum tersinkron"
  // (ada, tapi namanya belum ke-resolve).
  hasHolderSignal: boolean;
}

// Section 2 — fallback nama/uid/email PERSIS urutan yang diminta: dokumen
// asset_borrowings AKTIF didahulukan (paling akurat, snapshot saat pinjam),
// baru field pada dokumen assets (bisa dari skema lama ATAUPUN baru).
export function getCurrentAssetHolder(
  asset: Asset,
  activeBorrowing?: BorrowingLike | null
): AssetHolderInfo {
  const b = (activeBorrowing || {}) as Record<string, unknown>;
  const a = asset as unknown as Record<string, unknown>;

  const name =
    (b.borrowedByName as string) ||
    (b.borrowerName as string) ||
    (b.currentHolderName as string) ||
    asset.currentHolderName ||
    asset.currentBorrowerName ||
    (a.borrowedByName as string) ||
    (a.borrowerName as string) ||
    null;

  const uid =
    (b.borrowedByUid as string) ||
    (b.borrowerUid as string) ||
    (b.currentHolderUid as string) ||
    asset.currentHolderUid ||
    asset.currentBorrowerUid ||
    (a.borrowedByUid as string) ||
    (a.borrowerUid as string) ||
    null;

  const email =
    (b.borrowedByEmail as string) ||
    (b.borrowerEmail as string) ||
    asset.currentHolderEmail ||
    (a.currentBorrowerEmail as string) ||
    (a.borrowedByEmail as string) ||
    (a.borrowerEmail as string) ||
    null;

  const hasHolderSignal = !!uid || isActiveBorrowing(activeBorrowing);

  return { uid: uid || null, name: name || null, email: email || null, hasHolderSignal };
}

// Section 2 — teks yang ditampilkan untuk "Pemegang Saat Ini". TIDAK PERNAH
// "Belum tercatat" kalau sistem sebenarnya tahu ada pemegang (hasHolderSignal
// true) — itu menyesatkan. "Tidak ada" hanya kalau memang tidak ada
// penanda pemegang sama sekali.
export function getCurrentAssetHolderDisplayText(holder: AssetHolderInfo): string {
  if (holder.name) return holder.name;
  if (holder.hasHolderSignal) return "Data pemegang belum tersinkron";
  return "Tidak ada";
}

// Section 3/11 — kondisi FISIK aset (BUKAN status pemakaian) — reuse
// helper yang sudah ada di lib/utils.ts (sudah hasActiveIssue-aware),
// diekspor ulang di sini supaya satu tempat ini jadi rujukan tunggal
// "status aset" (pemakaian + kondisi) untuk halaman yang butuh keduanya.
export const getAssetConditionState = getAssetConditionLabel;
export { getAssetConditionLabel, getAssetConditionColor };
export const isAssetProblematic = isProblemAsset;

export interface ActiveIssueSummary {
  hasIssue: boolean;
  ticketNo: string | null;
  symptomLabel: string | null;
  note: string | null;
}

export function getActiveIssueSummary(
  asset: Pick<Asset, "hasActiveIssue" | "condition" | "activeIssueTicketNo" | "lastIssueSymptomLabel" | "lastIssueNote">
): ActiveIssueSummary {
  const hasIssue = asset.hasActiveIssue === true || asset.condition === "reported_issue";
  if (!hasIssue) return { hasIssue: false, ticketNo: null, symptomLabel: null, note: null };
  return {
    hasIssue: true,
    ticketNo: asset.activeIssueTicketNo || null,
    symptomLabel: asset.lastIssueSymptomLabel || null,
    note: asset.lastIssueNote || null,
  };
}

export interface AssetDataAnomaly {
  code: string;
  severity: "low" | "medium" | "high";
  title: string;
  message: string;
}

// Section 13 — deteksi anomali MINIMAL, bahasa netral (bukan "korupsi
// data") — cuma dipakai untuk beri sinyal ke Asset Admin/QHSE, tidak pernah
// diblokir untuk staff biasa.
export function detectAssetDataAnomalies(
  asset: Asset,
  activeBorrowings: BorrowingLike[]
): AssetDataAnomaly[] {
  const anomalies: AssetDataAnomaly[] = [];
  const activeOnes = activeBorrowings.filter(isActiveBorrowing);

  const rawStatus = String(asset.currentUsageStatus || asset.assetStatus || "").toLowerCase();
  const looksAvailable = ["available", "tersedia", "ready", "aktif"].includes(rawStatus);

  if (looksAvailable && activeOnes.length > 0) {
    anomalies.push({
      code: "AVAILABLE_WITH_ACTIVE_BORROWING",
      severity: "high",
      title: "Status pemakaian tidak sinkron",
      message: "Aset tercatat tersedia tetapi memiliki peminjaman aktif. Perlu pemeriksaan fisik dan sinkronisasi data.",
    });
  }

  if (activeOnes.length > 1) {
    anomalies.push({
      code: "DUPLICATE_ACTIVE_BORROWING",
      severity: "high",
      title: "Peminjaman aktif ganda",
      message: "Aset ini memiliki lebih dari satu catatan peminjaman aktif. Perlu pemeriksaan untuk mencegah ketidaksesuaian.",
    });
  }

  if (activeOnes.length > 0 && !asset.currentHolderUid && !asset.currentBorrowerUid) {
    anomalies.push({
      code: "EMPTY_HOLDER_WITH_ACTIVE_BORROWING",
      severity: "medium",
      title: "Data pemegang tidak lengkap",
      message: "Ada peminjaman aktif, tetapi dokumen aset belum mencatat pemegangnya. Data diambil dari riwayat peminjaman.",
    });
  }

  return anomalies;
}

export function pickLatestActiveBorrowing<T extends { borrowedAt?: unknown; createdAt?: unknown }>(
  borrowings: T[]
): T | null {
  const active = borrowings.filter((b) => isActiveBorrowing(b as Record<string, unknown>));
  if (active.length === 0) return null;
  return [...active].sort((a, b) => {
    const at = (a.borrowedAt as { toMillis?: () => number })?.toMillis?.() || 0;
    const bt = (b.borrowedAt as { toMillis?: () => number })?.toMillis?.() || 0;
    return bt - at;
  })[0];
}

// Section 2 — foto ASLI aset (bukan logo QHSE) untuk Aksi Cepat. Urutan
// fallback field PERSIS seperti diminta: assetPhotoUrl (alias legacy yang
// mungkin dipakai import lama) -> photoUrl (URL langsung) -> imageUrl
// (alias legacy lain) -> photoDriveFileId/driveFileId (lewat proxy
// /api/drive-image, sama seperti Asset Detail page) -> assetPhotoFileId
// (alias legacy Drive file id). Berhenti di kandidat pertama yang ada.
export interface AssetPhotoSrc {
  src: string | null;
  isDriveProxy: boolean;
}

export function resolveAssetPhotoSrc(asset: Asset): AssetPhotoSrc {
  const a = asset as unknown as Record<string, unknown>;
  const directUrl =
    (a.assetPhotoUrl as string) || asset.photoUrl || (a.imageUrl as string) || null;
  if (directUrl) return { src: directUrl, isDriveProxy: false };

  const driveFileId =
    asset.photoDriveFileId || (a.driveFileId as string) || (a.assetPhotoFileId as string) || null;
  if (driveFileId) {
    return { src: `/api/drive-image?fileId=${encodeURIComponent(driveFileId)}`, isDriveProxy: true };
  }

  return { src: null, isDriveProxy: false };
}

export interface AssetVerificationIndicator {
  key: string;
  label: string;
  ok: boolean;
}

// Section 4 — indikator kelengkapan identitas fisik aset, dipakai untuk
// blok "Identitas Aset Terverifikasi" di Aksi Cepat. "Pernah diverifikasi"
// HANYA true kalau sudah pernah ada "Konfirmasi Aset Sesuai" (verificationStatus
// === "verified") — scan QR semata tidak pernah mengubah nilai ini.
export function getAssetVerificationIndicators(asset: Asset): AssetVerificationIndicator[] {
  const photo = resolveAssetPhotoSrc(asset);
  return [
    { key: "photo", label: "Foto aset tersedia", ok: !!photo.src },
    { key: "code", label: "Kode aset sesuai", ok: !!asset.assetCode },
    { key: "serial", label: "Nomor seri tercatat", ok: !!asset.serialNumber },
    { key: "tag", label: "Tag fisik aktif", ok: !!asset.qrTagId },
    { key: "verified", label: "Pernah diverifikasi", ok: asset.verificationStatus === "verified" },
  ];
}

export function isAssetIdentityIncomplete(asset: Asset): boolean {
  return getAssetVerificationIndicators(asset).some((i) => !i.ok);
}

// Re-export supaya konsumen tidak perlu import dari dua tempat.
export { ASSET_STATUS_LABEL, ASSET_STATUS_COLOR };
export type { AssetIssueTicket };
