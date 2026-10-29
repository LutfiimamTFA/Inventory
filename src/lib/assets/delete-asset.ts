import type { User } from "firebase/auth";

// Section "Hapus Permanen Asset" — SATU-SATUNYA jalur hapus permanen asset,
// dipanggil dari halaman Assets (list) dan Detail Asset. Proteksi role
// SEBENARNYA ada di server (src/app/api/assets/[id]/route.ts, dicek ulang
// dari asset_users/{uid} lewat Firebase Admin SDK) — Firebase ID token
// dikirim di header Authorization supaya server tahu SIAPA yang meminta,
// bukan cuma percaya body/role yang dikirim client.
//
// Section "Perbaiki Console Error kosong" — SEBELUMNYA error dilempar
// sebagai object literal biasa ({message, code, status}), BUKAN instance
// Error. Object biasa yang di-throw tidak dikenali sebagai Error oleh
// console.error/Next.js dev overlay/error tracker apa pun — banyak alat
// (termasuk overlay Next.js) hanya menampilkan detail lengkap untuk
// `instanceof Error`, sehingga object biasa tadi tampil kosong ("{}") di
// log walau field-nya sebenarnya terisi. `extends Error` memperbaiki ini
// di semua tempat sekaligus (browser console, dev overlay, `.stack`, dst).
export class DeleteAssetError extends Error {
  code: string;
  status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = "DeleteAssetError";
    this.code = code;
    this.status = status;
  }
}

export async function deleteAssetPermanently(
  firebaseUser: Pick<User, "getIdToken">,
  assetId: string
): Promise<void> {
  const token = await firebaseUser.getIdToken();

  const res = await fetch(`/api/assets/${encodeURIComponent(assetId)}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (res.ok) return;

  const body = await res.json().catch(() => null);
  throw new DeleteAssetError(
    body?.error || "Gagal menghapus asset.",
    body?.code || "DELETE_FAILED",
    res.status
  );
}
