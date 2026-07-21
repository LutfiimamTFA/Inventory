"use client";

import { useEffect, useState } from "react";
import { addDoc, collection, doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { X } from "lucide-react";
import clsx from "clsx";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { AssetIssueTicket, AssetUser, ExternalCoordinationStatus, ExternalHandlerType, IssueAssignedTeam } from "@/lib/types";
import { fetchActiveUsersByRole } from "@/lib/firestore-helpers";
import { createAssetNotification } from "@/lib/notifications";
import { computeExternalArrivalEstimate, ExternalArrivalOption } from "@/lib/issueTicketActions";
import {
  EXTERNAL_COORDINATION_STAFF_MESSAGE,
  EXTERNAL_COORDINATION_STATUS_LABEL,
  EXTERNAL_HANDLER_TYPE_LABEL,
  ISSUE_STATUS_LABEL,
  ISSUE_STATUS_STAFF_LABEL,
} from "@/lib/utils";
import { getIssueTypeLabel } from "@/lib/maintenanceBoard";

// Section A perbaikan alur vendor eksternal — dua kelompok Tim Penanganan:
// tim internal (wajib pilih penanggung jawab dari akun AssetView asli) dan
// teknisi/vendor eksternal (TIDAK login ke AssetView, jadi tidak ada
// assignedToUid). QHSE HANYA jadi penghubung/koordinator — form eksternal
// sengaja dipersingkat, tidak butuh instruksi kerja detail atau nominal
// biaya (lihat Section E: field wajib cuma jenis teknisi + status + estimasi
// kedatangan).
const INTERNAL_TEAM_OPTIONS: { key: IssueAssignedTeam; label: string; usesDirectory: boolean }[] = [
  { key: "it_team", label: "Tim IT", usesDirectory: true },
  { key: "facility", label: "GA / Facility", usesDirectory: false },
  { key: "qhse", label: "QHSE", usesDirectory: true },
  { key: "security", label: "Security", usesDirectory: false },
  { key: "finance", label: "Finance / Pembelian", usesDirectory: true },
];

const EXTERNAL_HANDLER_OPTIONS: ExternalHandlerType[] = ["wifi_network", "ac", "electrical", "plumbing", "building", "other"];
const EXTERNAL_STATUS_OPTIONS: ExternalCoordinationStatus[] = [
  "calling_external_technician",
  "waiting_external_technician",
  "external_technician_arrived",
];

type TargetOption = "today" | "tomorrow" | "custom" | "urgent";

const TARGET_OPTION_LABEL: Record<TargetOption, string> = {
  today: "Hari Ini",
  tomorrow: "Besok",
  custom: "Tanggal Ditentukan",
  urgent: "Darurat / Segera",
};

function computeTargetResolutionAt(option: TargetOption, customDate: string): string | null {
  const now = new Date();
  if (option === "urgent") return now.toISOString();
  if (option === "today") {
    const d = new Date(now);
    d.setHours(23, 59, 0, 0);
    return d.toISOString();
  }
  if (option === "tomorrow") {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    d.setHours(23, 59, 0, 0);
    return d.toISOString();
  }
  if (option === "custom" && customDate) {
    const d = new Date(customDate);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return null;
}

export default function AssignIssueTicketModal({
  ticket,
  mode,
  open,
  onClose,
}: {
  ticket: AssetIssueTicket;
  mode: "assign" | "reassign";
  open: boolean;
  onClose: () => void;
}) {
  const { firebaseUser, assetUser, role } = useAuth();
  const currentUid = assetUser?.uid || firebaseUser?.uid || null;
  const currentName = assetUser?.name || firebaseUser?.email || "User";

  const initialIsExternal = ticket.assignedTeam === "external_vendor" || !!ticket.externalHandling;
  const [isExternal, setIsExternal] = useState(initialIsExternal);
  const [team, setTeam] = useState<IssueAssignedTeam>(
    !initialIsExternal && ticket.assignedTeam ? (ticket.assignedTeam as IssueAssignedTeam) : "it_team"
  );
  const [candidates, setCandidates] = useState<AssetUser[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [personUid, setPersonUid] = useState(ticket.assignedToUid || "");
  const [manualName, setManualName] = useState(ticket.assignedToName || "");

  const [externalHandlerType, setExternalHandlerType] = useState<ExternalHandlerType>(
    ticket.externalHandlerType || "wifi_network"
  );
  const [vendorName, setVendorName] = useState(ticket.vendorName || "");
  const [vendorContact, setVendorContact] = useState(ticket.vendorContact || "");
  const [externalStatus, setExternalStatus] = useState<ExternalCoordinationStatus>(
    ticket.externalCoordinationStatus || "calling_external_technician"
  );
  const [arrivalOption, setArrivalOption] = useState<ExternalArrivalOption>("today");
  const [arrivalDate, setArrivalDate] = useState("");
  const [arrivalTime, setArrivalTime] = useState("");
  const [coordinationNote, setCoordinationNote] = useState("");

  const [targetOption, setTargetOption] = useState<TargetOption>("today");
  const [customDate, setCustomDate] = useState("");
  const [instruction, setInstruction] = useState(ticket.assignmentInstruction || "");
  const [reporterNote, setReporterNote] = useState(ticket.noteForReporter || "");
  const [returnToWaitingTeam, setReturnToWaitingTeam] = useState(false);
  const [reassignReason, setReassignReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || isExternal) return;
    const teamDef = INTERNAL_TEAM_OPTIONS.find((t) => t.key === team);
    if (!teamDef?.usesDirectory) return;
    const roleForTeam = team === "it_team" ? "it_team" : team === "qhse" ? "asset_admin" : "asset_finance";
    queueMicrotask(() => setLoadingCandidates(true));
    fetchActiveUsersByRole(roleForTeam)
      .then((users) => setCandidates(users))
      .catch((err) => console.error("[AssignIssueTicketModal] gagal ambil daftar petugas", err))
      .finally(() => setLoadingCandidates(false));
  }, [open, isExternal, team]);

  if (!open) return null;

  const teamDef = INTERNAL_TEAM_OPTIONS.find((t) => t.key === team) || INTERNAL_TEAM_OPTIONS[0];
  const selectedCandidate = candidates.find((c) => c.uid === personUid) || null;

  const handleSubmit = async () => {
    setError("");

    if (isExternal) {
      const arrival = computeExternalArrivalEstimate(arrivalOption, arrivalDate, arrivalTime);
      if (!externalHandlerType || !externalStatus || !arrival.at) {
        setError("Pilih jenis teknisi, status koordinasi, dan estimasi kedatangan terlebih dahulu.");
        return;
      }
      if (mode === "reassign" && !reassignReason.trim()) {
        setError("Alasan pergantian wajib diisi.");
        return;
      }

      setSaving(true);
      try {
        const handlerLabel = EXTERNAL_HANDLER_TYPE_LABEL[externalHandlerType];
        const statusLabel = ISSUE_STATUS_LABEL.external_coordination;
        const staffStatusLabel = ISSUE_STATUS_STAFF_LABEL.external_coordination;
        const assignedToName = vendorName.trim() || handlerLabel;

        const payload: Record<string, unknown> = {
          status: "external_coordination",
          statusLabel,
          staffStatusLabel,

          externalHandling: true,
          assignedTeam: "external_vendor",
          assignedTeamLabel: "Teknisi Eksternal",

          externalHandlerType,
          externalHandlerLabel: handlerLabel,

          vendorName: vendorName.trim() || null,
          vendorContact: vendorContact.trim() || null,

          externalCoordinationStatus: externalStatus,
          externalCoordinationStatusLabel: EXTERNAL_COORDINATION_STATUS_LABEL[externalStatus],

          externalEstimatedArrivalAt: arrival.at,
          externalEstimatedArrivalLabel: arrival.label,

          assignedToUid: null,
          assignedToName,
          assignedToEmail: null,
          assignedToRole: null,

          coordinationNote: coordinationNote.trim() || "",
          noteForReporter: reporterNote.trim() || "",

          assignedAt: serverTimestamp(),
          assignedByUid: currentUid || "",
          assignedByName: currentName,

          lastActivityAt: serverTimestamp(),
          lastActivityByUid: currentUid || "",
          lastActivityByName: currentName,
          lastActivityMessage: `QHSE sedang memanggilkan ${handlerLabel}.`,

          updatedAt: serverTimestamp(),
          updatedByUid: currentUid || "",
          updatedByName: currentName,
        };

        if (mode === "reassign") {
          payload.reassignedAt = serverTimestamp();
          payload.reassignedByUid = currentUid || "";
          payload.reassignedByName = currentName;
          payload.reassignmentReason = reassignReason.trim();
        }

        await updateDoc(doc(db, "asset_issue_tickets", ticket.id), payload);

        const logMessage = `${currentName} sedang memanggilkan ${handlerLabel}${vendorName.trim() ? " - " + vendorName.trim() : ""}.`;
        await addDoc(collection(db, "asset_issue_ticket_logs"), {
          ticketId: ticket.id,
          ticketNumber: ticket.ticketNumber,
          action: "assign_external",
          actionLabel: "Meneruskan ke teknisi/vendor eksternal",
          fromStatus: ticket.status,
          toStatus: "external_coordination",
          message: logMessage,
          note: coordinationNote.trim() || null,
          actorRole: role || "",
          createdAt: serverTimestamp(),
          createdByUid: currentUid || "",
          createdByName: currentName,
          reporterUid: ticket.reportedByUid || "",
        });

        // Section D/L — vendor eksternal TIDAK login jadi TIDAK ADA
        // notifikasi ke assignedToUid (selalu null); yang dinotifikasi
        // hanya pelapor, dengan kalimat aman tanpa detail internal.
        if (ticket.reportedByUid) {
          try {
            await createAssetNotification({
              recipientUid: ticket.reportedByUid,
              recipientName: ticket.reportedByName,
              recipientRole: "staff",
              title: "Update Laporan Anda",
              message: `${EXTERNAL_COORDINATION_STAFF_MESSAGE[externalStatus]} (${ticket.title || ticket.ticketNumber})`,
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
            console.warn("[AssignIssueTicketModal] gagal kirim notifikasi ke pelapor, tetap berhasil", notifyError);
          }
        }

        onClose();
      } catch (submitError) {
        console.error("[AssignIssueTicketModal] gagal menyimpan assignment eksternal", submitError);
        setError("Gagal menyimpan. Coba lagi.");
      } finally {
        setSaving(false);
      }
      return;
    }

    // ── Tim internal (alur lama, tidak berubah) ──
    const targetResolutionAt = computeTargetResolutionAt(targetOption, customDate);
    if (!instruction.trim() || !targetResolutionAt) {
      setError("Pilih tim, penanggung jawab, instruksi, dan target penanganan terlebih dahulu.");
      return;
    }
    if (teamDef.usesDirectory && !selectedCandidate) {
      setError("Pilih tim, penanggung jawab, instruksi, dan target penanganan terlebih dahulu.");
      return;
    }
    if (!teamDef.usesDirectory && !manualName.trim()) {
      setError("Pilih tim, penanggung jawab, instruksi, dan target penanganan terlebih dahulu.");
      return;
    }
    if (mode === "reassign" && !reassignReason.trim()) {
      setError("Alasan pergantian wajib diisi.");
      return;
    }

    setSaving(true);
    try {
      const targetResolutionLabel = TARGET_OPTION_LABEL[targetOption];
      const previousAssignedToName = ticket.assignedToName || null;

      const assignedToUid = teamDef.usesDirectory ? selectedCandidate?.uid || null : null;
      const assignedToName = teamDef.usesDirectory ? selectedCandidate?.name || null : manualName.trim();
      const assignedToEmail = teamDef.usesDirectory ? selectedCandidate?.email || null : null;
      const assignedToRole = teamDef.usesDirectory ? selectedCandidate?.role || null : null;
      const resultingStatus = mode === "assign" ? "assigned" : returnToWaitingTeam ? "assigned" : ticket.status;

      const payload: Record<string, unknown> = {
        status: resultingStatus,
        statusLabel: ISSUE_STATUS_LABEL[resultingStatus] || resultingStatus,
        staffStatusLabel: ISSUE_STATUS_STAFF_LABEL[resultingStatus] || resultingStatus,

        externalHandling: false,
        externalHandlerType: null,
        externalHandlerLabel: null,
        externalCoordinationStatus: null,
        externalCoordinationStatusLabel: null,
        externalEstimatedArrivalAt: null,
        externalEstimatedArrivalLabel: null,
        coordinationNote: null,

        assignedTeam: team,
        assignedTeamLabel: teamDef.label,

        assignedToUid,
        assignedToName,
        assignedToEmail,
        assignedToRole,

        vendorName: null,
        vendorContact: null,

        assignmentInstruction: instruction.trim(),
        noteForReporter: reporterNote.trim() || null,
        targetResolutionAt,
        targetResolutionLabel,

        assignedAt: serverTimestamp(),
        assignedByUid: currentUid || "",
        assignedByName: currentName,

        lastActivityAt: serverTimestamp(),
        lastActivityByUid: currentUid || "",
        lastActivityByName: currentName,
        lastActivityMessage:
          mode === "assign"
            ? `Laporan diteruskan ke ${teamDef.label}${assignedToName ? " - " + assignedToName : ""}.`
            : `Penanggung jawab diganti ke ${teamDef.label}${assignedToName ? " - " + assignedToName : ""}.`,

        updatedAt: serverTimestamp(),
        updatedByUid: currentUid || "",
        updatedByName: currentName,
      };

      if (mode === "reassign") {
        payload.reassignedAt = serverTimestamp();
        payload.reassignedByUid = currentUid || "";
        payload.reassignedByName = currentName;
        payload.reassignmentReason = reassignReason.trim();
      }

      await updateDoc(doc(db, "asset_issue_tickets", ticket.id), payload);

      const logMessage =
        mode === "assign"
          ? `${currentName} meneruskan laporan "${ticket.title || ticket.ticketNumber}" ke ${teamDef.label}${assignedToName ? " - " + assignedToName : ""}.`
          : `${currentName} mengganti penanggung jawab laporan "${ticket.title || ticket.ticketNumber}" dari ${previousAssignedToName || "belum ada"} ke ${assignedToName || "-"}.`;

      await addDoc(collection(db, "asset_issue_ticket_logs"), {
        ticketId: ticket.id,
        ticketNumber: ticket.ticketNumber,
        action: mode === "assign" ? "assigned" : "reassigned",
        actionLabel: mode === "assign" ? "Meneruskan ke tim terkait" : "Mengganti tim/penanggung jawab",
        fromStatus: ticket.status,
        toStatus: resultingStatus,
        message: logMessage,
        note: mode === "reassign" ? reassignReason.trim() : instruction.trim(),
        actorRole: role || "",
        createdAt: serverTimestamp(),
        createdByUid: currentUid || "",
        createdByName: currentName,
        reporterUid: ticket.reportedByUid || "",
      });

      if (assignedToUid) {
        try {
          await createAssetNotification({
            recipientUid: assignedToUid,
            recipientName: assignedToName || "Petugas",
            recipientRole: teamDef.usesDirectory ? selectedCandidate?.role || "it_team" : "it_team",
            title: "Tugas Keluhan Baru",
            message: `Anda ditugaskan menangani laporan: ${ticket.title || ticket.symptomType || ticket.ticketNumber}`,
            type: "ticket_assigned",
            priority: ticket.priority,
            linkUrl: `/maintenance?tab=my-tasks&ticketId=${ticket.id}`,
            relatedType: "ticket",
            relatedId: ticket.id,
            relatedNumber: ticket.ticketNumber,
            createdByUid: currentUid || undefined,
            createdByName: currentName,
          });
        } catch (notifyError) {
          console.warn("[AssignIssueTicketModal] gagal kirim notifikasi assignment, tetap berhasil", notifyError);
        }
      }

      onClose();
    } catch (submitError) {
      console.error("[AssignIssueTicketModal] gagal menyimpan assignment", submitError);
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
          <h2 className="text-base font-semibold text-slate-900">
            {mode === "assign" ? "Teruskan Laporan ke Tim Terkait" : "Ganti Tim / Penanggung Jawab"}
          </h2>
          <button type="button" onClick={onClose} className="cursor-pointer rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          <p className="text-xs text-slate-500">
            {ticket.ticketNumber} · {ticket.title || ticket.symptomType} · {getIssueTypeLabel(ticket.reportType)}
          </p>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-500">
              Tim Penanganan <span className="text-red-500">*</span>
            </label>
            <div className="flex rounded-xl border border-slate-200 bg-slate-50 p-1">
              <button
                type="button"
                onClick={() => setIsExternal(false)}
                className={clsx(
                  "flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition-colors",
                  !isExternal ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
                )}
              >
                Tim Internal
              </button>
              <button
                type="button"
                onClick={() => setIsExternal(true)}
                className={clsx(
                  "flex-1 rounded-lg px-3 py-2 text-xs font-semibold transition-colors",
                  isExternal ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-100"
                )}
              >
                Teknisi / Vendor Eksternal
              </button>
            </div>
          </div>

          {!isExternal ? (
            <>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-500">Tim</label>
                <select
                  value={team}
                  onChange={(e) => {
                    setTeam(e.target.value as IssueAssignedTeam);
                    setPersonUid("");
                    setManualName("");
                  }}
                  className="input cursor-pointer"
                >
                  {INTERNAL_TEAM_OPTIONS.map((t) => (
                    <option key={t.key} value={t.key}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>

              {teamDef.usesDirectory ? (
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-500">
                    Penanggung Jawab / Petugas <span className="text-red-500">*</span>
                  </label>
                  <select
                    value={personUid}
                    onChange={(e) => setPersonUid(e.target.value)}
                    disabled={loadingCandidates}
                    className="input cursor-pointer disabled:opacity-60"
                  >
                    <option value="">{loadingCandidates ? "Memuat..." : "Pilih petugas"}</option>
                    {candidates.map((c) => (
                      <option key={c.uid} value={c.uid}>
                        {c.name} ({c.email})
                      </option>
                    ))}
                  </select>
                  {!loadingCandidates && candidates.length === 0 && (
                    <p className="mt-1 text-xs text-amber-600">Belum ada petugas aktif untuk tim ini.</p>
                  )}
                </div>
              ) : (
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-500">
                    Penanggung Jawab / Petugas <span className="text-red-500">*</span>
                  </label>
                  <input value={manualName} onChange={(e) => setManualName(e.target.value)} className="input" placeholder="Nama petugas" />
                  <p className="mt-1 text-[11px] text-slate-400">Belum ada daftar akun untuk tim ini di QHSE Care — diisi manual.</p>
                </div>
              )}

              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-500">
                  Target Waktu Penanganan <span className="text-red-500">*</span>
                </label>
                <div className="flex flex-wrap gap-2">
                  {(["today", "tomorrow", "custom", "urgent"] as TargetOption[]).map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setTargetOption(opt)}
                      className={clsx(
                        "rounded-full border px-3 py-1.5 text-xs font-medium",
                        targetOption === opt ? "border-slate-800 bg-slate-800 text-white" : "border-slate-200 text-slate-600 hover:bg-slate-50"
                      )}
                    >
                      {opt === "today" ? "Hari Ini" : opt === "tomorrow" ? "Besok" : opt === "custom" ? "Pilih Tanggal" : "Darurat / Segera"}
                    </button>
                  ))}
                </div>
                {targetOption === "custom" && (
                  <input type="date" value={customDate} onChange={(e) => setCustomDate(e.target.value)} className="input mt-2 cursor-text" />
                )}
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-500">
                  Instruksi QHSE <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={instruction}
                  onChange={(e) => setInstruction(e.target.value)}
                  rows={3}
                  placeholder="Contoh: Tolong cek koneksi WiFi lantai 2, pastikan router/AP normal, lalu kirim hasil pengecekan."
                  className="input"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-500">Catatan untuk Pelapor (opsional)</label>
                <textarea value={reporterNote} onChange={(e) => setReporterNote(e.target.value)} rows={2} className="input" />
              </div>
            </>
          ) : (
            <>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-500">
                  Jenis Teknisi <span className="text-red-500">*</span>
                </label>
                <select
                  value={externalHandlerType}
                  onChange={(e) => setExternalHandlerType(e.target.value as ExternalHandlerType)}
                  className="input cursor-pointer"
                >
                  {EXTERNAL_HANDLER_OPTIONS.map((opt) => (
                    <option key={opt} value={opt}>
                      {EXTERNAL_HANDLER_TYPE_LABEL[opt]}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-500">Nama Teknisi / Vendor (opsional)</label>
                  <input value={vendorName} onChange={(e) => setVendorName(e.target.value)} className="input" placeholder="Nama teknisi/vendor" />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-medium text-slate-500">Kontak Teknisi / Vendor (opsional)</label>
                  <input value={vendorContact} onChange={(e) => setVendorContact(e.target.value)} className="input" placeholder="No. HP / email" />
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-500">
                  Status Koordinasi <span className="text-red-500">*</span>
                </label>
                <select
                  value={externalStatus}
                  onChange={(e) => setExternalStatus(e.target.value as ExternalCoordinationStatus)}
                  className="input cursor-pointer"
                >
                  {EXTERNAL_STATUS_OPTIONS.map((s) => (
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
                <label className="mb-1.5 block text-xs font-medium text-slate-500">Catatan Koordinasi QHSE (opsional)</label>
                <textarea
                  value={coordinationNote}
                  onChange={(e) => setCoordinationNote(e.target.value)}
                  rows={2}
                  placeholder="Contoh: Teknisi WiFi sedang dipanggilkan, estimasi datang sore ini."
                  className="input"
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-500">Catatan untuk Pelapor (opsional)</label>
                <textarea
                  value={reporterNote}
                  onChange={(e) => setReporterNote(e.target.value)}
                  rows={2}
                  placeholder="Contoh: Teknisi eksternal sedang dipanggilkan. Mohon menunggu update berikutnya."
                  className="input"
                />
              </div>
            </>
          )}

          {mode === "reassign" && (
            <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
              {!isExternal && (
                <label className="flex items-center gap-2 text-xs font-medium text-amber-800">
                  <input
                    type="checkbox"
                    checked={returnToWaitingTeam}
                    onChange={(e) => setReturnToWaitingTeam(e.target.checked)}
                    className="h-3.5 w-3.5 cursor-pointer"
                  />
                  Kembalikan status ke Menunggu Tim Terkait
                </label>
              )}
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-500">
                  Alasan Pergantian <span className="text-red-500">*</span>
                </label>
                <textarea value={reassignReason} onChange={(e) => setReassignReason(e.target.value)} rows={2} className="input" />
              </div>
            </div>
          )}

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
            {saving ? "Menyimpan..." : mode === "assign" ? "Teruskan Laporan" : "Simpan Perubahan"}
          </button>
        </div>
      </div>
    </div>
  );
}
