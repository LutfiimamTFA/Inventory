import { NextResponse } from "next/server";
import { fetchDriveFile } from "@/lib/server/drive-file-fetch";

export const runtime = "nodejs";

function jsonError(message: string, status: number) {
  return NextResponse.json({ success: false, message }, { status });
}

function safeInlineFileName(value: unknown, fallback: string) {
  const raw = typeof value === "string" && value.trim() ? value.trim() : fallback;
  return raw.replace(/["\r\n]/g, "").slice(0, 120) || fallback;
}

// Foto/gambar/video/PDF ditampilkan langsung di browser (preview); tipe lain
// (mis. dokumen Office) diunduh sebagai attachment supaya browser tidak
// mencoba merender konten yang tidak didukung secara native.
function isInlineMimeType(mimeType: string) {
  return (
    mimeType.startsWith("image/") ||
    mimeType.startsWith("video/") ||
    mimeType.startsWith("text/") ||
    mimeType === "application/pdf"
  );
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ fileId: string }> }
) {
  const { fileId: rawFileId } = await params;
  const fileId = rawFileId?.trim();

  if (!fileId) {
    return jsonError("fileId wajib diisi", 400);
  }

  try {
    const result = await fetchDriveFile(fileId);

    if ("error" in result) {
      return jsonError(result.error, result.status);
    }

    const disposition = isInlineMimeType(result.mimeType) ? "inline" : "attachment";
    const fileName = safeInlineFileName(result.fileName, "asset-file");

    return new NextResponse(new Uint8Array(result.buffer), {
      status: 200,
      headers: {
        "Content-Type": result.mimeType,
        "Cache-Control": "private, max-age=3600",
        "Content-Disposition": `${disposition}; filename="${fileName}"`,
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    console.error("[Asset File Proxy] error:", error);
    return jsonError(error instanceof Error ? error.message : "Gagal mengambil file", 500);
  }
}
