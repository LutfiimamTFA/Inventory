import { serverTimestamp } from "firebase/firestore";
import { cleanFirestoreData } from "@/lib/firestore-helpers";
import { buildFullPath, resolveAreaPic, resolveLocationSelectionForNode } from "@/lib/locations";
import { TRACKING_MODE_LABEL } from "@/lib/utils";
import { AssetCategory, AssetLocationNode, AssetStatus } from "@/lib/types";
import { RawImportRow, excelValueToISODate, excelValueToNumber } from "./excel";
import { matchCategory } from "./category-match";
import { matchLocation } from "./location-match";
import {
  isDisposedFromEvidence,
  isKondisiHilang,
  resolveAssetCondition,
  resolveInventoryCondition,
  resolveInvoiceStatus,
} from "./condition-map";
import { createAssetCodeAllocator } from "./asset-code-batch";
import { ExtractedExcelImage } from "./excel-images";

export type ImportRowStatus = "ready" | "warning" | "error" | "duplicate";

// Gambar "Bukti Fisik Aset" hasil ekstrak Excel — BELUM diupload ke Storage
// (baru terjadi saat commit import, lihat asset-image-upload.ts). objectUrl
// HANYA untuk thumbnail preview, WAJIB di-revoke (revokePendingImages) kalau
// baris ini tidak jadi diimport / user ganti file, supaya tidak jadi memory
// leak di browser.
export interface PendingImage {
  fileName: string;
  mimeType: string;
  blob: Blob;
  objectUrl: string;
}

export interface MappedImportRow {
  excelRowNumber: number;
  status: ImportRowStatus;
  issues: string[];
  needsGeneratedCode: boolean;
  categoryCodeForGeneration: string;
  payload: Record<string, unknown> | null;
  pendingImages: PendingImage[];
  preview: {
    no: string;
    kodeAset: string;
    namaAset: string;
    jenisAset: string;
    tanggalPerolehan: string;
    harga: number | null;
    qty: number;
    lokasi: string;
    kondisi: string;
    invoice: string;
  };
}

export interface MapRowContext {
  categories: AssetCategory[];
  locations: AssetLocationNode[];
  companyId: string;
  companyName: string;
  currentUserUid: string;
  currentUserName: string;
  importBatchId: string;
  // Kode yang SUDAH DIPASTIKAN tabrakan sebelum pemetaan baris dimulai —
  // dihitung sekali oleh wizard dari seluruh baris explicit-code (in-file +
  // Firestore), lihat lib/import/asset-code-batch.ts.
  duplicateCodes: Set<string>;
  // Embedded image "Bukti Fisik Aset" per baris Excel (key = excelRowNumber),
  // hasil lib/import/excel-images.ts. Kosong/undefined = sheet ini memang
  // tidak punya embedded image sama sekali — BUKAN error.
  imagesByRow?: Map<number, ExtractedExcelImage[]>;
  // Section "Rombak permission Asset" — Asset Admin BOLEH import, TAPI
  // dilarang menulis field finance (Harga Perolehan/Invoice) walau kolom
  // itu ADA isinya di Excel. Firestore rules (isAssetAdminOperationalCreate)
  // menolak create kalau field ini terisi non-null, jadi payload di sini
  // WAJIB sudah null/kosong duluan untuk importer yang bukan Finance/Super
  // Admin — jangan buang data mentah Excel-nya (masih ada di preview lewat
  // MappedImportRow.preview.harga/invoice), cuma tidak ditulis ke Firestore.
  canManageFinance: boolean;
}

export function revokePendingImages(rows: MappedImportRow[]) {
  rows.forEach((row) => row.pendingImages.forEach((img) => URL.revokeObjectURL(img.objectUrl)));
}

const FIXED_TRACKING_MODE = "fixed_location" as const;

// "No" Excel -> assetNumber (number | null). HANYA integer non-negatif yang
// valid — kosong/"-"/desimal/negatif/bukan angka semuanya jadi null, TIDAK
// PERNAH fallback ke nomor baris atau angka acak.
export function parseAssetNumber(rawNo: string): number | null {
  const n = excelValueToNumber(rawNo);
  if (n === null || !Number.isInteger(n) || n < 0) return null;
  return n;
}

