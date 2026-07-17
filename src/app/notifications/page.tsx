"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { Bell } from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { AssetNotification, NotificationType } from "@/lib/types";
import {
  NOTIFICATION_PRIORITY_COLOR,
  NOTIFICATION_TYPE_LABEL,
  formatDateTime,
} from "@/lib/utils";
import ProtectedLayout from "@/components/ProtectedLayout";
import PageHeader from "@/components/PageHeader";
import Badge from "@/components/Badge";
import EmptyState from "@/components/EmptyState";

type ReadFilter = "all" | "unread" | "read";

export default function NotificationsPage() {
  const { firebaseUser, assetUser, role, loading } = useAuth();
  const authReady = !loading && !!firebaseUser && !!assetUser && !!role;
  const router = useRouter();
  const [notifications, setNotifications] = useState<AssetNotification[]>([]);
  const [readFilter, setReadFilter] = useState<ReadFilter>("all");
  const [typeFilter, setTypeFilter] = useState<NotificationType | "">("");

  useEffect(() => {
    if (!authReady || !assetUser?.uid) return;
    const q = query(
      collection(db, "asset_notifications"),
      where("recipientUid", "==", assetUser.uid),
      orderBy("createdAt", "desc")
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        console.log("[NotificationsPage Listener] asset_notifications success:", snap.size);
        setNotifications(snap.docs.map((d) => ({ id: d.id, ...d.data() } as AssetNotification)));
      },
      (error) => {
        console.error("[NotificationsPage Listener] asset_notifications error:", error);
      }
    );
    return () => unsub();
  }, [authReady, assetUser?.uid]);

  const filtered = useMemo(() => {
    return notifications.filter((n) => {
      if (readFilter === "unread" && n.isRead) return false;
      if (readFilter === "read" && !n.isRead) return false;
      if (typeFilter && n.type !== typeFilter) return false;
      return true;
    });
  }, [notifications, readFilter, typeFilter]);

  const usedTypes = useMemo(
    () => Array.from(new Set(notifications.map((n) => n.type))),
    [notifications]
  );

  const handleClick = async (n: AssetNotification) => {
    if (!n.isRead) {
      await updateDoc(doc(db, "asset_notifications", n.id), { isRead: true, readAt: new Date() });
    }
    if (n.linkUrl) router.push(n.linkUrl);
  };

  const handleMarkAllRead = async () => {
    const unread = notifications.filter((n) => !n.isRead);
    if (unread.length === 0) return;
    const batch = writeBatch(db);
    unread.forEach((n) => {
      batch.update(doc(db, "asset_notifications", n.id), { isRead: true, readAt: new Date() });
    });
    await batch.commit();
  };

  return (
    <ProtectedLayout>
      <PageHeader
        title="Notifikasi"
        subtitle="Semua notifikasi untuk akun Anda."
        actions={
          <button
            type="button"
            onClick={handleMarkAllRead}
            className="rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium cursor-pointer hover:bg-slate-50"
          >
            Tandai semua dibaca
          </button>
        }
      />

      <div className="flex flex-wrap gap-2 mb-4">
        {(["all", "unread", "read"] as ReadFilter[]).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setReadFilter(f)}
            className={`rounded-xl border px-3 py-1.5 text-sm font-medium cursor-pointer transition-colors ${
              readFilter === f
                ? "border-blue-500 bg-blue-50 text-blue-700"
                : "border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
          >
            {f === "all" ? "Semua" : f === "unread" ? "Belum Dibaca" : "Sudah Dibaca"}
          </button>
        ))}
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as NotificationType | "")}
          className="input text-sm cursor-pointer w-auto"
        >
          <option value="">Semua Tipe</option>
          {usedTypes.map((t) => (
            <option key={t} value={t}>
              {NOTIFICATION_TYPE_LABEL[t]}
            </option>
          ))}
        </select>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {filtered.length === 0 ? (
          <EmptyState icon={Bell} title="Tidak ada notifikasi" />
        ) : (
          <div className="divide-y divide-slate-100">
            {filtered.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => handleClick(n)}
                className={`w-full text-left px-5 py-4 cursor-pointer hover:bg-slate-50 transition-colors ${
                  !n.isRead ? "bg-blue-50/40" : ""
                }`}
              >
                <div className="flex items-center justify-between gap-2 mb-1">
                  <p className="text-sm font-medium text-slate-800">{n.title}</p>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs text-slate-400">{formatDateTime(n.createdAt)}</span>
                    {!n.isRead && <span className="h-2 w-2 rounded-full bg-blue-500" />}
                  </div>
                </div>
                <p className="whitespace-pre-line text-sm text-slate-500 mb-2">{n.message}</p>
                {!!n.changeSummary && n.changeSummary.length > 0 && (
                  <div className="mb-2 rounded-lg bg-slate-50 p-2 text-xs text-slate-600">
                    {n.changeSummary.slice(0, 3).map((change, index) => (
                      <div key={index}>• {change}</div>
                    ))}
                    {n.changeSummary.length > 3 && (
                      <div className="text-slate-400">
                        +{n.changeSummary.length - 3} perubahan lain
                      </div>
                    )}
                  </div>
                )}
                <Badge
                  label={NOTIFICATION_TYPE_LABEL[n.type]}
                  colorClass={NOTIFICATION_PRIORITY_COLOR[n.priority]}
                />
              </button>
            ))}
          </div>
        )}
      </div>
    </ProtectedLayout>
  );
}
