import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { AssetCategory } from "@/lib/types";
import { RawImportRow, excelValueToISODate, excelValueToNumber } from "./excel";
import { normalizeAssetCodeForMatch } from "./asset-photo-sync";
import { matchCategory } from "./category-match";

// Section "Sinkron Kategori Existing" — untuk aset yang SUDAH terlanjur
// diimport sebelum Master Kategori dirapikan (lihat category-match.ts/
// category-seed.ts). TIDAK PERNAH membuat dokumen aset baru, TIDAK PERNAH
// mengubah field selain categoryId/categoryName. Matching-nya SAMA persis
// dengan asset-number-sync.ts: Prioritas 1 Kode Aset, Prioritas 2 (Kode Aset
// Excel kosong) fallback Nama Aset + Tanggal Perolehan + Qty, dipersempit
// pakai Jenis Aset/Lokasi MENTAH kalau kandidat masih >1.

export type CategorySyncRowStatus =
  | "ready" // aset ditemukan, kategori Excel valid, beda dari categoryId existing -> siap sinkron
  | "same" // aset ditemukan, kategori Excel sudah sama dengan categoryId existing
  | "needs_review" // fallback nama+tanggal+qty menghasilkan >1 kandidat -> JANGAN auto update
  | "not_found" // tidak ada aset yang cocok sama sekali (atau kategori Excel tidak dikenali)
  | "invalid_category" // kolom Jenis Aset kosong di Excel -> tidak ada yang disinkron
  | "duplicate"; // >1 aset existing punya Kode Aset persis sama

export type MatchMethod = "Kode Aset" | "Nama + Tanggal + Qty" | "Perlu Review" | "-";

export interface ExistingAssetCategoryLite {
  id: string;
  assetCode: string;
  assetName: string;
  companyOwnerName: string;
  categoryId: string;
  categoryName: string;
  acquisitionDate: string | null;
  quantity: number;
  assetType: string;
  locationRaw: string;
}

export interface CategorySyncRow {
  excelRowNumber: number;
  kodeAsetExcel: string;
  namaAsetExcel: string;
  jenisAsetExcel: string;
  status: CategorySyncRowStatus;
  matchMethod: MatchMethod;
  matchedAsset: ExistingAssetCategoryLite | null;
  newCategoryId: string | null;
  newCategoryName: string | null;
  candidateCount: number;
}

