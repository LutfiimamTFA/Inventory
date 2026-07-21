export type AppRole =
  | "super_admin"
  | "asset_admin"
  | "asset_finance"
  | "location_pic"
  | "it_team"
  | "staff";

export type AssetStatus =
  | "available"
  | "borrowed"
  | "in_use"
  | "maintenance"
  | "broken"
  | "incomplete"
  | "lost"
  | "inactive"
  | "disposed";

export type AssetCondition =
  | "new"
  | "good"
  | "fair"
  | "minor_damage"
  | "heavy_damage";

export type OwnershipStatus =
  | "Aset Perusahaan"
  | "Barang Sewa"
  | "Barang Titipan"
  | "Barang Pinjaman Vendor"
  | "Barang Pribadi Karyawan"
  | "Lainnya";

export type FundingSource =
  | "Kas Perusahaan"
  | "Reimbursement"
  | "Dana Proyek"
  | "Hibah"
  | "Sponsor"
  | "Pembelian Pribadi Dialihkan ke Kantor"
  | "Lainnya";

export interface Asset {
  id: string;
  assetName: string;
  assetCode: string;
  categoryId: string;
  categoryName: string;
  subCategory?: string;
  brand?: string;
  model?: string;
  serialNumber?: string;
  imei?: string;
  description?: string;
  photoUrl?: string;
  photoThumbnailUrl?: string;
  photoFileName?: string;
  photoDriveFileId?: string;
  photoMimeType?: string;
  photoSize?: number;
  photoUploadedAt?: unknown;

  companyOwnerId?: string;
  companyOwnerName?: string;
  divisionOwnerId?: string;
  divisionOwnerName?: string;
  location?: string;
  // Lokasi terstruktur, diisi dari Master Lokasi (asset_locations).
  // Field "location" lama tetap dipertahankan untuk kompatibilitas asset
  // lama yang belum disinkronkan (lihat "Sinkronkan Lokasi Asset Lama").
  buildingId?: string;
  buildingName?: string;
  floorId?: string;
  floor?: string;
  roomId?: string;
  roomName?: string;
  areaId?: string;
  areaName?: string;
  locationId?: string;
  locationText?: string;
  responsiblePersonUid?: string;
  responsiblePersonName?: string;
  responsiblePersonEmail?: string;
  responsiblePersonDivision?: string;
  responsiblePersonJobTitle?: string;
  ownershipStatus: OwnershipStatus;

  // PIC Lokasi — diisi OTOMATIS dari asset_locations saat aset dibuat/lokasi
  // diubah (lihat resolveAreaPic di lib/locations.ts), BUKAN dipilih manual
  // di form. Beda dengan custodian/currentHolder (lihat blok di bawah) yang
  // menunjuk orang yang bertanggung jawab atas BARANG, bukan TEMPAT.
  areaPicUid?: string | null;
  areaPicName?: string | null;
  areaPicEmail?: string | null;
  areaPicLocationId?: string | null;
  areaPicLocationName?: string | null;

  maintenanceEnabled?: boolean;
  maintenanceIntervalMonths?: number;
  lastMaintenanceAt?: unknown;
  nextMaintenanceAt?: unknown;

  purchaseDate?: string;
  purchasePrice?: number;
  vendorName?: string;
  invoiceNumber?: string;
  invoiceFileUrl?: string;
  invoiceFileName?: string;
  invoiceDriveFileId?: string;
  invoiceMimeType?: string;
  invoiceSize?: number;
  invoiceUploadedAt?: unknown;
  fundingSource?: FundingSource;
  purchaseMethod?: string;
  estimatedUsefulLife?: string;
  financeNotes?: string;
  financeStatus?: "complete" | "pending_finance";
  financeUpdatedAt?: unknown;
  financeUpdatedByUid?: string;
  financeUpdatedByName?: string;

  assetStatus: AssetStatus;
  condition: AssetCondition;
  isBorrowable: boolean;
  requiresApproval: boolean;
  accessories?: string;
  operationalNotes?: string;
  qrCodeValue: string;

  currentBorrowingId?: string | null;
  currentBorrowerUid?: string | null;
  currentBorrowerName?: string | null;

  // ── Custodian / pemakaian harian ──────────────────────────────────────
  // Aset "assigned_daily" (mis. HP sosial media, laptop kerja) punya
  // custodian tetap yang TIDAK perlu scan/pinjam setiap hari. Kalau aset
  // dipegang orang lain sementara, currentHolder* berbeda dari custodian*
  // — begitu dikembalikan, currentHolder* disetel balik ke data custodian.
  usageType?: AssetUsageType;
  usageTypeLabel?: string;

  // Mode tracking (section A) — menentukan apakah aset ini masuk sistem
  // pemakaian/PIC sama sekali. "fixed_location" (AC, meja, CCTV, dll) TIDAK
  // punya custodian/currentHolder — cukup lokasi + PIC lokasi + maintenance.
  trackingMode?: TrackingMode;
  trackingModeLabel?: string;

  custodianUid?: string | null;
  custodianName?: string | null;
  custodianEmail?: string | null;
  custodianDivision?: string | null;
  custodianRole?: string | null;

