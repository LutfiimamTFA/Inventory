import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { AssetCategory } from "@/lib/types";
import { CANONICAL_EXCEL_CATEGORIES, canonicalCategoryDisplayName, generateFallbackCategoryCode, matchCategory } from "./category-match";

// Section "Sinkron Kategori Aset" — Master Kategori HARUS berisi 6 kategori
// "Label Aset EGC.xlsx" (Tanah/Perabot dan Meubelair/Komputer dan
// Jaringan/Mesin dan Peralatan/Kendaraan/Perlengkapan Kantor) dengan kode
// PERSIS seperti ticket, dan kategori Excel APA PUN yang belum ada di Master
// Kategori harus dibuat otomatis (bukan dipaksa masuk ke kategori existing
// yang tidak relevan seperti "Elektronik").

// Idempotent — HANYA membuat kategori canonical yang benar-benar belum ada
// (dicek via matchCategory yang sudah longgar terhadap typo/spasi/titik).
// Dipanggil sekali di awal proses import/sinkron, SEBELUM mapping baris.
export async function ensureCanonicalCategoriesExist(
  existingCategories: AssetCategory[],
  currentUserUid: string,
  currentUserName: string
): Promise<AssetCategory[]> {
  let categories = existingCategories;
  for (const canonical of CANONICAL_EXCEL_CATEGORIES) {
    if (matchCategory(canonical.name, categories).category) continue;
    const ref = await addDoc(collection(db, "asset_categories"), {
      categoryName: canonical.name,
      categoryCode: canonical.code,
      description: "",
      status: "active",
      createdByUid: currentUserUid,
      createdByName: currentUserName,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    categories = [
      ...categories,
      {
        id: ref.id,
        categoryName: canonical.name,
        categoryCode: canonical.code,
        status: "active",
        createdByUid: currentUserUid,
        createdByName: currentUserName,
        createdAt: null,
        updatedAt: null,
      },
    ];
  }
  return categories;
}

// Untuk SATU nilai "Jenis Aset" mentah dari Excel — cocokkan ke Master
// Kategori (existing, TERMASUK yang baru saja di-seed di atas); kalau
// benar-benar tidak ada yang cocok, buat kategori baru dengan nama yang
// sudah dirapikan (canonicalCategoryDisplayName) supaya "Komputer dan
// .Jaringan"/"komputer dan jaringan" TIDAK membuat kategori duplicate,
// melainkan sama-sama match ke "Komputer dan Jaringan" yang sudah ada.
export async function ensureCategoryExistsForRawName(
  rawJenisAset: string,
  categories: AssetCategory[],
  currentUserUid: string,
  currentUserName: string
): Promise<{ categories: AssetCategory[]; category: AssetCategory | null }> {
  const trimmed = rawJenisAset.trim();
  if (!trimmed) return { categories, category: null };

  const existingMatch = matchCategory(trimmed, categories);
  if (existingMatch.category) return { categories, category: existingMatch.category };

  const displayName = canonicalCategoryDisplayName(trimmed);
  const rematch = matchCategory(displayName, categories);
  if (rematch.category) return { categories, category: rematch.category };

  const existingCodes = new Set(categories.map((c) => c.categoryCode));
  const code = generateFallbackCategoryCode(displayName, existingCodes);
  const ref = await addDoc(collection(db, "asset_categories"), {
    categoryName: displayName,
    categoryCode: code,
    description: "",
    status: "active",
    createdByUid: currentUserUid,
    createdByName: currentUserName,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
  const newCategory: AssetCategory = {
    id: ref.id,
    categoryName: displayName,
    categoryCode: code,
    status: "active",
    createdByUid: currentUserUid,
    createdByName: currentUserName,
    createdAt: null,
    updatedAt: null,
  };
  return { categories: [...categories, newCategory], category: newCategory };
}

// Batch helper — dipanggil dengan seluruh baris Excel SEKALI di awal
// buildPreview(), supaya kategori baru yang sama (mis. banyak baris "Mesin
// dan Peralatan") hanya dibuat SATU KALI, bukan per-baris.
export async function ensureCategoriesForRawNames(
  rawJenisAsetValues: string[],
  categories: AssetCategory[],
  currentUserUid: string,
  currentUserName: string
): Promise<AssetCategory[]> {
  let current = categories;
  const distinct = Array.from(new Set(rawJenisAsetValues.map((v) => v.trim()).filter(Boolean)));
  for (const raw of distinct) {
    const result = await ensureCategoryExistsForRawName(raw, current, currentUserUid, currentUserName);
    current = result.categories;
  }
  return current;
}
