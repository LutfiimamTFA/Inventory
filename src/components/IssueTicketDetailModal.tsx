"use client";

import { useEffect, useState } from "react";
import {
  addDoc,
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { Check, X } from "lucide-react";
import clsx from "clsx";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { AssetIssueTicketLog, AssetIssueTicket, HandlingPriority, IssueSeverity } from "@/lib/types";
import { fetchActiveUsersByRole } from "@/lib/firestore-helpers";
import { uploadToDrive } from "@/lib/drive-upload";
import { createAssetNotification } from "@/lib/notifications";
import {
  getAvailableIssueTicketActions,
  getIssueTimelineActiveIndex,
  isAssignmentIncomplete,
  IssueActionDef,
  ISSUE_TIMELINE_STEPS,
} from "@/lib/issueTicketActions";
import {
  formatDateTime,
  EXTERNAL_HANDLER_TYPE_LABEL,
  FIELD_IMPACT_COLOR,
  FIELD_IMPACT_LABEL,
  HANDLING_PRIORITY_COLOR,
  HANDLING_PRIORITY_LABEL,
  ISSUE_REPORT_TYPE_COLOR,
  ISSUE_REPORT_TYPE_LABEL,
  ISSUE_STATUS_COLOR,
  ISSUE_STATUS_LABEL,
  ISSUE_STATUS_STAFF_LABEL,
  EXTERNAL_COORDINATION_STAFF_LABEL,
  EXTERNAL_COORDINATION_STATUS_LABEL,
} from "@/lib/utils";
import Badge from "@/components/Badge";
import AssignIssueTicketModal from "@/components/AssignIssueTicketModal";
import VendorCoordinationModal from "@/components/VendorCoordinationModal";

const FIELD_IMPACT_OPTIONS: IssueSeverity[] = ["low", "medium", "high", "critical"];
const HANDLING_PRIORITY_OPTIONS: HandlingPriority[] = ["normal", "soon", "urgent", "emergency"];

function reportTypeLabel(ticket: AssetIssueTicket) {
  return ticket.reportType ? ISSUE_REPORT_TYPE_LABEL[ticket.reportType] : "Kendala Asset";
}

function reportTypeColor(ticket: AssetIssueTicket) {
  return ticket.reportType ? ISSUE_REPORT_TYPE_COLOR[ticket.reportType] : "bg-amber-50 text-amber-700 border-amber-200";
}

function fieldImpactOf(ticket: AssetIssueTicket): IssueSeverity | undefined {
  return ticket.fieldImpact || ticket.severity;
}

// Section B — cek kepemilikan laporan lewat beberapa kemungkinan nama
// field (aplikasi ini konsisten pakai reportedByUid, tapi cek field lain
// juga sebagai jaring pengaman kalau ada data lama/alur lain yang beda).
function isCurrentUserReporter(
  ticket: Pick<AssetIssueTicket, "reportedByUid" | "createdByUid"> | null | undefined,
  currentUid: string | null | undefined
): boolean {
  if (!ticket || !currentUid) return false;
  return ticket.reportedByUid === currentUid || ticket.createdByUid === currentUid;
}

// Section A — label tombol konfirmasi disesuaikan jenis laporan supaya
// pelapor langsung paham maksudnya tanpa mikir ulang istilah generik.
function getReporterConfirmationCopy(ticket: AssetIssueTicket) {
  const text = `${ticket.reportType || ""} ${ticket.title || ""} ${ticket.symptomType || ""}`.toLowerCase();
  if (ticket.reportType === "it_network" || /wifi|jaringan|internet|network/.test(text)) {
    return {
      subtitle: "Apakah jaringan sudah normal?",
      confirmLabel: "Jaringan Sudah Normal",
      stillProblemLabel: "Masih Lemot / Masih Bermasalah",
      notePlaceholder: "Contoh: WiFi masih lemot di area kerja, terutama saat membuka aplikasi.",
    };
  }
  if (/\bac\b|pendingin/.test(text)) {
    return {
      subtitle: "Apakah AC sudah normal?",
      confirmLabel: "AC Sudah Normal",
      stillProblemLabel: "AC Masih Bermasalah",
      notePlaceholder: "Contoh: AC masih kurang dingin / masih berbunyi.",
    };
  }
  if (ticket.reportType === "facility_issue") {
    return {
      subtitle: "Apakah kendala sudah diperbaiki?",
      confirmLabel: "Sudah Diperbaiki",
      stillProblemLabel: "Masih Bermasalah",
      notePlaceholder: "Contoh: bagian yang diperbaiki masih belum berfungsi normal.",
    };
  }
  return {
    subtitle: "Apakah kendala sudah selesai di lapangan?",
    confirmLabel: "Sudah Selesai",
    stillProblemLabel: "Masih Bermasalah",
    notePlaceholder: "Contoh: kendala masih terjadi, jelaskan kondisinya.",
  };
}

const ACTION_TONE_CLASS: Record<IssueActionDef["tone"], string> = {
  primary: "bg-gradient-to-r from-blue-600 to-teal-500 text-white hover:brightness-105",
  success: "bg-emerald-600 text-white hover:bg-emerald-700",
  danger: "border border-red-200 bg-red-50 text-red-700 hover:bg-red-100",
  neutral: "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
};

export default function IssueTicketDetailModal({
  ticket: initialTicket,
  open,
  onClose,
  readOnly = false,
}: {
  ticket: AssetIssueTicket;
  open: boolean;
  onClose: () => void;
  readOnly?: boolean;
}) {
  const { firebaseUser, assetUser, role, loading } = useAuth();
  const authReady = !loading && !!firebaseUser && !!assetUser && !!role;
  const [ticket, setTicket] = useState(initialTicket);
  const [logs, setLogs] = useState<AssetIssueTicketLog[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [pendingAction, setPendingAction] = useState<IssueActionDef | null>(null);
  const [assignModalMode, setAssignModalMode] = useState<"assign" | "reassign" | null>(null);
  const [showVendorModal, setShowVendorModal] = useState(false);
  const [noteInput, setNoteInput] = useState("");
  const [photoFiles, setPhotoFiles] = useState<File[]>([]);

  const [showImpactCorrection, setShowImpactCorrection] = useState(false);
  const [correctedImpact, setCorrectedImpact] = useState<IssueSeverity>("medium");
  const [correctionReason, setCorrectionReason] = useState("");

  const [showHandlingPriority, setShowHandlingPriority] = useState(false);
  const [handlingPriorityInput, setHandlingPriorityInput] = useState<HandlingPriority>("normal");
  const [handlingPriorityReasonInput, setHandlingPriorityReasonInput] = useState("");

  useEffect(() => {
    if (!open || !authReady) return;
    const unsub = onSnapshot(
      doc(db, "asset_issue_tickets", initialTicket.id),
      (snap) => {
        if (snap.exists()) setTicket({ id: snap.id, ...snap.data() } as AssetIssueTicket);
      },
      (error) => {
        console.error("[Listener] issue ticket detail asset_issue_tickets doc error:", { id: initialTicket.id, error });
      }
    );
    return () => unsub();
  }, [open, authReady, initialTicket.id]);

  useEffect(() => {
    if (!open || !authReady) return;
    const q = query(
      collection(db, "asset_issue_ticket_logs"),
      where("ticketId", "==", ticket.id),
      orderBy("createdAt", "desc")
    );
    const unsub = onSnapshot(
      q,
      (snap) => setLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() } as AssetIssueTicketLog))),
      (error) => console.error("[Listener] issue ticket detail asset_issue_ticket_logs error:", error)
    );
    return () => unsub();
  }, [open, authReady, ticket.id]);

  if (!open) return null;

  const currentUid = assetUser?.uid || firebaseUser?.uid || null;
  const currentName = assetUser?.name || firebaseUser?.email || "User";
  const isQhse = role === "asset_admin" || role === "super_admin";
  const isReporter = isCurrentUserReporter(ticket, currentUid);
  const isClosed = ["completed", "cancelled", "rejected", "duplicate"].includes(ticket.status);
  const canReporterConfirm = ticket.status === "waiting_reporter_confirmation" && isReporter;
  const confirmationCopy = getReporterConfirmationCopy(ticket);

  // Section A/C — label confirm_done/still_problem disesuaikan jenis
  // laporan, dan confirm_done SELALU buka modal kecil (note optional)
  // walau tidak wajib diisi, supaya pelapor tidak asal klik tanpa konfirmasi.
  const availableActions = (readOnly ? [] : getAvailableIssueTicketActions(ticket, role, currentUid)).map((action) => {
    if (action.key === "confirm_done") {
      return { ...action, label: confirmationCopy.confirmLabel, notePlaceholder: "Contoh: WiFi sudah normal kembali." };
    }
    if (action.key === "still_problem") {
      return { ...action, label: confirmationCopy.stillProblemLabel, notePlaceholder: confirmationCopy.notePlaceholder };
    }
    return action;
  });

  const ticketRef = doc(db, "asset_issue_tickets", ticket.id);

  const isStaffView = isReporter && !isQhse;
  const displayStatusLabel = isStaffView
    ? ticket.status === "external_coordination" && ticket.externalCoordinationStatus
      ? EXTERNAL_COORDINATION_STAFF_LABEL[ticket.externalCoordinationStatus]
      : ticket.staffStatusLabel || ISSUE_STATUS_STAFF_LABEL[ticket.status] || ticket.status
    : ticket.statusLabel || ISSUE_STATUS_LABEL[ticket.status] || ticket.status;

  const openAction = (action: IssueActionDef) => {
    setError("");
    setNoteInput("");
    setPhotoFiles([]);
    setPendingAction(action);
  };

  const closeActionForm = () => {
    setPendingAction(null);
    setNoteInput("");
    setPhotoFiles([]);
    setError("");
  };

  const buildFieldUpdates = (action: IssueActionDef, photoUrls: string[]): Record<string, unknown> => {
    const base: Record<string, unknown> = {
      status: action.toStatus,
      statusLabel: ISSUE_STATUS_LABEL[action.toStatus],
      staffStatusLabel: ISSUE_STATUS_STAFF_LABEL[action.toStatus],
      lastActivityAt: serverTimestamp(),
      lastActivityByUid: currentUid || "",
      lastActivityByName: currentName,
      lastActivityMessage: action.actionLabel,
      updatedAt: serverTimestamp(),
      updatedByUid: currentUid || "",
      updatedByName: currentName,
    };

    switch (action.key) {
      case "review":
        return { ...base, reviewedAt: serverTimestamp(), reviewedByUid: currentUid || "", reviewedByName: currentName };
      case "request_info":
        return { ...base, reviewNote: noteInput };
      case "complete_info":
        return base;
      case "forward":
        return { ...base, assignedByUid: currentUid || "", assignedByName: currentName, assignedAt: serverTimestamp() };
      case "reassign":
        return {
          ...base,
          assignedToUid: null,
          assignedToName: null,
          assignedByUid: currentUid || "",
          assignedByName: currentName,
          assignedAt: serverTimestamp(),
          followUpType: null,
        };
      case "start":
        return {
          ...base,
          assignedToUid: currentUid || "",
          assignedToName: currentName,
          startedAt: serverTimestamp(),
          startedByUid: currentUid || "",
          startedByName: currentName,
        };
      case "send_result":
        return {
          ...base,
          resolutionNote: noteInput,
          resolutionPhotoUrls: photoUrls,
          handledAt: serverTimestamp(),
          handledByUid: currentUid || "",
          handledByName: currentName,
          waitingReporterConfirmationAt: serverTimestamp(),
        };
      case "mark_technician_arrived":
        // Section H — QHSE bukan yang mengerjakan, jadi begitu teknisi
        // eksternal datang, langsung minta konfirmasi pelapor (tidak ada
        // "hasil penanganan" versi QHSE, karena QHSE tidak tahu detailnya).
        return {
          ...base,
          staffStatusLabel: "Mohon Konfirmasi",
          lastActivityMessage: "Teknisi eksternal sudah datang. Menunggu konfirmasi pelapor.",
          externalCoordinationStatus: "external_technician_arrived",
          externalCoordinationStatusLabel: EXTERNAL_COORDINATION_STATUS_LABEL.external_technician_arrived,
          waitingReporterConfirmationAt: serverTimestamp(),
        };
      case "mark_follow_up":
        return { ...base, resolutionNote: noteInput };
      case "request_vendor":
        return { ...base, followUpType: "vendor" };
      case "request_purchase":
        return { ...base, followUpType: "purchase" };
      case "recheck":
        return { ...base, followUpType: "recheck" };
      case "confirm_done":
        return {
          ...base,
          staffStatusLabel: "Sudah Dikonfirmasi",
          lastActivityMessage: `${currentName} mengonfirmasi kendala sudah selesai.`,
          reporterConfirmedAt: serverTimestamp(),
          reporterConfirmedByUid: currentUid || "",
          reporterConfirmedByName: currentName,
          reporterConfirmationNote: noteInput || "",
        };
      case "still_problem":
        return {
          ...base,
          staffStatusLabel: "Masih Bermasalah",
          lastActivityMessage: `${currentName} menyatakan kendala masih bermasalah.`,
          reporterRejectedResolutionAt: serverTimestamp(),
          reporterRejectedResolutionByUid: currentUid || "",
          reporterRejectedResolutionByName: currentName,
          reporterRejectedResolutionNote: noteInput,
          reporterRejectedResolutionPhotoUrls: photoUrls,
        };
      case "close":
        return {
          ...base,
          completedAt: serverTimestamp(),
          completedByUid: currentUid || "",
          completedByName: currentName,
          completionNote: noteInput || null,
        };
      case "reject":
        return { ...base, rejectReason: noteInput };
      case "duplicate":
        return { ...base, duplicateNote: noteInput };
      case "cancel":
        return { ...base, cancelReason: noteInput };
      case "reopen":
        return { ...base, reopenReason: noteInput };
      default:
        return base;
    }
  };

  const notifyAfterAction = async (action: IssueActionDef) => {
    try {
      const recipients: { uid: string; name: string; role: "staff" | "asset_admin" | "it_team" }[] = [];
      if (action.actor !== "staff_reporter" && ticket.reportedByUid) {
        recipients.push({ uid: ticket.reportedByUid, name: ticket.reportedByName, role: "staff" });
      }
      if (action.actor === "staff_reporter" || action.key === "forward" || action.key === "reassign") {
        const qhse = await fetchActiveUsersByRole("asset_admin");
        qhse.forEach((u) => recipients.push({ uid: u.uid, name: u.name, role: "asset_admin" }));
      }
      if (action.key === "forward" || action.key === "reassign" || action.key === "recheck") {
        const team = await fetchActiveUsersByRole("it_team");
        team.forEach((u) => recipients.push({ uid: u.uid, name: u.name, role: "it_team" }));
      }
      // Section F — confirm_done/still_problem pakai judul & pesan spesifik
      // ke QHSE (bukan template status generik), dan diarahkan ke tab yang
      // relevan (Butuh Tindakan Lanjutan untuk still_problem).
      const isConfirmDone = action.key === "confirm_done";
      const isStillProblem = action.key === "still_problem";
      const ticketTitle = ticket.title || ticket.symptomType || ticket.ticketNumber;

      await Promise.all(
        recipients.map((r) =>
          createAssetNotification({
            recipientUid: r.uid,
            recipientName: r.name,
            recipientRole: r.role,
            title: isConfirmDone
              ? "Pelapor Mengonfirmasi Selesai"
              : isStillProblem
              ? "Laporan Masih Bermasalah"
              : "Status Laporan Diperbarui",
            message: isConfirmDone
              ? `${currentName} mengonfirmasi laporan "${ticketTitle}" sudah selesai.`
              : isStillProblem
              ? `${currentName} menyatakan laporan "${ticketTitle}" masih bermasalah dan butuh tindak lanjut.`
              : `${ticket.ticketNumber} sekarang: ${ISSUE_STATUS_LABEL[action.toStatus]}`,
            type: "ticket_status_updated",
            priority: ticket.priority,
            linkUrl:
              r.role === "staff"
                ? "/my-reports"
                : isStillProblem
                ? `/maintenance?tab=follow-up&ticketId=${ticket.id}`
                : `/maintenance?tab=staff-reports&ticketId=${ticket.id}`,
            relatedType: "ticket",
            relatedId: ticket.id,
            relatedNumber: ticket.ticketNumber,
            createdByUid: currentUid || undefined,
            createdByName: currentName,
          })
        )
      );
    } catch (notifyError) {
      console.warn("[IssueTicketDetailModal] gagal kirim notifikasi, aksi tetap berhasil", notifyError);
    }
  };

  const writeTicketLog = async (payload: {
    action: string;
    actionLabel: string;
    fromStatus?: string | null;
    toStatus?: string | null;
    message: string;
    note?: string | null;
  }) => {
    await addDoc(collection(db, "asset_issue_ticket_logs"), {
      ticketId: ticket.id,
      ticketNumber: ticket.ticketNumber,
      actorRole: role || "",
      createdAt: serverTimestamp(),
      createdByUid: currentUid || "",
      createdByName: currentName,
      reporterUid: ticket.reportedByUid || "",
      ...payload,
    });
  };

  const runAction = async (action: IssueActionDef) => {
    if (action.requiresNote && !noteInput.trim()) {
      setError("Catatan wajib diisi untuk aksi ini.");
      return;
    }
    setSaving(true);
    setError("");

    // Section E/F — confirm_done/still_problem/close pakai action/
    // actionLabel/message persis seperti yang diminta (bukan template
    // generik), supaya Riwayat Update jelas ini keputusan pelapor/QHSE.
    const isConfirmDone = action.key === "confirm_done";
    const isStillProblem = action.key === "still_problem";
    const isClose = action.key === "close";

    let photoUrls: string[] = [];
    if (action.requiresPhoto && photoFiles.length > 0) {
      try {
        const uploaded = await Promise.all(
          photoFiles.map((file) =>
            uploadToDrive(file, "issue_attachment", {
              assetCode: ticket.assetCode || "ticket",
              assetName: ticket.title || ticket.ticketNumber,
            })
          )
        );
        photoUrls = uploaded.map((f) => f.url);
      } catch (uploadError) {
        console.error("[IssueTicketDetailModal] gagal upload foto", action.key, uploadError);
        setError("Gagal mengunggah foto. Coba lagi.");
        setSaving(false);
        return;
      }
    }

    const updates = buildFieldUpdates(action, photoUrls);

    // Section C — update ticket TERPISAH dari log/notifikasi: kalau ini
    // gagal (mis. permission-denied), aksi dianggap gagal total. Kalau ini
    // berhasil tapi log/notifikasi gagal, statusnya TETAP berhasil berubah.
    try {
      console.log("[IssueTicketDetailModal Action Debug] START update ticket", {
        action: action.key,
        ticketId: ticket.id,
        currentStatus: ticket.status,
        nextStatus: action.toStatus,
        uid: currentUid,
        payloadKeys: Object.keys(updates),
      });
      await updateDoc(ticketRef, updates);
      console.log("[IssueTicketDetailModal Action Debug] SUCCESS update ticket");
    } catch (updateError) {
      console.error("[IssueTicketDetailModal] gagal menjalankan aksi", action.key, updateError);
      setError("Gagal memperbarui laporan. Coba lagi.");
      setSaving(false);
      return;
    }

    closeActionForm();
    setSaving(false);

    try {
      await writeTicketLog({
        action: isConfirmDone
          ? "reporter_confirmed"
          : isStillProblem
          ? "reporter_rejected_resolution"
          : isClose
          ? "completed"
          : action.key,
        actionLabel: isConfirmDone
          ? "Pelapor mengonfirmasi selesai"
          : isStillProblem
          ? "Pelapor menyatakan masih bermasalah"
          : isClose
          ? "Laporan ditutup QHSE"
          : action.actionLabel,
        fromStatus: ticket.status,
        toStatus: action.toStatus,
        message: isConfirmDone
          ? `${currentName} mengonfirmasi laporan sudah selesai.`
          : isStillProblem
          ? `${currentName} menyatakan laporan masih bermasalah.`
          : isClose
          ? `${currentName} menutup laporan setelah dikonfirmasi selesai oleh pelapor.`
          : `${currentName} ${action.actionLabel.toLowerCase()} "${ticket.title || ticket.ticketNumber}".`,
        note: noteInput || null,
      });
      console.log("[IssueTicketDetailModal Action Debug] SUCCESS create log");
    } catch (logError) {
      console.warn("[IssueTicketDetailModal] gagal membuat log, update ticket tetap berhasil", logError);
    }

    try {
      await notifyAfterAction(action);
      console.log("[IssueTicketDetailModal Action Debug] SUCCESS notify");
    } catch (notificationError) {
      console.warn("[IssueTicketDetailModal] gagal membuat notifikasi, update ticket tetap berhasil", notificationError);
    }
  };

  const submitImpactCorrection = async () => {
    if (!correctionReason.trim()) {
      setError("Alasan koreksi wajib diisi.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await updateDoc(ticketRef, {
        fieldImpact: correctedImpact,
        fieldImpactLabel: FIELD_IMPACT_LABEL[correctedImpact],
        fieldImpactCorrectedByUid: currentUid || "",
        fieldImpactCorrectedByName: currentName,
        fieldImpactCorrectedAt: serverTimestamp(),
        fieldImpactCorrectionReason: correctionReason,
        updatedAt: serverTimestamp(),
        updatedByUid: currentUid || "",
        updatedByName: currentName,
      });
      await writeTicketLog({
        action: "correct_impact",
        actionLabel: "Mengoreksi tingkat dampak",
        message: `${currentName} mengoreksi Tingkat Dampak dari Pelapor menjadi "${FIELD_IMPACT_LABEL[correctedImpact]}".`,
        note: correctionReason,
      });
      setShowImpactCorrection(false);
      setCorrectionReason("");
    } catch (correctionError) {
      console.error("[IssueTicketDetailModal] gagal koreksi dampak", correctionError);
      setError("Gagal menyimpan koreksi. Coba lagi.");
    } finally {
      setSaving(false);
    }
  };

  const submitHandlingPriority = async () => {
    if (!handlingPriorityReasonInput.trim()) {
      setError("Catatan alasan prioritas penanganan wajib diisi.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await updateDoc(ticketRef, {
        handlingPriority: handlingPriorityInput,
        handlingPriorityLabel: HANDLING_PRIORITY_LABEL[handlingPriorityInput],
        handlingPriorityReason: handlingPriorityReasonInput,
        handlingPriorityByUid: currentUid || "",
        handlingPriorityByName: currentName,
        handlingPriorityAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        updatedByUid: currentUid || "",
        updatedByName: currentName,
      });
      await writeTicketLog({
        action: "set_handling_priority",
        actionLabel: "Mengatur prioritas penanganan",
        message: `${currentName} mengatur Prioritas Penanganan QHSE menjadi "${HANDLING_PRIORITY_LABEL[handlingPriorityInput]}".`,
        note: handlingPriorityReasonInput,
      });
      setShowHandlingPriority(false);
      setHandlingPriorityReasonInput("");
    } catch (priorityError) {
      console.error("[IssueTicketDetailModal] gagal set prioritas penanganan", priorityError);
      setError("Gagal menyimpan prioritas penanganan. Coba lagi.");
    } finally {
      setSaving(false);
    }
  };

  const timelineActiveIndex = getIssueTimelineActiveIndex(ticket.status);
  const isClosedNonCompleted = ["cancelled", "rejected", "duplicate"].includes(ticket.status);
  const impact = fieldImpactOf(ticket);

  return (
    <>
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative flex max-h-[88vh] w-[92vw] max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg">
        {/* Header sticky */}
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-6 py-4">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-lg font-semibold text-slate-900">{ticket.ticketNumber}</h2>
              <span className="text-xs text-slate-400">{ticket.queueNumber}</span>
            </div>
            <h3 className="mt-0.5 text-base font-medium text-slate-700">{ticket.title || ticket.symptomType}</h3>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Badge label={displayStatusLabel} colorClass={ISSUE_STATUS_COLOR[ticket.status] || "bg-slate-100 text-slate-600 border-slate-200"} />
              <Badge label={reportTypeLabel(ticket)} colorClass={reportTypeColor(ticket)} />
              {impact && <Badge label={`Dampak: ${ticket.fieldImpactLabel || FIELD_IMPACT_LABEL[impact]}`} colorClass={FIELD_IMPACT_COLOR[impact]} />}
              {ticket.handlingPriority && (
                <Badge
                  label={`Penanganan: ${ticket.handlingPriorityLabel || HANDLING_PRIORITY_LABEL[ticket.handlingPriority]}`}
                  colorClass={HANDLING_PRIORITY_COLOR[ticket.handlingPriority]}
                />
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 cursor-pointer rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body — scroll internal, 2 kolom di desktop */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1.2fr_0.8fr]">
            {/* Kolom kiri */}
            <div className="space-y-5">
              <Card title="Ringkasan Laporan">
                <div className="grid gap-x-4 gap-y-3 text-sm sm:grid-cols-2">
                  <Info label="Judul" value={ticket.title || ticket.symptomType} />
                  <Info label="Jenis Laporan" value={reportTypeLabel(ticket)} />
                  <Info label="Status" value={displayStatusLabel} />
                  <Info label="Tanggal Lapor" value={formatDateTime(ticket.createdAt || ticket.reportedAt)} />
                  <Info label="Pelapor" value={ticket.reportedByName} />
                  <Info label="Ditugaskan ke" value={ticket.assignedToName || ticket.assignedTeam || undefined} />
                </div>
              </Card>

              <Card title="Lokasi & Asset">
                <div className="grid gap-x-4 gap-y-3 text-sm sm:grid-cols-2">
                  <Info label="Lokasi" value={ticket.locationText || ticket.assetLocation} />
                  <Info label="Detail Area" value={ticket.detailArea || undefined} />
                  <Info
                    label="Asset Terkait"
                    value={ticket.assetName ? `${ticket.assetName} (${ticket.assetCode || "-"})` : "Tidak terkait asset tertentu"}
                  />
                </div>
              </Card>

              <Card title="Kondisi dari Pelapor">
                <div className="grid gap-x-4 gap-y-3 text-sm sm:grid-cols-2">
                  <Info label="Gejala" value={ticket.symptomType} />
                  <Info label="Dampak" value={ticket.impactLevel} />
                  <div>
                    <p className="mb-0.5 text-xs text-slate-400">Tingkat Dampak dari Pelapor</p>
                    {impact ? (
                      <Badge label={ticket.fieldImpactLabel || FIELD_IMPACT_LABEL[impact]} colorClass={FIELD_IMPACT_COLOR[impact]} />
                    ) : (
                      <p className="font-medium text-slate-800">-</p>
                    )}
                    <p className="mt-1 text-[11px] text-slate-400">Diisi oleh pelapor berdasarkan kondisi yang terlihat di lapangan.</p>
                  </div>
                </div>

                <div className="mt-3">
                  <p className="mb-1 text-xs text-slate-400">Catatan Pelapor</p>
                  <p className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-800">{ticket.description}</p>
                </div>

                {ticket.attachmentUrls && ticket.attachmentUrls.length > 0 && (
                  <div className="mt-3">
                    <p className="mb-1 text-xs text-slate-400">Lampiran Pelapor</p>
                    {ticket.attachmentUrls.map((url, i) => (
                      <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="block text-sm text-blue-600 hover:underline">
                        {ticket.attachmentFiles?.[i] || `Lampiran ${i + 1}`}
                      </a>
                    ))}
                  </div>
                )}

                {isQhse && !isClosed && (
                  <div className="mt-3 border-t border-slate-100 pt-3">
                    {!showImpactCorrection ? (
                      <button
                        type="button"
                        onClick={() => {
                          setCorrectedImpact(fieldImpactOf(ticket) || "medium");
                          setShowImpactCorrection(true);
                          setCorrectionReason("");
                          setError("");
                        }}
                        className="text-xs font-medium text-slate-500 underline decoration-dotted hover:text-slate-700"
                      >
                        Koreksi Dampak
                      </button>
                    ) : (
                      <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3">
                        <p className="text-xs font-semibold text-amber-800">Koreksi Tingkat Dampak dari Pelapor</p>
                        <select
                          value={correctedImpact}
                          onChange={(e) => setCorrectedImpact(e.target.value as IssueSeverity)}
                          className="input cursor-pointer"
                        >
                          {FIELD_IMPACT_OPTIONS.map((opt) => (
                            <option key={opt} value={opt}>
                              {FIELD_IMPACT_LABEL[opt]}
                            </option>
                          ))}
                        </select>
                        <textarea
                          value={correctionReason}
                          onChange={(e) => setCorrectionReason(e.target.value)}
                          rows={2}
                          placeholder="Alasan koreksi (wajib diisi)"
                          className="input"
                        />
                        {error && <p className="text-xs text-red-600">{error}</p>}
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={saving}
                            onClick={submitImpactCorrection}
                            className="rounded-xl bg-amber-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-700 disabled:opacity-60"
                          >
                            Simpan Koreksi
                          </button>
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => {
                              setShowImpactCorrection(false);
                              setError("");
                            }}
                            className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                          >
                            Batal
                          </button>
                        </div>
                      </div>
                    )}
                    {ticket.fieldImpactCorrectedByName && (
                      <p className="mt-2 text-[11px] text-slate-400">
                        Terakhir dikoreksi oleh {ticket.fieldImpactCorrectedByName} · {formatDateTime(ticket.fieldImpactCorrectedAt)}
                        {ticket.fieldImpactCorrectionReason ? ` — ${ticket.fieldImpactCorrectionReason}` : ""}
                      </p>
                    )}
                  </div>
                )}
              </Card>

              {(ticket.resolutionNote || ticket.handledByName) && (
                <Card title="Hasil Penanganan">
                  <div className="space-y-2 text-sm">
                    <Info label="Ditangani oleh" value={ticket.handledByName} />
                    <Info label="Catatan" value={ticket.resolutionNote} />
                    {ticket.resolutionPhotoUrls && ticket.resolutionPhotoUrls.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {ticket.resolutionPhotoUrls.map((url, i) => (
                          <a key={url} href={url} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline">
                            Foto bukti {i + 1}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                </Card>
              )}

              {/* Timeline */}
              <Card title="Timeline Laporan">
                {!isClosedNonCompleted ? (
                  <div className="flex flex-wrap items-start gap-y-4">
                    {ISSUE_TIMELINE_STEPS.map((step, index) => {
                      const isDone = index < timelineActiveIndex || (index === timelineActiveIndex && ticket.status === "completed");
                      const isActive = index === timelineActiveIndex && ticket.status !== "completed";
                      // Section C — step "Selesai" TIDAK boleh terlihat final
                      // begitu pelapor konfirmasi; masih "menunggu QHSE tutup"
                      // sampai status benar-benar "completed".
                      const isLastStep = index === ISSUE_TIMELINE_STEPS.length - 1;
                      const stepLabel = isLastStep && ticket.status === "reporter_confirmed" ? "Siap Ditutup" : step.label;
                      return (
                        <div key={step.key} className="flex items-start">
                          <div className="flex w-24 flex-col items-center gap-2 text-center sm:w-28">
                            <span
                              className={clsx(
                                "flex h-9 w-9 items-center justify-center rounded-full text-xs font-bold",
                                isDone ? "bg-emerald-500 text-white" : isActive ? "bg-blue-600 text-white" : "bg-slate-200 text-slate-400"
                              )}
                            >
                              {isDone ? <Check size={16} /> : index + 1}
                            </span>
                            <span className={clsx("text-xs leading-tight", isActive ? "font-semibold text-slate-800" : isDone ? "text-slate-600" : "text-slate-400")}>
                              {stepLabel}
                            </span>
                            {isLastStep && ticket.status === "reporter_confirmed" && (
                              <span className="text-[10px] leading-tight text-slate-400">Menunggu QHSE menutup laporan</span>
                            )}
                          </div>
                          {index < ISSUE_TIMELINE_STEPS.length - 1 && (
                            <span className={clsx("mt-4 h-0.5 w-6 shrink-0 sm:w-10", isDone ? "bg-emerald-400" : "bg-slate-200")} />
                          )}
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <Badge
                    label={`Laporan ${ISSUE_STATUS_LABEL[ticket.status]}`}
                    colorClass={ISSUE_STATUS_COLOR[ticket.status] || "bg-slate-100 text-slate-600 border-slate-200"}
                  />
                )}
              </Card>
            </div>

            {/* Kolom kanan */}
            <div className="space-y-5">
              <Card title="Review QHSE">
                <div className="space-y-3 text-sm">
                  <div>
                    <p className="mb-0.5 text-xs text-slate-400">Prioritas Penanganan QHSE</p>
                    {ticket.handlingPriority ? (
                      <Badge label={ticket.handlingPriorityLabel || HANDLING_PRIORITY_LABEL[ticket.handlingPriority]} colorClass={HANDLING_PRIORITY_COLOR[ticket.handlingPriority]} />
                    ) : (
                      <p className="font-medium text-slate-800">Belum ditentukan</p>
                    )}
                    <p className="mt-1 text-[11px] text-slate-400">
                      Ditentukan QHSE untuk mengatur urutan penanganan berdasarkan risiko, dampak operasional, dan keselamatan.
                    </p>
                    {ticket.handlingPriorityReason && (
                      <p className="mt-1 text-xs text-slate-500">Alasan: {ticket.handlingPriorityReason}</p>
                    )}
                  </div>

                  {isQhse && !isClosed && (
                    <div>
                      {!showHandlingPriority ? (
                        <button
                          type="button"
                          onClick={() => {
                            setHandlingPriorityInput(ticket.handlingPriority || "normal");
                            setShowHandlingPriority(true);
                            setHandlingPriorityReasonInput("");
                            setError("");
                          }}
                          className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                        >
                          {ticket.handlingPriority ? "Ubah Prioritas Penanganan" : "Atur Prioritas Penanganan"}
                        </button>
                      ) : (
                        <div className="space-y-2 rounded-xl border border-slate-200 bg-slate-50 p-3">
                          <select
                            value={handlingPriorityInput}
                            onChange={(e) => setHandlingPriorityInput(e.target.value as HandlingPriority)}
                            className="input cursor-pointer"
                          >
                            {HANDLING_PRIORITY_OPTIONS.map((opt) => (
                              <option key={opt} value={opt}>
                                {HANDLING_PRIORITY_LABEL[opt]}
                              </option>
                            ))}
                          </select>
                          <textarea
                            value={handlingPriorityReasonInput}
                            onChange={(e) => setHandlingPriorityReasonInput(e.target.value)}
                            rows={2}
                            placeholder="Contoh: berdampak ke pekerjaan banyak karyawan / berisiko keselamatan / perlu vendor segera."
                            className="input"
                          />
                          {error && <p className="text-xs text-red-600">{error}</p>}
                          <div className="flex gap-2">
                            <button
                              type="button"
                              disabled={saving}
                              onClick={submitHandlingPriority}
                              className="rounded-xl bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-60"
                            >
                              Simpan
                            </button>
                            <button
                              type="button"
                              disabled={saving}
                              onClick={() => {
                                setShowHandlingPriority(false);
                                setError("");
                              }}
                              className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                            >
                              Batal
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {(ticket.reviewNote || ticket.reviewedByName) && (
                    <div className="border-t border-slate-100 pt-3">
                      <Info label="Ditinjau oleh" value={ticket.reviewedByName} />
                      <div className="mt-2">
                        <Info label="Catatan QHSE" value={ticket.reviewNote} />
                      </div>
                    </div>
                  )}
                </div>
              </Card>

              {/* Section I — card khusus "Penanganan Eksternal" (bukan card
                  "Tim Terkait" internal) supaya jelas ini bukan tim internal
                  yang login & klik "Mulai Tangani". QHSE cuma penghubung —
                  tidak ada nominal biaya atau bukti foto lagi, cukup status
                  koordinasi + estimasi kedatangan. */}
              {ticket.externalHandling ? (
                <Card title="Penanganan Eksternal">
                  <div className="grid gap-x-4 gap-y-3 text-sm sm:grid-cols-2">
                    <Info label="Tim Penanganan" value="Teknisi Eksternal" />
                    <Info label="Jenis Teknisi" value={ticket.externalHandlerLabel || (ticket.externalHandlerType ? EXTERNAL_HANDLER_TYPE_LABEL[ticket.externalHandlerType] : undefined)} />
                    <Info
                      label="Status"
                      value={ticket.externalCoordinationStatus ? ticket.externalCoordinationStatusLabel || EXTERNAL_COORDINATION_STATUS_LABEL[ticket.externalCoordinationStatus] : undefined}
                    />
                    <Info label="Estimasi Kedatangan" value={ticket.externalEstimatedArrivalLabel || "Belum ditentukan"} />
                    <Info label="Nama Vendor" value={ticket.vendorName || "Belum ditentukan"} />
                    <Info label="Kontak Vendor" value={ticket.vendorContact || "Belum tersedia"} />
                    {ticket.coordinationNote && (
                      <div className="sm:col-span-2">
                        <Info label="Catatan Koordinasi" value={ticket.coordinationNote} />
                      </div>
                    )}
                    {ticket.noteForReporter && (
                      <div className="sm:col-span-2">
                        <Info label="Catatan untuk Pelapor" value={ticket.noteForReporter} />
                      </div>
                    )}
                  </div>
                </Card>
              ) : (
                <Card title="Tim Terkait">
                  {!ticket.assignedTeam && !isAssignmentIncomplete(ticket) ? (
                    <p className="text-sm font-medium text-slate-500">Belum ditugaskan</p>
                  ) : isAssignmentIncomplete(ticket) ? (
                    <div className="space-y-3">
                      <Info label="Status" value={displayStatusLabel} />
                      <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                        Status laporan sudah diteruskan, tetapi tim penanganan belum dipilih. Data penugasan belum lengkap — lengkapi tim dan penanggung jawab.
                      </div>
                    </div>
                  ) : (
                    <div className="grid gap-x-4 gap-y-3 text-sm sm:grid-cols-2">
                      <Info label="Tim Terkait" value={ticket.assignedTeamLabel || ticket.assignedTeam || undefined} />
                      <Info
                        label="Penanggung Jawab"
                        value={ticket.assignedToName || (ticket.vendorName ? `${ticket.vendorName} (Vendor)` : "Belum ada petugas")}
                      />
                      {ticket.vendorContact && <Info label="Kontak Vendor" value={ticket.vendorContact} />}
                      <div className="sm:col-span-2">
                        <Info label="Instruksi QHSE" value={ticket.assignmentInstruction} />
                      </div>
                      <Info
                        label="Target Penanganan"
                        value={
                          ticket.targetResolutionLabel
                            ? `${ticket.targetResolutionLabel}${ticket.targetResolutionAt ? " — " + formatDateTime(ticket.targetResolutionAt) : ""}`
                            : formatDateTime(ticket.targetResolutionAt)
                        }
                      />
                      <Info label="Status" value={displayStatusLabel} />
                      {ticket.reassignmentReason && (
                        <div className="sm:col-span-2 border-t border-slate-100 pt-2">
                          <Info label="Alasan Pergantian Terakhir" value={ticket.reassignmentReason} />
                        </div>
                      )}
                    </div>
                  )}
                </Card>
              )}

              {/* Section A — QHSE harus langsung paham laporan sudah
                  dikonfirmasi selesai oleh pelapor dan tinggal ditutup,
                  bukan cuma lihat badge kecil di header. */}
              {ticket.status === "reporter_confirmed" && (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                  <div className="flex items-center gap-2">
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
                      <Check size={16} />
                    </span>
                    <h3 className="text-sm font-semibold text-emerald-800">Sudah Dikonfirmasi Pelapor</h3>
                  </div>
                  <p className="mt-2 text-sm text-emerald-900">Pelapor mengonfirmasi kendala sudah selesai.</p>
                  <div className="mt-3 grid gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
                    <Info
                      label="Dikonfirmasi oleh"
                      value={ticket.reporterConfirmedByName || ticket.createdByName || undefined}
                    />
                    <Info label="Waktu konfirmasi" value={formatDateTime(ticket.reporterConfirmedAt)} />
                  </div>
                  <div className="mt-3">
                    <p className="mb-0.5 text-xs text-emerald-700">Catatan Pelapor</p>
                    <p className="text-sm text-emerald-900">{ticket.reporterConfirmationNote || "Tidak ada catatan tambahan."}</p>
                  </div>
                </div>
              )}

              {/* Section A/G — untuk pelapor saat waiting_reporter_confirmation,
                  panel ini tampil sebagai "Konfirmasi Pelapor" (highlight),
                  bukan "Aksi Berikutnya" generik, karena ini keputusan
                  penting yang cuma pelapor bisa jawab. */}
              {!readOnly && availableActions.length > 0 && (
                <div
                  className={clsx(
                    "rounded-2xl border p-4",
                    canReporterConfirm ? "border-cyan-200 bg-cyan-50" : "border-slate-200 bg-slate-50"
                  )}
                >
                  <h3 className="text-sm font-semibold text-slate-800">
                    {canReporterConfirm ? "Konfirmasi Pelapor" : "Aksi Berikutnya"}
                  </h3>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {canReporterConfirm
                      ? `Teknisi/tim terkait sudah memberi update. ${confirmationCopy.subtitle}`
                      : ticket.status === "reporter_confirmed"
                      ? "Pelapor sudah mengonfirmasi kendala selesai. QHSE dapat menutup laporan ini."
                      : "Pilih tindakan sesuai kondisi laporan saat ini."}
                  </p>

                  <div className="mt-3">
                    {pendingAction ? (
                      <div className="space-y-3 rounded-xl border border-slate-200 bg-white p-3">
                        <p className="text-sm font-semibold text-slate-800">
                          {pendingAction.key === "confirm_done"
                            ? "Konfirmasi Kendala Selesai"
                            : pendingAction.key === "still_problem"
                            ? "Kendala Masih Bermasalah"
                            : pendingAction.key === "close"
                            ? "Tutup Laporan?"
                            : pendingAction.label}
                        </p>
                        {pendingAction.key === "confirm_done" && (
                          <p className="text-xs text-slate-500">Apakah kendala ini sudah selesai/normal di lapangan?</p>
                        )}
                        {pendingAction.key === "close" && (
                          <p className="text-xs text-slate-500">
                            Pelapor sudah mengonfirmasi kendala selesai. Setelah ditutup, laporan akan masuk ke riwayat.
                          </p>
                        )}
                        <div>
                          <label className="mb-1.5 block text-xs font-medium text-slate-500">
                            {pendingAction.notePlaceholder || "Catatan"} {pendingAction.requiresNote && <span className="text-red-500">*</span>}
                          </label>
                          <textarea
                            value={noteInput}
                            onChange={(e) => setNoteInput(e.target.value)}
                            rows={3}
                            placeholder={pendingAction.notePlaceholder}
                            className="input"
                          />
                        </div>
                        {pendingAction.requiresPhoto && (
                          <div>
                            <label className="mb-1.5 block text-xs font-medium text-slate-500">Foto Bukti (opsional)</label>
                            <input
                              type="file"
                              accept="image/*"
                              multiple
                              onChange={(e) => setPhotoFiles(Array.from(e.target.files || []).slice(0, 4))}
                              className="block w-full text-xs text-slate-500"
                            />
                            {photoFiles.length > 0 && <p className="mt-1 text-xs text-slate-500">{photoFiles.length} file dipilih</p>}
                          </div>
                        )}
                        {error && <p className="text-xs text-red-600">{error}</p>}
                        <div className="flex gap-2">
                          <button
                            type="button"
                            disabled={saving}
                            onClick={() => runAction(pendingAction)}
                            className={clsx("rounded-xl px-4 py-2 text-sm font-medium cursor-pointer disabled:opacity-60", ACTION_TONE_CLASS[pendingAction.tone])}
                          >
                            {saving
                              ? "Menyimpan..."
                              : pendingAction.key === "confirm_done"
                              ? "Ya, Sudah Selesai"
                              : pendingAction.key === "still_problem"
                              ? "Kirim Catatan"
                              : pendingAction.key === "close"
                              ? "Tutup Laporan"
                              : "Kirim"}
                          </button>
                          <button
                            type="button"
                            disabled={saving}
                            onClick={closeActionForm}
                            className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
                          >
                            Batal
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        {availableActions.map((action) => (
                          <button
                            key={action.key}
                            type="button"
                            disabled={saving}
                            onClick={() => {
                              // Section G/J — "Teruskan ke Tim Terkait" dan "Ganti
                              // Tim/Penanggung Jawab" WAJIB lewat modal assignment
                              // (pilih tim + petugas + instruksi), bukan aksi instan.
                              if (action.key === "forward" || action.key === "complete_assignment") {
                                setAssignModalMode("assign");
                                return;
                              }
                              if (action.key === "reassign" || action.key === "change_handling") {
                                setAssignModalMode("reassign");
                                return;
                              }
                              if (action.key === "update_arrival_estimate") {
                                setShowVendorModal(true);
                                return;
                              }
                              // Section C/E — "Sudah Selesai" dan "Tutup
                              // Laporan" SELALU buka modal konfirmasi kecil
                              // (catatan opsional), jangan langsung submit
                              // tanpa konfirmasi eksplisit.
                              if (action.requiresNote || action.requiresPhoto || action.key === "confirm_done" || action.key === "close") openAction(action);
                              else runAction(action);
                            }}
                            className={clsx("rounded-xl px-4 py-2 text-sm font-medium cursor-pointer disabled:opacity-60", ACTION_TONE_CLASS[action.tone])}
                          >
                            {action.label}
                          </button>
                        ))}
                      </div>
                    )}
                    {error && !pendingAction && <p className="mt-2 text-xs text-red-600">{error}</p>}
                  </div>
                </div>
              )}

              {/* Riwayat Update */}
              {logs.length > 0 && (
                <Card title="Riwayat Update">
                  <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
                    {logs.map((l) => (
                      <div key={l.id} className="text-xs text-slate-500">
                        <span className="font-medium text-slate-700">{l.createdByName}</span> {l.message || l.actionLabel}
                        {l.note ? ` — ${l.note}` : ""} · {formatDateTime(l.createdAt)}
                      </div>
                    ))}
                  </div>
                </Card>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>

    {assignModalMode && (
      <AssignIssueTicketModal
        ticket={ticket}
        mode={assignModalMode}
        open={!!assignModalMode}
        onClose={() => setAssignModalMode(null)}
      />
    )}
    {showVendorModal && (
      <VendorCoordinationModal ticket={ticket} open={showVendorModal} onClose={() => setShowVendorModal(false)} />
    )}
    </>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
      <h3 className="mb-3 text-sm font-semibold text-slate-800">{title}</h3>
      {children}
    </div>
  );
}

function Info({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <p className="text-xs text-slate-400 mb-0.5">{label}</p>
      <p className="text-slate-800 font-medium">{value || "-"}</p>
    </div>
  );
}
