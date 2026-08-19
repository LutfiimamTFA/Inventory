"use client";

import { X, FileText, ExternalLink } from "lucide-react";
import { Asset } from "@/lib/types";
import { getAssetInvoicePreviewUrl } from "@/lib/assets/asset-status";
import { formatCurrency, formatDate } from "@/lib/utils";

function inferFileKind(mimeType: string | undefined, src: string): "image" | "pdf" | "other" {
  const mime = (mimeType || "").toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (mime === "application/pdf") return "pdf";

  const lower = src.toLowerCase();
  if (/\.(png|jpe?g|webp|gif)(\?|#|$)/.test(lower)) return "image";
  if (/\.pdf(\?|#|$)/.test(lower)) return "pdf";
  return "other";
}

function Field({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <p className="text-xs text-slate-400 mb-0.5">{label}</p>
      <p className="text-sm font-medium text-slate-800">{value || "-"}</p>
    </div>
  );
}

export default function InvoicePreviewModal({
  open,
  asset,
  onClose,
}: {
  open: boolean;
  asset: Asset | null;
  onClose: () => void;
}) {
  if (!open || !asset) return null;

  const src = getAssetInvoicePreviewUrl(asset);
  const kind = src ? inferFileKind(asset.invoiceMimeType, src) : null;

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative flex max-h-[90vh] w-[92vw] max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg">
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-900">Invoice / Bukti Pembelian</h2>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 cursor-pointer rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Field label="Nama Asset" value={asset.assetName} />
            <Field label="Kode Asset" value={asset.assetCode} />
            <Field label="Harga Beli" value={formatCurrency(asset.purchasePrice)} />
            <Field label="Tanggal Pembelian" value={formatDate(asset.purchaseDate)} />
            <Field label="Nomor Invoice" value={asset.invoiceNumber} />
            <Field label="Vendor" value={asset.vendorName} />
          </div>

          <div>
            {!src ? (
              <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-slate-200 bg-slate-50 py-12 text-center">
                <FileText size={28} className="text-slate-300" />
                <p className="text-sm text-slate-400">Belum ada file invoice yang diunggah.</p>
              </div>
            ) : kind === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={src}
                alt="Invoice"
                className="max-h-[55vh] w-full rounded-xl border border-slate-200 object-contain bg-slate-50"
              />
            ) : kind === "pdf" ? (
              <div className="space-y-2">
                <iframe src={src} className="h-[55vh] w-full rounded-xl border border-slate-200" title="Preview invoice" />
                <button
                  type="button"
                  onClick={() => window.open(src, "_blank", "noopener,noreferrer")}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:underline"
                >
                  <ExternalLink size={14} />
                  Buka di tab baru
                </button>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-slate-200 bg-slate-50 py-10 text-center">
                <FileText size={28} className="text-slate-300" />
                <p className="text-sm text-slate-500">
                  Format file ini tidak bisa ditampilkan langsung sebagai preview.
                </p>
                <button
                  type="button"
                  onClick={() => window.open(src, "_blank", "noopener,noreferrer")}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  <ExternalLink size={14} />
                  Buka File
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
