import { formatCurrency, formatDate, CONDITION_LABEL } from "@/lib/utils";
import { INVOICE_STATUS_LABEL } from "@/lib/assets/inventory";
import { AssetCondition, InvoiceStatus } from "@/lib/types";

// Section "Riwayat Aktivitas" — hitung field APA yang benar-benar berubah
// nilainya (before -> after) dari satu penyimpanan Edit Aset, supaya Log
// Aktivitas/Audit Log tidak lagi cuma "Data aset diperbarui" generik, tapi
// benar-benar bilang field mana yang berubah dan nilai lama/barunya.

export interface FieldChange {
  field: string;
  label: string;
  before: string;
  after: string;
}

// Beberapa field TERPISAH secara struktur tapi merepresentasikan satu
// KONSEP yang sama di mata user (mis. purchaseDate vs acquisitionDate
// sama-sama "Tanggal Perolehan", dual-write supaya field lama & baru tetap
// sinkron) — field yang paling AWAL dalam ASSET_FIELD_ORDER untuk satu label
// yang menang ditampilkan, field lain dengan label sama otomatis di-skip
// supaya tidak dobel baris untuk satu perubahan yang sama.
export const ASSET_FIELD_LABELS: Record<string, string> = {
  assetName: "Nama Aset",
  categoryName: "Kategori",
  categoryId: "Kategori",
  subCategory: "Subkategori",
  assetCode: "Kode Aset",
  assetNumber: "No. Aset",
  quantity: "Qty",
  acquisitionDate: "Tanggal Perolehan",
  purchaseDate: "Tanggal Perolehan",
  brand: "Merk",
  model: "Model/Tipe",
  serialNumber: "Serial Number",
  imei: "IMEI",
  description: "Deskripsi",
  locationText: "Lokasi",
  location: "Lokasi",
  condition: "Kondisi Aset",
  inventoryCondition: "Kondisi Aset",
  photoUrl: "Foto Aset",
  photoThumbnailUrl: "Foto Aset",
  photoFileName: "Foto Aset",
  photoDriveFileId: "Foto Aset",
  photoMimeType: "Foto Aset",
  photoSize: "Foto Aset",
  photoUploadedAt: "Foto Aset",
  acquisitionPrice: "Harga Perolehan",
  purchasePrice: "Harga Perolehan",
  invoiceStatus: "Status Invoice",
  invoiceNumber: "Nomor Invoice",
  invoiceFileUrl: "Bukti Invoice",
  invoiceFileName: "Bukti Invoice",
  invoiceDriveFileId: "Bukti Invoice",
  invoiceMimeType: "Bukti Invoice",
  invoiceSize: "Bukti Invoice",
  invoiceUploadedAt: "Bukti Invoice",
  vendorName: "Vendor",
  fundingSource: "Sumber Dana",
  purchaseMethod: "Metode Pembelian",
  estimatedUsefulLife: "Estimasi Umur Aset",
  financeNotes: "Catatan Finance",
  responsiblePersonName: "PIC / Custodian",
  responsiblePersonUid: "PIC / Custodian",
  ownershipStatus: "Status Kepemilikan",
  assetStatus: "Status Operasional Aset",
};

const CURRENCY_FIELDS = new Set(["purchasePrice", "acquisitionPrice"]);
const DATE_FIELDS = new Set(["purchaseDate", "acquisitionDate", "photoUploadedAt"]);
const CONDITION_FIELDS = new Set(["condition"]);
const INVOICE_STATUS_FIELDS = new Set(["invoiceStatus"]);
// Field foto/bukti-invoice sengaja ditampilkan sebagai "Diperbarui" (bukan
// URL Drive mentah) — URL/fileId Google Drive tidak enak dibaca di log dan
// tidak relevan untuk audit "siapa mengubah apa".
const FILE_FIELDS = new Set([
  "photoUrl", "photoThumbnailUrl", "photoFileName", "photoDriveFileId", "photoMimeType", "photoSize", "photoUploadedAt",
  "invoiceFileUrl", "invoiceFileName", "invoiceDriveFileId", "invoiceMimeType", "invoiceSize", "invoiceUploadedAt",
]);

function formatFieldValue(field: string, value: unknown): string {
  if (value === null || value === undefined || value === "") return "-";
  if (FILE_FIELDS.has(field)) return "Diperbarui";
  if (CURRENCY_FIELDS.has(field)) return formatCurrency(value as number);
  if (DATE_FIELDS.has(field)) return formatDate(value);
  if (CONDITION_FIELDS.has(field)) return CONDITION_LABEL[value as AssetCondition] || String(value);
  if (INVOICE_STATUS_FIELDS.has(field)) return INVOICE_STATUS_LABEL[value as InvoiceStatus] || String(value);
  if (typeof value === "boolean") return value ? "Ya" : "Tidak";
  if (typeof value === "number") return String(value);
  return String(value);
}

// `fields` HARUS urutan dari yang paling "manusiawi" duluan (mis.
// categoryName sebelum categoryId) — dedup per label mempertahankan
// kemunculan PERTAMA saja.
export function diffAssetFields(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields: string[]
): FieldChange[] {
  const changes: FieldChange[] = [];
  const seenLabels = new Set<string>();
  for (const field of fields) {
    const beforeVal = before[field] ?? null;
    const afterVal = after[field] ?? null;
    if (beforeVal === afterVal) continue;
    const label = ASSET_FIELD_LABELS[field] || field;
    if (seenLabels.has(label)) continue;
    seenLabels.add(label);
    changes.push({
      field,
      label,
      before: formatFieldValue(field, beforeVal),
      after: formatFieldValue(field, afterVal),
    });
  }
  return changes;
}

// Nama SENGAJA beda dari lib/notifications.ts:buildChangeSummary (fungsi
// berbeda: yang itu untuk bullet notifikasi generik lintas-fitur, ini
// khusus narasi Riwayat Aktivitas/Audit Log Detail Aset) — dua-duanya bisa
// diimport di file yang sama tanpa bentrok nama.
export function buildAssetChangeSummary(changes: FieldChange[]): string {
  return changes.map((c) => `${c.label} dari "${c.before}" menjadi "${c.after}"`).join(" · ");
}

export const ROLE_LABEL: Record<string, string> = {
  super_admin: "Super Admin",
  asset_admin: "Asset Admin",
  asset_finance: "Finance",
  location_pic: "PIC Lokasi",
  it_team: "Tim IT",
};

export function getRoleLabel(role: string | null | undefined): string {
  if (!role) return "-";
  return ROLE_LABEL[role] || role;
}
