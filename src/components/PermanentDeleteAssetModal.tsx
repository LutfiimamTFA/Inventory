"use client";

import { useState } from "react";
import { AlertTriangle, X } from "lucide-react";
import { Asset } from "@/lib/types";
import { getAssetNumber } from "@/lib/assets/inventory";

const CONFIRM_WORD = "HAPUS";

// Section "Hapus Permanen Asset" — konfirmasi BERLAPIS sesuai spek: identitas
// asset ditampilkan jelas dulu (supaya Super Admin yakin asset yang benar),
// baru tombol "Hapus Permanen" aktif SETELAH user mengetik "HAPUS" persis
// (case-sensitive, tanpa spasi tambahan) — bukan window.confirm() bawaan
// browser, dan bukan cuma satu klik konfirmasi biasa seperti Nonaktifkan.
export default function PermanentDeleteAssetModal({
  asset,
  open,
  submitting,
  error,
  onConfirm,
  onCancel,
}: {
  asset: Pick<
    Asset,
    "id" | "assetNumber" | "assetName" | "assetCode" | "categoryName" | "companyOwnerName" | "location" | "locationText"
  > | null;
  open: boolean;
  submitting: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [typedValue, setTypedValue] = useState("");

  if (!open || !asset) return null;

  const canConfirm = typedValue === CONFIRM_WORD && !submitting;

  const handleCancel = () => {
    if (submitting) return;
    setTypedValue("");
    onCancel();
  };

  const handleConfirm = () => {
    if (!canConfirm) return;
    onConfirm();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={handleCancel} />
      <div className="relative w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-lg">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-50 text-red-600">
              <AlertTriangle size={20} />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-slate-900">Hapus Asset Secara Permanen?</h2>
              <p className="mt-1 text-sm text-slate-500">
                Asset ini akan dihapus secara permanen dari sistem dan tidak dapat dipulihkan kembali.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleCancel}
            className="shrink-0 text-slate-400 hover:text-slate-600"
            disabled={submitting}
          >
            <X size={18} />
          </button>
        </div>

        <div className="mt-4 space-y-1.5 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm">
          <IdentityRow label="No. Asset" value={getAssetNumber(asset) !== null ? String(getAssetNumber(asset)) : "-"} />
          <IdentityRow label="Nama Asset" value={asset.assetName || "-"} />
          <IdentityRow label="Kode Asset" value={asset.assetCode || "-"} />
          <IdentityRow label="Kategori" value={asset.categoryName || "-"} />
          <IdentityRow label="Perusahaan" value={asset.companyOwnerName || "-"} />
          <IdentityRow label="Lokasi" value={asset.location || asset.locationText || "-"} />
        </div>

        <p className="mt-3 text-xs font-medium text-amber-600">
          Pastikan asset yang dipilih sudah benar sebelum melanjutkan.
        </p>

        <div className="mt-4">
          <label className="mb-1.5 block text-xs font-medium text-slate-500">
            Ketik <span className="font-mono font-semibold text-slate-700">{CONFIRM_WORD}</span> untuk melanjutkan
          </label>
          <input
            type="text"
            value={typedValue}
            onChange={(e) => setTypedValue(e.target.value)}
            disabled={submitting}
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder={CONFIRM_WORD}
            className="input font-mono"
          />
        </div>

        {error && (
          <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">{error}</p>
        )}

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={handleCancel}
            disabled={submitting}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={!canConfirm}
            className="rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {submitting ? "Menghapus..." : "Hapus Permanen"}
          </button>
        </div>
      </div>
    </div>
  );
}

function IdentityRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-slate-400">{label}</span>
      <span className="truncate font-medium text-slate-800">{value}</span>
    </div>
  );
}