  currentHolderUid?: string | null;
  currentHolderName?: string | null;
  currentHolderEmail?: string | null;
  currentHolderDivision?: string | null;

  currentUsageStatus?: AssetUsageStatus;
  currentUsageStatusLabel?: string;
  currentUsageStartedAt?: unknown;
  currentUsageExpectedReturnAt?: string | null;
  currentUsagePurpose?: string | null;
  currentUsageNote?: string | null;

  // Alias legacy — beberapa data/tampilan lama membaca PIC dari field ini
  // alih-alih custodian* (lihat displayCustodianName di assets/[id]/page.tsx).
  picUid?: string | null;
  picName?: string | null;
  picEmail?: string | null;

  temporaryUseStartedAt?: unknown;
  temporaryUseExpectedReturnAt?: string | null;
  temporaryUseEndedAt?: unknown;
  temporaryUsePurpose?: string | null;
  temporaryUseNote?: string | null;

  handedOverByUid?: string | null;
  handedOverByName?: string | null;
  returnedByUid?: string | null;
  returnedByName?: string | null;

  createdByUid: string;
  createdByName: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export type AssetUsageType = "shared_pool" | "assigned_daily";

export type TrackingMode = "fixed_location" | "assigned_pic" | "shared_borrowable";

export type AssetUsageStatus =
  | "available"
  | "with_custodian"
  | "temporary_used_by_other"
  | "borrowed"
  | "maintenance"
  | "unavailable"
  | "fixed_at_location";

export interface AssetCategory {
  id: string;
  categoryName: string;
  categoryCode: string;
  description?: string;
  status: "active" | "inactive";
  createdByUid: string;
  createdByName: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export type BorrowingStatus = "borrowed" | "returned" | "overdue";

export interface AssetBorrowing {
  id: string;
  assetId: string;
  assetName: string;
  assetCode: string;
  borrowedByUid: string;
  borrowedByName: string;
  borrowedByEmail: string;
  borrowedAt: unknown;
  estimatedReturnAt?: string;
  returnedAt?: unknown;
  status: BorrowingStatus;
  borrowNotes?: string;
  returnCondition?: AssetCondition;
  returnNotes?: string;
}

export interface AssetLog {
  id: string;
  assetId: string;
  assetName: string;
  assetCode: string;
  action: string;
  userUid: string;
  userName: string;
  timestamp: unknown;
  detail?: string;

