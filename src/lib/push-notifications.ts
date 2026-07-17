import { getToken, getMessaging, isSupported } from "firebase/messaging";
import {
  addDoc,
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { app, db } from "@/lib/firebase";
import { AppRole } from "@/lib/types";

export type PushStatus = "active" | "inactive" | "denied" | "unsupported" | "error";

export interface PushStatusResult {
  status: PushStatus;
  message?: string;
}

export const PUSH_ENABLED_CACHE_KEY = "assetview_push_enabled";

interface PushUser {
  uid: string;
  email: string;
  name: string;
  role: AppRole;
}

function detectBrowser(userAgent: string) {
  if (userAgent.includes("Edg/")) return "Edge";
  if (userAgent.includes("Chrome/")) return "Chrome";
  if (userAgent.includes("Firefox/")) return "Firefox";
  if (userAgent.includes("Safari/")) return "Safari";
  return "Unknown";
}

// Registrasi service worker SAJA tidak cukup — kalau getToken()/subscribe()
// dipanggil sebelum registration-nya benar-benar "active", PushManager
// melempar "Failed to execute 'subscribe' on 'PushManager': Subscription
// failed - no active Service Worker". Wajib tunggu navigator.serviceWorker
// .ready dulu sebelum registration ini dipakai untuk getToken().
async function getActiveFirebaseMessagingSW(): Promise<ServiceWorkerRegistration> {
  if (typeof window === "undefined") {
    throw new Error("Service worker hanya tersedia di browser.");
  }
  if (!("serviceWorker" in navigator)) {
    throw new Error("Browser tidak mendukung Service Worker.");
  }

  const registration = await navigator.serviceWorker.register("/firebase-messaging-sw.js", {
    scope: "/",
  });
  console.log("[Push Notifications] service worker registered:", registration.scope);

  const readyRegistration = await navigator.serviceWorker.ready;

  if (!readyRegistration.active) {
    throw new Error("Service Worker belum aktif. Refresh halaman lalu coba lagi.");
  }
  console.log(
    "[Push Notifications] service worker active:",
    readyRegistration.active.scriptURL
  );

  return readyRegistration;
}

// Ambil FCM token dari browser TANPA meminta permission — caller wajib
// memastikan Notification.permission sudah "granted" sebelum memanggil ini.
// Semua kegagalan (termasuk AbortError dari PushManager.subscribe) ditangkap
// di sini dan dikembalikan sebagai { error } — TIDAK PERNAH throw ke caller,
// supaya tidak muncul sebagai overlay error Next.js.
async function getMessagingToken(): Promise<{ token: string } | { error: string }> {
  try {
    const supported = await isSupported().catch(() => false);
    if (!supported || typeof window === "undefined" || !("serviceWorker" in navigator)) {
      return { error: "unsupported" };
    }

    const vapidKey = process.env.NEXT_PUBLIC_FIREBASE_VAPID_KEY;
    if (!vapidKey) {
      console.warn("[Push Notifications] NEXT_PUBLIC_FIREBASE_VAPID_KEY belum diset");
      return { error: "Konfigurasi push notification belum lengkap." };
    }

    const registration = await getActiveFirebaseMessagingSW();

    const messaging = getMessaging(app);
    const token = await getToken(messaging, {
      vapidKey,
      serviceWorkerRegistration: registration,
    });

    console.log("[Push Notifications] token:", token ? "available" : "empty");
    if (!token) return { error: "Gagal mendapatkan token push notification." };
    return { token };
  } catch (err) {
    console.error("[Push Notifications] getMessagingToken error:", err);
    return {
      error:
        err instanceof Error
          ? err.message
          : "Gagal mengaktifkan notifikasi browser.",
    };
  }
}

// Cari token existing milik user ini (uid+token) supaya tidak membuat
// dokumen baru terus-menerus setiap kali dicek/login ulang — kalau sudah
// ada, cukup update lastUsedAt/isActive.
async function syncPushToken(user: PushUser, token: string): Promise<string> {
  const q = query(
    collection(db, "asset_notification_tokens"),
    where("uid", "==", user.uid),
    where("token", "==", token)
  );
  const snap = await getDocs(q);

  if (!snap.empty) {
    const existing = snap.docs[0];
    await updateDoc(doc(db, "asset_notification_tokens", existing.id), {
      isActive: true,
      email: user.email,
      displayName: user.name,
      role: user.role,
      updatedAt: serverTimestamp(),
      lastUsedAt: serverTimestamp(),
    });
    console.debug("[Push Notifications] token synced:", existing.id);
    return existing.id;
  }

  const ref = await addDoc(collection(db, "asset_notification_tokens"), {
    uid: user.uid,
    email: user.email,
    displayName: user.name,
    role: user.role,
    token,
    platform: typeof navigator !== "undefined" ? navigator.platform || "web" : "web",
    browser: typeof navigator !== "undefined" ? detectBrowser(navigator.userAgent) : "Unknown",
    userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "",
    isActive: true,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
    lastUsedAt: serverTimestamp(),
  });
  console.debug("[Push Notifications] token synced:", ref.id);
  return ref.id;
}

// Dipanggil setiap load NotificationBell (termasuk setelah login ulang).
// Tidak pernah memanggil Notification.requestPermission() — hanya membaca
// status yang sudah ada, supaya user yang sudah granted tidak diminta izin
// lagi setiap login.
export async function checkPushStatus(user: PushUser): Promise<PushStatusResult> {
  try {
    if (typeof window === "undefined" || !("Notification" in window)) {
      return { status: "unsupported" };
    }

    const permission = Notification.permission;
    console.debug("[Push Notifications] permission:", permission);

    if (permission === "denied") return { status: "denied" };
    if (permission !== "granted") return { status: "inactive" };

    const tokenResult = await getMessagingToken();
    if ("error" in tokenResult) {
      console.debug("[Push Notifications] token exists:", false);
      if (tokenResult.error === "unsupported") return { status: "unsupported" };
      return { status: "error", message: tokenResult.error };
    }
    console.debug("[Push Notifications] token exists:", true);

    await syncPushToken(user, tokenResult.token);
    if (typeof window !== "undefined") localStorage.setItem(PUSH_ENABLED_CACHE_KEY, "true");
    console.debug("[Push Notifications] status active:", true);

    return { status: "active" };
  } catch (err) {
    console.error("[Push Notifications] error:", err);
    return { status: "error", message: "Terjadi kesalahan saat memeriksa status notifikasi." };
  }
}

// Dipanggil saat user klik "Aktifkan Notifikasi Browser". Hanya meminta
// permission kalau belum granted.
export async function enableWebPush(user: PushUser): Promise<PushStatusResult> {
  try {
    if (typeof window === "undefined" || !("Notification" in window)) {
      return { status: "unsupported" };
    }

    let permission = Notification.permission;
    if (permission !== "granted") {
      permission = await Notification.requestPermission();
    }
    console.debug("[Push Notifications] permission:", permission);

    if (permission === "denied") return { status: "denied" };
    if (permission !== "granted") return { status: "inactive" };

    return await checkPushStatus(user);
  } catch (err) {
    console.error("[Push Notifications] error:", err);
    return { status: "error", message: "Terjadi kesalahan saat mengaktifkan notifikasi." };
  }
}

// Hanya dipanggil saat user secara eksplisit klik "Nonaktifkan Notifikasi" —
// TIDAK dipanggil saat logout, supaya push tetap terkirim walau user logout
// atau web tidak dibuka.
export async function disableWebPush(user: PushUser): Promise<void> {
  const q = query(collection(db, "asset_notification_tokens"), where("uid", "==", user.uid));
  const snap = await getDocs(q);
  await Promise.all(
    snap.docs.map((d) =>
      updateDoc(doc(db, "asset_notification_tokens", d.id), {
        isActive: false,
        updatedAt: serverTimestamp(),
      })
    )
  );
  if (typeof window !== "undefined") localStorage.removeItem(PUSH_ENABLED_CACHE_KEY);
}
