import { NextRequest, NextResponse } from "next/server";
import {
  verifyAuthenticationResponse,
  type AuthenticationResponseJSON,
} from "@simplewebauthn/server";
import type { DocumentReference } from "firebase-admin/firestore";
import {
  PASSKEY_CREDENTIALS_COLLECTION,
  extractClientChallenge,
  getAdminServices,
  normalizeEmail,
  passkeyAdminUnavailableError,
  passkeyJsonError,
  readChallenge,
  toWebAuthnCredential,
  type StoredPasskeyCredential,
} from "@/lib/passkey-server";

export const runtime = "nodejs";

interface LoginFinishBody {
  credential?: AuthenticationResponseJSON;
}

export async function POST(req: NextRequest) {
  const services = getAdminServices();
  if (!services) {
    return passkeyAdminUnavailableError();
  }

  let body: LoginFinishBody;
  try {
    body = await req.json();
  } catch {
    return passkeyJsonError("Payload tidak valid.");
  }

  const credential = body.credential;
  if (!credential?.id) {
    return passkeyJsonError("Credential passkey wajib diisi.");
  }

  let challengeRef: DocumentReference | undefined;

  try {
    const challenge = extractClientChallenge(credential);
    const challengeRecord = await readChallenge(
      services.firestore,
      challenge,
      "authentication"
    );
    challengeRef = challengeRecord.ref;

    if (!challengeRecord.data.credentialIds?.includes(credential.id)) {
      return passkeyJsonError("Credential tidak cocok dengan challenge login.", 403);
    }

    const credentialSnap = await services.firestore
      .collection(PASSKEY_CREDENTIALS_COLLECTION)
      .doc(credential.id)
      .get();

    if (!credentialSnap.exists) {
      return passkeyJsonError("Credential passkey tidak ditemukan.", 404);
    }

    const stored = credentialSnap.data() as StoredPasskeyCredential;
    if (stored.status !== "active") {
      return passkeyJsonError("Passkey ini sudah dinonaktifkan.", 403);
    }
    if (
      challengeRecord.data.email &&
      normalizeEmail(stored.email) !== normalizeEmail(challengeRecord.data.email)
    ) {
      return passkeyJsonError("Credential tidak cocok dengan email login.", 403);
    }

    const verification = await verifyAuthenticationResponse({
      response: credential,
      expectedChallenge: challenge,
      expectedOrigin: challengeRecord.data.origin,
      expectedRPID: challengeRecord.data.rpID,
      credential: toWebAuthnCredential(stored),
      requireUserVerification: true,
    });

    if (!verification.verified) {
      return passkeyJsonError("Verifikasi passkey gagal.", 400);
    }

    const now = new Date();
    await credentialSnap.ref.update({
      counter: verification.authenticationInfo.newCounter,
      lastUsedAt: now,
      updatedAt: now,
    });

    const customToken = await services.auth.createCustomToken(stored.uid);

    return NextResponse.json({
      success: true,
      customToken,
      uid: stored.uid,
      credentialId: stored.credentialId,
    });
  } catch (err) {
    console.error("[Passkey Login Finish] error", err);
    const message = err instanceof Error ? err.message : "Login passkey gagal.";
    return passkeyJsonError(message || "Login passkey gagal.", 400);
  } finally {
    await challengeRef?.delete().catch(() => {});
  }
}
