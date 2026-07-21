import {
  AppRole,
  AssetIssueTicket,
  IssueReportType,
  IssueTicketStatus,
  MaintenanceWorkOrder,
  WorkOrderStatus,
} from "@/lib/types";
import { ISSUE_REPORT_TYPE_LABEL, ISSUE_STATUS_LABEL, ISSUE_STATUS_STAFF_LABEL } from "@/lib/utils";

// ── Workflow Board — Maintenance Rutin dan Laporan Kendala Staff punya
// ALUR SENDIRI-SENDIRI (kolom, label, mapping status berbeda). Board ini
// TIDAK memaksa keduanya lewat satu alur; hanya DUA filter utama (Keluhan
// Masuk / Maintenance Rutin), masing-masing sumber data dan kolomnya
// sendiri — tidak ada mode gabungan/netral lagi. Kategori detail
// (reportType, korektif/vendor/dst.) hanya tampil sebagai badge di card.

export type BoardFilterKey = "issue_ticket" | "routine";

export const BOARD_FILTERS: { key: BoardFilterKey; label: string }[] = [
  { key: "issue_ticket", label: "Keluhan Masuk" },
  { key: "routine", label: "Maintenance Rutin" },
];

export function boardModeForFilter(filter: BoardFilterKey): "routine" | "issue" {
  return filter === "routine" ? "routine" : "issue";
}

type ColumnDef<K extends string> = {
  key: K;
  label: string;
  description: string;
  dotClass: string;
  headerClass: string;
  // Section C/D UI polish — warna soft per status supaya kolom tidak
  // terlihat seragam. columnBg mewarnai badan kolom, borderClass bingkainya,
  // textClass warna judul/ikon header, accentBarClass dipakai strip kiri
  // card (Section F) supaya konsisten dengan warna kolom tempat card berada.
  columnBg?: string;
  borderClass?: string;
  textClass?: string;
  accentBarClass?: string;
  collapsedByDefault?: boolean;
  // HANYA diisi untuk kolom Maintenance Rutin — Laporan Kendala Staff tidak
  // punya konsep owner tahap karena satu ticket bisa ditangani tim mana pun
  // (lihat AssignIssueTicketModal), bukan cuma dua peran tetap seperti rutin.
  owner?: "qhse" | "it";
  ownerLabel?: string;
};

export type ColumnOwner = "qhse" | "it";

export const COLUMN_OWNER_LABEL: Record<ColumnOwner, string> = {
  qhse: "QHSE/Admin",
  it: "Tim IT",
};

// Section E — QHSE pakai nuansa biru/navy (konsisten sama tema utama app),
// Tim IT pakai nuansa ungu supaya jelas beda "siapa yang pegang bola".
export const COLUMN_OWNER_BADGE_COLOR: Record<ColumnOwner, string> = {
  qhse: "bg-blue-100 text-blue-800 border-blue-200",
  it: "bg-purple-100 text-purple-800 border-purple-200",
};

export const COLUMN_OWNER_GROUP_BAND_COLOR: Record<ColumnOwner, string> = {
  qhse: "bg-gradient-to-r from-blue-50 to-sky-50 text-blue-700 border-blue-200",
  it: "bg-gradient-to-r from-violet-50 to-fuchsia-50 text-violet-700 border-violet-200",
};

// ── Kolom Maintenance Rutin (Section A/H) — setiap kolom sekarang punya
// owner eksplisit (QHSE/Admin vs Tim IT) supaya papan tidak terlihat
// seperti satu alur campur-aduk tanpa penanggung jawab jelas.
export type RoutineColumnKey =
  | "created"
  | "accepted"
  | "scheduled_by_it"
  | "in_progress"
  | "report_submitted"
  | "waiting_qhse_review"
  | "revision_or_follow_up"
  | "completed"
  | "cancelled";

