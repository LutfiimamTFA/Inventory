import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { RawImportRow, excelValueToISODate, excelValueToNumber } from "./excel";
import { normalizeAssetCodeForMatch } from "./asset-photo-sync";
import { parseAssetNumber } from "./asset-row-mapper";

// Section Sinkronkan No. Aset — BEDA dari Import Aset Baru maupun
// Sinkronkan Foto Excel: mode ini TIDAK PERNAH membuat dokumen baru dan
// TIDAK menyentuh foto/bukti fisik sama sekali. Satu-satunya field yang
// diupdate adalah assetNumber.
//
// Matching pakai DUA prioritas (lihat buildNumberSyncRows):
//  1. Kode Aset (companyId sudah di-scope lewat query) — identifier utama.
//  2. Kalau Kode Aset Excel KOSONG (banyak baris lama begini, itulah
//     penyebab "No. lompat-lompat" sebelumnya karena barisnya di-skip total)
//     fallback ke kombinasi Nama Aset + Tanggal Perolehan + Qty, dipersempit
//     pakai Jenis Aset/Lokasi MENTAH (assetType/locationRaw — bukan hasil
//     fuzzy-match kategori/lokasi supaya tidak salah exclude) kalau kandidat
//     masih >1. Kalau tetap >1 -> "Perlu Review", TIDAK PERNAH auto-update.

export type NumberSyncRowStatus =
  | "ready" // aset ditemukan (kode aset ATAU fallback unik), No Excel valid, beda dari assetNumber existing -> siap sinkron
  | "same" // aset ditemukan, No Excel valid, TAPI sama dengan assetNumber existing -> tidak perlu diupdate
  | "needs_review" // fallback nama+tanggal+qty menghasilkan >1 kandidat -> JANGAN auto update
  | "not_found" // tidak ada aset yang cocok sama sekali -> warning, JANGAN buat aset baru
  | "invalid_number" // kolom No di Excel kosong/bukan angka valid -> tidak ada yang disinkron
  | "duplicate"; // >1 aset existing punya Kode Aset persis sama -> perlu review manual

export type MatchMethod = "Kode Aset" | "Nama + Tanggal + Qty" | "Perlu Review" | "-";

export interface ExistingAssetNumberLite {
  id: string;
  assetCode: string;
  assetName: string;
  companyOwnerName: string;
  assetNumber: number | null;
  // Field TAMBAHAN khusus untuk fallback matching Prioritas 2 — assetType
  // dan locationRaw dipilih (bukan categoryName/locationText) karena
  // keduanya menyimpan teks Excel MENTAH tanpa distorsi fuzzy-match, supaya
  // narrowing tidak salah exclude kandidat yang sebenarnya benar.
  acquisitionDate: string | null;
  quantity: number;
  assetType: string;
  locationRaw: string;
}

export interface NumberSyncRow {
  excelRowNumber: number;
  noExcel: string;
  parsedNumber: number | null;
  kodeAsetExcel: string;
  namaAsetExcel: string;
  status: NumberSyncRowStatus;
  matchMethod: MatchMethod;
  matchedAsset: ExistingAssetNumberLite | null;
  candidateCount: number; // >1 hanya untuk status "duplicate"/"needs_review", untuk transparansi di preview
}

