import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getMessaging } from "firebase-admin/messaging";
import { getFirestore } from "firebase-admin/firestore";

// Firebase Admin SDK — HANYA boleh diimpor dari server (API routes / route.ts).
// Jangan pernah import file ini dari komponen "use client".
let adminApp: App | undefined;
let adminInitError: string | null = null;

// Section "Perbaiki bug kritis Public QR" — env var private key sering rusak
// SPESIFIK saat disalin ke dashboard Vercel (bukan di lokal, karena
// .env/.env.local dibaca apa adanya oleh dotenv): tanda kutip pembungkus
// ganda/tunggal ikut tersimpan, "\n" literal dua-karakter TIDAK selalu
// konsisten di-unescape tergantung cara environment variable itu di-paste,
// dan kadang ada carriage return (\r) sisa dari copy-paste di Windows.
// Normalisasi ini menangani SEMUA kemungkinan itu sekaligus supaya
// cert() tidak gagal parse PEM hanya karena format env var berbeda antara
// lokal dan Vercel — bukan mengubah isi key, cuma bentuk representasinya.
function normalizePrivateKey(raw?: string) {
  if (!raw) return "";

  let key = raw.trim();

  // Tanda kutip pembungkus bisa berlapis (mis. '"..."' tersimpan sebagai
  // string literal lengkap dengan kutipnya) — lucuti berulang, bukan sekali.
  while (
    (key.startsWith('"') && key.endsWith('"')) ||
    (key.startsWith("'") && key.endsWith("'"))
  ) {
    key = key.slice(1, -1).trim();
  }

  key = key.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  return key.trim();
}

// Section — bentuk PEM yang valid SELALU diawali/diakhiri header/footer ini
// setelah normalizePrivateKey() menormalkan newline — kalau tidak, hampir
// pasti env var-nya rusak saat disalin ke dashboard Vercel (paling sering:
// newline tidak ter-unescape atau key terpotong), BUKAN masalah di kode.
// Cek ini dipisah dari cert() sendiri supaya penyebabnya langsung jelas di
// log tanpa perlu menebak dari pesan error gRPC/OpenSSL yang generik.
function looksLikePemPrivateKey(key: string): boolean {
  return key.startsWith("-----BEGIN PRIVATE KEY-----") && key.includes("-----END PRIVATE KEY-----");
}

export function getFirebaseAdminStatus() {
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKeyRaw = process.env.FIREBASE_PRIVATE_KEY;
  const privateKey = normalizePrivateKey(privateKeyRaw);

  const missing: string[] = [];

  if (!projectId) missing.push("FIREBASE_PROJECT_ID");
  if (!clientEmail) missing.push("FIREBASE_CLIENT_EMAIL");
  if (!privateKeyRaw) missing.push("FIREBASE_PRIVATE_KEY");

  // Section — dibandingkan dengan NEXT_PUBLIC_FIREBASE_PROJECT_ID (project
  // yang dipakai Firebase Client SDK di browser): kalau beda, Admin SDK di
  // server membaca Firestore dari project LAIN — query selalu "berhasil"
  // secara teknis tapi selalu 404 karena datanya memang tidak ada di sana.
  // Ini BUKAN kredensial, aman dilog (project id publik terlihat dari
  // firebaseConfig di browser juga).
  const clientProjectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const projectIdMismatch = !!projectId && !!clientProjectId && projectId !== clientProjectId;

  return {
    ok: missing.length === 0 && !adminInitError && (!privateKeyRaw || looksLikePemPrivateKey(privateKey)),
    missing,
    error: adminInitError,
    hasProjectId: !!projectId,
    hasClientEmail: !!clientEmail,
    hasPrivateKey: !!privateKeyRaw,
    privateKeyLooksValidPem: privateKeyRaw ? looksLikePemPrivateKey(privateKey) : false,
    projectId: projectId || null,
    projectIdMismatch,
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

  if (!looksLikePemPrivateKey(privateKey)) {
    // Section — jangan pernah log isi key, cukup bentuknya. Ini gejala
    // KHAS env var Vercel yang newline-nya tidak ter-unescape dengan benar.
    adminInitError =
      "FIREBASE_PRIVATE_KEY tidak berbentuk PEM yang valid setelah dinormalisasi (kemungkinan newline rusak saat disalin ke environment variable).";
    console.error("[Firebase Admin]", adminInitError, {
      projectId,
      privateKeyLength: privateKey.length,
      startsCorrectly: privateKey.startsWith("-----BEGIN PRIVATE KEY-----"),
    });
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
    console.log("[Firebase Admin] initialized", { projectId });
    return adminApp;
  } catch (error) {
    adminInitError =
      error instanceof Error
        ? error.message
        : "Firebase Admin gagal initialize.";

    console.error("[Firebase Admin] gagal initialize", {
      projectId,
      errorName: error instanceof Error ? error.name : "Unknown",
      errorMessage: error instanceof Error ? error.message : String(error),
    });
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
