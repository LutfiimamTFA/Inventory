"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { addDoc, collection, onSnapshot, serverTimestamp } from "firebase/firestore";
import { QRCodeSVG } from "qrcode.react";
import { Wand2, Pencil } from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import {
  AssetCategory,
  AssetLocationNode,
  AssetStatus,
  AssetCondition,
  AssetUsageType,
  TrackingMode,
  DriveUploadResult,
  FundingSource,
  HrpBrand,
  HrpDivision,
  OwnershipStatus,
} from "@/lib/types";
import { fetchHrpBrands, fetchHrpDivisions } from "@/lib/hrp";
import {
  EmployeeOption,
  fetchActiveEmployeeOptions,
  fetchActiveUsersByRoles,
  generateAssetCode,
  isAssetCodeTaken,
  writeAssetLog,
} from "@/lib/firestore-helpers";
import { createAssetNotification } from "@/lib/notifications";
import { buildFullPath, getDescendantIds, resolveAreaPic, resolveLocationSelectionForNode } from "@/lib/locations";
import {
  ASSET_STATUS_HELPER,
  ASSET_STATUS_LABEL,
  ASSET_USAGE_TYPE_LABEL,
  TRACKING_MODE_LABEL,
  CONDITION_LABEL,
  getQrImageSettings,
} from "@/lib/utils";
import ProtectedLayout from "@/components/ProtectedLayout";
import PageHeader from "@/components/PageHeader";
import { FormSection, Field } from "@/components/FormSection";
import Toggle from "@/components/Toggle";
import CurrencyInput from "@/components/CurrencyInput";
import SearchableSelect, { SearchableSelectItem } from "@/components/SearchableSelect";
import LocationCascadeFields, {
  EMPTY_LOCATION_SELECTION,
  LocationSelection,
} from "@/components/LocationCascadeFields";
import PicLocationField from "@/components/PicLocationField";
import FileUploadField from "@/components/FileUploadField";
import { Toast, ToastState } from "@/components/Toast";

// Section A/B — mode tracking aset. Menggantikan "Tipe Pemakaian Aset" di
// form sebagai field utama; usageType lama tetap diturunkan darinya supaya
// kode/tampilan lain yang masih baca usageType tidak perlu diubah semua.
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

// Section G — "borrowed"/"in_use" SENGAJA tidak masuk pilihan di form
// tambah/edit aset. Dua nilai itu status PEMAKAIAN, bukan kondisi/siklus-
// hidup barang, dan HARUS otomatis dari proses pinjam/kembali atau
// assignCustodian — bukan dipilih manual saat membuat/mengedit data aset.
const ASSET_STATUS_OPTIONS: AssetStatus[] = [
  "available",
  "maintenance",
  "broken",
  "incomplete",
  "lost",
  "inactive",
  "disposed",
];

const CONDITION_OPTIONS: AssetCondition[] = [
  "new",
  "good",
  "fair",
  "minor_damage",
  "heavy_damage",
];

