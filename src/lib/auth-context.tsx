"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  ReactNode,
} from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  User,
} from "firebase/auth";
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from "firebase/firestore";
import { auth, db } from "@/lib/firebase";
import { AppRole, AssetUser } from "@/lib/types";
import { findActiveHrpEmployeeByUid } from "@/lib/hrp";

interface AuthState {
  firebaseUser: User | null;
  assetUser: AssetUser | null;
  role: AppRole | null;
  loading: boolean;
  accessDenied: boolean;
  accessDeniedReason: string;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | undefined>(undefined);

const BOOTSTRAP_SUPER_ADMIN_EMAILS = (
  process.env.NEXT_PUBLIC_ASSETVIEW_SUPER_ADMIN_EMAILS || ""
)
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

function isPermissionDenied(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "permission-denied"
  );
}

async function safeGetDoc(label: string, ref: ReturnType<typeof doc>) {
  try {
    console.log(`[Auth SafeGet] START ${label}`, ref.path);
    const snap = await getDoc(ref);
    console.log(`[Auth SafeGet] SUCCESS ${label}`, {
      path: ref.path,
      exists: snap.exists(),
    });
    return snap;
  } catch (error) {
    console.error(`[Auth SafeGet] ERROR ${label}`, {
      path: ref.path,
      error,
    });
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<User | null>(null);
  const [assetUser, setAssetUser] = useState<AssetUser | null>(null);
  const [role, setRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [accessDeniedReason, setAccessDeniedReason] = useState("");
  const hasUpdatedLoginRef = useRef<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setLoading(true);
      setAccessDenied(false);
      setAccessDeniedReason("");
      setFirebaseUser(user);
      if (!user) {
        setAssetUser(null);
        setRole(null);
        setLoading(false);
        hasUpdatedLoginRef.current = null;
        return;
      }

      const email = (user.email || "").toLowerCase();
      console.debug("[AssetView Auth] uid", user.uid);
      console.debug("[AssetView Auth] email", email);

      try {
        const ref = doc(db, "asset_users", user.uid);
        const snap = await safeGetDoc("asset_users current user", ref);
        console.debug("[AssetView Auth] asset_users exists", !!snap?.exists());

        if (snap?.exists()) {
          const data = snap.data() as Omit<AssetUser, "uid">;

          if (data.status !== "active") {
            setAssetUser(null);
            setRole(null);
            setAccessDenied(true);
            setAccessDeniedReason("Akun Anda dinonaktifkan. Hubungi Super Admin.");
            return;
          }

          setAssetUser({ uid: user.uid, ...data });
          setRole(data.role);
          console.debug("[AssetView Auth] final role", data.role);

          // lastLoginAt hanya diupdate sekali per sesi login, bukan setiap
          // kali onAuthStateChanged/effect ini jalan ulang (mis. Fast Refresh).
          if (hasUpdatedLoginRef.current !== user.uid) {
            hasUpdatedLoginRef.current = user.uid;
            updateDoc(ref, { lastLoginAt: serverTimestamp() }).catch(() => {});
          }
          return;
        }

        // Tidak ada asset_users -> cek karyawan aktif HRP (default role: staff).
        const hrpEmployee = await findActiveHrpEmployeeByUid(user.uid);
        console.debug("[AssetView Auth] hrp employee active", !!hrpEmployee);

        if (hrpEmployee) {
          setAssetUser({
            uid: user.uid,
            name: hrpEmployee.name,
            email: hrpEmployee.email || email,
            role: "staff",
            status: "active",
          });
          setRole("staff");
          console.debug("[AssetView Auth] final role", "staff");
          return;
        }

        // Bukan karyawan HRP aktif -> cek email bootstrap Super Admin.
        const isBootstrapSuperAdmin = BOOTSTRAP_SUPER_ADMIN_EMAILS.includes(email);
        console.debug("[AssetView Auth] bootstrap email", isBootstrapSuperAdmin);

        if (!isBootstrapSuperAdmin) {
          setAssetUser(null);
          setRole(null);
          setAccessDenied(true);
          setAccessDeniedReason(
            "Akun Anda belum terdaftar di AssetView. Hubungi Super Admin untuk mendapatkan akses."
          );
          return;
        }

        const now = serverTimestamp();
        await setDoc(ref, {
          uid: user.uid,
          name: user.displayName || email,
          email,
          role: "super_admin",
          status: "active",
          createdByUid: "system",
          createdByName: "System Bootstrap",
          createdAt: now,
          updatedAt: now,
        });
        const createdSnap = await safeGetDoc("asset_users bootstrap created user", ref);
        const createdData = createdSnap?.data() as Omit<AssetUser, "uid"> | undefined;
        if (!createdData) {
          setAssetUser(null);
          setRole(null);
          setAccessDenied(true);
          setAccessDeniedReason("Gagal membuat akses bootstrap AssetView.");
          return;
        }
        setAssetUser({ uid: user.uid, ...createdData });
        setRole(createdData.role);
        console.debug("[AssetView Auth] final role", createdData.role);
      } catch (err) {
        setAssetUser(null);
        setRole(null);
        setAccessDenied(true);
        setAccessDeniedReason(
          isPermissionDenied(err)
            ? "Tidak bisa membaca data akses AssetView. Periksa Firestore Rules."
            : "Terjadi kesalahan saat memvalidasi akun."
        );
      } finally {
        setLoading(false);
      }
    });
    return () => unsub();
  }, []);

  const login = async (email: string, password: string) => {
    await signInWithEmailAndPassword(auth, email, password);
  };

  const logout = async () => {
    await firebaseSignOut(auth);
  };

  return (
    <AuthContext.Provider
      value={{
        firebaseUser,
        assetUser,
        role,
        loading,
        accessDenied,
        accessDeniedReason,
        login,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
