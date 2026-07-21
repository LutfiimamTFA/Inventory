import { NextRequest, NextResponse } from "next/server";
import { generateAuthenticationOptions } from "@simplewebauthn/server";
import {
  PASSKEY_CREDENTIALS_COLLECTION,
  getAdminServices,
  normalizeEmail,
  passkeyAdminUnavailableError,
  passkeyJsonError,
  resolveWebAuthnConfig,
  storeChallenge,
  type StoredPasskeyCredential,
} from "@/lib/passkey-server";

export const runtime = "nodejs";

interface LoginStartBody {
  email?: string;
}

export async function POST(req: NextRequest) {
  const services = getAdminServices();
  if (!services) {
    return passkeyAdminUnavailableError();
  }

  let body: LoginStartBody;
  try {
    body = await req.json();
  } catch {
    return passkeyJsonError("Payload tidak valid.");
  }

  const email = normalizeEmail(body.email);
  if (!email) {
    return passkeyJsonError("Masukkan email terlebih dahulu untuk login dengan passkey.");
  }

  try {
    const { origin, rpID } = resolveWebAuthnConfig(req);
    const credentialsSnap = await services.firestore
      .collection(PASSKEY_CREDENTIALS_COLLECTION)
      .where("email", "==", email)
      .where("status", "==", "active")
      .get();

    if (credentialsSnap.empty) {
      return passkeyJsonError("Passkey belum diaktifkan untuk email ini.", 404);
    }

    const credentialIds = credentialsSnap.docs.map((doc) => doc.id);
    const options = await generateAuthenticationOptions({
      rpID,
      timeout: 60_000,
      userVerification: "preferred",
      allowCredentials: credentialsSnap.docs.map((doc) => {
        const data = doc.data() as StoredPasskeyCredential;
        return {
          id: doc.id,
          transports: data.transports,
        };
      }),
    });

    await storeChallenge(services.firestore, {
      challenge: options.challenge,
      type: "authentication",
      email,
      credentialIds,
      origin,
      rpID,
    });

    return NextResponse.json(options);
  } catch (err) {
    console.error("[Passkey Login Start] error", err);
    return passkeyJsonError("Gagal memulai login passkey.", 500);
  }
}
