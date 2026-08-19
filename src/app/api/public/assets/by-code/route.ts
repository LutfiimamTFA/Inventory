import { NextResponse } from "next/server";
import { getAdminFirestore } from "@/lib/firebase-admin";
import { getAssetConditionLabel } from "@/lib/utils";
import { getAssetNumber, getAssetQuantity } from "@/lib/assets/inventory";
import { getAssetUsageLabel, resolveAssetPhotoSrc } from "@/lib/assets/asset-status";
import { Asset } from "@/lib/types";

export const runtime = "nodejs";

// Section 1 — Scan QR / Barcode publik: halaman /asset-action boleh dibuka
// TANPA login, tapi Firestore `assets` TIDAK BOLEH jadi public (allow read:
// if true). Route server ini pakai Firebase Admin SDK (bypass rules, aman
// karena berjalan di server tepercaya) lalu HANYA mengembalikan whitelist
// field publik di bawah — jangan pernah tambahkan harga/invoice/finance/
// email PIC/UID/riwayat internal/maintenance/audit log/data karyawan ke sini.
function toPublicAssetPayload(id: string, asset: Asset) {
  const photo = resolveAssetPhotoSrc(asset);
  return {
    id,
    assetCode: asset.assetCode || "",
    assetName: asset.assetName || "",
    assetNumber: getAssetNumber(asset),
    categoryName: asset.categoryName || "",
    statusLabel: getAssetUsageLabel(asset, null),
    conditionLabel: getAssetConditionLabel(asset),
    companyName: asset.companyOwnerName || "",
    locationText: asset.location || asset.locationText || "",
    locationId: asset.locationId || asset.areaId || asset.roomId || asset.floorId || asset.buildingId || null,
    quantity: getAssetQuantity(asset),
    photoUrl: photo.src,
    picName: asset.areaPicName || null,
  };
}

// Section 6 — urutan fallback pencarian SAMA seperti fetchAssetByCode di
// asset-action/page.tsx (assetCode -> qrTagId -> id dokumen langsung),
// supaya QR lama/baru yang sudah beredar tetap terbuka lewat jalur publik
// ini juga. Tidak mengubah QR value/generator apa pun.
async function findAssetByCode(code: string) {
  const db = getAdminFirestore();
  if (!db) return null;

  const byCode = await db.collection("assets").where("assetCode", "==", code).limit(1).get();
  if (!byCode.empty) {
    const d = byCode.docs[0];
    return { id: d.id, data: d.data() as Asset };
  }

  const byTag = await db.collection("assets").where("qrTagId", "==", code).limit(1).get();
  if (!byTag.empty) {
    const d = byTag.docs[0];
    return { id: d.id, data: d.data() as Asset };
  }

  const byId = await db.collection("assets").doc(code).get();
  if (byId.exists) {
    return { id: byId.id, data: byId.data() as Asset };
  }

  return null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = (searchParams.get("code") || "").trim();

  if (!code) {
    return NextResponse.json({ found: false, message: "Kode asset wajib diisi." }, { status: 400 });
  }

  try {
    const result = await findAssetByCode(code);
    if (!result) {
      return NextResponse.json({ found: false }, { status: 404 });
    }

    return NextResponse.json({ found: true, asset: toPublicAssetPayload(result.id, result.data) });
  } catch (error) {
    console.error("[Public Asset Lookup] gagal mencari asset", {
      code,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    return NextResponse.json({ found: false, message: "Gagal memuat data asset." }, { status: 500 });
  }
}
