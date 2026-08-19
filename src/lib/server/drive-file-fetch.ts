// Ambil isi file Google Drive lewat Apps Script Web App (server-side saja —
// secret tidak pernah dikirim ke browser). Dipakai oleh /api/asset-files/[fileId].
export interface DriveFileFetchResult {
  buffer: Buffer;
  mimeType: string;
  fileName: string;
}

export interface DriveFileFetchError {
  error: string;
  status: number;
}

function resolveScriptUrl(): string | undefined {
  return (
    process.env.GOOGLE_APPS_SCRIPT_UPLOAD_URL ||
    process.env.NEXT_PUBLIC_GOOGLE_APPS_SCRIPT_UPLOAD_URL ||
    process.env.NEXT_PUBLIC_APPS_SCRIPT_UPLOAD_URL ||
    process.env.NEXT_PUBLIC_GOOGLE_DRIVE_UPLOAD_URL ||
    process.env.GOOGLE_DRIVE_APPS_SCRIPT_URL
  );
}

function resolveSecret(): string | undefined {
  return (
    process.env.GOOGLE_DRIVE_UPLOAD_SECRET ||
    process.env.NEXT_PUBLIC_GOOGLE_DRIVE_UPLOAD_SECRET ||
    process.env.NEXT_PUBLIC_UPLOAD_SECRET
  );
}

export async function fetchDriveFile(
  fileId: string
): Promise<DriveFileFetchResult | DriveFileFetchError> {
  const scriptUrl = resolveScriptUrl();
  const secret = resolveSecret();

  if (!scriptUrl || !secret) {
    console.error("[Asset File Proxy] missing env (GOOGLE_DRIVE_APPS_SCRIPT_URL/GOOGLE_DRIVE_UPLOAD_SECRET)");
    return { error: "Konfigurasi Google Drive belum lengkap", status: 500 };
  }

  const res = await fetch(scriptUrl, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify({ secret, action: "download", fileId }),
    cache: "no-store",
  });

  if (!res.ok) {
    console.error("[Asset File Proxy] Apps Script HTTP error:", res.status);
    return {
      error: res.status === 404 ? "File tidak ditemukan" : "Gagal mengambil file Drive",
      status: res.status,
    };
  }

  const data = await res.json().catch(() => null);

  if (!data || !data.success || !data.base64) {
    console.error("[Asset File Proxy] Apps Script error:", data?.error || data?.message);
    return { error: data?.error || data?.message || "File tidak ditemukan", status: 404 };
  }

  const mimeType: string = data.mimeType || data.fileType || data.contentType || "application/octet-stream";
  const buffer = Buffer.from(data.base64, "base64");
  const fileName: string = typeof data.fileName === "string" && data.fileName.trim() ? data.fileName.trim() : "asset-file";

  return { buffer, mimeType, fileName };
}
