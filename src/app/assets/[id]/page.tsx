"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { QRCodeSVG } from "qrcode.react";
import { Pencil, Download, ArrowLeft, Image as ImageIcon, History as HistoryIcon, Power, FileBarChart, FileDown, UserCog, ArrowRightLeft, Undo2, ShieldAlert } from "lucide-react";
import { db } from "@/lib/firebase";
import {
  cleanFirestoreData,
  EmployeeOption,
  fetchActiveEmployeeOptions,
  writeAssetLog,
} from "@/lib/firestore-helpers";
import {
  assignCustodian,
  forceReturnOrCorrectHolder,
  handoverTemporary,
  returnToCustodian,
} from "@/lib/custodian-actions";
import {
  computeHealthScore,
  exportToExcel,
  healthScoreLabel,
  isMaintenanceOverdue,
  todayStamp,
} from "@/lib/reports";
import ConfirmModal from "@/components/ConfirmModal";
import { useAuth } from "@/lib/auth-context";
import { isAssetInMyPicLocation } from "@/lib/locations";
import { Asset, AssetBorrowing, AssetIssueTicket, AssetLog } from "@/lib/types";
import {
  ASSET_STATUS_COLOR,
  ASSET_STATUS_LABEL,
  ASSET_USAGE_STATUS_COLOR,
  ASSET_USAGE_STATUS_LABEL,
  ASSET_USAGE_TYPE_LABEL,
  BORROWING_STATUS_COLOR,
  BORROWING_STATUS_LABEL,
  CONDITION_LABEL,
  formatCurrency,
  formatDate,
  getQrImageSettings,
} from "@/lib/utils";
import ProtectedLayout from "@/components/ProtectedLayout";
import Badge from "@/components/Badge";
import EmptyState from "@/components/EmptyState";
import SearchableSelect, { SearchableSelectItem } from "@/components/SearchableSelect";
import { Toast, ToastState } from "@/components/Toast";
import Link from "next/link";

