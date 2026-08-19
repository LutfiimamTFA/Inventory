import type JSZip from "jszip";

// Ekstraksi embedded image (drawing) dari file .xlsx — SheetJS/sheet_to_json
// HANYA membaca value cell, tidak pernah mengambil gambar yang ditempel di
// atas cell (drawing objects). File .xlsx sebenarnya adalah ZIP berisi XML
// terpisah untuk data (worksheet) dan posisi gambar (drawing) — dua hal ini
// dihubungkan lewat rantai relationship OOXML:
//
//   workbook.xml (nama sheet -> rId)
//     -> workbook.xml.rels (rId -> worksheets/sheetN.xml)
//       -> worksheets/_rels/sheetN.xml.rels (rId drawing -> drawings/drawingM.xml)
//         -> drawings/drawingM.xml (anchor col/row -> rId gambar)
//           -> drawings/_rels/drawingM.xml.rels (rId gambar -> media/imageX.jpg)
//
// Divalidasi terhadap file "Label Aset EGC.xlsx" asli — struktur ini PERSIS
// yang dipakai file itu (oneCellAnchor, tanpa twoCellAnchor).

const NS = {
  spreadsheetMl: "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
  xdr: "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing",
  a: "http://schemas.openxmlformats.org/drawingml/2006/main",
  r: "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
  pkgRels: "http://schemas.openxmlformats.org/package/2006/relationships",
};

export interface ExtractedExcelImage {
  sheetName: string;
  excelRow: number; // 1-based, SAMA dengan RawImportRow.excelRowNumber
  excelColumn: number; // 0-based (col index Excel)
  fileName: string;
  mimeType: string;
  blob: Blob;
}

function parseXml(text: string): Document {
  return new DOMParser().parseFromString(text, "application/xml");
}

// Resolusi path relatif OOXML (mis. "../media/image1.jpg" relatif terhadap
// "xl/drawings/") jadi path absolut di dalam zip ("xl/media/image1.jpg").
function resolveZipPath(basePath: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1);
  const baseParts = basePath.split("/").slice(0, -1);
  const targetParts = target.split("/");
  for (const part of targetParts) {
    if (part === "..") baseParts.pop();
    else if (part === ".") continue;
    else baseParts.push(part);
  }
  return baseParts.join("/");
}

