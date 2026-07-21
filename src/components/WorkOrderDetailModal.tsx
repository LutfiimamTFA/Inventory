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
  AlertOctagon,
} from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import {
  AssetIssueTicket,
  AssetUser,
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
  cleanFirestoreData,
  fetchActiveUsersByRole,
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
  "no_action",
  "cleaned",
  "reconfigured",
  "minor_repair",
  "software_update",
  "clear_storage",
  "replace_component",
  "need_purchase",
  "need_vendor",
  "need_follow_up_ticket",
  "temporarily_unusable",
];

const ACTION_LABELS: Record<MaintenanceActionTaken, string> = {
  no_action: "Tidak ada tindakan",
  cleaned: "Dibersihkan",
  reconfigured: "Disetting / Disesuaikan Ulang",
  minor_repair: "Diperbaiki Ringan",
  software_update: "Update Software / Firmware",
  clear_storage: "Kosongkan Storage / Rapikan Data",
  replace_component: "Ganti Komponen / Aksesoris",
  need_purchase: "Perlu Pembelian Komponen",
  need_vendor: "Perlu Vendor / Teknisi Eksternal",
  need_follow_up_ticket: "Perlu Ticket Kendala Lanjutan",
  temporarily_unusable: "Tidak Layak Pakai Sementara",
};

// Placeholder catatan menyesuaikan tindakan yang dipilih supaya teknisi tahu
// info apa yang wajib ditulis — dipakai juga untuk membersihkan catatan
// "kondisi baik" kalau tindakan diganti jadi bukan no_action (lihat handler
// onChange dropdown Tindakan).
const ACTION_NOTE_PLACEHOLDER: Partial<Record<MaintenanceActionTaken, string>> = {
  replace_component: "Sebutkan komponen atau aksesoris yang perlu diganti.",
  need_purchase: "Sebutkan komponen yang perlu dibeli dan alasannya.",
  need_vendor: "Jelaskan kenapa perlu vendor atau teknisi eksternal.",
  need_follow_up_ticket: "Jelaskan kendala yang perlu dibuatkan ticket lanjutan.",
  temporarily_unusable: "Jelaskan alasan asset sementara tidak layak digunakan.",
};

const DEFAULT_NOTE_PLACEHOLDER =
  "Tulis temuan, kondisi asset, atau catatan teknisi. Contoh: Tidak ada temuan, asset dalam kondisi baik.";

