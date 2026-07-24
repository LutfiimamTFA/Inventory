import { Asset, AssetBorrowing, AssetUser, IssueSymptomType } from "@/lib/types";
import { isActiveBorrowing } from "@/lib/assets/asset-status";
import { hasActiveIssueTicket } from "@/lib/utils";

type BorrowingLike =
  | AssetBorrowing
  | (Partial<AssetBorrowing> & { id?: string; [key: string]: unknown })
  | null
  | undefined;
type ReportUser = Pick<AssetUser, "uid" | "name" | "email" | "role"> | null | undefined;

export type AssetIssueReportSource =
  | "current_holder"
  | "active_borrower"
  | "shared_asset_user"
  | "operational_pic"
  | "qr_physical_observation"
  | "qhse_inspection"
  | "asset_admin_inspection"
  | "manual_web";

export type AssetIssueReporterRelationship =
  | "current_holder"
  | "active_borrower"
  | "shared_asset_user"
  | "operational_pic"
  | "physical_observer"
  | "qhse_inspector"
  | "asset_admin_inspector"
  | "manual_reporter";

export interface AssetIssueReportContext {
  canReport: boolean;
  reportSource: AssetIssueReportSource;
  reporterRelationship: AssetIssueReporterRelationship;
  sourceBorrowingId: string | null;
  sourceQrScanLogId: string | null;
  requiresEvidence: boolean;
  reason?: string;
}

export const ISSUE_SYMPTOM_OPTIONS: IssueSymptomType[] = [
  "Lemot / Lambat",
  "Storage Penuh",
  "Tidak Menyala",
  "Tidak Bisa Digunakan",
  "Error Sistem",
  "Koneksi Bermasalah",
  "Rusak Fisik",
  "Tidak Lengkap",
  "Aksesori Hilang",
  "Hilang",
  "Lainnya",
];

export const ISSUE_EVIDENCE_REQUIRED_SYMPTOMS: IssueSymptomType[] = [
  "Rusak Fisik",
  "Tidak Lengkap",
  "Aksesori Hilang",
  "Hilang",
];

export function isIssueEvidenceRequired(symptomType?: IssueSymptomType | ""): boolean {
  return !!symptomType && ISSUE_EVIDENCE_REQUIRED_SYMPTOMS.includes(symptomType);
}

function getBorrowingId(activeBorrowing: BorrowingLike): string | null {
  return activeBorrowing?.id || null;
}

function borrowingMatchesCurrentUser(activeBorrowing: BorrowingLike, uid: string): boolean {
  if (!activeBorrowing || !isActiveBorrowing(activeBorrowing as AssetBorrowing | Record<string, unknown>)) return false;
  const b = activeBorrowing as AssetBorrowing & Record<string, unknown>;
  return (
    b.borrowedByUid === uid ||
    (b.borrowerUid as string | undefined) === uid ||
    (b.currentHolderUid as string | undefined) === uid
  );
}

function isOperationalPic(asset: Asset, uid: string): boolean {
  const a = asset as unknown as Record<string, unknown>;
  return [
    asset.custodianUid,
    asset.responsiblePersonUid,
    asset.picUid,
    asset.areaPicUid,
    asset.locationPicUid,
    a.operationalPicUid,
  ].some((candidate) => candidate === uid);
}

function isCurrentHolder(asset: Asset, uid: string): boolean {
  return asset.currentHolderUid === uid || asset.currentBorrowerUid === uid;
}

function isSharedAssetUser(asset: Asset, activeBorrowing: BorrowingLike, uid: string): boolean {
  const isSharedAsset =
    asset.trackingMode === "shared_borrowable" ||
    asset.usageType === "shared_pool" ||
    (!asset.trackingMode && asset.usageType !== "assigned_daily");
  return isSharedAsset && (isCurrentHolder(asset, uid) || borrowingMatchesCurrentUser(activeBorrowing, uid));
}

function hasHolderSignal(asset: Asset, activeBorrowing: BorrowingLike): boolean {
  return !!(
    asset.currentHolderUid ||
    asset.currentBorrowerUid ||
    asset.currentHolderName ||
    asset.currentBorrowerName ||
    isActiveBorrowing(activeBorrowing as AssetBorrowing | Record<string, unknown>)
  );
}

function isAvailableOrUnheld(asset: Asset, activeBorrowing: BorrowingLike): boolean {
  const status = String(asset.currentUsageStatus || asset.assetStatus || "").toLowerCase();
  const available = !status || status === "available" || status === "tersedia";
  return available || !hasHolderSignal(asset, activeBorrowing);
}

function blockedContext(reason: string): AssetIssueReportContext {
  return {
    canReport: false,
    reportSource: "manual_web",
    reporterRelationship: "manual_reporter",
    sourceBorrowingId: null,
    sourceQrScanLogId: null,
    requiresEvidence: false,
    reason,
  };
}

// Role yang boleh membuat laporan KEDUA pada aset yang sudah punya laporan
// aktif — HANYA lewat konfirmasi eksplisit bahwa masalahnya berbeda
// (allowDuplicateOverride), tidak pernah otomatis/diam-diam.
export function canOverrideActiveIssueTicket(role?: string | null): boolean {
  return role === "super_admin" || role === "asset_admin";
}

