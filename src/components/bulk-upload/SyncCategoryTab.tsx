"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import { collection, doc, onSnapshot, updateDoc } from "firebase/firestore";
import {
  UploadCloud,
  FileSpreadsheet,
  CheckCircle2,
  XCircle,
  ArrowLeft,
  ArrowRight,
  RotateCcw,
  Download,
} from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { fetchHrpBrands } from "@/lib/hrp";
import { AssetCategory, HrpBrand } from "@/lib/types";
import { writeAssetLog } from "@/lib/firestore-helpers";
import { detectSheetHeader, downloadErrorReportXlsx, getSheetRowsAoa, parseSheetRows } from "@/lib/import/excel";
import {
  CategorySyncRow,
  CategorySyncRowStatus,
  buildCategorySyncRows,
  fetchExistingAssetsForCategorySync,
} from "@/lib/import/asset-category-sync";
import { ensureCanonicalCategoriesExist, ensureCategoriesForRawNames } from "@/lib/import/category-seed";
import Badge from "@/components/Badge";
import SearchableSelect, { SearchableSelectItem } from "@/components/SearchableSelect";
import { Toast, ToastState } from "@/components/Toast";
import { SummaryCard } from "@/components/bulk-upload/ImportNewAssetsTab";

type SyncStep = "upload" | "configure" | "preview" | "syncing" | "done";

