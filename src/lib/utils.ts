import {
  AssetCondition,
  AssetSelectionMode,
  AssetStatus,
  AssetUsageStatus,
  AssetUsageType,
  TrackingMode,
  BorrowingStatus,
  ExternalCoordinationStatus,
  ExternalHandlerType,
  HandlingPriority,
  IssuePriority,
  IssueReportType,
  IssueSeverity,
  IssueTicketStatus,
  MaintenanceConditionLabel,
  MaintenanceType,
  MaintenanceWorkOrder,
  MaintenanceWorkOrderLogAction,
  NotificationPriority,
  NotificationType,
  WorkOrderItemStatus,
  WorkOrderPriority,
  WorkOrderStatus,
} from "@/lib/types";

export function formatCurrency(value?: number) {
  if (value === undefined || value === null) return "-";
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);
}

const DATE_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

// "YYYY-MM-DD" HARUS di-parse sebagai tanggal lokal, bukan lewat
// `new Date(string)` (itu diperlakukan sebagai UTC midnight oleh JS dan bisa
// mundur 1 hari di timezone WIB/UTC+7 saat ditampilkan).
export function parseDateKey(dateKey: string): Date | null {
  const match = DATE_KEY_PATTERN.exec(dateKey);
  if (!match) return null;
  const [, y, m, d] = match;
  return new Date(Number(y), Number(m) - 1, Number(d));
}

function toDisplayDate(value: unknown): Date | null {
  if (!value) return null;
  if (typeof value === "object" && value !== null && "toDate" in value) {
    return (value as { toDate: () => Date }).toDate();
  }
  if (typeof value === "string" && DATE_KEY_PATTERN.test(value)) {
    return parseDateKey(value);
  }
  const d = new Date(value as string);
  return isNaN(d.getTime()) ? null : d;
}

export function formatDate(value: unknown) {
  const d = toDisplayDate(value);
  if (!d) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(d);
}

export const ASSET_STATUS_LABEL: Record<AssetStatus, string> = {
  available: "Tersedia",
  borrowed: "Dipinjam",
  in_use: "Digunakan Tetap",
  maintenance: "Maintenance",
  broken: "Rusak",
  incomplete: "Tidak Lengkap",
  lost: "Hilang",
  inactive: "Nonaktif",
  disposed: "Dihapuskan",
};

export const ASSET_STATUS_HELPER: Record<AssetStatus, string> = {
  available: "Asset siap dipinjam/digunakan.",
  borrowed: "Asset sedang dipinjam staff.",
  in_use: "Asset dipakai tetap oleh orang/divisi tertentu.",
  maintenance: "Asset sedang dicek/diperbaiki.",
  broken: "Asset tidak layak pakai.",
  incomplete: "Asset kurang aksesoris/komponen.",
  lost: "Asset tidak ditemukan.",
  inactive: "Asset tidak digunakan sementara.",
  disposed: "Asset sudah tidak menjadi asset aktif.",
};

export const ASSET_STATUS_COLOR: Record<AssetStatus, string> = {
  available: "bg-emerald-50 text-emerald-700 border-emerald-200",
  borrowed: "bg-amber-50 text-amber-700 border-amber-200",
  in_use: "bg-blue-50 text-blue-700 border-blue-200",
  maintenance: "bg-purple-50 text-purple-700 border-purple-200",
  broken: "bg-red-50 text-red-700 border-red-200",
  incomplete: "bg-orange-50 text-orange-700 border-orange-200",
  lost: "bg-rose-900 text-rose-50 border-rose-900",
  inactive: "bg-slate-100 text-slate-500 border-slate-200",
  disposed: "bg-slate-800 text-slate-100 border-slate-800",
};

// "assigned_daily" SENGAJA dilabeli "Aset dengan PIC", bukan "Ditugaskan
// Tetap" — supaya tidak terkesan aset jadi milik pribadi PIC-nya. Aset tetap
// milik kantor, PIC cuma penanggung jawab operasional; orang lain tetap
// boleh minta pakai sementara (lihat handoverTemporary di custodian-actions.ts).
export const ASSET_USAGE_TYPE_LABEL: Record<AssetUsageType, string> = {
  shared_pool: "Aset Bersama",
  assigned_daily: "Aset dengan PIC",
};

