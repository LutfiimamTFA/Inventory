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
import {
  AppRole,
  AssetIssueLogAction,
  AssetUser,
  AssetUserLogAction,
  IssueImpactLevel,
  IssuePriority,
  IssueTicketStatus,
  MaintenanceWorkOrderLogAction,
  WorkOrderStatus,
} from "@/lib/types";

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

// Format: TKT-[TAHUN]-[NOMOR_URUT] mis. TKT-2026-0001
export async function generateTicketNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `TKT-${year}-`;
  const q = query(
    collection(db, "asset_issue_tickets"),
    where("ticketNumber", ">=", prefix),
    where("ticketNumber", "<", prefix + "")
  );
  const snap = await getDocs(q);
  const sequence = snap.size + 1;
  return `${prefix}${String(sequence).padStart(4, "0")}`;
}

// Format: Q-[YYYYMMDD]-[NOMOR] mis. Q-20260707-001
export async function generateQueueNumber(): Promise<string> {
  const now = new Date();
  const datePart = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(
    now.getDate()
  ).padStart(2, "0")}`;
  const prefix = `Q-${datePart}-`;
  const q = query(
    collection(db, "asset_issue_tickets"),
    where("queueNumber", ">=", prefix),
    where("queueNumber", "<", prefix + "")
  );
  const snap = await getDocs(q);
  const sequence = snap.size + 1;
  return `${prefix}${String(sequence).padStart(3, "0")}`;
}

export const IMPACT_TO_PRIORITY: Record<IssueImpactLevel, IssuePriority> = {
  "Masih Bisa Dipakai": "low",
  "Mengganggu Pekerjaan": "medium",
  "Tidak Bisa Dipakai": "high",
  Darurat: "urgent",
};

export async function writeAssetIssueLog(params: {
  ticketId: string;
  ticketNumber: string;
  action: AssetIssueLogAction;
  oldStatus?: IssueTicketStatus;
  newStatus?: IssueTicketStatus;
  note?: string;
  performedByUid: string;
  performedByName: string;
}) {
  await addDoc(collection(db, "asset_issue_logs"), {
    ...params,
    performedAt: serverTimestamp(),
  });
}

// Format: MWO-[TAHUN]-[NOMOR_URUT] mis. MWO-2026-0001
export async function generateWorkOrderNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `MWO-${year}-`;
  const q = query(
    collection(db, "asset_maintenance_work_orders"),
    where("workOrderNumber", ">=", prefix),
    where("workOrderNumber", "<", prefix + "")
  );
  const snap = await getDocs(q);
  const sequence = snap.size + 1;
  return `${prefix}${String(sequence).padStart(4, "0")}`;
}

export async function writeWorkOrderLog(params: {
  workOrderId: string;
  workOrderNumber: string;
  action: MaintenanceWorkOrderLogAction;
  oldStatus?: WorkOrderStatus;
  newStatus?: WorkOrderStatus;
  note?: string;
  oldData?: Record<string, unknown>;
  newData?: Record<string, unknown>;
  changedFields?: string[];
  performedByUid: string;
  performedByName: string;
}) {
  await addDoc(collection(db, "asset_maintenance_work_order_logs"), {
    ...params,
    performedAt: serverTimestamp(),
  });
}

// Format: MRP-[TAHUN]-[NOMOR_URUT] mis. MRP-2026-0001 (Maintenance Routine Plan)
export async function generatePlanNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `MRP-${year}-`;
  const q = query(
    collection(db, "asset_maintenance_plans"),
    where("planNumber", ">=", prefix),
    where("planNumber", "<", prefix + "")
  );
  const snap = await getDocs(q);
  const sequence = snap.size + 1;
  return `${prefix}${String(sequence).padStart(4, "0")}`;
}

export async function fetchActiveUsersByRole(role: AppRole): Promise<AssetUser[]> {
  const q = query(
    collection(db, "asset_users"),
    where("role", "==", role),
    where("status", "==", "active")
  );
  const snap = await getDocs(q);
  return snap.docs.map((d) => ({ uid: d.id, ...d.data() } as AssetUser));
}

export async function fetchActiveUsersByRoles(roles: AppRole[]): Promise<AssetUser[]> {
  const lists = await Promise.all(roles.map((r) => fetchActiveUsersByRole(r)));
  return lists.flat();
}

export async function fetchActiveAssetsMinimal(): Promise<
  { id: string; buildingId?: string; floorId?: string; roomId?: string; areaId?: string }[]
> {
  const snap = await getDocs(collection(db, "assets"));
  return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
}