  // ── Detail perpindahan custodian/pemakai (opsional, hanya diisi untuk
  // action assigned_to_custodian/custodian_changed/temporary_handover/
  // temporary_returned/forced_return/holder_corrected) ────────────────────
  fromUid?: string;
  fromName?: string;
  toUid?: string;
  toName?: string;
  custodianUid?: string;
  custodianName?: string;
  purpose?: string;
  expectedReturnAt?: string;
  note?: string;
}

export interface AssetUser {
  uid: string;
  name: string;
  email: string;
  role: AppRole;
  status: "active" | "inactive";
  createdByUid?: string;
  createdByName?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
  lastLoginAt?: unknown;
}

export type AssetUserLogAction = "change_role" | "enable_user" | "disable_user" | "create_user";

export interface AssetUserLog {
  id: string;
  targetUid: string;
  targetName: string;
  targetEmail: string;
  oldRole?: AppRole;
  newRole?: AppRole;
  oldStatus?: "active" | "inactive";
  newStatus?: "active" | "inactive";
  action: AssetUserLogAction;
  performedByUid: string;
  performedByName: string;
  timestamp: unknown;
  detail?: string;
}

export interface HrpBrand {
  id: string;
  name: string;
  status?: string;
}

export interface DriveUploadResult {
  url: string;
  thumbnailUrl: string;
  fileId: string;
  fileName: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
}

export interface HrpDivision {
  id: string;
  name: string;
}

export interface EmployeeProfile {
  uid: string;
  name: string;
  email: string;
  status: "active" | "inactive";
  divisionId?: string;
  divisionName?: string;
  companyId?: string;
  companyName?: string;
  [key: string]: unknown;
}

export type IssueSymptomType =
  | "Lemot / Lambat"
  | "Memori / Storage Penuh"
  | "Tidak Menyala"
  | "Tidak Bisa Digunakan"
  | "Error Aplikasi / Sistem"
  | "Koneksi Bermasalah"
  | "Fisik Rusak"
  | "Tidak Lengkap"
  | "Hilang"
  | "Lainnya";

export type IssueImpactLevel =
  | "Masih Bisa Dipakai"
  | "Mengganggu Pekerjaan"
  | "Tidak Bisa Dipakai"
  | "Darurat";

export type IssuePriority = "low" | "medium" | "high" | "urgent";

export type IssueSeverity = "low" | "medium" | "high" | "critical";

// Section B perbaikan modal laporan kendala — DUA hal yang beda, jangan
// dicampur: "Tingkat Dampak dari Pelapor" (fieldImpact, pakai skala
// IssueSeverity yang sama) diisi staff saat lapor berdasarkan kondisi di
// lapangan, sedangkan "Prioritas Penanganan QHSE" (handlingPriority) HANYA
// boleh diisi QHSE setelah review, dengan skala kata yang berbeda supaya
// jelas ini keputusan penanganan, bukan penilaian tingkat kerusakan.
export type HandlingPriority = "normal" | "soon" | "urgent" | "emergency";

export type IssueReportType =
  | "asset_issue"
  | "facility_issue"
  | "it_network"
  | "safety_hazard"
  | "environment_issue"
  | "emergency"
  | "other";

// Section G perbaikan alur assignment — tim penanganan laporan kendala
// staff. HANYA "it_team", "qhse", dan "finance" yang punya sumber data
// akun AssetView asli (asset_users role it_team/asset_admin/asset_finance);
// "facility", "security", "vendor", "other" TIDAK punya role/collection
// pendukung di app ini, jadi penanggung jawabnya diisi manual (nama+kontak)
// lewat AssignIssueTicketModal, bukan dropdown user asli.
export type IssueAssignedTeam =
  | "it_team"
  | "facility"
  | "qhse"
  | "security"
  | "vendor"
  | "finance"
  | "other"
  | "external_vendor";

// Alur laporan kendala staff PUNYA status sendiri, TERPISAH dari
// WorkOrderStatus (maintenance rutin) — jangan campur lagi dua alur ini.
// Nilai lama (open/review_by_asset_admin/waiting_diagnosis/checking/
// minor_fix/waiting_sparepart/waiting_vendor/resolved/closed/scheduled)
// SENGAJA dihapus dari union ini; dokumen lama yang masih pakai nilai itu
// akan terbaca sebagai string biasa lewat fallback label di utils.ts.
// "waiting_qhse_review" (versi lama) DIHAPUS dari union ini — diganti
// alur konfirmasi pelapor (waiting_reporter_confirmation/reporter_confirmed)
// karena QHSE TIDAK BOLEH langsung close tanpa hasil penanganan tim DAN
// konfirmasi pelapor di lapangan (lihat lib/issueTicketActions.ts).
export type IssueTicketStatus =
  | "reported"
  | "under_review"
  | "need_more_info"
  | "assigned"
  | "in_progress"
  | "external_coordination"
  | "waiting_reporter_confirmation"
  | "reporter_confirmed"
  | "needs_follow_up"
  | "completed"
  | "cancelled"
  | "rejected"
  | "duplicate";

// Penanganan oleh teknisi/vendor eksternal (tidak login ke AssetView) —
// laporan yang butuh orang luar (teknisi AC/WiFi/listrik/plumbing/tukang
// bangunan/vendor lain) TIDAK dipaksa masuk status "assigned" internal biasa,
// karena tidak ada "Mulai Tangani" dari vendor. QHSE HANYA berperan sebagai
// penghubung/koordinator — bukan pihak yang mengerjakan — jadi statusnya
// sengaja dipersempit jadi 3 saja (lihat ExternalCoordinationStatus):
// QHSE tidak selalu tahu detail teknisi "sedang mengerjakan" di lapangan,
// yang pasti diketahui cuma "sudah dipanggil", "belum datang", "sudah datang".
export type ExternalHandlerType = "wifi_network" | "ac" | "electrical" | "plumbing" | "building" | "other";

export type ExternalCoordinationStatus =
  | "calling_external_technician"
  | "waiting_external_technician"
  | "external_technician_arrived";

// Vendor/pembelian pada laporan kendala staff BUKAN status terpisah —
// hanya sub-penanda di dalam status "needs_follow_up" (lihat Section C
// perbaikan alur laporan kendala: "Teruskan ke Vendor"/"Ajukan Pembelian"
// TETAP needs_follow_up, cuma followUpType yang berubah).
export type IssueFollowUpType = "recheck" | "vendor" | "purchase";

export type IssueCauseCategory =
  | "Software"
  | "Hardware"
  | "Jaringan"
  | "Kelistrikan"
  | "Human Error"
  | "Usia Asset"
  | "Aksesoris Hilang"
  | "Belum Diketahui";

export type IssueActionTaken =
  | "Dibersihkan"
  | "Restart / Reset"
  | "Update Software"
  | "Kosongkan Storage"
  | "Ganti Aksesoris"
  | "Ganti Sparepart"
  | "Serahkan Vendor"
  | "Tidak Ada Tindakan";

export interface AssetIssueTicket {
  id: string;
  ticketNumber: string;
  queueNumber: string;

  reportType?: IssueReportType;
  source?: "manual_web" | "staff_report" | "maintenance_work_order" | "maintenance_finding";
  title?: string;
  severity?: IssueSeverity;
  statusLabel?: string;
  staffStatusLabel?: string;

  // "Tingkat Dampak dari Pelapor" — diisi staff saat lapor, read-only untuk
  // QHSE kecuali lewat alur "Koreksi Dampak" yang wajib alasan. fieldImpact
  // pakai skala IssueSeverity yang sama dengan `severity` (severity tetap
  // disimpan untuk kompatibilitas kode lama yang belum dimigrasikan).
  fieldImpact?: IssueSeverity;
  fieldImpactLabel?: string;
  impactDescription?: string;
  fieldImpactCorrectedByUid?: string;
  fieldImpactCorrectedByName?: string;
  fieldImpactCorrectedAt?: unknown;
  fieldImpactCorrectionReason?: string;

