import type * as XLSX from "xlsx";
import type JSZip from "jszip";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { RawImportRow } from "./excel";
import { ExtractedExcelImage } from "./excel-images";
import { PendingImage } from "./asset-row-mapper";

// Section Sinkronkan Foto Excel — BEDA dari Import Aset Baru: mode ini TIDAK
// PERNAH membuat dokumen aset baru (tidak ada addDoc/setDoc sama sekali di
// seluruh alur ini), cuma mencocokkan baris Excel ke aset yang SUDAH ADA
// (lewat assetCode) lalu updateDoc HANYA field dokumentasi foto.

// Dikirim dari tab "Import Aset Baru" ke tab "Sinkronkan Foto Excel" ketika
// sistem mendeteksi sheet+company yang dipilih SUDAH PERNAH diimport —
// supaya user tidak perlu upload Excel/pilih sheet/pilih perusahaan lagi
// (lihat MODE_SYNC_EXISTING_ASSET_PHOTOS di ImportNewAssetsTab/SyncPhotosTab).
export interface PhotoSyncHandoff {
  file: File;
  workbook: XLSX.WorkBook;
  zip: JSZip;
  sheetName: string;
  companyId: string;
  companyName: string;
}

export type SyncRowStatus =
  | "ready" // aset ditemukan + foto ditemukan + belum ada foto -> siap sinkron
  | "has_photo" // aset ditemukan + foto ditemukan + SUDAH ada foto -> butuh keputusan overwrite/append
  | "no_photo" // aset ditemukan tapi Excel tidak punya foto di baris ini -> dilewati, BUKAN error
  | "not_found" // kode aset tidak cocok dengan aset manapun -> warning, JANGAN buat aset baru
  | "empty_code" // Kode Aset kosong di Excel -> warning, JANGAN matching berdasarkan nama
  | "duplicate"; // >1 aset existing punya kode yang sama -> perlu review manual

export interface ExistingAssetLite {
  id: string;
  assetCode: string;
  assetName: string;
  companyOwnerName: string;
  physicalEvidenceImages: string[];
  // Dipakai untuk cek "aset ini SUDAH punya foto utama?" sebelum backfill
  // photoUrl/photoDriveFileId dari hasil sync — jangan pernah timpa foto
  // utama yang sudah ada (mis. diisi manual lewat Tambah/Edit Aset).
  photoUrl?: string;
  photoDriveFileId?: string;
}

export interface SyncRow {
  excelRowNumber: number;
  kodeAsetExcel: string;
  namaAsetExcel: string;
  status: SyncRowStatus;
  matchedAsset: ExistingAssetLite | null;
  duplicateCount: number;
  excelImages: PendingImage[];
}

// Normalisasi HANYA untuk perbandingan (trim + uppercase + rapikan spasi) —
// nilai assetCode asli yang tersimpan di Firestore TIDAK PERNAH diubah.
export function normalizeAssetCodeForMatch(code: string): string {
  return code.trim().toUpperCase().replace(/\s+/g, " ");
}

// Company sudah dipilih di step wizard (sama seperti Import Aset Baru) —
// query di-scope ke companyOwnerId supaya tidak perlu fetch seluruh
// collection assets (bisa besar) dan langsung selaras dengan pilihan user.
export async function fetchExistingAssetsForCompany(companyId: string): Promise<ExistingAssetLite[]> {
  const snap = await getDocs(query(collection(db, "assets"), where("companyOwnerId", "==", companyId)));
  return snap.docs.map((d) => {
    const data = d.data() as Record<string, unknown>;
    return {
      id: d.id,
      assetCode: typeof data.assetCode === "string" ? data.assetCode : "",
      assetName: typeof data.assetName === "string" ? data.assetName : "",
      companyOwnerName: typeof data.companyOwnerName === "string" ? data.companyOwnerName : "",
      physicalEvidenceImages: Array.isArray(data.physicalEvidenceImages)
        ? (data.physicalEvidenceImages as string[])
        : [],
      photoUrl: typeof data.photoUrl === "string" ? data.photoUrl : undefined,
      photoDriveFileId: typeof data.photoDriveFileId === "string" ? data.photoDriveFileId : undefined,
    };
  });
}

function toPendingImage(image: ExtractedExcelImage): PendingImage {
  return {
    fileName: image.fileName,
    mimeType: image.mimeType,
    blob: image.blob,
    objectUrl: URL.createObjectURL(image.blob),
  };
}

export function buildSyncRows(
  rawRows: RawImportRow[],
  imagesByRow: Map<number, ExtractedExcelImage[]>,
  existingAssets: ExistingAssetLite[]
): SyncRow[] {
  const byCode = new Map<string, ExistingAssetLite[]>();
  existingAssets.forEach((asset) => {
    if (!asset.assetCode) return;
    const key = normalizeAssetCodeForMatch(asset.assetCode);
    const list = byCode.get(key) || [];
    list.push(asset);
    byCode.set(key, list);
  });

  return rawRows.map((raw) => {
    const excelImages = (imagesByRow.get(raw.excelRowNumber) || []).map(toPendingImage);
    const kodeAsetExcel = raw.kodeAset.trim();

    const base = {
      excelRowNumber: raw.excelRowNumber,
      kodeAsetExcel,
      namaAsetExcel: raw.namaAset,
      excelImages,
      duplicateCount: 0,
    };

    if (!kodeAsetExcel) {
      return { ...base, status: "empty_code" as const, matchedAsset: null };
    }

    const matches = byCode.get(normalizeAssetCodeForMatch(kodeAsetExcel)) || [];

    if (matches.length > 1) {
      return { ...base, status: "duplicate" as const, matchedAsset: null, duplicateCount: matches.length };
    }
    if (matches.length === 0) {
      return { ...base, status: "not_found" as const, matchedAsset: null };
    }

    const asset = matches[0];
    if (excelImages.length === 0) {
      return { ...base, status: "no_photo" as const, matchedAsset: asset };
    }
    if (asset.physicalEvidenceImages.length > 0) {
      return { ...base, status: "has_photo" as const, matchedAsset: asset };
    }
    return { ...base, status: "ready" as const, matchedAsset: asset };
  });
}

export function revokeSyncRowImages(rows: SyncRow[]) {
  rows.forEach((row) => row.excelImages.forEach((img) => URL.revokeObjectURL(img.objectUrl)));
}
