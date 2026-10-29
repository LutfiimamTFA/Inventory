import { NextRequest, NextResponse } from "next/server";
import { Asset, AssetCondition } from "@/lib/types";
import { findAssetByCode } from "@/app/api/public/_lib/findAssetByCode";

// Section "Halaman Utama Peminjaman Tanpa Login" — simetris dengan
// src/app/api/public/borrow/route.ts. Server-only via Admin SDK (dynamic
// import di dalam handler), firestore.rules tidak diubah. Mirror persis
// field shape returnAsset() di src/lib/borrow-actions.ts supaya transaksi
// dari kios publik tampil identik di list aset/laporan admin dengan
// transaksi yang dibuat lewat jalur login biasa.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PublicReturnErrorCode =
  | "FIREBASE_ADMIN_NOT_CONFIGURED"
  | "INVALID_REQUEST"
  | "ASSET_NOT_FOUND"
  | "NO_ACTIVE_BORROWING"
  | "TRANSACTION_FAILED";

class PublicReturnApiError extends Error {
  code: PublicReturnErrorCode;
  status: number;

  constructor(code: PublicReturnErrorCode, status: number, message: string) {
    super(message);
    this.name = "PublicReturnApiError";
    this.code = code;
    this.status = status;
  }
}

async function getAdminDb() {
  const { getAdminFirestore, getFirebaseAdminStatus } = await import("@/lib/firebase-admin");
  const db = getAdminFirestore();
  if (db) return db;

  const status = getFirebaseAdminStatus();
  const reasons: string[] = [];
  if (status.missing.length) reasons.push(`env hilang: ${status.missing.join(", ")}`);
  if (status.hasPrivateKey && !status.privateKeyLooksValidPem) {
    reasons.push("FIREBASE_PRIVATE_KEY tidak berbentuk PEM valid.");
  }
  if (status.projectIdMismatch) {
    reasons.push(`FIREBASE_PROJECT_ID ("${status.projectId}") berbeda dari NEXT_PUBLIC_FIREBASE_PROJECT_ID.`);
  }
  if (status.error) reasons.push(status.error);

  throw new PublicReturnApiError(
    "FIREBASE_ADMIN_NOT_CONFIGURED",
    500,
    reasons.length ? reasons.join(" | ") : "Firebase Admin SDK tidak siap, penyebab tidak diketahui."
  );
}

const VALID_RETURN_CONDITIONS: AssetCondition[] = ["good", "minor_damage", "heavy_damage"];

interface ReturnRequestBody {
  code?: unknown;
  borrowingId?: unknown;
  returnCondition?: unknown;
  notes?: unknown;
}

