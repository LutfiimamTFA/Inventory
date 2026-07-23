"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { collection, getDocs, limit, query, where } from "firebase/firestore";
import {
  AlertTriangle,
  ArrowRightLeft,
  ChevronUp,
  Eye,
  Pencil,
  QrCode,
  RotateCw,
  Undo2,
} from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { Asset } from "@/lib/types";
import { isAssetInMyPicLocation } from "@/lib/locations";
import { repairBrokenBorrowState } from "@/lib/borrow-actions";
import {
  ASSET_STATUS_COLOR,
  ASSET_STATUS_LABEL,
  TRACKING_MODE_LABEL,
  getAssetConditionLabel,
  hasBrokenBorrowState,
  isBorrowedByMe,
  isBorrowedByOther,
} from "@/lib/utils";
import Badge from "@/components/Badge";
import ReportIssueModal from "@/components/ReportIssueModal";
import { BorrowModal, ReturnModal } from "@/components/BorrowReturnModal";
import { Toast, ToastState } from "@/components/Toast";

// Section E — halaman ini SENGAJA berdiri sendiri (bukan dalam
// ProtectedLayout/sidebar) supaya bisa langsung dibuka kamera bawaan HP dari
// QR fisik tanpa nyasar ke guard role sidebar dulu. Guard login/akses
// ditangani manual di bawah (redirect ke /login?returnUrl=...).
export default function AssetActionPage() {
  return (
    <Suspense fallback={<PageShell><LoadingState /></PageShell>}>
      <AssetActionContent />
    </Suspense>
  );
}

function AssetActionContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { firebaseUser, assetUser, role, loading, isLocationPicRole, assignedPicLocations } = useAuth();
  const code = searchParams.get("code") || "";

  const [asset, setAsset] = useState<Asset | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loadingAsset, setLoadingAsset] = useState(true);
  const [reportOpen, setReportOpen] = useState(false);
  const [borrowOpen, setBorrowOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [showFullDetail, setShowFullDetail] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

  // Section K — diekstrak jadi fungsi sendiri supaya bisa dipanggil ULANG
  // setelah Pinjam/Kembalikan sukses (refresh status asset), TANPA perlu
  // scan ulang atau redirect ke /scan sama sekali.
  const fetchAssetByCode = useCallback(async (assetCode: string) => {
    const snap = await getDocs(
      query(collection(db, "assets"), where("assetCode", "==", assetCode), limit(1))
    );
    if (snap.empty) return null;
    const d = snap.docs[0];
    return { id: d.id, ...d.data() } as Asset;
  }, []);

  // Section E — flow: tunggu auth selesai, redirect ke login kalau belum
  // login (bawa returnUrl supaya balik ke sini lagi setelah login), baru
  // cari asset kalau sudah login.
  useEffect(() => {
    if (loading) return;

    if (!firebaseUser) {
      const returnUrl = `/asset-action?code=${encodeURIComponent(code)}`;
      router.replace(`/login?returnUrl=${encodeURIComponent(returnUrl)}`);
      return;
    }
  }, [loading, firebaseUser, code, router]);

  useEffect(() => {
    if (loading || !firebaseUser || !code) {
      if (!loading && !code) queueMicrotask(() => setLoadingAsset(false));
      return;
    }

    let cancelled = false;
    queueMicrotask(() => {
      setLoadingAsset(true);
      setNotFound(false);
    });

    fetchAssetByCode(code)
      .then((found) => {
        if (cancelled) return;
        if (!found) {
          setNotFound(true);
          setAsset(null);
        } else {
          setAsset(found);
        }
      })
      .catch((error) => {
        console.error("[Asset Action] gagal memuat asset", { code, error });
        if (!cancelled) setNotFound(true);
      })
      .finally(() => {
        if (!cancelled) setLoadingAsset(false);
      });

    return () => {
      cancelled = true;
    };
  }, [loading, firebaseUser, code, fetchAssetByCode]);

  // Section K/L/M — setelah Pinjam/Kembalikan sukses, refresh data asset
  // YANG SAMA di tempat (tanpa navigasi/scan ulang) supaya tombol aksi
  // langsung menyesuaikan status terbaru.
  const refreshAsset = useCallback(async () => {
    if (!code) return;
    try {
      const found = await fetchAssetByCode(code);
      if (found) setAsset(found);
    } catch (error) {
      console.error("[Asset Action] gagal refresh asset", { code, error });
    }
  }, [code, fetchAssetByCode]);

  if (loading || (!firebaseUser && !code)) {
    return (
      <PageShell>
        <LoadingState />
      </PageShell>
    );
  }

  if (!code) {
    return (
      <PageShell>
        <ErrorState message="Kode asset tidak ditemukan dari QR." />
      </PageShell>
    );
  }

  if (!firebaseUser) {
    // Sedang di tengah redirect ke /login (lihat useEffect di atas).
    return (
      <PageShell>
        <LoadingState />
      </PageShell>
    );
  }

  if (loadingAsset) {
    return (
      <PageShell>
        <LoadingState />
      </PageShell>
    );
  }

  if (notFound || !asset) {
    return (
      <PageShell>
        <ErrorState message={`Asset dengan kode "${code}" tidak ditemukan.`} />
      </PageShell>
    );
  }

  // Section A — status dibaca lewat helper normalisasi (lib/utils.ts),
  // BUKAN dibaca mentah dari satu field saja — asset ini bisa punya data
  // dari skema lama (assetStatus/currentBorrower*) maupun skema baru
  // (currentUsageStatus/currentHolder*), dan keduanya harus dianggap sah.
  const isFixedLocation = asset.trackingMode === "fixed_location";
  const borrowedByMe = isBorrowedByMe(asset, { uid: assetUser?.uid || firebaseUser.uid });
  const borrowedByOther = isBorrowedByOther(asset, { uid: assetUser?.uid || firebaseUser.uid });
  const brokenBorrowState = hasBrokenBorrowState(asset);
  const isAvailableToBorrow =
    asset.isBorrowable && !isFixedLocation && !borrowedByMe && !borrowedByOther && !brokenBorrowState;
  const holderName = asset.currentHolderName || asset.currentBorrowerName || asset.custodianName;

  const isLocationPicScoped = role === "location_pic" || isLocationPicRole;
  const isLocationPicOwner = isLocationPicScoped && isAssetInMyPicLocation(asset, assignedPicLocations, assetUser?.uid);
  // Section P — /assets/{id} punya guard sidebar sendiri (Super Admin/Asset
  // Admin/Asset Finance/Tim IT selalu boleh, PIC Lokasi hanya untuk asset di
  // lokasinya). Staff biasa (atau PIC di luar lokasinya) akan langsung
  // dilempar balik oleh guard itu — jadi utk mereka "Lihat Detail" TIDAK
  // boleh navigasi ke sana, cukup buka ringkasan tambahan di halaman ini.
  const canOpenFullDetailPage =
    role === "super_admin" || role === "asset_admin" || role === "asset_finance" || role === "it_team" || isLocationPicOwner;
  const canRepairBrokenState = role === "super_admin" || role === "asset_admin";

  // Section C — validasi lengkap sebelum buka modal Pinjam. borrowedByMe
  // dicek lebih dulu supaya klik "Pinjam Asset" yang ternyata sudah jadi
  // "Kembalikan Asset" (data baru saja berubah) tetap membuka modal yang
  // benar, bukan menolak diam-diam.
  const handleBorrowClick = () => {
    if (!asset.isBorrowable) {
      setToast({ type: "error", message: "Asset ini tidak dapat dipinjam." });
      return;
    }
    if (isFixedLocation) {
      setToast({ type: "error", message: "Asset tetap lokasi tidak dapat dipinjam." });
      return;
    }
    if (borrowedByMe) {
      setReturnOpen(true);
      return;
    }
    if (borrowedByOther) {
      setToast({
        type: "error",
        message: `Asset sedang dipinjam oleh ${holderName || "user lain"}.`,
      });
      return;
    }
    if (brokenBorrowState) {
      setToast({ type: "error", message: "Data peminjaman asset tidak sinkron. Hubungi Asset Admin." });
      return;
    }
    setBorrowOpen(true);
  };

  const handleRepairStatus = async () => {
    if (!assetUser?.uid) return;
    try {
      await repairBrokenBorrowState({
        asset,
        performedBy: { uid: assetUser.uid, name: assetUser.name || firebaseUser.email || "" },
      });
      setToast({ type: "success", message: "Status asset berhasil diperbaiki menjadi Tersedia." });
      refreshAsset();
    } catch (error) {
      console.error("[Asset Action] gagal memperbaiki status asset", {
        assetId: asset.id,
        assetCode: asset.assetCode,
        error,
      });
      setToast({ type: "error", message: "Gagal memperbaiki status asset." });
    }
  };

  return (
    <PageShell>
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-mono text-xs text-slate-400">{asset.assetCode}</p>
              <h2 className="truncate text-lg font-bold text-slate-900">{asset.assetName}</h2>
            </div>
            <Badge label={ASSET_STATUS_LABEL[asset.assetStatus]} colorClass={ASSET_STATUS_COLOR[asset.assetStatus]} />
          </div>

          {(asset.hasActiveIssue === true || asset.condition === "reported_issue") && (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-amber-800">
              <p className="font-semibold text-sm">Asset sedang dilaporkan bermasalah</p>
              <p className="text-sm mt-0.5">
                Laporan {asset.activeIssueTicketNo || "-"} sedang menunggu review QHSE.
              </p>
              {asset.lastIssueSymptomLabel && (
                <p className="text-xs mt-1">Gejala: {asset.lastIssueSymptomLabel}</p>
              )}
              {asset.lastIssueNote && <p className="text-xs mt-0.5">Catatan: {asset.lastIssueNote}</p>}
            </div>
          )}

          <div className="mt-4 space-y-2 text-sm text-slate-600">
            <Row label="Lokasi" value={asset.location || asset.locationText || "-"} />
            <Row label="Kondisi" value={getAssetConditionLabel(asset)} />
            {asset.areaPicName && <Row label="PIC Operasional" value={asset.areaPicName} />}
            {!isFixedLocation && (
              <Row label="Pemegang Saat Ini" value={holderName || "Belum tercatat"} />
            )}
          </div>

          {/* Section P — ringkasan tambahan TANPA finance, dipakai staff/PIC
              yang tidak punya akses ke /assets/{id} — jadi "Lihat Detail"
              tidak perlu navigasi sama sekali untuk mereka. */}
          {!canOpenFullDetailPage && showFullDetail && (
            <div className="mt-3 space-y-2 border-t border-slate-100 pt-3 text-sm text-slate-600">
              <Row label="Kategori" value={asset.categoryName || "-"} />
              <Row label="Merk" value={asset.brand || "-"} />
              <Row label="Model/Tipe" value={asset.model || "-"} />
              <Row label="Serial Number" value={asset.serialNumber || "-"} />
              <Row label="Mode Tracking" value={asset.trackingMode ? TRACKING_MODE_LABEL[asset.trackingMode] : "-"} />
              {asset.operationalNotes && <Row label="Catatan Operasional" value={asset.operationalNotes} />}
            </div>
          )}

          {/* Section B/G — data tidak sinkron: status bilang Dipinjam tapi
              tidak ada penanda pemegangnya sama sekali. */}
          {brokenBorrowState && (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>
                Data peminjaman asset ini tidak sinkron. Status asset Dipinjam, tetapi pemegang asset belum tercatat.
              </span>
            </div>
          )}

          {!brokenBorrowState && borrowedByOther && (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>Asset sedang dipinjam oleh {holderName || "user lain"}.</span>
            </div>
          )}

          {borrowedByMe && (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>Asset ini sedang Anda pinjam.</span>
            </div>
          )}

          <div className="mt-5 space-y-2">
            <ActionButton
              icon={showFullDetail && !canOpenFullDetailPage ? ChevronUp : Eye}
              label="Lihat Detail"
              onClick={() => {
                if (canOpenFullDetailPage) {
                  router.push(`/assets/${asset.id}`);
                  return;
                }
                setShowFullDetail((prev) => !prev);
              }}
            />

            {isLocationPicOwner && (
              <ActionButton
                icon={Pencil}
                label="Edit Asset"
                onClick={() => router.push(`/assets/${asset.id}/edit`)}
              />
            )}

            {brokenBorrowState && canRepairBrokenState && (
              <ActionButton icon={RotateCw} label="Perbaiki Status Asset" onClick={handleRepairStatus} />
            )}

            {!isFixedLocation && !brokenBorrowState && borrowedByMe && (
              <ActionButton icon={Undo2} label="Kembalikan Asset" onClick={() => setReturnOpen(true)} />
            )}

            {!isFixedLocation && isAvailableToBorrow && (
              <ActionButton icon={ArrowRightLeft} label="Pinjam Asset" onClick={handleBorrowClick} />
            )}

            <ActionButton
              icon={AlertTriangle}
              label="Laporkan Kendala"
              tone="warning"
              onClick={() => setReportOpen(true)}
            />
          </div>

          {/* Section N/Q — scan ulang HANYA lewat tombol ini, tidak pernah
              otomatis/dipaksa saat klik aksi lain di halaman ini. */}
          <button
            type="button"
            onClick={() => router.push("/scan")}
            className="mt-3 flex w-full items-center justify-center gap-1.5 text-xs font-medium text-slate-400 hover:text-slate-600"
          >
            <QrCode size={13} />
            Scan Asset Lain
          </button>
        </div>
      </div>

      <ReportIssueModal asset={asset} open={reportOpen} onClose={() => setReportOpen(false)} />
      <BorrowModal
        asset={asset}
        open={borrowOpen}
        onClose={() => setBorrowOpen(false)}
        onDone={() => {
          setBorrowOpen(false);
          setToast({ type: "success", message: "Asset berhasil dipinjam." });
          refreshAsset();
        }}
      />
      <ReturnModal
        asset={asset}
        open={returnOpen}
        onClose={() => setReturnOpen(false)}
        onDone={() => {
          setReturnOpen(false);
          setToast({ type: "success", message: "Asset berhasil dikembalikan." });
          refreshAsset();
        }}
      />
      <Toast toast={toast} onClose={() => setToast(null)} />
    </PageShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-slate-400">{label}</span>
      <span className="truncate font-medium text-slate-800">{value}</span>
    </div>
  );
}

function ActionButton({
  icon: Icon,
  label,
  onClick,
  tone = "default",
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  onClick: () => void;
  tone?: "default" | "warning";
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-semibold shadow-sm transition ${
        tone === "warning"
          ? "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
          : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
      }`}
    >
      <Icon size={16} />
      {label}
    </button>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-gradient-to-br from-slate-50 via-white to-blue-50 p-4">
      <div className="text-center">
        <img
          src="/qhse-care-icon.png"
          alt="QHSE Care"
          className="mx-auto mb-3 h-12 w-12 rounded-2xl object-cover shadow-lg shadow-blue-900/20"
        />
        <p className="text-lg font-bold text-slate-900">QHSE Care</p>
        <p className="text-sm text-slate-500">Aksi Cepat Asset</p>
      </div>
      {children}
    </div>
  );
}

function LoadingState() {
  return <div className="h-9 w-9 rounded-full border-2 border-slate-200 border-t-blue-600 animate-spin" />;
}

function ErrorState({ message }: { message: string }) {
  return (
    <div className="w-full max-w-md rounded-2xl border border-red-200 bg-red-50 p-5 text-center text-sm text-red-700">
      {message}
    </div>
  );
}