export const ROUTINE_COLUMNS: ColumnDef<RoutineColumnKey>[] = [
  { key: "created", label: "Dibuat QHSE", description: "Jadwal maintenance dibuat oleh QHSE dan menunggu diterima Tim IT.", dotClass: "bg-blue-500", headerClass: "bg-gradient-to-r from-blue-50 to-white", columnBg: "bg-gradient-to-b from-blue-50/70 to-white", borderClass: "border-blue-200", textClass: "text-blue-700", accentBarClass: "bg-blue-500", owner: "qhse", ownerLabel: "QHSE/Admin" },
  { key: "accepted", label: "Diterima Tim IT", description: "Tim IT sudah menerima tugas maintenance.", dotClass: "bg-violet-500", headerClass: "bg-gradient-to-r from-violet-50 to-white", columnBg: "bg-gradient-to-b from-violet-50/70 to-white", borderClass: "border-violet-200", textClass: "text-violet-700", accentBarClass: "bg-violet-500", owner: "it", ownerLabel: "Tim IT" },
  { key: "scheduled_by_it", label: "Dijadwalkan Tim IT", description: "Tim IT menentukan waktu pengerjaan.", dotClass: "bg-indigo-500", headerClass: "bg-gradient-to-r from-indigo-50 to-white", columnBg: "bg-gradient-to-b from-indigo-50/70 to-white", borderClass: "border-indigo-200", textClass: "text-indigo-700", accentBarClass: "bg-indigo-500", owner: "it", ownerLabel: "Tim IT" },
  { key: "in_progress", label: "Sedang Dikerjakan", description: "Maintenance sedang dikerjakan oleh Tim IT.", dotClass: "bg-purple-500", headerClass: "bg-gradient-to-r from-purple-50 to-white", columnBg: "bg-gradient-to-b from-purple-50/70 to-white", borderClass: "border-purple-200", textClass: "text-purple-700", accentBarClass: "bg-purple-500", owner: "it", ownerLabel: "Tim IT" },
  { key: "report_submitted", label: "Laporan Dikirim ke QHSE", description: "Hasil maintenance sudah dikirim Tim IT ke QHSE.", dotClass: "bg-cyan-500", headerClass: "bg-gradient-to-r from-cyan-50 to-white", columnBg: "bg-gradient-to-b from-cyan-50/70 to-white", borderClass: "border-cyan-200", textClass: "text-cyan-700", accentBarClass: "bg-cyan-500", owner: "it", ownerLabel: "Tim IT" },
  { key: "waiting_qhse_review", label: "Review QHSE", description: "QHSE memvalidasi laporan hasil maintenance.", dotClass: "bg-sky-500", headerClass: "bg-gradient-to-r from-sky-50 to-white", columnBg: "bg-gradient-to-b from-sky-50/70 to-white", borderClass: "border-sky-200", textClass: "text-sky-700", accentBarClass: "bg-sky-500", owner: "qhse", ownerLabel: "QHSE/Admin" },
  { key: "revision_or_follow_up", label: "Revisi / Tindak Lanjut", description: "QHSE meminta cek ulang, vendor, pembelian, atau tindakan lanjutan.", dotClass: "bg-amber-500", headerClass: "bg-gradient-to-r from-amber-50 to-white", columnBg: "bg-gradient-to-b from-amber-50/70 to-white", borderClass: "border-amber-200", textClass: "text-amber-700", accentBarClass: "bg-amber-500", owner: "qhse", ownerLabel: "QHSE/Admin" },
  { key: "completed", label: "Selesai", description: "Maintenance sudah ditutup oleh QHSE.", dotClass: "bg-emerald-500", headerClass: "bg-gradient-to-r from-emerald-50 to-white", columnBg: "bg-gradient-to-b from-emerald-50/70 to-white", borderClass: "border-emerald-200", textClass: "text-emerald-700", accentBarClass: "bg-emerald-500", owner: "qhse", ownerLabel: "QHSE/Admin" },
  { key: "cancelled", label: "Dibatalkan", description: "Jadwal maintenance dibatalkan oleh QHSE.", dotClass: "bg-rose-500", headerClass: "bg-gradient-to-r from-rose-50 to-white", columnBg: "bg-gradient-to-b from-rose-50/70 to-white", borderClass: "border-rose-200", textClass: "text-rose-700", accentBarClass: "bg-rose-500", owner: "qhse", ownerLabel: "QHSE/Admin", collapsedByDefault: true },
];

// ── Kolom Laporan Kendala Staff (Section C/I) — waiting_reporter_confirmation
// dan reporter_confirmed DIGABUNG jadi satu kolom "Validasi Penyelesaian"
// supaya papan tidak kebanyakan kolom (izin eksplisit dari spec), tapi
// badge status di card tetap membedakan keduanya (lihat getWorkflowStatusLabel).
export type IssueColumnKey =
  | "reported"
  | "under_review"
  | "need_more_info"
  | "assigned"
  | "in_progress"
  | "validating_completion"
  | "needs_follow_up"
  | "completed"
  | "not_continued";