export function getAssetIssueReportContext({
  user,
  asset,
  activeBorrowing,
  allowQrPhysicalObservation = false,
  sourceQrScanLogId = null,
  allowDuplicateOverride = false,
}: {
  user: ReportUser;
  asset: Asset;
  activeBorrowing?: BorrowingLike;
  allowQrPhysicalObservation?: boolean;
  sourceQrScanLogId?: string | null;
  // Section — hanya diisi true kalau Asset Admin/QHSE sudah mengonfirmasi
  // eksplisit lewat modal (lihat ReportIssueModal) bahwa laporan ini
  // memang masalah BERBEDA dari tiket aktif yang sudah ada.
  allowDuplicateOverride?: boolean;
}): AssetIssueReportContext {
  if (!user?.uid) return blockedContext("Sesi login tidak ditemukan.");

  // Section — cegah laporan ganda: kalau aset sudah punya tiket kendala
  // aktif, "Laporkan Kendala" tidak pernah ditawarkan (di SEMUA tempat yang
  // memanggil fungsi ini — tabel Assets/Scan QR, detail aset, My
  // Borrowings, modal pengembalian) kecuali Asset Admin/QHSE sudah
  // mengonfirmasi eksplisit bahwa ini masalah berbeda.
  if (hasActiveIssueTicket(asset) && !(allowDuplicateOverride && canOverrideActiveIssueTicket(user.role))) {
    return blockedContext("Aset ini sudah memiliki laporan kendala aktif.");
  }

  if (user.role === "super_admin") {
    return {
      canReport: true,
      reportSource: "asset_admin_inspection",
      reporterRelationship: "asset_admin_inspector",
      sourceBorrowingId: getBorrowingId(activeBorrowing),
      sourceQrScanLogId,
      requiresEvidence: false,
    };
  }

  if (user.role === "asset_admin") {
    return {
      canReport: true,
      reportSource: "qhse_inspection",
      reporterRelationship: "qhse_inspector",
      sourceBorrowingId: getBorrowingId(activeBorrowing),
      sourceQrScanLogId,
      requiresEvidence: false,
    };
  }

  if (asset.currentHolderUid === user.uid) {
    return {
      canReport: true,
      reportSource: "current_holder",
      reporterRelationship: "current_holder",
      sourceBorrowingId: getBorrowingId(activeBorrowing),
      sourceQrScanLogId,
      requiresEvidence: false,
    };
  }

  if (asset.currentBorrowerUid === user.uid || borrowingMatchesCurrentUser(activeBorrowing, user.uid)) {
    return {
      canReport: true,
      reportSource: "active_borrower",
      reporterRelationship: "active_borrower",
      sourceBorrowingId: getBorrowingId(activeBorrowing),
      sourceQrScanLogId,
      requiresEvidence: false,
    };
  }

  if (isSharedAssetUser(asset, activeBorrowing, user.uid)) {
    return {
      canReport: true,
      reportSource: "shared_asset_user",
      reporterRelationship: "shared_asset_user",
      sourceBorrowingId: getBorrowingId(activeBorrowing),
      sourceQrScanLogId,
      requiresEvidence: false,
    };
  }

  if (isOperationalPic(asset, user.uid)) {
    return {
      canReport: true,
      reportSource: "operational_pic",
      reporterRelationship: "operational_pic",
      sourceBorrowingId: getBorrowingId(activeBorrowing),
      sourceQrScanLogId,
      requiresEvidence: false,
    };
  }

  if (allowQrPhysicalObservation && isAvailableOrUnheld(asset, activeBorrowing)) {
    return {
      canReport: true,
      reportSource: "qr_physical_observation",
      reporterRelationship: "physical_observer",
      sourceBorrowingId: getBorrowingId(activeBorrowing),
      sourceQrScanLogId,
      requiresEvidence: true,
    };
  }

  return blockedContext("Anda tidak tercatat sebagai pemegang, peminjam aktif, pengguna bersama, atau PIC operasional aset ini.");
}

export function canReportAssetIssue(
  user: ReportUser,
  asset: Asset,
  activeBorrowing?: BorrowingLike
): boolean {
  return getAssetIssueReportContext({ user, asset, activeBorrowing }).canReport;
}

// Section — dipakai UI (tombol "Laporkan Kendala") untuk membedakan "tidak
// berhak melapor" dari "sudah ada laporan aktif" supaya pesan/aksi yang
// ditampilkan tepat (Lihat Laporan Aktif / Tambahkan Bukti), bukan cuma
// tombol yang hilang tanpa penjelasan.
export function getAssetActiveIssueBlockReason(asset: Asset): string | null {
  return hasActiveIssueTicket(asset) ? "Aset ini sudah memiliki laporan kendala aktif." : null;
}

export function getAssetIssueSourceFields({
  context,
  asset,
  activeBorrowing,
}: {
  context: AssetIssueReportContext;
  asset: Asset;
  activeBorrowing?: BorrowingLike;
}) {
  const b = (activeBorrowing || {}) as AssetBorrowing & Record<string, unknown>;
  const holderUidAtReport =
    (b.borrowedByUid as string | undefined) ||
    (b.borrowerUid as string | undefined) ||
    asset.currentHolderUid ||
    asset.currentBorrowerUid ||
    null;
  const holderNameAtReport =
    (b.borrowedByName as string | undefined) ||
    (b.borrowerName as string | undefined) ||
    asset.currentHolderName ||
    asset.currentBorrowerName ||
    null;

  return {
    reportSource: context.reportSource,
    reporterRelationship: context.reporterRelationship,
    sourceBorrowingId: context.sourceBorrowingId,
    sourceQrScanLogId: context.sourceQrScanLogId,
    holderUidAtReport,
    holderNameAtReport,
    usageStatusAtReport: asset.currentUsageStatus || asset.assetStatus || null,
    conditionAtReport: asset.condition || null,
  };
}
