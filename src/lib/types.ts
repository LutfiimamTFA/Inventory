export type AppRole = "super_admin" | "asset_admin" | "it_team" | "staff";

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

  createdByUid: string;
  createdByName: string;
  createdAt: unknown;
  updatedAt: unknown;
}

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

export type IssueTicketStatus =
  | "open"
  | "review_by_asset_admin"
  | "need_more_info"
  | "waiting_diagnosis"
  | "checking"
  | "minor_fix"
  | "needs_follow_up"
  | "waiting_sparepart"
  | "waiting_vendor"
  | "resolved"
  | "closed"
  | "rejected";

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

  assetId: string;
  assetName: string;
  assetCode: string;
  assetCategory?: string;
  assetLocation?: string;
  locationId?: string;
  buildingName?: string;
  floorName?: string;
  roomName?: string;
  areaName?: string;
  locationText?: string;

  reportedByUid: string;
  reportedByName: string;
  reportedByEmail: string;
  reportedAt: unknown;

  symptomType: IssueSymptomType;
  impactLevel: IssueImpactLevel;
  description: string;
  attachmentUrls?: string[];
  attachmentFiles?: string[];

  priority: IssuePriority;
  status: IssueTicketStatus;

  reviewedByUid?: string;
  reviewedByName?: string;
  reviewedAt?: unknown;
  reviewNote?: string;

  assignedToUid?: string;
  assignedToName?: string;
  assignedAt?: unknown;

  diagnosis?: string;
  causeCategory?: IssueCauseCategory;
  actionTaken?: IssueActionTaken;
  estimatedStartAt?: string;
  estimatedFinishAt?: string;

  resolutionNote?: string;
  resolvedAt?: unknown;
  closedAt?: unknown;

  // Diisi kalau ticket dibuat otomatis dari temuan Work Order Maintenance,
  // bukan dari laporan staff via Scan QR.
  source?: "staff_report" | "maintenance_work_order";
  workOrderId?: string;
  workOrderNumber?: string;
  workOrderItemId?: string;

  createdAt: unknown;
  updatedAt: unknown;
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
}

export type WorkOrderItemStatus =
  | "pending"
  | "in_progress"
  | "checked"
  | "needs_follow_up"
  | "skipped";

export type MaintenanceActionTaken =
  | "Tidak Ada Tindakan"
  | "Dibersihkan"
  | "Disetting Ulang"
  | "Update Software"
  | "Kosongkan Storage"
  | "Ganti Aksesoris"
  | "Ganti Sparepart"
  | "Perlu Vendor"
  | "Perlu Ticket Kendala Lanjutan";

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

  createdByUid: string;
  createdByName: string;
  createdAt: unknown;
  updatedAt: unknown;
}
