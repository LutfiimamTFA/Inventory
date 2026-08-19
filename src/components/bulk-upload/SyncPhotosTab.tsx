"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
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
import { DriveUploadResult, HrpBrand } from "@/lib/types";
import { writeAssetLog } from "@/lib/firestore-helpers";
import { detectSheetHeader, downloadErrorReportXlsx, getSheetRowsAoa, parseSheetRows } from "@/lib/import/excel";
import { extractEmbeddedImagesForSheet, findColumnIndex, groupImagesByRow } from "@/lib/import/excel-images";
import {
  PhotoSyncHandoff,
  SyncRow,
  SyncRowStatus,
  buildSyncRows,
  fetchExistingAssetsForCompany,
  revokeSyncRowImages,
} from "@/lib/import/asset-photo-sync";
import { buildPhysicalEvidenceFileName, runWithConcurrencyLimit, uploadImageWithRetry } from "@/lib/import/asset-image-upload";
import { getAssetFilePreviewUrl } from "@/lib/drive-file-id";
import Badge from "@/components/Badge";
import SearchableSelect, { SearchableSelectItem } from "@/components/SearchableSelect";
import ImageLightboxModal, { LightboxImage } from "@/components/ImageLightboxModal";
import { Toast, ToastState } from "@/components/Toast";
import { SummaryCard } from "@/components/bulk-upload/ImportNewAssetsTab";

// Google Apps Script/Drive jangan dibombardir request bersamaan — mulai
// dari 2-3, jangan langsung 10-20 paralel.
const SYNC_CONCURRENCY = 3;
// "analyzing" — HANYA dipakai jalur handoff (lihat useEffect di bawah):
// file/sheet/company sudah dibawa dari tab Import, langsung analisa embedded
// image tanpa user upload/pilih ulang apa pun.
type SyncStep = "upload" | "configure" | "analyzing" | "preview" | "syncing" | "done";
type OverwriteMode = "skip" | "overwrite" | "append";

