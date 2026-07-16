"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { addDoc, collection, onSnapshot, serverTimestamp } from "firebase/firestore";
import { QRCodeSVG } from "qrcode.react";
import { Wand2, Pencil } from "lucide-react";
import { db, EMPLOYEE_PROFILES_COLLECTION } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import {
  AssetCategory,
  AssetLocationNode,
  AssetStatus,
  AssetCondition,
  DriveUploadResult,
  EmployeeProfile,
  FundingSource,
  HrpBrand,
  HrpDivision,
  OwnershipStatus,
} from "@/lib/types";
import { fetchHrpBrands, fetchHrpDivisions } from "@/lib/hrp";
import {
  generateAssetCode,
  isAssetCodeTaken,
  writeAssetLog,
} from "@/lib/firestore-helpers";
import { buildFullPath } from "@/lib/locations";
import {
  ASSET_STATUS_HELPER,
  ASSET_STATUS_LABEL,
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
import FileUploadField from "@/components/FileUploadField";
import { Toast, ToastState } from "@/components/Toast";

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

const ASSET_STATUS_OPTIONS: AssetStatus[] = [
  "available",
  "borrowed",
  "in_use",
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
  const { assetUser } = useAuth();
  const router = useRouter();
  const [categories, setCategories] = useState<AssetCategory[]>([]);
  const [employees, setEmployees] = useState<EmployeeProfile[]>([]);
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
    () => employees.find((e) => e.uid === responsiblePersonUid),
    [employees, responsiblePersonUid]
  );

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "asset_categories"), (snap) => {
      setCategories(
        snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as AssetCategory))
          .filter((c) => c.status === "active")
      );
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "asset_locations"), (snap) => {
      setLocations(
        snap.docs
          .map((d) => ({ id: d.id, ...d.data() } as AssetLocationNode))
          .filter((n) => n.status === "active")
      );
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, EMPLOYEE_PROFILES_COLLECTION), (snap) => {
      setEmployees(
        snap.docs
          .map((d) => ({ uid: d.id, ...d.data() } as EmployeeProfile))
          .filter((e) => !e.status || e.status === "active")
      );
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    fetchHrpBrands().then(setBrands);
  }, []);

  useEffect(() => {
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
  }, [companyOwnerId]);

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

  const employeeItems: SearchableSelectItem[] = employees.map((e) => {
    const jobTitle = (e.jobTitle as string) || (e.jabatan as string) || "";
    const division = (e.divisionName as string) || "";
    const subParts = [jobTitle, division, e.email].filter(Boolean);
    return {
      id: e.uid,
      label: e.name || e.email,
      sublabel: subParts.join(" · "),
      searchText: [e.name, e.email, jobTitle, division].filter(Boolean).join(" "),
    };
  });

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
    if (!locationSelection.buildingId) errors.location = "Gedung wajib dipilih.";
    else if (!locationSelection.floorId) errors.location = "Lantai wajib dipilih.";
    else if (!locationSelection.roomId) errors.location = "Ruangan wajib dipilih.";
    if (!ownershipStatus) errors.ownershipStatus = "Status kepemilikan wajib dipilih.";
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
        responsiblePersonUid: responsiblePersonUid || null,
        responsiblePersonName: responsiblePerson?.name || "",
        responsiblePersonEmail: responsiblePerson?.email || "",
        responsiblePersonDivision: (responsiblePerson?.divisionName as string) || "",
        responsiblePersonJobTitle:
          (responsiblePerson?.jobTitle as string) || (responsiblePerson?.jabatan as string) || "",
        ownershipStatus,

        purchaseDate: purchaseDate || null,
        purchasePrice: purchasePrice ?? null,
        vendorName: vendorName.trim(),
        invoiceNumber: invoiceNumber.trim(),
        invoiceFileUrl: invoice?.url || "",
        invoiceFileName: invoice?.fileName || "",
        invoiceDriveFileId: invoice?.fileId || "",
        invoiceMimeType: invoice?.mimeType || "",
        invoiceSize: invoice?.size ?? null,
        invoiceUploadedAt: invoice?.uploadedAt || null,
        fundingSource,
        purchaseMethod: purchaseMethod.trim(),
        estimatedUsefulLife: estimatedUsefulLife.trim(),
        financeNotes: financeNotes.trim(),

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
                  <LocationCascadeFields
                    locations={locations}
                    value={locationSelection}
                    onChange={setLocationSelection}
                  />
                  {fieldErrors.location && (
                    <p className="mt-1 text-xs text-red-600">{fieldErrors.location}</p>
                  )}
                </div>
                <Field label="Penanggung Jawab">
                  <SearchableSelect
                    items={employeeItems}
                    value={responsiblePersonUid}
                    onChange={setResponsiblePersonUid}
                    placeholder="Pilih karyawan"
                    searchPlaceholder="Cari nama karyawan..."
                    emptyText="Tidak ada karyawan yang cocok."
                  />
                </Field>
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

              <FormSection
                step={4}
                title="Tracking & QR"
                description="QR Code akan digenerate otomatis dari kode aset."
              >
                <Field
                  label="Status Asset"
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
                <Field label="Kondisi Asset" required error={fieldErrors.condition}>
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
