import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ success: false, message }, { status });
}

function safeInlineFileName(value: unknown, fallback: string) {
  const raw = typeof value === "string" && value.trim() ? value.trim() : fallback;
  return raw.replace(/["\r\n]/g, "").slice(0, 120) || fallback;
}

export async function GET(request: NextRequest) {
  try {
    const fileId = request.nextUrl.searchParams.get("fileId")?.trim();

    if (!fileId) {
      return jsonError("fileId wajib diisi", 400);
    }

    const scriptUrl =
      process.env.GOOGLE_APPS_SCRIPT_UPLOAD_URL ||
      process.env.NEXT_PUBLIC_GOOGLE_APPS_SCRIPT_UPLOAD_URL ||
      process.env.NEXT_PUBLIC_APPS_SCRIPT_UPLOAD_URL ||
      process.env.NEXT_PUBLIC_GOOGLE_DRIVE_UPLOAD_URL ||
      process.env.GOOGLE_DRIVE_APPS_SCRIPT_URL;

    const secret =
      process.env.GOOGLE_DRIVE_UPLOAD_SECRET ||
      process.env.NEXT_PUBLIC_GOOGLE_DRIVE_UPLOAD_SECRET ||
      process.env.NEXT_PUBLIC_UPLOAD_SECRET;

    if (!scriptUrl || !secret) {
      console.error("[Drive Image] missing env");
      return jsonError("Konfigurasi Google Drive belum lengkap", 500);
    }

    const res = await fetch(scriptUrl, {
      method: "POST",
      headers: {
        "Content-Type": "text/plain;charset=utf-8",
      },
      body: JSON.stringify({
        secret,
        action: "download",
        fileId,
      }),
      cache: "no-store",
    });

    if (!res.ok) {
      console.error("[Drive Image] Apps Script HTTP error:", res.status);
      return jsonError(res.status === 404 ? "File tidak ditemukan" : "Gagal mengambil file Drive", res.status);
    }

    const data = await res.json().catch(() => null);

    if (!data || !data.success || !data.base64) {
      console.error("[Drive Image] Apps Script error:", data?.error || data?.message);
      return jsonError(data?.error || data?.message || "File tidak ditemukan", 404);
    }

    const mimeType: string = data.mimeType || data.fileType || data.contentType || "application/octet-stream";

    if (!mimeType.startsWith("image/") && !mimeType.startsWith("video/")) {
      return jsonError("Format file tidak didukung untuk preview", 415);
    }

    const buffer = Buffer.from(data.base64, "base64");
    const fileName = safeInlineFileName(data.fileName, mimeType.startsWith("video/") ? "asset-video" : "asset-photo");

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": mimeType,
        "Cache-Control": "private, max-age=3600",
        "Content-Disposition": `inline; filename="${fileName}"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("[Drive Image] error:", error);
    return jsonError(error instanceof Error ? error.message : "Gagal mengambil file", 500);
  }
}
