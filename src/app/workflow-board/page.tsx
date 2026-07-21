"use client";

import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  collectionGroup,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { AssetIssueTicket, MaintenanceWorkOrder, MaintenanceWorkOrderItem } from "@/lib/types";
import { workOrderProgress } from "@/lib/reports";
import {
  BoardColumnKey,
  BoardFilterKey,
  BoardItem,
  buildBoardItemFromTicket,
  buildBoardItemFromWorkOrder,
  canMoveMaintenanceCard,
  getColumnForItem,
  getIssueTicketStatusLabel,
  getMoveDeniedMessage,
  getRoutineStatusLabel,
  getStatusFromColumn,
  ROUTINE_COLUMNS,
  RoutineColumnKey,
} from "@/lib/maintenanceBoard";
import ProtectedLayout from "@/components/ProtectedLayout";
import PageHeader from "@/components/PageHeader";
import MaintenanceKanbanBoard from "@/components/maintenance/MaintenanceKanbanBoard";
import IssueTicketDetailModal from "@/components/IssueTicketDetailModal";
import WorkOrderDetailModal from "@/components/WorkOrderDetailModal";
import { Toast, ToastState } from "@/components/Toast";

type OptimisticMove = {
  status: string;
  fromStatus: string;
};

// Workflow Board terpisah dari tabel Maintenance & Kendala. Maintenance
// Rutin dan Laporan Kendala Staff PUNYA ALUR SENDIRI-SENDIRI (kolom,
// label, mapping status) — board ini tidak memaksa keduanya lewat satu
// alur; kolom yang ditampilkan berubah mengikuti filter aktif.
function isAssignedToCurrentUid(
  item: { assignedToUid?: string | null; technicianUid?: string | null; assignedTechnicianUid?: string | null },
  uid?: string | null
) {
  if (!uid) return false;
  return item.assignedToUid === uid || item.technicianUid === uid || item.assignedTechnicianUid === uid;
}

function boardItemKey(item: Pick<BoardItem, "sourceCollection" | "id">) {
  return `${item.sourceCollection}:${item.id}`;
}

