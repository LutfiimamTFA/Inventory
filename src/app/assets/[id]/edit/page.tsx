"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { QRCodeSVG } from "qrcode.react";
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
  OwnershipStatus,
} from "@/lib/types";
import { fetchHrpBrands, fetchHrpDivisions } from "@/lib/hrp";
import {
  EmployeeOption,
  fetchActiveEmployeeOptions,
  fetchActiveUsersByRoles,
  isAssetCodeTaken,
  writeAssetLog,
} from "@/lib/firestore-helpers";
import { buildChangeMessage, buildChangeSummary, createAssetNotification } from "@/lib/notifications";
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
import LocationCascadeFields, { LocationSelection } from "@/components/LocationCascadeFields";
import PicLocationField from "@/components/PicLocationField";
import FileUploadField from "@/components/FileUploadField";
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

const CONDITION_OPTIONS: AssetCondition[] = [
  "new",
  "good",
  "fair",
  "minor_damage",
  "heavy_damage",
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
  const [toast, setToast] = useState<ToastState | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [invoiceUploading, setInvoiceUploading] = useState(false);

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

  const handlePicLocationSelect = (nodeId: string) => {
    setSelectedPicLocationId(nodeId);
    if (!nodeId) return;
    handleLocationSelectionChange(resolveLocationSelectionForNode(locations, nodeId));
  };

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

    // Asset Finance HANYA boleh mengubah field finance (lihat
    // isAssetFinanceUpdate di firestore.rules) — jalur submit ini WAJIB
    // terpisah dan berjalan SEBELUM validasi field fisik (assetName,
    // categoryId, lokasi, PIC, condition, dst) supaya tidak pernah mengirim
    // field non-finance yang bikin updateDoc kena "Missing or insufficient
    // permissions".
    if (isFinanceOnlyRole) {
      setSaving(true);
      setError("");
      setFieldErrors({});

      try {
        const financePayload = {
          purchaseDate: form.purchaseDate || null,
          purchasePrice: form.purchasePrice ?? null,
          vendorName: form.vendorName || "",
          invoiceNumber: form.invoiceNumber || "",

          invoiceFileUrl: form.invoiceFileUrl || "",
          invoiceFileName: form.invoiceFileName || "",
          invoiceDriveFileId: form.invoiceDriveFileId || "",
          invoiceMimeType: form.invoiceMimeType || "",
          invoiceSize: form.invoiceSize ?? null,
          invoiceUploadedAt: form.invoiceUploadedAt || null,

          fundingSource: form.fundingSource || "",
          purchaseMethod: form.purchaseMethod || "",
          estimatedUsefulLife: form.estimatedUsefulLife || "",
          financeNotes: form.financeNotes || "",

          financeStatus:
            form.purchasePrice || form.invoiceNumber || form.invoiceFileUrl
              ? "complete"
              : "pending_finance",

          financeUpdatedAt: serverTimestamp(),
          financeUpdatedByUid: firebaseUser?.uid || "",
          financeUpdatedByName: assetUser?.name || firebaseUser?.email || "",

          updatedAt: serverTimestamp(),
          updatedByUid: firebaseUser?.uid || "",
          updatedByName: assetUser?.name || firebaseUser?.email || "",
        };

        console.log("[Asset Finance Submit]", {
          role,
          assetId: asset.id,
          financePayloadKeys: Object.keys(financePayload),
          financePayload,
        });

        await updateDoc(doc(db, "assets", asset.id), financePayload);

        setToast({
          type: "success",
          message: "Data finance aset berhasil disimpan.",
        });

        router.push(`/assets/${asset.id}`);
        return;
      } catch (err) {
        console.error("[Asset Finance Submit ERROR]", err);
        setError("Gagal menyimpan data finance.");
        setToast({
          type: "error",
          message: "Gagal menyimpan data finance.",
        });
        return;
      } finally {
        setSaving(false);
      }
    }

    const errors: Record<string, string> = {};
    if (!form.assetName?.trim()) errors.assetName = "Nama aset wajib diisi.";
    if (!form.assetCode?.trim()) errors.assetCode = "Kode aset wajib diisi.";
    if (!form.categoryId) errors.categoryId = "Kategori wajib dipilih.";
    if (!form.brand?.trim()) errors.brand = "Merk wajib diisi.";
    if (!form.model?.trim()) errors.model = "Model/Tipe wajib diisi.";
    if (!form.companyOwnerId) errors.companyOwnerId = "Perusahaan/Brand wajib dipilih.";
    if (isLocationPicRole) {
      if (!selectedPicLocationId) errors.location = "Lokasi tanggung jawab wajib dipilih.";
    } else if (!form.buildingId) {
      errors.location = "Gedung wajib dipilih.";
    } else if (!form.floorId) {
      errors.location = "Lantai wajib dipilih.";
    } else if (!form.roomId) {
      errors.location = "Ruangan wajib dipilih.";
    }
    if (!form.ownershipStatus) errors.ownershipStatus = "Status kepemilikan wajib dipilih.";
    if (trackingMode === "assigned_pic" && !form.responsiblePersonUid)
      errors.responsiblePersonUid = "PIC Operasional wajib dipilih untuk aset dengan PIC.";
    if (!form.assetStatus) errors.assetStatus = "Status aset wajib dipilih.";
    if (!form.condition) errors.condition = "Kondisi aset wajib dipilih.";

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setError("Lengkapi field yang wajib diisi.");
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
      if (form.assetCode?.trim() !== asset.assetCode) {
        const taken = await isAssetCodeTaken(form.assetCode!.trim(), asset.id);
        if (taken) {
          setFieldErrors({ assetCode: "Kode asset sudah digunakan." });
          setError("Kode asset sudah digunakan.");
          setSaving(false);
          return;
        }
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

      await updateDoc(doc(db, "assets", asset.id), {
        assetName: form.assetName,
        assetCode: form.assetCode,
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
        invoiceNumber: form.invoiceNumber || "",
        invoiceFileUrl: form.invoiceFileUrl || "",
        invoiceFileName: form.invoiceFileName || "",
        invoiceDriveFileId: form.invoiceDriveFileId || "",
        invoiceMimeType: form.invoiceMimeType || "",
        invoiceSize: form.invoiceSize ?? null,
        invoiceUploadedAt: form.invoiceUploadedAt || null,
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
        qrCodeValue: form.assetCode,

        updatedAt: serverTimestamp(),
      });

      await writeAssetLog({
        assetId: asset.id,
        assetName: form.assetName || asset.assetName,
        assetCode: form.assetCode || asset.assetCode,
        action: "update",
        userUid: assetUser?.uid || "",
        userName: assetUser?.name || "",
        detail: "Data aset diperbarui",
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
              <fieldset disabled={isFinanceOnlyRole} className="space-y-5 disabled:opacity-60">
              <FormSection step={1} title="Informasi Aset">
                <Field label="Nama Aset" required error={fieldErrors.assetName}>
                  <input
                    value={form.assetName || ""}
                    onChange={(e) => set("assetName", e.target.value)}
                    className="input"
                  />
                </Field>
                <Field label="Kategori" required error={fieldErrors.categoryId}>
                  <select
                    value={form.categoryId || ""}
                    onChange={(e) => set("categoryId", e.target.value)}
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
                  hint="Ubah dengan hati-hati — kode ini tercetak di QR yang sudah ditempel ke aset."
                >
                  <input
                    value={form.assetCode || ""}
                    onChange={(e) => set("assetCode", e.target.value)}
                    className="input"
                  />
                </Field>
                <Field label="Subkategori">
                  <input
                    value={form.subCategory || ""}
                    onChange={(e) => set("subCategory", e.target.value)}
                    className="input"
                  />
                </Field>
                <Field label="Merk" required error={fieldErrors.brand}>
                  <input
                    value={form.brand || ""}
                    onChange={(e) => set("brand", e.target.value)}
                    className="input"
                  />
                </Field>
                <Field label="Model/Tipe" required error={fieldErrors.model}>
                  <input
                    value={form.model || ""}
                    onChange={(e) => set("model", e.target.value)}
                    className="input"
                  />
                </Field>
                <Field label="Serial Number">
                  <input
                    value={form.serialNumber || ""}
                    onChange={(e) => set("serialNumber", e.target.value)}
                    className="input"
                  />
                </Field>
                <Field label="IMEI">
                  <input
                    value={form.imei || ""}
                    onChange={(e) => set("imei", e.target.value)}
                    className="input"
                  />
                </Field>
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
                    value={form.companyOwnerId || ""}
                    onChange={handleCompanyChange}
                    placeholder="Pilih perusahaan/brand"
                    searchPlaceholder="Cari brand..."
                    emptyText="Tidak ada brand yang cocok."
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
                    disabled={!form.companyOwnerId || loadingDivisions}
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
                  {form.location && !form.buildingId && (
                    <p className="mb-2 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                      Asset ini masih memakai lokasi lama. Pilih Lokasi Asset dari Master Lokasi
                      untuk sinkronisasi.
                    </p>
                  )}
                  {isLocationPicRole ? (
                    <PicLocationField
                      assignedPicLocations={myPicLocations}
                      locations={locations}
                      selectedLocationId={selectedPicLocationId}
                      onSelectLocation={handlePicLocationSelect}
                    />
                  ) : (
                    <LocationCascadeFields
                      locations={scopedLocations}
                      value={locationSelection}
                      onChange={handleLocationSelectionChange}
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
                <Field
                  label="Mode Tracking Aset"
                  hint={TRACKING_MODE_OPTIONS.find((o) => o.value === trackingMode)?.hint}
                >
                  <select
                    value={trackingMode}
                    onChange={(e) => set("trackingMode", e.target.value as TrackingMode)}
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
                    value={form.responsiblePersonUid || ""}
                    onChange={(v) => set("responsiblePersonUid", v)}
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
                    value={form.ownershipStatus || "Aset Perusahaan"}
                    onChange={(e) =>
                      set("ownershipStatus", e.target.value as OwnershipStatus)
                    }
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
              </fieldset>

              {canViewFinanceEdit && (
              <FormSection step={3} title="Finance / Bukti Pembelian">
                <Field label="Tanggal Pembelian">
                  <input
                    type="date"
                    value={form.purchaseDate || ""}
                    onChange={(e) => set("purchaseDate", e.target.value)}
                    className="input"
                  />
                </Field>
                <Field label="Harga Beli">
                  <CurrencyInput
                    value={form.purchasePrice ?? undefined}
                    onChange={(v) => set("purchasePrice", v as number)}
                  />
                </Field>
                <Field label="Vendor">
                  <input
                    value={form.vendorName || ""}
                    onChange={(e) => set("vendorName", e.target.value)}
                    className="input"
                  />
                </Field>
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

              <fieldset disabled={isFinanceOnlyRole} className="space-y-5 disabled:opacity-60">
              <FormSection
                step={4}
                title="Kondisi & Status Aset"
                description="Kondisi fisik dan status operasional barang — TERPISAH dari status pemakaian (Dipinjam/Tersedia diatur otomatis lewat proses pinjam/kembali)."
              >
                <Field
                  label="Status Operasional Aset"
                  required
                  error={fieldErrors.assetStatus}
                  hint={
                    form.assetStatus ? ASSET_STATUS_HELPER[form.assetStatus] : undefined
                  }
                >
                  <select
                    value={form.assetStatus || "available"}
                    onChange={(e) => set("assetStatus", e.target.value as AssetStatus)}
                    className="input"
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
                    value={form.condition || "good"}
                    onChange={(e) => set("condition", e.target.value as AssetCondition)}
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

              <FormSection step={5} title="Pengaturan Pemakaian Aset">
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
                    <dt className="text-xs text-slate-400">Kode Aset</dt>
                    <dd className="font-medium text-slate-800">{form.assetCode || "-"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-400">Kategori</dt>
                    <dd className="font-medium text-slate-800">
                      {category?.categoryName || form.categoryName || "-"}
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

              <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 flex flex-col items-center">
                <h2 className="font-semibold text-slate-800 mb-4 self-start">
                  Preview QR
                </h2>
                {form.assetCode ? (
                  <div className="p-3 rounded-xl border border-slate-200 bg-slate-50">
                    <QRCodeSVG
                      value={form.assetCode}
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

      <Toast toast={toast} onClose={() => setToast(null)} />
    </ProtectedLayout>
  );
}
