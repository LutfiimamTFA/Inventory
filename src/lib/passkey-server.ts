import { NextRequest, NextResponse } from "next/server";
import type { DecodedIdToken } from "firebase-admin/auth";
import type { Firestore } from "firebase-admin/firestore";
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  RegistrationResponseJSON,
  WebAuthnCredential,
} from "@simplewebauthn/server";
import { getAdminAuth, getAdminFirestore } from "@/lib/firebase-admin";

export const PASSKEY_CREDENTIALS_COLLECTION = "passkey_credentials";
export const PASSKEY_CHALLENGES_COLLECTION = "passkey_challenges";
export const PASSKEY_CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const PASSKEY_RP_NAME = "QHSE Care";

export interface PasskeyChallengeData {
  challenge: string;
  type: "registration" | "authentication";
  uid?: string;
  email?: string;
  displayName?: string;
  credentialIds?: string[];
  origin: string;
  rpID: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface StoredPasskeyCredential {
  credentialId: string;
  uid: string;
  email: string;
  displayName: string;
  publicKey: string;
  counter: number;
  transports?: AuthenticatorTransportFuture[];
  deviceName: string;
  deviceType: string;
  userAgent: string;
  credentialDeviceType?: string;
  credentialBackedUp?: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
  lastUsedAt?: unknown;
  status: "active" | "revoked";
}

export function passkeyJsonError(message: string, status = 400) {
  return NextResponse.json({ success: false, message }, { status });
}

export function normalizeEmail(email?: string | null) {
  return (email || "").trim().toLowerCase();
}

export function getAdminServices() {
  const firestore = getAdminFirestore();
  const auth = getAdminAuth();
  if (!firestore || !auth) return null;
  return { firestore, auth };
}

export async function requireFirebaseUser(req: NextRequest): Promise<
  | { decoded: DecodedIdToken; response?: never }
  | { decoded?: never; response: NextResponse }
> {
  const services = getAdminServices();
  if (!services) {
    return {
      response: passkeyJsonError(
        "Firebase Admin belum dikonfigurasi untuk passkey.",
        500
      ),
    };
  }

  const authorization = req.headers.get("authorization") || "";
  const token = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) {
    return { response: passkeyJsonError("Sesi login tidak valid.", 401) };
  }

  try {
    const decoded = await services.auth.verifyIdToken(token);
    return { decoded };
  } catch {
    return { response: passkeyJsonError("Sesi login tidak valid.", 401) };
  }
}

export function resolveWebAuthnConfig(req: NextRequest) {
  const configuredOrigin =
    process.env.PASSKEY_ORIGIN ||
    process.env.NEXT_PUBLIC_QHSECARE_ORIGIN ||
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");

  const forwardedProto = req.headers.get("x-forwarded-proto");
  const forwardedHost = req.headers.get("x-forwarded-host");
  const host = forwardedHost || req.headers.get("host") || req.nextUrl.host;
  const proto = forwardedProto || req.nextUrl.protocol.replace(":", "") || "https";
  const fallbackOrigin = `${proto}://${host}`;
  const origin = normalizeOrigin(configuredOrigin || fallbackOrigin);
  const rpID = process.env.PASSKEY_RP_ID || new URL(origin).hostname;

  return { origin, rpID };
}

function normalizeOrigin(value: string) {
  const withProtocol = /^https?:\/\//i.test(value) ? value : `https://${value}`;
  const url = new URL(withProtocol);
  return url.origin;
}

export async function storeChallenge(
  firestore: Firestore,
  data: Omit<PasskeyChallengeData, "createdAt" | "expiresAt">
) {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + PASSKEY_CHALLENGE_TTL_MS);
  await firestore
    .collection(PASSKEY_CHALLENGES_COLLECTION)
    .doc(data.challenge)
    .set({ ...data, createdAt: now, expiresAt });
}

export async function readChallenge(
  firestore: Firestore,
  challenge: string,
  type: PasskeyChallengeData["type"]
) {
  const ref = firestore.collection(PASSKEY_CHALLENGES_COLLECTION).doc(challenge);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new Error("Challenge passkey tidak ditemukan atau sudah kedaluwarsa.");
  }

  const data = snap.data() as PasskeyChallengeData;
  if (data.type !== type) {
    throw new Error("Challenge passkey tidak sesuai.");
  }

  const expiresAt = toMillis(data.expiresAt);
  if (!expiresAt || expiresAt < Date.now()) {
    await ref.delete().catch(() => {});
    throw new Error("Challenge passkey sudah kedaluwarsa.");
  }

  return { data, ref };
}

function toMillis(value: unknown) {
  if (!value) return 0;
  if (typeof value === "object" && "toMillis" in value) {
    return (value as { toMillis: () => number }).toMillis();
  }
  if (value instanceof Date) return value.getTime();
  if (typeof value === "string" || typeof value === "number") {
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? 0 : parsed;
  }
  return 0;
}

export function extractClientChallenge(
  credential: RegistrationResponseJSON | AuthenticationResponseJSON
) {
  const clientDataText = Buffer.from(
    credential.response.clientDataJSON,
    "base64url"
  ).toString("utf8");
  const clientData = JSON.parse(clientDataText) as { challenge?: string };
  if (!clientData.challenge) {
    throw new Error("Challenge passkey tidak valid.");
  }
  return clientData.challenge;
}

export function bytesToBase64url(bytes: Uint8Array) {
  return Buffer.from(bytes).toString("base64url");
}

export function base64urlToBytes(value: string) {
  return new Uint8Array(Buffer.from(value, "base64url"));
}

export function toWebAuthnCredential(data: StoredPasskeyCredential): WebAuthnCredential {
  return {
    id: data.credentialId,
    publicKey: base64urlToBytes(data.publicKey),
    counter: Number(data.counter || 0),
    transports: data.transports,
  };
}

export function getDeviceInfo(req: NextRequest, attachment?: string) {
  const userAgent = req.headers.get("user-agent") || "Unknown device";
  const deviceType = detectDeviceType(userAgent);
  const browser = detectBrowser(userAgent);
  const authenticator = attachment === "cross-platform" ? "Security Key" : "Passkey";
  const deviceName = [deviceType, browser, authenticator].filter(Boolean).join(" - ");

  return { userAgent, deviceType, deviceName };
}

function detectDeviceType(userAgent: string) {
  if (/android/i.test(userAgent)) return "Android";
  if (/iphone|ipad|ipod/i.test(userAgent)) return "iPhone/iPad";
  if (/windows/i.test(userAgent)) return "Windows";
  if (/macintosh|mac os x/i.test(userAgent)) return "Mac";
  if (/linux/i.test(userAgent)) return "Linux";
  return "Perangkat";
}

function detectBrowser(userAgent: string) {
  if (/edg\//i.test(userAgent)) return "Edge";
  if (/opr\//i.test(userAgent)) return "Opera";
  if (/chrome\//i.test(userAgent)) return "Chrome";
  if (/safari\//i.test(userAgent) && !/chrome\//i.test(userAgent)) return "Safari";
  if (/firefox\//i.test(userAgent)) return "Firefox";
  return "";
}
