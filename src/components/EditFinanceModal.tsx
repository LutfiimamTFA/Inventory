"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { writeAssetLog } from "@/lib/firestore-helpers";
import { Asset, FundingSource, InvoiceStatus } from "@/lib/types";
import { INVOICE_STATUS_LABEL } from "@/lib/assets/inventory";
import { diffAssetFields, buildAssetChangeSummary } from "@/lib/assets/audit-log";
import { Field } from "@/components/FormSection";
import CurrencyInput from "@/components/CurrencyInput";
import FileUploadField, { FileUploadValue } from "@/components/FileUploadField";
import { ToastState } from "@/components/Toast";

// Section "Riwayat Aktivitas" — field yang diikutkan diff audit log dari
// modal ini (lihat lib/assets/audit-log.ts).
const AUDITED_FINANCE_FIELDS = [
  "acquisitionDate", "purchaseDate",
  "acquisitionPrice", "purchasePrice",
  "invoiceStatus", "invoiceNumber",
  "invoiceFileUrl", "invoiceFileName", "invoiceDriveFileId",
  "vendorName", "fundingSource", "purchaseMethod", "estimatedUsefulLife", "financeNotes",
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

interface FinanceForm {
  purchaseDate: string;
  purchasePrice: number | undefined;
  invoiceStatus: InvoiceStatus | "";
  vendorName: string;
  invoiceNumber: string;
  invoiceFileUrl: string;
  invoiceFileName: string;
  invoiceDriveFileId: string;
  invoiceMimeType: string;
  invoiceSize: number | undefined;
  invoiceUploadedAt: unknown;
  fundingSource: FundingSource | "";
  purchaseMethod: string;
  estimatedUsefulLife: string;
  financeNotes: string;
}

function formFromAsset(asset: Asset): FinanceForm {
  return {
    // acquisitionDate/acquisitionPrice adalah field asal Excel (Tanggal/Harga
    // Perolehan) — diprioritaskan sebagai source of truth, fallback ke
    // purchaseDate/purchasePrice lama untuk aset yang dibuat manual sebelum
    // field acquisition* ada.
    purchaseDate: asset.acquisitionDate || asset.purchaseDate || "",
    purchasePrice: asset.acquisitionPrice ?? asset.purchasePrice,
    invoiceStatus: asset.invoiceStatus || "",
    vendorName: asset.vendorName || "",
    invoiceNumber: asset.invoiceNumber || "",
    invoiceFileUrl: asset.invoiceFileUrl || "",
    invoiceFileName: asset.invoiceFileName || "",
    invoiceDriveFileId: asset.invoiceDriveFileId || "",
    invoiceMimeType: asset.invoiceMimeType || "",
    invoiceSize: asset.invoiceSize,
    invoiceUploadedAt: asset.invoiceUploadedAt,
    fundingSource: asset.fundingSource || "",
    purchaseMethod: asset.purchaseMethod || "",
    estimatedUsefulLife: asset.estimatedUsefulLife || "",
    financeNotes: asset.financeNotes || "",
  };
}

export default function EditFinanceModal({
  open,
  asset,
  onClose,
  onSaved,
}: {
  open: boolean;
  asset: Asset | null;
  onClose: () => void;
  onSaved: (toast: ToastState) => void;
}) {
  const { firebaseUser, assetUser, role } = useAuth();
  const [form, setForm] = useState<FinanceForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [invoiceUploading, setInvoiceUploading] = useState(false);

  // "Adjust state during render" (BUKAN useEffect) — form direset ke data
  // asset terbaru setiap kali modal berpindah dari tertutup ke terbuka.
  const [prevOpen, setPrevOpen] = useState(false);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open && asset) setForm(formFromAsset(asset));
  }

  if (!open || !asset || !form) return null;

  const set = <K extends keyof FinanceForm>(key: K, value: FinanceForm[K]) => {
    setForm((prev) => (prev ? { ...prev, [key]: value } : prev));
  };

  const invoiceValue: FileUploadValue | null = form.invoiceFileUrl
    ? { url: form.invoiceFileUrl, driveFileId: form.invoiceDriveFileId, fileName: form.invoiceFileName || "invoice", size: form.invoiceSize }
    : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (invoiceUploading) {
      onSaved({ type: "error", message: "Tunggu proses upload invoice selesai sebelum menyimpan." });
      return;
    }

    setSaving(true);
    try {
      const financePayload = {
        // Dual-write ke acquisitionDate/acquisitionPrice/invoiceStatus (field
        // asal Excel, source of truth utama untuk Harga/Tanggal/Invoice —
        // dibaca di Finance section, Finance-role table, dan tabel Asset
        // umum) SEKALIGUS ke purchaseDate/purchasePrice/invoiceNumber lama
        // supaya tidak ada field yang diam-diam jadi stale kalau ada bagian
        // lain project yang masih membaca nama field lama.
        purchaseDate: form.purchaseDate || null,
        purchasePrice: form.purchasePrice ?? null,
        acquisitionDate: form.purchaseDate || null,
        acquisitionPrice: form.purchasePrice ?? null,
        invoiceStatus: form.invoiceStatus || null,
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

        fundingSource: form.fundingSource || "",
        purchaseMethod: form.purchaseMethod || "",
        estimatedUsefulLife: form.estimatedUsefulLife || "",
        financeNotes: form.financeNotes || "",

        financeStatus:
          form.purchasePrice || form.invoiceNumber || form.invoiceFileUrl ? "complete" : "pending_finance",

        financeUpdatedAt: serverTimestamp(),
        financeUpdatedByUid: firebaseUser?.uid || "",
        financeUpdatedByName: assetUser?.name || firebaseUser?.email || "",

        updatedAt: serverTimestamp(),
        updatedByUid: firebaseUser?.uid || "",
        updatedByName: assetUser?.name || firebaseUser?.email || "",
      };

      await updateDoc(doc(db, "assets", asset.id), financePayload);

      // Section "Riwayat Aktivitas" — audit log field-level, sama seperti
      // jalur Edit Aset umum (lib/assets/audit-log.ts), supaya perubahan
      // lewat modal cepat "Edit Data Finance" ini juga tercatat siapa/kapan/
      // field apa/nilai lama-baru, bukan cuma lewat halaman Edit Aset penuh.
      const auditChanges = diffAssetFields(
        asset as unknown as Record<string, unknown>,
        financePayload as unknown as Record<string, unknown>,
        AUDITED_FINANCE_FIELDS
      );
      await writeAssetLog({
        assetId: asset.id,
        assetName: asset.assetName,
        assetCode: asset.assetCode,
        action: "update",
        userUid: firebaseUser?.uid || "",
        userName: assetUser?.name || firebaseUser?.email || "",
        editedByRole: role || "",
        detail: auditChanges.length > 0 ? buildAssetChangeSummary(auditChanges) : "Data finance diperbarui (tidak ada field yang berubah nilainya)",
        changedFields: auditChanges.map((c) => c.field),
        before: Object.fromEntries(auditChanges.map((c) => [c.field, (asset as unknown as Record<string, unknown>)[c.field] ?? null])),
        after: Object.fromEntries(auditChanges.map((c) => [c.field, (financePayload as unknown as Record<string, unknown>)[c.field] ?? null])),
      });

      onSaved({ type: "success", message: "Data finance aset berhasil disimpan." });
      onClose();
    } catch (err) {
      console.error("[Edit Finance Modal] error:", err);
      onSaved({ type: "error", message: "Gagal menyimpan data finance." });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={saving ? undefined : onClose} />
      <form
        onSubmit={handleSubmit}
        className="relative flex max-h-[90vh] w-[92vw] max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg"
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Edit Data Finance</h2>
            <p className="mt-0.5 text-sm text-slate-500">{asset.assetName} · {asset.assetCode}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="shrink-0 cursor-pointer rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="grid gap-x-5 gap-y-4 sm:grid-cols-2">
            <Field label="Tanggal Perolehan">
              <input
                type="date"
                value={form.purchaseDate}
                onChange={(e) => set("purchaseDate", e.target.value)}
                className="input"
              />
            </Field>
            <Field label="Harga Perolehan">
              <CurrencyInput value={form.purchasePrice} onChange={(v) => set("purchasePrice", v)} />
            </Field>
            <Field label="Status Invoice">
              <select
                value={form.invoiceStatus}
                onChange={(e) => {
                  const next = e.target.value as InvoiceStatus | "";
                  // Nomor/Bukti Invoice cuma relevan saat "Ada Invoice" —
                  // pindah ke status lain mengosongkan state form ini.
                  // Relasi ke file Drive existing baru benar-benar hilang
                  // dari data asset setelah user klik Simpan; file-nya
                  // sendiri di Drive tidak pernah dihapus dari sini.
                  setForm((prev) =>
                    prev
                      ? {
                          ...prev,
                          invoiceStatus: next,
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
                      : prev
                  );
                }}
                className="input"
              >
                <option value="">Belum diisi</option>
                {(Object.keys(INVOICE_STATUS_LABEL) as InvoiceStatus[]).map((status) => (
                  <option key={status} value={status}>
                    {INVOICE_STATUS_LABEL[status]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Vendor">
              <input
                value={form.vendorName}
                onChange={(e) => set("vendorName", e.target.value)}
                className="input"
              />
            </Field>
            {form.invoiceStatus === "ada" && (
              <>
                <Field label="Nomor Invoice">
                  <input
                    value={form.invoiceNumber}
                    onChange={(e) => set("invoiceNumber", e.target.value)}
                    className="input"
                  />
                </Field>
                <Field label="Upload Invoice / Bukti Pembelian" full>
                  <FileUploadField
                    kind="file"
                    uploadType="invoice"
                    accept={["pdf", "jpg", "jpeg", "png"]}
                    maxSizeMB={10}
                    value={invoiceValue}
                    meta={{ assetCode: asset.assetCode, assetName: asset.assetName }}
                    onUploadStateChange={setInvoiceUploading}
                    onUploaded={(result) => {
                      set("invoiceFileUrl", result.url);
                      set("invoiceFileName", result.fileName);
                      set("invoiceDriveFileId", result.fileId);
                      set("invoiceMimeType", result.mimeType || "");
                      set("invoiceSize", result.size);
                      set("invoiceUploadedAt", result.uploadedAt);
                    }}
                    onRemove={() => {
                      set("invoiceFileUrl", "");
                      set("invoiceFileName", "");
                      set("invoiceDriveFileId", "");
                    }}
                    onError={(msg) => onSaved({ type: "error", message: msg })}
                  />
                </Field>
              </>
            )}
            <Field label="Sumber Dana">
              <select
                value={form.fundingSource}
                onChange={(e) => set("fundingSource", e.target.value as FundingSource)}
                className="input"
              >
                <option value="">Pilih sumber dana</option>
                {FUNDING_OPTIONS.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Metode Pembelian">
              <input
                value={form.purchaseMethod}
                onChange={(e) => set("purchaseMethod", e.target.value)}
                className="input"
              />
            </Field>
            <Field label="Estimasi Umur" hint="mis. 3 tahun">
              <input
                value={form.estimatedUsefulLife}
                onChange={(e) => set("estimatedUsefulLife", e.target.value)}
                className="input"
              />
            </Field>
            <Field label="Catatan Finance" full>
              <textarea
                value={form.financeNotes}
                onChange={(e) => set("financeNotes", e.target.value)}
                className="input"
                rows={2}
              />
            </Field>
          </div>
        </div>

        <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-100 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-xl px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Batal
          </button>
          <button
            type="submit"
            disabled={saving || invoiceUploading}
            className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {saving ? "Menyimpan..." : "Simpan Data Finance"}
          </button>
        </div>
      </form>
    </div>
  );
}
