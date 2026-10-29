import { NextRequest, NextResponse } from "next/server";

// Section "Hapus Permanen Asset" — endpoint ini WAJIB melakukan verifikasi
// role super_admin sendiri, TIDAK PERNAH mengandalkan Firestore Security
// Rules sebagai satu-satunya proteksi (Admin SDK di bawah membaca/menulis
// Firestore dengan hak penuh, bypass rules sepenuhnya — otorisasi harus
// eksplisit di sini). Client mengirim Firebase ID token lewat header
// `Authorization: Bearer <token>` (lihat lib/assets/delete-asset.ts),
// diverifikasi lewat getAdminAuth().verifyIdToken(), lalu role user dicek
// langsung dari dokumen asset_users/{uid} — PERSIS sumber kebenaran yang
// sama dipakai firestore.rules (assetUserDoc().role), bukan sistem role
// baru. Dynamic import firebase-admin (bukan top-level) supaya kegagalan
// bootstrap Admin SDK di runtime serverless tertangkap try/catch, bukan
// crash opaque sebelum handler sempat jalan (lihat catatan yang sama di
// /api/public/assets/by-code/route.ts).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DeleteErrorCode =
  | "UNAUTHENTICATED"
  | "FORBIDDEN"
  | "ASSET_NOT_FOUND"
  | "ADMIN_NOT_CONFIGURED"
  | "DELETE_FAILED";

function errorResponse(code: DeleteErrorCode, message: string, status: number) {
  return NextResponse.json({ error: message, code }, { status });
}

async function loadAdmin() {
  const { getAdminAuth, getAdminFirestore } = await import("@/lib/firebase-admin");
  return { adminAuth: getAdminAuth(), adminDb: getAdminFirestore() };
}

