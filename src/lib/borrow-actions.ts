import {
  addDoc,
  collection,
  doc,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Asset, AssetCondition } from "@/lib/types";
import { writeAssetLog } from "@/lib/firestore-helpers";

export async function borrowAsset(params: {
  asset: Asset;
  userUid: string;
  userName: string;
  userEmail: string;
  estimatedReturnAt: string;
  borrowNotes: string;
}) {
  const { asset, userUid, userName, userEmail, estimatedReturnAt, borrowNotes } =
    params;

  const borrowingRef = await addDoc(collection(db, "asset_borrowings"), {
    assetId: asset.id,
    assetName: asset.assetName,
    assetCode: asset.assetCode,
    borrowedByUid: userUid,
    borrowedByName: userName,
    borrowedByEmail: userEmail,
    borrowedAt: serverTimestamp(),
    estimatedReturnAt: estimatedReturnAt || null,
    returnedAt: null,
    status: "borrowed",
    borrowNotes: borrowNotes || "",
  });

  await updateDoc(doc(db, "assets", asset.id), {
    assetStatus: "borrowed",
    currentBorrowingId: borrowingRef.id,
    currentBorrowerUid: userUid,
    currentBorrowerName: userName,
    updatedAt: serverTimestamp(),
  });

  await writeAssetLog({
    assetId: asset.id,
    assetName: asset.assetName,
    assetCode: asset.assetCode,
    action: "borrow",
    userUid,
    userName,
    detail: borrowNotes || "Aset dipinjam",
  });

  return borrowingRef.id;
}

export async function returnAsset(params: {
  asset: Asset;
  userUid: string;
  userName: string;
  returnCondition: AssetCondition;
  returnNotes: string;
}) {
  const { asset, userUid, userName, returnCondition, returnNotes } = params;

  if (!asset.currentBorrowingId) {
    throw new Error("Aset ini tidak sedang dipinjam.");
  }

  await updateDoc(doc(db, "asset_borrowings", asset.currentBorrowingId), {
    returnedAt: serverTimestamp(),
    status: "returned",
    returnCondition,
    returnNotes: returnNotes || "",
  });

  const isDamaged =
    returnCondition === "minor_damage" || returnCondition === "heavy_damage";

  await updateDoc(doc(db, "assets", asset.id), {
    assetStatus: isDamaged ? "maintenance" : "available",
    condition: returnCondition,
    currentBorrowingId: null,
    currentBorrowerUid: null,
    currentBorrowerName: null,
    updatedAt: serverTimestamp(),
  });

  await writeAssetLog({
    assetId: asset.id,
    assetName: asset.assetName,
    assetCode: asset.assetCode,
    action: "return",
    userUid,
    userName,
    detail: returnNotes || "Aset dikembalikan",
  });
}
