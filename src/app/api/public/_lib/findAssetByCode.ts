import type { Firestore } from "firebase-admin/firestore";
import { Asset } from "@/lib/types";

// Section "Halaman Utama Peminjaman Tanpa Login" — lookup aset berdasarkan
// kode scan QR, diekstrak dari src/app/api/public/assets/by-code/route.ts
// supaya route borrow/return publik baru TIDAK menduplikasi logic fallback
// ini. Urutan fallback: assetCode -> qrTagId -> id dokumen langsung, supaya
// QR lama/baru yang sudah beredar tetap terbuka. Query EXACT match (bukan
// prefix/contains) supaya kode dengan karakter "/", ".", "-" tetap match
// persis sebagai string utuh, bukan diparse sebagai path segment.
//
// Dipanggil dengan instance Firestore Admin SDK yang SUDAH diinisialisasi
// (caller bertanggung jawab atas getAdminDb()/error handling bootstrap-nya
// sendiri, supaya tiap route tetap bebas punya taksonomi error terstruktur
// sendiri-sendiri seperti rute `by-code` sudah lakukan) — fungsi ini murni
// query, melempar error asli Firestore apa adanya kalau query gagal, tanpa
// membungkusnya jadi error class tertentu.
export async function findAssetByCode(
  db: Firestore,
  code: string
): Promise<{ id: string; data: Asset } | null> {
  const byCode = await db.collection("assets").where("assetCode", "==", code).limit(1).get();
  if (!byCode.empty) {
    const d = byCode.docs[0];
    return { id: d.id, data: d.data() as Asset };
  }

  const byTag = await db.collection("assets").where("qrTagId", "==", code).limit(1).get();
  if (!byTag.empty) {
    const d = byTag.docs[0];
    return { id: d.id, data: d.data() as Asset };
  }

  const byId = await db.collection("assets").doc(code).get();
  if (byId.exists) {
    return { id: byId.id, data: byId.data() as Asset };
  }

  return null;
}
