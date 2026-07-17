"use client";

import { useEffect, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { X } from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import {
  AssetIssueLog,
  AssetIssueTicket,
  IssueActionTaken,
  IssueCauseCategory,
  IssuePriority,
} from "@/lib/types";
import { fetchActiveUsersByRole, writeAssetIssueLog } from "@/lib/firestore-helpers";
import { createAssetNotification } from "@/lib/notifications";
import {
  formatDateTime,
  ISSUE_PRIORITY_COLOR,
  ISSUE_PRIORITY_LABEL,
  ISSUE_STATUS_COLOR,
  ISSUE_STATUS_LABEL,
} from "@/lib/utils";
import Badge from "@/components/Badge";

const CAUSE_OPTIONS: IssueCauseCategory[] = [
  "Software",
  "Hardware",
  "Jaringan",
  "Kelistrikan",
  "Human Error",
  "Usia Asset",
  "Aksesoris Hilang",
  "Belum Diketahui",
];

const ACTION_OPTIONS: IssueActionTaken[] = [
  "Dibersihkan",
  "Restart / Reset",
  "Update Software",
  "Kosongkan Storage",
  "Ganti Aksesoris",
  "Ganti Sparepart",
  "Serahkan Vendor",
  "Tidak Ada Tindakan",
];

const PRIORITY_OPTIONS: IssuePriority[] = ["low", "medium", "high", "urgent"];

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
  const [logs, setLogs] = useState<AssetIssueLog[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !authReady) return;
    const unsub = onSnapshot(
      doc(db, "asset_issue_tickets", initialTicket.id),
      (snap) => {
        console.log("[Listener] issue ticket detail asset_issue_tickets doc success:", {
          id: initialTicket.id,
          exists: snap.exists(),
        });
        if (snap.exists()) setTicket({ id: snap.id, ...snap.data() } as AssetIssueTicket);
      },
      (error) => {
        console.error("[Listener] issue ticket detail asset_issue_tickets doc error:", {
          id: initialTicket.id,
          error,
        });
      }
    );
    return () => unsub();
  }, [open, authReady, initialTicket.id]);

  const [priority, setPriority] = useState<IssuePriority>(ticket.priority);
  const [reviewNote, setReviewNote] = useState("");

  const [diagnosis, setDiagnosis] = useState(ticket.diagnosis || "");
  const [causeCategory, setCauseCategory] = useState<IssueCauseCategory | "">(
    ticket.causeCategory || ""
  );
  const [actionTaken, setActionTaken] = useState<IssueActionTaken | "">(
    ticket.actionTaken || ""
  );
  const [estimatedFinishAt, setEstimatedFinishAt] = useState(ticket.estimatedFinishAt || "");
  const [technicianNote, setTechnicianNote] = useState(ticket.resolutionNote || "");

  useEffect(() => {
    if (!open || !authReady) return;
    const q = query(
      collection(db, "asset_issue_logs"),
      where("ticketId", "==", ticket.id),
      orderBy("performedAt", "desc")
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        console.log("[Listener] issue ticket detail asset_issue_logs success:", snap.size);
        setLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() } as AssetIssueLog)));
      },
      (error) => {
        console.error("[Listener] issue ticket detail asset_issue_logs error:", error);
      }
    );
    return () => unsub();
  }, [open, authReady, ticket.id]);

  if (!open) return null;

  const canReview =
    !readOnly &&
    role === "asset_admin" &&
    ["open", "review_by_asset_admin", "need_more_info"].includes(ticket.status);

  const canDiagnose =
    !readOnly &&
    (role === "it_team" || (role === "super_admin" && ticket.assignedToUid === assetUser?.uid)) &&
    ["waiting_diagnosis", "checking", "minor_fix", "needs_follow_up", "waiting_sparepart", "waiting_vendor"].includes(
      ticket.status
    );

  const canClose = !readOnly && ticket.status === "resolved";

  const ticketRef = doc(db, "asset_issue_tickets", ticket.id);

  const runUpdate = async (
    action: Parameters<typeof writeAssetIssueLog>[0]["action"],
    updates: Record<string, unknown>,
    note?: string
  ) => {
    setSaving(true);
    try {
      await updateDoc(ticketRef, { ...updates, updatedAt: serverTimestamp() });
      await writeAssetIssueLog({
        ticketId: ticket.id,
        ticketNumber: ticket.ticketNumber,
        action,
        oldStatus: ticket.status,
        newStatus: (updates.status as typeof ticket.status) || ticket.status,
        note,
        performedByUid: assetUser?.uid || "",
        performedByName: assetUser?.name || "",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleForward = async () => {
    await runUpdate(
      "forward_to_technician",
      {
        status: "waiting_diagnosis",
        priority,
        reviewedByUid: assetUser?.uid || "",
        reviewedByName: assetUser?.name || "",
        reviewedAt: serverTimestamp(),
        reviewNote,
      },
      reviewNote || "Diteruskan ke teknisi"
    );
    const technicians = await fetchActiveUsersByRole("it_team");
    await Promise.all(
      technicians.map((tech) =>
        createAssetNotification({
          recipientUid: tech.uid,
          recipientName: tech.name,
          recipientRole: "it_team",
          title: "Ticket Ditugaskan",
          message: `${ticket.ticketNumber} perlu diagnosa teknisi.`,
          type: "ticket_assigned",
          priority,
          linkUrl: `/maintenance?tab=technician-queue&ticketId=${ticket.id}`,
          relatedType: "ticket",
          relatedId: ticket.id,
          relatedNumber: ticket.ticketNumber,
          createdByUid: assetUser?.uid,
          createdByName: assetUser?.name,
        })
      )
    );
  };

  const handleRequestInfo = async () => {
    await runUpdate(
      "request_more_info",
      {
        status: "need_more_info",
        priority,
        reviewedByUid: assetUser?.uid || "",
        reviewedByName: assetUser?.name || "",
        reviewedAt: serverTimestamp(),
        reviewNote,
      },
      reviewNote || "Butuh info tambahan dari pelapor"
    );
    await createAssetNotification({
      recipientUid: ticket.reportedByUid,
      recipientName: ticket.reportedByName,
      recipientRole: "staff",
      title: "Butuh Info Tambahan",
      message: `Mohon lengkapi informasi untuk ${ticket.ticketNumber}`,
      type: "ticket_need_info",
      priority,
      linkUrl: "/my-reports",
      relatedType: "ticket",
      relatedId: ticket.id,
      relatedNumber: ticket.ticketNumber,
      createdByUid: assetUser?.uid,
      createdByName: assetUser?.name,
    });
  };

  const notifyStatusUpdate = async (
    statusLabel: string,
    qhseTab: "staff-reports" | "follow-up" | "history" = "staff-reports"
  ) => {
    const recipients: { uid: string; name: string; role: "staff" | "asset_admin" }[] = [];
    if (ticket.reportedByUid) {
      recipients.push({ uid: ticket.reportedByUid, name: ticket.reportedByName, role: "staff" });
    }
    const qhse = await fetchActiveUsersByRole("asset_admin");
    qhse.forEach((q) => recipients.push({ uid: q.uid, name: q.name, role: "asset_admin" }));

    await Promise.all(
      recipients.map((r) =>
        createAssetNotification({
          recipientUid: r.uid,
          recipientName: r.name,
          recipientRole: r.role,
          title: "Status Laporan Diperbarui",
          message: `${ticket.ticketNumber} sekarang: ${statusLabel}`,
          type: "ticket_status_updated",
          priority: ticket.priority,
          linkUrl:
            r.role === "staff" ? "/my-reports" : `/maintenance?tab=${qhseTab}&ticketId=${ticket.id}`,
          relatedType: "ticket",
          relatedId: ticket.id,
          relatedNumber: ticket.ticketNumber,
          createdByUid: assetUser?.uid,
          createdByName: assetUser?.name,
        })
      )
    );
  };

  const handleReject = async () => {
    await runUpdate(
      "reject_ticket",
      {
        status: "rejected",
        priority,
        reviewedByUid: assetUser?.uid || "",
        reviewedByName: assetUser?.name || "",
        reviewedAt: serverTimestamp(),
        reviewNote,
      },
      reviewNote || "Laporan ditolak"
    );
    await notifyStatusUpdate(ISSUE_STATUS_LABEL.rejected, "history");
  };

  const handleStartDiagnosis = async () => {
    await runUpdate(
      "start_diagnosis",
      {
        status: "checking",
        assignedToUid: assetUser?.uid || "",
        assignedToName: assetUser?.name || "",
        assignedAt: serverTimestamp(),
      },
      "Mulai diagnosa"
    );
    await notifyStatusUpdate(ISSUE_STATUS_LABEL.checking);
  };

  const handleSaveDiagnosis = () =>
    runUpdate(
      "update_diagnosis",
      {
        diagnosis,
        causeCategory: causeCategory || null,
        actionTaken: actionTaken || null,
        estimatedFinishAt: estimatedFinishAt || null,
        resolutionNote: technicianNote,
      },
      "Update diagnosa/tindakan"
    );

  const handleMarkResolved = async () => {
    await runUpdate(
      "mark_resolved",
      {
        status: "resolved",
        diagnosis,
        causeCategory: causeCategory || null,
        actionTaken: actionTaken || null,
        resolutionNote: technicianNote,
        resolvedAt: serverTimestamp(),
      },
      "Ticket ditandai selesai"
    );
    await createAssetNotification({
      recipientUid: ticket.reportedByUid,
      recipientName: ticket.reportedByName,
      recipientRole: "staff",
      title: "Ticket Selesai",
      message: `${ticket.ticketNumber} telah selesai ditangani.`,
      type: "ticket_resolved",
      priority: ticket.priority,
      linkUrl: "/my-reports",
      relatedType: "ticket",
      relatedId: ticket.id,
      relatedNumber: ticket.ticketNumber,
      createdByUid: assetUser?.uid,
      createdByName: assetUser?.name,
    });
  };

  const handleFollowUp = async (
    status: "needs_follow_up" | "waiting_sparepart" | "waiting_vendor"
  ) => {
    await runUpdate(
      "mark_follow_up",
      { status, diagnosis, causeCategory: causeCategory || null, resolutionNote: technicianNote },
      `Dipindahkan ke ${ISSUE_STATUS_LABEL[status]}`
    );
    await notifyStatusUpdate(ISSUE_STATUS_LABEL[status], "follow-up");
  };

  const handleClose = async () => {
    await runUpdate("close_ticket", { status: "closed", closedAt: serverTimestamp() }, "Ticket ditutup");
    await notifyStatusUpdate(ISSUE_STATUS_LABEL.closed, "history");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-lg border border-slate-200 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 pt-6 mb-1">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{ticket.ticketNumber}</h2>
            <p className="text-xs text-slate-400">{ticket.queueNumber}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 cursor-pointer rounded-lg p-1 hover:bg-slate-100"
          >
            <X size={18} />
          </button>
        </div>

        <div className="px-6 pb-6 space-y-5">
          <div className="flex items-center gap-2 flex-wrap">
            <Badge label={ISSUE_STATUS_LABEL[ticket.status]} colorClass={ISSUE_STATUS_COLOR[ticket.status]} />
            <Badge label={ISSUE_PRIORITY_LABEL[ticket.priority]} colorClass={ISSUE_PRIORITY_COLOR[ticket.priority]} />
          </div>

          <div className="grid sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <Info label="Asset" value={`${ticket.assetName} (${ticket.assetCode})`} />
            <Info label="Lokasi" value={ticket.assetLocation} />
            <Info label="Pelapor" value={ticket.reportedByName} />
            <Info label="Tanggal Lapor" value={formatDateTime(ticket.reportedAt)} />
            <Info label="Gejala" value={ticket.symptomType} />
            <Info label="Dampak" value={ticket.impactLevel} />
          </div>

          <div>
            <p className="text-xs text-slate-400 mb-1">Catatan Pelapor</p>
            <p className="text-sm text-slate-800 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
              {ticket.description}
            </p>
          </div>

          {ticket.attachmentUrls && ticket.attachmentUrls.length > 0 && (
            <div>
              <p className="text-xs text-slate-400 mb-1">Lampiran</p>
              {ticket.attachmentUrls.map((url, i) => (
                <a
                  key={url}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-blue-600 hover:underline block"
                >
                  {ticket.attachmentFiles?.[i] || `Lampiran ${i + 1}`}
                </a>
              ))}
            </div>
          )}

          {(ticket.reviewNote || ticket.reviewedByName) && (
            <div className="grid sm:grid-cols-2 gap-x-4 gap-y-2 text-sm border-t border-slate-100 pt-4">
              <Info label="Direview oleh" value={ticket.reviewedByName} />
              <Info label="Catatan Review" value={ticket.reviewNote} />
            </div>
          )}

          {(ticket.diagnosis || ticket.actionTaken) && (
            <div className="grid sm:grid-cols-2 gap-x-4 gap-y-2 text-sm border-t border-slate-100 pt-4">
              <Info label="Diagnosa" value={ticket.diagnosis} />
              <Info label="Kategori Penyebab" value={ticket.causeCategory} />
              <Info label="Tindakan" value={ticket.actionTaken} />
              <Info label="Estimasi Selesai" value={ticket.estimatedFinishAt} />
              <Info label="Catatan Teknisi" value={ticket.resolutionNote} />
            </div>
          )}

          {canReview && (
            <div className="border-t border-slate-100 pt-4 space-y-3">
              <h3 className="text-sm font-semibold text-slate-800">Review Laporan</h3>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">Prioritas</label>
                <select
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as IssuePriority)}
                  className="input cursor-pointer"
                >
                  {PRIORITY_OPTIONS.map((p) => (
                    <option key={p} value={p}>
                      {ISSUE_PRIORITY_LABEL[p]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">
                  Catatan Review
                </label>
                <textarea
                  value={reviewNote}
                  onChange={(e) => setReviewNote(e.target.value)}
                  rows={2}
                  className="input"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleForward}
                  disabled={saving}
                  className="rounded-xl bg-gradient-to-r from-blue-600 to-teal-500 text-white px-4 py-2 text-sm font-medium cursor-pointer hover:brightness-105 disabled:opacity-60"
                >
                  Teruskan ke Teknisi
                </button>
                <button
                  type="button"
                  onClick={handleRequestInfo}
                  disabled={saving}
                  className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium cursor-pointer hover:bg-slate-50 disabled:opacity-60"
                >
                  Minta Info Tambahan
                </button>
                <button
                  type="button"
                  onClick={handleReject}
                  disabled={saving}
                  className="rounded-xl border border-red-200 bg-red-50 text-red-700 px-4 py-2 text-sm font-medium cursor-pointer hover:bg-red-100 disabled:opacity-60"
                >
                  Tolak
                </button>
              </div>
            </div>
          )}

          {canDiagnose && (
            <div className="border-t border-slate-100 pt-4 space-y-3">
              <h3 className="text-sm font-semibold text-slate-800">Diagnosa Teknisi</h3>
              {ticket.status === "waiting_diagnosis" && (
                <button
                  type="button"
                  onClick={handleStartDiagnosis}
                  disabled={saving}
                  className="rounded-xl bg-purple-600 text-white px-4 py-2 text-sm font-medium cursor-pointer hover:bg-purple-700 disabled:opacity-60"
                >
                  Mulai Diagnosa
                </button>
              )}
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">Diagnosa</label>
                <textarea
                  value={diagnosis}
                  onChange={(e) => setDiagnosis(e.target.value)}
                  rows={2}
                  className="input"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">
                    Kategori Penyebab
                  </label>
                  <select
                    value={causeCategory}
                    onChange={(e) => setCauseCategory(e.target.value as IssueCauseCategory)}
                    className="input cursor-pointer"
                  >
                    <option value="">Pilih kategori</option>
                    {CAUSE_OPTIONS.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">
                    Tindakan
                  </label>
                  <select
                    value={actionTaken}
                    onChange={(e) => setActionTaken(e.target.value as IssueActionTaken)}
                    className="input cursor-pointer"
                  >
                    <option value="">Pilih tindakan</option>
                    {ACTION_OPTIONS.map((a) => (
                      <option key={a} value={a}>
                        {a}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">
                  Estimasi Selesai
                </label>
                <input
                  type="datetime-local"
                  value={estimatedFinishAt}
                  onChange={(e) => setEstimatedFinishAt(e.target.value)}
                  className="input cursor-text"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">
                  Catatan Teknisi
                </label>
                <textarea
                  value={technicianNote}
                  onChange={(e) => setTechnicianNote(e.target.value)}
                  rows={2}
                  className="input"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={handleSaveDiagnosis}
                  disabled={saving}
                  className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium cursor-pointer hover:bg-slate-50 disabled:opacity-60"
                >
                  Simpan Diagnosa
                </button>
                <button
                  type="button"
                  onClick={handleMarkResolved}
                  disabled={saving}
                  className="rounded-xl bg-emerald-600 text-white px-4 py-2 text-sm font-medium cursor-pointer hover:bg-emerald-700 disabled:opacity-60"
                >
                  Tandai Selesai
                </button>
                <button
                  type="button"
                  onClick={() => handleFollowUp("needs_follow_up")}
                  disabled={saving}
                  className="rounded-xl border border-red-200 bg-red-50 text-red-700 px-4 py-2 text-sm font-medium cursor-pointer hover:bg-red-100 disabled:opacity-60"
                >
                  Butuh Tindakan Lanjutan
                </button>
                <button
                  type="button"
                  onClick={() => handleFollowUp("waiting_sparepart")}
                  disabled={saving}
                  className="rounded-xl border border-rose-200 bg-rose-50 text-rose-700 px-4 py-2 text-sm font-medium cursor-pointer hover:bg-rose-100 disabled:opacity-60"
                >
                  Menunggu Sparepart
                </button>
                <button
                  type="button"
                  onClick={() => handleFollowUp("waiting_vendor")}
                  disabled={saving}
                  className="rounded-xl border border-rose-200 bg-rose-50 text-rose-700 px-4 py-2 text-sm font-medium cursor-pointer hover:bg-rose-100 disabled:opacity-60"
                >
                  Menunggu Vendor
                </button>
              </div>
            </div>
          )}

          {canClose && (
            <div className="border-t border-slate-100 pt-4">
              <button
                type="button"
                onClick={handleClose}
                disabled={saving}
                className="rounded-xl bg-slate-900 text-white px-4 py-2 text-sm font-medium cursor-pointer hover:bg-slate-800 disabled:opacity-60"
              >
                Tutup Ticket
              </button>
            </div>
          )}

          {logs.length > 0 && (
            <div className="border-t border-slate-100 pt-4">
              <h3 className="text-sm font-semibold text-slate-800 mb-2">Riwayat Update</h3>
              <div className="space-y-2">
                {logs.map((l) => (
                  <div key={l.id} className="text-xs text-slate-500">
                    <span className="font-medium text-slate-700">{l.performedByName}</span>{" "}
                    {l.note || l.action} · {formatDateTime(l.performedAt)}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
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
