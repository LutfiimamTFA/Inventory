"use client";

import { useState } from "react";
import { addDoc, collection, doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { X } from "lucide-react";
import clsx from "clsx";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { AssetIssueTicket, ExternalCoordinationStatus } from "@/lib/types";
import { createAssetNotification } from "@/lib/notifications";
import { computeExternalArrivalEstimate, ExternalArrivalOption } from "@/lib/issueTicketActions";
import { EXTERNAL_COORDINATION_STAFF_MESSAGE, EXTERNAL_COORDINATION_STATUS_LABEL } from "@/lib/utils";

// Section G perbaikan alur vendor eksternal — modal ini SEKARANG cuma
// "Update Estimasi Kedatangan Teknisi": status koordinasi (3 pilihan),
// estimasi kedatangan, catatan koordinasi, catatan pelapor. TIDAK ADA lagi
// jadwal terpisah, estimasi biaya, atau upload bukti — QHSE cuma
// penghubung, bukan pihak yang mengerjakan/menagih biaya.
const STATUS_OPTIONS: ExternalCoordinationStatus[] = [
  "calling_external_technician",
  "waiting_external_technician",
  "external_technician_arrived",
];

export default function VendorCoordinationModal({
  ticket,
  open,
  onClose,
}: {
  ticket: AssetIssueTicket;
  open: boolean;
  onClose: () => void;
}) {
  const { firebaseUser, assetUser } = useAuth();
  const currentUid = assetUser?.uid || firebaseUser?.uid || null;
  const currentName = assetUser?.name || firebaseUser?.email || "User";

  const [status, setStatus] = useState<ExternalCoordinationStatus>(
    ticket.externalCoordinationStatus || "calling_external_technician"
  );
  const [arrivalOption, setArrivalOption] = useState<ExternalArrivalOption>("today");
  const [arrivalDate, setArrivalDate] = useState("");
  const [arrivalTime, setArrivalTime] = useState("");
  const [coordinationNote, setCoordinationNote] = useState("");
  const [reporterNote, setReporterNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  if (!open) return null;

  const handleSubmit = async () => {
    setError("");
    const arrival = computeExternalArrivalEstimate(arrivalOption, arrivalDate, arrivalTime);
    if (!status || !arrival.at) {
      setError("Pilih status koordinasi dan estimasi kedatangan terlebih dahulu.");
      return;
    }

    setSaving(true);
    try {
      const statusLabel = EXTERNAL_COORDINATION_STATUS_LABEL[status];
      const payload: Record<string, unknown> = {
        externalCoordinationStatus: status,
        externalCoordinationStatusLabel: statusLabel,
        externalEstimatedArrivalAt: arrival.at,
        externalEstimatedArrivalLabel: arrival.label,
        lastActivityAt: serverTimestamp(),
        lastActivityByUid: currentUid || "",
        lastActivityByName: currentName,
        lastActivityMessage: `QHSE memperbarui estimasi kedatangan teknisi: ${arrival.label}.`,
        updatedAt: serverTimestamp(),
        updatedByUid: currentUid || "",
        updatedByName: currentName,
      };
      if (coordinationNote.trim()) payload.coordinationNote = coordinationNote.trim();
      if (reporterNote.trim()) payload.noteForReporter = reporterNote.trim();

      await updateDoc(doc(db, "asset_issue_tickets", ticket.id), payload);

      await addDoc(collection(db, "asset_issue_ticket_logs"), {
        ticketId: ticket.id,
        ticketNumber: ticket.ticketNumber,
        action: "external_coordination_updated",
        actionLabel: "Memperbarui koordinasi teknisi eksternal",
        fromStatus: ticket.status,
        toStatus: ticket.status,
        message: `${currentName} memperbarui estimasi kedatangan teknisi: ${arrival.label}.`,
        note: coordinationNote.trim() || null,
        createdAt: serverTimestamp(),
        createdByUid: currentUid || "",
        createdByName: currentName,
        reporterUid: ticket.reportedByUid || "",
      });

      if (ticket.reportedByUid) {
        try {
          await createAssetNotification({
            recipientUid: ticket.reportedByUid,
            recipientName: ticket.reportedByName,
            recipientRole: "staff",
            title: "Update Laporan Anda",
            message: `${reporterNote.trim() || EXTERNAL_COORDINATION_STAFF_MESSAGE[status]} (${ticket.title || ticket.ticketNumber})`,
            type: "ticket_status_updated",
            priority: ticket.priority,
            linkUrl: "/my-reports",
            relatedType: "ticket",
            relatedId: ticket.id,
            relatedNumber: ticket.ticketNumber,
            createdByUid: currentUid || undefined,
            createdByName: currentName,
          });
        } catch (notifyError) {
          console.warn("[VendorCoordinationModal] gagal kirim notifikasi ke pelapor, tetap berhasil", notifyError);
        }
      }

      onClose();
    } catch (submitError) {
      console.error("[VendorCoordinationModal] gagal menyimpan update estimasi kedatangan", submitError);
      setError("Gagal menyimpan. Coba lagi.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative flex max-h-[88vh] w-[92vw] max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-6 py-4">
          <h2 className="text-base font-semibold text-slate-900">Update Estimasi Kedatangan Teknisi</h2>
          <button type="button" onClick={onClose} className="cursor-pointer rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          <p className="text-xs text-slate-500">
            {ticket.ticketNumber} · {ticket.externalHandlerLabel || "Teknisi Eksternal"}
            {ticket.vendorName ? ` · ${ticket.vendorName}` : ""}
          </p>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-500">
              Status Koordinasi <span className="text-red-500">*</span>
            </label>
            <select value={status} onChange={(e) => setStatus(e.target.value as ExternalCoordinationStatus)} className="input cursor-pointer">
              {STATUS_OPTIONS.map((s) => (
                <option key={s} value={s}>
                  {EXTERNAL_COORDINATION_STATUS_LABEL[s]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-500">
              Estimasi Kedatangan <span className="text-red-500">*</span>
            </label>
            <div className="flex flex-wrap gap-2">
              {(["today", "tomorrow", "custom", "asap"] as ExternalArrivalOption[]).map((opt) => (
                <button
                  key={opt}
                  type="button"
                  onClick={() => setArrivalOption(opt)}
                  className={clsx(
                    "rounded-full border px-3 py-1.5 text-xs font-medium",
                    arrivalOption === opt ? "border-slate-800 bg-slate-800 text-white" : "border-slate-200 text-slate-600 hover:bg-slate-50"
                  )}
                >
                  {opt === "today" ? "Hari Ini" : opt === "tomorrow" ? "Besok" : opt === "custom" ? "Pilih Tanggal & Jam" : "Secepatnya"}
                </button>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              {arrivalOption === "custom" && (
                <input type="date" value={arrivalDate} onChange={(e) => setArrivalDate(e.target.value)} className="input cursor-text" />
              )}
              {(arrivalOption === "today" || arrivalOption === "tomorrow" || arrivalOption === "custom") && (
                <input type="time" value={arrivalTime} onChange={(e) => setArrivalTime(e.target.value)} className="input cursor-text" />
              )}
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-500">Catatan Koordinasi (opsional)</label>
            <textarea value={coordinationNote} onChange={(e) => setCoordinationNote(e.target.value)} rows={2} className="input" />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-500">Catatan untuk Pelapor (opsional)</label>
            <textarea value={reporterNote} onChange={(e) => setReporterNote(e.target.value)} rows={2} className="input" />
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>

        <div className="flex shrink-0 justify-end gap-2 border-t border-slate-100 px-6 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={saving}
            className="rounded-xl bg-gradient-to-r from-blue-600 to-teal-500 px-4 py-2 text-sm font-medium text-white hover:brightness-105 disabled:opacity-60"
          >
            {saving ? "Menyimpan..." : "Simpan Update"}
          </button>
        </div>
      </div>
    </div>
  );
}
