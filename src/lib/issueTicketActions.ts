import { AppRole, AssetIssueTicket, IssueTicketStatus } from "@/lib/types";

// Section A/C/F — alur Laporan Kendala Staff TIDAK BOLEH diubah lewat
// dropdown status bebas. Status hanya boleh berubah lewat tombol aksi yang
// valid sesuai status sekarang + peran orang yang menekan tombol. File ini
// adalah SATU-SATUNYA tempat yang mendefinisikan aksi mana yang valid dari
// status apa, untuk siapa — IssueTicketDetailModal dan Workflow Board harus
// selalu lewat sini, jangan hardcode tombol lagi di komponen.

export type IssueActionKey =
  | "review"
  | "request_info"
  | "complete_info"
  | "forward"
  | "reassign"
  | "complete_assignment"
  | "revert_to_review"
  | "start"
  | "send_result"
  | "mark_follow_up"
  | "request_vendor"
  | "request_purchase"
  | "recheck"
  | "confirm_done"
  | "still_problem"
  | "close"
  | "reject"
  | "duplicate"
  | "cancel"
  | "reopen"
  | "update_arrival_estimate"
  | "mark_technician_arrived"
  | "change_handling";

export type IssueActorKind = "qhse" | "staff_reporter" | "assigned_team";

export type IssueActionTone = "primary" | "neutral" | "danger" | "success";

export interface IssueActionDef {
  key: IssueActionKey;
  label: string;
  actor: IssueActorKind;
  tone: IssueActionTone;
  toStatus: IssueTicketStatus; // status sama dengan status sekarang untuk aksi non-status (mis. request_vendor)
  actionLabel: string; // dipakai di log asset_issue_ticket_logs
  requiresNote?: boolean;
  notePlaceholder?: string;
  requiresPhoto?: boolean;
}

