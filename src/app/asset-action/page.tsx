"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { collection, doc, getDoc, getDocs, limit, query, where } from "firebase/firestore";
import {
  AlertTriangle,
  ArrowRightLeft,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  Eye,
  FileWarning,
  ImageIcon,
  Pencil,
  QrCode,
  RotateCw,
  ShieldCheck,
  Undo2,
  X,
  XCircle,
} from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { Asset, AssetBorrowing } from "@/lib/types";
import { isAssetInMyPicLocation } from "@/lib/locations";
import { repairBrokenBorrowState } from "@/lib/borrow-actions";
import { useEmployeeDirectory } from "@/lib/employeeDirectory";
import {
  TRACKING_MODE_LABEL,
  formatDate,
  formatDateLong,
  formatExpectedReturn,
  getAssetConditionLabel,
  hasBrokenBorrowState,
  isBorrowedByMe,
  isBorrowedByOther,
} from "@/lib/utils";
import { getAssetNumber, getAssetQuantity } from "@/lib/assets/inventory";
import {
  detectAssetDataAnomalies,
  getActiveIssueSummary,
  getAssetUsageColor,
  getAssetUsageLabel,
  getAssetUsageState,
  getAssetVerificationIndicators,
  getCurrentAssetHolder,
  getCurrentAssetHolderDisplayText,
  isAssetIdentityIncomplete,
  pickLatestActiveBorrowing,
  resolveAssetPhotoSrc,
} from "@/lib/assets/asset-status";
import { VerificationChecklist, logAssetQrScan, submitAssetVerification } from "@/lib/assets/asset-verification";
import Badge from "@/components/Badge";
import ReportProblemModal from "@/components/ReportProblemModal";
import { BorrowModal, ReturnModal } from "@/components/BorrowReturnModal";
import { Toast, ToastState } from "@/components/Toast";

