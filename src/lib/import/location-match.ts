import { AssetLocationNode } from "@/lib/types";
import { locationLabelOf } from "@/lib/locations";

function normalize(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

// Normalisasi KHUSUS alias lokasi lama — lebih agresif dari normalize() di
// atas: "Lt."/"Lt. "/"lt" disamakan, titik/tanda baca liar dibuang, supaya
// "Hall Lt. 2"/"Hall Lt.2"/"hall lt 2" jadi SATU key yang sama. Dipakai baik
// oleh Sinkronkan Lokasi Lama (lib/import/legacy-location-sync.ts) maupun
// matchLocation() di bawah — HARUS konsisten di kedua tempat supaya alias
// yang sudah dipetakan benar-benar dikenali lagi saat import berikutnya.
export function normalizeLegacyLocationAlias(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/lt\.?\s*/g, "lt ")
    .replace(/[.,;:'"`]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface LocationMatchResult {
  node: AssetLocationNode | null;
  matchedBy: "legacy_alias" | "exact_label" | "exact_path" | "contains" | "none";
}

// Cocokkan teks "Lokasi" mentah dari Excel (mis. "CBDMS", "OCD", "MDS") ke
// SATU node Master Lokasi manapun (Gedung/Lantai/Ruangan/Area) — bukan cuma
// level Area, karena kode lokasi seperti ini bisa saja disimpan di level
// mana pun tergantung struktur Master Lokasi masing-masing perusahaan.
// TIDAK PERNAH menolak import kalau tidak ketemu — pemanggil (row mapper)
// tetap menyimpan teks lokasi mentahnya dan menandai baris sebagai warning.
export function matchLocation(rawLokasi: string, locations: AssetLocationNode[]): LocationMatchResult {
  const raw = normalize(rawLokasi);
  if (!raw) return { node: null, matchedBy: "none" };

  // Prioritas 1 — alias legacy yang SUDAH dikonfirmasi user lewat
  // "Sinkronkan Lokasi Lama". Dicek PALING AWAL (sebelum exact_label/fuzzy)
  // supaya keputusan mapping manual user selalu menang, bukan ketimpa
  // fallback otomatis yang kebetulan match duluan.
  const aliasKey = normalizeLegacyLocationAlias(rawLokasi);
  if (aliasKey) {
    const aliasMatch = locations.find((n) =>
      (n.legacyAliases || []).some((alias) => normalizeLegacyLocationAlias(alias) === aliasKey)
    );
    if (aliasMatch) return { node: aliasMatch, matchedBy: "legacy_alias" };
  }

  const exactLabel = locations.find((n) => normalize(locationLabelOf(n)) === raw);
  if (exactLabel) return { node: exactLabel, matchedBy: "exact_label" };

  const exactPath = locations.find((n) => normalize(n.fullPath || "") === raw);
  if (exactPath) return { node: exactPath, matchedBy: "exact_path" };

  // Fallback longgar — teks Excel muncul sebagai bagian dari fullPath node
  // (mis. rawLokasi "OCD" ada di dalam "Gedung A / Lantai 2 / OCD"), ATAU
  // sebaliknya label node ada di dalam teks Excel yang lebih panjang.
  const contains = locations.find((n) => {
    const path = normalize(n.fullPath || "");
    const label = normalize(locationLabelOf(n));
    return (path && path.includes(raw)) || (label && raw.includes(label) && label.length >= 3);
  });
  if (contains) return { node: contains, matchedBy: "contains" };

  return { node: null, matchedBy: "none" };
}
