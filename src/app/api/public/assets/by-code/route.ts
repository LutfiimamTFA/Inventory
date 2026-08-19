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
// firebase-admin/firestore, dst di baliknya) SENGAJA dilakukan lewat
// dynamic import() DI DALAM handler (lihat getAdminDb() di bawah), BUKAN
// sebagai top-level `import`. Kalau bootstrap Admin SDK gagal di runtime
// serverless Vercel (mis. bundling/tracing gRPC, native binding, atau
// resolusi package "exports" yang berbeda dari lingkungan lokal), top-level
// import akan crash SAAT MODULE DIEVALUASI — sebelum baris kode apa pun di
// handler ini sempat jalan, sehingga try/catch di bawah TIDAK PERNAH
// tereksekusi dan yang tampil ke user cuma halaman error generik platform
// ("This page couldn't load"), bukan JSON 500 buatan kita. Dynamic import
// di dalam try/catch memastikan kegagalan seperti itu tetap TERTANGKAP dan
// masuk log terstruktur di bawah, bukan crash opaque.
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

// Section — whitelist PUBLIK ketat: field yang boleh dilihat siapa pun yang
// scan QR tanpa login. TIDAK PERNAH tambahkan purchasePrice/invoice/vendor/
// finance/UID PIC/email/audit log/maintenance internal/borrowing history/
// data karyawan ke sini, walau ada di dokumen Firestore aslinya.
function toPublicAssetPayload(id: string, asset: Asset): PublicAssetPayload {
  const photo = resolveAssetPhotoSrc(asset);
  return {
    id,
    assetNumber: getAssetNumber(asset),
    assetCode: asset.assetCode || "",
    assetName: asset.assetName || "",
    categoryName: asset.categoryName || "",
    acquisitionDate: asset.acquisitionDate || asset.purchaseDate || null,
    quantity: getAssetQuantity(asset),
    companyName: asset.companyOwnerName || "",
    locationId: asset.locationId || asset.areaId || asset.roomId || asset.floorId || asset.buildingId || null,
    locationText: asset.location || asset.locationText || "",
    condition: asset.condition || "good",
    conditionLabel: getAssetConditionLabel(asset),
    assetStatus: asset.assetStatus || "available",
    assetStatusLabel: ASSET_STATUS_LABEL[asset.assetStatus] || asset.assetStatus || "-",
    photoUrl: photo.src,
    photoThumbnailUrl: asset.photoThumbnailUrl || photo.src,
    photoDriveFileId: asset.photoDriveFileId || null,
    hasActiveIssue: asset.hasActiveIssue === true || asset.condition === "reported_issue",
    activeIssueTicketNo: asset.activeIssueTicketNo || null,
  };
}

// Section — urutan fallback pencarian SAMA seperti fetchAssetByCode di
// asset-action/page.tsx (assetCode -> qrTagId -> id dokumen langsung),
// supaya QR lama/baru yang sudah beredar tetap terbuka lewat jalur publik
// ini juga. Query EXACT match (bukan prefix/contains) supaya kode dengan
// karakter "/", ".", "-" (mis. "EGS.19/08/2026.DTIC.G-D02") tetap match
// persis, bukan dipotong/di-parse sebagai path.
// Section — dilempar sebagai error yang eksplisit (bukan cuma return null)
// supaya "Firebase Admin belum terkonfigurasi" TIDAK PERNAH menyamar sebagai
// 404 "asset tidak ditemukan" — dua kondisi ini penyebabnya sangat berbeda
// (env/credential vs. kode memang tidak ada) dan harus mudah dibedakan dari
// log server saat audit environment Vercel.
class AdminNotConfiguredError extends Error {
  code = "FIREBASE_ADMIN_NOT_CONFIGURED";

  constructor(message: string) {
    super(message);
    this.name = "AdminNotConfiguredError";
  }
}

async function getAdminDb() {
  const { getAdminFirestore, getFirebaseAdminStatus } = await import("@/lib/firebase-admin");
  const db = getAdminFirestore();
  if (db) return db;

  // getAdminFirestore sengaja dipakai juga oleh route server lain dan
  // mengembalikan null saat bootstrap gagal. Di endpoint ini null BUKAN
  // "asset tidak ada"; ubah menjadi error yang membawa penyebab asli agar
  // log production langsung menunjukkan env yang hilang atau error cert().
  const status = getFirebaseAdminStatus();
  const detail = status.error || (status.missing.length ? `Env hilang: ${status.missing.join(", ")}` : "Penyebab tidak diketahui.");
  throw new AdminNotConfiguredError(`Firebase Admin SDK tidak siap. ${detail}`);
}

async function findAssetByCode(
  code: string
): Promise<{ id: string; data: Asset } | null> {
  const db = await getAdminDb();

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
}

export async function GET(request: NextRequest) {
  // Section — `nextUrl.searchParams.get()` SUDAH men-decode query string
  // sekali secara otomatis (URLSearchParams standar). Kode asset dikirim
  // dari client lewat encodeURIComponent() SEKALI (lihat asset-action/
  // page.tsx) — jadi di sini TIDAK boleh decodeURIComponent() lagi, supaya
  // tidak double-decode (bisa melempar "URI malformed" untuk kode yang
  // kebetulan mengandung karakter mirip escape sequence).
  const rawCode = request.nextUrl.searchParams.get("code");
  const code = (rawCode || "").trim();

  console.log("[Public Asset Lookup] START", { code });

  if (!code) {
    console.warn("[Public Asset Lookup] REJECTED", { reason: "empty_code" });
    return NextResponse.json({ error: "Kode asset wajib diisi." }, { status: 400 });
  }

  try {
    const result = await findAssetByCode(code);
    if (!result) {
      console.warn("[Public Asset Lookup] NOT_FOUND", { code });
      return NextResponse.json({ error: "Asset tidak ditemukan." }, { status: 404 });
    }

    console.log("[Public Asset Lookup] SUCCESS", { assetId: result.id, assetCode: result.data.assetCode });
    return NextResponse.json({ asset: toPublicAssetPayload(result.id, result.data) }, { status: 200 });
  } catch (error) {
    const errorInfo = error as {
      code?: unknown;
      message?: unknown;
      name?: unknown;
      stack?: unknown;
    };
    console.error("[PUBLIC ASSET READ FAILED]", {
      code,
      stage: error instanceof AdminNotConfiguredError ? "firebase_admin_init" : "firestore_query_or_payload",
      errorCode: typeof errorInfo?.code === "string" ? errorInfo.code : undefined,
      errorMessage: typeof errorInfo?.message === "string" ? errorInfo.message : String(error),
      errorName: typeof errorInfo?.name === "string" ? errorInfo.name : "Unknown",
      errorStack: typeof errorInfo?.stack === "string" ? errorInfo.stack : undefined,
    });
    return NextResponse.json(
      { error: "Gagal memuat data asset.", code: "ASSET_PUBLIC_READ_FAILED" },
      { status: 500 }
    );
  }
}
