/* Service worker AssetView untuk background web push (Firebase Cloud Messaging).
   Nilai di bawah ini adalah Firebase client config publik (NEXT_PUBLIC_*),
   sama seperti yang sudah ada di bundle client — bukan rahasia. */
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "AIzaSyDqMdXWhOikeYNqJo9XTMvZ63Hmmgixsfk",
  authDomain: "studio-9262077557-bc9c9.firebaseapp.com",
  projectId: "studio-9262077557-bc9c9",
  storageBucket: "studio-9262077557-bc9c9.firebasestorage.app",
  messagingSenderId: "80532457942",
  appId: "1:80532457942:web:b370536157cf3450243c77",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || "AssetView";
  const body = payload.notification?.body || "";
  const link = payload.fcmOptions?.link || payload.data?.linkUrl || "/notifications";

  self.registration.showNotification(title, {
    body,
    icon: "/logo.png",
    data: { link },
  });
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const link = event.notification.data?.link || "/notifications";
  event.waitUntil(clients.openWindow(link));
});
