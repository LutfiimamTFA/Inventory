"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  collection,
  collectionGroup,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import {
  Inbox,
  Wrench,
  AlertOctagon,
  CheckCircle2,
  CalendarClock,
  ClipboardCheck,
  Plus,
  ChevronDown,
  Eye,
  Pencil,
  Power,
  RefreshCw,
  Users,
} from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import {
  AppRole,
  AssetIssueTicket,
  IssueTicketStatus,
  MaintenanceWorkOrder,
  MaintenanceWorkOrderItem,
} from "@/lib/types";
import { getAssignedMaintenanceRole } from "@/lib/roles";
import { isAssignmentIncomplete } from "@/lib/issueTicketActions";
import {
  ASSET_SELECTION_MODE_LABEL,
  FIELD_IMPACT_COLOR,
  FIELD_IMPACT_LABEL,
  ISSUE_PRIORITY_RANK,
  ISSUE_REPORT_TYPE_COLOR,
  ISSUE_REPORT_TYPE_LABEL,
  ISSUE_STATUS_COLOR,
  ISSUE_STATUS_LABEL,
  computeNextCycleDueDateKey,
  formatDate,
  formatDateTime,
  getDisplayStatus,
  getDueDateKey,
  isWorkOrderOverdue,
  WORK_ORDER_STATUS_LABEL,
} from "@/lib/utils";
import { getMaintenanceSummaryCounts, toDateSafe, workOrderProgress } from "@/lib/reports";
import ProtectedLayout from "@/components/ProtectedLayout";
import PageHeader from "@/components/PageHeader";
import Badge from "@/components/Badge";
import EmptyState from "@/components/EmptyState";
import IssueTicketDetailModal from "@/components/IssueTicketDetailModal";
import CreateMaintenanceScheduleModal from "@/components/CreateMaintenanceScheduleModal";
import WorkOrderDetailModal from "@/components/WorkOrderDetailModal";
import {
  buildOverdueDedupeKey,
  createAssetNotification,
  dedupeKeyExists,
} from "@/lib/notifications";
import { Toast, ToastState } from "@/components/Toast";

type TabKey = "incoming" | "technician" | "follow_up" | "schedule" | "my_tasks" | "history";

// Deep-link query param (?tab=...) dipakai notifikasi untuk mengarahkan
// langsung ke tab yang tepat — nilainya sengaja berbeda dari TabKey internal
// supaya URL tetap stabil walau nama variabel internal berubah.
const TAB_QUERY_PARAM: Record<TabKey, string> = {
  incoming: "staff-reports",
  technician: "technician-queue",
  follow_up: "follow-up",
  schedule: "routine",
  my_tasks: "my-tasks",
  history: "history",
};
const TAB_KEY_FROM_QUERY: Record<string, TabKey> = Object.fromEntries(
  (Object.entries(TAB_QUERY_PARAM) as [TabKey, string][]).map(([key, value]) => [value, key])
);

// Section A/B perbaikan alur Laporan Kendala Staff — tab "Laporan Kendala
// Staff" HARUS menampilkan SEMUA laporan aktif (belum final), bukan cuma
// reported/under_review. Sebelumnya tiket yang sudah "assigned" jadi
// hilang dari tab ini (hanya muncul di tab Antrian Tim IT), padahal
// laporan itu masih aktif — bikin tabel di Maintenance & Kendala tidak
// sinkron dengan Workflow Board (yang sudah benar dari awal).
const ACTIVE_ISSUE_STATUSES: IssueTicketStatus[] = [
  "reported",
  "under_review",
  "need_more_info",
  "assigned",
  "in_progress",
  "external_coordination",
  "waiting_reporter_confirmation",
  "reporter_confirmed",
  "needs_follow_up",
];
const FINAL_ISSUE_STATUSES: IssueTicketStatus[] = ["completed", "cancelled", "rejected", "duplicate"];

const TICKET_TAB_STATUS: Partial<Record<TabKey, IssueTicketStatus[]>> = {
  incoming: ACTIVE_ISSUE_STATUSES,
  technician: ["assigned", "in_progress", "external_coordination", "waiting_reporter_confirmation", "reporter_confirmed"],
  follow_up: ["needs_follow_up"],
  history: FINAL_ISSUE_STATUSES,
};

// Section C — subfilter kecil di dalam tab Laporan Kendala Staff supaya
// QHSE masih bisa mempersempit tampilan tanpa kehilangan tiket lain dari
// tabelnya (beda dengan bug lama: status assigned dulu memang tidak ada
// di manapun dalam tab ini).
type IncomingSubFilterKey =
  | "all_active"
  | "reported"
  | "under_review"
  | "need_more_info"
  | "assigned"
  | "in_progress"
  | "external_coordination"
  | "waiting_confirmation"
  | "needs_follow_up";

const INCOMING_SUB_FILTERS: { key: IncomingSubFilterKey; label: string; statuses: IssueTicketStatus[] }[] = [
  { key: "all_active", label: "Semua Aktif", statuses: ACTIVE_ISSUE_STATUSES },
  { key: "reported", label: "Laporan Masuk", statuses: ["reported"] },
  { key: "under_review", label: "Ditinjau QHSE", statuses: ["under_review"] },
  { key: "need_more_info", label: "Butuh Info", statuses: ["need_more_info"] },
  { key: "assigned", label: "Menunggu Tim", statuses: ["assigned"] },
  { key: "in_progress", label: "Sedang Ditangani", statuses: ["in_progress"] },
  { key: "external_coordination", label: "Koordinasi Eksternal", statuses: ["external_coordination"] },
  { key: "waiting_confirmation", label: "Menunggu Konfirmasi", statuses: ["waiting_reporter_confirmation", "reporter_confirmed"] },
  { key: "needs_follow_up", label: "Butuh Tindakan Lanjutan", statuses: ["needs_follow_up"] },
];

const TABS: { key: TabKey; label: string; roles: AppRole[] }[] = [
  { key: "incoming", label: "Laporan Kendala Staff", roles: ["super_admin", "asset_admin"] },
  { key: "schedule", label: "Maintenance Rutin", roles: ["asset_admin", "super_admin", "it_team"] },
  { key: "technician", label: "Antrian Tim IT", roles: ["super_admin", "it_team"] },
  { key: "follow_up", label: "Butuh Tindakan Lanjutan", roles: ["super_admin", "asset_admin", "it_team"] },
  { key: "my_tasks", label: "Tugas Kendala Saya", roles: ["super_admin", "it_team"] },
  { key: "history", label: "Riwayat", roles: ["super_admin", "asset_admin", "it_team"] },
];

// Badge angka tab: hijau/tidak penting tidak dapat badge sama sekali,
// menunggu = kuning, tugas/jadwal = biru, overdue/butuh tindakan = merah.
const TAB_BADGE_COLOR: Record<TabKey, string> = {
  incoming: "bg-amber-100 text-amber-700",
  technician: "bg-blue-100 text-blue-700",
  follow_up: "bg-red-100 text-red-700",
  schedule: "bg-blue-100 text-blue-700",
  my_tasks: "bg-blue-100 text-blue-700",
  history: "bg-slate-100 text-slate-500",
};

function formatBadgeCount(count: number) {
  if (count > 99) return "99+";
  return String(count);
}

const HISTORY_DONE_STATUSES = ["completed"];
const HISTORY_CANCELLED_STATUSES = ["cancelled", "rejected", "duplicate"];

type HistorySourceKind =
  | "activity_log"
  | "work_order_log"
  | "asset_activity_log"
  | "issue_ticket_log"
  | "maintenance"
  | "ticket";
type HistorySourceFilter = "maintenance" | "ticket";
type HistoryLogRecord = Record<string, unknown> & { id: string };

interface MaintenanceHistoryItem {
  id: string;
  source: HistorySourceFilter;
  recordSource: HistorySourceKind;
  sourceId: string;
  targetType: HistorySourceFilter;
  number: string;
  title: string;
  typeLabel: string;
  status: string;
  statusLabel: string;
  locationText: string;
  assignedToName: string;
  actorName: string;
  completedAt: unknown;
  resultSummary: string;
  raw: MaintenanceWorkOrder | AssetIssueTicket | HistoryLogRecord;
}

function logMaintenanceListenerError(label: string) {
  return (error: unknown) => {
    console.error(`[Maintenance Listener] ${label} error`, error);
  };
}

function normalizeMatchText(value?: string | null) {
  return (value || "").toLowerCase().trim();
}

function historyText(value: unknown, fallback = "") {
  if (typeof value === "string" && value.trim()) return value;
  if (typeof value === "number") return String(value);
  return fallback;
}

function firstHistoryText(values: unknown[], fallback = "") {
  for (const value of values) {
    const text = historyText(value);
    if (text) return text;
  }
  return fallback;
}

function firstHistoryValue(values: unknown[]) {
  return values.find((value) => value !== undefined && value !== null) ?? null;
}

function getHistoryStatusLabel(status: string) {
  return (
    (WORK_ORDER_STATUS_LABEL as Record<string, string>)[status] ||
    (ISSUE_STATUS_LABEL as Record<string, string>)[status] ||
    status ||
    "-"
  );
}