// Section "Kembalikan flow Scan QR ke sistem stabil" — public read lewat
// /api/public/assets/by-code TERBUKTI belum stabil di production (500
// berulang), jadi halaman ini KEMBALI memakai gate login SEDERHANA seperti
// sebelumnya: belum login -> langsung redirect /login?returnUrl=..., baru
// setelah login data asset dimuat lewat client SDK yang memang sudah
// berjalan. Route /api/public/assets/by-code TETAP ada di repo untuk
// dikembangkan nanti, TAPI TIDAK DIPANGGIL sama sekali dari halaman ini —
// bukan dependency untuk membuka /asset-action lagi.
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
  const employeeDirectory = useEmployeeDirectory(!!assetUser?.uid);

  const [asset, setAsset] = useState<Asset | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loadingAsset, setLoadingAsset] = useState(true);
  const [problemOpen, setProblemOpen] = useState(false);
  const [borrowOpen, setBorrowOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [showFullDetail, setShowFullDetail] = useState(false);
  const [showIdentityDetail, setShowIdentityDetail] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [activeBorrowings, setActiveBorrowings] = useState<AssetBorrowing[]>([]);

  const [photoLoaded, setPhotoLoaded] = useState(false);
  const [photoFailed, setPhotoFailed] = useState(false);
  const [photoPreviewOpen, setPhotoPreviewOpen] = useState(false);

  const [verifyOpen, setVerifyOpen] = useState(false);
  const [verifySubmitting, setVerifySubmitting] = useState(false);

  // Section 6 — QR lama/baru harus tetap terbuka ke asset yang sama meskipun
  // isi QR berbeda-beda (assetCode polos, qrTagId, atau assetId dokumen).
  // Urutan fallback: assetCode -> qrTagId -> assetId (getDoc langsung).
  const fetchAssetByCode = useCallback(async (rawCode: string) => {
    const codeSnap = await getDocs(
      query(collection(db, "assets"), where("assetCode", "==", rawCode), limit(1))
    );
    if (!codeSnap.empty) {
      const d = codeSnap.docs[0];
      return { id: d.id, ...d.data() } as Asset;
    }

    const tagSnap = await getDocs(
      query(collection(db, "assets"), where("qrTagId", "==", rawCode), limit(1))
    );
    if (!tagSnap.empty) {
      const d = tagSnap.docs[0];
      return { id: d.id, ...d.data() } as Asset;
    }

    const byId = await getDoc(doc(db, "assets", rawCode));
    if (byId.exists()) {
      return { id: byId.id, ...byId.data() } as Asset;
    }

    return null;
  }, []);

  // Section 2 — SATU pintu gerbang: tunggu auth selesai, lalu kalau belum
  // login langsung redirect ke /login sambil membawa returnUrl balik ke
  // asset yang sama. `code` di-encodeURIComponent SEKALI supaya karakter
  // "/", ".", "-" pada kode asset (mis. "EGS.19/08/2026.DTIC.G-D02") tidak
  // pernah rusak/terpotong — getSafeReturnUrl di login/page.tsx (tidak
  // diubah) yang membaca returnUrl ini hanya menerima path internal
  // ("/..."), jadi tidak mungkin dipakai untuk open-redirect ke luar.
  useEffect(() => {
    if (loading) return;
    if (!firebaseUser) {
      const returnUrl = `/asset-action?code=${encodeURIComponent(code)}`;
      router.replace(`/login?returnUrl=${encodeURIComponent(returnUrl)}`);
    }
  }, [loading, firebaseUser, code, router]);

  useEffect(() => {
    if (loading || !firebaseUser || !code) return;

    let cancelled = false;
    queueMicrotask(() => {
      setLoadingAsset(true);
      setNotFound(false);
      setPhotoLoaded(false);
      setPhotoFailed(false);
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

  const refreshAsset = useCallback(async () => {
    if (!code) return;
    try {
      const found = await fetchAssetByCode(code);
      if (found) setAsset(found);
    } catch (error) {
      console.error("[Asset Action] gagal refresh asset", { code, error });
    }
  }, [code, fetchAssetByCode]);

  // Section "Perbaiki flow Laporkan Masalah" — begitu ReportProblemModal
  // sukses membuat ticket, langsung update state `asset` di sini SECARA
  // OPTIMISTIS (tanpa menunggu refetch Firestore) supaya badge "Ada Laporan
  // Aktif" tampil seketika DAN guard "sudah ada laporan aktif" di modal
  // langsung aktif kalau user menekan "Laporkan Masalah" lagi sebelum
  // refetch selesai — mencegah laporan ganda akibat race klik cepat.
  const handleProblemSubmitted = useCallback(
    (info: { ticketId: string; ticketNumber: string; symptomLabel: string; note: string }) => {
      setAsset((prev) =>
        prev
          ? {
              ...prev,
              hasActiveIssue: true,
              activeIssueTicketId: info.ticketId,
              activeIssueTicketNo: info.ticketNumber,
              condition: "reported_issue",
              conditionLabel: "Perlu Pemeriksaan",
              issueReportedAt: new Date().toISOString(),
              issueReportedByUid: assetUser?.uid || firebaseUser?.uid || prev.issueReportedByUid,
              issueReportedByName: assetUser?.name || firebaseUser?.email || prev.issueReportedByName,
              lastIssueSymptomLabel: info.symptomLabel,
              lastIssueNote: info.note,
            }
          : prev
      );
      void refreshAsset();
    },
    [assetUser?.uid, assetUser?.name, firebaseUser?.uid, firebaseUser?.email, refreshAsset]
  );

  useEffect(() => {
    if (!asset?.id) {
      queueMicrotask(() => setActiveBorrowings([]));
      return;
    }
    let cancelled = false;
    getDocs(query(collection(db, "asset_borrowings"), where("assetId", "==", asset.id)))
      .then((snap) => {
        if (cancelled) return;
        setActiveBorrowings(snap.docs.map((d) => ({ id: d.id, ...d.data() } as AssetBorrowing)));
      })
      .catch((error) => {
        console.error("[Asset Action] gagal memuat asset_borrowings", { assetId: asset.id, error });
      });
    return () => {
      cancelled = true;
    };
  }, [asset?.id]);

  // Section 7/9 — catat SETIAP QR discan begitu asset+user diketahui.
  // Kegagalan tetap non-fatal (try/catch di logAssetQrScan sendiri).
  const loggedForRef = useRef<string | null>(null);
  useEffect(() => {
    if (!asset?.id || !assetUser?.uid) return;
    const key = `${asset.id}|${assetUser.uid}`;
    if (loggedForRef.current === key) return;
    loggedForRef.current = key;

    const activeBorrowing = pickLatestActiveBorrowing(activeBorrowings);
    const holder = getCurrentAssetHolder(asset, activeBorrowing);
    logAssetQrScan({
      asset,
      usageStatus: getAssetUsageState(asset, activeBorrowing),
      holderUid: holder.uid,
      holderName: holder.name,
      scannedByUid: assetUser.uid,
      scannedByName: assetUser.name || firebaseUser?.email || "",
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asset?.id, assetUser?.uid]);

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

  // Section A — dari titik ini `asset` SUDAH DIJAMIN ada (guard di atas).
  const isFixedLocation = asset.trackingMode === "fixed_location";
  const borrowedByMe = isBorrowedByMe(asset, { uid: assetUser?.uid || firebaseUser.uid });
  const borrowedByOther = isBorrowedByOther(asset, { uid: assetUser?.uid || firebaseUser.uid });
  const brokenBorrowState = hasBrokenBorrowState(asset);
  const activeBorrowing = pickLatestActiveBorrowing(activeBorrowings);
  const activeIssue = getActiveIssueSummary(asset);
  const isAvailableToBorrow =
    asset.isBorrowable && !isFixedLocation && !borrowedByMe && !borrowedByOther && !brokenBorrowState && !activeIssue.hasIssue;

  const usageLabel = getAssetUsageLabel(asset, activeBorrowing);
  const usageColor = getAssetUsageColor(asset, activeBorrowing);
  const rawHolder = getCurrentAssetHolder(asset, activeBorrowing);
  const resolvedHolderName =
    rawHolder.name || employeeDirectory.resolveName(rawHolder.uid, rawHolder.email) || null;
  const holder = { ...rawHolder, name: resolvedHolderName };
  const holderDisplayText = getCurrentAssetHolderDisplayText(holder);
  const dataAnomalies = detectAssetDataAnomalies(asset, activeBorrowings);
  const canSeeAnomalies = role === "super_admin" || role === "asset_admin";

  const isLocationPicScoped = role === "location_pic" || isLocationPicRole;
  const isLocationPicOwner = isLocationPicScoped && isAssetInMyPicLocation(asset, assignedPicLocations, assetUser?.uid);
  const canOpenFullDetailPage =
    role === "super_admin" || role === "asset_admin" || role === "asset_finance" || role === "it_team" || isLocationPicOwner;
  const canRepairBrokenState = role === "super_admin" || role === "asset_admin";

  const verificationIndicators = getAssetVerificationIndicators(asset);
  const identityIncomplete = isAssetIdentityIncomplete(asset);
  const photo = resolveAssetPhotoSrc(asset);

  const activeTicketLink = asset.activeIssueTicketId
    ? canSeeAnomalies
      ? `/maintenance?tab=staff-reports&ticketId=${asset.activeIssueTicketId}`
      : `/my-reports?ticketId=${asset.activeIssueTicketId}`
    : null;
  const isActiveIssueReporter = !!assetUser?.uid && asset.issueReportedByUid === assetUser.uid;

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
        message: `Asset sedang dipinjam oleh ${holder.name || "user lain"}.`,
      });
      return;
    }
    if (brokenBorrowState) {
      setToast({ type: "error", message: "Data peminjaman asset tidak sinkron. Hubungi Asset Admin." });
      return;
    }
    if (activeIssue.hasIssue) {
      setToast({ type: "error", message: "Asset tidak dapat dipinjam sebelum laporan kendala selesai." });
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

  const handleSubmitVerification = async (checklist: VerificationChecklist) => {
    if (!assetUser?.uid) return;
    setVerifySubmitting(true);
    try {
      await submitAssetVerification({
        asset,
        checklist,
        performedByUid: assetUser.uid,
        performedByName: assetUser.name || firebaseUser.email || "",
      });
      setToast({ type: "success", message: "Asset dikonfirmasi sesuai dan tercatat sebagai terverifikasi." });
      setVerifyOpen(false);
      refreshAsset();
    } catch (error) {
      const err = error as { code?: string; message?: string; name?: string };
      console.error("[Asset Action] gagal menyimpan verifikasi", {
        collection: "asset_verification_logs",
        assetId: asset.id,
        errorCode: err?.code,
        errorMessage: err?.message,
        errorName: err?.name,
      });
      setToast({ type: "error", message: "Gagal menyimpan hasil verifikasi." });
    } finally {
      setVerifySubmitting(false);
    }
  };

  return (
    <PageShell>
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <AssetPhotoBlock
            photoSrc={photo.src}
            assetName={asset.assetName}
            loaded={photoLoaded}
            failed={photoFailed}
            onLoad={() => setPhotoLoaded(true)}
            onError={() => setPhotoFailed(true)}
            onPreview={() => photo.src && !photoFailed && setPhotoPreviewOpen(true)}
            canManage={canSeeAnomalies}
            onCompletePhoto={() => router.push(`/assets/${asset.id}/edit`)}
          />

          <div className="mt-4 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-mono text-xs text-slate-400">{asset.assetCode}</p>
              <h2 className="truncate text-lg font-bold text-slate-900">{asset.assetName}</h2>
            </div>
            <Badge label={usageLabel} colorClass={usageColor} />
          </div>

          {/* Section 9 — badge kecil "Ada Laporan Aktif" tampil SEKETIKA
              laporan berhasil dibuat (state `asset` di-update optimistis
              oleh handleProblemSubmitted), tidak menunggu refresh manual. */}
          {activeIssue.hasIssue && (
            <div className="mt-1.5 flex justify-end">
              <Badge label="Ada Laporan Aktif" colorClass="bg-amber-100 text-amber-700 border-amber-200" />
            </div>
          )}

          {activeIssue.hasIssue && (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-amber-800">
              <p className="text-sm font-semibold">Asset Dilaporkan Bermasalah</p>
              <p className="mt-0.5 text-sm">Laporan {activeIssue.ticketNo || "-"} sedang menunggu review QHSE.</p>
              {activeIssue.symptomLabel && <p className="mt-1 text-xs">Gejala: {activeIssue.symptomLabel}</p>}
              {activeIssue.note && <p className="mt-0.5 text-xs">Catatan: &ldquo;{activeIssue.note}&rdquo;</p>}
            </div>
          )}

          {canSeeAnomalies &&
            dataAnomalies.map((anomaly) => (
              <div key={anomaly.code} className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                <p className="font-semibold">{anomaly.title}</p>
                <p className="mt-0.5">{anomaly.message}</p>
              </div>
            ))}

          <div className="mt-4 space-y-2 text-sm text-slate-600">
            <Row label="Lokasi" value={asset.location || asset.locationText || "-"} />
            <Row label="Kondisi Aset" value={getAssetConditionLabel(asset)} />
            {asset.areaPicName && <Row label="PIC Operasional" value={asset.areaPicName} />}
            {!isFixedLocation && <Row label="Pemegang Saat Ini" value={holderDisplayText} />}
            {!isFixedLocation && activeBorrowing?.estimatedReturnAt && (
              <Row label="Estimasi Kembali" value={formatExpectedReturn(activeBorrowing.estimatedReturnAt)} />
            )}
            {!isFixedLocation && canSeeAnomalies && holder.hasHolderSignal && !holder.name && (
              <p className="text-right text-[11px] text-amber-600">Perlu sinkronisasi data pemegang</p>
            )}
          </div>

          {!canOpenFullDetailPage && showFullDetail && (
            <div className="mt-3 space-y-2 border-t border-slate-100 pt-3 text-sm text-slate-600">
              <Row label="Kategori" value={asset.categoryName || "Belum tersedia"} />
              <Row
                label="Tanggal Perolehan"
                value={
                  asset.acquisitionDate || asset.purchaseDate
                    ? formatDateLong(asset.acquisitionDate || asset.purchaseDate)
                    : "Belum tersedia"
                }
              />
              <Row label="Qty" value={`${getAssetQuantity(asset)} Unit`} />
              <Row label="Mode Tracking" value={asset.trackingMode ? TRACKING_MODE_LABEL[asset.trackingMode] : "-"} />
              {asset.operationalNotes && <Row label="Catatan Operasional" value={asset.operationalNotes} />}
            </div>
          )}

          <div className="mt-4 border-t border-slate-100 pt-3">
            <button
              type="button"
              onClick={() => setShowIdentityDetail((prev) => !prev)}
              className="flex w-full items-center justify-between text-left"
            >
              <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-700">
                <ShieldCheck size={15} className="text-blue-600" />
                Identitas Aset Terverifikasi
              </span>
              {showIdentityDetail ? (
                <ChevronUp size={16} className="text-slate-400" />
              ) : (
                <ChevronDown size={16} className="text-slate-400" />
              )}
            </button>

            {showIdentityDetail && (
              <div className="mt-3 space-y-3">
                <div className="rounded-xl border border-blue-100 bg-blue-50/60 p-3 text-xs text-blue-800">
                  <p className="font-semibold">Status QR: Terdaftar di Sistem</p>
                  <p className="mt-1">
                    Tag QR ini terdaftar dalam sistem. Cocokkan foto, nama, dan kode aset dengan barang di
                    hadapan Anda.
                  </p>
                </div>

                <div className="space-y-2 text-sm text-slate-600">
                  <Row
                    label="No. Aset"
                    value={getAssetNumber(asset) !== null ? String(getAssetNumber(asset)) : "Belum tersedia"}
                  />
                  <Row label="Nama Aset" value={asset.assetName || "Belum tersedia"} />
                  <Row label="Kode Aset" value={asset.assetCode || "Belum tersedia"} />
                  <Row label="Kategori Aset" value={asset.categoryName || "Belum tersedia"} />
                  <Row
                    label="Tanggal Perolehan"
                    value={
                      asset.acquisitionDate || asset.purchaseDate
                        ? formatDateLong(asset.acquisitionDate || asset.purchaseDate)
                        : "Belum tersedia"
                    }
                  />
                  <Row label="Qty" value={`${getAssetQuantity(asset)} Unit`} />
                  <Row label="Perusahaan" value={asset.companyOwnerName || "Belum tersedia"} />
                  {asset.divisionOwnerName && <Row label="Divisi" value={asset.divisionOwnerName} />}
                  <Row label="Lokasi Terdaftar" value={asset.location || asset.locationText || "Belum tersedia"} />
                  <Row
                    label="Terakhir Diverifikasi"
                    value={asset.lastVerifiedAt ? formatDate(asset.lastVerifiedAt) : "Belum pernah"}
                  />
                  {asset.lastVerifiedByName && <Row label="Diverifikasi Oleh" value={asset.lastVerifiedByName} />}
                </div>

                <div className="space-y-1.5 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  {verificationIndicators.map((indicator) => (
                    <div key={indicator.key} className="flex items-center gap-2 text-xs">
                      {indicator.ok ? (
                        <CheckCircle2 size={14} className="shrink-0 text-emerald-600" />
                      ) : indicator.neutral ? (
                        <Circle size={14} className="shrink-0 text-slate-300" />
                      ) : (
                        <XCircle size={14} className="shrink-0 text-red-400" />
                      )}
                      <span className={indicator.ok ? "text-slate-700" : "text-slate-400"}>{indicator.label}</span>
                    </div>
                  ))}
                </div>

                {identityIncomplete ? (
                  <p className="text-xs text-amber-600">
                    Identitas aset belum lengkap. Lengkapi data yang ditandai.
                  </p>
                ) : asset.lastVerifiedAt ? (
                  <p className="text-xs text-emerald-600">
                    Identitas aset lengkap dan terdaftar di sistem.
                  </p>
                ) : (
                  <p className="text-xs text-slate-500">
                    Identitas aset lengkap. Verifikasi fisik belum pernah dilakukan.
                  </p>
                )}
              </div>
            )}
          </div>

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
              <span>Asset sedang dipinjam oleh {holder.name || "user lain"}.</span>
            </div>
          )}

          {borrowedByMe && (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>Asset ini sedang Anda pinjam.</span>
            </div>
          )}

          {/* Section 3/10 — layout aksi: Lihat Detail / Pinjam Asset /
              (Konfirmasi Asset, Laporkan Masalah berdampingan) / Scan Asset
              Lain. "Laporkan Masalah" SATU-SATUNYA entry point laporan
              (bekas "Laporkan Temuan" + "Laporkan Ketidaksesuaian" digabung). */}
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

            {activeIssue.hasIssue && activeTicketLink && (
              <ActionButton
                icon={FileWarning}
                label="Lihat Laporan Aktif"
                tone="warning"
                onClick={() => router.push(activeTicketLink)}
              />
            )}

            {activeIssue.hasIssue && isActiveIssueReporter && activeTicketLink && (
              <ActionButton
                icon={Camera}
                label="Tambahkan Bukti"
                tone="warning"
                onClick={() => router.push(activeTicketLink)}
              />
            )}

            <div className="grid grid-cols-2 gap-2 pt-1">
              <ActionButton icon={CheckCircle2} label="Konfirmasi Asset" onClick={() => setVerifyOpen(true)} />
              <ActionButton
                icon={AlertTriangle}
                label="Laporkan Masalah"
                tone="warning"
                onClick={() => setProblemOpen(true)}
              />
            </div>
          </div>

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

      {photoPreviewOpen && photo.src && (
        <PhotoPreviewOverlay src={photo.src} assetName={asset.assetName} onClose={() => setPhotoPreviewOpen(false)} />
      )}

      {verifyOpen && (
        <VerificationChecklistModal
          submitting={verifySubmitting}
          onClose={() => setVerifyOpen(false)}
          onSubmit={handleSubmitVerification}
          onReportProblem={() => {
            setVerifyOpen(false);
            setProblemOpen(true);
          }}
        />
      )}

      <ReportProblemModal
        asset={asset}
        open={problemOpen}
        activeBorrowing={activeBorrowing}
        onClose={() => setProblemOpen(false)}
        onSubmitted={handleProblemSubmitted}
      />

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
        onDone={(message) => {
          setReturnOpen(false);
          setToast({ type: "success", message: message || "Asset berhasil dikembalikan." });
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

function AssetPhotoBlock({
  photoSrc,
  assetName,
  loaded,
  failed,
  onLoad,
  onError,
  onPreview,
  canManage,
  onCompletePhoto,
}: {
  photoSrc: string | null;
  assetName: string;
  loaded: boolean;
  failed: boolean;
  onLoad: () => void;
  onError: () => void;
  onPreview: () => void;
  canManage: boolean;
  onCompletePhoto: () => void;
}) {
  const showImage = !!photoSrc && !failed;

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
      <div className="relative aspect-video w-full">
        {showImage ? (
          <>
            {!loaded && <div className="absolute inset-0 animate-pulse bg-slate-200" />}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photoSrc as string}
              alt={assetName}
              onLoad={onLoad}
              onError={onError}
              onClick={onPreview}
              className={`h-full w-full cursor-zoom-in object-cover transition-opacity ${
                loaded ? "opacity-100" : "opacity-0"
              }`}
            />
          </>
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1.5 px-4 text-center">
            <ImageIcon size={28} className="text-slate-300" />
            <p className="text-xs text-slate-400">
              {photoSrc && failed ? "Foto aset gagal dimuat." : "Foto verifikasi aset belum tersedia."}
            </p>
          </div>
        )}
      </div>
      {canManage && (!photoSrc || failed) && (
        <button
          type="button"
          onClick={onCompletePhoto}
          className="flex w-full items-center justify-center gap-1.5 border-t border-slate-200 bg-white py-2 text-xs font-semibold text-blue-600 hover:bg-blue-50"
        >
          <Camera size={13} />
          Lengkapi Foto Aset
        </button>
      )}
    </div>
  );
}

function PhotoPreviewOverlay({
  src,
  assetName,
  onClose,
}: {
  src: string;
  assetName: string;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={onClose}>
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white hover:bg-white/20"
      >
        <X size={20} />
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={assetName}
        onClick={(e) => e.stopPropagation()}
        className="max-h-full max-w-full rounded-lg object-contain"
      />
    </div>
  );
}

// Section 8/9 — checklist UI disederhanakan jadi 3 poin (Serial Number sudah
// tidak dipakai di struktur Asset terbaru). "Kode / QR sesuai" mewakili DUA
// field lama sekaligus (codeMatches + qrOnRightItem) supaya bentuk data
// VerificationChecklist yang ditulis ke asset_verification_logs TIDAK
// berubah — hanya tampilannya yang dipadatkan.
const VERIFICATION_UI_ITEMS: { key: "photo" | "code" | "location"; label: string }[] = [
  { key: "photo", label: "Barang / foto sesuai" },
  { key: "code", label: "Kode / QR sesuai" },
  { key: "location", label: "Lokasi / PIC sesuai" },
];

function VerificationChecklistModal({
  submitting,
  onClose,
  onSubmit,
  onReportProblem,
}: {
  submitting: boolean;
  onClose: () => void;
  onSubmit: (checklist: VerificationChecklist) => void;
  onReportProblem: () => void;
}) {
  const [checked, setChecked] = useState<Record<"photo" | "code" | "location", boolean>>({
    photo: false,
    code: false,
    location: false,
  });

  const allChecked = checked.photo && checked.code && checked.location;

  const toggleAll = () => {
    const next = !allChecked;
    setChecked({ photo: next, code: next, location: next });
  };

  const handleSubmit = () => {
    onSubmit({
      photoMatches: checked.photo,
      codeMatches: checked.code,
      qrOnRightItem: checked.code,
      locationAndHolderMatch: checked.location,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <div className="w-full max-w-md rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-slate-900">Konfirmasi Aset Sesuai</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Centang semua yang sudah Anda cocokkan langsung dengan barang fisik di hadapan Anda.
        </p>

        <div className="mt-4 space-y-2.5">
          <label className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-blue-200 bg-blue-50/60 px-3 py-2.5 text-sm font-medium text-blue-800">
            <input
              type="checkbox"
              checked={allChecked}
              onChange={toggleAll}
              className="h-4 w-4 rounded border-slate-300 text-blue-600"
            />
            Semua sesuai
          </label>

          {VERIFICATION_UI_ITEMS.map((item) => (
            <label
              key={item.key}
              className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-700"
            >
              <input
                type="checkbox"
                checked={checked[item.key]}
                onChange={(e) => setChecked((prev) => ({ ...prev, [item.key]: e.target.checked }))}
                className="h-4 w-4 rounded border-slate-300 text-blue-600"
              />
              {item.label}
            </label>
          ))}
        </div>

        <button
          type="button"
          disabled={!allChecked || submitting}
          onClick={handleSubmit}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Check size={16} />
          {submitting ? "Menyimpan..." : "Simpan Verifikasi"}
        </button>

        <button
          type="button"
          onClick={onReportProblem}
          className="mt-3 flex w-full items-center justify-center gap-1.5 text-xs font-medium text-amber-600 hover:text-amber-700"
        >
          <AlertTriangle size={13} />
          Ada yang tidak sesuai? Laporkan Masalah
        </button>
      </div>
    </div>
  );
}

function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-6 bg-gradient-to-br from-slate-50 via-white to-blue-50 p-4">
      <div className="text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
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
