"use client";

import { useMemo } from "react";
import { AssetIssueTicket } from "@/lib/types";
import {
  ISSUE_PRIORITY_LABEL,
  ISSUE_STATUS_LABEL,
  formatDateTime,
} from "@/lib/utils";
import { exportToExcel, resolutionTimeLabel, todayStamp, toDateSafe } from "@/lib/reports";
import SummaryCard from "@/components/reports/SummaryCard";
import { ChartCard, SimpleBarChart, SimpleLineChart } from "@/components/reports/charts";
import ResponsiveTable from "@/components/reports/ResponsiveTable";

export default function TicketReportTab({ tickets }: { tickets: AssetIssueTicket[] }) {
  const total = tickets.length;
  const open = tickets.filter((t) => t.status === "reported").length;
  const checking = tickets.filter((t) => t.status === "in_progress").length;
  const followUp = tickets.filter((t) => t.status === "needs_follow_up").length;
  const done = tickets.filter((t) => t.status === "completed").length;

  const avgResolutionHours = useMemo(() => {
    const resolved = tickets.filter((t) => t.resolvedAt && t.reportedAt);
    if (resolved.length === 0) return 0;
    const totalHours = resolved.reduce((sum, t) => {
      const from = toDateSafe(t.reportedAt);
      const to = toDateSafe(t.resolvedAt);
      if (!from || !to) return sum;
      return sum + (to.getTime() - from.getTime()) / 3600000;
    }, 0);
    return Math.round(totalHours / resolved.length);
  }, [tickets]);

  const perMonth = useMemo(() => {
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

  const byStatus = Object.entries(ISSUE_STATUS_LABEL).map(([key, label]) => ({
    name: label,
    value: tickets.filter((t) => t.status === key).length,
  })).filter((d) => d.value > 0);

  const byPriority = Object.entries(ISSUE_PRIORITY_LABEL).map(([key, label]) => ({
    name: label,
    value: tickets.filter((t) => t.priority === key).length,
  }));

  const bySymptom = useMemo(() => {
    const counts = new Map<string, number>();
    tickets.forEach((t) => counts.set(t.symptomType, (counts.get(t.symptomType) || 0) + 1));
    return Array.from(counts.entries()).map(([name, value]) => ({ name, value }));
  }, [tickets]);

  const topAssets = useMemo(() => {
    const counts = new Map<string, number>();
    tickets.forEach((t) => {
      const name = t.assetName || "Tanpa asset";
      counts.set(name, (counts.get(name) || 0) + 1);
    });
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, value]) => ({ name, value }));
  }, [tickets]);

  const topReporters = useMemo(() => {
    const counts = new Map<string, number>();
    tickets.forEach((t) => counts.set(t.reportedByName, (counts.get(t.reportedByName) || 0) + 1));
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, value]) => ({ name, value }));
  }, [tickets]);

  const topLocations = useMemo(() => {
    const counts = new Map<string, number>();
    tickets.forEach((t) => {
      const loc = t.assetLocation || "Tidak diketahui";
      counts.set(loc, (counts.get(loc) || 0) + 1);
    });
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, value]) => ({ name, value }));
  }, [tickets]);

  const handleExport = () => {
    exportToExcel(
      `AssetView-Ticket-Report-${todayStamp()}.xlsx`,
      "Tickets",
      tickets.map((t) => ({
        "Nomor Ticket": t.ticketNumber,
        Asset: t.assetName,
        Lokasi: t.assetLocation,
        Pelapor: t.reportedByName,
        Gejala: t.symptomType,
        Priority: ISSUE_PRIORITY_LABEL[t.priority],
        Status: ISSUE_STATUS_LABEL[t.status],
        "Assigned To": t.assignedToName || "",
        "Created At": formatDateTime(t.reportedAt),
        "Resolved At": t.resolvedAt ? formatDateTime(t.resolvedAt) : "",
        "Resolution Time": resolutionTimeLabel(t),
      }))
    );
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
        <SummaryCard label="Total Ticket" value={total} />
        <SummaryCard label="Open" value={open} color="bg-blue-50 text-blue-600" />
        <SummaryCard label="Sedang Dicek" value={checking} color="bg-indigo-50 text-indigo-600" />
        <SummaryCard label="Butuh Tindakan Lanjutan" value={followUp} color="bg-red-50 text-red-600" />
        <SummaryCard label="Selesai" value={done} color="bg-emerald-50 text-emerald-600" />
        <SummaryCard label="Rata-rata Selesai (jam)" value={avgResolutionHours} color="bg-slate-100 text-slate-600" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard title="Ticket per Bulan">
          <SimpleLineChart data={perMonth} />
        </ChartCard>
        <ChartCard title="Ticket by Status">
          <SimpleBarChart data={byStatus} />
        </ChartCard>
        <ChartCard title="Ticket by Priority">
          <SimpleBarChart data={byPriority} />
        </ChartCard>
        <ChartCard title="Ticket by Gejala">
          <SimpleBarChart data={bySymptom} horizontal />
        </ChartCard>
        <ChartCard title="Top 10 Asset Paling Sering Dilaporkan">
          <SimpleBarChart data={topAssets} horizontal />
        </ChartCard>
        <ChartCard title="Top 10 Pelapor Terbanyak">
          <SimpleBarChart data={topReporters} horizontal />
        </ChartCard>
        <ChartCard title="Top 10 Lokasi dengan Kendala Terbanyak">
          <SimpleBarChart data={topLocations} horizontal />
        </ChartCard>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleExport}
          className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium cursor-pointer hover:bg-slate-50"
        >
          Export Ticket Report
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <ResponsiveTable
          rows={tickets.slice(0, 50)}
          keyFn={(t) => t.id}
          columns={[
            { label: "Nomor Ticket", primary: true, render: (t) => t.ticketNumber },
            { label: "Asset", render: (t) => t.assetName },
            { label: "Pelapor", render: (t) => t.reportedByName },
            { label: "Gejala", render: (t) => t.symptomType },
            { label: "Priority", render: (t) => ISSUE_PRIORITY_LABEL[t.priority] },
            { label: "Status", render: (t) => ISSUE_STATUS_LABEL[t.status] },
            { label: "Created At", render: (t) => formatDateTime(t.reportedAt) },
            { label: "Resolution Time", render: (t) => resolutionTimeLabel(t) },
          ]}
        />
      </div>
    </div>
  );
}
