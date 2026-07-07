import { AssetCondition, AssetStatus, BorrowingStatus } from "@/lib/types";

export function formatCurrency(value?: number) {
  if (value === undefined || value === null) return "-";
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(value);
}

export function formatDate(value: unknown) {
  if (!value) return "-";
  const d =
    typeof value === "object" && value !== null && "toDate" in value
      ? (value as { toDate: () => Date }).toDate()
      : new Date(value as string);
  if (isNaN(d.getTime())) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(d);
}

export const ASSET_STATUS_LABEL: Record<AssetStatus, string> = {
  available: "Tersedia",
  borrowed: "Dipinjam",
  in_use: "Digunakan Tetap",
  maintenance: "Maintenance",
  broken: "Rusak",
  incomplete: "Tidak Lengkap",
  lost: "Hilang",
  inactive: "Nonaktif",
  disposed: "Dihapuskan",
};

export const ASSET_STATUS_HELPER: Record<AssetStatus, string> = {
  available: "Asset siap dipinjam/digunakan.",
  borrowed: "Asset sedang dipinjam staff.",
  in_use: "Asset dipakai tetap oleh orang/divisi tertentu.",
  maintenance: "Asset sedang dicek/diperbaiki.",
  broken: "Asset tidak layak pakai.",
  incomplete: "Asset kurang aksesoris/komponen.",
  lost: "Asset tidak ditemukan.",
  inactive: "Asset tidak digunakan sementara.",
  disposed: "Asset sudah tidak menjadi asset aktif.",
};

export const ASSET_STATUS_COLOR: Record<AssetStatus, string> = {
  available: "bg-emerald-50 text-emerald-700 border-emerald-200",
  borrowed: "bg-amber-50 text-amber-700 border-amber-200",
  in_use: "bg-blue-50 text-blue-700 border-blue-200",
  maintenance: "bg-purple-50 text-purple-700 border-purple-200",
  broken: "bg-red-50 text-red-700 border-red-200",
  incomplete: "bg-orange-50 text-orange-700 border-orange-200",
  lost: "bg-rose-900 text-rose-50 border-rose-900",
  inactive: "bg-slate-100 text-slate-500 border-slate-200",
  disposed: "bg-slate-800 text-slate-100 border-slate-800",
};

export const CONDITION_LABEL: Record<AssetCondition, string> = {
  new: "Baru",
  good: "Baik",
  fair: "Cukup",
  minor_damage: "Rusak Ringan",
  heavy_damage: "Rusak Berat",
};

export const BORROWING_STATUS_LABEL: Record<BorrowingStatus, string> = {
  borrowed: "Dipinjam",
  returned: "Dikembalikan",
  overdue: "Terlambat",
};

export const BORROWING_STATUS_COLOR: Record<BorrowingStatus, string> = {
  borrowed: "bg-amber-50 text-amber-700 border-amber-200",
  returned: "bg-emerald-50 text-emerald-700 border-emerald-200",
  overdue: "bg-red-50 text-red-700 border-red-200",
};

export function formatRupiahInput(digitsOnly: string) {
  if (!digitsOnly) return "";
  return new Intl.NumberFormat("id-ID").format(Number(digitsOnly));
}

// Logo di tengah QR code AssetView (public/logo.png). Ukuran logo dijaga di
// ~20% dari ukuran QR supaya tetap bisa discan (dipakai bersama level="H").
export function getQrImageSettings(size: number) {
  const logoSize = Math.round(size * 0.2);
  return {
    src: "/logo.png",
    height: logoSize,
    width: logoSize,
    excavate: true,
  };
}