export const ASSET_USAGE_STATUS_LABEL: Record<AssetUsageStatus, string> = {
  available: "Tersedia",
  with_custodian: "Bersama Custodian",
  temporary_used_by_other: "Dipakai Sementara",
  borrowed: "Dipinjam",
  maintenance: "Maintenance",
  unavailable: "Tidak Tersedia",
  fixed_at_location: "Tetap di Lokasi",
};

export const ASSET_USAGE_STATUS_COLOR: Record<AssetUsageStatus, string> = {
  available: "bg-emerald-50 text-emerald-700 border-emerald-200",
  with_custodian: "bg-blue-50 text-blue-700 border-blue-200",
  temporary_used_by_other: "bg-amber-50 text-amber-700 border-amber-200",
  borrowed: "bg-amber-50 text-amber-700 border-amber-200",
  maintenance: "bg-purple-50 text-purple-700 border-purple-200",
  unavailable: "bg-slate-100 text-slate-500 border-slate-200",
  fixed_at_location: "bg-slate-100 text-slate-600 border-slate-200",
};

// Section A — mode tracking aset (lihat AGENTS/spec "Perbaiki konsep Status
// Pemakaian Aset Kantor"). Menentukan apakah aset ini masuk sistem
// pemakaian/PIC sama sekali, atau cukup dilacak di lokasi (AC, meja, CCTV).
export const TRACKING_MODE_LABEL: Record<TrackingMode, string> = {
  fixed_location: "Aset Tetap Lokasi",
  assigned_pic: "Aset dengan PIC Operasional",
  shared_borrowable: "Aset Bersama Bisa Dipakai",
};

export const CONDITION_LABEL: Record<AssetCondition, string> = {
  new: "Baru",
  good: "Baik",
  fair: "Cukup",
  minor_damage: "Rusak Ringan",
  heavy_damage: "Rusak Berat",
};

export const BORROWING_STATUS_LABEL: Record<BorrowingStatus, string> = {
  borrowed: "Dipinjam",
  returned: "Dikembalikan",
  overdue: "Terlambat",
};

export const BORROWING_STATUS_COLOR: Record<BorrowingStatus, string> = {
  borrowed: "bg-amber-50 text-amber-700 border-amber-200",
  returned: "bg-emerald-50 text-emerald-700 border-emerald-200",
  overdue: "bg-red-50 text-red-700 border-red-200",
};

export function formatDateTime(value: unknown) {
  const d = toDisplayDate(value);
  if (!d) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(d);
}

// Format lengkap dengan detik, dipakai di timeline Work Order — mis.
// "15 Jul 2026, 14:32:08".
export function formatDateTimeSeconds(value: unknown) {
  const d = toDisplayDate(value);
  if (!d) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(d);
}

// Section B/K — status laporan kendala staff, TERPISAH dari status
// maintenance rutin (WORK_ORDER_STATUS_LABEL/WorkOrderStatus). Label ini
// untuk sisi QHSE; sisi staff pakai ISSUE_STATUS_STAFF_LABEL (section F).
export const ISSUE_STATUS_LABEL: Record<IssueTicketStatus, string> = {
  reported: "Laporan Masuk",
  under_review: "Ditinjau QHSE",
  need_more_info: "Butuh Info Tambahan",
  assigned: "Menunggu Tim Terkait",
  in_progress: "Sedang Ditangani",
  external_coordination: "Teknisi Eksternal Dipanggilkan",
  waiting_reporter_confirmation: "Menunggu Konfirmasi Pelapor",
  reporter_confirmed: "Dikonfirmasi Pelapor",
  needs_follow_up: "Butuh Tindakan Lanjutan",
  completed: "Selesai",
  cancelled: "Dibatalkan",
  rejected: "Ditolak",
  duplicate: "Duplikat",
};

