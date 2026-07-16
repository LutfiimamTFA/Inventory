import * as XLSX from "xlsx";
import {
  Asset,
  AssetBorrowing,
  AssetIssueTicket,
  MaintenanceWorkOrder,
  MaintenanceWorkOrderItem,
} from "@/lib/types";
import { isWorkOrderOverdue } from "@/lib/utils";

export interface ReportFilters {
  datePreset: DateRangePreset;
  customFrom: string;
  customTo: string;
  companyFilter: string;
  divisionFilter: string;
  categoryFilter: string;
  buildingFilter: string;
  floorFilter: string;
  roomFilter: string;
  statusFilter: string;
  conditionFilter: string;
  picFilter: string;
}

export const DEFAULT_REPORT_FILTERS: ReportFilters = {
  datePreset: "this_month",
  customFrom: "",
  customTo: "",
  companyFilter: "",
  divisionFilter: "",
  categoryFilter: "",
  buildingFilter: "",
  floorFilter: "",
  roomFilter: "",
  statusFilter: "",
  conditionFilter: "",
  picFilter: "",
};

export function assetMatchesFilters(asset: Asset, f: ReportFilters): boolean {
  if (f.companyFilter && asset.companyOwnerName !== f.companyFilter) return false;
  if (f.divisionFilter && asset.divisionOwnerName !== f.divisionFilter) return false;
  if (f.categoryFilter && asset.categoryId !== f.categoryFilter) return false;
  if (f.buildingFilter && asset.buildingName !== f.buildingFilter) return false;
  if (f.floorFilter && asset.floor !== f.floorFilter) return false;
  if (f.roomFilter && asset.roomName !== f.roomFilter) return false;
  if (f.statusFilter && asset.assetStatus !== f.statusFilter) return false;
  if (f.conditionFilter && asset.condition !== f.conditionFilter) return false;
  if (f.picFilter && asset.responsiblePersonName !== f.picFilter) return false;
  return true;
}

// ── Date range ─────────────────────────────────────────────────────────────

export type DateRangePreset =
  | "today"
  | "7d"
  | "this_month"
  | "3m"
  | "this_year"
  | "custom";

export const DATE_RANGE_PRESET_LABEL: Record<DateRangePreset, string> = {
  today: "Hari ini",
  "7d": "7 hari terakhir",
  this_month: "Bulan ini",
  "3m": "3 bulan terakhir",
  this_year: "Tahun ini",
  custom: "Custom range",
};

export function resolveDateRange(
  preset: DateRangePreset,
  customFrom?: string,
  customTo?: string
): { from: Date; to: Date } {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const endOfToday = new Date(startOfToday.getTime() + 24 * 60 * 60 * 1000 - 1);

  switch (preset) {
    case "today":
      return { from: startOfToday, to: endOfToday };
    case "7d":
      return { from: new Date(startOfToday.getTime() - 6 * 86400000), to: endOfToday };
    case "this_month":
      return {
        from: new Date(now.getFullYear(), now.getMonth(), 1),
        to: endOfToday,
      };
    case "3m":
      return { from: new Date(now.getFullYear(), now.getMonth() - 2, 1), to: endOfToday };
    case "this_year":
      return { from: new Date(now.getFullYear(), 0, 1), to: endOfToday };
    case "custom":
      return {
        from: customFrom ? new Date(customFrom) : new Date(now.getFullYear(), now.getMonth(), 1),
        to: customTo ? new Date(new Date(customTo).getTime() + 86400000 - 1) : endOfToday,
      };
  }
}

export function toDateSafe(value: unknown): Date | null {
  if (!value) return null;
  const d =
    typeof value === "object" && value !== null && "toDate" in value
      ? (value as { toDate: () => Date }).toDate()
      : new Date(value as string);
  return isNaN(d.getTime()) ? null : d;
}

export function isWithinRange(value: unknown, from: Date, to: Date): boolean {
  const d = toDateSafe(value);
  if (!d) return false;
  return d.getTime() >= from.getTime() && d.getTime() <= to.getTime();
}

