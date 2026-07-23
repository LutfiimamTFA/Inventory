import {
  getApp,
  getApps,
  initializeApp,
  type FirebaseApp,
  type FirebaseOptions,
} from "firebase/app";
import { browserLocalPersistence, getAuth, setPersistence, type Auth } from "firebase/auth";
import {
  getFirestore,
  initializeFirestore,
  memoryLocalCache,
  type Firestore,
} from "firebase/firestore";
import { getStorage, type FirebaseStorage } from "firebase/storage";
import {
  checkPublicEnv,
  formatMissingPublicEnvMessage,
  getMissingPublicEnv,
} from "@/lib/check-env";

const firebaseConfig: FirebaseOptions = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

const publicEnvValues = {
  NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID:
    process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  NEXT_PUBLIC_FIREBASE_APP_ID: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

const missingFirebaseEnv = getMissingPublicEnv(publicEnvValues);
const firebaseConfigError =
  missingFirebaseEnv.length > 0
    ? formatMissingPublicEnvMessage(missingFirebaseEnv)
    : "";

if (firebaseConfigError) {
  console.error(firebaseConfigError);
}

function assertFirebaseClientConfig() {
  checkPublicEnv(publicEnvValues);
}

let cachedApp: FirebaseApp | null = null;
let cachedAuth: Auth | null = null;
let cachedDb: Firestore | null = null;
let cachedStorage: FirebaseStorage | null = null;

function getFirebaseApp() {
  assertFirebaseClientConfig();
  if (cachedApp) return cachedApp;

  const alreadyInitialized = getApps().length > 0;
  cachedApp = alreadyInitialized ? getApp() : initializeApp(firebaseConfig);

  if (!alreadyInitialized) {
    console.debug("[Firebase] initialized once");
  }

  return cachedApp;
}

function getFirebaseDb() {
  if (cachedDb) return cachedDb;

  const firebaseApp = getFirebaseApp();

  // Memory cache saja (bukan IndexedDB persistence) supaya tidak bentrok
  // dengan Turbopack/Fast Refresh yang bisa memicu banyak instance Firestore.
  try {
    cachedDb = initializeFirestore(firebaseApp, {
      localCache: memoryLocalCache(),
    });
    console.debug("[Firestore] using memory local cache");
  } catch {
    cachedDb = getFirestore(firebaseApp);
  }

  return cachedDb;
}

function getFirebaseAuth() {
  if (typeof window === "undefined") {
    throw new Error("[Firebase Auth] Auth hanya boleh digunakan di browser/client component.");
  }
  if (!cachedAuth) {
    cachedAuth = getAuth(getFirebaseApp());
    // Section H — eksplisit local persistence supaya user yang sudah login
    // di HP tidak perlu login ulang saat scan QR lain kali (SDK web memang
    // sudah default begini, tapi dibuat eksplisit biar tidak bergantung ke
    // default yang bisa berubah antar versi SDK).
    setPersistence(cachedAuth, browserLocalPersistence).catch((error) => {
      console.error("[Firebase Auth] gagal set local persistence", error);
    });
  }
  return cachedAuth;
}

function getFirebaseStorage() {
  if (typeof window === "undefined") {
    throw new Error("[Firebase Storage] Storage hanya boleh digunakan di browser/client component.");
  }
  if (!cachedStorage) {
    cachedStorage = getStorage(getFirebaseApp());
  }
  return cachedStorage;
}

function createLazyClient<T extends object>(getter: () => T): T {
  return new Proxy({} as T, {
    get(_target, prop, receiver) {
      const instance = getter();
      const value = Reflect.get(instance, prop, receiver);
      return typeof value === "function" ? value.bind(instance) : value;
    },
    set(_target, prop, value, receiver) {
      return Reflect.set(getter(), prop, value, receiver);
    },
    has(_target, prop) {
      return prop in getter();
    },
    getPrototypeOf() {
      return Object.getPrototypeOf(getter());
    },
  });
}

const canInitializeFirebaseClient = missingFirebaseEnv.length === 0;

const app = canInitializeFirebaseClient
  ? getFirebaseApp()
  : createLazyClient<FirebaseApp>(getFirebaseApp);

const db = canInitializeFirebaseClient
  ? getFirebaseDb()
  : createLazyClient<Firestore>(getFirebaseDb);

const auth =
  canInitializeFirebaseClient && typeof window !== "undefined"
    ? getFirebaseAuth()
    : createLazyClient<Auth>(getFirebaseAuth);

const storage =
  canInitializeFirebaseClient && typeof window !== "undefined"
    ? getFirebaseStorage()
    : createLazyClient<FirebaseStorage>(getFirebaseStorage);

export { app, auth, db, storage };

// Nama collection karyawan HRP bisa berbeda per environment (mis. "usersdev").
export const EMPLOYEE_PROFILES_COLLECTION =
  process.env.NEXT_PUBLIC_EMPLOYEE_PROFILES_COLLECTION || "employee_profiles";