function ticketReportTypeLabel(ticket: AssetIssueTicket) {
  return ticket.reportType ? ISSUE_REPORT_TYPE_LABEL[ticket.reportType] : "Kendala Asset";
}

function ticketReportTypeColor(ticket: AssetIssueTicket) {
  return ticket.reportType ? ISSUE_REPORT_TYPE_COLOR[ticket.reportType] : "bg-amber-50 text-amber-700 border-amber-200";
}

function ticketTitle(ticket: AssetIssueTicket) {
  return ticket.title || ticket.symptomType || "Laporan Kendala Staff";
}

function ticketStatusLabel(ticket: AssetIssueTicket) {
  return ticket.statusLabel || (ISSUE_STATUS_LABEL as Record<string, string>)[ticket.status] || ticket.status;
}

function ticketStatusColor(ticket: AssetIssueTicket) {
  return (ISSUE_STATUS_COLOR as Record<string, string>)[ticket.status] || "bg-slate-100 text-slate-600 border-slate-200";
}

// Section D/I — jangan biarkan sel "Penanggung Jawab" kosong-tanpa-konteks
// kalau tim sudah ditentukan tapi orangnya belum dipilih, dan jangan sampai
// status "assigned" tanpa assignedTeam sama sekali terlihat seperti "belum
// ditugaskan" — itu data cacat, bukan belum diproses (lihat isAssignmentIncomplete).
function ticketAssignedPersonLabel(ticket: AssetIssueTicket) {
  if (isAssignmentIncomplete(ticket)) return "Belum dipilih";
  if (ticket.assignedToName) return ticket.assignedToName;
  if (ticket.vendorName) return `${ticket.vendorName} (Vendor)`;
  if (ticket.assignedTeam) return `${ticket.assignedTeamLabel || ticket.assignedTeam} - belum ada petugas`;
  return "-";
}

function ticketAssignedTeamLabel(ticket: AssetIssueTicket) {
  if (isAssignmentIncomplete(ticket)) return "Belum lengkap";
  if (ticket.externalHandling) return ticket.externalHandlerLabel || ticket.assignedTeamLabel || "Teknisi Eksternal";
  return ticket.assignedTeamLabel || ticket.assignedTeam || "-";
}

function ticketFieldImpact(ticket: AssetIssueTicket) {
  return ticket.fieldImpact || ticket.severity;
}

function inferHistorySource(data: HistoryLogRecord, fallback: HistorySourceFilter): HistorySourceFilter {
  const sourceText = firstHistoryText([
    data.sourceType,
    data.taskCategory,
    data.reportType,
    data.type,
    data.source,
    data.sourceCollection,
  ]).toLowerCase();
  if (
    data.ticketId ||
    sourceText.includes("ticket") ||
    sourceText.includes("kendala") ||
    sourceText.includes("issue") ||
    sourceText.includes("staff")
  ) {
    return "ticket";
  }
  return fallback;
}

function isMaintenanceRelatedAssetLog(data: HistoryLogRecord) {
  const haystack = [
    data.type,
    data.sourceType,
    data.action,
    data.detail,
    data.note,
    data.message,
    data.category,
  ]
    .map((value) => historyText(value).toLowerCase())
    .join(" ");
  return (
    !!data.workOrderId ||
    !!data.ticketId ||
    haystack.includes("maintenance") ||
    haystack.includes("kendala") ||
    haystack.includes("ticket") ||
    haystack.includes("issue") ||
    haystack.includes("work_order")
  );
}

function normalizeHistoryItem(
  source: HistorySourceKind,
  docId: string,
  data: HistoryLogRecord,
  fallbackSource: HistorySourceFilter = "maintenance"
): MaintenanceHistoryItem {
  const sourceKind = inferHistorySource(data, fallbackSource);
  const sourceId = firstHistoryText(
    [data.sourceId, data.workOrderId, data.ticketId, data.assetId, docId],
    docId
  );
  const taskNumber = firstHistoryText(
    [data.taskNumber, data.maintenanceNumber, data.workOrderNumber, data.ticketNumber, data.number],
    "-"
  );
  const title = firstHistoryText(
    [data.title, data.message, data.actionLabel, data.statusLabel],
    "Aktivitas maintenance"
  );
  const description = firstHistoryText([
    data.description,
    data.note,
    data.detail,
    data.reason,
    data.lastActivityMessage,
    data.message,
  ]);
  const actorName = firstHistoryText(
    [data.createdByName, data.updatedByName, data.actorName, data.movedByName, data.performedByName, data.userName],
    "-"
  );
  const status = firstHistoryText([data.status, data.toStatus, data.newStatus, data.action]);
  const createdAt = firstHistoryValue([
    data.createdAt,
    data.performedAt,
    data.timestamp,
    data.updatedAt,
    data.movedAt,
    data.lastActivityAt,
  ]);

  return {
    id: `${source}-${docId}`,
    source: sourceKind,
    recordSource: source,
    sourceId,
    targetType: sourceKind,
    number: taskNumber,
    title,
    typeLabel: sourceKind === "ticket" ? "Laporan Kendala" : "Maintenance",
    status,
    statusLabel: getHistoryStatusLabel(status),
    locationText: firstHistoryText([data.locationText, data.locationName, data.assetLocation], "-"),
    assignedToName: firstHistoryText(
      [data.assignedToName, data.technicianName, data.assignedTechnicianName],
      "-"
    ),
    actorName,
    completedAt: createdAt,
    resultSummary: description || firstHistoryText([data.actionLabel, data.action], "-"),
    raw: data,
  };
}

// Cocokkan work order ke user Tim IT yang sedang login lewat SEMUA field
// yang pernah dipakai untuk menyimpan penugasan (uid, email, lalu nama
// sebagai fallback terakhir) — jangan hanya cek assignedToUid, karena data
// lama/dibuat lewat jalur berbeda bisa memakai nama field lain atau bahkan
// cuma menyimpan nama teknisi tanpa uid sama sekali.
function isAssignedToCurrentIt(
  workOrder: MaintenanceWorkOrder,
  currentAssetUser?: { uid?: string; email?: string; name?: string } | null,
  firebaseUser?: { uid?: string; email?: string | null; displayName?: string | null } | null
) {
  const wo = workOrder as MaintenanceWorkOrder & {
    assignedUserUid?: string;
    assignedToId?: string;
    picUid?: string;
    picEmail?: string;
    picName?: string;
    executorUid?: string;
    executorEmail?: string;
    executorName?: string;
  };

  const uid = currentAssetUser?.uid || firebaseUser?.uid;
  const email = normalizeMatchText(currentAssetUser?.email || firebaseUser?.email);
  const name = normalizeMatchText(currentAssetUser?.name || firebaseUser?.displayName);

  if (uid) {
    const uidMatch =
      wo.assignedToUid === uid ||
      wo.technicianUid === uid ||
      wo.assignedTechnicianUid === uid ||
      wo.assignedToId === uid ||
      wo.assignedUserUid === uid ||
      wo.picUid === uid ||
      wo.executorUid === uid;
    if (uidMatch) return true;
  }

  if (email) {
    const emailMatch =
      normalizeMatchText(wo.assignedToEmail) === email ||
      normalizeMatchText(wo.technicianEmail) === email ||
      normalizeMatchText(wo.assignedTechnicianEmail) === email ||
      normalizeMatchText(wo.picEmail) === email ||
      normalizeMatchText(wo.executorEmail) === email;
    if (emailMatch) return true;
  }

  if (name) {
    const nameMatch =
      normalizeMatchText(wo.assignedToName) === name ||
      normalizeMatchText(wo.technicianName) === name ||
      normalizeMatchText(wo.assignedTechnicianName) === name ||
      normalizeMatchText(wo.picName) === name ||
      normalizeMatchText(wo.executorName) === name;
    if (nameMatch) return true;
  }

  return false;
}

// Versi generik isAssignedToCurrentIt yang juga dipakai untuk ticket kendala
// (AssetIssueTicket hanya punya assignedToUid/assignedToName/assignedToEmail,
// tanpa alias legacy seperti technicianUid) — dipakai khusus untuk scoping
// Riwayat Tim IT supaya satu history hanya menampilkan tugas yang pernah
// ditugaskan ke user yang sedang login.
function isAssignedToCurrentUser(
  item: {
    assignedToUid?: string | null;
    assignedToName?: string | null;
    assignedToEmail?: string | null;
    technicianUid?: string;
    technicianName?: string;
    technicianEmail?: string;
    assignedTechnicianUid?: string;
    assignedTechnicianName?: string;
    assignedTechnicianEmail?: string;
  },
  currentAssetUser?: { uid?: string; email?: string; name?: string } | null,
  firebaseUser?: { uid?: string; email?: string | null; displayName?: string | null } | null
) {
  const uid = currentAssetUser?.uid || firebaseUser?.uid;
  const email = normalizeMatchText(currentAssetUser?.email || firebaseUser?.email);
  const name = normalizeMatchText(currentAssetUser?.name || firebaseUser?.displayName);

  if (uid) {
    if (
      item.assignedToUid === uid ||
      item.technicianUid === uid ||
      item.assignedTechnicianUid === uid
    )
      return true;
  }
  if (email) {
    if (
      normalizeMatchText(item.assignedToEmail) === email ||
      normalizeMatchText(item.technicianEmail) === email ||
      normalizeMatchText(item.assignedTechnicianEmail) === email
    )
      return true;
  }
  if (name) {
    if (
      normalizeMatchText(item.assignedToName) === name ||
      normalizeMatchText(item.technicianName) === name ||
      normalizeMatchText(item.assignedTechnicianName) === name
    )
      return true;
  }
  return false;
}