// Definisi tombol per status SEKARANG. Urutan array = urutan tombol tampil.
const ACTIONS_BY_STATUS: Partial<Record<IssueTicketStatus, IssueActionDef[]>> = {
  reported: [
    { key: "review", label: "Tinjau Laporan", actor: "qhse", tone: "primary", toStatus: "under_review", actionLabel: "Meninjau laporan" },
    { key: "request_info", label: "Minta Info Tambahan", actor: "qhse", tone: "neutral", toStatus: "need_more_info", actionLabel: "Meminta info tambahan", requiresNote: true, notePlaceholder: "Info apa yang masih kurang?" },
    { key: "reject", label: "Tolak", actor: "qhse", tone: "danger", toStatus: "rejected", actionLabel: "Menolak laporan", requiresNote: true, notePlaceholder: "Alasan penolakan" },
    { key: "duplicate", label: "Tandai Duplikat", actor: "qhse", tone: "neutral", toStatus: "duplicate", actionLabel: "Menandai duplikat", requiresNote: true, notePlaceholder: "Duplikat dari laporan mana?" },
  ],
  under_review: [
    { key: "forward", label: "Teruskan ke Tim Terkait", actor: "qhse", tone: "primary", toStatus: "assigned", actionLabel: "Meneruskan ke tim terkait" },
    { key: "request_info", label: "Minta Info Tambahan", actor: "qhse", tone: "neutral", toStatus: "need_more_info", actionLabel: "Meminta info tambahan", requiresNote: true, notePlaceholder: "Info apa yang masih kurang?" },
    { key: "reject", label: "Tolak", actor: "qhse", tone: "danger", toStatus: "rejected", actionLabel: "Menolak laporan", requiresNote: true, notePlaceholder: "Alasan penolakan" },
    { key: "duplicate", label: "Tandai Duplikat", actor: "qhse", tone: "neutral", toStatus: "duplicate", actionLabel: "Menandai duplikat", requiresNote: true, notePlaceholder: "Duplikat dari laporan mana?" },
  ],
  need_more_info: [
    { key: "complete_info", label: "Lengkapi Info", actor: "staff_reporter", tone: "primary", toStatus: "under_review", actionLabel: "Melengkapi info tambahan" },
  ],
  assigned: [
    { key: "start", label: "Mulai Tangani", actor: "assigned_team", tone: "primary", toStatus: "in_progress", actionLabel: "Mulai menangani laporan" },
    { key: "reassign", label: "Ganti Tim/Penanggung Jawab", actor: "qhse", tone: "neutral", toStatus: "assigned", actionLabel: "Mengganti tim/penanggung jawab" },
    { key: "cancel", label: "Batalkan", actor: "qhse", tone: "danger", toStatus: "cancelled", actionLabel: "Membatalkan laporan", requiresNote: true, notePlaceholder: "Alasan pembatalan" },
  ],
  in_progress: [
    { key: "send_result", label: "Kirim Hasil Penanganan", actor: "assigned_team", tone: "primary", toStatus: "waiting_reporter_confirmation", actionLabel: "Mengirim hasil penanganan", requiresNote: true, notePlaceholder: "Hasil penanganan / catatan tindakan", requiresPhoto: true },
    { key: "mark_follow_up", label: "Butuh Tindakan Lanjutan", actor: "assigned_team", tone: "danger", toStatus: "needs_follow_up", actionLabel: "Menandai butuh tindakan lanjutan", requiresNote: true, notePlaceholder: "Kendala yang menyebabkan butuh tindakan lanjutan" },
  ],
  waiting_reporter_confirmation: [
    { key: "confirm_done", label: "Sudah Selesai", actor: "staff_reporter", tone: "success", toStatus: "reporter_confirmed", actionLabel: "Mengonfirmasi laporan selesai" },
    { key: "still_problem", label: "Masih Bermasalah", actor: "staff_reporter", tone: "danger", toStatus: "needs_follow_up", actionLabel: "Menyatakan masih bermasalah", requiresNote: true, notePlaceholder: "Bagian mana yang masih bermasalah?", requiresPhoto: true },
  ],
  reporter_confirmed: [
    { key: "close", label: "Tutup Laporan", actor: "qhse", tone: "primary", toStatus: "completed", actionLabel: "Menutup laporan", notePlaceholder: "Catatan penutupan (opsional)" },
  ],
  needs_follow_up: [
    { key: "recheck", label: "Minta Cek Ulang", actor: "qhse", tone: "primary", toStatus: "assigned", actionLabel: "Meminta cek ulang" },
    { key: "request_vendor", label: "Teruskan ke Vendor", actor: "qhse", tone: "neutral", toStatus: "needs_follow_up", actionLabel: "Meneruskan ke vendor" },
    { key: "request_purchase", label: "Ajukan Pembelian", actor: "qhse", tone: "neutral", toStatus: "needs_follow_up", actionLabel: "Mengajukan pembelian" },
    { key: "reassign", label: "Ganti Tim Terkait", actor: "qhse", tone: "neutral", toStatus: "assigned", actionLabel: "Mengganti tim terkait" },
    { key: "cancel", label: "Batalkan", actor: "qhse", tone: "danger", toStatus: "cancelled", actionLabel: "Membatalkan laporan", requiresNote: true, notePlaceholder: "Alasan pembatalan" },
  ],
  // Section F/G/H perbaikan alur vendor eksternal — vendor TIDAK login,
  // jadi tidak ada "Mulai Tangani"/"Sedang Ditangani Vendor" (QHSE bukan
  // yang mengerjakan dan belum tentu tahu detail progresnya). QHSE cuma
  // mencatat: sudah dipanggilkan, estimasi kedatangan, lalu begitu teknisi
  // datang langsung minta konfirmasi pelapor (satu aksi, bukan dua).
  external_coordination: [
    { key: "update_arrival_estimate", label: "Update Estimasi Kedatangan", actor: "qhse", tone: "primary", toStatus: "external_coordination", actionLabel: "Memperbarui estimasi kedatangan teknisi" },
    { key: "mark_technician_arrived", label: "Tandai Teknisi Sudah Datang", actor: "qhse", tone: "success", toStatus: "waiting_reporter_confirmation", actionLabel: "Menandai teknisi eksternal sudah datang" },
    { key: "change_handling", label: "Ganti Penanganan", actor: "qhse", tone: "neutral", toStatus: "external_coordination", actionLabel: "Mengganti penanganan" },
    { key: "cancel", label: "Batalkan", actor: "qhse", tone: "danger", toStatus: "cancelled", actionLabel: "Membatalkan laporan", requiresNote: true, notePlaceholder: "Alasan pembatalan" },
  ],
};

