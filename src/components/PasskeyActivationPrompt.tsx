"use client";

import { useEffect, useState } from "react";
import { Fingerprint, X } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import {
  dismissPasskeyPrompt,
  friendlyPasskeyError,
  hasDismissedPasskeyPrompt,
  isPasskeyRegisteredLocally,
  isPasskeySecureContext,
  isPasskeySupported,
  registerPasskey,
} from "@/lib/passkeys";

export default function PasskeyActivationPrompt() {
  const { firebaseUser, assetUser } = useAuth();
  const [visible, setVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!firebaseUser || !assetUser) return;
    if (!isPasskeySupported() || !isPasskeySecureContext()) return;
    if (hasDismissedPasskeyPrompt()) return;
    if (isPasskeyRegisteredLocally(firebaseUser.uid)) return;

    const timer = window.setTimeout(() => setVisible(true), 600);
    return () => window.clearTimeout(timer);
  }, [firebaseUser, assetUser]);

  if (!visible || !firebaseUser || !assetUser) return null;

  const handleDismiss = () => {
    dismissPasskeyPrompt();
    setVisible(false);
  };

  const handleActivate = async () => {
    setError("");
    setSubmitting(true);
    try {
      await registerPasskey(firebaseUser, assetUser.name);
      setVisible(false);
    } catch (err) {
      setError(friendlyPasskeyError(err, "Gagal mengaktifkan passkey."));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl shadow-slate-950/20">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
            <Fingerprint size={24} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <h2 className="text-base font-semibold text-slate-900">
                  Aktifkan Login Cepat
                </h2>
                <p className="mt-1 text-sm leading-5 text-slate-500">
                  Anda bisa masuk lebih cepat menggunakan fingerprint, Face ID,
                  Touch ID, atau Windows Hello di perangkat ini.
                </p>
              </div>
              <button
                type="button"
                onClick={handleDismiss}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                title="Tutup"
              >
                <X size={17} />
              </button>
            </div>

            {error && (
              <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
                {error}
              </p>
            )}

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <button
                type="button"
                onClick={handleDismiss}
                disabled={submitting}
                className="rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
              >
                Nanti Saja
              </button>
              <button
                type="button"
                onClick={handleActivate}
                disabled={submitting}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-teal-500 px-4 py-2.5 text-sm font-medium text-white shadow-md shadow-blue-900/20 hover:brightness-105 disabled:opacity-60"
              >
                <Fingerprint size={16} />
                {submitting ? "Mengaktifkan..." : "Aktifkan"}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
