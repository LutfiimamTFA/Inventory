"use client";

import { useEffect, useMemo, useState } from "react";
import { Fingerprint, KeyRound, Trash2 } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import {
  clearLocalPasskey,
  friendlyPasskeyError,
  getLocalPasskeyCredentialId,
  getPasskeyDevices,
  getPasskeyUnavailableMessage,
  isPasskeyRegisteredLocally,
  isPasskeySupported,
  registerPasskey,
  revokePasskey,
  type PasskeyDevice,
} from "@/lib/passkeys";

export default function PasskeySecurityPanel() {
  const { firebaseUser, assetUser } = useAuth();
  const [devices, setDevices] = useState<PasskeyDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [supported, setSupported] = useState(false);
  const [localCredentialId, setLocalCredentialId] = useState("");
  const [localRegistered, setLocalRegistered] = useState(false);

  const activeCredentialIds = useMemo(
    () => new Set(devices.map((device) => device.credentialId)),
    [devices]
  );
  const currentDeviceActive =
    !!localCredentialId && activeCredentialIds.has(localCredentialId);
  const passkeyActive = devices.length > 0 || localRegistered;

  useEffect(() => {
    queueMicrotask(() => setSupported(isPasskeySupported()));
  }, []);

  useEffect(() => {
    if (!firebaseUser) return;
    queueMicrotask(() => {
      setLocalCredentialId(getLocalPasskeyCredentialId(firebaseUser.uid));
      setLocalRegistered(isPasskeyRegisteredLocally(firebaseUser.uid));
    });
  }, [firebaseUser]);

  useEffect(() => {
    let cancelled = false;
    async function loadDevices() {
      if (!firebaseUser) return;
      setLoading(true);
      setError("");
      try {
        const nextDevices = await getPasskeyDevices(firebaseUser);
        if (!cancelled) setDevices(nextDevices);
      } catch (err) {
        if (!cancelled) {
          setError(friendlyPasskeyError(err, "Gagal memuat daftar passkey."));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    loadDevices();
    return () => {
      cancelled = true;
    };
  }, [firebaseUser]);

  const refreshLocalState = () => {
    if (!firebaseUser) return;
    setLocalCredentialId(getLocalPasskeyCredentialId(firebaseUser.uid));
    setLocalRegistered(isPasskeyRegisteredLocally(firebaseUser.uid));
  };

  const refreshDevices = async () => {
    if (!firebaseUser) return;
    const nextDevices = await getPasskeyDevices(firebaseUser);
    setDevices(nextDevices);
    refreshLocalState();
  };

  const handleActivate = async () => {
    if (!firebaseUser || !assetUser) return;
    setError("");
    setMessage("");
    setSubmitting(true);
    try {
      await registerPasskey(firebaseUser, assetUser.name);
      await refreshDevices();
      setMessage("Passkey berhasil diaktifkan di perangkat ini.");
    } catch (err) {
      setError(friendlyPasskeyError(err, "Gagal mengaktifkan passkey."));
    } finally {
      setSubmitting(false);
    }
  };

  const handleRevoke = async (credentialId: string) => {
    if (!firebaseUser) return;
    setError("");
    setMessage("");
    setSubmitting(true);
    try {
      await revokePasskey(firebaseUser, credentialId);
      await refreshDevices();
      setMessage("Passkey berhasil dinonaktifkan.");
    } catch (err) {
      setError(friendlyPasskeyError(err, "Gagal menonaktifkan passkey."));
    } finally {
      setSubmitting(false);
    }
  };

  const handleClearLocal = () => {
    if (!firebaseUser) return;
    clearLocalPasskey(firebaseUser.uid);
    refreshLocalState();
    setMessage("Penanda passkey lokal perangkat ini sudah dihapus.");
  };

  const unavailableMessage = getPasskeyUnavailableMessage();

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
            <Fingerprint size={23} />
          </div>
          <div>
            <h2 className="text-base font-semibold text-slate-900">
              Login &amp; Keamanan
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Status Passkey:{" "}
              <span className={passkeyActive ? "font-medium text-emerald-700" : "font-medium text-slate-700"}>
                {passkeyActive ? "Aktif" : "Belum Aktif"}
              </span>
            </p>
            {localCredentialId && (
              <p className="mt-1 text-xs text-slate-400">
                Perangkat ini: {currentDeviceActive ? "Aktif" : "Tidak aktif"}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={handleActivate}
            disabled={!supported || submitting}
            className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-teal-500 px-4 py-2.5 text-sm font-medium text-white shadow-md shadow-blue-900/20 hover:brightness-105 disabled:opacity-60"
          >
            <Fingerprint size={16} />
            {submitting ? "Memproses..." : "Aktifkan Passkey"}
          </button>
          {localCredentialId ? (
            <button
              type="button"
              onClick={() =>
                currentDeviceActive
                  ? handleRevoke(localCredentialId)
                  : handleClearLocal()
              }
              disabled={submitting}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60"
            >
              <KeyRound size={16} />
              Nonaktifkan Perangkat Ini
            </button>
          ) : null}
        </div>
      </div>

      {!supported && (
        <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          Browser ini belum mendukung passkey.
        </p>
      )}
      {supported && unavailableMessage && (
        <p className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
          {unavailableMessage}
        </p>
      )}
      {error && (
        <p className="mt-4 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      )}
      {message && (
        <p className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
          {message}
        </p>
      )}

      <div className="mt-5">
        <h3 className="text-sm font-semibold text-slate-800">Perangkat Passkey</h3>
        {loading ? (
          <p className="mt-3 text-sm text-slate-400">Memuat perangkat...</p>
        ) : devices.length === 0 ? (
          <p className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm text-slate-500">
            Belum ada perangkat passkey aktif.
          </p>
        ) : (
          <div className="mt-3 divide-y divide-slate-100 rounded-xl border border-slate-200">
            {devices.map((device) => (
              <div
                key={device.credentialId}
                className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-slate-800">
                    {device.deviceName || device.deviceType || "Passkey"}
                  </p>
                  <p className="mt-0.5 text-xs text-slate-400">
                    Terdaftar {formatDate(device.createdAt)}
                    {device.lastUsedAt ? ` - terakhir dipakai ${formatDate(device.lastUsedAt)}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleRevoke(device.credentialId)}
                  disabled={submitting}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-red-200 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-60"
                >
                  <Trash2 size={15} />
                  Hapus Akses
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

function formatDate(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}
