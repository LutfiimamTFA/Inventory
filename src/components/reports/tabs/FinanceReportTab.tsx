"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { Asset } from "@/lib/types";
import { formatCompactCurrency, formatCurrency, toDisplayDate } from "@/lib/utils";
import { getAssetNumber, getAssetQuantity } from "@/lib/assets/inventory";
import { getAssetPrice, hasPrice, getFinanceStatus } from "@/lib/assetFinance";
import { getAssetInvoicePreviewUrl } from "@/lib/assets/asset-status";
import { exportMultiSheetExcel, todayStamp } from "@/lib/reports";
import SummaryCard from "@/components/reports/SummaryCard";
import { ChartCard, SimpleBarChart, SimplePieChart } from "@/components/reports/charts";
import ResponsiveTable from "@/components/reports/ResponsiveTable";

// Section "Rekap Laporan Finance" (rombak total) — dashboard ANALITIK
// keuangan aset, BUKAN tabel daftar aset lagi (itu sudah ada di menu
// Asset). Semua angka dihitung dari collection `assets` yang memang
// di-load untuk role ini (lihat src/app/reports/page.tsx) — sengaja TIDAK
// menerima props tickets/workOrders/items sama sekali karena Finance tidak
// diberi izin baca Maintenance/Ticket (firestore.rules tidak diubah).
// Filter (Perusahaan/Tahun Perolehan/Kategori) dikelola SENDIRI di sini
// (bukan filter global halaman Reports yang dipakai role lain) supaya tetap
// sederhana sesuai permintaan — lihat src/app/reports/page.tsx yang
// menyembunyikan ReportsFilterBar untuk role Finance.

const TOP_CATEGORY_LIMIT = 7;
const TOP_ASSET_LIMIT = 10;
const TOP_VENDOR_LIMIT = 5;
const NO_COMPANY_LABEL = "Tanpa Perusahaan";
const INSIGHT_LIST_LIMIT = 30;
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
const MONTH_FULL_LABELS = [
  "Januari",
  "Februari",
  "Maret",
  "April",
  "Mei",
  "Juni",
  "Juli",
  "Agustus",
  "September",
  "Oktober",
  "November",
  "Desember",
];

interface FinanceInsight {
  key: string;
  message: string;
  count: number;
  assets: Asset[];
}

function getAcquisitionYear(asset: Asset): number | null {
  const d = toDisplayDate(asset.acquisitionDate || asset.purchaseDate);
  return d ? d.getFullYear() : null;
}

function FinanceStatCard({
  label,
  value,
  sub,
}: {
  label: string;
  value: string | number;
  sub?: string;
}) {
  return (
    <div className="min-w-0 w-full max-w-full rounded-2xl border border-slate-200 bg-white p-3 shadow-sm md:p-4">
      <p className="text-xl font-bold text-slate-900 break-words">{value}</p>
      <p className="mt-1 text-[11px] font-medium text-slate-500 break-words">{label}</p>
      {sub && <p className="mt-1 text-[11px] text-amber-600 break-words">{sub}</p>}
    </div>
  );
}