// Section E/F perbaikan alur assignment — laporan yang sudah "assigned"
// TAPI belum punya assignedTeam adalah data cacat (biasanya tiket lama dari
// sebelum AssignIssueTicketModal ada, atau bug lain yang lolos validasi).
// Untuk kondisi ini, tombol normal "Mulai Tangani"/"Ganti Tim" TIDAK relevan
// — QHSE harus melengkapi penugasan dulu atau mengembalikan ke review.
const INCOMPLETE_ASSIGNMENT_ACTIONS: IssueActionDef[] = [
  {
    key: "complete_assignment",
    label: "Lengkapi Penugasan",
    actor: "qhse",
    tone: "primary",
    toStatus: "assigned",
    actionLabel: "Melengkapi penugasan",
  },
  {
    key: "revert_to_review",
    label: "Kembalikan ke Ditinjau QHSE",
    actor: "qhse",
    tone: "neutral",
    toStatus: "under_review",
    actionLabel: "Mengembalikan ke ditinjau QHSE",
  },
  {
    key: "cancel",
    label: "Batalkan",
    actor: "qhse",
    tone: "danger",
    toStatus: "cancelled",
    actionLabel: "Membatalkan laporan",
    requiresNote: true,
    notePlaceholder: "Alasan pembatalan",
  },
];

// Ticket dianggap "sudah seharusnya punya tim" begitu lewat under_review —
// kalau di salah satu status ini assignedTeam kosong, itu data tidak
// lengkap yang wajib diberi peringatan (lihat isAssignmentIncomplete).
const STATUSES_REQUIRING_TEAM: IssueTicketStatus[] = [
  "assigned",
  "in_progress",
  "waiting_reporter_confirmation",
  "reporter_confirmed",
  "needs_follow_up",
];

export function isAssignmentIncomplete(ticket: Pick<AssetIssueTicket, "status" | "assignedTeam">): boolean {
  return STATUSES_REQUIRING_TEAM.includes(ticket.status) && !ticket.assignedTeam;
}

const CLOSED_STATUSES: IssueTicketStatus[] = ["completed", "rejected", "duplicate", "cancelled"];

const REOPEN_ACTION: IssueActionDef = {
  key: "reopen",
  label: "Buka Kembali",
  actor: "qhse",
  tone: "neutral",
  toStatus: "under_review",
  actionLabel: "Membuka kembali laporan",
  requiresNote: true,
  notePlaceholder: "Alasan membuka kembali laporan",
};

function isQhse(role: AppRole | null | undefined): boolean {
  return role === "asset_admin" || role === "super_admin";
}

function isAssignedTeamMember(ticket: AssetIssueTicket, currentUid: string | null | undefined): boolean {
  return !!currentUid && ticket.assignedToUid === currentUid;
}

function isReporter(ticket: AssetIssueTicket, currentUid: string | null | undefined): boolean {
  return !!currentUid && ticket.reportedByUid === currentUid;
}

// Section F — helper utama. Return HANYA aksi yang benar-benar boleh
// ditekan oleh currentUser sekarang, berdasarkan status, role, dan
// hubungan currentUser dengan ticket (pelapor / tim yang di-assign).
export function getAvailableIssueTicketActions(
  ticket: Pick<AssetIssueTicket, "status" | "reportedByUid" | "assignedToUid" | "assignedTeam">,
  currentRole: AppRole | null | undefined,
  currentUid: string | null | undefined
): IssueActionDef[] {
  const status = ticket.status;

  if (CLOSED_STATUSES.includes(status)) {
    // Buka Kembali — HANYA Super Admin/QHSE, wajib alasan.
    return isQhse(currentRole) || currentRole === "super_admin" ? [REOPEN_ACTION] : [];
  }

  // Section E/F — data cacat (assigned/in_progress/dst. tapi belum ada
  // assignedTeam) dapat set tombol KHUSUS, bukan tombol normal status itu,
  // supaya QHSE tidak bisa "Mulai Tangani"/dst. di atas penugasan kosong.
  if (isAssignmentIncomplete(ticket) && status === "assigned") {
    return isQhse(currentRole) ? INCOMPLETE_ASSIGNMENT_ACTIONS : [];
  }

  const candidates = ACTIONS_BY_STATUS[status] || [];
  return candidates.filter((action) => {
    if (action.actor === "qhse") return isQhse(currentRole);
    if (action.actor === "staff_reporter") return isReporter(ticket as AssetIssueTicket, currentUid);
    if (action.actor === "assigned_team") {
      // Super Admin ikut bisa menangani kalau kebetulan dia yang di-assign
      // (mis. saat testing/darurat) — tapi normalnya ini tim IT/terkait.
      return isAssignedTeamMember(ticket as AssetIssueTicket, currentUid) || currentRole === "super_admin";
    }
    return false;
  });
}

