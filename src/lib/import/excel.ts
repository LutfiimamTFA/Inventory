import * as XLSX from "xlsx";

// Header PERSIS seperti "Label Aset EGC.xlsx" — dipakai untuk template
// download DAN sebagai daftar kunci kanonik hasil parsing baris Excel.
export const IMPORT_TEMPLATE_HEADERS = [
  "No",
  "Jenis Aset",
  "Kode Aset",
  "Nama Aset",
  "Tanggal Perolehan",
  "Harga Perolehan",
  "Qty",
  "Invoice",
  "Lokasi",
  "Kondisi",
  "Keterangan",
  "Foto",
  "Bukti Fisik Aset",
] as const;

export type ImportFieldKey =
  | "no"
  | "jenisAset"
  | "kodeAset"
  | "namaAset"
  | "tanggalPerolehan"
  | "hargaPerolehan"
  | "qty"
  | "invoice"
  | "lokasi"
  | "kondisi"
  | "keterangan"
  | "foto"
  | "buktiFisikAset";

// Beberapa kemungkinan penulisan header per kolom — dicocokkan case-insensitive
// & trim, BUKAN posisi kolom, supaya aman kalau urutan kolom di sheet lain
// berbeda (lihat requirement "gunakan nama header, jangan nomor kolom").
const HEADER_ALIASES: Record<string, ImportFieldKey> = {
  "no": "no",
  "no.": "no",
  "jenis aset": "jenisAset",
  "kode aset": "kodeAset",
  "nama aset": "namaAset",
  "tanggal perolehan": "tanggalPerolehan",
  "harga perolehan": "hargaPerolehan",
  "qty": "qty",
  "quantity": "qty",
  "invoice": "invoice",
  "lokasi": "lokasi",
  "kondisi": "kondisi",
  "keterangan": "keterangan",
  "foto": "foto",
  "bukti fisik aset": "buktiFisikAset",
  "bukti fisik": "buktiFisikAset",
};

function normalizeHeaderText(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export interface RawImportRow {
  excelRowNumber: number; // nomor baris ASLI di file Excel (1-based, termasuk header) — untuk error report
  no: string;
  jenisAset: string;
  kodeAset: string;
  namaAset: string;
  tanggalPerolehanRaw: unknown;
  hargaPerolehanRaw: unknown;
  qtyRaw: unknown;
  invoice: string;
  lokasi: string;
  kondisi: string;
  keterangan: string;
  foto: string;
  buktiFisikAset: string;
}

export interface SheetHeaderInfo {
  headerRowIndex: number; // 0-based index di dalam array-of-arrays
  columnMap: Record<number, ImportFieldKey>; // kolom index -> field kanonik
}

const MAX_HEADER_SCAN_ROWS = 15;

// Cari baris header dengan MENCARI kolom "Nama Aset" di beberapa baris
// pertama — TIDAK mengasumsikan selalu baris ke-2, supaya tetap aman kalau
// sheet lain di masa depan menaruh header di baris berbeda.
export function detectSheetHeader(rows: unknown[][]): SheetHeaderInfo | null {
  const scanLimit = Math.min(rows.length, MAX_HEADER_SCAN_ROWS);
  for (let r = 0; r < scanLimit; r++) {
    const row = rows[r];
    if (!row) continue;
    const columnMap: Record<number, ImportFieldKey> = {};
    let hasNamaAset = false;
    row.forEach((cell, colIndex) => {
      const key = HEADER_ALIASES[normalizeHeaderText(cell)];
      if (key) {
        columnMap[colIndex] = key;
        if (key === "namaAset") hasNamaAset = true;
      }
    });
    if (hasNamaAset) {
      return { headerRowIndex: r, columnMap };
    }
  }
  return null;
}

function cellString(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

// Baris dianggap DATA ASET valid hanya kalau "Nama Aset" terisi — ini
// otomatis menyaring baris kosong DAN baris footer/Total (footer "Label
// Aset EGC.xlsx" hanya berisi angka total di kolom Harga/Qty, Nama Aset-nya
// selalu kosong).
export function parseSheetRows(rows: unknown[][], header: SheetHeaderInfo): RawImportRow[] {
  const result: RawImportRow[] = [];

  // Balik columnMap (colIndex -> field) jadi (field -> colIndex) SEKALI di
  // luar loop baris, supaya lookup per baris/field O(1) bukan O(kolom).
  const fieldToColumn = new Map<ImportFieldKey, number>();
  Object.entries(header.columnMap).forEach(([colIndex, key]) => {
    fieldToColumn.set(key, Number(colIndex));
  });

  for (let r = header.headerRowIndex + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.length === 0) continue;

    const get = (key: ImportFieldKey): unknown => {
      const colIndex = fieldToColumn.get(key);
      if (colIndex === undefined) return null;
      return row[colIndex] ?? null;
    };

    const namaAset = cellString(get("namaAset"));
    if (!namaAset) continue; // bukan baris data aset (kosong / footer Total / dst)

    result.push({
      excelRowNumber: r + 1,
      no: cellString(get("no")),
      jenisAset: cellString(get("jenisAset")),
      kodeAset: cellString(get("kodeAset")),
      namaAset,
      tanggalPerolehanRaw: get("tanggalPerolehan"),
      hargaPerolehanRaw: get("hargaPerolehan"),
      qtyRaw: get("qty"),
      invoice: cellString(get("invoice")),
      lokasi: cellString(get("lokasi")),
      kondisi: cellString(get("kondisi")),
      keterangan: cellString(get("keterangan")),
      foto: cellString(get("foto")),
      buktiFisikAset: cellString(get("buktiFisikAset")),
    });
  }

  return result;
}

export async function readWorkbookFromFile(file: File): Promise<XLSX.WorkBook> {
  const buffer = await file.arrayBuffer();
  // SENGAJA tidak pakai cellDates:true — pengujian menunjukkan itu bisa
  // menggeser tanggal mundur satu hari di sekitar tengah malam tergantung
  // timezone browser. Serial number mentah + XLSX.SSF.parse_date_code jauh
  // lebih deterministik (murni kalkulasi kalender, tidak tergantung timezone).
  return XLSX.read(buffer, { type: "array" });
}

export function getSheetRowsAoa(workbook: XLSX.WorkBook, sheetName: string): unknown[][] {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];
  return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true, defval: null }) as unknown[][];
}

