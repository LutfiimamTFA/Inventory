"use client";

import { useMemo } from "react";
import { Asset, MaintenanceWorkOrder, MaintenanceWorkOrderItem } from "@/lib/types";
import { WORK_ORDER_STATUS_LABEL, formatDate } from "@/lib/utils";
import {
  exportToExcel,
  isMaintenanceOverdue,
  isWorkOrderOverdueRecord,
  todayStamp,
  toDateSafe,
  workOrderProgress,
} from "@/lib/reports";
import SummaryCard from "@/components/reports/SummaryCard";
import { ChartCard, SimpleBarChart, SimpleLineChart } from "@/components/reports/charts";
import Badge from "@/components/Badge";
import ResponsiveTable from "@/components/reports/ResponsiveTable";

export default function MaintenanceReportTab({
  assets,
  workOrders,
  items,
}: {
  assets: Asset[];
  workOrders: MaintenanceWorkOrder[];
  items: MaintenanceWorkOrderItem[];
}) {
  const dueThisMonth = assets.filter((a) => {
    const next = toDateSafe(a.nextMaintenanceAt);
    if (!next) return false;
    const now = new Date();
    return next.getMonth() === now.getMonth() && next.getFullYear() === now.getFullYear();
  }).length;
  const overdueAssets = assets.filter(isMaintenanceOverdue).length;
  const inProgress = workOrders.filter((w) => w.status === "in_progress").length;
  const completed = workOrders.filter((w) => w.status === "completed").length;
  const cancelled = workOrders.filter((w) => w.status === "cancelled").length;

  const completedPerMonth = useMemo(() => {
    const buckets = new Map<string, number>();
    workOrders
      .filter((w) => w.status === "completed")
      .forEach((w) => {
        const d = toDateSafe(w.completedAt);
        if (!d) return;
        const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
        buckets.set(key, (buckets.get(key) || 0) + 1);
      });
    return Array.from(buckets.entries())
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .slice(-6)
      .map(([name, value]) => ({ name, value }));
  }, [workOrders]);

  const byTechnician = useMemo(() => {
    const counts = new Map<string, number>();
    workOrders.forEach((w) => {
      if (!w.assignedToName) return;
      counts.set(w.assignedToName, (counts.get(w.assignedToName) || 0) + 1);
    });
    return Array.from(counts.entries()).map(([name, value]) => ({ name, value }));
  }, [workOrders]);

  const byLocation = useMemo(() => {
    const counts = new Map<string, number>();
    workOrders.forEach((w) => {
      const loc = w.locationText || "Tidak diketahui";
      counts.set(loc, (counts.get(loc) || 0) + 1);
    });
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, value]) => ({ name, value }));
  }, [workOrders]);

  const rows = workOrders.map((w) => {
    const woItems = items.filter((i) => i.workOrderId === w.id);
    const progress = workOrderProgress(woItems);
    const overdue = isWorkOrderOverdueRecord(w);
    return { w, progress, overdue };
  });

  const handleExport = () => {
    exportToExcel(
      `QHSE-Care-Maintenance-Report-${todayStamp()}.xlsx`,
      "Maintenance",
      rows.map((r) => ({
        "Nomor WO": r.w.workOrderNumber,
        Judul: r.w.title,
        "Jumlah Asset": r.w.assetIds?.length || 0,
        Lokasi: r.w.locationText,
        Technician: r.w.assignedToName,
        Jadwal: formatDate(r.w.scheduledDate),
        Status: r.overdue ? "Terlambat" : WORK_ORDER_STATUS_LABEL[r.w.status],
        Progress: `${r.progress.checked}/${r.progress.total} (${r.progress.percent}%)`,
        "Completed At": r.w.completedAt ? formatDate(r.w.completedAt) : "",
      }))
    );
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <SummaryCard label="Total Work Order" value={workOrders.length} />
        <SummaryCard label="Due Bulan Ini" value={dueThisMonth} color="bg-amber-50 text-amber-600" />
        <SummaryCard label="Overdue" value={overdueAssets} color="bg-red-50 text-red-600" />
        <SummaryCard label="In Progress" value={inProgress} color="bg-purple-50 text-purple-600" />
        <SummaryCard label="Completed" value={completed} color="bg-emerald-50 text-emerald-600" />
        <SummaryCard label="Cancelled" value={cancelled} color="bg-slate-100 text-slate-600" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard title="Maintenance Completed per Bulan">
          <SimpleLineChart data={completedPerMonth} />
        </ChartCard>
        <ChartCard title="Maintenance by Technician">
          <SimpleBarChart data={byTechnician} horizontal />
        </ChartCard>
        <ChartCard title="Maintenance by Lokasi">
          <SimpleBarChart data={byLocation} horizontal />
        </ChartCard>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleExport}
          className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium cursor-pointer hover:bg-slate-50"
        >
          Export Maintenance Report
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <ResponsiveTable
          rows={rows.slice(0, 50)}
          keyFn={(r) => r.w.id}
          columns={[
            { label: "Nomor WO", primary: true, render: (r) => r.w.workOrderNumber },
            { label: "Jumlah Asset", render: (r) => r.w.assetIds?.length || 0 },
            { label: "Lokasi", render: (r) => r.w.locationText || "-" },
            { label: "Technician", render: (r) => r.w.assignedToName || "-" },
            { label: "Jadwal", render: (r) => formatDate(r.w.scheduledDate) },
            {
              label: "Status",
              render: (r) => (
                <Badge
                  label={r.overdue ? "Terlambat" : WORK_ORDER_STATUS_LABEL[r.w.status]}
                  colorClass={
                    r.overdue ? "bg-red-50 text-red-700 border-red-200" : "bg-slate-100 text-slate-600 border-slate-200"
                  }
                />
              ),
            },
            {
              label: "Progress",
              render: (r) => `${r.progress.checked}/${r.progress.total} (${r.progress.percent}%)`,
            },
          ]}
        />
      </div>
    </div>
  );
}