  // "Prioritas Penanganan QHSE" — HANYA QHSE yang mengisi, setelah review.
  // TERPISAH dari fieldImpact/severity (lihat HandlingPriority di atas).
  handlingPriority?: HandlingPriority;
  handlingPriorityLabel?: string;
  handlingPriorityReason?: string;
  handlingPriorityByUid?: string;
  handlingPriorityByName?: string;
  handlingPriorityAt?: unknown;

  // Laporan non-asset (fasilitas/IT-jaringan/K3/lingkungan/darurat/lainnya)
  // TIDAK PERNAH terkait satu asset tertentu — assetId/Name/Code null itu
  // valid, bukan data cacat. locationId/locationText tetap wajib diisi di
  // level form (lihat staff-reports/new/page.tsx) karena laporan non-asset
  // tetap harus punya lokasi.
  assetId?: string | null;
  assetName?: string | null;
  assetCode?: string | null;
  assetCategory?: string;
  assetLocation?: string;
  locationId?: string;
  buildingId?: string | null;
  buildingName?: string;
  floorName?: string;
  roomName?: string;
  areaName?: string;
  locationText?: string;
  floorId?: string | null;
  roomId?: string | null;
  areaId?: string | null;
  detailArea?: string | null;

  reportedByUid: string;
  reportedByName: string;
  reportedByEmail: string;
  reportedAt: unknown;
  createdByUid?: string;
  createdByName?: string;
  createdByEmail?: string;
  updatedByUid?: string;
  updatedByName?: string;

  symptomType: IssueSymptomType;
  impactLevel: IssueImpactLevel;
  description: string;
  attachmentUrls?: string[];
  attachmentFiles?: string[];
  photoUrls?: string[];

  priority: IssuePriority;
  status: IssueTicketStatus;

  reviewedByUid?: string;
  reviewedByName?: string;
  reviewedAt?: unknown;
  reviewNote?: string;

  // Section G/I perbaikan alur — "Teruskan ke Tim Terkait" TIDAK LAGI cuma
  // ubah status, wajib pilih tim + penanggung jawab lewat AssignIssueTicketModal.
  assignedToUid?: string | null;
  assignedToName?: string | null;
  assignedToEmail?: string | null;
  assignedToRole?: string | null;
  assignedTeam?: IssueAssignedTeam | null;
  assignedTeamLabel?: string | null;
  assignedAt?: unknown;
  assignedByUid?: string;
  assignedByName?: string;

  // Vendor eksternal — dipakai kalau assignedTeam == "vendor" dan tidak ada
  // akun AssetView untuk penanggung jawabnya.
  vendorName?: string | null;
  vendorContact?: string | null;

  assignmentInstruction?: string;
  targetResolutionAt?: unknown;
  targetResolutionLabel?: string;

  reassignedAt?: unknown;
  reassignedByUid?: string;
  reassignedByName?: string;
  reassignmentReason?: string;

  // Penanganan teknisi/vendor eksternal — vendor TIDAK login ke AssetView,
  // jadi tidak ada assignedToUid; QHSE hanya mencatat proses memanggilkan
  // teknisi + estimasi kedatangan (bukan progres pengerjaan detail, karena
  // QHSE bukan yang mengerjakan dan belum tentu tahu detailnya).
  externalHandling?: boolean;
  externalHandlerType?: ExternalHandlerType;
  externalHandlerLabel?: string;
  externalCoordinationStatus?: ExternalCoordinationStatus;
  externalCoordinationStatusLabel?: string;
  externalEstimatedArrivalAt?: unknown;
  externalEstimatedArrivalLabel?: string;
  coordinationNote?: string;
  noteForReporter?: string;

  diagnosis?: string;
  causeCategory?: IssueCauseCategory;
  actionTaken?: IssueActionTaken;
  estimatedStartAt?: string;
  estimatedFinishAt?: string;

  resolutionNote?: string;
  resolvedAt?: unknown;
  closedAt?: unknown;

  // Section G — field alur laporan kendala staff yang TERKONTROL lewat
  // tombol aksi (bukan dropdown status bebas), lihat lib/issueTicketActions.ts.
  startedAt?: unknown;
  startedByUid?: string;
  startedByName?: string;

  resolutionPhotoUrls?: string[];
  handledAt?: unknown;
  handledByUid?: string;
  handledByName?: string;
  waitingReporterConfirmationAt?: unknown;

  reporterConfirmedAt?: unknown;
  reporterConfirmedByUid?: string;
  reporterConfirmedByName?: string;
  reporterConfirmationNote?: string;

  // Pelapor menyatakan "Masih Bermasalah" saat waiting_reporter_confirmation
  // — field TERPISAH dari reopenReason (itu milik aksi QHSE "Buka Kembali"
  // laporan yang sudah closed, alur berbeda sama sekali).
  reporterRejectedResolutionAt?: unknown;
  reporterRejectedResolutionByUid?: string;
  reporterRejectedResolutionByName?: string;
  reporterRejectedResolutionNote?: string;
  reporterRejectedResolutionPhotoUrls?: string[];

  followUpType?: IssueFollowUpType;

