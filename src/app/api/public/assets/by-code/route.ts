import { NextRequest, NextResponse } from "next/server";
import { ASSET_STATUS_LABEL, getAssetConditionLabel } from "@/lib/utils";
import { getAssetNumber, getAssetQuantity } from "@/lib/assets/inventory";
import { resolveAssetPhotoSrc } from "@/lib/assets/asset-status";
import { Asset } from "@/lib/types";

// Section "Perbaiki bug kritis QR Asset public" — route ini WAJIB
// server-only: hanya Firebase Admin SDK (getAdminFirestore, helper existing
// di lib/firebase-admin.ts — TIDAK ada initialization baru di file ini).
// Firestore `assets` TETAP tidak public (tidak ada `allow read: if true` di
// firestore.rules) — akses publik lewat route ini SAJA, yang berjalan
// tepercaya di server dan hanya mengembalikan field whitelist di bawah.
// Jangan pernah import "firebase/firestore" (client SDK) atau
// "@/lib/firebase" (auth.currentUser/onAuthStateChanged) di file ini — sudah
// ditelusuri: utils.ts/asset-status.ts/inventory.ts/drive-file-id.ts/types.ts
// SEMUA bersih, tidak ada satupun yang menyentuh client SDK.
//
// Section — import "@/lib/firebase-admin" (dan subpath firebase-admin/app,
// firebase-admin/firestore, dst di baliknya) SENGAJA lewat dynamic import()
// DI DALAM handler (lihat getAdminDb()), BUKAN top-level `import`. Kalau
// bootstrap Admin SDK gagal di runtime serverless Vercel (bundling/tracing
// gRPC, native binding, resolusi package "exports" berbeda dari lokal),
// top-level import akan crash SAAT MODULE DIEVALUASI — sebelum baris kode
// apa pun di handler sempat jalan, sehingga try/catch TIDAK PERNAH
// tereksekusi dan yang tampil ke user cuma error generik platform, bukan
// JSON buatan kita. Dynamic import di dalam try/catch memastikan kegagalan
// seperti itu tetap TERTANGKAP dan masuk log terstruktur, bukan crash opaque.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface PublicAssetPayload {
  id: string;
  assetNumber: number | null;
  assetCode: string;
  assetName: string;
  categoryName: string;
  acquisitionDate: string | null;
  quantity: number;
  companyName: string;
  locationId: string | null;
  locationText: string;
  condition: string;
  conditionLabel: string;
  assetStatus: string;
  assetStatusLabel: string;
  photoUrl: string | null;
  photoThumbnailUrl: string | null;
  photoDriveFileId: string | null;
  hasActiveIssue: boolean;
  activeIssueTicketNo: string | null;
}