export default function NewAssetPage() {
  const { firebaseUser, assetUser, role, loading, isLocationPicRole: isPicViaLocations } = useAuth();
  const authReady = !loading && !!firebaseUser && !!assetUser && !!role;
  const router = useRouter();

  // Section A/H — Asset Finance TIDAK boleh membuat aset baru (bukan bagian
  // dari kewenangannya), hanya boleh mengedit data finance aset yang sudah
  // ada. NAV_ITEMS mengizinkan "/assets" secara umum, jadi guard tambahan di
  // sini mencegah akses langsung lewat URL /assets/new.
  useEffect(() => {
    if (authReady && role === "asset_finance") {
      router.replace("/assets");
    }
  }, [authReady, role, router]);

  // Section B — Asset Admin/QHSE TIDAK boleh melihat/mengisi section Finance
  // sama sekali di Create Asset (harga dilengkapi belakangan oleh Asset
  // Finance). Asset Finance sendiri sudah di-redirect keluar dari halaman
  // ini di atas, jadi hanya Super Admin yang tersisa untuk melihat section
  // ini kalau memang mau isi harga saat create.
  const canViewFinanceCreate = role === "super_admin";
  const [categories, setCategories] = useState<AssetCategory[]>([]);
  const [employeeOptions, setEmployeeOptions] = useState<EmployeeOption[]>([]);
  const [brands, setBrands] = useState<HrpBrand[]>([]);
  const [divisions, setDivisions] = useState<HrpDivision[]>([]);
  const [loadingDivisions, setLoadingDivisions] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [toast, setToast] = useState<ToastState | null>(null);

  // A. Informasi Aset
  const [assetName, setAssetName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [subCategory, setSubCategory] = useState("");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [imei, setImei] = useState("");
  const [description, setDescription] = useState("");
  const [photo, setPhoto] = useState<DriveUploadResult | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);

  const [autoCode, setAutoCode] = useState(true);
  const [assetCode, setAssetCode] = useState("");
  const [generatingCode, setGeneratingCode] = useState(false);

  // B. Kepemilikan & Lokasi
  const [companyOwnerId, setCompanyOwnerId] = useState("");
  const [divisionOwnerId, setDivisionOwnerId] = useState("");
  const [locations, setLocations] = useState<AssetLocationNode[]>([]);
  const [locationSelection, setLocationSelection] = useState<LocationSelection>(
    EMPTY_LOCATION_SELECTION
  );
  const [responsiblePersonUid, setResponsiblePersonUid] = useState("");
  const [ownershipStatus, setOwnershipStatus] =
    useState<OwnershipStatus>("Aset Perusahaan");
  const [trackingMode, setTrackingMode] = useState<TrackingMode>("shared_borrowable");
  // usageType (skema lama) diturunkan dari trackingMode — SATU sumber data,
  // supaya tidak ada dua state yang bisa saling desync.
  const usageType: AssetUsageType = trackingMode === "assigned_pic" ? "assigned_daily" : "shared_pool";

  // C. Finance
  const [purchaseDate, setPurchaseDate] = useState("");
  const [purchasePrice, setPurchasePrice] = useState<number | undefined>(undefined);
  const [vendorName, setVendorName] = useState("");
  const [invoiceNumber, setInvoiceNumber] = useState("");
  const [invoice, setInvoice] = useState<DriveUploadResult | null>(null);
  const [invoiceUploading, setInvoiceUploading] = useState(false);
  const [fundingSource, setFundingSource] =
    useState<FundingSource>("Kas Perusahaan");
  const [purchaseMethod, setPurchaseMethod] = useState("");
  const [estimatedUsefulLife, setEstimatedUsefulLife] = useState("");
  const [financeNotes, setFinanceNotes] = useState("");

  // D. Tracking & QR
  const [assetStatus, setAssetStatus] = useState<AssetStatus>("available");
  const [condition, setCondition] = useState<AssetCondition>("good");
  const [isBorrowable, setIsBorrowable] = useState(true);
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [accessories, setAccessories] = useState("");
  const [operationalNotes, setOperationalNotes] = useState("");

  // Section E — PIC Lokasi hanya boleh membuat aset di lokasi yang dia
  // pegang: LocationCascadeFields cuma diberi node-node dalam scope-nya
  // (dirinya + leluhur untuk konteks cascade + seluruh turunannya), jadi
  // secara struktural tidak mungkin memilih lokasi lain.
  // Berlaku juga untuk staff yang ditunjuk PIC di Master Lokasi
  // (isPicViaLocations dari auth-context), bukan cuma role "location_pic".
  const isLocationPicRole = role === "location_pic" || isPicViaLocations;
  // Lokasi-lokasi yang JADI TANGGUNG JAWAB user ini secara langsung (bukan
  // turunannya) — dipakai PicLocationField untuk "Pilih Lokasi Tanggung
  // Jawab" kalau lebih dari satu, atau auto-select kalau cuma satu.
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

  // Section F — kalau PIC cuma pegang 1 lokasi, langsung auto-select tanpa
  // perlu user memilih apa pun.
  useEffect(() => {
    if (isLocationPicRole && myPicLocations.length === 1 && !selectedPicLocationId) {
      queueMicrotask(() => setSelectedPicLocationId(myPicLocations[0].id));
    }
  }, [isLocationPicRole, myPicLocations, selectedPicLocationId]);

  // Section F/G — locationSelection (dipakai validasi & payload save) SELALU
  // diturunkan dari selectedPicLocationId untuk PIC Lokasi, supaya struktur
  // datanya identik dengan hasil dropdown cascade biasa.
  useEffect(() => {
    if (!isLocationPicRole) return;
    queueMicrotask(() => {
      if (!selectedPicLocationId) {
        setLocationSelection(EMPTY_LOCATION_SELECTION);
        return;
      }
      setLocationSelection(resolveLocationSelectionForNode(locations, selectedPicLocationId));
    });
  }, [isLocationPicRole, selectedPicLocationId, locations]);

  const category = useMemo(
    () => categories.find((c) => c.id === categoryId),
    [categories, categoryId]
  );
  const companyOwner = useMemo(
    () => brands.find((b) => b.id === companyOwnerId),
    [brands, companyOwnerId]
  );
  const divisionOwner = useMemo(
    () => divisions.find((d) => d.id === divisionOwnerId),
    [divisions, divisionOwnerId]
  );
  const responsiblePerson = useMemo(
    () => employeeOptions.find((e) => e.uid === responsiblePersonUid),
    [employeeOptions, responsiblePersonUid]
  );

  useEffect(() => {
    if (!authReady) return;
    const unsub = onSnapshot(
      collection(db, "asset_categories"),
      (snap) => {
        console.log("[NewAssetPage Listener] asset_categories success:", snap.size);
        setCategories(
          snap.docs
            .map((d) => ({ id: d.id, ...d.data() } as AssetCategory))
            .filter((c) => c.status === "active")
        );
      },
      (error) => {
        console.error("[NewAssetPage Listener] asset_categories error:", error);
      }
    );
    return () => unsub();
  }, [authReady]);

  useEffect(() => {
    if (!authReady) return;
    const unsub = onSnapshot(
      collection(db, "asset_locations"),
      (snap) => {
        console.log("[NewAssetPage Listener] asset_locations success:", snap.size);
        setLocations(
          snap.docs
            .map((d) => ({ id: d.id, ...d.data() } as AssetLocationNode))
            .filter((n) => n.status === "active")
        );
      },
      (error) => {
        console.error("[NewAssetPage Listener] asset_locations error:", error);
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
      .catch((err) => console.error("[NewAssetPage] gagal memuat daftar karyawan aktif", err));
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
    if (!companyOwnerId) return;
    let cancelled = false;
    fetchHrpDivisions(companyOwnerId)
      .then((list) => {
        if (!cancelled) setDivisions(list);
      })
      .finally(() => {
        if (!cancelled) setLoadingDivisions(false);
      });
    return () => {
      cancelled = true;
    };
  }, [authReady, companyOwnerId]);

  const handleCompanyChange = (value: string) => {
    setCompanyOwnerId(value);
    setDivisionOwnerId("");
    setDivisions([]);
    setLoadingDivisions(!!value);
  };

  // Auto-generate kode asset saat kategori berubah (jika mode auto aktif).
  useEffect(() => {
    if (!autoCode || !category) return;
    let cancelled = false;
    generateAssetCode(category.categoryCode)
      .then((code) => {
        if (!cancelled) setAssetCode(code);
      })
      .finally(() => {
        if (!cancelled) setGeneratingCode(false);
      });
    return () => {
      cancelled = true;
    };
  }, [autoCode, category]);

  const handleCategoryChange = (value: string) => {
    setCategoryId(value);
    if (autoCode) setGeneratingCode(true);
  };

  const handleToggleAutoCode = () => {
    const next = !autoCode;
    setAutoCode(next);
    if (next && category) setGeneratingCode(true);
  };

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

    if (photoUploading || invoiceUploading) {
      setError("Tunggu proses upload file selesai sebelum menyimpan.");
      return;
    }

    const errors: Record<string, string> = {};
    if (!assetName.trim()) errors.assetName = "Nama aset wajib diisi.";
    if (!assetCode.trim()) errors.assetCode = "Kode aset wajib diisi.";
    if (!categoryId) errors.categoryId = "Kategori wajib dipilih.";
    if (!brand.trim()) errors.brand = "Merk wajib diisi.";
    if (!model.trim()) errors.model = "Model/Tipe wajib diisi.";
    if (!companyOwnerId) errors.companyOwnerId = "Perusahaan/Brand wajib dipilih.";
    // PIC Lokasi bisa ditugaskan di level Gedung/Lantai/Area juga (bukan
    // wajib sampai Ruangan) — cukup pastikan dia sudah memilih salah satu
    // lokasi tanggung jawabnya.
    if (isLocationPicRole) {
      if (!selectedPicLocationId) errors.location = "Lokasi tanggung jawab wajib dipilih.";
    } else if (!locationSelection.buildingId) {
      errors.location = "Gedung wajib dipilih.";
    } else if (!locationSelection.floorId) {
      errors.location = "Lantai wajib dipilih.";
    } else if (!locationSelection.roomId) {
      errors.location = "Ruangan wajib dipilih.";
    }
    if (!ownershipStatus) errors.ownershipStatus = "Status kepemilikan wajib dipilih.";
    if (trackingMode === "assigned_pic" && !responsiblePersonUid)
      errors.responsiblePersonUid = "PIC Operasional wajib dipilih untuk aset dengan PIC.";
    if (!assetStatus) errors.assetStatus = "Status aset wajib dipilih.";
    if (!condition) errors.condition = "Kondisi aset wajib dipilih.";

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setError("Lengkapi field yang wajib diisi.");
      return;
    }

    console.debug("[Asset Photo] state before submit:", {
      photoUrl: photo?.url,
      photoThumbnailUrl: photo?.thumbnailUrl,
      photoDriveFileId: photo?.fileId,
      photoFileName: photo?.fileName,
    });

    setSaving(true);
    setError("");
    setFieldErrors({});
    try {
      const codeTaken = await isAssetCodeTaken(assetCode.trim());
      if (codeTaken) {
        setFieldErrors({ assetCode: "Kode asset sudah digunakan." });
        setError("Kode asset sudah digunakan.");
        setSaving(false);
        return;
      }

      const photoFields = {
        photoUrl: photo?.url || null,
        photoThumbnailUrl: photo?.thumbnailUrl || null,
        photoFileName: photo?.fileName || null,
        photoDriveFileId: photo?.fileId || null,
        photoMimeType: photo?.mimeType || null,
        photoSize: photo?.size ?? null,
        photoUploadedAt: photo?.uploadedAt || null,
      };
      console.debug("[Asset Save] payload photo fields:", photoFields);

      const assetLocationText = buildFullPath({
        buildingName: locationSelection.buildingName,
        floorName: locationSelection.floorName,
        roomName: locationSelection.roomName,
        areaName: locationSelection.areaName,
      });

      // Section D — PIC Lokasi diisi OTOMATIS dari asset_locations (cascade
      // Area > Ruangan > Lantai > Gedung), BUKAN dipilih manual di form.
      const areaPic = resolveAreaPic(locations, {
        buildingId: locationSelection.buildingId,
        floorId: locationSelection.floorId,
        roomId: locationSelection.roomId,
        areaId: locationSelection.areaId,
      });

      const docRef = await addDoc(collection(db, "assets"), {
        assetName: assetName.trim(),
        assetCode: assetCode.trim(),
        categoryId,
        categoryName: category?.categoryName || "",
        subCategory: subCategory.trim(),
        brand: brand.trim(),
        model: model.trim(),
        serialNumber: serialNumber.trim(),
        imei: imei.trim(),
        description: description.trim(),
        ...photoFields,

        companyOwnerId,
        companyOwnerName: companyOwner?.name || "",
        divisionOwnerId: divisionOwnerId || null,
        divisionOwnerName: divisionOwner?.name || "",
        location: assetLocationText,
        buildingId: locationSelection.buildingId || null,
        buildingName: locationSelection.buildingName || "",
        floorId: locationSelection.floorId || null,
        floor: locationSelection.floorName || "",
        roomId: locationSelection.roomId || null,
        roomName: locationSelection.roomName || "",
        areaId: locationSelection.areaId || null,
        areaName: locationSelection.areaName || "",
        locationId:
          locationSelection.areaId ||
          locationSelection.roomId ||
          locationSelection.floorId ||
          locationSelection.buildingId ||
          null,
        locationText: assetLocationText,
        areaPicUid: areaPic?.uid || null,
        areaPicName: areaPic?.name || null,
        areaPicEmail: areaPic?.email || null,
        areaPicLocationId: areaPic?.locationId || null,
        areaPicLocationName: areaPic?.locationName || null,
        // Section G — metadata tambahan saat asset dibuat oleh PIC Lokasi
        // (role "location_pic" ATAU staff yang ditunjuk PIC di Master
        // Lokasi), dipakai firestore.rules (isLocationPicCreateAsset) untuk
        // memverifikasi pembuatnya memang PIC lokasi yang bersangkutan.
        ...(isLocationPicRole
          ? {
              createdFromLocationPic: true,
              createdByUid: firebaseUser?.uid || "",
              createdByName: assetUser?.name || firebaseUser?.email || "",
              createdByRole: "location_pic",
              locationPicUid: firebaseUser?.uid || "",
              locationPicName: assetUser?.name || firebaseUser?.email || "",
              locationPicEmail: firebaseUser?.email || "",
              allowedLocationPicUids: firebaseUser?.uid ? [firebaseUser.uid] : [],
            }
          : {}),
        responsiblePersonUid: responsiblePersonUid || null,
        responsiblePersonName: responsiblePerson?.name || "",
        responsiblePersonEmail: responsiblePerson?.email || "",
        responsiblePersonDivision: responsiblePerson?.divisionName || "",
        responsiblePersonJobTitle: responsiblePerson?.roleLabel || "",
        ownershipStatus,

        // ── Mode tracking, tipe pemakaian & custodian ─────────────────────
        // "PIC/Custodian" pakai picker yang sama dengan responsiblePerson di
        // atas — custodian* cuma alias semantik dari data karyawan yang sama.
        // Aset "fixed_location" TIDAK masuk sistem custodian/currentHolder
        // sama sekali (section B) — hanya PIC Lokasi opsional di
        // responsiblePerson*.
        trackingMode,
        trackingModeLabel: TRACKING_MODE_LABEL[trackingMode],
        usageType: trackingMode === "fixed_location" ? null : usageType,
        usageTypeLabel: trackingMode === "fixed_location" ? null : ASSET_USAGE_TYPE_LABEL[usageType],
        custodianUid: trackingMode === "fixed_location" ? null : responsiblePersonUid || null,
        custodianName: trackingMode === "fixed_location" ? null : responsiblePerson?.name || null,
        custodianEmail: trackingMode === "fixed_location" ? null : responsiblePerson?.email || null,
        custodianDivision: trackingMode === "fixed_location" ? null : responsiblePerson?.divisionName || null,
        custodianRole: trackingMode === "fixed_location" ? null : responsiblePerson?.roleLabel || null,
        currentHolderUid: trackingMode === "assigned_pic" ? responsiblePersonUid || null : null,
        currentHolderName: trackingMode === "assigned_pic" ? responsiblePerson?.name || null : null,
        currentHolderEmail: trackingMode === "assigned_pic" ? responsiblePerson?.email || null : null,
        currentHolderDivision:
          trackingMode === "assigned_pic" ? responsiblePerson?.divisionName || null : null,
        currentUsageStatus:
          trackingMode === "fixed_location"
            ? "fixed_at_location"
            : trackingMode === "assigned_pic"
            ? "with_custodian"
            : "available",
        currentUsageStatusLabel:
          trackingMode === "fixed_location"
            ? "Tetap di Lokasi"
            : trackingMode === "assigned_pic"
            ? "Bersama Custodian"
            : "Tersedia",
        currentUsageStartedAt: trackingMode === "assigned_pic" ? serverTimestamp() : null,
        // Alias legacy — tampilan/laporan lama yang masih baca pic* tetap
        // konsisten dengan custodian baru. Untuk fixed_location, dipakai
        // sebagai "PIC Lokasi".
        picUid: responsiblePersonUid || null,
        picName: responsiblePerson?.name || null,
        picEmail: responsiblePerson?.email || null,

        // Section B/G — Asset Admin/QHSE boleh create aset TANPA data
        // finance sama sekali; field finance disimpan default kosong +
        // financeStatus "pending_finance" supaya Asset Finance tahu aset ini
        // masih perlu dilengkapi. Cuma Super Admin yang bisa langsung isi
        // harga saat create (section Finance-nya juga cuma tampil untuknya).
        purchaseDate: canViewFinanceCreate ? purchaseDate || null : null,
        purchasePrice: canViewFinanceCreate ? purchasePrice ?? null : null,
        vendorName: canViewFinanceCreate ? vendorName.trim() : "",
        invoiceNumber: canViewFinanceCreate ? invoiceNumber.trim() : "",
        invoiceFileUrl: canViewFinanceCreate ? invoice?.url || "" : "",
        invoiceFileName: canViewFinanceCreate ? invoice?.fileName || "" : "",
        invoiceDriveFileId: canViewFinanceCreate ? invoice?.fileId || "" : "",
        invoiceMimeType: canViewFinanceCreate ? invoice?.mimeType || "" : "",
        invoiceSize: canViewFinanceCreate ? invoice?.size ?? null : null,
        invoiceUploadedAt: canViewFinanceCreate ? invoice?.uploadedAt || null : null,
        fundingSource: canViewFinanceCreate ? fundingSource : "",
        purchaseMethod: canViewFinanceCreate ? purchaseMethod.trim() : "",
        estimatedUsefulLife: canViewFinanceCreate ? estimatedUsefulLife.trim() : "",
        financeNotes: canViewFinanceCreate ? financeNotes.trim() : "",
        financeStatus:
          canViewFinanceCreate && purchasePrice && invoiceNumber.trim() ? "complete" : "pending_finance",

        assetStatus,
        condition,
        isBorrowable,
        requiresApproval,
        accessories: accessories.trim(),
        operationalNotes: operationalNotes.trim(),
        qrCodeValue: assetCode.trim(),

        currentBorrowingId: null,
        currentBorrowerUid: null,
        currentBorrowerName: null,

        createdByUid: assetUser?.uid,
        createdByName: assetUser?.name,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      await writeAssetLog({
        assetId: docRef.id,
        assetName: assetName.trim(),
        assetCode: assetCode.trim(),
        action: "create",
        userUid: assetUser?.uid || "",
        userName: assetUser?.name || "",
        detail: "Aset dibuat",
      });

      const notifyRecipients = (await fetchActiveUsersByRoles(["asset_admin", "super_admin"])).filter(
        (u) => u.uid !== assetUser?.uid
      );
      await Promise.all(
        notifyRecipients.map((recipient) =>
          createAssetNotification({
            recipientUid: recipient.uid,
            recipientName: recipient.name,
            recipientRole: recipient.role,
            title: "Asset Baru Ditambahkan",
            message: `${assetName.trim()} (${assetCode.trim()}) ditambahkan oleh ${assetUser?.name || "seseorang"}.`,
            type: "asset_created",
            priority: "low",
            linkUrl: `/assets/${docRef.id}`,
            relatedType: "asset",
            relatedId: docRef.id,
            relatedNumber: assetCode.trim(),
            createdByUid: assetUser?.uid,
            createdByName: assetUser?.name,
          })
        )
      );

      setToast({ type: "success", message: "Asset berhasil ditambahkan." });
      router.push(`/assets/${docRef.id}`);
    } catch (err) {
      console.error(err);
      setError("Gagal menyimpan aset. Coba lagi.");
      setToast({ type: "error", message: "Gagal menyimpan aset. Coba lagi." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <ProtectedLayout>
      <div className="mx-auto max-w-[1440px]">
        <PageHeader
          title="Tambah Aset Baru"
          subtitle="Lengkapi informasi aset di bawah ini untuk mendaftarkannya ke sistem."
        />
        <form onSubmit={handleSubmit}>
          <div className="grid grid-cols-12 gap-6">
            <div className="col-span-12 xl:col-span-8 2xl:col-span-9 space-y-5">
              <FormSection step={1} title="Informasi Aset">
                <Field label="Nama Aset" required error={fieldErrors.assetName}>
                  <input
                    value={assetName}
                    onChange={(e) => setAssetName(e.target.value)}
                    className="input"
                  />
                </Field>
                <Field label="Kategori" required error={fieldErrors.categoryId}>
                  <select
                    value={categoryId}
                    onChange={(e) => handleCategoryChange(e.target.value)}
                    className="input"
                  >
                    <option value="">Pilih kategori</option>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.categoryName}
                      </option>
                    ))}
                  </select>
                </Field>

                <Field
                  label="Kode Asset"
                  required
                  full
                  error={fieldErrors.assetCode}
                  hint={
                    autoCode && !category
                      ? "Kode akan dibuat otomatis setelah kategori dipilih."
                      : undefined
                  }
                >
                  <div className="flex gap-2">
                    <input
                      value={
                        autoCode && generatingCode ? "Membuat kode..." : assetCode
                      }
                      onChange={(e) => setAssetCode(e.target.value)}
                      readOnly={autoCode}
                      className={`input flex-1 ${autoCode ? "bg-slate-50 text-slate-500" : ""}`}
                      placeholder={
                        autoCode ? "Pilih kategori untuk membuat kode" : "mis. AST-LAP-2026-0001"
                      }
                    />
                    <button
                      type="button"
                      onClick={handleToggleAutoCode}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-600 hover:bg-slate-50 shrink-0"
                    >
                      {autoCode ? <Pencil size={13} /> : <Wand2 size={13} />}
                      {autoCode ? "Edit Manual" : "Auto Generate"}
                    </button>
                  </div>
                </Field>

                <Field label="Subkategori">
                  <input
                    value={subCategory}
                    onChange={(e) => setSubCategory(e.target.value)}
                    className="input"
                  />
                </Field>
                <Field label="Merk" required error={fieldErrors.brand}>
                  <input
                    value={brand}
                    onChange={(e) => setBrand(e.target.value)}
                    className="input"
                  />
                </Field>
                <Field label="Model/Tipe" required error={fieldErrors.model}>
                  <input
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    className="input"
                  />
                </Field>
                <Field label="Serial Number">
                  <input
                    value={serialNumber}
                    onChange={(e) => setSerialNumber(e.target.value)}
                    className="input"
                  />
                </Field>
                <Field label="IMEI">
                  <input
                    value={imei}
                    onChange={(e) => setImei(e.target.value)}
                    className="input"
                  />
                </Field>
                <Field label="Foto Aset" full>
                  <FileUploadField
                    kind="image"
                    uploadType="asset_photo"
                    accept={["jpg", "jpeg", "png", "webp"]}
                    maxSizeMB={5}
                    value={
                      photo
                        ? {
                            url: photo.url,
                            thumbnailUrl: photo.thumbnailUrl,
                            driveFileId: photo.fileId,
                            fileName: photo.fileName,
                            size: photo.size,
                          }
                        : null
                    }
                    meta={{ assetCode, assetName }}
                    onUploadStateChange={setPhotoUploading}
                    onUploaded={(result) => setPhoto(result)}
                    onRemove={() => setPhoto(null)}
                    onError={(msg) => setToast({ type: "error", message: msg })}
                  />
                </Field>
                <Field label="Deskripsi" full>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="input"
                    rows={2}
                  />
                </Field>
              </FormSection>

              <FormSection step={2} title="Kepemilikan & Lokasi">
                <Field
                  label="Perusahaan/Brand Pemilik"
                  required
                  error={fieldErrors.companyOwnerId}
                  hint={brands.length === 0 ? "Tidak ada data perusahaan/brand dari HRP." : undefined}
                >
                  <SearchableSelect
                    items={brandItems}
                    value={companyOwnerId}
                    onChange={handleCompanyChange}
                    placeholder="Pilih perusahaan/brand"
                    searchPlaceholder="Cari brand..."
                    emptyText="Tidak ada brand yang cocok."
                  />
                </Field>
                <Field
                  label="Divisi Pengguna"
                  hint={
                    !companyOwnerId
                      ? "Pilih perusahaan/brand terlebih dahulu"
                      : loadingDivisions
                      ? "Memuat divisi..."
                      : divisions.length === 0
                      ? "Tidak ada data divisi untuk brand ini."
                      : undefined
                  }
                >
                  <select
                    value={divisionOwnerId}
                    onChange={(e) => setDivisionOwnerId(e.target.value)}
                    disabled={!companyOwnerId || loadingDivisions}
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
                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">
                    Lokasi Asset <span className="text-red-500">*</span>
                  </label>
                  {isLocationPicRole ? (
                    <PicLocationField
                      assignedPicLocations={myPicLocations}
                      locations={locations}
                      selectedLocationId={selectedPicLocationId}
                      onSelectLocation={setSelectedPicLocationId}
                    />
                  ) : (
                    <LocationCascadeFields
                      locations={scopedLocations}
                      value={locationSelection}
                      onChange={setLocationSelection}
                    />
                  )}
                  {fieldErrors.location && (
                    <p className="mt-1 text-xs text-red-600">{fieldErrors.location}</p>
                  )}
                </div>
                <Field
                  label="Mode Tracking Aset"
                  hint={TRACKING_MODE_OPTIONS.find((o) => o.value === trackingMode)?.hint}
                >
                  <select
                    value={trackingMode}
                    onChange={(e) => setTrackingMode(e.target.value as TrackingMode)}
                    className="input"
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
                    value={responsiblePersonUid}
                    onChange={setResponsiblePersonUid}
                    placeholder="Pilih karyawan"
                    searchPlaceholder="Cari nama karyawan..."
                    emptyText="Tidak ada karyawan yang cocok."
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
                    value={ownershipStatus}
                    onChange={(e) => setOwnershipStatus(e.target.value as OwnershipStatus)}
                    className="input"
                  >
                    {OWNERSHIP_OPTIONS.map((o) => (
                      <option key={o} value={o}>
                        {o}
                      </option>
                    ))}
                  </select>
                </Field>
              </FormSection>

              {canViewFinanceCreate && (
              <FormSection step={3} title="Finance / Bukti Pembelian">
                <Field label="Tanggal Pembelian">
                  <input
                    type="date"
                    value={purchaseDate}
                    onChange={(e) => setPurchaseDate(e.target.value)}
                    className="input"
                  />
                </Field>
                <Field label="Harga Beli">
                  <CurrencyInput value={purchasePrice} onChange={setPurchasePrice} />
                </Field>
                <Field label="Vendor">
                  <input
                    value={vendorName}
                    onChange={(e) => setVendorName(e.target.value)}
                    className="input"
                  />
                </Field>
                <Field label="Nomor Invoice">
                  <input
                    value={invoiceNumber}
                    onChange={(e) => setInvoiceNumber(e.target.value)}
                    className="input"
                  />
                </Field>
                <Field label="Upload Invoice" full>
                  <FileUploadField
                    kind="file"
                    uploadType="invoice"
                    accept={["pdf", "jpg", "jpeg", "png"]}
                    maxSizeMB={10}
                    value={
                      invoice
                        ? { url: invoice.url, fileName: invoice.fileName, size: invoice.size }
                        : null
                    }
                    meta={{ assetCode, assetName }}
                    onUploadStateChange={setInvoiceUploading}
                    onUploaded={(result) => setInvoice(result)}
                    onRemove={() => setInvoice(null)}
                    onError={(msg) => setToast({ type: "error", message: msg })}
                  />
                </Field>
                <Field label="Sumber Dana">
                  <select
                    value={fundingSource}
                    onChange={(e) => setFundingSource(e.target.value as FundingSource)}
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
                    value={purchaseMethod}
                    onChange={(e) => setPurchaseMethod(e.target.value)}
                    className="input"
                  />
                </Field>
                <Field label="Estimasi Umur Aset" hint="mis. 3 tahun">
                  <input
                    value={estimatedUsefulLife}
                    onChange={(e) => setEstimatedUsefulLife(e.target.value)}
                    className="input"
                  />
                </Field>
                <Field label="Catatan Finance" full>
                  <textarea
                    value={financeNotes}
                    onChange={(e) => setFinanceNotes(e.target.value)}
                    className="input"
                    rows={2}
                  />
                </Field>
              </FormSection>
              )}

              <FormSection
                step={4}
                title="Kondisi & Status Aset"
                description="Kondisi fisik dan status operasional barang — TERPISAH dari status pemakaian (Dipinjam/Tersedia diatur otomatis lewat proses pinjam/kembali)."
              >
                <Field
                  label="Status Operasional Aset"
                  required
                  error={fieldErrors.assetStatus}
                  hint={ASSET_STATUS_HELPER[assetStatus]}
                >
                  <select
                    value={assetStatus}
                    onChange={(e) => setAssetStatus(e.target.value as AssetStatus)}
                    className="input"
                  >
                    {ASSET_STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {ASSET_STATUS_LABEL[s]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Kondisi Aset" required error={fieldErrors.condition}>
                  <select
                    value={condition}
                    onChange={(e) => setCondition(e.target.value as AssetCondition)}
                    className="input"
                  >
                    {CONDITION_OPTIONS.map((c) => (
                      <option key={c} value={c}>
                        {CONDITION_LABEL[c]}
                      </option>
                    ))}
                  </select>
                </Field>
              </FormSection>

              <FormSection
                step={5}
                title="Pengaturan Pemakaian Aset"
                description="QR Code akan digenerate otomatis dari kode aset."
              >
                <div className="md:col-span-2 grid md:grid-cols-2 gap-4">
                  <Toggle
                    checked={isBorrowable}
                    onChange={setIsBorrowable}
                    label="Bisa Dipinjam"
                    helper="Jika aktif, staff dapat meminjam asset melalui scan QR."
                  />
                  <Toggle
                    checked={requiresApproval}
                    onChange={setRequiresApproval}
                    label="Butuh Approval"
                    helper="Jika aktif, peminjaman perlu persetujuan Asset Admin."
                  />
                </div>
                <Field label="Aksesoris" full>
                  <input
                    value={accessories}
                    onChange={(e) => setAccessories(e.target.value)}
                    className="input"
                  />
                </Field>
                <Field label="Catatan Operasional" full>
                  <textarea
                    value={operationalNotes}
                    onChange={(e) => setOperationalNotes(e.target.value)}
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
            </div>

            <aside className="col-span-12 xl:col-span-4 2xl:col-span-3 space-y-5 xl:sticky xl:top-24 self-start">
              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
                <h2 className="font-semibold text-slate-800 mb-4">Ringkasan Aset</h2>
                <dl className="space-y-3 text-sm">
                  <div>
                    <dt className="text-xs text-slate-400">Nama Aset</dt>
                    <dd className="font-medium text-slate-800">{assetName || "-"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-400">Kode Aset</dt>
                    <dd className="font-medium text-slate-800">{assetCode || "-"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-400">Kategori</dt>
                    <dd className="font-medium text-slate-800">
                      {category?.categoryName || "-"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-400">Status Asset</dt>
                    <dd className="font-medium text-slate-800">
                      {ASSET_STATUS_LABEL[assetStatus]}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-400">Perusahaan/Brand</dt>
                    <dd className="font-medium text-slate-800">
                      {companyOwner?.name || "-"}
                    </dd>
                  </div>
                </dl>
              </div>

              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex flex-col items-center">
                <h2 className="font-semibold text-slate-800 mb-4 self-start">
                  Preview QR
                </h2>
                {assetCode ? (
                  <div className="p-3 rounded-xl border border-slate-200 bg-slate-50">
                    <QRCodeSVG
                      value={assetCode}
                      size={140}
                      level="H"
                      includeMargin
                      imageSettings={getQrImageSettings(140)}
                    />
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 text-center py-8">
                    QR akan tersedia setelah kode aset dibuat.
                  </p>
                )}
              </div>

              <div className="bg-blue-50/60 rounded-2xl border border-blue-100 p-5">
                <h2 className="font-semibold text-slate-800 mb-2 text-sm">
                  Panduan Pengisian
                </h2>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Field bertanda <span className="text-red-500 font-medium">*</span> wajib
                  diisi sebelum aset dapat disimpan. Field lain bertanda{" "}
                  <span className="text-slate-400">(Opsional)</span> boleh dilengkapi
                  belakangan melalui halaman Edit Aset.
                </p>
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
                : "Simpan Aset"}
            </button>
          </div>
        </form>
      </div>

      <Toast toast={toast} onClose={() => setToast(null)} />
    </ProtectedLayout>
  );
}
