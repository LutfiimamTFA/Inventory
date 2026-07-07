import { collection, doc, getDoc, getDocs, query, where } from "firebase/firestore";
import { db, EMPLOYEE_PROFILES_COLLECTION } from "@/lib/firebase";
import { HrpBrand, HrpDivision } from "@/lib/types";

export interface HrpEmployeeInfo {
  uid: string;
  name: string;
  email: string;
  divisionName: string;
  jabatan: string;
  jobTitle: string;
  brandName: string;
  raw: Record<string, unknown>;
}

function getPath(obj: Record<string, unknown>, path: string): string | undefined {
  const value = path
    .split(".")
    .reduce<unknown>(
      (acc, key) =>
        acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined,
      obj
    );
  return typeof value === "string" && value.trim() ? value : undefined;
}

function firstOf(obj: Record<string, unknown>, paths: string[]): string {
  for (const p of paths) {
    const v = getPath(obj, p);
    if (v) return v;
  }
  return "";
}

// Urutan collection karyawan HRP yang dicoba (prioritas sesuai skema HRP):
// 1. employee_profiles (atau override via NEXT_PUBLIC_EMPLOYEE_PROFILES_COLLECTION)
// 2. employees
// 3. users (fallback terakhir)
export const HRP_EMPLOYEE_COLLECTIONS = Array.from(
  new Set([EMPLOYEE_PROFILES_COLLECTION, "employee_profiles", "employees", "users"])
);

const CANDIDATE_WORDS = ["candidate", "kandidat", "pelamar", "applicant"];

export function isActiveEmployeeData(data: Record<string, unknown>): boolean {
  if (data.resign === true) return false;
  if (data.inactive === true) return false;
  if (data.disabled === true) return false;

  const status = String(data.status ?? "").toLowerCase();
  const accountStatus = String(data.accountStatus ?? "").toLowerCase();
  const employmentStatus = String(data.employmentStatus ?? "").toLowerCase();

  if (["resign", "inactive", "terminated"].includes(employmentStatus)) return false;

  if (data.isActive === true || data.active === true) return true;
  if (["active", "aktif"].includes(status)) return true;
  if (["active", "aktif"].includes(accountStatus)) return true;

  // Tidak ada field status sama sekali -> anggap aktif secara default
  // (banyak skema HRP tidak menyimpan status eksplisit untuk karyawan aktif).
  if (
    data.status === undefined &&
    data.accountStatus === undefined &&
    data.employmentStatus === undefined &&
    data.isActive === undefined &&
    data.active === undefined
  ) {
    return true;
  }

  return false;
}

// Kandidat/pelamar recruitment tidak boleh muncul sebagai user AssetView.
export function isCandidateData(data: Record<string, unknown>): boolean {
  const role = String(data.role ?? "").toLowerCase();
  const userType = String(data.userType ?? "").toLowerCase();
  const status = String(data.status ?? "").toLowerCase();

  if (CANDIDATE_WORDS.includes(role)) return true;
  if (CANDIDATE_WORDS.includes(userType)) return true;
  if (CANDIDATE_WORDS.includes(status)) return true;

  const name = String(
    data.name ?? data.fullName ?? data.employeeName ?? ""
  ).toLowerCase();
  const email = String(data.email ?? "").toLowerCase();
  if (CANDIDATE_WORDS.some((w) => name.includes(w) || email.includes(w))) {
    return true;
  }

  return false;
}

function extractEmployeeInfo(uid: string, data: Record<string, unknown>): HrpEmployeeInfo {
  const name = firstOf(data, [
    "fullName",
    "name",
    "displayName",
    "employeeName",
    "dataDiriIdentitas.fullName",
    "dataDiriIdentitas.namaLengkap",
  ]);
  const jobTitle = firstOf(data, [
    "jobTitle",
    "position",
    "jabatan",
    "structuralPosition",
    "hrdEmploymentInfo.jabatan",
    "title",
  ]);
  const divisionName = firstOf(data, [
    "divisionName",
    "divisi",
    "departmentName",
    "division",
    "department",
    "hrdEmploymentInfo.divisi",
  ]);
  const brandName = firstOf(data, ["brandName", "companyName", "brand"]);
  const email = firstOf(data, ["email"]);

  return {
    uid,
    name: name || email,
    email,
    divisionName,
    jabatan: jobTitle,
    jobTitle,
    brandName,
    raw: data,
  };
}