function mimeTypeFromFileName(fileName: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  switch (ext) {
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "gif":
      return "image/gif";
    case "bmp":
      return "image/bmp";
    case "webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

interface RelMap {
  [rId: string]: { type: string; target: string };
}

async function readRelsFile(zip: JSZip, relsPath: string): Promise<RelMap> {
  const file = zip.file(relsPath);
  if (!file) return {};
  const text = await file.async("string");
  const doc = parseXml(text);
  const rels: RelMap = {};
  Array.from(doc.getElementsByTagNameNS(NS.pkgRels, "Relationship")).forEach((el) => {
    const id = el.getAttribute("Id");
    const type = el.getAttribute("Type") || "";
    const target = el.getAttribute("Target") || "";
    if (id) rels[id] = { type, target };
  });
  return rels;
}

// Cari path xl/worksheets/sheetN.xml untuk SATU nama sheet, lewat
// workbook.xml (nama -> r:id) + workbook.xml.rels (r:id -> target).
async function resolveWorksheetPath(zip: JSZip, sheetName: string): Promise<string | null> {
  const workbookFile = zip.file("xl/workbook.xml");
  if (!workbookFile) return null;
  const workbookXml = await workbookFile.async("string");
  const doc = parseXml(workbookXml);

  const sheetEls = Array.from(doc.getElementsByTagNameNS(NS.spreadsheetMl, "sheet"));
  const match = sheetEls.find((el) => el.getAttribute("name") === sheetName);
  const rId = match?.getAttributeNS(NS.r, "id");
  if (!rId) return null;

  const workbookRels = await readRelsFile(zip, "xl/_rels/workbook.xml.rels");
  const rel = workbookRels[rId];
  if (!rel) return null;

  return resolveZipPath("xl/workbook.xml", rel.target);
}

// Cari path xl/drawings/drawingM.xml yang dipakai SATU worksheet, lewat
// worksheets/_rels/sheetN.xml.rels (relationship bertipe ".../drawing").
async function resolveDrawingPath(zip: JSZip, worksheetPath: string): Promise<string | null> {
  const parts = worksheetPath.split("/");
  const fileName = parts.pop()!;
  const relsPath = [...parts, "_rels", `${fileName}.rels`].join("/");
  const rels = await readRelsFile(zip, relsPath);
  const drawingRel = Object.values(rels).find((r) => r.type.endsWith("/drawing"));
  if (!drawingRel) return null;
  return resolveZipPath(worksheetPath, drawingRel.target);
}

interface DrawingAnchor {
  col: number;
  row: number;
  rId: string;
  name: string;
}

// Ambil semua anchor gambar (oneCellAnchor DAN twoCellAnchor — file asli
// yang diuji cuma pakai oneCellAnchor, tapi twoCellAnchor didukung juga
// untuk jaga-jaga sheet lain di masa depan) dari SATU file drawing.
function parseDrawingAnchors(doc: Document): DrawingAnchor[] {
  const anchorNodes = [
    ...Array.from(doc.getElementsByTagNameNS(NS.xdr, "oneCellAnchor")),
    ...Array.from(doc.getElementsByTagNameNS(NS.xdr, "twoCellAnchor")),
  ];

  const anchors: DrawingAnchor[] = [];
  for (const anchor of anchorNodes) {
    const fromEl = anchor.getElementsByTagNameNS(NS.xdr, "from")[0];
    if (!fromEl) continue;
    const colText = fromEl.getElementsByTagNameNS(NS.xdr, "col")[0]?.textContent;
    const rowText = fromEl.getElementsByTagNameNS(NS.xdr, "row")[0]?.textContent;
    if (colText === undefined || colText === null || rowText === undefined || rowText === null) continue;

    const blip = anchor.getElementsByTagNameNS(NS.a, "blip")[0];
    const rId = blip?.getAttributeNS(NS.r, "embed");
    if (!rId) continue; // shape/chart tanpa gambar — lewati

    const nameEl = anchor.getElementsByTagNameNS(NS.xdr, "cNvPr")[0];

    anchors.push({
      col: Number(colText),
      row: Number(rowText),
      rId,
      name: nameEl?.getAttribute("name") || "",
    });
  }
  return anchors;
}

// Fungsi utama — ekstrak SEMUA embedded image pada satu sheet yang ANCHOR-nya
// persis di kolom target (mis. kolom "Bukti Fisik Aset"), sudah dipetakan ke
// nomor baris Excel 1-based (SAMA dengan RawImportRow.excelRowNumber).
export async function extractEmbeddedImagesForSheet(
  zip: JSZip,
  sheetName: string,
  targetColumnIndex: number
): Promise<ExtractedExcelImage[]> {
  try {
    const worksheetPath = await resolveWorksheetPath(zip, sheetName);
    if (!worksheetPath) return [];

    const drawingPath = await resolveDrawingPath(zip, worksheetPath);
    if (!drawingPath) return []; // sheet tanpa gambar sama sekali — bukan error

    const drawingFile = zip.file(drawingPath);
    if (!drawingFile) return [];

    const drawingXml = await drawingFile.async("string");
    const anchors = parseDrawingAnchors(parseXml(drawingXml));
    const relevantAnchors = anchors.filter((a) => a.col === targetColumnIndex);
    if (relevantAnchors.length === 0) return [];

    const drawingParts = drawingPath.split("/");
    const drawingFileName = drawingParts.pop()!;
    const drawingRelsPath = [...drawingParts, "_rels", `${drawingFileName}.rels`].join("/");
    const drawingRels = await readRelsFile(zip, drawingRelsPath);

    const results: ExtractedExcelImage[] = [];
    for (const anchor of relevantAnchors) {
      const rel = drawingRels[anchor.rId];
      if (!rel) continue;
      const mediaPath = resolveZipPath(drawingPath, rel.target);
      const mediaFile = zip.file(mediaPath);
      if (!mediaFile) continue;

      const blob = await mediaFile.async("blob");
      const fileName = anchor.name || mediaPath.split("/").pop() || "image";

      results.push({
        sheetName,
        excelRow: anchor.row + 1,
        excelColumn: anchor.col,
        fileName,
        mimeType: mimeTypeFromFileName(mediaPath),
        blob,
      });
    }
    return results;
  } catch (error) {
    console.error("[Excel Images] gagal ekstrak embedded image", { sheetName, error });
    return [];
  }
}

// Cari index kolom (0-based) untuk "Bukti Fisik Aset" dari columnMap hasil
// detectSheetHeader (excel.ts) — dipakai sebagai targetColumnIndex di atas.
export function findColumnIndex(columnMap: Record<number, string>, field: string): number | null {
  const entry = Object.entries(columnMap).find(([, key]) => key === field);
  return entry ? Number(entry[0]) : null;
}

// Group hasil ekstraksi per baris Excel — satu baris bisa punya lebih dari
// satu gambar (physicalEvidenceImages: string[] di Asset, bukan satu URL).
export function groupImagesByRow(images: ExtractedExcelImage[]): Map<number, ExtractedExcelImage[]> {
  const map = new Map<number, ExtractedExcelImage[]>();
  for (const img of images) {
    const list = map.get(img.excelRow) || [];
    list.push(img);
    map.set(img.excelRow, list);
  }
  return map;
}