  completedAt?: unknown;
  completedByUid?: string;
  completedByName?: string;
  completionNote?: string;

  cancelReason?: string;
  rejectReason?: string;
  duplicateNote?: string;
  reopenReason?: string;

  lastActivityAt?: unknown;
  lastActivityByUid?: string;
  lastActivityByName?: string;
  lastActivityMessage?: string;

  // Diisi kalau ticket dibuat otomatis dari temuan Work Order Maintenance,
  // bukan dari laporan staff via Scan QR/manual web.
  workOrderId?: string;
  workOrderNumber?: string;
  workOrderItemId?: string;

  createdAt: unknown;
  updatedAt: unknown;
}

// Log alur laporan kendala staff — collection asset_issue_ticket_logs,
// TERPISAH dari AssetIssueLog/asset_issue_logs (log lama, masih dipakai
// jalur lain yang belum dimigrasikan). Setiap tombol aksi di
// IssueTicketDetailModal menulis satu entri ke sini.
export type IssueTicketLogAction =
  | "created"
  | "review"
  | "request_info"
  | "complete_info"
  | "forward"
  | "reassign"
  | "start"
  | "send_result"
  | "mark_follow_up"
  | "request_vendor"
  | "request_purchase"
  | "confirm_done"
  | "still_problem"
  | "close"
  | "reject"
  | "duplicate"
  | "cancel"
  | "reopen"
  | "status_moved"
  | "correct_impact"
  | "set_handling_priority"
  | "assign_external"
  | "external_coordination_updated"
  | "mark_technician_arrived";

export interface AssetIssueTicketLog {
  id: string;
  ticketId: string;
  ticketNumber?: string;
  action: IssueTicketLogAction | string;
  actionLabel: string;
  fromStatus?: IssueTicketStatus | string | null;
  toStatus?: IssueTicketStatus | string | null;
  message: string;
  note?: string | null;
  actorRole?: string;
  createdAt: unknown;
  createdByUid: string;
  createdByName: string;
  reporterUid?: string;
}

export type AssetIssueLogAction =
  | "create_ticket"
  | "review_ticket"
  | "forward_to_technician"
  | "request_more_info"
  | "reject_ticket"
  | "start_diagnosis"
  | "update_diagnosis"
  | "update_estimation"
  | "mark_resolved"
  | "mark_follow_up"
  | "close_ticket";

export interface AssetIssueLog {
  id: string;
  ticketId: string;
  ticketNumber: string;
  action: AssetIssueLogAction;
  oldStatus?: IssueTicketStatus;
  newStatus?: IssueTicketStatus;
  note?: string;
  performedByUid: string;
  performedByName: string;
  performedAt: unknown;
}

// ── Maintenance Work Order ────────────────────────────────────────────────

export type MaintenanceType =
  | "routine"
  | "location_based"
  | "category_based"
  | "manual_request"
  | "follow_up_ticket";

export type AssetSelectionMode = "all_assets" | "filtered_assets";

export interface MaintenanceFiltersSnapshot {
  searchText?: string;
  assetBuildingName?: string;
  assetFloor?: string;
  assetRoomName?: string;
  assetAreaName?: string;
  categoryText?: string;
  statusText?: string;
  conditionText?: string;
}

export type WorkOrderPriority = "low" | "medium" | "high" | "urgent";

export type WorkOrderRecurrence =
  | "none"
  | "monthly"
  | "every_3_months"
  | "every_6_months"
  | "yearly"
  | "custom";

export type WorkOrderStatus =
  | "draft"
  | "scheduled"
  | "created"
  | "accepted"
  | "scheduled_by_it"
  | "assigned"
  | "in_progress"
  | "partially_completed"
  | "report_submitted"
  | "revision_requested"
  | "completed"
  | "cancelled"
  | "overdue";

export interface AssetSnapshot {
  assetId: string;
  assetName: string;
  assetCode: string;
  assetCategory?: string;
  assetLocation?: string;
  condition?: AssetCondition;
  assetStatus?: AssetStatus;
}

export type MaintenanceTaskCategory = "routine" | "corrective";

export type MaintenanceSource =
  | "routine_schedule"
  | "staff_issue"
  | "follow_up_ticket"
  | "manual_corrective"
  | "routine_follow_up";

export interface MaintenanceWorkOrder {
  id: string;
  workOrderNumber: string;

  title: string;
  description?: string;
  maintenanceType: MaintenanceType;

  // Pembeda tab Maintenance & Kendala: "routine" = jadwal berkala/preventive
  // (Jadwal Maintenance Rutin), "corrective" = tugas insidental di luar
  // jadwal (Tugas Maintenance Saya). Data lama tanpa field ini dianggap
  // "routine" karena dulu hanya jadwal rutin yang membuat dokumen di
  // collection ini.
  taskCategory?: MaintenanceTaskCategory;
  maintenanceSource?: MaintenanceSource;

  frequencyMonths: number;
  frequencyLabel: string;

  startMonth: number;
  startYear: number;
  periodLabel: string;
  scheduledDayOfMonth: number;