function isEligibleHrpEmployee(uid: string, data: Record<string, unknown>): boolean {
  if (!uid) return false;
  if (!isActiveEmployeeData(data)) return false;
  if (isCandidateData(data)) return false;

  const name = firstOf(data, ["fullName", "name", "employeeName"]);
  const email = firstOf(data, ["email"]);
  if (!name && !email) return false;

  return true;
}

// Cari satu karyawan HRP aktif berdasarkan uid, coba tiap collection kandidat.
export async function findActiveHrpEmployeeByUid(
  uid: string
): Promise<HrpEmployeeInfo | null> {
  for (const col of HRP_EMPLOYEE_COLLECTIONS) {
    try {
      const snap = await getDoc(doc(db, col, uid));
      if (snap.exists()) {
        const data = snap.data();
        if (isEligibleHrpEmployee(uid, data)) {
          return extractEmployeeInfo(uid, data);
        }
        return null;
      }
    } catch {
      // lanjut coba collection berikutnya
    }
  }
  return null;
}

export interface HrpEmployeeFetchResult {
  employees: HrpEmployeeInfo[];
  excludedCandidates: number;
  sourceCollection: string | null;
}

// Ambil semua karyawan aktif HRP (tanpa kandidat/pelamar) untuk halaman User
// Access. Memakai collection kandidat pertama yang berhasil dibaca dan
// menghasilkan minimal satu karyawan aktif yang valid.
export async function fetchAllActiveHrpEmployees(): Promise<HrpEmployeeFetchResult> {
  for (const col of HRP_EMPLOYEE_COLLECTIONS) {
    try {
      const snap = await getDocs(collection(db, col));
      if (snap.empty) continue;

      let excludedCandidates = 0;
      const active = snap.docs
        .filter((d) => {
          const data = d.data();
          if (!isActiveEmployeeData(data)) return false;
          if (isCandidateData(data)) {
            excludedCandidates += 1;
            return false;
          }
          return true;
        })
        .map((d) => extractEmployeeInfo(d.id, d.data()))
        .filter((emp) => emp.uid && (emp.name || emp.email));

      console.debug(
        `[User Access] source collection "${col}": ${snap.size} docs, ${active.length} eligible, ${excludedCandidates} excluded as candidate`
      );

      if (active.length > 0) {
        return { employees: active, excludedCandidates, sourceCollection: col };
      }
    } catch {
      // lanjut coba collection berikutnya
    }
  }
  return { employees: [], excludedCandidates: 0, sourceCollection: null };
}

// Perusahaan/Brand pemilik aset, diambil dari master data HRP.
export const HRP_BRAND_COLLECTIONS = ["brands", "ecosystem_companies"];

export async function fetchHrpBrands(): Promise<HrpBrand[]> {
  for (const col of HRP_BRAND_COLLECTIONS) {
    try {
      const snap = await getDocs(collection(db, col));
      if (snap.empty) continue;
      return snap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          name:
            (data.name as string) ||
            (data.brandName as string) ||
            (data.companyName as string) ||
            d.id,
          status: (data.status as string) || undefined,
        };
      });
    } catch {
      // lanjut coba collection berikutnya
    }
  }
  return [];
}

// Divisi tergantung brand yang dipilih: coba subcollection brands/{brandId}/divisions,
// fallback ke collection top-level "divisions" yang difilter brandId.
export async function fetchHrpDivisions(brandId: string): Promise<HrpDivision[]> {
  if (!brandId) return [];
  try {
    const subSnap = await getDocs(collection(db, "brands", brandId, "divisions"));
    if (!subSnap.empty) {
      return subSnap.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id,
          name: (data.name as string) || (data.divisionName as string) || d.id,
        };
      });
    }
  } catch {
    // lanjut coba fallback top-level
  }

  try {
    const q = query(collection(db, "divisions"), where("brandId", "==", brandId));
    const snap = await getDocs(q);
    return snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        name: (data.name as string) || (data.divisionName as string) || d.id,
      };
    });
  } catch {
    return [];
  }
}