export default function FinanceReportTab({ assets }: { assets: Asset[] }) {
  const [companyFilter, setCompanyFilter] = useState("");
  const [yearFilter, setYearFilter] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [yearMetric, setYearMetric] = useState<"value" | "count">("value");
  const [expandedInsight, setExpandedInsight] = useState<string | null>(null);

  const companyOptions = useMemo(
    () => Array.from(new Set(assets.map((a) => a.companyOwnerName).filter(Boolean))) as string[],
    [assets]
  );
  const categoryOptions = useMemo(
    () => Array.from(new Set(assets.map((a) => a.categoryName).filter(Boolean))) as string[],
    [assets]
  );
  const yearOptions = useMemo(() => {
    const years = new Set<number>();
    assets.forEach((a) => {
      const y = getAcquisitionYear(a);
      if (y) years.add(y);
    });
    return Array.from(years).sort((a, b) => b - a);
  }, [assets]);

  const filteredAssets = useMemo(
    () =>
      assets.filter((a) => {
        if (companyFilter && a.companyOwnerName !== companyFilter) return false;
        if (categoryFilter && a.categoryName !== categoryFilter) return false;
        if (yearFilter && String(getAcquisitionYear(a) ?? "") !== yearFilter) return false;
        return true;
      }),
    [assets, companyFilter, categoryFilter, yearFilter]
  );

  const hasActiveFilter = !!(companyFilter || categoryFilter || yearFilter);
  const resetFilters = () => {
    setCompanyFilter("");
    setCategoryFilter("");
    setYearFilter("");
  };

  // ── Bagian 1 — Executive Summary ──────────────────────────────────────
  const totalValue = useMemo(
    () => filteredAssets.reduce((sum, a) => sum + getAssetPrice(a), 0),
    [filteredAssets]
  );
  const totalUnits = useMemo(
    () => filteredAssets.reduce((sum, a) => sum + getAssetQuantity(a), 0),
    [filteredAssets]
  );
  const totalAssetCount = filteredAssets.length;
  const assetsWithPrice = useMemo(() => filteredAssets.filter(hasPrice).length, [filteredAssets]);
  const assetsWithoutPrice = totalAssetCount - assetsWithPrice;

  const invoiceBuckets = useMemo(() => {
    const buckets = { ada: 0, tidak_ada: 0, tidak_diketahui: 0, belum_diisi: 0 };
    filteredAssets.forEach((a) => {
      if (a.invoiceStatus === "ada") buckets.ada++;
      else if (a.invoiceStatus === "tidak_ada") buckets.tidak_ada++;
      else if (a.invoiceStatus === "tidak_diketahui") buckets.tidak_diketahui++;
      else buckets.belum_diisi++;
    });
    return buckets;
  }, [filteredAssets]);
  const invoicePercent =
    totalAssetCount > 0 ? Math.round((invoiceBuckets.ada / totalAssetCount) * 100) : 0;

  // ── Bagian 2 — Insight / Perlu Perhatian ──────────────────────────────
  const insights: FinanceInsight[] = useMemo(() => {
    const noPrice = filteredAssets.filter((a) => !hasPrice(a));
    const unknownInvoice = filteredAssets.filter((a) => a.invoiceStatus === "tidak_diketahui");
    const missingProof = filteredAssets.filter(
      (a) => a.invoiceStatus === "ada" && !getAssetInvoicePreviewUrl(a)
    );
    const noVendor = filteredAssets.filter((a) => !a.vendorName?.trim());
    const incompleteFinance = filteredAssets.filter((a) => getFinanceStatus(a) === "incomplete");
    return [
      {
        key: "no_price",
        message: "aset belum memiliki harga perolehan",
        count: noPrice.length,
        assets: noPrice,
      },
      {
        key: "unknown_invoice",
        message: "aset status invoice belum diketahui",
        count: unknownInvoice.length,
        assets: unknownInvoice,
      },
      {
        key: "missing_proof",
        message: 'aset memiliki status "Ada Invoice" tetapi bukti invoice belum tersedia',
        count: missingProof.length,
        assets: missingProof,
      },
      {
        key: "no_vendor",
        message: "aset belum memiliki vendor",
        count: noVendor.length,
        assets: noVendor,
      },
      {
        key: "incomplete",
        message: "aset memiliki data finance tidak lengkap",
        count: incompleteFinance.length,
        assets: incompleteFinance,
      },
    ].filter((i) => i.count > 0);
  }, [filteredAssets]);

  // ── Bagian 3 — Nilai per Perusahaan / Kategori ───────────────────────
  const valueByCompany = useMemo(() => {
    const totals = new Map<string, number>();
    filteredAssets.forEach((a) => {
      const key = a.companyOwnerName || NO_COMPANY_LABEL;
      totals.set(key, (totals.get(key) || 0) + getAssetPrice(a));
    });
    return Array.from(totals.entries())
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([name, value]) => ({ name, value }));
  }, [filteredAssets]);

  const valueByCategory = useMemo(() => {
    const totals = new Map<string, number>();
    filteredAssets.forEach((a) => {
      const key = a.categoryName || "Tanpa Kategori";
      totals.set(key, (totals.get(key) || 0) + getAssetPrice(a));
    });
    const sorted = Array.from(totals.entries())
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, TOP_CATEGORY_LIMIT);
    const rest = sorted.slice(TOP_CATEGORY_LIMIT);
    const restTotal = rest.reduce((sum, [, v]) => sum + v, 0);
    const result = top.map(([name, value]) => ({ name, value }));
    if (restTotal > 0) result.push({ name: "Lainnya", value: restTotal });
    return result;
  }, [filteredAssets]);

  // ── Bagian 4 — Tren Perolehan Aset ────────────────────────────────────
  // Prinsip: multi-year → breakdown per tahun, single-year → breakdown per
  // bulan (supaya chart tidak pernah cuma 1 titik kosong). "Single-year"
  // dipicu BUKAN cuma dari yearFilter eksplisit, tapi juga kalau hasil
  // filter kebetulan cuma mengandung 1 tahun data (mis. filter
  // Perusahaan+Kategori yang datanya semua dari tahun sama).
  const yearsInFilteredData = useMemo(() => {
    const set = new Set<number>();
    filteredAssets.forEach((a) => {
      const y = getAcquisitionYear(a);
      if (y) set.add(y);
    });
    return Array.from(set).sort((a, b) => a - b);
  }, [filteredAssets]);

  const trendYear = yearFilter
    ? Number(yearFilter)
    : yearsInFilteredData.length === 1
    ? yearsInFilteredData[0]
    : null;
  const isMonthlyTrend = trendYear !== null;

  interface TrendPoint {
    name: string;
    fullLabel: string;
    value: number;
    rawValue: number;
    rawCount: number;
  }

  const yearlyTrend: TrendPoint[] = useMemo(() => {
    const totals = new Map<number, { value: number; count: number }>();
    filteredAssets.forEach((a) => {
      const y = getAcquisitionYear(a);
      if (!y) return;
      const entry = totals.get(y) || { value: 0, count: 0 };
      entry.value += getAssetPrice(a);
      entry.count += 1;
      totals.set(y, entry);
    });
    return Array.from(totals.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([year, v]) => ({
        name: String(year),
        fullLabel: String(year),
        value: yearMetric === "value" ? v.value : v.count,
        rawValue: v.value,
        rawCount: v.count,
      }));
  }, [filteredAssets, yearMetric]);

  const monthlyTrend: TrendPoint[] = useMemo(() => {
    if (trendYear === null) return [];
    const buckets = Array.from({ length: 12 }, () => ({ value: 0, count: 0 }));
    filteredAssets.forEach((a) => {
      const d = toDisplayDate(a.acquisitionDate || a.purchaseDate);
      if (!d || d.getFullYear() !== trendYear) return;
      const bucket = buckets[d.getMonth()];
      bucket.value += getAssetPrice(a);
      bucket.count += 1;
    });
    return buckets.map((b, i) => ({
      name: MONTH_LABELS[i],
      fullLabel: `${MONTH_FULL_LABELS[i]} ${trendYear}`,
      value: yearMetric === "value" ? b.value : b.count,
      rawValue: b.value,
      rawCount: b.count,
    }));
  }, [filteredAssets, trendYear, yearMetric]);

  const trendData = isMonthlyTrend ? monthlyTrend : yearlyTrend;

  const trendTitle = isMonthlyTrend
    ? yearMetric === "value"
      ? `Nilai Perolehan Asset per Bulan — ${trendYear}`
      : `Jumlah Asset Diperoleh per Bulan — ${trendYear}`
    : yearMetric === "value"
    ? "Nilai Perolehan Asset per Tahun"
    : "Jumlah Asset Diperoleh per Tahun";

  const trendValueFormatter =
    yearMetric === "value" ? formatCompactCurrency : (v: number) => `${v} asset`;

  // Section "Jika Data Sangat Sedikit" — kalau di tampilan bulanan cuma ada
  // SATU bulan yang punya transaksi, highlight bar itu (bukan cuma
  // menampilkan satu titik polos di tengah layar) supaya tetap keliatan
  // sebagai insight, bukan chart kosong.
  const soleTransactionMonthIndex = useMemo(() => {
    if (!isMonthlyTrend) return -1;
    const monthsWithData = monthlyTrend.filter((m) => m.rawCount > 0);
    if (monthsWithData.length !== 1) return -1;
    return monthlyTrend.findIndex((m) => m.rawCount > 0);
  }, [isMonthlyTrend, monthlyTrend]);

  // ── Bagian 5 — Invoice Analytics ──────────────────────────────────────
  const invoiceDonutData = [
    { name: "Ada Invoice", value: invoiceBuckets.ada },
    { name: "Tidak Ada Invoice", value: invoiceBuckets.tidak_ada },
    { name: "Belum Diketahui", value: invoiceBuckets.tidak_diketahui },
    { name: "Belum Diisi", value: invoiceBuckets.belum_diisi },
  ];
  const documentCompleteness = useMemo(() => {
    let withProof = 0;
    let withoutProof = 0;
    filteredAssets.forEach((a) => {
      if (a.invoiceStatus !== "ada") return;
      if (getAssetInvoicePreviewUrl(a)) withProof++;
      else withoutProof++;
    });
    return [
      { label: "Ada Invoice + Bukti", value: withProof },
      { label: "Ada Invoice tanpa Bukti", value: withoutProof },
      { label: "Tidak Ada Invoice", value: invoiceBuckets.tidak_ada },
      { label: "Belum Diketahui", value: invoiceBuckets.tidak_diketahui },
    ];
  }, [filteredAssets, invoiceBuckets]);

  // ── Bagian 6 — Top Asset ───────────────────────────────────────────
  const topAssets = useMemo(
    () => [...filteredAssets].sort((a, b) => getAssetPrice(b) - getAssetPrice(a)).slice(0, TOP_ASSET_LIMIT),
    [filteredAssets]
  );

  // ── Bagian 7 — Top Vendor ──────────────────────────────────────────
  const topVendors = useMemo(() => {
    const totals = new Map<string, { value: number; count: number; units: number }>();
    filteredAssets.forEach((a) => {
      const vendor = a.vendorName?.trim();
      if (!vendor) return;
      const entry = totals.get(vendor) || { value: 0, count: 0, units: 0 };
      entry.value += getAssetPrice(a);
      entry.count += 1;
      entry.units += getAssetQuantity(a);
      totals.set(vendor, entry);
    });
    return Array.from(totals.entries())
      .sort((a, b) => b[1].value - a[1].value)
      .slice(0, TOP_VENDOR_LIMIT)
      .map(([name, v]) => ({ name, ...v }));
  }, [filteredAssets]);

  const handleExport = () => {
    exportMultiSheetExcel(`QHSE-Care-Rekap-Finance-${todayStamp()}.xlsx`, [
      {
        sheetName: "Ringkasan",
        rows: [
          { Metrik: "Total Nilai Aset", Nilai: totalValue },
          { Metrik: "Total Aset", Nilai: totalAssetCount },
          { Metrik: "Total Unit", Nilai: totalUnits },
          { Metrik: "Aset Dengan Harga Terisi", Nilai: `${assetsWithPrice}/${totalAssetCount}` },
          { Metrik: "Aset Belum Memiliki Harga", Nilai: assetsWithoutPrice },
          { Metrik: "Ada Invoice", Nilai: invoiceBuckets.ada },
          { Metrik: "Tidak Ada Invoice", Nilai: invoiceBuckets.tidak_ada },
          { Metrik: "Status Invoice Belum Diketahui", Nilai: invoiceBuckets.tidak_diketahui },
          { Metrik: "Status Invoice Belum Diisi", Nilai: invoiceBuckets.belum_diisi },
        ],
      },
      {
        sheetName: "Nilai per Perusahaan",
        rows: valueByCompany.map((c) => ({ Perusahaan: c.name, "Nilai Aset": c.value })),
      },
      {
        sheetName: "Nilai per Kategori",
        rows: valueByCategory.map((c) => ({ Kategori: c.name, "Nilai Aset": c.value })),
      },
      {
        sheetName: "Nilai per Tahun",
        rows: yearlyTrend.map((y) => ({
          "Tahun Perolehan": y.name,
          "Nilai Aset": y.rawValue,
          "Jumlah Asset": y.rawCount,
        })),
      },
      {
        sheetName: "Status Invoice",
        rows: invoiceDonutData.map((i) => ({ Status: i.name, Jumlah: i.value })),
      },
      {
        sheetName: "Data Finance Belum Lengkap",
        rows: insights.flatMap((insight) =>
          insight.assets.map((a) => ({
            Insight: insight.message,
            "No. Aset": getAssetNumber(a) ?? "-",
            "Kode Aset": a.assetCode,
            "Nama Aset": a.assetName,
            Perusahaan: a.companyOwnerName || "-",
          }))
        ),
      },
      {
        sheetName: "Top Asset",
        rows: topAssets.map((a) => ({
          "No. Aset": getAssetNumber(a) ?? "-",
          "Kode Aset": a.assetCode,
          "Nama Aset": a.assetName,
          Perusahaan: a.companyOwnerName || "-",
          Kategori: a.categoryName,
          Harga: getAssetPrice(a),
        })),
      },
    ]);
  };

  return (
    <div className="space-y-5">
      {/* Filter Global — SENGAJA ringkas (Perusahaan/Tahun Perolehan/
          Kategori saja), bukan filter selengkap halaman Asset, karena ini
          dashboard analitik. Mempengaruhi SELURUH card/chart/insight/Top
          Asset di bawah (semuanya dihitung dari filteredAssets). */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 flex flex-wrap items-center gap-2.5">
        <select
          value={companyFilter}
          onChange={(e) => setCompanyFilter(e.target.value)}
          className="input text-sm cursor-pointer w-auto"
        >
          <option value="">Semua Perusahaan</option>
          {companyOptions.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          value={yearFilter}
          onChange={(e) => setYearFilter(e.target.value)}
          className="input text-sm cursor-pointer w-auto"
        >
          <option value="">Semua Tahun Perolehan</option>
          {yearOptions.map((y) => (
            <option key={y} value={String(y)}>
              {y}
            </option>
          ))}
        </select>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="input text-sm cursor-pointer w-auto"
        >
          <option value="">Semua Kategori</option>
          {categoryOptions.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        {hasActiveFilter && (
          <button
            type="button"
            onClick={resetFilters}
            className="rounded-full border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 cursor-pointer hover:bg-slate-50"
          >
            Reset Filter
          </button>
        )}
        <button
          type="button"
          onClick={handleExport}
          className="ml-auto rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium cursor-pointer hover:bg-slate-50"
        >
          Export Rekap Finance
        </button>
      </div>

      {/* Bagian 1 — Executive Summary */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <SummaryCard label="Total Nilai Aset" value={formatCurrency(totalValue)} color="bg-blue-50 text-blue-600" />
        <SummaryCard label="Total Aset" value={`${totalAssetCount} Asset / ${totalUnits} Unit`} />
        <FinanceStatCard
          label="Aset Dengan Harga Terisi"
          value={`${assetsWithPrice} / ${totalAssetCount}`}
          sub={`${assetsWithoutPrice} aset belum memiliki harga`}
        />
        <div className="min-w-0 w-full max-w-full rounded-2xl border border-slate-200 bg-white p-3 shadow-sm md:p-4">
          <p className="text-[11px] font-medium text-slate-500">Kelengkapan Invoice</p>
          <div className="mt-1.5 space-y-0.5">
            <p className="text-sm">
              <span className="font-bold text-slate-900">{invoiceBuckets.ada}</span>{" "}
              <span className="text-slate-500">Ada Invoice</span>
            </p>
            <p className="text-sm">
              <span className="font-bold text-slate-900">{invoiceBuckets.tidak_ada}</span>{" "}
              <span className="text-slate-500">Tidak Ada Invoice</span>
            </p>
            <p className="text-sm">
              <span className="font-bold text-slate-900">{invoiceBuckets.tidak_diketahui}</span>{" "}
              <span className="text-slate-500">Belum Diketahui</span>
            </p>
          </div>
          <p className="mt-1.5 inline-flex rounded-full bg-emerald-50 text-emerald-700 px-2 py-0.5 text-[11px] font-semibold">
            {invoicePercent}% aset memiliki invoice
          </p>
        </div>
      </div>

      {/* Bagian 2 — Insight / Perlu Perhatian */}
      <div className="rounded-2xl border border-amber-200 bg-amber-50/40 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-amber-100">
          <h3 className="text-sm font-semibold text-amber-800">Perlu Perhatian Finance</h3>
        </div>
        {insights.length === 0 ? (
          <p className="px-4 py-6 text-sm text-slate-500 text-center">
            Tidak ada catatan — data finance aset pada filter ini sudah lengkap.
          </p>
        ) : (
          <div className="divide-y divide-amber-100">
            {insights.map((insight) => (
              <div key={insight.key}>
                <button
                  type="button"
                  onClick={() => setExpandedInsight(expandedInsight === insight.key ? null : insight.key)}
                  className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left cursor-pointer hover:bg-amber-50/60"
                >
                  <span className="text-sm text-slate-700">
                    <span className="font-semibold text-amber-700">{insight.count}</span> {insight.message}
                  </span>
                  <ChevronRight
                    size={16}
                    className={`shrink-0 text-amber-500 transition-transform ${
                      expandedInsight === insight.key ? "rotate-90" : ""
                    }`}
                  />
                </button>
                {expandedInsight === insight.key && (
                  <div className="bg-white px-4 py-3 border-t border-amber-100">
                    <ul className="space-y-1.5 max-h-56 overflow-y-auto">
                      {insight.assets.slice(0, INSIGHT_LIST_LIMIT).map((a) => (
                        <li key={a.id} className="text-xs text-slate-600 truncate">
                          {a.assetName} <span className="text-slate-400">· {a.assetCode}</span>
                        </li>
                      ))}
                    </ul>
                    {insight.assets.length > INSIGHT_LIST_LIMIT && (
                      <p className="mt-2 text-[11px] text-slate-400">
                        +{insight.assets.length - INSIGHT_LIST_LIMIT} lainnya
                      </p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bagian 3 — Visual Nilai Asset */}
      <div className="grid md:grid-cols-2 gap-4">
        <ChartCard title="Nilai Aset per Perusahaan">
          <SimplePieChart
            data={valueByCompany}
            donut
            valueFormatter={formatCompactCurrency}
            onSliceClick={(name) => {
              if (name === NO_COMPANY_LABEL) return;
              setCompanyFilter((prev) => (prev === name ? "" : name));
            }}
          />
        </ChartCard>
        <ChartCard title={`Nilai Aset per Kategori (Top ${TOP_CATEGORY_LIMIT})`}>
          <SimpleBarChart
            data={valueByCategory}
            horizontal
            valueFormatter={formatCompactCurrency}
            showValueLabel
            onBarClick={(name) => {
              if (name === "Lainnya" || name === "Tanpa Kategori") return;
              setCategoryFilter((prev) => (prev === name ? "" : name));
            }}
          />
        </ChartCard>
      </div>

      {/* Bagian 4 — Tren Perolehan Aset */}
      <ChartCard title={trendTitle}>
        <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
          {isMonthlyTrend ? (
            <p className="text-[11px] text-slate-400">
              Hasil filter hanya mencakup 1 tahun — otomatis ditampilkan per bulan.
            </p>
          ) : (
            <span />
          )}
          <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden text-xs">
            <button
              type="button"
              onClick={() => setYearMetric("value")}
              className={`px-3 py-1.5 font-medium cursor-pointer ${
                yearMetric === "value" ? "bg-blue-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              Nilai Aset
            </button>
            <button
              type="button"
              onClick={() => setYearMetric("count")}
              className={`px-3 py-1.5 font-medium cursor-pointer ${
                yearMetric === "count" ? "bg-blue-600 text-white" : "bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              Jumlah Asset
            </button>
          </div>
        </div>
        <SimpleBarChart
          // key dipasang supaya chart di-remount bersih tiap kali mode/tahun
          // berubah — data label & Y-axis SELALU ikut formatter mode
          // terbaru, tidak ada sisa render lama (mis. "asset" nyangkut
          // waktu mode-nya sudah "Nilai Aset").
          key={`trend-${isMonthlyTrend ? trendYear : "all"}-${yearMetric}`}
          data={trendData}
          valueFormatter={trendValueFormatter}
          showValueLabel
          cellColor={
            soleTransactionMonthIndex >= 0
              ? (_row, i) => (i === soleTransactionMonthIndex ? "#0d9488" : "#bfdbfe")
              : undefined
          }
          renderTooltip={(row) => (
            <>
              <p className="font-semibold text-slate-800">{row.fullLabel}</p>
              {yearMetric === "value" ? (
                <p className="text-slate-600">Nilai Perolehan: {formatCurrency(row.rawValue)}</p>
              ) : (
                <p className="text-slate-600">Jumlah Asset: {row.rawCount} asset</p>
              )}
            </>
          )}
        />
      </ChartCard>

      {/* Bagian 5 — Invoice Analytics */}
      <div className="grid md:grid-cols-2 gap-4">
        <ChartCard title="Status Invoice">
          <SimplePieChart data={invoiceDonutData} donut />
        </ChartCard>
        <ChartCard title="Kelengkapan Dokumen">
          <div className="space-y-2.5 mt-1">
            {documentCompleteness.map((d) => (
              <div
                key={d.label}
                className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2.5"
              >
                <span className="text-sm text-slate-600">{d.label}</span>
                <span className="text-sm font-bold text-slate-900">{d.value}</span>
              </div>
            ))}
          </div>
        </ChartCard>
      </div>

      {/* Bagian 6 — Asset Bernilai Terbesar */}
      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
          <h3 className="text-sm font-semibold text-slate-800">
            Top {TOP_ASSET_LIMIT} Asset Berdasarkan Nilai
          </h3>
          <Link href="/assets" className="text-xs font-medium text-blue-600 hover:underline shrink-0">
            Lihat Semua Asset →
          </Link>
        </div>
        <ResponsiveTable
          rows={topAssets}
          keyFn={(a) => a.id}
          minWidth={700}
          columns={[
            { label: "No. Aset", render: (a) => getAssetNumber(a) ?? "-" },
            {
              label: "Asset",
              primary: true,
              render: (a) => (
                <>
                  <p className="font-medium text-slate-800">{a.assetName}</p>
                  <p className="text-xs text-slate-400">{a.assetCode}</p>
                </>
              ),
            },
            { label: "Perusahaan", render: (a) => a.companyOwnerName || "-" },
            { label: "Kategori", render: (a) => a.categoryName },
            { label: "Harga", render: (a) => formatCurrency(getAssetPrice(a)), align: "right" },
          ]}
        />
      </div>

      {/* Bagian 7 — Vendor Analytics */}
      <ChartCard title="Top Vendor berdasarkan Nilai Pembelian">
        {topVendors.length === 0 ? (
          <p className="text-sm text-slate-400 text-center py-8">
            Data vendor belum cukup untuk membuat analisis.
          </p>
        ) : (
          <div className="space-y-2.5">
            {topVendors.map((v) => (
              <div
                key={v.name}
                className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2.5"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium text-slate-800 truncate">{v.name}</p>
                  <p className="text-xs text-slate-400">
                    {v.count} asset · {v.units} unit
                  </p>
                </div>
                <p className="text-sm font-bold text-slate-900 shrink-0">{formatCurrency(v.value)}</p>
              </div>
            ))}
          </div>
        )}
      </ChartCard>
    </div>
  );
}