// ── Health score ───────────────────────────────────────────────────────────

export type HealthLabel = "Sehat" | "Perlu Dipantau" | "Perlu Maintenance" | "Prioritas Ganti";

export const HEALTH_LABEL_COLOR: Record<HealthLabel, string> = {
  Sehat: "bg-emerald-50 text-emerald-700 border-emerald-200",
  "Perlu Dipantau": "bg-amber-50 text-amber-700 border-amber-200",
  "Perlu Maintenance": "bg-orange-50 text-orange-700 border-orange-200",
  "Prioritas Ganti": "bg-red-50 text-red-700 border-red-200",
};

export function healthScoreLabel(score: number): HealthLabel {
  if (score >= 80) return "Sehat";
  if (score >= 60) return "Perlu Dipantau";
  if (score >= 40) return "Perlu Maintenance";
  return "Prioritas Ganti";
}

export function computeHealthScore(params: {
  asset: Asset;
  unresolvedTicketCount: number;
  resolvedLast30dCount: number;
  hasOverdueMaintenance: boolean;
}): number {
  let score = 100;
  score -= params.unresolvedTicketCount * 15;
  score -= params.resolvedLast30dCount * 5;
  if (params.hasOverdueMaintenance) score -= 20;
  if (params.asset.condition === "fair") score -= 10;
  if (params.asset.condition === "minor_damage") score -= 25;
  if (params.asset.condition === "heavy_damage") score -= 50;
  if (params.asset.assetStatus === "broken") score -= 60;
  if (params.asset.assetStatus === "lost") score -= 100;
  return Math.max(0, Math.min(100, score));
}

export function isMaintenanceOverdue(asset: Asset): boolean {
  const next = toDateSafe(asset.nextMaintenanceAt);
  if (!next) return false;
  return next.getTime() < Date.now();
}

// ── Recommendation engine ───────────────────────────────────────────────────

export function buildAssetRecommendations(params: {
  healthScore: number;
  ticketCount: number;
  maintenanceOverdue: boolean;
  maintenanceCost: number;
  borrowingCount: number;
  brokenRecurring: boolean;
}): string[] {
  const notes: string[] = [];
  if (params.healthScore < 40 && params.ticketCount >= 3) {
    notes.push("Pertimbangkan penggantian asset");
  }
  if (params.maintenanceCost > 0 && params.brokenRecurring) {
    notes.push("Evaluasi kelayakan perbaikan vs pembelian baru");
  }
  if (params.maintenanceOverdue) {
    notes.push("Segera jadwalkan maintenance");
  }
  if (params.borrowingCount >= 5 && params.brokenRecurring) {
    notes.push("Perlu asset cadangan / unit tambahan");
  }
  if (params.borrowingCount === 0 && params.healthScore >= 80) {
    notes.push("Evaluasi pemanfaatan asset (jarang dipinjam)");
  }
  return notes;
}

// ── Borrowing overdue ────────────────────────────────────────────────────────

export function isBorrowingOverdue(b: AssetBorrowing): boolean {
  if (b.status !== "borrowed") return false;
  const expected = toDateSafe(b.estimatedReturnAt);
  if (!expected) return false;
  return expected.getTime() < Date.now();
}

// ── Ticket resolution time ──────────────────────────────────────────────────

export function resolutionTimeLabel(ticket: AssetIssueTicket): string {
  const resolvedAt = toDateSafe(ticket.resolvedAt);
  const createdAt = toDateSafe(ticket.reportedAt);
  if (!resolvedAt || !createdAt) return "Belum selesai";
  const diffMs = resolvedAt.getTime() - createdAt.getTime();
  const hours = Math.round(diffMs / 3600000);
  if (hours < 24) return `${hours} jam`;
  return `${Math.round(hours / 24)} hari`;
}

// ── Work order progress ─────────────────────────────────────────────────────