export const ISSUE_STATUS_COLOR: Record<IssueTicketStatus, string> = {
  reported: "bg-blue-50 text-blue-700 border-blue-200",
  under_review: "bg-indigo-50 text-indigo-700 border-indigo-200",
  need_more_info: "bg-orange-50 text-orange-700 border-orange-200",
  assigned: "bg-amber-50 text-amber-700 border-amber-200",
  in_progress: "bg-purple-50 text-purple-700 border-purple-200",
  external_coordination: "bg-fuchsia-50 text-fuchsia-700 border-fuchsia-200",
  waiting_reporter_confirmation: "bg-cyan-50 text-cyan-700 border-cyan-200",
  reporter_confirmed: "bg-emerald-50 text-emerald-700 border-emerald-200",
  needs_follow_up: "bg-red-50 text-red-700 border-red-200",
  completed: "bg-emerald-50 text-emerald-700 border-emerald-200",
  cancelled: "bg-slate-100 text-slate-500 border-slate-200",
  rejected: "bg-slate-800 text-slate-100 border-slate-800",
  duplicate: "bg-slate-100 text-slate-500 border-slate-200",
};

// Section D/F/J — label yang staff lihat di My Reports, lebih sederhana
// daripada label QHSE (mis. "Ditinjau QHSE" -> "Sedang Ditinjau").
// external_coordination TIDAK PERNAH menunjukkan detail vendor ke staff
// lewat label ini — detailnya ada di EXTERNAL_COORDINATION_STAFF_MESSAGE.
export const ISSUE_STATUS_STAFF_LABEL: Record<IssueTicketStatus, string> = {
  reported: "Laporan Terkirim",
  under_review: "Sedang Ditinjau",
  need_more_info: "Butuh Info Tambahan",
  assigned: "Ditugaskan ke Tim Terkait",
  in_progress: "Sedang Ditangani",
  external_coordination: "Sedang Dipanggilkan",
  waiting_reporter_confirmation: "Menunggu Konfirmasi Anda",
  reporter_confirmed: "Sudah Anda Konfirmasi",
  needs_follow_up: "Butuh Tindakan Lanjutan",
  completed: "Selesai",
  cancelled: "Tidak Dilanjutkan",
  rejected: "Tidak Dilanjutkan",
  duplicate: "Sudah Ada Laporan Serupa",
};

// Section A/C — jenis teknisi/vendor eksternal (tidak login ke AssetView).
export const EXTERNAL_HANDLER_TYPE_LABEL: Record<ExternalHandlerType, string> = {
  wifi_network: "Teknisi WiFi / Jaringan",
  ac: "Teknisi AC",
  electrical: "Teknisi Listrik",
  plumbing: "Teknisi Plumbing",
  building: "Tukang Bangunan",
  other: "Lainnya",
};

// Section A — HANYA 3 status koordinasi. QHSE cuma penghubung, bukan yang
// mengerjakan, jadi sistem tidak berpura-pura tahu detail progres vendor.
export const EXTERNAL_COORDINATION_STATUS_LABEL: Record<ExternalCoordinationStatus, string> = {
  calling_external_technician: "Sedang Dipanggilkan",
  waiting_external_technician: "Menunggu Kedatangan Teknisi",
  external_technician_arrived: "Teknisi Sudah Datang",
};

// Section B/J — kalimat yang staff baca (tanpa nama/kontak vendor mentah).
export const EXTERNAL_COORDINATION_STAFF_MESSAGE: Record<ExternalCoordinationStatus, string> = {
  calling_external_technician: "QHSE sedang memanggilkan teknisi eksternal.",
  waiting_external_technician: "Menunggu kedatangan teknisi eksternal.",
  external_technician_arrived: "Teknisi eksternal sudah datang. Mohon konfirmasi jika kendala sudah selesai.",
};

// Section J — label RINGKAS untuk badge status staff.
export const EXTERNAL_COORDINATION_STAFF_LABEL: Record<ExternalCoordinationStatus, string> = {
  calling_external_technician: "Sedang Dipanggilkan",
  waiting_external_technician: "Menunggu Kedatangan",
  external_technician_arrived: "Mohon Konfirmasi",
};

export const ISSUE_PRIORITY_LABEL: Record<IssuePriority, string> = {
  low: "Rendah",
  medium: "Sedang",
  high: "Tinggi",
  urgent: "Darurat",
};

export const ISSUE_PRIORITY_COLOR: Record<IssuePriority, string> = {
  low: "bg-slate-100 text-slate-600 border-slate-200",
  medium: "bg-amber-50 text-amber-700 border-amber-200",
  high: "bg-orange-50 text-orange-700 border-orange-200",
  urgent: "bg-red-50 text-red-700 border-red-200",
};

