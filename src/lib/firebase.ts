import { initializeApp, getApp, getApps } from "firebase/app";
import { getAuth } from "firebase/auth";
import {
  initializeFirestore,
  getFirestore,
  memoryLocalCache,
  type Firestore,
} from "firebase/firestore";
import { getStorage } from "firebase/storage";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const alreadyInitialized = getApps().length > 0;
const app = alreadyInitialized ? getApp() : initializeApp(firebaseConfig);

if (!alreadyInitialized) {
  console.debug("[Firebase] initialized once");
}

// Memory cache saja (bukan IndexedDB persistence) supaya tidak bentrok dengan
// Turbopack/Fast Refresh yang bisa memicu banyak instance Firestore berjalan
// bersamaan ("Another write batch or compaction is already active").
let db: Firestore;
try {
  db = initializeFirestore(app, {
    localCache: memoryLocalCache(),
  });
  console.debug("[Firestore] using memory local cache");
} catch {
  // initializeFirestore melempar error kalau instance untuk app ini sudah
  // dibuat sebelumnya (mis. saat Fast Refresh) — pakai instance yang ada.
  db = getFirestore(app);
}

const auth = getAuth(app);
const storage = getStorage(app);

export { app, auth, db, storage };

// Nama collection karyawan HRP bisa berbeda per environment (mis. "usersdev").
export const EMPLOYEE_PROFILES_COLLECTION =
  process.env.NEXT_PUBLIC_EMPLOYEE_PROFILES_COLLECTION || "employee_profiles";
