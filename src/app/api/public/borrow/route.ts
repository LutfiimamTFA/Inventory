import { NextRequest, NextResponse } from "next/server";
import { Asset } from "@/lib/types";
import { isKnownPublicBorrower } from "@/lib/publicBorrowDirectory";
import { findAssetByCode } from "@/app/api/public/_lib/findAssetByCode";

// Section "Halaman Utama Peminjaman Tanpa Login" — route ini WAJIB
// server-only: hanya Firebase Admin SDK (dynamic import di dalam handler,
// pola sama persis dengan src/app/api/public/assets/by-code/route.ts, supaya
// kegagalan bootstrap Admin SDK tertangkap try/catch, bukan crash opaque di
// Vercel). firestore.rules TIDAK diubah untuk fitur ini — akses publik lewat
// Admin SDK di server saja, yang bypass rules secara sah (bukan rules yang
// dilonggarkan).
//
// Identitas peminjam di sini SELALU divalidasi ulang terhadap daftar statis
// src/lib/publicBorrowDirectory.ts di server (bukan dipercaya dari client)
// — tidak ada akun Firebase Auth untuk nama-nama ini, jadi borrowedByUid
// SELALU null untuk transaksi dari jalur ini.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PublicBorrowErrorCode =
  | "FIREBASE_ADMIN_NOT_CONFIGURED"
  | "INVALID_REQUEST"
  | "INVALID_BORROWER"
  | "ASSET_NOT_FOUND"
  | "NOT_BORROWABLE"
  | "ALREADY_BORROWED"
  | "TRANSACTION_FAILED";

class PublicBorrowApiError extends Error {
  code: PublicBorrowErrorCode;
  status: number;

  constructor(code: PublicBorrowErrorCode, status: number, message: string) {
    super(message);
    this.name = "PublicBorrowApiError";
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

  throw new PublicBorrowApiError(
    "FIREBASE_ADMIN_NOT_CONFIGURED",
    500,
    reasons.length ? reasons.join(" | ") : "Firebase Admin SDK tidak siap, penyebab tidak diketahui."
  );
}

interface BorrowRequestBody {
  code?: unknown;
  borrowerDivisionId?: unknown;
  borrowerName?: unknown;
  estimatedReturnAt?: unknown;
  notes?: unknown;
}

export async function POST(request: NextRequest) {
  let body: BorrowRequestBody;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Body request tidak valid.", code: "INVALID_REQUEST" }, { status: 400 });
  }

  const code = typeof body.code === "string" ? body.code.trim() : "";
  const borrowerDivisionId = typeof body.borrowerDivisionId === "string" ? body.borrowerDivisionId.trim() : "";
  const borrowerName = typeof body.borrowerName === "string" ? body.borrowerName.trim() : "";
  const estimatedReturnAt = typeof body.estimatedReturnAt === "string" ? body.estimatedReturnAt : null;
  const notes = typeof body.notes === "string" ? body.notes.trim() : "";

  console.log("[Public Borrow] START", { code, borrowerDivisionId, borrowerName });

  if (!code || !borrowerDivisionId || !borrowerName) {
    return NextResponse.json(
      { error: "Kode asset, divisi, dan nama peminjam wajib diisi.", code: "INVALID_REQUEST" },
      { status: 400 }
    );
  }

  // Section — jangan pernah percaya nama tampilan dari client begitu saja;
  // validasi ulang terhadap daftar referensi statis di server.
  if (!isKnownPublicBorrower(borrowerDivisionId, borrowerName)) {
    console.warn("[Public Borrow] REJECTED", { reason: "unknown_borrower", borrowerDivisionId, borrowerName });
    return NextResponse.json(
      { error: "Nama/divisi peminjam tidak dikenali.", code: "INVALID_BORROWER" },
      { status: 400 }
    );
  }