  nextDueAt?: string;
  // Date-key "YYYY-MM-DD" murni, sumber tunggal untuk compare overdue/
  // display/filter/summary — dibangun dari komponen tahun/bulan/tanggal
  // langsung (bukan toISOString()) supaya tidak mundur 1 hari di WIB.
  dueDateKey?: string;
  lastGeneratedAt?: unknown;

  assetSelectionMode: AssetSelectionMode;
  filtersSnapshot?: MaintenanceFiltersSnapshot;

  // Dipertahankan untuk kompatibilitas data lama (alamat maintenance bebas
  // teks). Alamat maintenance sekarang wajib dari Master Lokasi — lihat
  // field maintenanceBuildingId dst di bawah.
  buildingName?: string;
  floor?: string;
  roomName?: string;
  areaName?: string;
  locationText?: string;

  maintenanceBuildingId?: string;
  maintenanceBuildingName?: string;
  maintenanceFloorId?: string;
  maintenanceFloorName?: string;
  maintenanceRoomId?: string;
  maintenanceRoomName?: string;
  maintenanceAreaId?: string;
  maintenanceAreaName?: string;
  maintenanceLocationText?: string;

  assetIds: string[];
  assetSnapshots: AssetSnapshot[];

  // Dipertahankan untuk kompatibilitas data lama (tidak lagi diisi dari form
  // QHSE — tanggal kunjungan digantikan oleh Frekuensi + Setiap Tanggal).
  scheduledDate?: string;
  scheduledStartTime?: string;
  scheduledEndTime?: string;

  priority: WorkOrderPriority;
  status: WorkOrderStatus;

  requestedByUid: string;
  requestedByName: string;
  requestedByRole: AppRole;

  assignedToUid?: string;
  assignedToName?: string;
  assignedToEmail?: string;
  assignedToRole?: AppRole;
  technicianUid?: string;
  technicianName?: string;
  technicianEmail?: string;
  // Alias legacy — beberapa dokumen lama/jalur berbeda menyimpan penugasan
  // teknisi di field ini alih-alih assignedToUid/technicianUid.
  assignedTechnicianUid?: string;
  assignedTechnicianName?: string;
  assignedTechnicianEmail?: string;
  assignedAt?: unknown;

  checklistItems?: string[];

  qhseNote?: string;
  notes?: string;
  createdAt: unknown;
  updatedAt: unknown;

  acceptedAt?: unknown;
  acceptedByUid?: string;
  acceptedByName?: string;

  // Rencana pengerjaan yang diisi IT (status "scheduled_by_it") supaya QHSE
  // dan penanggung jawab asset tahu kapan maintenance akan dikerjakan.
  plannedWorkDate?: string;
  plannedStartTime?: string;
  plannedEndTime?: string;
  plannedNote?: string;
  willInterruptUser?: boolean;
  scheduledByItAt?: unknown;
  scheduledByItUid?: string;
  scheduledByItName?: string;

  startedAt?: unknown;
  startedByUid?: string;
  startedByName?: string;

  reportSubmittedAt?: unknown;
  reportSubmittedByUid?: string;
  reportSubmittedByName?: string;

  // ── Laporan akhir Tim IT (rekap semua item + kesimpulan/rekomendasi) ────
  reportSummary?: string;
  reportConclusion?: string;
  reportRecommendation?: string;
  reportData?: Record<string, unknown>;

  completedAt?: unknown;
  completedByUid?: string;
  completedByName?: string;

  cancelledAt?: unknown;
  cancelledByUid?: string;
  cancelledByName?: string;
  cancelReason?: string;

  // ── Aksi Bantuan (revisi/kembalikan/buka ulang/ulang cek) ─────────────────
  // Semua field di bawah bersifat tambahan/append-only — tidak pernah
  // menghapus timestamp/laporan/history lama, hanya mencatat aksi koreksi.
  revisionRequestedAt?: unknown;
  revisionRequestedByUid?: string;
  revisionRequestedByName?: string;
  revisionNote?: string;

  previousStatus?: WorkOrderStatus;

  reopenedAt?: unknown;
  reopenedByUid?: string;
  reopenedByName?: string;
  reopenReason?: string;

  retryCount?: number;

  // ── Edit Jadwal Maintenance Rutin ──────────────────────────────────────────
  lastEditedAt?: unknown;
  lastEditedByUid?: string;
  lastEditedByName?: string;
  lastEditReason?: string;
  // Alias generik "siapa/kapan terakhir update dokumen ini" — sama nilainya
  // dengan lastEditedByUid/Name, dipertahankan karena beberapa konsumen
  // memakai nama field ini.
  updatedByUid?: string;
  updatedByName?: string;

  // Perubahan yang disimpan untuk "Periode Berikutnya Saja" — jadwal aktif
  // sekarang TIDAK berubah, field ini baru dipakai saat periode berikutnya
  // dibuat/generate. Bentuknya subset dari field jadwal (title, frequency,
  // dst) yang sengaja longgar (unknown) karena hanya dipakai sebagai draft.
  nextConfig?: Record<string, unknown>;

