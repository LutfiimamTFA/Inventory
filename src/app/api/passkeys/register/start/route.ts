import { NextRequest, NextResponse } from "next/server";
import { generateRegistrationOptions } from "@simplewebauthn/server";
import {
  PASSKEY_CREDENTIALS_COLLECTION,
  PASSKEY_RP_NAME,
  getAdminServices,
  normalizeEmail,
  passkeyJsonError,
  requireFirebaseUser,
  resolveWebAuthnConfig,
  storeChallenge,
  type StoredPasskeyCredential,
} from "@/lib/passkey-server";

export const runtime = "nodejs";

interface RegisterStartBody {
  uid?: string;
  email?: string;
  displayName?: string;
}

export async function POST(req: NextRequest) {
  const authResult = await requireFirebaseUser(req);
  if (authResult.response) return authResult.response;

  const services = getAdminServices();
  if (!services) {
    return passkeyJsonError("Firebase Admin belum dikonfigurasi untuk passkey.", 500);
  }

  let body: RegisterStartBody;
  try {
    body = await req.json();
  } catch {
    return passkeyJsonError("Payload tidak valid.");
  }

  const uid = (body.uid || "").trim();
  const email = normalizeEmail(body.email || authResult.decoded.email);
  const displayName = (body.displayName || authResult.decoded.name || email).trim();

  if (!uid || !email) {
    return passkeyJsonError("UID dan email wajib diisi.");
  }
  if (uid !== authResult.decoded.uid) {
    return passkeyJsonError("UID passkey tidak cocok dengan sesi login.", 403);
  }

  try {
    const { origin, rpID } = resolveWebAuthnConfig(req);
    const existingSnap = await services.firestore
      .collection(PASSKEY_CREDENTIALS_COLLECTION)
      .where("uid", "==", uid)
      .where("status", "==", "active")
      .get();

    const excludeCredentials = existingSnap.docs.map((doc) => {
      const data = doc.data() as StoredPasskeyCredential;
      return {
        id: doc.id,
        transports: data.transports,
      };
    });

    const options = await generateRegistrationOptions({
      rpName: PASSKEY_RP_NAME,
      rpID,
      userID: new TextEncoder().encode(uid),
      userName: email,
      userDisplayName: displayName || email,
      timeout: 60_000,
      attestationType: "none",
      excludeCredentials,
      authenticatorSelection: {
        residentKey: "preferred",
        userVerification: "required",
      },
      preferredAuthenticatorType: "localDevice",
    });

    await storeChallenge(services.firestore, {
      challenge: options.challenge,
      type: "registration",
      uid,
      email,
      displayName,
      origin,
      rpID,
    });

    return NextResponse.json(options);
  } catch (err) {
    console.error("[Passkey Register Start] error", err);
    return passkeyJsonError("Gagal memulai aktivasi passkey.", 500);
  }
}
