"use client";

import type { User } from "firebase/auth";
import { signInWithCustomToken } from "firebase/auth";
import {
  startAuthentication,
  startRegistration,
  type AuthenticationResponseJSON,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
  type RegistrationResponseJSON,
} from "@simplewebauthn/browser";
import { auth } from "@/lib/firebase";

export const PASSKEY_PROMPT_DISMISSED_KEY = "qhsecare_passkey_prompt_dismissed";

export interface PasskeyDevice {
  credentialId: string;
  deviceName: string;
  deviceType: string;
  createdAt: string | null;
  lastUsedAt: string | null;
  status: "active" | "revoked";
}

interface ApiResult {
  success?: boolean;
  message?: string;
}

interface RegisterFinishResult extends ApiResult {
  credentialId?: string;
}

interface LoginFinishResult extends ApiResult {
  customToken?: string;
  uid?: string;
  credentialId?: string;
}

interface DevicesResult extends ApiResult {
  devices?: PasskeyDevice[];
}

export function isPasskeySupported() {
  return typeof window !== "undefined" && !!window.PublicKeyCredential;
}

export function isPasskeySecureContext() {
  return typeof window !== "undefined" && window.isSecureContext;
}

export function getPasskeyUnavailableMessage() {
  if (!isPasskeySupported()) {
    return "Browser ini belum mendukung passkey.";
  }
  if (!isPasskeySecureContext()) {
    return "Login passkey memerlukan HTTPS atau localhost. Gunakan domain HTTPS atau tunnel HTTPS untuk testing di HP.";
  }
  return "";
}

export function passkeyRegisteredKey(uid: string) {
  return `qhsecare_passkey_registered_${uid}`;
}

export function passkeyCredentialKey(uid: string) {
  return `qhsecare_passkey_credential_${uid}`;
}

export function isPasskeyRegisteredLocally(uid: string) {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(passkeyRegisteredKey(uid)) === "true";
}

export function getLocalPasskeyCredentialId(uid: string) {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(passkeyCredentialKey(uid)) || "";
}

export function markPasskeyRegistered(uid: string, credentialId?: string) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(passkeyRegisteredKey(uid), "true");
  window.localStorage.removeItem(PASSKEY_PROMPT_DISMISSED_KEY);
  if (credentialId) {
    window.localStorage.setItem(passkeyCredentialKey(uid), credentialId);
  }
}

export function clearLocalPasskey(uid: string) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(passkeyRegisteredKey(uid));
  window.localStorage.removeItem(passkeyCredentialKey(uid));
}

export function dismissPasskeyPrompt() {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(PASSKEY_PROMPT_DISMISSED_KEY, "true");
}

export function hasDismissedPasskeyPrompt() {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(PASSKEY_PROMPT_DISMISSED_KEY) === "true";
}

export async function registerPasskey(firebaseUser: User, currentUserName?: string) {
  const unavailableMessage = getPasskeyUnavailableMessage();
  if (unavailableMessage) throw new Error(unavailableMessage);

  const token = await firebaseUser.getIdToken();
  const startRes = await fetch("/api/passkeys/register/start", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      uid: firebaseUser.uid,
      email: firebaseUser.email,
      displayName: currentUserName || firebaseUser.displayName || firebaseUser.email,
    }),
  });

  const options = await readJson<PublicKeyCredentialCreationOptionsJSON>(startRes);
  const credential: RegistrationResponseJSON = await startRegistration({
    optionsJSON: options,
  });

  const finishRes = await fetch("/api/passkeys/register/finish", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      uid: firebaseUser.uid,
      credential,
    }),
  });

  const result = await readJson<RegisterFinishResult>(finishRes);
  if (!result.success) {
    throw new Error(result.message || "Gagal mengaktifkan passkey.");
  }

  markPasskeyRegistered(firebaseUser.uid, result.credentialId);
  return result;
}

export async function loginWithPasskey(email: string) {
  const unavailableMessage = getPasskeyUnavailableMessage();
  if (unavailableMessage) throw new Error(unavailableMessage);

  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail) {
    throw new Error("Masukkan email terlebih dahulu untuk login dengan passkey.");
  }

  const startRes = await fetch("/api/passkeys/login/start", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: normalizedEmail }),
  });

  const options = await readJson<PublicKeyCredentialRequestOptionsJSON>(startRes);
  const credential: AuthenticationResponseJSON = await startAuthentication({
    optionsJSON: options,
  });

  const finishRes = await fetch("/api/passkeys/login/finish", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ credential }),
  });

  const result = await readJson<LoginFinishResult>(finishRes);
  if (!result.customToken) {
    throw new Error(result.message || "Login passkey gagal.");
  }

  await signInWithCustomToken(auth, result.customToken);
  if (result.uid) markPasskeyRegistered(result.uid, result.credentialId);

  return result;
}

export async function getPasskeyDevices(firebaseUser: User) {
  const token = await firebaseUser.getIdToken();
  const res = await fetch("/api/passkeys/devices", {
    headers: { Authorization: `Bearer ${token}` },
  });
  const result = await readJson<DevicesResult>(res);
  if (!result.success) {
    throw new Error(result.message || "Gagal memuat daftar passkey.");
  }
  return result.devices || [];
}

export async function revokePasskey(firebaseUser: User, credentialId: string) {
  const token = await firebaseUser.getIdToken();
  const res = await fetch("/api/passkeys/devices", {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ credentialId }),
  });
  const result = await readJson<ApiResult>(res);
  if (!result.success) {
    throw new Error(result.message || "Gagal menonaktifkan passkey.");
  }
  if (getLocalPasskeyCredentialId(firebaseUser.uid) === credentialId) {
    clearLocalPasskey(firebaseUser.uid);
  }
  return result;
}

export function friendlyPasskeyError(error: unknown, fallback: string) {
  if (!(error instanceof Error)) return fallback;
  if (error.name === "NotAllowedError" || /not allowed|cancel/i.test(error.message)) {
    return "Proses passkey dibatalkan atau tidak selesai.";
  }
  if (/secure|https|localhost/i.test(error.message)) {
    return getPasskeyUnavailableMessage() || error.message;
  }
  return error.message || fallback;
}

async function readJson<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.message || "Request passkey gagal.");
  }
  return data as T;
}
