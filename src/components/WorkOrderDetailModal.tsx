"use client";

import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  deleteField,
  doc,
  getDoc,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import {
  X,
  ChevronDown,
  ChevronUp,
  Ban,
  Check,
  ClipboardList,
  FilePlus,
  UserCheck,
  Wrench,
  HelpCircle,
  CalendarClock,
  FlaskConical,
} from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import {
  MaintenanceActionTaken,
  MaintenanceChecklistState,
  MaintenanceConditionLabel,
  MaintenanceWorkOrder,
  MaintenanceWorkOrderItem,
  MaintenanceWorkOrderLog,
  WorkOrderItemStatus,
  WorkOrderStatus,
} from "@/lib/types";
import {
  generateQueueNumber,
  generateTicketNumber,
  writeAssetIssueLog,
  writeWorkOrderLog,
} from "@/lib/firestore-helpers";
import { createAssetNotification } from "@/lib/notifications";
import { getAssetRoleHelpers, getAssignedMaintenanceRole } from "@/lib/roles";
import {
  MAINTENANCE_CONDITION_TO_ASSET_CONDITION,
  WORK_ORDER_ITEM_STATUS_COLOR,
  WORK_ORDER_ITEM_STATUS_LABEL,
  WORK_ORDER_LOG_ACTION_LABEL,
  WORK_ORDER_PRIORITY_COLOR,
  WORK_ORDER_PRIORITY_LABEL,
  formatDate,
  formatDateTimeSeconds,
  computeNextCycleDueDateKey,
  getDisplayStatus,
  getDueDateKey,
  getMaintenanceStatusColor,
  getMaintenanceStatusLabel,
  getMaintenanceTimelineSteps,
  MaintenanceTimelineStep,
} from "@/lib/utils";
import Badge from "@/components/Badge";

const CONDITION_OPTIONS: MaintenanceConditionLabel[] = [
  "Baik",
  "Cukup",
  "Rusak Ringan",
  "Rusak Berat",
  "Tidak Bisa Digunakan",
];

const ACTION_OPTIONS: MaintenanceActionTaken[] = [
  "Tidak Ada Tindakan",
  "Dibersihkan",
  "Disetting Ulang",
  "Update Software",
  "Kosongkan Storage",
  "Ganti Aksesoris",
  "Ganti Sparepart",
  "Perlu Vendor",
  "Perlu Ticket Kendala Lanjutan",
];

const NEEDS_FOLLOW_UP_ACTIONS: MaintenanceActionTaken[] = [
  "Ganti Sparepart",
  "Perlu Vendor",
  "Perlu Ticket Kendala Lanjutan",
];

const CHECKLIST_LABELS: { key: keyof MaintenanceChecklistState; label: string }[] = [
  { key: "fisikDicek", label: "Fisik aset dicek" },
  { key: "fungsiUtamaBerjalan", label: "Fungsi utama berjalan" },
  { key: "aksesorisLengkap", label: "Aksesoris lengkap" },
  { key: "kebersihanDicek", label: "Kebersihan aset dicek" },
  { key: "labelQrTerbaca", label: "Label QR masih terbaca" },
  { key: "lokasiSesuai", label: "Lokasi aset sesuai" },
  { key: "tidakAdaKerusakanKritis", label: "Tidak ada kerusakan kritis" },
];

type HelpActionKey =
  | "request_revision"
  | "return_to_in_progress"
  | "cancel_from_report"
  | "reopen_task"
  | "retry_checklist_completed"
  | "view_history"
  | "save_draft_report"
  | "reset_checklist_in_progress"
  | "return_to_scheduled"
  | "return_to_created"
  | "start_now";

interface HelpActionOption {
  key: HelpActionKey;
  label: string;
  // Aksi yang cuma navigasi (Lihat Riwayat) tidak butuh modal konfirmasi +
  // alasan — semua aksi lain WAJIB.
  requiresReason?: boolean;
  destructive?: boolean;
}

// ── Testing Alur Timeline (dev-only) ────────────────────────────────────────
// BUKAN flow produksi — hanya jalan pintas untuk mencoba semua status tanpa
// klik tombol satu per satu. Lihat handleTestingStatusChange di bawah untuk
// mapping timestamp/actor per status.
interface TestingStatusOption {
  key: string;
  label: string;
  targetStatus: WorkOrderStatus;
}

const TESTING_STATUS_OPTIONS: TestingStatusOption[] = [
  { key: "reset", label: "1. Reset ke Dibuat QHSE", targetStatus: "created" },
  { key: "accepted", label: "2. Diterima IT", targetStatus: "accepted" },
  { key: "scheduled_by_it", label: "3. Dijadwalkan IT", targetStatus: "scheduled_by_it" },
  { key: "in_progress", label: "4. Sedang Dikerjakan", targetStatus: "in_progress" },
  { key: "report_submitted", label: "5. Laporan Dikirim", targetStatus: "report_submitted" },
  { key: "revision_requested", label: "6. Minta Revisi", targetStatus: "revision_requested" },
  { key: "completed", label: "7. Selesai", targetStatus: "completed" },
  { key: "cancelled", label: "8. Dibatalkan", targetStatus: "cancelled" },
];

const DEFAULT_CHECKLIST: MaintenanceChecklistState = {
  fisikDicek: false,
  fungsiUtamaBerjalan: false,
  aksesorisLengkap: false,
  kebersihanDicek: false,
  labelQrTerbaca: false,
  lokasiSesuai: false,
  tidakAdaKerusakanKritis: false,
};