export const ISSUE_SEVERITY_LABEL: Record<IssueSeverity, string> = {
  low: "Rendah",
  medium: "Sedang",
  high: "Tinggi",
  critical: "Kritis",
};

export const ISSUE_SEVERITY_COLOR: Record<IssueSeverity, string> = {
  low: "bg-slate-100 text-slate-600 border-slate-200",
  medium: "bg-amber-50 text-amber-700 border-amber-200",
  high: "bg-orange-50 text-orange-700 border-orange-200",
  critical: "bg-red-50 text-red-700 border-red-200",
};

// Section B/I perbaikan modal laporan kendala — "Tingkat Dampak dari
// Pelapor", TERPISAH istilahnya dari ISSUE_SEVERITY_LABEL (yang masih
// dipakai di tempat lain seperti tabel/badge ringkas) supaya di modal detail
// jelas ini penilaian pelapor, bukan keputusan penanganan QHSE.
export const FIELD_IMPACT_LABEL: Record<IssueSeverity, string> = {
  low: "Ringan",
  medium: "Sedang",
  high: "Berat",
  critical: "Darurat",
};

export const FIELD_IMPACT_COLOR: Record<IssueSeverity, string> = ISSUE_SEVERITY_COLOR;

// "Prioritas Penanganan QHSE" — HANYA diisi QHSE setelah review, skala kata
// beda dari FIELD_IMPACT_LABEL supaya tidak tertukar dengan penilaian
// pelapor (lihat HandlingPriority di lib/types.ts).
export const HANDLING_PRIORITY_LABEL: Record<HandlingPriority, string> = {
  normal: "Normal",
  soon: "Perlu Ditangani Segera",
  urgent: "Mendesak",
  emergency: "Darurat",
};

export const HANDLING_PRIORITY_COLOR: Record<HandlingPriority, string> = {
  normal: "bg-slate-100 text-slate-600 border-slate-200",
  soon: "bg-amber-50 text-amber-700 border-amber-200",
  urgent: "bg-orange-50 text-orange-700 border-orange-200",
  emergency: "bg-red-50 text-red-700 border-red-200",
};

export const ISSUE_REPORT_TYPE_LABEL: Record<IssueReportType, string> = {
  asset_issue: "Asset / Barang Rusak",
  facility_issue: "Fasilitas Gedung",
  it_network: "IT / Jaringan",
  safety_hazard: "K3 / Keselamatan",
  environment_issue: "Lingkungan / Kebersihan",
  emergency: "Kejadian Darurat",
  other: "Lainnya",
};

export const ISSUE_REPORT_TYPE_COLOR: Record<IssueReportType, string> = {
  asset_issue: "bg-amber-50 text-amber-700 border-amber-200",
  facility_issue: "bg-blue-50 text-blue-700 border-blue-200",
  it_network: "bg-indigo-50 text-indigo-700 border-indigo-200",
  safety_hazard: "bg-red-50 text-red-700 border-red-200",
  environment_issue: "bg-emerald-50 text-emerald-700 border-emerald-200",
  emergency: "bg-rose-50 text-rose-700 border-rose-200",
  other: "bg-slate-100 text-slate-600 border-slate-200",
};

export const ISSUE_PRIORITY_RANK: Record<IssuePriority, number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export const MAINTENANCE_TYPE_LABEL: Record<MaintenanceType, string> = {
  routine: "Maintenance Rutin",
  location_based: "Berdasarkan Lokasi",
  category_based: "Berdasarkan Kategori",
  manual_request: "Request Manual",
  follow_up_ticket: "Tindak Lanjut Ticket",
};

export const WORK_ORDER_STATUS_LABEL: Record<WorkOrderStatus, string> = {
  draft: "Draft",
  scheduled: "Terjadwal",
  created: "Dibuat oleh QHSE",
  accepted: "Diterima IT",
  scheduled_by_it: "Dijadwalkan IT",
  assigned: "Belum Dikerjakan",
  in_progress: "Sedang Dikerjakan",
  partially_completed: "Sebagian Selesai",
  report_submitted: "Laporan Dikirim",
  revision_requested: "Revisi Diminta",
  completed: "Selesai",
  cancelled: "Dibatalkan",
  overdue: "Terlambat",
};

