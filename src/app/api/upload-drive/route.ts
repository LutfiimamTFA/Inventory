import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10MB (batas terbesar di antara foto/invoice)

// Beberapa kemungkinan nama env yang dipakai proyek HRP untuk endpoint upload
// Google Apps Script. Dipakai yang pertama ditemukan.
const UPLOAD_URL_ENV_KEYS = [
  "GOOGLE_APPS_SCRIPT_UPLOAD_URL",
  "NEXT_PUBLIC_GOOGLE_APPS_SCRIPT_UPLOAD_URL",
  "NEXT_PUBLIC_APPS_SCRIPT_UPLOAD_URL",
  "NEXT_PUBLIC_GOOGLE_DRIVE_UPLOAD_URL",
  "ASSETVIEW_GOOGLE_DRIVE_UPLOAD_URL",
  "GOOGLE_DRIVE_APPS_SCRIPT_URL",
] as const;

function resolveUploadUrl(): string | undefined {
  for (const key of UPLOAD_URL_ENV_KEYS) {
    const value = process.env[key];
    if (value) return value;
  }
  return undefined;
}

/**
 * Proxy upload file ke Google Apps Script Web App milik HRP, supaya
 * GOOGLE_DRIVE_UPLOAD_SECRET tidak pernah dikirim ke browser.
 *
 * ASUMSI KONTRAK (belum diverifikasi ke Apps Script HRP yang sebenarnya —
 * sesuaikan field di bawah ini kalau kontrak aslinya berbeda):
 *
 * Request ke endpoint upload (POST, JSON):
 * {
 *   secret: string,
 *   folder: string,
 *   type: string,
 *   fileName: string,
 *   mimeType: string,
 *   base64: string,
 *   assetCode?: string,
 *   assetName?: string,
 * }
 *
 * Response yang diharapkan (JSON):
 * {
 *   success: boolean,
 *   url?: string,
 *   thumbnailUrl?: string,  // kalau tidak ada, di-generate dari fileId
 *   fileId?: string,
 *   name?: string,
 *   mimeType?: string,
 *   size?: number,
 *   message?: string,
 * }
 *
 * PENTING: agar thumbnailUrl (drive.google.com/thumbnail) bisa diakses browser,
 * file di Drive harus di-share dengan permission "Anyone with the link can view".
 */
export async function POST(req: NextRequest) {
  const uploadUrl = resolveUploadUrl();
  const secret = process.env.GOOGLE_DRIVE_UPLOAD_SECRET;
  const rootFolderId = process.env.GOOGLE_DRIVE_ROOT_FOLDER_ID;

  console.debug("[Upload Drive] env exists", !!uploadUrl && !!secret);

  if (!uploadUrl || !secret) {
    return NextResponse.json(
      {
        success: false,
        message:
          "Upload Google Drive belum dikonfigurasi (env upload URL/secret kosong).",
      },
      { status: 500 }
    );
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json(
      { success: false, message: "Payload request tidak valid (bukan FormData)." },
      { status: 400 }
    );
  }

  const file = formData.get("file");
  const folder = String(formData.get("folder") || "assetview/misc");
  // "type" adalah nama field baru; "category" tetap didukung untuk kompatibilitas
  // dengan pemanggil lama yang masih mengirim field "category".
  const type = String(formData.get("type") || formData.get("category") || "misc");
  const assetCode = String(formData.get("assetCode") || "");
  const assetName = String(formData.get("assetName") || "");

  if (!file || !(file instanceof File)) {
    return NextResponse.json(
      { success: false, message: "File tidak ditemukan di payload." },
      { status: 400 }
    );
  }

  console.debug("[Upload Drive] file name", file.name);
  console.debug("[Upload Drive] file type", file.type);
  console.debug("[Upload Drive] file size", file.size);
  console.debug("[Upload Drive] upload type", type);

  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { success: false, message: "Ukuran file melebihi batas maksimum." },
      { status: 400 }
    );
  }

  try {
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    const base64 = buffer.toString("base64");

    const scriptResponse = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        secret,
        folderId: rootFolderId,
        folder,
        type,
        fileName: file.name,
        mimeType: file.type || "application/octet-stream",
        base64,
        assetCode,
        assetName,
      }),
    });

    const result = await scriptResponse.json().catch(() => null);

    if (!scriptResponse.ok || !result || result.success === false) {
      console.error("[Upload Drive] Apps Script upload failed", result);
      return NextResponse.json(
        {
          success: false,
          message: result?.message || result?.error || "Gagal mengunggah file ke Google Drive.",
        },
        { status: 502 }
      );
    }

    // Log bentuk respons Apps Script yang sebenarnya (aman, tanpa base64) supaya
    // gampang dicocokkan kalau nama field di skrip HRP ternyata berbeda.
    console.debug("[Upload Drive] apps script response keys", Object.keys(result));

    const fileId =
      result.fileId || result.id || result.file_id || result.driveFileId || "";

    // Prioritaskan field yang memang dirancang untuk akses langsung/embed
    // (directUrl, thumbnailUrl) di atas webViewLink — webViewLink membuka
    // halaman preview Drive (HTML), bukan gambar langsung, sehingga tidak
    // bisa dipakai sebagai <img src>.
    const url =
      result.directUrl ||
      result.url ||
      result.fileUrl ||
      result.downloadUrl ||
      result.driveDownloadUrl ||
      result.webViewLink ||
      result.driveViewUrl ||
      result.viewUrl ||
      result.webContentLink ||
      result.link ||
      (fileId ? `https://drive.google.com/uc?id=${fileId}` : "");

    if (!url) {
      console.error(
        "[Upload Drive] Apps Script returned success without a usable url/fileId field",
        result
      );
    }

    // Google Drive tidak menyediakan direct-image URL yang stabil dari
    // webViewLink; endpoint /thumbnail resmi Google mengembalikan gambar
    // langsung selama file di-share "anyone with the link can view".
    const thumbnailUrl =
      result.thumbnailUrl ||
      result.directUrl ||
      (fileId ? `https://drive.google.com/thumbnail?id=${fileId}&sz=w1000` : "");

    return NextResponse.json({
      success: true,
      url,
      fileUrl: url,
      thumbnailUrl,
      fileId,
      fileName: result.fileName || result.name || file.name,
      mimeType: result.mimeType || result.fileType || file.type,
      size: result.fileSize || result.size || file.size,
      uploadedAt: new Date().toISOString(),
    });
  } catch (err) {
    console.error("[Upload Drive] unexpected error", err);
    return NextResponse.json(
      { success: false, message: "Terjadi kesalahan saat mengunggah file." },
      { status: 500 }
    );
  }
}
