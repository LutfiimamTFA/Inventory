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

// Section "Rombak flow Scan QR" — bentuk data PUBLIK (whitelist), field
// PERSIS sama dengan yang dikembalikan /api/public/assets/by-code. Dipakai
// SEBELUM login (atau sebagai fallback kalau fetch client SDK gagal karena
// rules) — TIDAK PERNAH berisi harga/invoice/finance/email PIC/UID/riwayat
// internal/maintenance/audit log/data karyawan.
interface PublicAssetInfo {
  id: string;
  assetNumber: number | null;
  assetCode: string;
  assetName: string;
  categoryName: string;
  acquisitionDate: string | null;
  quantity: number;
  companyName: string;
  locationId: string | null;
  locationText: string;
  condition: string;
  conditionLabel: string;
  assetStatus: string;
  assetStatusLabel: string;
  photoUrl: string | null;
  photoThumbnailUrl: string | null;
  photoDriveFileId: string | null;
  hasActiveIssue: boolean;
  activeIssueTicketNo: string | null;
}

type GatedActionKey = "borrow" | "verify" | "report" | "detail";
type PublicFetchState = "loading" | "found" | "not_found" | "error";

// Section E — halaman ini SENGAJA berdiri sendiri (bukan dalam
// ProtectedLayout/sidebar) supaya bisa langsung dibuka kamera bawaan HP dari
// QR fisik. Section 1/2 — TARGET UTAMA rombak ini: info asset boleh dibaca
// TANPA login sama sekali; login HANYA dipicu saat user menekan aksi yang
// butuh identitas (Pinjam/Konfirmasi/Laporkan Masalah/Lihat Detail
// Internal), lewat /login?returnUrl=/asset-action?code=X&action=Y — setelah
// login berhasil, /login mengembalikan user ke returnUrl itu APA ADANYA
// (lihat getSafeReturnUrl di login/page.tsx, tidak diubah sama sekali), dan
// effect "auto-continue" di bawah membaca query `action` untuk otomatis
// melanjutkan aksi yang tadi dipilih.
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
  const { firebaseUser, assetUser, role, isLocationPicRole, assignedPicLocations } = useAuth();
  const code = searchParams.get("code") || "";
  const actionParam = searchParams.get("action") as GatedActionKey | null;

  // Section 4 — Employee Directory HANYA diaktifkan setelah user benar-benar
  // jadi active asset_users (rules employee_profiles mewajibkan
  // isActiveAssetUser()) — sebelumnya hook ini fetch TANPA SYARAT begitu
  // komponen mount, termasuk untuk pengunjung publik/belum login sama
  // sekali, yang SELALU permission-denied ("[Employee Directory] gagal
  // memuat"). Dipakai HANYA untuk resolve nama pemegang aset, TIDAK PERNAH
  // dibutuhkan oleh modal Laporkan Masalah (lihat ReportProblemModal, yang
  // tidak mengimpor hook ini sama sekali).
  const employeeDirectory = useEmployeeDirectory(!!assetUser?.uid);

  const [publicAsset, setPublicAsset] = useState<PublicAssetInfo | null>(null);
  const [publicState, setPublicState] = useState<PublicFetchState>("loading");

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
  // Urutan fallback: assetCode -> qrTagId -> assetId (getDoc langsung), SAMA
  // PERSIS dengan urutan pencarian di /api/public/assets/by-code supaya
  // hasil publik & hasil setelah login selalu konsisten.
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

  // Section 1 — data PUBLIK dimuat SELALU, terlepas dari status login,
  // lewat server route yang pakai Firebase Admin SDK (bukan client SDK
  // langsung ke Firestore) supaya `assets` TIDAK PERNAH perlu dibuka publik
  // lewat rules. Ini yang membuat info asset bisa tampil SEKETIKA scan,
  // tanpa menunggu proses auth selesai sama sekali.
  useEffect(() => {
    if (!code) {
      queueMicrotask(() => setPublicState("error"));
      return;
    }
    let cancelled = false;
    queueMicrotask(() => setPublicState("loading"));
    fetch(`/api/public/assets/by-code?code=${encodeURIComponent(code)}`)
      .then(async (res) => {
        if (cancelled) return;
        if (res.status === 404) {
          setPublicState("not_found");
          return;
        }
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          console.error("[Asset Action] /api/public/assets/by-code gagal", {
            code,
            status: res.status,
            error: body?.error,
          });
          setPublicState("error");
          return;
        }
        const data = await res.json();
        if (data?.asset) {
          setPublicAsset(data.asset as PublicAssetInfo);
          setPublicState("found");
        } else {
          setPublicState("not_found");
        }
      })
      .catch((error) => {
        console.error("[Asset Action] gagal memuat data publik asset", { code, error });
        if (!cancelled) setPublicState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [code]);

  // Section 2 — data LENGKAP (semua field, dipakai UI penuh + logika bisnis
  // pinjam/verifikasi/laporan) HANYA dimuat lewat client SDK setelah user
  // benar-benar login — TIDAK PERNAH lagi memaksa redirect ke /login begitu
  // halaman dibuka (bandingkan versi lama yang langsung router.replace ke
  // /login sebelum data apa pun sempat tampil).
  useEffect(() => {
    if (!firebaseUser || !code) return;

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
        console.error("[Asset Action] gagal memuat asset setelah login", { code, error });
        if (!cancelled) setNotFound(true);
      })
      .finally(() => {
        if (!cancelled) setLoadingAsset(false);
      });

    return () => {
      cancelled = true;
    };
  }, [firebaseUser, code, fetchAssetByCode]);

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
  // OPTIMISTIS (tanpa menunggu refetch Firestore yang butuh round-trip
  // jaringan) supaya badge "Ada Laporan Aktif" tampil seketika DAN guard
  // "sudah ada laporan aktif" di modal langsung aktif kalau user menekan
  // "Laporkan Masalah" lagi sebelum refetch selesai — inilah yang mencegah
  // laporan ganda akibat race klik cepat. refreshAsset() tetap dipanggil
  // sesudahnya supaya data akhirnya sinkron penuh dengan server.
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

  // Section 7/9 — catat SETIAP QR discan HANYA untuk user yang sudah
  // diketahui identitasnya (assetUser aktif) — pengunjung anonim/publik
  // SENGAJA tidak pernah memicu write ke asset_qr_scan_logs sama sekali
  // (bukan kegagalan, memang tidak dicatat; lihat firestore.rules).
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

  // Section A — status dibaca lewat helper normalisasi, null-safe karena
  // `asset` bisa belum ada (belum login/masih memuat) saat const ini
  // dievaluasi — SEMUA turunan di bawah dihitung tanpa syarat (bukan di
  // dalam if), supaya effect "auto-continue" setelah login (di bawah) bisa
  // memakainya dan urutan Hook tetap konsisten di setiap render.
  const isFixedLocation = asset?.trackingMode === "fixed_location";
  const borrowedByMe = asset ? isBorrowedByMe(asset, { uid: assetUser?.uid || firebaseUser?.uid }) : false;
  const borrowedByOther = asset ? isBorrowedByOther(asset, { uid: assetUser?.uid || firebaseUser?.uid }) : false;
  const brokenBorrowState = asset ? hasBrokenBorrowState(asset) : false;
  const activeBorrowing = pickLatestActiveBorrowing(activeBorrowings);
  const activeIssue = asset
    ? getActiveIssueSummary(asset)
    : {
        hasIssue: !!publicAsset?.hasActiveIssue,
        ticketNo: publicAsset?.activeIssueTicketNo || null,
        symptomLabel: null,
        note: null,
      };
  const isAvailableToBorrow =
    !!asset?.isBorrowable && !isFixedLocation && !borrowedByMe && !borrowedByOther && !brokenBorrowState && !activeIssue.hasIssue;

  const usageLabel = asset ? getAssetUsageLabel(asset, activeBorrowing) : publicAsset?.assetStatusLabel || "";
  const usageColor = asset ? getAssetUsageColor(asset, activeBorrowing) : "bg-slate-100 text-slate-500 border-slate-200";
  const rawHolder = asset ? getCurrentAssetHolder(asset, activeBorrowing) : null;
  const resolvedHolderName =
    rawHolder?.name || (rawHolder ? employeeDirectory.resolveName(rawHolder.uid, rawHolder.email) : null) || null;
  const holder = rawHolder ? { ...rawHolder, name: resolvedHolderName } : null;
  const holderDisplayText = holder ? getCurrentAssetHolderDisplayText(holder) : "";
  const dataAnomalies = asset ? detectAssetDataAnomalies(asset, activeBorrowings) : [];
  const canSeeAnomalies = role === "super_admin" || role === "asset_admin";

  const isLocationPicScoped = role === "location_pic" || isLocationPicRole;
  const isLocationPicOwner =
    asset && isLocationPicScoped ? isAssetInMyPicLocation(asset, assignedPicLocations, assetUser?.uid) : false;
  const canOpenFullDetailPage =
    role === "super_admin" || role === "asset_admin" || role === "asset_finance" || role === "it_team" || isLocationPicOwner;
  const canRepairBrokenState = role === "super_admin" || role === "asset_admin";

  const verificationIndicators = asset ? getAssetVerificationIndicators(asset) : [];
  const identityIncomplete = asset ? isAssetIdentityIncomplete(asset) : false;
  const photo = asset ? resolveAssetPhotoSrc(asset) : { src: publicAsset?.photoUrl || null };

  const activeTicketLink = asset?.activeIssueTicketId
    ? canSeeAnomalies
      ? `/maintenance?tab=staff-reports&ticketId=${asset.activeIssueTicketId}`
      : `/my-reports?ticketId=${asset.activeIssueTicketId}`
    : null;
  const isActiveIssueReporter = !!assetUser?.uid && asset?.issueReportedByUid === assetUser.uid;

  // Section 2 — SATU pintu gerbang: kalau belum login, arahkan ke
  // /login?returnUrl=/asset-action?code=X&action=Y (baca lagi setelah login
  // via effect auto-continue di bawah); kalau sudah login, jalankan aksinya
  // LANGSUNG tanpa redirect apa pun.
  const handleGatedAction = useCallback(
    (actionKey: GatedActionKey, run?: () => void) => {
      if (!firebaseUser) {
        const returnUrl = `/asset-action?code=${encodeURIComponent(code)}&action=${actionKey}`;
        router.push(`/login?returnUrl=${encodeURIComponent(returnUrl)}`);
        return;
      }
      run?.();
    },
    [firebaseUser, code, router]
  );

  // Section — SENGAJA bukan useCallback: `holder` dihitung ulang tiap render
  // (bukan objek stabil), jadi identitas callback yang di-"memo" pun ikut
  // berubah tiap render juga — dua fungsi ini hanya dipakai langsung di JSX
  // komponen yang sama (bukan dioper ke child yang butuh identitas stabil),
  // jadi plain function cukup dan lebih sederhana.
  const handleBorrowClick = () => {
    if (!asset) return;
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
        message: `Asset sedang dipinjam oleh ${holder?.name || "user lain"}.`,
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

  const handleDetailClick = () => {
    if (!asset) return;
    if (canOpenFullDetailPage) {
      router.push(`/assets/${asset.id}`);
      return;
    }
    setShowFullDetail((prev) => !prev);
  };

  // Section 2 — setelah login sukses & data lengkap asset selesai dimuat,
  // baca query `action` SEKALI lalu jalankan aksi yang tadi dipilih otomatis
  // (user tidak perlu klik ulang), baru bersihkan query itu dari URL supaya
  // refresh/kembali dari modal tidak memicunya lagi.
  const autoActionRunRef = useRef(false);
  useEffect(() => {
    if (autoActionRunRef.current) return;
    if (!firebaseUser || !asset || !actionParam) return;
    autoActionRunRef.current = true;

    if (actionParam === "verify") queueMicrotask(() => setVerifyOpen(true));
    else if (actionParam === "report") queueMicrotask(() => setProblemOpen(true));
    else if (actionParam === "borrow") queueMicrotask(() => handleBorrowClick());
    else if (actionParam === "detail") queueMicrotask(() => handleDetailClick());

    router.replace(`/asset-action?code=${encodeURIComponent(code)}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firebaseUser, asset, actionParam, code]);

  const handleRepairStatus = async () => {
    if (!assetUser?.uid || !asset) return;
    try {
      await repairBrokenBorrowState({
        asset,
        performedBy: { uid: assetUser.uid, name: assetUser.name || firebaseUser?.email || "" },
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
    if (!assetUser?.uid || !asset) return;
    setVerifySubmitting(true);
    try {
      await submitAssetVerification({
        asset,
        checklist,
        performedByUid: assetUser.uid,
        performedByName: assetUser.name || firebaseUser?.email || "",
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

  // Section 1/10 — urutan tampil: asset LENGKAP (sudah login) didahulukan,
  // fallback ke data PUBLIK (belum login), baru "tidak ditemukan"/"gagal
  // memuat" — supaya info selalu tampil secepat mungkin tanpa menunggu auth.
  if (!code) {
    return (
      <PageShell>
        <ErrorState message="Kode asset tidak ditemukan dari QR." />
      </PageShell>
    );
  }

  if (!asset && !publicAsset) {
    if (publicState === "not_found") {
      return (
        <PageShell>
          <ErrorState title="QR Asset Tidak Dikenali" message="Kode ini tidak terdaftar pada sistem." />
        </PageShell>
      );
    }
    if (publicState === "error" && !firebaseUser) {
      return (
        <PageShell>
          <ErrorState message="Gagal memuat data asset. Coba lagi." />
        </PageShell>
      );
    }
    if (firebaseUser && notFound && !loadingAsset) {
      return (
        <PageShell>
          <ErrorState message={`Asset dengan kode "${code}" tidak ditemukan.`} />
        </PageShell>
      );
    }
    return (
      <PageShell>
        <LoadingState />
      </PageShell>
    );
  }

  // Section 10 — bagian info (foto/kode/status/nama/lokasi/kondisi/PIC)
  // dipakai BAIK saat sudah login (data `asset` lengkap) MAUPUN belum (data
  // `publicAsset` whitelist saja) — satu tampilan yang sama, cuma sumber
  // datanya beda, supaya tidak ada "kedipan" layout begitu login selesai.
  // Section "Perbaiki error public Scan QR" — whitelist publik TIDAK lagi
  // menyertakan nama PIC (lebih konservatif dari sebelumnya) — PIC
  // Operasional hanya tampil setelah login (data `asset` lengkap).
  const displayCode = asset?.assetCode || publicAsset?.assetCode || "";
  const displayName = asset?.assetName || publicAsset?.assetName || "";
  const displayConditionLabel = asset ? getAssetConditionLabel(asset) : publicAsset?.conditionLabel || "-";
  const displayLocationText = asset ? asset.location || asset.locationText || "-" : publicAsset?.locationText || "-";
  const displayPicName = asset?.areaPicName || null;
  const displayPhotoSrc = photo.src;

  return (
    <PageShell>
      <div className="w-full max-w-md">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <AssetPhotoBlock
            photoSrc={displayPhotoSrc}
            assetName={displayName}
            loaded={photoLoaded}
            failed={photoFailed}
            onLoad={() => setPhotoLoaded(true)}
            onError={() => setPhotoFailed(true)}
            onPreview={() => displayPhotoSrc && !photoFailed && setPhotoPreviewOpen(true)}
            canManage={!!asset && canSeeAnomalies}
            onCompletePhoto={() => asset && router.push(`/assets/${asset.id}/edit`)}
          />

          <div className="mt-4 flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="font-mono text-xs text-slate-400">{displayCode}</p>
              <h2 className="truncate text-lg font-bold text-slate-900">{displayName}</h2>
            </div>
            <Badge label={usageLabel} colorClass={usageColor} />
          </div>

          {/* Section 9 — badge kecil "Ada Laporan Aktif" harus tampil
              SEKETIKA laporan berhasil dibuat (state `asset` di-update
              optimistis oleh handleProblemSubmitted), tidak menunggu refresh
              manual. */}
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

          {asset &&
            canSeeAnomalies &&
            dataAnomalies.map((anomaly) => (
              <div key={anomaly.code} className="mt-4 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700">
                <p className="font-semibold">{anomaly.title}</p>
                <p className="mt-0.5">{anomaly.message}</p>
              </div>
            ))}

          <div className="mt-4 space-y-2 text-sm text-slate-600">
            <Row label="Lokasi" value={displayLocationText} />
            <Row label="Kondisi Asset" value={displayConditionLabel} />
            {displayPicName && <Row label="PIC Operasional" value={displayPicName} />}
            {asset && !isFixedLocation && <Row label="Pemegang Saat Ini" value={holderDisplayText} />}
            {asset && !isFixedLocation && activeBorrowing?.estimatedReturnAt && (
              <Row label="Estimasi Kembali" value={formatExpectedReturn(activeBorrowing.estimatedReturnAt)} />
            )}
            {asset && !isFixedLocation && canSeeAnomalies && holder?.hasHolderSignal && !holder?.name && (
              <p className="text-right text-[11px] text-amber-600">Perlu sinkronisasi data pemegang</p>
            )}
          </div>

          {/* Section 2 — detail lebih lanjut (Kategori/Tanggal Perolehan/Qty/
              Mode Tracking/Catatan Operasional) TERMASUK bagian "Lihat Detail
              Internal" yang wajib login — hanya dirender begitu `asset`
              (data lengkap, berarti sudah login) tersedia. */}
          {asset && !canOpenFullDetailPage && showFullDetail && (
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

          {asset && (
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
                    <p className="text-xs text-amber-600">Identitas aset belum lengkap. Lengkapi data yang ditandai.</p>
                  ) : asset.lastVerifiedAt ? (
                    <p className="text-xs text-emerald-600">Identitas aset lengkap dan terdaftar di sistem.</p>
                  ) : (
                    <p className="text-xs text-slate-500">Identitas aset lengkap. Verifikasi fisik belum pernah dilakukan.</p>
                  )}
                </div>
              )}
            </div>
          )}

          {asset && brokenBorrowState && (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>Data peminjaman asset ini tidak sinkron. Status asset Dipinjam, tetapi pemegang asset belum tercatat.</span>
            </div>
          )}

          {asset && !brokenBorrowState && borrowedByOther && (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>Asset sedang dipinjam oleh {holder?.name || "user lain"}.</span>
            </div>
          )}

          {asset && borrowedByMe && (
            <div className="mt-4 flex items-start gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>Asset ini sedang Anda pinjam.</span>
            </div>
          )}

          {/* Section 3/10 — layout aksi FINAL: Lihat Detail / Pinjam Asset /
              (Konfirmasi Asset, Laporkan Masalah berdampingan) / Scan Asset
              Lain. "Laporkan Masalah" SATU-SATUNYA entry point laporan
              (bekas "Laporkan Temuan" + "Laporkan Ketidaksesuaian" digabung). */}
          <div className="mt-5 space-y-2">
            <ActionButton
              icon={asset && showFullDetail && !canOpenFullDetailPage ? ChevronUp : Eye}
              label="Lihat Detail"
              onClick={() => handleGatedAction("detail", handleDetailClick)}
            />

            {asset && isLocationPicOwner && (
              <ActionButton icon={Pencil} label="Edit Asset" onClick={() => router.push(`/assets/${asset.id}/edit`)} />
            )}

            {asset && brokenBorrowState && canRepairBrokenState && (
              <ActionButton icon={RotateCw} label="Perbaiki Status Asset" onClick={handleRepairStatus} />
            )}

            {asset && !isFixedLocation && !brokenBorrowState && borrowedByMe && (
              <ActionButton icon={Undo2} label="Kembalikan Asset" onClick={() => setReturnOpen(true)} />
            )}

            {/* Section 2/3 — belum login: selalu tampilkan "Pinjam Asset" (klik
                akan digerbang ke login, action=borrow). Sudah login: ikuti
                logika bisnis asli (disembunyikan untuk lokasi tetap/sedang
                dipinjam orang lain/data tidak sinkron/laporan aktif — kondisi
                itu sudah dijelaskan lewat banner peringatan di atas). */}
            {!asset && (
              <ActionButton
                icon={ArrowRightLeft}
                label="Pinjam Asset"
                onClick={() => handleGatedAction("borrow", handleBorrowClick)}
              />
            )}
            {asset && !isFixedLocation && isAvailableToBorrow && (
              <ActionButton icon={ArrowRightLeft} label="Pinjam Asset" onClick={handleBorrowClick} />
            )}

            {asset && activeIssue.hasIssue && activeTicketLink && (
              <ActionButton
                icon={FileWarning}
                label="Lihat Laporan Aktif"
                tone="warning"
                onClick={() => router.push(activeTicketLink)}
              />
            )}

            {asset && activeIssue.hasIssue && isActiveIssueReporter && activeTicketLink && (
              <ActionButton
                icon={Camera}
                label="Tambahkan Bukti"
                tone="warning"
                onClick={() => router.push(activeTicketLink)}
              />
            )}

            <div className="grid grid-cols-2 gap-2 pt-1">
              <ActionButton
                icon={CheckCircle2}
                label="Konfirmasi Asset"
                onClick={() => handleGatedAction("verify", () => setVerifyOpen(true))}
              />
              <ActionButton
                icon={AlertTriangle}
                label="Laporkan Masalah"
                tone="warning"
                onClick={() => handleGatedAction("report", () => setProblemOpen(true))}
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

      {photoPreviewOpen && displayPhotoSrc && (
        <PhotoPreviewOverlay src={displayPhotoSrc} assetName={displayName} onClose={() => setPhotoPreviewOpen(false)} />
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

      {asset && (
        <ReportProblemModal
          asset={asset}
          open={problemOpen}
          activeBorrowing={activeBorrowing}
          onClose={() => setProblemOpen(false)}
          onSubmitted={handleProblemSubmitted}
        />
      )}

      {asset && (
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
      )}
      {asset && (
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
      )}
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

function ErrorState({ title, message }: { title?: string; message: string }) {
  return (
    <div className="w-full max-w-md rounded-2xl border border-red-200 bg-red-50 p-5 text-center text-sm text-red-700">
      {title && <p className="mb-1 font-semibold">{title}</p>}
      {message}
    </div>
  );
}
