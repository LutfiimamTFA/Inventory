"use client";

import { useMemo } from "react";
import { Asset, AssetIssueTicket, MaintenanceWorkOrder } from "@/lib/types";
import { exportToExcel, healthScoreLabel, HEALTH_LABEL_COLOR, isMaintenanceOverdue, computeHealthScore, todayStamp } from "@/lib/reports";
import { ChartCard, SimpleBarChart } from "@/components/reports/charts";
import Badge from "@/components/Badge";

export default function LocationReportTab({
  assets,
  tickets,
  workOrders,
}: {
  assets: Asset[];
  tickets: AssetIssueTicket[];
  workOrders: MaintenanceWorkOrder[];
}) {
  const rows = useMemo(() => {
    const byLocation = new Map<string, Asset[]>();
    assets.forEach((a) => {
      const key = [a.buildingName, a.floor, a.roomName].filter(Boolean).join(" - ") || a.location || "Tidak diketahui";
      if (!byLocation.has(key)) byLocation.set(key, []);
      byLocation.get(key)!.push(a);
    });

    return Array.from(byLocation.entries()).map(([location, locAssets]) => {
      const assetIds = new Set(locAssets.map((a) => a.id));
      const locTickets = tickets.filter((t) => assetIds.has(t.assetId));
      const locWorkOrders = workOrders.filter((w) => w.assetIds?.some((id) => assetIds.has(id)));
      const brokenCount = locAssets.filter((a) => a.assetStatus === "broken").length;
      const overdueCount = locAssets.filter(isMaintenanceOverdue).length;
      const activeWO = locWorkOrders.filter((w) =>
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
      ).length;

      const scores = locAssets.map((a) => {
        const assetTickets = locTickets.filter((t) => t.assetId === a.id);
        const unresolved = assetTickets.filter(
          (t) => !["resolved", "closed", "rejected"].includes(t.status)
        ).length;
        return computeHealthScore({
          asset: a,
          unresolvedTicketCount: unresolved,
          resolvedLast30dCount: 0,
          hasOverdueMaintenance: isMaintenanceOverdue(a),
        });
      });
      const avgScore = scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 100;
      const label = healthScoreLabel(avgScore);

      return {
        location,
        buildingName: locAssets[0]?.buildingName || "",
        floor: locAssets[0]?.floor || "",
        roomName: locAssets[0]?.roomName || "",
        totalAssets: locAssets.length,
        brokenCount,
        ticketCount: locTickets.length,
        overdueCount,
        activeWO,
        avgScore,
        label,
        recommendation:
          label === "Prioritas Ganti" || label === "Perlu Maintenance"
            ? "Prioritaskan inspeksi & maintenance di lokasi ini"
            : "Kondisi lokasi terpantau baik",
      };
    }).sort((a, b) => b.ticketCount - a.ticketCount);
  }, [assets, tickets, workOrders]);

  const ticketByBuilding = useMemo(() => {
    const counts = new Map<string, number>();
    rows.forEach((r) => counts.set(r.buildingName || "Tidak diketahui", (counts.get(r.buildingName || "Tidak diketahui") || 0) + r.ticketCount));
    return Array.from(counts.entries()).map(([name, value]) => ({ name, value }));
  }, [rows]);

  const handleExport = () => {
    exportToExcel(
      `AssetView-Location-Report-${todayStamp()}.xlsx`,
      "Locations",
      rows.map((r) => ({
        Gedung: r.buildingName,
        Lantai: r.floor,
        Ruangan: r.roomName,
        "Total Asset": r.totalAssets,
        "Asset Rusak": r.brokenCount,
        "Ticket Kendala": r.ticketCount,
        "Maintenance Overdue": r.overdueCount,
        "Work Order Aktif": r.activeWO,
        "Health Score Lokasi": r.avgScore,
        Rekomendasi: r.recommendation,
      }))
    );
  };

  return (
    <div className="space-y-5">
      <ChartCard title="Ticket by Gedung">
        <SimpleBarChart data={ticketByBuilding} horizontal />
      </ChartCard>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleExport}
          className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium cursor-pointer hover:bg-slate-50"
        >
          Export Location Report
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-200 bg-slate-50/60">
                <th className="px-4 py-3 font-semibold">Lokasi</th>
                <th className="px-4 py-3 font-semibold">Total Asset</th>
                <th className="px-4 py-3 font-semibold">Asset Rusak</th>
                <th className="px-4 py-3 font-semibold">Ticket Kendala</th>
                <th className="px-4 py-3 font-semibold">Maintenance Overdue</th>
                <th className="px-4 py-3 font-semibold">WO Aktif</th>
                <th className="px-4 py-3 font-semibold">Health Score</th>
                <th className="px-4 py-3 font-semibold">Rekomendasi</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.location} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/70">
                  <td className="px-4 py-3 font-medium text-slate-800">{r.location}</td>
                  <td className="px-4 py-3 text-slate-600">{r.totalAssets}</td>
                  <td className="px-4 py-3 text-slate-600">{r.brokenCount}</td>
                  <td className="px-4 py-3 text-slate-600">{r.ticketCount}</td>
                  <td className="px-4 py-3 text-slate-600">{r.overdueCount}</td>
                  <td className="px-4 py-3 text-slate-600">{r.activeWO}</td>
                  <td className="px-4 py-3 font-semibold text-slate-800">{r.avgScore}</td>
                  <td className="px-4 py-3">
                    <Badge label={r.label} colorClass={HEALTH_LABEL_COLOR[r.label]} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
