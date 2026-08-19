"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { addDoc, collection, doc, onSnapshot, serverTimestamp, setDoc } from "firebase/firestore";
import { QRCodeSVG } from "qrcode.react";
import { Copy, Check } from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import {
  Asset,
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
  InvoiceStatus,
  OwnershipStatus,
} from "@/lib/types";
import { INVOICE_STATUS_LABEL } from "@/lib/assets/inventory";
import { fetchHrpBrands, fetchHrpDivisions } from "@/lib/hrp";
import {
  cleanFirestoreData,
  EmployeeOption,
  fetchActiveEmployeeOptions,
  fetchActiveUsersByRoles,
  normalizeCategoryCodePart,
  writeAssetLog,
} from "@/lib/firestore-helpers";
import {
  allocateAssetCode,
  allocateAssetNumber,
  deriveCompanyCode,
  formatDateForAssetCode,
  previewNextAssetCode,
  previewNextAssetNumber,
  resolveOperationalLocationCode,
} from "@/lib/assets/asset-code-generator";
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
import AssetFieldErrorModal from "@/components/AssetFieldErrorModal";
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
import QrLabelModal from "@/components/QrLabelModal";
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

// Section "Validasi Create/Edit Asset" — urutan tampil form (atas ke bawah),
// dipakai AssetFieldErrorModal untuk menentukan error PERTAMA yang di-scroll
// & di-focus saat user klik "Perbaiki Data".
const REQUIRED_FIELD_ORDER = [
  "assetName",
  "categoryId",
  "purchaseDate",
  "quantity",
  "companyOwnerId",
  "location",
  "assetCode",
  "responsiblePersonUid",
  "ownershipStatus",
  "condition",
  "assetStatus",
];

