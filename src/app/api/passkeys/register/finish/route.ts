import { NextRequest, NextResponse } from "next/server";
import { verifyRegistrationResponse, type RegistrationResponseJSON } from "@simplewebauthn/server";
import type { DocumentReference } from "firebase-admin/firestore";
import {
  PASSKEY_CREDENTIALS_COLLECTION,
  bytesToBase64url,
  extractClientChallenge,
  getAdminServices,
  getDeviceInfo,
  normalizeEmail,
  passkeyAdminUnavailableError,
  passkeyJsonError,
  readChallenge,
  requireFirebaseUser,
  type StoredPasskeyCredential,
} from "@/lib/passkey-server";

export const runtime = "nodejs";

interface RegisterFinishBody {
  uid?: string;
  credential?: RegistrationResponseJSON;
}

export async function POST(req: NextRequest) {
  const authResult = await requireFirebaseUser(req);
  if (authResult.response) return authResult.response;

  const services = getAdminServices();
  if (!services) {
    return passkeyAdminUnavailableError();
  }

  let body: RegisterFinishBody;
  try {
    body = await req.json();
  } catch {
    return passkeyJsonError("Payload tidak valid.");
  }

  const uid = (body.uid || "").trim();
  const credential = body.credential;
  if (!uid || !credential?.id) {
    return passkeyJsonError("UID dan credential wajib diisi.");
  }
  if (uid !== authResult.decoded.uid) {
    return passkeyJsonError("UID passkey tidak cocok dengan sesi login.", 403);
  }

  let challengeRef: DocumentReference | undefined;

  try {
    const challenge = extractClientChallenge(credential);
    const challengeRecord = await readChallenge(
      services.firestore,
      challenge,
      "registration"
    );
    challengeRef = challengeRecord.ref;

    if (challengeRecord.data.uid !== uid) {
      return passkeyJsonError("Challenge passkey tidak cocok dengan user.", 403);
    }

    const verification = await verifyRegistrationResponse({
      response: credential,
      expectedChallenge: challenge,
      expectedOrigin: challengeRecord.data.origin,
      expectedRPID: challengeRecord.data.rpID,
      requireUserVerification: true,
    });

    if (!verification.verified) {
      return passkeyJsonError("Verifikasi passkey gagal.", 400);
    }

    const { registrationInfo } = verification;
    const credentialId = registrationInfo.credential.id;
    const existing = await services.firestore
      .collection(PASSKEY_CREDENTIALS_COLLECTION)
      .doc(credentialId)
      .get();

    if (existing.exists) {
      const data = existing.data() as StoredPasskeyCredential;
      if (data.uid !== uid || data.status === "active") {
        return passkeyJsonError("Passkey ini sudah terdaftar.", 409);
      }
    }

    const { deviceName, deviceType, userAgent } = getDeviceInfo(
      req,
      credential.authenticatorAttachment
    );
    const now = new Date();
    const email = normalizeEmail(challengeRecord.data.email || authResult.decoded.email);
    const displayName = challengeRecord.data.displayName || authResult.decoded.name || email;

    await services.firestore
      .collection(PASSKEY_CREDENTIALS_COLLECTION)
      .doc(credentialId)
      .set({
        credentialId,
        uid,
        email,
        displayName,
        publicKey: bytesToBase64url(registrationInfo.credential.publicKey),
        counter: registrationInfo.credential.counter,
        transports: credential.response.transports || registrationInfo.credential.transports || [],
        deviceName,
        deviceType,
        userAgent,
        credentialDeviceType: registrationInfo.credentialDeviceType,
        credentialBackedUp: registrationInfo.credentialBackedUp,
        createdAt: now,
        updatedAt: now,
        lastUsedAt: null,
        status: "active",
      });

    return NextResponse.json({ success: true, credentialId });
  } catch (err) {
    console.error("[Passkey Register Finish] error", err);
    const message = err instanceof Error ? err.message : "Gagal mengaktifkan passkey.";
    return passkeyJsonError(message || "Gagal mengaktifkan passkey.", 400);
  } finally {
    await challengeRef?.delete().catch(() => {});
  }
}