// Longgar dengan sengaja — data lama/jalur pembuatan berbeda bisa tidak
// punya taskCategory/maintenanceSource sama sekali, jadi kita juga terima
// tanda-tanda tidak langsung (frequencyMonths, due-date-key, dst) sebagai
// bukti "ini jadwal rutin".
function isRoutineWorkOrder(workOrder: MaintenanceWorkOrder) {
  const wo = workOrder as MaintenanceWorkOrder & {
    type?: string;
    category?: string;
    currentDueDateKey?: string;
    nextDueDateKey?: string;
    currentPeriodLabel?: string;
  };
  if (wo.taskCategory === "corrective") return false;
  return (
    wo.taskCategory === "routine" ||
    wo.maintenanceSource === "routine_schedule" ||
    wo.type === "routine" ||
    wo.category === "routine" ||
    !!wo.frequencyMonths ||
    !!wo.dueDateKey ||
    !!wo.currentDueDateKey ||
    !!wo.nextDueDateKey ||
    !!wo.currentPeriodLabel ||
    !wo.taskCategory
  );
}

function sortWorkOrdersNewestFirst(a: MaintenanceWorkOrder, b: MaintenanceWorkOrder) {
  const ta = (a.createdAt as { seconds?: number })?.seconds || 0;
  const tb = (b.createdAt as { seconds?: number })?.seconds || 0;
  return tb - ta;
}

export default function MaintenancePage() {
  return (
    <Suspense fallback={null}>
      <MaintenancePageContent />
    </Suspense>
  );
}

