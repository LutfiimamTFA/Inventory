import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getMessaging } from "firebase-admin/messaging";
import { getFirestore } from "firebase-admin/firestore";

// Firebase Admin SDK — HANYA boleh diimpor dari server (API routes / route.ts).
// Jangan pernah import file ini dari komponen "use client".
let adminApp: App | undefined;
let adminInitError: string | null = null;

function normalizePrivateKey(raw?: string) {
  if (!raw) return "";

  return raw
    .replace(/^"|"$/g, "")
    .replace(/\\n/g, "\n")
    .trim();
}

export function getFirebaseAdminStatus() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY;

  const missing: string[] = [];

  if (!projectId) missing.push("FIREBASE_PROJECT_ID");
  if (!clientEmail) missing.push("FIREBASE_CLIENT_EMAIL");
  if (!privateKey) missing.push("FIREBASE_PRIVATE_KEY");

  return {
    ok: missing.length === 0 && !adminInitError,
    missing,
    error: adminInitError,
    hasProjectId: !!projectId,
    hasClientEmail: !!clientEmail,
    hasPrivateKey: !!privateKey,
  };
}

function getAdminApp(): App | undefined {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY);

  const missing: string[] = [];
  if (!projectId) missing.push("FIREBASE_PROJECT_ID");
  if (!clientEmail) missing.push("FIREBASE_CLIENT_EMAIL");
  if (!privateKey) missing.push("FIREBASE_PRIVATE_KEY");

  if (missing.length > 0) {
    adminInitError = `Firebase Admin env belum lengkap: ${missing.join(", ")}`;
    console.error("[Firebase Admin]", adminInitError);
    return undefined;
  }

  try {
    if (getApps().length > 0) {
      adminApp = getApps()[0];
      return adminApp;
    }

    adminApp = initializeApp({
      credential: cert({
        projectId,
        clientEmail,
        privateKey,
      }),
    });

    adminInitError = null;
    return adminApp;
  } catch (error) {
    adminInitError =
      error instanceof Error
        ? error.message
        : "Firebase Admin gagal initialize.";

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
