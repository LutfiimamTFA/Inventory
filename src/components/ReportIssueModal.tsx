"use client";

import { useState } from "react";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { X, UploadCloud, Check } from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { Asset, IssueImpactLevel, IssueSymptomType } from "@/lib/types";
import {
  generateTicketNumber,
  generateQueueNumber,
  IMPACT_TO_PRIORITY,
  writeAssetIssueLog,
  fetchActiveUsersByRole,
} from "@/lib/firestore-helpers";
import { uploadToDrive } from "@/lib/drive-upload";
import { createAssetNotification } from "@/lib/notifications";

const SYMPTOM_OPTIONS: IssueSymptomType[] = [
  "Lemot / Lambat",
  "Memori / Storage Penuh",
  "Tidak Menyala",
  "Tidak Bisa Digunakan",
  "Error Aplikasi / Sistem",
  "Koneksi Bermasalah",
  "Fisik Rusak",
  "Tidak Lengkap",
  "Hilang",
  "Lainnya",
];

const IMPACT_OPTIONS: IssueImpactLevel[] = [
  "Masih Bisa Dipakai",
  "Mengganggu Pekerjaan",
  "Tidak Bisa Dipakai",
  "Darurat",
];

export default function ReportIssueModal({
  asset,
  open,
  onClose,
}: {
  asset: Asset;
  open: boolean;
  onClose: () => void;
}) {
  const { assetUser } = useAuth();
  const [symptomType, setSymptomType] = useState<IssueSymptomType | "">("");
  const [impactLevel, setImpactLevel] = useState<IssueImpactLevel | "">("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [ticketNumber, setTicketNumber] = useState<string | null>(null);

  if (!open) return null;

  const resetAndClose = () => {
    setSymptomType("");
    setImpactLevel("");
    setDescription("");
    setFile(null);
    setError("");
    setTicketNumber(null);
    onClose();
  };

  const handleSubmit = async () => {
    setError("");
    if (!symptomType) {
      setError("Gejala kendala wajib dipilih.");
      return;
    }
    if (!impactLevel) {
      setError("Dampak wajib dipilih.");
      return;
    }
    if (!description.trim()) {
      setError("Catatan kendala wajib diisi.");
      return;
    }

    setSubmitting(true);
    try {
      let attachmentUrls: string[] = [];
      let attachmentFiles: string[] = [];
      if (file) {
        const uploaded = await uploadToDrive(file, "issue_attachment", {
          assetCode: asset.assetCode,
          assetName: asset.assetName,
        });
        attachmentUrls = [uploaded.url];
        attachmentFiles = [uploaded.fileName];
      }

      const ticketNum = await generateTicketNumber();
      const queueNum = await generateQueueNumber();
      const priority = IMPACT_TO_PRIORITY[impactLevel];

      const ticketRef = await addDoc(collection(db, "asset_issue_tickets"), {
        ticketNumber: ticketNum,
        queueNumber: queueNum,
        reportType: "asset_issue",
        source: "staff_report",
        title: `${symptomType} - ${asset.assetName}`,
        assetId: asset.id,
        assetName: asset.assetName,
        assetCode: asset.assetCode,
        assetCategory: asset.categoryName || "",
        assetLocation: asset.locationText || asset.location || "",
        locationId: asset.locationId || asset.areaId || asset.roomId || asset.floorId || asset.buildingId || "",
        buildingId: asset.buildingId || null,
        floorId: asset.floorId || null,
        roomId: asset.roomId || null,
        areaId: asset.areaId || null,
        buildingName: asset.buildingName || "",
        floorName: asset.floor || "",
        roomName: asset.roomName || "",
        areaName: asset.areaName || "",
        locationText: asset.locationText || asset.location || "",
        reportedByUid: assetUser?.uid || "",
        reportedByName: assetUser?.name || "",
        reportedByEmail: assetUser?.email || "",
        reportedAt: serverTimestamp(),
        createdByUid: assetUser?.uid || "",
        createdByName: assetUser?.name || "",
        createdByEmail: assetUser?.email || "",
        symptomType,
        impactLevel,
        description: description.trim(),
        attachmentUrls,
        attachmentFiles,
        photoUrls: attachmentUrls,
        priority,
        status: "reported",
        statusLabel: "Laporan Masuk",
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        updatedByUid: assetUser?.uid || "",
        updatedByName: assetUser?.name || "",
      });

      await writeAssetIssueLog({
        ticketId: ticketRef.id,
        ticketNumber: ticketNum,
        action: "create_ticket",
        newStatus: "reported",
        note: "Laporan kendala dibuat dari Scan QR",
        performedByUid: assetUser?.uid || "",
        performedByName: assetUser?.name || "",
      });

      const assetAdmins = await fetchActiveUsersByRole("asset_admin");
      await Promise.all(
        assetAdmins.map((admin) =>
          createAssetNotification({
            recipientUid: admin.uid,
            recipientName: admin.name,
            recipientRole: "asset_admin",
            title: "Ticket Kendala Baru",
            message: `${asset.assetName} dilaporkan: ${symptomType}`,
            type: "ticket_created",
            priority,
            linkUrl: `/maintenance?tab=staff-reports&ticketId=${ticketRef.id}`,
            relatedType: "ticket",
            relatedId: ticketRef.id,
            relatedNumber: ticketNum,
            createdByUid: assetUser?.uid,
            createdByName: assetUser?.name,
          })
        )
      );

      setTicketNumber(ticketNum);
    } catch (err) {
      console.error("[Report Issue] gagal submit", err);
      setError("Gagal mengirim laporan. Coba lagi.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={resetAndClose} />
      <div className="relative bg-white rounded-2xl shadow-lg border border-slate-200 w-full max-w-lg max-h-[90vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-900">Laporkan Kendala</h2>
          <button
            type="button"
            onClick={resetAndClose}
            className="text-slate-400 hover:text-slate-700 cursor-pointer rounded-lg p-1 hover:bg-slate-100"
          >
            <X size={18} />
          </button>
        </div>

        {ticketNumber ? (
          <div className="text-center py-8">
            <div className="mx-auto mb-4 h-14 w-14 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <Check size={26} />
            </div>
            <p className="text-slate-800 font-medium mb-1">
              Laporan berhasil dikirim. Nomor ticket Anda:
            </p>
            <p className="text-xl font-bold text-slate-900 mb-6">{ticketNumber}</p>
            <button
              type="button"
              onClick={resetAndClose}
              className="rounded-xl bg-slate-900 text-white px-5 py-2.5 text-sm font-medium cursor-pointer hover:bg-slate-800"
            >
              Tutup
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-xl bg-slate-50 border border-slate-200 px-3 py-2">
              <p className="text-sm font-medium text-slate-800">{asset.assetName}</p>
              <p className="text-xs text-slate-400">{asset.assetCode}</p>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">
                Gejala Kendala <span className="text-red-500">*</span>
              </label>
              <select
                value={symptomType}
                onChange={(e) => setSymptomType(e.target.value as IssueSymptomType)}
                className="input cursor-pointer"
              >
                <option value="">Pilih gejala</option>
                {SYMPTOM_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">
                Dampak <span className="text-red-500">*</span>
              </label>
              <select
                value={impactLevel}
                onChange={(e) => setImpactLevel(e.target.value as IssueImpactLevel)}
                className="input cursor-pointer"
              >
                <option value="">Pilih dampak</option>
                {IMPACT_OPTIONS.map((i) => (
                  <option key={i} value={i}>
                    {i}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">
                Catatan Kendala <span className="text-red-500">*</span>
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                placeholder="Jelaskan kendala yang dialami..."
                className="input"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1.5">
                Upload Foto/Video (opsional)
              </label>
              <label className="file-drop">
                <UploadCloud size={20} className="text-slate-400" />
                <span className="text-xs text-slate-500 text-center">
                  {file ? file.name : "Klik atau drag & drop file di sini"}
                </span>
                <input
                  type="file"
                  accept="image/*,video/*"
                  className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] || null)}
                />
              </label>
            </div>

            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                {error}
              </p>
            )}

            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitting}
              className="w-full rounded-xl bg-gradient-to-r from-blue-600 to-teal-500 text-white px-4 py-2.5 text-sm font-medium cursor-pointer hover:brightness-105 shadow-md shadow-blue-900/20 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {submitting ? "Mengirim..." : "Kirim Laporan"}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
