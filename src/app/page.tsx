"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { getDefaultRouteForRole } from "@/lib/roles";

export default function Home() {
  const { firebaseUser, role, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!firebaseUser) {
      router.replace("/login");
      return;
    }
    router.replace(getDefaultRouteForRole(role));
  }, [loading, firebaseUser, role, router]);

  return (
    <div className="flex flex-1 items-center justify-center">
      <p className="text-slate-400 text-sm">Memuat QHSE Care...</p>
    </div>
  );
}
