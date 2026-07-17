import {
  addDoc,
  collection,
  getDocs,
  limit,
  query,
  serverTimestamp,
  where,
} from "firebase/firestore";
import { db, EMPLOYEE_PROFILES_COLLECTION } from "@/lib/firebase";
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

export function cleanFirestoreData(value: unknown): unknown {
  if (value === undefined || value === null) return null;

  if (Array.isArray(value)) {
    return value.map((item) => cleanFirestoreData(item));
  }

  if (value instanceof Date) {
    return value;
  }

  if (typeof value === "object") {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      return value;
    }

    const cleaned: Record<string, unknown> = {};
    Object.entries(value as Record<string, unknown>).forEach(([key, val]) => {
      cleaned[key] = cleanFirestoreData(val);
    });

    return cleaned;
  }

  return value;
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
  fromUid?: string;
  fromName?: string;
  toUid?: string;
  toName?: string;
  custodianUid?: string;
  custodianName?: string;
  purpose?: string;
  expectedReturnAt?: string;
  note?: string;
}) {
  const payload = cleanFirestoreData(params) as Record<string, unknown>;
  await addDoc(collection(db, "asset_logs"), {
    ...payload,
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
  const payload = cleanFirestoreData(params) as Record<string, unknown>;
  await addDoc(collection(db, "asset_maintenance_work_order_logs"), {
    ...payload,
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

export interface EmployeeOption {
  uid: string;
  name: string;
  email: string | null;
  divisionName: string | null;
  brandName: string | null;
  roleLabel: string;
}

// Kandidat/pelamar TIDAK boleh muncul sebagai pilihan custodian/pemakai
// aset — cuma karyawan sungguhan. Dicek dari role (bukan cuma status) karena
// beberapa sumber data menandai kandidat lewat field role, bukan status.
function isCandidateRecord(role: string): boolean {
  return role.includes("kandidat") || role.includes("candidate") || role.includes("applicant");
}

function isInactiveRecord(e: Record<string, unknown>, status: string): boolean {
  if (status.includes("inactive") || status.includes("nonaktif") || status.includes("rejected")) {
    return true;
  }
  if (typeof e.isActive === "boolean" && !e.isActive) return true;
  if (typeof e.active === "boolean" && !e.active) return true;
  return false;
}

// Sumber tunggal untuk dropdown pilih karyawan (PIC/Custodian, Serahkan
// Sementara, dst) — SEMUA karyawan aktif dari EMPLOYEE_PROFILES_COLLECTION
// (data HRP), BUKAN cuma asset_users (yang cuma berisi user yang punya akses
// AssetView). Nama field employee_profiles bervariasi antar sumber data,
// jadi setiap field dicoba dari beberapa kemungkinan nama. Kandidat/pelamar
// dan karyawan nonaktif dikecualikan; hasil dideduplikasi per uid (fallback
// email) supaya tidak ada nama dobel kalau datanya tumpang tindih.
export async function fetchActiveEmployeeOptions(): Promise<EmployeeOption[]> {
  const snap = await getDocs(collection(db, EMPLOYEE_PROFILES_COLLECTION));
  const seen = new Set<string>();
  const options: EmployeeOption[] = [];

  snap.docs.forEach((d) => {
    const data = d.data() as Record<string, unknown>;
    const e: Record<string, unknown> = { ...data, id: d.id };
    const role = String(e.role || e.userRole || "").toLowerCase();
    const status = String(e.status || e.employmentStatus || "").toLowerCase();
    if (isCandidateRecord(role) || isInactiveRecord(e, status)) return;

    const uid = (e.uid as string) || (e.userId as string) || (e.employeeUid as string) || (e.id as string);
    const name =
      (e.fullName as string) ||
      (e.employeeName as string) ||
      (e.name as string) ||
      (e.displayName as string) ||
      (e.email as string);
    if (!uid || !name) return;

    const dedupeKey = uid || (e.email as string) || "";
    if (dedupeKey && seen.has(dedupeKey)) return;
    if (dedupeKey) seen.add(dedupeKey);

    options.push({
      uid,
      name,
      email: (e.email as string) || (e.personalEmail as string) || null,
      divisionName:
        (e.divisionName as string) || (e.division as string) || (e.departmentName as string) || null,
      brandName: (e.brandName as string) || (e.companyName as string) || null,
      roleLabel:
        (e.jobTitle as string) ||
        (e.jabatan as string) ||
        (e.position as string) ||
        (e.role as string) ||
        "Karyawan",
    });
  });

  return options.sort((a, b) => a.name.localeCompare(b.name));
}