const STATUS_META: Record<SyncRowStatus, { label: string; colorClass: string }> = {
  ready: { label: "Siap Sinkron", colorClass: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  has_photo: { label: "Sudah Ada Foto", colorClass: "bg-blue-50 text-blue-700 border-blue-200" },
  no_photo: { label: "Tidak Ada Foto", colorClass: "bg-slate-100 text-slate-500 border-slate-200" },
  not_found: { label: "Aset Tidak Ditemukan", colorClass: "bg-amber-50 text-amber-700 border-amber-200" },
  empty_code: { label: "Kode Aset Kosong", colorClass: "bg-amber-50 text-amber-700 border-amber-200" },
  duplicate: { label: "Duplicate Database", colorClass: "bg-red-50 text-red-700 border-red-200" },
};

function isEligible(row: SyncRow, mode: OverwriteMode): boolean {
  if (row.status === "ready") return true;
  if (row.status === "has_photo") return mode !== "skip";
  return false;
}

export default function SyncPhotosTab({
  handoff,
  onHandoffConsumed,
}: {
  handoff?: PhotoSyncHandoff | null;
  onHandoffConsumed?: () => void;
}) {
  const router = useRouter();
  const { firebaseUser, assetUser, role, loading } = useAuth();
  const authReady = !loading && !!firebaseUser && !!assetUser && !!role;

  const [step, setStep] = useState<SyncStep>("upload");
  const [toast, setToast] = useState<ToastState | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [zip, setZip] = useState<JSZip | null>(null);
  const [sheetName, setSheetName] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [companies, setCompanies] = useState<HrpBrand[]>([]);
  const [loadingCompanies, setLoadingCompanies] = useState(true);

  const [preparing, setPreparing] = useState(false);
  const [syncRows, setSyncRows] = useState<SyncRow[]>([]);
  const [selectedKeys, setSelectedKeys] = useState<Set<number>>(new Set());
  const [mode, setMode] = useState<OverwriteMode>("skip");
  const [lightbox, setLightbox] = useState<{ images: LightboxImage[]; title?: string } | null>(null);

  const isSyncingRef = useRef(false);
  const [syncProgress, setSyncProgress] = useState({ done: 0, total: 0 });
  const [syncingText, setSyncingText] = useState("");
  const [reportRows, setReportRows] = useState<{ excelRowNumber: number; kodeAset: string; namaAset: string; status: string; reason: string }[]>([]);
  const [result, setResult] = useState<{ success: number; failed: number; skipped: number; notFound: number; duplicate: number } | null>(null);

  useEffect(() => {
    if (!authReady) return;
    fetchHrpBrands()
      .then(setCompanies)
      .finally(() => setLoadingCompanies(false));
  }, [authReady]);

  const companyItems: SearchableSelectItem[] = useMemo(
    () => companies.map((c) => ({ id: c.id, label: c.name, searchText: c.name })),
    [companies]
  );
  const company = companies.find((c) => c.id === companyId) || null;

  const handleFile = async (f: File) => {
    try {
      const buffer = await f.arrayBuffer();
      const wb = XLSX.read(buffer, { type: "array" });
      if (wb.SheetNames.length === 0) {
        setToast({ type: "error", message: "File Excel tidak berisi sheet apa pun." });
        return;
      }
      const z = await JSZip.loadAsync(buffer);
      setFile(f);
      setWorkbook(wb);
      setZip(z);
      setSheetName(wb.SheetNames[0]);
      setStep("configure");
    } catch (err) {
      console.error("[Sync Photos] gagal membaca file", err);
      setToast({ type: "error", message: "Gagal membaca file Excel. Pastikan formatnya .xlsx/.xls." });
    }
  };

  // Terima parameter EKSPLISIT (bukan baca dari state closure) supaya bisa
  // dipanggil langsung dari jalur handoff tanpa menunggu re-render state
  // file/workbook/zip/sheetName/companyId selesai di-set lebih dulu.
  const runPreviewMatch = async (wb: XLSX.WorkBook, zipInstance: JSZip, sheet: string, company_Id: string) => {
    setPreparing(true);
    try {
      const aoa = getSheetRowsAoa(wb, sheet);
      const header = detectSheetHeader(aoa);
      if (!header) {
        setToast({
          type: "error",
          message: `Sheet "${sheet}" tidak punya kolom "Nama Aset" yang bisa dikenali — pastikan formatnya sesuai template.`,
        });
        setStep("configure");
        return;
      }
      const parsed = parseSheetRows(aoa, header);
      if (parsed.length === 0) {
        setToast({ type: "error", message: `Tidak ada baris data aset yang ditemukan di sheet "${sheet}".` });
        setStep("configure");
        return;
      }

      const buktiFisikColumn = findColumnIndex(header.columnMap, "buktiFisikAset");
      const imagesByRow =
        buktiFisikColumn !== null
          ? groupImagesByRow(await extractEmbeddedImagesForSheet(zipInstance, sheet, buktiFisikColumn))
          : new Map();

      const existingAssets = await fetchExistingAssetsForCompany(company_Id);

      revokeSyncRowImages(syncRows);
      const rows = buildSyncRows(parsed, imagesByRow, existingAssets);
      setSyncRows(rows);
      setSelectedKeys(new Set(rows.filter((r) => r.status === "ready").map((r) => r.excelRowNumber)));
      setMode("skip");
      setStep("preview");
    } catch (err) {
      console.error("[Sync Photos] gagal menyiapkan preview", err);
      setToast({ type: "error", message: "Gagal menyiapkan preview pencocokan." });
      setStep("configure");
    } finally {
      setPreparing(false);
    }
  };

  const buildPreview = async () => {
    if (!workbook || !zip || !sheetName || !companyId || !company) return;
    await runPreviewMatch(workbook, zip, sheetName, companyId);
  };

  // ── Handoff dari tab Import Aset Baru: sheet+company yang dipilih sudah
  // pernah diimport, jadi file/workbook/zip/sheet/company dibawa langsung ke
  // sini dan analisa pencocokan foto berjalan OTOMATIS — user tidak upload
  // ulang, tidak pilih sheet ulang, tidak pilih perusahaan ulang.
  const handoffConsumedRef = useRef<PhotoSyncHandoff | null>(null);
  useEffect(() => {
    if (!handoff || handoffConsumedRef.current === handoff) return;
    handoffConsumedRef.current = handoff;
    setFile(handoff.file);
    setWorkbook(handoff.workbook);
    setZip(handoff.zip);
    setSheetName(handoff.sheetName);
    setCompanyId(handoff.companyId);
    setStep("analyzing");
    runPreviewMatch(handoff.workbook, handoff.zip, handoff.sheetName, handoff.companyId).finally(() => {
      onHandoffConsumed?.();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [handoff]);

  // Kalau mode balik ke "skip", baris "Sudah Ada Foto" yang sempat dipilih
  // otomatis tidak lagi eligible — buang dari seleksi supaya tidak "nyangkut".
  // Dilakukan langsung di event handler (bukan effect terpisah) supaya jadi
  // satu update sinkron, bukan render tambahan setelah efek jalan.
  const handleModeChange = (nextMode: OverwriteMode) => {
    setMode(nextMode);
    if (nextMode === "skip") {
      setSelectedKeys((prev) => {
        const next = new Set<number>();
        prev.forEach((key) => {
          const row = syncRows.find((r) => r.excelRowNumber === key);
          if (row && isEligible(row, nextMode)) next.add(key);
        });
        return next;
      });
    }
  };

  const summary = useMemo(() => {
    const total = syncRows.length;
    const assetFound = syncRows.filter((r) => !!r.matchedAsset).length;
    const photoFound = syncRows.filter((r) => r.excelImages.length > 0).length;
    const ready = syncRows.filter((r) => r.status === "ready").length;
    const hasPhoto = syncRows.filter((r) => r.status === "has_photo").length;
    const noPhoto = syncRows.filter((r) => r.status === "no_photo").length;
    const notFound = syncRows.filter((r) => r.status === "not_found").length;
    const emptyCode = syncRows.filter((r) => r.status === "empty_code").length;
    const duplicate = syncRows.filter((r) => r.status === "duplicate").length;
    return { total, assetFound, photoFound, ready, hasPhoto, noPhoto, notFound, emptyCode, duplicate };
  }, [syncRows]);

  const selectedCount = selectedKeys.size;

  const handleSelectAllReady = () => {
    setSelectedKeys(new Set(syncRows.filter((r) => isEligible(r, mode)).map((r) => r.excelRowNumber)));
  };
  const handleSelectOnlyNoPhoto = () => {
    setSelectedKeys(new Set(syncRows.filter((r) => r.status === "ready").map((r) => r.excelRowNumber)));
  };
  const handleDeselectAll = () => setSelectedKeys(new Set());
  const toggleRow = (row: SyncRow) => {
    if (!isEligible(row, mode)) return;
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(row.excelRowNumber)) next.delete(row.excelRowNumber);
      else next.add(row.excelRowNumber);
      return next;
    });
  };

  const handleSync = async () => {
    if (isSyncingRef.current) return;
    const selectedRows = syncRows.filter((r) => selectedKeys.has(r.excelRowNumber) && isEligible(r, mode) && r.matchedAsset);
    if (selectedRows.length === 0) {
      setToast({ type: "error", message: "Pilih minimal satu baris untuk disinkronkan." });
      return;
    }

    isSyncingRef.current = true;
    setStep("syncing");
    setSyncProgress({ done: 0, total: selectedRows.length });
    setSyncingText("");

    const currentUserUid = firebaseUser?.uid || assetUser?.uid || "";
    const currentUserName = assetUser?.name || firebaseUser?.email || "";

    let done = 0;
    const outcomes = await runWithConcurrencyLimit(
      selectedRows.map((row) => async () => {
        const asset = row.matchedAsset!;
        setSyncingText(`Mengupload bukti fisik ${asset.assetName}...`);

        const uploadedUrls: string[] = [];
        // Simpan hasil upload PERTAMA yang sukses lengkap (bukan cuma URL
        // proxy) — dipakai untuk backfill field foto utama (photoUrl dkk) di
        // bawah, TANPA upload ulang, cuma reuse hasil yang sama.
        let firstUploaded: DriveUploadResult | null = null;
        for (let i = 0; i < row.excelImages.length; i++) {
          const image = row.excelImages[i];
          const fileName = buildPhysicalEvidenceFileName(asset.assetCode, i, image.mimeType);
          try {
            const uploaded = await uploadImageWithRetry(image.blob, fileName, image.mimeType, {
              assetCode: asset.assetCode,
              assetName: asset.assetName,
            });
            uploadedUrls.push(getAssetFilePreviewUrl(uploaded.fileId));
            if (!firstUploaded) firstUploaded = uploaded;
          } catch (err) {
            const errorInfo =
              err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : { raw: String(err) };
            console.error("[Sync Photos] Google Drive upload gagal", {
              assetCode: asset.assetCode,
              fileName,
              fileSize: image.blob.size,
              mimeType: image.mimeType,
              error: errorInfo,
            });
          }
        }

        if (uploadedUrls.length === 0) {
          return { row, outcome: "failed" as const, message: "Semua foto gagal diupload setelah beberapa percobaan" };
        }

        const finalUrls = mode === "append" ? [...asset.physicalEvidenceImages, ...uploadedUrls] : uploadedUrls;
        const partial = uploadedUrls.length < row.excelImages.length;

        try {
          // Foto utama (card "Foto Aset") HANYA di-backfill kalau aset ini
          // BELUM punya foto utama sama sekali — jangan pernah menimpa foto
          // yang sudah diisi manual lewat Tambah/Edit Aset. Reuse hasil
          // upload yang SAMA (firstUploaded) — TIDAK upload ulang.
          const hasMainPhoto = !!(asset.photoDriveFileId || asset.photoUrl);
          const mainPhotoFields =
            !hasMainPhoto && firstUploaded
              ? {
                  photoUrl: firstUploaded.url,
                  photoThumbnailUrl: firstUploaded.thumbnailUrl,
                  photoFileName: firstUploaded.fileName,
                  photoDriveFileId: firstUploaded.fileId,
                  photoMimeType: firstUploaded.mimeType,
                  photoSize: firstUploaded.size,
                  photoUploadedAt: firstUploaded.uploadedAt,
                }
              : {};

          // HANYA field dokumentasi foto — TIDAK PERNAH menyentuh assetCode,
          // nama, kategori, qty, harga, tanggal, perusahaan, divisi, lokasi,
          // kondisi, QR, PIC, status pinjam, maintenance, finance, invoice,
          // createdAt/By, atau document ID.
          await updateDoc(doc(db, "assets", asset.id), {
            physicalEvidenceImages: finalUrls,
            photoSyncedAt: serverTimestamp(),
            photoSyncedByUid: currentUserUid,
            photoSyncedByName: currentUserName,
            photoSource: "excel_sync",
            ...mainPhotoFields,
          });

          await writeAssetLog({
            assetId: asset.id,
            assetName: asset.assetName,
            assetCode: asset.assetCode,
            action: "SYNC_ASSET_PHOTO_FROM_EXCEL",
            userUid: currentUserUid,
            userName: currentUserName,
            detail: `Sinkron ${uploadedUrls.length} foto dari file "${file?.name}" sheet "${sheetName}"${partial ? " (sebagian foto gagal diupload)" : ""}`,
          });

          return {
            row,
            outcome: partial ? ("partial" as const) : ("success" as const),
            message: partial ? "Sebagian foto gagal diupload, sisanya tersimpan" : "Berhasil disinkronkan",
          };
        } catch (err) {
          console.error("[Sync Photos] updateDoc gagal", { assetCode: asset.assetCode, err });
          return { row, outcome: "failed" as const, message: "Gagal menyimpan referensi foto ke aset" };
        }
      }),
      SYNC_CONCURRENCY,
      () => {
        done++;
        setSyncProgress({ done, total: selectedRows.length });
      }
    );

    revokeSyncRowImages(syncRows);
    setSyncingText("");

    const success = outcomes.filter((o) => o.outcome === "success" || o.outcome === "partial").length;
    const failed = outcomes.filter((o) => o.outcome === "failed").length;
    const skipped = syncRows.filter((r) => !selectedKeys.has(r.excelRowNumber) && (r.status === "ready" || r.status === "has_photo")).length;

    const report = [
      ...outcomes.map((o) => ({
        excelRowNumber: o.row.excelRowNumber,
        kodeAset: o.row.kodeAsetExcel || "-",
        namaAset: o.row.namaAsetExcel,
        status: o.outcome === "success" ? "Berhasil" : o.outcome === "partial" ? "Sebagian Berhasil" : "Gagal",
        reason: o.message,
      })),
      ...syncRows
        .filter((r) => r.status === "not_found" || r.status === "duplicate" || r.status === "empty_code")
        .map((r) => ({
          excelRowNumber: r.excelRowNumber,
          kodeAset: r.kodeAsetExcel || "-",
          namaAset: r.namaAsetExcel,
          status: STATUS_META[r.status].label,
          reason:
            r.status === "duplicate"
              ? `${r.duplicateCount} aset di database memakai kode ini — perlu review manual`
              : r.status === "not_found"
              ? "Tidak ada aset dengan Kode Aset ini"
              : "Kode Aset kosong di Excel, tidak dicocokkan berdasarkan nama",
        })),
    ];

    setReportRows(report);
    setResult({
      success,
      failed,
      skipped,
      notFound: summary.notFound,
      duplicate: summary.duplicate,
    });
    setStep("done");
    isSyncingRef.current = false;
  };

  const resetWizard = () => {
    revokeSyncRowImages(syncRows);
    handoffConsumedRef.current = null;
    setStep("upload");
    setFile(null);
    setWorkbook(null);
    setZip(null);
    setSheetName("");
    setCompanyId("");
    setSyncRows([]);
    setSelectedKeys(new Set());
    setMode("skip");
    setResult(null);
    setReportRows([]);
    setSyncProgress({ done: 0, total: 0 });
  };

  useEffect(() => {
    return () => revokeSyncRowImages(syncRows);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      {step === "upload" && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
          <label className="file-drop py-14">
            <UploadCloud className="text-slate-400" size={30} />
            <span className="text-sm font-medium text-slate-600">Klik untuk upload file Excel (.xlsx/.xls)</span>
            <span className="text-xs text-slate-400">
              Gunakan file Excel yang sama seperti proses import sebelumnya — data aset TIDAK dibuat ulang, hanya
              fotonya yang dicocokkan lewat Kode Aset.
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

      {step === "analyzing" && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center space-y-4">
          <div className="mx-auto h-10 w-10 rounded-full border-2 border-slate-200 border-t-slate-900 animate-spin" />
          <p className="text-sm font-medium text-slate-700">Menganalisa file Excel...</p>
          <div className="mx-auto max-w-sm space-y-1 text-left text-sm text-slate-500">
            <p>
              File: <span className="font-medium text-slate-800">{file?.name}</span>
            </p>
            <p>
              Sheet: <span className="font-medium text-slate-800">{sheetName}</span>
            </p>
            <p>
              Perusahaan: <span className="font-medium text-slate-800">{company?.name || handoff?.companyName}</span>
            </p>
          </div>
          <p className="text-xs text-slate-400">Mencocokkan Kode Aset dan mengekstrak foto bukti fisik...</p>
        </div>
      )}

      {step === "preview" && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
            <SummaryCard label="Data Excel" value={summary.total} tone="neutral" />
            <SummaryCard label="Aset Ditemukan" value={summary.assetFound} tone="neutral" />
            <SummaryCard label="Foto Ditemukan" value={summary.photoFound} tone="neutral" />
            <SummaryCard label="Siap Sinkron" value={summary.ready} tone="success" />
            <SummaryCard label="Sudah Ada Foto" value={summary.hasPhoto} tone="warning" />
            <SummaryCard label="Tidak Ada Foto" value={summary.noPhoto} tone="slate" />
            <SummaryCard label="Aset Tidak Ditemukan" value={summary.notFound} tone="error" />
            <SummaryCard label="Duplicate" value={summary.duplicate} tone="error" />
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
            <div>
              <p className="mb-2 text-xs font-medium text-slate-500">Foto yang sudah ada di aset existing</p>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    { key: "skip", label: "Lewati foto yang sudah ada" },
                    { key: "overwrite", label: "Timpa foto existing" },
                    { key: "append", label: "Tambahkan sebagai foto baru" },
                  ] as { key: OverwriteMode; label: string }[]
                ).map((opt) => (
                  <label
                    key={opt.key}
                    className={`inline-flex cursor-pointer items-center gap-2 rounded-xl border px-3 py-2 text-sm font-medium ${
                      mode === opt.key ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    <input
                      type="radio"
                      name="overwrite-mode"
                      className="hidden"
                      checked={mode === opt.key}
                      onChange={() => handleModeChange(opt.key)}
                    />
                    {opt.label}
                  </label>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-slate-400">
                Default: foto yang sudah ada TIDAK ditimpa otomatis. Aktifkan &quot;Timpa&quot;/&quot;Tambahkan&quot; secara sadar
                untuk memproses baris berstatus &quot;Sudah Ada Foto&quot;.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
              <button
                type="button"
                onClick={handleSelectAllReady}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Pilih Semua Siap Sinkron
              </button>
              <button
                type="button"
                onClick={handleSelectOnlyNoPhoto}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Hanya Aset Tanpa Foto
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
                  Sinkronkan {selectedCount} Foto
                </button>
              </div>
            </div>

            <div className="overflow-x-auto max-h-[32rem] overflow-y-auto rounded-xl border border-slate-100">
              <table className="w-full min-w-[1200px] text-sm">
                <thead className="sticky top-0 bg-slate-50">
                  <tr className="text-left text-slate-500 border-b border-slate-200">
                    <th className="px-3 py-2 font-semibold w-8"></th>
                    <th className="px-3 py-2 font-semibold">Row Excel</th>
                    <th className="px-3 py-2 font-semibold">Kode Aset</th>
                    <th className="px-3 py-2 font-semibold">Nama Aset Excel</th>
                    <th className="px-3 py-2 font-semibold">Nama Aset Existing</th>
                    <th className="px-3 py-2 font-semibold">Perusahaan</th>
                    <th className="px-3 py-2 font-semibold">Foto Excel</th>
                    <th className="px-3 py-2 font-semibold">Foto Existing</th>
                    <th className="px-3 py-2 font-semibold">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {syncRows.map((row) => {
                    const meta = STATUS_META[row.status];
                    const eligible = isEligible(row, mode);
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
                        <td className="px-3 py-2 text-slate-500">{row.excelRowNumber}</td>
                        <td className="px-3 py-2 font-mono text-xs text-slate-700 whitespace-nowrap">{row.kodeAsetExcel || "-"}</td>
                        <td className="px-3 py-2 text-slate-800">{row.namaAsetExcel}</td>
                        <td className="px-3 py-2 text-slate-500">{row.matchedAsset?.assetName || "-"}</td>
                        <td className="px-3 py-2 text-slate-500">{row.matchedAsset?.companyOwnerName || "-"}</td>
                        <td className="px-3 py-2">
                          {row.excelImages.length > 0 ? (
                            <button
                              type="button"
                              onClick={() =>
                                setLightbox({
                                  images: row.excelImages.map((img) => ({ src: img.objectUrl, label: img.fileName })),
                                  title: row.namaAsetExcel,
                                })
                              }
                              className="block h-10 w-10 overflow-hidden rounded-lg border border-slate-200 hover:opacity-80"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={row.excelImages[0].objectUrl} alt="" className="h-full w-full object-cover" />
                            </button>
                          ) : (
                            <span className="text-xs text-slate-300">-</span>
                          )}
                        </td>
                        <td className="px-3 py-2">
                          {row.matchedAsset && row.matchedAsset.physicalEvidenceImages.length > 0 ? (
                            <button
                              type="button"
                              onClick={() =>
                                setLightbox({
                                  images: (row.matchedAsset?.physicalEvidenceImages || []).map((url, i) => ({
                                    src: url,
                                    label: `Foto ${i + 1}`,
                                  })),
                                  title: row.matchedAsset?.assetName,
                                })
                              }
                              className="block h-10 w-10 overflow-hidden rounded-lg border border-slate-200 hover:opacity-80"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={row.matchedAsset.physicalEvidenceImages[0]} alt="" className="h-full w-full object-cover" />
                            </button>
                          ) : (
                            <span className="text-xs text-slate-300">-</span>
                          )}
                        </td>
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
            Sinkronisasi Foto {syncProgress.done} / {syncProgress.total}
          </p>
          {syncingText && <p className="text-xs text-slate-500">{syncingText}</p>}
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
          <h2 className="text-lg font-semibold text-slate-900">Sinkronisasi Foto Selesai</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-xl mx-auto text-left">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
              <p className="text-xl font-semibold text-emerald-700">{result.success}</p>
              <p className="text-xs text-emerald-700 mt-0.5 inline-flex items-center gap-1"><CheckCircle2 size={12} /> Berhasil</p>
            </div>
            <div className="rounded-xl border border-red-200 bg-red-50 p-3">
              <p className="text-xl font-semibold text-red-700">{result.failed}</p>
              <p className="text-xs text-red-700 mt-0.5 inline-flex items-center gap-1"><XCircle size={12} /> Gagal</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
              <p className="text-xl font-semibold text-slate-700">{result.skipped}</p>
              <p className="text-xs text-slate-500 mt-0.5">Dilewati</p>
            </div>
            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
              <p className="text-xl font-semibold text-amber-700">{result.notFound}</p>
              <p className="text-xs text-amber-700 mt-0.5">Tidak Ditemukan</p>
            </div>
          </div>
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
              onClick={() => downloadErrorReportXlsx(reportRows, `Sinkronisasi Foto - ${file?.name || "sync"}`)}
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

      <ImageLightboxModal
        open={!!lightbox}
        images={lightbox?.images || []}
        title={lightbox?.title}
        onClose={() => setLightbox(null)}
      />

      <Toast toast={toast} onClose={() => setToast(null)} />
    </div>
  );
}
