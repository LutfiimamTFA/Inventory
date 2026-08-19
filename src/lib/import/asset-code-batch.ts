import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { formatAssetCode, normalizeCategoryCodePart } from "@/lib/firestore-helpers";

// Section Import Aset — versi "batch-aware" dari generateAssetCode()
// (firestore-helpers.ts): generateAssetCode melakukan SATU query Firestore
// PER PANGGILAN, yang kalau dipakai apa adanya untuk ratusan baris Excel
// berarti ratusan query berurutan. Allocator ini query Firestore HANYA
// SEKALI per kombinasi (kategori, tahun) yang benar-benar muncul, lalu
// increment nomor urut di memori untuk baris-baris berikutnya — meniru pola
// "nextSequence" yang sudah dipakai halaman /bulk-upload lama, tapi dengan
// query awal yang di-cache per prefix (bukan per baris).
export function createAssetCodeAllocator() {
  const nextSequence = new Map<string, number>(); // key = prefix "AST-{CODE}-{YEAR}-"

  async function allocate(categoryCode: string): Promise<string> {
    const codePart = normalizeCategoryCodePart(categoryCode) || "GEN";
    const year = new Date().getFullYear();
    const prefix = `AST-${codePart}-${year}-`;

    let seq = nextSequence.get(prefix);
    if (seq === undefined) {
      const q = query(
        collection(db, "assets"),
        where("assetCode", ">=", prefix),
        where("assetCode", "<", prefix + "")
      );
      const snap = await getDocs(q);
      seq = snap.size + 1;
    }
    nextSequence.set(prefix, seq + 1);
    return formatAssetCode(categoryCode, year, seq);
  }

  return { allocate };
}

// Duplicate KODE ASET EXPLISIT dari Excel (bukan yang di-generate — kode
// hasil generate dijamin baru karena berasal dari sequence yang sama sekali
// belum dipakai) — dicek terhadap dua sumber sesuai requirement:
// (1) sesama baris dalam file yang sedang diimport, (2) data yang sudah
// tersimpan di Firestore.
export function findInFileDuplicateCodes(codes: string[]): Set<string> {
  const seen = new Map<string, number>();
  const duplicates = new Set<string>();
  for (const raw of codes) {
    const code = raw.trim();
    if (!code) continue;
    const count = (seen.get(code) || 0) + 1;
    seen.set(code, count);
    if (count > 1) duplicates.add(code);
  }
  return duplicates;
}

const FIRESTORE_IN_CHUNK_SIZE = 30;

export async function findExistingAssetCodes(codes: string[]): Promise<Set<string>> {
  const unique = Array.from(new Set(codes.map((c) => c.trim()).filter(Boolean)));
  if (unique.length === 0) return new Set();

  const chunks: string[][] = [];
  for (let i = 0; i < unique.length; i += FIRESTORE_IN_CHUNK_SIZE) {
    chunks.push(unique.slice(i, i + FIRESTORE_IN_CHUNK_SIZE));
  }

  const existing = new Set<string>();
  const results = await Promise.all(
    chunks.map((chunk) => getDocs(query(collection(db, "assets"), where("assetCode", "in", chunk))))
  );
  results.forEach((snap) => {
    snap.docs.forEach((d) => existing.add((d.data().assetCode as string) || ""));
  });
  return existing;
}