export function workOrderProgress(items: MaintenanceWorkOrderItem[]) {
  const total = items.length;
  const checked = items.filter((i) => i.status !== "pending" && i.status !== "in_progress").length;
  const percent = total > 0 ? Math.round((checked / total) * 100) : 0;
  return { checked, total, percent };
}

// Delegasi ke helper date-key di lib/utils.ts (isWorkOrderOverdue) supaya
// logic overdue tidak bercabang dua — nama "Record" dipertahankan karena
// dipakai luas di reports/dashboard.
export function isWorkOrderOverdueRecord(w: MaintenanceWorkOrder): boolean {
  return isWorkOrderOverdue(w);
}

export interface MaintenanceRoutineSummary {
  activeCount: number;
  notStartedCount: number;
  inProgressCount: number;
  awaitingReviewCount: number;
  overdueCount: number;
  completedThisMonth: number;
}

export interface MaintenanceCorrectiveSummary {
  staffReports: number;
  waitingDiagnosis: number;
  checking: number;
  followUpCount: number;
  resolvedThisMonth: number;
}

export interface MaintenanceSummaryCounts {
  routine: MaintenanceRoutineSummary;
  corrective: MaintenanceCorrectiveSummary;
}

function isRoutineWorkOrder(w: MaintenanceWorkOrder): boolean {
  return (w.taskCategory || "routine") === "routine";
}

// Sumber tunggal angka summary card halaman Maintenance & Kendala — HARUS
// tetap dipisah antara Maintenance Rutin (taskCategory "routine", jadwal
// berkala) dan Laporan Kendala/Korektif (tickets + work order "corrective"),
// supaya jadwal rutin tidak lagi ikut dihitung sebagai "Dalam Antrian".
export function getMaintenanceSummaryCounts({
  tickets,
  workOrders,
}: {
  tickets: AssetIssueTicket[];
  workOrders: MaintenanceWorkOrder[];
}): MaintenanceSummaryCounts {
  const routineOrders = workOrders.filter(isRoutineWorkOrder);
  const now = new Date();

  const routine: MaintenanceRoutineSummary = {
    activeCount: routineOrders.filter((w) => !["completed", "cancelled"].includes(w.status)).length,
    notStartedCount: routineOrders.filter((w) =>
      ["created", "accepted", "scheduled_by_it", "assigned"].includes(w.status)
    ).length,
    inProgressCount: routineOrders.filter((w) => w.status === "in_progress").length,
    awaitingReviewCount: routineOrders.filter((w) => w.status === "report_submitted").length,
    overdueCount: routineOrders.filter((w) => isWorkOrderOverdueRecord(w)).length,
    completedThisMonth: routineOrders.filter((w) => {
      if (w.status !== "completed") return false;
      const d = toDateSafe(w.completedAt);
      if (!d) return false;
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).length,
  };

  const corrective: MaintenanceCorrectiveSummary = {
    staffReports: tickets.filter((t) =>
      ["open", "review_by_asset_admin", "need_more_info"].includes(t.status)
    ).length,
    waitingDiagnosis: tickets.filter((t) => t.status === "waiting_diagnosis").length,
    checking: tickets.filter((t) => ["checking", "minor_fix"].includes(t.status)).length,
    followUpCount: tickets.filter((t) =>
      ["needs_follow_up", "waiting_sparepart", "waiting_vendor"].includes(t.status)
    ).length,
    resolvedThisMonth: tickets.filter((t) => {
      if (!["resolved", "closed"].includes(t.status)) return false;
      const d = toDateSafe(t.resolvedAt);
      if (!d) return false;
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).length,
  };

  return { routine, corrective };
}

// ── Export helpers ───────────────────────────────────────────────────────────

export function exportToExcel(fileName: string, sheetName: string, rows: Record<string, unknown>[]) {
  console.debug("[Reports] export started", fileName);
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, fileName);
  console.debug("[Reports] export completed", fileName);
}

export function todayStamp() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate()
  ).padStart(2, "0")}`;
}