export const ISSUE_COLUMNS: ColumnDef<IssueColumnKey>[] = [
  { key: "reported", label: "Laporan Masuk", description: "Laporan baru dari staff, belum ditinjau.", dotClass: "bg-blue-500", headerClass: "bg-gradient-to-r from-blue-50 to-white", columnBg: "bg-gradient-to-b from-blue-50/70 to-white", borderClass: "border-blue-200", textClass: "text-blue-700", accentBarClass: "bg-blue-500" },
  { key: "under_review", label: "Ditinjau QHSE", description: "QHSE memeriksa kategori, lokasi, urgensi, dan asset terkait.", dotClass: "bg-indigo-500", headerClass: "bg-gradient-to-r from-indigo-50 to-white", columnBg: "bg-gradient-to-b from-indigo-50/70 to-white", borderClass: "border-indigo-200", textClass: "text-indigo-700", accentBarClass: "bg-indigo-500" },
  { key: "need_more_info", label: "Butuh Info Tambahan", description: "Staff perlu melengkapi info, foto, atau lokasi.", dotClass: "bg-orange-400", headerClass: "bg-gradient-to-r from-orange-50 to-white", columnBg: "bg-gradient-to-b from-orange-50/70 to-white", borderClass: "border-orange-200", textClass: "text-orange-700", accentBarClass: "bg-orange-400" },
  { key: "assigned", label: "Menunggu Tim Terkait", description: "QHSE sudah assign, menunggu tim mulai menangani.", dotClass: "bg-amber-500", headerClass: "bg-gradient-to-r from-amber-50 to-white", columnBg: "bg-gradient-to-b from-amber-50/70 to-white", borderClass: "border-amber-200", textClass: "text-amber-700", accentBarClass: "bg-amber-500" },
  { key: "in_progress", label: "Sedang Ditangani", description: "Tim terkait sedang menangani laporan.", dotClass: "bg-purple-500", headerClass: "bg-gradient-to-r from-purple-50 to-white", columnBg: "bg-gradient-to-b from-purple-50/70 to-white", borderClass: "border-purple-200", textClass: "text-purple-700", accentBarClass: "bg-purple-500" },
  { key: "validating_completion", label: "Validasi Penyelesaian", description: "Tim sudah kirim hasil — menunggu pelapor konfirmasi di lapangan.", dotClass: "bg-cyan-500", headerClass: "bg-gradient-to-r from-cyan-50 to-white", columnBg: "bg-gradient-to-b from-cyan-50/70 to-white", borderClass: "border-cyan-200", textClass: "text-cyan-700", accentBarClass: "bg-cyan-500" },
  { key: "needs_follow_up", label: "Butuh Tindakan Lanjutan", description: "Perlu vendor, pembelian, cek ulang, investigasi, atau keputusan QHSE.", dotClass: "bg-red-500", headerClass: "bg-gradient-to-r from-red-50 to-white", columnBg: "bg-gradient-to-b from-red-50/70 to-white", borderClass: "border-red-200", textClass: "text-red-700", accentBarClass: "bg-red-500" },
  { key: "completed", label: "Selesai", description: "Laporan sudah ditutup QHSE.", dotClass: "bg-emerald-500", headerClass: "bg-gradient-to-r from-emerald-50 to-white", columnBg: "bg-gradient-to-b from-emerald-50/70 to-white", borderClass: "border-emerald-200", textClass: "text-emerald-700", accentBarClass: "bg-emerald-500" },
  { key: "not_continued", label: "Tidak Dilanjutkan", description: "Dibatalkan, ditolak, atau duplikat.", dotClass: "bg-slate-500", headerClass: "bg-gradient-to-r from-slate-50 to-white", columnBg: "bg-gradient-to-b from-slate-50/70 to-white", borderClass: "border-slate-200", textClass: "text-slate-700", accentBarClass: "bg-slate-500", collapsedByDefault: true },
];

export type BoardColumnKey = RoutineColumnKey | IssueColumnKey;