export const WORK_ORDER_STATUS_COLOR: Record<WorkOrderStatus, string> = {
  draft: "bg-slate-100 text-slate-500 border-slate-200",
  scheduled: "bg-blue-50 text-blue-700 border-blue-200",
  created: "bg-blue-50 text-blue-700 border-blue-200",
  accepted: "bg-cyan-50 text-cyan-700 border-cyan-200",
  scheduled_by_it: "bg-sky-50 text-sky-700 border-sky-200",
  assigned: "bg-indigo-50 text-indigo-700 border-indigo-200",
  in_progress: "bg-purple-50 text-purple-700 border-purple-200",
  partially_completed: "bg-amber-50 text-amber-700 border-amber-200",
  report_submitted: "bg-teal-50 text-teal-700 border-teal-200",
  revision_requested: "bg-orange-50 text-orange-700 border-orange-200",
  completed: "bg-emerald-50 text-emerald-700 border-emerald-200",
  cancelled: "bg-slate-800 text-slate-100 border-slate-800",
  overdue: "bg-red-50 text-red-700 border-red-200",
};

// Satu-satunya sumber label/warna status Work Order — dipakai baik di tabel
// Jadwal Maintenance Rutin maupun di WorkOrderDetailModal supaya keduanya
// selalu sinkron (jangan bikin mapping status terpisah di tempat lain).
export function getMaintenanceStatusLabel(status: WorkOrderStatus): string {
  return WORK_ORDER_STATUS_LABEL[status];
}

export function getMaintenanceStatusColor(status: WorkOrderStatus): string {
  return WORK_ORDER_STATUS_COLOR[status];
}

export interface MaintenanceTimelineStep {
  key:
    | "created"
    | "accepted"
    | "scheduled_by_it"
    | "started"
    | "report_submitted"
    | "completed"
    | "cancelled";
  label: string;
  done: boolean;
  byName?: string;
  at?: unknown;
}

// Urutan step timeline mengikuti status utama work order — hanya step yang
// sudah benar-benar terjadi (ada timestamp-nya) yang ditandai "done", supaya
// badge status di atas dan timeline di bawah tidak pernah bertabrakan.
export function getMaintenanceTimelineSteps(
  workOrder: Pick<
    MaintenanceWorkOrder,
    | "createdAt"
    | "requestedByName"
    | "acceptedAt"
    | "acceptedByName"
    | "scheduledByItAt"
    | "scheduledByItName"
    | "startedAt"
    | "startedByName"
    | "reportSubmittedAt"
    | "reportSubmittedByName"
    | "completedAt"
    | "completedByName"
    | "cancelledAt"
    | "cancelledByName"
    | "status"
  >
): MaintenanceTimelineStep[] {
  const steps: MaintenanceTimelineStep[] = [
    {
      key: "created",
      label: "Dibuat oleh QHSE",
      done: !!workOrder.createdAt,
      byName: workOrder.requestedByName,
      at: workOrder.createdAt,
    },
    {
      key: "accepted",
      label: "Diterima IT",
      done: !!workOrder.acceptedAt,
      byName: workOrder.acceptedByName,
      at: workOrder.acceptedAt,
    },
    {
      key: "scheduled_by_it",
      label: "Dijadwalkan IT",
      done: !!workOrder.scheduledByItAt,
      byName: workOrder.scheduledByItName,
      at: workOrder.scheduledByItAt,
    },
    {
      key: "started",
      label: "Mulai Dikerjakan",
      done: !!workOrder.startedAt,
      byName: workOrder.startedByName,
      at: workOrder.startedAt,
    },
    {
      key: "report_submitted",
      label: "Laporan Dikirim",
      done: !!workOrder.reportSubmittedAt,
      byName: workOrder.reportSubmittedByName,
      at: workOrder.reportSubmittedAt,
    },
    {
      key: "completed",
      label: "Selesai",
      done: !!workOrder.completedAt,
      byName: workOrder.completedByName,
      at: workOrder.completedAt,
    },
  ];

  if (workOrder.status === "cancelled") {
    steps.push({
      key: "cancelled",
      label: "Dibatalkan",
      done: !!workOrder.cancelledAt,
      byName: workOrder.cancelledByName,
      at: workOrder.cancelledAt,
    });
  }

  return steps;
}

