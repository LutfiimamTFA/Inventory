"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { QRCodeSVG } from "qrcode.react";
import { Copy, Check } from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { isAssetInMyPicLocation } from "@/lib/locations";
import {
  Asset,
  AssetCategory,
  AssetCondition,
  AssetLocationNode,
  AssetStatus,
  AssetUsageType,
  TrackingMode,
  FundingSource,
  HrpBrand,
  HrpDivision,
  InvoiceStatus,
  OwnershipStatus,
} from "@/lib/types";
import { INVOICE_STATUS_LABEL } from "@/lib/assets/inventory";
import { diffAssetFields, buildAssetChangeSummary } from "@/lib/assets/audit-log";
import {
  allocateAssetCode,
  deriveCompanyCode,
  formatDateForAssetCode,
  resolveOperationalLocationCode,
} from "@/lib/assets/asset-code-generator";
import { fetchHrpBrands, fetchHrpDivisions } from "@/lib/hrp";
import {
  EmployeeOption,
  fetchActiveEmployeeOptions,
  fetchActiveUsersByRoles,
  normalizeCategoryCodePart,
  writeAssetLog,
} from "@/lib/firestore-helpers";
import { buildChangeMessage, buildChangeSummary, createAssetNotification } from "@/lib/notifications";
import { buildFullPath, getDescendantIds, resolveAreaPic } from "@/lib/locations";
import {
  ASSET_STATUS_HELPER,
  ASSET_STATUS_LABEL,
  ASSET_USAGE_TYPE_LABEL,
  TRACKING_MODE_LABEL,
  CONDITION_LABEL,
  getQrImageSettings,
} from "@/lib/utils";
import ProtectedLayout from "@/components/ProtectedLayout";
import AssetFieldErrorModal from "@/components/AssetFieldErrorModal";
import PageHeader from "@/components/PageHeader";
import { FormSection, Field } from "@/components/FormSection";
import Toggle from "@/components/Toggle";
import CurrencyInput from "@/components/CurrencyInput";
import SearchableSelect, { SearchableSelectItem } from "@/components/SearchableSelect";
import LocationCascadeFields, { LocationSelection } from "@/components/LocationCascadeFields";
import FileUploadField from "@/components/FileUploadField";
import PhysicalEvidenceManager from "@/components/PhysicalEvidenceManager";
import QrLabelModal from "@/components/QrLabelModal";
import { Toast, ToastState } from "@/components/Toast";

const TRACKING_MODE_OPTIONS: { value: TrackingMode; hint: string }[] = [
  {
    value: "fixed_location",
    hint: "Aset menetap di lokasi, tidak dipinjam/diserahkan — mis. AC, meja, kursi, lemari, CCTV, printer ruangan.",
  },
  {
    value: "assigned_pic",
    hint: "Dipakai harian oleh satu PIC operasional, bisa diserahkan sementara — mis. HP sosial media, laptop kerja.",
  },
  {
    value: "shared_borrowable",
    hint: "Dipakai bergantian/dipinjam — mis. kamera, tripod, proyektor, mic, tablet.",
  },
];

const OWNERSHIP_OPTIONS: OwnershipStatus[] = [
  "Aset Perusahaan",
  "Barang Sewa",
  "Barang Titipan",
  "Barang Pinjaman Vendor",
  "Barang Pribadi Karyawan",
  "Lainnya",
];

const FUNDING_OPTIONS: FundingSource[] = [
  "Kas Perusahaan",
  "Dana Proyek",
  "Reimbursement",
  "Hibah",
  "Sponsor",
  "Pembelian Pribadi Dialihkan ke Kantor",
  "Lainnya",
];

// Section G — "borrowed"/"in_use" SENGAJA tidak masuk pilihan dasar. Dua
// nilai itu status PEMAKAIAN, bukan kondisi/siklus-hidup barang, dan HARUS
// otomatis dari proses pinjam/kembali atau assignCustodian — bukan dipilih
// manual di form edit. Kalau asetnya KEBETULAN sudah "borrowed"/"in_use"
// (data lama), nilainya tetap disisipkan di render supaya dropdown tidak
// diam-diam mengubah status pemakaian asset saat admin cuma mau edit field
// lain — lihat assetStatusOptionsWithCurrent di bawah.
const ASSET_STATUS_OPTIONS: AssetStatus[] = [
  "available",
  "maintenance",
  "broken",
  "incomplete",
  "lost",
  "inactive",
  "disposed",
];

// Section "Riwayat Aktivitas" — field yang diikutkan diff audit log dari
// jalur submit umum (Finance/Asset Admin/Super Admin sama-sama lewat sini).
// Urutan SENGAJA menaruh field yang lebih "manusiawi" duluan (categoryName
// sebelum categoryId, dst) — lihat diffAssetFields di lib/assets/audit-log.ts.
const AUDITED_ASSET_FIELDS = [
  "assetName", "categoryName", "categoryId", "subCategory",
  "assetCode", "assetNumber",
  "brand", "model", "serialNumber", "imei", "description",
  "quantity",
  "acquisitionDate", "purchaseDate",
  "locationText", "location",
  "condition", "inventoryCondition",
  "photoUrl", "photoThumbnailUrl", "photoFileName", "photoDriveFileId", "photoMimeType", "photoSize", "photoUploadedAt",
  "acquisitionPrice", "purchasePrice",
  "invoiceStatus", "invoiceNumber", "vendorName", "fundingSource", "purchaseMethod", "estimatedUsefulLife", "financeNotes",
  "responsiblePersonName", "responsiblePersonUid",
  "ownershipStatus",
  "assetStatus",
];

const CONDITION_OPTIONS: AssetCondition[] = [
  "new",
  "good",
  "fair",
  "minor_damage",
  "heavy_damage",
];

// Section "Validasi Create/Edit Asset" — urutan tampil form, dipakai
// AssetFieldErrorModal untuk menentukan error PERTAMA yang di-scroll & di-
// focus saat user klik "Perbaiki Data".
const REQUIRED_FIELD_ORDER = [
  "assetName",
  "categoryId",
  "acquisitionDate",
  "quantity",
  "companyOwnerId",
  "location",
  "assetCode",
  "responsiblePersonUid",
  "ownershipStatus",
  "condition",
  "assetStatus",
];