// Section 7 "Perbaiki serializer" — SETIAP field dibungkus try/catch
// masing-masing (bukan satu try/catch besar untuk seluruh objek) supaya
// SATU field yang gagal di-resolve (mis. resolveAssetPhotoSrc melempar
// untuk bentuk data foto yang tidak terduga) tidak pernah menggagalkan
// SELURUH response — field itu jatuh ke fallback aman, field lain tetap
// tampil, dan asset tetap berhasil dibaca.
function safeField<T>(compute: () => T, fallback: T, fieldName: string): T {
  try {
    return compute();
  } catch (error) {
    console.warn("[Public Asset Lookup] field mapping fallback", {
      field: fieldName,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return fallback;
  }
}

// Section — whitelist PUBLIK ketat: field yang boleh dilihat siapa pun yang
// scan QR tanpa login. TIDAK PERNAH tambahkan purchasePrice/invoice/vendor/
// finance/UID PIC/email/audit log/maintenance internal/borrowing history/
// data karyawan ke sini, walau ada di dokumen Firestore aslinya.
function toPublicAssetPayload(id: string, asset: Asset): PublicAssetPayload {
  return {
    id,
    assetNumber: safeField(() => getAssetNumber(asset), null, "assetNumber"),
    assetCode: safeField(() => asset.assetCode || "", "", "assetCode"),
    assetName: safeField(() => asset.assetName || "", "", "assetName"),
    categoryName: safeField(() => asset.categoryName || "", "", "categoryName"),
    acquisitionDate: safeField(() => asset.acquisitionDate || asset.purchaseDate || null, null, "acquisitionDate"),
    quantity: safeField(() => getAssetQuantity(asset), 1, "quantity"),
    companyName: safeField(() => asset.companyOwnerName || "", "", "companyName"),
    locationId: safeField(
      () => asset.locationId || asset.areaId || asset.roomId || asset.floorId || asset.buildingId || null,
      null,
      "locationId"
    ),
    locationText: safeField(() => asset.location || asset.locationText || "", "", "locationText"),
    condition: safeField(() => asset.condition || "good", "good", "condition"),
    conditionLabel: safeField(() => getAssetConditionLabel(asset), "-", "conditionLabel"),
    assetStatus: safeField(() => asset.assetStatus || "available", "available", "assetStatus"),
    assetStatusLabel: safeField(
      () => ASSET_STATUS_LABEL[asset.assetStatus] || asset.assetStatus || "-",
      "-",
      "assetStatusLabel"
    ),
    photoUrl: safeField(() => resolveAssetPhotoSrc(asset).src, null, "photoUrl"),
    photoThumbnailUrl: safeField(
      () => asset.photoThumbnailUrl || resolveAssetPhotoSrc(asset).src,
      null,
      "photoThumbnailUrl"
    ),
    photoDriveFileId: safeField(() => asset.photoDriveFileId || null, null, "photoDriveFileId"),
    hasActiveIssue: safeField(
      () => asset.hasActiveIssue === true || asset.condition === "reported_issue",
      false,
      "hasActiveIssue"
    ),
    activeIssueTicketNo: safeField(() => asset.activeIssueTicketNo || null, null, "activeIssueTicketNo"),
  };
}

// Section 4 — TIGA kategori kegagalan server yang harus mudah dibedakan
// dari response DAN log, tanpa pernah membocorkan credential/stack ke
// browser: admin SDK belum siap, Firestore query gagal, atau serializer
// gagal total (harusnya nyaris mustahil sekarang karena toPublicAssetPayload
// sudah defensif per-field, tapi tetap dijaga).
type PublicAssetErrorCode =
  | "FIREBASE_ADMIN_NOT_CONFIGURED"
  | "ASSET_PUBLIC_QUERY_FAILED"
  | "ASSET_PUBLIC_MAPPING_FAILED";

class PublicAssetApiError extends Error {
  code: PublicAssetErrorCode;
  stage: string;

  constructor(code: PublicAssetErrorCode, stage: string, message: string) {
    super(message);
    this.name = "PublicAssetApiError";
    this.code = code;
    this.stage = stage;
  }
}

async function getAdminDb() {
  const { getAdminFirestore, getFirebaseAdminStatus } = await import("@/lib/firebase-admin");
  const db = getAdminFirestore();
  if (db) return db;

  // getAdminFirestore() dipakai bersama oleh route server lain dan sengaja
  // mengembalikan null saat bootstrap gagal (tidak throw) — di endpoint ini
  // null BUKAN "asset tidak ada", jadi diubah jadi error eksplisit yang
  // membawa penyebab asli (env hilang / private key tidak PEM valid /
  // project id server-client mismatch) supaya log production langsung
  // menunjukkan mana yang salah, TANPA pernah mencantumkan isi credential.
  const status = getFirebaseAdminStatus();
  const reasons: string[] = [];
  if (status.missing.length) reasons.push(`env hilang: ${status.missing.join(", ")}`);
  if (status.hasPrivateKey && !status.privateKeyLooksValidPem) {
    reasons.push("FIREBASE_PRIVATE_KEY tidak berbentuk PEM valid (kemungkinan newline rusak saat disalin ke Vercel)");
  }
  if (status.projectIdMismatch) {
    reasons.push(
      `FIREBASE_PROJECT_ID ("${status.projectId}") berbeda dari NEXT_PUBLIC_FIREBASE_PROJECT_ID — Admin SDK membaca project Firebase yang berbeda dari yang dipakai Client SDK`
    );
  }
  if (status.error) reasons.push(status.error);

  throw new PublicAssetApiError(
    "FIREBASE_ADMIN_NOT_CONFIGURED",
    "firebase_admin_init",
    reasons.length ? reasons.join(" | ") : "Firebase Admin SDK tidak siap, penyebab tidak diketahui."
  );
}

// Section 6 — urutan fallback pencarian SAMA seperti fetchAssetByCode di
// asset-action/page.tsx (assetCode -> qrTagId -> id dokumen langsung),
// supaya QR lama/baru yang sudah beredar tetap terbuka lewat jalur publik
// ini juga. Query EXACT match (bukan prefix/contains) supaya kode dengan
// karakter "/", ".", "-" (mis. "EGS.19/08/2026.DTIC.G-D02") tetap match
// persis, bukan dipotong/di-parse sebagai path — where() Firestore
// memperlakukan nilai itu sebagai STRING UTUH, bukan path segment, jadi "/"
// di dalamnya aman.
async function findAssetByCode(code: string): Promise<{ id: string; data: Asset } | null> {
  const db = await getAdminDb();

  try {
    console.log("[Public Asset Lookup] QUERY", { collection: "assets", field: "assetCode", code });
    const byCode = await db.collection("assets").where("assetCode", "==", code).limit(1).get();
    if (!byCode.empty) {
      const d = byCode.docs[0];
      return { id: d.id, data: d.data() as Asset };
    }

    console.log("[Public Asset Lookup] QUERY", { collection: "assets", field: "qrTagId", code });
    const byTag = await db.collection("assets").where("qrTagId", "==", code).limit(1).get();
    if (!byTag.empty) {
      const d = byTag.docs[0];
      return { id: d.id, data: d.data() as Asset };
    }

    console.log("[Public Asset Lookup] QUERY", { collection: "assets", field: "__doc_id__", code });
    const byId = await db.collection("assets").doc(code).get();
    if (byId.exists) {
      return { id: byId.id, data: byId.data() as Asset };
    }

    return null;
  } catch (error) {
    const err = error as { code?: unknown; message?: unknown };
    throw new PublicAssetApiError(
      "ASSET_PUBLIC_QUERY_FAILED",
      "firestore_query",
      typeof err?.message === "string" ? err.message : "Firestore query gagal."
    );
  }
}

export async function GET(request: NextRequest) {
  // Section 12 — `nextUrl.searchParams.get()` SUDAH men-decode query string
  // sekali secara otomatis (URLSearchParams standar). Kode asset dikirim
  // dari client lewat encodeURIComponent() SEKALI (lihat asset-action/
  // page.tsx) — jadi di sini TIDAK boleh decodeURIComponent() lagi, supaya
  // tidak double-decode (bisa melempar "URI malformed" untuk kode yang
  // kebetulan mengandung karakter mirip escape sequence, dan MERUSAK kode
  // yang mengandung "/").
  const rawCode = request.nextUrl.searchParams.get("code");
  const code = (rawCode || "").trim();

  console.log("[Public Asset Lookup] START", { code });

  if (!code) {
    console.warn("[Public Asset Lookup] REJECTED", { reason: "empty_code" });
    return NextResponse.json({ error: "Kode asset wajib diisi." }, { status: 400 });
  }

  let result: { id: string; data: Asset } | null;
  try {
    result = await findAssetByCode(code);
  } catch (error) {
    const apiError = error instanceof PublicAssetApiError ? error : null;
    console.error("[PUBLIC ASSET READ FAILED]", {
      code,
      stage: apiError?.stage || "unknown",
      errorCode: apiError?.code || "UNKNOWN",
      errorMessage: error instanceof Error ? error.message : String(error),
      errorName: error instanceof Error ? error.name : "Unknown",
      errorStack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json(
      {
        error:
          apiError?.code === "FIREBASE_ADMIN_NOT_CONFIGURED"
            ? "Layanan pencarian asset sedang tidak tersedia."
            : "Gagal memuat data asset.",
        code: apiError?.code || "ASSET_PUBLIC_READ_FAILED",
      },
      { status: 500 }
    );
  }

  if (!result) {
    console.warn("[Public Asset Lookup] NOT_FOUND", { code });
    return NextResponse.json({ error: "Asset tidak ditemukan." }, { status: 404 });
  }

  try {
    const payload = toPublicAssetPayload(result.id, result.data);
    console.log("[Public Asset Lookup] SUCCESS", { assetId: result.id, assetCode: payload.assetCode });
    return NextResponse.json({ asset: payload }, { status: 200 });
  } catch (error) {
    // Section 7/11 — sampai titik ini nyaris tidak mungkin throw lagi (semua
    // field sudah dibungkus safeField masing-masing di atas), tapi tetap
    // dijaga supaya SERIALISASI JSON (mis. kalau ada field non-primitif
    // yang lolos) tidak pernah jadi 500 opaque tanpa log.
    console.error("[PUBLIC ASSET READ FAILED]", {
      code,
      stage: "response_serialization",
      errorCode: "ASSET_PUBLIC_MAPPING_FAILED",
      errorMessage: error instanceof Error ? error.message : String(error),
      errorName: error instanceof Error ? error.name : "Unknown",
      errorStack: error instanceof Error ? error.stack : undefined,
    });
    return NextResponse.json(
      { error: "Gagal memuat data asset.", code: "ASSET_PUBLIC_MAPPING_FAILED" },
      { status: 500 }
    );
  }
}
