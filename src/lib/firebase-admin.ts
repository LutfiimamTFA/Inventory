import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import { getFirestore } from "firebase-admin/firestore";

// Firebase Admin SDK — HANYA boleh diimpor dari server (API routes / route.ts).
// Jangan pernah import file ini dari komponen "use client".
let adminApp: App | undefined;

function getAdminApp(): App | undefined {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    console.warn("[Firebase Admin] env belum lengkap, push notification dilewati");
    return undefined;
  }

  if (getApps().length > 0) {
    adminApp = getApps()[0];
    return adminApp;
  }

  adminApp = initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
  });
  return adminApp;
}

export function getAdminMessaging() {
  const app = getAdminApp();
  if (!app) return null;
  return getMessaging(app);
}

export function getAdminFirestore() {
  const app = getAdminApp();
  if (!app) return null;
  return getFirestore(app);
}