const STATUS_META: Record<CategorySyncRowStatus, { label: string; colorClass: string }> = {
  ready: { label: "Siap Sinkron", colorClass: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  same: { label: "Sudah Sama", colorClass: "bg-slate-100 text-slate-500 border-slate-200" },
  needs_review: { label: "Perlu Review", colorClass: "bg-amber-50 text-amber-700 border-amber-200" },
  not_found: { label: "Aset Tidak Ditemukan", colorClass: "bg-amber-50 text-amber-700 border-amber-200" },
  invalid_category: { label: "Kategori Kosong", colorClass: "bg-slate-100 text-slate-500 border-slate-200" },
  duplicate: { label: "Duplicate", colorClass: "bg-red-50 text-red-700 border-red-200" },
};

export default function SyncCategoryTab() {
  const router = useRouter();
  const { firebaseUser, assetUser, role, loading } = useAuth();
  const authReady = !loading && !!firebaseUser && !!assetUser && !!role;

  const [step, setStep] = useState<SyncStep>("upload");
  const [toast, setToast] = useState<ToastState | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [sheetName, setSheetName] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [companies, setCompanies] = useState<HrpBrand[]>([]);
  const [loadingCompanies, setLoadingCompanies] = useState(true);
  const [categories, setCategories] = useState<AssetCategory[]>([]);

  const [preparing, setPreparing] = useState(false);
  const [rows, setRows] = useState<CategorySyncRow[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<Set<number>>(new Set());

  const [syncProgress, setSyncProgress] = useState({ done: 0, total: 0 });
  const [reportRows, setReportRows] = useState<{ excelRowNumber: number; kodeAset: string; namaAset: string; status: string; reason: string }[]>([]);
  const [result, setResult] = useState<{ success: number; failed: number } | null>(null);

  useEffect(() => {
    if (!authReady) return;
    fetchHrpBrands()
      .then(setCompanies)
      .finally(() => setLoadingCompanies(false));
  }, [authReady]);

  useEffect(() => {
    if (!authReady) return;
    const unsub = onSnapshot(collection(db, "asset_categories"), (snap) => {
      setCategories(snap.docs.map((d) => ({ id: d.id, ...d.data() } as AssetCategory)).filter((c) => c.status === "active"));
    });
    return () => unsub();
  }, [authReady]);

  const companyItems: SearchableSelectItem[] = useMemo(
    () => companies.map((c) => ({ id: c.id, label: c.name, searchText: c.name })),
    [companies]
  );

  const handleFile = async (f: File) => {
    try {
      const buffer = await f.arrayBuffer();
      const wb = XLSX.read(buffer, { type: "array" });
      if (wb.SheetNames.length === 0) {
        setToast({ type: "error", message: "File Excel tidak berisi sheet apa pun." });
        return;
      }
      setFile(f);
      setWorkbook(wb);
      setSheetName(wb.SheetNames[0]);
      setStep("configure");
    } catch (err) {
      console.error("[Sync Kategori] gagal membaca file", err);
      setToast({ type: "error", message: "Gagal membaca file Excel. Pastikan formatnya .xlsx/.xls." });
    }
  };

  const buildPreview = async () => {
    if (!workbook || !sheetName || !companyId) return;
    setPreparing(true);
    try {
      const aoa = getSheetRowsAoa(workbook, sheetName);
      const header = detectSheetHeader(aoa);
      if (!header) {
        setToast({
          type: "error",
          message: `Sheet "${sheetName}" tidak punya kolom "Nama Aset" yang bisa dikenali — pastikan formatnya sesuai template.`,
        });
        return;
      }
      const parsed = parseSheetRows(aoa, header);
      if (parsed.length === 0) {
        setToast({ type: "error", message: `Tidak ada baris data aset yang ditemukan di sheet "${sheetName}".` });
        return;
      }

      const currentUserUid = firebaseUser?.uid || assetUser?.uid || "";
      const currentUserName = assetUser?.name || firebaseUser?.email || "";

      // Master Kategori disiapkan dulu (6 kategori canonical + kategori baru
      // apa pun di sheet ini yang belum ada) SEBELUM matching — supaya baris
      // yang kategorinya belum pernah ada di Master Kategori tetap bisa
      // "Siap Sinkron", bukan "Aset Tidak Ditemukan".
      let categoriesForMatch = categories;
      try {
        categoriesForMatch = await ensureCanonicalCategoriesExist(categoriesForMatch, currentUserUid, currentUserName);
        categoriesForMatch = await ensureCategoriesForRawNames(
          parsed.map((r) => r.jenisAset),
          categoriesForMatch,
          currentUserUid,
          currentUserName
        );
        setCategories(categoriesForMatch);
      } catch (err) {
        console.error("[Sync Kategori] gagal menyiapkan Master Kategori", err);
        setToast({ type: "error", message: "Gagal menyiapkan Master Kategori dari Excel." });
      }

      const existingAssets = await fetchExistingAssetsForCategorySync(companyId);
      const built = buildCategorySyncRows(parsed, existingAssets, categoriesForMatch);
      setRows(built);
      setSelectedKeys(new Set(built.filter((r) => r.status === "ready").map((r) => r.excelRowNumber)));
      setStep("preview");
    } catch (err) {
      console.error("[Sync Kategori] gagal menyiapkan preview", err);
      setToast({ type: "error", message: "Gagal menyiapkan preview pencocokan." });
    } finally {
      setPreparing(false);
    }
  };

  const summary = useMemo(() => {
    const total = rows.length;
    const ready = rows.filter((r) => r.status === "ready").length;
    const same = rows.filter((r) => r.status === "same").length;
    const needsReview = rows.filter((r) => r.status === "needs_review").length;
    const notFound = rows.filter((r) => r.status === "not_found").length;
    const invalidCategory = rows.filter((r) => r.status === "invalid_category").length;
    const duplicate = rows.filter((r) => r.status === "duplicate").length;
    return { total, ready, same, needsReview, notFound, invalidCategory, duplicate };
  }, [rows]);

  const selectedCount = selectedKeys.size;

  const handleSelectAllReady = () => setSelectedKeys(new Set(rows.filter((r) => r.status === "ready").map((r) => r.excelRowNumber)));
  const handleDeselectAll = () => setSelectedKeys(new Set());
  const toggleRow = (row: CategorySyncRow) => {
    if (row.status !== "ready") return;
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(row.excelRowNumber)) next.delete(row.excelRowNumber);
      else next.add(row.excelRowNumber);
      return next;
    });
  };

  const handleSync = async () => {
    const selectedRows = rows.filter((r) => selectedKeys.has(r.excelRowNumber) && r.status === "ready" && r.matchedAsset && r.newCategoryId);
    if (selectedRows.length === 0) {
      setToast({ type: "error", message: "Pilih minimal satu baris untuk disinkronkan." });
      return;
    }

    setStep("syncing");
    setSyncProgress({ done: 0, total: selectedRows.length });

    const currentUserUid = firebaseUser?.uid || assetUser?.uid || "";
    const currentUserName = assetUser?.name || firebaseUser?.email || "";

    let done = 0;
    let success = 0;
    let failed = 0;
    const outcomeRows: { row: CategorySyncRow; ok: boolean; message: string }[] = [];

    for (const row of selectedRows) {
      const asset = row.matchedAsset!;
      try {
        // HANYA field categoryId/categoryName yang diupdate — TIDAK PERNAH
        // menyentuh document ID, assetCode, No. Aset, nama, qty, harga,
        // invoice, lokasi, foto, Drive file, QR, PIC, finance, maintenance,
        // peminjaman, atau histori.
        await updateDoc(doc(db, "assets", asset.id), {
          categoryId: row.newCategoryId,
          categoryName: row.newCategoryName,
        });
        console.log("[Sync Kategori] updated", {
          assetCode: asset.assetCode,
          categoryName: row.newCategoryName,
        });
        await writeAssetLog({
          assetId: asset.id,
          assetName: asset.assetName,
          assetCode: asset.assetCode,
          action: "SYNC_ASSET_CATEGORY_FROM_EXCEL",
          userUid: currentUserUid,
          userName: currentUserName,
          detail: `Kategori disinkronkan dari "${asset.categoryName || "-"}" menjadi "${row.newCategoryName}" (file "${file?.name}" sheet "${sheetName}")`,
        });
        success += 1;
        outcomeRows.push({ row, ok: true, message: "Berhasil disinkronkan" });
      } catch (err) {
        console.error("[Sync Kategori] updateDoc gagal", { assetCode: asset.assetCode, err });
        failed += 1;
        outcomeRows.push({ row, ok: false, message: "Gagal menyimpan kategori" });
      }
      done += 1;
      setSyncProgress({ done, total: selectedRows.length });
    }

    const report = [
      ...outcomeRows.map((o) => ({
        excelRowNumber: o.row.excelRowNumber,
        kodeAset: o.row.kodeAsetExcel || "-",
        namaAset: o.row.namaAsetExcel,
        status: o.ok ? "Berhasil" : "Gagal",
        reason: o.message,
      })),
      ...rows
        .filter((r) => r.status === "not_found" || r.status === "duplicate" || r.status === "needs_review" || r.status === "invalid_category")
        .map((r) => ({
          excelRowNumber: r.excelRowNumber,
          kodeAset: r.kodeAsetExcel || "-",
          namaAset: r.namaAsetExcel,
          status: STATUS_META[r.status].label,
          reason:
            r.status === "duplicate"
              ? `${r.candidateCount} aset di database memakai Kode Aset ini — perlu review manual`
              : r.status === "needs_review"
              ? `${r.candidateCount} kandidat aset cocok dengan Nama+Tanggal+Qty yang sama — perlu review manual`
              : r.status === "not_found"
              ? "Tidak ada aset yang cocok (Kode Aset maupun Nama+Tanggal+Qty)"
              : "Kolom Jenis Aset kosong di Excel",
        })),
    ];

    setReportRows(report);
    setResult({ success, failed });
    setStep("done");
  };

  const resetWizard = () => {
    setStep("upload");
    setFile(null);
    setWorkbook(null);
    setSheetName("");
    setCompanyId("");
    setRows([]);
    setSelectedKeys(new Set());
    setResult(null);
    setReportRows([]);
    setSyncProgress({ done: 0, total: 0 });
  };

  return (
    <div>
      {step === "upload" && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
          <label className="file-drop py-14">
            <UploadCloud className="text-slate-400" size={30} />
            <span className="text-sm font-medium text-slate-600">Klik untuk upload file Excel (.xlsx/.xls)</span>
            <span className="text-xs text-slate-400">
              Gunakan file Excel yang sama seperti proses import sebelumnya — data aset TIDAK dibuat/diubah, hanya
              kategori yang disinkronkan lewat Kode Aset.
            </span>
            <input
              type="file"
              accept=".xlsx,.xls"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
            />
          </label>
        </div>
      )}

      {step === "configure" && workbook && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-5">
          <p className="text-sm text-slate-500 inline-flex items-center gap-1.5">
            <FileSpreadsheet size={15} className="text-slate-400" />
            File terpilih: <span className="font-medium text-slate-800">{file?.name}</span>
          </p>
          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">
                Pilih Sheet <span className="text-red-500">*</span>
              </label>
              <select value={sheetName} onChange={(e) => setSheetName(e.target.value)} className="input">
                {workbook.SheetNames.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">
                Perusahaan / Brand Pemilik <span className="text-red-500">*</span>
              </label>
              <SearchableSelect
                items={companyItems}
                value={companyId}
                onChange={setCompanyId}
                placeholder={loadingCompanies ? "Memuat..." : "Pilih perusahaan/brand"}
                searchPlaceholder="Cari brand..."
                emptyText="Tidak ada data perusahaan/brand."
                disabled={loadingCompanies}
              />
            </div>
          </div>
          <div className="flex items-center justify-between pt-2 border-t border-slate-100">
            <button
              type="button"
              onClick={resetWizard}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <ArrowLeft size={15} /> Ganti File
            </button>
            <button
              type="button"
              onClick={buildPreview}
              disabled={!sheetName || !companyId || preparing}
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-teal-500 text-white px-4 py-2.5 text-sm font-medium hover:brightness-105 disabled:opacity-50 shadow-md shadow-blue-900/20"
            >
              {preparing ? "Mencocokkan..." : "Lanjut ke Preview Pencocokan"} <ArrowRight size={15} />
            </button>
          </div>
        </div>
      )}

      {step === "preview" && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
            <SummaryCard label="Data Excel" value={summary.total} tone="neutral" />
            <SummaryCard label="Siap Sinkron" value={summary.ready} tone="success" />
            <SummaryCard label="Sudah Sama" value={summary.same} tone="slate" />
            <SummaryCard label="Perlu Review" value={summary.needsReview} tone="warning" />
            <SummaryCard label="Aset Tidak Ditemukan" value={summary.notFound} tone="error" />
            <SummaryCard label="Kategori Kosong" value={summary.invalidCategory} tone="slate" />
            <SummaryCard label="Duplicate" value={summary.duplicate} tone="error" />
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleSelectAllReady}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Pilih Semua Siap Sinkron
              </button>
              <button
                type="button"
                onClick={handleDeselectAll}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Batalkan Semua
              </button>
              <div className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setStep("configure")}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  <ArrowLeft size={15} /> Kembali
                </button>
                <button
                  type="button"
                  onClick={handleSync}
                  disabled={selectedCount === 0}
                  className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-teal-500 text-white px-4 py-2.5 text-sm font-medium hover:brightness-105 disabled:opacity-50 shadow-md shadow-blue-900/20"
                >
                  Sinkronkan {selectedCount} Kategori
                </button>
              </div>
            </div>

            <div className="overflow-x-auto max-h-[32rem] overflow-y-auto rounded-xl border border-slate-100">
              <table className="w-full min-w-[1300px] text-sm">
                <thead className="sticky top-0 bg-slate-50">
                  <tr className="text-left text-slate-500 border-b border-slate-200">
                    <th className="px-3 py-2 font-semibold w-8"></th>
                    <th className="px-3 py-2 font-semibold">Kode Aset Excel</th>
                    <th className="px-3 py-2 font-semibold">Nama Aset Excel</th>
                    <th className="px-3 py-2 font-semibold">Jenis Aset Excel</th>
                    <th className="px-3 py-2 font-semibold">Nama Aset Web</th>
                    <th className="px-3 py-2 font-semibold">Kategori Existing</th>
                    <th className="px-3 py-2 font-semibold">Kategori Baru</th>
                    <th className="px-3 py-2 font-semibold">Metode Pencocokan</th>
                    <th className="px-3 py-2 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const meta = STATUS_META[row.status];
                    const eligible = row.status === "ready";
                    const checked = selectedKeys.has(row.excelRowNumber);
                    return (
                      <tr key={row.excelRowNumber} className="border-b border-slate-100 last:border-0 align-top">
                        <td className="px-3 py-2">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={!eligible}
                            onChange={() => toggleRow(row)}
                            className="cursor-pointer disabled:cursor-not-allowed disabled:opacity-30"
                          />
                        </td>
                        <td className="px-3 py-2 font-mono text-xs text-slate-700 whitespace-nowrap">{row.kodeAsetExcel || "-"}</td>
                        <td className="px-3 py-2 text-slate-800">{row.namaAsetExcel}</td>
                        <td className="px-3 py-2 text-slate-500">{row.jenisAsetExcel || "-"}</td>
                        <td className="px-3 py-2 text-slate-500">{row.matchedAsset?.assetName || "-"}</td>
                        <td className="px-3 py-2 text-slate-500">{row.matchedAsset?.categoryName || "-"}</td>
                        <td className="px-3 py-2 font-semibold text-slate-800">{row.newCategoryName || "-"}</td>
                        <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{row.matchMethod}</td>
                        <td className="px-3 py-2">
                          <Badge label={meta.label} colorClass={meta.colorClass} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {step === "syncing" && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center space-y-4">
          <div className="mx-auto h-10 w-10 rounded-full border-2 border-slate-200 border-t-slate-900 animate-spin" />
          <p className="text-sm font-medium text-slate-700">
            Sinkronisasi Kategori {syncProgress.done} / {syncProgress.total}
          </p>
          <div className="mx-auto max-w-md h-2 rounded-full bg-slate-100 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-600 to-teal-500 transition-all"
              style={{ width: `${syncProgress.total === 0 ? 0 : Math.round((syncProgress.done / syncProgress.total) * 100)}%` }}
            />
          </div>
          <p className="text-xs text-slate-400">Jangan tutup halaman ini sampai proses selesai.</p>
        </div>
      )}

      {step === "done" && result && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center space-y-5">
          <CheckCircle2 size={40} className="mx-auto text-emerald-500" />
          <h2 className="text-lg font-semibold text-slate-900">Sinkronisasi Kategori Selesai</h2>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 max-w-2xl mx-auto text-left">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
              <p className="text-xl font-semibold text-emerald-700">{result.success}</p>
              <p className="text-xs text-emerald-700 mt-0.5 inline-flex items-center gap-1"><CheckCircle2 size={12} /> Berhasil</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xl font-semibold text-slate-700">{summary.same}</p>
              <p className="text-xs text-slate-500 mt-0.5">Sudah Sama</p>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="text-xl font-semibold text-amber-700">{summary.needsReview}</p>
              <p className="text-xs text-amber-700 mt-0.5">Perlu Review</p>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="text-xl font-semibold text-amber-700">{summary.notFound}</p>
              <p className="text-xs text-amber-700 mt-0.5">Tidak Ditemukan</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xl font-semibold text-slate-700">{summary.invalidCategory}</p>
              <p className="text-xs text-slate-500 mt-0.5">Kategori Kosong</p>
            </div>
          </div>
          {(result.failed > 0 || summary.duplicate > 0) && (
            <div className="flex flex-wrap items-center justify-center gap-3 text-xs">
              {result.failed > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-red-700">
                  <XCircle size={12} /> {result.failed} Gagal Disimpan
                </span>
              )}
              {summary.duplicate > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-red-700">
                  {summary.duplicate} Duplicate (dilewati)
                </span>
              )}
            </div>
          )}
          <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
            <button
              type="button"
              onClick={() => router.push("/assets")}
              className="rounded-xl bg-gradient-to-r from-blue-600 to-teal-500 text-white px-4 py-2.5 text-sm font-medium hover:brightness-105 shadow-md shadow-blue-900/20"
            >
              Lihat Data Aset
            </button>
            <button
              type="button"
              onClick={() => downloadErrorReportXlsx(reportRows, `Sinkronisasi Kategori - ${file?.name || "sync"}`)}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <Download size={15} /> Download Laporan Sinkronisasi
            </button>
            <button
              type="button"
              onClick={resetWizard}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <RotateCcw size={15} /> Sinkronkan File Lain
            </button>
          </div>
        </div>
      )}

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
