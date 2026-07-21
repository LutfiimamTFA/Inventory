"use client";

import { useMemo } from "react";
import {
  Asset,
  AssetIssueTicket,
  MaintenanceWorkOrder,
} from "@/lib/types";
import { ASSET_STATUS_LABEL, CONDITION_LABEL } from "@/lib/utils";
import { isMaintenanceOverdue, isWithinRange, toDateSafe } from "@/lib/reports";
import SummaryCard from "@/components/reports/SummaryCard";
import { ChartCard, SimpleBarChart, SimpleLineChart, SimplePieChart } from "@/components/reports/charts";

export default function OverviewTab({
  assets,
  tickets,
  workOrders,
  dateFrom,
  dateTo,
}: {
  assets: Asset[];
  tickets: AssetIssueTicket[];
  workOrders: MaintenanceWorkOrder[];
  dateFrom: Date;
  dateTo: Date;
}) {
  const ticketsThisRange = useMemo(
    () => tickets.filter((t) => isWithinRange(t.reportedAt, dateFrom, dateTo)),
    [tickets, dateFrom, dateTo]
  );

  const unresolvedTickets = tickets.filter(
    (t) => !["completed", "cancelled", "rejected", "duplicate"].includes(t.status)
  );

  const activeWorkOrders = workOrders.filter((w) =>
    [
      "scheduled",
      "created",
      "accepted",
      "scheduled_by_it",
      "assigned",
      "in_progress",
      "partially_completed",
      "report_submitted",
    ].includes(w.status)
  );
  const overdueMaintenanceAssets = assets.filter(isMaintenanceOverdue);
  const completedThisMonth = workOrders.filter((w) => {
    if (w.status !== "completed") return false;
    return isWithinRange(w.completedAt, dateFrom, dateTo);
  });

  const cards = [
    { label: "Total Asset", value: assets.length, color: "bg-blue-50 text-blue-600" },
    {
      label: "Asset Aktif",
      value: assets.filter((a) => a.assetStatus === "available" || a.assetStatus === "in_use").length,
      color: "bg-emerald-50 text-emerald-600",
    },
    {
      label: "Asset Dipinjam",
      value: assets.filter((a) => a.assetStatus === "borrowed").length,
      color: "bg-amber-50 text-amber-600",
    },
    {
      label: "Asset Maintenance",
      value: assets.filter((a) => a.assetStatus === "maintenance").length,
      color: "bg-purple-50 text-purple-600",
    },
    {
      label: "Asset Rusak",
      value: assets.filter((a) => a.assetStatus === "broken").length,
      color: "bg-red-50 text-red-600",
    },
    {
      label: "Ticket Kendala (Rentang Ini)",
      value: ticketsThisRange.length,
      color: "bg-blue-50 text-blue-600",
    },
    {
      label: "Ticket Belum Selesai",
      value: unresolvedTickets.length,
      color: "bg-orange-50 text-orange-600",
    },
    { label: "Work Order Aktif", value: activeWorkOrders.length, color: "bg-indigo-50 text-indigo-600" },
    {
      label: "Maintenance Overdue",
      value: overdueMaintenanceAssets.length,
      color: "bg-red-50 text-red-600",
    },
    {
      label: "Maintenance Selesai (Rentang Ini)",
      value: completedThisMonth.length,
      color: "bg-emerald-50 text-emerald-600",
    },
  ];

  const assetByStatus = Object.entries(ASSET_STATUS_LABEL).map(([key, label]) => ({
    name: label,
    value: assets.filter((a) => a.assetStatus === key).length,
  }));

  const assetByCondition = Object.entries(CONDITION_LABEL).map(([key, label]) => ({
    name: label,
    value: assets.filter((a) => a.condition === key).length,
  }));

  const ticketTrend = useMemo(() => {
    const buckets = new Map<string, number>();
    tickets.forEach((t) => {
      const d = toDateSafe(t.reportedAt);
      if (!d) return;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      buckets.set(key, (buckets.get(key) || 0) + 1);
    });
    return Array.from(buckets.entries())
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .slice(-6)
      .map(([name, value]) => ({ name, value }));
  }, [tickets]);

  const maintenanceCompletedVsOverdue = [
    { name: "Selesai", value: workOrders.filter((w) => w.status === "completed").length },
    { name: "Overdue", value: overdueMaintenanceAssets.length },
  ];

  const topCategories = useMemo(() => {
    const counts = new Map<string, number>();
    tickets.forEach((t) => {
      const cat = t.assetCategory || "Tidak diketahui";
      counts.set(cat, (counts.get(cat) || 0) + 1);
    });
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, value]) => ({ name, value }));
  }, [tickets]);

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {cards.map((c) => (
          <SummaryCard key={c.label} label={c.label} value={c.value} color={c.color} />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard title="Asset by Status">
          <SimplePieChart data={assetByStatus} />
        </ChartCard>
        <ChartCard title="Asset by Condition">
          <SimplePieChart data={assetByCondition} />
        </ChartCard>
        <ChartCard title="Ticket Trend per Bulan">
          <SimpleLineChart data={ticketTrend} />
        </ChartCard>
        <ChartCard title="Maintenance Completed vs Overdue">
          <SimpleBarChart data={maintenanceCompletedVsOverdue} />
        </ChartCard>
        <ChartCard title="Top 5 Kategori dengan Kendala Terbanyak">
          <SimpleBarChart data={topCategories} horizontal />
        </ChartCard>
      </div>
    </div>
  );
}
