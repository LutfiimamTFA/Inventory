import { Asset } from "@/lib/types";

// Beberapa data lama/import bisa punya field harga/invoice dengan nama lain
// (assetPrice, hargaBeli, dst) yang tidak ada di tipe Asset resmi. Helper di
// bawah menerima Asset biasa lalu cast internal ke Record supaya tetap bisa
// membaca field tak-terduga itu tanpa menambah field asing ke interface Asset.
type AssetLike = Asset;
function asRecord(asset: AssetLike): Record<string, unknown> {
  return asset as unknown as Record<string, unknown>;
}

// acquisitionPrice ("Harga Perolehan" dari Excel) adalah source of truth
// utama — purchasePrice/field lama lain HANYA fallback untuk aset yang
// dibuat manual sebelum field acquisitionPrice ada (dual-write dari
// EditFinanceModal/import mapper menjaga keduanya tetap sinkron).
export function getAssetPrice(asset: AssetLike): number {
  const r = asRecord(asset);
  const raw =
    asset.acquisitionPrice ?? asset.purchasePrice ?? r.assetPrice ?? r.assetValue ?? r.acquisitionCost ?? r.hargaBeli ?? 0;

  if (typeof raw === "number") return raw;

  if (typeof raw === "string") {
    const cleaned = raw.replace(/[^\d]/g, "");
    return Number(cleaned || 0);
  }

  return 0;
}

export function hasPrice(asset: AssetLike): boolean {
  return getAssetPrice(asset) > 0;
}

export function hasInvoice(asset: AssetLike): boolean {
  const r = asRecord(asset);
  return Boolean(
    asset.invoiceStatus === "ada" ||
      asset.invoiceNumber ||
      r.invoiceNo ||
      r.purchaseInvoiceNumber ||
      asset.invoiceFileUrl ||
      r.invoiceDriveUrl ||
      r.purchaseProofFileUrl ||
      r.receiptFileUrl
  );
}

export function hasPurchaseDate(asset: AssetLike): boolean {
  return Boolean(asset.acquisitionDate || asset.purchaseDate);
}

// Field opsional yang tidak (belum) ada di interface Asset resmi — hanya
// ditampilkan "jika ada" di card Finance untuk data lama/import yang
// kebetulan punya field ini, TIDAK ditambahkan sebagai field edit baru.
export function getAssetBookValue(asset: AssetLike): number | null {
  const r = asRecord(asset);
  const raw = r.bookValue ?? r.estimatedValue ?? r.currentValue;
  if (typeof raw === "number" && raw > 0) return raw;
  if (typeof raw === "string" && raw.trim()) {
    const n = Number(raw.replace(/[^\d]/g, ""));
    return n > 0 ? n : null;
  }
  return null;
}

export function getAssetCostCenter(asset: AssetLike): string | null {
  const r = asRecord(asset);
  const raw = r.costCenter ?? r.costCenterCode;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

export function getAssetBudgetCode(asset: AssetLike): string | null {
  const r = asRecord(asset);
  const raw = r.budgetCode ?? r.budgetCodeNumber;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

export function isFinanceComplete(asset: AssetLike): boolean {
  return hasPrice(asset) && hasPurchaseDate(asset) && hasInvoice(asset);
}

export function formatRupiah(value: number | null | undefined): string {
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value || 0);
}

export type FinanceStatus = "complete" | "no_price" | "no_invoice" | "incomplete";

// Section F — status finance per aset, dipakai di table + filter Asset
// Finance. "no_price" diperiksa duluan (paling kritis — tidak ada harga
// berarti belum bisa dianggap "lengkap sebagian").
export function getFinanceStatus(asset: AssetLike): FinanceStatus {
  if (isFinanceComplete(asset)) return "complete";
  if (!hasPrice(asset)) return "no_price";
  if (!hasInvoice(asset)) return "no_invoice";
  return "incomplete";
}

export const FINANCE_STATUS_LABEL: Record<FinanceStatus, string> = {
  complete: "Data Finance Lengkap",
  no_price: "Belum Ada Harga",
  no_invoice: "Belum Ada Invoice",
  incomplete: "Perlu Dilengkapi",
};

export const FINANCE_STATUS_COLOR: Record<FinanceStatus, string> = {
  complete: "bg-emerald-50 text-emerald-700 border-emerald-200",
  no_price: "bg-red-50 text-red-700 border-red-200",
  no_invoice: "bg-amber-50 text-amber-700 border-amber-200",
  incomplete: "bg-slate-100 text-slate-600 border-slate-200",
};
