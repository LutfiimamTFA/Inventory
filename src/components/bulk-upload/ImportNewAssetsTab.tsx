"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";
import JSZip from "jszip";
import {
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  query,
  serverTimestamp,
  where,
  writeBatch,
} from "firebase/firestore";
import {
  UploadCloud,
  Download,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Copy,
  ArrowLeft,
  ArrowRight,
  ImageOff,
  Image as ImageIcon,
} from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { fetchHrpBrands } from "@/lib/hrp";
import { AssetCategory, AssetImportBatch, AssetLocationNode, HrpBrand } from "@/lib/types";
import {
  detectSheetHeader,
  downloadErrorReportXlsx,
  getSheetRowsAoa,
  parseSheetRows,
} from "@/lib/import/excel";
import { extractEmbeddedImagesForSheet, findColumnIndex, groupImagesByRow } from "@/lib/import/excel-images";
import {
  MappedImportRow,
  finalizeGeneratedCodes,
  mapImportRow,
  revokePendingImages,
} from "@/lib/import/asset-row-mapper";
import { ensureCanonicalCategoriesExist, ensureCategoriesForRawNames } from "@/lib/import/category-seed";
import {
  createAssetCodeAllocator,
  findExistingAssetCodes,
  findInFileDuplicateCodes,
} from "@/lib/import/asset-code-batch";
import { runWithConcurrencyLimit, uploadImageWithRetry, buildPhysicalEvidenceFileName } from "@/lib/import/asset-image-upload";
import { getAssetFilePreviewUrl } from "@/lib/drive-file-id";
import { PhotoSyncHandoff } from "@/lib/import/asset-photo-sync";
import Badge from "@/components/Badge";
import SearchableSelect, { SearchableSelectItem } from "@/components/SearchableSelect";
import ConfirmModal from "@/components/ConfirmModal";
import ImageLightboxModal, { LightboxImage } from "@/components/ImageLightboxModal";
import { Toast, ToastState } from "@/components/Toast";
import { formatCurrency } from "@/lib/utils";

// Google Apps Script/Drive jangan dibombardir request bersamaan — mulai
// dari 2-3, jangan langsung 10-20 paralel.
const IMAGE_UPLOAD_CONCURRENCY = 3;

type WizardStep = "upload" | "configure" | "preview" | "importing" | "done";

const MAX_OPS_PER_BATCH = 450;