function normalizeNameForMatch(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function buildFallbackKey(name: string, date: string | null, qty: number): string {
  return `${normalizeNameForMatch(name)}|${date || ""}|${qty}`;
}

export async function fetchExistingAssetsForCategorySync(companyId: string): Promise<ExistingAssetCategoryLite[]> {
  const snap = await getDocs(query(collection(db, "assets"), where("companyOwnerId", "==", companyId)));
  return snap.docs.map((d) => {
    const data = d.data() as Record<string, unknown>;
    const rawQty = data.quantity;
    return {
      id: d.id,
      assetCode: typeof data.assetCode === "string" ? data.assetCode : "",
      assetName: typeof data.assetName === "string" ? data.assetName : "",
      companyOwnerName: typeof data.companyOwnerName === "string" ? data.companyOwnerName : "",
      categoryId: typeof data.categoryId === "string" ? data.categoryId : "",
      categoryName: typeof data.categoryName === "string" ? data.categoryName : "",
      acquisitionDate: typeof data.acquisitionDate === "string" && data.acquisitionDate ? data.acquisitionDate : null,
      quantity: typeof rawQty === "number" && rawQty > 0 ? rawQty : 1,
      assetType: typeof data.assetType === "string" ? data.assetType : "",
      locationRaw: typeof data.locationRaw === "string" ? data.locationRaw : "",
    };
  });
}

function resolveRowCategory(
  base: Pick<CategorySyncRow, "excelRowNumber" | "kodeAsetExcel" | "namaAsetExcel" | "jenisAsetExcel" | "candidateCount">,
  asset: ExistingAssetCategoryLite,
  matchMethod: MatchMethod,
  categories: AssetCategory[]
): CategorySyncRow {
  if (!base.jenisAsetExcel) {
    return { ...base, status: "invalid_category", matchMethod, matchedAsset: asset, newCategoryId: null, newCategoryName: null };
  }
  const resolved = matchCategory(base.jenisAsetExcel, categories).category;
  if (!resolved) {
    return { ...base, status: "not_found", matchMethod, matchedAsset: asset, newCategoryId: null, newCategoryName: null };
  }
  return {
    ...base,
    status: asset.categoryId === resolved.id ? "same" : "ready",
    matchMethod,
    matchedAsset: asset,
    newCategoryId: resolved.id,
    newCategoryName: resolved.categoryName,
  };
}

export function buildCategorySyncRows(
  rawRows: RawImportRow[],
  existingAssets: ExistingAssetCategoryLite[],
  categories: AssetCategory[]
): CategorySyncRow[] {
  const byCode = new Map<string, ExistingAssetCategoryLite[]>();
  existingAssets.forEach((asset) => {
    if (!asset.assetCode) return;
    const key = normalizeAssetCodeForMatch(asset.assetCode);
    const list = byCode.get(key) || [];
    list.push(asset);
    byCode.set(key, list);
  });

  const explicitMatchedIds = new Set<string>();
  rawRows.forEach((raw) => {
    const code = raw.kodeAset.trim();
    if (!code) return;
    const matches = byCode.get(normalizeAssetCodeForMatch(code)) || [];
    if (matches.length === 1) explicitMatchedIds.add(matches[0].id);
  });

  const fallbackPool = existingAssets.filter((a) => !explicitMatchedIds.has(a.id));
  const byNameDateQty = new Map<string, ExistingAssetCategoryLite[]>();
  fallbackPool.forEach((asset) => {
    const key = buildFallbackKey(asset.assetName, asset.acquisitionDate, asset.quantity);
    const list = byNameDateQty.get(key) || [];
    list.push(asset);
    byNameDateQty.set(key, list);
  });

  return rawRows.map((raw) => {
    const kodeAsetExcel = raw.kodeAset.trim();
    const jenisAsetExcel = raw.jenisAset.trim();

    const base = {
      excelRowNumber: raw.excelRowNumber,
      kodeAsetExcel,
      namaAsetExcel: raw.namaAset,
      jenisAsetExcel,
      candidateCount: 0,
    };

    // ── Prioritas 1 — Kode Aset.
    if (kodeAsetExcel) {
      const matches = byCode.get(normalizeAssetCodeForMatch(kodeAsetExcel)) || [];
      if (matches.length > 1) {
        return { ...base, status: "duplicate" as const, matchMethod: "-" as const, matchedAsset: null, newCategoryId: null, newCategoryName: null, candidateCount: matches.length };
      }
      if (matches.length === 0) {
        return { ...base, status: "not_found" as const, matchMethod: "-" as const, matchedAsset: null, newCategoryId: null, newCategoryName: null };
      }
      return resolveRowCategory(base, matches[0], "Kode Aset", categories);
    }

    // ── Prioritas 2 — Kode Aset Excel kosong -> fallback Nama + Tanggal + Qty.
    const excelDate = excelValueToISODate(raw.tanggalPerolehanRaw);
    let excelQty = excelValueToNumber(raw.qtyRaw);
    if (excelQty === null || excelQty <= 0) excelQty = 1;

    const key = buildFallbackKey(raw.namaAset, excelDate, excelQty);
    let candidates = byNameDateQty.get(key) || [];

    if (candidates.length > 1) {
      const narrowed = candidates.filter((c) => {
        const typeOk = !raw.jenisAset || normalizeNameForMatch(c.assetType) === normalizeNameForMatch(raw.jenisAset);
        const locationOk = !raw.lokasi || normalizeNameForMatch(c.locationRaw) === normalizeNameForMatch(raw.lokasi);
        return typeOk && locationOk;
      });
      if (narrowed.length === 1) candidates = narrowed;
    }

    if (candidates.length === 0) {
      return { ...base, status: "not_found" as const, matchMethod: "-" as const, matchedAsset: null, newCategoryId: null, newCategoryName: null };
    }
    if (candidates.length > 1) {
      return {
        ...base,
        status: "needs_review" as const,
        matchMethod: "Perlu Review" as const,
        matchedAsset: null,
        newCategoryId: null,
        newCategoryName: null,
        candidateCount: candidates.length,
      };
    }

    return resolveRowCategory(base, candidates[0], "Nama + Tanggal + Qty", categories);
  });
}