export const WORK_ORDER_LOG_ACTION_LABEL: Record<MaintenanceWorkOrderLogAction, string> = {
  create_work_order: "Jadwal dibuat",
  assign_work_order: "Ditugaskan",
  accept_work_order: "Tugas diterima",
  schedule_by_it: "Dijadwalkan IT",
  start_work_order: "Mulai dikerjakan",
  check_asset_item: "Asset dicek",
  complete_asset_item: "Asset selesai dicek",
  create_follow_up_ticket: "Ticket lanjutan dibuat",
  reset_follow_up_ticket: "Relasi ticket lanjutan direset",
  qhse_finding_decision: "QHSE memutuskan tindak lanjut temuan",
  submit_report: "Laporan dikirim",
  complete_work_order: "Ditandai selesai",
  cancel_work_order: "Dibatalkan",
  request_revision: "QHSE meminta revisi laporan",
  return_to_in_progress: "Dikembalikan ke Sedang Dikerjakan",
  reopen_work_order: "Tugas dibuka ulang",
  retry_checklist: "Pengecekan diulang",
  return_to_created: "Dikembalikan ke Belum Diterima",
  return_to_scheduled: "Dikembalikan ke Dijadwalkan IT",
  save_draft_report: "Draft laporan disimpan",
  testing_status_change: "[Testing] Status diubah manual",
  maintenance_schedule_updated: "Jadwal maintenance diedit",
};

export const ASSET_SELECTION_MODE_LABEL: Record<AssetSelectionMode, string> = {
  all_assets: "Semua Asset",
  filtered_assets: "Asset Berdasarkan Filter",
};

const MONTH_NAMES_ID = [
  "Januari", "Februari", "Maret", "April", "Mei", "Juni",
  "Juli", "Agustus", "September", "Oktober", "November", "Desember",
];

export function monthYearLabel(month: number, year: number) {
  return `${MONTH_NAMES_ID[month] || ""} ${year}`;
}

export function frequencyMonthsLabel(months: number): string {
  if (months === 1) return "Setiap 1 Bulan";
  return `Setiap ${months} Bulan`;
}