export function isIssueTicketClosed(status: IssueTicketStatus): boolean {
  return CLOSED_STATUSES.includes(status);
}

// Section E — urutan step timeline visual. reporter_confirmed digabung
// tampil sebagai bagian dari step "Menunggu Konfirmasi Pelapor" supaya
// timeline tidak terlalu panjang, tapi tetap "aktif" beda dari waiting.
export const ISSUE_TIMELINE_STEPS: { key: IssueTicketStatus | "created"; label: string }[] = [
  { key: "created", label: "Laporan Dibuat" },
  { key: "under_review", label: "Ditinjau QHSE" },
  { key: "assigned", label: "Diteruskan ke Tim" },
  { key: "in_progress", label: "Sedang Ditangani" },
  { key: "waiting_reporter_confirmation", label: "Menunggu Konfirmasi Pelapor" },
  { key: "completed", label: "Selesai" },
];

// Index step aktif untuk status tertentu — dipakai buat mewarnai step mana
// yang sudah lewat/aktif/belum jalan. need_more_info dianggap "menempel"
// di step under_review (siklusnya kembali ke situ), needs_follow_up
// dianggap menempel di step sebelum konfirmasi karena masih dalam proses
// penanganan, reporter_confirmed dianggap sudah melewati step konfirmasi.
export function getIssueTimelineActiveIndex(status: IssueTicketStatus): number {
  switch (status) {
    case "reported":
      return 0;
    case "under_review":
    case "need_more_info":
      return 1;
    case "assigned":
      return 2;
    case "in_progress":
    case "external_coordination":
    case "needs_follow_up":
      return 3;
    case "waiting_reporter_confirmation":
      return 4;
    case "reporter_confirmed":
    case "completed":
      return 5;
    case "cancelled":
    case "rejected":
    case "duplicate":
      return -1;
    default:
      return 0;
  }
}

// Section C/G — dipakai bareng oleh AssignIssueTicketModal (saat pertama
// kali teruskan ke teknisi eksternal) dan modal "Update Estimasi
// Kedatangan Teknisi" (saat update belakangan), supaya label yang
// dihasilkan konsisten di kedua tempat.
export type ExternalArrivalOption = "today" | "tomorrow" | "custom" | "asap";

export function computeExternalArrivalEstimate(
  option: ExternalArrivalOption,
  customDate: string,
  customTime: string
): { at: string | null; label: string } {
  const now = new Date();
  const timeSuffix = customTime ? `, sekitar ${customTime}` : "";

  if (option === "asap") {
    return { at: now.toISOString(), label: "Secepatnya" };
  }
  if (option === "today") {
    const d = new Date(now);
    if (customTime) {
      const [h, m] = customTime.split(":").map(Number);
      d.setHours(h || 23, m || 59, 0, 0);
    } else {
      d.setHours(23, 59, 0, 0);
    }
    return { at: d.toISOString(), label: `Hari ini${timeSuffix}` };
  }
  if (option === "tomorrow") {
    const d = new Date(now);
    d.setDate(d.getDate() + 1);
    if (customTime) {
      const [h, m] = customTime.split(":").map(Number);
      d.setHours(h || 23, m || 59, 0, 0);
    } else {
      d.setHours(23, 59, 0, 0);
    }
    return { at: d.toISOString(), label: `Besok${timeSuffix}` };
  }
  // custom
  if (!customDate) return { at: null, label: "" };
  const d = new Date(customDate);
  if (Number.isNaN(d.getTime())) return { at: null, label: "" };
  if (customTime) {
    const [h, m] = customTime.split(":").map(Number);
    d.setHours(h || 0, m || 0, 0, 0);
  }
  const dateLabel = d.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
  return { at: d.toISOString(), label: `${dateLabel}${timeSuffix}` };
}
 