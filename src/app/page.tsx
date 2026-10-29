"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth-context";
import { getDefaultRouteForRole } from "@/lib/roles";
import PublicBorrowLanding from "./PublicBorrowLanding";

// Section "Halaman Utama Peminjaman Tanpa Login" — user yang SUDAH login
// tetap diarahkan ke dashboard sesuai role seperti sebelumnya, TIDAK
// berubah. Yang berubah hanya cabang belum-login: dulu redirect ke
// `/login`, sekarang merender halaman kios publik (PublicBorrowLanding) di
// tempat, tanpa redirect, supaya karyawan bisa pinjam/kembalikan barang
// tanpa harus dibuatkan akun.
export default function Home() {
  const { firebaseUser, role, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!firebaseUser) return;
    router.replace(getDefaultRouteForRole(role));
  }, [loading, firebaseUser, role, router]);

  if (loading || firebaseUser) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <p className="text-slate-400 text-sm">Memuat QHSE Care...</p>
      </div>
    );
  }

  return <PublicBorrowLanding />;
}
