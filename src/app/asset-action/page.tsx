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
import { getAssetIssueReportContext } from "@/lib/asset-issue-reporting";
import { useEmployeeDirectory } from "@/lib/employeeDirectory";
import {
  TRACKING_MODE_LABEL,
  formatDate,
  formatExpectedReturn,
  getAssetConditionLabel,
  hasBrokenBorrowState,
  isBorrowedByMe,
  isBorrowedByOther,
} from "@/lib/utils";
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
import {
  VerificationChecklist,
  logAssetQrScan,
  submitAssetMismatchReport,
  submitAssetVerification,
} from "@/lib/assets/asset-verification";
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
  const employeeDirectory = useEmployeeDirectory();

  const [asset, setAsset] = useState<Asset | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loadingAsset, setLoadingAsset] = useState(true);
  const [reportOpen, setReportOpen] = useState(false);
  const [borrowOpen, setBorrowOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [showFullDetail, setShowFullDetail] = useState(false);
  const [showIdentityDetail, setShowIdentityDetail] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);
  // Section 1/4 — borrowing AKTIF untuk aset ini, sumber utama status
  // pemakaian & pemegang (lihat lib/assets/asset-status.ts) — bukan cuma
  // baca field mentah di dokumen assets yang bisa tidak sinkron.
  const [activeBorrowings, setActiveBorrowings] = useState<AssetBorrowing[]>([]);

  // Section 2/10 — foto ASLI aset (bukan logo QHSE): loading skeleton +
  // fallback kalau gagal dimuat + preview besar.
  const [photoLoaded, setPhotoLoaded] = useState(false);
  const [photoFailed, setPhotoFailed] = useState(false);
  const [photoPreviewOpen, setPhotoPreviewOpen] = useState(false);

  // Section 6/7 — "Konfirmasi Aset Sesuai" / "Laporkan Ketidaksesuaian",
  // TERPISAH dari laporan kerusakan (ReportIssueModal).
  const [verifyOpen, setVerifyOpen] = useState(false);
  const [mismatchOpen, setMismatchOpen] = useState(false);
  const [verifySubmitting, setVerifySubmitting] = useState(false);
  const [mismatchSubmitting, setMismatchSubmitting] = useState(false);

  // Section K — diekstrak jadi fungsi sendiri supaya bisa dipanggil ULANG
  // setelah Pinjam/Kembalikan sukses (refresh status asset), TANPA perlu
  // scan ulang atau redirect ke /scan sama sekali.
  // Section 6 — QR lama/baru harus tetap terbuka ke asset yang sama meskipun
  // isi QR berbeda-beda (assetCode polos, qrTagId, atau assetId dokumen).
  // Urutan fallback: assetCode -> qrTagId -> assetId (getDoc langsung),
  // berhenti begitu salah satu ditemukan.
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

  // Section 4 — begitu asset diketahui, ambil SEMUA asset_borrowings yang
  // menunjuk ke asset ini (assetId) — bukan cuma percaya field currentHolder*
  // di dokumen assets, yang bisa telat/tidak sinkron dari borrowing yang
  // sebenarnya masih aktif.
  useEffect(() => {
    if (!asset?.id) {
      Promise.resolve().then(() => setActiveBorrowings([]));
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

  // Section 8/9 — catat SETIAP QR discan (bukan verifikasi fisik) begitu
  // asset+user diketahui. loggedForRef mencegah log ganda untuk asset yang
  // sama selama komponen ini hidup (termasuk saat React Strict Mode
  // menjalankan effect dua kali di dev) — dikombinasikan dengan dedupe
  // in-memory di lib/assets/asset-verification.ts.
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
    // activeBorrowings sengaja tidak dipakai ulang sebagai dependency biar
    // scan hanya dicatat SEKALI per asset+user per kunjungan halaman ini,
    // bukan setiap kali daftar borrowing selesai fetch.
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

  // Section A — status dibaca lewat helper normalisasi (lib/utils.ts),
  // BUKAN dibaca mentah dari satu field saja — asset ini bisa punya data
  // dari skema lama (assetStatus/currentBorrower*) maupun skema baru
  // (currentUsageStatus/currentHolder*), dan keduanya harus dianggap sah.
  const isFixedLocation = asset.trackingMode === "fixed_location";
  const borrowedByMe = isBorrowedByMe(asset, { uid: assetUser?.uid || firebaseUser.uid });
  const borrowedByOther = isBorrowedByOther(asset, { uid: assetUser?.uid || firebaseUser.uid });
  const brokenBorrowState = hasBrokenBorrowState(asset);

  // Section 1/2 — SATU sumber untuk status pemakaian + pemegang, lewat
  // lib/assets/asset-status.ts, supaya badge dan pesan warning tidak lagi
  // bisa saling bertentangan (akar bug: badge sebelumnya baca assetStatus
  // mentah, warning baca currentUsageStatus — dua field yang bisa beda).
  const activeBorrowing = pickLatestActiveBorrowing(activeBorrowings);
  const activeIssue = getActiveIssueSummary(asset);
  // Section 5 — status inspection_required/reported_issue mengunci Pinjam
  // Aset TOTAL sampai laporan aktif selesai, terlepas dari isBorrowable.
  const isAvailableToBorrow =
    asset.isBorrowable &&
    !isFixedLocation &&
    !borrowedByMe &&
    !borrowedByOther &&
    !brokenBorrowState &&
    !activeIssue.hasIssue;

  const quickReportContext = getAssetIssueReportContext({
    user: assetUser?.uid
      ? {
          uid: assetUser.uid,
          name: assetUser.name || "",
          email: assetUser.email || "",
          role: role || assetUser.role || "staff",
        }
      : null,
    asset,
    activeBorrowing,
    allowQrPhysicalObservation: true,
  });
  // Section 5 — kalau SUDAH ada laporan aktif, jangan tawarkan "laporkan
  // kendala baru" lagi — arahkan ke "Lihat Laporan Aktif"/"Tambahkan Bukti"
  // di bawah supaya tidak ada dua tiket kendala yang tumpang tindih.
  const canReportIssue = quickReportContext.canReport && !activeIssue.hasIssue;
  const reportIssueLabel = borrowedByMe
    ? "Laporkan Kendala"
    : borrowedByOther
    ? "Laporkan Temuan Fisik"
    : "Laporkan Temuan";
  const usageLabel = getAssetUsageLabel(asset, activeBorrowing);
  const usageColor = getAssetUsageColor(asset, activeBorrowing);
  const rawHolder = getCurrentAssetHolder(asset, activeBorrowing);
  // Section 1 — kalau sistem cuma tahu UID pemegang (nama belum ke-resolve
  // di data borrowing/asset), coba resolve dari direktori karyawan
  // (employee_profiles/users) SEBELUM menyerah ke "Data pemegang belum
  // tersinkron" — ini langkah fallback TERAKHIR persis seperti diminta.
  const resolvedHolderName =
    rawHolder.name || employeeDirectory.resolveName(rawHolder.uid, rawHolder.email) || null;
  const holder = { ...rawHolder, name: resolvedHolderName };
  const holderDisplayText = getCurrentAssetHolderDisplayText(holder);
  const dataAnomalies = detectAssetDataAnomalies(asset, activeBorrowings);
  const canSeeAnomalies = role === "super_admin" || role === "asset_admin";

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

  // Section 4 — indikator kelengkapan identitas fisik + status QR.
  const verificationIndicators = getAssetVerificationIndicators(asset);
  const identityIncomplete = isAssetIdentityIncomplete(asset);
  const photo = resolveAssetPhotoSrc(asset);

  // Section 5 — tiket kendala aktif: arahkan "Lihat Laporan Aktif" ke tempat
  // yang tepat sesuai peran (QHSE/Admin ke board Maintenance & Kendala,
  // staff pelapor ke Laporan Saya).
  const activeTicketLink = asset.activeIssueTicketId
    ? canSeeAnomalies
      ? `/maintenance?tab=staff-reports&ticketId=${asset.activeIssueTicketId}`
      : `/my-reports?ticketId=${asset.activeIssueTicketId}`
    : null;
  const isActiveIssueReporter = !!assetUser?.uid && asset.issueReportedByUid === assetUser.uid;

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

  const handleSubmitMismatch = async (reasons: string[], note: string) => {
    if (!assetUser?.uid) return;
    setMismatchSubmitting(true);
    try {
      await submitAssetMismatchReport({
        asset,
        reasons,
        note,
        performedByUid: assetUser.uid,
        performedByName: assetUser.name || firebaseUser.email || "",
      });
      setToast({ type: "success", message: "Laporan ketidaksesuaian berhasil dikirim ke QHSE." });
      setMismatchOpen(false);
    } catch (error) {
      const err = error as { code?: string; message?: string; name?: string };
      console.error("[Asset Action] gagal mengirim laporan ketidaksesuaian", {
        collection: "asset_verification_logs",
        assetId: asset.id,
        errorCode: err?.code,
        errorMessage: err?.message,
        errorName: err?.name,
      });
      setToast({ type: "error", message: "Gagal mengirim laporan ketidaksesuaian." });
    } finally {
      setMismatchSubmitting(false);
    }
  };

  return (
    <PageShell>
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          {/* Section 2/10 — foto ASLI aset SELALU di paling atas card (urutan
              mobile: foto -> status QR -> nama/kode -> ...). */}
          <AssetPhotoBlock
            photo={photo}
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
            {/* Section 3 — Status Pemakaian TERPISAH dari Kondisi Aset (Row di
                bawah) — badge ini SELALU lewat getAssetUsageLabel/Color, bukan
                baca assetStatus mentah, supaya tidak lagi bisa bertentangan
                dengan pesan "dipinjam oleh user lain" di bawah. */}
            <Badge label={usageLabel} colorClass={usageColor} />
          </div>

          {activeIssue.hasIssue && (
            <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3.5 text-amber-800">
              <p className="font-semibold text-sm">Asset Dilaporkan Bermasalah</p>
              <p className="text-sm mt-0.5">Laporan {activeIssue.ticketNo || "-"} sedang menunggu review QHSE.</p>
              {activeIssue.symptomLabel && <p className="text-xs mt-1">Gejala: {activeIssue.symptomLabel}</p>}
              {activeIssue.note && <p className="text-xs mt-0.5">Catatan: &ldquo;{activeIssue.note}&rdquo;</p>}
            </div>
          )}

          {/* Section 13 — anomali data HANYA untuk Asset Admin/QHSE, bahasa
              netral (bukan "korupsi data"), tidak pernah memblokir staff. */}
          {canSeeAnomalies &&
            dataAnomalies.map((anomaly) => (
              <div
                key={anomaly.code}
                className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700"
              >
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
            {/* Section 1 — sistem TAHU ada pemegang tapi namanya belum
                ke-resolve (uid ada, nama kosong walau sudah dicoba dari
                direktori karyawan) — cuma tampil untuk Asset Admin/QHSE,
                bukan noise buat staff, dan TIDAK PERNAH tampil kalau status
                pemakaian sudah jelas "Sedang Dipakai"/"Sedang Dipinjam" dan
                nama berhasil ditemukan lewat fallback di atas. */}
            {!isFixedLocation && canSeeAnomalies && holder.hasHolderSignal && !holder.name && (
              <p className="text-right text-[11px] text-amber-600">Perlu sinkronisasi data pemegang</p>
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

          {/* Section 3/10 — "Identitas Aset Terverifikasi", accordion supaya
              card tetap ringkas di mobile. */}
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
                    Tag QR ini terdaftar dalam sistem. Cocokkan foto, kode aset, nomor seri, dan tag fisik dengan
                    barang di hadapan Anda.
                  </p>
                </div>

                <div className="space-y-2 text-sm text-slate-600">
                  <Row label="Nama Aset" value={asset.assetName} />
                  <Row label="Kode Aset" value={asset.assetCode} />
                  <Row label="Merek" value={asset.brand || "-"} />
                  <Row label="Model" value={asset.model || "-"} />
                  <Row label="Nomor Seri" value={asset.serialNumber || "-"} />
                  <Row label="Nomor Tag Fisik" value={asset.qrTagId || "-"} />
                  <Row label="Perusahaan" value={asset.companyOwnerName || "-"} />
                  <Row label="Divisi" value={asset.divisionOwnerName || "-"} />
                  <Row label="Lokasi Terdaftar" value={asset.location || asset.locationText || "-"} />
                  <Row
                    label="Terakhir Diverifikasi"
                    value={asset.lastVerifiedAt ? formatDate(asset.lastVerifiedAt) : "Belum pernah"}
                  />
                  <Row label="Diverifikasi Oleh" value={asset.lastVerifiedByName || "-"} />
                </div>

                <div className="space-y-1.5 rounded-xl border border-slate-200 bg-slate-50 p-3">
                  {verificationIndicators.map((indicator) => (
                    <div key={indicator.key} className="flex items-center gap-2 text-xs">
                      {indicator.ok ? (
                        <CheckCircle2 size={14} className="shrink-0 text-emerald-600" />
                      ) : (
                        <XCircle size={14} className="shrink-0 text-slate-300" />
                      )}
                      <span className={indicator.ok ? "text-slate-700" : "text-slate-400"}>{indicator.label}</span>
                    </div>
                  ))}
                </div>

                {identityIncomplete && (
                  <p className="text-xs text-amber-600">
                    Identitas aset belum lengkap dan perlu diverifikasi QHSE.
                  </p>
                )}
              </div>
            )}
          </div>

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
              <span>Asset sedang dipinjam oleh {holder.name || "user lain"}.</span>
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

            {/* Section 5 — status pemakaian tetap dulu (kembalikan/pinjam),
                lalu laporan aktif (kalau ada), lalu laporan baru. */}
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

            {canReportIssue && (
              <ActionButton
                icon={AlertTriangle}
                label={reportIssueLabel}
                tone="warning"
                onClick={() => setReportOpen(true)}
              />
            )}

            {/* Section 6 — verifikasi identitas fisik, TERPISAH dari laporan
                kerusakan/kendala di atas. Selalu tersedia (tidak tergantung
                status pemakaian) supaya siapa pun yang scan bisa mencocokkan
                barang di depannya dengan data sistem. */}
            <div className="grid grid-cols-2 gap-2 pt-1">
              <ActionButton icon={CheckCircle2} label="Konfirmasi Aset Sesuai" onClick={() => setVerifyOpen(true)} />
              <ActionButton
                icon={FileWarning}
                label="Laporkan Ketidaksesuaian"
                tone="warning"
                onClick={() => setMismatchOpen(true)}
              />
            </div>
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

      {photoPreviewOpen && photo.src && (
        <PhotoPreviewOverlay src={photo.src} assetName={asset.assetName} onClose={() => setPhotoPreviewOpen(false)} />
      )}

      {verifyOpen && (
        <VerificationChecklistModal
          submitting={verifySubmitting}
          onClose={() => setVerifyOpen(false)}
          onSubmit={handleSubmitVerification}
        />
      )}

      {mismatchOpen && (
        <MismatchReportModal
          submitting={mismatchSubmitting}
          onClose={() => setMismatchOpen(false)}
          onSubmit={handleSubmitMismatch}
        />
      )}

      <ReportIssueModal
        asset={asset}
        open={reportOpen}
        activeBorrowing={activeBorrowing}
        allowQrPhysicalObservation
        onClose={() => setReportOpen(false)}
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

// Section 2/10 — blok foto ASLI aset dengan skeleton loading + fallback
// error, TIDAK PERNAH menampilkan logo QHSE sebagai pengganti foto.
function AssetPhotoBlock({
  photo,
  assetName,
  loaded,
  failed,
  onLoad,
  onError,
  onPreview,
  canManage,
  onCompletePhoto,
}: {
  photo: { src: string | null };
  assetName: string;
  loaded: boolean;
  failed: boolean;
  onLoad: () => void;
  onError: () => void;
  onPreview: () => void;
  canManage: boolean;
  onCompletePhoto: () => void;
}) {
  const showImage = !!photo.src && !failed;

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-50">
      <div className="relative aspect-video w-full">
        {showImage ? (
          <>
            {!loaded && <div className="absolute inset-0 animate-pulse bg-slate-200" />}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={photo.src as string}
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
            <p className="text-xs text-slate-400">Foto verifikasi aset belum tersedia.</p>
          </div>
        )}
      </div>
      {canManage && (!photo.src || failed) && (
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
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4"
      onClick={onClose}
    >
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

const VERIFICATION_CHECKLIST_ITEMS: { key: keyof VerificationChecklist; label: string }[] = [
  { key: "photoMatches", label: "Foto sesuai dengan aset fisik" },
  { key: "codeMatches", label: "Kode aset sesuai" },
  { key: "serialMatches", label: "Nomor seri sesuai" },
  { key: "qrOnRightItem", label: "QR terpasang pada barang yang benar" },
  { key: "locationAndHolderMatch", label: "Lokasi dan pemegang sesuai" },
];

// Section 7 — checklist "Konfirmasi Aset Sesuai". Semua item HARUS dicentang
// sebelum submit diaktifkan, supaya konfirmasi tidak jadi klik kosong.
function VerificationChecklistModal({
  submitting,
  onClose,
  onSubmit,
}: {
  submitting: boolean;
  onClose: () => void;
  onSubmit: (checklist: VerificationChecklist) => void;
}) {
  const [checklist, setChecklist] = useState<VerificationChecklist>({
    photoMatches: false,
    codeMatches: false,
    serialMatches: false,
    qrOnRightItem: false,
    locationAndHolderMatch: false,
  });

  const allChecked = VERIFICATION_CHECKLIST_ITEMS.every((item) => checklist[item.key]);

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
          {VERIFICATION_CHECKLIST_ITEMS.map((item) => (
            <label
              key={item.key}
              className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-700"
            >
              <input
                type="checkbox"
                checked={checklist[item.key]}
                onChange={(e) => setChecklist((prev) => ({ ...prev, [item.key]: e.target.checked }))}
                className="h-4 w-4 rounded border-slate-300 text-blue-600"
              />
              {item.label}
            </label>
          ))}
        </div>

        <button
          type="button"
          disabled={!allChecked || submitting}
          onClick={() => onSubmit(checklist)}
          className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Check size={16} />
          {submitting ? "Menyimpan..." : "Simpan Verifikasi"}
        </button>
      </div>
    </div>
  );
}

const MISMATCH_REASON_OPTIONS = [
  "Foto aset berbeda",
  "Nomor seri berbeda",
  "QR ditempel pada aset lain",
  "Lokasi tidak sesuai",
  "Pemegang tidak sesuai",
  "QR diduga dipindahkan",
  "Aset tidak ditemukan",
  "Tag rusak atau hilang",
];

// Section 6 — "Laporkan Ketidaksesuaian" SENGAJA punya alasan sendiri
// (bukan gejala kerusakan seperti ReportIssueModal) karena ini soal
// identitas/kecocokan barang, bukan kondisi rusak.
function MismatchReportModal({
  submitting,
  onClose,
  onSubmit,
}: {
  submitting: boolean;
  onClose: () => void;
  onSubmit: (reasons: string[], note: string) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [note, setNote] = useState("");

  const toggle = (reason: string) => {
    setSelected((prev) => (prev.includes(reason) ? prev.filter((r) => r !== reason) : [...prev, reason]));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <div className="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-bold text-slate-900">Laporkan Ketidaksesuaian</h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600">
            <X size={18} />
          </button>
        </div>
        <p className="mt-1 text-xs text-slate-500">
          Pilih satu atau lebih ketidaksesuaian yang Anda temukan. Ini BUKAN laporan kerusakan — gunakan
          &ldquo;Laporkan Kendala/Temuan&rdquo; untuk kondisi rusak.
        </p>

        <div className="mt-4 space-y-2">
          {MISMATCH_REASON_OPTIONS.map((reason) => (
            <label
              key={reason}
              className="flex cursor-pointer items-center gap-2.5 rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-700"
            >
              <input
                type="checkbox"
                checked={selected.includes(reason)}
                onChange={() => toggle(reason)}
                className="h-4 w-4 rounded border-slate-300 text-amber-600"
              />
              {reason}
            </label>
          ))}
        </div>

        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Catatan tambahan (opsional)"
          rows={3}
          className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:border-blue-400 focus:outline-none"
        />

        <button
          type="button"
          disabled={selected.length === 0 || submitting}
          onClick={() => onSubmit(selected, note)}
          className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-amber-600 px-4 py-3 text-sm font-semibold text-white shadow-sm hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <FileWarning size={16} />
          {submitting ? "Mengirim..." : "Kirim Laporan"}
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
