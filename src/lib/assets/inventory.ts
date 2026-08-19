import { Asset, AssetOperationalStatus, AssetSource, InvoiceStatus } from "@/lib/types";

// Label/warna untuk badge field-field baru hasil Import Aset (lihat
// lib/import/*). Terpisah dari lib/utils.ts (assetStatus/condition lama)
// supaya perubahan di sini tidak menyentuh mapping yang sudah dipakai
// alur peminjaman/QHSE.

export const INVOICE_STATUS_LABEL: Record<InvoiceStatus, string> = {
  ada: "Ada Invoice",
  tidak_ada: "Tidak Ada Invoice",
  tidak_diketahui: "Tidak Diketahui",
};

export const INVOICE_STATUS_COLOR: Record<InvoiceStatus, string> = {
  ada: "bg-emerald-50 text-emerald-700 border-emerald-200",
  tidak_ada: "bg-slate-100 text-slate-500 border-slate-200",
  tidak_diketahui: "bg-slate-100 text-slate-500 border-slate-200",
};

export const ASSET_SOURCE_LABEL: Record<AssetSource, string> = {
  manual: "Input Manual",
  excel_import: "Import Excel",
};

// Sumber foto/bukti fisik SAAT INI — beda dari ASSET_SOURCE_LABEL (asal
// keseluruhan dokumen aset). "excel_sync" = tab Sinkronkan Foto Excel.
export const PHOTO_SOURCE_LABEL: Record<"manual" | "excel_import" | "excel_sync", string> = {
  manual: "Upload Manual",
  excel_import: "Import Excel",
  excel_sync: "Sinkronisasi Excel",
};

export const OPERATIONAL_STATUS_LABEL: Record<AssetOperationalStatus, string> = {
  active: "Aktif",
  needs_review: "Perlu Review",
};

export const OPERATIONAL_STATUS_COLOR: Record<AssetOperationalStatus, string> = {
  active: "bg-emerald-50 text-emerald-700 border-emerald-200",
  needs_review: "bg-amber-50 text-amber-700 border-amber-200",
};

// inventoryCondition disimpan sebagai teks Indonesia apa adanya (bukan enum
// tetap) karena data lama/import bisa punya variasi ("Rusak" tanpa
// ringan/berat, dll) — warna badge dicocokkan per kata kunci, fallback netral
// untuk teks yang tidak dikenali (supaya tetap tampil walau bukan salah satu
// dari 5 nilai standar).
export function getInventoryConditionColor(value?: string | null): string {
  const v = (value || "").toLowerCase();
  if (!v) return "bg-slate-100 text-slate-500 border-slate-200";
  if (v.includes("perlu pemeriksaan")) return "bg-amber-50 text-amber-700 border-amber-200";
  if (v.includes("hilang")) return "bg-rose-900 text-rose-50 border-rose-900";
  if (v.includes("berat")) return "bg-red-50 text-red-700 border-red-200";
  if (v.includes("ringan") || v.includes("rusak")) return "bg-orange-50 text-orange-700 border-orange-200";
  if (v.includes("baik")) return "bg-emerald-50 text-emerald-700 border-emerald-200";
  return "bg-slate-100 text-slate-600 border-slate-200";
}

export function getAssetSourceLabel(asset: Pick<Asset, "source">): string {
  return ASSET_SOURCE_LABEL[asset.source || "manual"];
}

export function getAssetOperationalStatus(asset: Pick<Asset, "operationalStatus">): AssetOperationalStatus {
  return asset.operationalStatus || "active";
}

// SATU sumber kebenaran untuk "berapa unit fisik diwakili aset ini" — dipakai
// tabel Assets & rekap Total Unit. Business logic existing (lihat
// lib/import/asset-row-mapper.ts): satu dokumen aset TETAP mewakili minimal 1
// unit fisik walau field quantity belum pernah diisi (aset lama sebelum fitur
// Qty ada) — jadi default-nya 1, BUKAN 0/"-".
export function getAssetQuantity(asset: Pick<Asset, "quantity">): number {
  return typeof asset.quantity === "number" && asset.quantity > 0 ? asset.quantity : 1;
}

// Normalisasi assetNumber untuk sorting/tampilan — backward compatible utk
// aset lama yang belum punya field ini sama sekali (undefined) ATAU field-nya
// bukan number yang valid.
export function getAssetNumber(asset: Pick<Asset, "assetNumber">): number | null {
  return typeof asset.assetNumber === "number" && Number.isFinite(asset.assetNumber) ? asset.assetNumber : null;
}
