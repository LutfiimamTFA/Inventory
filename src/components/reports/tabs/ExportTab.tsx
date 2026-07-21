"use client";

import { FileDown } from "lucide-react";
import {
  Asset,
  AssetBorrowing,
  AssetIssueTicket,
  MaintenanceWorkOrder,
  MaintenanceWorkOrderItem,
} from "@/lib/types";
import {
  ASSET_STATUS_LABEL,
  BORROWING_STATUS_LABEL,
  CONDITION_LABEL,
  ISSUE_PRIORITY_LABEL,
  ISSUE_STATUS_LABEL,
  WORK_ORDER_STATUS_LABEL,
  formatDate,
  formatDateTime,
} from "@/lib/utils";
import {
  computeHealthScore,
  exportToExcel,
  healthScoreLabel,
  isBorrowingOverdue,
  isMaintenanceOverdue,
  isWorkOrderOverdueRecord,
  resolutionTimeLabel,
  todayStamp,
  workOrderProgress,
} from "@/lib/reports";

interface ExportTabProps {
  assets: Asset[];
  tickets: AssetIssueTicket[];
  workOrders: MaintenanceWorkOrder[];
  items: MaintenanceWorkOrderItem[];
  borrowings: AssetBorrowing[];
}

export default function ExportTab({ assets, tickets, workOrders, items, borrowings }: ExportTabProps) {
  const exportAssetHealth = () => {
    exportToExcel(
      `AssetView-Asset-Health-Report-${todayStamp()}.xlsx`,
      "Asset Health",
      assets.map((asset) => {
        const assetTickets = tickets.filter((t) => t.assetId === asset.id);
        const unresolved = assetTickets.filter(
          (t) => !["completed", "cancelled", "rejected", "duplicate"].includes(t.status)
        ).length;
        const score = computeHealthScore({
          asset,
          unresolvedTicketCount: unresolved,
          resolvedLast30dCount: 0,
          hasOverdueMaintenance: isMaintenanceOverdue(asset),
        });
        return {
          Asset: asset.assetName,
          "Kode Asset": asset.assetCode,
          Kategori: asset.categoryName,
          "Kondisi Saat Ini": CONDITION_LABEL[asset.condition],
          "Status Asset": ASSET_STATUS_LABEL[asset.assetStatus],
          "Jumlah Ticket": assetTickets.length,
          "Health Score": score,
          Label: healthScoreLabel(score),
        };
      })
    );
  };

  const exportTickets = () => {
    exportToExcel(
      `AssetView-Ticket-Report-${todayStamp()}.xlsx`,
      "Tickets",
      tickets.map((t) => ({
        "Nomor Ticket": t.ticketNumber,
        Asset: t.assetName,
        Pelapor: t.reportedByName,
        Gejala: t.symptomType,
        Priority: ISSUE_PRIORITY_LABEL[t.priority],
        Status: ISSUE_STATUS_LABEL[t.status],
        "Created At": formatDateTime(t.reportedAt),
        "Resolution Time": resolutionTimeLabel(t),
      }))
    );
  };

  const exportMaintenance = () => {
    exportToExcel(
      `AssetView-Maintenance-Report-${todayStamp()}.xlsx`,
      "Maintenance",
      workOrders.map((w) => {
        const progress = workOrderProgress(items.filter((i) => i.workOrderId === w.id));
        return {
          "Nomor WO": w.workOrderNumber,
          Judul: w.title,
          Lokasi: w.locationText,
          Technician: w.assignedToName,
          Jadwal: formatDate(w.scheduledDate),
          Status: isWorkOrderOverdueRecord(w) ? "Terlambat" : WORK_ORDER_STATUS_LABEL[w.status],
          Progress: `${progress.checked}/${progress.total} (${progress.percent}%)`,
        };
      })
    );
  };

  const exportBorrowings = () => {
    exportToExcel(
      `AssetView-Borrowing-Report-${todayStamp()}.xlsx`,
      "Borrowings",
      borrowings.map((b) => ({
        Asset: b.assetName,
        Peminjam: b.borrowedByName,
        "Borrowed At": formatDate(b.borrowedAt),
        "Returned At": b.returnedAt ? formatDate(b.returnedAt) : "",
        Status: BORROWING_STATUS_LABEL[b.status],
        Terlambat: isBorrowingOverdue(b) ? "Ya" : "Tidak",
      }))
    );
  };

  const exportLocations = () => {
    const byLocation = new Map<string, Asset[]>();
    assets.forEach((a) => {
      const key =
        [a.buildingName, a.floor, a.roomName].filter(Boolean).join(" - ") || a.location || "Tidak diketahui";
      if (!byLocation.has(key)) byLocation.set(key, []);
      byLocation.get(key)!.push(a);
    });
    exportToExcel(
      `AssetView-Location-Report-${todayStamp()}.xlsx`,
      "Locations",
      Array.from(byLocation.entries()).map(([location, locAssets]) => ({
        Lokasi: location,
        "Total Asset": locAssets.length,
        "Asset Rusak": locAssets.filter((a) => a.assetStatus === "broken").length,
        "Maintenance Overdue": locAssets.filter(isMaintenanceOverdue).length,
      }))
    );
  };

  const exportCost = () => {
    exportToExcel(
      `AssetView-Cost-Report-${todayStamp()}.xlsx`,
      "Cost",
      assets.map((a) => ({
        Asset: a.assetName,
        "Kode Asset": a.assetCode,
        Kategori: a.categoryName,
        "Nilai Beli": a.purchasePrice || 0,
      }))
    );
  };

  const buttons = [
    { label: "Export Asset Health Report", onClick: exportAssetHealth },
    { label: "Export Ticket Report", onClick: exportTickets },
    { label: "Export Maintenance Report", onClick: exportMaintenance },
    { label: "Export Borrowing Report", onClick: exportBorrowings },
    { label: "Export Location Report", onClick: exportLocations },
    { label: "Export Cost Report", onClick: exportCost },
  ];

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6">
      <h3 className="text-sm font-semibold text-slate-800 mb-1">Export Laporan</h3>
      <p className="text-sm text-slate-500 mb-5">
        Export mengikuti filter global yang sedang aktif. Format file: Excel (.xlsx).
      </p>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {buttons.map((b) => (
          <button
            key={b.label}
            type="button"
            onClick={b.onClick}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium cursor-pointer hover:bg-slate-50"
          >
            <FileDown size={15} />
            {b.label}
          </button>
        ))}
      </div>
    </div>
  );
}
