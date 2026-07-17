import { addDoc, collection, getDocs, limit, query, serverTimestamp, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { cleanFirestoreData } from "@/lib/firestore-helpers";
import {
  AppRole,
  NotificationPriority,
  NotificationRelatedType,
  NotificationType,
} from "@/lib/types";

export async function createAssetNotification(params: {
  recipientUid: string;
  recipientName: string;
  recipientRole: AppRole;
  title: string;
  message: string;
  type: NotificationType;
  priority: NotificationPriority;
  linkUrl?: string;
  relatedType?: NotificationRelatedType;
  relatedId?: string;
  relatedNumber?: string;
  dedupeKey?: string;
  createdByUid?: string;
  createdByName?: string;
  oldData?: Record<string, unknown>;
  newData?: Record<string, unknown>;
  changeSummary?: string[];
}): Promise<string> {
  // Selalu dibersihkan dari `undefined` — addDoc melempar error kalau ada
  // field bernilai undefined (mis. createdByUid tidak diisi caller).
  const payload = cleanFirestoreData({
    ...params,
    isRead: false,
  }) as Record<string, unknown>;

  const ref = await addDoc(collection(db, "asset_notifications"), {
    ...payload,
    createdAt: serverTimestamp(),
  });

  // Trigger web push secara best-effort (fire-and-forget). Kegagalan push
  // tidak boleh mengganggu flow utama (ticket/work order tetap tersimpan),
  // makanya errornya cukup di-log, bukan di-throw.
  fetch("/api/notifications/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipientUid: params.recipientUid,
      title: params.title,
      message: params.message,
      linkUrl: params.linkUrl,
    }),
  }).catch((err) => console.debug("[Notifications] push gagal dikirim", err));

  return ref.id;
}

// Bandingkan dua snapshot data (mis. work order sebelum/sesudah edit) dan
// hasilkan ringkasan field apa saja yang berubah — dipakai untuk mengisi
// changeSummary di notifikasi "X diperbarui" supaya penerima tahu apa yang
// berubah tanpa harus buka detailnya dulu.
const CHANGE_SUMMARY_IGNORED_FIELDS = [
  "updatedAt",
  "updatedByUid",
  "updatedByName",
  "lastActivityAt",
  "lastActivityByUid",
  "lastActivityByName",
];

export function getChangeSummary(
  oldData: Record<string, unknown> | null | undefined,
  newData: Record<string, unknown> | null | undefined
) {
  const changedFields: string[] = [];

  Object.keys(newData || {}).forEach((key) => {
    if (CHANGE_SUMMARY_IGNORED_FIELDS.includes(key)) return;
    const oldValue = JSON.stringify(oldData?.[key] ?? null);
    const newValue = JSON.stringify(newData?.[key] ?? null);
    if (oldValue !== newValue) changedFields.push(key);
  });

  return {
    changedFields,
    changedCount: changedFields.length,
    label:
      changedFields.length > 0
        ? `Perubahan pada: ${changedFields.join(", ")}`
        : "Data diperbarui",
  };
}

// ── Ringkasan perubahan yang human-readable ("Label: lama → baru") ─────────
// dipakai untuk mengisi changeSummary + isi pesan notifikasi supaya
// penerima langsung tahu APA yang berubah, bukan cuma "X diperbarui".

interface FirestoreTimestampLike {
  toDate: () => Date;
}

