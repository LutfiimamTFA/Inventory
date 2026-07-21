import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getMessaging } from "firebase-admin/messaging";
import { getFirestore } from "firebase-admin/firestore";

// Firebase Admin SDK — HANYA boleh diimpor dari server (API routes / route.ts).
// Jangan pernah import file ini dari komponen "use client".
let adminApp: App | undefined;

function getAdminApp(): App | undefined {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const rawPrivateKey = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !rawPrivateKey) {
    console.error("[Firebase Admin] Env belum lengkap:", {
      hasProjectId: !!projectId,
      hasClientEmail: !!clientEmail,
      hasPrivateKey: !!rawPrivateKey,
    });
    return undefined;
  }

  const privateKey = rawPrivateKey.replace(/\\n/g, "\n");

  try {
    if (getApps().length > 0) {
      adminApp = getApps()[0];
      return adminApp;
    }

    adminApp = initializeApp({
      credential: cert({ projectId, clientEmail, privateKey }),
    });
    return adminApp;
  } catch (error) {
    console.error("[Firebase Admin] gagal initialize:", error);
    return undefined;
  }
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

export function getAdminAuth() {
  const app = getAdminApp();
  if (!app) return null;
  return getAuth(app);
}