export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: assetId } = await params;

  console.log("[Asset Permanent Delete] START", { assetId });

  if (!assetId) {
    return errorResponse("ASSET_NOT_FOUND", "ID asset tidak valid.", 400);
  }

  const { adminAuth, adminDb } = await loadAdmin();
  if (!adminAuth || !adminDb) {
    console.error("[Asset Permanent Delete] FAILED", {
      assetId,
      stage: "admin_init",
      errorMessage: "Firebase Admin SDK tidak siap (env belum lengkap atau gagal bootstrap).",
    });
    return errorResponse("ADMIN_NOT_CONFIGURED", "Layanan hapus asset sedang tidak tersedia.", 500);
  }

  // Section 1/4 — validasi token login DULU sebelum apa pun lain.
  const authHeader = request.headers.get("authorization") || "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice("Bearer ".length).trim() : "";
  if (!token) {
    console.warn("[Asset Permanent Delete] REJECTED", { assetId, reason: "missing_token" });
    return errorResponse("UNAUTHENTICATED", "Anda harus login untuk melakukan aksi ini.", 401);
  }

  let uid: string;
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    uid = decoded.uid;
  } catch (error) {
    console.warn("[Asset Permanent Delete] REJECTED", {
      assetId,
      reason: "invalid_token",
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return errorResponse("UNAUTHENTICATED", "Sesi login tidak valid. Silakan login ulang.", 401);
  }

  // Section 2/3/4 — role super_admin dicek LANGSUNG dari asset_users/{uid},
  // sumber kebenaran yang sama dipakai firestore.rules (assetUserDoc()).
  // Role selain super_admin (asset_admin/asset_finance/location_pic/staff/
  // it_team) SELALU ditolak di sini, terlepas dari apa pun yang dikirim
  // client — tombol yang disembunyikan di frontend BUKAN proteksi utama.
  let requesterName = "";
  try {
    const userSnap = await adminDb.collection("asset_users").doc(uid).get();
    const userData = userSnap.exists ? (userSnap.data() as Record<string, unknown>) : null;
    const activeStatus = userData?.status === "active";
    const isSuperAdmin = userData?.role === "super_admin";
    requesterName = typeof userData?.name === "string" ? userData.name : "";

    if (!userSnap.exists || !activeStatus || !isSuperAdmin) {
      console.warn("[Asset Permanent Delete] REJECTED", {
        assetId,
        uid,
        reason: "not_super_admin",
        role: userData?.role || null,
        status: userData?.status || null,
      });
      return errorResponse("FORBIDDEN", "Anda tidak memiliki izin untuk menghapus asset secara permanen.", 403);
    }
  } catch (error) {
    console.error("[Asset Permanent Delete] FAILED", {
      assetId,
      uid,
      stage: "role_check",
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return errorResponse("DELETE_FAILED", "Gagal memverifikasi izin akses.", 500);
  }

  // Section — pastikan asset benar-benar ada sebelum dihapus.
  let assetData: Record<string, unknown>;
  try {
    const assetSnap = await adminDb.collection("assets").doc(assetId).get();
    if (!assetSnap.exists) {
      console.warn("[Asset Permanent Delete] NOT_FOUND", { assetId, uid });
      return errorResponse("ASSET_NOT_FOUND", "Asset tidak ditemukan.", 404);
    }
    assetData = assetSnap.data() as Record<string, unknown>;
  } catch (error) {
    console.error("[Asset Permanent Delete] FAILED", {
      assetId,
      uid,
      stage: "fetch_asset",
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return errorResponse("DELETE_FAILED", "Gagal mengambil data asset.", 500);
  }

  // Section INTEGRITY (dilonggarkan atas permintaan eksplisit) — Super Admin
  // boleh menghapus asset permanen TERLEPAS dari status pinjam/laporan aktif
  // (dipakai untuk membersihkan data dummy/testing). Kalau asset yang
  // dihapus masih punya borrowing/ticket aktif, dokumen itu jadi menunjuk ke
  // assetId yang sudah tidak ada — dicatat di log SEBELUM delete supaya
  // tetap ada jejak audit, tapi TIDAK PERNAH lagi memblokir hapus.
  const hasActiveHolder = !!(assetData.currentBorrowerUid || assetData.currentHolderUid);
  const hasActiveIssue = assetData.hasActiveIssue === true || assetData.condition === "reported_issue";
  if (hasActiveHolder || hasActiveIssue) {
    console.warn("[Asset Permanent Delete] deleting with active dependency (allowed)", {
      assetId,
      uid,
      hasActiveHolder,
      hasActiveIssue,
    });
  }

  // Section — HANYA dokumen assets/{id} yang dihapus. Counter global
  // (asset_number_counters/asset_code_counters) TIDAK PERNAH disentuh
  // (bukan milik satu asset, dipakai untuk generate nomor/kode asset
  // berikutnya). Collection riwayat (asset_logs/asset_borrowings/
  // asset_issue_tickets/asset_qr_scan_logs/asset_verification_logs/dst)
  // TIDAK di-cascade-delete — semuanya sudah menyimpan snapshot nama/kode/
  // nomor asset sendiri saat ditulis, jadi tetap valid sebagai histori
  // meski dokumen asset aslinya sudah tidak ada. Asset lain TIDAK PERNAH
  // ikut terpengaruh karena hanya doc.delete() pada SATU document ID ini.
  try {
    await adminDb.collection("assets").doc(assetId).delete();
    console.log("[Asset Permanent Delete] SUCCESS", {
      assetId,
      assetCode: assetData.assetCode,
      deletedByUid: uid,
    });
  } catch (error) {
    console.error("[Asset Permanent Delete] FAILED", {
      assetId,
      uid,
      stage: "delete_asset",
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return errorResponse("DELETE_FAILED", "Gagal menghapus asset.", 500);
  }

  // Section — audit log permanent delete, best-effort (non-fatal): asset
  // SUDAH terhapus di titik ini, kegagalan log tidak boleh membuat client
  // mengira delete gagal.
  try {
    const { FieldValue } = await import("firebase-admin/firestore");
    await adminDb.collection("asset_logs").add({
      assetId,
      assetName: assetData.assetName || "",
      assetCode: assetData.assetCode || "",
      action: "permanent_delete",
      userUid: uid,
      userName: requesterName,
      detail: "Asset dihapus permanen oleh Super Admin",
      timestamp: FieldValue.serverTimestamp(),
    });
  } catch (error) {
    console.error("[Asset Permanent Delete] FAILED", {
      assetId,
      uid,
      stage: "audit_log",
      errorMessage: error instanceof Error ? error.message : String(error),
    });
  }

  return NextResponse.json({ success: true }, { status: 200 });
}
