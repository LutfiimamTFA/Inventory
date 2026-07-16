import { addDoc, collection, getDocs, limit, query, serverTimestamp, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
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
}): Promise<string> {
  const ref = await addDoc(collection(db, "asset_notifications"), {
    ...params,
    isRead: false,
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