function dateKeyFromParts(year: number, monthIndex: number, day: number): string {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// Hitung tanggal jatuh tempo pertama dari periode mulai + tanggal rutin.
// Kalau tanggalnya tidak ada di bulan tersebut (mis. 31 Februari), pakai
// tanggal terakhir bulan itu. Dibangun langsung dari komponen tahun/bulan/
// tanggal (bukan toISOString()) supaya tidak mundur 1 hari di timezone WIB.
export function computeNextDueDate(startMonth: number, startYear: number, dayOfMonth: number): string {
  const lastDayOfMonth = new Date(startYear, startMonth + 1, 0).getDate();
  const clampedDay = Math.min(dayOfMonth, lastDayOfMonth);
  return dateKeyFromParts(startYear, startMonth, clampedDay);
}

export function addMonthsClamped(dateKey: string, monthsToAdd: number, dayOfMonth: number): string {
  const match = DATE_KEY_PATTERN.exec(dateKey);
  if (!match) return dateKey;
  const [, yStr, mStr] = match;
  const total = Number(mStr) - 1 + monthsToAdd;
  const newYear = Number(yStr) + Math.floor(total / 12);
  const normalizedMonth = ((total % 12) + 12) % 12;
  return computeNextDueDate(normalizedMonth, newYear, dayOfMonth);
}

// ── Maintenance Work Order: Next Due / Overdue (date-key based) ─────────────

export function getTodayDateKey(): string {
  const now = new Date();
  return dateKeyFromParts(now.getFullYear(), now.getMonth(), now.getDate());
}

export function getDueDateKey(
  workOrder: Pick<MaintenanceWorkOrder, "dueDateKey" | "nextDueAt" | "scheduledDate">
): string | null {
  return workOrder.dueDateKey || workOrder.nextDueAt || workOrder.scheduledDate || null;
}

// Overdue murni derived dari perbandingan string date-key ("YYYY-MM-DD"),
// TIDAK pernah lewat Date/toISOString supaya tidak kena bug timezone.
export function isWorkOrderOverdue(
  workOrder: Pick<MaintenanceWorkOrder, "status" | "dueDateKey" | "nextDueAt" | "scheduledDate">
): boolean {
  if (["completed", "cancelled"].includes(workOrder.status)) return false;
  const dueDateKey = getDueDateKey(workOrder);
  if (!dueDateKey) return false;
  return getTodayDateKey() > dueDateKey;
}

export function isWorkOrderDueToday(
  workOrder: Pick<MaintenanceWorkOrder, "status" | "dueDateKey" | "nextDueAt" | "scheduledDate">
): boolean {
  if (["completed", "cancelled"].includes(workOrder.status)) return false;
  const dueDateKey = getDueDateKey(workOrder);
  if (!dueDateKey) return false;
  return getTodayDateKey() === dueDateKey;
}

export interface MaintenanceDisplayStatus {
  overdue: boolean;
  dueToday: boolean;
  label: string;
  subLabel?: string;
  colorClass: string;
}

// Status yang benar-benar ditampilkan di badge — overdue/jatuh tempo hari
// ini HANYA visual (derived), status asli di Firestore tidak diubah.
export function getDisplayStatus(
  workOrder: Pick<MaintenanceWorkOrder, "status" | "dueDateKey" | "nextDueAt" | "scheduledDate">
): MaintenanceDisplayStatus {
  const baseLabel = WORK_ORDER_STATUS_LABEL[workOrder.status];
  const baseColor = WORK_ORDER_STATUS_COLOR[workOrder.status];

  if (isWorkOrderOverdue(workOrder)) {
    return {
      overdue: true,
      dueToday: false,
      label: "Terlambat",
      subLabel: baseLabel,
      colorClass: "bg-red-50 text-red-700 border-red-200",
    };
  }
  if (isWorkOrderDueToday(workOrder)) {
    return {
      overdue: false,
      dueToday: true,
      label: "Jatuh Tempo Hari Ini",
      subLabel: baseLabel,
      colorClass: "bg-amber-50 text-amber-700 border-amber-200",
    };
  }
  return { overdue: false, dueToday: false, label: baseLabel, colorClass: baseColor };
}

// Jadwal berikutnya setelah jatuh tempo tugas saat ini (currentDueDateKey)
// lewat — maju sesuai frequencyMonths sampai >= hari ini. Tanggal target
// (hari dalam bulan) dipertahankan tetap dari currentDueDateKey, diclamp ke
// tanggal terakhir bulan kalau tidak ada (mis. 31 di Februari -> 28/29).
// TIDAK mengubah/menghapus currentDueDateKey — itu tetap dipakai untuk
// mendeteksi keterlambatan periode berjalan.
export function computeNextCycleDueDateKey(
  currentDueDateKey: string | null,
  frequencyMonths: number
): string | null {
  if (!currentDueDateKey || frequencyMonths <= 0) return currentDueDateKey;
  const match = DATE_KEY_PATTERN.exec(currentDueDateKey);
  if (!match) return currentDueDateKey;
  const day = Number(match[3]);
  const todayKey = getTodayDateKey();

  let candidate = currentDueDateKey;
  let guard = 0;
  while (candidate < todayKey && guard < 1200) {
    candidate = addMonthsClamped(candidate, frequencyMonths, day);
    guard += 1;
  }
  return candidate;
}

export const WORK_ORDER_PRIORITY_LABEL: Record<WorkOrderPriority, string> = {
  low: "Rendah",
  medium: "Sedang",
  high: "Tinggi",
  urgent: "Urgent",
};

export const WORK_ORDER_PRIORITY_COLOR: Record<WorkOrderPriority, string> = {
  low: "bg-slate-100 text-slate-600 border-slate-200",
  medium: "bg-amber-50 text-amber-700 border-amber-200",
  high: "bg-orange-50 text-orange-700 border-orange-200",
  urgent: "bg-red-50 text-red-700 border-red-200",
};

export const WORK_ORDER_ITEM_STATUS_LABEL: Record<WorkOrderItemStatus, string> = {
  pending: "Belum Dicek",
  in_progress: "Sedang Dicek",
  checked: "Sudah Dicek",
  needs_follow_up: "Butuh Tindak Lanjut",
  skipped: "Dilewati",
};

export const WORK_ORDER_ITEM_STATUS_COLOR: Record<WorkOrderItemStatus, string> = {
  pending: "bg-slate-100 text-slate-500 border-slate-200",
  in_progress: "bg-purple-50 text-purple-700 border-purple-200",
  checked: "bg-emerald-50 text-emerald-700 border-emerald-200",
  needs_follow_up: "bg-red-50 text-red-700 border-red-200",
  skipped: "bg-slate-100 text-slate-400 border-slate-200",
};

export const MAINTENANCE_CONDITION_TO_ASSET_CONDITION: Record<
  MaintenanceConditionLabel,
  AssetCondition
> = {
  Baik: "good",
  Cukup: "fair",
  "Rusak Ringan": "minor_damage",
  "Rusak Berat": "heavy_damage",
  "Tidak Bisa Digunakan": "heavy_damage",
};

export function formatRupiahInput(digitsOnly: string) {
  if (!digitsOnly) return "";
  return new Intl.NumberFormat("id-ID").format(Number(digitsOnly));
}

// Logo di tengah QR code AssetView (public/logo.png). Ukuran logo dijaga di
// ~18% dari ukuran QR supaya tetap bisa discan (dipakai bersama level="H").
export function getQrImageSettings(size: number) {
  const logoSize = Math.round(size * 0.18);
  return {
    src: "/logo.png",
    height: logoSize,
    width: logoSize,
    excavate: true,
  };
}

export const NOTIFICATION_TYPE_LABEL: Record<NotificationType, string> = {
  asset_borrowed: "Asset Dipinjam",
  asset_returned: "Asset Dikembalikan",
  asset_damage_reported: "Kerusakan Dilaporkan",
  asset_created: "Asset Baru",
  asset_updated: "Asset Diperbarui",
  asset_status_changed: "Status Asset Berubah",
  ticket_created: "Laporan Staff",
  ticket_assigned: "Ticket Ditugaskan",
  ticket_status_updated: "Status Ticket",
  ticket_need_info: "Butuh Info Tambahan",
  ticket_resolved: "Ticket Selesai",
  work_order_assigned: "Tugas Maintenance",
  work_order_accepted: "Tugas Diterima IT",
  work_order_scheduled_by_it: "Jadwal Pengerjaan IT",
  work_order_started: "Maintenance Dimulai",
  work_order_report_submitted: "Laporan Maintenance Dikirim",
  work_order_completed: "Maintenance Selesai",
  work_order_revision_requested: "Revisi Laporan Diminta",
  work_order_reopened: "Tugas Dibuka Ulang",
  maintenance_due: "Maintenance Jatuh Tempo",
  maintenance_overdue: "Maintenance Terlambat",
  maintenance_finding_reported: "Temuan Maintenance Perlu Review",
  maintenance_finding_decided: "Keputusan QHSE atas Temuan",
  asset_custodian_assigned: "Anda Menjadi PIC Aset",
  asset_temporary_handover: "Aset Dipakai Sementara",
  asset_returned_to_custodian: "Aset Dikembalikan",
  asset_usage_overdue: "Penggunaan Aset Melewati Estimasi",
  system: "Sistem",
};

export const NOTIFICATION_PRIORITY_COLOR: Record<NotificationPriority, string> = {
  low: "bg-slate-100 text-slate-600 border-slate-200",
  medium: "bg-amber-50 text-amber-700 border-amber-200",
  high: "bg-orange-50 text-orange-700 border-orange-200",
  urgent: "bg-red-50 text-red-700 border-red-200",
};

export function formatRelativeTime(value: unknown) {
  if (!value) return "-";
  const d =
    typeof value === "object" && value !== null && "toDate" in value
      ? (value as { toDate: () => Date }).toDate()
      : new Date(value as string);
  if (isNaN(d.getTime())) return "-";
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "Baru saja";
  if (diffMin < 60) return `${diffMin} menit lalu`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24) return `${diffHour} jam lalu`;
  const diffDay = Math.floor(diffHour / 24);
  if (diffDay < 7) return `${diffDay} hari lalu`;
  return formatDate(value);
}
