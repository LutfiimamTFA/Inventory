import { NextRequest, NextResponse } from "next/server";
import {
  PASSKEY_CREDENTIALS_COLLECTION,
  getAdminServices,
  passkeyJsonError,
  requireFirebaseUser,
  type StoredPasskeyCredential,
} from "@/lib/passkey-server";

export const runtime = "nodejs";

interface RevokeBody {
  credentialId?: string;
}

export async function GET(req: NextRequest) {
  const authResult = await requireFirebaseUser(req);
  if (authResult.response) return authResult.response;

  const services = getAdminServices();
  if (!services.firestore || !services.auth) {
    return passkeyJsonError(
      services.error || "Firebase Admin belum dikonfigurasi untuk passkey.",
      500
    );
  }

  try {
    const snap = await services.firestore
      .collection(PASSKEY_CREDENTIALS_COLLECTION)
      .where("uid", "==", authResult.decoded.uid)
      .where("status", "==", "active")
      .get();

    const devices = snap.docs.map((doc) => {
      const data = doc.data() as StoredPasskeyCredential;
      return {
        credentialId: doc.id,
        deviceName: data.deviceName,
        deviceType: data.deviceType,
        createdAt: toJsonDate(data.createdAt),
        lastUsedAt: toJsonDate(data.lastUsedAt),
        status: data.status,
      };
    });

    return NextResponse.json({ success: true, devices });
  } catch (err) {
    console.error("[Passkey Devices] list error", err);
    return passkeyJsonError("Gagal memuat daftar passkey.", 500);
  }
}

export async function DELETE(req: NextRequest) {
  const authResult = await requireFirebaseUser(req);
  if (authResult.response) return authResult.response;

  const services = getAdminServices();
  if (!services.firestore || !services.auth) {
    return passkeyJsonError(
      services.error || "Firebase Admin belum dikonfigurasi untuk passkey.",
      500
    );
  }

  let body: RevokeBody;
  try {
    body = await req.json();
  } catch {
    return passkeyJsonError("Payload tidak valid.");
  }

  const credentialId = (body.credentialId || "").trim();
  if (!credentialId) {
    return passkeyJsonError("Credential ID wajib diisi.");
  }

  try {
    const ref = services.firestore
      .collection(PASSKEY_CREDENTIALS_COLLECTION)
      .doc(credentialId);
    const snap = await ref.get();
    if (!snap.exists) {
      return passkeyJsonError("Passkey tidak ditemukan.", 404);
    }

    const data = snap.data() as StoredPasskeyCredential;
    if (data.uid !== authResult.decoded.uid) {
      return passkeyJsonError("Anda tidak bisa menghapus passkey user lain.", 403);
    }

    const now = new Date();
    await ref.update({
      status: "revoked",
      updatedAt: now,
      revokedAt: now,
      revokedByUid: authResult.decoded.uid,
    });

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[Passkey Devices] revoke error", err);
    return passkeyJsonError("Gagal menonaktifkan passkey.", 500);
  }
}

function toJsonDate(value: unknown) {
  if (!value) return null;
  if (typeof value === "object" && "toDate" in value) {
    return (value as { toDate: () => Date }).toDate().toISOString();
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string") return value;
  return null;
}
