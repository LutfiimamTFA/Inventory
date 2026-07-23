import {
  Asset,
  AssetCondition,
  AssetIssueTicket,
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

export function toDisplayDate(value: unknown): Date | null {
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

export const CONDITION_COLOR: Record<AssetCondition, string> = {
  new: "bg-emerald-50 text-emerald-700 border-emerald-200",
  good: "bg-emerald-50 text-emerald-700 border-emerald-200",
  fair: "bg-amber-50 text-amber-700 border-amber-200",
  minor_damage: "bg-orange-50 text-orange-700 border-orange-200",
  heavy_damage: "bg-red-50 text-red-700 border-red-200",
};

// Section A/B — "Kondisi Aset" TIDAK BOLEH menampilkan status pemakaian
// (Tersedia/Dipinjam) sebagai status utama menu Assets — itu konsep beda
// (lihat Scan QR/Status Pemakaian). assetStatus SEBENARNYA mencampur dua
// hal: sebagian nilainya murni pemakaian (available/borrowed/in_use),
// sebagian lagi murni kondisi/siklus-hidup barang (maintenance/broken/
// lost/inactive/disposed/incomplete). Daripada migrasi data (spec eksplisit
// minta "data backend lama tetap aman"), functions di bawah cuma
// MEMILAH TAMPILAN: kalau assetStatus salah satu nilai kondisi/siklus,
// itu yang ditampilkan sebagai Kondisi Aset (assetStatus lebih parah/
// spesifik daripada condition biasa); selain itu baru pakai field
// `condition` (Baik/Cukup/Rusak Ringan/Rusak Berat).
const ASSET_STATUS_AS_CONDITION: AssetStatus[] = [
  "maintenance",
  "broken",
  "incomplete",
  "lost",
  "inactive",
  "disposed",
];
const ASSET_STATUS_AS_USAGE: AssetStatus[] = ["available", "borrowed", "in_use"];

export function getAssetConditionLabel(asset: Pick<Asset, "assetStatus" | "condition">): string {
  if (ASSET_STATUS_AS_CONDITION.includes(asset.assetStatus)) {
    return ASSET_STATUS_LABEL[asset.assetStatus];
  }
  return CONDITION_LABEL[asset.condition] || "Baik";
}

export function getAssetConditionColor(asset: Pick<Asset, "assetStatus" | "condition">): string {
  if (ASSET_STATUS_AS_CONDITION.includes(asset.assetStatus)) {
    return ASSET_STATUS_COLOR[asset.assetStatus];
  }
  return CONDITION_COLOR[asset.condition] || CONDITION_COLOR.good;
}

// Section C — badge "Pemakaian" kecil/sekunder, HANYA muncul kalau
// assetStatus memang murni status pemakaian (bukan kondisi barang) — kalau
// assetStatus sudah dipakai sebagai Kondisi Aset di atas (mis. "maintenance"),
// tidak perlu diulang lagi di sini supaya tidak duplikat/rancu.
export function getAssetUsageBadge(
  asset: Pick<Asset, "assetStatus" | "condition">
): { label: string; colorClass: string } | null {
  if (!ASSET_STATUS_AS_USAGE.includes(asset.assetStatus)) return null;
  return {
    label: ASSET_STATUS_LABEL[asset.assetStatus],
    colorClass: ASSET_STATUS_COLOR[asset.assetStatus],
  };
}

export const BORROWING_STATUS_LABEL: Record<BorrowingStatus, string> = {
  borrowed: "Sedang Dipinjam",
  returned: "Sudah Dikembalikan",
  overdue: "Terlambat Dikembalikan",
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

// Section A — format tanggal PANJANG dengan nama bulan lengkap dan jam
// pakai titik (bukan titik dua), dipakai halaman Peminjaman Saya — mis.
// "23 Juli 2026, 09.20".
export function formatDateTimeLong(value: unknown) {
  const d = toDisplayDate(value);
  if (!d) return "-";
  const datePart = new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(d);
  const timePart = new Intl.DateTimeFormat("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(d)
    .replace(":", ".");
  return `${datePart}, ${timePart}`;
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

// Deteksi tiket yang ditangani teknisi/vendor eksternal — dipakai untuk
// MENGECUALIKAN tiket ini dari Antrian Tim IT / Tugas Kendala Saya Tim IT
// (bukan tugas mereka), TANPA menyembunyikannya dari QHSE/Admin/pelapor.
// Dicek dari beberapa field sekaligus supaya tetap kena walau data lama
// hanya mengisi sebagian field (mis. assignedTeam tanpa externalHandling).
export function isExternalHandlingTicket(
  ticket: Partial<
    Pick<
      AssetIssueTicket,
      | "externalHandling"
      | "assignedTeam"
      | "assignedTeamLabel"
      | "assignedToName"
      | "externalCoordinationStatus"
      | "externalHandlerType"
      | "vendorName"
    >
  >
): boolean {
  return !!(
    ticket.externalHandling === true ||
    ticket.assignedTeam === "vendor" ||
    ticket.assignedTeam === "external_vendor" ||
    String(ticket.assignedTeamLabel || "").toLowerCase().includes("eksternal") ||
    String(ticket.assignedToName || "").toLowerCase().includes("teknisi eksternal") ||
    ticket.externalCoordinationStatus ||
    ticket.externalHandlerType ||
    ticket.vendorName
  );
}

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

// Section A/B — domain QR asset. NEXT_PUBLIC_APP_URL WAJIB diisi production
// (https://qhse-care.vercel.app) supaya QR yang dicetak bisa langsung
// dibuka kamera bawaan HP (bukan cuma scanner internal web). Fallback ke
// window.location.origin/produksi hanya jaring pengaman kalau env belum
// pernah diisi sama sekali, bukan cara normal untuk jalan.
export function getAppBaseUrl(): string {
  const envUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (envUrl && envUrl.trim()) {
    return envUrl.trim().replace(/\/$/, "");
  }
  if (typeof window !== "undefined") {
    return window.location.origin;
  }
  return "https://qhse-care.vercel.app";
}

export function getAssetActionUrl(assetCode: string): string {
  return `${getAppBaseUrl()}/asset-action?code=${encodeURIComponent(assetCode)}`;
}

// Section D — info kecil di modal cetak QR supaya admin tahu label yang
// akan dicetak itu memang bisa dibuka kamera HP atau cuma untuk testing.
export function getQrDomainNotice(baseUrl: string): { tone: "warning" | "info" | "success"; message: string } {
  if (/localhost|127\.0\.0\.1/i.test(baseUrl)) {
    return {
      tone: "warning",
      message: "QR ini masih memakai localhost. QR hanya cocok untuk testing di laptop, bukan untuk kamera HP.",
    };
  }
  if (/^https?:\/\/(\d{1,3}\.){3}\d{1,3}/.test(baseUrl)) {
    return {
      tone: "info",
      message: "QR ini hanya bisa dibuka dari HP yang berada di WiFi yang sama.",
    };
  }
  return {
    tone: "success",
    message: "QR siap dipakai. Kamera HP bisa langsung membuka halaman asset.",
  };
}

// Section I — scanner internal web tetap harus bisa baca QR LAMA yang cuma
// berisi kode asset polos, sekaligus QR BARU yang berisi URL penuh
// (https://qhse-care.vercel.app/asset-action?code=...). qrCodeValue yang
// tersimpan di Firestore selalu kode polos (lihat assets/new & edit), jadi
// hasil ekstraksi ini yang dipakai untuk query, bukan raw value dari kamera.
// Section J — kamera bawaan HP kadang salah mendeteksi QR sebagai vCard/
// kontak (mis. kalau ada QR kontak lama tertukar dengan label asset).
// Dicek terpisah dari extractAssetCodeFromQr supaya pemanggil bisa kasih
// pesan yang lebih spesifik ("ini QR kontak, bukan QR asset") daripada
// cuma "kode tidak valid".
export function isVCardOrContactQr(rawValue: string): boolean {
  if (!rawValue) return false;
  const value = rawValue.trim();
  return value.includes("BEGIN:VCARD") || /^tel:|^mailto:/i.test(value);
}

export function extractAssetCodeFromQr(rawValue: string): string {
  if (!rawValue) return "";
  const value = rawValue.trim();
  if (isVCardOrContactQr(value)) return "";

  try {
    const url = new URL(value);
    const codeFromParam = url.searchParams.get("code");
    if (codeFromParam) return codeFromParam.trim();

    // Section I — fallback kalau suatu saat format URL berubah jadi path
    // (/assets/AST-...) alih-alih query param ?code=.
    const lastSegment = url.pathname.split("/").filter(Boolean).pop();
    if (lastSegment?.startsWith("AST-")) return lastSegment;

    return "";
  } catch {
    return value;
  }
}

// Section G — returnUrl setelah login WAJIB path internal saja, tidak boleh
// dipakai untuk open-redirect ke domain luar.
export function getSafeReturnUrl(returnUrl: string | null | undefined): string | null {
  if (!returnUrl) return null;
  try {
    const decoded = decodeURIComponent(returnUrl);
    if (!decoded.startsWith("/")) return null;
    if (decoded.startsWith("//")) return null;
    if (decoded.includes("http://") || decoded.includes("https://")) return null;
    return decoded;
  } catch {
    return null;
  }
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

// Section A — normalisasi status pinjam/kembalikan. Aset di app ini punya
// DUA skema status peminjaman yang sempat berjalan paralel dan tidak
// sinkron satu sama lain:
// 1. Skema lama ("shared_pool"): assetStatus/currentBorrowingId/
//    currentBorrowerUid/currentBorrowerName (lib/borrow-actions.ts).
// 2. Skema custodian/holder yang dipakai di tempat lain (assets list,
//    /asset-action, firestore.rules): currentUsageStatus/currentHolderUid.
// Helper ini SENGAJA membaca kedua skema sekaligus (bukan cuma salah satu)
// supaya asset lama yang datanya campuran tetap terbaca benar, sambil
// borrowAsset/returnAsset yang baru menulis KEDUANYA sekaligus supaya ke
// depan tidak ada lagi dua sumber kebenaran yang bisa berbeda.
type BorrowStatusAsset = Pick<
  Asset,
  | "currentUsageStatus"
  | "assetStatus"
  | "currentHolderUid"
  | "currentHolderName"
  | "currentBorrowerUid"
  | "currentBorrowerName"
>;

export type NormalizedBorrowStatus = "available" | "borrowed" | "maintenance";

export function normalizeAssetUsageStatus(asset: BorrowStatusAsset): NormalizedBorrowStatus {
  const rawStatus = String(asset.currentUsageStatus || asset.assetStatus || "").toLowerCase();

  const borrowedKeywords = ["borrowed", "dipinjam", "sedang_dipinjam", "in_use", "used", "temporary_used_by_other"];
  const maintenanceKeywords = ["maintenance", "perbaikan", "rusak", "broken"];
  const availableKeywords = ["available", "tersedia", "ready", "aktif"];

  if (borrowedKeywords.includes(rawStatus)) return "borrowed";
  if (maintenanceKeywords.includes(rawStatus)) return "maintenance";
  if (availableKeywords.includes(rawStatus)) return "available";

  // Status mentah tidak dikenali (data lama/kosong) — tapi ada penanda
  // pemegang aset, jadi tetap dianggap dipinjam daripada salah tampil
  // "tersedia" padahal sedang dipegang orang.
  if (asset.currentHolderUid || asset.currentHolderName || asset.currentBorrowerUid || asset.currentBorrowerName) {
    return "borrowed";
  }

  return "available";
}

export function isAssetBorrowed(asset: BorrowStatusAsset): boolean {
  return normalizeAssetUsageStatus(asset) === "borrowed";
}

export function isBorrowedByMe(
  asset: Pick<BorrowStatusAsset, "currentHolderUid" | "currentBorrowerUid">,
  user?: { uid?: string | null } | null
): boolean {
  if (!asset || !user?.uid) return false;
  return asset.currentHolderUid === user.uid || asset.currentBorrowerUid === user.uid;
}

export function isBorrowedByOther(
  asset: BorrowStatusAsset,
  user?: { uid?: string | null } | null
): boolean {
  if (!isAssetBorrowed(asset)) return false;
  if (!user?.uid) return true;
  return !isBorrowedByMe(asset, user);
}

// Estimasi kembali yang cuma tanggal (date picker `type="date"`, tanpa jam)
// TIDAK BOLEH dianggap jatuh tempo jam 00:00 dini hari — itu bikin aset
// dianggap "Terlambat Dikembalikan" padahal tanggalnya sendiri belum lewat.
// Value date-only dianggap berlaku sampai AKHIR hari itu (23:59:59.999).
export function isDateOnlyValue(value: unknown): boolean {
  return typeof value === "string" && DATE_KEY_PATTERN.test(value.trim());
}

// Timestamp/Date yang kebetulan jatuh persis jam 00:00:00 (mis. data lama
// yang disimpan dari date-only string lewat `new Date(string)`) diperlakukan
// sama seperti date-only murni — kalau user memang sengaja pilih jam 00:00,
// ini satu-satunya kasus yang "salah dianggap" akhir hari, tapi risikonya
// jauh lebih kecil daripada semua estimasi tanpa jam otomatis dianggap telat.
function normalizeExpectedReturnDateInfo(rawValue: unknown): { date: Date; isDateOnly: boolean } | null {
  if (!rawValue) return null;
  if (isDateOnlyValue(rawValue)) {
    const parsed = parseDateKey((rawValue as string).trim());
    if (!parsed) return null;
    parsed.setHours(23, 59, 59, 999);
    return { date: parsed, isDateOnly: true };
  }
  const date = toDisplayDate(rawValue);
  if (!date) return null;
  const isMidnight = date.getHours() === 0 && date.getMinutes() === 0 && date.getSeconds() === 0;
  if (isMidnight) {
    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);
    return { date: endOfDay, isDateOnly: true };
  }
  return { date, isDateOnly: false };
}

export function normalizeExpectedReturnDate(rawValue: unknown): Date | null {
  return normalizeExpectedReturnDateInfo(rawValue)?.date || null;
}

// Section B/G — status bilang "Dipinjam" tapi tidak ada satu pun penanda
// siapa pemegangnya (dari alur mana pun) — data tidak sinkron, jangan
// biarkan user coba pinjam/kembalikan di atas data yang rusak ini.
// Section F — telat HANYA soal tampilan (badge "Terlambat Dikembalikan"),
// TIDAK PERNAH otomatis mengubah status field asset/borrowing — itu tetap
// "borrowed" sampai user benar-benar klik Kembalikan Aset.
export function isBorrowingLate(entry: {
  estimatedReturnAt?: string | null;
  currentUsageExpectedReturnAt?: string | null;
  dueAt?: string | null;
  expectedReturnAt?: string | null;
}): boolean {
  const rawExpectedReturn =
    entry.expectedReturnAt || entry.dueAt || entry.currentUsageExpectedReturnAt || entry.estimatedReturnAt;
  const expectedDate = normalizeExpectedReturnDate(rawExpectedReturn);
  if (!expectedDate) return false;
  return Date.now() > expectedDate.getTime();
}

// Section D — tampilan manusiawi: date-only tampil "23 Juli 2026, akhir
// hari" (BUKAN "23 Juli 2026, 00.00"); kalau memang ada jam spesifik, tetap
// tampilkan jamnya seperti biasa.
export function formatExpectedReturn(rawValue: unknown): string {
  const info = normalizeExpectedReturnDateInfo(rawValue);
  if (!info) return "-";
  const datePart = new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(info.date);
  if (info.isDateOnly) return `${datePart}, akhir hari`;
  const timePart = new Intl.DateTimeFormat("id-ID", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  })
    .format(info.date)
    .replace(":", ".");
  return `${datePart}, ${timePart}`;
}

// Section H — jangan pernah tampilkan email sebagai "nama" kalau field
// name-nya kebetulan justru berisi email (data lama). Pure function, TIDAK
// bergantung ke employee directory — dipakai sebagai lapis pertama
// sebelum fallback ke directory (lihat lib/employeeDirectory.ts).
export function looksLikeEmail(value: string | null | undefined): boolean {
  return !!value && value.includes("@");
}

export function getPersonDisplayName(
  name: string | null | undefined,
  email: string | null | undefined,
  resolvedFromDirectory?: string | null
): string {
  if (name && !looksLikeEmail(name)) return name;
  if (resolvedFromDirectory && !looksLikeEmail(resolvedFromDirectory)) return resolvedFromDirectory;
  if (email) return email;
  if (name) return name;
  return "-";
}

export function hasBrokenBorrowState(asset: BorrowStatusAsset): boolean {
  return (
    isAssetBorrowed(asset) &&
    !asset.currentHolderUid &&
    !asset.currentHolderName &&
    !asset.currentBorrowerUid &&
    !asset.currentBorrowerName
  );
}

// ── Badge notifikasi tab Maintenance & Kendala ────────────────────────────
// Badge angka tab TIDAK BOLEH menghitung total data (staffReports.length,
// dst) — itu bikin badge menyala terus walau semua sudah dibaca/tidak butuh
// aksi. Dua helper di bawah menentukan APAKAH satu tiket/work order layak
// dihitung ke badge: belum dibaca user login, atau memang butuh aksi dari
// role user login saat ini.
interface BadgeReadableItem {
  unreadByUids?: string[] | null;
  readByUids?: string[] | null;
  createdByUid?: string | null;
  status?: string | null;
}

export function isUnreadForCurrentUser(
  item: BadgeReadableItem,
  firebaseUser?: { uid?: string | null } | null
): boolean {
  if (!firebaseUser?.uid) return false;
  const unreadByUids = item.unreadByUids || [];
  const readByUids = item.readByUids || [];

  if (unreadByUids.includes(firebaseUser.uid)) return true;

  // Fallback data lama (belum pernah diisi unreadByUids sama sekali) —
  // anggap belum dibaca kalau statusnya masih "reported" (laporan baru) dan
  // bukan dibuat oleh user itu sendiri.
  if (
    !readByUids.includes(firebaseUser.uid) &&
    item.createdByUid !== firebaseUser.uid &&
    item.status === "reported"
  ) {
    return true;
  }

  return false;
}

interface BadgeActionableItem {
  status?: string | null;
  assignedToUid?: string | null;
  technicianUid?: string | null;
  assignedTechnicianUid?: string | null;
  assignedToEmail?: string | null;
  technicianEmail?: string | null;
  assignedTechnicianEmail?: string | null;
}

const QHSE_ACTIONABLE_STATUSES = ["reported", "under_review", "reporter_confirmed", "needs_follow_up"];
const IT_ACTIONABLE_STATUSES = [
  "created",
  "assigned",
  "accepted",
  "scheduled_by_it",
  "in_progress",
  "revision_requested",
  "needs_follow_up",
];

export function needsActionForCurrentUser(
  item: BadgeActionableItem,
  firebaseUser?: { uid?: string | null; email?: string | null } | null,
  currentRole?: string | null
): boolean {
  if (!firebaseUser?.uid) return false;
  const role = currentRole || "";

  if (role === "asset_admin" || role === "super_admin") {
    return QHSE_ACTIONABLE_STATUSES.includes(item.status || "");
  }

  if (role === "it_team") {
    const assignedToMe =
      item.assignedToUid === firebaseUser.uid ||
      item.technicianUid === firebaseUser.uid ||
      item.assignedTechnicianUid === firebaseUser.uid ||
      (!!firebaseUser.email && item.assignedToEmail === firebaseUser.email) ||
      (!!firebaseUser.email && item.technicianEmail === firebaseUser.email) ||
      (!!firebaseUser.email && item.assignedTechnicianEmail === firebaseUser.email);
    return assignedToMe && IT_ACTIONABLE_STATUSES.includes(item.status || "");
  }

  return false;
}

export function needsBadgeForCurrentUser(
  item: BadgeReadableItem & BadgeActionableItem,
  firebaseUser?: { uid?: string | null; email?: string | null } | null,
  currentRole?: string | null
): boolean {
  return (
    isUnreadForCurrentUser(item, firebaseUser) || needsActionForCurrentUser(item, firebaseUser, currentRole)
  );
}
