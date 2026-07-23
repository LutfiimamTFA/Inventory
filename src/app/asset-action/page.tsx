"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { collection, getDocs, limit, query, where } from "firebase/firestore";
import {
  AlertTriangle,
  ArrowRightLeft,
  Eye,
  Pencil,
  Undo2,
} from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { Asset } from "@/lib/types";
import {
  ASSET_STATUS_COLOR,
  ASSET_STATUS_LABEL,
  CONDITION_LABEL,
} from "@/lib/utils";
import Badge from "@/components/Badge";
import ReportIssueModal from "@/components/ReportIssueModal";

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
  const { firebaseUser, assetUser, role, loading } = useAuth();
  const code = searchParams.get("code") || "";

  const [asset, setAsset] = useState<Asset | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loadingAsset, setLoadingAsset] = useState(true);
  const [reportOpen, setReportOpen] = useState(false);

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

    (async () => {
      try {
        const snap = await getDocs(
          query(collection(db, "assets"), where("assetCode", "==", code), limit(1))
        );
        if (cancelled) return;
        if (snap.empty) {
          setNotFound(true);
          setAsset(null);
        } else {
          const d = snap.docs[0];
          setAsset({ id: d.id, ...d.data() } as Asset);
        }
      } catch (error) {
        console.error("[Asset Action] gagal memuat asset", { code, error });
        setNotFound(true);
      } finally {
        if (!cancelled) setLoadingAsset(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loading, firebaseUser, code]);

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

  const usageStatus = asset.currentUsageStatus || asset.assetStatus;
  const isFixedLocation = asset.trackingMode === "fixed_location";
  const isHeldByMe =
    !!assetUser?.uid &&
    (asset.currentHolderUid === assetUser.uid || asset.custodianUid === assetUser.uid);
  const isAvailableToBorrow = asset.isBorrowable && usageStatus === "available" && !isHeldByMe;
  const usedBySomeoneElse =
    !isFixedLocation && !isHeldByMe && !isAvailableToBorrow && usageStatus !== "available";

  const isLocationPicOwner = role === "location_pic" && asset.areaPicUid === assetUser?.uid;

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

          <div className="mt-4 space-y-2 text-sm text-slate-600">
            <Row label="Lokasi" value={asset.location || asset.locationText || "-"} />
            <Row label="Kondisi" value={CONDITION_LABEL[asset.condition]} />
            {asset.areaPicName && <Row label="PIC Operasional" value={asset.areaPicName} />}
            {(asset.currentHolderName || asset.custodianName) && (
              <Row label="Pemegang Saat Ini" value={asset.currentHolderName || asset.custodianName || "-"} />
            )}
          </div>

          {usedBySomeoneElse && (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>
                Asset sedang digunakan oleh {asset.currentHolderName || asset.custodianName || asset.responsiblePersonName || "pengguna lain"}.
              </span>
            </div>
          )}

          <div className="mt-5 space-y-2">
            <ActionButton
              icon={Eye}
              label="Lihat Detail"
              onClick={() => router.push(`/assets/${asset.id}`)}
            />

            {isLocationPicOwner && (
              <ActionButton
                icon={Pencil}
                label="Edit Asset"
                onClick={() => router.push(`/assets/${asset.id}/edit`)}
              />
            )}

            {!isFixedLocation && isHeldByMe && (
              <ActionButton
                icon={Undo2}
                label="Kembalikan Asset"
                onClick={() => router.push(`/scan?code=${encodeURIComponent(asset.assetCode)}`)}
              />
            )}

            {!isFixedLocation && isAvailableToBorrow && (
              <ActionButton
                icon={ArrowRightLeft}
                label="Pinjam Asset"
                onClick={() => router.push(`/scan?code=${encodeURIComponent(asset.assetCode)}`)}
              />
            )}

            <ActionButton
              icon={AlertTriangle}
              label="Laporkan Kendala"
              tone="warning"
              onClick={() => setReportOpen(true)}
            />
          </div>
        </div>
      </div>

      <ReportIssueModal asset={asset} open={reportOpen} onClose={() => setReportOpen(false)} />
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