// Tindakan yang butuh tindak lanjut nyata (beli/ganti/vendor/tidak layak
// pakai) — item ditandai "needs_follow_up" dan tombol buat ticket muncul.
const NEEDS_FOLLOW_UP_ACTIONS: MaintenanceActionTaken[] = [
  "replace_component",
  "need_purchase",
  "need_vendor",
  "need_follow_up_ticket",
  "temporarily_unusable",
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

const ALL_CHECKED_CHECKLIST: MaintenanceChecklistState = {
  fisikDicek: true,
  fungsiUtamaBerjalan: true,
  aksesorisLengkap: true,
  kebersihanDicek: true,
  labelQrTerbaca: true,
  lokasiSesuai: true,
  tidakAdaKerusakanKritis: true,
};

const GOOD_CONDITION_NOTE = "Tidak ada temuan. Asset dalam kondisi baik.";

// Bungkus setiap write reset-checklist supaya kalau gagal (mis. Firestore
// rules menolak field yang belum di-whitelist) errornya jelas collection
// mana yang bermasalah di console, bukan cuma "gagal menyimpan" generik —
// dan errornya tetap di-rethrow supaya try/catch/finally pemanggil (yang
// me-reset tombol "Menyimpan...") tetap jalan seperti biasa.
// 4 sub-keputusan di bawah modal "Tindak Lanjuti" — "request_recheck" dipicu
// langsung dari tombol "Minta Cek Ulang" terpisah (tidak lewat chooser ini).
type QhseFollowUpDecisionKind =
  | "request_recheck"
  | "create_corrective_task"
  | "need_purchase"
  | "need_vendor"
  | "mark_temporarily_unusable";

const QHSE_FOLLOW_UP_DECISION_LABELS: Record<QhseFollowUpDecisionKind, string> = {
  request_recheck: "Minta Cek Ulang ke Tim IT",
  create_corrective_task: "Buat Tugas Korektif IT",
  need_purchase: "Ajukan Pembelian Komponen",
  need_vendor: "Butuh Vendor Eksternal",
  mark_temporarily_unusable: "Tandai Asset Tidak Layak Pakai Sementara",
};

type TicketBadgeState = "active" | "cancelled" | "missing" | "none";

// "cancelled" di sini = status ticket yang sudah final/tidak butuh tindak
// lanjut lagi (closed/rejected) — AssetIssueTicket TIDAK punya status
// "cancelled" sungguhan, jadi dua status final ini dipakai sebagai
// padanannya untuk keperluan badge.
const TICKET_CANCELLED_EQUIVALENT_STATUSES = ["closed", "rejected"];

function getTicketBadgeState(
  item: MaintenanceWorkOrderItem,
  existingTicketsById: Record<string, AssetIssueTicket | null>
): TicketBadgeState {
  if (!item.followUpTicketId) return "none";
  const ticket = existingTicketsById[item.followUpTicketId];
  // undefined = belum selesai di-fetch — anggap "none" dulu supaya badge
  // tidak sempat kelihatan aktif sebelum kepastian didapat.
  if (ticket === undefined) return "none";
  if (ticket === null) return "missing";
  if (TICKET_CANCELLED_EQUIVALENT_STATUSES.includes(ticket.status)) return "cancelled";
  return "active";
}

// Label status temuan Tim IT → QHSE (alur baru: IT lapor, QHSE yang
// memutuskan tugas lanjutan/ticket — bukan IT bikin ticket sendiri).
// Return null kalau item belum pernah dilaporkan sama sekali.
function getFindingStatusLabel(
  item: MaintenanceWorkOrderItem,
  existingTicketsById: Record<string, AssetIssueTicket | null>
): string | null {
  if (item.followUpStatus === "corrective_task_created") {
    const ticketState = getTicketBadgeState(item, existingTicketsById);
    if (ticketState === "cancelled") return "Ticket dibatalkan";
    if (item.followUpTicketNumber) return `Tugas Lanjutan Dibuat: ${item.followUpTicketNumber}`;
    return "Tugas Lanjutan Dibuat";
  }
  if (item.followUpStatus === "noted") return "Temuan Dicatat QHSE";
  if (item.followUpStatus === "recheck_requested") return "Cek Ulang Diminta QHSE";
  if (item.followUpStatus === "waiting_purchase") return "Menunggu pembelian komponen";
  if (item.followUpStatus === "waiting_vendor") return "Menunggu vendor eksternal";
  if (item.followUpStatus === "asset_temporarily_unusable")
    return "Asset ditandai tidak layak pakai sementara";
  if (item.needsQhseReview || item.followUpStatus === "waiting_qhse_decision") {
    return "Menunggu Keputusan QHSE";
  }
  return null;
}

// Mapping label + warna badge status utama (section H) — dipakai untuk
// badge di header item (ringkas, satu badge) DAN sebagai judul panel
// keputusan QHSE (lebih detail). Beda dengan getFindingStatusLabel di atas
// yang menambahkan info ticket number untuk corrective_task_created.
const FINDING_STATUS_META: Record<string, { label: string; colorClass: string }> = {
  waiting_qhse_decision: { label: "Menunggu Keputusan QHSE", colorClass: "bg-amber-100 text-amber-700" },
  noted: { label: "Temuan Dicatat QHSE", colorClass: "bg-emerald-100 text-emerald-700" },
  recheck_requested: { label: "Cek Ulang Diminta QHSE", colorClass: "bg-blue-100 text-blue-700" },
  corrective_task_created: { label: "Tugas Korektif Dibuat", colorClass: "bg-orange-100 text-orange-700" },
  waiting_purchase: { label: "Menunggu Pembelian", colorClass: "bg-amber-100 text-amber-700" },
  waiting_vendor: { label: "Menunggu Vendor", colorClass: "bg-purple-100 text-purple-700" },
  asset_temporarily_unusable: {
    label: "Asset Tidak Layak Pakai Sementara",
    colorClass: "bg-red-100 text-red-700",
  },
};

function getFindingStatusMeta(
  item: MaintenanceWorkOrderItem
): { label: string; colorClass: string } | null {
  // Hasil cek ulang yang baru dikirim tetap followUpStatus
  // "waiting_qhse_decision" seperti temuan biasa — bedakan labelnya supaya
  // QHSE tahu ini putaran cek ulang, bukan temuan baru (section F).
  if (item.followUpStatus === "waiting_qhse_decision" && item.recheckSubmittedAt) {
    return { label: "Hasil Cek Ulang Dikirim", colorClass: "bg-amber-100 text-amber-700" };
  }
  if (item.followUpStatus && FINDING_STATUS_META[item.followUpStatus]) {
    return FINDING_STATUS_META[item.followUpStatus];
  }
  if (item.needsQhseReview) return FINDING_STATUS_META.waiting_qhse_decision;
  return null;
}

// Item butuh panel keputusan QHSE kalau sedang menunggu ATAU sudah pernah
// diputuskan (supaya QHSE tetap bisa "Minta Cek Ulang"/"Ubah Keputusan"
// walau statusnya sudah final — lihat acceptance #7).
const QHSE_PANEL_STATUSES = [
  "waiting_qhse_decision",
  "noted",
  "recheck_requested",
  "waiting_purchase",
  "waiting_vendor",
  "asset_temporarily_unusable",
  "corrective_task_created",
];

function needsQhsePanel(item: MaintenanceWorkOrderItem): boolean {
  return !!item.needsQhseReview || (!!item.followUpStatus && QHSE_PANEL_STATUSES.includes(item.followUpStatus));
}

interface MaintenanceItemReportSummary {
  assetId: string;
  assetCode: string;
  assetName: string;
  conditionBefore: string;
  conditionAfter: string;
  actionTaken: string;
  technicianNote: string;
  needsQhseReview: boolean;
  followUpStatus: string | null;
}

interface MaintenanceReportSummary {
  totalAssets: number;
  checkedCount: number;
  goodCount: number;
  findingCount: number;
  waitingQhseDecisionCount: number;
  itemSummaries: MaintenanceItemReportSummary[];
}

// Merangkum semua hasil cek per-device jadi satu laporan siap kirim ke QHSE
// — dipakai baik untuk rekap di modal "Kirim Laporan" maupun disimpan ke
// reportData di parent work order (item.status di codebase ini tidak punya
// nilai "completed"/boolean checked, jadi "checked" dianggap = statusnya
// bukan lagi pending/in_progress, sama seperti checkedCount di modal ini).
function buildMaintenanceReportSummary(items: MaintenanceWorkOrderItem[]): MaintenanceReportSummary {
  const totalAssets = items.length;

  const checkedAssets = items.filter(
    (item) => item.status !== "pending" && item.status !== "in_progress"
  );

  const assetsWithFindings = items.filter(
    (item) =>
      item.needsQhseReview === true ||
      !!item.findingNote ||
      !!item.technicianNote ||
      (!!item.actionTaken && item.actionTaken !== "no_action")
  );

  const waitingQhseDecision = items.filter(
    (item) => item.needsQhseReview === true && item.followUpStatus === "waiting_qhse_decision"
  );

  const goodAssets = items.filter(
    (item) => !item.needsQhseReview && (item.actionTaken === "no_action" || !item.actionTaken)
  );

  return {
    totalAssets,
    checkedCount: checkedAssets.length,
    goodCount: goodAssets.length,
    findingCount: assetsWithFindings.length,
    waitingQhseDecisionCount: waitingQhseDecision.length,
    itemSummaries: items.map((item) => ({
      assetId: item.assetId,
      assetCode: item.assetCode,
      assetName: item.assetName,
      conditionBefore: item.conditionBefore || "-",
      conditionAfter: item.conditionAfter || "-",
      actionTaken: (item.actionTaken && ACTION_LABELS[item.actionTaken]) || item.actionLabel || item.actionTaken || "-",
      technicianNote: item.technicianNote || item.findingNote || item.technicalNote || "-",
      needsQhseReview: item.needsQhseReview === true,
      followUpStatus: item.followUpStatus || null,
    })),
  };
}

// Teks ringkasan otomatis (section F) — ditampilkan di modal konfirmasi
// sekaligus disimpan sebagai reportSummary di parent work order.
function buildReportSummaryText(technicianName: string, summary: MaintenanceReportSummary): string {
  const lines = [
    `Laporan maintenance telah dikirim oleh ${technicianName || "Tim IT"}.`,
    `Total asset dicek: ${summary.totalAssets}.`,
    `Asset kondisi baik: ${summary.goodCount}.`,
    `Asset dengan temuan: ${summary.findingCount}.`,
    `Menunggu keputusan QHSE: ${summary.waitingQhseDecisionCount}.`,
  ];

  const findings = summary.itemSummaries.filter(
    (i) => i.needsQhseReview || (i.technicianNote && i.technicianNote !== "-")
  );
  if (findings.length > 0) {
    lines.push("");
    lines.push("Temuan penting:");
    findings.forEach((f, index) => {
      lines.push(`${index + 1}. ${f.assetName} - ${f.actionTaken} - ${f.technicianNote}`);
    });
  }

  return lines.join("\n");
}

// ── Lock form hasil cek Tim IT setelah temuan dikirim ke QHSE ────────────
// isFindingLocked = menunggu keputusan (form dikunci total).
// isFindingFinal = QHSE sudah memutuskan sesuatu yang final (juga dikunci —
// kalau butuh direvisi, jalurnya adalah QHSE pilih "Minta Cek Ulang", bukan
// Tim IT edit langsung).
function isFindingLocked(item: MaintenanceWorkOrderItem): boolean {
  return item.needsQhseReview === true && item.followUpStatus === "waiting_qhse_decision";
}

function isFindingFinal(item: MaintenanceWorkOrderItem): boolean {
  return !!item.followUpStatus &&
    (
      [
        "noted",
        "corrective_task_created",
        "waiting_purchase",
        "waiting_vendor",
        "asset_temporarily_unusable",
      ] as string[]
    ).includes(item.followUpStatus);
}

// Satu-satunya sumber kebenaran untuk "boleh edit form hasil cek atau tidak"
// — dipakai baik untuk disable UI (defense in depth) MAUPUN sebagai guard di
// dalam setiap handler submit, supaya data tetap aman walau ada bug di UI
// yang lupa nge-disable sesuatu.
function canEditMaintenanceCheck(
  item: MaintenanceWorkOrderItem,
  currentAssetUser?: { role?: string } | null
): boolean {
  if (currentAssetUser?.role !== "it_team") return false;

  // Temuan sudah dikirim ke QHSE, menunggu keputusan — kunci.
  if (isFindingLocked(item)) return false;

  // QHSE sudah memutuskan final — kunci (revisi lewat "Minta Cek Ulang").
  if (isFindingFinal(item)) return false;

  // QHSE minta cek ulang — boleh edit lagi.
  if (item.followUpStatus === "recheck_requested") return true;

  // Normal saat sedang dikerjakan.
  return ["in_progress", "checking", "sedang_dicek"].includes(item.status);
}

async function debugFirestoreWrite<T>(label: string, action: () => Promise<T>): Promise<T> {
  try {
    console.log(`[Reset Checklist Write] START ${label}`);
    const result = await action();
    console.log(`[Reset Checklist Write] SUCCESS ${label}`);
    return result;
  } catch (error) {
    console.error(`[Reset Checklist Write] ERROR ${label}`, error);
    throw error;
  }
}

export default function WorkOrderDetailModal({
  workOrder: initialWorkOrder,
  open,
  onClose,
}: {
  workOrder: MaintenanceWorkOrder;
  open: boolean;
  onClose: () => void;
}) {
  const { firebaseUser, assetUser, role, loading } = useAuth();
  const authReady = !loading && !!firebaseUser && !!assetUser && !!role;
  const [workOrder, setWorkOrder] = useState(initialWorkOrder);
  const [items, setItems] = useState<MaintenanceWorkOrderItem[]>([]);
  const [logs, setLogs] = useState<MaintenanceWorkOrderLog[]>([]);
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [conditionBefore, setConditionBefore] = useState<MaintenanceConditionLabel>("Baik");
  const [conditionAfter, setConditionAfter] = useState<MaintenanceConditionLabel>("Baik");
  const [checklist, setChecklist] = useState<MaintenanceChecklistState>(DEFAULT_CHECKLIST);
  const [actionTaken, setActionTaken] = useState<MaintenanceActionTaken | "">("");
  const [technicianNote, setTechnicianNote] = useState("");
  const [itemFormError, setItemFormError] = useState("");
  const [existingTicketsById, setExistingTicketsById] = useState<
    Record<string, AssetIssueTicket | null>
  >({});
  const [pendingTicketResetItem, setPendingTicketResetItem] = useState<MaintenanceWorkOrderItem | null>(
    null
  );
  const [ticketResetReason, setTicketResetReason] = useState("");
  const [ticketResetError, setTicketResetError] = useState("");
  const [ticketResetSaving, setTicketResetSaving] = useState(false);
  const [resetChecklistClearTickets, setResetChecklistClearTickets] = useState(false);

  // ── Modal keputusan QHSE atas temuan Tim IT ───────────────────────────────
  // kind === null hanya berlaku saat "Tindak Lanjuti" baru diklik (masih
  // menampilkan 4 pilihan sub-keputusan); begitu salah satu dipilih, kind
  // terisi dan form detailnya muncul. "request_recheck" langsung membuka
  // modal ini dengan kind terisi (skip pemilihan).
  const [qhseDecisionItem, setQhseDecisionItem] = useState<MaintenanceWorkOrderItem | null>(null);
  const [qhseDecisionKind, setQhseDecisionKind] = useState<QhseFollowUpDecisionKind | null>(null);
  const [qhseDecisionNote, setQhseDecisionNote] = useState("");
  const [qhseDecisionError, setQhseDecisionError] = useState("");
  const [qhseDecisionSaving, setQhseDecisionSaving] = useState(false);
  const [qhseSelectedItUid, setQhseSelectedItUid] = useState("");
  const [qhsePurchaseDetail, setQhsePurchaseDetail] = useState("");
  const [qhseVendorNote, setQhseVendorNote] = useState("");
  const [qhseConfirmUnusable, setQhseConfirmUnusable] = useState(false);
  const [itTeamOptions, setItTeamOptions] = useState<AssetUser[]>([]);

  const closeQhseDecisionModal = () => {
    setQhseDecisionItem(null);
    setQhseDecisionKind(null);
    setQhseDecisionNote("");
    setQhseDecisionError("");
    setQhseSelectedItUid("");
    setQhsePurchaseDetail("");
    setQhseVendorNote("");
    setQhseConfirmUnusable(false);
  };

  useEffect(() => {
    if (qhseDecisionKind !== "create_corrective_task") return;
    let cancelled = false;
    fetchActiveUsersByRole("it_team")
      .then((users) => {
        if (!cancelled) setItTeamOptions(users);
      })
      .catch((error) => {
        console.error("[Work Order] gagal memuat daftar Tim IT", error);
      });
    return () => {
      cancelled = true;
    };
  }, [qhseDecisionKind]);

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

  // Modal "Kirim Laporan Maintenance ke QHSE" — rekap otomatis semua item +
  // kesimpulan/rekomendasi Tim IT, dibuka dari tombol "Kirim Laporan"
  // (bukan langsung submit).
  const [submitReportModalOpen, setSubmitReportModalOpen] = useState(false);
  const [reportConclusion, setReportConclusion] = useState("");
  const [reportRecommendation, setReportRecommendation] = useState("");
  const [reportConfirmChecked, setReportConfirmChecked] = useState(false);
  const [reportModalError, setReportModalError] = useState("");

  const [testingMenuOpen, setTestingMenuOpen] = useState(false);
  const [pendingTestingOption, setPendingTestingOption] = useState<TestingStatusOption | null>(null);
  const [testingReason, setTestingReason] = useState("");
  const [testingError, setTestingError] = useState("");

  useEffect(() => {
    if (!open || !authReady) return;
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
  }, [open, authReady, initialWorkOrder.id]);

  useEffect(() => {
    if (!open || !authReady) return;
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
  }, [open, authReady, initialWorkOrder.id]);

  // Activity log mini — 5 aktivitas terakhir untuk work order ini.
  useEffect(() => {
    if (!open || !authReady) return;
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
  }, [open, authReady, initialWorkOrder.id]);

  const checkedCount = useMemo(
    () => items.filter((i) => i.status !== "pending" && i.status !== "in_progress").length,
    [items]
  );
  const progressPercent = items.length > 0 ? Math.round((checkedCount / items.length) * 100) : 0;

  // Badge "Ticket TKT-xxx dibuat" TIDAK boleh hanya mengandalkan
  // followUpTicketId/Number di item — dokumen ticket-nya bisa saja sudah
  // dihapus manual (mis. saat mengulang alur testing). Fetch dulu tiap
  // ticket yang direferensikan, baru tentukan badge-nya nanti (lihat
  // getTicketBadgeState). Sebelum fetch selesai, existingTicketsById[id]
  // sengaja undefined supaya badge TIDAK sempat tampil "aktif" duluan.
  const followUpTicketIds = useMemo(
    () =>
      Array.from(
        new Set(items.map((i) => i.followUpTicketId).filter((id): id is string => !!id))
      ),
    [items]
  );

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      followUpTicketIds.map(async (id) => {
        const snap = await getDoc(doc(db, "asset_issue_tickets", id));
        return [id, snap.exists() ? ({ id: snap.id, ...snap.data() } as AssetIssueTicket) : null] as const;
      })
    )
      .then((results) => {
        if (cancelled) return;
        setExistingTicketsById(Object.fromEntries(results));
      })
      .catch((error) => {
        console.error("[Work Order] gagal memverifikasi ticket lanjutan", error);
      });
    return () => {
      cancelled = true;
    };
  }, [followUpTicketIds]);

  if (!open) return null;

  const currentAssetUser = assetUser ? { role: assetUser.role } : null;
  const { isSuperAdminRole, isAssetAdminRole, isItTeamRole, canManageSchedule } =
    getAssetRoleHelpers(currentAssetUser);
  const assignedMaintenanceRole = getAssignedMaintenanceRole(workOrder.assignedToRole);
  const workOrderTabQuery = workOrder.taskCategory === "corrective" ? "my-tasks" : "routine";
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
  // Progress 100% = syarat sebelum tombol "Kirim Laporan" bisa dipakai
  // (lihat modal konfirmasi — bukan langsung submit saat diklik).
  const progressComplete = items.length > 0 && checkedCount === items.length;
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

  // Dipanggil HANYA dari modal "Kirim Laporan Maintenance ke QHSE" (lihat
  // submitReportModalOpen) — validasi sudah dilakukan oleh caller, di sini
  // cukup menyimpan rekap + kesimpulan/rekomendasi Tim IT.
  const handleSubmitReport = async (conclusion: string, recommendation: string) => {
    setSaving(true);
    try {
      const performerUid = assetUser?.uid || "";
      const performerName = assetUser?.name || "";
      const reportData = buildMaintenanceReportSummary(items);
      const reportSummaryText = buildReportSummaryText(performerName, reportData);
      const hasAnyFinding = items.some((i) => !!i.needsQhseReview);

      await updateDoc(
        woRef,
        cleanFirestoreData({
          status: "report_submitted",
          reportSubmittedAt: serverTimestamp(),
          reportSubmittedByUid: performerUid,
          reportSubmittedByName: performerName,
          reportSummary: reportSummaryText,
          reportConclusion: conclusion,
          reportRecommendation: recommendation || "",
          reportData: reportData as unknown as Record<string, unknown>,
          needsQhseReview: hasAnyFinding,
          lastActivityAt: serverTimestamp(),
          lastActivityByUid: performerUid,
          lastActivityByName: performerName,
          lastActivityMessage: "Tim IT mengirim laporan maintenance ke QHSE.",
          updatedAt: serverTimestamp(),
          updatedByUid: performerUid,
          updatedByName: performerName,
        }) as Record<string, unknown>
      );

      // Semua item yang masih "Sedang Dicek" otomatis jadi "Sudah Dicek" saat
      // laporan dikirim — item yang sudah "needs_follow_up"/"skipped" tidak
      // disentuh (statusnya sudah final, bukan "belum selesai dicek"). Data
      // per-device TETAP tersimpan di subcollection items, laporan ini hanya
      // menambahkan ringkasan di level parent work order.
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
        performedByUid: performerUid,
        performedByName: performerName,
      });
      if (workOrder.requestedByUid) {
        const extraSentence = hasAnyFinding
          ? ` ${reportData.waitingQhseDecisionCount} temuan menunggu keputusan QHSE.`
          : "";
        await createAssetNotification({
          recipientUid: workOrder.requestedByUid,
          recipientName: workOrder.requestedByName,
          recipientRole: "asset_admin",
          title: "Laporan Maintenance Dikirim",
          message: `${performerName} mengirim laporan maintenance ${workOrder.workOrderNumber}. Total ${reportData.totalAssets} asset dicek, ${reportData.findingCount} asset memiliki temuan.${extraSentence}`,
          type: "work_order_report_submitted",
          priority: hasAnyFinding ? "high" : workOrder.priority,
          linkUrl: `/maintenance?tab=routine&workOrderId=${workOrder.id}`,
          relatedType: "work_order",
          relatedId: workOrder.id,
          relatedNumber: workOrder.workOrderNumber,
          createdByUid: performerUid,
          createdByName: performerName,
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
          linkUrl: `/maintenance?tab=history&workOrderId=${workOrder.id}`,
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
      if (workOrder.assignedToUid) {
        await createAssetNotification({
          recipientUid: workOrder.assignedToUid,
          recipientName: workOrder.assignedToName || "",
          recipientRole: "super_admin",
          title: "Maintenance Dibatalkan",
          message: `Jadwal maintenance ${workOrder.title} dibatalkan oleh QHSE.`,
          type: "work_order_completed",
          priority: workOrder.priority,
          linkUrl: `/maintenance?tab=history&workOrderId=${workOrder.id}`,
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
        linkUrl: `/maintenance?tab=${workOrderTabQuery}&workOrderId=${workOrder.id}`,
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
        linkUrl: `/maintenance?tab=${isQhse ? workOrderTabQuery : "routine"}&workOrderId=${workOrder.id}`,
        relatedType: "work_order",
        relatedId: workOrder.id,
        relatedNumber: workOrder.workOrderNumber,
        createdByUid: assetUser?.uid,
        createdByName: assetUser?.name,
      });
    }
  };

  // Dipakai untuk "Buat Ulang Pengecekan" (dari completed) — reset status
  // item ke pending TANPA menghapus findings/actionTaken/technicianNote lama
  // (history tetap ada).
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

  // "Reset Checklist Asset" (dari in_progress) — BEDA dari "Buat Ulang
  // Pengecekan" di atas: di sini checklist/tindakan/catatan tiap item
  // BENAR-BENAR dikembalikan ke kondisi awal (bukan cuma status), supaya
  // progress kembali 0% dan teknisi mengisi ulang dari nol. Setiap write
  // dibungkus debugFirestoreWrite supaya kalau Firestore rules menolak field
  // tertentu, errornya jelas kelihatan di console alih-alih tombol stuck
  // tanpa penjelasan.
  const handleResetChecklistInProgress = async (reason: string, clearFollowUpTickets: boolean) => {
    const performerUid = assetUser?.uid || firebaseUser?.uid || "";
    const performerName = assetUser?.name || firebaseUser?.displayName || firebaseUser?.email || "Tim IT";

    console.log("[Reset Checklist] START", { workOrderId: workOrder.id, reason, clearFollowUpTickets });

    await debugFirestoreWrite("reset work order item checklist", async () => {
      const batch = writeBatch(db);
      items.forEach((item) => {
        const itemRef = doc(db, "asset_maintenance_work_orders", workOrder.id, "items", item.id);
        batch.update(
          itemRef,
          cleanFirestoreData({
            status: "pending",
            checklist: DEFAULT_CHECKLIST,
            actionTaken: null,
            technicianNote: "",
            findings: "",
            checkedByUid: null,
            checkedByName: null,
            checkedAt: null,
            ...(clearFollowUpTickets && item.followUpTicketId
              ? {
                  followUpTicketId: null,
                  followUpTicketNumber: null,
                  resetFollowUpTicketAt: serverTimestamp(),
                  resetFollowUpTicketByUid: performerUid,
                  resetFollowUpTicketByName: performerName,
                  resetFollowUpTicketReason: `Dibersihkan bersamaan reset checklist. Alasan: ${reason}`,
                }
              : {}),
            updatedAt: serverTimestamp(),
          }) as Record<string, unknown>
        );
      });
      return batch.commit();
    });

    await debugFirestoreWrite("update parent work order after checklist reset", async () => {
      return updateDoc(
        woRef,
        cleanFirestoreData({
          status: "in_progress",
          retryCount: (workOrder.retryCount || 0) + 1,
          checklistResetAt: serverTimestamp(),
          checklistResetByUid: performerUid,
          checklistResetByName: performerName,
          checklistResetReason: reason,
          updatedAt: serverTimestamp(),
          updatedByUid: performerUid,
          updatedByName: performerName,
        }) as Record<string, unknown>
      );
    });

    await debugFirestoreWrite("create reset checklist work order log", async () => {
      return writeWorkOrderLog({
        workOrderId: workOrder.id,
        workOrderNumber: workOrder.workOrderNumber,
        action: "retry_checklist",
        oldStatus: workOrder.status,
        newStatus: "in_progress",
        note: `Checklist asset di-reset. Alasan: ${reason}`,
        performedByUid: performerUid,
        performedByName: performerName,
      });
    });

    const clearedTicketItems = clearFollowUpTickets
      ? items.filter((item) => !!item.followUpTicketId)
      : [];
    if (clearedTicketItems.length > 0) {
      await debugFirestoreWrite("create reset follow-up ticket work order log", async () => {
        return writeWorkOrderLog({
          workOrderId: workOrder.id,
          workOrderNumber: workOrder.workOrderNumber,
          action: "reset_follow_up_ticket",
          note: `Ticket lanjutan di-reset oleh admin bersamaan reset checklist (${clearedTicketItems
            .map((i) => i.assetName)
            .join(", ")}). Alasan: ${reason}`,
          performedByUid: performerUid,
          performedByName: performerName,
        });
      });
    }
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
    setResetChecklistClearTickets(false);
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
          await handleResetChecklistInProgress(reason, resetChecklistClearTickets);
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
    setActionTaken(item.actionTaken || "");
    setTechnicianNote(item.technicianNote || item.findings || "");
    setItemFormError("");
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
    // Guard di dalam handler, bukan cuma disable UI — supaya data tetap aman
    // walau ada bug di UI yang lupa nge-disable tombol/lupa mengunci form.
    if (!canEditMaintenanceCheck(item, currentAssetUser)) {
      setItemFormError("Temuan sudah dikirim ke QHSE. Menunggu keputusan QHSE.");
      return;
    }
    const allChecked = CHECKLIST_LABELS.every(({ key }) => checklist[key]);
    const actionNeedsNote = !!actionTaken && actionTaken !== "no_action";
    if ((!allChecked || actionNeedsNote) && !technicianNote.trim()) {
      setItemFormError(
        actionNeedsNote
          ? `Tindakan "${ACTION_LABELS[actionTaken as MaintenanceActionTaken]}" wajib disertai catatan di "Temuan / Catatan Teknisi".`
          : 'Ada checklist yang belum dicentang — isi dulu "Temuan / Catatan Teknisi".'
      );
      return;
    }
    setItemFormError("");
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
      const isRecheck = item.followUpStatus === "recheck_requested";
      await updateDoc(
        itemRef,
        cleanFirestoreData({
          status: newItemStatus,
          conditionBefore,
          conditionAfter,
          checklist,
          // technicianNote = satu-satunya field yang diisi di UI ("Temuan /
          // Catatan Teknisi") — findings dipertahankan sebagai alias untuk
          // kompatibilitas data lama yang masih membaca field ini.
          technicianNote,
          findings: technicianNote,
          actionTaken: actionTaken || null,
          checkedByUid: assetUser?.uid || "",
          checkedByName: assetUser?.name || "",
          checkedAt: serverTimestamp(),
          // Simpan draft hasil cek ulang TANPA mengubah followUpStatus —
          // masih "recheck_requested" sampai Tim IT klik "Kirim Hasil Cek
          // Ulang ke QHSE" (lihat handleSubmitRecheckResult).
          ...(isRecheck
            ? {
                recheckSavedAt: serverTimestamp(),
                recheckSavedByUid: assetUser?.uid || "",
                recheckSavedByName: assetUser?.name || "",
              }
            : {}),
          updatedAt: serverTimestamp(),
        }) as Record<string, unknown>
      );
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

  // Tim IT TIDAK boleh lagi bikin ticket kendala untuk dirinya sendiri (alur
  // muter: IT lapor → ticket dibuat → balik ke IT lagi). Tim IT hanya
  // melaporkan temuan ke QHSE lewat handleReportFindingToQhse di bawah. QHSE
  // yang memutuskan tindak lanjutnya lewat salah satu handler di bawah ini —
  // dipanggil dari modal keputusan (qhseDecisionItem/qhseDecisionKind).

  // 1. Cukup Dicatat — tidak ada ticket, tidak ada assignment baru.
  const handleQhseMarkNoted = async (item: MaintenanceWorkOrderItem) => {
    setSaving(true);
    try {
      const qhseUid = assetUser?.uid || "";
      const qhseName = assetUser?.name || "";
      const itemRef = doc(db, "asset_maintenance_work_orders", workOrder.id, "items", item.id);
      await updateDoc(
        itemRef,
        cleanFirestoreData({
          followUpStatus: "noted",
          needsQhseReview: false,
          qhseDecision: "noted",
          qhseDecisionLabel: "Cukup Dicatat",
          qhseDecisionByUid: qhseUid,
          qhseDecisionByName: qhseName,
          qhseDecisionAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }) as Record<string, unknown>
      );
      await writeWorkOrderLog({
        workOrderId: workOrder.id,
        workOrderNumber: workOrder.workOrderNumber,
        action: "qhse_finding_decision",
        note: `Temuan dicatat QHSE (${item.assetName}) — tidak ada tindak lanjut lebih jauh`,
        performedByUid: qhseUid,
        performedByName: qhseName,
      });
    } finally {
      setSaving(false);
    }
  };

  // 2. Minta Cek Ulang ke Tim IT — item & work order kembali "in_progress",
  // notifikasi ke Tim IT yang mengerjakan, catatan revisi WAJIB.
  const handleQhseRequestRecheck = async (item: MaintenanceWorkOrderItem, note: string) => {
    setSaving(true);
    try {
      const qhseUid = assetUser?.uid || "";
      const qhseName = assetUser?.name || "";
      const itemRef = doc(db, "asset_maintenance_work_orders", workOrder.id, "items", item.id);
      await updateDoc(
        itemRef,
        cleanFirestoreData({
          status: "in_progress",
          followUpStatus: "recheck_requested",
          needsQhseReview: false,
          qhseDecision: "request_recheck",
          qhseDecisionLabel: "Minta Cek Ulang",
          qhseDecisionNote: note,
          qhseDecisionByUid: qhseUid,
          qhseDecisionByName: qhseName,
          qhseDecisionAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }) as Record<string, unknown>
      );

      // needsQhseReview di parent hanya boleh jadi false kalau TIDAK ada item
      // lain (selain item ini) yang masih menunggu keputusan QHSE.
      const stillWaiting = items.some(
        (i) => i.id !== item.id && i.needsQhseReview && i.followUpStatus === "waiting_qhse_decision"
      );

      await updateDoc(
        woRef,
        cleanFirestoreData({
          status: "in_progress",
          needsQhseReview: stillWaiting,
          lastActivityMessage: "QHSE meminta Tim IT melakukan cek ulang.",
          updatedAt: serverTimestamp(),
          updatedByUid: qhseUid,
          updatedByName: qhseName,
        }) as Record<string, unknown>
      );
      await writeWorkOrderLog({
        workOrderId: workOrder.id,
        workOrderNumber: workOrder.workOrderNumber,
        action: "qhse_finding_decision",
        note: `QHSE (${qhseName}) minta cek ulang pada ${item.assetName}. Catatan: ${note}`,
        performedByUid: qhseUid,
        performedByName: qhseName,
      });

      if (workOrder.assignedToUid) {
        await createAssetNotification({
          recipientUid: workOrder.assignedToUid,
          recipientName: workOrder.assignedToName || "",
          recipientRole: assignedMaintenanceRole,
          title: "QHSE Meminta Cek Ulang",
          message: `QHSE meminta Anda melakukan cek ulang pada asset ${item.assetName}. Catatan: ${note}`,
          type: "maintenance_finding_decided",
          priority: "medium",
          linkUrl: `/maintenance?tab=routine&workOrderId=${workOrder.id}`,
          relatedType: "work_order",
          relatedId: workOrder.id,
          relatedNumber: workOrder.workOrderNumber,
          createdByUid: qhseUid,
          createdByName: qhseName,
        });
      }
    } finally {
      setSaving(false);
    }
  };

  // 3. Buat Tugas Korektif IT — SATU-SATUNYA tempat ticket dibuat dari
  // temuan maintenance, dan hanya QHSE yang bisa memicunya.
  const handleQhseCreateCorrectiveTask = async (
    item: MaintenanceWorkOrderItem,
    note: string,
    selectedItUid: string
  ) => {
    setSaving(true);
    try {
      const qhseUid = assetUser?.uid || "";
      const qhseName = assetUser?.name || "";
      const technicianUid = workOrder.assignedToUid || "";
      const technicianName = workOrder.assignedToName || "";
      const selectedIt = itTeamOptions.find((u) => u.uid === selectedItUid);

      const ticketNumber = await generateTicketNumber();
      const queueNumber = await generateQueueNumber();
      const ticketRef = await addDoc(
        collection(db, "asset_issue_tickets"),
        cleanFirestoreData({
          ticketNumber,
          queueNumber,
          assetId: item.assetId,
          assetName: item.assetName,
          assetCode: item.assetCode,
          assetCategory: item.assetCategory || "",
          assetLocation: item.assetLocation || "",
          reportedByUid: technicianUid,
          reportedByName: technicianName,
          reportedByEmail: workOrder.assignedToEmail || "",
          reportedAt: serverTimestamp(),
          symptomType: "Lainnya",
          impactLevel: item.findingSeverity === "urgent" ? "Darurat" : "Mengganggu Pekerjaan",
          description: note || item.findingNote || item.technicianNote || "Temuan dari Work Order Maintenance",
          priority: item.findingSeverity === "urgent" ? "high" : "medium",
          status: "assigned",
          statusLabel: "Menunggu Tim Terkait",
          assignedToUid: selectedIt?.uid || null,
          assignedToName: selectedIt?.name || null,
          assignedAt: selectedIt ? serverTimestamp() : null,
          source: "maintenance_finding",
          sourceWorkOrderId: workOrder.id,
          sourceWorkOrderNumber: workOrder.workOrderNumber,
          sourceItemId: item.id,
          sourceAssetId: item.assetId,
          workOrderId: workOrder.id,
          workOrderNumber: workOrder.workOrderNumber,
          workOrderItemId: item.id,
          createdByUid: qhseUid,
          createdByName: qhseName,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }) as Record<string, unknown>
      );
      await writeAssetIssueLog({
        ticketId: ticketRef.id,
        ticketNumber,
        action: "create_ticket",
        newStatus: "assigned",
        note: `Dibuat oleh QHSE (${qhseName}) dari temuan Work Order ${workOrder.workOrderNumber}. Catatan: ${note}`,
        performedByUid: qhseUid,
        performedByName: qhseName,
      });

      const itemRef = doc(db, "asset_maintenance_work_orders", workOrder.id, "items", item.id);
      await updateDoc(
        itemRef,
        cleanFirestoreData({
          followUpTicketId: ticketRef.id,
          followUpTicketNumber: ticketNumber,
          followUpStatus: "corrective_task_created",
          needsQhseReview: false,
          correctiveAssignedToUid: selectedIt?.uid || null,
          correctiveAssignedToName: selectedIt?.name || null,
          qhseDecision: "create_corrective_task",
          qhseDecisionLabel: QHSE_FOLLOW_UP_DECISION_LABELS.create_corrective_task,
          qhseDecisionNote: note,
          qhseDecisionByUid: qhseUid,
          qhseDecisionByName: qhseName,
          qhseDecisionAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }) as Record<string, unknown>
      );

      await writeWorkOrderLog({
        workOrderId: workOrder.id,
        workOrderNumber: workOrder.workOrderNumber,
        action: "qhse_finding_decision",
        note: `QHSE (${qhseName}) membuat tugas korektif ${ticketNumber} dari temuan ${item.assetName}${
          selectedIt ? ` untuk ${selectedIt.name}` : ""
        }. Catatan: ${note}`,
        performedByUid: qhseUid,
        performedByName: qhseName,
      });

      if (selectedIt) {
        await createAssetNotification({
          recipientUid: selectedIt.uid,
          recipientName: selectedIt.name || "",
          recipientRole: "it_team",
          title: "Tugas Korektif Baru dari Temuan Maintenance",
          message: `QHSE menugaskan Anda menangani ${item.assetName} (${ticketNumber}). Catatan: ${note}`,
          type: "maintenance_finding_decided",
          priority: item.findingSeverity === "urgent" ? "urgent" : "medium",
          linkUrl: `/maintenance?tab=technician-queue&ticketId=${ticketRef.id}`,
          relatedType: "ticket",
          relatedId: ticketRef.id,
          relatedNumber: ticketNumber,
          createdByUid: qhseUid,
          createdByName: qhseName,
        });
      }
    } finally {
      setSaving(false);
    }
  };

  // 4 & 5. Ajukan Pembelian Komponen / Butuh Vendor Eksternal — TIDAK
  // membuat ticket dan TIDAK assign ke Tim IT sebagai tugas aktif, cuma
  // dicatat + notifikasi QHSE/Admin/Super Admin lain supaya bisa ditindak.
  const handleQhseRequestPurchaseOrVendor = async (
    item: MaintenanceWorkOrderItem,
    kind: "need_purchase" | "need_vendor",
    note: string
  ) => {
    setSaving(true);
    try {
      const qhseUid = assetUser?.uid || "";
      const qhseName = assetUser?.name || "";
      const followUpStatus = kind === "need_purchase" ? "waiting_purchase" : "waiting_vendor";
      const itemRef = doc(db, "asset_maintenance_work_orders", workOrder.id, "items", item.id);
      await updateDoc(
        itemRef,
        cleanFirestoreData({
          followUpStatus,
          needsQhseReview: false,
          purchaseDetail: kind === "need_purchase" ? note : null,
          vendorNote: kind === "need_vendor" ? note : null,
          qhseDecision: kind,
          qhseDecisionLabel: QHSE_FOLLOW_UP_DECISION_LABELS[kind],
          qhseDecisionNote: note,
          qhseDecisionByUid: qhseUid,
          qhseDecisionByName: qhseName,
          qhseDecisionAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }) as Record<string, unknown>
      );
      await writeWorkOrderLog({
        workOrderId: workOrder.id,
        workOrderNumber: workOrder.workOrderNumber,
        action: "qhse_finding_decision",
        note: `QHSE (${qhseName}) menandai ${item.assetName} ${
          kind === "need_purchase" ? "butuh pembelian komponen" : "butuh vendor eksternal"
        }. Catatan: ${note}`,
        performedByUid: qhseUid,
        performedByName: qhseName,
      });

      const otherQhse = await fetchActiveUsersByRole("asset_admin");
      const superAdmins = await fetchActiveUsersByRole("super_admin");
      const recipients = [...otherQhse, ...superAdmins].filter((u) => u.uid !== qhseUid);
      await Promise.all(
        recipients.map((r) =>
          createAssetNotification({
            recipientUid: r.uid,
            recipientName: r.name || "",
            recipientRole: r.role,
            title: "Keputusan QHSE atas Temuan",
            message: `${item.assetName} pada maintenance ${workOrder.title} ${
              kind === "need_purchase" ? "butuh pembelian komponen" : "butuh vendor eksternal"
            }. Catatan: ${note}`,
            type: "maintenance_finding_decided",
            priority: item.findingSeverity === "urgent" ? "urgent" : "medium",
            linkUrl: `/maintenance?tab=follow-up&workOrderId=${workOrder.id}`,
            relatedType: "work_order",
            relatedId: workOrder.id,
            relatedNumber: workOrder.workOrderNumber,
            createdByUid: qhseUid,
            createdByName: qhseName,
          })
        )
      );
    } finally {
      setSaving(false);
    }
  };

  // 6. Tandai Asset Tidak Layak Pakai Sementara — asset ikut diupdate supaya
  // tidak bisa dipinjam sampai QHSE lanjut memilih vendor/pembelian/tugas IT.
  const handleQhseMarkAssetUnusable = async (item: MaintenanceWorkOrderItem, note: string) => {
    setSaving(true);
    try {
      const qhseUid = assetUser?.uid || "";
      const qhseName = assetUser?.name || "";
      const itemRef = doc(db, "asset_maintenance_work_orders", workOrder.id, "items", item.id);
      await updateDoc(
        itemRef,
        cleanFirestoreData({
          followUpStatus: "asset_temporarily_unusable",
          needsQhseReview: false,
          qhseDecision: "mark_temporarily_unusable",
          qhseDecisionLabel: QHSE_FOLLOW_UP_DECISION_LABELS.mark_temporarily_unusable,
          qhseDecisionNote: note,
          qhseDecisionByUid: qhseUid,
          qhseDecisionByName: qhseName,
          qhseDecisionAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        }) as Record<string, unknown>
      );

      const assetRef = doc(db, "assets", item.assetId);
      const assetSnap = await getDoc(assetRef);
      let responsiblePersonUid: string | undefined;
      let responsiblePersonName: string | undefined;
      if (assetSnap.exists()) {
        const assetData = assetSnap.data();
        responsiblePersonUid = assetData.responsiblePersonUid;
        responsiblePersonName = assetData.responsiblePersonName;
        await updateDoc(
          assetRef,
          cleanFirestoreData({
            assetStatus: "maintenance",
            condition: "heavy_damage",
            isBorrowable: false,
            updatedAt: serverTimestamp(),
          }) as Record<string, unknown>
        );
      }

      await writeWorkOrderLog({
        workOrderId: workOrder.id,
        workOrderNumber: workOrder.workOrderNumber,
        action: "qhse_finding_decision",
        note: `QHSE (${qhseName}) menandai ${item.assetName} tidak layak pakai sementara. Catatan: ${note}`,
        performedByUid: qhseUid,
        performedByName: qhseName,
      });

      const notifyRecipients: { uid: string; name: string; role: "asset_admin" | "staff" }[] = [];
      if (workOrder.requestedByUid && workOrder.requestedByUid !== qhseUid) {
        notifyRecipients.push({
          uid: workOrder.requestedByUid,
          name: workOrder.requestedByName,
          role: "asset_admin",
        });
      }
      if (responsiblePersonUid) {
        notifyRecipients.push({
          uid: responsiblePersonUid,
          name: responsiblePersonName || "",
          role: "staff",
        });
      }
      await Promise.all(
        notifyRecipients.map((r) =>
          createAssetNotification({
            recipientUid: r.uid,
            recipientName: r.name,
            recipientRole: r.role,
            title: "Keputusan QHSE atas Temuan",
            message: `${item.assetName} ditandai tidak layak pakai sementara oleh QHSE. Catatan: ${note}`,
            type: "maintenance_finding_decided",
            priority: "high",
            linkUrl: "/assets",
            relatedType: "asset",
            relatedId: item.assetId,
            createdByUid: qhseUid,
            createdByName: qhseName,
          })
        )
      );
    } finally {
      setSaving(false);
    }
  };

  // Tim IT melaporkan temuan ke QHSE — TIDAK create ticket sama sekali di
  // sini, cuma update flag review di item + parent work order, lalu
  // notifikasi QHSE yang membuat jadwal ini (workOrder.requestedByUid).
  // QHSE-lah yang nanti memutuskan lewat salah satu handleQhse* di atas.
  const handleReportFindingToQhse = async (item: MaintenanceWorkOrderItem) => {
    // Guard di dalam handler (defense in depth) — kalau item sudah terkunci
    // (menunggu keputusan QHSE atau sudah final), tolak walau tombolnya
    // entah kenapa masih ter-render aktif.
    if (!canEditMaintenanceCheck(item, currentAssetUser)) {
      setItemFormError("Temuan sudah dikirim ke QHSE. Menunggu keputusan QHSE.");
      return;
    }
    setSaving(true);
    try {
      const performerUid = assetUser?.uid || firebaseUser?.uid || "";
      const performerName =
        assetUser?.name || firebaseUser?.displayName || firebaseUser?.email || "Tim IT";
      const severity: "normal" | "urgent" =
        actionTaken && ["temporarily_unusable", "need_vendor"].includes(actionTaken)
          ? "urgent"
          : "normal";
      const actionLabel = actionTaken ? ACTION_LABELS[actionTaken] : "";

      const itemRef = doc(db, "asset_maintenance_work_orders", workOrder.id, "items", item.id);
      await updateDoc(
        itemRef,
        cleanFirestoreData({
          actionTaken: actionTaken || null,
          actionLabel,
          technicianNote,
          findingNote: technicianNote,
          technicalNote: technicianNote,
          needsQhseReview: true,
          followUpStatus: "waiting_qhse_decision",
          findingSeverity: severity,
          findingAction: actionTaken || null,
          reportedToQhseAt: serverTimestamp(),
          reportedToQhseByUid: performerUid,
          reportedToQhseByName: performerName,
          updatedAt: serverTimestamp(),
          updatedByUid: performerUid,
          updatedByName: performerName,
        }) as Record<string, unknown>
      );

      await updateDoc(
        woRef,
        cleanFirestoreData({
          hasFindings: true,
          needsQhseReview: true,
          followUpStatus: "waiting_qhse_decision",
          lastFindingAt: serverTimestamp(),
          lastFindingByUid: performerUid,
          lastFindingByName: performerName,
          lastActivityMessage: "Tim IT melaporkan temuan maintenance kepada QHSE.",
          updatedAt: serverTimestamp(),
          updatedByUid: performerUid,
          updatedByName: performerName,
        }) as Record<string, unknown>
      );

      await writeWorkOrderLog({
        workOrderId: workOrder.id,
        workOrderNumber: workOrder.workOrderNumber,
        action: "check_asset_item",
        note: `Temuan pada ${item.assetName} dilaporkan ke QHSE. Tindakan disarankan: ${actionLabel || "-"}. Catatan: ${technicianNote || "-"}`,
        performedByUid: performerUid,
        performedByName: performerName,
      });

      if (workOrder.requestedByUid) {
        await createAssetNotification({
          recipientUid: workOrder.requestedByUid,
          recipientName: workOrder.requestedByName,
          recipientRole: "asset_admin",
          title: "Temuan Maintenance Perlu Review",
          message: `${performerName} melaporkan temuan pada maintenance ${workOrder.title}. Tindakan yang disarankan: ${
            actionLabel || "-"
          }. Catatan: ${technicianNote || "-"}`,
          type: "maintenance_finding_reported",
          priority: severity === "urgent" ? "urgent" : "medium",
          linkUrl: `/maintenance?tab=follow-up&workOrderId=${workOrder.id}`,
          relatedType: "work_order",
          relatedId: workOrder.id,
          relatedNumber: workOrder.workOrderNumber,
          createdByUid: performerUid,
          createdByName: performerName,
        });
      }

      setExpandedItemId(null);
    } finally {
      setSaving(false);
    }
  };

  // Tim IT mengirim hasil CEK ULANG (setelah QHSE minta "Minta Cek Ulang") —
  // beda dari handleReportFindingToQhse (laporan pertama kali): di sini
  // followUpStatus balik dari "recheck_requested" ke "waiting_qhse_decision"
  // lagi, dicatat sebagai recheckSubmittedAt/By* supaya kelihatan ini
  // putaran cek ulang, bukan temuan baru.
  const handleSubmitRecheckResult = async (item: MaintenanceWorkOrderItem) => {
    if (!canEditMaintenanceCheck(item, currentAssetUser)) {
      setItemFormError("Form ini sudah terkunci.");
      return;
    }
    const allChecked = CHECKLIST_LABELS.every(({ key }) => checklist[key]);
    const actionNeedsNote = !!actionTaken && actionTaken !== "no_action";
    if (!actionTaken) {
      setItemFormError("Pilih tindakan sebelum mengirim hasil cek ulang.");
      return;
    }
    if ((!allChecked || actionNeedsNote) && !technicianNote.trim()) {
      setItemFormError(
        actionNeedsNote
          ? `Tindakan "${ACTION_LABELS[actionTaken as MaintenanceActionTaken]}" wajib disertai catatan di "Temuan / Catatan Teknisi".`
          : 'Ada checklist yang belum dicentang — isi dulu "Temuan / Catatan Teknisi".'
      );
      return;
    }
    setItemFormError("");
    setSaving(true);
    try {
      const performerUid = assetUser?.uid || firebaseUser?.uid || "";
      const performerName =
        assetUser?.name || firebaseUser?.displayName || firebaseUser?.email || "Tim IT";
      const actionLabel = actionTaken ? ACTION_LABELS[actionTaken] : "";

      const itemRef = doc(db, "asset_maintenance_work_orders", workOrder.id, "items", item.id);
      await updateDoc(
        itemRef,
        cleanFirestoreData({
          status: "checked",
          conditionBefore,
          conditionAfter,
          checklist,
          actionTaken: actionTaken || null,
          actionLabel,
          technicianNote,
          findingNote: technicianNote,
          technicalNote: technicianNote,
          findings: technicianNote,
          followUpStatus: "waiting_qhse_decision",
          needsQhseReview: true,
          recheckSubmittedAt: serverTimestamp(),
          recheckSubmittedByUid: performerUid,
          recheckSubmittedByName: performerName,
          recheckResponseNote: technicianNote,
          reportedToQhseAt: serverTimestamp(),
          reportedToQhseByUid: performerUid,
          reportedToQhseByName: performerName,
          updatedAt: serverTimestamp(),
          updatedByUid: performerUid,
          updatedByName: performerName,
        }) as Record<string, unknown>
      );

      await updateDoc(
        woRef,
        cleanFirestoreData({
          needsQhseReview: true,
          followUpStatus: "waiting_qhse_decision",
          lastActivityAt: serverTimestamp(),
          lastActivityByUid: performerUid,
          lastActivityByName: performerName,
          lastActivityMessage: "Tim IT mengirim hasil cek ulang ke QHSE.",
          updatedAt: serverTimestamp(),
          updatedByUid: performerUid,
          updatedByName: performerName,
        }) as Record<string, unknown>
      );

      await writeWorkOrderLog({
        workOrderId: workOrder.id,
        workOrderNumber: workOrder.workOrderNumber,
        action: "check_asset_item",
        note: `Hasil cek ulang ${item.assetName} dikirim ke QHSE. Tindakan: ${actionLabel || "-"}. Catatan: ${technicianNote || "-"}`,
        performedByUid: performerUid,
        performedByName: performerName,
      });

      if (workOrder.requestedByUid) {
        await createAssetNotification({
          recipientUid: workOrder.requestedByUid,
          recipientName: workOrder.requestedByName,
          recipientRole: "asset_admin",
          title: "Hasil Cek Ulang Dikirim",
          message: `${performerName} mengirim hasil cek ulang untuk asset ${item.assetName}. Catatan: ${
            technicianNote || "-"
          }`,
          type: "maintenance_finding_reported",
          priority: "medium",
          linkUrl: `/maintenance?tab=follow-up&workOrderId=${workOrder.id}`,
          relatedType: "work_order",
          relatedId: workOrder.id,
          relatedNumber: workOrder.workOrderNumber,
          createdByUid: performerUid,
          createdByName: performerName,
        });
      }

      setExpandedItemId(null);
    } finally {
      setSaving(false);
    }
  };

  // Khusus QHSE/Super Admin — bersihkan relasi ticket lanjutan yang stale di
  // item (mis. ticket-nya sudah dihapus manual saat testing) TANPA menyentuh
  // timeline lama; tetap tercatat log baru supaya jejaknya ada.
  const handleResetFollowUpTicket = async (item: MaintenanceWorkOrderItem, reason: string) => {
    const performerUid = assetUser?.uid || firebaseUser?.uid || "";
    const performerName =
      assetUser?.name || firebaseUser?.displayName || firebaseUser?.email || "Admin";

    console.log("[Reset Ticket Lanjutan] START", {
      workOrderId: workOrder.id,
      itemId: item.id,
      followUpTicketId: item.followUpTicketId,
      reason,
    });

    const itemRef = doc(db, "asset_maintenance_work_orders", workOrder.id, "items", item.id);
    await debugFirestoreWrite("reset follow-up ticket relation on item", async () =>
      updateDoc(
        itemRef,
        cleanFirestoreData({
          followUpTicketId: null,
          followUpTicketNumber: null,
          actionTaken: "no_action",
          resetFollowUpTicketAt: serverTimestamp(),
          resetFollowUpTicketByUid: performerUid,
          resetFollowUpTicketByName: performerName,
          resetFollowUpTicketReason: reason,
          updatedAt: serverTimestamp(),
        }) as Record<string, unknown>
      )
    );

    await debugFirestoreWrite("create reset follow-up ticket work order log", async () =>
      writeWorkOrderLog({
        workOrderId: workOrder.id,
        workOrderNumber: workOrder.workOrderNumber,
        action: "reset_follow_up_ticket",
        note: `Ticket lanjutan di-reset oleh admin dari ${item.assetName}. Alasan: ${reason}`,
        performedByUid: performerUid,
        performedByName: performerName,
      })
    );
  };

  // Laporan Hasil (section 10) — diagregasi dari checklist per-asset karena
  // belum ada field laporan tunggal di level work order.
  const hasReport = !!workOrder.reportSubmittedAt;
  const hasAnyQhseFinding = items.some((i) => !!i.needsQhseReview);
  const findingsList = items.filter((i) => i.findings).map((i) => ({ asset: i.assetName, text: i.findings! }));
  const actionsList = items
    .filter((i) => i.actionTaken)
    .map((i) => ({ asset: i.assetName, text: ACTION_LABELS[i.actionTaken!] || i.actionTaken! }));
  const recommendationList = items
    .filter((i) => i.technicianNote)
    .map((i) => ({ asset: i.assetName, text: i.technicianNote! }));
  const photosBefore = items.flatMap((i) =>
    (i.photoBeforeUrls || []).map((url) => ({ asset: i.assetName, url }))
  );
  const photosAfter = items.flatMap((i) =>
    (i.photoAfterUrls || []).map((url) => ({ asset: i.assetName, url }))
  );
  const followUpTickets = items.filter(
    (i) =>
      !!i.needsQhseReview ||
      !!i.followUpStatus ||
      ["active", "cancelled"].includes(getTicketBadgeState(i, existingTicketsById))
  );

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

              <section id="wo-laporan-hasil" className="rounded-2xl border border-slate-200 p-4">
                <h3 className="text-sm font-semibold text-slate-800 mb-3">Laporan Hasil</h3>
                {!hasReport ? (
                  isAssignedTechnician ? (
                    <p className="text-sm text-slate-400">
                      Laporan akhir belum dikirim. Selesaikan pengecekan asset lalu kirim laporan
                      ke QHSE.
                    </p>
                  ) : (
                    <p className="text-sm text-slate-400">Laporan hasil belum dikirim.</p>
                  )
                ) : (
                  <div className="space-y-4">
                    {hasAnyQhseFinding && (
                      <Badge label="Menunggu Review QHSE" colorClass="bg-amber-100 text-amber-700" />
                    )}
                    <div className="grid sm:grid-cols-2 gap-x-4 gap-y-2 text-sm">
                      <Info label="Dikirim oleh" value={workOrder.reportSubmittedByName} />
                      <Info
                        label="Waktu kirim"
                        value={
                          workOrder.reportSubmittedAt
                            ? formatDateTimeSeconds(workOrder.reportSubmittedAt)
                            : undefined
                        }
                      />
                    </div>
                    {workOrder.reportSummary && (
                      <div>
                        <p className="text-xs font-medium text-slate-500 mb-1">Ringkasan</p>
                        <p className="text-sm text-slate-700 whitespace-pre-line bg-slate-50 border border-slate-200 rounded-xl px-3 py-2">
                          {workOrder.reportSummary}
                        </p>
                      </div>
                    )}
                    {workOrder.reportConclusion && (
                      <div>
                        <p className="text-xs font-medium text-slate-500 mb-1">Kesimpulan Teknisi</p>
                        <p className="text-sm text-slate-700">{workOrder.reportConclusion}</p>
                      </div>
                    )}
                    {workOrder.reportRecommendation && (
                      <div>
                        <p className="text-xs font-medium text-slate-500 mb-1">Rekomendasi Teknisi</p>
                        <p className="text-sm text-slate-700">{workOrder.reportRecommendation}</p>
                      </div>
                    )}
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
                    <div id="wo-temuan-qhse">
                      <p className="text-xs font-medium text-slate-500 mb-1">Temuan / Butuh Tindak Lanjut QHSE</p>
                      {followUpTickets.length === 0 ? (
                        <p className="text-sm text-slate-600">Tidak ada.</p>
                      ) : (
                        <ul className="text-sm text-slate-700 space-y-0.5">
                          {followUpTickets.map((t) => (
                            <li key={t.id}>
                              {t.assetName} →{" "}
                              <span className="text-blue-600">
                                {getFindingStatusLabel(t, existingTicketsById) || "-"}
                              </span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                    {canMarkCompleted && (
                      <div className="flex flex-wrap gap-2 pt-1 border-t border-slate-100">
                        <button
                          type="button"
                          onClick={handleMarkCompleted}
                          disabled={saving}
                          className="rounded-lg bg-emerald-600 text-white px-3 py-1.5 text-xs font-medium cursor-pointer hover:bg-emerald-700 disabled:opacity-60"
                        >
                          Tandai Selesai
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setRevisionError("");
                            setRevisionReason("");
                            setRevisionModalOpen(true);
                          }}
                          disabled={saving}
                          className="rounded-lg border border-amber-300 bg-amber-50 text-amber-700 px-3 py-1.5 text-xs font-medium cursor-pointer hover:bg-amber-100 disabled:opacity-60"
                        >
                          Minta Revisi
                        </button>
                        {followUpTickets.length > 0 && (
                          <button
                            type="button"
                            onClick={() =>
                              document
                                .getElementById("wo-temuan-qhse")
                                ?.scrollIntoView({ behavior: "smooth", block: "start" })
                            }
                            disabled={saving}
                            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 cursor-pointer hover:bg-slate-50 disabled:opacity-60"
                          >
                            Lihat Temuan Butuh Keputusan
                          </button>
                        )}
                      </div>
                    )}
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
                          {(() => {
                            // Status utama header: kalau ada temuan yang lagi berjalan/final,
                            // itu lebih relevan daripada status checklist mentah — tampilkan
                            // SATU badge yang jelas (bukan dua badge kecil bertumpuk).
                            const findingMeta = getFindingStatusMeta(item);
                            if (findingMeta) {
                              return <Badge label={findingMeta.label} colorClass={findingMeta.colorClass} />;
                            }
                            const ticketState = getTicketBadgeState(item, existingTicketsById);
                            if (ticketState === "active") {
                              return (
                                <Badge
                                  label={item.followUpTicketNumber || "Ticket dibuat"}
                                  colorClass="bg-blue-100 text-blue-700"
                                />
                              );
                            }
                            if (ticketState === "cancelled") {
                              return <Badge label="Ticket Dibatalkan" colorClass="bg-slate-100 text-slate-500" />;
                            }
                            return (
                              <Badge
                                label={WORK_ORDER_ITEM_STATUS_LABEL[item.status]}
                                colorClass={WORK_ORDER_ITEM_STATUS_COLOR[item.status]}
                              />
                            );
                          })()}
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

                      {(isQhse || isSuperAdminRole) &&
                        !!item.followUpTicketId &&
                        getTicketBadgeState(item, existingTicketsById) !== "none" && (
                          <div className="px-3 pb-2 -mt-1">
                            <button
                              type="button"
                              onClick={() => {
                                setPendingTicketResetItem(item);
                                setTicketResetReason("");
                                setTicketResetError("");
                              }}
                              className="text-xs font-medium text-slate-400 cursor-pointer hover:text-red-600 hover:underline"
                            >
                              Reset Ticket Lanjutan
                            </button>
                          </div>
                        )}

                      {/* Panel keputusan QHSE — tampil selama temuan masih berjalan ATAU
                          sudah final (needsQhsePanel), supaya QHSE tetap bisa "Minta Cek
                          Ulang"/"Ubah Keputusan" walau sudah salah klik sebelumnya (acceptance
                          #7). Ticket/tugas lanjutan HANYA dibuat lewat tombol di panel ini,
                          bukan otomatis dari form hasil cek Tim IT. */}
                      {(isQhse || isSuperAdminRole) && needsQhsePanel(item) && (
                        <div className="mx-3 mb-3 mt-2 rounded-2xl border border-amber-200 bg-amber-50 p-4 space-y-3">
                          {/* Header */}
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <AlertOctagon size={18} className="text-amber-600 shrink-0" />
                              <h4 className="text-sm font-semibold text-amber-900">
                                Keputusan QHSE atas Temuan
                              </h4>
                            </div>
                            <div className="flex items-center gap-1.5">
                              {getFindingStatusMeta(item) && (
                                <Badge
                                  label={getFindingStatusMeta(item)!.label}
                                  colorClass={getFindingStatusMeta(item)!.colorClass}
                                />
                              )}
                              {item.findingSeverity === "urgent" && (
                                <Badge label="Urgent" colorClass="bg-red-100 text-red-700" />
                              )}
                            </div>
                          </div>

                          {/* Body */}
                          <div className="space-y-2.5">
                            <p className="text-sm leading-6 text-slate-700">
                              <span className="font-medium">Asset:</span> {item.assetName}
                            </p>
                            <div>
                              <p className="text-sm font-medium text-slate-700 mb-1">
                                Tindakan disarankan Tim IT
                              </p>
                              <p className="text-base font-semibold text-slate-900">
                                {item.findingAction ? ACTION_LABELS[item.findingAction] : "-"}
                              </p>
                            </div>
                            <div>
                              <p className="text-sm font-medium text-slate-700 mb-1">Catatan Tim IT</p>
                              <p className="text-sm leading-6 text-slate-700 bg-white border border-slate-200 rounded-xl px-3 py-2.5">
                                {item.findingNote || item.technicianNote || "-"}
                              </p>
                            </div>
                            {item.qhseDecisionLabel && (
                              <div>
                                <p className="text-sm font-medium text-slate-700 mb-1">Keputusan QHSE</p>
                                <div className="bg-white border border-slate-200 rounded-xl px-3 py-2.5 space-y-1">
                                  <p className="text-sm font-semibold text-slate-900">
                                    {item.qhseDecisionLabel}
                                  </p>
                                  {item.qhseDecisionNote && (
                                    <p className="text-sm leading-6 text-slate-600">
                                      {item.qhseDecisionNote}
                                    </p>
                                  )}
                                  {item.qhseDecisionByName && (
                                    <p className="text-xs text-slate-400">
                                      oleh {item.qhseDecisionByName}
                                      {item.qhseDecisionAt
                                        ? ` · ${formatDateTimeSeconds(item.qhseDecisionAt)}`
                                        : ""}
                                    </p>
                                  )}
                                </div>
                              </div>
                            )}
                          </div>

                          {/* Footer */}
                          <div className="flex flex-wrap gap-2 pt-1">
                            {item.followUpStatus === "waiting_qhse_decision" || !item.followUpStatus ? (
                              <>
                                <button
                                  type="button"
                                  onClick={() => handleQhseMarkNoted(item)}
                                  disabled={saving}
                                  className="min-h-9 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 cursor-pointer hover:bg-slate-50 disabled:opacity-60"
                                >
                                  Cukup Dicatat
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setQhseDecisionItem(item);
                                    setQhseDecisionKind("request_recheck");
                                    setQhseDecisionNote("");
                                    setQhseDecisionError("");
                                  }}
                                  disabled={saving}
                                  className="min-h-9 rounded-lg border border-blue-200 bg-blue-50 px-3.5 py-2 text-sm font-medium text-blue-700 cursor-pointer hover:bg-blue-100 disabled:opacity-60"
                                >
                                  Minta Cek Ulang
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setQhseDecisionItem(item);
                                    setQhseDecisionKind(null);
                                    setQhseDecisionNote("");
                                    setQhseDecisionError("");
                                  }}
                                  disabled={saving}
                                  className="min-h-9 rounded-lg border border-red-200 bg-red-50 px-3.5 py-2 text-sm font-medium text-red-700 cursor-pointer hover:bg-red-100 disabled:opacity-60"
                                >
                                  Tindak Lanjuti
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setQhseDecisionItem(item);
                                    setQhseDecisionKind("request_recheck");
                                    setQhseDecisionNote("");
                                    setQhseDecisionError("");
                                  }}
                                  disabled={saving}
                                  className="min-h-9 rounded-lg border border-blue-200 bg-blue-50 px-3.5 py-2 text-sm font-medium text-blue-700 cursor-pointer hover:bg-blue-100 disabled:opacity-60"
                                >
                                  Minta Cek Ulang
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setQhseDecisionItem(item);
                                    setQhseDecisionKind(null);
                                    setQhseDecisionNote("");
                                    setQhseDecisionError("");
                                  }}
                                  disabled={saving}
                                  className="min-h-9 rounded-lg border border-slate-300 bg-white px-3.5 py-2 text-sm font-medium text-slate-700 cursor-pointer hover:bg-slate-50 disabled:opacity-60"
                                >
                                  Ubah Keputusan
                                </button>
                              </>
                            )}
                          </div>
                        </div>
                      )}

                      {expandedItemId === item.id && canWorkItems && (() => {
                        const isCheckLocked = !canEditMaintenanceCheck(item, currentAssetUser);
                        return (
                        <div className="px-3 pb-3 pt-1 space-y-3 border-t border-slate-100">
                          {isFindingLocked(item) && (
                            <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">
                              Temuan sudah dikirim ke QHSE dan sedang menunggu keputusan. Form
                              dikunci sementara.
                            </div>
                          )}
                          {isFindingFinal(item) && (
                            <div className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
                              QHSE sudah mengambil keputusan atas temuan ini (
                              {getFindingStatusLabel(item, existingTicketsById) || "-"}). Form
                              dikunci — kalau perlu direvisi, minta QHSE pilih &quot;Minta Cek
                              Ulang&quot;.
                            </div>
                          )}
                          {item.followUpStatus === "recheck_requested" && (
                            <div className="rounded-xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-700">
                              <p className="font-medium">QHSE meminta cek ulang</p>
                              {item.qhseDecisionNote && (
                                <p className="mt-1">Catatan QHSE: {item.qhseDecisionNote}</p>
                              )}
                            </div>
                          )}
                          <div className="grid grid-cols-2 gap-3">
                            <div>
                              <label className="block text-xs font-medium text-slate-500 mb-1.5">
                                Kondisi Sebelum
                              </label>
                              <select
                                value={conditionBefore}
                                onChange={(e) => setConditionBefore(e.target.value as MaintenanceConditionLabel)}
                                disabled={isCheckLocked}
                                className="input text-sm cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
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
                                disabled={isCheckLocked}
                                className="input text-sm cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
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
                            <div className="flex items-center justify-between mb-1.5">
                              <label className="block text-xs font-medium text-slate-500">
                                Checklist
                              </label>
                              <div className="flex flex-wrap gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setChecklist(ALL_CHECKED_CHECKLIST);
                                    setItemFormError("");
                                  }}
                                  disabled={isCheckLocked}
                                  className="rounded-full bg-slate-100 text-slate-600 px-2.5 py-1 text-xs font-medium cursor-pointer hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  Centang Semua
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setChecklist(DEFAULT_CHECKLIST)}
                                  disabled={isCheckLocked}
                                  className="rounded-full bg-slate-100 text-slate-600 px-2.5 py-1 text-xs font-medium cursor-pointer hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  Kosongkan
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setChecklist(ALL_CHECKED_CHECKLIST);
                                    setActionTaken("no_action");
                                    setTechnicianNote(GOOD_CONDITION_NOTE);
                                    setItemFormError("");
                                  }}
                                  disabled={isCheckLocked}
                                  className="rounded-full bg-emerald-50 text-emerald-700 px-2.5 py-1 text-xs font-medium cursor-pointer hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  Kondisi Baik
                                </button>
                              </div>
                            </div>
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
                                    disabled={isCheckLocked}
                                    className="cursor-pointer disabled:cursor-not-allowed"
                                  />
                                  {label}
                                </label>
                              ))}
                            </div>
                          </div>

                          <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1.5">
                              Tindakan
                            </label>
                            <select
                              value={actionTaken}
                              onChange={(e) => {
                                const nextAction = e.target.value as MaintenanceActionTaken | "";
                                setActionTaken(nextAction);
                                // Kalau tindakan diganti dari "Kondisi Baik" ke tindakan lain,
                                // catatan "Tidak ada temuan..." jadi tidak relevan lagi —
                                // kosongkan supaya teknisi mengisi catatan sesuai tindakan
                                // barunya (placeholder textarea otomatis menyesuaikan).
                                if (
                                  nextAction &&
                                  nextAction !== "no_action" &&
                                  technicianNote.trim() === GOOD_CONDITION_NOTE
                                ) {
                                  setTechnicianNote("");
                                }
                                setItemFormError("");
                              }}
                              disabled={isCheckLocked}
                              className="input text-sm cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                            >
                              <option value="">Pilih tindakan</option>
                              {ACTION_OPTIONS.map((a) => (
                                <option key={a} value={a}>
                                  {ACTION_LABELS[a]}
                                </option>
                              ))}
                            </select>
                          </div>

                          <div>
                            <label className="block text-xs font-medium text-slate-500 mb-1.5">
                              Temuan / Catatan Teknisi
                            </label>
                            <textarea
                              value={technicianNote}
                              onChange={(e) => {
                                setTechnicianNote(e.target.value);
                                if (e.target.value.trim()) setItemFormError("");
                              }}
                              rows={3}
                              placeholder={
                                (actionTaken && ACTION_NOTE_PLACEHOLDER[actionTaken]) ||
                                DEFAULT_NOTE_PLACEHOLDER
                              }
                              disabled={isCheckLocked}
                              className="input text-sm disabled:cursor-not-allowed disabled:opacity-60"
                            />
                            {itemFormError && (
                              <p className="text-xs text-red-600 mt-1">{itemFormError}</p>
                            )}
                          </div>

                          {isFindingLocked(item) ? null : item.followUpStatus === "recheck_requested" ? (
                            // QHSE minta cek ulang — Tim IT MELAKUKAN cek ulang lalu
                            // mengirim hasilnya, bukan "minta" apa pun lagi. Tombol kedua
                            // di sini TIDAK PERNAH menampilkan status ("Cek Ulang Diminta
                            // QHSE" itu badge, bukan aksi) — selalu aksi kirim yang aktif.
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => handleSaveItem(item)}
                                disabled={saving || isCheckLocked}
                                className="rounded-xl bg-emerald-600 text-white px-4 py-2 text-sm font-medium cursor-pointer hover:bg-emerald-700 disabled:opacity-60"
                              >
                                Simpan Hasil Cek Ulang
                              </button>
                              <button
                                type="button"
                                onClick={() => handleSubmitRecheckResult(item)}
                                disabled={saving || isCheckLocked}
                                className="rounded-xl border border-blue-200 bg-blue-50 text-blue-700 px-4 py-2 text-sm font-medium cursor-pointer hover:bg-blue-100 disabled:opacity-60"
                              >
                                Kirim Hasil Cek Ulang ke QHSE
                              </button>
                            </div>
                          ) : (
                            <div className="flex flex-wrap gap-2">
                              <button
                                type="button"
                                onClick={() => handleSaveItem(item)}
                                disabled={saving || isCheckLocked}
                                className="rounded-xl bg-emerald-600 text-white px-4 py-2 text-sm font-medium cursor-pointer hover:bg-emerald-700 disabled:opacity-60"
                              >
                                Simpan Hasil Cek
                              </button>
                              {(() => {
                                const isFindingWorthy =
                                  !!actionTaken &&
                                  (NEEDS_FOLLOW_UP_ACTIONS.includes(actionTaken) ||
                                    (actionTaken === "minor_repair" && !!technicianNote.trim()));
                                if (!isFindingWorthy) return null;

                                const alreadyReported = !!item.needsQhseReview || !!item.followUpStatus;

                                return (
                                  <button
                                    type="button"
                                    onClick={() => handleReportFindingToQhse(item)}
                                    disabled={saving || alreadyReported || isCheckLocked}
                                    className="rounded-xl border border-amber-200 bg-amber-50 text-amber-700 px-4 py-2 text-sm font-medium cursor-pointer hover:bg-amber-100 disabled:opacity-60"
                                  >
                                    Laporkan Temuan ke QHSE
                                  </button>
                                );
                              })()}
                            </div>
                          )}
                        </div>
                        );
                      })()}
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
                      onClick={() => {
                        setReportConclusion("");
                        setReportRecommendation("");
                        setReportConfirmChecked(false);
                        setReportModalError("");
                        setSubmitReportModalOpen(true);
                      }}
                      disabled={saving || !progressComplete}
                      title={
                        progressComplete
                          ? undefined
                          : "Selesaikan pengecekan semua asset dulu (progress harus 100%)."
                      }
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

      {submitReportModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => !saving && setSubmitReportModalOpen(false)}
          />
          <div className="relative bg-white rounded-2xl shadow-lg border border-slate-200 w-full max-w-[1200px] sm:w-[92vw] max-h-[88vh] flex flex-col overflow-hidden">
            <div className="shrink-0 px-6 sm:px-7 pt-6 sm:pt-7 pb-4 border-b border-slate-100">
              <h3 className="text-xl font-semibold text-slate-900 mb-1">
                Kirim Laporan Maintenance ke QHSE
              </h3>
              <p className="text-sm text-slate-500">
                Rekap ini dibuat otomatis dari hasil pengecekan tiap asset — periksa dulu sebelum
                dikirim ke QHSE.
              </p>
            </div>

            {(() => {
              const reportPreview = buildMaintenanceReportSummary(items);
              return (
                <>
                  <div className="flex-1 overflow-y-auto px-6 sm:px-7 py-6 space-y-7">
                    <div>
                      <p className="text-sm font-semibold text-slate-700 mb-3">
                        1. Ringkasan Pengecekan
                      </p>
                      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-3">
                        <MiniStat label="Total Asset Dicek" value={String(reportPreview.totalAssets)} />
                        <MiniStat label="Kondisi Baik" value={String(reportPreview.goodCount)} />
                        <MiniStat label="Ada Temuan" value={String(reportPreview.findingCount)} />
                        <MiniStat
                          label="Butuh Keputusan QHSE"
                          value={String(reportPreview.waitingQhseDecisionCount)}
                        />
                        <MiniStat label="Progress" value={`${progressPercent}%`} />
                      </div>
                    </div>

                    <div>
                      <p className="text-sm font-semibold text-slate-700 mb-3">2. Rekap Per Asset</p>
                      <div className="overflow-x-auto rounded-xl border border-slate-200">
                        <table className="w-full min-w-[1100px] text-sm">
                          <thead>
                            <tr className="text-left text-slate-500 border-b border-slate-200 bg-slate-50/60">
                              <th className="px-4 py-3 font-semibold min-w-[180px]">Asset</th>
                              <th className="px-4 py-3 font-semibold min-w-[120px]">Kode</th>
                              <th className="px-4 py-3 font-semibold min-w-[110px]">Kondisi Sebelum</th>
                              <th className="px-4 py-3 font-semibold min-w-[110px]">Kondisi Setelah</th>
                              <th className="px-4 py-3 font-semibold min-w-[160px]">Tindakan</th>
                              <th className="px-4 py-3 font-semibold min-w-[170px]">Checklist</th>
                              <th className="px-4 py-3 font-semibold min-w-[220px]">Temuan / Catatan</th>
                              <th className="px-4 py-3 font-semibold min-w-[140px]">Status Temuan</th>
                            </tr>
                          </thead>
                          <tbody>
                            {reportPreview.itemSummaries.map((i) => {
                              const rawItem = items.find((it) => it.assetId === i.assetId);
                              const checkedCount = rawItem?.checklist
                                ? CHECKLIST_LABELS.filter(({ key }) => rawItem.checklist![key]).length
                                : 0;
                              return (
                                <tr key={i.assetId} className="border-b border-slate-100 last:border-0 align-top">
                                  <td className="px-4 py-3 font-medium text-slate-800 min-w-[180px]">
                                    {i.assetName}
                                  </td>
                                  <td className="px-4 py-3 text-slate-500 min-w-[120px]">{i.assetCode}</td>
                                  <td className="px-4 py-3 text-slate-600 min-w-[110px]">{i.conditionBefore}</td>
                                  <td className="px-4 py-3 text-slate-600 min-w-[110px]">{i.conditionAfter}</td>
                                  <td className="px-4 py-3 text-slate-600 min-w-[160px]">{i.actionTaken}</td>
                                  <td className="px-4 py-3 min-w-[170px]">
                                    <Badge
                                      label={`${checkedCount}/${CHECKLIST_LABELS.length} checklist terpenuhi`}
                                      colorClass={
                                        checkedCount === CHECKLIST_LABELS.length
                                          ? "bg-emerald-100 text-emerald-700"
                                          : "bg-amber-100 text-amber-700"
                                      }
                                    />
                                  </td>
                                  <td className="px-4 py-3 text-slate-600 min-w-[220px] whitespace-pre-wrap break-words leading-normal">
                                    {i.technicianNote}
                                  </td>
                                  <td className="px-4 py-3 text-slate-600 min-w-[140px]">
                                    {i.needsQhseReview
                                      ? getFindingStatusLabel(rawItem!, existingTicketsById) || "-"
                                      : "-"}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-2">
                        3. Kesimpulan Umum Hasil Maintenance <span className="text-red-500">*</span>
                      </label>
                      <textarea
                        value={reportConclusion}
                        onChange={(e) => {
                          setReportConclusion(e.target.value);
                          if (e.target.value.trim()) setReportModalError("");
                        }}
                        className="input text-sm min-h-[110px]"
                        placeholder="Contoh: Seluruh asset telah dicek. 2 asset dalam kondisi baik, 1 asset membutuhkan keputusan QHSE karena tidak layak pakai sementara."
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-semibold text-slate-700 mb-2">
                        4. Rekomendasi Tindak Lanjut (opsional)
                      </label>
                      <textarea
                        value={reportRecommendation}
                        onChange={(e) => setReportRecommendation(e.target.value)}
                        className="input text-sm min-h-[100px]"
                        placeholder="Contoh: Disarankan mengganti adaptor dan menonaktifkan asset sementara sampai komponen tersedia."
                      />
                    </div>

                    <label className="flex items-start gap-2 text-sm text-slate-600 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={reportConfirmChecked}
                        onChange={(e) => setReportConfirmChecked(e.target.checked)}
                        className="mt-0.5 cursor-pointer"
                      />
                      Saya menyatakan seluruh hasil pengecekan sudah sesuai dan siap dikirim ke QHSE.
                    </label>

                    {reportModalError && <p className="text-sm text-red-600">{reportModalError}</p>}
                  </div>

                  <div className="shrink-0 flex items-center justify-between gap-3 px-6 sm:px-7 py-4 border-t border-slate-200 bg-white">
                    <button
                      type="button"
                      onClick={() => setSubmitReportModalOpen(false)}
                      disabled={saving}
                      className="min-h-[44px] rounded-xl border border-slate-300 bg-white px-5 text-sm font-medium cursor-pointer hover:bg-slate-50 disabled:opacity-60"
                    >
                      Batal
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        // Validasi (section D) — dicek lagi di sini, bukan cuma
                        // mengandalkan tombol "Kirim Laporan" yang sudah disable.
                        const allChecked =
                          items.length > 0 && items.every((i) => i.status !== "pending" && i.status !== "in_progress");
                        if (!allChecked) {
                          setReportModalError("Masih ada asset yang belum selesai dicek.");
                          return;
                        }
                        const missingNote = items.some(
                          (i) => !!i.actionTaken && i.actionTaken !== "no_action" && !i.technicianNote?.trim()
                        );
                        if (missingNote) {
                          setReportModalError(
                            'Ada asset dengan tindakan selain "Tidak ada tindakan" tapi belum diisi catatan.'
                          );
                          return;
                        }
                        if (!reportConclusion.trim()) {
                          setReportModalError("Kesimpulan umum hasil maintenance wajib diisi.");
                          return;
                        }
                        if (!reportConfirmChecked) {
                          setReportModalError("Konfirmasi kesiapan laporan wajib dicentang.");
                          return;
                        }
                        setReportModalError("");
                        try {
                          await handleSubmitReport(reportConclusion.trim(), reportRecommendation.trim());
                          setSubmitReportModalOpen(false);
                        } catch (err) {
                          console.error("[Work Order] gagal mengirim laporan maintenance", err);
                          setReportModalError("Gagal mengirim laporan. Coba lagi.");
                        }
                      }}
                      disabled={saving}
                      className="min-h-[44px] rounded-xl bg-emerald-600 text-white px-6 text-sm font-medium cursor-pointer hover:bg-emerald-700 disabled:opacity-60"
                    >
                      {saving ? "Mengirim..." : "Kirim Laporan ke QHSE"}
                    </button>
                  </div>
                </>
              );
            })()}
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
            {pendingHelpAction.key === "reset_checklist_in_progress" && (
              <label className="mb-3 flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
                <input
                  type="checkbox"
                  checked={resetChecklistClearTickets}
                  onChange={(e) => setResetChecklistClearTickets(e.target.checked)}
                  className="cursor-pointer"
                />
                Hapus relasi ticket lanjutan dari item ini
              </label>
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

      {pendingTicketResetItem && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => !ticketResetSaving && setPendingTicketResetItem(null)}
          />
          <div className="relative bg-white rounded-2xl shadow-lg border border-slate-200 w-full max-w-md p-5">
            <h3 className="text-base font-semibold text-slate-900 mb-1">Reset Ticket Lanjutan</h3>
            <p className="text-sm text-slate-500 mb-3">
              Relasi ticket lanjutan untuk {pendingTicketResetItem.assetName} akan dibersihkan dari
              item ini. Tindakan ini dicatat di timeline work order.
            </p>
            <div className="mb-3">
              <label className="block text-xs font-medium text-slate-500 mb-1.5">
                Alasan <span className="text-red-500">*</span>
              </label>
              <textarea
                value={ticketResetReason}
                onChange={(e) => setTicketResetReason(e.target.value)}
                rows={3}
                className="input text-sm"
                placeholder="Jelaskan alasan reset ticket lanjutan ini..."
                autoFocus
              />
            </div>
            {ticketResetError && <p className="text-sm text-red-600 mb-3">{ticketResetError}</p>}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPendingTicketResetItem(null)}
                disabled={ticketResetSaving}
                className="flex-1 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium cursor-pointer hover:bg-slate-50 disabled:opacity-60"
              >
                Batal
              </button>
              <button
                type="button"
                onClick={async () => {
                  if (!ticketResetReason.trim()) {
                    setTicketResetError("Alasan wajib diisi.");
                    return;
                  }
                  setTicketResetSaving(true);
                  setTicketResetError("");
                  try {
                    await handleResetFollowUpTicket(pendingTicketResetItem, ticketResetReason.trim());
                    setPendingTicketResetItem(null);
                    setTicketResetReason("");
                  } catch (err) {
                    console.error("[Work Order] gagal reset ticket lanjutan", err);
                    setTicketResetError("Gagal reset ticket lanjutan. Coba lagi.");
                  } finally {
                    setTicketResetSaving(false);
                  }
                }}
                disabled={ticketResetSaving}
                className="flex-1 rounded-xl bg-red-600 px-4 py-2 text-sm font-medium text-white cursor-pointer hover:bg-red-700 disabled:opacity-60"
              >
                {ticketResetSaving ? "Menyimpan..." : "Konfirmasi"}
              </button>
            </div>
          </div>
        </div>
      )}

      {qhseDecisionItem && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div
            className="absolute inset-0 bg-black/50"
            onClick={() => !qhseDecisionSaving && closeQhseDecisionModal()}
          />
          <div className="relative bg-white rounded-2xl shadow-lg border border-slate-200 w-full max-w-md p-5 max-h-[90vh] overflow-y-auto">
            {qhseDecisionKind === null ? (
              <>
                <h3 className="text-base font-semibold text-slate-900 mb-1">Tindak Lanjuti Temuan</h3>
                <p className="text-sm text-slate-500 mb-3">
                  Pilih tindak lanjut untuk temuan pada {qhseDecisionItem.assetName}.
                </p>
                <div className="space-y-2">
                  {(
                    [
                      "create_corrective_task",
                      "need_purchase",
                      "need_vendor",
                      "mark_temporarily_unusable",
                    ] as QhseFollowUpDecisionKind[]
                  ).map((kind) => (
                    <button
                      key={kind}
                      type="button"
                      onClick={() => setQhseDecisionKind(kind)}
                      className="w-full text-left rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 cursor-pointer hover:bg-slate-50"
                    >
                      {QHSE_FOLLOW_UP_DECISION_LABELS[kind]}
                    </button>
                  ))}
                </div>
                <div className="flex gap-2 mt-4">
                  <button
                    type="button"
                    onClick={closeQhseDecisionModal}
                    className="flex-1 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium cursor-pointer hover:bg-slate-50"
                  >
                    Batal
                  </button>
                </div>
              </>
            ) : (
              <>
                <h3 className="text-base font-semibold text-slate-900 mb-1">
                  {qhseDecisionKind === "request_recheck"
                    ? "Minta Tim IT Cek Ulang"
                    : QHSE_FOLLOW_UP_DECISION_LABELS[qhseDecisionKind]}
                </h3>
                <p className="text-sm text-slate-500 mb-3">
                  Keputusan untuk temuan pada {qhseDecisionItem.assetName}. Tindakan ini dicatat di
                  timeline work order.
                </p>

                {qhseDecisionKind === "create_corrective_task" && (
                  <div className="mb-3">
                    <label className="block text-xs font-medium text-slate-500 mb-1.5">
                      Pilih Tim IT (opsional)
                    </label>
                    <select
                      value={qhseSelectedItUid}
                      onChange={(e) => setQhseSelectedItUid(e.target.value)}
                      className="input text-sm cursor-pointer"
                    >
                      <option value="">Belum ditentukan</option>
                      {itTeamOptions.map((u) => (
                        <option key={u.uid} value={u.uid}>
                          {u.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}

                {qhseDecisionKind === "need_purchase" && (
                  <div className="mb-3">
                    <label className="block text-xs font-medium text-slate-500 mb-1.5">
                      Detail Komponen yang Dibutuhkan
                    </label>
                    <textarea
                      value={qhsePurchaseDetail}
                      onChange={(e) => setQhsePurchaseDetail(e.target.value)}
                      rows={2}
                      className="input text-sm"
                      placeholder="Sebutkan komponen yang perlu dibeli..."
                    />
                  </div>
                )}

                {qhseDecisionKind === "need_vendor" && (
                  <div className="mb-3">
                    <label className="block text-xs font-medium text-slate-500 mb-1.5">
                      Nama Vendor / Catatan
                    </label>
                    <textarea
                      value={qhseVendorNote}
                      onChange={(e) => setQhseVendorNote(e.target.value)}
                      rows={2}
                      className="input text-sm"
                      placeholder="Sebutkan vendor yang disarankan / alasannya..."
                    />
                  </div>
                )}

                {qhseDecisionKind === "mark_temporarily_unusable" && (
                  <label className="mb-3 flex items-start gap-2 text-sm text-slate-600 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={qhseConfirmUnusable}
                      onChange={(e) => setQhseConfirmUnusable(e.target.checked)}
                      className="mt-0.5 cursor-pointer"
                    />
                    Saya konfirmasi asset ini dinonaktifkan sementara dari peminjaman sampai
                    ditindaklanjuti.
                  </label>
                )}

                <div className="mb-3">
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">
                    Catatan Keputusan <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    value={qhseDecisionNote}
                    onChange={(e) => setQhseDecisionNote(e.target.value)}
                    rows={3}
                    className="input text-sm"
                    placeholder="Jelaskan alasan keputusan ini..."
                    autoFocus
                  />
                </div>
                {qhseDecisionError && (
                  <p className="text-sm text-red-600 mb-3">{qhseDecisionError}</p>
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() =>
                      qhseDecisionKind === "request_recheck"
                        ? closeQhseDecisionModal()
                        : setQhseDecisionKind(null)
                    }
                    disabled={qhseDecisionSaving}
                    className="flex-1 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium cursor-pointer hover:bg-slate-50 disabled:opacity-60"
                  >
                    {qhseDecisionKind === "request_recheck" ? "Batal" : "Kembali"}
                  </button>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!qhseDecisionNote.trim()) {
                        setQhseDecisionError("Catatan keputusan wajib diisi.");
                        return;
                      }
                      if (qhseDecisionKind === "mark_temporarily_unusable" && !qhseConfirmUnusable) {
                        setQhseDecisionError("Konfirmasi nonaktifkan peminjaman asset wajib dicentang.");
                        return;
                      }
                      setQhseDecisionSaving(true);
                      setQhseDecisionError("");
                      try {
                        const note = qhseDecisionNote.trim();
                        switch (qhseDecisionKind) {
                          case "request_recheck":
                            await handleQhseRequestRecheck(qhseDecisionItem, note);
                            break;
                          case "create_corrective_task":
                            await handleQhseCreateCorrectiveTask(qhseDecisionItem, note, qhseSelectedItUid);
                            break;
                          case "need_purchase":
                            await handleQhseRequestPurchaseOrVendor(
                              qhseDecisionItem,
                              "need_purchase",
                              qhsePurchaseDetail.trim() || note
                            );
                            break;
                          case "need_vendor":
                            await handleQhseRequestPurchaseOrVendor(
                              qhseDecisionItem,
                              "need_vendor",
                              qhseVendorNote.trim() || note
                            );
                            break;
                          case "mark_temporarily_unusable":
                            await handleQhseMarkAssetUnusable(qhseDecisionItem, note);
                            break;
                        }
                        closeQhseDecisionModal();
                      } catch (err) {
                        console.error("[Work Order] gagal menyimpan keputusan QHSE", err);
                        setQhseDecisionError("Gagal menyimpan keputusan. Coba lagi.");
                      } finally {
                        setQhseDecisionSaving(false);
                      }
                    }}
                    disabled={qhseDecisionSaving}
                    className="flex-1 rounded-xl bg-gradient-to-r from-blue-600 to-teal-500 px-4 py-2 text-sm font-medium text-white cursor-pointer hover:brightness-105 disabled:opacity-60"
                  >
                    {qhseDecisionSaving ? "Menyimpan..." : "Konfirmasi"}
                  </button>
                </div>
              </>
            )}
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