function normalizeNameForMatch(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function buildFallbackKey(name: string, date: string | null, qty: number): string {
  return `${normalizeNameForMatch(name)}|${date || ""}|${qty}`;
}

// Company sudah dipilih di step wizard (sama seperti Import Aset Baru /
// Sinkronkan Foto Excel) — query di-scope ke companyOwnerId supaya tidak
// perlu fetch seluruh collection assets.
export async function fetchExistingAssetsForNumberSync(companyId: string): Promise<ExistingAssetNumberLite[]> {
  const snap = await getDocs(query(collection(db, "assets"), where("companyOwnerId", "==", companyId)));
  return snap.docs.map((d) => {
    const data = d.data() as Record<string, unknown>;
    const rawQty = data.quantity;
    return {
      id: d.id,
      assetCode: typeof data.assetCode === "string" ? data.assetCode : "",
      assetName: typeof data.assetName === "string" ? data.assetName : "",
      companyOwnerName: typeof data.companyOwnerName === "string" ? data.companyOwnerName : "",
      assetNumber: typeof data.assetNumber === "number" && Number.isFinite(data.assetNumber) ? data.assetNumber : null,
      acquisitionDate: typeof data.acquisitionDate === "string" && data.acquisitionDate ? data.acquisitionDate : null,
      quantity: typeof rawQty === "number" && rawQty > 0 ? rawQty : 1,
      assetType: typeof data.assetType === "string" ? data.assetType : "",
      locationRaw: typeof data.locationRaw === "string" ? data.locationRaw : "",
    };
  });
}

export function buildNumberSyncRows(
  rawRows: RawImportRow[],
  existingAssets: ExistingAssetNumberLite[]
): NumberSyncRow[] {
  // ── Index Prioritas 1 — by Kode Aset ternormalisasi.
  const byCode = new Map<string, ExistingAssetNumberLite[]>();
  existingAssets.forEach((asset) => {
    if (!asset.assetCode) return;
    const key = normalizeAssetCodeForMatch(asset.assetCode);
    const list = byCode.get(key) || [];
    list.push(asset);
    byCode.set(key, list);
  });

  // Aset yang SUDAH pasti kena match eksplisit lewat Kode Aset (satu row
  // Excel -> satu aset) dikeluarkan dari pool fallback, supaya baris lain
  // yang Kode Aset-nya kosong tidak bisa "mencuri" aset yang sudah
  // dipastikan cocok lewat identifier utama.
  const explicitMatchedIds = new Set<string>();
  rawRows.forEach((raw) => {
    const code = raw.kodeAset.trim();
    if (!code) return;
    const matches = byCode.get(normalizeAssetCodeForMatch(code)) || [];
    if (matches.length === 1) explicitMatchedIds.add(matches[0].id);
  });

  // ── Index Prioritas 2 — by Nama Aset + Tanggal Perolehan + Qty.
  const fallbackPool = existingAssets.filter((a) => !explicitMatchedIds.has(a.id));
  const byNameDateQty = new Map<string, ExistingAssetNumberLite[]>();
  fallbackPool.forEach((asset) => {
    const key = buildFallbackKey(asset.assetName, asset.acquisitionDate, asset.quantity);
    const list = byNameDateQty.get(key) || [];
    list.push(asset);
    byNameDateQty.set(key, list);
  });

  return rawRows.map((raw) => {
    const kodeAsetExcel = raw.kodeAset.trim();
    const parsedNumber = parseAssetNumber(raw.no);

    // Debug sementara — bukti bahwa nilai "No" Excel benar-benar terbaca dan
    // dikonversi jadi angka sebelum proses matching berjalan.
    console.log("[Sync Asset Number] Excel", {
      excelRow: raw.excelRowNumber,
      assetCode: kodeAsetExcel,
      assetNumber: parsedNumber,
    });

    const base = {
      excelRowNumber: raw.excelRowNumber,
      noExcel: raw.no,
      parsedNumber,
      kodeAsetExcel,
      namaAsetExcel: raw.namaAset,
      candidateCount: 0,
    };

    const logMatched = (asset: ExistingAssetNumberLite) => {
      // Debug sementara — bukti bahwa Excel benar-benar cocok dengan satu
      // dokumen Firestore tertentu, sebelum keputusan ready/same diambil.
      console.log("[Sync Asset Number] matched", {
        assetId: asset.id,
        assetCode: asset.assetCode,
        oldAssetNumber: asset.assetNumber,
        newAssetNumber: parsedNumber,
      });
    };

    const decide = (asset: ExistingAssetNumberLite, matchMethod: MatchMethod) => {
      logMatched(asset);
      if (parsedNumber === null) {
        return { ...base, status: "invalid_number" as const, matchMethod, matchedAsset: asset };
      }
      if (asset.assetNumber === parsedNumber) {
        return { ...base, status: "same" as const, matchMethod, matchedAsset: asset };
      }
      return { ...base, status: "ready" as const, matchMethod, matchedAsset: asset };
    };

    // ── Prioritas 1 — Kode Aset.
    if (kodeAsetExcel) {
      const matches = byCode.get(normalizeAssetCodeForMatch(kodeAsetExcel)) || [];
      if (matches.length > 1) {
        return { ...base, status: "duplicate" as const, matchMethod: "-" as const, matchedAsset: null, candidateCount: matches.length };
      }
      if (matches.length === 0) {
        return { ...base, status: "not_found" as const, matchMethod: "-" as const, matchedAsset: null };
      }
      return decide(matches[0], "Kode Aset");
    }

    // ── Prioritas 2 — Kode Aset Excel kosong -> fallback Nama + Tanggal + Qty.
    const excelDate = excelValueToISODate(raw.tanggalPerolehanRaw);
    let excelQty = excelValueToNumber(raw.qtyRaw);
    if (excelQty === null || excelQty <= 0) excelQty = 1;

    const key = buildFallbackKey(raw.namaAset, excelDate, excelQty);
    let candidates = byNameDateQty.get(key) || [];

    if (candidates.length > 1) {
      // Persempit pakai Jenis Aset/Lokasi MENTAH — HANYA untuk memecah
      // ambiguitas, tidak pernah dipakai sebagai filter utama (supaya tidak
      // salah exclude kandidat yang benar kalau teksnya sedikit beda).
      const narrowed = candidates.filter((c) => {
        const typeOk = !raw.jenisAset || normalizeNameForMatch(c.assetType) === normalizeNameForMatch(raw.jenisAset);
        const locationOk = !raw.lokasi || normalizeNameForMatch(c.locationRaw) === normalizeNameForMatch(raw.lokasi);
        return typeOk && locationOk;
      });
      if (narrowed.length === 1) candidates = narrowed;
    }

    if (candidates.length === 0) {
      return { ...base, status: "not_found" as const, matchMethod: "-" as const, matchedAsset: null };
    }
    if (candidates.length > 1) {
      return {
        ...base,
        status: "needs_review" as const,
        matchMethod: "Perlu Review" as const,
        matchedAsset: null,
        candidateCount: candidates.length,
      };
    }

    return decide(candidates[0], "Nama + Tanggal + Qty");
  });
}
