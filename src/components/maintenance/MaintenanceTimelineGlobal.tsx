"use client";

import { useEffect, useMemo, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query } from "firebase/firestore";
import { History, Search } from "lucide-react";
import { db } from "@/lib/firebase";
import { AssetIssueLog, MaintenanceWorkOrderLog } from "@/lib/types";
import { formatDateTime } from "@/lib/utils";
import { TASK_CATEGORY_LABEL } from "@/lib/maintenanceBoard";
import EmptyState from "@/components/EmptyState";

// Section J — satu bentuk gabungan dari 3 sumber log (work order, ticket,
// aktivitas Kanban) supaya Timeline Global bisa dirender dari satu list
// tunggal terurut kronologis, TIDAK per-task.
interface TimelineEntry {
  id: string;
  sourceType: "work_order" | "ticket" | "activity";
  taskNumber: string;
  title: string;
  actorName: string;
  message: string;
  status?: string;
  createdAt: unknown;
}

interface ActivityLog {
  id: string;
  message: string;
  actionLabel: string;
  taskNumber?: string;
  title?: string;
  toStatus?: string;
  createdByName: string;
  createdAt: unknown;
  locationName?: string;
  sourceType: "work_order" | "ticket";
}

// Section D — filter Riwayat Aktivitas (gabungan bekas Timeline Global +
// tab Riwayat lama). "K3/Facility" tidak dimasukkan sebagai filter jenis
// karena tidak ada field yang membedakannya di data work order/ticket saat
// ini (sama seperti chip Kanban) — filter status (Selesai/Dibatalkan) tetap
// dimasukkan karena bisa dihitung langsung dari status baru tiap log.
const TYPE_FILTERS: { key: string; label: string }[] = [
  { key: "", label: "Semua" },
  { key: "work_order", label: "Maintenance Rutin" },
  { key: "ticket", label: "Kendala Staff" },
  { key: "activity", label: "Perubahan Status" },
  { key: "done", label: "Selesai" },
  { key: "cancelled", label: "Dibatalkan" },
];

const DONE_STATUSES = ["completed"];
const CANCELLED_STATUSES = ["cancelled", "rejected"];

function timeValue(t: unknown): number {
  if (!t) return 0;
  if (typeof t === "object" && t !== null && "toMillis" in t) {
    return (t as { toMillis: () => number }).toMillis();
  }
  return 0;
}

export default function MaintenanceTimelineGlobal() {
  const [workOrderLogs, setWorkOrderLogs] = useState<MaintenanceWorkOrderLog[]>([]);
  const [issueLogs, setIssueLogs] = useState<AssetIssueLog[]>([]);
  const [activityLogs, setActivityLogs] = useState<ActivityLog[]>([]);
  const [typeFilter, setTypeFilter] = useState("");
  const [search, setSearch] = useState("");

  useEffect(() => {
    const q = query(collection(db, "asset_maintenance_work_order_logs"), orderBy("performedAt", "desc"), limit(200));
    const unsub = onSnapshot(
      q,
      (snap) => setWorkOrderLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() } as MaintenanceWorkOrderLog))),
      (err) => console.error("[MaintenanceTimelineGlobal] work_order_logs error:", err)
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    const q = query(collection(db, "asset_issue_logs"), orderBy("performedAt", "desc"), limit(200));
    const unsub = onSnapshot(
      q,
      (snap) => setIssueLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() } as AssetIssueLog))),
      (err) => console.error("[MaintenanceTimelineGlobal] issue_logs error:", err)
    );
    return () => unsub();
  }, []);

  useEffect(() => {
    const q = query(collection(db, "asset_maintenance_activity_logs"), orderBy("createdAt", "desc"), limit(200));
    const unsub = onSnapshot(
      q,
      (snap) => setActivityLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() } as ActivityLog))),
      (err) => console.error("[MaintenanceTimelineGlobal] activity_logs error:", err)
    );
    return () => unsub();
  }, []);

  const entries: TimelineEntry[] = useMemo(() => {
    const fromWorkOrder: TimelineEntry[] = workOrderLogs.map((l) => ({
      id: `wo-${l.id}`,
      sourceType: "work_order",
      taskNumber: l.workOrderNumber,
      title: l.workOrderNumber,
      actorName: l.performedByName,
      message: l.note || `${l.performedByName} mengubah status: ${l.action}`,
      status: l.newStatus,
      createdAt: l.performedAt,
    }));
    const fromTicket: TimelineEntry[] = issueLogs.map((l) => ({
      id: `tk-${l.id}`,
      sourceType: "ticket",
      taskNumber: l.ticketNumber,
      title: l.ticketNumber,
      actorName: l.performedByName,
      message: l.note || `${l.performedByName} mengubah status: ${l.action}`,
      status: l.newStatus,
      createdAt: l.performedAt,
    }));
    const fromActivity: TimelineEntry[] = activityLogs.map((l) => ({
      id: `ac-${l.id}`,
      sourceType: "activity",
      taskNumber: l.taskNumber || "-",
      title: l.title || l.taskNumber || "-",
      actorName: l.createdByName,
      message: l.message,
      status: l.toStatus,
      createdAt: l.createdAt,
    }));
    return [...fromWorkOrder, ...fromTicket, ...fromActivity].sort(
      (a, b) => timeValue(b.createdAt) - timeValue(a.createdAt)
    );
  }, [workOrderLogs, issueLogs, activityLogs]);

  const filtered = entries.filter((e) => {
    if (typeFilter === "done" && !DONE_STATUSES.includes(e.status || "")) return false;
    else if (typeFilter === "cancelled" && !CANCELLED_STATUSES.includes(e.status || "")) return false;
    else if (typeFilter && typeFilter !== "done" && typeFilter !== "cancelled" && e.sourceType !== typeFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      if (!`${e.taskNumber} ${e.title} ${e.actorName} ${e.message}`.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {TYPE_FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setTypeFilter(f.key)}
            className={`rounded-xl border px-3 py-1.5 text-sm font-medium cursor-pointer transition-colors ${
              typeFilter === f.key
                ? "border-blue-500 bg-blue-50 text-blue-700"
                : "border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Cari nomor task, judul, pelapor, teknisi, atau catatan..."
          className="input pl-9"
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={History} title="Belum ada aktivitas" description="Aktivitas maintenance/kendala akan muncul di sini." />
      ) : (
        <div className="space-y-2.5">
          {filtered.slice(0, 100).map((e) => (
            <div key={e.id} className="rounded-2xl border border-slate-200 bg-white p-3.5 shadow-sm">
              <p className="text-xs text-slate-400">{e.createdAt ? formatDateTime(e.createdAt) : "-"}</p>
              <p className="mt-1 text-sm text-slate-800 break-words">
                <span className="font-semibold">{e.actorName}</span> — {e.message}
              </p>
              <p className="mt-1 text-xs text-slate-500 break-words">
                {e.sourceType !== "activity" && `${TASK_CATEGORY_LABEL[e.sourceType === "work_order" ? "routine" : "staff_issue"]} · `}
                {e.taskNumber} {e.title !== e.taskNumber ? `— ${e.title}` : ""}
              </p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
