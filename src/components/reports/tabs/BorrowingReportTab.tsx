"use client";

import { useMemo } from "react";
import { AssetBorrowing } from "@/lib/types";
import { BORROWING_STATUS_LABEL, formatDate } from "@/lib/utils";
import { exportToExcel, isBorrowingOverdue, todayStamp, toDateSafe } from "@/lib/reports";
import SummaryCard from "@/components/reports/SummaryCard";
import { ChartCard, SimpleBarChart, SimpleLineChart } from "@/components/reports/charts";
import Badge from "@/components/Badge";
import ResponsiveTable from "@/components/reports/ResponsiveTable";

export default function BorrowingReportTab({ borrowings }: { borrowings: AssetBorrowing[] }) {
  const total = borrowings.length;
  const borrowed = borrowings.filter((b) => b.status === "borrowed").length;
  const returned = borrowings.filter((b) => b.status === "returned").length;
  const overdue = borrowings.filter(isBorrowingOverdue).length;

  const topAsset = useMemo(() => {
    const counts = new Map<string, number>();
    borrowings.forEach((b) => counts.set(b.assetName, (counts.get(b.assetName) || 0) + 1));
    const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
    return sorted[0]?.[0] || "-";
  }, [borrowings]);

  const perMonth = useMemo(() => {
    const buckets = new Map<string, number>();
    borrowings.forEach((b) => {
      const d = toDateSafe(b.borrowedAt);
      if (!d) return;
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      buckets.set(key, (buckets.get(key) || 0) + 1);
    });
    return Array.from(buckets.entries())
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .slice(-6)
      .map(([name, value]) => ({ name, value }));
  }, [borrowings]);

  const topAssets = useMemo(() => {
    const counts = new Map<string, number>();
    borrowings.forEach((b) => counts.set(b.assetName, (counts.get(b.assetName) || 0) + 1));
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, value]) => ({ name, value }));
  }, [borrowings]);

  const byUser = useMemo(() => {
    const counts = new Map<string, number>();
    borrowings.forEach((b) => counts.set(b.borrowedByName, (counts.get(b.borrowedByName) || 0) + 1));
    return Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, value]) => ({ name, value }));
  }, [borrowings]);

  const handleExport = () => {
    exportToExcel(
      `QHSE-Care-Borrowing-Report-${todayStamp()}.xlsx`,
      "Borrowings",
      borrowings.map((b) => ({
        Asset: b.assetName,
        "Kode Asset": b.assetCode,
        Peminjam: b.borrowedByName,
        "Borrowed At": formatDate(b.borrowedAt),
        "Expected Return At": b.estimatedReturnAt || "",
        "Returned At": b.returnedAt ? formatDate(b.returnedAt) : "",
        Status: BORROWING_STATUS_LABEL[b.status],
        "Terlambat": isBorrowingOverdue(b) ? "Ya" : "Tidak",
      }))
    );
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <SummaryCard label="Total Peminjaman" value={total} />
        <SummaryCard label="Sedang Dipinjam" value={borrowed} color="bg-amber-50 text-amber-600" />
        <SummaryCard label="Sudah Dikembalikan" value={returned} color="bg-emerald-50 text-emerald-600" />
        <SummaryCard label="Terlambat Dikembalikan" value={overdue} color="bg-red-50 text-red-600" />
        <SummaryCard label="Paling Sering Dipinjam" value={topAsset} color="bg-blue-50 text-blue-600" />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard title="Borrowing Trend per Bulan">
          <SimpleLineChart data={perMonth} />
        </ChartCard>
        <ChartCard title="Top 10 Asset Paling Sering Dipinjam">
          <SimpleBarChart data={topAssets} horizontal />
        </ChartCard>
        <ChartCard title="Borrowing by User">
          <SimpleBarChart data={byUser} horizontal />
        </ChartCard>
      </div>

      <div className="flex justify-end">
        <button
          type="button"
          onClick={handleExport}
          className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium cursor-pointer hover:bg-slate-50"
        >
          Export Borrowing Report
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        <ResponsiveTable
          rows={borrowings.slice(0, 50)}
          keyFn={(b) => b.id}
          columns={[
            {
              label: "Asset",
              primary: true,
              render: (b) => (
                <>
                  <p className="font-medium text-slate-800">{b.assetName}</p>
                  <p className="text-xs text-slate-400">{b.assetCode}</p>
                </>
              ),
            },
            { label: "Peminjam", render: (b) => b.borrowedByName },
            { label: "Borrowed At", render: (b) => formatDate(b.borrowedAt) },
            { label: "Expected Return", render: (b) => b.estimatedReturnAt || "-" },
            { label: "Returned At", render: (b) => (b.returnedAt ? formatDate(b.returnedAt) : "-") },
            {
              label: "Status",
              render: (b) => (
                <Badge
                  label={isBorrowingOverdue(b) ? "Terlambat" : BORROWING_STATUS_LABEL[b.status]}
                  colorClass={
                    isBorrowingOverdue(b)
                      ? "bg-red-50 text-red-700 border-red-200"
                      : "bg-slate-100 text-slate-600 border-slate-200"
                  }
                />
              ),
            },
          ]}
        />
      </div>
    </div>
  );
}
