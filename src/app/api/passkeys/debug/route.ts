import { NextResponse } from "next/server";
import { getFirebaseAdminStatus } from "@/lib/firebase-admin";

export const runtime = "nodejs";

// Endpoint sementara untuk diagnosa 500 di production — hanya membocorkan
// boolean/nama env yang hilang, TIDAK PERNAH isi private key. Hapus setelah
// env Vercel stabil dan passkey terbukti jalan.
export async function GET() {
  const status = getFirebaseAdminStatus();

  return NextResponse.json({
    success: status.ok,
    firebaseAdmin: {
      ok: status.ok,
      missing: status.missing,
      error: status.error,
      hasProjectId: status.hasProjectId,
      hasClientEmail: status.hasClientEmail,
      hasPrivateKey: status.hasPrivateKey,
    },
    passkey: {
      appUrl: process.env.NEXT_PUBLIC_APP_URL || null,
      rpId: process.env.NEXT_PUBLIC_PASSKEY_RP_ID || process.env.PASSKEY_RP_ID || null,
      rpName: process.env.NEXT_PUBLIC_PASSKEY_RP_NAME || process.env.PASSKEY_RP_NAME || null,
    },
  });
}