// Konversi Excel serial date (ATAU Date object hasil cellDates:true, ATAU
// string tanggal) jadi "YYYY-MM-DD". Pakai XLSX.SSF.parse_date_code untuk
// serial number supaya bug 1900-leap-year Excel ditangani library, bukan
// hitungan manual yang rawan off-by-one.
export function excelValueToISODate(value: unknown): string | null {
  if (value instanceof Date) {
    if (isNaN(value.getTime())) return null;
    const y = value.getUTCFullYear();
    const m = String(value.getUTCMonth() + 1).padStart(2, "0");
    const d = String(value.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  if (typeof value === "number" && isFinite(value) && value > 0) {
    const parsed = XLSX.SSF.parse_date_code(value);
    if (!parsed) return null;
    const y = parsed.y;
    const m = String(parsed.m).padStart(2, "0");
    const d = String(parsed.d).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;

    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

    const dmy = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (dmy) {
      const [, d, m, y] = dmy;
      return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
    }

    const parsedDate = new Date(trimmed);
    if (!isNaN(parsedDate.getTime())) {
      return excelValueToISODate(parsedDate);
    }
  }

  return null;
}

export function excelValueToNumber(value: unknown): number | null {
  if (typeof value === "number" && isFinite(value)) return value;
  if (typeof value === "string") {
    const cleaned = value.replace(/[^\d.-]/g, "");
    if (!cleaned) return null;
    const n = Number(cleaned);
    return isFinite(n) ? n : null;
  }
  return null;
}

export function downloadTemplateXlsx() {
  const ws = XLSX.utils.aoa_to_sheet([[...IMPORT_TEMPLATE_HEADERS]]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Template");
  XLSX.writeFile(wb, "Template Import Aset.xlsx");
}

export interface ErrorReportRow {
  excelRowNumber: number;
  kodeAset: string;
  namaAset: string;
  status: string;
  reason: string;
}

export function downloadErrorReportXlsx(rows: ErrorReportRow[], fileLabel: string) {
  const aoa = [
    ["Baris Excel", "Kode Aset", "Nama Aset", "Status", "Alasan"],
    ...rows.map((r) => [r.excelRowNumber, r.kodeAset || "-", r.namaAset || "-", r.status, r.reason]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Error Report");
  XLSX.writeFile(wb, `Error Report - ${fileLabel}.xlsx`);
}