export default function WorkOrderDetailModal({
  workOrder: initialWorkOrder,
  open,
  onClose,
}: {
  workOrder: MaintenanceWorkOrder;
  open: boolean;
  onClose: () => void;
}) {
  const { assetUser } = useAuth();
  const [workOrder, setWorkOrder] = useState(initialWorkOrder);
  const [items, setItems] = useState<MaintenanceWorkOrderItem[]>([]);
  const [logs, setLogs] = useState<MaintenanceWorkOrderLog[]>([]);
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [conditionBefore, setConditionBefore] = useState<MaintenanceConditionLabel>("Baik");
  const [conditionAfter, setConditionAfter] = useState<MaintenanceConditionLabel>("Baik");
  const [checklist, setChecklist] = useState<MaintenanceChecklistState>(DEFAULT_CHECKLIST);
  const [findings, setFindings] = useState("");
  const [actionTaken, setActionTaken] = useState<MaintenanceActionTaken | "">("");
  const [technicianNote, setTechnicianNote] = useState("");

  const [helpMenuOpen, setHelpMenuOpen] = useState(false);
  const [pendingHelpAction, setPendingHelpAction] = useState<HelpActionOption | null>(null);
  const [helpReason, setHelpReason] = useState("");
  const [helpError, setHelpError] = useState("");

  const [scheduleModalOpen, setScheduleModalOpen] = useState(false);
  const [scheduleDate, setScheduleDate] = useState("");
  const [scheduleStart, setScheduleStart] = useState("");
  const [scheduleEnd, setScheduleEnd] = useState("");
  const [scheduleNote, setScheduleNote] = useState("");
  const [scheduleWillInterrupt, setScheduleWillInterrupt] = useState<"yes" | "no" | "">("");
  const [scheduleError, setScheduleError] = useState("");

  const [revisionModalOpen, setRevisionModalOpen] = useState(false);
  const [revisionReason, setRevisionReason] = useState("");
  const [revisionError, setRevisionError] = useState("");

  const [testingMenuOpen, setTestingMenuOpen] = useState(false);
  const [pendingTestingOption, setPendingTestingOption] = useState<TestingStatusOption | null>(null);
  const [testingReason, setTestingReason] = useState("");
  const [testingError, setTestingError] = useState("");

  useEffect(() => {
    if (!open) return;
    const unsub = onSnapshot(
      doc(db, "asset_maintenance_work_orders", initialWorkOrder.id),
      (snap) => {
        console.log("[Listener] work order detail asset_maintenance_work_orders doc success:", {
          id: initialWorkOrder.id,
          exists: snap.exists(),
        });
        if (snap.exists())
          setWorkOrder({ id: snap.id, ...snap.data() } as MaintenanceWorkOrder);
      },
      (error) => {
        console.error("[Listener] work order detail asset_maintenance_work_orders doc error:", {
          id: initialWorkOrder.id,
          error,
        });
      }
    );
    return () => unsub();
  }, [open, initialWorkOrder.id]);

  useEffect(() => {
    if (!open) return;
    const q = query(
      collection(db, "asset_maintenance_work_orders", initialWorkOrder.id, "items"),
      orderBy("createdAt", "asc")
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        console.log("[Listener] work order detail items success:", snap.size);
        setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() } as MaintenanceWorkOrderItem)));
      },
      (error) => {
        console.error("[Listener] work order detail items error:", error);
      }
    );
    return () => unsub();
  }, [open, initialWorkOrder.id]);

  // Activity log mini — 5 aktivitas terakhir untuk work order ini.
  useEffect(() => {
    if (!open) return;
    const q = query(
      collection(db, "asset_maintenance_work_order_logs"),
      where("workOrderId", "==", initialWorkOrder.id),
      orderBy("performedAt", "desc"),
      limit(5)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        console.log("[Listener] work order detail asset_maintenance_work_order_logs success:", snap.size);
        setLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() } as MaintenanceWorkOrderLog)));
      },
      (error) => {
        console.error("[Listener] work order detail asset_maintenance_work_order_logs error:", error);
      }
    );
    return () => unsub();
  }, [open, initialWorkOrder.id]);

  const checkedCount = useMemo(
    () => items.filter((i) => i.status !== "pending" && i.status !== "in_progress").length,
    [items]
  );
  const progressPercent = items.length > 0 ? Math.round((checkedCount / items.length) * 100) : 0;

  if (!open) return null;

  const currentAssetUser = assetUser ? { role: assetUser.role } : null;
  const { isSuperAdminRole, isAssetAdminRole, isItTeamRole, canManageSchedule } =
    getAssetRoleHelpers(currentAssetUser);
  const assignedMaintenanceRole = getAssignedMaintenanceRole(workOrder.assignedToRole);
  const isAssignedTechnician =
    workOrder.assignedToUid === assetUser?.uid &&
    (isItTeamRole || (isSuperAdminRole && assignedMaintenanceRole === "super_admin"));
  const isQhse = isAssetAdminRole;

  // "Mode Testing Alur" BUKAN flow produksi — hanya untuk Super Admin dan
  // Asset Admin/QHSE. Staff tidak pernah melihat ini (role staff tidak
  // pernah membuka modal ini sama sekali, tapi guard eksplisit tetap
  // dipasang untuk jaga-jaga). Sengaja TIDAK dikunci env dulu per instruksi.
  const canUseTestingMode = isSuperAdminRole || canManageSchedule;

  const canAccept =
    isAssignedTechnician && ["created", "scheduled", "assigned"].includes(workOrder.status);
  const canScheduleByIt = isAssignedTechnician && workOrder.status === "accepted";
  const canStart =
    isAssignedTechnician && ["scheduled_by_it", "scheduled", "assigned"].includes(workOrder.status);
  const canWorkItems =
    isAssignedTechnician && ["in_progress", "partially_completed"].includes(workOrder.status);
  const canSubmitReport =
    isAssignedTechnician && ["in_progress", "partially_completed"].includes(workOrder.status);
  const canMarkCompleted = isQhse && workOrder.status === "report_submitted";
  const canCancel = isQhse && workOrder.status === "created";

  // Dropdown "Aksi Bantuan" — opsi mengulang/mengembalikan status kalau ada
  // kesalahan, dipilah per role + status seperti didefinisikan spesifikasi.
  const helpActions: HelpActionOption[] = [];
  if (isQhse && workOrder.status === "report_submitted") {
    helpActions.push(
      { key: "return_to_in_progress", label: "Kembalikan ke Sedang Dikerjakan", requiresReason: true },
      { key: "cancel_from_report", label: "Batalkan Tugas", requiresReason: true, destructive: true }
    );
  }
  if ((isQhse || isAssignedTechnician) && workOrder.status === "completed") {
    helpActions.push(
      { key: "reopen_task", label: "Buka Ulang Tugas", requiresReason: true },
      { key: "retry_checklist_completed", label: "Buat Ulang Pengecekan", requiresReason: true },
      { key: "view_history", label: "Lihat Riwayat" }
    );
  }
  if (isAssignedTechnician && workOrder.status === "in_progress") {
    helpActions.push(
      { key: "save_draft_report", label: "Simpan Draft Laporan", requiresReason: true },
      { key: "reset_checklist_in_progress", label: "Reset Checklist Asset", requiresReason: true },
      { key: "return_to_scheduled", label: "Kembalikan ke Dijadwalkan IT", requiresReason: true }
    );
  }
  if (isAssignedTechnician && workOrder.status === "accepted") {
    helpActions.push({ key: "return_to_created", label: "Kembalikan ke Belum Diterima", requiresReason: true });
  }

  const woRef = doc(db, "asset_maintenance_work_orders", workOrder.id);

  const handleAccept = async () => {
    setSaving(true);
    try {
      await updateDoc(woRef, {
        status: "accepted",
        acceptedAt: serverTimestamp(),
        acceptedByUid: assetUser?.uid || "",
        acceptedByName: assetUser?.name || "",
        updatedAt: serverTimestamp(),
      });
      await writeWorkOrderLog({
        workOrderId: workOrder.id,
        workOrderNumber: workOrder.workOrderNumber,
        action: "accept_work_order",
        oldStatus: workOrder.status,
        newStatus: "accepted",
        note: "Tugas diterima teknisi",
        performedByUid: assetUser?.uid || "",
        performedByName: assetUser?.name || "",
      });
      if (workOrder.requestedByUid) {
        await createAssetNotification({
          recipientUid: workOrder.requestedByUid,
          recipientName: workOrder.requestedByName,
          recipientRole: "asset_admin",
          title: "Tugas Maintenance Diterima IT",
          message: `${assetUser?.name || "Teknisi"} menerima tugas ${workOrder.workOrderNumber}.`,
          type: "work_order_accepted",
          priority: workOrder.priority,
          linkUrl: `/maintenance?tab=routine&workOrderId=${workOrder.id}`,
          relatedType: "work_order",
          relatedId: workOrder.id,
          relatedNumber: workOrder.workOrderNumber,
          createdByUid: assetUser?.uid,
          createdByName: assetUser?.name,
        });
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSubmitSchedule = async (data: {
    plannedWorkDate: string;
    plannedStartTime: string;
    plannedEndTime: string;
    plannedNote: string;
    willInterruptUser: boolean;
  }) => {
    setSaving(true);
    try {
      await updateDoc(woRef, {
        status: "scheduled_by_it",
        plannedWorkDate: data.plannedWorkDate,
        plannedStartTime: data.plannedStartTime,
        plannedEndTime: data.plannedEndTime,
        plannedNote: data.plannedNote,
        willInterruptUser: data.willInterruptUser,
        scheduledByItAt: serverTimestamp(),
        scheduledByItUid: assetUser?.uid || "",
        scheduledByItName: assetUser?.name || "",
        updatedAt: serverTimestamp(),
      });
      await writeWorkOrderLog({
        workOrderId: workOrder.id,
        workOrderNumber: workOrder.workOrderNumber,
        action: "schedule_by_it",
        oldStatus: workOrder.status,
        newStatus: "scheduled_by_it",
        note: `Dijadwalkan ${formatDate(data.plannedWorkDate)} ${data.plannedStartTime}-${data.plannedEndTime}`,
        performedByUid: assetUser?.uid || "",
        performedByName: assetUser?.name || "",
      });

      const timeRangeText = `${formatDate(data.plannedWorkDate)} jam ${data.plannedStartTime}-${data.plannedEndTime}`;

      if (workOrder.requestedByUid) {
        await createAssetNotification({
          recipientUid: workOrder.requestedByUid,
          recipientName: workOrder.requestedByName,
          recipientRole: "asset_admin",
          title: "Jadwal Pengerjaan IT",
          message: `IT sudah menjadwalkan maintenance pada ${timeRangeText}.`,
          type: "work_order_scheduled_by_it",
          priority: workOrder.priority,
          linkUrl: `/maintenance?tab=routine&workOrderId=${workOrder.id}`,
          relatedType: "work_order",
          relatedId: workOrder.id,
          relatedNumber: workOrder.workOrderNumber,
          createdByUid: assetUser?.uid,
          createdByName: assetUser?.name,
        });
      }

      // Beri tahu penanggung jawab masing-masing asset (kalau ada) — dedupe
      // supaya satu orang yang bertanggung jawab atas beberapa asset di work
      // order ini hanya menerima satu notifikasi.
      const uniqueAssetIds = Array.from(new Set(items.map((i) => i.assetId)));
      const responsiblePersons = new Map<string, string>();
      await Promise.all(
        uniqueAssetIds.map(async (assetId) => {
          const snap = await getDoc(doc(db, "assets", assetId));
          if (!snap.exists()) return;
          const assetData = snap.data();
          if (assetData.responsiblePersonUid) {
            responsiblePersons.set(assetData.responsiblePersonUid, assetData.responsiblePersonName || "");
          }
        })
      );
      await Promise.all(
        Array.from(responsiblePersons.entries()).map(([uid, name]) =>
          createAssetNotification({
            recipientUid: uid,
            recipientName: name,
            recipientRole: "staff",
            title: "Jadwal Maintenance Asset Anda",
            message: `Asset Anda dijadwalkan maintenance pada ${timeRangeText}.`,
            type: "work_order_scheduled_by_it",
            priority: workOrder.priority,
            linkUrl: "/assets",
            relatedType: "work_order",
            relatedId: workOrder.id,
            relatedNumber: workOrder.workOrderNumber,
            createdByUid: assetUser?.uid,
            createdByName: assetUser?.name,
          })
        )
      );
    } finally {
      setSaving(false);
    }
  };

  const notifyResponsibleAssetUsers = async (params: {
    title: string;
    message: string;
    type: "work_order_scheduled_by_it" | "work_order_completed";
  }) => {
    const uniqueAssetIds = Array.from(new Set(items.map((i) => i.assetId)));
    const responsiblePersons = new Map<string, string>();
    await Promise.all(
      uniqueAssetIds.map(async (assetId) => {
        const snap = await getDoc(doc(db, "assets", assetId));
        if (!snap.exists()) return;
        const assetData = snap.data();
        if (assetData.responsiblePersonUid) {
          responsiblePersons.set(
            assetData.responsiblePersonUid,
            assetData.responsiblePersonName || ""
          );
        }
      })
    );

    await Promise.all(
      Array.from(responsiblePersons.entries()).map(([uid, name]) =>
        createAssetNotification({
          recipientUid: uid,
          recipientName: name,
          recipientRole: "staff",
          title: params.title,
          message: params.message,
          type: params.type,
          priority: workOrder.priority,
          linkUrl: "/assets",
          relatedType: "work_order",
          relatedId: workOrder.id,
          relatedNumber: workOrder.workOrderNumber,
          createdByUid: assetUser?.uid,
          createdByName: assetUser?.name,
        })
      )
    );
  };

  const handleStart = async () => {
    setSaving(true);
    try {
      await updateDoc(woRef, {
        status: "in_progress",
        startedAt: serverTimestamp(),
        startedByUid: assetUser?.uid || "",
        startedByName: assetUser?.name || "",
        updatedAt: serverTimestamp(),
      });

      // Semua item yang masih "Belum Dicek" otomatis jadi "Sedang Dicek" saat
      // teknisi mulai kerjakan — progress tetap 0% sampai asset benar-benar
      // selesai dicek satu per satu.
      const pendingItems = items.filter((i) => i.status === "pending");
      if (pendingItems.length > 0) {
        const batch = writeBatch(db);
        pendingItems.forEach((item) => {
          const itemRef = doc(db, "asset_maintenance_work_orders", workOrder.id, "items", item.id);
          batch.update(itemRef, { status: "in_progress", updatedAt: serverTimestamp() });
        });
        await batch.commit();
      }

      await writeWorkOrderLog({
        workOrderId: workOrder.id,
        workOrderNumber: workOrder.workOrderNumber,
        action: "start_work_order",
        oldStatus: workOrder.status,
        newStatus: "in_progress",
        note: "Mulai dikerjakan",
        performedByUid: assetUser?.uid || "",
        performedByName: assetUser?.name || "",
      });
      if (workOrder.requestedByUid) {
        await createAssetNotification({
          recipientUid: workOrder.requestedByUid,
          recipientName: workOrder.requestedByName,
          recipientRole: "asset_admin",
          title: "Maintenance Mulai Dikerjakan",
          message: `${workOrder.assignedToName || "Teknisi"} mulai mengerjakan ${workOrder.title}.`,
          type: "work_order_started",
          priority: workOrder.priority,
          linkUrl: `/maintenance?tab=routine&workOrderId=${workOrder.id}`,
          relatedType: "work_order",
          relatedId: workOrder.id,
          relatedNumber: workOrder.workOrderNumber,
          createdByUid: assetUser?.uid,
          createdByName: assetUser?.name,
        });
      }
    } finally {
      setSaving(false);
    }
  };

  const handleSubmitReport = async () => {
    setSaving(true);
    try {
      await updateDoc(woRef, {
        status: "report_submitted",
        reportSubmittedAt: serverTimestamp(),
        reportSubmittedByUid: assetUser?.uid || "",
        reportSubmittedByName: assetUser?.name || "",
        updatedAt: serverTimestamp(),
      });

      // Semua item yang masih "Sedang Dicek" otomatis jadi "Sudah Dicek" saat
      // laporan dikirim — item yang sudah "needs_follow_up"/"skipped" tidak
      // disentuh (statusnya sudah final, bukan "belum selesai dicek").
      const inProgressItems = items.filter((i) => i.status === "in_progress");
      if (inProgressItems.length > 0) {
        const batch = writeBatch(db);
        inProgressItems.forEach((item) => {
          const itemRef = doc(db, "asset_maintenance_work_orders", workOrder.id, "items", item.id);
          batch.update(itemRef, { status: "checked", updatedAt: serverTimestamp() });
        });
        await batch.commit();
      }

      await writeWorkOrderLog({
        workOrderId: workOrder.id,
        workOrderNumber: workOrder.workOrderNumber,
        action: "submit_report",
        oldStatus: workOrder.status,
        newStatus: "report_submitted",
        note: "Laporan hasil pengecekan dikirim ke QHSE",
        performedByUid: assetUser?.uid || "",
        performedByName: assetUser?.name || "",
      });
      if (workOrder.requestedByUid) {
        await createAssetNotification({
          recipientUid: workOrder.requestedByUid,
          recipientName: workOrder.requestedByName,
          recipientRole: "asset_admin",
          title: "Laporan Maintenance Dikirim",
          message: `${workOrder.title} sudah selesai dikerjakan, menunggu review QHSE.`,
          type: "work_order_report_submitted",
          priority: workOrder.priority,
          linkUrl: `/maintenance?tab=routine&workOrderId=${workOrder.id}`,
          relatedType: "work_order",
          relatedId: workOrder.id,
          relatedNumber: workOrder.workOrderNumber,
          createdByUid: assetUser?.uid,
          createdByName: assetUser?.name,
        });
      }
    } finally {
      setSaving(false);
    }
  };

  const handleMarkCompleted = async () => {
    setSaving(true);
    try {
      await updateDoc(woRef, {
        status: "completed",
        completedAt: serverTimestamp(),
        completedByUid: assetUser?.uid || "",
        completedByName: assetUser?.name || "",
        updatedAt: serverTimestamp(),
      });
      await writeWorkOrderLog({
        workOrderId: workOrder.id,
        workOrderNumber: workOrder.workOrderNumber,
        action: "complete_work_order",
        oldStatus: workOrder.status,
        newStatus: "completed",
        note: "Ditandai selesai oleh QHSE setelah review laporan",
        performedByUid: assetUser?.uid || "",
        performedByName: assetUser?.name || "",
      });
      if (workOrder.assignedToUid) {
        await createAssetNotification({
          recipientUid: workOrder.assignedToUid,
          recipientName: workOrder.assignedToName || "",
          recipientRole: assignedMaintenanceRole,
          title: "Maintenance Selesai",
          message: `${workOrder.title} sudah selesai dikerjakan.`,
          type: "work_order_completed",
          priority: workOrder.priority,
          linkUrl: `/maintenance?tab=my-tasks&workOrderId=${workOrder.id}`,
          relatedType: "work_order",
          relatedId: workOrder.id,
          relatedNumber: workOrder.workOrderNumber,
          createdByUid: assetUser?.uid,
          createdByName: assetUser?.name,
        });
      }
      await notifyResponsibleAssetUsers({
        title: "Maintenance Asset Selesai",
        message: `${workOrder.title} sudah selesai direview QHSE.`,
        type: "work_order_completed",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleCancelWorkOrder = async () => {
    setSaving(true);
    try {
      await updateDoc(woRef, {
        status: "cancelled",
        cancelledAt: serverTimestamp(),
        cancelledByUid: assetUser?.uid || "",
        cancelledByName: assetUser?.name || "",
        updatedAt: serverTimestamp(),
      });
      await writeWorkOrderLog({
        workOrderId: workOrder.id,
        workOrderNumber: workOrder.workOrderNumber,
        action: "cancel_work_order",
        oldStatus: workOrder.status,
        newStatus: "cancelled",
        note: "Jadwal maintenance dibatalkan QHSE",
        performedByUid: assetUser?.uid || "",
        performedByName: assetUser?.name || "",
      });
    } finally {
      setSaving(false);
    }
  };

  // ── Aksi Bantuan ──────────────────────────────────────────────────────────
  // Semua handler di bawah ini bersifat koreksi/undo — TIDAK PERNAH menghapus
  // timestamp/laporan/history lama, hanya menambah field baru + log.

  const handleRequestRevision = async (reason: string) => {
    await updateDoc(woRef, {
      status: "in_progress",
      revisionRequestedAt: serverTimestamp(),
      revisionRequestedByUid: assetUser?.uid || "",
      revisionRequestedByName: assetUser?.name || "",
      revisionNote: reason,
      updatedAt: serverTimestamp(),
    });
    await writeWorkOrderLog({
      workOrderId: workOrder.id,
      workOrderNumber: workOrder.workOrderNumber,
      action: "request_revision",
      oldStatus: workOrder.status,
      newStatus: "in_progress",
      note: reason,
      performedByUid: assetUser?.uid || "",
      performedByName: assetUser?.name || "",
    });
    if (workOrder.assignedToUid) {
      await createAssetNotification({
        recipientUid: workOrder.assignedToUid,
        recipientName: workOrder.assignedToName || "",
        recipientRole: assignedMaintenanceRole,
        title: "Revisi Laporan Diminta",
        message: `QHSE meminta revisi laporan maintenance ${workOrder.title}: ${reason}`,
        type: "work_order_revision_requested",
        priority: workOrder.priority,
        linkUrl: `/maintenance?tab=my-tasks&workOrderId=${workOrder.id}`,
        relatedType: "work_order",
        relatedId: workOrder.id,
        relatedNumber: workOrder.workOrderNumber,
        createdByUid: assetUser?.uid,
        createdByName: assetUser?.name,
      });
    }
  };

  const handleReturnToInProgress = async (reason: string) => {
    await updateDoc(woRef, {
      status: "in_progress",
      previousStatus: workOrder.status,
      updatedAt: serverTimestamp(),
    });
    await writeWorkOrderLog({
      workOrderId: workOrder.id,
      workOrderNumber: workOrder.workOrderNumber,
      action: "return_to_in_progress",
      oldStatus: workOrder.status,
      newStatus: "in_progress",
      note: reason,
      performedByUid: assetUser?.uid || "",
      performedByName: assetUser?.name || "",
    });
  };

  const handleCancelFromReport = async (reason: string) => {
    await updateDoc(woRef, {
      status: "cancelled",
      cancelledAt: serverTimestamp(),
      cancelledByUid: assetUser?.uid || "",
      cancelledByName: assetUser?.name || "",
      cancelReason: reason,
      updatedAt: serverTimestamp(),
    });
    await writeWorkOrderLog({
      workOrderId: workOrder.id,
      workOrderNumber: workOrder.workOrderNumber,
      action: "cancel_work_order",
      oldStatus: workOrder.status,
      newStatus: "cancelled",
      note: reason,
      performedByUid: assetUser?.uid || "",
      performedByName: assetUser?.name || "",
    });
  };

  const handleReopenTask = async (reason: string) => {
    await updateDoc(woRef, {
      status: "in_progress",
      reopenedAt: serverTimestamp(),
      reopenedByUid: assetUser?.uid || "",
      reopenedByName: assetUser?.name || "",
      reopenReason: reason,
      updatedAt: serverTimestamp(),
    });
    await writeWorkOrderLog({
      workOrderId: workOrder.id,
      workOrderNumber: workOrder.workOrderNumber,
      action: "reopen_work_order",
      oldStatus: workOrder.status,
      newStatus: "in_progress",
      note: reason,
      performedByUid: assetUser?.uid || "",
      performedByName: assetUser?.name || "",
    });
    const notifyUid = isQhse ? workOrder.assignedToUid : workOrder.requestedByUid;
    const notifyName = isQhse ? workOrder.assignedToName : workOrder.requestedByName;
    if (notifyUid) {
      await createAssetNotification({
        recipientUid: notifyUid,
        recipientName: notifyName || "",
        recipientRole: isQhse ? assignedMaintenanceRole : "asset_admin",
        title: "Tugas Dibuka Ulang",
        message: `${workOrder.title} dibuka ulang: ${reason}`,
        type: "work_order_reopened",
        priority: workOrder.priority,
        linkUrl: `/maintenance?tab=${isQhse ? "my-tasks" : "routine"}&workOrderId=${workOrder.id}`,
        relatedType: "work_order",
        relatedId: workOrder.id,
        relatedNumber: workOrder.workOrderNumber,
        createdByUid: assetUser?.uid,
        createdByName: assetUser?.name,
      });
    }
  };

  // Dipakai untuk "Buat Ulang Pengecekan" (dari completed) maupun "Reset
  // Checklist Asset" (dari in_progress) — reset status item ke pending TANPA
  // menghapus findings/actionTaken/technicianNote lama (history tetap ada).
  const handleRetryChecklist = async (reason: string, targetStatus: "in_progress") => {
    const batch = writeBatch(db);
    items.forEach((item) => {
      const itemRef = doc(db, "asset_maintenance_work_orders", workOrder.id, "items", item.id);
      batch.update(itemRef, { status: "pending", updatedAt: serverTimestamp() });
    });
    await batch.commit();

    await updateDoc(woRef, {
      status: targetStatus,
      retryCount: (workOrder.retryCount || 0) + 1,
      updatedAt: serverTimestamp(),
    });
    await writeWorkOrderLog({
      workOrderId: workOrder.id,
      workOrderNumber: workOrder.workOrderNumber,
      action: "retry_checklist",
      oldStatus: workOrder.status,
      newStatus: targetStatus,
      note: reason,
      performedByUid: assetUser?.uid || "",
      performedByName: assetUser?.name || "",
    });
  };

  const handleSaveDraftReport = async (reason: string) => {
    await writeWorkOrderLog({
      workOrderId: workOrder.id,
      workOrderNumber: workOrder.workOrderNumber,
      action: "save_draft_report",
      note: reason,
      performedByUid: assetUser?.uid || "",
      performedByName: assetUser?.name || "",
    });
  };

  // Kembali dari in_progress ke "scheduled_by_it" (state terakhir sebelum
  // mulai dikerjakan) — bukan ke "accepted", supaya rencana pengerjaan yang
  // sudah diisi IT tidak hilang begitu saja.
  const handleReturnToScheduled = async (reason: string) => {
    await updateDoc(woRef, {
      status: "scheduled_by_it",
      updatedAt: serverTimestamp(),
    });
    await writeWorkOrderLog({
      workOrderId: workOrder.id,
      workOrderNumber: workOrder.workOrderNumber,
      action: "return_to_scheduled",
      oldStatus: workOrder.status,
      newStatus: "scheduled_by_it",
      note: reason,
      performedByUid: assetUser?.uid || "",
      performedByName: assetUser?.name || "",
    });
  };

  const handleReturnToCreated = async (reason: string) => {
    await updateDoc(woRef, {
      status: "created",
      updatedAt: serverTimestamp(),
    });
    await writeWorkOrderLog({
      workOrderId: workOrder.id,
      workOrderNumber: workOrder.workOrderNumber,
      action: "return_to_created",
      oldStatus: workOrder.status,
      newStatus: "created",
      note: reason,
      performedByUid: assetUser?.uid || "",
      performedByName: assetUser?.name || "",
    });
  };

  const handleHelpActionClick = (option: HelpActionOption) => {
    setHelpMenuOpen(false);
    if (option.key === "view_history") {
      document.getElementById("wo-activity-log")?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }
    if (option.key === "start_now") {
      handleStart();
      return;
    }
    setHelpError("");
    setHelpReason("");
    setPendingHelpAction(option);
  };

  const handleConfirmHelpAction = async () => {
    if (!pendingHelpAction) return;
    if (pendingHelpAction.requiresReason && !helpReason.trim()) {
      setHelpError("Alasan wajib diisi.");
      return;
    }
    setSaving(true);
    setHelpError("");
    try {
      const reason = helpReason.trim();
      switch (pendingHelpAction.key) {
        case "request_revision":
          await handleRequestRevision(reason);
          break;
        case "return_to_in_progress":
          await handleReturnToInProgress(reason);
          break;
        case "cancel_from_report":
          await handleCancelFromReport(reason);
          break;
        case "reopen_task":
          await handleReopenTask(reason);
          break;
        case "retry_checklist_completed":
          await handleRetryChecklist(reason, "in_progress");
          break;
        case "save_draft_report":
          await handleSaveDraftReport(reason);
          break;
        case "reset_checklist_in_progress":
          await handleRetryChecklist(reason, "in_progress");
          break;
        case "return_to_scheduled":
          await handleReturnToScheduled(reason);
          break;
        case "return_to_created":
          await handleReturnToCreated(reason);
          break;
      }
      setPendingHelpAction(null);
      setHelpReason("");
    } catch (err) {
      console.error("[Work Order] gagal menjalankan aksi bantuan", err);
      setHelpError("Gagal menyimpan aksi. Coba lagi.");
    } finally {
      setSaving(false);
    }
  };

  const handleSubmitScheduleModal = async () => {
    setScheduleError("");
    if (!scheduleDate || !scheduleStart || !scheduleEnd) {
      setScheduleError("Tanggal, jam mulai, dan jam selesai wajib diisi.");
      return;
    }
    if (!scheduleWillInterrupt) {
      setScheduleError("Pilih apakah berpotensi mengganggu user.");
      return;
    }
    setSaving(true);
    try {
      await handleSubmitSchedule({
        plannedWorkDate: scheduleDate,
        plannedStartTime: scheduleStart,
        plannedEndTime: scheduleEnd,
        plannedNote: scheduleNote,
        willInterruptUser: scheduleWillInterrupt === "yes",
      });
      setScheduleModalOpen(false);
      setScheduleDate("");
      setScheduleStart("");
      setScheduleEnd("");
      setScheduleNote("");
      setScheduleWillInterrupt("");
    } catch (err) {
      console.error("[Work Order] gagal menyimpan jadwal pengerjaan", err);
      setScheduleError("Gagal menyimpan jadwal. Coba lagi.");
    } finally {
      setSaving(false);
    }
  };

  const handleSubmitRevisionModal = async () => {
    setRevisionError("");
    if (!revisionReason.trim()) {
      setRevisionError("Alasan revisi wajib diisi.");
      return;
    }
    setSaving(true);
    try {
      await handleRequestRevision(revisionReason.trim());
      setRevisionModalOpen(false);
      setRevisionReason("");
    } catch (err) {
      console.error("[Work Order] gagal meminta revisi", err);
      setRevisionError("Gagal mengirim permintaan revisi. Coba lagi.");
    } finally {
      setSaving(false);
    }
  };

  // ── Testing Alur Timeline (dev-only) ──────────────────────────────────────
  const handleTestingStatusChange = async (option: TestingStatusOption, reason: string) => {
    const actorUid = assetUser?.uid || "";
    const actorName = assetUser?.name || "";
    const payload: Record<string, unknown> = {
      status: option.targetStatus,
      updatedAt: serverTimestamp(),
    };

    switch (option.key) {
      case "accepted":
        payload.acceptedAt = serverTimestamp();
        payload.acceptedByUid = actorUid;
        payload.acceptedByName = actorName;
        break;
      case "scheduled_by_it":
        payload.scheduledByItAt = serverTimestamp();
        payload.scheduledByItUid = actorUid;
        payload.scheduledByItName = actorName;
        break;
      case "in_progress":
        payload.startedAt = serverTimestamp();
        payload.startedByUid = actorUid;
        payload.startedByName = actorName;
        break;
      case "report_submitted":
        payload.reportSubmittedAt = serverTimestamp();
        payload.reportSubmittedByUid = actorUid;
        payload.reportSubmittedByName = actorName;
        break;
      case "revision_requested":
        payload.revisionRequestedAt = serverTimestamp();
        payload.revisionRequestedByUid = actorUid;
        payload.revisionRequestedByName = actorName;
        payload.revisionNote = reason;
        break;
      case "completed":
        payload.completedAt = serverTimestamp();
        payload.completedByUid = actorUid;
        payload.completedByName = actorName;
        break;
      case "cancelled":
        payload.cancelledAt = serverTimestamp();
        payload.cancelledByUid = actorUid;
        payload.cancelledByName = actorName;
        payload.cancelReason = reason;
        break;
      case "reset":
        payload.createdAt = serverTimestamp();
        payload.requestedByUid = actorUid;
        payload.requestedByName = actorName;
        payload.acceptedAt = deleteField();
        payload.acceptedByUid = deleteField();
        payload.acceptedByName = deleteField();
        payload.plannedWorkDate = deleteField();
        payload.plannedStartTime = deleteField();
        payload.plannedEndTime = deleteField();
        payload.plannedNote = deleteField();
        payload.willInterruptUser = deleteField();
        payload.scheduledByItAt = deleteField();
        payload.scheduledByItUid = deleteField();
        payload.scheduledByItName = deleteField();
        payload.startedAt = deleteField();
        payload.startedByUid = deleteField();
        payload.startedByName = deleteField();
        payload.reportSubmittedAt = deleteField();
        payload.reportSubmittedByUid = deleteField();
        payload.reportSubmittedByName = deleteField();
        payload.revisionRequestedAt = deleteField();
        payload.revisionRequestedByUid = deleteField();
        payload.revisionRequestedByName = deleteField();
        payload.revisionNote = deleteField();
        payload.completedAt = deleteField();
        payload.completedByUid = deleteField();
        payload.completedByName = deleteField();
        payload.cancelledAt = deleteField();
        payload.cancelledByUid = deleteField();
        payload.cancelledByName = deleteField();
        payload.cancelReason = deleteField();
        break;
    }

    await updateDoc(woRef, payload);

    // Ikut ubah status asset item sesuai status baru — tidak pernah dihapus,
    // hanya field status per-item yang di-reset/dimajukan.
    if (option.key === "in_progress") {
      const pendingItems = items.filter((i) => i.status === "pending");
      if (pendingItems.length > 0) {
        const batch = writeBatch(db);
        pendingItems.forEach((item) => {
          const itemRef = doc(db, "asset_maintenance_work_orders", workOrder.id, "items", item.id);
          batch.update(itemRef, { status: "in_progress", updatedAt: serverTimestamp() });
        });
        await batch.commit();
      }
    } else if (option.key === "report_submitted") {
      const uncheckedItems = items.filter((i) => i.status === "pending" || i.status === "in_progress");
      if (uncheckedItems.length > 0) {
        const batch = writeBatch(db);
        uncheckedItems.forEach((item) => {
          const itemRef = doc(db, "asset_maintenance_work_orders", workOrder.id, "items", item.id);
          batch.update(itemRef, { status: "checked", updatedAt: serverTimestamp() });
        });
        await batch.commit();
      }
    } else if (option.key === "reset") {
      const nonPendingItems = items.filter((i) => i.status !== "pending");
      if (nonPendingItems.length > 0) {
        const batch = writeBatch(db);
        nonPendingItems.forEach((item) => {
          const itemRef = doc(db, "asset_maintenance_work_orders", workOrder.id, "items", item.id);
          batch.update(itemRef, { status: "pending", updatedAt: serverTimestamp() });
        });
        await batch.commit();
      }
    }

    await writeWorkOrderLog({
      workOrderId: workOrder.id,
      workOrderNumber: workOrder.workOrderNumber,
      action: "testing_status_change",
      oldStatus: workOrder.status,
      newStatus: option.targetStatus,
      note: `[Testing] ${option.label}: ${reason}`,
      performedByUid: actorUid,
      performedByName: actorName,
    });
  };

  const handleConfirmTestingStatus = async () => {
    if (!pendingTestingOption) return;
    if (!testingReason.trim()) {
      setTestingError("Catatan/alasan testing wajib diisi.");
      return;
    }
    setSaving(true);
    setTestingError("");
    try {
      await handleTestingStatusChange(pendingTestingOption, testingReason.trim());
      setPendingTestingOption(null);
      setTestingReason("");
    } catch (err) {
      console.error("[Work Order] gagal testing perubahan status", err);
      setTestingError("Gagal mengubah status. Coba lagi.");
    } finally {
      setSaving(false);
    }
  };

  const openItemForm = (item: MaintenanceWorkOrderItem) => {
    setExpandedItemId(item.id === expandedItemId ? null : item.id);
    setConditionBefore(item.conditionBefore || "Baik");
    setConditionAfter(item.conditionAfter || "Baik");
    setChecklist(item.checklist || DEFAULT_CHECKLIST);
    setFindings(item.findings || "");
    setActionTaken(item.actionTaken || "");
    setTechnicianNote(item.technicianNote || "");
  };

  const updateAssetAfterCheck = async (item: MaintenanceWorkOrderItem, after: MaintenanceConditionLabel) => {
    try {
      const assetRef = doc(db, "assets", item.assetId);
      const assetSnap = await getDoc(assetRef);
      if (!assetSnap.exists()) return;
      const assetData = assetSnap.data();
      if (assetData.assetStatus === "borrowed") {
        console.warn("[Work Order] asset sedang dipinjam, lewati update otomatis kondisi", item.assetId);
        return;
      }
      const mappedCondition = MAINTENANCE_CONDITION_TO_ASSET_CONDITION[after];
      const updates: Record<string, unknown> = {
        condition: mappedCondition,
        lastMaintenanceAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };
      if (mappedCondition === "heavy_damage") {
        updates.assetStatus = "broken";
      }
      if (assetData.maintenanceEnabled && assetData.maintenanceIntervalMonths) {
        const next = new Date();
        next.setMonth(next.getMonth() + Number(assetData.maintenanceIntervalMonths));
        updates.nextMaintenanceAt = next.toISOString();
      }
      await updateDoc(assetRef, updates);
    } catch (err) {
      console.error("[Work Order] gagal update asset setelah cek", err);
    }
  };

  // Progress per-asset hanya dicatat sebagai log aktivitas — status utama
  // work order (6 status: created/accepted/in_progress/report_submitted/
  // completed/cancelled) TIDAK ikut berubah di sini, supaya badge status dan
  // timeline tetap sinkron dan hanya berubah lewat aksi eksplisit (Terima
  // Tugas/Kerjakan/Kirim Laporan/Tandai Selesai/Batalkan).
  const logItemProgress = async (updatedItems: MaintenanceWorkOrderItem[]) => {
    const doneCount = updatedItems.filter(
      (i) => i.status !== "pending" && i.status !== "in_progress"
    ).length;
    if (doneCount === 0) return;
    await writeWorkOrderLog({
      workOrderId: workOrder.id,
      workOrderNumber: workOrder.workOrderNumber,
      action: "check_asset_item",
      note: `${doneCount}/${updatedItems.length} asset sudah dicek`,
      performedByUid: assetUser?.uid || "",
      performedByName: assetUser?.name || "",
    });
  };

  const handleSaveItem = async (item: MaintenanceWorkOrderItem) => {
    setSaving(true);
    try {
      const needsFollowUp = !!actionTaken && NEEDS_FOLLOW_UP_ACTIONS.includes(actionTaken);
      const newItemStatus: WorkOrderItemStatus = needsFollowUp ? "needs_follow_up" : "checked";
      const itemRef = doc(
        db,
        "asset_maintenance_work_orders",
        workOrder.id,
        "items",
        item.id
      );
      await updateDoc(itemRef, {
        status: newItemStatus,
        conditionBefore,
        conditionAfter,
        checklist,
        findings,
        actionTaken: actionTaken || null,
        technicianNote,
        checkedByUid: assetUser?.uid || "",
        checkedByName: assetUser?.name || "",
        checkedAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await writeWorkOrderLog({
        workOrderId: workOrder.id,
        workOrderNumber: workOrder.workOrderNumber,
        action: newItemStatus === "checked" ? "complete_asset_item" : "check_asset_item",
        note: `${item.assetName}: ${newItemStatus === "checked" ? "selesai dicek" : "butuh tindak lanjut"}`,
        performedByUid: assetUser?.uid || "",
        performedByName: assetUser?.name || "",
      });

      await updateAssetAfterCheck(item, conditionAfter);

      const updatedItems = items.map((i) =>
        i.id === item.id ? { ...i, status: newItemStatus } : i
      );
      await logItemProgress(updatedItems);

      if (!needsFollowUp) {
        setExpandedItemId(null);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleCreateFollowUpTicket = async (item: MaintenanceWorkOrderItem) => {
    setSaving(true);
    try {
      const ticketNumber = await generateTicketNumber();
      const queueNumber = await generateQueueNumber();
      const ticketRef = await addDoc(collection(db, "asset_issue_tickets"), {
        ticketNumber,
        queueNumber,
        assetId: item.assetId,
        assetName: item.assetName,
        assetCode: item.assetCode,
        assetCategory: item.assetCategory || "",
        assetLocation: item.assetLocation || "",
        reportedByUid: assetUser?.uid || "",
        reportedByName: assetUser?.name || "",
        reportedByEmail: assetUser?.email || "",
        reportedAt: serverTimestamp(),
        symptomType: "Lainnya",
        impactLevel: "Mengganggu Pekerjaan",
        description: findings || item.findings || "Temuan dari Work Order Maintenance",
        priority: "medium",
        status: "waiting_diagnosis",
        source: "maintenance_work_order",
        workOrderId: workOrder.id,
        workOrderNumber: workOrder.workOrderNumber,
        workOrderItemId: item.id,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
      await writeAssetIssueLog({
        ticketId: ticketRef.id,
        ticketNumber,
        action: "create_ticket",
        newStatus: "waiting_diagnosis",
        note: `Dibuat dari temuan Work Order ${workOrder.workOrderNumber}`,
        performedByUid: assetUser?.uid || "",
        performedByName: assetUser?.name || "",
      });

      const itemRef = doc(
        db,
        "asset_maintenance_work_orders",
        workOrder.id,
        "items",
        item.id
      );
      await updateDoc(itemRef, {
        followUpTicketId: ticketRef.id,
        followUpTicketNumber: ticketNumber,
        updatedAt: serverTimestamp(),
      });

      await writeWorkOrderLog({
        workOrderId: workOrder.id,
        workOrderNumber: workOrder.workOrderNumber,
        action: "create_follow_up_ticket",
        note: `Ticket ${ticketNumber} dibuat dari ${item.assetName}`,
        performedByUid: assetUser?.uid || "",
        performedByName: assetUser?.name || "",
      });
    } finally {
      setSaving(false);
    }
  };

  // Laporan Hasil (section 10) — diagregasi dari checklist per-asset karena
  // belum ada field laporan tunggal di level work order.
  const hasReport = !!workOrder.reportSubmittedAt;
  const findingsList = items.filter((i) => i.findings).map((i) => ({ asset: i.assetName, text: i.findings! }));
  const actionsList = items
    .filter((i) => i.actionTaken)
    .map((i) => ({ asset: i.assetName, text: i.actionTaken! }));
  const recommendationList = items
    .filter((i) => i.technicianNote)
    .map((i) => ({ asset: i.assetName, text: i.technicianNote! }));
  const photosBefore = items.flatMap((i) =>
    (i.photoBeforeUrls || []).map((url) => ({ asset: i.assetName, url }))
  );
  const photosAfter = items.flatMap((i) =>
    (i.photoAfterUrls || []).map((url) => ({ asset: i.assetName, url }))
  );
  const followUpTickets = items.filter((i) => i.followUpTicketNumber);

  const locationLabel =
    workOrder.maintenanceLocationText || workOrder.locationText || "Belum ditentukan";

  const displayStatus = getDisplayStatus(workOrder);
  const currentDueDateKey = getDueDateKey(workOrder);
  const nextCycleDueDateKey = computeNextCycleDueDateKey(currentDueDateKey, workOrder.frequencyMonths);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-white rounded-none sm:rounded-2xl shadow-lg border-0 sm:border border-slate-200 w-full h-full sm:h-auto sm:w-[90vw] sm:max-w-[1100px] max-h-full sm:max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="shrink-0 border-b border-slate-200 px-5 sm:px-6 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[11px] font-medium text-slate-400 uppercase tracking-wide">Work Order</p>
              <h2 className="text-xl sm:text-2xl font-bold text-slate-900 truncate">{workOrder.workOrderNumber}</h2>
              <p className="text-sm text-slate-600 mt-0.5 truncate">{workOrder.title}</p>
              <div className="flex flex-wrap items-center gap-2 mt-2.5">
                <Badge label={displayStatus.label} colorClass={displayStatus.colorClass} />
                {(displayStatus.overdue || displayStatus.dueToday) && displayStatus.subLabel && (
                  <span className="text-xs text-slate-400">· {displayStatus.subLabel}</span>
                )}
                <Badge
                  label={WORK_ORDER_PRIORITY_LABEL[workOrder.priority]}
                  colorClass={WORK_ORDER_PRIORITY_COLOR[workOrder.priority]}
                />
                {workOrder.assignedToName && (
                  <span className="text-xs text-slate-500">
                    Teknisi: <span className="font-medium text-slate-700">{workOrder.assignedToName}</span>
                  </span>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="shrink-0 text-slate-400 hover:text-slate-700 cursor-pointer rounded-lg p-1 hover:bg-slate-100"
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Body scroll */}
        <div className="flex-1 overflow-y-auto px-5 sm:px-6 py-5 space-y-5">
          {/* Summary mini cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
            <MiniStat label="Jumlah Asset" value={String(items.length)} />
            <MiniStat label="Sudah Dicek" value={String(checkedCount)} />
            <MiniStat label="Belum Dicek" value={String(items.length - checkedCount)} />
            <MiniStat label="Progress" value={`${progressPercent}%`} />
            <MiniStat
              label="Jatuh Tempo Tugas Ini"
              value={currentDueDateKey ? formatDate(currentDueDateKey) : "-"}
            />
            <MiniStat
              label="Jadwal Berikutnya"
              value={nextCycleDueDateKey ? formatDate(nextCycleDueDateKey) : "-"}
            />
            <MiniStat label="Ditugaskan ke" value={workOrder.assignedToName || "-"} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
            {/* Kolom kiri */}
            <div className="lg:col-span-3 space-y-5">
              <section className="rounded-2xl border border-slate-200 p-4">
                <p className="text-xs font-medium text-slate-400 mb-1">Lokasi Maintenance</p>
                <p className="text-base font-semibold text-slate-900">{locationLabel}</p>
              </section>

              <section className="rounded-2xl border border-slate-200 p-4">
                <h3 className="text-sm font-semibold text-slate-800 mb-3">Informasi Jadwal</h3>
                <div className="grid sm:grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  <Info label="Frekuensi" value={workOrder.frequencyLabel} />
                  <Info label="Mulai Periode" value={workOrder.periodLabel} />
                  <Info
                    label="Setiap Tanggal"
                    value={workOrder.scheduledDayOfMonth ? `Tanggal ${workOrder.scheduledDayOfMonth}` : undefined}
                  />
                  <Info
                    label="Jatuh Tempo Tugas Ini"
                    value={currentDueDateKey ? formatDate(currentDueDateKey) : undefined}
                  />
                  <Info
                    label="Jadwal Berikutnya"
                    value={nextCycleDueDateKey ? formatDate(nextCycleDueDateKey) : undefined}
                  />
                  <Info label="Dibuat oleh" value={workOrder.requestedByName} />
                  <Info label="Ditugaskan ke" value={workOrder.assignedToName} />
                </div>
                {!!workOrder.lastEditedAt && (
                  <div className="mt-3 pt-3 border-t border-slate-100 text-xs text-slate-500">
                    <p>
                      Terakhir diubah oleh{" "}
                      <span className="font-medium text-slate-700">
                        {workOrder.lastEditedByName || "-"}
                      </span>{" "}
                      · {formatDateTimeSeconds(workOrder.lastEditedAt)}
                    </p>
                    {workOrder.lastEditReason && (
                      <p className="mt-0.5">Alasan: {workOrder.lastEditReason}</p>
                    )}
                  </div>
                )}
              </section>

              {(workOrder.scheduledByItAt || workOrder.plannedWorkDate) && (
                <section className="rounded-2xl border border-sky-200 bg-sky-50/40 p-4">
                  <h3 className="text-sm font-semibold text-slate-800 mb-3">Rencana Pengerjaan</h3>
                  <div className="grid sm:grid-cols-2 gap-x-4 gap-y-3 text-sm">
                    <Info
                      label="Tanggal"
                      value={workOrder.plannedWorkDate ? formatDate(workOrder.plannedWorkDate) : undefined}
                    />
                    <Info
                      label="Jam"
                      value={
                        workOrder.plannedStartTime && workOrder.plannedEndTime
                          ? `${workOrder.plannedStartTime} - ${workOrder.plannedEndTime}`
                          : undefined
                      }
                    />
                    <Info
                      label="Potensi Ganggu User"
                      value={
                        workOrder.willInterruptUser === undefined
                          ? undefined
                          : workOrder.willInterruptUser
                          ? "Ya"
                          : "Tidak"
                      }
                    />
                    <Info label="Catatan IT" value={workOrder.plannedNote} />
                  </div>
                </section>
              )}

              <section className="rounded-2xl border border-slate-200 p-4">
                <h3 className="text-sm font-semibold text-slate-800 mb-2">Catatan QHSE untuk Teknisi</h3>
                <p className="text-sm text-slate-700 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
                  {workOrder.qhseNote || workOrder.notes || "Tidak ada catatan."}
                </p>
              </section>

              <section className="rounded-2xl border border-slate-200 p-4">
                <h3 className="text-sm font-semibold text-slate-800 mb-3">Laporan Hasil</h3>
                {!hasReport ? (
                  <p className="text-sm text-slate-400">Laporan hasil belum dikirim.</p>
                ) : (
                  <div className="space-y-4">
                    <ReportField title="Ringkasan Temuan" entries={findingsList} />
                    <ReportField title="Tindakan yang Dilakukan" entries={actionsList} />
                    <ReportField title="Catatan Teknisi / Rekomendasi" entries={recommendationList} />
                    {(photosBefore.length > 0 || photosAfter.length > 0) && (
                      <div>
                        <p className="text-xs font-medium text-slate-500 mb-1.5">Foto Sebelum / Sesudah</p>
                        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                          {[...photosBefore, ...photosAfter].map((p, i) => (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              key={`${p.asset}-${i}`}
                              src={p.url}
                              alt={p.asset}
                              className="h-16 w-full object-cover rounded-lg border border-slate-200"
                            />
                          ))}
                        </div>
                      </div>
                    )}
                    <div>
                      <p className="text-xs font-medium text-slate-500 mb-1">Butuh Ticket Lanjutan?</p>
                      {followUpTickets.length === 0 ? (
                        <p className="text-sm text-slate-600">Tidak ada.</p>
                      ) : (
                        <ul className="text-sm text-slate-700 space-y-0.5">
                          {followUpTickets.map((t) => (
                            <li key={t.id}>
                              {t.assetName} → <span className="text-blue-600">{t.followUpTicketNumber}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>
                )}
              </section>

              <section>
                <h3 className="text-sm font-semibold text-slate-800 mb-3">Daftar Asset</h3>
                <div className="space-y-2">
                  {items.map((item) => (
                    <div key={item.id} className="border border-slate-200 rounded-xl overflow-hidden">
                      <button
                        type="button"
                        onClick={() => canWorkItems && openItemForm(item)}
                        className={`w-full flex items-center justify-between px-3 py-2.5 text-left ${
                          canWorkItems ? "cursor-pointer hover:bg-slate-50" : "cursor-default"
                        }`}
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-800 truncate">{item.assetName}</p>
                          <p className="text-xs text-slate-400 truncate">
                            {item.assetCode} · {item.assetCategory || "-"} · {item.assetLocation || "-"}
                          </p>
                          {item.conditionBefore && (
                            <p className="text-xs text-slate-400">Kondisi awal: {item.conditionBefore}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Badge
                            label={WORK_ORDER_ITEM_STATUS_LABEL[item.status]}
                            colorClass={WORK_ORDER_ITEM_STATUS_COLOR[item.status]}
                          />
                          {item.followUpTicketNumber && (
                            <span className="text-xs text-blue-600">{item.followUpTicketNumber}</span>
                          )}
                          {canWorkItems && (
                            <span className="text-xs font-medium text-blue-600">
                              {item.status === "pending" ? "Isi Hasil" : "Detail"}
                            </span>
                          )}
                          {canWorkItems &&
                            (expandedItemId === item.id ? (
                              <ChevronUp size={15} className="text-slate-400" />
                            ) : (
                              <ChevronDown size={15} className="text-slate-400" />
                            ))}
                        </div>
                      </button>

                      {expandedItemId === item.id && canWorkItems && (
                        <div className="px-3 pb-3 pt-1 space-y-3 border-t border-slate-100">
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-xs font-medium text-slate-500 mb-1.5">
                                Kondisi Sebelum
                              </label>
                              <select
                                value={conditionBefore}
                                onChange={(e) => setConditionBefore(e.target.value as MaintenanceConditionLabel)}
                                className="input text-sm cursor-pointer"
                              >
                                {CONDITION_OPTIONS.map((c) => (
                                  <option key={c} value={c}>
                                    {c}
                                  </option>
                                ))}
                              </select>
                            </div>
                            <div>
                              <label className="block text-xs font-medium text-slate-500 mb-1.5">
                                Kondisi Setelah
                              </label>
                              <select
                                value={conditionAfter}
                                onChange={(e) => setConditionAfter(e.target.value as MaintenanceConditionLabel)}
                                className="input text-sm cursor-pointer"
                              >
                                {CONDITION_OPTIONS.map((c) => (
                                  <option key={c} value={c}>
                                    {c}
                                  </option>
                                ))}
                              </select>
                            </div>
                          </div>

                          <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1.5">
                              Checklist
                            </label>
                            <div className="grid sm:grid-cols-2 gap-1.5">
                              {CHECKLIST_LABELS.map(({ key, label }) => (
                                <label
                                  key={key}
                                  className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer"
                                >
                                  <input
                                    type="checkbox"
                                    checked={checklist[key]}
                                    onChange={(e) =>
                                      setChecklist((prev) => ({ ...prev, [key]: e.target.checked }))
                                    }
                                    className="cursor-pointer"
                                  />
                                  {label}
                                </label>
                              ))}
                            </div>
                          </div>

                          <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1.5">
                              Temuan
                            </label>
                            <textarea
                              value={findings}
                              onChange={(e) => setFindings(e.target.value)}
                              rows={2}
                              className="input text-sm"
                            />
                          </div>

                          <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1.5">
                              Tindakan
                            </label>
                            <select
                              value={actionTaken}
                              onChange={(e) => setActionTaken(e.target.value as MaintenanceActionTaken)}
                              className="input text-sm cursor-pointer"
                            >
                              <option value="">Pilih tindakan</option>
                              {ACTION_OPTIONS.map((a) => (
                                <option key={a} value={a}>
                                  {a}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1.5">
                              Catatan Teknisi
                            </label>
                            <textarea
                              value={technicianNote}
                              onChange={(e) => setTechnicianNote(e.target.value)}
                              rows={2}
                              className="input text-sm"
                            />
                          </div>

                          <div className="flex flex-wrap gap-2">
                            <button
                              type="button"
                              onClick={() => handleSaveItem(item)}
                              disabled={saving}
                              className="rounded-xl bg-emerald-600 text-white px-4 py-2 text-sm font-medium cursor-pointer hover:bg-emerald-700 disabled:opacity-60"
                            >
                              Simpan Hasil Cek
                            </button>
                            {actionTaken && NEEDS_FOLLOW_UP_ACTIONS.includes(actionTaken) && (
                              <button
                                type="button"
                                onClick={() => handleCreateFollowUpTicket(item)}
                                disabled={saving || !!item.followUpTicketNumber}
                                className="rounded-xl border border-red-200 bg-red-50 text-red-700 px-4 py-2 text-sm font-medium cursor-pointer hover:bg-red-100 disabled:opacity-60"
                              >
                                {item.followUpTicketNumber
                                  ? `Ticket ${item.followUpTicketNumber} dibuat`
                                  : "Buat Ticket Kendala dari Temuan Ini?"}
                              </button>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </section>
            </div>

            {/* Kolom kanan */}
            <div className="lg:col-span-2 space-y-5">
              <section className="rounded-2xl border border-blue-200 bg-blue-50/40 p-4">
                <h3 className="text-sm font-semibold text-slate-800 mb-3">Aksi Berikutnya</h3>
                <div className="flex flex-wrap gap-2">
                  {canAccept && (
                    <button
                      type="button"
                      onClick={handleAccept}
                      disabled={saving}
                      className="rounded-xl bg-gradient-to-r from-blue-600 to-teal-500 text-white px-4 py-2 text-sm font-medium cursor-pointer hover:brightness-105 disabled:opacity-60"
                    >
                      Terima Tugas
                    </button>
                  )}
                  {canScheduleByIt && (
                    <button
                      type="button"
                      onClick={() => setScheduleModalOpen(true)}
                      disabled={saving}
                      className="rounded-xl bg-gradient-to-r from-blue-600 to-teal-500 text-white px-4 py-2 text-sm font-medium cursor-pointer hover:brightness-105 disabled:opacity-60"
                    >
                      Jadwalkan Pengerjaan
                    </button>
                  )}
                  {canStart && (
                    <button
                      type="button"
                      onClick={handleStart}
                      disabled={saving}
                      className="rounded-xl bg-gradient-to-r from-blue-600 to-teal-500 text-white px-4 py-2 text-sm font-medium cursor-pointer hover:brightness-105 disabled:opacity-60"
                    >
                      Kerjakan
                    </button>
                  )}
                  {canSubmitReport && (
                    <button
                      type="button"
                      onClick={handleSubmitReport}
                      disabled={saving}
                      className="rounded-xl bg-emerald-600 text-white px-4 py-2 text-sm font-medium cursor-pointer hover:bg-emerald-700 disabled:opacity-60"
                    >
                      Kirim Laporan
                    </button>
                  )}
                  {canMarkCompleted && (
                    <button
                      type="button"
                      onClick={handleMarkCompleted}
                      disabled={saving}
                      className="rounded-xl bg-emerald-600 text-white px-4 py-2 text-sm font-medium cursor-pointer hover:bg-emerald-700 disabled:opacity-60"
                    >
                      Tandai Selesai
                    </button>
                  )}
                  {canMarkCompleted && (
                    <button
                      type="button"
                      onClick={() => {
                        setRevisionError("");
                        setRevisionReason("");
                        setRevisionModalOpen(true);
                      }}
                      disabled={saving}
                      className="rounded-xl border border-amber-300 bg-amber-50 text-amber-700 px-4 py-2 text-sm font-medium cursor-pointer hover:bg-amber-100 disabled:opacity-60"
                    >
                      Minta Revisi
                    </button>
                  )}
                  {canCancel && (
                    <button
                      type="button"
                      onClick={handleCancelWorkOrder}
                      disabled={saving}
                      className="rounded-xl border border-red-200 bg-red-50 text-red-700 px-4 py-2 text-sm font-medium cursor-pointer hover:bg-red-100 disabled:opacity-60"
                    >
                      Batalkan
                    </button>
                  )}
                  {workOrder.status === "completed" && (
                    <Badge label="Selesai" colorClass={getMaintenanceStatusColor("completed")} />
                  )}
                  {!canAccept &&
                    !canScheduleByIt &&
                    !canStart &&
                    !canSubmitReport &&
                    !canMarkCompleted &&
                    !canCancel &&
                    workOrder.status !== "completed" &&
                    !canUseTestingMode && (
                      <p className="text-sm text-slate-500">
                        {workOrder.status === "report_submitted"
                          ? "Menunggu review QHSE."
                          : "Tidak ada aksi untuk Anda saat ini."}
                      </p>
                    )}
                  {helpActions.length > 0 && (
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setHelpMenuOpen((v) => !v)}
                        disabled={saving}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-600 cursor-pointer hover:bg-slate-50 disabled:opacity-60"
                      >
                        <HelpCircle size={15} />
                        Aksi Bantuan
                        <ChevronDown size={14} />
                      </button>
                      {helpMenuOpen && (
                        <>
                          <div className="fixed inset-0 z-10" onClick={() => setHelpMenuOpen(false)} />
                          <div className="absolute left-0 mt-1 w-64 bg-white rounded-xl border border-slate-200 shadow-lg z-20 py-1">
                            {helpActions.map((option) => (
                              <button
                                key={option.key}
                                type="button"
                                onClick={() => handleHelpActionClick(option)}
                                className={`w-full text-left px-3 py-2 text-sm cursor-pointer hover:bg-slate-50 ${
                                  option.destructive ? "text-red-600" : "text-slate-700"
                                }`}
                              >
                                {option.label}
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                  {canUseTestingMode && (
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setTestingMenuOpen((v) => !v)}
                        disabled={saving}
                        className="inline-flex items-center gap-1.5 rounded-xl border border-dashed border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-500 cursor-pointer hover:bg-slate-50 disabled:opacity-60"
                        title="Fitur sementara untuk testing — bukan flow produksi"
                      >
                        <FlaskConical size={13} />
                        Mode Testing Alur
                        <ChevronDown size={13} />
                      </button>
                      {testingMenuOpen && (
                        <>
                          <div className="fixed inset-0 z-10" onClick={() => setTestingMenuOpen(false)} />
                          <div className="absolute left-0 mt-1 w-64 bg-white rounded-xl border border-slate-200 shadow-lg z-20 py-1">
                            <p className="px-3 py-1.5 text-[11px] font-medium text-amber-600 uppercase tracking-wide">
                              Testing Mode — bukan flow final
                            </p>
                            {TESTING_STATUS_OPTIONS.map((option) => (
                              <button
                                key={option.key}
                                type="button"
                                onClick={() => {
                                  setTestingMenuOpen(false);
                                  setTestingError("");
                                  setTestingReason("");
                                  setPendingTestingOption(option);
                                }}
                                className="w-full text-left px-3 py-2 text-sm text-slate-700 cursor-pointer hover:bg-slate-50"
                              >
                                {option.label}
                              </button>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 p-4">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-semibold text-slate-800">Progress Pengecekan</h3>
                  <span className="text-sm font-semibold text-slate-700">{progressPercent}%</span>
                </div>
                <p className="text-xs text-slate-500 mb-2">
                  {checkedCount} dari {items.length} asset dicek
                </p>
                <div className="h-3 rounded-full bg-slate-100 overflow-hidden">
                  <div
                    className="h-full bg-blue-500 transition-all"
                    style={{ width: `${progressPercent}%` }}
                  />
                </div>
              </section>

              <section className="rounded-2xl border border-slate-200 p-4">
                <WorkOrderTimeline workOrder={workOrder} />
              </section>

              <section id="wo-activity-log" className="rounded-2xl border border-slate-200 p-4 scroll-mt-4">
                <h3 className="text-sm font-semibold text-slate-800 mb-3">Aktivitas Terakhir</h3>
                {logs.length === 0 ? (
                  <p className="text-sm text-slate-400">Belum ada aktivitas.</p>
                ) : (
                  <ul className="space-y-2.5">
                    {logs.map((log) => (
                      <li key={log.id} className="text-sm">
                        <p className="text-slate-800">
                          <span className="font-medium">{log.performedByName || "Sistem"}</span>{" "}
                          {WORK_ORDER_LOG_ACTION_LABEL[log.action] || log.action}
                          {log.oldStatus && log.newStatus && log.oldStatus !== log.newStatus && (
                            <span className="text-slate-500">
                              {" "}
                              ({getMaintenanceStatusLabel(log.oldStatus)} → {getMaintenanceStatusLabel(log.newStatus)})
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-slate-400">{formatDateTimeSeconds(log.performedAt)}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </div>
        </div>
      </div>

      {scheduleModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => !saving && setScheduleModalOpen(false)}
          />
          <div className="relative bg-white rounded-2xl shadow-lg border border-slate-200 w-full max-w-md p-5">
            <h3 className="text-base font-semibold text-slate-900 mb-1">Jadwalkan Pengerjaan</h3>
            <p className="text-sm text-slate-500 mb-4">
              Beri tahu QHSE kapan maintenance ini akan Anda kerjakan.
            </p>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">
                  Tanggal Rencana Pengerjaan <span className="text-red-500">*</span>
                </label>
                <input
                  type="date"
                  value={scheduleDate}
                  onChange={(e) => setScheduleDate(e.target.value)}
                  className="input text-sm"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">
                    Jam Mulai <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="time"
                    value={scheduleStart}
                    onChange={(e) => setScheduleStart(e.target.value)}
                    className="input text-sm"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">
                    Jam Selesai <span className="text-red-500">*</span>
                  </label>
                  <input
                    type="time"
                    value={scheduleEnd}
                    onChange={(e) => setScheduleEnd(e.target.value)}
                    className="input text-sm"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">Catatan Teknisi</label>
                <textarea
                  value={scheduleNote}
                  onChange={(e) => setScheduleNote(e.target.value)}
                  rows={2}
                  className="input text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1.5">
                  Apakah berpotensi mengganggu user? <span className="text-red-500">*</span>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setScheduleWillInterrupt("yes")}
                    className={`rounded-xl border px-3 py-2 text-sm font-medium cursor-pointer transition-colors ${
                      scheduleWillInterrupt === "yes"
                        ? "border-amber-500 bg-amber-50 text-amber-700"
                        : "border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    Ya
                  </button>
                  <button
                    type="button"
                    onClick={() => setScheduleWillInterrupt("no")}
                    className={`rounded-xl border px-3 py-2 text-sm font-medium cursor-pointer transition-colors ${
                      scheduleWillInterrupt === "no"
                        ? "border-blue-500 bg-blue-50 text-blue-700"
                        : "border-slate-200 text-slate-600 hover:bg-slate-50"
                    }`}
                  >
                    Tidak
                  </button>
                </div>
              </div>
              {scheduleError && <p className="text-sm text-red-600">{scheduleError}</p>}
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setScheduleModalOpen(false)}
                  disabled={saving}
                  className="flex-1 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium cursor-pointer hover:bg-slate-50 disabled:opacity-60"
                >
                  Batal
                </button>
                <button
                  type="button"
                  onClick={handleSubmitScheduleModal}
                  disabled={saving}
                  className="flex-1 rounded-xl bg-gradient-to-r from-blue-600 to-teal-500 text-white px-4 py-2 text-sm font-medium cursor-pointer hover:brightness-105 disabled:opacity-60"
                >
                  {saving ? "Menyimpan..." : "Simpan Jadwal"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {revisionModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => !saving && setRevisionModalOpen(false)}
          />
          <div className="relative bg-white rounded-2xl shadow-lg border border-slate-200 w-full max-w-md p-5">
            <h3 className="text-base font-semibold text-slate-900 mb-1">Minta Revisi Laporan</h3>
            <p className="text-sm text-slate-500 mb-3">
              Tugas akan dikembalikan ke status Sedang Dikerjakan supaya IT bisa memperbaiki laporan.
            </p>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">
              Alasan Revisi <span className="text-red-500">*</span>
            </label>
            <textarea
              value={revisionReason}
              onChange={(e) => setRevisionReason(e.target.value)}
              rows={3}
              className="input text-sm"
              placeholder="Jelaskan bagian mana yang perlu diperbaiki..."
              autoFocus
            />
            {revisionError && <p className="text-sm text-red-600 mt-2">{revisionError}</p>}
            <div className="flex gap-2 pt-3">
              <button
                type="button"
                onClick={() => setRevisionModalOpen(false)}
                disabled={saving}
                className="flex-1 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium cursor-pointer hover:bg-slate-50 disabled:opacity-60"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleSubmitRevisionModal}
                disabled={saving}
                className="flex-1 rounded-xl bg-amber-600 text-white px-4 py-2 text-sm font-medium cursor-pointer hover:bg-amber-700 disabled:opacity-60"
              >
                {saving ? "Mengirim..." : "Kirim Permintaan Revisi"}
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingTestingOption && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => !saving && setPendingTestingOption(null)}
          />
          <div className="relative bg-white rounded-2xl shadow-lg border border-amber-200 w-full max-w-md p-5">
            <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 text-[11px] font-semibold mb-2">
              <FlaskConical size={11} /> Testing Mode
            </span>
            <h3 className="text-base font-semibold text-slate-900 mb-1">{pendingTestingOption.label}</h3>
            <p className="text-sm text-slate-500 mb-3">
              Ini fitur sementara untuk mencoba alur timeline, bukan flow produksi. Status, timestamp,
              dan asset item akan diubah paksa sesuai pilihan ini.
            </p>
            <label className="block text-xs font-medium text-slate-500 mb-1.5">
              Catatan / Alasan Testing <span className="text-red-500">*</span>
            </label>
            <textarea
              value={testingReason}
              onChange={(e) => setTestingReason(e.target.value)}
              rows={3}
              className="input text-sm"
              placeholder="Contoh: testing alur revisi laporan..."
              autoFocus
            />
            {testingError && <p className="text-sm text-red-600 mt-2">{testingError}</p>}
            <div className="flex gap-2 pt-3">
              <button
                type="button"
                onClick={() => setPendingTestingOption(null)}
                disabled={saving}
                className="flex-1 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium cursor-pointer hover:bg-slate-50 disabled:opacity-60"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleConfirmTestingStatus}
                disabled={saving}
                className="flex-1 rounded-xl bg-amber-600 text-white px-4 py-2 text-sm font-medium cursor-pointer hover:bg-amber-700 disabled:opacity-60"
              >
                {saving ? "Menyimpan..." : "Terapkan (Testing)"}
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingHelpAction && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => !saving && setPendingHelpAction(null)}
          />
          <div className="relative bg-white rounded-2xl shadow-lg border border-slate-200 w-full max-w-md p-5">
            <h3 className="text-base font-semibold text-slate-900 mb-1">{pendingHelpAction.label}</h3>
            <p className="text-sm text-slate-500 mb-3">
              Tindakan ini akan dicatat di timeline dan activity log work order.
            </p>
            {pendingHelpAction.requiresReason && (
              <div className="mb-3">
                <label className="block text-xs font-medium text-slate-500 mb-1.5">
                  Alasan <span className="text-red-500">*</span>
                </label>
                <textarea
                  value={helpReason}
                  onChange={(e) => setHelpReason(e.target.value)}
                  rows={3}
                  className="input text-sm"
                  placeholder="Jelaskan alasan tindakan ini..."
                  autoFocus
                />
              </div>
            )}
            {helpError && <p className="text-sm text-red-600 mb-3">{helpError}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPendingHelpAction(null)}
                disabled={saving}
                className="flex-1 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium cursor-pointer hover:bg-slate-50 disabled:opacity-60"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={handleConfirmHelpAction}
                disabled={saving}
                className={`flex-1 rounded-xl px-4 py-2 text-sm font-medium cursor-pointer text-white disabled:opacity-60 ${
                  pendingHelpAction.destructive
                    ? "bg-red-600 hover:bg-red-700"
                    : "bg-gradient-to-r from-blue-600 to-teal-500 hover:brightness-105"
                }`}
              >
                {saving ? "Menyimpan..." : "Konfirmasi"}
              </button>
            </div>
          </div>
        </div>
      )}
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

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-slate-200 p-3">
      <p className="text-xs text-slate-400 mb-1 truncate">{label}</p>
      <p className="text-base font-semibold text-slate-900 truncate">{value}</p>
    </div>
  );
}

function ReportField({ title, entries }: { title: string; entries: { asset: string; text: string }[] }) {
  if (entries.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-medium text-slate-500 mb-1.5">{title}</p>
      <ul className="space-y-1">
        {entries.map((e, i) => (
          <li key={`${e.asset}-${i}`} className="text-sm text-slate-700">
            <span className="font-medium">{e.asset}:</span> {e.text}
          </li>
        ))}
      </ul>
    </div>
  );
}

const TIMELINE_ICON: Record<MaintenanceTimelineStep["key"], typeof Check> = {
  created: FilePlus,
  accepted: UserCheck,
  scheduled_by_it: CalendarClock,
  started: Wrench,
  report_submitted: ClipboardList,
  completed: Check,
  cancelled: Ban,
};

function WorkOrderTimeline({ workOrder }: { workOrder: MaintenanceWorkOrder }) {
  const steps = getMaintenanceTimelineSteps(workOrder);
  const isCancelled = workOrder.status === "cancelled";

  return (
    <div>
      <p className="text-xs font-medium text-slate-500 mb-3">Timeline</p>
      <div>
        {steps.map((step, i) => {
          const Icon = TIMELINE_ICON[step.key];
          const isCancelStep = step.key === "cancelled";
          const stateClass = isCancelStep
            ? "bg-red-500 text-white"
            : step.done
            ? "bg-emerald-500 text-white"
            : "bg-slate-100 text-slate-400";
          const lineClass = isCancelStep
            ? "bg-red-200"
            : step.done
            ? "bg-emerald-300"
            : "bg-slate-150";

          return (
            <div key={step.key} className="flex gap-3">
              <div className="flex flex-col items-center">
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${stateClass}`}
                >
                  <Icon size={15} />
                </span>
                {i < steps.length - 1 && (
                  <span className={`w-0.5 flex-1 min-h-[18px] ${lineClass}`} />
                )}
              </div>
              <div className="pb-5">
                <p
                  className={`text-sm font-medium ${
                    isCancelStep ? "text-red-700" : step.done ? "text-slate-800" : "text-slate-400"
                  }`}
                >
                  {step.label}
                </p>
                {step.done ? (
                  <p className="text-xs text-slate-500 mt-0.5">
                    {step.byName ? `${step.byName} · ` : ""}
                    {formatDateTimeSeconds(step.at)}
                  </p>
                ) : (
                  !isCancelled && <p className="text-xs text-slate-400 mt-0.5">Belum dilakukan</p>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
