import { collection, doc, getDocs, query, runTransaction, serverTimestamp, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { isAssetCodeTaken } from "@/lib/firestore-helpers";

// Section "Create/Edit Asset ikuti Excel" — No. Aset & Kode Aset TIDAK
// PERNAH diisi manual oleh user (ticket eksplisit: "rawan salah dan
// duplicate"). Keduanya dibentuk otomatis dari data yang sudah dipilih user
// (Perusahaan/Tanggal Perolehan/Lokasi/Kategori), format mengikuti
// "Label Aset EGC.xlsx":
//
//   EGS   . 28/11/2017      . MDS  . G-E06
//   ^company  ^tanggal perolehan  ^lokasi ^kategori(E)+sequence(06)
//
// Race-safety ("dua user create asset hampir bersamaan"): pakai counter
// document per company (No. Aset) / per company+kategori (sequence Kode
// Aset) yang di-increment lewat Firestore transaction — BUKAN sekadar
// "baca max lalu +1" di client, karena itu rawan race. Transaction hanya
// bisa transaction.get() dokumen langsung (bukan query), jadi nilai bootstrap
// awal (kalau counter document belum pernah ada) dihitung SEKALI di luar
// transaction dari data assets existing — tetap aman dari race karena kalau
// ternyata sudah ada counter document (dibuat transaction lain yang menang
// duluan), transaction.get() di dalam akan melihatnya dan bootstrap value
// tidak pernah dipakai lagi.

const LEGAL_PREFIXES = new Set(["PT", "CV", "UD", "PD", "TBK", "PERSERO"]);

// "PT Environesia Global Saraya" -> "EGS" (buang prefix badan hukum, ambil
// huruf pertama tiap kata sisanya). HrpBrand TIDAK punya field kode sendiri
// (data dari collection HRP eksternal), jadi kode perusahaan diturunkan
// deterministik dari nama, bukan disimpan terpisah.
export function deriveCompanyCode(companyName: string): string {
  const words = companyName
    .trim()
    .split(/\s+/)
    .filter((w) => w && !LEGAL_PREFIXES.has(w.toUpperCase().replace(/\./g, "")));
  if (words.length === 0) return "GEN";
  if (words.length === 1) return words[0].slice(0, 3).toUpperCase();
  return words.map((w) => w[0].toUpperCase()).join("");
}

// "YYYY-MM-DD" -> "DD/MM/YYYY" (format tanggal pada Kode Aset Excel).
export function formatDateForAssetCode(isoDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate.trim());
  if (!m) return "";
  const [, y, mo, d] = m;
  return `${d}/${mo}/${y}`;
}

// Section "Rombak Tambah/Edit Asset" — nama Ruangan/Divisi yang KEBETULAN
// sudah berbentuk kode pendek (mis. "DTIC", "MDS", "CBDMS") dipakai
// langsung sebagai kode lokasi kalau roomCode/divisionCode eksplisit belum
// diisi di Master Lokasi/HRP — supaya user tidak perlu isi field kode
// terpisah untuk nama yang sudah jelas ringkas. HANYA nama yang memang
// "code-like" (huruf/angka/underscore/dash, 2-12 karakter, TANPA spasi)
// yang dipakai — nama panjang seperti "Ruang Meeting Lantai 2" TIDAK PERNAH
// diubah jadi kode buatan sendiri.
const CODE_LIKE_NAME_PATTERN = /^[A-Za-z0-9_-]{2,12}$/;

function codeFromNameIfCodeLike(name?: string | null): string {
  const trimmed = name?.trim() || "";
  if (!trimmed || !CODE_LIKE_NAME_PATTERN.test(trimmed)) return "";
  return trimmed.toUpperCase();
}

