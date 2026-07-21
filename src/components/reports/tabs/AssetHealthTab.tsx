"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Asset, AssetIssueTicket, MaintenanceWorkOrder } from "@/lib/types";
import { CONDITION_LABEL, ASSET_STATUS_LABEL, formatDate } from "@/lib/utils";
import {
  computeHealthScore,
  exportToExcel,
  healthScoreLabel,
  HEALTH_LABEL_COLOR,
  isMaintenanceOverdue,
  todayStamp,
  toDateSafe,
} from "@/lib/reports";
import Badge from "@/components/Badge";
import ResponsiveTable from "@/components/reports/ResponsiveTable";

const PAGE_SIZE = 25;

export default function AssetHealthTab({
  assets,
  tickets,
  workOrders,
}: {
  assets: Asset[];
  tickets: AssetIssueTicket[];
  workOrders: MaintenanceWorkOrder[];
}) {
  const [page, setPage] = useState(0);

  const rows = useMemo(() => {
    return assets.map((asset) => {
      const assetTickets = tickets.filter((t) => t.assetId === asset.id);
      const unresolvedCount = assetTickets.filter(
        (t) => !["completed", "cancelled", "rejected", "duplicate"].includes(t.status)
      ).length;
      const resolvedLast30d = assetTickets.filter((t) => {
        if (t.status !== "completed") return false;
        const resolvedAt = toDateSafe(t.resolvedAt);
        if (!resolvedAt) return false;
        return Date.now() - resolvedAt.getTime() <= 30 * 86400000;
      }).length;
      const maintenanceOverdue = isMaintenanceOverdue(asset);
      const assetWorkOrders = workOrders.filter((w) => w.assetIds?.includes(asset.id));

      const score = computeHealthScore({
        asset,
        unresolvedTicketCount: unresolvedCount,
        resolvedLast30dCount: resolvedLast30d,
        hasOverdueMaintenance: maintenanceOverdue,
      });
      const label = healthScoreLabel(score);

      const recommendation =
        label === "Prioritas Ganti"
          ? "Pertimbangkan penggantian asset"
          : label === "Perlu Maintenance"
          ? "Segera jadwalkan maintenance"
          : label === "Perlu Dipantau"
          ? "Pantau kondisi secara berkala"
          : "Kondisi baik";

      return {
        asset,
        ticketCount: assetTickets.length,
        maintenanceCount: assetWorkOrders.length,
        score,
        label,
        recommendation,
      };
    }).sort((a, b) => a.score - b.score);
  }, [assets, tickets, workOrders]);

  const paged = rows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));

  const handleExport = () => {
    exportToExcel(
      `AssetView-Asset-Health-Report-${todayStamp()}.xlsx`,
      "Asset Health",
      rows.map((r) => ({
        Asset: r.asset.assetName,
        "Kode Asset": r.asset.assetCode,
        Kategori: r.asset.categoryName,
        Lokasi: [r.asset.buildingName, r.asset.floor, r.asset.roomName].filter(Boolean).join(" - ") || r.asset.location || "",
        "Kondisi Saat Ini": CONDITION_LABEL[r.asset.condition],
        "Status Asset": ASSET_STATUS_LABEL[r.asset.assetStatus],
        "Jumlah Ticket": r.ticketCount,
        "Jumlah Maintenance": r.maintenanceCount,
        "Terakhir Maintenance": formatDate(r.asset.lastMaintenanceAt),
        "Next Maintenance": formatDate(r.asset.nextMaintenanceAt),
        "Health Score": r.score,
        Rekomendasi: r.recommendation,
      }))
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleExport}
          className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium cursor-pointer hover:bg-slate-50"
        >
          Export Asset Health
        </button>
      </div>
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <ResponsiveTable
          rows={paged}
          keyFn={(r) => r.asset.id}
          columns={[
            {
              label: "Asset",
              primary: true,
              render: (r) => (
                <>
                  <Link href={`/reports/assets/${r.asset.id}`} className="font-medium text-blue-600 hover:underline">
                    {r.asset.assetName}
                  </Link>
                  <p className="text-xs text-slate-400">{r.asset.assetCode}</p>
                </>
              ),
            },
            { label: "Kategori", render: (r) => r.asset.categoryName },
            {
              label: "Lokasi",
              render: (r) =>
                [r.asset.buildingName, r.asset.floor, r.asset.roomName].filter(Boolean).join(" - ") ||
                r.asset.location ||
                "-",
            },
            { label: "Kondisi", render: (r) => CONDITION_LABEL[r.asset.condition] },
            { label: "Status", render: (r) => ASSET_STATUS_LABEL[r.asset.assetStatus] },
            { label: "Ticket", render: (r) => r.ticketCount },
            { label: "Maintenance", render: (r) => r.maintenanceCount },
            { label: "Next Maintenance", render: (r) => formatDate(r.asset.nextMaintenanceAt) },
            { label: "Health Score", render: (r) => r.score },
            {
              label: "Rekomendasi",
              render: (r) => <Badge label={r.label} colorClass={HEALTH_LABEL_COLOR[r.label]} />,
            },
          ]}
        />
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 text-sm">
            <span className="text-slate-500">
              Halaman {page + 1} dari {totalPages}
            </span>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPage((p) => Math.max(0, p - 1))}
                disabled={page === 0}
                className="rounded-lg border border-slate-200 px-3 py-1.5 cursor-pointer hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Sebelumnya
              </button>
              <button
                type="button"
                onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                disabled={page === totalPages - 1}
                className="rounded-lg border border-slate-200 px-3 py-1.5 cursor-pointer hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Berikutnya
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