export function getWorkflowColumnsByFilter(filter: BoardFilterKey): ColumnDef<BoardColumnKey>[] {
  return boardModeForFilter(filter) === "routine" ? ROUTINE_COLUMNS : ISSUE_COLUMNS;
}

function findColumnDef(column: BoardColumnKey): ColumnDef<BoardColumnKey> | undefined {
  return (ROUTINE_COLUMNS as ColumnDef<BoardColumnKey>[]).find((c) => c.key === column)
    || (ISSUE_COLUMNS as ColumnDef<BoardColumnKey>[]).find((c) => c.key === column);
}

export function getColumnBadgeColor(column: BoardColumnKey): string {
  const def = findColumnDef(column);
  if (!def) return "bg-slate-100 text-slate-600 border-slate-200";
  return `bg-white ${def.textClass || "text-slate-700"} ${def.borderClass || "border-slate-200"}`;
}

// Section F — accent bar warna kiri card mengikuti warna kolom/status card
// saat ini, supaya sekilas lihat langsung tahu tahap dari warnanya tanpa
// baca teks. Fallback slate kalau kolom tidak ditemukan (seharusnya tidak
// terjadi, tapi tetap aman daripada crash pada data tidak terduga).
export function getColumnAccentBarClass(column: BoardColumnKey): string {
  const def = findColumnDef(column);
  return def?.accentBarClass || "bg-slate-400";
}

export type BoardTaskCategory = "routine" | "staff_issue" | "corrective" | "vendor" | "purchase" | "recheck";

export const TASK_CATEGORY_LABEL: Record<BoardTaskCategory, string> = {
  routine: "Rutin",
  staff_issue: "Kendala Staff",
  corrective: "Korektif",
  vendor: "Vendor",
  purchase: "Pembelian",
  recheck: "Recheck",
};

export const TASK_CATEGORY_COLOR: Record<BoardTaskCategory, string> = {
  routine: "bg-blue-50 text-blue-700 border-blue-200",
  staff_issue: "bg-amber-50 text-amber-700 border-amber-200",
  corrective: "bg-purple-50 text-purple-700 border-purple-200",
  vendor: "bg-indigo-50 text-indigo-700 border-indigo-200",
  purchase: "bg-teal-50 text-teal-700 border-teal-200",
  recheck: "bg-rose-50 text-rose-700 border-rose-200",
};

// Kartu gabungan satu bentuk untuk work order & ticket. Field khusus salah
// satu sumber (mis. progressPercent untuk rutin, reportedByName untuk
// ticket) dibiarkan null/undefined di sumber lain — komponen kartu yang
// menentukan mana yang ditampilkan berdasarkan sourceType.
export interface BoardItem {
  id: string;
  sourceType: "work_order" | "ticket";
  sourceCollection: "asset_maintenance_work_orders" | "asset_issue_tickets";
  raw: MaintenanceWorkOrder | AssetIssueTicket;
  number: string;
  title: string;
  category: BoardTaskCategory;
  reportType?: IssueReportType;
  reportTypeLabel?: string;
  status: string;
  locationText: string;
  assetSummary: string;
  hasAsset: boolean;
  assignedToUid: string | null;
  technicianUid: string | null;
  assignedTechnicianUid: string | null;
  assignedToName: string | null;
  priority: string;
  severityLabel?: string;
  dueDateText: string | null;
  nextScheduleText: string | null;
  overdue: boolean;
  progressPercent: number | null;
  reportedByName: string | null;
  createdAtText: string | null;
}