function hasToDate(value: unknown): value is FirestoreTimestampLike {
  return (
    typeof value === "object" &&
    value !== null &&
    "toDate" in value &&
    typeof (value as FirestoreTimestampLike).toDate === "function"
  );
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null || value === "") return "-";

  if (hasToDate(value)) {
    return value.toDate().toLocaleDateString("id-ID", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  }

  if (value instanceof Date) {
    return value.toLocaleDateString("id-ID", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  }

  if (typeof value === "boolean") return value ? "Ya" : "Tidak";

  if (Array.isArray(value)) return `${value.length} item`;

  if (typeof value === "object") return JSON.stringify(value);

  return String(value);
}

// Field teknis (uid, id, timestamp mentah) SENGAJA tidak dikasih label —
// artinya tidak akan pernah muncul ke user lewat buildChangeSummary, hanya
// field yang ada di FIELD_LABELS/IMPORTANT_FIELDS yang ditampilkan.
const FIELD_LABELS: Record<string, string> = {
  title: "Judul",
  frequencyMonths: "Frekuensi",
  scheduledDayOfMonth: "Tanggal Maintenance",
  dueDateKey: "Jatuh Tempo",
  currentDueDateKey: "Jatuh Tempo",
  nextDueDateKey: "Jadwal Berikutnya",
  maintenanceLocationText: "Lokasi",
  locationText: "Lokasi",
  assignedToName: "Teknisi",
  technicianName: "Teknisi",
  assignedToEmail: "Email Teknisi",
  priority: "Prioritas",
  qhseNote: "Catatan QHSE",
  note: "Catatan",
  status: "Status",
  assetIds: "Jumlah Asset",
  assetName: "Nama Asset",
  categoryId: "Kategori",
  responsiblePersonUid: "Penanggung Jawab",
  ownershipStatus: "Status Kepemilikan",
  assetStatus: "Status Asset",
  condition: "Kondisi",
};

const IMPORTANT_FIELDS = Object.keys(FIELD_LABELS);

export function buildChangeSummary(
  oldData: Record<string, unknown> | null | undefined,
  newData: Record<string, unknown> | null | undefined
): string[] {
  const changes: string[] = [];

  IMPORTANT_FIELDS.forEach((key) => {
    // Hanya bandingkan field yang benar-benar ada di newData — kalau
    // caller sengaja tidak menyertakan field tertentu (mis. field terkunci
    // karena status work order tidak mengizinkan diedit), field itu tidak
    // boleh dianggap "berubah jadi kosong".
    if (!(key in (newData || {}))) return;
    const oldText = formatValue(oldData?.[key]);
    const newText = formatValue(newData?.[key]);
    if (oldText !== newText) {
      const label = FIELD_LABELS[key] || key;
      changes.push(`${label}: ${oldText} → ${newText}`);
    }
  });

  return changes;
}

// Gabungkan kalimat pembuka + maksimal N bullet perubahan jadi satu pesan
// multiline siap tampil di NotificationBell (whitespace-pre-line).
export function buildChangeMessage(intro: string, changes: string[], max = 4): string {
  if (changes.length === 0) return intro;
  const bullets = changes.slice(0, max).map((c) => `• ${c}`).join("\n");
  return `${intro}\n${bullets}`;
}

// Helper terpusat untuk notifikasi ke banyak penerima sekaligus (mis. edit
// jadwal maintenance yang harus memberi tahu QHSE + Tim IT bersamaan) —
// membungkus createAssetNotification per recipientUid supaya call site tidak
// perlu Promise.all manual tiap kali, dan changeSummary/oldData/newData
// otomatis disertakan kalau ada.
export async function createAssetViewNotification(params: {
  recipientUids: { uid: string; name: string; role: AppRole }[];
  title: string;
  message: string;
  type: NotificationType;
  priority: NotificationPriority;
  linkUrl?: string;
  relatedType?: NotificationRelatedType;
  relatedId?: string;
  relatedNumber?: string;
  oldData?: Record<string, unknown>;
  newData?: Record<string, unknown>;
  changeSummary?: string[];
  createdByUid?: string;
  createdByName?: string;
  dedupeKey?: string;
}): Promise<void> {
  const uniqueRecipients = Array.from(
    new Map(params.recipientUids.filter((r) => !!r.uid).map((r) => [r.uid, r])).values()
  );

  await Promise.all(
    uniqueRecipients.map((recipient) =>
      createAssetNotification({
        recipientUid: recipient.uid,
        recipientName: recipient.name,
        recipientRole: recipient.role,
        title: params.title,
        message: params.message,
        type: params.type,
        priority: params.priority,
        linkUrl: params.linkUrl,
        relatedType: params.relatedType,
        relatedId: params.relatedId,
        relatedNumber: params.relatedNumber,
        oldData: params.oldData,
        newData: params.newData,
        changeSummary: params.changeSummary,
        createdByUid: params.createdByUid,
        createdByName: params.createdByName,
        dedupeKey: params.dedupeKey,
      })
    )
  );
}

// Cegah notifikasi overdue dikirim berulang tiap kali halaman dibuka —
// cek dulu apakah dedupeKey hari ini sudah pernah dibuat.
export async function dedupeKeyExists(dedupeKey: string): Promise<boolean> {
  const q = query(
    collection(db, "asset_notifications"),
    where("dedupeKey", "==", dedupeKey),
    limit(1)
  );
  const snap = await getDocs(q);
  return !snap.empty;
}

export function buildOverdueDedupeKey(workOrderNumber: string) {
  const today = new Date();
  const datePart = `${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(
    today.getDate()
  ).padStart(2, "0")}`;
  return `maintenance_overdue_${workOrderNumber}_${datePart}`;
}