export default function WorkflowBoardPage() {
  const { firebaseUser, assetUser, role, loading } = useAuth();
  const authReady = !loading && !!firebaseUser && !!assetUser && !!role;
  const canViewBoard = authReady && (role === "super_admin" || role === "asset_admin" || role === "it_team");

  const [workOrders, setWorkOrders] = useState<MaintenanceWorkOrder[]>([]);
  const [tickets, setTickets] = useState<AssetIssueTicket[]>([]);
  const [items, setItems] = useState<MaintenanceWorkOrderItem[]>([]);
  const [activeFilter, setActiveFilter] = useState<BoardFilterKey>("issue_ticket");
  const [optimisticMoves, setOptimisticMoves] = useState<Record<string, OptimisticMove>>({});
  const [detailTarget, setDetailTarget] = useState<AssetIssueTicket | null>(null);
  const [woDetailTarget, setWoDetailTarget] = useState<MaintenanceWorkOrder | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);

  useEffect(() => {
    if (!canViewBoard) return;
    const q = query(collection(db, "asset_maintenance_work_orders"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(
      q,
      (snap) => setWorkOrders(snap.docs.map((d) => ({ id: d.id, ...d.data() } as MaintenanceWorkOrder))),
      (err) => console.error("[Workflow Board Listener] asset_maintenance_work_orders error:", err)
    );
    return () => unsub();
  }, [canViewBoard, role, firebaseUser?.uid]);

  useEffect(() => {
    if (!canViewBoard) return;
    const q = query(collection(db, "asset_issue_tickets"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(
      q,
      (snap) => setTickets(snap.docs.map((d) => ({ id: d.id, ...d.data() } as AssetIssueTicket))),
      (err) => console.error("[Workflow Board Listener] asset_issue_tickets error:", err)
    );
    return () => unsub();
  }, [canViewBoard, role, firebaseUser?.uid]);

  // Progress per work order rutin — dipakai bar progress di card, sumber
  // sama seperti tabel Maintenance Rutin (workOrderProgress dari items).
  useEffect(() => {
    if (!canViewBoard) return;
    const unsub = onSnapshot(
      collectionGroup(db, "items"),
      (snap) => setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() } as MaintenanceWorkOrderItem))),
      (err) => console.error("[Workflow Board Listener] items error:", err)
    );
    return () => unsub();
  }, [canViewBoard]);

  const currentUid = assetUser?.uid || firebaseUser?.uid || null;
  const currentName = assetUser?.name || firebaseUser?.email || "";

  // Role helper — dipakai debug log & pesan penolakan, BUKAN sumber
  // kebenaran izin drag (itu tetap canMoveMaintenanceCard di
  // lib/maintenanceBoard.ts, disinkronkan dengan firestore.rules).
  const isSuperAdminRole = role === "super_admin";
  const isQhseRole = role === "asset_admin";
  const isItTeamRole = role === "it_team";
  const isStaffRole = role === "staff";
  const isFinanceRole = role === "asset_finance";

  // Dipakai untuk debug log saja — pengecekan izin drag yang sebenarnya
  // (canMoveMaintenanceCard) sengaja HANYA mencocokkan UID karena
  // firestore.rules (isAssignedMaintenanceTechnician) juga hanya
  // mencocokkan UID, bukan email. Kalau frontend meloloskan lewat email
  // tapi rules menolak, itu akan tampil sebagai error "gagal update
  // status" yang membingungkan — jadi email match TIDAK dipakai untuk
  // keputusan izin, hanya untuk informasi debug.
  function isCurrentUserAssignedTechnician(item: BoardItem | null | undefined): boolean {
    if (!item || item.sourceType !== "work_order") return false;
    const raw = item.raw as MaintenanceWorkOrder;
    const uidMatch = isAssignedToCurrentUid(item, currentUid);
    const emailMatch =
      !!firebaseUser?.email &&
      (raw.assignedToEmail === firebaseUser.email ||
        raw.technicianEmail === firebaseUser.email ||
        raw.assignedTechnicianEmail === firebaseUser.email);
    return uidMatch || emailMatch;
  }

  // Section D — transisi tertentu wajib diisi lewat form (jadwal, laporan,
  // keputusan QHSE) karena butuh data pendukung yang tidak ada saat drag.
  // Drag ke transisi ini TIDAK langsung updateDoc — board hanya membuka
  // WorkOrderDetailModal (yang sudah punya form/tombol aksi untuk semua
  // transisi ini) supaya tidak ada dua tempat berbeda yang menyimpan field
  // wajib untuk transisi yang sama (rawan tidak sinkron).
  type RoutineTransitionRequirement =
    | "schedule_modal"
    | "submit_report_modal"
    | "complete_modal"
    | "revision_modal"
    | "direct_update";

  function getRoutineTransitionRequirement(
    fromColumn: RoutineColumnKey,
    toColumn: RoutineColumnKey
  ): RoutineTransitionRequirement {
    if (fromColumn === "accepted" && toColumn === "scheduled_by_it") return "schedule_modal";
    if ((fromColumn === "in_progress" || fromColumn === "revision_or_follow_up") && toColumn === "report_submitted") {
      return "submit_report_modal";
    }
    if ((fromColumn === "waiting_qhse_review" || fromColumn === "revision_or_follow_up") && toColumn === "completed") {
      return "complete_modal";
    }
    if (fromColumn === "waiting_qhse_review" && toColumn === "revision_or_follow_up") return "revision_modal";
    return "direct_update";
  }

  const ROUTINE_TRANSITION_MODAL_TITLE: Record<Exclude<RoutineTransitionRequirement, "direct_update">, string> = {
    schedule_modal: "Jadwalkan Pengerjaan",
    submit_report_modal: "Kirim Laporan Maintenance ke QHSE",
    complete_modal: "Tandai Maintenance Selesai",
    revision_modal: "Minta Revisi / Cek Ulang",
  };

  // Board sekarang selalu memuat KEDUA sumber (supaya segmented control bisa
  // menampilkan count untuk dua filter sekaligus) — filter aktif hanya
  // menentukan kolom/subset mana yang dirender, bukan listener mana yang
  // jalan (lihat MaintenanceKanbanBoard).
  const sourceBoardItems = useMemo<BoardItem[]>(() => {
    const woItems = workOrders
      .filter((w) => role !== "it_team" || isAssignedToCurrentUid(w, currentUid))
      .map((w) => {
        const woItems = items.filter((i) => i.workOrderId === w.id);
        const progress = woItems.length > 0 ? workOrderProgress(woItems).percent : null;
        return buildBoardItemFromWorkOrder(w, progress);
      });

    const ticketItems = tickets
      .filter((t) => role !== "it_team" || isAssignedToCurrentUid(t, currentUid))
      .map(buildBoardItemFromTicket);

    return [...woItems, ...ticketItems];
  }, [workOrders, tickets, items, role, currentUid]);

  const boardItems = useMemo<BoardItem[]>(() => {
    return sourceBoardItems.map((item) => {
      const move = optimisticMoves[boardItemKey(item)];
      if (!move) return item;

      const sourceStillOriginal = item.status === move.fromStatus;
      const sourceMatchesOptimistic = item.status === move.status;
      if (!sourceStillOriginal && !sourceMatchesOptimistic) return item;

      return { ...item, status: move.status };
    });
  }, [sourceBoardItems, optimisticMoves]);

  const handleOpenDetail = (item: BoardItem) => {
    if (item.sourceType === "work_order") setWoDetailTarget(item.raw as MaintenanceWorkOrder);
    else setDetailTarget(item.raw as AssetIssueTicket);
  };

  // Section F — payload direct update WAJIB minimal (cuma field status +
  // jejak aktor + field turunan status itu sendiri), tidak pernah ikut kirim
  // field jadwal/laporan/penugasan/dll yang bukan urusan drag-drop.
  function buildRoutineDirectUpdatePayload({
    item,
    fromColumn,
    toColumn,
    toStatus,
  }: {
    item: BoardItem;
    fromColumn: RoutineColumnKey;
    toColumn: RoutineColumnKey;
    toStatus: string;
  }): { payload: Record<string, unknown>; fromLabel: string; toLabel: string; activityMessage: string } {
    const fromLabel = ROUTINE_COLUMNS.find((c) => c.key === fromColumn)?.label || getRoutineStatusLabel(item.status);
    const toLabel = ROUTINE_COLUMNS.find((c) => c.key === toColumn)?.label || getRoutineStatusLabel(toStatus);
    const activityMessage = `${currentName || "User"} memindahkan status maintenance dari ${fromLabel} ke ${toLabel}.`;

    const payload: Record<string, unknown> = {
      updatedAt: serverTimestamp(),
      updatedByUid: currentUid || "",
      updatedByName: currentName,
      lastActivityAt: serverTimestamp(),
      lastActivityByUid: currentUid || "",
      lastActivityByName: currentName,
      lastActivityMessage: activityMessage,
    };

    // report_submitted -> waiting_qhse_review TIDAK mengubah field "status"
    // (WorkOrderStatus tidak punya nilai "waiting_qhse_review" — kolom itu
    // hanya penanda needsQhseReview=true di atas status "report_submitted"
    // yang sama). Kirim status di sini akan jadi no-op transition di rules.
    if (fromColumn === "report_submitted" && toColumn === "waiting_qhse_review") {
      payload.needsQhseReview = true;
      payload.statusLabel = toLabel;
      return { payload, fromLabel, toLabel, activityMessage };
    }

    payload.status = toStatus;
    payload.statusLabel = toLabel;
    payload.previousStatus = item.status;

    if (toColumn === "accepted") {
      payload.acceptedAt = serverTimestamp();
      payload.acceptedByUid = currentUid || "";
      payload.acceptedByName = currentName;
    }
    if (toColumn === "in_progress") {
      payload.startedAt = serverTimestamp();
      payload.startedByUid = currentUid || "";
      payload.startedByName = currentName;
    }
    if (toColumn === "cancelled") {
      payload.cancelledAt = serverTimestamp();
      payload.cancelledByUid = currentUid || "";
      payload.cancelledByName = currentName;
    }

    return { payload, fromLabel, toLabel, activityMessage };
  }

  const handleKanbanMove = async (item: BoardItem, toColumn: BoardColumnKey) => {
    const isRoutine = item.sourceType === "work_order";
    const fromColumn = getColumnForItem(item);
    if (fromColumn === toColumn) return;

    const newStatus = getStatusFromColumn(item, toColumn);
    // report_submitted -> waiting_qhse_review sengaja TIDAK ditolak di sini
    // walau newStatus === item.status (lihat buildRoutineDirectUpdatePayload)
    // — transisi ini valid tapi tidak mengubah field status mentah.
    const isNoopWaitingQhseReview =
      isRoutine && fromColumn === "report_submitted" && toColumn === "waiting_qhse_review";
    if (newStatus === item.status && !isNoopWaitingQhseReview) return;

    // Section A — debug lengkap SEBELUM permission check & update, supaya
    // penolakan pun tetap tercatat untuk investigasi (bukan cuma yang lolos).
    const raw = isRoutine ? (item.raw as MaintenanceWorkOrder) : null;
    console.log("[Workflow Board Drag Debug]", {
      sourceType: item.sourceType,
      workOrderId: item.id,
      workOrderNumber: item.number,
      userRole: role,
      userUid: firebaseUser?.uid,
      userEmail: firebaseUser?.email,
      fromStatus: item.status,
      fromColumn,
      toColumn,
      toStatus: newStatus,
      assignedToUid: raw?.assignedToUid,
      technicianUid: raw?.technicianUid,
      assignedTechnicianUid: raw?.assignedTechnicianUid,
      assignedToEmail: raw?.assignedToEmail,
      technicianEmail: raw?.technicianEmail,
      assignedTechnicianEmail: raw?.assignedTechnicianEmail,
      isCurrentUserAssignedTechnician: isCurrentUserAssignedTechnician(item),
      roleFlags: { isSuperAdminRole, isQhseRole, isItTeamRole, isStaffRole, isFinanceRole },
    });

    const canMove = canMoveMaintenanceCard({
      item,
      toColumn,
      role,
      currentUserUid: currentUid,
    });

    if (!canMove) {
      setToast({
        type: "error",
        message: isRoutine
          ? getMoveDeniedMessage({ role, toColumn: toColumn as RoutineColumnKey })
          : "Status laporan kendala hanya bisa diubah lewat tombol aksi di detail laporan, bukan drag-drop.",
      });
      return;
    }

    // Section D/E — transisi yang butuh form (jadwal/laporan/keputusan QHSE)
    // tidak boleh langsung updateDoc dari drag. Buka detail (yang sudah
    // punya tombol aksi/form untuk transisi ini) dan batalkan drag-nya.
    if (isRoutine) {
      const requirement = getRoutineTransitionRequirement(fromColumn as RoutineColumnKey, toColumn as RoutineColumnKey);
      if (requirement !== "direct_update") {
        setWoDetailTarget(item.raw as MaintenanceWorkOrder);
        setToast({
          type: "info",
          message: `Lengkapi lewat form "${ROUTINE_TRANSITION_MODAL_TITLE[requirement]}" di detail tugas.`,
        });
        return;
      }
    }

    const statusLabel = isRoutine ? getRoutineStatusLabel(newStatus) : getIssueTicketStatusLabel(newStatus);

    const { payload: updatePayload, toLabel, activityMessage } = isRoutine
      ? buildRoutineDirectUpdatePayload({ item, fromColumn: fromColumn as RoutineColumnKey, toColumn: toColumn as RoutineColumnKey, toStatus: newStatus })
      : {
          payload: {
            status: newStatus,
            statusLabel,
            previousStatus: item.status,
            movedAt: serverTimestamp(),
            movedByUid: currentUid || "",
            movedByName: currentName,
            updatedAt: serverTimestamp(),
            updatedByUid: currentUid || "",
            updatedByName: currentName,
            lastActivityAt: serverTimestamp(),
            lastActivityByUid: currentUid || "",
            lastActivityByName: currentName,
            lastActivityMessage: `Status dipindahkan ke ${statusLabel}`,
          } as Record<string, unknown>,
          toLabel: statusLabel,
          activityMessage: `Status dipindahkan ke ${statusLabel}`,
        };

    console.log("[Workflow Board Update Debug]", {
      sourceCollection: item.sourceCollection,
      workOrderId: item.id,
      fromStatus: item.status,
      toStatus: newStatus,
      payloadKeys: Object.keys(updatePayload),
      updatePayload,
    });

    const key = boardItemKey(item);
    setOptimisticMoves((prev) => ({
      ...prev,
      [key]: {
        status: newStatus,
        fromStatus: item.status,
      },
    }));

    try {
      await updateDoc(doc(db, item.sourceCollection, item.id), updatePayload);
      setToast({
        type: "success",
        message: `Status dipindahkan ke ${toLabel}.`,
      });
      window.setTimeout(() => {
        setOptimisticMoves((prev) => {
          const current = prev[key];
          if (!current || current.status !== newStatus) return prev;
          const next = { ...prev };
          delete next[key];
          return next;
        });
      }, 5000);
    } catch (error) {
      const err = error as { code?: string; message?: string; name?: string };
      console.error("[Workflow Board] gagal update status", {
        errorCode: err?.code,
        errorMessage: err?.message,
        errorName: err?.name,
        userRole: role,
        userUid: firebaseUser?.uid,
        userEmail: firebaseUser?.email,
        sourceType: item.sourceType,
        workOrderId: item.id,
        workOrderNumber: item.number,
        fromStatus: item.status,
        toStatus: newStatus,
        payloadKeys: Object.keys(updatePayload || {}),
        updatePayload,
      });

      setOptimisticMoves((prev) => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
      setToast({
        type: "error",
        message: "Gagal memindahkan status.",
      });
      return;
    }

    // Laporan kendala staff tidak lagi bisa di-drag (canMoveMaintenanceCard
    // menolaknya di atas), jadi titik ini HANYA pernah tercapai untuk
    // Maintenance Rutin — log drag-drop cukup ditulis ke activity log
    // maintenance yang sudah ada.
    try {
      await addDoc(collection(db, "asset_maintenance_activity_logs"), {
        sourceCollection: item.sourceCollection,
        sourceType: item.sourceType,
        sourceId: item.id,
        workOrderId: item.id,
        ticketId: null,
        action: "status_moved",
        actionLabel: "Status maintenance diubah",
        fromStatus: item.status,
        toStatus: newStatus,
        message: activityMessage,
        createdAt: serverTimestamp(),
        createdByUid: currentUid || "",
        createdByName: currentName,
        taskNumber: item.number || "",
        title: item.title || "",
        locationText: item.locationText || "",
      });
    } catch (logError) {
      console.warn("[Workflow Board] gagal menulis log, status tetap berhasil", {
        sourceCollection: item.sourceCollection,
        itemId: item.id,
        logError,
      });
    }
  };

  if (authReady && !canViewBoard) {
    return (
      <ProtectedLayout>
        <PageHeader title="Workflow Board" subtitle="Monitoring visual seluruh pekerjaan maintenance & kendala." />
        <p className="text-sm text-slate-500">Anda tidak punya akses ke halaman ini.</p>
      </ProtectedLayout>
    );
  }

  return (
    <ProtectedLayout>
      <div className="workflow-board-page w-full max-w-full min-w-0 overflow-hidden">
        <PageHeader
          title="Workflow Board"
          subtitle="Monitoring visual Maintenance Rutin dan Laporan Kendala Staff — alur dan kolom keduanya terpisah."
        />
        <MaintenanceKanbanBoard
          items={boardItems}
          activeFilter={activeFilter}
          onFilterChange={setActiveFilter}
          onOpenDetail={handleOpenDetail}
          onMoveItem={handleKanbanMove}
          currentRole={role}
          currentUserUid={currentUid}
        />
        <Toast toast={toast} onClose={() => setToast(null)} />
      </div>

      {detailTarget && (
        <IssueTicketDetailModal ticket={detailTarget} open={!!detailTarget} onClose={() => setDetailTarget(null)} />
      )}
      {woDetailTarget && (
        <WorkOrderDetailModal workOrder={woDetailTarget} open={!!woDetailTarget} onClose={() => setWoDetailTarget(null)} />
      )}
    </ProtectedLayout>
  );
}