const STATUS_BADGE: Record<MappedImportRow["status"], { label: string; colorClass: string }> = {
  ready: { label: "Siap Import", colorClass: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  warning: { label: "Warning", colorClass: "bg-amber-50 text-amber-700 border-amber-200" },
  error: { label: "Error", colorClass: "bg-red-50 text-red-700 border-red-200" },
  duplicate: { label: "Duplicate", colorClass: "bg-slate-800 text-slate-100 border-slate-800" },
};

export default function ImportNewAssetsTab({
  onNeedPhotoSync,
}: {
  onNeedPhotoSync: (handoff: PhotoSyncHandoff) => void;
}) {
  const router = useRouter();
  const { firebaseUser, assetUser, role, loading } = useAuth();
  const authReady = !loading && !!firebaseUser && !!assetUser && !!role;
  // Section "Rombak permission Asset" — HANYA Super Admin/Asset Finance
  // yang boleh melihat & menyimpan field finance (Harga Perolehan/Invoice)
  // lewat Import Aset. Asset Admin tetap boleh import, tapi field finance
  // di Excel-nya tidak pernah ditulis ke Firestore (lihat mapImportRow ctx
  // di bawah) — Firestore rules (isAssetAdminOperationalCreate) menegakkan
  // ini juga di backend, bukan cuma di UI.
  const canManageFinance = role === "super_admin" || role === "asset_finance";

  const [step, setStep] = useState<WizardStep>("upload");
  const [toast, setToast] = useState<ToastState | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [workbook, setWorkbook] = useState<XLSX.WorkBook | null>(null);
  const [zip, setZip] = useState<JSZip | null>(null);
  const [sheetName, setSheetName] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [companies, setCompanies] = useState<HrpBrand[]>([]);
  const [loadingCompanies, setLoadingCompanies] = useState(true);

  const [categories, setCategories] = useState<AssetCategory[]>([]);
  const [locations, setLocations] = useState<AssetLocationNode[]>([]);

  const [preparing, setPreparing] = useState(false);
  const [mappedRows, setMappedRows] = useState<MappedImportRow[]>([]);

  // Sheet+company yang dipilih SUDAH PERNAH diimport — jangan tawarkan
  // "lanjut import lagi" (itulah akar duplicate lama), arahkan ke
  // Sinkronkan Foto Excel lewat onNeedPhotoSync (lihat modal di bawah).
  const [reimportWarning, setReimportWarning] = useState<AssetImportBatch | null>(null);

  const isImportingRef = useRef(false);
  const [importProgress, setImportProgress] = useState({ done: 0, total: 0 });
  const [importResult, setImportResult] = useState<{
    success: number;
    warning: number;
    failed: number;
    duplicate: number;
  } | null>(null);
  const [failedRowsForReport, setFailedRowsForReport] = useState<MappedImportRow[]>([]);
  const [lightbox, setLightbox] = useState<{ images: LightboxImage[]; title?: string } | null>(null);
  const [uploadingImagesText, setUploadingImagesText] = useState("");
  const [importPhase, setImportPhase] = useState<"images" | "data">("images");
  const [imageProgress, setImageProgress] = useState({ done: 0, total: 0 });

  useEffect(() => {
    if (!authReady) return;
    const unsub = onSnapshot(collection(db, "asset_categories"), (snap) => {
      setCategories(
        snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as AssetCategory))
          .filter((c) => c.status === "active")
      );
    });
    return () => unsub();
  }, [authReady]);

  useEffect(() => {
    if (!authReady) return;
    const unsub = onSnapshot(collection(db, "asset_locations"), (snap) => {
      setLocations(snap.docs.map((d) => ({ id: d.id, ...d.data() } as AssetLocationNode)));
    });
    return () => unsub();
  }, [authReady]);

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
      // Dibaca dua kali dari buffer yang sama: SheetJS untuk data cell,
      // JSZip untuk embedded image (drawing) — SheetJS tidak pernah
      // mengekstrak gambar, lihat lib/import/excel-images.ts.
      const z = await JSZip.loadAsync(buffer);
      setFile(f);
      setWorkbook(wb);
      setZip(z);
      setSheetName(wb.SheetNames[0]);
      setStep("configure");
    } catch (err) {
      console.error("[Bulk Upload] gagal membaca file", err);
      setToast({ type: "error", message: "Gagal membaca file Excel. Pastikan formatnya .xlsx/.xls." });
    }
  };

  async function checkPriorImport(): Promise<AssetImportBatch | null> {
    if (!file || !sheetName || !companyId) return null;
    // SENGAJA tidak menyaring by fileName — file yang sama bisa saja
    // di-rename (mis. "Label Aset EGC (1).xlsx"), jadi deteksi "sheet ini
    // sudah pernah diimport" harus tetap kena walau nama file berubah.
    // sheetName+companyId adalah identitas konseptual dataset ini, bukan
    // nama file. Riwayat batch ini hanya early-detection UX — pencocokan
    // sungguhan tetap by Kode Aset terhadap Firestore (lihat asset-photo-sync.ts).
    const q = query(
      collection(db, "asset_import_batches"),
      where("sheetName", "==", sheetName),
      where("companyId", "==", companyId),
      limit(1)
    );
    const snap = await getDocs(q);
    if (snap.empty) return null;
    const d = snap.docs[0];
    return { id: d.id, ...d.data() } as AssetImportBatch;
  }

  async function buildPreview() {
    if (!workbook || !zip || !sheetName || !companyId || !company) return;
    setPreparing(true);
    try {
      const aoa = getSheetRowsAoa(workbook, sheetName);
      const header = detectSheetHeader(aoa);
      if (!header) {
        setToast({
          type: "error",
          message: `Sheet "${sheetName}" tidak punya kolom "Nama Aset" yang bisa dikenali — pastikan formatnya sesuai template.`,
        });
        setPreparing(false);
        return;
      }

      const parsed = parseSheetRows(aoa, header);
      if (parsed.length === 0) {
        setToast({ type: "error", message: `Tidak ada baris data aset yang ditemukan di sheet "${sheetName}".` });
        setPreparing(false);
        return;
      }
      const explicitCodes = parsed.map((r) => r.kodeAset).filter(Boolean);
      const inFileDup = findInFileDuplicateCodes(explicitCodes);
      const existingCodes = await findExistingAssetCodes(explicitCodes);
      const duplicateCodes = new Set<string>([...inFileDup, ...existingCodes]);

      // Bukti Fisik Aset (embedded image) — ekstrak HANYA gambar yang
      // anchor-nya persis di kolom "Bukti Fisik Aset" sheet ini, lalu
      // dipetakan ke baris Excel yang sama (bukan urutan gambar/index array).
      const buktiFisikColumn = findColumnIndex(header.columnMap, "buktiFisikAset");
      const imagesByRow =
        buktiFisikColumn !== null
          ? groupImagesByRow(await extractEmbeddedImagesForSheet(zip, sheetName, buktiFisikColumn))
          : new Map();

      // Revoke object URL preview dari percobaan preview sebelumnya (mis.
      // user klik "Kembali" lalu ganti sheet) supaya tidak jadi memory leak.
      revokePendingImages(mappedRows);

      const currentUserUid = firebaseUser?.uid || assetUser?.uid || "";
      const currentUserName = assetUser?.name || firebaseUser?.email || "";
      const importBatchId = doc(collection(db, "asset_import_batches")).id;

      // Master Kategori HARUS berisi 6 kategori "Label Aset EGC.xlsx" dulu
      // (Tanah/Perabot dan Meubelair/dst dengan kode persis sesuai ticket),
      // baru kategori APA PUN di sheet ini yang masih belum ada dibuat
      // otomatis — supaya tidak ada baris yang "terpaksa" masuk ke kategori
      // yang tidak relevan (mis. "Elektronik") hanya karena belum ada
      // kategori yang benar di Master Kategori.
      let categoriesForMapping = categories;
      try {
        categoriesForMapping = await ensureCanonicalCategoriesExist(categoriesForMapping, currentUserUid, currentUserName);
        categoriesForMapping = await ensureCategoriesForRawNames(
          parsed.map((r) => r.jenisAset),
          categoriesForMapping,
          currentUserUid,
          currentUserName
        );
        setCategories(categoriesForMapping);
      } catch (err) {
        console.error("[Bulk Upload] gagal menyiapkan Master Kategori", err);
        setToast({ type: "error", message: "Gagal menyiapkan Master Kategori dari Excel. Kategori yang belum ada mungkin tidak otomatis dibuat." });
      }

      const mapped = parsed.map((r) =>
        mapImportRow(r, {
          categories: categoriesForMapping,
          locations,
          companyId,
          companyName: company.name,
          currentUserUid,
          currentUserName,
          importBatchId,
          duplicateCodes,
          imagesByRow,
          canManageFinance,
        })
      );
      setMappedRows(mapped);
      setStep("preview");
    } catch (err) {
      console.error("[Bulk Upload] gagal menyiapkan preview", err);
      setToast({ type: "error", message: "Gagal menyiapkan preview data." });
    } finally {
      setPreparing(false);
    }
  }

  const handleProceedToPreview = async () => {
    setPreparing(true);
    const prior = await checkPriorImport();
    setPreparing(false);
    if (prior) {
      // JANGAN tawarkan "lanjut import lagi" — sheet+company ini sudah
      // pernah masuk, tampilkan modal yang mengarahkan ke Sinkronkan Foto
      // (lihat ConfirmModal di bawah), bukan buildPreview() untuk aset baru.
      setReimportWarning(prior);
      return;
    }
    await buildPreview();
  };

  const summary = useMemo(() => {
    const total = mappedRows.length;
    const ready = mappedRows.filter((r) => r.status === "ready").length;
    const warning = mappedRows.filter((r) => r.status === "warning").length;
    const error = mappedRows.filter((r) => r.status === "error").length;
    const duplicate = mappedRows.filter((r) => r.status === "duplicate").length;
    const needsCode = mappedRows.filter((r) => r.needsGeneratedCode).length;
    const locationUnlinked = mappedRows.filter((r) =>
      r.issues.some((i) => i.includes("belum terhubung ke Master Lokasi"))
    ).length;
    return { total, ready, warning, error, duplicate, needsCode, locationUnlinked };
  }, [mappedRows]);

  const handleImport = async () => {
    if (isImportingRef.current) return;
    const importable = mappedRows.filter((r) => r.payload && (r.status === "ready" || r.status === "warning"));
    if (importable.length === 0) {
      setToast({ type: "error", message: "Tidak ada baris yang bisa diimport." });
      return;
    }

    isImportingRef.current = true;
    setStep("importing");
    setImportPhase("images");
    setImportProgress({ done: 0, total: importable.length });
    setImageProgress({ done: 0, total: 0 });
    setUploadingImagesText("");

    try {
      const allocator = createAssetCodeAllocator();
      await finalizeGeneratedCodes(importable, allocator);

      const docsToWrite = importable.map((r) => ({
        row: r,
        ref: doc(collection(db, "assets")),
      }));

      // ── Fase 1: upload SEMUA "Bukti Fisik Aset" ke Google Drive (pipeline
      // yang sama dengan foto aset manual — uploadToDrive -> /api/upload-drive
      // -> Apps Script -> Drive, BUKAN Firebase Storage), dengan batas
      // konkurensi (jangan pernah upload 100+ gambar sekaligus). Satu foto
      // gagal (setelah retry) TIDAK menggagalkan baris/aset — cuma menandai
      // baris itu jadi Warning.
      const imageTasks = docsToWrite.flatMap(({ ref, row }) =>
        row.pendingImages.map((image, index) => ({ ref, row, image, index }))
      );

      if (imageTasks.length > 0) {
        setImageProgress({ done: 0, total: imageTasks.length });
        let done = 0;
        const uploadResults = await runWithConcurrencyLimit(
          imageTasks.map((task) => async () => {
            setUploadingImagesText(`Mengupload bukti fisik ${task.row.preview.namaAset}...`);
            const fileName = buildPhysicalEvidenceFileName(task.row.preview.kodeAset, task.index, task.image.mimeType);
            try {
              const uploaded = await uploadImageWithRetry(task.image.blob, fileName, task.image.mimeType, {
                assetCode: task.row.preview.kodeAset,
                assetName: task.row.preview.namaAset,
              });
              return { ...task, url: getAssetFilePreviewUrl(uploaded.fileId), error: null as unknown };
            } catch (error) {
              const errorInfo =
                error instanceof Error
                  ? { name: error.name, message: error.message, stack: error.stack }
                  : { raw: String(error) };
              console.error("[Bulk Upload] Google Drive upload gagal", {
                assetCode: task.row.preview.kodeAset,
                fileName,
                fileSize: task.image.blob.size,
                mimeType: task.image.mimeType,
                error: errorInfo,
              });
              return { ...task, url: null as string | null, error };
            }
          }),
          IMAGE_UPLOAD_CONCURRENCY,
          () => {
            done++;
            setImageProgress({ done, total: imageTasks.length });
          }
        );

        const urlsByAssetId = new Map<string, string[]>();
        uploadResults.forEach(({ ref, row, url, error, image }) => {
          if (url) {
            const list = urlsByAssetId.get(ref.id) || [];
            list.push(url);
            urlsByAssetId.set(ref.id, list);
          }
          if (error) {
            if (row.status === "ready") row.status = "warning";
            row.issues.push(`Foto "${image.fileName}" gagal diupload setelah beberapa percobaan`);
          }
        });
        docsToWrite.forEach(({ ref, row }) => {
          if (row.payload) row.payload.physicalEvidenceImages = urlsByAssetId.get(ref.id) || [];
        });
      }

      revokePendingImages(importable);
      setUploadingImagesText("");
      setImportPhase("data");

      // ── Fase 2: tulis dokumen aset (batch, chunk 450, commit sekuensial).
      for (let i = 0; i < docsToWrite.length; i += MAX_OPS_PER_BATCH) {
        const chunk = docsToWrite.slice(i, i + MAX_OPS_PER_BATCH);
        const batch = writeBatch(db);
        chunk.forEach(({ ref, row }) => batch.set(ref, row.payload as Record<string, unknown>));
        await batch.commit();
        setImportProgress({ done: Math.min(i + chunk.length, docsToWrite.length), total: docsToWrite.length });
      }

      // Hitung ulang status SETELAH fase upload foto (bisa menaikkan
      // sebagian baris dari "ready" ke "warning") — jangan pakai `summary`
      // lama yang dihitung sebelum upload.
      const finalWarning = mappedRows.filter((r) => r.status === "warning").length;

      const currentUserUid = firebaseUser?.uid || assetUser?.uid || "";
      const currentUserName = assetUser?.name || firebaseUser?.email || "";
      await writeBatch(db)
        .set(doc(collection(db, "asset_import_batches")), {
          fileName: file?.name || "",
          sheetName,
          companyId,
          companyName: company?.name || "",
          totalRows: mappedRows.length,
          successRows: importable.length,
          warningRows: finalWarning,
          errorRows: summary.error,
          duplicateRows: summary.duplicate,
          importedAt: serverTimestamp(),
          importedByUid: currentUserUid,
          importedByName: currentUserName,
        })
        .commit();

      setImportResult({
        success: importable.length,
        warning: finalWarning,
        failed: summary.error,
        duplicate: summary.duplicate,
      });
      setFailedRowsForReport(mappedRows.filter((r) => r.status !== "ready"));
      setStep("done");
    } catch (err) {
      console.error("[Bulk Upload] import gagal", err);
      setToast({ type: "error", message: "Import gagal di tengah proses. Sebagian data mungkin sudah tersimpan — cek halaman Assets." });
      setStep("preview");
    } finally {
      isImportingRef.current = false;
    }
  };

  const resetWizard = () => {
    revokePendingImages(mappedRows);
    setStep("upload");
    setFile(null);
    setWorkbook(null);
    setZip(null);
    setSheetName("");
    setCompanyId("");
    setMappedRows([]);
    setImportResult(null);
    setImportProgress({ done: 0, total: 0 });
    setImageProgress({ done: 0, total: 0 });
    setFailedRowsForReport([]);
  };

  // Revoke SEMUA object URL preview kalau komponen unmount (mis. user
  // navigasi keluar halaman di tengah preview, atau pindah tab) — jangan
  // cuma diandalkan resetWizard yang hanya jalan lewat interaksi tombol.
  useEffect(() => {
    return () => revokePendingImages(mappedRows);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div>
      <WizardStepper step={step} />

      {step === "upload" && <UploadStep onFile={handleFile} />}

      {step === "configure" && workbook && (
        <ConfigureStep
          fileName={file?.name || ""}
          sheetNames={workbook.SheetNames}
          sheetName={sheetName}
          onSheetChange={setSheetName}
          companyItems={companyItems}
          companyId={companyId}
          onCompanyChange={setCompanyId}
          loadingCompanies={loadingCompanies}
          preparing={preparing}
          onBack={resetWizard}
          onNext={handleProceedToPreview}
        />
      )}

      {step === "preview" && (
        <PreviewStep
          summary={summary}
          rows={mappedRows}
          onBack={() => setStep("configure")}
          onImport={handleImport}
          canManageFinance={canManageFinance}
          onPreviewImages={(row) =>
            setLightbox({
              images: row.pendingImages.map((img) => ({ src: img.objectUrl, label: img.fileName })),
              title: row.preview.namaAset,
            })
          }
        />
      )}

      {step === "importing" && (
        <ImportingStep
          phase={importPhase}
          dataProgress={importProgress}
          imageProgress={imageProgress}
          uploadingImagesText={uploadingImagesText}
        />
      )}

      {step === "done" && importResult && (
        <DoneStep
          result={importResult}
          onViewAssets={() => router.push("/assets")}
          onDownloadErrorReport={() =>
            downloadErrorReportXlsx(
              failedRowsForReport.map((r) => ({
                excelRowNumber: r.excelRowNumber,
                kodeAset: r.preview.kodeAset,
                namaAset: r.preview.namaAset,
                status: STATUS_BADGE[r.status].label,
                reason: r.issues.join("; ") || "-",
              })),
              file?.name || "import"
            )
          }
          onNewImport={resetWizard}
        />
      )}

      <ConfirmModal
        open={!!reimportWarning}
        title="Data Aset Sudah Pernah Diimport"
        confirmLabel="Sinkronkan Foto"
        onCancel={() => setReimportWarning(null)}
        onConfirm={() => {
          if (!reimportWarning || !workbook || !zip) return;
          const handoff: PhotoSyncHandoff = {
            file: file as File,
            workbook,
            zip,
            sheetName: reimportWarning.sheetName,
            companyId: reimportWarning.companyId,
            companyName: reimportWarning.companyName,
          };
          setReimportWarning(null);
          onNeedPhotoSync(handoff);
        }}
      >
        {reimportWarning && (
          <div className="text-sm text-slate-600 space-y-1.5">
            <p>
              Sheet <span className="font-medium text-slate-800">{reimportWarning.sheetName}</span> untuk perusahaan{" "}
              <span className="font-medium text-slate-800">{reimportWarning.companyName}</span> sudah pernah diimport
              sebanyak <span className="font-medium text-slate-800">{reimportWarning.successRows}</span> aset.
            </p>
            <p>
              Untuk menghindari duplikasi, data aset tidak akan diimport ulang. Anda dapat melanjutkan untuk
              menyinkronkan foto/bukti fisik dari Excel ke aset yang sudah ada berdasarkan Kode Aset.
            </p>
          </div>
        )}
      </ConfirmModal>

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

function WizardStepper({ step }: { step: WizardStep }) {
  const steps: { key: WizardStep; label: string }[] = [
    { key: "upload", label: "Upload Excel" },
    { key: "configure", label: "Sheet & Perusahaan" },
    { key: "preview", label: "Preview & Validasi" },
    { key: "importing", label: "Import" },
    { key: "done", label: "Selesai" },
  ];
  const activeIndex = steps.findIndex((s) => s.key === step);
  return (
    <div className="mb-5 flex flex-wrap items-center gap-2 text-xs font-medium text-slate-400">
      {steps.map((s, i) => (
        <div key={s.key} className="flex items-center gap-2">
          <span
            className={
              i < activeIndex
                ? "flex items-center gap-1 text-emerald-600"
                : i === activeIndex
                ? "flex items-center gap-1 text-slate-900"
                : "flex items-center gap-1"
            }
          >
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-full border text-[10px] ${
                i < activeIndex
                  ? "border-emerald-500 bg-emerald-500 text-white"
                  : i === activeIndex
                  ? "border-slate-900 bg-slate-900 text-white"
                  : "border-slate-300 text-slate-400"
              }`}
            >
              {i + 1}
            </span>
            {s.label}
          </span>
          {i < steps.length - 1 && <span className="text-slate-300">/</span>}
        </div>
      ))}
    </div>
  );
}

function UploadStep({ onFile }: { onFile: (f: File) => void }) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
      <label className="file-drop py-14">
        <UploadCloud className="text-slate-400" size={30} />
        <span className="text-sm font-medium text-slate-600">Klik untuk upload file Excel (.xlsx/.xls)</span>
        <span className="text-xs text-slate-400">
          Ikuti format Label Aset EGC.xlsx — header boleh di baris mana pun, dicocokkan berdasarkan nama kolom.
        </span>
        <input
          type="file"
          accept=".xlsx,.xls"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
        />
      </label>
    </div>
  );
}

function ConfigureStep({
  fileName,
  sheetNames,
  sheetName,
  onSheetChange,
  companyItems,
  companyId,
  onCompanyChange,
  loadingCompanies,
  preparing,
  onBack,
  onNext,
}: {
  fileName: string;
  sheetNames: string[];
  sheetName: string;
  onSheetChange: (v: string) => void;
  companyItems: SearchableSelectItem[];
  companyId: string;
  onCompanyChange: (v: string) => void;
  loadingCompanies: boolean;
  preparing: boolean;
  onBack: () => void;
  onNext: () => void;
}) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-5">
      <p className="text-sm text-slate-500 inline-flex items-center gap-1.5">
        <FileSpreadsheet size={15} className="text-slate-400" />
        File terpilih: <span className="font-medium text-slate-800">{fileName}</span>
      </p>

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-slate-500 mb-1.5">
            Pilih Sheet <span className="text-red-500">*</span>
          </label>
          <select value={sheetName} onChange={(e) => onSheetChange(e.target.value)} className="input">
            {sheetNames.map((s) => (
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
            onChange={onCompanyChange}
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
          onClick={onBack}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          <ArrowLeft size={15} /> Ganti File
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={!sheetName || !companyId || preparing}
          className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-teal-500 text-white px-4 py-2.5 text-sm font-medium hover:brightness-105 disabled:opacity-50 shadow-md shadow-blue-900/20"
        >
          {preparing ? "Menyiapkan..." : "Lanjut ke Preview"} <ArrowRight size={15} />
        </button>
      </div>
    </div>
  );
}

export function SummaryCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "neutral" | "success" | "warning" | "error" | "slate";
}) {
  const toneClass = {
    neutral: "text-slate-900",
    success: "text-emerald-600",
    warning: "text-amber-600",
    error: "text-red-600",
    slate: "text-slate-500",
  }[tone];
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3.5">
      <p className={`text-2xl font-semibold ${toneClass}`}>{value}</p>
      <p className="text-xs text-slate-400 mt-0.5">{label}</p>
    </div>
  );
}

function PreviewStep({
  summary,
  rows,
  onBack,
  onImport,
  onPreviewImages,
  canManageFinance,
}: {
  summary: { total: number; ready: number; warning: number; error: number; duplicate: number; needsCode: number; locationUnlinked: number };
  rows: MappedImportRow[];
  onBack: () => void;
  onImport: () => void;
  onPreviewImages: (row: MappedImportRow) => void;
  // Asset Admin TIDAK melihat kolom Harga/Invoice di preview sama sekali
  // (bukan disabled) — datanya tetap ada di row.preview (lihat
  // asset-row-mapper.ts), cuma tidak dirender untuk role ini. Payload yang
  // benar-benar disimpan ke Firestore sudah digating terpisah lewat
  // ctx.canManageFinance di buildPreview().
  canManageFinance: boolean;
}) {
  const importableCount = summary.ready + summary.warning;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        <SummaryCard label="Baris Ditemukan" value={summary.total} tone="neutral" />
        <SummaryCard label="Siap Import" value={summary.ready} tone="success" />
        <SummaryCard label="Warning" value={summary.warning} tone="warning" />
        <SummaryCard label="Error" value={summary.error} tone="error" />
        <SummaryCard label="Duplicate" value={summary.duplicate} tone="slate" />
        <SummaryCard label="Lokasi Belum Terhubung" value={summary.locationUnlinked} tone="warning" />
        <SummaryCard label="Kode Akan Dibuat" value={summary.needsCode} tone="neutral" />
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
        <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
          <h2 className="font-semibold text-slate-800">Preview Data</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onBack}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              <ArrowLeft size={15} /> Kembali
            </button>
            <button
              type="button"
              onClick={onImport}
              disabled={importableCount === 0}
              className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-teal-500 text-white px-4 py-2.5 text-sm font-medium hover:brightness-105 disabled:opacity-50 shadow-md shadow-blue-900/20"
            >
              Import {importableCount} Aset
            </button>
          </div>
        </div>

        <div className="overflow-x-auto max-h-[32rem] overflow-y-auto rounded-xl border border-slate-100">
          <table className="w-full min-w-[1300px] text-sm">
            <thead className="sticky top-0 bg-slate-50">
              <tr className="text-left text-slate-500 border-b border-slate-200">
                <th className="px-3 py-2 font-semibold">No</th>
                <th className="px-3 py-2 font-semibold">Kode Aset</th>
                <th className="px-3 py-2 font-semibold">Nama Aset</th>
                <th className="px-3 py-2 font-semibold">Jenis Aset</th>
                <th className="px-3 py-2 font-semibold">Tgl Perolehan</th>
                {canManageFinance && <th className="px-3 py-2 font-semibold">Harga</th>}
                <th className="px-3 py-2 font-semibold">Qty</th>
                <th className="px-3 py-2 font-semibold">Lokasi</th>
                <th className="px-3 py-2 font-semibold">Kondisi</th>
                {canManageFinance && <th className="px-3 py-2 font-semibold">Invoice</th>}
                <th className="px-3 py-2 font-semibold">Bukti Fisik</th>
                <th className="px-3 py-2 font-semibold">Status Validasi</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const badge = STATUS_BADGE[r.status];
                return (
                  <tr key={r.excelRowNumber} className="border-b border-slate-100 last:border-0 align-top">
                    <td className="px-3 py-2 text-slate-500">{r.preview.no || "-"}</td>
                    <td className="px-3 py-2 font-mono text-xs text-slate-700 whitespace-nowrap">{r.preview.kodeAset}</td>
                    <td className="px-3 py-2 text-slate-800">{r.preview.namaAset}</td>
                    <td className="px-3 py-2 text-slate-500">{r.preview.jenisAset}</td>
                    <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{r.preview.tanggalPerolehan}</td>
                    {canManageFinance && (
                      <td className="px-3 py-2 text-slate-500 whitespace-nowrap">{formatCurrency(r.preview.harga || undefined)}</td>
                    )}
                    <td className="px-3 py-2 text-slate-500">{r.preview.qty}</td>
                    <td className="px-3 py-2 text-slate-500">{r.preview.lokasi}</td>
                    <td className="px-3 py-2 text-slate-500">{r.preview.kondisi}</td>
                    {canManageFinance && <td className="px-3 py-2 text-slate-500">{r.preview.invoice}</td>}
                    <td className="px-3 py-2">
                      {r.pendingImages.length > 0 ? (
                        <button
                          type="button"
                          onClick={() => onPreviewImages(r)}
                          className="flex items-center gap-2 rounded-lg border border-slate-200 p-1 pr-2 hover:bg-slate-50"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={r.pendingImages[0].objectUrl}
                            alt={r.preview.namaAset}
                            className="h-9 w-9 rounded object-cover"
                          />
                          <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-600">
                            <ImageIcon size={12} />
                            {r.pendingImages.length} Foto
                          </span>
                        </button>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs text-slate-400">
                          <ImageOff size={12} />
                          Tidak Ada Foto
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <Badge label={badge.label} colorClass={badge.colorClass} />
                      {r.issues.length > 0 && (
                        <p className="mt-1 max-w-[220px] text-[11px] text-slate-400">{r.issues.join(" · ")}</p>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ImportingStep({
  phase,
  dataProgress,
  imageProgress,
  uploadingImagesText,
}: {
  phase: "images" | "data";
  dataProgress: { done: number; total: number };
  imageProgress: { done: number; total: number };
  uploadingImagesText: string;
}) {
  const showImagePhase = phase === "images" && imageProgress.total > 0;
  const progress = showImagePhase ? imageProgress : dataProgress;
  const pct = progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100);
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center space-y-4">
      <div className="mx-auto h-10 w-10 rounded-full border-2 border-slate-200 border-t-slate-900 animate-spin" />
      <p className="text-sm font-medium text-slate-700">
        {showImagePhase
          ? `Mengupload bukti fisik ${imageProgress.done} / ${imageProgress.total} foto`
          : `Mengimport aset ${dataProgress.done} / ${dataProgress.total}`}
      </p>
      {showImagePhase && uploadingImagesText && (
        <p className="text-xs text-slate-500">{uploadingImagesText}</p>
      )}
      <div className="mx-auto max-w-md h-2 rounded-full bg-slate-100 overflow-hidden">
        <div className="h-full bg-gradient-to-r from-blue-600 to-teal-500 transition-all" style={{ width: `${pct}%` }} />
      </div>
      <p className="text-xs text-slate-400">Jangan tutup halaman ini sampai proses selesai.</p>
    </div>
  );
}

function DoneStep({
  result,
  onViewAssets,
  onDownloadErrorReport,
  onNewImport,
}: {
  result: { success: number; warning: number; failed: number; duplicate: number };
  onViewAssets: () => void;
  onDownloadErrorReport: () => void;
  onNewImport: () => void;
}) {
  const hasFailures = result.failed > 0 || result.duplicate > 0;
  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center space-y-5">
      <CheckCircle2 size={40} className="mx-auto text-emerald-500" />
      <h2 className="text-lg font-semibold text-slate-900">Import Selesai</h2>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 max-w-xl mx-auto text-left">
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
          <p className="text-xl font-semibold text-emerald-700">{result.success}</p>
          <p className="text-xs text-emerald-700 mt-0.5 inline-flex items-center gap-1"><CheckCircle2 size={12} /> Berhasil</p>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="text-xl font-semibold text-amber-700">{result.warning}</p>
          <p className="text-xs text-amber-700 mt-0.5 inline-flex items-center gap-1"><AlertTriangle size={12} /> Warning</p>
        </div>
        <div className="rounded-xl border border-red-200 bg-red-50 p-3">
          <p className="text-xl font-semibold text-red-700">{result.failed}</p>
          <p className="text-xs text-red-700 mt-0.5 inline-flex items-center gap-1"><XCircle size={12} /> Gagal</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <p className="text-xl font-semibold text-slate-700">{result.duplicate}</p>
          <p className="text-xs text-slate-500 mt-0.5 inline-flex items-center gap-1"><Copy size={12} /> Duplicate Dilewati</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
        <button
          type="button"
          onClick={onViewAssets}
          className="rounded-xl bg-gradient-to-r from-blue-600 to-teal-500 text-white px-4 py-2.5 text-sm font-medium hover:brightness-105 shadow-md shadow-blue-900/20"
        >
          Lihat Data Aset
        </button>
        {hasFailures && (
          <button
            type="button"
            onClick={onDownloadErrorReport}
            className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <Download size={15} /> Download Error Report
          </button>
        )}
        <button
          type="button"
          onClick={onNewImport}
          className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Import File Lain
        </button>
      </div>
    </div>
  );
}
