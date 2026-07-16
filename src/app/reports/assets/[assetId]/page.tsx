"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { collection, doc, onSnapshot, query, where } from "firebase/firestore";
import { ArrowLeft, FileDown } from "lucide-react";
import { db } from "@/lib/firebase";
import {
  Asset,
  AssetBorrowing,
  AssetIssueTicket,
  MaintenanceWorkOrder,
} from "@/lib/types";
import {
  ASSET_STATUS_LABEL,
  BORROWING_STATUS_LABEL,
  CONDITION_LABEL,
  ISSUE_STATUS_LABEL,
  formatCurrency,
  formatDate,
  formatDateTime,
} from "@/lib/utils";
import {
  computeHealthScore,
  exportToExcel,
  healthScoreLabel,
  HEALTH_LABEL_COLOR,
  isMaintenanceOverdue,
  resolutionTimeLabel,
  todayStamp,
} from "@/lib/reports";
import ProtectedLayout from "@/components/ProtectedLayout";
import Badge from "@/components/Badge";
import EmptyState from "@/components/EmptyState";

export default function AssetFullReportPage() {
  const { assetId } = useParams<{ assetId: string }>();
  const router = useRouter();
  const [asset, setAsset] = useState<Asset | null>(null);
  const [tickets, setTickets] = useState<AssetIssueTicket[]>([]);
  const [workOrders, setWorkOrders] = useState<MaintenanceWorkOrder[]>([]);
  const [borrowings, setBorrowings] = useState<AssetBorrowing[]>([]);

  useEffect(() => {
    const unsub = onSnapshot(doc(db, "assets", assetId), (snap) => {
      setAsset(snap.exists() ? ({ id: snap.id, ...snap.data() } as Asset) : null);
    });
    return () => unsub();
  }, [assetId]);

  useEffect(() => {
    const q = query(collection(db, "asset_issue_tickets"), where("assetId", "==", assetId));
    const unsub = onSnapshot(q, (snap) => {
      setTickets(snap.docs.map((d) => ({ id: d.id, ...d.data() } as AssetIssueTicket)));
    });
    return () => unsub();
  }, [assetId]);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "asset_maintenance_work_orders"), (snap) => {
      const all = snap.docs.map((d) => ({ id: d.id, ...d.data() } as MaintenanceWorkOrder));
      setWorkOrders(all.filter((w) => w.assetIds?.includes(assetId)));
    });
    return () => unsub();
  }, [assetId]);

  useEffect(() => {
    const q = query(collection(db, "asset_borrowings"), where("assetId", "==", assetId));
    const unsub = onSnapshot(q, (snap) => {
      setBorrowings(snap.docs.map((d) => ({ id: d.id, ...d.data() } as AssetBorrowing)));
    });
    return () => unsub();
  }, [assetId]);

  if (!asset) {
    return (
      <ProtectedLayout>
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 rounded-full border-2 border-slate-200 border-t-slate-900 animate-spin" />
        </div>
      </ProtectedLayout>
    );
  }

  const unresolvedTicketCount = tickets.filter(
    (t) => !["resolved", "closed", "rejected"].includes(t.status)
  ).length;
  const maintenanceOverdue = isMaintenanceOverdue(asset);
  const score = computeHealthScore({
    asset,
    unresolvedTicketCount,
    resolvedLast30dCount: 0,
    hasOverdueMaintenance: maintenanceOverdue,
  });
  const label = healthScoreLabel(score);

  const handleExport = () => {
    exportToExcel(
      `AssetView-Asset-Report-${asset.assetCode}-${todayStamp()}.xlsx`,
      "Asset Report",
      [
        {
          Asset: asset.assetName,
          "Kode Asset": asset.assetCode,
          Kategori: asset.categoryName,
          "Health Score": score,
          Label: label,
          "Total Ticket": tickets.length,
          "Total Maintenance": workOrders.length,
          "Total Peminjaman": borrowings.length,
          "Total Nilai Beli": asset.purchasePrice || 0,
          "Last Maintenance": formatDate(asset.lastMaintenanceAt),
          "Next Maintenance": formatDate(asset.nextMaintenanceAt),
        },
      ]
    );
  };

  return (
    <ProtectedLayout>
      <button
        onClick={() => router.push("/reports")}
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 mb-3"
      >
        <ArrowLeft size={15} />
        Kembali ke Reports
      </button>

      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">{asset.assetName}</h1>
          <p className="text-sm text-slate-500 mt-0.5">{asset.assetCode}</p>
        </div>
        <button
          onClick={handleExport}
          className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium hover:bg-slate-50"
        >
          <FileDown size={15} />
          Export Asset Report
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
          <p className="text-2xl font-semibold text-slate-900">{score}</p>
          <Badge label={label} colorClass={HEALTH_LABEL_COLOR[label]} />
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
          <p className="text-2xl font-semibold text-slate-900">{tickets.length}</p>
          <p className="text-xs text-slate-500">Total Ticket ({unresolvedTicketCount} belum selesai)</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
          <p className="text-2xl font-semibold text-slate-900">{workOrders.length}</p>
          <p className="text-xs text-slate-500">Total Maintenance</p>
        </div>
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
          <p className="text-2xl font-semibold text-slate-900">{borrowings.length}</p>
          <p className="text-xs text-slate-500">Total Peminjaman</p>
        </div>
      </div>

      <div className="grid md:grid-cols-2 gap-4 mb-6">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
          <h2 className="font-semibold text-slate-800 mb-3">Informasi Asset</h2>
          <div className="grid grid-cols-2 gap-y-2 text-sm">
            <Info label="Kategori" value={asset.categoryName} />
            <Info label="Kondisi" value={CONDITION_LABEL[asset.condition]} />
            <Info label="Status" value={ASSET_STATUS_LABEL[asset.assetStatus]} />
            <Info
              label="Lokasi"
              value={[asset.buildingName, asset.floor, asset.roomName].filter(Boolean).join(" - ") || asset.location}
            />
            <Info label="Total Nilai Beli" value={formatCurrency(asset.purchasePrice)} />
            <Info label="Last Maintenance" value={formatDate(asset.lastMaintenanceAt)} />
            <Info label="Next Maintenance" value={formatDate(asset.nextMaintenanceAt)} />
            <Info label="Maintenance Overdue" value={maintenanceOverdue ? "Ya" : "Tidak"} />
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
          <h2 className="font-semibold text-slate-800 mb-3">Rekomendasi</h2>
          {label === "Prioritas Ganti" || label === "Perlu Maintenance" ? (
            <p className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
              {label === "Prioritas Ganti"
                ? "Pertimbangkan penggantian asset — health score rendah dengan riwayat ticket berulang."
                : "Segera jadwalkan maintenance untuk mencegah kerusakan lebih lanjut."}
            </p>
          ) : (
            <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
              Kondisi asset terpantau baik, tidak ada tindakan mendesak.
            </p>
          )}
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden mb-6">
        <h2 className="font-semibold text-slate-800 px-5 pt-5 mb-3">Riwayat Ticket Kendala</h2>
        {tickets.length === 0 ? (
          <EmptyState title="Belum ada ticket untuk asset ini" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-200 bg-slate-50/60">
                  <th className="px-4 py-3 font-semibold">Nomor Ticket</th>
                  <th className="px-4 py-3 font-semibold">Gejala</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Dilaporkan</th>
                  <th className="px-4 py-3 font-semibold">Resolution Time</th>
                </tr>
              </thead>
              <tbody>
                {tickets.map((t) => (
                  <tr key={t.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-3 font-medium text-slate-800">{t.ticketNumber}</td>
                    <td className="px-4 py-3 text-slate-600">{t.symptomType}</td>
                    <td className="px-4 py-3 text-slate-600">{ISSUE_STATUS_LABEL[t.status]}</td>
                    <td className="px-4 py-3 text-slate-500">{formatDateTime(t.reportedAt)}</td>
                    <td className="px-4 py-3 text-slate-500">{resolutionTimeLabel(t)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <h2 className="font-semibold text-slate-800 px-5 pt-5 mb-3">Riwayat Peminjaman</h2>
        {borrowings.length === 0 ? (
          <EmptyState title="Belum ada riwayat peminjaman untuk asset ini" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-200 bg-slate-50/60">
                  <th className="px-4 py-3 font-semibold">Peminjam</th>
                  <th className="px-4 py-3 font-semibold">Borrowed At</th>
                  <th className="px-4 py-3 font-semibold">Returned At</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {borrowings.map((b) => (
                  <tr key={b.id} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-3 font-medium text-slate-800">{b.borrowedByName}</td>
                    <td className="px-4 py-3 text-slate-500">{formatDate(b.borrowedAt)}</td>
                    <td className="px-4 py-3 text-slate-500">{b.returnedAt ? formatDate(b.returnedAt) : "-"}</td>
                    <td className="px-4 py-3 text-slate-600">{BORROWING_STATUS_LABEL[b.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </ProtectedLayout>
  );
}

function Info({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <p className="text-xs text-slate-400 mb-0.5">{label}</p>
      <p className="text-slate-800 font-medium">{value || "-"}</p>
    </div>
  );
}
