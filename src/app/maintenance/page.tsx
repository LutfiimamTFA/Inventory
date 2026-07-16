"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { collection, collectionGroup, onSnapshot, orderBy, query } from "firebase/firestore";
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
import {
  ASSET_SELECTION_MODE_LABEL,
  ISSUE_PRIORITY_COLOR,
  ISSUE_PRIORITY_LABEL,
  ISSUE_PRIORITY_RANK,
  ISSUE_STATUS_COLOR,
  ISSUE_STATUS_LABEL,
  computeNextCycleDueDateKey,
  formatDate,
  formatDateTime,
  getDisplayStatus,
  getDueDateKey,
  isWorkOrderOverdue,
} from "@/lib/utils";
import { getMaintenanceSummaryCounts, workOrderProgress } from "@/lib/reports";
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

const TICKET_TAB_STATUS: Partial<Record<TabKey, IssueTicketStatus[]>> = {
  incoming: ["open", "review_by_asset_admin", "need_more_info"],
  technician: ["waiting_diagnosis", "checking", "minor_fix"],
  follow_up: ["needs_follow_up", "waiting_sparepart", "waiting_vendor"],
  history: ["resolved", "closed", "rejected"],
};

const TABS: { key: TabKey; label: string; roles: AppRole[] }[] = [
  { key: "incoming", label: "Laporan Kendala Staff", roles: ["super_admin", "asset_admin"] },
  { key: "technician", label: "Antrian Tim IT", roles: ["super_admin", "it_team"] },
  { key: "follow_up", label: "Butuh Tindakan Lanjutan", roles: ["super_admin", "asset_admin", "it_team"] },
  { key: "schedule", label: "Maintenance Rutin", roles: ["asset_admin", "super_admin"] },
  { key: "my_tasks", label: "Tugas Saya", roles: ["super_admin", "it_team"] },
  { key: "history", label: "Riwayat", roles: ["super_admin", "asset_admin"] },
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

function logMaintenanceListenerError(label: string) {
  return (error: unknown) => {
    console.error(`[Maintenance Listener] ${label} error`, error);
  };
}

export default function MaintenancePage() {
  return (
    <Suspense fallback={null}>
      <MaintenancePageContent />
    </Suspense>
  );
}

function MaintenancePageContent() {
  const { role, assetUser } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [tickets, setTickets] = useState<AssetIssueTicket[]>([]);
  const [workOrders, setWorkOrders] = useState<MaintenanceWorkOrder[]>([]);
  const [items, setItems] = useState<MaintenanceWorkOrderItem[]>([]);
  const [activeTab, setActiveTab] = useState<TabKey>("incoming");
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

  const tabParam = searchParams.get("tab");
  const ticketIdParam = searchParams.get("ticketId");
  const workOrderIdParam = searchParams.get("workOrderId");
  const canViewMaintenancePage =
    role === "super_admin" || role === "asset_admin" || role === "it_team";

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
  const isRoutineWorkOrder = (w: MaintenanceWorkOrder) => (w.taskCategory || "routine") === "routine";
  const ticketsForTab = useMemo(() => {
    // Tugas Maintenance Saya = tugas korektif (kerusakan/insidental) yang
    // ditugaskan ke teknisi yang sedang login — BUKAN jadwal rutin.
    if (activeTab === "my_tasks") {
      return tickets
        .filter(
          (t) =>
            t.assignedToUid === assetUser?.uid &&
            !["resolved", "closed", "rejected"].includes(t.status)
        )
        .sort((a, b) => ISSUE_PRIORITY_RANK[a.priority] - ISSUE_PRIORITY_RANK[b.priority]);
    }
    const statuses = TICKET_TAB_STATUS[activeTab];
    if (!statuses) return [];
    const filtered = tickets.filter((t) => statuses.includes(t.status));
    if (activeTab === "incoming" || activeTab === "technician") {
      return [...filtered].sort(
        (a, b) => ISSUE_PRIORITY_RANK[a.priority] - ISSUE_PRIORITY_RANK[b.priority]
      );
    }
    return filtered;
  }, [tickets, activeTab, assetUser?.uid]);

  // Jadwal Maintenance Rutin: HANYA taskCategory "routine" — tugas korektif
  // (taskCategory "corrective") tidak boleh muncul di sini.
  const scheduleWorkOrders = useMemo(
    () =>
      workOrders
        .filter(isRoutineWorkOrder)
        .sort((a, b) => {
          const ta = (a.createdAt as { seconds?: number })?.seconds || 0;
          const tb = (b.createdAt as { seconds?: number })?.seconds || 0;
          return tb - ta;
        }),
    [workOrders]
  );

  // Work order korektif (taskCategory "corrective") yang ditugaskan ke saya
  // — saat ini belum ada flow yang membuat work order korektif (tugas
  // insidental dibuat sebagai ticket, lihat ticketsForTab di atas), jadi
  // list ini forward-compat saja dan biasanya kosong.
  const myAssignedWorkOrders = useMemo(
    () =>
      workOrders.filter(
        (w) =>
          w.assignedToUid === assetUser?.uid &&
          !["cancelled", "completed"].includes(w.status)
      ),
    [workOrders, assetUser?.uid]
  );

  const overdueWorkOrders = workOrders.filter((w) => isWorkOrderOverdue(w));

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
  const scheduleBadgeCount = workOrders.filter(
    (w) =>
      isRoutineWorkOrder(w) &&
      (["created", "accepted", "scheduled_by_it", "assigned"].includes(w.status) || isWorkOrderOverdue(w))
  ).length;
  const myCorrectiveTicketCount = tickets.filter(
    (t) =>
      t.assignedToUid === assetUser?.uid && !["resolved", "closed", "rejected"].includes(t.status)
  ).length;
  const myTasksBadgeCount = myCorrectiveTicketCount + myAssignedWorkOrders.length;
  const myTasksHasOverdue = myAssignedWorkOrders.some(
    (w) => w.status !== "completed" && isWorkOrderOverdue(w)
  );

  const tabBadgeCount: Record<TabKey, number> = {
    incoming: tickets.filter((t) => TICKET_TAB_STATUS.incoming!.includes(t.status)).length,
    technician: tickets.filter((t) => TICKET_TAB_STATUS.technician!.includes(t.status)).length,
    follow_up: tickets.filter((t) => TICKET_TAB_STATUS.follow_up!.includes(t.status)).length,
    schedule: scheduleBadgeCount,
    my_tasks: myTasksBadgeCount,
    history: 0,
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
                  linkUrl: `/maintenance?tab=${TAB_QUERY_PARAM.my_tasks}&workOrderId=${w.id}`,
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
      value: summaryCounts.routine.activeCount,
      icon: CalendarClock,
      color: "bg-blue-50 text-blue-600",
    },
    {
      label: "Belum Dikerjakan",
      value: summaryCounts.routine.notStartedCount,
      icon: Wrench,
      color: "bg-indigo-50 text-indigo-600",
    },
    {
      label: "Sedang Dikerjakan",
      value: summaryCounts.routine.inProgressCount,
      icon: Wrench,
      color: "bg-purple-50 text-purple-600",
    },
    {
      label: "Menunggu Review QHSE",
      value: summaryCounts.routine.awaitingReviewCount,
      icon: ClipboardCheck,
      color: "bg-teal-50 text-teal-600",
    },
    {
      label: "Terlambat",
      value: summaryCounts.routine.overdueCount,
      icon: AlertOctagon,
      color: "bg-red-50 text-red-600",
    },
    {
      label: "Selesai Bulan Ini",
      value: summaryCounts.routine.completedThisMonth,
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
      label: "Menunggu Diagnosa IT",
      value: summaryCounts.corrective.waitingDiagnosis,
      icon: Wrench,
      color: "bg-purple-50 text-purple-600",
    },
    {
      label: "Sedang Dicek",
      value: summaryCounts.corrective.checking,
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
      label: "Selesai",
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
            ? "Maintenance Rutin: tugas berkala/preventive (bulanan, 3 bulanan, dst) yang dijadwalkan QHSE."
            : "Tugas Saya: maintenance rutin dan kendala yang ditugaskan ke Anda."}
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
          {activeTab === "my_tasks" && myAssignedWorkOrders.length > 0 && (
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
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
                    {myAssignedWorkOrders.map((w) => {
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
            </div>
          )}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          {ticketsForTab.length === 0 ? (
            <EmptyState
              icon={Inbox}
              title={
                activeTab === "my_tasks" ? "Belum ada tugas untuk Anda" : "Belum ada ticket pada tab ini"
              }
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-200 bg-slate-50/60">
                    <th className="px-4 py-3 font-semibold">Nomor Ticket</th>
                    <th className="px-4 py-3 font-semibold">Asset</th>
                    <th className="px-4 py-3 font-semibold">Pelapor</th>
                    <th className="px-4 py-3 font-semibold">Gejala</th>
                    <th className="px-4 py-3 font-semibold">Dampak</th>
                    <th className="px-4 py-3 font-semibold">Prioritas</th>
                    <th className="px-4 py-3 font-semibold">Status</th>
                    <th className="px-4 py-3 font-semibold">Tanggal Lapor</th>
                    <th className="px-4 py-3 font-semibold text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody>
                  {ticketsForTab.map((t) => (
                    <tr
                      key={t.id}
                      className={`border-b border-slate-100 last:border-0 hover:bg-slate-50/70 transition-colors ${
                        highlightId === t.id ? "bg-amber-50" : ""
                      }`}
                    >
                      <td className="px-4 py-3 font-medium text-slate-800">{t.ticketNumber}</td>
                      <td className="px-4 py-3 text-slate-600">
                        <p>{t.assetName}</p>
                        <p className="text-xs text-slate-400">{t.assetCode}</p>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{t.reportedByName}</td>
                      <td className="px-4 py-3 text-slate-600">{t.symptomType}</td>
                      <td className="px-4 py-3 text-slate-600">{t.impactLevel}</td>
                      <td className="px-4 py-3">
                        <Badge label={ISSUE_PRIORITY_LABEL[t.priority]} colorClass={ISSUE_PRIORITY_COLOR[t.priority]} />
                      </td>
                      <td className="px-4 py-3">
                        <Badge label={ISSUE_STATUS_LABEL[t.status]} colorClass={ISSUE_STATUS_COLOR[t.status]} />
                      </td>
                      <td className="px-4 py-3 text-slate-500">{formatDateTime(t.reportedAt)}</td>
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
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        </div>
      )}

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
