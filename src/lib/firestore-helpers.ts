import {
  addDoc,
  collection,
  doc,
  getDocs,
  limit,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { db, EMPLOYEE_PROFILES_COLLECTION } from "@/lib/firebase";
import { getDescendantIds, resolveAreaPic } from "@/lib/locations";
import {
  AppRole,
  Asset,
  AssetIssueLogAction,
  AssetLocationNode,
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

export async function writeLocationPicLog(params: {
  locationId: string;
  locationName: string;
  action: "location_pic_assigned" | "location_pic_changed" | "location_pic_removed";
  oldPicUid?: string | null;
  oldPicName?: string | null;
  newPicUid?: string | null;
  newPicName?: string | null;
  createdByUid: string;
  createdByName: string;
}) {
  const payload = cleanFirestoreData(params) as Record<string, unknown>;
  await addDoc(collection(db, "asset_location_logs"), {
    ...payload,
    createdAt: serverTimestamp(),
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

// Section 3 — sebelumnya generateTicketNumber/generateQueueNumber MENGHITUNG
// seluruh collection asset_issue_tickets lewat range query tanpa filter
// kepemilikan — untuk staff biasa ini SELALU permission-denied (rules
// asset_issue_tickets membatasi baca ke tiket miliknya sendiri, dan
// Firestore menolak SELURUH query "list" kalau ada satu saja dokumen hasil
// yang gagal rules). Sekarang pakai SATU dokumen counter
// (asset_counters/asset_issue_tickets) yang dinaikkan via transaction —
// tidak perlu baca/list collection tiket sama sekali. Kalau transaction
// gagal (mis. rules asset_counters belum ditambahkan), tetap fallback ke
// nomor berbasis waktu supaya user tidak pernah stuck.
const TICKET_COUNTER_DOC_ID = "asset_issue_tickets";

// Format: TKT-[TAHUN]-[NOMOR_URUT] mis. TKT-2026-0001
export async function generateTicketNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `TKT-${year}-`;
  try {
    const counterRef = doc(db, "asset_counters", TICKET_COUNTER_DOC_ID);
    const sequence = await runTransaction(db, async (tx) => {
      const snap = await tx.get(counterRef);
      const data = snap.data();
      const nextSeq = data?.ticketYear === year ? (Number(data?.lastTicketNumber) || 0) + 1 : 1;
      tx.set(
        counterRef,
        { ticketYear: year, lastTicketNumber: nextSeq, updatedAt: serverTimestamp() },
        { merge: true }
      );
      return nextSeq;
    });
    return `${prefix}${String(sequence).padStart(4, "0")}`;
  } catch (error) {
    const err = error as { code?: string; message?: string; name?: string };
    console.warn("[generateTicketNumber] counter transaction gagal, memakai fallback nomor berbasis waktu", {
      collection: "asset_counters",
      documentId: TICKET_COUNTER_DOC_ID,
      errorCode: err?.code,
      errorMessage: err?.message,
      errorName: err?.name,
    });
    return `${prefix}${Date.now()}`;
  }
}

// Format: Q-[YYYYMMDD]-[NOMOR] mis. Q-20260707-001
export async function generateQueueNumber(): Promise<string> {
  const now = new Date();
  const datePart = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(
    now.getDate()
  ).padStart(2, "0")}`;
  const prefix = `Q-${datePart}-`;
  try {
    const counterRef = doc(db, "asset_counters", TICKET_COUNTER_DOC_ID);
    const sequence = await runTransaction(db, async (tx) => {
      const snap = await tx.get(counterRef);
      const data = snap.data();
      const nextSeq = data?.queueDateKey === datePart ? (Number(data?.lastQueueNumber) || 0) + 1 : 1;
      tx.set(
        counterRef,
        { queueDateKey: datePart, lastQueueNumber: nextSeq, updatedAt: serverTimestamp() },
        { merge: true }
      );
      return nextSeq;
    });
    return `${prefix}${String(sequence).padStart(3, "0")}`;
  } catch (error) {
    const err = error as { code?: string; message?: string; name?: string };
    console.warn("[generateQueueNumber] counter transaction gagal, memakai fallback nomor berbasis waktu", {
      collection: "asset_counters",
      documentId: TICKET_COUNTER_DOC_ID,
      errorCode: err?.code,
      errorMessage: err?.message,
      errorName: err?.name,
    });
    return `${prefix}${Date.now()}`;
  }
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

// Log lintas-sumber untuk Kanban Board Maintenance & Kendala (section O) —
// dipakai saat kartu dipindah drag-drop, mencakup work order MAUPUN ticket
// dalam satu collection supaya Timeline Global bisa baca satu tempat saja.
export async function writeMaintenanceActivityLog(params: {
  sourceType: "work_order" | "ticket";
  sourceId: string;
  workOrderId?: string | null;
  ticketId?: string | null;
  action: string;
  actionLabel: string;
  fromStatus?: string;
  toStatus?: string;
  fromColumn?: string;
  toColumn?: string;
  message: string;
  createdByUid: string;
  createdByName: string;
  locationName?: string;
  taskNumber?: string;
  title?: string;
}) {
  const payload = cleanFirestoreData(params) as Record<string, unknown>;
  await addDoc(collection(db, "asset_maintenance_activity_logs"), {
    ...payload,
    createdAt: serverTimestamp(),
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
// Skor kelengkapan data — dipakai saat dedupe untuk memilih record yang
// paling lengkap (nama lengkap/multi-kata, ada divisi, ada jabatan) kalau
// satu orang yang sama muncul dobel dari beberapa collection/dokumen.
function employeeCompletenessScore(o: EmployeeOption): number {
  let score = 0;
  if (o.name.trim().includes(" ")) score += 1;
  if (o.divisionName) score += 1;
  if (o.brandName) score += 1;
  if (o.roleLabel && o.roleLabel !== "Karyawan") score += 1;
  return score;
}

export async function fetchActiveEmployeeOptions(): Promise<EmployeeOption[]> {
  const snap = await getDocs(collection(db, EMPLOYEE_PROFILES_COLLECTION));
  // Dedupe per uid DAN per email (huruf kecil) — data bisa dobel dari
  // beberapa collection/dokumen dengan uid berbeda tapi email sama, atau
  // sebaliknya. Kalau ketemu duplikat, simpan yang datanya paling lengkap.
  const byUid = new Map<string, EmployeeOption>();
  const byEmail = new Map<string, EmployeeOption>();

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

    const email = ((e.email as string) || (e.personalEmail as string) || "").toLowerCase() || null;
    const option: EmployeeOption = {
      uid,
      name,
      email,
      divisionName:
        (e.divisionName as string) || (e.division as string) || (e.departmentName as string) || null,
      brandName: (e.brandName as string) || (e.companyName as string) || null,
      roleLabel:
        (e.jobTitle as string) ||
        (e.jabatan as string) ||
        (e.position as string) ||
        (e.role as string) ||
        "Karyawan",
    };

    const existing = byUid.get(uid) || (email ? byEmail.get(email) : undefined);
    if (existing && employeeCompletenessScore(existing) >= employeeCompletenessScore(option)) {
      return;
    }
    // Kalau duplikat ditemukan lewat email tapi uid-nya beda, buang entri
    // uid lama supaya orang yang sama tidak muncul dua kali di hasil akhir.
    if (existing && existing.uid !== uid) byUid.delete(existing.uid);
    byUid.set(uid, option);
    if (email) byEmail.set(email, option);
  });

  const options = Array.from(byUid.values());
  return options.sort((a, b) => a.name.localeCompare(b.name));
}

function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

// Section J — backfill PIC Lokasi ke asset yang SUDAH ADA saat PIC sebuah
// lokasi ditetapkan/diganti/dihapus di Master Lokasi. areaPicUid/areaPicName
// dkk pada dokumen asset SEBELUMNYA hanya dihitung sekali saat asset
// dibuat/diedit (lihat resolveAreaPic di assets/new & assets/[id]/edit) —
// tanpa backfill ini, asset yang sudah ada di suatu lokasi SEBELUM PIC-nya
// ditunjuk tidak akan pernah ikut ter-assign ke PIC baru itu, sehingga PIC
// Lokasi baru akan melihat daftar Assets kosong walau lokasinya sudah benar.
//
// `locations` yang dioper WAJIB sudah berisi perubahan PIC terbaru (patch
// manual di pemanggil) karena listener onSnapshot lokasi belum tentu selesai
// re-render saat fungsi ini dipanggil tepat setelah updateDoc PIC.
export async function backfillAreaPicForLocationSubtree({
  locations,
  locationId,
}: {
  locations: AssetLocationNode[];
  locationId: string;
}): Promise<number> {
  const affectedLocationIds = [locationId, ...getDescendantIds(locations, locationId)];
  const locationIdChunks = chunkArray(affectedLocationIds, 10);
  const scopeFields = ["buildingId", "floorId", "roomId", "areaId"] as const;

  const matchedDocs = new Map<string, { id: string; data: Asset }>();
  for (const field of scopeFields) {
    for (const idsChunk of locationIdChunks) {
      const snap = await getDocs(query(collection(db, "assets"), where(field, "in", idsChunk)));
      snap.docs.forEach((d) => matchedDocs.set(d.id, { id: d.id, data: d.data() as Asset }));
    }
  }

  let updatedCount = 0;
  for (const { id, data: asset } of matchedDocs.values()) {
    const areaPic = resolveAreaPic(locations, {
      buildingId: asset.buildingId,
      floorId: asset.floorId,
      roomId: asset.roomId,
      areaId: asset.areaId,
    });

    const nextAreaPicUid = areaPic?.uid || null;
    const nextAreaPicLocationId = areaPic?.locationId || null;
    if (
      (asset.areaPicUid || null) === nextAreaPicUid &&
      (asset.areaPicLocationId || null) === nextAreaPicLocationId
    ) {
      continue;
    }

    // Section F — locationPicUid/allowedLocationPicUids (dipakai
    // firestore.rules isLocationPicForAsset/isLocationPicAllowedAssetUpdate
    // untuk staff yang ditunjuk PIC di Master Lokasi, TANPA butuh role
    // "location_pic") dihitung ULANG dari resolveAreaPic setiap kali — bukan
    // arrayUnion/arrayRemove — supaya PIC lama otomatis kehilangan akses
    // begitu diganti/dihapus (tidak ada sisa uid basi di array).
    await updateDoc(doc(db, "assets", id), {
      areaPicUid: nextAreaPicUid,
      areaPicName: areaPic?.name || null,
      areaPicEmail: areaPic?.email || null,
      areaPicLocationId: nextAreaPicLocationId,
      areaPicLocationName: areaPic?.locationName || null,
      locationPicUid: nextAreaPicUid,
      locationPicName: areaPic?.name || null,
      locationPicEmail: areaPic?.email || null,
      allowedLocationPicUids: nextAreaPicUid ? [nextAreaPicUid] : [],
      updatedAt: serverTimestamp(),
    });
    updatedCount += 1;
  }

  return updatedCount;
}