  try {
    const db = await getAdminDb();
    const { FieldValue } = await import("firebase-admin/firestore");

    const lookup = await findAssetByCode(db, code);
    if (!lookup) {
      console.warn("[Public Borrow] NOT_FOUND", { code });
      return NextResponse.json({ error: "Asset tidak ditemukan.", code: "ASSET_NOT_FOUND" }, { status: 404 });
    }

    const assetRef = db.collection("assets").doc(lookup.id);
    const borrowingRef = db.collection("asset_borrowings").doc();

    const result = await db.runTransaction(async (transaction) => {
      // Section — WAJIB re-fetch FRESH di dalam transaksi (bukan pakai hasil
      // findAssetByCode di atas yang sudah basi begitu transaksi dimulai),
      // supaya dua kiosk yang submit nyaris bersamaan untuk aset yang sama
      // tidak pernah lolos dua-duanya (double-booking) — ini yang tidak
      // dijamin oleh borrowAsset() lama di src/lib/borrow-actions.ts.
      const freshSnap = await transaction.get(assetRef);
      if (!freshSnap.exists) {
        throw new PublicBorrowApiError("ASSET_NOT_FOUND", 404, "Asset tidak ditemukan.");
      }
      const asset = freshSnap.data() as Asset;

      if (asset.trackingMode !== "shared_borrowable" || asset.isBorrowable === false) {
        throw new PublicBorrowApiError(
          "NOT_BORROWABLE",
          409,
          "Asset ini tidak tersedia untuk dipinjam lewat kios publik."
        );
      }

      const isAvailable =
        (asset.currentUsageStatus || "available") === "available" && (asset.assetStatus || "available") === "available";
      if (!isAvailable) {
        throw new PublicBorrowApiError("ALREADY_BORROWED", 409, "Asset ini sedang dipinjam/tidak tersedia.");
      }

      // Section — mirror field shape borrowAsset() di src/lib/borrow-actions.ts
      // (dual-write assetStatus/currentBorrower* lama DAN
      // currentUsageStatus/currentHolder* baru) supaya list aset & laporan
      // tetap konsisten membaca transaksi dari kios publik ini.
      transaction.set(borrowingRef, {
        assetId: lookup.id,
        assetName: asset.assetName || "",
        assetCode: asset.assetCode || code,
        locationText: asset.locationText || asset.location || "",
        borrowedByUid: null,
        borrowedByName: borrowerName,
        borrowedByEmail: null,
        borrowerDivision: borrowerDivisionId,
        borrowedAt: FieldValue.serverTimestamp(),
        estimatedReturnAt: estimatedReturnAt || null,
        returnedAt: null,
        status: "borrowed",
        borrowNotes: notes,
        source: "public_kiosk",
        isPublicTransaction: true,
      });

      transaction.update(assetRef, {
        assetStatus: "borrowed",
        currentBorrowingId: borrowingRef.id,
        currentBorrowerUid: null,
        currentBorrowerName: borrowerName,
        currentUsageStatus: "borrowed",
        currentUsageStatusLabel: "Dipinjam",
        currentHolderUid: null,
        currentHolderName: borrowerName,
        currentHolderEmail: null,
        currentHolderDivision: borrowerDivisionId,
        currentUsageStartedAt: FieldValue.serverTimestamp(),
        currentUsageExpectedReturnAt: estimatedReturnAt || null,
        updatedAt: FieldValue.serverTimestamp(),
        updatedByUid: null,
        updatedByName: "Public Kiosk",
      });

      return {
        assetName: asset.assetName || "",
        assetCode: asset.assetCode || code,
      };
    });

    // Section — log minimal lewat Admin SDK langsung (bukan writeAssetLog
    // client helper, yang tidak bisa dipakai di server). Notifikasi ke
    // manager (asset_admin/super_admin) SENGAJA belum diimplementasikan di
    // Tahap 1 — createAssetNotification() di src/lib/notifications.ts pakai
    // client SDK, butuh port Admin SDK terpisah di luar scope Tahap 1 ini.
    await db.collection("asset_logs").add({
      assetId: lookup.id,
      assetName: result.assetName,
      assetCode: result.assetCode,
      action: "borrow",
      userUid: null,
      userName: borrowerName,
      detail: notes || "Aset dipinjam (kios publik, tanpa login)",
      createdAt: FieldValue.serverTimestamp(),
    });

    console.log("[Public Borrow] SUCCESS", { borrowingId: borrowingRef.id, assetCode: result.assetCode });

    return NextResponse.json(
      {
        borrowingId: borrowingRef.id,
        assetName: result.assetName,
        assetCode: result.assetCode,
        borrowerName,
        borrowerDivision: borrowerDivisionId,
        estimatedReturnAt,
      },
      { status: 200 }
    );
  } catch (error) {
    const apiError = error instanceof PublicBorrowApiError ? error : null;
    console.error("[PUBLIC BORROW FAILED]", {
      code,
      errorCode: apiError?.code || "TRANSACTION_FAILED",
      errorMessage: error instanceof Error ? error.message : String(error),
      errorName: error instanceof Error ? error.name : "Unknown",
      errorStack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json(
      {
        error: apiError?.message || "Gagal memproses peminjaman.",
        code: apiError?.code || "TRANSACTION_FAILED",
      },
      { status: apiError?.status || 500 }
    );
  }
}