// Section "Perbaiki generator Kode Aset" — Kode Aset TIDAK BOLEH mewajibkan
// Kode Gedung (mis. "Avenue" belum di-set jadi "AVE"), karena format Excel
// yang dipakai lebih sering memuat kode lokasi OPERASIONAL yang lebih
// spesifik (Ruangan, mis. "DTIC"). Prioritas: Kode Ruangan eksplisit ->
// nama Ruangan (kalau code-like) -> Kode Divisi eksplisit -> nama Divisi
// (kalau code-like) -> Kode Gedung (fallback terakhir). Kosongkan salah
// satu/semua tidak masalah — cukup satu yang terisi. floorCode/areaCode
// SENGAJA tidak ikut prioritas ini (belum diminta ticket), meski field-nya
// sudah tersedia di AssetLocationNode.
export function resolveOperationalLocationCode(params: {
  roomCode?: string | null;
  roomName?: string | null;
  divisionCode?: string | null;
  divisionName?: string | null;
  buildingCode?: string | null;
}): {
  code: string;
  source: "room_code" | "room_name" | "division_code" | "division_name" | "building" | null;
} {
  const roomCode = params.roomCode?.trim();
  if (roomCode) return { code: roomCode, source: "room_code" };
  const roomNameCode = codeFromNameIfCodeLike(params.roomName);
  if (roomNameCode) return { code: roomNameCode, source: "room_name" };
  const divisionCode = params.divisionCode?.trim();
  if (divisionCode) return { code: divisionCode, source: "division_code" };
  const divisionNameCode = codeFromNameIfCodeLike(params.divisionName);
  if (divisionNameCode) return { code: divisionNameCode, source: "division_name" };
  const buildingCode = params.buildingCode?.trim();
  if (buildingCode) return { code: buildingCode, source: "building" };
  return { code: "", source: null };
}

export function buildExcelStyleAssetCode(params: {
  companyCode: string;
  dateForCode: string; // sudah dalam format DD/MM/YYYY
  locationCode: string;
  categoryCode: string;
  sequence: number;
}): string {
  const seq = String(params.sequence).padStart(2, "0");
  return `${params.companyCode}.${params.dateForCode}.${params.locationCode}.G-${params.categoryCode}${seq}`;
}

export async function getMaxAssetNumberForCompany(companyId: string): Promise<number> {
  const snap = await getDocs(query(collection(db, "assets"), where("companyOwnerId", "==", companyId)));
  let max = 0;
  snap.forEach((d) => {
    const n = d.data().assetNumber;
    if (typeof n === "number" && Number.isFinite(n) && n > max) max = n;
  });
  return max;
}

// Cari sequence terbesar dari Kode Aset EXISTING yang cocok pola
// "...G-{categoryCode}{NN}" untuk company ini — dipakai sebagai bootstrap
// counter kalau belum pernah ada counter document. Kode lama yang tidak
// cocok pola (mis. skema AST-XXX-YYYY-NNNN dari Import Aset, atau kode Excel
// historis yang tidak beraturan) diabaikan, BUKAN dianggap error.
export async function getMaxCodeSequenceForCompanyCategory(companyId: string, categoryCode: string): Promise<number> {
  const snap = await getDocs(query(collection(db, "assets"), where("companyOwnerId", "==", companyId)));
  const pattern = new RegExp(`G-${categoryCode}(\\d+)$`);
  let max = 0;
  snap.forEach((d) => {
    const code = d.data().assetCode;
    if (typeof code !== "string") return;
    const m = pattern.exec(code.trim());
    if (m) {
      const seq = Number(m[1]);
      if (Number.isFinite(seq) && seq > max) max = seq;
    }
  });
  return max;
}

// Preview SAJA — dipanggil setiap kombinasi Perusahaan/Tanggal/Lokasi/
// Kategori berubah supaya user langsung lihat "No. Aset: 51 — dibuat
// otomatis" / "Kode Aset: EGS.28/11/2017.MDS.G-E06" SEBELUM submit. TIDAK
// menulis apa pun ke Firestore — alokasi final race-safe terjadi di
// allocateAssetNumber/allocateAssetCodeSequence saat submit sungguhan.
export async function previewNextAssetNumber(companyId: string): Promise<number> {
  if (!companyId) return 1;
  return (await getMaxAssetNumberForCompany(companyId)) + 1;
}

export async function previewNextAssetCode(params: {
  companyId: string;
  companyCode: string;
  dateForCode: string;
  locationCode: string;
  categoryCode: string;
}): Promise<string> {
  if (!params.companyId || !params.categoryCode) return "";
  const seq = (await getMaxCodeSequenceForCompanyCategory(params.companyId, params.categoryCode)) + 1;
  return buildExcelStyleAssetCode({ ...params, sequence: seq });
}