export function mapImportRow(raw: RawImportRow, ctx: MapRowContext): MappedImportRow {
  const issues: string[] = [];
  let status: ImportRowStatus = "ready";

  // ── Kode Aset — WAJIB pakai apa adanya kalau ada di Excel, JANGAN pernah
  // generate ulang. Kosong -> ditandai untuk di-generate wizard sesudah ini
  // (lihat finalizeGeneratedCodes).
  const explicitCode = raw.kodeAset.trim();
  const needsGeneratedCode = !explicitCode;

  // ── Bukti Fisik Aset (embedded image) — dipetakan berdasarkan NOMOR BARIS
  // Excel (bukan index array), supaya header/baris kosong/footer yang
  // dilewati tidak pernah menggeser foto ke aset yang salah.
  const pendingImages: PendingImage[] = (ctx.imagesByRow?.get(raw.excelRowNumber) || []).map((img) => ({
    fileName: img.fileName,
    mimeType: img.mimeType,
    blob: img.blob,
    objectUrl: URL.createObjectURL(img.blob),
  }));

  if (explicitCode && ctx.duplicateCodes.has(explicitCode)) {
    return {
      excelRowNumber: raw.excelRowNumber,
      status: "duplicate",
      issues: ["Kode aset sudah digunakan"],
      needsGeneratedCode: false,
      categoryCodeForGeneration: "",
      payload: null,
      pendingImages,
      preview: {
        no: raw.no,
        kodeAset: explicitCode,
        namaAset: raw.namaAset,
        jenisAset: raw.jenisAset || "-",
        tanggalPerolehan: excelValueToISODate(raw.tanggalPerolehanRaw) || "-",
        harga: excelValueToNumber(raw.hargaPerolehanRaw),
        qty: excelValueToNumber(raw.qtyRaw) || 1,
        lokasi: raw.lokasi || "-",
        kondisi: resolveInventoryCondition(raw.kondisi),
        invoice: raw.invoice || "-",
      },
    };
  }

  // ── Kategori — toleran beda penulisan (alias + fuzzy token match). Tidak
  // match BUKAN error, cuma warning — categoryName tetap diisi teks mentah
  // Excel supaya tidak kosong di tampilan.
  const categoryMatch = matchCategory(raw.jenisAset, ctx.categories);
  if (raw.jenisAset && !categoryMatch.category) {
    issues.push(`Jenis Aset "${raw.jenisAset}" tidak ditemukan di Master Kategori`);
    status = "warning";
  }
  const categoryCodeForGeneration = categoryMatch.category?.categoryCode || "GEN";

  // ── Lokasi — cocokkan ke Master Lokasi; tidak ketemu BUKAN error, data
  // lokasi mentah tetap disimpan (lihat requirement "jangan menolak import").
  const locationMatch = raw.lokasi ? matchLocation(raw.lokasi, ctx.locations) : { node: null, matchedBy: "none" as const };
  if (raw.lokasi && !locationMatch.node) {
    issues.push(`Lokasi "${raw.lokasi}" belum terhubung ke Master Lokasi`);
    status = "warning";
  }

  let locationSelection = { buildingId: "", buildingName: "", floorId: "", floorName: "", roomId: "", roomName: "", areaId: "", areaName: "" };
  let areaPic: ReturnType<typeof resolveAreaPic> = null;
  if (locationMatch.node) {
    locationSelection = resolveLocationSelectionForNode(ctx.locations, locationMatch.node.id);
    areaPic = resolveAreaPic(ctx.locations, {
      buildingId: locationSelection.buildingId,
      floorId: locationSelection.floorId,
      roomId: locationSelection.roomId,
      areaId: locationSelection.areaId,
    });
  }
  const resolvedLocationText = locationMatch.node ? buildFullPath(locationSelection) : raw.lokasi || "";

  // ── Kondisi — TIDAK PERNAH default "Baik" kalau kosong (pakai "Perlu
  // Pemeriksaan"). "Hilang"/bukti fisik disposal dipetakan ke assetStatus
  // yang SUDAH ADA ("lost"/"disposed"), bukan field baru.
  const inventoryCondition = resolveInventoryCondition(raw.kondisi);
  if (!raw.kondisi.trim()) {
    issues.push("Kondisi kosong di Excel — ditandai Perlu Pemeriksaan");
    status = "warning";
  }
  const disposed = isDisposedFromEvidence(raw.buktiFisikAset);
  const lost = !disposed && isKondisiHilang(raw.kondisi);
  const assetStatus: AssetStatus = disposed ? "disposed" : lost ? "lost" : "available";

  // ── Qty — SATU dokumen aset, qty disimpan sebagai angka, TIDAK PERNAH
  // dipecah jadi banyak dokumen.
  let quantity = excelValueToNumber(raw.qtyRaw);
  if (quantity === null || quantity <= 0) {
    if (raw.qtyRaw !== null && raw.qtyRaw !== "") {
      issues.push("Qty tidak valid di Excel — digunakan 1");
      status = "warning";
    }
    quantity = 1;
  }

  // ── Tanggal & Harga Perolehan.
  const acquisitionDate = excelValueToISODate(raw.tanggalPerolehanRaw);
  if (raw.tanggalPerolehanRaw !== null && raw.tanggalPerolehanRaw !== "" && !acquisitionDate) {
    issues.push("Tanggal Perolehan tidak bisa dibaca dari Excel");
    status = "warning";
  }
  const acquisitionPriceRaw = excelValueToNumber(raw.hargaPerolehanRaw);
  const invoiceStatusRaw = resolveInvoiceStatus(raw.invoice);

  // Importer BUKAN Finance/Super Admin (mis. Asset Admin) TIDAK BOLEH
  // menulis field finance ke Firestore sama sekali — walau Excel-nya
  // memang punya kolom Harga/Invoice terisi. Firestore rules
  // (isAssetAdminOperationalCreate) juga menolak create kalau field ini
  // terisi non-null untuk Asset Admin, jadi payload WAJIB sudah null di
  // sini duluan. Data mentahnya TETAP ada di preview (row.preview.harga/
  // invoice) supaya tidak hilang — cuma tidak dipersist.
  const acquisitionPrice = ctx.canManageFinance ? acquisitionPriceRaw : null;
  const invoiceStatus = ctx.canManageFinance ? invoiceStatusRaw : null;

  const assetCode = needsGeneratedCode ? "" : explicitCode;

  // ── No. Aset (assetNumber) — dari kolom "No" Excel, BUKAN dari
  // excelRowNumber/index array. Kosong/"-"/bukan angka/desimal/negatif ->
  // null, JANGAN pernah diisi otomatis (mis. dari urutan baris).
  const assetNumber = parseAssetNumber(raw.no);

  const payload: Record<string, unknown> = cleanFirestoreData({
    assetName: raw.namaAset,
    assetCode,
    assetNumber,
    categoryId: categoryMatch.category?.id || "",
    categoryName: categoryMatch.category?.categoryName || raw.jenisAset || "Tidak Dikategorikan",
    subCategory: "",
    brand: "",
    model: "",
    serialNumber: "",
    imei: "",
    description: "",

    photoUrl: null,
    photoThumbnailUrl: null,
    photoFileName: null,
    photoDriveFileId: null,
    photoMimeType: null,
    photoSize: null,
    photoUploadedAt: null,

    companyOwnerId: ctx.companyId,
    companyOwnerName: ctx.companyName,
    divisionOwnerId: null,
    divisionOwnerName: "",

    location: resolvedLocationText,
    buildingId: locationSelection.buildingId || null,
    buildingName: locationSelection.buildingName || "",
    floorId: locationSelection.floorId || null,
    floor: locationSelection.floorName || "",
    roomId: locationSelection.roomId || null,
    roomName: locationSelection.roomName || "",
    areaId: locationSelection.areaId || null,
    areaName: locationSelection.areaName || "",
    locationId:
      locationSelection.areaId || locationSelection.roomId || locationSelection.floorId || locationSelection.buildingId || null,
    locationText: resolvedLocationText,
    areaPicUid: areaPic?.uid || null,
    areaPicName: areaPic?.name || null,
    areaPicEmail: areaPic?.email || null,
    areaPicLocationId: areaPic?.locationId || null,
    areaPicLocationName: areaPic?.locationName || null,

    responsiblePersonUid: null,
    responsiblePersonName: "",
    responsiblePersonEmail: "",
    responsiblePersonDivision: "",
    responsiblePersonJobTitle: "",
    ownershipStatus: "Aset Perusahaan",

    // Aset hasil import belum punya data PIC/custodian sama sekali dari
    // Excel — default "fixed_location" (tetap di lokasi, tidak masuk
    // antrean pinjam) supaya tidak langsung muncul di alur peminjaman
    // sebelum direview admin (lihat operationalStatus di bawah).
    trackingMode: FIXED_TRACKING_MODE,
    trackingModeLabel: TRACKING_MODE_LABEL[FIXED_TRACKING_MODE],
    usageType: null,
    usageTypeLabel: null,
    custodianUid: null,
    custodianName: null,
    custodianEmail: null,
    custodianDivision: null,
    custodianRole: null,
    currentHolderUid: null,
    currentHolderName: null,
    currentHolderEmail: null,
    currentHolderDivision: null,
    currentUsageStatus: "fixed_at_location",
    currentUsageStatusLabel: "Tetap di Lokasi",
    currentUsageStartedAt: null,
    picUid: null,
    picName: null,
    picEmail: null,

    // Finance — dual-write ke field lama (purchaseDate/purchasePrice) supaya
    // section Finance yang SUDAH ADA langsung berguna untuk aset hasil
    // import, TANPA field finance lain (vendor/invoice number/dst) yang
    // memang tidak ada di Excel ini.
    purchaseDate: acquisitionDate,
    purchasePrice: acquisitionPrice,
    vendorName: "",
    invoiceNumber: "",
    invoiceFileUrl: "",
    invoiceFileName: "",
    invoiceDriveFileId: "",
    invoiceMimeType: "",
    invoiceSize: null,
    invoiceUploadedAt: null,
    fundingSource: "",
    purchaseMethod: "",
    estimatedUsefulLife: "",
    financeNotes: "",
    financeStatus: acquisitionPrice ? "complete" : "pending_finance",

    assetStatus,
    condition: resolveAssetCondition(raw.kondisi),
    // Belum direview admin — jangan langsung bisa dipinjam siapa pun.
    isBorrowable: false,
    requiresApproval: true,
    accessories: "",
    operationalNotes: "",
    qrCodeValue: assetCode,

    currentBorrowingId: null,
    currentBorrowerUid: null,
    currentBorrowerName: null,

    createdByUid: ctx.currentUserUid,
    createdByName: ctx.currentUserName,
    updatedByUid: ctx.currentUserUid,
    updatedByName: ctx.currentUserName,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),

    // ── Field baru Import Aset ──
    inventoryNumber: raw.no || "",
    assetType: raw.jenisAset || "",
    quantity,
    acquisitionDate,
    acquisitionPrice,
    invoiceStatus,
    locationRaw: raw.lokasi || "",
    inventoryCondition,
    inventoryNotes: raw.keterangan || "",
    photoStatus: raw.foto || "",
    physicalEvidence: raw.buktiFisikAset || "",
    // Placeholder — diisi URL Storage sungguhan oleh wizard SETELAH upload
    // sukses (lihat lib/import/asset-image-upload.ts), BUKAN di sini karena
    // Blob tidak pernah boleh masuk payload Firestore.
    physicalEvidenceImages: [],
    source: "excel_import",
    operationalStatus: "needs_review",
    importBatchId: ctx.importBatchId,
    importRowNumber: raw.excelRowNumber,
  }) as Record<string, unknown>;

  return {
    excelRowNumber: raw.excelRowNumber,
    status,
    issues,
    needsGeneratedCode,
    categoryCodeForGeneration,
    payload,
    pendingImages,
    preview: {
      no: raw.no,
      kodeAset: assetCode || "(akan dibuat otomatis)",
      namaAset: raw.namaAset,
      jenisAset: raw.jenisAset || "-",
      tanggalPerolehan: acquisitionDate || "-",
      // Selalu nilai Excel MENTAH (bukan hasil gating canManageFinance) —
      // supaya data tidak pernah "hilang" dari preview walau importer-nya
      // Asset Admin (payload Firestore-nya sendiri tetap null, lihat di
      // atas). UI (ImportNewAssetsTab) yang memutuskan tampil/tidaknya
      // kolom ini berdasarkan role.
      harga: acquisitionPriceRaw,
      qty: quantity,
      lokasi: raw.lokasi || "-",
      kondisi: inventoryCondition,
      invoice: raw.invoice || "-",
    },
  };
}

// Dipanggil SETELAH mapImportRow untuk seluruh baris — generate kode baru
// SEKUENSIAL (allocator stateful, tidak aman dipanggil paralel) untuk
// baris-baris yang Kode Aset-nya kosong di Excel.
export async function finalizeGeneratedCodes(
  rows: MappedImportRow[],
  allocator: ReturnType<typeof createAssetCodeAllocator>
): Promise<void> {
  for (const row of rows) {
    if (!row.needsGeneratedCode || !row.payload) continue;
    const code = await allocator.allocate(row.categoryCodeForGeneration);
    row.payload.assetCode = code;
    row.payload.qrCodeValue = code;
    row.preview.kodeAset = code;
  }
}
