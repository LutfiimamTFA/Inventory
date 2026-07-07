"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";

export default function Home() {
  const { firebaseUser, role, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!firebaseUser) {
      router.replace("/login");
      return;
    }
    router.replace(
      role === "super_admin" || role === "asset_admin" ? "/dashboard" : "/scan"
    );
  }, [loading, firebaseUser, role, router]);

  return (
    <div className="flex flex-1 items-center justify-center">
      <p className="text-slate-400 text-sm">Memuat AssetView...</p>
    </div>
  );
}