  // ── Ringkasan temuan Tim IT yang butuh review QHSE (lihat field serupa di
  // MaintenanceWorkOrderItem) — dipakai supaya tab "Butuh Tindakan Lanjutan"
  // QHSE bisa langsung tahu ada temuan tanpa perlu buka tiap item.
  hasFindings?: boolean;
  needsQhseReview?: boolean;
  followUpStatus?:
    | "waiting_qhse_decision"
    | "noted"
    | "recheck_requested"
    | "corrective_task_created"
    | "waiting_purchase"
    | "waiting_vendor"
    | "asset_temporarily_unusable";
  lastFindingAt?: unknown;
  lastFindingByUid?: string;
  lastFindingByName?: string;
  lastActivityAt?: unknown;
  lastActivityByUid?: string;
  lastActivityByName?: string;
  lastActivityMessage?: string;
}

export type WorkOrderItemStatus =
  | "pending"
  | "in_progress"
  | "checked"
  | "needs_follow_up"
  | "skipped";

export type MaintenanceActionTaken =
  | "no_action"
  | "cleaned"
  | "reconfigured"
  | "minor_repair"
  | "software_update"
  | "clear_storage"
  | "replace_component"
  | "need_purchase"
  | "need_vendor"
  | "need_follow_up_ticket"
  | "temporarily_unusable";

export type MaintenanceConditionLabel =
  | "Baik"
  | "Cukup"
  | "Rusak Ringan"
  | "Rusak Berat"
  | "Tidak Bisa Digunakan";

export interface MaintenanceChecklistState {
  fisikDicek: boolean;
  fungsiUtamaBerjalan: boolean;
  aksesorisLengkap: boolean;
  kebersihanDicek: boolean;
  labelQrTerbaca: boolean;
  lokasiSesuai: boolean;
  tidakAdaKerusakanKritis: boolean;
}

export interface MaintenanceWorkOrderItem {
  id: string;
  workOrderId: string;
  assetId: string;
  assetName: string;
  assetCode: string;
  assetCategory?: string;
  assetLocation?: string;

  status: WorkOrderItemStatus;
  conditionBefore?: MaintenanceConditionLabel;
  conditionAfter?: MaintenanceConditionLabel;
  checklist?: MaintenanceChecklistState;
  findings?: string;
  actionTaken?: MaintenanceActionTaken;
  technicianNote?: string;
  photoBeforeUrls?: string[];
  photoAfterUrls?: string[];

  followUpTicketId?: string;
  followUpTicketNumber?: string;

  // ── Alur temuan → QHSE (bukan Tim IT bikin ticket untuk diri sendiri) ────
  // Tim IT hanya menandai needsQhseReview lewat handleReportFindingToQhse;
  // QHSE yang memutuskan followUpStatus berikutnya lewat salah satu
  // handleQhse* di WorkOrderDetailModal (dicatat/cek ulang/tugas
  // korektif/pembelian/vendor/tidak layak pakai).
  needsQhseReview?: boolean;
  followUpStatus?:
    | "waiting_qhse_decision"
    | "noted"
    | "recheck_requested"
    | "corrective_task_created"
    | "waiting_purchase"
    | "waiting_vendor"
    | "asset_temporarily_unusable";
  findingSeverity?: "normal" | "urgent";
  findingAction?: MaintenanceActionTaken;
  findingNote?: string;
  technicalNote?: string;
  actionLabel?: string;
  reportedToQhseAt?: unknown;
  reportedToQhseByUid?: string;
  reportedToQhseByName?: string;

  // Cek ulang atas permintaan QHSE (followUpStatus "recheck_requested") —
  // recheckSavedAt = Tim IT klik "Simpan Hasil Cek Ulang" (draft, belum
  // dikirim), recheckSubmittedAt = Tim IT klik "Kirim Hasil Cek Ulang ke
  // QHSE" (followUpStatus balik ke waiting_qhse_decision).
  recheckSavedAt?: unknown;
  recheckSavedByUid?: string;
  recheckSavedByName?: string;
  recheckSubmittedAt?: unknown;
  recheckSubmittedByUid?: string;
  recheckSubmittedByName?: string;
  recheckResponseNote?: string;

  // Keputusan QHSE atas temuan (lihat followUpStatus di atas untuk hasilnya).
  qhseDecision?: string;
  qhseDecisionLabel?: string;
  qhseDecisionNote?: string;
  qhseDecisionByUid?: string;
  qhseDecisionByName?: string;
  qhseDecisionAt?: unknown;
  purchaseDetail?: string;
  vendorNote?: string;
  correctiveAssignedToUid?: string;
  correctiveAssignedToName?: string;