export default function AssetDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { firebaseUser, assetUser, role, loading, isLocationPicRole, assignedPicLocations } = useAuth();
  // Section C — staff yang ditunjuk PIC di Master Lokasi diperlakukan sama
  // seperti role "location_pic" literal untuk halaman ini.
  const isLocationPicScoped = role === "location_pic" || isLocationPicRole;
  const authReady = !loading && !!firebaseUser && !!assetUser && !!role;
  const [asset, setAsset] = useState<Asset | null>(null);
  const [photoImgError, setPhotoImgError] = useState(false);
  const [borrowings, setBorrowings] = useState<AssetBorrowing[]>([]);
  const [logs, setLogs] = useState<AssetLog[]>([]);
  const [tickets, setTickets] = useState<AssetIssueTicket[]>([]);
  const [deactivateOpen, setDeactivateOpen] = useState(false);
  const [deactivating, setDeactivating] = useState(false);

  const [employeeOptions, setEmployeeOptions] = useState<EmployeeOption[]>([]);
  const [custodianModalOpen, setCustodianModalOpen] = useState(false);
  const [handoverModalOpen, setHandoverModalOpen] = useState(false);
  const [returnConfirmOpen, setReturnConfirmOpen] = useState(false);
  const [forceModalOpen, setForceModalOpen] = useState(false);
  const [selectedUserUid, setSelectedUserUid] = useState("");
  const [handoverPurpose, setHandoverPurpose] = useState("");
  const [handoverExpectedReturnAt, setHandoverExpectedReturnAt] = useState("");
  const [handoverNote, setHandoverNote] = useState("");
  const [forceCorrectedUserUid, setForceCorrectedUserUid] = useState("");
  const [forceNote, setForceNote] = useState("");
  const [usageSaving, setUsageSaving] = useState(false);
  const [usageError, setUsageError] = useState("");
  const [toast, setToast] = useState<ToastState | null>(null);

  const canManage = role === "super_admin" || role === "asset_admin";
  // Finance/Bukti Pembelian: HANYA Super Admin & Asset Finance yang boleh
  // melihat/mengedit — Asset Admin/QHSE, Staff, Tim IT tidak boleh melihat
  // nominal harga sama sekali (lihat spec "data Finance hanya tampil untuk
  // role Asset Finance").
  const canViewFinance = role === "super_admin" || role === "asset_finance";
  // Section H — badge status finance, HANYA untuk yang boleh lihat finance
  // (Asset Admin/QHSE dapat versi tanpa nominal, lihat Section "Status" di
  // bawah).
  const financeStatusBadge = !asset
    ? { label: "Perlu Dilengkapi", colorClass: "bg-slate-100 text-slate-500 border-slate-200" }
    : asset.financeStatus === "complete" ||
      (asset.purchasePrice && asset.invoiceNumber)
    ? { label: "Data Finance Lengkap", colorClass: "bg-emerald-50 text-emerald-700 border-emerald-200" }
    : !asset.purchasePrice
    ? { label: "Belum Ada Harga", colorClass: "bg-amber-50 text-amber-700 border-amber-200" }
    : !asset.invoiceNumber && !asset.invoiceFileUrl
    ? { label: "Belum Ada Invoice", colorClass: "bg-amber-50 text-amber-700 border-amber-200" }
    : { label: "Perlu Dilengkapi", colorClass: "bg-slate-100 text-slate-500 border-slate-200" };
  // Custodian/currentHolder boleh serah-terima & kembalikan sendiri — rules
  // Firestore (isCustodianOrHolderUsageUpdate) sudah menegakkan ini di sisi
  // server, guard di UI ini cuma supaya tombolnya tidak nyasar ditampilkan.
  const isCustodian = !!asset && asset.custodianUid === assetUser?.uid;
  const isCurrentHolder = !!asset && asset.currentHolderUid === assetUser?.uid;
  const canHandover = canManage || isCustodian || isCurrentHolder;
  const canReturnToCustodian = canManage || isCustodian || isCurrentHolder;

  useEffect(() => {
    if (!authReady) return;
    const unsub = onSnapshot(
      doc(db, "assets", id),
      (snap) => {
        console.log("[AssetDetailPage Listener] assets doc success:", { id, exists: snap.exists() });
        if (snap.exists()) {
          const data = { id: snap.id, ...snap.data() } as Asset;
          console.debug("[Asset Detail] loaded photo fields:", {
            photoUrl: data.photoUrl,
            photoThumbnailUrl: data.photoThumbnailUrl,
            photoFileName: data.photoFileName,
            photoDriveFileId: data.photoDriveFileId,
          });
          setAsset(data);
        } else {
          setAsset(null);
        }
      },
      (error) => {
        console.error("[AssetDetailPage Listener] assets doc error:", { id, error });
      }
    );
    return () => unsub();
  }, [authReady, id]);

  // Section G/H — PIC Lokasi tidak boleh melihat asset di luar lokasi
  // tanggung jawabnya, walau dibuka lewat URL langsung. Firestore rules
  // sudah menolak WRITE-nya (isLocationPicUpdate), tapi tanpa guard ini dia
  // masih bisa membaca detail operasional (lokasi/kondisi/custodian) asset
  // orang lain lewat halaman ini.
  useEffect(() => {
    if (!authReady || !asset) return;
    if (!isLocationPicScoped) return;
    if (isAssetInMyPicLocation(asset, assignedPicLocations, assetUser?.uid)) return;

    queueMicrotask(() =>
      setToast({
        type: "error",
        message: "Anda hanya dapat mengelola asset pada lokasi yang menjadi tanggung jawab Anda.",
      })
    );
    const timer = window.setTimeout(() => router.replace("/assets"), 1200);
    return () => window.clearTimeout(timer);
  }, [authReady, asset, isLocationPicScoped, assignedPicLocations, assetUser?.uid, router]);

  useEffect(() => {
    if (!authReady) return;
    const q = query(
      collection(db, "asset_borrowings"),
      where("assetId", "==", id),
      orderBy("borrowedAt", "desc")
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        console.log("[AssetDetailPage Listener] asset_borrowings success:", snap.size);
        setBorrowings(
          snap.docs.map((d) => ({ id: d.id, ...d.data() } as AssetBorrowing))
        );
      },
      (error) => {
        console.error("[AssetDetailPage Listener] asset_borrowings error:", error);
      }
    );
    return () => unsub();
  }, [authReady, id]);

  useEffect(() => {
    if (!authReady) return;
    const q = query(
      collection(db, "asset_logs"),
      where("assetId", "==", id),
      orderBy("timestamp", "desc")
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        console.log("[AssetDetailPage Listener] asset_logs success:", snap.size);
        setLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() } as AssetLog)));
      },
      (error) => {
        console.error("[AssetDetailPage Listener] asset_logs error:", error);
      }
    );
    return () => unsub();
  }, [authReady, id]);

  useEffect(() => {
    if (!authReady) return;
    const q = query(collection(db, "asset_issue_tickets"), where("assetId", "==", id));
    const unsub = onSnapshot(
      q,
      (snap) => {
        console.log("[AssetDetailPage Listener] asset_issue_tickets success:", snap.size);
        setTickets(snap.docs.map((d) => ({ id: d.id, ...d.data() } as AssetIssueTicket)));
      },
      (error) => {
        console.error("[AssetDetailPage Listener] asset_issue_tickets error:", error);
      }
    );
    return () => unsub();
  }, [authReady, id]);

  // Daftar KARYAWAN AKTIF untuk dropdown "Pilih Custodian"/"Serahkan
  // Sementara ke" — dimuat sekali saja saat salah satu modal dibuka pertama
  // kali. WAJIB dari employee_profiles (semua karyawan), BUKAN asset_users
  // (cuma user yang punya akses AssetView) — kalau sumbernya asset_users,
  // dropdown cuma menampilkan segelintir admin/QHSE/Tim IT yang punya akun
  // AssetView, bukan seluruh karyawan yang bisa jadi PIC/pemakai sementara.
  useEffect(() => {
    if (!custodianModalOpen && !handoverModalOpen && !forceModalOpen) return;
    if (employeeOptions.length > 0) return;
    let cancelled = false;
    fetchActiveEmployeeOptions()
      .then((options) => {
        if (!cancelled) setEmployeeOptions(options);
      })
      .catch((err) => console.error("[AssetDetailPage] gagal memuat daftar karyawan aktif", err));
    return () => {
      cancelled = true;
    };
  }, [custodianModalOpen, handoverModalOpen, forceModalOpen, employeeOptions.length]);

  // Baris utama dropdown = nama saja, baris kecil = divisi/brand/role —
  // JANGAN gabung jadi satu label panjang seperti sebelumnya ("Nama — Divisi").
  const employeeSelectItems: SearchableSelectItem[] = useMemo(
    () =>
      employeeOptions.map((u) => ({
        id: u.uid,
        label: u.name,
        sublabel: u.divisionName || u.brandName || u.roleLabel,
        searchText: [u.name, u.email, u.divisionName, u.brandName, u.roleLabel]
          .filter(Boolean)
          .join(" "),
      })),
    [employeeOptions]
  );

  if (!asset) {
    return (
      <ProtectedLayout>
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 rounded-full border-2 border-slate-200 border-t-slate-900 animate-spin" />
        </div>
      </ProtectedLayout>
    );
  }

  console.debug("[Asset Photo] drive file id:", asset.photoDriveFileId);
  const photoImageSrc = asset.photoDriveFileId
    ? `/api/drive-image?fileId=${asset.photoDriveFileId}`
    : null;
  console.debug("[Asset Photo] image src:", photoImageSrc);

  const handleDeactivate = async () => {
    setDeactivating(true);
    try {
      await updateDoc(doc(db, "assets", asset.id), {
        assetStatus: "inactive",
        updatedAt: serverTimestamp(),
      });
      await writeAssetLog({
        assetId: asset.id,
        assetName: asset.assetName,
        assetCode: asset.assetCode,
        action: "deactivate",
        userUid: assetUser?.uid || "",
        userName: assetUser?.name || "",
        detail: "Aset dinonaktifkan",
      });
      setDeactivateOpen(false);
    } finally {
      setDeactivating(false);
    }
  };

  // Fallback tampilan (section C) — jangan cuma baca custodianName/
  // currentHolderName mentah, karena aset lama bisa saja sudah punya
  // usageType/currentUsageStatus (mis. diset manual) tapi belum pernah
  // disentuh assignCustodian sehingga custodian*/currentHolder* masih
  // kosong. responsiblePersonName adalah field lama yang paling relevan
  // sebagai pengganti PIC/Custodian untuk data seperti ini.
  const isFixedLocationAsset =
    (asset.trackingMode || (asset.usageType === "assigned_daily" ? "assigned_pic" : "shared_borrowable")) ===
    "fixed_location";
  const custodianDisplayName =
    asset.custodianName ||
    asset.responsiblePersonName ||
    asset.picName ||
    asset.custodianEmail ||
    asset.responsiblePersonEmail ||
    "-";
  const currentHolderDisplayName =
    asset.currentHolderName ||
    asset.currentBorrowerName ||
    (asset.usageType === "assigned_daily" || asset.currentUsageStatus === "with_custodian"
      ? custodianDisplayName
      : "-");
  const needsCustodianSync =
    asset.usageType === "assigned_daily" &&
    !asset.custodianName &&
    (!!asset.responsiblePersonName || !!asset.picName);
  // Custodian dan currentHolder adalah orang yang SAMA — jangan tampilkan
  // dua blok berisi nama yang sama (membingungkan). "with_custodian" adalah
  // penanda paling eksplisit; uid/name sama juga dianggap sama untuk data
  // lama yang belum konsisten pakai currentUsageStatus.
  const custodianIsCurrentHolder =
    asset.currentUsageStatus === "with_custodian" ||
    (!!asset.custodianUid && asset.custodianUid === asset.currentHolderUid) ||
    (!!custodianDisplayName &&
      custodianDisplayName !== "-" &&
      custodianDisplayName === currentHolderDisplayName);

  console.log("[Asset Detail Custodian]", {
    assetId: asset.id,
    usageType: asset.usageType,
    currentUsageStatus: asset.currentUsageStatus,
    custodianName: asset.custodianName,
    responsiblePersonName: asset.responsiblePersonName,
    picName: asset.picName,
    currentHolderName: asset.currentHolderName,
  });

  const handleSyncCustodianFromResponsible = async () => {
    const sourceUid = asset.responsiblePersonUid || asset.picUid || null;
    const sourceName = asset.responsiblePersonName || asset.picName || null;
    const sourceEmail = asset.responsiblePersonEmail || asset.picEmail || null;
    setUsageSaving(true);
    setUsageError("");
    try {
      await updateDoc(
        doc(db, "assets", asset.id),
        cleanFirestoreData({
          custodianUid: sourceUid,
          custodianName: sourceName,
          custodianEmail: sourceEmail,
          custodianDivision: asset.responsiblePersonDivision || null,
          currentHolderUid: sourceUid,
          currentHolderName: sourceName,
          currentHolderEmail: sourceEmail,
          currentHolderDivision: asset.responsiblePersonDivision || null,
          currentUsageStatus: "with_custodian",
          currentUsageStatusLabel: "Bersama Custodian",
          updatedAt: serverTimestamp(),
        }) as Record<string, unknown>
      );
      await writeAssetLog({
        assetId: asset.id,
        assetName: asset.assetName,
        assetCode: asset.assetCode,
        action: "custodian_changed",
        userUid: assetUser?.uid || "",
        userName: assetUser?.name || "",
        toUid: sourceUid || undefined,
        toName: sourceName || undefined,
        custodianUid: sourceUid || undefined,
        custodianName: sourceName || undefined,
        detail: `Custodian disinkronkan dari Penanggung Jawab (${sourceName})`,
      });
    } catch (err) {
      console.error("[AssetDetailPage] gagal sinkronkan custodian dari penanggung jawab", err);
      setUsageError("Gagal menyinkronkan custodian. Coba lagi.");
    } finally {
      setUsageSaving(false);
    }
  };

  const closeUsageModals = () => {
    setCustodianModalOpen(false);
    setHandoverModalOpen(false);
    setForceModalOpen(false);
    setSelectedUserUid("");
    setHandoverPurpose("");
    setHandoverExpectedReturnAt("");
    setHandoverNote("");
    setForceCorrectedUserUid("");
    setForceNote("");
    setUsageError("");
  };

  const handleAssignCustodian = async () => {
    const selected = employeeOptions.find((u) => u.uid === selectedUserUid);
    if (!selected) {
      setUsageError("Pilih karyawan yang akan jadi custodian.");
      return;
    }
    setUsageSaving(true);
    setUsageError("");
    try {
      const payload = {
        custodianUid: selected.uid,
        custodianName: selected.name,
        custodianEmail: selected.email || "",
        custodianDivision: selected.divisionName || undefined,
        custodianRole: selected.roleLabel || undefined,
        currentHolderUid: selected.uid,
        currentHolderName: selected.name,
        currentUsageStatus: "with_custodian",
      };
      console.log("[Asset Custodian Submit]", {
        usageType: "assigned_daily",
        selectedCustodian: selected,
        payload,
      });
      await assignCustodian({
        asset,
        custodianUid: selected.uid,
        custodianName: selected.name,
        custodianEmail: selected.email || "",
        custodianDivision: selected.divisionName || undefined,
        custodianRole: selected.roleLabel || undefined,
        performedBy: { uid: assetUser?.uid || "", name: assetUser?.name || "" },
      });
      closeUsageModals();
    } catch (err) {
      console.error("[AssetDetailPage] gagal menetapkan custodian", err);
      setUsageError("Gagal menetapkan custodian. Coba lagi.");
    } finally {
      setUsageSaving(false);
    }
  };

  const handleHandoverTemporary = async () => {
    const selected = employeeOptions.find((u) => u.uid === selectedUserUid);
    if (!selected) {
      setUsageError("Pilih siapa yang akan memakai aset ini.");
      return;
    }
    if (!handoverPurpose.trim()) {
      setUsageError("Keperluan wajib diisi.");
      return;
    }
    setUsageSaving(true);
    setUsageError("");
    try {
      await handoverTemporary({
        asset,
        toUid: selected.uid,
        toName: selected.name,
        toEmail: selected.email || undefined,
        toDivision: selected.divisionName || undefined,
        purpose: handoverPurpose.trim(),
        expectedReturnAt: handoverExpectedReturnAt || undefined,
        note: handoverNote.trim() || undefined,
        performedBy: { uid: assetUser?.uid || "", name: assetUser?.name || "" },
      });
      closeUsageModals();
    } catch (err) {
      console.error("[AssetDetailPage] gagal menyerahkan aset sementara", err);
      setUsageError("Gagal menyerahkan aset. Coba lagi.");
    } finally {
      setUsageSaving(false);
    }
  };

  const handleReturnToCustodian = async () => {
    setUsageSaving(true);
    setUsageError("");
    try {
      await returnToCustodian({
        asset,
        performedBy: { uid: assetUser?.uid || "", name: assetUser?.name || "" },
      });
      setReturnConfirmOpen(false);
    } catch (err) {
      console.error("[AssetDetailPage] gagal mengembalikan aset ke custodian", err);
      setUsageError("Gagal mengembalikan aset. Coba lagi.");
    } finally {
      setUsageSaving(false);
    }
  };

  const handleForceReturnOrCorrect = async () => {
    if (!forceNote.trim()) {
      setUsageError("Catatan/alasan koreksi wajib diisi.");
      return;
    }
    const corrected = employeeOptions.find((u) => u.uid === forceCorrectedUserUid);
    setUsageSaving(true);
    setUsageError("");
    try {
      await forceReturnOrCorrectHolder({
        asset,
        correctedHolderUid: corrected?.uid,
        correctedHolderName: corrected?.name,
        correctedHolderEmail: corrected?.email || undefined,
        note: forceNote.trim(),
        performedBy: { uid: assetUser?.uid || "", name: assetUser?.name || "" },
      });
      closeUsageModals();
    } catch (err) {
      console.error("[AssetDetailPage] gagal paksa kembalikan/koreksi pemakai", err);
      setUsageError("Gagal memproses. Coba lagi.");
    } finally {
      setUsageSaving(false);
    }
  };

  const unresolvedTicketCount = tickets.filter(
    (t) => !["resolved", "closed", "rejected"].includes(t.status)
  ).length;
  const healthScore = computeHealthScore({
    asset,
    unresolvedTicketCount,
    resolvedLast30dCount: 0,
    hasOverdueMaintenance: isMaintenanceOverdue(asset),
  });

  const downloadQr = () => {
    const svg = document.getElementById("asset-qr-svg");
    if (!svg) return;
    const serializer = new XMLSerializer();
    const source = serializer.serializeToString(svg);
    const blob = new Blob([source], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${asset.assetCode}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <ProtectedLayout>
      <button
        onClick={() => router.push("/assets")}
        className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 mb-3"
      >
        <ArrowLeft size={15} />
        Kembali ke Assets
      </button>

      <div className="flex items-center justify-between mb-6 gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
                {asset.assetName}
              </h1>
              <Badge
                label={ASSET_STATUS_LABEL[asset.assetStatus]}
                colorClass={ASSET_STATUS_COLOR[asset.assetStatus]}
              />
            </div>
            <p className="text-sm text-slate-500 mt-0.5">{asset.assetCode}</p>
          </div>
        </div>
        <div className="flex gap-2">
          {(canManage ||
            (isLocationPicScoped && isAssetInMyPicLocation(asset, assignedPicLocations, assetUser?.uid))) && (
            <button
              onClick={() => router.push(`/assets/${asset.id}/edit`)}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium hover:bg-slate-50 shadow-sm"
            >
              <Pencil size={15} />
              Edit
            </button>
          )}
          {role === "super_admin" && (
            <button
              onClick={() => setDeactivateOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-red-600 hover:bg-red-50 shadow-sm"
            >
              <Power size={15} />
              Nonaktifkan
            </button>
          )}
        </div>
      </div>

      <p className="text-xs text-slate-400 -mt-4 mb-6">
        Peminjaman asset hanya dapat dilakukan melalui scan QR.
      </p>

      <div className="grid lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          <Section title="Informasi Aset">
            <div className="grid sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <Info label="Kategori" value={asset.categoryName} />
              <Info label="Subkategori" value={asset.subCategory} />
              <Info label="Merk" value={asset.brand} />
              <Info label="Model" value={asset.model} />
              <Info label="Serial Number" value={asset.serialNumber} />
              <Info label="IMEI" value={asset.imei} />
              <Info label="Deskripsi" value={asset.description} full />
            </div>
          </Section>

          <Section title="Kepemilikan & Lokasi">
            <div className="grid sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
              <Info label="Perusahaan Pemilik" value={asset.companyOwnerName} />
              <Info label="Divisi Pengguna" value={asset.divisionOwnerName} />
              <Info label="Lokasi" value={asset.location} />
              <Info label="Penanggung Jawab" value={asset.responsiblePersonName} />
              <Info label="Status Kepemilikan" value={asset.ownershipStatus} />
            </div>
          </Section>

          {canViewFinance && (
            <Section title="Finance / Bukti Pembelian">
              <div className="grid sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <div className="sm:col-span-2">
                  <Badge label={financeStatusBadge.label} colorClass={financeStatusBadge.colorClass} />
                </div>
                <Info label="Tanggal Pembelian" value={formatDate(asset.purchaseDate)} />
                <Info label="Harga Beli" value={formatCurrency(asset.purchasePrice)} />
                <Info label="Vendor" value={asset.vendorName} />
                <Info label="Nomor Invoice" value={asset.invoiceNumber} />
                <Info label="Sumber Dana" value={asset.fundingSource} />
                <Info label="Metode Pembelian" value={asset.purchaseMethod} />
                <Info label="Estimasi Umur" value={asset.estimatedUsefulLife} />
                <Info label="Catatan Finance" value={asset.financeNotes} full />
                {asset.invoiceFileUrl && (
                  <div className="sm:col-span-2">
                    <a
                      href={asset.invoiceFileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-blue-600 hover:underline"
                    >
                      Lihat file invoice
                    </a>
                  </div>
                )}
                <div className="sm:col-span-2 pt-2 border-t border-slate-100 mt-1">
                  <Link
                    href={`/assets/${asset.id}/edit`}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Edit Data Finance
                  </Link>
                </div>
              </div>
            </Section>
          )}

          <Section title="Histori Peminjaman">
            {borrowings.length === 0 ? (
              <EmptyState
                icon={HistoryIcon}
                title="Belum ada riwayat peminjaman"
              />
            ) : (
              <div className="divide-y divide-slate-100">
                {borrowings.map((b) => (
                  <div
                    key={b.id}
                    className="flex items-center justify-between text-sm py-3 first:pt-0 last:pb-0"
                  >
                    <div>
                      <p className="font-medium text-slate-800">{b.borrowedByName}</p>
                      <p className="text-xs text-slate-400">
                        {formatDate(b.borrowedAt)} — {b.returnedAt ? formatDate(b.returnedAt) : "sekarang"}
                      </p>
                    </div>
                    <Badge
                      label={BORROWING_STATUS_LABEL[b.status]}
                      colorClass={BORROWING_STATUS_COLOR[b.status]}
                    />
                  </div>
                ))}
              </div>
            )}
          </Section>

          <Section title="Log Aktivitas" anchorId="log-aktivitas">
            {logs.length === 0 ? (
              <EmptyState icon={HistoryIcon} title="Belum ada log aktivitas" />
            ) : (
              <div className="divide-y divide-slate-100">
                {logs.map((l) => (
                  <div key={l.id} className="text-sm py-3 first:pt-0 last:pb-0">
                    <p className="text-slate-800">
                      <span className="font-medium">{l.userName}</span> — {l.action}
                    </p>
                    <p className="text-xs text-slate-400">
                      {formatDate(l.timestamp)} {l.detail && `· ${l.detail}`}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </Section>
        </div>

        <div className="space-y-5">
          <Section title="Status">
            <div className="flex flex-col gap-2.5">
              <div>
                <Badge
                  label={ASSET_STATUS_LABEL[asset.assetStatus]}
                  colorClass={ASSET_STATUS_COLOR[asset.assetStatus]}
                />
              </div>
              <p className="text-sm text-slate-500">
                Kondisi: <span className="text-slate-800 font-medium">{CONDITION_LABEL[asset.condition]}</span>
              </p>
              {asset.currentBorrowerName && (
                <p className="text-sm text-slate-500">
                  Dipinjam oleh: <span className="text-slate-800 font-medium">{asset.currentBorrowerName}</span>
                </p>
              )}
              <p className="text-xs text-slate-400">
                {asset.isBorrowable ? "Bisa dipinjam" : "Tidak bisa dipinjam"}
                {asset.requiresApproval ? " · Butuh approval" : ""}
              </p>
              {asset.accessories && (
                <p className="text-xs text-slate-400">Aksesoris: {asset.accessories}</p>
              )}
              {asset.operationalNotes && (
                <p className="text-xs text-slate-400">{asset.operationalNotes}</p>
              )}
              {!canViewFinance && asset.financeStatus !== "complete" && (
                <Badge
                  label="Data finance belum dilengkapi"
                  colorClass="bg-slate-100 text-slate-500 border-slate-200"
                />
              )}
            </div>
          </Section>

          {isFixedLocationAsset ? (
            <Section title="Penempatan Aset">
              <div className="flex flex-col gap-2.5">
                <div>
                  <Badge label="Aset Tetap Lokasi" colorClass="bg-slate-100 text-slate-600" />
                </div>
                <Info label="Lokasi" value={asset.locationText || asset.location} />
                <Info label="PIC Lokasi" value={asset.custodianName || asset.responsiblePersonName} />
                <Info label="Status" value="Tetap di Lokasi" />
                <Info label="Kondisi" value={CONDITION_LABEL[asset.condition]} />
                <Info label="Maintenance Terakhir" value={formatDate(asset.lastMaintenanceAt)} />
                <div className="flex flex-col gap-2 pt-2 border-t border-slate-100 mt-1">
                  <a
                    href="#log-aktivitas"
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-500 hover:bg-slate-50"
                  >
                    <HistoryIcon size={14} />
                    Lihat Riwayat
                  </a>
                </div>
              </div>
            </Section>
          ) : (
          <Section title="Pemakaian Aset">
            <div className="flex flex-col gap-2.5">
              <div>
                <Badge
                  label={
                    asset.usageType ? ASSET_USAGE_TYPE_LABEL[asset.usageType] : "Aset Bersama"
                  }
                  colorClass="bg-slate-100 text-slate-600"
                />
              </div>
              {asset.currentUsageStatus && (
                <Badge
                  label={ASSET_USAGE_STATUS_LABEL[asset.currentUsageStatus]}
                  colorClass={ASSET_USAGE_STATUS_COLOR[asset.currentUsageStatus]}
                />
              )}
              {asset.areaPicName && (
                <Info label="PIC Lokasi" value={asset.areaPicName} />
              )}
              {custodianIsCurrentHolder ? (
                <Info label="Pemegang Harian / Saat Ini" value={custodianDisplayName} />
              ) : (
                <>
                  <Info label="Custodian / Pemegang Harian" value={custodianDisplayName} />
                  <Info label="Pemegang Saat Ini" value={currentHolderDisplayName} />
                  <p className="text-xs text-amber-600 font-medium">Sedang dipakai sementara</p>
                </>
              )}
              {canManage && needsCustodianSync && (
                <button
                  onClick={handleSyncCustodianFromResponsible}
                  disabled={usageSaving}
                  className="self-start text-xs font-medium text-blue-600 hover:underline disabled:opacity-60"
                >
                  {usageSaving ? "Menyinkronkan..." : "Sinkronkan Custodian dari Penanggung Jawab"}
                </button>
              )}
              {usageError && <p className="text-xs text-red-600">{usageError}</p>}
              {asset.currentUsageStatus === "temporary_used_by_other" && (
                <>
                  <Info label="Keperluan Sementara" value={asset.temporaryUsePurpose || undefined} />
                  <Info
                    label="Estimasi Kembali"
                    value={
                      asset.temporaryUseExpectedReturnAt
                        ? formatDate(asset.temporaryUseExpectedReturnAt)
                        : undefined
                    }
                  />
                </>
              )}

              <div className="flex flex-col gap-2 pt-2 border-t border-slate-100 mt-1">
                {canManage && (
                  <button
                    onClick={() => setCustodianModalOpen(true)}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <UserCog size={14} />
                    {asset.custodianUid ? "Ubah Custodian" : "Tetapkan Custodian"}
                  </button>
                )}
                {canHandover && asset.custodianUid && asset.currentUsageStatus !== "temporary_used_by_other" && (
                  <button
                    onClick={() => setHandoverModalOpen(true)}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <ArrowRightLeft size={14} />
                    Serahkan Sementara
                  </button>
                )}
                {canReturnToCustodian && asset.currentUsageStatus === "temporary_used_by_other" && (
                  <button
                    onClick={() => setReturnConfirmOpen(true)}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-emerald-600 text-white px-3 py-2 text-sm font-medium hover:bg-emerald-700"
                  >
                    <Undo2 size={14} />
                    Kembalikan ke Custodian
                  </button>
                )}
                {canManage && asset.custodianUid && (
                  <button
                    onClick={() => setForceModalOpen(true)}
                    className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-100"
                  >
                    <ShieldAlert size={14} />
                    Paksa Kembalikan / Koreksi Pemakai
                  </button>
                )}
                <a
                  href="#log-aktivitas"
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-500 hover:bg-slate-50"
                >
                  <HistoryIcon size={14} />
                  Lihat Riwayat Pemakaian
                </a>
              </div>
            </div>
          </Section>
          )}

          <Section title="Foto Aset">
            {photoImageSrc && !photoImgError ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={photoImageSrc}
                alt={asset.photoFileName || "Foto asset"}
                className="w-full rounded-xl object-cover"
                onError={() => {
                  console.debug("[Asset Photo] image load failed:", photoImageSrc);
                  setPhotoImgError(true);
                }}
              />
            ) : (
              <EmptyState
                icon={ImageIcon}
                title={photoImgError ? "Foto belum dapat ditampilkan" : "Belum ada foto"}
                description={asset.photoFileName}
              />
            )}
          </Section>

          <Section title="QR Code" anchorId="qr">
            <div className="flex flex-col items-center gap-4">
              {asset.qrCodeValue ? (
                <div className="p-3 rounded-xl border border-slate-200 bg-slate-50">
                  <QRCodeSVG
                    id="asset-qr-svg"
                    value={asset.qrCodeValue}
                    size={160}
                    level="H"
                    includeMargin
                    imageSettings={getQrImageSettings(160)}
                  />
                </div>
              ) : (
                <p className="text-xs text-slate-400 text-center py-8">
                  QR belum tersedia untuk aset ini.
                </p>
              )}
              <button
                onClick={downloadQr}
                disabled={!asset.qrCodeValue}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 w-full justify-center disabled:opacity-50"
              >
                <Download size={14} />
                Download QR
              </button>
            </div>
          </Section>

          {canManage && (
            <Section title="Asset Report Summary">
              <div className="grid grid-cols-2 gap-3 text-sm mb-4">
                <Info label="Health Score" value={String(healthScore)} />
                <Info label="Label" value={healthScoreLabel(healthScore)} />
                <Info label="Total Ticket" value={String(tickets.length)} />
                <Info
                  label="Ticket Belum Selesai"
                  value={String(
                    tickets.filter((t) => !["resolved", "closed", "rejected"].includes(t.status)).length
                  )}
                />
                <Info label="Total Peminjaman" value={String(borrowings.length)} />
                <Info label="Last Maintenance" value={formatDate(asset.lastMaintenanceAt)} />
                <Info label="Next Maintenance" value={formatDate(asset.nextMaintenanceAt)} />
                {canViewFinance && (
                  <Info label="Total Nilai Beli" value={formatCurrency(asset.purchasePrice)} />
                )}
              </div>
              <div className="flex gap-2">
                <Link
                  href={`/reports/assets/${asset.id}`}
                  className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-teal-500 text-white px-3 py-2 text-sm font-medium hover:brightness-105"
                >
                  <FileBarChart size={14} />
                  Lihat Full Report
                </Link>
                <button
                  onClick={() =>
                    exportToExcel(
                      `QHSE-Care-Asset-Report-${asset.assetCode}-${todayStamp()}.xlsx`,
                      "Asset Report",
                      [
                        {
                          Asset: asset.assetName,
                          "Kode Asset": asset.assetCode,
                          "Health Score": healthScore,
                          Label: healthScoreLabel(healthScore),
                          "Total Ticket": tickets.length,
                          "Total Peminjaman": borrowings.length,
                          "Last Maintenance": formatDate(asset.lastMaintenanceAt),
                          "Next Maintenance": formatDate(asset.nextMaintenanceAt),
                        },
                      ]
                    )
                  }
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                >
                  <FileDown size={14} />
                  Export
                </button>
              </div>
            </Section>
          )}
        </div>
      </div>

      <ConfirmModal
        open={deactivateOpen}
        title="Nonaktifkan Asset"
        description={`Asset "${asset.assetName}" akan ditandai nonaktif.`}
        confirmLabel={deactivating ? "Memproses..." : "Nonaktifkan"}
        danger
        onConfirm={handleDeactivate}
        onCancel={() => setDeactivateOpen(false)}
      />

      <ConfirmModal
        open={custodianModalOpen}
        title={asset.custodianUid ? "Ubah Custodian" : "Tetapkan Custodian"}
        description="Custodian tidak perlu scan/pinjam setiap hari — aset ini akan berada langsung padanya."
        confirmLabel={usageSaving ? "Menyimpan..." : "Tetapkan"}
        onConfirm={handleAssignCustodian}
        onCancel={closeUsageModals}
      >
        <div className="space-y-2">
          <label className="block text-xs font-medium text-slate-500">Pilih Custodian</label>
          <SearchableSelect
            items={employeeSelectItems}
            value={selectedUserUid}
            onChange={setSelectedUserUid}
            placeholder="Pilih karyawan"
            searchPlaceholder="Cari nama karyawan..."
            emptyText="Karyawan tidak ditemukan"
          />
          {usageError && <p className="text-sm text-red-600">{usageError}</p>}
        </div>
      </ConfirmModal>

      <ConfirmModal
        open={handoverModalOpen}
        title="Serahkan Sementara"
        description="Catat siapa yang sedang memegang aset ini sementara — begitu selesai, kembalikan lewat tombol Kembalikan ke Custodian."
        confirmLabel={usageSaving ? "Menyimpan..." : "Serahkan"}
        onConfirm={handleHandoverTemporary}
        onCancel={closeUsageModals}
      >
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Dipakai oleh</label>
            <SearchableSelect
              items={employeeSelectItems}
              value={selectedUserUid}
              onChange={setSelectedUserUid}
              placeholder="Pilih karyawan"
              searchPlaceholder="Cari nama karyawan..."
              emptyText="Karyawan tidak ditemukan"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">
              Keperluan <span className="text-red-500">*</span>
            </label>
            <input
              value={handoverPurpose}
              onChange={(e) => setHandoverPurpose(e.target.value)}
              placeholder="mis. Konten Instagram acara kantor"
              className="input text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Estimasi Kembali</label>
            <input
              type="date"
              value={handoverExpectedReturnAt}
              onChange={(e) => setHandoverExpectedReturnAt(e.target.value)}
              className="input text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Catatan</label>
            <textarea
              value={handoverNote}
              onChange={(e) => setHandoverNote(e.target.value)}
              rows={2}
              className="input text-sm"
            />
          </div>
          {usageError && <p className="text-sm text-red-600">{usageError}</p>}
        </div>
      </ConfirmModal>

      <ConfirmModal
        open={returnConfirmOpen}
        title="Kembalikan ke Custodian"
        description={`Aset akan kembali ke pemegang tetapnya, ${asset.custodianName || "custodian"}.`}
        confirmLabel={usageSaving ? "Menyimpan..." : "Kembalikan"}
        onConfirm={handleReturnToCustodian}
        onCancel={() => {
          setReturnConfirmOpen(false);
          setUsageError("");
        }}
      >
        {usageError && <p className="text-sm text-red-600">{usageError}</p>}
      </ConfirmModal>

      <ConfirmModal
        open={forceModalOpen}
        title="Paksa Kembalikan / Koreksi Pemakai"
        description="Dipakai kalau data pemakai salah atau barang tidak dikembalikan sesuai prosedur. Kosongkan pilihan user untuk paksa-kembalikan ke custodian."
        confirmLabel={usageSaving ? "Menyimpan..." : "Proses"}
        danger
        onConfirm={handleForceReturnOrCorrect}
        onCancel={closeUsageModals}
      >
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">
              Koreksi pemakai jadi (opsional)
            </label>
            <SearchableSelect
              items={employeeSelectItems}
              value={forceCorrectedUserUid}
              onChange={setForceCorrectedUserUid}
              placeholder="Paksa kembali ke custodian"
              searchPlaceholder="Cari nama karyawan..."
              emptyText="Karyawan tidak ditemukan"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">
              Catatan / Alasan <span className="text-red-500">*</span>
            </label>
            <textarea
              value={forceNote}
              onChange={(e) => setForceNote(e.target.value)}
              rows={2}
              placeholder="Jelaskan kenapa koreksi ini perlu dilakukan..."
              className="input text-sm"
            />
          </div>
          {usageError && <p className="text-sm text-red-600">{usageError}</p>}
        </div>
      </ConfirmModal>

      <Toast toast={toast} onClose={() => setToast(null)} />
    </ProtectedLayout>
  );
}

function Section({
  title,
  children,
  anchorId,
}: {
  title: string;
  children: React.ReactNode;
  anchorId?: string;
}) {
  return (
    <div
      id={anchorId}
      className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 scroll-mt-20"
    >
      <h2 className="font-semibold mb-4 text-slate-800">{title}</h2>
      {children}
    </div>
  );
}

function Info({ label, value, full }: { label: string; value?: string; full?: boolean }) {
  return (
    <div className={full ? "sm:col-span-2" : ""}>
      <p className="text-xs text-slate-400 mb-0.5">{label}</p>
      <p className="text-slate-800 font-medium">{value || "-"}</p>
    </div>
  );
}
