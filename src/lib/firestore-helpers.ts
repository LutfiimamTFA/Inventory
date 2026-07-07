import {
  addDoc,
  collection,
  getDocs,
  limit,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { AppRole, AssetUserLogAction } from "@/lib/types";

function normalizeCategoryCodePart(categoryCode: string) {
  return (categoryCode || "GEN").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

// Format: AST-[KODE_KATEGORI]-[TAHUN]-[NOMOR_URUT] mis. AST-LAP-2026-0001
export async function generateAssetCode(categoryCode: string): Promise<string> {
  const codePart = normalizeCategoryCodePart(categoryCode) || "GEN";
  const year = new Date().getFullYear();
  const prefix = `AST-${codePart}-${year}-`;

  const q = query(
    collection(db, "assets"),
    where("assetCode", ">=", prefix),
    where("assetCode", "<", prefix + "")
  );
  const snap = await getDocs(q);
  const sequence = snap.size + 1;
  return `${prefix}${String(sequence).padStart(4, "0")}`;
}

export async function isAssetCodeTaken(
  assetCode: string,
  excludeAssetId?: string
): Promise<boolean> {
  const q = query(
    collection(db, "assets"),
    where("assetCode", "==", assetCode),
    limit(2)
  );
  const snap = await getDocs(q);
  return snap.docs.some((d) => d.id !== excludeAssetId);
}

export async function writeAssetLog(params: {
  assetId: string;
  assetName: string;
  assetCode: string;
  action: string;
  userUid: string;
  userName: string;
  detail?: string;
}) {
  await addDoc(collection(db, "asset_logs"), {
    ...params,
    timestamp: serverTimestamp(),
  });
}

export async function writeAssetUserLog(params: {
  targetUid: string;
  targetName: string;
  targetEmail: string;
  oldRole?: AppRole;
  newRole?: AppRole;
  oldStatus?: "active" | "inactive";
  newStatus?: "active" | "inactive";
  action: AssetUserLogAction;
  performedByUid: string;
  performedByName: string;
  detail?: string;
}) {
  await addDoc(collection(db, "asset_user_logs"), {
    ...params,
    timestamp: serverTimestamp(),
  });
}