export default function EditAssetPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const {
    firebaseUser,
    assetUser,
    role,
    loading,
    isLocationPicRole: isPicViaLocations,
    assignedPicLocations,
  } = useAuth();
  const authReady = !loading && !!firebaseUser && !!assetUser && !!role;
  const [asset, setAsset] = useState<Asset | null>(null);
  const [categories, setCategories] = useState<AssetCategory[]>([]);
  const [employeeOptions, setEmployeeOptions] = useState<EmployeeOption[]>([]);
  const [brands, setBrands] = useState<HrpBrand[]>([]);
  const [divisions, setDivisions] = useState<HrpDivision[]>([]);
  const [loadingDivisions, setLoadingDivisions] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  // Section "Validasi Create/Edit Asset" — locationErrorLevel: border merah
  // per-level Gedung/Lantai/Ruangan; errorModalOpen: modal ringkasan
  // "Periksa Data Aset".
  const [locationErrorLevel, setLocationErrorLevel] = useState<"building" | "floor" | "room" | null>(null);
  const [errorModalOpen, setErrorModalOpen] = useState(false);
  // Section "Rapikan UI Identitas Aset Otomatis" — modal QR full (lihat/
  // cetak) dari card compact, dan feedback "tersalin" sesaat di tombol Copy
  // Kode Aset (bukan cuma toast, biar langsung kelihatan di tombolnya).
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  const errCls = (hasError: boolean, base = "input") => (hasError ? `${base} border-red-500 focus:ring-red-500/30` : base);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [invoiceUploading, setInvoiceUploading] = useState(false);
  // Section "Create/Edit Asset ikuti Excel" — Kode Aset readonly, TIDAK
  // PERNAH digenerate ulang otomatis. User harus mencentang ini dulu kalau
  // memang bermaksud mengubah field pembentuk kode (Perusahaan/Tanggal
  // Perolehan/Lokasi Gedung/Kategori) — lihat codeFormingChanged di bawah.
  const [codeChangeAcknowledged, setCodeChangeAcknowledged] = useState(false);

  const [form, setForm] = useState<Partial<Asset>>({});
  const [locations, setLocations] = useState<AssetLocationNode[]>([]);

  useEffect(() => {
    if (!authReady) return;
    getDoc(doc(db, "assets", id))
      .then((snap) => {
        console.log("[EditAssetPage GetDoc] assets success:", { id, exists: snap.exists() });
        if (snap.exists()) {
          const data = { id: snap.id, ...snap.data() } as Asset;
          console.debug("[Asset Detail] loaded photo fields:", {
            photoUrl: data.photoUrl,
            photoThumbnailUrl: data.photoThumbnailUrl,
            photoFileName: data.photoFileName,
            photoDriveFileId: data.photoDriveFileId,
          });
          setAsset(data);
          setForm(data);
        }
      })
      .catch((error) => {
        console.error("[EditAssetPage GetDoc] assets error:", { id, error });
      });
  }, [authReady, id]);

  // Section G — PIC Lokasi cuma boleh edit asset di lokasi tanggung jawabnya
  // sendiri. Firestore rules (isLocationPicUpdate) sudah menolak WRITE-nya,
  // tapi tanpa guard ini form-nya masih bisa dibuka dan diisi (baru gagal
  // saat submit) — lebih jelas kalau langsung ditolak di sini.
  useEffect(() => {
    if (!authReady || !asset) return;
    if (role !== "location_pic" && !isPicViaLocations) return;
    if (isAssetInMyPicLocation(asset, assignedPicLocations, assetUser?.uid)) return;

    queueMicrotask(() =>
      setToast({
        type: "error",
        message: "Anda hanya dapat mengelola asset pada lokasi yang menjadi tanggung jawab Anda.",
      })
    );
    const timer = window.setTimeout(() => router.replace("/assets"), 1200);
    return () => window.clearTimeout(timer);
  }, [authReady, asset, role, isPicViaLocations, assignedPicLocations, assetUser?.uid, router]);

  useEffect(() => {
    if (!authReady) return;
    const unsub = onSnapshot(
      collection(db, "asset_categories"),
      (snap) => {
        console.log("[EditAssetPage Listener] asset_categories success:", snap.size);
        setCategories(
          snap.docs.map((d) => ({ id: d.id, ...d.data() } as AssetCategory))
        );
      },
      (error) => {
        console.error("[EditAssetPage Listener] asset_categories error:", error);
      }
    );
    return () => unsub();
  }, [authReady]);

  useEffect(() => {
    if (!authReady) return;
    const unsub = onSnapshot(
      collection(db, "asset_locations"),
      (snap) => {
        console.log("[EditAssetPage Listener] asset_locations success:", snap.size);
        setLocations(
          snap.docs
            .map((d) => ({ id: d.id, ...d.data() } as AssetLocationNode))
            .filter((n) => n.status === "active")
        );
      },
      (error) => {
        console.error("[EditAssetPage Listener] asset_locations error:", error);
      }
    );
    return () => unsub();
  }, [authReady]);

  // Sumber tunggal dropdown PIC/Custodian — fetchActiveEmployeeOptions sudah
  // menormalisasi nama (fullName/employeeName/name/displayName, email cuma
  // fallback terakhir), mengecualikan kandidat/nonaktif, dan dedupe per
  // uid/email. Jangan bangun daftar karyawan sendiri di sini lagi.
  useEffect(() => {
    if (!authReady) return;
    let cancelled = false;
    fetchActiveEmployeeOptions()
      .then((options) => {
        if (!cancelled) setEmployeeOptions(options);
      })
      .catch((err) => console.error("[EditAssetPage] gagal memuat daftar karyawan aktif", err));
    return () => {
      cancelled = true;
    };
  }, [authReady]);

  useEffect(() => {
    if (!authReady) return;
    fetchHrpBrands().then(setBrands);
  }, [authReady]);

  useEffect(() => {
    if (!authReady) return;
    if (!form.companyOwnerId) return;
    let cancelled = false;
    fetchHrpDivisions(form.companyOwnerId)
      .then((list) => {
        if (!cancelled) setDivisions(list);
      })
      .finally(() => {
        if (!cancelled) setLoadingDivisions(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authReady, form.companyOwnerId]);

  const set = <K extends keyof Asset>(key: K, value: Asset[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  // Aset lama belum punya trackingMode tersimpan — diturunkan dari usageType
  // lama supaya form tetap konsisten begitu dibuka pertama kali.
  const trackingMode: TrackingMode =
    form.trackingMode || (form.usageType === "assigned_daily" ? "assigned_pic" : "shared_borrowable");

  // Section C/D — Asset Finance cuma boleh edit section Finance (field lain
  // read-only lewat <fieldset disabled>). Asset Admin/QHSE, Staff, Tim IT
  // TIDAK boleh melihat section Finance sama sekali (disembunyikan penuh,
  // bukan cuma read-only) — hanya Super Admin & Asset Finance yang boleh
  // melihat/mengedit nominal harga.
  const isFinanceOnlyRole = role === "asset_finance";
  const canViewFinanceEdit = role === "super_admin" || role === "asset_finance";

  const locationSelection: LocationSelection = {
    buildingId: form.buildingId || "",
    buildingName: form.buildingName || "",
    floorId: form.floorId || "",
    floorName: form.floor || "",
    roomId: form.roomId || "",
    roomName: form.roomName || "",
    areaId: form.areaId || "",
    areaName: form.areaName || "",
  };
  const handleLocationSelectionChange = (next: LocationSelection) => {
    setForm((f) => ({
      ...f,
      buildingId: next.buildingId,
      buildingName: next.buildingName,
      floorId: next.floorId,
      floor: next.floorName,
      roomId: next.roomId,
      roomName: next.roomName,
      areaId: next.areaId,
      areaName: next.areaName,
    }));
  };

  const handleCompanyChange = (value: string) => {
    set("companyOwnerId", value);
    set("divisionOwnerId", "");
    setDivisions([]);
    setLoadingDivisions(!!value);
  };

  // Section E — PIC Lokasi hanya boleh memindahkan aset ke lokasi dalam
  // scope-nya (dirinya + turunannya) — sama seperti create asset. Berlaku
  // juga untuk staff yang ditunjuk PIC di Master Lokasi (isPicViaLocations),
  // bukan cuma role "location_pic" literal.
  const isLocationPicRole = role === "location_pic" || isPicViaLocations;
  const myPicLocations = useMemo(() => {
    if (!isLocationPicRole || !assetUser) return [];
    return locations.filter((n) => n.picUid === assetUser.uid);
  }, [locations, isLocationPicRole, assetUser]);
  const scopedLocations = useMemo(() => {
    if (!isLocationPicRole) return locations;
    if (myPicLocations.length === 0) return [];
    const idSet = new Set<string>();
    myPicLocations.forEach((node) => {
      node.parentPath.forEach((id) => idSet.add(id));
      idSet.add(node.id);
      getDescendantIds(locations, node.id).forEach((id) => idSet.add(id));
    });
    return locations.filter((n) => idSet.has(n.id));
  }, [locations, isLocationPicRole, myPicLocations]);

  const [selectedPicLocationId, setSelectedPicLocationId] = useState("");

  // Section J — inisialisasi pilihan lokasi PIC dari lokasi asset SAAT INI
  // (cari node PIC miliknya yang id-nya cocok dengan salah satu level lokasi
  // asset), supaya form tidak kosong saat pertama dibuka.
  useEffect(() => {
    if (!isLocationPicRole || selectedPicLocationId || myPicLocations.length === 0) return;
    const currentIds = [form.areaId, form.roomId, form.floorId, form.buildingId].filter(Boolean);
    const match = myPicLocations.find((loc) => currentIds.includes(loc.id));
    queueMicrotask(() => {
      if (match) setSelectedPicLocationId(match.id);
      else if (myPicLocations.length === 1) setSelectedPicLocationId(myPicLocations[0].id);
    });
  }, [isLocationPicRole, myPicLocations, selectedPicLocationId, form.areaId, form.roomId, form.floorId, form.buildingId]);

  const category = useMemo(
    () => categories.find((c) => c.id === form.categoryId),
    [categories, form.categoryId]
  );
  const companyOwner = useMemo(
    () => brands.find((b) => b.id === form.companyOwnerId),
    [brands, form.companyOwnerId]
  );
  const divisionOwner = useMemo(
    () => divisions.find((d) => d.id === form.divisionOwnerId),
    [divisions, form.divisionOwnerId]
  );
  const responsiblePerson = useMemo(
    () => employeeOptions.find((e) => e.uid === form.responsiblePersonUid),
    [employeeOptions, form.responsiblePersonUid]
  );

  // Baris utama SELALU nama, baris kecil divisi/perusahaan/jabatan — email
  // TIDAK PERNAH ditampilkan, cuma dipakai sebagai kata kunci pencarian.
  const employeeItems: SearchableSelectItem[] = employeeOptions.map((e) => ({
    id: e.uid,
    label: e.name,
    sublabel: [e.divisionName, e.brandName, e.roleLabel].filter(Boolean).join(" — ") || undefined,
    searchText: [e.name, e.email, e.divisionName, e.brandName, e.roleLabel].filter(Boolean).join(" "),
  }));

  const brandItems: SearchableSelectItem[] = brands.map((b) => ({
    id: b.id,
    label: b.name,
    sublabel: b.status ? `Status: ${b.status}` : undefined,
    searchText: b.name,
  }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!asset) return;

    if (photoUploading || invoiceUploading) {
      setError("Tunggu proses upload file selesai sebelum menyimpan.");
      return;
    }

    // Section "Finance edit lengkap + audit log" — Asset Finance sekarang
    // ikut jalur submit UMUM yang sama dengan Asset Admin/Super Admin
    // (bukan cabang financePayload terpisah lagi). Field yang memang tidak
    // boleh disentuh Finance (Perusahaan/Divisi/PIC/Mode Tracking/Status
    // Kepemilikan/Status Operasional Aset/Pengaturan Pemakaian) sudah
    // di-disable di level UI (lihat fieldset disabled={isFinanceOnlyRole}
    // di form di bawah), jadi form.* untuk field itu tetap nilai lama yang
    // di-load — updateDoc mengirim nilai yang SAMA (bukan berubah), dan
    // Firestore rules (isAssetFinanceUpdate) menolak kalau field itu tetap
    // berhasil berubah lewat jalur lain.

    // Section 1/2/3 — PIC Lokasi HANYA boleh mengubah data fisik + PIC
    // Operasional/Custodian aset di lokasinya sendiri (lihat
    // firestore.rules isLocationPicAssetUpdate) — jalur submit ini WAJIB
    // terpisah dan mengirim payload MINIMAL (bukan seluruh object aset
    // lewat spread data lama) supaya tidak pernah mengirim field
    // locationId/finance/status peminjaman/kendala yang bikin updateDoc
    // kena "Missing or insufficient permissions".
    if (isLocationPicRole && role !== "super_admin" && role !== "asset_admin") {
      if (!isAssetInMyPicLocation(asset, assignedPicLocations, assetUser?.uid)) {
        setError("Anda hanya dapat mengelola asset pada lokasi yang menjadi tanggung jawab Anda.");
        return;
      }
      if (!form.assetName?.trim()) {
        setFieldErrors({ assetName: "Nama aset wajib diisi." });
        setError("Lengkapi field yang wajib diisi.");
        return;
      }
      // Section 4 — aset dengan PIC Operasional ("assigned_pic") WAJIB
      // punya PIC/Custodian terisi; aset bersama ("shared_borrowable")
      // boleh kosong. "fixed_location" tidak pernah punya custodian sama
      // sekali (di luar validasi ini).
      if (trackingMode === "assigned_pic" && !form.responsiblePersonUid) {
        setFieldErrors({ responsiblePersonUid: "Pilih PIC/Custodian untuk aset tetap." });
        setError("Pilih PIC/Custodian untuk aset tetap.");
        return;
      }

      setSaving(true);
      setError("");
      setFieldErrors({});

      const currentUserUid = firebaseUser?.uid || assetUser?.uid || "";
      const currentUserName = assetUser?.name || firebaseUser?.email || "";
      const currentUserEmail = firebaseUser?.email || "";
      // Section 1/3 — trackingMode BARU (dari dropdown, bukan asset.trackingMode
      // lama) — inilah bug yang diperbaiki: cabang PIC Lokasi sebelumnya
      // TIDAK PERNAH mengirim trackingMode/trackingModeLabel sama sekali,
      // jadi perubahan di dropdown selalu hilang begitu disimpan.
      const custodianName =
        trackingMode === "fixed_location" ? null : responsiblePerson?.name || form.responsiblePersonName || null;
      const custodianEmail =
        trackingMode === "fixed_location" ? null : responsiblePerson?.email || form.responsiblePersonEmail || null;
      const custodianUid = trackingMode === "fixed_location" ? null : form.responsiblePersonUid || null;

      const updatePayload = {
        assetName: form.assetName?.trim(),
        subCategory: form.subCategory || "",
        brand: form.brand || "",
        model: form.model || "",
        serialNumber: form.serialNumber || "",
        imei: form.imei || "",
        description: form.description || "",

        photoUrl: form.photoUrl || null,
        photoThumbnailUrl: form.photoThumbnailUrl || null,
        photoFileName: form.photoFileName || null,
        photoDriveFileId: form.photoDriveFileId || null,
        photoMimeType: form.photoMimeType || null,
        photoSize: form.photoSize ?? null,
        photoUploadedAt: form.photoUploadedAt || null,

        trackingMode,
        trackingModeLabel: TRACKING_MODE_LABEL[trackingMode],

        responsiblePersonUid: custodianUid,
        responsiblePersonName: custodianName || "",
        responsiblePersonEmail: custodianEmail || "",
        responsiblePersonDivision:
          trackingMode === "fixed_location" ? "" : responsiblePerson?.divisionName || form.responsiblePersonDivision || "",
        responsiblePersonJobTitle:
          trackingMode === "fixed_location" ? "" : responsiblePerson?.roleLabel || form.responsiblePersonJobTitle || "",

        custodianUid,
        custodianName,
        custodianEmail,
        custodianEmployeeId: null,
        custodianDivision:
          trackingMode === "fixed_location" ? null : responsiblePerson?.divisionName || form.responsiblePersonDivision || null,
        custodianRole:
          trackingMode === "fixed_location" ? null : responsiblePerson?.roleLabel || form.custodianRole || null,
        custodianCompanyId: null,
        custodianCompanyName: trackingMode === "fixed_location" ? null : responsiblePerson?.brandName || null,

        // Section 2 — PIC Operasional dan PIC/Custodian dipilih lewat satu
        // picker yang sama (belum ada picker terpisah di UI), jadi field
        // operationalPic* diisi dari sumber data yang sama dengan custodian*
        // supaya konsisten dan tidak kosong.
        operationalPicUid: form.responsiblePersonUid || null,
        operationalPicName: responsiblePerson?.name || form.responsiblePersonName || null,
        operationalPicEmail: responsiblePerson?.email || form.responsiblePersonEmail || null,
        operationalPicEmployeeId: null,
        operationalPicDivision: responsiblePerson?.divisionName || form.responsiblePersonDivision || null,
        operationalPicCompanyId: null,
        operationalPicCompanyName: responsiblePerson?.brandName || null,

        picUid: custodianUid,
        picName: custodianName,
        picEmail: custodianEmail,

        accessories: form.accessories || "",
        operationalNotes: form.operationalNotes || "",

        updatedAt: serverTimestamp(),
        updatedByUid: currentUserUid,
        updatedByName: currentUserName,
        updatedByEmail: currentUserEmail,
      };

      console.info("[Asset Custodian Submit]", {
        assetId: asset.id,
        locationId: asset.locationId,
        currentUserUid: firebaseUser?.uid,
        payloadKeys: Object.keys(updatePayload),
        updatePayload,
      });

      const custodianChanged = custodianUid !== (asset.custodianUid || null);
      const logAction = custodianChanged ? "asset_custodian_updated" : "asset_updated_by_location_pic";

      try {
        await updateDoc(doc(db, "assets", asset.id), updatePayload);

        // Section 5 — baca ulang dokumen aset SETELAH update berhasil,
        // supaya kalau user tetap di halaman ini (sebelum redirect selesai)
        // state lokal `asset`/`form` sudah menampilkan nilai terbaru, bukan
        // snapshot lama dari sebelum submit.
        try {
          const freshSnap = await getDoc(doc(db, "assets", asset.id));
          if (freshSnap.exists()) {
            const freshData = { id: freshSnap.id, ...freshSnap.data() } as Asset;
            setAsset(freshData);
            setForm(freshData);
          }
        } catch (refreshErr) {
          console.warn("[Asset Custodian Submit] gagal baca ulang dokumen aset (non-fatal)", refreshErr);
        }

        // Section 5/10 — activity log TERPISAH, tidak boleh menggagalkan
        // update aset yang sudah berhasil kalau gagal ditulis. Ditulis DUA
        // kali: ke asset_logs (supaya muncul di "Log Aktivitas" halaman
        // Detail Aset, yang membaca collection ini) dan ke
        // asset_activity_logs (izin khusus PIC Lokasi di firestore.rules).
        try {
          await writeAssetLog({
            assetId: asset.id,
            assetName: form.assetName || asset.assetName,
            assetCode: asset.assetCode,
            action: logAction,
            userUid: currentUserUid,
            userName: currentUserName,
            detail: "Diperbarui oleh PIC Lokasi",
          });
        } catch (logError) {
          console.warn("[Asset Custodian Submit] asset_logs gagal, perubahan aset tetap berhasil", logError);
        }
        try {
          await addDoc(collection(db, "asset_activity_logs"), {
            assetId: asset.id,
            locationId: asset.locationId || null,
            actorUid: currentUserUid,
            createdByUid: currentUserUid,
            action: logAction,
            createdAt: serverTimestamp(),
          });
        } catch (logError) {
          console.warn(
            "[Asset Custodian Submit] asset_activity_logs gagal, perubahan aset tetap berhasil",
            logError
          );
        }

        setToast({ type: "success", message: "Perubahan aset berhasil disimpan." });
        router.push(`/assets/${asset.id}`);
      } catch (err) {
        console.error("[Asset Custodian Submit ERROR]", err);
        setError("Gagal menyimpan perubahan.");
        setToast({ type: "error", message: "Gagal menyimpan perubahan." });
      } finally {
        setSaving(false);
      }
      return;
    }

    const errors: Record<string, string> = {};
    if (!form.assetName?.trim()) errors.assetName = "Nama aset wajib diisi.";
    if (!form.assetCode?.trim()) errors.assetCode = "Kode aset wajib diisi.";
    if (!form.categoryId) errors.categoryId = "Kategori wajib dipilih.";
    if (!form.purchaseDate) errors.acquisitionDate = "Tanggal Perolehan wajib diisi.";
    if (!form.companyOwnerId) errors.companyOwnerId = "Perusahaan/Brand wajib dipilih.";
    let locationErrorLevelNow: "building" | "floor" | "room" | null = null;
    if (isLocationPicRole) {
      if (!selectedPicLocationId) errors.location = "Lokasi tanggung jawab wajib dipilih.";
    } else if (!form.buildingId) {
      errors.location = "Gedung wajib dipilih.";
      locationErrorLevelNow = "building";
    } else if (!form.floorId) {
      errors.location = "Lantai wajib dipilih.";
      locationErrorLevelNow = "floor";
    } else if (!form.roomId) {
      errors.location = "Ruangan wajib dipilih.";
      locationErrorLevelNow = "room";
    }
    if (!form.quantity || form.quantity < 1) errors.quantity = "Qty minimal 1.";
    // Section "Create/Edit Asset ikuti Excel" — Kode Aset TIDAK PERNAH
    // digenerate ulang diam-diam. Kalau field pembentuknya berubah, user
    // WAJIB mencentang konfirmasi di banner dekat field Kode Aset dulu.
    // Section "Perbaiki generator Kode Aset" — dibandingkan KODE LOKASI
    // HASIL RESOLVE (bukan sekadar apakah roomId/divisionOwnerId berubah),
    // supaya ganti Divisi/Ruangan yang TIDAK mengubah kode final (mis.
    // Ruangan tetap sama, atau Ruangan baru kebetulan tidak punya kode jadi
    // tetap fallback ke Gedung yang sama) tidak memicu regenerasi/konfirmasi
    // yang tidak perlu — allocateAssetCode() SELALU membakar sequence baru,
    // jadi harus benar-benar yakin kode-nya berubah dulu.
    const originalLocationCode = resolveOperationalLocationCode({
      roomCode: locations.find((n) => n.id === asset.roomId)?.roomCode,
      roomName: locations.find((n) => n.id === asset.roomId)?.roomName,
      divisionCode: divisions.find((d) => d.id === asset.divisionOwnerId)?.code,
      divisionName: divisions.find((d) => d.id === asset.divisionOwnerId)?.name,
      buildingCode: locations.find((n) => n.id === asset.buildingId)?.buildingCode,
    }).code;
    const currentLocationCodeForCompare = resolveOperationalLocationCode({
      roomCode: locations.find((n) => n.id === form.roomId)?.roomCode,
      roomName: locations.find((n) => n.id === form.roomId)?.roomName,
      divisionCode: divisionOwner?.code,
      divisionName: divisionOwner?.name,
      buildingCode: locations.find((n) => n.id === form.buildingId)?.buildingCode,
    }).code;
    const codeFormingChangedNow =
      (form.companyOwnerId || "") !== (asset.companyOwnerId || "") ||
      (form.purchaseDate || "") !== (asset.acquisitionDate || asset.purchaseDate || "") ||
      (form.categoryId || "") !== (asset.categoryId || "") ||
      currentLocationCodeForCompare !== originalLocationCode;
    if (codeFormingChangedNow && !codeChangeAcknowledged) {
      errors.assetCode = "Konfirmasi perubahan Kode Aset (centang di bawah field Kode Aset) sebelum menyimpan.";
    }
    if (!form.ownershipStatus) errors.ownershipStatus = "Status kepemilikan wajib dipilih.";
    if (trackingMode === "assigned_pic" && !form.responsiblePersonUid)
      errors.responsiblePersonUid = "PIC Operasional wajib dipilih untuk aset dengan PIC.";
    if (!form.assetStatus) errors.assetStatus = "Status aset wajib dipilih.";
    if (!form.condition) errors.condition = "Kondisi aset wajib dipilih.";

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setLocationErrorLevel(locationErrorLevelNow);
      setToast({ type: "error", message: `Data belum lengkap. Ada ${Object.keys(errors).length} bagian yang perlu diperbaiki.` });
      setErrorModalOpen(true);
      return;
    }

    console.debug("[Asset Photo] state before submit:", {
      photoUrl: form.photoUrl,
      photoThumbnailUrl: form.photoThumbnailUrl,
      photoDriveFileId: form.photoDriveFileId,
      photoFileName: form.photoFileName,
    });

    setSaving(true);
    setError("");
    setFieldErrors({});
    try {
      // Section "Create/Edit Asset ikuti Excel" — Kode Aset HANYA digenerate
      // ulang kalau field pembentuknya benar-benar berubah (sudah divalidasi
      // & dikonfirmasi user di atas). Selain itu, form.assetCode/No. Aset
      // TIDAK PERNAH disentuh — dipertahankan persis seperti data asli
      // (readonly di UI). allocateAssetCode sendiri sudah punya jaring
      // pengaman anti-duplicate (lihat lib/assets/asset-code-generator.ts).
      let finalAssetCode = form.assetCode || asset.assetCode;
      if (codeFormingChangedNow) {
        // Section "Perbaiki generator Kode Aset" — locationCode sudah
        // dihitung di atas (currentLocationCodeForCompare) dengan prioritas
        // Kode Ruangan -> Kode Divisi -> Kode Gedung, SAMA seperti Create
        // Asset — jangan wajibkan Kode Gedung kalau Ruangan/Divisi sudah
        // punya kode sendiri.
        const locationCode = currentLocationCodeForCompare;
        const dateForCode = form.purchaseDate ? formatDateForAssetCode(form.purchaseDate) : "";
        if (!locationCode || !dateForCode || !companyOwner || !category) {
          setFieldErrors({
            assetCode: !locationCode
              ? "Lokasi ini belum memiliki kode. Atur kode Ruangan/Divisi di Master Lokasi."
              : "Gagal membuat Kode Aset baru — pastikan Perusahaan/Tanggal Perolehan/Kategori sudah lengkap.",
          });
          setError("Gagal membuat Kode Aset baru.");
          setSaving(false);
          return;
        }
        finalAssetCode = await allocateAssetCode({
          companyId: form.companyOwnerId!,
          companyCode: deriveCompanyCode(companyOwner.name),
          dateForCode,
          locationCode,
          categoryCode: normalizeCategoryCodePart(category.categoryCode),
        });
        console.info("[Asset Edit] Kode Aset digenerate ulang", {
          assetId: asset.id,
          oldCode: asset.assetCode,
          newCode: finalAssetCode,
        });
      }

      const photoFields = {
        photoUrl: form.photoUrl || null,
        photoThumbnailUrl: form.photoThumbnailUrl || null,
        photoFileName: form.photoFileName || null,
        photoDriveFileId: form.photoDriveFileId || null,
        photoMimeType: form.photoMimeType || null,
        photoSize: form.photoSize ?? null,
        photoUploadedAt: form.photoUploadedAt || null,
      };
      console.debug("[Asset Save] payload photo fields:", photoFields);

      const assetLocationText = buildFullPath({
        buildingName: form.buildingName || "",
        floorName: form.floor || "",
        roomName: form.roomName || "",
        areaName: form.areaName || "",
      });

      // Section D — PIC Lokasi ikut dihitung ulang tiap edit tersimpan,
      // supaya kalau aset dipindah lokasi (atau PIC lokasinya baru saja
      // ditetapkan/diubah), areaPic* tetap sinkron.
      const areaPic = resolveAreaPic(locations, {
        buildingId: form.buildingId,
        floorId: form.floorId,
        roomId: form.roomId,
        areaId: form.areaId,
      });

      // ── Tipe pemakaian & custodian ──────────────────────────────────────
      // custodian* selalu ikut PIC/Custodian di form. currentHolder* HANYA
      // dipaksa ikut custodian kalau belum ada serah-terima sementara aktif
      // (currentUsageStatus !== "temporary_used_by_other") atau kalau
      // usageType/custodian-nya baru saja diubah — supaya edit form yang
      // tidak berkaitan (mis. ganti deskripsi) tidak diam-diam menimpa
      // siapa yang sedang pegang barang.
      const nextTrackingMode = trackingMode;
      const nextUsageType: AssetUsageType = nextTrackingMode === "assigned_pic" ? "assigned_daily" : "shared_pool";
      const custodianChanged = (form.responsiblePersonUid || null) !== (asset.custodianUid || null);
      const trackingModeChanged = nextTrackingMode !== (asset.trackingMode || null);
      const hasActiveHandover = asset.currentUsageStatus === "temporary_used_by_other";
      const custodianName = responsiblePerson?.name || form.responsiblePersonName || null;
      const custodianEmail = responsiblePerson?.email || form.responsiblePersonEmail || null;
      const custodianDivision = responsiblePerson?.divisionName || form.responsiblePersonDivision || null;
      const custodianRole = responsiblePerson?.roleLabel || form.custodianRole || null;

      const usageFields: Record<string, unknown> = {
        trackingMode: nextTrackingMode,
        trackingModeLabel: TRACKING_MODE_LABEL[nextTrackingMode],
        // Alias legacy — tampilan/laporan lama yang masih baca
        // responsiblePerson*/pic* tetap konsisten dengan custodian baru.
        picUid: form.responsiblePersonUid || null,
        picName: custodianName,
        picEmail: custodianEmail,
      };
      if (nextTrackingMode === "fixed_location") {
        // Aset tetap lokasi TIDAK masuk sistem custodian/currentHolder sama
        // sekali (section B) — responsiblePerson* tetap dipakai sebagai
        // "PIC Lokasi", tapi usageType/custodian*/currentHolder* dikosongkan.
        usageFields.usageType = null;
        usageFields.usageTypeLabel = null;
        usageFields.custodianUid = null;
        usageFields.custodianName = null;
        usageFields.custodianEmail = null;
        usageFields.custodianDivision = null;
        usageFields.custodianRole = null;
        usageFields.currentHolderUid = null;
        usageFields.currentHolderName = null;
        usageFields.currentHolderEmail = null;
        usageFields.currentHolderDivision = null;
        usageFields.currentUsageStatus = "fixed_at_location";
        usageFields.currentUsageStatusLabel = "Tetap di Lokasi";
      } else {
        usageFields.usageType = nextUsageType;
        usageFields.usageTypeLabel = ASSET_USAGE_TYPE_LABEL[nextUsageType];
        usageFields.custodianUid = form.responsiblePersonUid || null;
        usageFields.custodianName = custodianName;
        usageFields.custodianEmail = custodianEmail;
        usageFields.custodianDivision = custodianDivision;
        usageFields.custodianRole = custodianRole;
        if (nextTrackingMode === "assigned_pic") {
          if (!hasActiveHandover || trackingModeChanged || custodianChanged) {
            usageFields.currentHolderUid = form.responsiblePersonUid || null;
            usageFields.currentHolderName = custodianName;
            usageFields.currentHolderEmail = custodianEmail;
            usageFields.currentHolderDivision = custodianDivision;
            usageFields.currentUsageStatus = "with_custodian";
            usageFields.currentUsageStatusLabel = "Bersama Custodian";
            usageFields.currentUsageStartedAt = asset.currentUsageStartedAt || serverTimestamp();
          }
        } else {
          usageFields.currentHolderUid = null;
          usageFields.currentHolderName = null;
          usageFields.currentHolderEmail = null;
          usageFields.currentHolderDivision = null;
          usageFields.currentUsageStatus = "available";
          usageFields.currentUsageStatusLabel = "Tersedia";
        }
      }

      console.log("[Asset Custodian Submit]", {
        usageType: nextUsageType,
        selectedCustodian: { uid: form.responsiblePersonUid, name: custodianName, email: custodianEmail },
        payload: {
          custodianUid: usageFields.custodianUid,
          custodianName: usageFields.custodianName,
          custodianEmail: usageFields.custodianEmail,
          currentHolderUid: usageFields.currentHolderUid,
          currentHolderName: usageFields.currentHolderName,
          currentUsageStatus: usageFields.currentUsageStatus,
        },
      });

      const generalUpdatePayload = {
        assetName: form.assetName,
        assetCode: finalAssetCode,
        // No. Aset TIDAK PERNAH digenerate ulang lewat Edit Aset — dipakai
        // persis nilai existing (readonly di UI, lihat Field "No. Aset").
        assetNumber: typeof form.assetNumber === "number" ? form.assetNumber : null,
        categoryId: form.categoryId,
        categoryName: category?.categoryName || form.categoryName,
        subCategory: form.subCategory || "",
        brand: form.brand || "",
        model: form.model || "",
        serialNumber: form.serialNumber || "",
        imei: form.imei || "",
        description: form.description || "",
        ...photoFields,

        companyOwnerId: form.companyOwnerId || null,
        companyOwnerName: companyOwner?.name || form.companyOwnerName || "",
        divisionOwnerId: form.divisionOwnerId || null,
        divisionOwnerName: divisionOwner?.name || form.divisionOwnerName || "",
        location: assetLocationText,
        buildingId: form.buildingId || null,
        buildingName: form.buildingName || "",
        floorId: form.floorId || null,
        floor: form.floor || "",
        roomId: form.roomId || null,
        roomName: form.roomName || "",
        areaId: form.areaId || null,
        areaName: form.areaName || "",
        locationId:
          form.areaId || form.roomId || form.floorId || form.buildingId || null,
        locationText: assetLocationText,
        areaPicUid: areaPic?.uid || null,
        areaPicName: areaPic?.name || null,
        areaPicEmail: areaPic?.email || null,
        areaPicLocationId: areaPic?.locationId || null,
        areaPicLocationName: areaPic?.locationName || null,
        responsiblePersonUid: form.responsiblePersonUid || null,
        responsiblePersonName:
          responsiblePerson?.name || form.responsiblePersonName || "",
        responsiblePersonEmail:
          responsiblePerson?.email || form.responsiblePersonEmail || "",
        responsiblePersonDivision:
          responsiblePerson?.divisionName || form.responsiblePersonDivision || "",
        responsiblePersonJobTitle:
          responsiblePerson?.roleLabel || form.responsiblePersonJobTitle || "",
        ownershipStatus: form.ownershipStatus,
        ...usageFields,

        purchaseDate: form.purchaseDate || null,
        purchasePrice: form.purchasePrice ?? null,
        vendorName: form.vendorName || "",
        // Nomor/Bukti Invoice hanya disimpan saat Status Invoice = "Ada
        // Invoice" — dijaga ulang di sini (bukan cuma di UI) supaya data
        // yang kesimpan tetap benar walau state form sempat tidak sinkron.
        // File di Google Drive-nya sendiri TIDAK pernah dihapus dari sini —
        // hanya relasinya di dokumen asset yang dikosongkan.
        invoiceNumber: form.invoiceStatus === "ada" ? form.invoiceNumber || "" : "",
        invoiceFileUrl: form.invoiceStatus === "ada" ? form.invoiceFileUrl || "" : "",
        invoiceFileName: form.invoiceStatus === "ada" ? form.invoiceFileName || "" : "",
        invoiceDriveFileId: form.invoiceStatus === "ada" ? form.invoiceDriveFileId || "" : "",
        invoiceMimeType: form.invoiceStatus === "ada" ? form.invoiceMimeType || "" : "",
        invoiceSize: form.invoiceStatus === "ada" ? form.invoiceSize ?? null : null,
        invoiceUploadedAt: form.invoiceStatus === "ada" ? form.invoiceUploadedAt || null : null,
        fundingSource: form.fundingSource,
        purchaseMethod: form.purchaseMethod || "",
        estimatedUsefulLife: form.estimatedUsefulLife || "",
        financeNotes: form.financeNotes || "",

        assetStatus: form.assetStatus,
        condition: form.condition,
        isBorrowable: form.isBorrowable,
        requiresApproval: form.requiresApproval,
        accessories: form.accessories || "",
        operationalNotes: form.operationalNotes || "",
        qrCodeValue: finalAssetCode,

        // ── Informasi Inventaris — inventoryNumber/quantity/inventoryNotes/
        // physicalEvidence diedit langsung di form (section "Informasi
        // Inventaris" di atas). assetType/inventoryCondition/photoStatus
        // SENGAJA cuma diisi kalau BELUM ADA (bukan menimpa tiap submit) —
        // supaya teks asli dari Excel (mis. "Perlu Pemeriksaan") tidak hilang
        // hanya karena admin edit field lain yang tidak berkaitan.
        inventoryNumber: form.inventoryNumber || "",
        assetType: form.assetType || category?.categoryName || "",
        quantity: form.quantity ?? 1,
        acquisitionDate: form.purchaseDate || null,
        acquisitionPrice: form.purchasePrice ?? null,
        // Section "Rombak permission Asset" — JANGAN derive ulang dari
        // invoiceNumber/invoiceFileUrl di sini. form.invoiceStatus sudah
        // memuat nilai tersimpan apa adanya (form di-load dari seluruh
        // dokumen asset, lihat setForm(data) di atas) — non-Finance role
        // tidak pernah mengubahnya, jadi menulis ulang persis nilai ini
        // aman dan tidak menimpa keputusan Finance (mis. "Belum Diperiksa"
        // tanpa nomor/file invoice) hanya karena field lain diedit.
        invoiceStatus: form.invoiceStatus ?? null,
        locationRaw: assetLocationText,
        inventoryCondition: form.inventoryCondition || CONDITION_LABEL[form.condition as AssetCondition],
        inventoryNotes: form.inventoryNotes || "",
        photoStatus: form.photoStatus || (form.photoDriveFileId ? "Sudah" : "Belum Ditemukan"),
        physicalEvidence: form.physicalEvidence || "",
        physicalEvidenceImages: form.physicalEvidenceImages || [],
        // Aset hasil import dianggap SUDAH DIREVIEW begitu admin menyimpan
        // perubahan lewat form edit lengkap ini.
        operationalStatus: "active",

        updatedAt: serverTimestamp(),
      };

      await updateDoc(doc(db, "assets", asset.id), generalUpdatePayload);

      // Section "Riwayat Aktivitas" — audit log field-level, dipakai
      // Finance/Asset Admin/Super Admin sama-sama (jalur submit ini sekarang
      // dibagi ketiganya). Diff dihitung dari dokumen SEBELUM disimpan
      // (asset, hasil getDoc awal) terhadap payload yang BENAR-BENAR baru
      // saja ditulis (generalUpdatePayload) — bukan re-derive terpisah,
      // supaya before/after selalu mencerminkan apa yang sungguhan tersimpan.
      const auditChanges = diffAssetFields(
        asset as unknown as Record<string, unknown>,
        generalUpdatePayload as unknown as Record<string, unknown>,
        AUDITED_ASSET_FIELDS
      );
      await writeAssetLog({
        assetId: asset.id,
        assetName: form.assetName || asset.assetName,
        assetCode: finalAssetCode,
        action: "update",
        userUid: assetUser?.uid || firebaseUser?.uid || "",
        userName: assetUser?.name || firebaseUser?.email || "",
        editedByRole: role || "",
        detail: auditChanges.length > 0 ? buildAssetChangeSummary(auditChanges) : "Data aset diperbarui (tidak ada field yang berubah nilainya)",
        changedFields: auditChanges.map((c) => c.field),
        before: Object.fromEntries(auditChanges.map((c) => [c.field, (asset as unknown as Record<string, unknown>)[c.field] ?? null])),
        after: Object.fromEntries(auditChanges.map((c) => [c.field, (generalUpdatePayload as unknown as Record<string, unknown>)[c.field] ?? null])),
      });

      const assetLabel = `${form.assetName || asset.assetName} (${form.assetCode || asset.assetCode})`;
      const oldSnapshotForDiff: Record<string, unknown> = {
        assetName: asset.assetName,
        categoryId: asset.categoryId,
        locationText: asset.locationText,
        responsiblePersonUid: asset.responsiblePersonUid || null,
        ownershipStatus: asset.ownershipStatus,
        assetStatus: asset.assetStatus,
        condition: asset.condition,
      };
      const newSnapshotForDiff: Record<string, unknown> = {
        assetName: form.assetName,
        categoryId: form.categoryId,
        locationText: assetLocationText,
        responsiblePersonUid: form.responsiblePersonUid || null,
        ownershipStatus: form.ownershipStatus,
        assetStatus: form.assetStatus,
        condition: form.condition,
      };
      const changes = buildChangeSummary(oldSnapshotForDiff, newSnapshotForDiff);

      if (changes.length > 0) {
        const notifyRecipients = (
          await fetchActiveUsersByRoles(["asset_admin", "super_admin"])
        ).filter((u) => u.uid !== assetUser?.uid);
        const message = buildChangeMessage(
          `${assetUser?.name || "Seseorang"} memperbarui data ${assetLabel}.`,
          changes
        );
        await Promise.all(
          notifyRecipients.map((recipient) =>
            createAssetNotification({
              recipientUid: recipient.uid,
              recipientName: recipient.name,
              recipientRole: recipient.role,
              title: "Data Asset Diperbarui",
              message,
              type: "asset_updated",
              priority: "low",
              linkUrl: `/assets/${asset.id}`,
              relatedType: "asset",
              relatedId: asset.id,
              relatedNumber: form.assetCode || asset.assetCode,
              oldData: oldSnapshotForDiff,
              newData: newSnapshotForDiff,
              changeSummary: changes,
              createdByUid: assetUser?.uid,
              createdByName: assetUser?.name,
            })
          )
        );
      }

      const oldResponsibleUid = asset.responsiblePersonUid || "";
      const newResponsibleUid = form.responsiblePersonUid || "";
      if (newResponsibleUid !== oldResponsibleUid) {
        if (oldResponsibleUid) {
          await createAssetNotification({
            recipientUid: oldResponsibleUid,
            recipientName: asset.responsiblePersonName || "",
            recipientRole: "staff",
            title: "Penanggung Jawab Asset Diperbarui",
            message: `Anda tidak lagi menjadi penanggung jawab ${assetLabel}.`,
            type: "asset_updated",
            priority: "low",
            linkUrl: `/assets/${asset.id}`,
            relatedType: "asset",
            relatedId: asset.id,
            relatedNumber: form.assetCode || asset.assetCode,
            createdByUid: assetUser?.uid,
            createdByName: assetUser?.name,
          });
        }
        if (newResponsibleUid) {
          await createAssetNotification({
            recipientUid: newResponsibleUid,
            recipientName: responsiblePerson?.name || form.responsiblePersonName || "",
            recipientRole: "staff",
            title: "Penanggung Jawab Asset Diperbarui",
            message: `Anda menjadi penanggung jawab ${assetLabel}.`,
            type: "asset_updated",
            priority: "low",
            linkUrl: `/assets/${asset.id}`,
            relatedType: "asset",
            relatedId: asset.id,
            relatedNumber: form.assetCode || asset.assetCode,
            createdByUid: assetUser?.uid,
            createdByName: assetUser?.name,
          });
        }
      } else if (
        newResponsibleUid &&
        form.assetStatus !== asset.assetStatus
      ) {
        await createAssetNotification({
          recipientUid: newResponsibleUid,
          recipientName: responsiblePerson?.name || form.responsiblePersonName || "",
          recipientRole: "staff",
          title: "Status Asset Berubah",
          message: `Status ${assetLabel} berubah menjadi ${form.assetStatus}.`,
          type: "asset_status_changed",
          priority: "low",
          linkUrl: `/assets/${asset.id}`,
          relatedType: "asset",
          relatedId: asset.id,
          relatedNumber: form.assetCode || asset.assetCode,
          createdByUid: assetUser?.uid,
          createdByName: assetUser?.name,
        });
      }

      setToast({ type: "success", message: "Perubahan aset berhasil disimpan." });
      router.push(`/assets/${asset.id}`);
    } catch (err) {
      console.error(err);
      setError("Gagal menyimpan perubahan.");
      setToast({ type: "error", message: "Gagal menyimpan perubahan." });
    } finally {
      setSaving(false);
    }
  };

  if (!asset) {
    return (
      <ProtectedLayout>
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 rounded-full border-2 border-slate-200 border-t-slate-900 animate-spin" />
        </div>
      </ProtectedLayout>
    );
  }

  // Section 4 — PIC Lokasi di luar scope: TOLAK render form sama sekali
  // (bukan cuma toast + redirect tertunda 1.2 detik lewat useEffect di atas
  // — selama itu form tetap bisa diisi/disubmit). Guard ini langsung
  // mengganti seluruh halaman dengan pesan penolakan.
  if ((role === "location_pic" || isPicViaLocations) && !isAssetInMyPicLocation(asset, assignedPicLocations, assetUser?.uid)) {
    return (
      <ProtectedLayout>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center text-sm text-amber-800">
          Anda hanya dapat mengelola asset pada lokasi yang menjadi tanggung jawab Anda.
        </div>
      </ProtectedLayout>
    );
  }

  // Section "Create/Edit Asset ikuti Excel" — field pembentuk Kode Aset
  // (Perusahaan/Tanggal Perolehan/Lokasi Gedung/Kategori) berubah dari nilai
  // ASLI aset -> tampilkan banner konfirmasi, JANGAN diam-diam regenerate.
  // Section "Perbaiki generator Kode Aset" — "Lokasi" dibandingkan lewat
  // KODE HASIL RESOLVE (Ruangan -> Divisi -> Gedung), bukan cuma buildingId,
  // supaya ganti Ruangan/Divisi yang TIDAK mengubah kode final (mis. sama-
  // sama fallback ke Kode Gedung yang sama) tidak memicu banner konfirmasi
  // yang tidak perlu. Duplikat sengaja dari perhitungan yang sama di
  // handleSubmit (codeFormingChangedNow) — komponen ini dievaluasi di scope
  // render terpisah, sama seperti pola locationErrorLevel di file ini.
  const codeFormingChangedFields: string[] = [];
  if ((form.companyOwnerId || "") !== (asset.companyOwnerId || "")) codeFormingChangedFields.push("Perusahaan");
  if ((form.purchaseDate || "") !== (asset.acquisitionDate || asset.purchaseDate || "")) codeFormingChangedFields.push("Tanggal Perolehan");
  if ((form.categoryId || "") !== (asset.categoryId || "")) codeFormingChangedFields.push("Kategori");
  const originalLocationCodeForBanner = resolveOperationalLocationCode({
    roomCode: locations.find((n) => n.id === asset.roomId)?.roomCode,
    roomName: locations.find((n) => n.id === asset.roomId)?.roomName,
    divisionCode: divisions.find((d) => d.id === asset.divisionOwnerId)?.code,
    divisionName: divisions.find((d) => d.id === asset.divisionOwnerId)?.name,
    buildingCode: locations.find((n) => n.id === asset.buildingId)?.buildingCode,
  }).code;
  const currentLocationCodeForBanner = resolveOperationalLocationCode({
    roomCode: locations.find((n) => n.id === form.roomId)?.roomCode,
    roomName: locations.find((n) => n.id === form.roomId)?.roomName,
    divisionCode: divisionOwner?.code,
    divisionName: divisionOwner?.name,
    buildingCode: locations.find((n) => n.id === form.buildingId)?.buildingCode,
  }).code;
  if (currentLocationCodeForBanner !== originalLocationCodeForBanner) codeFormingChangedFields.push("Lokasi");
  const codeFormingChanged = codeFormingChangedFields.length > 0;

  const photoValue = form.photoUrl
    ? {
        url: form.photoUrl,
        thumbnailUrl: form.photoThumbnailUrl,
        driveFileId: form.photoDriveFileId,
        fileName: form.photoFileName || "foto-aset",
        size: form.photoSize,
      }
    : null;
  const invoiceValue = form.invoiceFileUrl
    ? { url: form.invoiceFileUrl, fileName: form.invoiceFileName || "invoice", size: form.invoiceSize }
    : null;

  // Section "Rapikan UI Identitas Aset Otomatis" — QrLabelModal ditampilkan
  // dengan data TERKINI dari form (bukan cuma `asset` snapshot awal), supaya
  // kalau user baru saja mengubah field pembentuk kode (belum disimpan),
  // preview QR/labelnya konsisten dengan Kode Aset yang tampil di card. QR
  // value-nya sendiri tetap dari getAssetQrTarget(asset) di dalam modal —
  // tidak ada logic QR baru di sini.
  const qrModalAsset = { ...asset, ...form } as Asset;

  const handleCopyCode = async () => {
    if (!form.assetCode) return;
    try {
      await navigator.clipboard.writeText(form.assetCode);
      setCodeCopied(true);
      setToast({ type: "success", message: "Kode aset berhasil disalin" });
      setTimeout(() => setCodeCopied(false), 1500);
    } catch {
      // clipboard tidak tersedia — abaikan diam-diam
    }
  };

  return (
    <ProtectedLayout>
      <div className="mx-auto max-w-[1440px]">
        <PageHeader
          title={`Edit Aset — ${asset.assetCode}`}
          subtitle={asset.assetName}
        />
        <form onSubmit={handleSubmit}>
          <div className="grid grid-cols-12 gap-6">
            <div className="col-span-12 xl:col-span-8 2xl:col-span-9 space-y-5">
              {/* Section "Finance edit lengkap" — Informasi Aset & Informasi
                  Inventaris SEKARANG full-enabled untuk Finance juga (Nama
                  Aset/Kategori/Kode Aset/No. Aset/Qty/Merk/Model/Serial
                  Number/IMEI/Deskripsi/Foto — semua ada di daftar field yang
                  boleh diedit Finance). Company/Divisi/PIC/Mode Tracking/
                  Status Kepemilikan/Status Operasional Aset TETAP dikunci
                  per-field di bawah (bukan level fieldset lagi). */}
              <div className="space-y-5">
              {/* Section "Rombak Tambah/Edit Asset" — SATU section berisi
                  semua field pembentuk identitas+lokasi, supaya card
                  "Identitas Aset Otomatis" tepat di bawahnya langsung
                  merefleksikan hasilnya tanpa scroll jauh. */}
              <FormSection step={1} title="Identitas & Lokasi Asset">
                <Field label="Nama Aset" required error={fieldErrors.assetName}>
                  <input
                    id="field-assetName"
                    value={form.assetName || ""}
                    onChange={(e) => set("assetName", e.target.value)}
                    className={errCls(!!fieldErrors.assetName)}
                  />
                </Field>
                <Field label="Kategori" required error={fieldErrors.categoryId}>
                  <select
                    id="field-categoryId"
                    value={form.categoryId || ""}
                    onChange={(e) => set("categoryId", e.target.value)}
                    className={errCls(!!fieldErrors.categoryId)}
                  >
                    <option value="">Pilih kategori</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.categoryName}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Tanggal Perolehan" required error={fieldErrors.acquisitionDate}>
                  <input
                    id="field-acquisitionDate"
                    type="date"
                    value={form.purchaseDate || ""}
                    onChange={(e) => set("purchaseDate", e.target.value)}
                    className={errCls(!!fieldErrors.acquisitionDate)}
                  />
                </Field>
                <Field
                  label="Qty"
                  required
                  error={fieldErrors.quantity}
                  hint="Jumlah unit fisik yang diwakili SATU dokumen aset ini."
                >
                  <input
                    id="field-quantity"
                    type="number"
                    min={1}
                    value={form.quantity ?? 1}
                    onChange={(e) => set("quantity", Math.max(1, Number(e.target.value) || 1))}
                    className={errCls(!!fieldErrors.quantity)}
                  />
                </Field>

                <Field
                  label="Perusahaan/Brand Pemilik"
                  required
                  error={fieldErrors.companyOwnerId}
                  hint={
                    isFinanceOnlyRole
                      ? "Hanya Asset Admin/Super Admin yang dapat memindahkan aset ke perusahaan/brand lain."
                      : brands.length === 0
                      ? "Tidak ada data perusahaan/brand dari HRP."
                      : undefined
                  }
                >
                  <SearchableSelect
                    id="field-companyOwnerId"
                    items={brandItems}
                    value={form.companyOwnerId || ""}
                    onChange={handleCompanyChange}
                    placeholder="Pilih perusahaan/brand"
                    searchPlaceholder="Cari brand..."
                    emptyText="Tidak ada brand yang cocok."
                    disabled={isFinanceOnlyRole}
                    error={!!fieldErrors.companyOwnerId}
                  />
                </Field>
                <Field
                  label="Divisi Pengguna"
                  hint={
                    !form.companyOwnerId
                      ? "Pilih perusahaan/brand terlebih dahulu"
                      : loadingDivisions
                      ? "Memuat divisi..."
                      : divisions.length === 0
                      ? "Tidak ada data divisi untuk brand ini."
                      : undefined
                  }
                >
                  <select
                    value={form.divisionOwnerId || ""}
                    onChange={(e) => set("divisionOwnerId", e.target.value)}
                    disabled={!form.companyOwnerId || loadingDivisions || isFinanceOnlyRole}
                    className="input disabled:bg-slate-50 disabled:text-slate-400"
                  >
                    <option value="">Pilih divisi</option>
                    {divisions.map((d) => (
                      <option key={d.id} value={d.id}>
                        {d.name}
                      </option>
                    ))}
                  </select>
                </Field>

                <div className="sm:col-span-2" id="field-location">
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">
                    Lokasi Asset <span className="text-red-500">*</span>
                  </label>
                  {form.location && !form.buildingId && (
                    <p className="mb-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      Asset ini masih memakai lokasi lama. Pilih Lokasi Asset dari Master Lokasi
                      untuk sinkronisasi.
                    </p>
                  )}
                  {isLocationPicRole ? (
                    // Section 1/2/4 — lokasi aset TIDAK BISA diubah lewat
                    // Edit Aset oleh PIC Lokasi (locationId immutable di
                    // firestore.rules isLocationPicAssetUpdate) — tampilkan
                    // read-only, bukan picker yang bisa dipilih ulang.
                    <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
                      {asset.locationText || asset.location || "-"}
                      <p className="mt-1 text-xs text-slate-400">
                        Lokasi aset tidak dapat diubah dari sini. Hubungi Asset Admin/QHSE untuk memindahkan aset.
                      </p>
                    </div>
                  ) : (
                    <LocationCascadeFields
                      locations={scopedLocations}
                      value={locationSelection}
                      onChange={handleLocationSelectionChange}
                      errorLevel={locationErrorLevel}
                    />
                  )}
                  {fieldErrors.location && (
                    <p className="mt-1 text-xs text-red-600">{fieldErrors.location}</p>
                  )}
                  {form.location && !form.buildingId && (
                    <p className="mt-2 text-xs text-slate-500">
                      Lokasi Lama: <span className="text-slate-700">{form.location}</span>
                    </p>
                  )}
                </div>
              </FormSection>

              {/* Section "Urutan Form Create/Edit ikuti dependency" — No./
                  Kode Aset/QR TIDAK PERNAH diisi manual, jadi ditaruh di
                  sini (PERSIS setelah Perusahaan & Lokasi), bukan lagi di
                  Section 1. Beda dari Create: nilainya SELALU sudah ada
                  (aset ini sudah tersimpan) — yang bisa terjadi di sini
                  cuma banner konfirmasi kalau field pembentuk kode berubah. */}
              <div id="field-assetCode" className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100">
                  <h2 className="text-sm font-semibold text-slate-800">Identitas Aset Otomatis</h2>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    Dibuat Otomatis
                  </span>
                </div>
                <div className="flex flex-col divide-y divide-slate-100 sm:grid sm:grid-cols-[20%_55%_25%] sm:divide-y-0 sm:divide-x">
                  <div className="flex flex-col justify-center px-4 py-3">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">No. Aset</p>
                    <p className="mt-0.5 text-xl font-bold text-slate-900">
                      {typeof form.assetNumber === "number" ? form.assetNumber : "-"}
                    </p>
                  </div>
                  <div className="flex flex-col justify-center px-4 py-3 min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Kode Aset</p>
                    <div className="mt-0.5 flex items-center gap-2 min-w-0">
                      <p
                        className={`truncate font-mono text-sm font-semibold ${
                          fieldErrors.assetCode ? "text-red-600" : "text-slate-900"
                        }`}
                        title={form.assetCode}
                      >
                        {form.assetCode || "-"}
                      </p>
                      {form.assetCode && (
                        <button
                          type="button"
                          onClick={handleCopyCode}
                          title="Copy Kode Aset"
                          className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-slate-200 px-2 py-1 text-[11px] font-medium text-slate-500 hover:bg-slate-50"
                        >
                          {codeCopied ? (
                            <Check size={12} className="text-emerald-600" />
                          ) : (
                            <Copy size={12} />
                          )}
                          Copy
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 px-4 py-3">
                    {form.assetCode ? (
                      <>
                        <div className="shrink-0 rounded-lg border border-slate-200 bg-slate-50 p-1">
                          <QRCodeSVG
                            value={form.assetCode}
                            size={64}
                            level="H"
                            includeMargin
                            imageSettings={getQrImageSettings(64)}
                          />
                        </div>
                        <button
                          type="button"
                          onClick={() => setQrModalOpen(true)}
                          className="text-xs font-medium text-blue-600 hover:underline"
                        >
                          Lihat / Cetak QR
                        </button>
                      </>
                    ) : (
                      <p className="text-xs text-slate-400">-</p>
                    )}
                  </div>
                </div>
                {codeFormingChanged && (
                  <div className="mx-4 mb-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-800">
                    <p className="font-medium">
                      Anda mengubah {codeFormingChangedFields.join(", ")} — Kode Aset akan dibuat ULANG saat
                      disimpan.
                    </p>
                    <p className="mt-1 text-amber-700">
                      QR/histori yang sudah memakai kode lama ({asset.assetCode}) tetap tersimpan di Log
                      Aktivitas, tapi QR fisik yang sudah tercetak/ditempel tidak berubah otomatis.
                    </p>
                    <label className="mt-2 flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={codeChangeAcknowledged}
                        onChange={(e) => setCodeChangeAcknowledged(e.target.checked)}
                      />
                      Saya mengerti dan ingin melanjutkan perubahan Kode Aset.
                    </label>
                  </div>
                )}
                {fieldErrors.assetCode && (
                  <p className="px-4 pb-3 text-xs text-red-600">{fieldErrors.assetCode}</p>
                )}
              </div>
              </div>

              {qrModalOpen && (
                <QrLabelModal asset={qrModalAsset} open={qrModalOpen} onClose={() => setQrModalOpen(false)} />
              )}

              <FormSection step={2} title="Dokumentasi Asset">
                <Field label="Foto Aset" full>
                  <FileUploadField
                    kind="image"
                    uploadType="asset_photo"
                    accept={["jpg", "jpeg", "png", "webp"]}
                    maxSizeMB={5}
                    value={photoValue}
                    meta={{ assetCode: form.assetCode, assetName: form.assetName }}
                    onUploadStateChange={setPhotoUploading}
                    onUploaded={(result) => {
                      set("photoUrl", result.url);
                      set("photoThumbnailUrl", result.thumbnailUrl);
                      set("photoFileName", result.fileName);
                      set("photoDriveFileId", result.fileId);
                      set("photoMimeType", result.mimeType);
                      set("photoSize", result.size);
                      set("photoUploadedAt", result.uploadedAt);
                    }}
                    onRemove={() => {
                      set("photoUrl", "");
                      set("photoThumbnailUrl", "");
                      set("photoFileName", "");
                      set("photoDriveFileId", "");
                    }}
                    onError={(msg) => setToast({ type: "error", message: msg })}
                  />
                </Field>
                <Field label="Deskripsi" full>
                  <textarea
                    value={form.description || ""}
                    onChange={(e) => set("description", e.target.value)}
                    className="input"
                    rows={2}
                  />
                </Field>
                <Field label="Bukti Fisik Aset" full hint="Catatan verifikasi fisik, mis. tanggal ditemukan/dihapuskan.">
                  <input
                    value={form.physicalEvidence || ""}
                    onChange={(e) => set("physicalEvidence", e.target.value)}
                    className="input"
                  />
                </Field>
                {/* Section "Rombak Tambah/Edit Asset" — dipertegas BUKAN
                    No. Aset (yang dibuat otomatis di card di atas) — cuma
                    label lama/manual dari pencatatan sebelum sistem ini,
                    TIDAK PERNAH ikut membentuk No./Kode Aset/QR. */}
                <Field
                  label="Nomor Inventaris Lama"
                  full
                  hint="Nomor inventaris lama/label fisik sebelumnya jika asset sudah pernah tercatat. Kosongkan untuk asset baru."
                >
                  <input
                    value={form.inventoryNumber || ""}
                    onChange={(e) => set("inventoryNumber", e.target.value)}
                    className="input"
                  />
                </Field>
                {/* Keterangan/Foto Bukti Fisik — khusus data pelengkap hasil
                    Import Aset dari Excel, tidak ada equivalent-nya di
                    Create Asset (aset baru belum punya riwayat import). */}
                {!isLocationPicRole && (
                  <>
                    <Field label="Keterangan" full hint="Catatan inventaris (mis. dari data lama/import Excel).">
                      <input
                        value={form.inventoryNotes || ""}
                        onChange={(e) => set("inventoryNotes", e.target.value)}
                        className="input"
                      />
                    </Field>
                    <Field
                      label="Foto Bukti Fisik"
                      full
                      hint="Hasil ekstrak Excel (kalau ada) atau upload manual ke Google Drive. Hapus/tambah langsung tersimpan."
                    >
                      <PhysicalEvidenceManager
                        images={form.physicalEvidenceImages || []}
                        onChange={(urls) => set("physicalEvidenceImages", urls)}
                        assetCode={form.assetCode || asset.assetCode}
                        assetName={form.assetName || asset.assetName}
                        onError={(msg) => setToast({ type: "error", message: msg })}
                      />
                    </Field>
                  </>
                )}
              </FormSection>

              <FormSection step={3} title="Pengelolaan Asset">
                <Field
                  label="Mode Tracking Aset"
                  hint={TRACKING_MODE_OPTIONS.find((o) => o.value === trackingMode)?.hint}
                >
                  <select
                    value={trackingMode}
                    onChange={(e) => set("trackingMode", e.target.value as TrackingMode)}
                    disabled={isFinanceOnlyRole}
                    className="input disabled:bg-slate-50 disabled:text-slate-400"
                  >
                    {TRACKING_MODE_OPTIONS.map((o) => (
                      <option key={o.value} value={o.value}>
                        {TRACKING_MODE_LABEL[o.value]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field
                  label={trackingMode === "fixed_location" ? "PIC Lokasi" : "PIC / Custodian Aset"}
                  required={trackingMode === "assigned_pic"}
                  hint={
                    trackingMode === "fixed_location"
                      ? "Orang yang menjaga/mendata aset di lokasi ini (opsional)."
                      : "Orang yang bertanggung jawab utama atas aset ini."
                  }
                  error={fieldErrors.responsiblePersonUid}
                >
                  <SearchableSelect
                    items={employeeItems}
                    value={form.responsiblePersonUid || ""}
                    onChange={(v) => set("responsiblePersonUid", v)}
                    placeholder="Pilih karyawan"
                    searchPlaceholder="Cari nama karyawan..."
                    emptyText="Tidak ada karyawan yang cocok."
                    disabled={isFinanceOnlyRole}
                  />
                </Field>
                {trackingMode === "assigned_pic" && (
                  <p className="sm:col-span-2 text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-xl px-3 py-2">
                    Karena aset ini punya PIC Operasional, PIC akan otomatis menjadi pemegang utama
                    aset.
                  </p>
                )}
                {trackingMode === "fixed_location" && (
                  <p className="sm:col-span-2 text-xs text-slate-600 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
                    Aset tetap lokasi tidak masuk sistem pinjam/PIC operasional — fokus ke lokasi dan
                    maintenance.
                  </p>
                )}
                <Field
                  label="Status Kepemilikan"
                  required
                  full
                  error={fieldErrors.ownershipStatus}
                >
                  <select
                    value={form.ownershipStatus || "Aset Perusahaan"}
                    onChange={(e) =>
                      set("ownershipStatus", e.target.value as OwnershipStatus)
                    }
                    disabled={isFinanceOnlyRole}
                    className="input disabled:bg-slate-50 disabled:text-slate-400"
                  >
                    {OWNERSHIP_OPTIONS.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                </Field>
              </FormSection>

              {canViewFinanceEdit && (
              <FormSection step={4} title="Finance / Bukti Pembelian">
                <Field label="Harga Perolehan">
                  <CurrencyInput
                    value={form.purchasePrice ?? undefined}
                    onChange={(v) => set("purchasePrice", v as number)}
                  />
                </Field>
                <Field label="Status Invoice">
                  <select
                    value={form.invoiceStatus || ""}
                    onChange={(e) => {
                      const next = e.target.value as InvoiceStatus | "";
                      // Nomor/Bukti Invoice cuma relevan saat "Ada Invoice" —
                      // pindah ke status lain mengosongkan state form ini
                      // (relasi ke file Drive existing baru benar-benar
                      // hilang dari data asset SETELAH user klik Simpan;
                      // file di Drive sendiri tidak pernah dihapus di sini).
                      setForm((f) =>
                        f
                          ? {
                              ...f,
                              invoiceStatus: next || undefined,
                              ...(next !== "ada"
                                ? {
                                    invoiceNumber: "",
                                    invoiceFileUrl: "",
                                    invoiceFileName: "",
                                    invoiceDriveFileId: "",
                                    invoiceMimeType: "",
                                    invoiceSize: undefined,
                                    invoiceUploadedAt: undefined,
                                  }
                                : {}),
                            }
                          : f
                      );
                    }}
                    className="input"
                  >
                    <option value="">Belum diisi</option>
                    {(Object.keys(INVOICE_STATUS_LABEL) as InvoiceStatus[]).map((s) => (
                      <option key={s} value={s}>
                        {INVOICE_STATUS_LABEL[s]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Vendor">
                  <input
                    value={form.vendorName || ""}
                    onChange={(e) => set("vendorName", e.target.value)}
                    className="input"
                  />
                </Field>
                {form.invoiceStatus === "ada" && (
                  <>
                    <Field label="Nomor Invoice">
                      <input
                        value={form.invoiceNumber || ""}
                        onChange={(e) => set("invoiceNumber", e.target.value)}
                        className="input"
                      />
                    </Field>
                    <Field label="Upload Invoice" full>
                      <FileUploadField
                        kind="file"
                        uploadType="invoice"
                        accept={["pdf", "jpg", "jpeg", "png"]}
                        maxSizeMB={10}
                        value={invoiceValue}
                        meta={{ assetCode: form.assetCode, assetName: form.assetName }}
                        onUploadStateChange={setInvoiceUploading}
                        onUploaded={(result) => {
                          set("invoiceFileUrl", result.url);
                          set("invoiceFileName", result.fileName);
                          set("invoiceDriveFileId", result.fileId);
                          set("invoiceMimeType", result.mimeType);
                          set("invoiceSize", result.size);
                          set("invoiceUploadedAt", result.uploadedAt);
                        }}
                        onRemove={() => {
                          set("invoiceFileUrl", "");
                          set("invoiceFileName", "");
                          set("invoiceDriveFileId", "");
                        }}
                        onError={(msg) => setToast({ type: "error", message: msg })}
                      />
                    </Field>
                  </>
                )}
                <Field label="Sumber Dana">
                  <select
                    value={form.fundingSource || "Kas Perusahaan"}
                    onChange={(e) =>
                      set("fundingSource", e.target.value as FundingSource)
                    }
                    className="input"
                  >
                    {FUNDING_OPTIONS.map((f) => (
                      <option key={f} value={f}>
                        {f}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Metode Pembelian">
                  <input
                    value={form.purchaseMethod || ""}
                    onChange={(e) => set("purchaseMethod", e.target.value)}
                    className="input"
                  />
                </Field>
                <Field label="Estimasi Umur Aset" hint="mis. 3 tahun">
                  <input
                    value={form.estimatedUsefulLife || ""}
                    onChange={(e) => set("estimatedUsefulLife", e.target.value)}
                    className="input"
                  />
                </Field>
                <Field label="Catatan Finance" full>
                  <textarea
                    value={form.financeNotes || ""}
                    onChange={(e) => set("financeNotes", e.target.value)}
                    className="input"
                    rows={2}
                  />
                </Field>
              </FormSection>
              )}

              {/* Section "Finance edit lengkap" — Kondisi Aset full-enabled
                  untuk Finance (ada di daftar field yang boleh diedit).
                  Status Operasional Aset (disposal-adjacent: available/
                  lost/disposed/dst) TETAP dikunci per-field — ticket minta
                  "hapus/disposal asset" tetap ikut permission existing. */}
              <FormSection
                step={5}
                title="Kondisi & Status Aset"
                description="Kondisi fisik dan status operasional barang — TERPISAH dari status pemakaian (Dipinjam/Tersedia diatur otomatis lewat proses pinjam/kembali)."
              >
                <Field
                  label="Status Operasional Aset"
                  required
                  error={fieldErrors.assetStatus}
                  hint={
                    isFinanceOnlyRole
                      ? "Hanya Asset Admin/Super Admin yang dapat mengubah status operasional (mis. disposal)."
                      : form.assetStatus
                      ? ASSET_STATUS_HELPER[form.assetStatus]
                      : undefined
                  }
                >
                  <select
                    value={form.assetStatus || "available"}
                    onChange={(e) => set("assetStatus", e.target.value as AssetStatus)}
                    disabled={isFinanceOnlyRole}
                    className="input disabled:bg-slate-50 disabled:text-slate-400"
                  >
                    {(ASSET_STATUS_OPTIONS.includes(form.assetStatus as AssetStatus) || !form.assetStatus
                      ? ASSET_STATUS_OPTIONS
                      : [form.assetStatus as AssetStatus, ...ASSET_STATUS_OPTIONS]
                    ).map((s) => (
                      <option key={s} value={s}>
                        {ASSET_STATUS_LABEL[s]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Kondisi Aset" required error={fieldErrors.condition}>
                  <select
                    id="field-condition"
                    value={form.condition || "good"}
                    onChange={(e) => set("condition", e.target.value as AssetCondition)}
                    className={errCls(!!fieldErrors.condition)}
                  >
                    {CONDITION_OPTIONS.map((c) => (
                      <option key={c} value={c}>
                        {CONDITION_LABEL[c]}
                      </option>
                    ))}
                  </select>
                </Field>
              </FormSection>

              {/* Pengaturan Pemakaian Aset (Bisa Dipinjam/Approval/Aksesoris/
                  Catatan Operasional) TIDAK ada di daftar field yang diminta
                  ticket untuk Finance — tetap dikunci lewat fieldset. */}
              <fieldset disabled={isFinanceOnlyRole} className="space-y-5 disabled:opacity-60">
              <FormSection step={6} title="Pengaturan Pemakaian Aset">
                <div className="md:col-span-2 grid md:grid-cols-2 gap-4">
                  <Toggle
                    checked={!!form.isBorrowable}
                    onChange={(v) => set("isBorrowable", v)}
                    label="Bisa Dipinjam"
                    helper="Jika aktif, staff dapat meminjam asset melalui scan QR."
                  />
                  <Toggle
                    checked={!!form.requiresApproval}
                    onChange={(v) => set("requiresApproval", v)}
                    label="Butuh Approval"
                    helper="Jika aktif, peminjaman perlu persetujuan Asset Admin."
                  />
                </div>
                <Field label="Aksesoris" full>
                  <input
                    value={form.accessories || ""}
                    onChange={(e) => set("accessories", e.target.value)}
                    className="input"
                  />
                </Field>
                <Field label="Catatan Operasional" full>
                  <textarea
                    value={form.operationalNotes || ""}
                    onChange={(e) => set("operationalNotes", e.target.value)}
                    className="input"
                    rows={2}
                  />
                </Field>
              </FormSection>

              {error && (
                <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">
                  {error}
                </p>
              )}
              </fieldset>
            </div>

            <aside className="col-span-12 xl:col-span-4 2xl:col-span-3 space-y-5 xl:sticky xl:top-24 self-start">
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                <h2 className="font-semibold text-slate-800 mb-4">Ringkasan Aset</h2>
                <dl className="space-y-3 text-sm">
                  <div>
                    <dt className="text-xs text-slate-400">Nama Aset</dt>
                    <dd className="font-medium text-slate-800">{form.assetName || "-"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-400">No. Aset</dt>
                    <dd className="font-medium text-slate-800">
                      {typeof form.assetNumber === "number" ? form.assetNumber : "-"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-400">Kode Aset</dt>
                    <dd className="font-medium text-slate-800 break-all">{form.assetCode || "-"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-400">Kategori</dt>
                    <dd className="font-medium text-slate-800">
                      {category?.categoryName || form.categoryName || "-"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-400">Perusahaan</dt>
                    <dd className="font-medium text-slate-800">
                      {companyOwner?.name || form.companyOwnerName || "-"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-400">Lokasi</dt>
                    <dd className="font-medium text-slate-800">
                      {[form.buildingName, form.floor, form.roomName].filter(Boolean).join(" / ") || "-"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-400">Status Asset</dt>
                    <dd className="font-medium text-slate-800">
                      {form.assetStatus ? ASSET_STATUS_LABEL[form.assetStatus] : "-"}
                    </dd>
                  </div>
                </dl>
              </div>
            </aside>
          </div>

          <div className="sticky bottom-0 -mx-4 md:-mx-6 mt-5 bg-white/95 backdrop-blur-sm border-t border-slate-200 px-4 md:px-6 py-3 flex justify-end gap-2 z-10">
            <button
              type="button"
              onClick={() => router.back()}
              className="rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
            >
              Batal
            </button>
            <button
              type="submit"
              disabled={saving || photoUploading || invoiceUploading}
              className="rounded-xl bg-gradient-to-r from-blue-600 to-teal-500 text-white px-6 py-2.5 text-sm font-semibold hover:brightness-105 disabled:opacity-60 shadow-md shadow-blue-900/20"
            >
              {saving
                ? "Menyimpan..."
                : photoUploading || invoiceUploading
                ? "Mengupload foto..."
                : "Simpan Perubahan"}
            </button>
          </div>
        </form>
      </div>

      <AssetFieldErrorModal
        open={errorModalOpen}
        errors={fieldErrors}
        fieldOrder={REQUIRED_FIELD_ORDER}
        onClose={() => setErrorModalOpen(false)}
      />
      <Toast toast={toast} onClose={() => setToast(null)} />
    </ProtectedLayout>
  );
}