  checkedByUid?: string;
  checkedByName?: string;
  checkedAt?: unknown;
  createdAt: unknown;
  updatedAt: unknown;
}

export type MaintenanceWorkOrderLogAction =
  | "create_work_order"
  | "assign_work_order"
  | "accept_work_order"
  | "schedule_by_it"
  | "start_work_order"
  | "check_asset_item"
  | "complete_asset_item"
  | "create_follow_up_ticket"
  | "reset_follow_up_ticket"
  | "qhse_finding_decision"
  | "submit_report"
  | "complete_work_order"
  | "cancel_work_order"
  | "request_revision"
  | "return_to_in_progress"
  | "reopen_work_order"
  | "retry_checklist"
  | "return_to_created"
  | "return_to_scheduled"
  | "save_draft_report"
  | "testing_status_change"
  | "maintenance_schedule_updated";

export interface MaintenanceWorkOrderLog {
  id: string;
  workOrderId: string;
  workOrderNumber: string;
  action: MaintenanceWorkOrderLogAction;
  oldStatus?: WorkOrderStatus;
  newStatus?: WorkOrderStatus;
  note?: string;
  // Hanya diisi untuk action "maintenance_schedule_updated" — snapshot field
  // yang berubah saja (bukan seluruh dokumen) supaya log tetap ringkas.
  oldData?: Record<string, unknown>;
  newData?: Record<string, unknown>;
  changedFields?: string[];
  performedByUid: string;
  performedByName: string;
  performedAt: unknown;
}

export interface AssetLocation {
  id: string;
  buildingName: string;
  floor?: string;
  roomName?: string;
  areaName?: string;
  description?: string;
  status: "active" | "inactive";
  createdAt: unknown;
  updatedAt: unknown;
}

// ── Notifikasi ─────────────────────────────────────────────────────────────

export type NotificationType =
  | "asset_borrowed"
  | "asset_returned"
  | "asset_damage_reported"
  | "asset_created"
  | "asset_updated"
  | "asset_status_changed"
  | "ticket_created"
  | "ticket_assigned"
  | "ticket_status_updated"
  | "ticket_need_info"
  | "ticket_resolved"
  | "work_order_assigned"
  | "work_order_accepted"
  | "work_order_scheduled_by_it"
  | "work_order_started"
  | "work_order_report_submitted"
  | "work_order_completed"
  | "work_order_revision_requested"
  | "work_order_reopened"
  | "maintenance_due"
  | "maintenance_overdue"
  | "maintenance_finding_reported"
  | "maintenance_finding_decided"
  | "asset_custodian_assigned"
  | "asset_temporary_handover"
  | "asset_returned_to_custodian"
  | "asset_usage_overdue"
  | "system";

export type NotificationPriority = "low" | "medium" | "high" | "urgent";

export type NotificationRelatedType =
  | "ticket"
  | "work_order"
  | "maintenance_schedule"
  | "borrowing"
  | "asset";

export interface AssetNotification {
  id: string;
  recipientUid: string;
  recipientName: string;
  recipientRole: AppRole;

  title: string;
  message: string;
  type: NotificationType;
  priority: NotificationPriority;

  linkUrl?: string;

  relatedType?: NotificationRelatedType;
  relatedId?: string;
  relatedNumber?: string;

  dedupeKey?: string;

  oldData?: Record<string, unknown>;
  newData?: Record<string, unknown>;
  changeSummary?: string[];

  isRead: boolean;
  readAt?: unknown;

  createdAt: unknown;
  createdByUid?: string;
  createdByName?: string;
}

export interface AssetNotificationToken {
  id: string;
  uid: string;
  email: string;
  displayName: string;
  role: AppRole;
  token: string;
  platform?: string;
  browser?: string;
  userAgent?: string;
  isActive: boolean;
  createdAt: unknown;
  updatedAt: unknown;
  lastUsedAt?: unknown;
}

export interface AssetReportSnapshot {
  id: string;
  period: string;
  periodStart: string;
  periodEnd: string;
  totalAssets: number;
  totalTickets: number;
  totalMaintenance: number;
  totalBorrowings: number;
  totalOverdueMaintenance: number;
  totalCost: number;
  generatedAt: unknown;
  generatedByUid: string;
  generatedByName: string;
}

// ── Master Lokasi ──────────────────────────────────────────────────────────

export type LocationType = "building" | "floor" | "room" | "area";

export interface AssetLocationNode {
  id: string;
  locationType: LocationType;

  buildingName?: string;
  buildingCode?: string;
  floorName?: string;
  roomName?: string;
  roomFunction?: string;
  areaName?: string;

  parentId: string | null;
  parentPath: string[];

  locationLabel: string;
  fullPath: string;

  notes?: string;
  status: "active" | "inactive";

  // PIC Lokasi — orang yang bertanggung jawab mendata/mengawasi aset di
  // level lokasi ini (Gedung/Lantai/Ruangan/Area). BEDA dengan
  // custodian/currentHolder aset (lihat Asset.custodianUid/currentHolderUid)
  // — PIC Lokasi bertanggung jawab atas TEMPATNYA, bukan barang tertentu.
  picUid?: string | null;
  picName?: string | null;
  picEmail?: string | null;
  picRole?: string | null;
  picDivision?: string | null;
  picAssignedAt?: unknown;
  picAssignedByUid?: string | null;
  picAssignedByName?: string | null;

  createdByUid: string;
  createdByName: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export type LocationPicLogAction =
  | "location_pic_assigned"
  | "location_pic_changed"
  | "location_pic_removed";

export interface AssetLocationLog {
  id: string;
  locationId: string;
  locationName: string;
  action: LocationPicLogAction;
  oldPicUid?: string | null;
  oldPicName?: string | null;
  newPicUid?: string | null;
  newPicName?: string | null;
  createdAt: unknown;
  createdByUid: string;
  createdByName: string;
}
