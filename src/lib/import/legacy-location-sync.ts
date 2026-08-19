import { collection, getDocs } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Asset, AssetLocationNode } from "@/lib/types";
import { normalizeLegacyLocationAlias } from "./location-match";

// Section "Sinkronkan Lokasi Lama" — Excel lama simpan lokasi sebagai teks
// bebas ("CBDMS", "MDS", "OCD", "Hall Lt.2", dst), sedangkan Master Lokasi
// web berstruktur Gedung > Lantai > Ruangan > Area. Tool ini TIDAK membuat
// Gedung baru dari teks Excel — tugasnya cuma MENGELOMPOKKAN nilai lokasi
// lama yang unik dari data asset EXISTING, supaya user memetakan tiap
// kelompok SEKALI ke node Master Lokasi yang benar, lalu seluruh aset di
// kelompok itu langsung ikut diperbarui — SEKALIGUS lewat bulk-select per
// kelompok (klik "MDS" -> semua aset MDS terseleksi), bukan centang satu-satu.
//
// groupLegacyLocations() PURE & SINKRON (tidak query Firestore sendiri) —
// dipakai components/SyncAssetLocationModal.tsx yang sudah menerima
// assets/locations lewat props dari listener parent-nya (halaman
// /locations), supaya tidak ada listener/fetch dobel. scanLegacyLocations()
// di bawah cuma wrapper async untuk pemakai yang BELUM punya assets di
// tangan (mis. tool mandiri tanpa parent listener).

export const NO_LOCATION_KEY = "__tanpa_lokasi__";
export const NO_LOCATION_LABEL = "Tanpa Lokasi";

export interface LegacyLocationAssetRow {
  id: string;
  assetName: string;
  assetCode: string;
  legacyLocationKey: string;
  legacyLocationLabel: string; // teks mentah apa adanya ("Tanpa Lokasi" untuk NO_LOCATION_KEY)
  source: "location" | "assetCode" | "none";
}

export interface LegacyLocationGroup {
  key: string; // normalizeLegacyLocationAlias() (atau NO_LOCATION_KEY) — identitas unik grup
  displayLabel: string; // variasi penulisan pertama yang ditemukan (apa adanya)
  rawVariants: string[]; // semua variasi penulisan berbeda yang ternormalisasi sama (kosong untuk NO_LOCATION_KEY)
  assetIds: string[];
  assetCount: number;
  sourceLocationCount: number; // dari field location/locationRaw
  sourceAssetCodeCount: number; // dari token Kode Aset (locationRaw/location kosong)
  mappedNode: AssetLocationNode | null; // sudah pernah dipetakan (legacyAliases) atau belum
}

export interface LegacyLocationScanResult {
  groups: LegacyLocationGroup[];
  assetRows: LegacyLocationAssetRow[];
}

// Ambil token lokasi dari Kode Aset gaya "EGS.28/11/2017.MDS.G-E05" — segmen
// ke-3 (index 2), SEBELUM segmen "G-...". SENGAJA tidak kaku: kalau
// strukturnya tidak sesuai (kurang dari 4 segmen, mengandung "/", atau malah
// segmen kategori "G-..."), dianggap TIDAK ADA token lokasi — bukan error,
// baris itu cuma dilewati sebagai kandidat sinkron (kode historis memang
// tidak semuanya konsisten, lihat contoh lama "EGS.02/03/2022.G-B24-05").
export function extractLocationTokenFromAssetCode(assetCode: string): string | null {
  const segments = assetCode.split(".").map((s) => s.trim());
  if (segments.length < 4) return null;
  const candidate = segments[2];
  if (!candidate || candidate.includes("/") || /^G-/i.test(candidate)) return null;
  if (candidate.length > 12) return null;
  return candidate;
}

// Kelompokkan aset yang BELUM punya lokasi terstruktur (buildingId kosong)
// berdasarkan teks lokasi lama (locationRaw/location, fallback token Kode
// Aset) — sinkron, tidak menyentuh Firestore sama sekali.
export function groupLegacyLocations(assets: Asset[], locations: AssetLocationNode[]): LegacyLocationScanResult {
  const legacyAliasIndex = new Map<string, AssetLocationNode>();
  locations.forEach((node) => {
    (node.legacyAliases || []).forEach((alias) => {
      const key = normalizeLegacyLocationAlias(alias);
      if (key) legacyAliasIndex.set(key, node);
    });
  });

  const groups = new Map<string, LegacyLocationGroup>();
  const assetRows: LegacyLocationAssetRow[] = [];

  assets.forEach((asset) => {
    // Aset yang SUDAH punya buildingId (lokasi sudah terstruktur) dilewati —
    // fokus tool ini HANYA aset yang lokasinya masih teks bebas/belum ada.
    if (asset.buildingId) return;

    const assetName = asset.assetName || "";
    const assetCode = asset.assetCode || "";
    const locationRaw = (asset.locationRaw || "").trim();
    const location = (asset.location || "").trim();

    let raw = locationRaw || location;
    let source: "location" | "assetCode" | "none" = "location";
    if (!raw && assetCode) {
      const token = extractLocationTokenFromAssetCode(assetCode);
      if (token) {
        raw = token;
        source = "assetCode";
      }
    }

    const key = raw ? normalizeLegacyLocationAlias(raw) : "";
    const groupKey = key || NO_LOCATION_KEY;
    if (!raw) source = "none";

    let group = groups.get(groupKey);
    if (!group) {
      group = {
        key: groupKey,
        displayLabel: raw || NO_LOCATION_LABEL,
        rawVariants: [],
        assetIds: [],
        assetCount: 0,
        sourceLocationCount: 0,
        sourceAssetCodeCount: 0,
        mappedNode: (key && legacyAliasIndex.get(key)) || null,
      };
      groups.set(groupKey, group);
    }
    if (raw && !group.rawVariants.includes(raw)) group.rawVariants.push(raw);
    group.assetIds.push(asset.id);
    group.assetCount += 1;
    if (source === "location") group.sourceLocationCount += 1;
    else if (source === "assetCode") group.sourceAssetCodeCount += 1;

    assetRows.push({
      id: asset.id,
      assetName,
      assetCode,
      legacyLocationKey: groupKey,
      legacyLocationLabel: raw || NO_LOCATION_LABEL,
      source,
    });
  });

  // "Tanpa Lokasi" SELALU di bawah — grup dengan data (assetCount terbanyak
  // duluan) lebih relevan dipetakan lebih dulu.
  const groupList = Array.from(groups.values()).sort((a, b) => {
    if (a.key === NO_LOCATION_KEY) return 1;
    if (b.key === NO_LOCATION_KEY) return -1;
    return b.assetCount - a.assetCount;
  });

  return { groups: groupList, assetRows };
}

// Wrapper async — scan LANGSUNG dari Firestore (collection assets penuh)
// untuk pemakai yang belum punya data assets di tangan.
export async function scanLegacyLocations(locations: AssetLocationNode[]): Promise<LegacyLocationScanResult> {
  const snap = await getDocs(collection(db, "assets"));
  const assets = snap.docs.map((d) => ({ id: d.id, ...d.data() } as Asset));
  return groupLegacyLocations(assets, locations);
}