function MaintenancePageContent() {
  const { firebaseUser, role, assetUser, loading } = useAuth();
  const authReady = !loading && !!firebaseUser && !!assetUser && !!role;
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tickets, setTickets] = useState<AssetIssueTicket[]>([]);
  const [workOrders, setWorkOrders] = useState<MaintenanceWorkOrder[]>([]);
  const [items, setItems] = useState<MaintenanceWorkOrderItem[]>([]);
  const [activityLogs, setActivityLogs] = useState<HistoryLogRecord[]>([]);
  const [workOrderLogs, setWorkOrderLogs] = useState<HistoryLogRecord[]>([]);
  const [assetActivityLogs, setAssetActivityLogs] = useState<HistoryLogRecord[]>([]);
  const [issueTicketLogs, setIssueTicketLogs] = useState<HistoryLogRecord[]>([]);
  const [activeTab, setActiveTab] = useState<TabKey>("incoming");
  const [incomingSubFilter, setIncomingSubFilter] = useState<IncomingSubFilterKey>("all_active");
  const [detailTarget, setDetailTarget] = useState<AssetIssueTicket | null>(null);
  const [woDetailTarget, setWoDetailTarget] = useState<MaintenanceWorkOrder | null>(null);
  const [editWorkOrderTarget, setEditWorkOrderTarget] = useState<MaintenanceWorkOrder | null>(null);
  const [duplicateWorkOrderTarget, setDuplicateWorkOrderTarget] = useState<MaintenanceWorkOrder | null>(
    null
  );
  const [createScheduleOpen, setCreateScheduleOpen] = useState(false);
  const [openActionMenuId, setOpenActionMenuId] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const [consumedDeepLink, setConsumedDeepLink] = useState(false);
  const [historySourceFilter, setHistorySourceFilter] = useState<"all" | "maintenance" | "ticket">(
    "all"
  );
  const [historyStatusFilter, setHistoryStatusFilter] = useState<"all" | "done" | "cancelled">("all");
  const [historySearch, setHistorySearch] = useState("");
  const [toast, setToast] = useState<ToastState | null>(null);

  const tabParam = searchParams.get("tab");
  const ticketIdParam = searchParams.get("ticketId");
  const workOrderIdParam = searchParams.get("workOrderId");
  const canViewMaintenancePage =
    authReady && (role === "super_admin" || role === "asset_admin" || role === "it_team");
  const currentAssetUser = assetUser;

  // Baca ?tab= dari notifikasi begitu halaman dibuka supaya tab yang
  // relevan langsung aktif, bukan selalu jatuh ke tab pertama.
  useEffect(() => {
    queueMicrotask(() => {
      if (tabParam && TAB_KEY_FROM_QUERY[tabParam]) {
        setActiveTab(TAB_KEY_FROM_QUERY[tabParam]);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleTabClick = (key: TabKey) => {
    setActiveTab(key);
    router.replace(`/maintenance?tab=${TAB_QUERY_PARAM[key]}`, { scroll: false });
  };

  useEffect(() => {
    if (!canViewMaintenancePage) return;
    const q = query(collection(db, "asset_issue_tickets"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        console.log("[Maintenance Listener] asset_issue_tickets success:", snap.size);
        setTickets(snap.docs.map((d) => ({ id: d.id, ...d.data() } as AssetIssueTicket)));
      },
      logMaintenanceListenerError("asset_issue_tickets")
    );
    return () => unsub();
  }, [canViewMaintenancePage]);

  useEffect(() => {
    if (!canViewMaintenancePage) return;
    const q = query(collection(db, "asset_maintenance_work_orders"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        console.log("[Maintenance Listener] asset_maintenance_work_orders success:", snap.size);
        setWorkOrders(
          snap.docs.map((d) => ({ id: d.id, ...d.data() } as MaintenanceWorkOrder))
        );
      },
      logMaintenanceListenerError("asset_maintenance_work_orders")
    );
    return () => unsub();
  }, [canViewMaintenancePage]);

  useEffect(() => {
    if (!canViewMaintenancePage) return;
    const unsub = onSnapshot(
      collectionGroup(db, "items"),
      (snap) => {
        console.log("[Maintenance Listener] collectionGroup items success:", snap.size);
        setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() } as MaintenanceWorkOrderItem)));
      },
      logMaintenanceListenerError("collectionGroup items")
    );
    return () => unsub();
  }, [canViewMaintenancePage]);

  useEffect(() => {
    if (!canViewMaintenancePage) return;
    const q = query(collection(db, "asset_maintenance_activity_logs"), orderBy("createdAt", "desc"), limit(500));
    const unsub = onSnapshot(
      q,
      (snap) => {
        console.log("[Maintenance Listener] asset_maintenance_activity_logs success:", snap.size);
        setActivityLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() } as HistoryLogRecord)));
      },
      logMaintenanceListenerError("asset_maintenance_activity_logs")
    );
    return () => unsub();
  }, [canViewMaintenancePage]);

  useEffect(() => {
    if (!canViewMaintenancePage) return;
    const q = query(collection(db, "asset_maintenance_work_order_logs"), orderBy("performedAt", "desc"), limit(500));
    const unsub = onSnapshot(
      q,
      (snap) => {
        console.log("[Maintenance Listener] asset_maintenance_work_order_logs success:", snap.size);
        setWorkOrderLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() } as HistoryLogRecord)));
      },
      logMaintenanceListenerError("asset_maintenance_work_order_logs")
    );
    return () => unsub();
  }, [canViewMaintenancePage]);

  useEffect(() => {
    if (!canViewMaintenancePage) return;
    const q = query(collection(db, "asset_logs"), orderBy("timestamp", "desc"), limit(500));
    const unsub = onSnapshot(
      q,
      (snap) => {
        console.log("[Maintenance Listener] asset_logs success:", snap.size);
        setAssetActivityLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() } as HistoryLogRecord)));
      },
      logMaintenanceListenerError("asset_logs")
    );
    return () => unsub();
  }, [canViewMaintenancePage]);

  useEffect(() => {
    if (!canViewMaintenancePage) return;
    const q = query(collection(db, "asset_issue_logs"), orderBy("performedAt", "desc"), limit(500));
    const unsub = onSnapshot(
      q,
      (snap) => {
        console.log("[Maintenance Listener] asset_issue_logs success:", snap.size);
        setIssueTicketLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() } as HistoryLogRecord)));
      },
      logMaintenanceListenerError("asset_issue_logs")
    );
    return () => unsub();
  }, [canViewMaintenancePage]);

  // Deep link dari notifikasi: begitu data terkait sudah termuat, buka modal
  // detailnya langsung dan sorot barisnya selama 3 detik. Hanya dijalankan
  // sekali per kunjungan supaya menutup modal tidak langsung membukanya lagi.
  useEffect(() => {
    if (consumedDeepLink) return;
    queueMicrotask(() => {
      if (ticketIdParam) {
        const ticket = tickets.find((t) => t.id === ticketIdParam);
        if (ticket) {
          setDetailTarget(ticket);
          setHighlightId(ticketIdParam);
          setConsumedDeepLink(true);
        }
      } else if (workOrderIdParam) {
        const wo = workOrders.find((w) => w.id === workOrderIdParam);
        if (wo) {
          setWoDetailTarget(wo);
          setHighlightId(workOrderIdParam);
          setConsumedDeepLink(true);
        }
      }
    });
  }, [ticketIdParam, workOrderIdParam, tickets, workOrders, consumedDeepLink]);

  useEffect(() => {
    if (!highlightId) return;
    const timer = setTimeout(() => setHighlightId(null), 3000);
    return () => clearTimeout(timer);
  }, [highlightId]);

  const visibleTabs = useMemo(
    () => TABS.filter((t) => !!role && t.roles.includes(role)),
    [role]
  );
  const visibleTabKeys = visibleTabs.map((t) => t.key).join(",");

  useEffect(() => {
    if (!role || visibleTabs.length === 0) return;
    if (visibleTabs.some((t) => t.key === activeTab)) return;
    const nextTab = visibleTabs[0].key;
    queueMicrotask(() => {
      setActiveTab(nextTab);
      router.replace(`/maintenance?tab=${TAB_QUERY_PARAM[nextTab]}`, { scroll: false });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, activeTab, visibleTabKeys, router]);

  // Data lama tanpa taskCategory dianggap "routine" — dulu hanya jadwal
  // rutin yang membuat dokumen di asset_maintenance_work_orders.
  const ticketsForTab = useMemo(() => {
    // Tugas Maintenance Saya = tugas korektif (kerusakan/insidental) yang
    // ditugaskan ke teknisi yang sedang login — BUKAN jadwal rutin.
    const statuses = TICKET_TAB_STATUS[activeTab];
    if (!statuses) return [];
    let filtered = tickets.filter((t) => statuses.includes(t.status));
    if (activeTab === "incoming" && incomingSubFilter !== "all_active") {
      const subStatuses = INCOMING_SUB_FILTERS.find((f) => f.key === incomingSubFilter)?.statuses || [];
      filtered = filtered.filter((t) => subStatuses.includes(t.status));
    }
    if (activeTab === "incoming" || activeTab === "technician") {
      return [...filtered].sort(
        (a, b) => ISSUE_PRIORITY_RANK[a.priority] - ISSUE_PRIORITY_RANK[b.priority]
      );
    }
    return filtered;
  }, [tickets, activeTab, incomingSubFilter]);

  // Jadwal Maintenance Rutin: HANYA taskCategory "routine" — tugas korektif
  // (taskCategory "corrective") tidak boleh muncul di sini.
  const routineTasks = useMemo(
    () => workOrders.filter((wo) => isRoutineWorkOrder(wo)),
    [workOrders]
  );

  const correctiveTasks = useMemo(
    () => workOrders.filter((wo) => wo.taskCategory === "corrective"),
    [workOrders]
  );

  // Work order korektif (taskCategory "corrective") yang ditugaskan ke saya
  // — saat ini belum ada flow yang membuat work order korektif (tugas
  // insidental dibuat sebagai ticket, lihat ticketsForTab di atas), jadi
  // list ini forward-compat saja dan biasanya kosong.
  const myRoutineTasks = useMemo(
    () =>
      routineTasks
        .filter(
          (task) =>
            task.taskCategory === "routine" &&
            isAssignedToCurrentIt(task, currentAssetUser, firebaseUser) &&
            !["completed", "cancelled"].includes(task.status)
        )
        .sort(sortWorkOrdersNewestFirst),
    [routineTasks, currentAssetUser, firebaseUser]
  );

  const myCorrectiveTasks = useMemo(
    () =>
      correctiveTasks
        .filter(
          (task) =>
            task.taskCategory === "corrective" &&
            isAssignedToCurrentIt(task, currentAssetUser, firebaseUser) &&
            !["completed", "cancelled", "rejected", "duplicate"].includes(task.status)
        )
        .sort(sortWorkOrdersNewestFirst),
    [correctiveTasks, currentAssetUser, firebaseUser]
  );

  const myAssignedTasks = myCorrectiveTasks;

  const scheduleWorkOrders = useMemo(() => {
    const source = role === "it_team" ? myRoutineTasks : routineTasks;
    return [...source].sort(sortWorkOrdersNewestFirst);
  }, [role, myRoutineTasks, routineTasks]);

  // Summary card Maintenance Rutin HARUS pakai sumber yang sama-sama
  // di-scope per role dengan tabel (scheduleWorkOrders) — sebelumnya summary
  // pakai summaryCounts.routine (global, semua work order tanpa peduli siapa
  // yang login) sedangkan tabel sudah discope ke tugas Tim IT, jadi angkanya
  // bisa kelihatan "ada data" padahal tabelnya kosong buat user itu.
  const routineWorkOrders = useMemo(
    () => routineTasks.filter((wo) => !["completed", "cancelled"].includes(wo.status)),
    [routineTasks]
  );
  const visibleRoutineWorkOrders = useMemo(
    () =>
      role === "it_team"
        ? routineWorkOrders.filter((wo) => isAssignedToCurrentIt(wo, currentAssetUser, firebaseUser))
        : routineWorkOrders,
    [role, routineWorkOrders, currentAssetUser, firebaseUser]
  );
  const routineSummarySource = visibleRoutineWorkOrders;

  const routineCompletedThisMonthCount = useMemo(() => {
    const scoped =
      role === "it_team"
        ? routineTasks.filter((wo) => isAssignedToCurrentIt(wo, currentAssetUser, firebaseUser))
        : routineTasks;
    const now = new Date();
    return scoped.filter((wo) => {
      if (wo.status !== "completed") return false;
      const d = toDateSafe(wo.completedAt);
      if (!d) return false;
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    }).length;
  }, [role, routineTasks, currentAssetUser, firebaseUser]);

  // Debug sementara — bantu diagnosa kalau Maintenance Rutin kosong lagi di
  // akun Tim IT (mis. field penugasan tidak konsisten di data lama).
  useEffect(() => {
    if (role !== "it_team") return;
    console.log("[Tim IT Routine Filter]", {
      currentUid: currentAssetUser?.uid || firebaseUser?.uid,
      currentEmail: currentAssetUser?.email || firebaseUser?.email,
      currentName: currentAssetUser?.name || firebaseUser?.displayName,
      totalWorkOrders: workOrders.length,
      routineCandidates: routineTasks.map((wo) => ({
        id: wo.id,
        title: wo.title,
        assignedToUid: wo.assignedToUid,
        technicianUid: wo.technicianUid,
        assignedToName: wo.assignedToName,
        assignedToEmail: wo.assignedToEmail,
        taskCategory: wo.taskCategory,
        maintenanceSource: wo.maintenanceSource,
        status: wo.status,
      })),
      myRoutineTasks: myRoutineTasks.length,
    });
  }, [role, currentAssetUser, firebaseUser, workOrders.length, routineTasks, myRoutineTasks]);

  // Debug tambahan — bandingkan langsung apa yang dipakai summary card
  // (routineSummarySource) vs tabel (scheduleWorkOrders) supaya kalau
  // keduanya beda lagi di masa depan, ketahuan dari log ini.
  useEffect(() => {
    console.log("[Tim IT Routine Debug]", {
      role,
      currentUid: currentAssetUser?.uid || firebaseUser?.uid,
      currentEmail: currentAssetUser?.email || firebaseUser?.email,
      currentName: currentAssetUser?.name || firebaseUser?.displayName,
      totalWorkOrders: workOrders.length,
      routineWorkOrders: routineWorkOrders.map((wo) => ({
        id: wo.id,
        title: wo.title,
        status: wo.status,
        taskCategory: wo.taskCategory,
        maintenanceSource: wo.maintenanceSource,
        assignedToUid: wo.assignedToUid,
        technicianUid: wo.technicianUid,
        assignedTechnicianUid: wo.assignedTechnicianUid,
        assignedToName: wo.assignedToName,
        assignedToEmail: wo.assignedToEmail,
      })),
      visibleRoutineCount: visibleRoutineWorkOrders.length,
      scheduleTableCount: scheduleWorkOrders.length,
    });
  }, [role, currentAssetUser, firebaseUser, workOrders.length, routineWorkOrders, visibleRoutineWorkOrders, scheduleWorkOrders]);

  // Backfill data lama: kalau jadwal rutin cuma cocok lewat email/nama
  // (assignedToUid kosong/berbeda) dengan Tim IT yang sedang login, isi
  // ulang field uid-nya supaya konsisten ke depannya — tidak menyentuh
  // dokumen milik teknisi lain.
  useEffect(() => {
    if (role !== "it_team" || !currentAssetUser?.uid) return;
    const uid = currentAssetUser.uid;
    const mismatched = routineTasks.filter(
      (task) =>
        task.assignedToUid !== uid && isAssignedToCurrentIt(task, currentAssetUser, firebaseUser)
    );
    if (mismatched.length === 0) return;
    mismatched.forEach((task) => {
      console.log("[Tim IT Routine Backfill] memperbaiki assignedToUid", {
        workOrderId: task.id,
        workOrderNumber: task.workOrderNumber,
        oldAssignedToUid: task.assignedToUid,
      });
      updateDoc(doc(db, "asset_maintenance_work_orders", task.id), {
        assignedToUid: uid,
        assignedToName: currentAssetUser.name || task.assignedToName || "",
        assignedToEmail: currentAssetUser.email || task.assignedToEmail || "",
        assignedToRole: "it_team",
        technicianUid: uid,
        technicianName: currentAssetUser.name || task.technicianName || "",
        technicianEmail: currentAssetUser.email || task.technicianEmail || "",
        taskCategory: "routine",
        maintenanceSource: task.maintenanceSource || "routine_schedule",
        updatedAt: serverTimestamp(),
      }).catch((err) => console.error("[Tim IT Routine Backfill] gagal update", task.id, err));
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, currentAssetUser?.uid, routineTasks]);

  const overdueWorkOrders = workOrders.filter((w) => isWorkOrderOverdue(w));

  // Riwayat = gabungan log baru + log lama + fallback dokumen kerja/ticket.
  // Jangan dibatasi hanya status selesai, karena user perlu melihat pindah
  // status, laporan dikirim, cek ulang, follow-up, pembatalan, dan selesai.
  const historyItems = useMemo<MaintenanceHistoryItem[]>(() => {
    const currentHistoryUid = currentAssetUser?.uid || firebaseUser?.uid || "";
    const findWorkOrder = (item: MaintenanceHistoryItem) =>
      workOrders.find((wo) => wo.id === item.sourceId || wo.workOrderNumber === item.number);
    const findTicket = (item: MaintenanceHistoryItem) =>
      tickets.find((ticket) => ticket.id === item.sourceId || ticket.ticketNumber === item.number);
    const visibleForRole = (item: MaintenanceHistoryItem) => {
      if (role !== "it_team") return true;
      if (item.targetType === "maintenance") {
        const workOrder = findWorkOrder(item);
        if (workOrder) return isAssignedToCurrentUser(workOrder, currentAssetUser, firebaseUser);
      }
      if (item.targetType === "ticket") {
        const ticket = findTicket(item);
        if (ticket) return isAssignedToCurrentUser(ticket, currentAssetUser, firebaseUser);
      }
      const raw = item.raw as HistoryLogRecord;
      return (
        raw.createdByUid === currentHistoryUid ||
        raw.updatedByUid === currentHistoryUid ||
        raw.performedByUid === currentHistoryUid ||
        raw.movedByUid === currentHistoryUid ||
        raw.userUid === currentHistoryUid
      );
    };

    const normalizedActivityLogs = activityLogs.map((log) =>
      normalizeHistoryItem("activity_log", log.id, log, "maintenance")
    );
    const normalizedWorkOrderLogs = workOrderLogs.map((log) =>
      normalizeHistoryItem("work_order_log", log.id, log, "maintenance")
    );
    const normalizedAssetActivityLogs = assetActivityLogs
      .filter(isMaintenanceRelatedAssetLog)
      .map((log) => normalizeHistoryItem("asset_activity_log", log.id, log, "maintenance"));
    const normalizedIssueTicketLogs = issueTicketLogs.map((log) =>
      normalizeHistoryItem("issue_ticket_log", log.id, log, "ticket")
    );

    const workOrderFallbacks: MaintenanceHistoryItem[] = workOrders
      .filter(
        (wo) =>
          ["completed", "cancelled", "report_submitted", "revision_requested"].includes(wo.status) ||
          !!wo.followUpStatus
      )
      .map((wo) => ({
        id: `maintenance-${wo.id}`,
        source: "maintenance",
        recordSource: "maintenance",
        sourceId: wo.id,
        targetType: "maintenance",
        number: wo.workOrderNumber || wo.id,
        title: wo.title,
        typeLabel: isRoutineWorkOrder(wo) ? "Maintenance Rutin" : "Maintenance Korektif",
        status: wo.status as string,
        statusLabel: getHistoryStatusLabel(wo.status),
        locationText: wo.maintenanceLocationText || wo.locationText || "-",
        assignedToName: wo.assignedToName || wo.technicianName || wo.assignedTechnicianName || "-",
        actorName: wo.updatedByName || wo.completedByName || wo.cancelledByName || wo.requestedByName || "-",
        completedAt:
          wo.completedAt ||
          wo.cancelledAt ||
          wo.reportSubmittedAt ||
          wo.lastActivityAt ||
          wo.updatedAt ||
          wo.createdAt,
        resultSummary:
          wo.lastActivityMessage ||
          wo.reportSummary ||
          wo.qhseNote ||
          wo.notes ||
          wo.cancelReason ||
          "-",
        raw: wo,
      }));

    const ticketFallbacks: MaintenanceHistoryItem[] = tickets
      .filter((t) =>
        ["completed", "cancelled", "rejected", "duplicate", "needs_follow_up"].includes(t.status)
      )
      .map((t) => ({
        id: `ticket-${t.id}`,
        source: "ticket",
        recordSource: "ticket",
        sourceId: t.id,
        targetType: "ticket",
        number: t.ticketNumber || t.id,
        title: t.assetName ? `${t.symptomType} — ${t.assetName}` : t.description || "Laporan Kendala",
        typeLabel: ticketReportTypeLabel(t),
        status: t.status as string,
        statusLabel: getHistoryStatusLabel(t.status),
        locationText: t.locationText || t.assetLocation || "-",
        assignedToName: t.assignedToName || t.assignedTeam || "-",
        actorName: t.assignedToName || t.assignedTeam || t.reportedByName || "-",
        completedAt: t.resolvedAt || t.closedAt || t.updatedAt || t.createdAt,
        resultSummary: t.resolutionNote || t.diagnosis || t.description || "-",
        raw: t,
      }));

    return [
      ...normalizedActivityLogs,
      ...normalizedWorkOrderLogs,
      ...normalizedAssetActivityLogs,
      ...normalizedIssueTicketLogs,
      ...workOrderFallbacks,
      ...ticketFallbacks,
    ]
      .filter(visibleForRole)
      .sort((a, b) => {
        const aTime = toDateSafe(a.completedAt)?.getTime() || 0;
        const bTime = toDateSafe(b.completedAt)?.getTime() || 0;
        return bTime - aTime;
      });
  }, [
    activityLogs,
    workOrderLogs,
    assetActivityLogs,
    issueTicketLogs,
    workOrders,
    tickets,
    role,
    currentAssetUser,
    firebaseUser,
  ]);

  const filteredHistoryItems = useMemo(() => {
    const search = historySearch.trim().toLowerCase();
    return historyItems.filter((item) => {
      if (historySourceFilter !== "all" && item.source !== historySourceFilter) return false;
      if (historyStatusFilter === "done" && !HISTORY_DONE_STATUSES.includes(item.status)) return false;
      if (
        historyStatusFilter === "cancelled" &&
        !HISTORY_CANCELLED_STATUSES.includes(item.status)
      )
        return false;
      if (search) {
        const haystack = [
          item.number,
          item.title,
          item.locationText,
          item.assignedToName,
          item.actorName,
          item.statusLabel,
          item.resultSummary,
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    });
  }, [historyItems, historySourceFilter, historyStatusFilter, historySearch]);

  useEffect(() => {
    console.log("[Maintenance History Debug]", {
      activityLogs: activityLogs.length,
      workOrderLogs: workOrderLogs.length,
      assetActivityLogs: assetActivityLogs.filter(isMaintenanceRelatedAssetLog).length,
      issueTicketLogs: issueTicketLogs.length,
      workOrderFallbacks: workOrders.filter(
        (wo) =>
          ["completed", "cancelled", "report_submitted", "revision_requested"].includes(wo.status) ||
          !!wo.followUpStatus
      ).length,
      ticketFallbacks: tickets.filter((t) =>
        ["completed", "cancelled", "rejected", "duplicate", "needs_follow_up"].includes(t.status)
      ).length,
      mergedHistory: historyItems.length,
    });
  }, [activityLogs, workOrderLogs, assetActivityLogs, issueTicketLogs, workOrders, tickets, historyItems.length]);

  // Summary card WAJIB menghitung dari kedua collection (tickets + work
  // orders), termasuk status baru (created/accepted/in_progress/
  // report_submitted) — jangan hardcode 0 dan jangan hanya baca tickets.
  const summaryCounts = useMemo(
    () => getMaintenanceSummaryCounts({ tickets, workOrders }),
    [tickets, workOrders]
  );

  useEffect(() => {
    console.log("[Maintenance Summary] tickets:", tickets.length);
    console.log("[Maintenance Summary] workOrders:", workOrders.length);
    console.log("[Maintenance Summary] routine.notStartedCount:", summaryCounts.routine.notStartedCount);
    console.log("[Maintenance Summary] routine.inProgressCount:", summaryCounts.routine.inProgressCount);
    console.log("[Maintenance Summary] routine.overdueCount:", summaryCounts.routine.overdueCount);
    console.log(
      "[Maintenance Summary] routine.completedThisMonth:",
      summaryCounts.routine.completedThisMonth
    );
    console.log("[Maintenance Summary] corrective.staffReports:", summaryCounts.corrective.staffReports);
    console.log(
      "[Maintenance Summary] corrective.followUpCount:",
      summaryCounts.corrective.followUpCount
    );
  }, [tickets, workOrders, summaryCounts]);

  // Badge angka tab — dihitung dari data realtime yang sama dengan isi tab
  // itu sendiri, bukan angka hardcode, supaya selalu sinkron. Rutin dan
  // korektif TIDAK boleh saling menghitung data yang sama.
  const scheduleBadgeCount = scheduleWorkOrders.length;
  const myTasksBadgeCount = myCorrectiveTasks.length;
  const myTasksHasOverdue = myCorrectiveTasks.some(
    (w) => w.status !== "completed" && isWorkOrderOverdue(w)
  );

  const tabBadgeCount: Record<TabKey, number> = {
    incoming: tickets.filter((t) => TICKET_TAB_STATUS.incoming!.includes(t.status)).length,
    technician: tickets.filter((t) => TICKET_TAB_STATUS.technician!.includes(t.status)).length,
    follow_up: tickets.filter((t) => TICKET_TAB_STATUS.follow_up!.includes(t.status)).length,
    schedule: scheduleBadgeCount,
    my_tasks: myTasksBadgeCount,
    history: historyItems.length,
  };
  const tabBadgeColor: Record<TabKey, string> = {
    ...TAB_BADGE_COLOR,
    schedule: overdueWorkOrders.length > 0 ? "bg-red-100 text-red-700" : TAB_BADGE_COLOR.schedule,
    my_tasks: myTasksHasOverdue ? "bg-red-100 text-red-700" : TAB_BADGE_COLOR.my_tasks,
  };

  // Minimal deteksi overdue: dicek setiap kali halaman ini dibuka (bukan cron
  // terjadwal), di-dedupe per hari per work order supaya tidak spam notifikasi
  // setiap refresh.
  useEffect(() => {
    if (!canViewMaintenancePage) return;
    if (overdueWorkOrders.length === 0) return;
    overdueWorkOrders.forEach((w) => {
      void (async () => {
        const actionLabel = "maintenance overdue notification";
        try {
          console.log("[Maintenance page.tsx:394] START", actionLabel, {
            workOrderId: w.id,
            workOrderNumber: w.workOrderNumber,
          });
          const dedupeKey = buildOverdueDedupeKey(w.workOrderNumber);
          const alreadySent = await dedupeKeyExists(dedupeKey);
          if (alreadySent) {
            console.log("[Maintenance page.tsx:394] SUCCESS", actionLabel, {
              workOrderId: w.id,
              skipped: "dedupe exists",
            });
            return;
          }

          const recipients = [
            w.assignedToUid
              ? {
                  uid: w.assignedToUid,
                  name: w.assignedToName || "",
                  role: getAssignedMaintenanceRole(w.assignedToRole),
                  linkUrl: `/maintenance?tab=${TAB_QUERY_PARAM.schedule}&workOrderId=${w.id}`,
                }
              : null,
            w.requestedByUid
              ? {
                  uid: w.requestedByUid,
                  name: w.requestedByName,
                  role: "asset_admin" as const,
                  linkUrl: `/maintenance?tab=${TAB_QUERY_PARAM.schedule}&workOrderId=${w.id}`,
                }
              : null,
          ].filter(
            (
              r
            ): r is {
              uid: string;
              name: string;
              role: "it_team" | "super_admin" | "asset_admin";
              linkUrl: string;
            } => !!r
          );

          await Promise.all(
            recipients.map((r) =>
              createAssetNotification({
                recipientUid: r.uid,
                recipientName: r.name,
                recipientRole: r.role,
                title: "Maintenance Overdue",
                message: `${w.workOrderNumber} melewati jadwal.`,
                type: "maintenance_overdue",
                priority: "high",
                linkUrl: r.linkUrl,
                relatedType: "work_order",
                relatedId: w.id,
                relatedNumber: w.workOrderNumber,
                dedupeKey,
              })
            )
          );
          console.log("[Maintenance page.tsx:394] SUCCESS", actionLabel, {
            workOrderId: w.id,
            recipients: recipients.length,
          });
        } catch (error) {
          console.error("[Maintenance page.tsx:394] ERROR maintenance overdue notification", {
            workOrderId: w.id,
            workOrderNumber: w.workOrderNumber,
            error,
          });
        }
      })();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canViewMaintenancePage, overdueWorkOrders.map((w) => w.id).join(",")]);

  // Dua kelompok kartu terpisah — jadwal rutin TIDAK BOLEH ikut dihitung di
  // kartu manapun milik Laporan Kendala/Korektif (khususnya "Dalam Antrian"
  // versi lama, sekarang dihapus total).
  const routineSummary = [
    {
      label: "Jadwal Rutin Aktif",
      value: routineSummarySource.length,
      icon: CalendarClock,
      color: "bg-blue-50 text-blue-600",
    },
    {
      label: "Belum Dikerjakan",
      value: routineSummarySource.filter((wo) =>
        ["created", "accepted", "scheduled_by_it"].includes(wo.status)
      ).length,
      icon: Wrench,
      color: "bg-indigo-50 text-indigo-600",
    },
    {
      label: "Sedang Dikerjakan",
      value: routineSummarySource.filter((wo) => wo.status === "in_progress").length,
      icon: Wrench,
      color: "bg-purple-50 text-purple-600",
    },
    {
      label: "Menunggu Review QHSE",
      value: routineSummarySource.filter((wo) => wo.status === "report_submitted").length,
      icon: ClipboardCheck,
      color: "bg-teal-50 text-teal-600",
    },
    {
      label: "Terlambat",
      value: routineSummarySource.filter((wo) => isWorkOrderOverdue(wo)).length,
      icon: AlertOctagon,
      color: "bg-red-50 text-red-600",
    },
    {
      label: "Selesai Bulan Ini",
      value: routineCompletedThisMonthCount,
      icon: CheckCircle2,
      color: "bg-emerald-50 text-emerald-600",
    },
  ];

  const correctiveSummary = [
    {
      label: "Laporan Kendala Staff",
      value: summaryCounts.corrective.staffReports,
      icon: Inbox,
      color: "bg-blue-50 text-blue-600",
    },
    {
      label: "Menunggu Diagnosa / Review QHSE",
      value: summaryCounts.corrective.waitingReview,
      icon: Wrench,
      color: "bg-purple-50 text-purple-600",
    },
    {
      label: "Menunggu Tim Terkait",
      value: summaryCounts.corrective.waitingTeam,
      icon: Users,
      color: "bg-amber-50 text-amber-600",
    },
    {
      label: "Sedang Ditangani",
      value: summaryCounts.corrective.inProgress,
      icon: Wrench,
      color: "bg-indigo-50 text-indigo-600",
    },
    {
      label: "Butuh Tindakan Lanjutan",
      value: summaryCounts.corrective.followUpCount,
      icon: AlertOctagon,
      color: "bg-red-50 text-red-600",
    },
    {
      label: "Selesai Bulan Ini",
      value: summaryCounts.corrective.resolvedThisMonth,
      icon: CheckCircle2,
      color: "bg-emerald-50 text-emerald-600",
    },
  ];

  return (
    <ProtectedLayout>
      <PageHeader
        title="Maintenance & Kendala"
        subtitle="Kelola laporan kendala dan jadwal maintenance asset."
        actions={
          activeTab === "schedule" &&
          role === "asset_admin" && (
            <button
              type="button"
              onClick={() => setCreateScheduleOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-teal-500 text-white px-4 py-2.5 text-sm font-medium cursor-pointer hover:brightness-105 shadow-md shadow-blue-900/20"
            >
              <Plus size={16} />
              Buat Jadwal Maintenance Rutin
            </button>
          )
        }
      />

      <div className="mb-2">
        <p className="text-xs font-semibold text-slate-500 mb-2">Maintenance Rutin</p>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          {routineSummary.map((s) => (
            <div key={s.label} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
              <div className={`h-8 w-8 rounded-lg flex items-center justify-center mb-2 ${s.color}`}>
                <s.icon size={16} />
              </div>
              <p className="text-xl font-semibold text-slate-900">{s.value}</p>
              <p className="text-xs text-slate-500">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="mb-6">
        <p className="text-xs font-semibold text-slate-500 mb-2">Laporan Kendala / Korektif</p>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {correctiveSummary.map((s) => (
            <div key={s.label} className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
              <div className={`h-8 w-8 rounded-lg flex items-center justify-center mb-2 ${s.color}`}>
                <s.icon size={16} />
              </div>
              <p className="text-xl font-semibold text-slate-900">{s.value}</p>
              <p className="text-xs text-slate-500">{s.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Section A — tab utama dikembalikan (Laporan Kendala Staff,
          Maintenance Rutin, Tugas Saya, Butuh Tindakan Lanjutan, Riwayat,
          + Antrian Tim IT) — TIDAK diganti oleh Kanban. */}
      <div className="flex items-center gap-1 mb-4 border-b border-slate-200 overflow-x-auto">
        {visibleTabs.map((t) => {
          const badgeCount = tabBadgeCount[t.key];
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => handleTabClick(t.key)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium whitespace-nowrap cursor-pointer border-b-2 -mb-px transition-colors ${
                activeTab === t.key
                  ? "border-blue-600 text-blue-700"
                  : "border-transparent text-slate-500 hover:text-slate-700"
              }`}
            >
              {t.label}
              {badgeCount > 0 && (
                <span
                  className={`inline-flex items-center justify-center h-5 min-w-5 px-1 rounded-full text-[11px] font-semibold ${tabBadgeColor[t.key]}`}
                >
                  {formatBadgeCount(badgeCount)}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {(activeTab === "schedule" || activeTab === "my_tasks") && (
        <p className="text-xs text-slate-500 mb-4 -mt-2">
          {activeTab === "schedule"
            ? "Jadwal maintenance rutin yang ditugaskan ke Anda."
            : "Kendala/korektif yang ditugaskan ke Anda."}
        </p>
      )}

      {activeTab === "schedule" ? (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-visible">
          {scheduleWorkOrders.length === 0 ? (
            <EmptyState icon={CalendarClock} title="Belum ada jadwal maintenance rutin" />
          ) : (
            <div className="overflow-x-auto sm:overflow-x-visible">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-200 bg-slate-50/60">
                    <th className="px-4 py-3 font-semibold">Judul</th>
                    <th className="px-4 py-3 font-semibold">Frekuensi</th>
                    <th className="px-4 py-3 font-semibold">Setiap Tanggal</th>
                    <th className="px-4 py-3 font-semibold">Periode Mulai</th>
                    <th className="px-4 py-3 font-semibold">Jatuh Tempo</th>
                    <th className="px-4 py-3 font-semibold">Jadwal Berikutnya</th>
                    <th className="px-4 py-3 font-semibold">Lokasi / Filter</th>
                    <th className="px-4 py-3 font-semibold">Asset yang Dicek</th>
                    <th className="px-4 py-3 font-semibold">Jumlah Asset</th>
                    <th className="px-4 py-3 font-semibold">Ditugaskan ke</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {scheduleWorkOrders.map((w) => {
                    const scopeLabel =
                      w.assetSelectionMode === "filtered_assets"
                        ? [w.filtersSnapshot?.categoryText ? `Kategori ${w.filtersSnapshot.categoryText}` : ""]
                            .filter(Boolean)
                            .join(" / ") || "Filter aktif"
                        : w.assetSelectionMode
                        ? ASSET_SELECTION_MODE_LABEL[w.assetSelectionMode]
                        : "-";
                    const canManageRoutineSchedule = role === "asset_admin";
                    const canMonitorSystem = role === "super_admin";
                    return (
                      <tr
                        key={w.id}
                        className={`border-b border-slate-100 last:border-0 hover:bg-slate-50/70 transition-colors ${
                          highlightId === w.id ? "bg-amber-50" : ""
                        }`}
                      >
                        <td className="px-4 py-3 font-medium text-slate-800">{w.title}</td>
                        <td className="px-4 py-3 text-slate-600">{w.frequencyLabel || "-"}</td>
                        <td className="px-4 py-3 text-slate-600">
                          {w.scheduledDayOfMonth ? `Tanggal ${w.scheduledDayOfMonth}` : "-"}
                        </td>
                        <td className="px-4 py-3 text-slate-600">{w.periodLabel || "-"}</td>
                        <td className="px-4 py-3 text-slate-600">{formatDate(getDueDateKey(w))}</td>
                        <td className="px-4 py-3 text-slate-600">
                          {formatDate(computeNextCycleDueDateKey(getDueDateKey(w), w.frequencyMonths))}
                        </td>
                        <td className="px-4 py-3 text-slate-600">{w.locationText || "-"}</td>
                        <td className="px-4 py-3 text-slate-600">{scopeLabel}</td>
                        <td className="px-4 py-3 text-slate-600">{w.assetIds?.length || 0}</td>
                        <td className="px-4 py-3 text-slate-600">{w.assignedToName || "-"}</td>
                        <td className="px-4 py-3">
                          <WorkOrderStatusBadge workOrder={w} />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="relative inline-block text-left">
                            <button
                              type="button"
                              onClick={() =>
                                setOpenActionMenuId((cur) => (cur === w.id ? null : w.id))
                              }
                              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 shadow-sm cursor-pointer hover:bg-slate-50"
                            >
                              Aksi
                              <ChevronDown size={14} />
                            </button>

                            {openActionMenuId === w.id && (
                              <>
                                <div
                                  className="fixed inset-0 z-20"
                                  onClick={() => setOpenActionMenuId(null)}
                                />
                                <div className="absolute right-0 z-30 mt-1.5 w-44 rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setWoDetailTarget(w);
                                      setOpenActionMenuId(null);
                                    }}
                                    className="flex w-full items-center gap-2 rounded-lg px-3 h-9 text-left text-[13px] text-slate-700 cursor-pointer hover:bg-slate-50"
                                  >
                                    <Eye size={16} />
                                    {canMonitorSystem ? "Monitoring" : "Lihat Detail"}
                                  </button>
                                  {canManageRoutineSchedule && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setEditWorkOrderTarget(w);
                                        setOpenActionMenuId(null);
                                      }}
                                      className="flex w-full items-center gap-2 rounded-lg px-3 h-9 text-left text-[13px] text-blue-700 cursor-pointer hover:bg-blue-50"
                                    >
                                      <Pencil size={16} />
                                      Edit Jadwal
                                    </button>
                                  )}
                                  {canMonitorSystem && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        router.push("/access");
                                        setOpenActionMenuId(null);
                                      }}
                                      className="flex w-full items-center gap-2 rounded-lg px-3 h-9 text-left text-[13px] text-purple-700 cursor-pointer hover:bg-purple-50"
                                    >
                                      <Users size={16} />
                                      Kelola User Access
                                    </button>
                                  )}
                                  {canManageRoutineSchedule && ["completed", "cancelled"].includes(w.status) && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setDuplicateWorkOrderTarget(w);
                                        setOpenActionMenuId(null);
                                      }}
                                      className="flex w-full items-center gap-2 rounded-lg px-3 h-9 text-left text-[13px] text-slate-700 cursor-pointer hover:bg-slate-50"
                                    >
                                      <RefreshCw size={16} />
                                      Duplikat / Jadwalkan Ulang
                                    </button>
                                  )}
                                  {canManageRoutineSchedule && !["completed", "cancelled"].includes(w.status) && (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setWoDetailTarget(w);
                                        setOpenActionMenuId(null);
                                      }}
                                      className="flex w-full items-center gap-2 rounded-lg px-3 h-9 text-left text-[13px] text-red-600 cursor-pointer hover:bg-red-50"
                                    >
                                      <Power size={16} />
                                      Nonaktifkan
                                    </button>
                                  )}
                                </div>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        <div className="space-y-4">
          {activeTab === "my_tasks" ? (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              {myAssignedTasks.length === 0 ? (
                <EmptyState icon={Wrench} title="Belum ada tugas untuk Anda" />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-slate-500 border-b border-slate-200 bg-slate-50/60">
                      <th className="px-4 py-3 font-semibold">Judul</th>
                      <th className="px-4 py-3 font-semibold">Periode</th>
                      <th className="px-4 py-3 font-semibold">Lokasi</th>
                      <th className="px-4 py-3 font-semibold">Jumlah Asset</th>
                      <th className="px-4 py-3 font-semibold">Status</th>
                      <th className="px-4 py-3 font-semibold">Progress</th>
                      <th className="px-4 py-3 font-semibold text-right">Aksi</th>
                    </tr>
                  </thead>
                  <tbody>
                    {myAssignedTasks.map((w) => {
                      const progress = workOrderProgress(items.filter((i) => i.workOrderId === w.id));
                      return (
                        <tr
                          key={w.id}
                          className={`border-b border-slate-100 last:border-0 hover:bg-slate-50/70 transition-colors ${
                            highlightId === w.id ? "bg-amber-50" : ""
                          }`}
                        >
                          <td className="px-4 py-3 font-medium text-slate-800">{w.title}</td>
                          <td className="px-4 py-3 text-slate-600">{w.periodLabel || "-"}</td>
                          <td className="px-4 py-3 text-slate-600">{w.locationText || "-"}</td>
                          <td className="px-4 py-3 text-slate-600">{w.assetIds?.length || 0}</td>
                          <td className="px-4 py-3">
                            <WorkOrderStatusBadge workOrder={w} />
                          </td>
                          <td className="px-4 py-3 text-slate-600">
                            {progress.checked}/{progress.total}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              type="button"
                              onClick={() => setWoDetailTarget(w)}
                              className="text-sm font-medium text-blue-600 cursor-pointer hover:underline"
                            >
                              Lihat Detail
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  </table>
                </div>
              )}
            </div>
          ) : activeTab === "history" ? (
            <div className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                {(
                  [
                    { key: "all" as const, label: "Semua" },
                    { key: "maintenance" as const, label: "Maintenance" },
                    { key: "ticket" as const, label: "Kendala" },
                  ]
                ).map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => setHistorySourceFilter(f.key)}
                    className={`rounded-xl border px-3 py-1.5 text-sm font-medium cursor-pointer transition-colors ${
                      historySourceFilter === f.key
                        ? "border-blue-500 bg-blue-50 text-blue-700"
                        : "border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
                <span className="mx-1 h-5 w-px bg-slate-200" />
                {(
                  [
                    { key: "all" as const, label: "Semua Status" },
                    { key: "done" as const, label: "Selesai" },
                    { key: "cancelled" as const, label: "Dibatalkan/Ditolak" },
                  ]
                ).map((f) => (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => setHistoryStatusFilter(f.key)}
                    className={`rounded-xl border px-3 py-1.5 text-sm font-medium cursor-pointer transition-colors ${
                      historyStatusFilter === f.key
                        ? "border-blue-500 bg-blue-50 text-blue-700"
                        : "border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
                <input
                  type="text"
                  value={historySearch}
                  onChange={(e) => setHistorySearch(e.target.value)}
                  placeholder="Cari nomor, judul, lokasi, teknisi, aktor..."
                  className="input text-sm ml-auto w-full sm:w-64"
                />
              </div>

              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                {filteredHistoryItems.length === 0 ? (
                  <EmptyState icon={Inbox} title="Belum ada riwayat maintenance atau kendala" />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-slate-500 border-b border-slate-200 bg-slate-50/60">
                          <th className="px-4 py-3 font-semibold">Tanggal</th>
                          <th className="px-4 py-3 font-semibold">Nomor</th>
                          <th className="px-4 py-3 font-semibold">Jenis</th>
                          <th className="px-4 py-3 font-semibold">Judul</th>
                          <th className="px-4 py-3 font-semibold">Lokasi</th>
                          <th className="px-4 py-3 font-semibold">Ditugaskan ke</th>
                          <th className="px-4 py-3 font-semibold">Status</th>
                          <th className="px-4 py-3 font-semibold">Ringkasan</th>
                          <th className="px-4 py-3 font-semibold text-right">Aksi</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredHistoryItems.map((item) => {
                          const targetWorkOrder =
                            item.targetType === "maintenance"
                              ? workOrders.find((w) => w.id === item.sourceId || w.workOrderNumber === item.number)
                              : null;
                          const targetTicket =
                            item.targetType === "ticket"
                              ? tickets.find((t) => t.id === item.sourceId || t.ticketNumber === item.number)
                              : null;
                          const canOpenDetail = !!targetWorkOrder || !!targetTicket;

                          return (
                            <tr
                              key={item.id}
                              className={`border-b border-slate-100 last:border-0 hover:bg-slate-50/70 transition-colors ${
                                highlightId === item.sourceId || highlightId === item.id ? "bg-amber-50" : ""
                              }`}
                            >
                              <td className="px-4 py-3 text-slate-500">{formatDateTime(item.completedAt)}</td>
                              <td className="px-4 py-3 font-medium text-slate-800">{item.number}</td>
                              <td className="px-4 py-3 text-slate-600">{item.typeLabel}</td>
                              <td className="px-4 py-3 text-slate-600">{item.title}</td>
                              <td className="px-4 py-3 text-slate-600">{item.locationText}</td>
                              <td className="px-4 py-3 text-slate-600">{item.assignedToName}</td>
                              <td className="px-4 py-3">
                                {targetWorkOrder ? (
                                  <WorkOrderStatusBadge workOrder={targetWorkOrder} />
                                ) : targetTicket ? (
                                  <Badge
                                    label={ISSUE_STATUS_LABEL[targetTicket.status]}
                                    colorClass={ISSUE_STATUS_COLOR[targetTicket.status]}
                                  />
                                ) : (
                                  <Badge label={item.statusLabel} colorClass="bg-slate-100 text-slate-600 border-slate-200" />
                                )}
                              </td>
                              <td className="px-4 py-3 text-slate-600">
                                <div>
                                  <p>{item.resultSummary}</p>
                                  {item.actorName !== "-" && (
                                    <p className="mt-1 text-xs text-slate-400">Oleh {item.actorName}</p>
                                  )}
                                </div>
                              </td>
                              <td className="px-4 py-3 text-right">
                                <button
                                  type="button"
                                  disabled={!canOpenDetail}
                                  onClick={() => {
                                    if (targetWorkOrder) {
                                      setWoDetailTarget(targetWorkOrder);
                                    } else if (targetTicket) {
                                      setDetailTarget(targetTicket);
                                    }
                                  }}
                                  className={`text-sm font-medium ${
                                    canOpenDetail
                                      ? "text-blue-600 cursor-pointer hover:underline"
                                      : "text-slate-400 cursor-not-allowed"
                                  }`}
                                >
                                  {canOpenDetail ? "Lihat Detail" : "Log Saja"}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              {activeTab === "incoming" && (
                <div className="flex flex-wrap gap-2 border-b border-slate-100 px-4 py-3">
                  {INCOMING_SUB_FILTERS.map((f) => (
                    <button
                      key={f.key}
                      type="button"
                      onClick={() => setIncomingSubFilter(f.key)}
                      className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                        incomingSubFilter === f.key
                          ? "border-slate-800 bg-slate-800 text-white"
                          : "border-slate-200 text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              )}
              {ticketsForTab.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title="Belum ada ticket pada tab ini"
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-200 bg-slate-50/60">
                    <th className="px-4 py-3 font-semibold">Nomor Laporan</th>
                    <th className="px-4 py-3 font-semibold">Judul</th>
                    <th className="px-4 py-3 font-semibold">Jenis Laporan</th>
                    <th className="px-4 py-3 font-semibold">Lokasi</th>
                    <th className="px-4 py-3 font-semibold">Pelapor</th>
                    <th className="px-4 py-3 font-semibold">Tingkat Dampak</th>
                    <th className="px-4 py-3 font-semibold">Tim Terkait</th>
                    <th className="px-4 py-3 font-semibold">Penanggung Jawab</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold">Tanggal Lapor</th>
                    <th className="px-4 py-3 font-semibold text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {ticketsForTab.map((t) => {
                    const impact = ticketFieldImpact(t);
                    return (
                    <tr
                      key={t.id}
                      className={`border-b border-slate-100 last:border-0 hover:bg-slate-50/70 transition-colors ${
                        highlightId === t.id ? "bg-amber-50" : ""
                      }`}
                    >
                      <td className="px-4 py-3 font-medium text-slate-800">{t.ticketNumber}</td>
                      <td className="px-4 py-3 text-slate-600">
                        <p className="font-medium text-slate-800">{ticketTitle(t)}</p>
                        <p className="line-clamp-2 text-xs text-slate-400">{t.description}</p>
                        <p className="text-xs text-slate-400">{t.assetName ? `${t.assetName} (${t.assetCode || "-"})` : "Tanpa asset"}</p>
                      </td>
                      <td className="px-4 py-3">
                        <Badge label={ticketReportTypeLabel(t)} colorClass={ticketReportTypeColor(t)} />
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        <p>{t.locationText || t.assetLocation || "-"}</p>
                        <p className="text-xs text-slate-400">{t.detailArea || "-"}</p>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{t.reportedByName}</td>
                      <td className="px-4 py-3">
                        {impact ? (
                          <Badge label={t.fieldImpactLabel || FIELD_IMPACT_LABEL[impact]} colorClass={FIELD_IMPACT_COLOR[impact]} />
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {ticketAssignedTeamLabel(t)}
                        {isAssignmentIncomplete(t) && (
                          <span className="mt-1 block">
                            <Badge label="Penugasan belum lengkap" colorClass="bg-amber-50 text-amber-700 border-amber-200" />
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{ticketAssignedPersonLabel(t)}</td>
                      <td className="px-4 py-3">
                        <Badge label={ticketStatusLabel(t)} colorClass={ticketStatusColor(t)} />
                      </td>
                      <td className="px-4 py-3 text-slate-500">{formatDateTime(t.createdAt || t.reportedAt)}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => setDetailTarget(t)}
                          className="text-sm font-medium text-blue-600 cursor-pointer hover:underline"
                        >
                          Kelola
                        </button>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
            </div>
          )}
        </div>
      )}

      <Toast toast={toast} onClose={() => setToast(null)} />

      {detailTarget && (
        <IssueTicketDetailModal
          ticket={detailTarget}
          open={!!detailTarget}
          onClose={() => setDetailTarget(null)}
        />
      )}

      {woDetailTarget && (
        <WorkOrderDetailModal
          workOrder={woDetailTarget}
          open={!!woDetailTarget}
          onClose={() => setWoDetailTarget(null)}
        />
      )}

      <CreateMaintenanceScheduleModal
        open={createScheduleOpen}
        onClose={() => setCreateScheduleOpen(false)}
      />

      {editWorkOrderTarget && (
        <CreateMaintenanceScheduleModal
          open={!!editWorkOrderTarget}
          editWorkOrder={editWorkOrderTarget}
          onClose={() => setEditWorkOrderTarget(null)}
          onCreated={() => setEditWorkOrderTarget(null)}
        />
      )}

      {duplicateWorkOrderTarget && (
        <CreateMaintenanceScheduleModal
          open={!!duplicateWorkOrderTarget}
          duplicateFrom={duplicateWorkOrderTarget}
          onClose={() => setDuplicateWorkOrderTarget(null)}
          onCreated={() => setDuplicateWorkOrderTarget(null)}
        />
      )}
    </ProtectedLayout>
  );
}

// Badge status tabel — kalau overdue/jatuh tempo hari ini, tampilkan badge
// derived (merah/kuning) tapi tetap sertakan status asli kecil di sebelahnya
// supaya tidak ambigu, mis. "Terlambat · Dibuat oleh QHSE".
function WorkOrderStatusBadge({ workOrder }: { workOrder: MaintenanceWorkOrder }) {
  const display = getDisplayStatus(workOrder);
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      <Badge label={display.label} colorClass={display.colorClass} />
      {(display.overdue || display.dueToday) && display.subLabel && (
        <span className="text-xs text-slate-400">· {display.subLabel}</span>
      )}
    </div>
  );
}
