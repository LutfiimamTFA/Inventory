"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  collection,
  doc,
  limit,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
  writeBatch,
} from "firebase/firestore";
import { Bell, BellRing } from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { AssetNotification } from "@/lib/types";
import { NOTIFICATION_PRIORITY_COLOR, NOTIFICATION_TYPE_LABEL, formatRelativeTime } from "@/lib/utils";
import { checkPushStatus, disableWebPush, enableWebPush } from "@/lib/push-notifications";
import Badge from "@/components/Badge";

export default function NotificationBell() {
  const { firebaseUser, assetUser, role, loading } = useAuth();
  const authReady = !loading && !!firebaseUser && !!assetUser && !!role;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<AssetNotification[]>([]);
  const [pushStatus, setPushStatus] = useState<
    "checking" | "requesting" | "active" | "inactive" | "denied" | "unsupported" | "error"
  >("checking");
  const [pushError, setPushError] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);

  // Cek status push setiap kali NotificationBell dimuat (termasuk setelah
  // login ulang) — kalau permission browser sudah granted dan token masih
  // valid, tombol langsung tampil aktif tanpa minta izin ulang.
  useEffect(() => {
    if (!authReady || !assetUser?.uid) return;
    let cancelled = false;
    checkPushStatus({
      uid: assetUser.uid,
      email: assetUser.email,
      name: assetUser.name,
      role: assetUser.role,
    })
      .then((result) => {
        if (cancelled) return;
        setPushStatus(result.status);
        if (result.status === "error" && result.message) setPushError(result.message);
      })
      .catch((err) => {
        console.error("[NotificationBell] checkPushStatus error:", err);
        if (cancelled) return;
        setPushStatus("error");
        setPushError("Gagal memeriksa status notifikasi.");
      });
    return () => {
      cancelled = true;
    };
  }, [authReady, assetUser?.uid, assetUser?.email, assetUser?.name, assetUser?.role]);

  useEffect(() => {
    if (!authReady || !assetUser?.uid) return;
    console.log("[NotificationBell Current User]", {
      uid: firebaseUser?.uid,
      email: firebaseUser?.email,
      role: assetUser?.role,
    });
    const q = query(
      collection(db, "asset_notifications"),
      where("recipientUid", "==", assetUser.uid),
      orderBy("createdAt", "desc"),
      limit(30)
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        console.log("[Listener] asset_notifications success:", snap.size);
        setNotifications(snap.docs.map((d) => ({ id: d.id, ...d.data() } as AssetNotification)));
      },
      (error) => {
        console.error("[Listener] asset_notifications error:", error);
      }
    );
    return () => unsub();
  }, [authReady, assetUser?.uid, assetUser?.role, firebaseUser?.uid, firebaseUser?.email]);

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [open]);

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.isRead).length,
    [notifications]
  );

  const handleClickNotification = async (n: AssetNotification) => {
    if (!n.isRead) {
      await updateDoc(doc(db, "asset_notifications", n.id), {
        isRead: true,
        readAt: new Date(),
      });
    }
    setOpen(false);
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

  const handleEnablePush = async () => {
    if (!assetUser) return;
    setPushStatus("requesting");
    setPushError("");
    try {
      const result = await enableWebPush({
        uid: assetUser.uid,
        email: assetUser.email,
        name: assetUser.name,
        role: assetUser.role,
      });
      setPushStatus(result.status);
      if (result.status === "error" && result.message) setPushError(result.message);
    } catch (err) {
      // enableWebPush sudah menangkap error internal dan tidak seharusnya
      // throw — try/catch ini cuma jaring pengaman terakhir supaya klik
      // "Aktifkan Notifikasi" tidak pernah memunculkan overlay error Next.js.
      console.error("[NotificationBell] enableWebPush error:", err);
      setPushStatus("error");
      setPushError("Gagal mengaktifkan notifikasi. Refresh halaman lalu coba lagi.");
    }
  };

  const handleDisablePush = async () => {
    if (!assetUser) return;
    setPushStatus("requesting");
    await disableWebPush({
      uid: assetUser.uid,
      email: assetUser.email,
      name: assetUser.name,
      role: assetUser.role,
    });
    setPushStatus("inactive");
  };

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative flex items-center justify-center h-9 w-9 rounded-full text-slate-600 cursor-pointer hover:bg-slate-100"
        title="Notifikasi"
      >
        {unreadCount > 0 ? <BellRing size={19} /> : <Bell size={19} />}
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center">
            {unreadCount > 9 ? "9+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white rounded-2xl border border-slate-200 shadow-lg z-40 max-h-[28rem] overflow-y-auto">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
            <h3 className="text-sm font-semibold text-slate-800">Notifikasi</h3>
            <button
              type="button"
              onClick={handleMarkAllRead}
              className="text-xs font-medium text-blue-600 cursor-pointer hover:underline"
            >
              Tandai semua dibaca
            </button>
          </div>

          {notifications.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-10">Belum ada notifikasi.</p>
          ) : (
            <div className="divide-y divide-slate-100">
              {notifications.map((n) => (
                <button
                  key={n.id}
                  type="button"
                  onClick={() => handleClickNotification(n)}
                  className={`w-full text-left px-4 py-3 cursor-pointer hover:bg-slate-50 transition-colors ${
                    !n.isRead ? "bg-blue-50/50" : ""
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <p className="text-sm font-medium text-slate-800 truncate">{n.title}</p>
                    {!n.isRead && <span className="h-2 w-2 rounded-full bg-blue-500 shrink-0" />}
                  </div>
                  <p className="whitespace-pre-line text-xs text-slate-500 mb-1.5">{n.message}</p>
                  {!!n.changeSummary && n.changeSummary.length > 0 && (
                    <div className="mb-1.5 rounded-lg bg-slate-50 p-2 text-[11px] text-slate-600">
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
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge
                      label={NOTIFICATION_TYPE_LABEL[n.type]}
                      colorClass={NOTIFICATION_PRIORITY_COLOR[n.priority]}
                    />
                    <span className="text-[11px] text-slate-400">
                      {formatRelativeTime(n.createdAt)}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}

          <div className="border-t border-slate-100 px-4 py-3 space-y-2">
            {pushStatus === "active" && (
              <div className="space-y-1">
                <button
                  type="button"
                  disabled
                  className="w-full text-xs font-medium text-emerald-700 border border-emerald-200 bg-emerald-50 rounded-lg py-1.5 cursor-default"
                >
                  Notifikasi Browser Aktif
                </button>
                <button
                  type="button"
                  onClick={handleDisablePush}
                  className="w-full text-[11px] font-medium text-slate-400 cursor-pointer hover:text-slate-600 hover:underline"
                >
                  Nonaktifkan Notifikasi
                </button>
              </div>
            )}
            {(pushStatus === "inactive" || pushStatus === "checking" || pushStatus === "requesting") && (
              <button
                type="button"
                onClick={handleEnablePush}
                disabled={pushStatus === "requesting" || pushStatus === "checking"}
                className="w-full text-xs font-medium text-slate-600 border border-slate-200 rounded-lg py-1.5 cursor-pointer hover:bg-slate-50 disabled:opacity-60"
              >
                {pushStatus === "requesting"
                  ? "Meminta izin..."
                  : pushStatus === "checking"
                  ? "Memeriksa status..."
                  : "Aktifkan Notifikasi Browser"}
              </button>
            )}
            {pushStatus === "denied" && (
              <div className="space-y-1">
                <p className="text-xs font-medium text-amber-700 border border-amber-200 bg-amber-50 rounded-lg py-1.5 text-center">
                  Notifikasi diblokir browser
                </p>
                <p className="text-[11px] text-slate-400">
                  Aktifkan kembali izin notifikasi dari pengaturan browser Anda, lalu muat ulang
                  halaman ini.
                </p>
              </div>
            )}
            {pushStatus === "unsupported" && (
              <p className="text-[11px] text-slate-400">
                Browser ini tidak mendukung web push notification.
              </p>
            )}
            {pushStatus === "error" && pushError && (
              <p className="text-[11px] text-red-600">{pushError}</p>
            )}
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                router.push("/notifications");
              }}
              className="w-full text-xs font-medium text-blue-600 cursor-pointer hover:underline text-center"
            >
              Lihat semua notifikasi
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
