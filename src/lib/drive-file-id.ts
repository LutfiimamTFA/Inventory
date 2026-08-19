// Ekstraksi fileId Google Drive dari string apa pun: ID mentah, URL proxy
// internal (?fileId=/?id=), atau URL Drive mentah dalam BENTUK APA PUN
// (drive.google.com/file/d/ID, drive.google.com/uc?id=ID,
// drive.usercontent.google.com/download?id=ID, dst). Sengaja tidak menguji
// domain lebih dulu — cukup cari pola id/fileId di query string atau path,
// supaya varian domain Drive baru (mis. usercontent) tidak pernah lolos
// sebagai "bukan Drive" lalu dipakai mentah sebagai <img src>/href.
export function extractDriveFileId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const raw = value.trim();
  if (!raw) return null;

  try {
    const url = new URL(raw, "https://assetview.local");
    const fileId = url.searchParams.get("fileId") || url.searchParams.get("id");
    if (fileId) return fileId;
  } catch {
    // Bukan URL valid; lanjut cek pola ID/URL Drive mentah.
  }

  const decoded = decodeURIComponent(raw);
  const drivePathMatch = decoded.match(/\/file\/d\/([^/?#]+)/);
  if (drivePathMatch?.[1]) return drivePathMatch[1];

  // URL proxy internal sendiri (/api/asset-files/{fileId}) — path-based,
  // bukan query param, jadi tidak kena dua pengecekan di atas. Dicek supaya
  // string yang SUDAH berupa proxy URL kita sendiri (mis. tersimpan di
  // physicalEvidenceImages) tetap bisa dibalik jadi fileId mentah kalau perlu.
  const assetFilesMatch = decoded.match(/\/asset-files\/([^/?#]+)/);
  if (assetFilesMatch?.[1]) return assetFilesMatch[1];

  const queryMatch = decoded.match(/[?&](?:fileId|id)=([^&#]+)/);
  if (queryMatch?.[1]) return queryMatch[1];

  if (/^[a-zA-Z0-9_-]{20,}$/.test(decoded)) return decoded;
  return null;
}

export function getAssetFilePreviewUrl(fileId: string): string {
  return `/api/asset-files/${encodeURIComponent(fileId)}`;
}

// Resolver umum: cek field fileId eksplisit dulu (paling andal), baru field
// URL — kalau URL itu ternyata link Drive (domain apa pun), ekstrak fileId
// dan tetap lewat proxy; kalau bukan, dipakai apa adanya (fallback data lama
// yang memang menyimpan URL gambar non-Drive).
export function resolveDriveFileSrc(
  fileIdFields: unknown[],
  urlFields: unknown[]
): { src: string | null; fileId: string | null } {
  for (const value of fileIdFields) {
    const fileId = typeof value === "string" && value.trim() ? value.trim() : null;
    if (fileId) return { src: getAssetFilePreviewUrl(fileId), fileId };
  }

  for (const value of urlFields) {
    const url = typeof value === "string" && value.trim() ? value.trim() : null;
    if (!url) continue;

    const fileId = extractDriveFileId(url);
    if (fileId) return { src: getAssetFilePreviewUrl(fileId), fileId };

    return { src: url, fileId: null };
  }

  return { src: null, fileId: null };
}
