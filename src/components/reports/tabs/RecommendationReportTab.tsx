"use client";

import { useMemo } from "react";
import Link from "next/link";
import { Asset, AssetBorrowing, AssetIssueTicket } from "@/lib/types";
import { computeHealthScore, isMaintenanceOverdue } from "@/lib/reports";
import SummaryCard from "@/components/reports/SummaryCard";
import { ChartCard, SimpleBarChart, SimplePieChart } from "@/components/reports/charts";

// Section "Recommendation QHSE — visual, bukan tabel" — pengganti tabel
// panjang Asset/Kategori/Jumlah Ticket/Health Score/Rekomendasi yang
// dirasa double dengan menu Asset. Tab ini KHUSUS role yang tidak boleh
// lihat data finance (asset_admin/it_team — lihat canViewFinanceData di
// src/app/reports/page.tsx) — semua di sini murni dari
// kondisi/ticket/maintenance/lokasi, TIDAK ADA nominal Rupiah sama sekali.
// Role Finance/Super Admin tetap dapat CostReportTab yang lama (tabel +
// data cost, tidak diubah oleh file ini).

const HEALTH_TIERS = [
  { label: "Sangat Baik", min: 90, color: "#10b981" },
  { label: "Perlu Monitoring", min: 75, color: "#f59e0b" },
  { label: "Perlu Tindakan", min: 0, color: "#dc2626" },
] as const;

function getHealthTier(score: number) {
  return HEALTH_TIERS.find((t) => score >= t.min) || HEALTH_TIERS[HEALTH_TIERS.length - 1];
}

const DEGRADED_CONDITIONS = new Set(["fair", "minor_damage", "heavy_damage"]);
const RECOMMENDATION_ORDER = [
  "Perlu tindak lanjut kendala",
  "Perlu maintenance preventif",
  "Perlu pengecekan kondisi",
  "Perlu relokasi / penataan ulang",
  "Evaluasi pemanfaatan asset",
] as const;

const TOP_LIMIT = 7;
const TOP_ASSET_LIMIT = 10;

interface AssetInsight {
  asset: Asset;
  score: number;
  ticketCount: number;
  reasons: string[];
}

function getAssetAreaLabel(asset: Asset): string {
  const parts = [asset.buildingName, asset.floor, asset.roomName].filter(Boolean);
  if (parts.length > 0) return parts.join(" / ");
  return asset.locationText || asset.location || "Tidak Diketahui";
}

export default function RecommendationReportTab({
  assets,
  tickets,
  borrowings,
}: {
  assets: Asset[];
  tickets: AssetIssueTicket[];
  borrowings: AssetBorrowing[];
}) {
  const insights: AssetInsight[] = useMemo(
    () =>
      assets.map((asset) => {
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

        const reasons: string[] = [];
        if (unresolved > 0) reasons.push("Perlu tindak lanjut kendala");
        if (maintenanceOverdue) reasons.push("Perlu maintenance preventif");
        if (DEGRADED_CONDITIONS.has(asset.condition)) reasons.push("Perlu pengecekan kondisi");
        if (asset.operationalStatus === "needs_review") reasons.push("Perlu relokasi / penataan ulang");
        if (borrowingCount === 0 && score >= 80) reasons.push("Evaluasi pemanfaatan asset");

        return { asset, score, ticketCount: assetTickets.length, reasons };
      }),
    [assets, tickets, borrowings]
  );

  const needingAttention = useMemo(() => insights.filter((i) => i.reasons.length > 0), [insights]);

  // 1. Distribusi Health Score
  const healthDistribution = useMemo(() => {
    const counts = new Map<string, number>(HEALTH_TIERS.map((t) => [t.label, 0]));
    insights.forEach((i) => {
      const tier = getHealthTier(i.score);
      counts.set(tier.label, (counts.get(tier.label) || 0) + 1);
    });
    return HEALTH_TIERS.map((t) => ({ name: t.label, value: counts.get(t.label) || 0 }));
  }, [insights]);

  // 2. Top Kategori Paling Banyak Perlu Perhatian
  const topCategories = useMemo(() => {
    const counts = new Map<string, number>();
    needingAttention.forEach((i) => {
      const key = i.asset.categoryName || "Tanpa Kategori";
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_LIMIT)
      .map(([name, value]) => ({ name, value }));
  }, [needingAttention]);

  // 3. Ringkasan Rekomendasi
  const recommendationSummary = useMemo(() => {
    const counts = new Map<string, number>(RECOMMENDATION_ORDER.map((r) => [r, 0]));
    needingAttention.forEach((i) => {
      i.reasons.forEach((r) => counts.set(r, (counts.get(r) || 0) + 1));
    });
    return RECOMMENDATION_ORDER.map((name) => ({ name, value: counts.get(name) || 0 }));
  }, [needingAttention]);

  // 4. Top Problem Area
  const topAreas = useMemo(() => {
    const counts = new Map<string, number>();
    needingAttention.forEach((i) => {
      const key = getAssetAreaLabel(i.asset);
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, TOP_LIMIT)
      .map(([name, value]) => ({ name, value }));
  }, [needingAttention]);

  // 5. Top Asset Perlu Perhatian (compact list, BUKAN tabel)
  const topAssets = useMemo(
    () => [...needingAttention].sort((a, b) => a.score - b.score).slice(0, TOP_ASSET_LIMIT),
    [needingAttention]
  );

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard label="Total Asset" value={assets.length} />
        <SummaryCard label="Sangat Baik" value={healthDistribution[0]?.value || 0} color="bg-emerald-50 text-emerald-600" />
        <SummaryCard label="Perlu Monitoring" value={healthDistribution[1]?.value || 0} color="bg-amber-50 text-amber-600" />
        <SummaryCard label="Perlu Tindakan" value={healthDistribution[2]?.value || 0} color="bg-red-50 text-red-600" />
      </div>

      <div className="grid md:grid-cols-2 gap-4">
        <ChartCard title="Distribusi Health Score">
          <SimplePieChart data={healthDistribution} donut />
        </ChartCard>
        <ChartCard title="Top Kategori Paling Banyak Perlu Perhatian">
          <SimpleBarChart data={topCategories} horizontal showValueLabel />
        </ChartCard>
      </div>

      <ChartCard title="Ringkasan Rekomendasi">
        <SimpleBarChart data={recommendationSummary} horizontal showValueLabel />
      </ChartCard>

      <ChartCard title="Top Problem Area">
        <SimpleBarChart data={topAreas} horizontal showValueLabel />
      </ChartCard>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-800">
            Top {TOP_ASSET_LIMIT} Asset Perlu Perhatian
          </h3>
          <Link href="/assets" className="text-xs font-medium text-blue-600 hover:underline shrink-0">
            Lihat Detail Asset Terkait →
          </Link>
        </div>
        {topAssets.length === 0 ? (
          <p className="px-4 py-8 text-sm text-slate-400 text-center">
            Tidak ada asset yang perlu perhatian pada filter saat ini.
          </p>
        ) : (
          <div className="divide-y divide-slate-100">
            {topAssets.map((i) => (
              <div key={i.asset.id} className="flex items-start justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{i.asset.assetName}</p>
                  <p className="text-xs text-slate-400">
                    {i.asset.categoryName} · {i.asset.assetCode}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">{i.reasons.join(", ")}</p>
                </div>
                <div className="shrink-0 text-right">
                  <p className="text-sm font-bold text-slate-900">{i.score}</p>
                  <p className="text-[11px] text-slate-400">{i.ticketCount} ticket</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
