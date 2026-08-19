import { AssetCondition, InvoiceStatus } from "@/lib/types";

// Nilai "Kondisi" DITAMPILKAN apa adanya (setelah trim) di field baru
// inventoryCondition — TIDAK pernah otomatis "Baik" kalau kosong (lihat
// requirement import). "Rusak" tanpa embel-embel Ringan/Berat pada data
// lama (mis. "Label Aset EGC.xlsx") dibiarkan apa adanya juga, bukan ditebak
// jadi salah satu dari dua.
export function resolveInventoryCondition(rawKondisi: string): string {
  const trimmed = rawKondisi.trim();
  return trimmed || "Perlu Pemeriksaan";
}

// Mapping ke field condition (AssetCondition) yang SUDAH ADA & dipakai alur
// peminjaman/health-score lain — HANYA dipetakan kalau maknanya memang
// persis sama, supaya tidak merusak semantik field lama itu. "Hilang" tidak
// dipetakan ke condition (fisik barangnya tidak diketahui) — itu jadi
// assetStatus "lost" (lihat resolveAssetStatusFromInventory).
export function resolveAssetCondition(rawKondisi: string): AssetCondition {
  const v = rawKondisi.trim().toLowerCase();
  if (!v) return "fair"; // netral — BUKAN "good", supaya tidak menyiratkan sudah diverifikasi baik
  if (v.includes("berat")) return "heavy_damage";
  if (v.includes("ringan")) return "minor_damage";
  if (v.includes("rusak")) return "minor_damage"; // "Rusak" generik tanpa embel — konservatif
  if (v.includes("baik")) return "good";
  if (v.includes("hilang")) return "fair";
  return "fair";
}

// "Hilang" di kolom Kondisi persis cocok dengan assetStatus "lost" yang
// sudah ada di aplikasi — dipetakan ke situ, BUKAN field condition.
export function isKondisiHilang(rawKondisi: string): boolean {
  return rawKondisi.trim().toLowerCase().includes("hilang");
}

// Aset hanya boleh dianggap disposed kalau teks "Bukti Fisik Aset" SECARA
// JELAS menyatakan sudah dihapus/disposal — bukan tebakan dari field lain
// (mis. "Foto" = "Dihapus" TIDAK boleh dipakai, itu cuma status foto).
const DISPOSAL_PATTERN = /\bdihapus\b|\bdisposal\b|\bdimusnahkan\b|\bdibuang\b/i;

export function isDisposedFromEvidence(buktiFisikAset: string): boolean {
  return DISPOSAL_PATTERN.test(buktiFisikAset.trim());
}

// "Invoice" di Excel cuma "Ada"/"Tidak Ada" — cek "tidak" LEBIH DULU karena
// "Tidak Ada" juga mengandung substring "ada".
export function resolveInvoiceStatus(rawInvoice: string): InvoiceStatus {
  const v = rawInvoice.trim().toLowerCase();
  if (!v) return "tidak_diketahui";
  if (v.includes("tidak")) return "tidak_ada";
  if (v.includes("ada")) return "ada";
  return "tidak_diketahui";
}