export async function POST(request: NextRequest) {
  let body: ReturnRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body request tidak valid.", code: "INVALID_REQUEST" }, { status: 400 });
  }

  const code = typeof body.code === "string" ? body.code.trim() : "";
  const borrowingIdHint = typeof body.borrowingId === "string" ? body.borrowingId.trim() : "";
  const returnCondition: AssetCondition = VALID_RETURN_CONDITIONS.includes(body.returnCondition as AssetCondition)
    ? (body.returnCondition as AssetCondition)
    : "good";
  const notes = typeof body.notes === "string" ? body.notes.trim() : "";

  console.log("[Public Return] START", { code, borrowingIdHint, returnCondition });

  if (!code) {
    return NextResponse.json({ error: "Kode asset wajib diisi.", code: "INVALID_REQUEST" }, { status: 400 });
  }

  try {
    const db = await getAdminDb();
    const { FieldValue } = await import("firebase-admin/firestore");

    const lookup = await findAssetByCode(db, code);
    if (!lookup) {
      console.warn("[Public Return] NOT_FOUND", { code });
      return NextResponse.json({ error: "Asset tidak ditemukan.", code: "ASSET_NOT_FOUND" }, { status: 404 });
    }

    const assetRef = db.collection("assets").doc(lookup.id);

    const result = await db.runTransaction(async (transaction) => {
      const freshSnap = await transaction.get(assetRef);
      if (!freshSnap.exists) {
        throw new PublicReturnApiError("ASSET_NOT_FOUND", 404, "Asset tidak ditemukan.");
      }
      const asset = freshSnap.data() as Asset;

      const borrowingId = borrowingIdHint || asset.currentBorrowingId || null;
      if (!borrowingId) {
        throw new PublicReturnApiError(
          "NO_ACTIVE_BORROWING",
          404,
          "Tidak ditemukan peminjaman aktif untuk asset ini."
        );
      }

      const borrowingRef = db.collection("asset_borrowings").doc(borrowingId);
      const borrowingSnap = await transaction.get(borrowingRef);
      if (!borrowingSnap.exists || borrowingSnap.data()?.assetId !== lookup.id) {
        throw new PublicReturnApiError(
          "NO_ACTIVE_BORROWING",
          404,
          "Tidak ditemukan peminjaman aktif untuk asset ini."
        );
      }
      if (borrowingSnap.data()?.status !== "borrowed") {
        throw new PublicReturnApiError(
          "NO_ACTIVE_BORROWING",
          409,
          "Peminjaman ini sudah dikembalikan sebelumnya."
        );
      }

      const isDamaged = returnCondition === "minor_damage" || returnCondition === "heavy_damage";

      transaction.update(borrowingRef, {
        returnedAt: FieldValue.serverTimestamp(),
        returnedByUid: null,
        returnedByName: "Public Kiosk",
        status: "returned",
        statusLabel: "Sudah Dikembalikan",
        returnCondition,
        returnNotes: notes,
      });

      // Section — mirror assetReturnPayload di returnAsset()
      // (src/lib/borrow-actions.ts), termasuk snapshot lastHolder* sebelum
      // dikosongkan, supaya admin tetap bisa lihat siapa pemegang terakhir.
      transaction.update(assetRef, {
        assetStatus: isDamaged ? "maintenance" : "available",
        condition: returnCondition,
        currentBorrowingId: null,
        currentBorrowerUid: null,
        currentBorrowerName: null,
        currentUsageStatus: isDamaged ? "maintenance" : "available",
        currentUsageStatusLabel: isDamaged ? "Maintenance" : "Tersedia",
        lastHolderUid: asset.currentHolderUid || asset.currentBorrowerUid || null,
        lastHolderName: asset.currentHolderName || asset.currentBorrowerName || null,
        lastHolderEmail: asset.currentHolderEmail || null,
        lastHeldAt: asset.currentUsageStartedAt || null,
        lastReturnedAt: FieldValue.serverTimestamp(),
        currentHolderUid: null,
        currentHolderName: null,
        currentHolderEmail: null,
        currentHolderDivision: null,
        currentUsageExpectedReturnAt: null,
        returnedAt: FieldValue.serverTimestamp(),
        returnedByUid: null,
        returnedByName: "Public Kiosk",
        updatedAt: FieldValue.serverTimestamp(),
        updatedByUid: null,
        updatedByName: "Public Kiosk",
      });

      return {
        assetName: asset.assetName || "",
        assetCode: asset.assetCode || code,
      };
    });

    await db.collection("asset_logs").add({
      assetId: lookup.id,
      assetName: result.assetName,
      assetCode: result.assetCode,
      action: "return",
      userUid: null,
      userName: "Public Kiosk",
      detail: notes || "Aset dikembalikan (kios publik, tanpa login)",
      createdAt: FieldValue.serverTimestamp(),
    });

    console.log("[Public Return] SUCCESS", { assetCode: result.assetCode });

    return NextResponse.json(
      {
        assetName: result.assetName,
        assetCode: result.assetCode,
        returnedCondition: returnCondition,
        returnedAt: new Date().toISOString(),
      },
      { status: 200 }
    );
  } catch (error) {
    const apiError = error instanceof PublicReturnApiError ? error : null;
    console.error("[PUBLIC RETURN FAILED]", {
      code,
      errorCode: apiError?.code || "TRANSACTION_FAILED",
      errorMessage: error instanceof Error ? error.message : String(error),
      errorName: error instanceof Error ? error.name : "Unknown",
      errorStack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json(
      {
        error: apiError?.message || "Gagal memproses pengembalian.",
        code: apiError?.code || "TRANSACTION_FAILED",
      },
      { status: apiError?.status || 500 }
    );
  }
}
