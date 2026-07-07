import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    console.log("[Drive Image] route hit");

    const fileId = request.nextUrl.searchParams.get("fileId");

    if (!fileId) {
      return NextResponse.json(
        { success: false, message: "fileId wajib diisi" },
        { status: 400 }
      );
    }

    console.log("[Drive Image] fileId:", fileId);

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
      return NextResponse.json(
        { success: false, message: "Konfigurasi Google Drive belum lengkap" },
        { status: 500 }
      );
    }

    console.log("[Drive Image] fetching from Google Drive");

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

    const data = await res.json().catch(() => null);

    if (!data || !data.success || !data.base64) {
      console.error("[Drive Image] Apps Script error:", data?.error || data?.message);
      return NextResponse.json(
        {
          success: false,
          message: data?.error || data?.message || "Gagal mengambil file Drive",
        },
        { status: 404 }
      );
    }

    const mimeType: string = data.mimeType || data.fileType || "image/jpeg";
    console.log("[Drive Image] mimeType:", mimeType);

    if (!mimeType.startsWith("image/")) {
      return NextResponse.json(
        { success: false, message: "File bukan gambar" },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(data.base64, "base64");

    console.log("[Drive Image] image response success:", mimeType);

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": mimeType,
        "Cache-Control": "private, max-age=3600",
        "Content-Disposition": `inline; filename="${data.fileName || "asset-photo"}"`,
      },
    });
  } catch (error) {
    console.error("[Drive Image] error:", error);

    return NextResponse.json(
      {
        success: false,
        message: error instanceof Error ? error.message : "Gagal mengambil gambar",
      },
      { status: 500 }
    );
  }
}
