import { uploadToDrive } from "@/lib/drive-upload";
import { DriveUploadResult } from "@/lib/types";

// Section Sinkronkan Foto Excel / Import Aset Baru — foto "Bukti Fisik
// Aset" HARUS lewat pipeline Google Drive yang SUDAH DIPAKAI project
// (uploadToDrive -> /api/upload-drive -> Apps Script -> Drive), SAMA
// PERSIS dengan foto aset manual (Tambah/Edit Aset). JANGAN pernah
// Firebase Storage di sini — dua sistem penyimpanan foto berbeda akan
// membuat Detail Aset harus menangani dua sumber sekaligus.

// Karakter yang tidak aman untuk nama file (dan yang memang sering muncul
// di Kode Aset lama seperti "EGS.11/12/2016.G-B01") diganti jadi "-" —
// HANYA nama file yang disanitasi, assetCode di database tidak pernah diubah.
export function sanitizeFileNamePart(value: string): string {
  return value
    .trim()
    .replace(/[/\\:*?"<>|.]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120) || "asset";
}

// Mapping MIME minimal — jangan biarkan semua jatuh ke
// application/octet-stream kalau sebenarnya gambar biasa.
function extensionFromMimeType(mimeType: string): string {
  switch (mimeType) {
    case "image/png":
      return "png";
    case "image/gif":
      return "gif";
    case "image/bmp":
      return "bmp";
    case "image/webp":
      return "webp";
    case "image/jpeg":
    default:
      return "jpg";
  }
}

// Nama file untuk diupload ke Drive (BUKAN path Storage — folder tujuan
// ditentukan oleh uploadType "asset_photo" di uploadToDrive(), sama seperti
// foto aset manual, folder assetview/assets).
export function buildPhysicalEvidenceFileName(assetCode: string, index: number, mimeType: string): string {
  const safeCode = sanitizeFileNamePart(assetCode || "asset");
  const ext = extensionFromMimeType(mimeType);
  const suffix = index > 0 ? `-${index + 1}` : "";
  return `${safeCode}-physical-evidence${suffix}.${ext}`;
}

function toUploadFile(blob: Blob, fileName: string, mimeType: string): File {
  const type = mimeType || blob.type || "image/jpeg";
  return new File([blob], fileName, { type });
}

function describeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    return { name: error.name, message: error.message, stack: error.stack };
  }
  return { raw: String(error) };
}

// Error validasi PERMANEN — percobaan ulang tidak akan mengubah hasil,
// jadi tidak boleh masuk retry loop (beda dari error network/HTTP sementara).
class NonRetryableUploadError extends Error {}

// Upload SATU gambar ke Google Drive lewat pipeline existing (uploadToDrive
// -> /api/upload-drive), retry maksimal 2 kali (total 3 percobaan) untuk
// error sementara (network/HTTP) — TIDAK retry untuk file kosong/format
// tidak didukung. Mengembalikan DriveUploadResult LENGKAP (fileId dkk),
// supaya pemanggil bisa bangun URL preview via getAssetFilePreviewUrl(fileId).
export async function uploadImageWithRetry(
  blob: Blob,
  fileName: string,
  mimeType: string,
  meta: { assetCode?: string; assetName?: string },
  maxRetries = 2
): Promise<DriveUploadResult> {
  if (!blob || blob.size === 0) {
    throw new NonRetryableUploadError("File gambar kosong");
  }
  if (mimeType && !mimeType.startsWith("image/")) {
    throw new NonRetryableUploadError(`Format file tidak didukung: ${mimeType}`);
  }

  const file = toUploadFile(blob, fileName, mimeType);

  console.log("[Drive Image Upload] preparing upload", {
    assetCode: meta.assetCode,
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.type,
  });

  if (file.size === 0) {
    throw new NonRetryableUploadError("File gambar kosong");
  }

  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await uploadToDrive(file, "asset_photo", meta);
      console.log("[Drive Image Upload] berhasil", {
        assetCode: meta.assetCode,
        fileName: file.name,
        fileId: result.fileId,
        attempt: attempt + 1,
      });
      return result;
    } catch (error) {
      lastError = error;
      console.error("[Drive Image Upload] Google Drive upload gagal", {
        attempt: attempt + 1,
        assetCode: meta.assetCode,
        assetName: meta.assetName,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type,
        error: describeError(error),
      });
      if (error instanceof NonRetryableUploadError) break;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

// Runner konkurensi terbatas — Google Apps Script/Drive jangan dibombardir
// request bersamaan. Mulai dari 2-3, jangan langsung 10-20 paralel.
export async function runWithConcurrencyLimit<T>(
  tasks: (() => Promise<T>)[],
  limit: number,
  onTaskDone?: () => void
): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < tasks.length) {
      const current = nextIndex++;
      results[current] = await tasks[current]();
      onTaskDone?.();
    }
  }

  const workers = Array.from({ length: Math.min(limit, tasks.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