function isOverdue(dueDateKey: string | null | undefined): boolean {
  if (!dueDateKey) return false;
  const due = new Date(dueDateKey);
  if (Number.isNaN(due.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return due < today;
}

function workOrderCategory(w: MaintenanceWorkOrder): BoardTaskCategory {
  if (w.followUpStatus === "waiting_vendor") return "vendor";
  if (w.followUpStatus === "waiting_purchase") return "purchase";
  if (w.followUpStatus === "recheck_requested") return "recheck";
  return w.taskCategory === "corrective" ? "corrective" : "routine";
}

// ── Mapping status -> kolom, alur Maintenance Rutin (Section B) ──
export function getRoutineColumnForWorkOrder(w: MaintenanceWorkOrder): RoutineColumnKey {
  const needsFollowUp =
    ["needs_follow_up", "waiting_purchase", "waiting_vendor", "recheck_requested", "asset_temporarily_unusable"].includes(
      w.followUpStatus || ""
    ) || w.status === "revision_requested";
  if (needsFollowUp) return "revision_or_follow_up";
  if (w.status === "completed") return "completed";
  if (w.status === "cancelled") return "cancelled";
  if (w.status === "report_submitted") return w.needsQhseReview ? "waiting_qhse_review" : "report_submitted";
  if (w.status === "in_progress" || w.status === "partially_completed") return "in_progress";
  if (w.status === "scheduled_by_it" || w.status === "scheduled") return "scheduled_by_it";
  if (w.status === "accepted" || w.status === "assigned") return "accepted";
  return "created"; // draft, created, overdue
}

export function getRoutineStatusFromColumn(column: RoutineColumnKey): WorkOrderStatus {
  switch (column) {
    case "created":
      return "created";
    case "accepted":
      return "accepted";
    case "scheduled_by_it":
      return "scheduled_by_it";
    case "in_progress":
      return "in_progress";
    case "report_submitted":
      return "report_submitted";
    case "waiting_qhse_review":
      return "report_submitted";
    case "revision_or_follow_up":
      return "revision_requested";
    case "completed":
      return "completed";
    case "cancelled":
      return "cancelled";
  }
}

// ── Mapping status -> kolom, alur Laporan Kendala Staff (Section C/I) ──
export function getIssueColumnForTicket(t: AssetIssueTicket): IssueColumnKey {
  const status = t.status;
  if (status === "reported") return "reported";
  if (status === "under_review") return "under_review";
  if (status === "need_more_info") return "need_more_info";
  if (status === "assigned") return "assigned";
  // Koordinasi teknisi/vendor eksternal dianggap "sedang ditangani" —
  // vendor tidak login, tapi laporan tetap aktif diproses (lihat
  // VendorCoordinationModal untuk update progresnya).
  if (status === "in_progress" || status === "external_coordination") return "in_progress";
  if (status === "waiting_reporter_confirmation" || status === "reporter_confirmed") return "validating_completion";
  if (status === "needs_follow_up") return "needs_follow_up";
  if (status === "completed") return "completed";
  if (status === "cancelled" || status === "rejected" || status === "duplicate") return "not_continued";
  return "reported";
}

// Kartu laporan kendala staff TIDAK BISA di-drag-drop lagi (lihat
// canMoveMaintenanceCard) — status hanya boleh berubah lewat tombol aksi
// di IssueTicketDetailModal karena beberapa transisi wajib data pendukung
// (catatan hasil, konfirmasi pelapor, dst). Fungsi ini masih dipakai
// getStatusFromColumn untuk keperluan non-drag (mis. label kolom).
export function getIssueStatusFromColumn(column: IssueColumnKey): IssueTicketStatus {
  switch (column) {
    case "reported":
      return "reported";
    case "under_review":
      return "under_review";
    case "need_more_info":
      return "need_more_info";
    case "assigned":
      return "assigned";
    case "in_progress":
      return "in_progress";
    case "validating_completion":
      return "waiting_reporter_confirmation";
    case "needs_follow_up":
      return "needs_follow_up";
    case "completed":
      return "completed";
    case "not_continued":
      return "cancelled";
  }
}

// Kolom untuk sebuah item selalu dari alur aslinya sendiri (routine untuk
// work order, issue untuk ticket) — tidak ada mode gabungan lagi karena
// filter utama sekarang cuma dua, masing-masing satu sumber data saja.
export function getColumnForItem(item: BoardItem): BoardColumnKey {
  if (item.sourceType === "work_order") {
    return getRoutineColumnForWorkOrder(item.raw as MaintenanceWorkOrder);
  }
  return getIssueColumnForTicket(item.raw as AssetIssueTicket);
}

// Section F — kolom tujuan drag -> status Firestore, sesuai sourceType.
export function getStatusFromColumn(
  item: Pick<BoardItem, "sourceType">,
  toColumn: BoardColumnKey
): WorkOrderStatus | IssueTicketStatus {
  if (item.sourceType === "work_order") {
    return getRoutineStatusFromColumn(toColumn as RoutineColumnKey);
  }
  return getIssueStatusFromColumn(toColumn as IssueColumnKey);
}

export function buildBoardItemFromWorkOrder(w: MaintenanceWorkOrder, progressPercent: number | null = null): BoardItem {
  const assignedToUid = w.assignedToUid || w.technicianUid || w.assignedTechnicianUid || null;
  const assignedToName = w.assignedToName || w.technicianName || null;
  return {
    id: w.id,
    sourceType: "work_order",
    sourceCollection: "asset_maintenance_work_orders",
    raw: w,
    number: w.workOrderNumber,
    title: w.title,
    category: workOrderCategory(w),
    status: w.status,
    locationText: w.locationText || w.maintenanceLocationText || "-",
    assetSummary: w.assetIds?.length ? `${w.assetIds.length} aset` : "-",
    hasAsset: !!w.assetIds?.length,
    assignedToUid,
    technicianUid: w.technicianUid || null,
    assignedTechnicianUid: w.assignedTechnicianUid || null,
    assignedToName,
    priority: w.priority,
    dueDateText: w.dueDateKey || null,
    nextScheduleText: w.nextDueAt || null,
    overdue: isOverdue(w.dueDateKey || w.nextDueAt),
    progressPercent: w.taskCategory === "routine" ? progressPercent : null,
    reportedByName: null,
    createdAtText: null,
  };
}

export function buildBoardItemFromTicket(t: AssetIssueTicket): BoardItem {
  const reportTypeLabel = t.reportType ? ISSUE_REPORT_TYPE_LABEL[t.reportType] : TASK_CATEGORY_LABEL.staff_issue;
  return {
    id: t.id,
    sourceType: "ticket",
    sourceCollection: "asset_issue_tickets",
    raw: t,
    number: t.ticketNumber,
    title: t.title || t.symptomType,
    category: "staff_issue",
    reportType: t.reportType,
    reportTypeLabel,
    status: t.status,
    locationText: t.locationText || t.assetLocation || "-",
    assetSummary: t.assetName ? `${t.assetName}${t.assetCode ? ` (${t.assetCode})` : ""}` : "Tidak terkait asset tertentu",
    hasAsset: !!t.assetId,
    assignedToUid: t.assignedToUid || null,
    technicianUid: null,
    assignedTechnicianUid: null,
    assignedToName: t.assignedToName || t.assignedTeam || null,
    priority: t.severity === "critical" ? "urgent" : t.priority,
    severityLabel: t.severity,
    dueDateText: t.estimatedFinishAt || null,
    nextScheduleText: null,
    overdue: isOverdue(t.estimatedFinishAt),
    progressPercent: null,
    reportedByName: t.reportedByName || null,
    createdAtText: null,
  };
}

// ── Label status — TERPISAH per alur, jangan pernah dicampur (Section H) ──
export function getRoutineStatusLabel(status: string): string {
  const map: Record<string, string> = {
    draft: "Dibuat QHSE",
    created: "Dibuat QHSE",
    overdue: "Dibuat QHSE",
    accepted: "Diterima Tim IT",
    assigned: "Diterima Tim IT",
    scheduled: "Dijadwalkan Tim IT",
    scheduled_by_it: "Dijadwalkan Tim IT",
    in_progress: "Sedang Dikerjakan",
    partially_completed: "Sedang Dikerjakan",
    report_submitted: "Laporan Dikirim ke QHSE",
    waiting_qhse_review: "Review QHSE",
    revision_requested: "Revisi / Cek Ulang",
    needs_follow_up: "Butuh Tindakan Lanjutan",
    completed: "Selesai",
    cancelled: "Dibatalkan",
  };
  return map[status] || status || "-";
}

// Section D — aktor berikutnya dihitung dari WorkOrderStatus MENTAH (bukan
// dari kolom yang sudah digabung), supaya "Revisi/Tindak Lanjut" tetap bisa
// membedakan revision_requested (giliran Tim IT cek ulang) dari
// needs_follow_up (giliran QHSE memutuskan vendor/pembelian) walau
// keduanya tampil di kolom yang sama.
export function getRoutineNextActor(w: Pick<MaintenanceWorkOrder, "status" | "followUpStatus" | "needsQhseReview">): {
  actor: "qhse" | "it" | "done";
  label: string;
} {
  if (w.status === "completed") return { actor: "done", label: "Selesai" };
  if (w.status === "cancelled") return { actor: "done", label: "Dibatalkan" };
  if (
    ["needs_follow_up", "waiting_purchase", "waiting_vendor", "recheck_requested", "asset_temporarily_unusable"].includes(
      w.followUpStatus || ""
    )
  ) {
    return { actor: "qhse", label: "QHSE/Admin" };
  }
  if (w.status === "revision_requested") return { actor: "it", label: "Tim IT" };
  if (w.status === "report_submitted") return { actor: "qhse", label: "QHSE/Admin" };
  // created/accepted/scheduled_by_it/in_progress (dan alias lama) — semua
  // masih giliran Tim IT sampai laporan dikirim.
  return { actor: "it", label: "Tim IT" };
}

// Delegasi ke ISSUE_STATUS_LABEL (lib/utils.ts) supaya cuma ada SATU sumber
// kebenaran untuk label status laporan kendala staff — sebelumnya file ini
// punya map duplikat sendiri yang gampang tidak sinkron kalau status baru
// ditambah di satu tempat tapi lupa di tempat lain.
export function getIssueTicketStatusLabel(status: string): string {
  return (ISSUE_STATUS_LABEL as Record<string, string>)[status] || status || "-";
}

export function getIssueTicketStaffStatusLabel(status: string): string {
  return (ISSUE_STATUS_STAFF_LABEL as Record<string, string>)[status] || status || "-";
}

export function getIssueTypeLabel(reportType?: string | null): string {
  if (!reportType) return "Kendala Asset";
  return (ISSUE_REPORT_TYPE_LABEL as Record<string, string>)[reportType] || reportType;
}

// Section H — label status yang benar untuk sebuah item board, TIDAK PERNAH
// mencampur alur rutin dengan alur laporan kendala staff.
export function getWorkflowStatusLabel(item: Pick<BoardItem, "sourceType" | "status">): string {
  if (item.sourceType === "work_order") return getRoutineStatusLabel(item.status);
  return getIssueTicketStatusLabel(item.status);
}

// Section F/G/J — siapa boleh drag kartu ke kolom mana. Ditentukan per
// KOLOM (bukan status mentah) karena owner tahap sekarang eksplisit per
// kolom — QHSE/Admin dan Tim IT masing-masing HANYA boleh menggeser kartu
// sesuai tahap yang jadi tanggung jawabnya, bukan bebas semua kolom lagi.
// Super Admin selalu bebas sebagai emergency override. Staff tidak boleh
// drag-drop sama sekali (board tidak dapat diakses oleh role staff), dan
// Laporan Kendala Staff tidak bisa di-drag sama sekali (lihat di bawah).
const ROUTINE_QHSE_TRANSITIONS: Partial<Record<RoutineColumnKey, RoutineColumnKey[]>> = {
  created: ["cancelled"],
  report_submitted: ["waiting_qhse_review"],
  waiting_qhse_review: ["completed", "revision_or_follow_up", "cancelled"],
  revision_or_follow_up: ["completed", "cancelled"],
};

const ROUTINE_IT_TRANSITIONS: Partial<Record<RoutineColumnKey, RoutineColumnKey[]>> = {
  created: ["accepted"],
  accepted: ["scheduled_by_it"],
  scheduled_by_it: ["in_progress"],
  in_progress: ["report_submitted"],
  revision_or_follow_up: ["in_progress", "report_submitted"],
};

// Section F — dipakai Workflow Board untuk pesan toast spesifik ("Status
// ini hanya bisa diubah oleh QHSE/Admin."/"...Tim IT.") saat drag ditolak.
export function getRequiredOwnerLabelForColumn(toColumn: BoardColumnKey): string | null {
  const def = ROUTINE_COLUMNS.find((c) => c.key === toColumn);
  return def?.ownerLabel || null;
}

// Section G — pesan penolakan lebih spesifik daripada "tidak punya akses"
// generik, supaya user langsung tahu ini soal kewenangan tahap, bukan bug.
export function getMoveDeniedMessage({
  role,
  toColumn,
}: {
  role: AppRole | null | undefined;
  toColumn: RoutineColumnKey;
}): string {
  const itColumns: RoutineColumnKey[] = ["accepted", "scheduled_by_it", "in_progress", "report_submitted"];
  const qhseColumns: RoutineColumnKey[] = ["waiting_qhse_review", "revision_or_follow_up", "completed", "cancelled"];

  if (role === "asset_admin" && itColumns.includes(toColumn)) {
    return "Tahap ini adalah pekerjaan Tim IT. QHSE hanya bisa memonitor atau memberi keputusan melalui detail.";
  }
  if (role === "it_team" && qhseColumns.includes(toColumn)) {
    return "Tahap ini hanya bisa diputuskan oleh QHSE/Admin.";
  }
  return "Anda tidak memiliki izin memindahkan tugas ke tahap ini.";
}

// Section H — dipakai KanbanColumn untuk badge "Tim IT only"/"QHSE only"
// dan penguncian visual (cursor-not-allowed, tidak menyala saat drag-over)
// pada kolom yang bukan kewenangan role yang sedang login.
export function isRoutineColumnLockedForRole(column: RoutineColumnKey, role: AppRole | null | undefined): boolean {
  if (role === "super_admin") return false;
  const owner = ROUTINE_COLUMNS.find((c) => c.key === column)?.owner;
  if (!owner) return false;
  if (role === "asset_admin") return owner !== "qhse";
  if (role === "it_team") return owner !== "it";
  return true;
}

// Section I — drag handle HANYA aktif kalau user punya minimal satu
// transisi valid dari kolom/status kartu saat ini. Diturunkan langsung
// dari tabel transisi di atas (bukan daftar status terpisah) supaya tidak
// pernah tidak-sinkron dengan aturan canMoveMaintenanceCard yang sebenarnya.
export function canDragRoutineCard({
  item,
  role,
  currentUserUid,
}: {
  item: Pick<BoardItem, "raw" | "assignedToUid" | "technicianUid" | "assignedTechnicianUid">;
  role: AppRole | null | undefined;
  currentUserUid: string | null | undefined;
}): boolean {
  if (role === "super_admin") return true;

  const fromColumn = getRoutineColumnForWorkOrder(item.raw as MaintenanceWorkOrder);

  if (role === "asset_admin") {
    return (ROUTINE_QHSE_TRANSITIONS[fromColumn] || []).length > 0;
  }

  if (role === "it_team") {
    const assignedToMe =
      !!currentUserUid &&
      (item.assignedToUid === currentUserUid ||
        item.technicianUid === currentUserUid ||
        item.assignedTechnicianUid === currentUserUid);
    if (!assignedToMe) return false;
    return (ROUTINE_IT_TRANSITIONS[fromColumn] || []).length > 0;
  }

  return false;
}

// Laporan Kendala Staff TIDAK BOLEH lagi digeser bebas lewat drag-drop —
// setiap transisi statusnya (tinjau, teruskan, mulai tangani, kirim hasil,
// konfirmasi pelapor, tutup, dst.) wajib data pendukung yang cuma bisa
// diisi lewat tombol aksi di IssueTicketDetailModal (lihat
// lib/issueTicketActions.ts). Drag-drop di Workflow Board sekarang HANYA
// berlaku untuk Maintenance Rutin.
export function canMoveMaintenanceCard({
  item,
  toColumn,
  role,
  currentUserUid,
}: {
  item: BoardItem;
  toColumn: BoardColumnKey;
  role: AppRole | null | undefined;
  currentUserUid: string | null | undefined;
}): boolean {
  if (item.sourceType === "ticket") return false;

  if (role === "super_admin") return true;

  const fromColumn = getRoutineColumnForWorkOrder(item.raw as MaintenanceWorkOrder);

  if (role === "asset_admin") {
    return (ROUTINE_QHSE_TRANSITIONS[fromColumn] || []).includes(toColumn as RoutineColumnKey);
  }

  if (role === "it_team") {
    const assignedToMe =
      !!currentUserUid &&
      (item.assignedToUid === currentUserUid ||
        item.technicianUid === currentUserUid ||
        item.assignedTechnicianUid === currentUserUid);
    if (!assignedToMe) return false;

    return (ROUTINE_IT_TRANSITIONS[fromColumn] || []).includes(toColumn as RoutineColumnKey);
  }

  return false;
}

export function getPrioritySeverity(priority: string): "critical" | "high" | "normal" {
  if (priority === "urgent") return "critical";
  if (priority === "high") return "high";
  return "normal";
}

export const SEVERITY_STRIP_COLOR: Record<"critical" | "high" | "normal", string> = {
  critical: "bg-red-500",
  high: "bg-orange-400",
  normal: "bg-transparent",
};
