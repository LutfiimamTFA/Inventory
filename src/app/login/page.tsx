"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Fingerprint, LogIn, ShieldAlert } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { getDefaultRouteForRole } from "@/lib/roles";
import {
  friendlyPasskeyError,
  isPasskeySupported,
  loginWithPasskey,
} from "@/lib/passkeys";

export default function LoginPage() {
  const { firebaseUser, assetUser, role, loading, accessDenied, accessDeniedReason, login, logout } =
    useAuth();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [passkeySubmitting, setPasskeySubmitting] = useState(false);
  const [passkeySupported, setPasskeySupported] = useState(false);

  useEffect(() => {
    queueMicrotask(() => setPasskeySupported(isPasskeySupported()));
  }, []);

  useEffect(() => {
    if (!loading && firebaseUser && assetUser && role) {
      router.replace(getDefaultRouteForRole(role));
    }
  }, [loading, firebaseUser, assetUser, role, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await login(email, password);
    } catch {
      setError("Email atau password salah.");
    } finally {
      setSubmitting(false);
    }
  };

  const handlePasskeyLogin = async () => {
    setError("");
    setPasskeySubmitting(true);
    try {
      await loginWithPasskey(email);
    } catch (err) {
      setError(friendlyPasskeyError(err, "Login passkey gagal."));
    } finally {
      setPasskeySubmitting(false);
    }
  };

  if (firebaseUser && loading) {
    return (
      <div className="flex flex-1 items-center justify-center p-4 min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50">
        <div className="flex flex-col items-center gap-3">
          <div className="h-9 w-9 rounded-full border-2 border-slate-200 border-t-blue-600 animate-spin" />
          <p className="text-slate-500 text-sm">Memvalidasi akses QHSE Care...</p>
        </div>
      </div>
    );
  }

  if (!loading && firebaseUser && accessDenied) {
    return (
      <div className="flex flex-1 items-center justify-center p-4 min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50">
        <div className="max-w-sm w-full bg-white rounded-2xl shadow-lg border border-slate-200 p-8 text-center">
          <div className="mx-auto mb-4 h-14 w-14 rounded-2xl bg-red-50 flex items-center justify-center">
            <ShieldAlert className="text-red-500" size={28} />
          </div>
          <h1 className="text-lg font-semibold text-slate-900 mb-1">Akses Ditolak</h1>
          <p className="text-sm text-slate-500 mb-2">
            {accessDeniedReason ||
              "Akun Anda belum terdaftar di QHSE Care. Hubungi Super Admin untuk mendapatkan akses."}
          </p>
          <button
            onClick={() => logout()}
            className="w-full rounded-xl bg-slate-900 text-white py-2.5 text-sm font-medium hover:bg-slate-800 mt-4"
          >
            Kembali ke Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 items-center justify-center p-4 min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50">
      <div className="max-w-sm w-full">
        <div className="text-center mb-8">
          <img
            src="/qhse-care-icon.png"
            alt="QHSE Care"
            className="mx-auto mb-4 h-14 w-14 rounded-2xl object-cover shadow-lg shadow-blue-900/20"
          />
          <h1 className="text-2xl font-semibold text-slate-900 tracking-tight">
            QHSE Care
          </h1>
          <p className="text-sm text-slate-500">Safety, Asset & Maintenance System</p>
        </div>
        <form
          onSubmit={handleSubmit}
          className="bg-white rounded-2xl shadow-lg border border-slate-200 p-6 space-y-4"
        >
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Email
            </label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="input"
              placeholder="nama@perusahaan.com"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Password
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="input"
              placeholder="••••••••"
            />
          </div>
          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
              {error}
            </p>
          )}
          <button
            type="submit"
            disabled={submitting || passkeySubmitting}
            className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-teal-500 text-white py-2.5 text-sm font-medium hover:brightness-105 disabled:opacity-60 shadow-md shadow-blue-900/20"
          >
            <LogIn size={16} />
            {submitting ? "Memproses..." : "Masuk"}
          </button>
          {passkeySupported && (
            <>
              <div className="flex items-center gap-3">
                <div className="h-px flex-1 bg-slate-200" />
                <span className="text-xs text-slate-400">atau</span>
                <div className="h-px flex-1 bg-slate-200" />
              </div>
              <button
                type="button"
                onClick={handlePasskeyLogin}
                disabled={submitting || passkeySubmitting}
                className="w-full inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                <Fingerprint size={16} />
                {passkeySubmitting ? "Memproses..." : "Masuk dengan Passkey"}
              </button>
              <p className="text-xs text-center leading-5 text-slate-400">
                Gunakan fingerprint, Face ID, Touch ID, atau Windows Hello jika
                sudah diaktifkan di perangkat ini.
              </p>
            </>
          )}
          <p className="text-xs text-center text-slate-400">
            Gunakan akun yang sudah terdaftar di QHSE Care.
          </p>
        </form>
      </div>
    </div>
  );
}
