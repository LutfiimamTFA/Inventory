"use client";

import { useMemo } from "react";
import { Asset, AssetBorrowing, AssetIssueTicket } from "@/lib/types";
import { formatCurrency } from "@/lib/utils";
import {
  buildAssetRecommendations,
  computeHealthScore,
  exportToExcel,
  healthScoreLabel,
  isMaintenanceOverdue,
  todayStamp,
} from "@/lib/reports";
import SummaryCard from "@/components/reports/SummaryCard";
import { ChartCard, SimpleBarChart } from "@/components/reports/charts";
import ResponsiveTable from "@/components/reports/ResponsiveTable";

export default function CostReportTab({
  assets,
  tickets,
  borrowings,
}: {
  assets: Asset[];
  tickets: AssetIssueTicket[];
  borrowings: AssetBorrowing[];
}) {
  const totalAssetValue = assets.reduce((sum, a) => sum + (a.purchasePrice || 0), 0);
  const hasCostData = assets.some((a) => a.purchasePrice);

  const rows = useMemo(() => {
    const computed = assets.map((asset) => {
      const assetTickets = tickets.filter((t) => t.assetId === asset.id);
      const unresolved = assetTickets.filter(
        (t) => !["completed", "cancelled", "rejected", "duplicate"].includes(t.status)
      ).length;
      const maintenanceOverdue = isMaintenanceOverdue(asset);
      const score = computeHealthScore({
        asset,
        unresolvedTicketCount: unresolved,
        resolvedLast30dCount: 0,
        hasOverdueMaintenance: maintenanceOverdue,
      });
      const borrowingCount = borrowings.filter((b) => b.assetCode === asset.assetCode).length;
      const brokenRecurring = assetTickets.length >= 2 && asset.condition !== "new";

      const recommendations = buildAssetRecommendations({
        healthScore: score,
        ticketCount: assetTickets.length,
        maintenanceOverdue,
        maintenanceCost: 0,
        borrowingCount,
        brokenRecurring,
      });

      return {
        asset,
        ticketCount: assetTickets.length,
        score,
        label: healthScoreLabel(score),
        recommendations,
      };
    });
    computed.sort((a, b) => (b.asset.purchasePrice || 0) - (a.asset.purchasePrice || 0));
    return computed;
  }, [assets, tickets, borrowings]);

  const byCategoryValue = useMemo(() => {
    const totals = new Map<string, number>();
    assets.forEach((a) => {
      totals.set(a.categoryName, (totals.get(a.categoryName) || 0) + (a.purchasePrice || 0));
    });
    return Array.from(totals.entries())
      .filter(([, value]) => value > 0)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, value]) => ({ name, value }));
  }, [assets]);

  const handleExport = () => {
    exportToExcel(
      `QHSE-Care-Cost-Report-${todayStamp()}.xlsx`,
      "Cost",
      rows.map((r) => ({
        Asset: r.asset.assetName,
        "Kode Asset": r.asset.assetCode,
        Kategori: r.asset.categoryName,
        "Nilai Beli": r.asset.purchasePrice || 0,
        "Jumlah Ticket": r.ticketCount,
        "Health Score": r.score,
        Rekomendasi: r.recommendations.join("; ") || "-",
      }))
    );
  };

  return (
    <div className="space-y-5">
      {!hasCostData && (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5">
          Data biaya maintenance/ticket belum tersedia di sistem saat ini. Report ini memakai nilai
          beli (purchasePrice) asset sebagai satu-satunya data biaya yang ada.
        </p>
      )}

      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        <SummaryCard label="Total Nilai Asset" value={formatCurrency(totalAssetValue)} />
        <SummaryCard
          label="Asset dengan Nilai Tertinggi"
          value={rows[0]?.asset.assetName || "-"}
          color="bg-blue-50 text-blue-600"
        />
        <SummaryCard
          label="Asset Perlu Perhatian"
          value={rows.filter((r) => r.recommendations.length > 0).length}
          color="bg-red-50 text-red-600"
        />
      </div>

      <ChartCard title="Nilai Asset per Kategori (Top 10)">
        <SimpleBarChart data={byCategoryValue} horizontal />
      </ChartCard>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleExport}
          className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium cursor-pointer hover:bg-slate-50"
        >
          Export Cost Report
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <ResponsiveTable
          rows={rows.slice(0, 50)}
          keyFn={(r) => r.asset.id}
          columns={[
            {
              label: "Asset",
              primary: true,
              render: (r) => (
                <>
                  <p className="font-medium text-slate-800">{r.asset.assetName}</p>
                  <p className="text-xs text-slate-400">{r.asset.assetCode}</p>
                </>
              ),
            },
            { label: "Kategori", render: (r) => r.asset.categoryName },
            { label: "Nilai Beli", render: (r) => formatCurrency(r.asset.purchasePrice) },
            { label: "Jumlah Ticket", render: (r) => r.ticketCount },
            { label: "Health Score", render: (r) => r.score },
            {
              label: "Rekomendasi",
              render: (r) => (r.recommendations.length > 0 ? r.recommendations.join("; ") : "-"),
            },
          ]}
        />
      </div>
    </div>
  );
}