// Section "Fix Create Asset PIC Lokasi" — metadata write-attribution (BUKAN
// bagian dari nilai counter itu sendiri) yang wajib disertakan setiap kali
// counter document ditulis, supaya firestore.rules bisa memverifikasi PIC
// Lokasi cuma menggenerate No./Kode Aset untuk lokasi yang benar-benar dia
// pegang (lihat isLocationPicAssetCounterWrite() di firestore.rules — cek
// field locationId & updatedByUid PERSIS seperti ini). locationId HARUS
// locationId yang sama dengan aset yang sedang dibuat (assetPayload.locationId),
// bukan id lain — kalau beda, PIC akan ditolak rules meski sebenarnya sah.
export interface AssetCounterWriteMeta {
  locationId?: string | null;
  updatedByUid?: string;
  updatedByName?: string;
}

function buildCounterMetaFields(meta?: AssetCounterWriteMeta): Record<string, unknown> {
  const fields: Record<string, unknown> = {};
  if (meta?.locationId) fields.locationId = meta.locationId;
  if (meta?.updatedByUid) fields.updatedByUid = meta.updatedByUid;
  if (meta?.updatedByName) fields.updatedByName = meta.updatedByName;
  return fields;
}

// Alokasi FINAL race-safe — dipanggil sesaat sebelum addDoc() saat submit.
export async function allocateAssetNumber(companyId: string, meta?: AssetCounterWriteMeta): Promise<number> {
  const counterRef = doc(db, "asset_number_counters", companyId);
  const bootstrapMax = await getMaxAssetNumberForCompany(companyId);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(counterRef);
    const last = snap.exists() ? (snap.data().lastAssetNumber as number) || 0 : bootstrapMax;
    const next = last + 1;
    tx.set(
      counterRef,
      { lastAssetNumber: next, updatedAt: serverTimestamp(), ...buildCounterMetaFields(meta) },
      { merge: true }
    );
    return next;
  });
}

async function allocateAssetCodeSequence(
  companyId: string,
  categoryCode: string,
  meta?: AssetCounterWriteMeta
): Promise<number> {
  const counterKey = `${companyId}__${categoryCode}`;
  const counterRef = doc(db, "asset_code_counters", counterKey);
  const bootstrapMax = await getMaxCodeSequenceForCompanyCategory(companyId, categoryCode);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(counterRef);
    const last = snap.exists() ? (snap.data().lastSequence as number) || 0 : bootstrapMax;
    const next = last + 1;
    tx.set(
      counterRef,
      { lastSequence: next, updatedAt: serverTimestamp(), ...buildCounterMetaFields(meta) },
      { merge: true }
    );
    return next;
  });
}

// Alokasi Kode Aset FINAL — transaction counter (race-safe untuk kasus
// normal) DITAMBAH verifikasi isAssetCodeTaken sebagai jaring pengaman kedua
// (ticket poin 5: "generate nomor berikutnya sampai menemukan kode yang
// belum dipakai") — kalau entah kenapa kode hasil counter TETAP sudah
// dipakai (mis. data lama yang tidak konsisten), naikkan sequence lagi
// sampai benar-benar kosong, maksimal 20 percobaan supaya tidak infinite loop.
export async function allocateAssetCode(params: {
  companyId: string;
  companyCode: string;
  dateForCode: string;
  locationCode: string;
  categoryCode: string;
  counterMeta?: AssetCounterWriteMeta;
}): Promise<string> {
  const MAX_ATTEMPTS = 20;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const sequence = await allocateAssetCodeSequence(params.companyId, params.categoryCode, params.counterMeta);
    const code = buildExcelStyleAssetCode({ ...params, sequence });
    const taken = await isAssetCodeTaken(code);
    if (!taken) return code;
    console.warn("[Asset Code Generator] kode hasil counter ternyata sudah dipakai, coba sequence berikutnya", {
      code,
      attempt,
    });
  }
  throw new Error("Gagal membuat Kode Aset unik setelah beberapa percobaan.");
}