export default function NewAssetPage() {
  const { firebaseUser, assetUser, role, loading, isLocationPicRole: isPicViaLocations } = useAuth();
  const authReady = !loading && !!firebaseUser && !!assetUser && !!role;
  const router = useRouter();

  // Section "Rombak permission Asset" — Asset Finance sekarang BOLEH
  // membuat aset baru dari nol (tidak perlu menunggu Asset Admin), jadi
  // redirect keluar yang dulu ada di sini sudah dihapus.

  // Section B — Asset Admin/QHSE TIDAK boleh melihat/mengisi section Finance
  // sama sekali di Create Asset (field-nya benar-benar tidak dirender, bukan
  // cuma disabled) — harga dilengkapi lewat Finance. Super Admin & Asset
  // Finance sama-sama melihat section Finance saat create.
  const canViewFinanceCreate = role === "super_admin" || role === "asset_finance";
  const [categories, setCategories] = useState<AssetCategory[]>([]);
  const [employeeOptions, setEmployeeOptions] = useState<EmployeeOption[]>([]);
  const [brands, setBrands] = useState<HrpBrand[]>([]);
  const [divisions, setDivisions] = useState<HrpDivision[]>([]);
  const [loadingDivisions, setLoadingDivisions] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  // Section "Validasi Create/Edit Asset" — locationErrorLevel dipakai border
  // merah per-level Gedung/Lantai/Ruangan (LocationCascadeFields), errorModalOpen
  // untuk modal ringkasan "Periksa Data Aset".
  const [locationErrorLevel, setLocationErrorLevel] = useState<"building" | "floor" | "room" | null>(null);
  const [errorModalOpen, setErrorModalOpen] = useState(false);
  // Section "Rapikan UI Identitas Aset Otomatis" — modal QR full (lihat/
  // cetak) dari card compact, dan feedback "tersalin" sesaat di tombol Copy
  // Kode Aset (bukan cuma toast, biar langsung kelihatan di tombolnya).
  const [qrModalOpen, setQrModalOpen] = useState(false);
  const [codeCopied, setCodeCopied] = useState(false);
  // Border merah untuk <input>/<select> native saat field itu error —
  // SearchableSelect punya prop `error` sendiri (lihat components/SearchableSelect.tsx).
  const errCls = (hasError: boolean, base = "input") => (hasError ? `${base} border-red-500 focus:ring-red-500/30` : base);
  const [toast, setToast] = useState<ToastState | null>(null);
  // Section 4/5 — SATU document ref dipakai sepanjang percobaan submit ini
  // (termasuk kalau handleSubmit sempat terpanggil ulang sebelum berhasil).
  // pendingAssetIdRef.current diisi SEKALI saat pertama kali submit dicoba,
  // dan dipakai ulang kalau user sempat klik simpan lagi sebelum proses
  // pertama selesai — supaya tidak pernah ada dua dokumen assets untuk satu
  // percobaan yang sama (akar bug aset duplikat "testing bebe h").
  const pendingAssetIdRef = useRef<string | null>(null);
  // No./Kode Aset FINAL yang benar-benar dialokasikan (bukan preview) —
  // di-cache per percobaan submit supaya retry tidak membakar nomor baru.
  const pendingAllocationRef = useRef<{ assetNumber: number; assetCode: string } | null>(null);

  // A. Informasi Aset — SENGAJA hanya field yang ada di "Label Aset
  // EGC.xlsx" (Subkategori/Merk/Model/Serial Number/IMEI dihapus, lihat
  // ticket "Create/Edit Asset ikuti Excel").
  const [assetName, setAssetName] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [description, setDescription] = useState("");
  const [photo, setPhoto] = useState<DriveUploadResult | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);

  // Informasi Inventaris — field tambahan supaya struktur data aset manual
  // sama dengan hasil Import Aset (lihat lib/import/asset-row-mapper.ts).
  const [inventoryNumber, setInventoryNumber] = useState("");
  const [quantity, setQuantity] = useState<number>(1);
  const [physicalEvidence, setPhysicalEvidence] = useState("");

  // No. Aset & Kode Aset — TIDAK PERNAH diisi manual (ticket eksplisit:
  // "rawan salah dan duplicate"). Keduanya dihitung otomatis dari
  // Perusahaan+Tanggal Perolehan+Lokasi+Kategori lewat
  // lib/assets/asset-code-generator.ts, readonly di UI. Nilai di state ini
  // HANYA preview — alokasi FINAL race-safe terjadi ulang persis sebelum
  // submit (lihat handleSubmit).
  const [assetNumber, setAssetNumber] = useState<number | null>(null);
  const [assetCode, setAssetCode] = useState("");
  const [codeGenerationError, setCodeGenerationError] = useState("");

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
  const [invoiceStatus, setInvoiceStatus] = useState<InvoiceStatus | "">("");
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
  // Section 1 — cek SEMUA kemungkinan field PIC (picUid/picEmail dan alias
  // legacy locationPicUid/locationPicEmail yang mungkin masih dipakai data
  // lama) supaya PIC tidak "kehilangan" lokasinya hanya karena field yang
  // terisi beda nama. PIC TIDAK BOLEH memilih lokasi lain di luar hasil ini
  // — myPicLocations inilah satu-satunya sumber opsi untuk PicLocationField.
  const myPicLocations = useMemo(() => {
    if (!isLocationPicRole || !assetUser) return [];
    const uid = firebaseUser?.uid || assetUser.uid;
    const email = firebaseUser?.email || assetUser.email;
    return locations.filter((n) => {
      const node = n as unknown as Record<string, unknown>;
      return (
        n.picUid === uid ||
        node.locationPicUid === uid ||
        (!!email && n.picEmail === email) ||
        (!!email && node.locationPicEmail === email)
      );
    });
  }, [locations, isLocationPicRole, assetUser, firebaseUser?.uid, firebaseUser?.email]);
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

  // Section "Perbaiki generator Kode Aset" — No./Kode Aset otomatis dibuat
  // ulang (preview) setiap kali Perusahaan/Tanggal Perolehan/Lokasi/Kategori
  // berubah, mengikuti pola "EGS.28/11/2017.DTIC.G-B06". Kode LOKASI OPERASIONAL
  // TIDAK PERNAH mewajibkan Kode Gedung — prioritas Kode Ruangan (paling
  // spesifik) -> Kode Divisi -> Kode Gedung (fallback terakhir), lihat
  // resolveOperationalLocationCode di lib/assets/asset-code-generator.ts.
  const selectedBuilding = useMemo(
    () => locations.find((n) => n.id === locationSelection.buildingId),
    [locations, locationSelection.buildingId]
  );
  const selectedRoom = useMemo(
    () => locations.find((n) => n.id === locationSelection.roomId),
    [locations, locationSelection.roomId]
  );
  const operationalLocationCode = resolveOperationalLocationCode({
    roomCode: selectedRoom?.roomCode,
    roomName: selectedRoom?.roomName,
    divisionCode: divisionOwner?.code,
    divisionName: divisionOwner?.name,
    buildingCode: selectedBuilding?.buildingCode,
  });
  const locationCodeForGeneration = operationalLocationCode.code;
  const dateForCodeGeneration = purchaseDate ? formatDateForAssetCode(purchaseDate) : "";
  const codeDepsReady = !!(
    companyOwnerId &&
    companyOwner &&
    category &&
    category.categoryCode?.trim() &&
    dateForCodeGeneration &&
    locationSelection.buildingId &&
    locationCodeForGeneration
  );
  // Section "Validasi Create/Edit Asset" — pesan SPESIFIK per sumber data
  // master yang belum lengkap (bukan "Gagal membuat Kode Aset" generik).
  // Kosong ("") berarti belum ada masalah — field wajib LAIN yang belum
  // diisi ditangani validasi required terpisah, bukan di sini.
  const codeNotReadyReason = (() => {
    if (companyOwnerId && companyOwner && !companyOwner.name?.trim()) {
      return "Perusahaan belum memiliki Kode Perusahaan.";
    }
    if (category && !category.categoryCode?.trim()) {
      return `Kategori "${category.categoryName}" belum memiliki Kode Kategori.`;
    }
    // Section "Rombak Tambah/Edit Asset" — baru dianggap "belum siap" kalau
    // SEMUA sumber kode lokasi (Kode/Nama Ruangan, Kode/Nama Divisi, Kode
    // Gedung) kosong — nama Ruangan/Divisi yang sudah code-like (mis.
    // "DTIC") otomatis ikut dicoba duluan lewat resolveOperationalLocationCode,
    // jadi kasus ini SEHARUSNYA jarang terjadi kalau Ruangan sudah dipilih.
    if (
      companyOwnerId &&
      category &&
      category.categoryCode?.trim() &&
      purchaseDate &&
      dateForCodeGeneration &&
      locationSelection.buildingId &&
      !locationCodeForGeneration
    ) {
      return "Lokasi ini belum memiliki kode. Atur kode Ruangan/Divisi di Master Lokasi.";
    }
    return "";
  })();

  // Section "Urutan Form Create/Edit ikuti dependency" — daftar field yang
  // BELUM DIPILIH sama sekali (beda dari codeNotReadyReason di atas, yang
  // khusus kasus field SUDAH dipilih tapi master data-nya belum punya kode)
  // — dipakai card "Identitas Aset Otomatis" supaya pesannya bilang PERSIS
  // field mana yang masih kosong, bukan "-" atau pesan generik. Hanya level
  // lokasi TERDALAM yang belum diisi yang ditampilkan (sama seperti pola
  // locationErrorLevel di bawah) — bukan Gedung/Lantai/Ruangan sekaligus.
  const missingCodeFields: string[] = [];
  if (!companyOwnerId) missingCodeFields.push("Perusahaan");
  if (!purchaseDate) missingCodeFields.push("Tanggal Perolehan");
  if (!categoryId) missingCodeFields.push("Kategori");
  if (!locationSelection.buildingId) missingCodeFields.push("Gedung");
  else if (!locationSelection.floorId) missingCodeFields.push("Lantai");
  else if (!locationSelection.roomId) missingCodeFields.push("Ruangan");

  // Section "Rapikan UI Identitas Aset Otomatis" — QrLabelModal butuh objek
  // Asset penuh, tapi aset di Create BELUM tersimpan (belum punya id/asset
  // sungguhan) — dibuatkan objek preview MINIMAL (field yang benar-benar
  // dibaca QrLabelModal saja), TETAP memakai assetCode yang sama persis
  // dengan yang ditampilkan di card (bukan kode baru).
  const qrPreviewAsset = {
    id: "preview",
    assetName: assetName || "Aset Baru",
    assetCode,
    // Bug fix "No. Aset modal QR" — assetNumber sempat tidak diikutkan di
    // sini, jadi getAssetNumber(asset) di QrLabelModal selalu null -> "-",
    // padahal card Identitas Aset Otomatis sudah menampilkan angkanya (dari
    // state assetNumber yang SAMA). Preview number, BUKAN alokasi final
    // (yang baru terjadi race-safe saat submit) — tetap angka yang sama
    // persis yang tampil di card.
    assetNumber,
    companyOwnerName: companyOwner?.name || "",
    locationText: buildFullPath({
      buildingName: locationSelection.buildingName,
      floorName: locationSelection.floorName,
      roomName: locationSelection.roomName,
      areaName: locationSelection.areaName,
    }),
    assetStatus,
    condition,
  } as Asset;

  const handleCopyCode = async () => {
    if (!assetCode) return;
    try {
      await navigator.clipboard.writeText(assetCode);
      setCodeCopied(true);
      setToast({ type: "success", message: "Kode aset berhasil disalin" });
      setTimeout(() => setCodeCopied(false), 1500);
    } catch {
      // clipboard tidak tersedia — abaikan diam-diam
    }
  };

  // "Adjust state during render" (BUKAN di dalam useEffect, supaya tidak
  // kena react-hooks/set-state-in-effect) — reset preview setiap kali
  // kombinasi dependency berubah tapi belum lengkap. Ikut roomId/divisionId
  // supaya ganti Ruangan/Divisi dalam Gedung yang sama juga memicu reset
  // (dua-duanya bisa mengubah locationCodeForGeneration).
  const codeDepsSignature = `${companyOwnerId}|${divisionOwnerId}|${category?.id || ""}|${purchaseDate}|${locationSelection.buildingId}|${locationSelection.roomId}`;
  const [prevCodeDepsSignature, setPrevCodeDepsSignature] = useState(codeDepsSignature);
  if (codeDepsSignature !== prevCodeDepsSignature) {
    setPrevCodeDepsSignature(codeDepsSignature);
    if (!codeDepsReady) {
      setAssetNumber(null);
      setAssetCode("");
    }
    setCodeGenerationError(codeNotReadyReason);
  }

  // "Membuat nomor/kode..." diturunkan (BUKAN state useEffect terpisah) —
  // siap secara dependency tapi preview belum terisi = sedang diproses.
  const codeGenerating = codeDepsReady && assetNumber === null && !codeGenerationError;

  useEffect(() => {
    if (!codeDepsReady || !companyOwner || !category) return;
    let cancelled = false;
    Promise.all([
      previewNextAssetNumber(companyOwnerId),
      previewNextAssetCode({
        companyId: companyOwnerId,
        companyCode: deriveCompanyCode(companyOwner.name),
        dateForCode: dateForCodeGeneration,
        locationCode: locationCodeForGeneration,
        categoryCode: normalizeCategoryCodePart(category.categoryCode),
      }),
    ])
      .then(([nextNumber, nextCode]) => {
        if (cancelled) return;
        setAssetNumber(nextNumber);
        setAssetCode(nextCode);
        setCodeGenerationError("");
      })
      .catch((err) => {
        console.error("[Asset Create] gagal membuat preview No./Kode Aset", err);
        if (!cancelled) setCodeGenerationError("Gagal membuat No./Kode Aset otomatis. Coba lagi.");
      });
    return () => {
      cancelled = true;
    };
  }, [codeDepsReady, companyOwnerId, companyOwner, category, dateForCodeGeneration, locationCodeForGeneration]);

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

    // Section 3 — cegah submit ganda: kalau proses sebelumnya masih
    // berjalan (mis. user klik dua kali, atau klik lagi setelah pesan
    // error yang sebenarnya keliru karena proses tambahan yang gagal),
    // jangan mulai proses baru sama sekali.
    if (saving) return;

    if (photoUploading || invoiceUploading) {
      setError("Tunggu proses upload file selesai sebelum menyimpan.");
      return;
    }

    const errors: Record<string, string> = {};
    if (!assetName.trim()) errors.assetName = "Nama aset wajib diisi.";
    if (!categoryId) errors.categoryId = "Kategori wajib dipilih.";
    if (!companyOwnerId) errors.companyOwnerId = "Perusahaan/Brand wajib dipilih.";
    if (!purchaseDate) errors.purchaseDate = "Tanggal Perolehan wajib diisi.";
    // PIC Lokasi bisa ditugaskan di level Gedung/Lantai/Area juga (bukan
    // wajib sampai Ruangan) — cukup pastikan dia sudah memilih salah satu
    // lokasi tanggung jawabnya. locationErrorLevel dipakai border merah +
    // scroll/focus per-level di LocationCascadeFields (Field yang sama
    // sekali tidak pernah kena error: Area, karena opsional).
    let locationErrorLevel: "building" | "floor" | "room" | null = null;
    if (isLocationPicRole) {
      if (!selectedPicLocationId) errors.location = "Lokasi tanggung jawab wajib dipilih.";
    } else if (!locationSelection.buildingId) {
      errors.location = "Gedung wajib dipilih.";
      locationErrorLevel = "building";
    } else if (!locationSelection.floorId) {
      errors.location = "Lantai wajib dipilih.";
      locationErrorLevel = "floor";
    } else if (!locationSelection.roomId) {
      errors.location = "Ruangan wajib dipilih.";
      locationErrorLevel = "room";
    }
    if (!quantity || quantity < 1) errors.quantity = "Qty minimal 1.";
    if (codeGenerationError) {
      errors.assetCode = codeGenerationError;
    } else if (!assetCode || assetNumber === null) {
      errors.assetCode = "No./Kode Aset belum bisa dibuat — lengkapi Perusahaan, Kategori, Tanggal Perolehan, dan Lokasi.";
    }
    if (!ownershipStatus) errors.ownershipStatus = "Status kepemilikan wajib dipilih.";
    if (trackingMode === "assigned_pic" && !responsiblePersonUid)
      errors.responsiblePersonUid = "PIC Operasional wajib dipilih untuk aset dengan PIC.";
    if (!assetStatus) errors.assetStatus = "Status aset wajib dipilih.";
    if (!condition) errors.condition = "Kondisi aset wajib dipilih.";

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setLocationErrorLevel(locationErrorLevel);
      setToast({ type: "error", message: `Data belum lengkap. Ada ${Object.keys(errors).length} bagian yang perlu diperbaiki.` });
      setErrorModalOpen(true);
      return;
    }

    setSaving(true);
    setError("");
    setFieldErrors({});
    // Section 2/7 — SATU sumber untuk uid/nama pembuat & pengubah, dipakai
    // konsisten di seluruh payload (termasuk log aktivitas) DAN di log
    // error kalau submit gagal — firebaseUser.uid DULU karena itu yang
    // selalu sama dengan request.auth.uid yang dipakai rules, assetUser
    // cuma pelengkap nama. Dideklarasikan di luar try supaya tetap bisa
    // dipakai di blok catch.
    const currentUserUid = firebaseUser?.uid || assetUser?.uid || "";
    const currentUserName = assetUser?.name || firebaseUser?.email || "";
    const picLocationId = isLocationPicRole ? selectedPicLocationId || null : null;
    // Section "Audit Create Asset per-stage" — SATU format log dipakai di
    // semua stage (counter/code/asset_document/activity_log/dst) supaya
    // kalau ada yang gagal, console langsung menunjukkan STAGE + COLLECTION
    // + errorCode/errorMessage yang sebenarnya — bukan cuma
    // "stage=create_assets FAILED {}" yang tidak bisa ditelusuri.
    const logStageError = (stage: string, collectionName: string, err: unknown, context?: Record<string, unknown>) => {
      const e = err as { code?: string; message?: string; name?: string };
      console.error(`[Asset Create] stage=${stage} FAILED`, {
        stage,
        collection: collectionName,
        role,
        uid: currentUserUid,
        errorCode: e?.code,
        errorMessage: e?.message,
        errorName: e?.name,
        ...context,
      });
    };
    // Section "Audit Create Asset per-stage" — pesan spesifik ke USER: kalau
    // error-nya benar-benar Firestore permission-denied, bilang PERSIS
    // collection mana yang ditolak (paling actionable untuk debug rules) —
    // selain itu baru pakai pesan generik per-stage.
    const getUserFacingErrorMessage = (err: unknown, collectionName: string, fallbackMessage: string) => {
      const e = err as { code?: string };
      if (e?.code === "permission-denied") {
        return `Tidak memiliki izin untuk menyimpan data pada ${collectionName}.`;
      }
      return fallbackMessage;
    };
    // Section 1 — dokumen `assets` dianggap berhasil dibuat SEGERA setelah
    // setDoc() sukses. Proses tambahan (log aktivitas, notifikasi QHSE)
    // TIDAK PERNAH boleh membuat halaman ini melapor "gagal" — itulah akar
    // bug aset duplikat: dulu semuanya dalam satu try/catch, jadi kegagalan
    // proses tambahan membuat pesan error muncul padahal dokumennya sudah
    // tersimpan, lalu user submit ulang dan membuat dokumen KEDUA.
    let assetCreated = false;
    try {
      // Section 5 — idempotency: pakai assetRef yang SAMA kalau percobaan
      // sebelumnya (dalam sesi form yang sama) sempat membuat ref tapi
      // belum berhasil setDoc — jangan pernah generate id baru selama
      // percobaan sebelumnya masih "gantung".
      const assetRef = pendingAssetIdRef.current
        ? doc(db, "assets", pendingAssetIdRef.current)
        : doc(collection(db, "assets"));
      pendingAssetIdRef.current = assetRef.id;

      // Section "Fix Create Asset PIC Lokasi" — locationId PERSIS sama
      // dengan locationId yang nanti ditulis ke assetPayload (dihitung SEKALI
      // di sini, dipakai ulang di payload di bawah) — firestore.rules
      // (isLocationPicAssetCounterWrite) memverifikasi PIC Lokasi cuma boleh
      // menggenerate No./Kode Aset untuk lokasi yang benar-benar dia pegang,
      // jadi nilainya wajib konsisten antara counter dan dokumen assets.
      const assetLocationId =
        locationSelection.areaId ||
        locationSelection.roomId ||
        locationSelection.floorId ||
        locationSelection.buildingId ||
        null;
      const counterWriteMeta = {
        locationId: assetLocationId,
        updatedByUid: currentUserUid,
        updatedByName: currentUserName,
      };

      // Alokasi FINAL race-safe (transaction counter, lihat
      // lib/assets/asset-code-generator.ts) — bukan cuma preview yang sudah
      // tampil di layar, supaya dua user create hampir bersamaan tidak
      // pernah dapat No./Kode Aset yang sama. Di-cache per percobaan submit
      // (pendingAllocationRef) supaya retry setelah gagal parsial TIDAK
      // membakar nomor baru lagi — tetap idempotent seperti pendingAssetIdRef.
      let allocation = pendingAllocationRef.current;
      if (!allocation) {
        // Section "Audit Create Asset per-stage" — counter (No. Aset) dan
        // code (Kode Aset) SENGAJA dipisah try/catch masing-masing (dua
        // collection Firestore berbeda: asset_number_counters vs
        // asset_code_counters) supaya kalau salah satu gagal permission,
        // pesannya spesifik ke stage itu — bukan generik "gagal simpan aset".
        console.info("[Asset Create] stage=counter START", { companyOwnerId, locationId: assetLocationId });
        let finalAssetNumber: number;
        try {
          finalAssetNumber = await allocateAssetNumber(companyOwnerId, counterWriteMeta);
          console.info("[Asset Create] stage=counter SUCCESS", { assetNumber: finalAssetNumber });
        } catch (err) {
          logStageError("counter", "asset_number_counters", err, { companyOwnerId });
          const message = getUserFacingErrorMessage(err, "asset_number_counters", "Gagal membuat No. Aset otomatis.");
          setError(message);
          setToast({ type: "error", message });
          setSaving(false);
          return;
        }

        console.info("[Asset Create] stage=code START", {
          companyOwnerId,
          categoryCode: category?.categoryCode,
          locationCode: locationCodeForGeneration,
        });
        let finalAssetCode: string;
        try {
          finalAssetCode = await allocateAssetCode({
            companyId: companyOwnerId,
            companyCode: deriveCompanyCode(companyOwner?.name || ""),
            dateForCode: formatDateForAssetCode(purchaseDate),
            locationCode: locationCodeForGeneration,
            categoryCode: normalizeCategoryCodePart(category?.categoryCode || ""),
            counterMeta: counterWriteMeta,
          });
          console.info("[Asset Create] stage=code SUCCESS", { assetCode: finalAssetCode });
        } catch (err) {
          logStageError("code", "asset_code_counters", err, { companyOwnerId });
          const message = getUserFacingErrorMessage(err, "asset_code_counters", "Gagal membuat Kode Aset.");
          setError(message);
          setToast({ type: "error", message });
          setSaving(false);
          return;
        }

        allocation = { assetNumber: finalAssetNumber, assetCode: finalAssetCode };
        pendingAllocationRef.current = allocation;
      }

      // Section 8 — foto utama SUDAH terupload sebelum submit (lewat
      // FileUploadField), tahap ini cuma memastikan hasil uploadnya
      // dipakai di payload — tidak ada request upload baru di sini.
      console.info("[Asset Create] stage=upload_photo", {
        hasPhoto: !!photo?.fileId,
        photoFileName: photo?.fileName || null,
      });
      const photoFields = {
        photoUrl: photo?.url || null,
        photoThumbnailUrl: photo?.thumbnailUrl || null,
        photoFileName: photo?.fileName || null,
        photoDriveFileId: photo?.fileId || null,
        photoMimeType: photo?.mimeType || null,
        photoSize: photo?.size ?? null,
        photoUploadedAt: photo?.uploadedAt || null,
      };

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

      const assetPayload = cleanFirestoreData({
        assetName: assetName.trim(),
        assetCode: allocation.assetCode,
        // Section "Audit Create Asset per-stage" — Number() eksplisit (bukan
        // cuma percaya tipe TS) supaya assetNumber TIDAK PERNAH kekirim
        // sebagai undefined/NaN ke Firestore — ini SATU-SATUNYA field
        // canonical No. Aset (dipakai sama di card Identitas/Ringkasan
        // Aset/modal QR/Detail Asset/Table Asset/Export, lihat
        // lib/assets/inventory.ts getAssetNumber()).
        assetNumber: Number(allocation.assetNumber),
        categoryId,
        categoryName: category?.categoryName || "",
        // Subkategori/Merk/Model/Serial Number/IMEI dihapus dari form
        // (tidak ada di Excel) — field SCHEMA tetap ada (kompatibel dengan
        // data lama), cuma tidak pernah diisi lagi dari sini.
        subCategory: "",
        brand: "",
        model: "",
        serialNumber: "",
        imei: "",
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
        locationId: assetLocationId,
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
              createdByRole: "location_pic",
              locationPicUid: currentUserUid || "",
              locationPicName: currentUserName || "",
              locationPicEmail: firebaseUser?.email || "",
              allowedLocationPicUids: currentUserUid ? [currentUserUid] : [],
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
        // Tanggal Perolehan BUKAN field Finance (dipakai semua role, juga
        // jadi bagian pembentuk Kode Aset) — SELALU ditulis apa adanya.
        purchaseDate: purchaseDate || null,
        // Number() eksplisit saat ada nilai — TAPI null tetap null (bukan 0)
        // kalau memang belum diisi, supaya "belum ada harga" tidak diam-diam
        // jadi "harga Rp0" di financeStatus/hasPrice() dan tampilan lain.
        purchasePrice: canViewFinanceCreate && purchasePrice !== undefined ? Number(purchasePrice) : null,
        vendorName: canViewFinanceCreate ? vendorName.trim() : "",
        // Nomor/Bukti Invoice hanya disimpan saat Status Invoice = "Ada
        // Invoice" — dijaga ulang di sini (bukan cuma di UI) supaya data
        // yang kesimpan tetap benar walau state sempat tidak sinkron.
        invoiceNumber: canViewFinanceCreate && invoiceStatus === "ada" ? invoiceNumber.trim() : "",
        invoiceFileUrl: canViewFinanceCreate && invoiceStatus === "ada" ? invoice?.url || "" : "",
        invoiceFileName: canViewFinanceCreate && invoiceStatus === "ada" ? invoice?.fileName || "" : "",
        invoiceDriveFileId: canViewFinanceCreate && invoiceStatus === "ada" ? invoice?.fileId || "" : "",
        invoiceMimeType: canViewFinanceCreate && invoiceStatus === "ada" ? invoice?.mimeType || "" : "",
        invoiceSize: canViewFinanceCreate && invoiceStatus === "ada" ? invoice?.size ?? null : null,
        invoiceUploadedAt: canViewFinanceCreate && invoiceStatus === "ada" ? invoice?.uploadedAt || null : null,
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
        qrCodeValue: allocation.assetCode,

        currentBorrowingId: null,
        currentBorrowerUid: null,
        currentBorrowerName: null,

        createdByUid: currentUserUid,
        createdByName: currentUserName,
        updatedByUid: currentUserUid,
        updatedByName: currentUserName,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),

        // ── Informasi Inventaris — sama seperti field hasil Import Aset.
        // Tanggal/Harga Perolehan, status Invoice, Kondisi & Status Foto
        // SENGAJA diturunkan dari field Finance/Kondisi/Foto yang sudah diisi
        // di atas (bukan input terpisah) supaya tidak ada isian ganda.
        inventoryNumber: inventoryNumber.trim(),
        assetType: category?.categoryName || "",
        quantity: Number(quantity) || 1,
        acquisitionDate: purchaseDate || null,
        acquisitionPrice: canViewFinanceCreate && purchasePrice !== undefined ? Number(purchasePrice) : null,
        // Dropdown eksplisit (Field "Status Invoice" di atas) — bukan
        // diturunkan otomatis dari invoiceNumber/invoice presence, sama
        // seperti Edit Asset/EditFinanceModal.
        invoiceStatus: canViewFinanceCreate && invoiceStatus ? invoiceStatus : null,
        locationRaw: assetLocationText,
        inventoryCondition: CONDITION_LABEL[condition],
        inventoryNotes: "",
        photoStatus: photo?.fileId ? "Sudah" : "Belum Ditemukan",
        physicalEvidence: physicalEvidence.trim(),
        source: "manual",
        operationalStatus: "active",
      }) as Record<string, unknown>;

      // Section "Audit Create Asset per-stage" — payload lengkap di-log
      // SEBELUM write, supaya kalau stage asset_document gagal, isi
      // payload-nya (bukan cuma pesan error) langsung kelihatan di console.
      console.log("[Asset Create] payload", assetPayload);

      console.info("[Asset Create] stage=asset_document START", {
        assetId: assetRef.id,
        assetCode: assetPayload.assetCode,
      });
      try {
        await setDoc(assetRef, assetPayload);
        assetCreated = true;
        console.info("[Asset Create] stage=asset_document SUCCESS", {
          assetId: assetRef.id,
          assetCode: assetPayload.assetCode,
        });
      } catch (err) {
        logStageError("asset_document", "assets", err, {
          assetId: assetRef.id,
          assetCode: assetPayload.assetCode,
        });
        const message = getUserFacingErrorMessage(err, "assets", "Data Asset gagal disimpan.");
        setError(message);
        setToast({ type: "error", message });
        setSaving(false);
        return;
      }

      // Section 2/6 — SEMUA proses di bawah ini bersifat TAMBAHAN. Mulai
      // titik ini, aset SUDAH tersimpan — apa pun yang terjadi selanjutnya
      // TIDAK PERNAH boleh membuat halaman ini menampilkan pesan gagal.
      // Section "Audit Create Asset per-stage" — SETIAP stage sekunder
      // dipetakan ke collection Firestore-nya yang BENAR (bug lama: log PIC
      // Lokasi diberi label "update_counter" padahal menulis ke asset_logs,
      // bukan collection counter apa pun — menyesatkan kalau sampai gagal).
      const SECONDARY_STAGES = [
        { key: "activity_log", collection: "asset_logs" },
        { key: "location_pic_log", collection: "asset_logs" },
        { key: "notification", collection: "asset_notifications" },
      ];
      const additionalResults = await Promise.allSettled([
        (async () => {
          console.info("[Asset Create] stage=activity_log START", { assetId: assetRef.id });
          await writeAssetLog({
            assetId: assetRef.id,
            assetName: assetName.trim(),
            assetCode: allocation.assetCode,
            action: "create",
            userUid: currentUserUid,
            userName: currentUserName,
            detail: "Aset dibuat",
          });
          console.info("[Asset Create] stage=activity_log SUCCESS", { assetId: assetRef.id });
        })(),
        (async () => {
          // Section 4/6 — log aktivitas KHUSUS saat aset dibuat oleh PIC
          // Lokasi, payload PERSIS seperti diminta, ditulis ke asset_logs
          // (bukan asset_activity_logs yang aksesnya dibatasi ke
          // canViewAssetMaintenance, sementara PIC Lokasi tidak selalu
          // punya akses itu).
          if (!isLocationPicRole) return;
          console.info("[Asset Create] stage=location_pic_log START", { assetId: assetRef.id });
          await addDoc(collection(db, "asset_logs"), {
            assetId: assetRef.id,
            locationId: picLocationId,
            actorUid: currentUserUid,
            createdByUid: currentUserUid,
            action: "asset_created_by_location_pic",
            timestamp: serverTimestamp(),
          });
          console.info("[Asset Create] stage=location_pic_log SUCCESS", { assetId: assetRef.id });
        })(),
        (async () => {
          console.info("[Asset Create] stage=notification START", { assetId: assetRef.id });
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
                message: `${assetName.trim()} (${allocation.assetCode}) ditambahkan oleh ${assetUser?.name || "seseorang"}.`,
                type: "asset_created",
                priority: "low",
                linkUrl: `/assets/${assetRef.id}`,
                relatedType: "asset",
                relatedId: assetRef.id,
                relatedNumber: allocation.assetCode,
                createdByUid: assetUser?.uid,
                createdByName: assetUser?.name,
              })
            )
          );
          console.info("[Asset Create] stage=notification SUCCESS", { assetId: assetRef.id });
        })(),
      ]);

      // Section 2/6 (tetap) — kegagalan di sini TIDAK PERNAH boleh membuat
      // halaman ini melapor "Gagal membuat Asset" — dokumen assets sudah
      // tersimpan sebelum titik ini. Tetap di-log LENGKAP (stage/collection/
      // errorCode) sebagai console.warn (bukan .error) supaya jelas ini
      // non-fatal, sesuai section 7/8 ticket "Audit Create Asset".
      additionalResults.forEach((result, index) => {
        if (result.status === "rejected") {
          const { key: stage, collection: collectionName } = SECONDARY_STAGES[index] || {
            key: `stage_${index}`,
            collection: "unknown",
          };
          const e = result.reason as { code?: string; message?: string; name?: string };
          console.warn(`[Asset Create] stage=${stage} FAILED (non-fatal, aset tetap tersimpan)`, {
            stage,
            collection: collectionName,
            assetId: assetRef.id,
            role,
            uid: currentUserUid,
            errorCode: e?.code,
            errorMessage: e?.message,
            errorName: e?.name,
          });
        }
      });

      // Section 8 — PIC Lokasi diarahkan balik ke "Aset Lokasi Saya"
      // (/assets, sudah menampilkan label itu untuk role ini — lihat
      // ProtectedLayout), BUKAN ke halaman detail aset seperti Admin/QHSE.
      // Pesan sukses dibawa lewat query param supaya tetap terlihat setelah
      // redirect (pola sama dengan /my-reports?submitted=1).
      console.info("[Asset Create] stage=redirect", { assetId: assetRef.id, isLocationPicRole });
      if (isLocationPicRole) {
        router.push("/assets?created=1");
      } else {
        setToast({ type: "success", message: "Asset berhasil ditambahkan." });
        router.push(`/assets/${assetRef.id}`);
      }
    } catch (err) {
      // Section 6 — kalau assetCreated sudah true, dokumen assets SUDAH
      // tersimpan sebelum error ini terjadi (pasti dari salah satu proses
      // tambahan yang lolos dari Promise.allSettled-nya sendiri, mis. error
      // sinkron yang tidak sempat ketangkap) — jangan pernah tampilkan
      // pesan gagal, tetap anggap berhasil dan redirect.
      if (assetCreated) {
        console.warn("[Asset Create] aset sudah tersimpan, hanya proses tambahan yang gagal", err);
        if (isLocationPicRole) {
          router.push("/assets?created=1");
        } else {
          setToast({ type: "success", message: "Asset berhasil ditambahkan." });
          router.push(`/assets/${pendingAssetIdRef.current}`);
        }
        setSaving(false);
        return;
      }

      // Section 7 — titik ini SEHARUSNYA jarang tercapai: counter/code/
      // asset_document masing-masing sudah punya try/catch + pesan spesifik
      // sendiri (return lebih awal). Kalau tetap sampai sini berarti error
      // TIDAK TERDUGA (mis. dari helper sinkron seperti buildFullPath/
      // resolveAreaPic) — tetap di-log LENGKAP, bukan cuma err mentah,
      // supaya tetap bisa ditelusuri dari console.
      logStageError("unexpected", "unknown", err, {
        documentId: pendingAssetIdRef.current,
        locationId: picLocationId,
      });
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
              {/* Section "Rombak Tambah/Edit Asset" — SATU section berisi
                  semua field pembentuk identitas+lokasi (Nama/Kategori/
                  Tanggal/Qty/Perusahaan/Divisi/Gedung/Lantai/Ruangan/Area),
                  supaya card "Identitas Aset Otomatis" tepat di bawahnya
                  bisa langsung merefleksikan hasilnya tanpa scroll jauh. */}
              <FormSection step={1} title="Identitas & Lokasi Asset">
                <Field label="Nama Aset" required error={fieldErrors.assetName}>
                  <input
                    id="field-assetName"
                    value={assetName}
                    onChange={(e) => setAssetName(e.target.value)}
                    className={errCls(!!fieldErrors.assetName)}
                  />
                </Field>
                <Field label="Kategori" required error={fieldErrors.categoryId}>
                  <select
                    id="field-categoryId"
                    value={categoryId}
                    onChange={(e) => setCategoryId(e.target.value)}
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

                <Field label="Tanggal Perolehan" required error={fieldErrors.purchaseDate}>
                  <input
                    id="field-purchaseDate"
                    type="date"
                    value={purchaseDate}
                    onChange={(e) => setPurchaseDate(e.target.value)}
                    className={errCls(!!fieldErrors.purchaseDate)}
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
                    value={quantity}
                    onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))}
                    className={errCls(!!fieldErrors.quantity)}
                  />
                </Field>

                <Field
                  label="Perusahaan/Brand Pemilik"
                  required
                  error={fieldErrors.companyOwnerId}
                  hint={brands.length === 0 ? "Tidak ada data perusahaan/brand dari HRP." : undefined}
                >
                  <SearchableSelect
                    id="field-companyOwnerId"
                    items={brandItems}
                    value={companyOwnerId}
                    onChange={handleCompanyChange}
                    placeholder="Pilih perusahaan/brand"
                    searchPlaceholder="Cari brand..."
                    emptyText="Tidak ada brand yang cocok."
                    error={!!fieldErrors.companyOwnerId}
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

                <div className="sm:col-span-2" id="field-location">
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
                      errorLevel={locationErrorLevel}
                    />
                  )}
                  {fieldErrors.location && (
                    <p className="mt-1 text-xs text-red-600">{fieldErrors.location}</p>
                  )}
                </div>
              </FormSection>

              {/* Section "Urutan Form Create/Edit ikuti dependency" — No./
                  Kode Aset/QR TIDAK PERNAH diisi manual, jadi sengaja bukan
                  bagian dari Section 1/2 (yang isinya field yang memang
                  perlu diisi user) — ditaruh di sini, PERSIS setelah
                  Perusahaan & Lokasi terisi, supaya user tidak perlu scroll
                  balik ke atas atau ke sidebar untuk tahu hasilnya. */}
              <div id="field-assetCode" className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100">
                  <h2 className="text-sm font-semibold text-slate-800">Identitas Aset Otomatis</h2>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    Dibuat Otomatis
                  </span>
                </div>
                {missingCodeFields.length === 0 && !codeNotReadyReason ? (
                  <div className="flex flex-col divide-y divide-slate-100 sm:grid sm:grid-cols-[20%_55%_25%] sm:divide-y-0 sm:divide-x">
                    <div className="flex flex-col justify-center px-4 py-3">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">No. Aset</p>
                      <p className="mt-0.5 text-xl font-bold text-slate-900">
                        {codeGenerating ? "…" : assetNumber !== null ? assetNumber : "-"}
                      </p>
                    </div>
                    <div className="flex flex-col justify-center px-4 py-3 min-w-0">
                      <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">Kode Aset</p>
                      <div className="mt-0.5 flex items-center gap-2 min-w-0">
                        <p
                          className={`truncate font-mono text-sm font-semibold ${
                            fieldErrors.assetCode ? "text-red-600" : "text-slate-900"
                          }`}
                          title={assetCode}
                        >
                          {codeGenerating ? "Membuat kode..." : assetCode || "-"}
                        </p>
                        {assetCode && !codeGenerating && (
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
                      {assetCode ? (
                        <>
                          <div className="shrink-0 rounded-lg border border-slate-200 bg-slate-50 p-1">
                            <QRCodeSVG
                              value={assetCode}
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
                        <p className="text-xs text-slate-400">Menyiapkan...</p>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="px-4 py-3">
                    <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5">
                      {missingCodeFields.length === 1 ? (
                        <p className="text-sm font-medium text-amber-800">
                          {missingCodeFields[0] === "Tanggal Perolehan"
                            ? "Isi Tanggal Perolehan untuk membuat Kode Aset."
                            : `Pilih ${missingCodeFields[0]} untuk membuat Kode Aset.`}
                        </p>
                      ) : missingCodeFields.length > 1 ? (
                        <>
                          <p className="text-sm font-medium text-amber-800">Kode Aset belum dapat dibuat</p>
                          <p className="mt-2 text-xs text-amber-700">Masih diperlukan:</p>
                          <ul className="mt-1 list-inside list-disc text-xs text-amber-700">
                            {missingCodeFields.map((f) => (
                              <li key={f}>{f}</li>
                            ))}
                          </ul>
                        </>
                      ) : (
                        <p className="text-sm font-medium text-amber-800">{codeNotReadyReason}</p>
                      )}
                    </div>
                  </div>
                )}
                {fieldErrors.assetCode && (
                  <p className="px-4 pb-3 text-xs text-red-600">{fieldErrors.assetCode}</p>
                )}
              </div>

              {qrModalOpen && (
                <QrLabelModal asset={qrPreviewAsset} open={qrModalOpen} onClose={() => setQrModalOpen(false)} />
              )}

              <FormSection step={2} title="Dokumentasi Asset">
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
                <Field label="Bukti Fisik Aset" full hint="Catatan verifikasi fisik, mis. tanggal ditemukan/dihapuskan.">
                  <input
                    value={physicalEvidence}
                    onChange={(e) => setPhysicalEvidence(e.target.value)}
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
                    value={inventoryNumber}
                    onChange={(e) => setInventoryNumber(e.target.value)}
                    className="input"
                  />
                </Field>
              </FormSection>

              <FormSection step={3} title="Pengelolaan Asset">
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
              <FormSection step={4} title="Informasi Keuangan">
                <Field label="Harga Perolehan">
                  <CurrencyInput value={purchasePrice} onChange={setPurchasePrice} />
                </Field>
                <Field label="Vendor">
                  <input
                    value={vendorName}
                    onChange={(e) => setVendorName(e.target.value)}
                    className="input"
                  />
                </Field>
                <Field label="Status Invoice">
                  <select
                    value={invoiceStatus}
                    onChange={(e) => {
                      const next = e.target.value as InvoiceStatus | "";
                      setInvoiceStatus(next);
                      // Nomor/Bukti Invoice hanya relevan saat "Ada Invoice" —
                      // pindah ke status lain mengosongkan state sementara ini
                      // (belum ada asset tersimpan di Create, jadi aman
                      // langsung direset, bukan cuma disembunyikan).
                      if (next !== "ada") {
                        setInvoiceNumber("");
                        setInvoice(null);
                      }
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
                {invoiceStatus === "ada" && (
                  <>
                    <Field label="Nomor Invoice">
                      <input
                        value={invoiceNumber}
                        onChange={(e) => setInvoiceNumber(e.target.value)}
                        className="input"
                      />
                    </Field>
                    <Field label="Bukti Invoice" full>
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
                  </>
                )}
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
                step={5}
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
                    id="field-condition"
                    value={condition}
                    onChange={(e) => setCondition(e.target.value as AssetCondition)}
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

              <FormSection
                step={6}
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
                    <dt className="text-xs text-slate-400">No. Aset</dt>
                    <dd className="font-medium text-slate-800">{assetNumber !== null ? assetNumber : "-"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-400">Kode Aset</dt>
                    <dd className="font-medium text-slate-800 break-all">{assetCode || "-"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-400">Kategori</dt>
                    <dd className="font-medium text-slate-800">
                      {category?.categoryName || "-"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-400">Perusahaan</dt>
                    <dd className="font-medium text-slate-800">
                      {companyOwner?.name || "-"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-400">Lokasi</dt>
                    <dd className="font-medium text-slate-800">
                      {[locationSelection.buildingName, locationSelection.floorName, locationSelection.roomName]
                        .filter(Boolean)
                        .join(" / ") || "-"}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-400">Status Asset</dt>
                    <dd className="font-medium text-slate-800">
                      {ASSET_STATUS_LABEL[assetStatus]}
                    </dd>
                  </div>
                </dl>
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
