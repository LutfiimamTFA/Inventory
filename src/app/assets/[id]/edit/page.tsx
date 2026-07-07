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
import { db, EMPLOYEE_PROFILES_COLLECTION } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import {
  Asset,
  AssetCategory,
  AssetCondition,
  AssetStatus,
  EmployeeProfile,
  FundingSource,
  HrpBrand,
  HrpDivision,
  OwnershipStatus,
} from "@/lib/types";
import { fetchHrpBrands, fetchHrpDivisions } from "@/lib/hrp";
import { isAssetCodeTaken, writeAssetLog } from "@/lib/firestore-helpers";
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

export default function EditAssetPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { assetUser } = useAuth();
  const [asset, setAsset] = useState<Asset | null>(null);
  const [categories, setCategories] = useState<AssetCategory[]>([]);
  const [employees, setEmployees] = useState<EmployeeProfile[]>([]);
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

  useEffect(() => {
    getDoc(doc(db, "assets", id)).then((snap) => {
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
    });
  }, [id]);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "asset_categories"), (snap) => {
      setCategories(
        snap.docs.map((d) => ({ id: d.id, ...d.data() } as AssetCategory))
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
  }, [form.companyOwnerId]);

  const set = <K extends keyof Asset>(key: K, value: Asset[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const handleCompanyChange = (value: string) => {
    set("companyOwnerId", value);
    set("divisionOwnerId", "");
    setDivisions([]);
    setLoadingDivisions(!!value);
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
    () => employees.find((e) => e.uid === form.responsiblePersonUid),
    [employees, form.responsiblePersonUid]
  );

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
    if (!asset) return;

    if (photoUploading || invoiceUploading) {
      setError("Tunggu proses upload file selesai sebelum menyimpan.");
      return;
    }

    const errors: Record<string, string> = {};
    if (!form.assetName?.trim()) errors.assetName = "Nama aset wajib diisi.";
    if (!form.assetCode?.trim()) errors.assetCode = "Kode aset wajib diisi.";
    if (!form.categoryId) errors.categoryId = "Kategori wajib dipilih.";
    if (!form.brand?.trim()) errors.brand = "Merk wajib diisi.";
    if (!form.model?.trim()) errors.model = "Model/Tipe wajib diisi.";
    if (!form.companyOwnerId) errors.companyOwnerId = "Perusahaan/Brand wajib dipilih.";
    if (!form.location?.trim()) errors.location = "Lokasi wajib diisi.";
    if (!form.ownershipStatus) errors.ownershipStatus = "Status kepemilikan wajib dipilih.";
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
        location: form.location || "",
        responsiblePersonUid: form.responsiblePersonUid || null,
        responsiblePersonName:
          responsiblePerson?.name || form.responsiblePersonName || "",
        responsiblePersonEmail:
          responsiblePerson?.email || form.responsiblePersonEmail || "",
        responsiblePersonDivision:
          (responsiblePerson?.divisionName as string) || form.responsiblePersonDivision || "",
        responsiblePersonJobTitle:
          (responsiblePerson?.jobTitle as string) ||
          (responsiblePerson?.jabatan as string) ||
          form.responsiblePersonJobTitle ||
          "",
        ownershipStatus: form.ownershipStatus,

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
                <Field label="Lokasi" required error={fieldErrors.location}>
                  <input
                    value={form.location || ""}
                    onChange={(e) => set("location", e.target.value)}
                    className="input"
                  />
                </Field>
                <Field label="Penanggung Jawab">
                  <SearchableSelect
                    items={employeeItems}
                    value={form.responsiblePersonUid || ""}
                    onChange={(v) => set("responsiblePersonUid", v)}
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

              <FormSection step={4} title="Tracking & QR">
                <Field
                  label="Status Asset"
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
                    {ASSET_STATUS_OPTIONS.map((s) => (
                      <option key={s} value={s}>
                        {ASSET_STATUS_LABEL[s]}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Kondisi Asset" required error={fieldErrors.condition}>
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
