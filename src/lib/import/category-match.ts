import { AssetCategory } from "@/lib/types";

// Alias kategori yang SUDAH DIKETAHUI beda penulisan antara data lama (mis.
// "Label Aset EGC.xlsx") dan Master Kategori aplikasi — dicek SEBELUM fuzzy
// match token-based supaya kasus umum ini selalu match persis.
const CATEGORY_ALIASES: Record<string, string> = {
  "perabot dan meubelair kantor": "perabot dan meubelair",
  "mesin dan peralatan kantor": "mesin dan peralatan",
};

// Kata pengisi yang diabaikan saat fuzzy match token-based — beda-beda tipis
// seperti "Kantor"/"dan" tidak boleh bikin kategori yang jelas sama gagal
// dicocokkan.
const FILLER_WORDS = new Set(["dan", "kantor"]);

// Titik/tanda baca liar dianggap TYPO (mis. "Komputer dan .Jaringan"), bukan
// bagian nama kategori — dibuang SEBELUM collapse spasi supaya "dan .Jaringan"
// jadi "dan Jaringan", bukan "dan .jaringan" yang gagal exact/fuzzy match.
function normalize(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[.,;:'"`]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// 6 kategori master dari "Label Aset EGC.xlsx" — jadi ACUAN AWAL Master
// Kategori (bukan cuma alias matching). Kode-nya HARUS persis seperti ini,
// bukan hasil generate — lihat ensureCanonicalCategoriesExist().
export const CANONICAL_EXCEL_CATEGORIES: { name: string; code: string }[] = [
  { name: "Tanah", code: "TANAH" },
  { name: "Perabot dan Meubelair", code: "A" },
  { name: "Komputer dan Jaringan", code: "B" },
  { name: "Mesin dan Peralatan", code: "C" },
  { name: "Kendaraan", code: "D" },
  { name: "Perlengkapan Kantor", code: "E" },
];

// Bersihkan teks "Jenis Aset" Excel jadi nama kategori final yang rapi (Title
// Case, tanpa titik/spasi ganda) — dipakai HANYA saat kategori baru harus
// dibuat (tidak ada di Master Kategori sama sekali), BUKAN untuk matching itu
// sendiri (matching pakai normalize() yang jauh lebih longgar di atas).
export function canonicalCategoryDisplayName(rawJenisAset: string): string {
  const cleaned = rawJenisAset
    .replace(/[.,;:'"`]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned
    .split(" ")
    .map((word) => (word ? word[0].toUpperCase() + word.slice(1).toLowerCase() : word))
    .join(" ");
}

// Kode untuk kategori baru yang BUKAN salah satu dari 6 kategori canonical di
// atas (mis. Excel lain di masa depan punya "Jenis Aset" yang benar-benar
// baru) — inisial tiap kata, huruf besar, dijamin tidak tabrakan dengan kode
// yang sudah ada di Master Kategori.
export function generateFallbackCategoryCode(displayName: string, existingCodes: Set<string>): string {
  const initials = displayName
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase())
    .join("");
  let code = initials || "GEN";
  let suffix = 1;
  while (existingCodes.has(code)) {
    suffix += 1;
    code = `${initials}${suffix}`;
  }
  return code;
}

function tokenSet(value: string): Set<string> {
  return new Set(
    normalize(value)
      .split(" ")
      .filter((t) => t && !FILLER_WORDS.has(t))
  );
}

// Jaccard similarity token-based — toleran terhadap beda spasi/kata pengisi
// (mis. "Perabot dan Meubelair Kantor" vs "Perabot dan Meubelair") tanpa
// perlu daftar alias eksplisit untuk SETIAP variasi kecil yang mungkin ada.
function tokenSimilarity(a: string, b: string): number {
  const setA = tokenSet(a);
  const setB = tokenSet(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  setA.forEach((t) => {
    if (setB.has(t)) intersection++;
  });
  const union = new Set([...setA, ...setB]).size;
  return union === 0 ? 0 : intersection / union;
}

const SIMILARITY_THRESHOLD = 0.6;

export interface CategoryMatchResult {
  category: AssetCategory | null;
  matchedBy: "exact" | "alias" | "fuzzy" | "none";
}

export function matchCategory(rawJenisAset: string, categories: AssetCategory[]): CategoryMatchResult {
  const raw = normalize(rawJenisAset);
  if (!raw) return { category: null, matchedBy: "none" };

  const exact = categories.find((c) => normalize(c.categoryName) === raw);
  if (exact) return { category: exact, matchedBy: "exact" };

  const aliasTarget = CATEGORY_ALIASES[raw];
  if (aliasTarget) {
    const aliased = categories.find((c) => normalize(c.categoryName) === aliasTarget);
    if (aliased) return { category: aliased, matchedBy: "alias" };
  }
  // Coba arah sebaliknya juga — alias map ditulis satu arah, tapi Master
  // Kategori bisa saja yang justru pakai penulisan "panjang".
  for (const [variant, canonical] of Object.entries(CATEGORY_ALIASES)) {
    if (canonical === raw) {
      const aliased = categories.find((c) => normalize(c.categoryName) === variant);
      if (aliased) return { category: aliased, matchedBy: "alias" };
    }
  }

  let best: { category: AssetCategory; score: number } | null = null;
  for (const c of categories) {
    const score = tokenSimilarity(raw, c.categoryName);
    if (score >= SIMILARITY_THRESHOLD && (!best || score > best.score)) {
      best = { category: c, score };
    }
  }
  if (best) return { category: best.category, matchedBy: "fuzzy" };

  return { category: null, matchedBy: "none" };
}
