"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  collection,
  doc,
  onSnapshot,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { Search, ShieldCheck, ShieldOff, Power, Users, RefreshCw, MoreVertical } from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { AppRole, AssetUser } from "@/lib/types";
import { ROLE_BADGE_COLOR, ROLE_LABEL } from "@/lib/roles";
import { writeAssetUserLog } from "@/lib/firestore-helpers";
import { fetchAllActiveHrpEmployees, HrpEmployeeInfo } from "@/lib/hrp";
import { formatDate } from "@/lib/utils";
import ProtectedLayout from "@/components/ProtectedLayout";
import PageHeader from "@/components/PageHeader";
import Badge from "@/components/Badge";
import EmptyState from "@/components/EmptyState";
import ConfirmModal from "@/components/ConfirmModal";
import { Toast, ToastState } from "@/components/Toast";

// Baris gabungan: satu karyawan HRP aktif + status role AssetView-nya
// (atau akun bootstrap Super Admin eksternal yang tidak terdaftar di HRP).
interface AccessRow {
  uid: string;
  name: string;
  email: string;
  divisionName: string;
  jabatan: string;
  role: AppRole;
  effectiveStatus: "active" | "inactive";
  isDefaultStaff: boolean; // true kalau belum ada dokumen asset_users
  lastLoginAt?: unknown;
}

const ASSIGNABLE_ROLES: AppRole[] = ["staff", "asset_admin", "asset_finance", "location_pic", "it_team"];

type PendingAction =
  | { type: "role"; target: AccessRow; newRole: AppRole }
  | { type: "status"; target: AccessRow; newStatus: "active" | "inactive" };

export default function AccessPage() {
  const { firebaseUser, assetUser: currentUser, role, loading } = useAuth();
  const authReady = !loading && !!firebaseUser && !!currentUser && !!role;
  const [hrpEmployees, setHrpEmployees] = useState<HrpEmployeeInfo[]>([]);
  const [assetUsers, setAssetUsers] = useState<Record<string, AssetUser>>({});
  const [loadingHrp, setLoadingHrp] = useState(true);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<AppRole | "">("");
  const [statusFilter, setStatusFilter] = useState<"active" | "inactive" | "">("");
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [processing, setProcessing] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

  const isSyncingRef = useRef(false);

  const syncEmployeesFromHRP = useCallback(async () => {
    if (isSyncingRef.current) {
      console.debug("[User Access] sync skipped because already running");
      return;
    }
    isSyncingRef.current = true;
    console.debug("[User Access] sync started");
    try {
      const result = await fetchAllActiveHrpEmployees();
      console.debug("[User Access] HRP employees loaded:", result.employees.length);
      console.debug("[User Access] excluded candidates:", result.excludedCandidates);
      setHrpEmployees(result.employees);
      console.debug("[User Access] sync completed");
    } finally {
      setLoadingHrp(false);
      isSyncingRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (!authReady || role !== "super_admin") return;
    syncEmployeesFromHRP();
  }, [authReady, role, syncEmployeesFromHRP]);

  const handleRefresh = () => {
    if (!authReady || role !== "super_admin") return;
    if (isSyncingRef.current) {
      console.debug("[User Access] sync skipped because already running");
      return;
    }
    setLoadingHrp(true);
    syncEmployeesFromHRP();
  };

  useEffect(() => {
    if (!authReady || role !== "super_admin") return;
    const unsub = onSnapshot(
      collection(db, "asset_users"),
      (snap) => {
        const map: Record<string, AssetUser> = {};
        snap.docs.forEach((d) => {
          map[d.id] = { uid: d.id, ...d.data() } as AssetUser;
        });
        console.log("[UserAccessPage Listener] asset_users success:", snap.size);
        setAssetUsers(map);
      },
      (error) => {
        console.error("[UserAccessPage Listener] asset_users error:", error);
      }
    );
    return () => unsub();
  }, [authReady, role]);

  if (role !== "super_admin") {
    return (
      <ProtectedLayout>
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm">
          <EmptyState
            icon={ShieldOff}
            title="Akses terbatas"
            description="Halaman ini hanya dapat diakses oleh Super Admin."
          />
        </div>
      </ProtectedLayout>
    );
  }

  // Gabungkan karyawan HRP dengan asset_users: cocokkan uid dulu, kalau tidak
  // ketemu coba fallback email (lowercase) — beberapa dokumen asset_users
  // (mis. hasil bootstrap) bisa punya uid berbeda dari collection HRP.
  const assetUsersByUid = assetUsers;
  const assetUsersByEmail: Record<string, AssetUser> = {};
  Object.values(assetUsers).forEach((au) => {
    const email = au.email?.toLowerCase();
    if (email) assetUsersByEmail[email] = au;
  });

  const rowsMap = new Map<string, AccessRow>();
  const matchedAssetUserUids = new Set<string>();

  hrpEmployees.forEach((emp) => {
    const au =
      assetUsersByUid[emp.uid] ||
      (emp.email ? assetUsersByEmail[emp.email.toLowerCase()] : undefined);
    if (au) matchedAssetUserUids.add(au.uid);
    rowsMap.set(emp.uid, {
      uid: emp.uid,
      name: emp.name,
      email: emp.email,
      divisionName: emp.divisionName,
      jabatan: emp.jabatan,
      role: au?.role || "staff",
      effectiveStatus: au?.status || "active",
      isDefaultStaff: !au,
      lastLoginAt: au?.lastLoginAt,
    });
  });

  // Akun asset_users yang tidak match karyawan HRP manapun (mis. bootstrap
  // Super Admin eksternal) tetap ditampilkan agar tetap bisa dikelola.
  Object.values(assetUsers).forEach((au) => {
    if (matchedAssetUserUids.has(au.uid) || rowsMap.has(au.uid)) return;
    rowsMap.set(au.uid, {
      uid: au.uid,
      name: au.name,
      email: au.email,
      divisionName: "-",
      jabatan: "-",
      role: au.role,
      effectiveStatus: au.status,
      isDefaultStaff: false,
      lastLoginAt: au.lastLoginAt,
    });
  });

  const rows = Array.from(rowsMap.values());

  const counters = {
    total: rows.length,
    superAdmin: rows.filter((r) => r.role === "super_admin").length,
    assetAdmin: rows.filter((r) => r.role === "asset_admin").length,
    assetFinance: rows.filter((r) => r.role === "asset_finance").length,
    locationPic: rows.filter((r) => r.role === "location_pic").length,
    itTeam: rows.filter((r) => r.role === "it_team").length,
    staff: rows.filter((r) => r.role === "staff").length,
    inactive: rows.filter((r) => !r.isDefaultStaff && r.effectiveStatus === "inactive").length,
  };

  const filtered = rows.filter((r) => {
    if (search) {
      const q = search.toLowerCase();
      if (!r.name?.toLowerCase().includes(q) && !r.email?.toLowerCase().includes(q)) {
        return false;
      }
    }
    if (roleFilter && r.role !== roleFilter) return false;
    if (statusFilter && r.effectiveStatus !== statusFilter) return false;
    return true;
  });

  const upsertAssetUser = async (
    row: AccessRow,
    changes: { role?: AppRole; status?: "active" | "inactive" }
  ) => {
    if (!currentUser) return;
    const ref = doc(db, "asset_users", row.uid);
    const existing = assetUsers[row.uid];
    const now = serverTimestamp();

    if (existing) {
      await updateDoc(ref, { ...changes, updatedAt: now });
    } else {
      await setDoc(ref, {
        uid: row.uid,
        name: row.name,
        email: row.email,
        role: changes.role || "staff",
        status: changes.status || "active",
        createdByUid: currentUser.uid,
        createdByName: currentUser.name,
        createdAt: now,
        updatedAt: now,
      });
    }
  };

  const handleConfirm = async () => {
    if (!pending || !currentUser) return;
    setProcessing(true);
    try {
      if (pending.type === "role") {
        await upsertAssetUser(pending.target, { role: pending.newRole, status: "active" });
        await writeAssetUserLog({
          targetUid: pending.target.uid,
          targetName: pending.target.name,
          targetEmail: pending.target.email,
          oldRole: pending.target.role,
          newRole: pending.newRole,
          action: "change_role",
          performedByUid: currentUser.uid,
          performedByName: currentUser.name,
          detail: `Role diubah dari ${ROLE_LABEL[pending.target.role]} menjadi ${ROLE_LABEL[pending.newRole]}`,
        });
        setToast({
          type: "success",
          message: `User berhasil dijadikan ${ROLE_LABEL[pending.newRole]}.`,
        });
      } else {
        await upsertAssetUser(pending.target, {
          role: pending.target.role,
          status: pending.newStatus,
        });
        await writeAssetUserLog({
          targetUid: pending.target.uid,
          targetName: pending.target.name,
          targetEmail: pending.target.email,
          oldStatus: pending.target.effectiveStatus,
          newStatus: pending.newStatus,
          action: pending.newStatus === "active" ? "enable_user" : "disable_user",
          performedByUid: currentUser.uid,
          performedByName: currentUser.name,
          detail:
            pending.newStatus === "active"
              ? "Akun diaktifkan"
              : "Akun dinonaktifkan",
        });
        setToast({
          type: "success",
          message:
            pending.newStatus === "active"
              ? "User berhasil diaktifkan."
              : "User berhasil dinonaktifkan.",
        });
      }
      setPending(null);
    } catch {
      setToast({ type: "error", message: "Gagal memproses perubahan. Coba lagi." });
    } finally {
      setProcessing(false);
    }
  };

  return (
    <ProtectedLayout>
      <PageHeader
        title="User Access"
        subtitle="Kelola akses Super Admin, Asset Admin/QHSE, Tim IT, dan Staff di QHSE Care."
        actions={
          <button
            type="button"
            onClick={handleRefresh}
            disabled={loadingHrp}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-teal-500 text-white px-4 py-2.5 text-sm font-medium shadow-md shadow-blue-900/20 cursor-pointer hover:brightness-105 active:brightness-95 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:brightness-100"
          >
            <RefreshCw size={16} className={loadingHrp ? "animate-spin" : ""} />
            {loadingHrp ? "Menyinkronkan..." : "Sinkron Karyawan HRP"}
          </button>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3 mb-5">
        <CounterCard label="Total Karyawan Aktif" value={counters.total} />
        <CounterCard label="Super Admin" value={counters.superAdmin} tone="purple" />
        <CounterCard label="Asset Admin" value={counters.assetAdmin} tone="blue" />
        <CounterCard label="Asset Finance" value={counters.assetFinance} tone="amber" />
        <CounterCard label="PIC Lokasi" value={counters.locationPic} tone="emerald" />
        <CounterCard label="Tim IT" value={counters.itTeam} tone="emerald" />
        <CounterCard label="Staff" value={counters.staff} tone="slate" />
        <CounterCard label="Inactive" value={counters.inactive} tone="red" />
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 mb-5 grid gap-3 md:grid-cols-3">
        <div className="relative md:col-span-1">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari nama atau email..."
            className="input pl-9 cursor-text"
          />
        </div>
        <select
          value={roleFilter}
          onChange={(e) => setRoleFilter(e.target.value as AppRole | "")}
          className="input cursor-pointer"
        >
          <option value="">Semua Role</option>
          <option value="super_admin">Super Admin</option>
          <option value="asset_admin">Asset Admin</option>
          <option value="asset_finance">Asset Finance</option>
          <option value="location_pic">PIC Lokasi</option>
          <option value="it_team">Tim IT</option>
          <option value="staff">Staff</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as "active" | "inactive" | "")}
          className="input cursor-pointer"
        >
          <option value="">Semua Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {filtered.length === 0 ? (
          <EmptyState
            icon={Users}
            title={rows.length === 0 ? "Belum ada karyawan HRP ditemukan" : "Tidak ditemukan"}
            description={
              rows.length === 0
                ? "Klik Sinkron Karyawan HRP untuk memuat data karyawan aktif."
                : "Coba kata kunci atau filter lain."
            }
            action={
              rows.length === 0 && (
                <button
                  type="button"
                  onClick={handleRefresh}
                  disabled={loadingHrp}
                  className="inline-flex items-center gap-2 rounded-xl bg-slate-900 text-white px-4 py-2 text-sm font-medium cursor-pointer hover:bg-slate-800 active:bg-slate-950 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <RefreshCw size={16} className={loadingHrp ? "animate-spin" : ""} />
                  {loadingHrp ? "Menyinkronkan..." : "Sinkron Karyawan HRP"}
                </button>
              )
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-200 bg-slate-50/60">
                  <th className="px-4 py-3 font-semibold">Nama</th>
                  <th className="px-4 py-3 font-semibold">Email</th>
                  <th className="px-4 py-3 font-semibold">Divisi</th>
                  <th className="px-4 py-3 font-semibold">Jabatan</th>
                  <th className="px-4 py-3 font-semibold">Role QHSE Care</th>
                  <th className="px-4 py-3 font-semibold">Status QHSE Care</th>
                  <th className="px-4 py-3 font-semibold">Last Login</th>
                  <th className="px-4 py-3 font-semibold text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const isSelf = r.uid === currentUser?.uid;
                  const isSelfSuperAdmin = isSelf && r.role === "super_admin";
                  // Section C — dropdown "Aksi": tampilkan semua role yang
                  // bisa ditugaskan KECUALI role user saat ini. Super Admin
                  // tidak pernah muncul di sini (tidak boleh downgrade lewat
                  // UI ini) dan baris Super Admin sendiri tidak punya aksi
                  // ganti role sama sekali.
                  const roleActions: AppRole[] =
                    r.role === "super_admin"
                      ? []
                      : ASSIGNABLE_ROLES.filter((x) => x !== r.role);
                  const canToggleStatus = !isSelfSuperAdmin && !isSelf;
                  const statusLabel = r.isDefaultStaff
                    ? "Default Staff"
                    : r.effectiveStatus === "active"
                    ? "Active"
                    : "Inactive";
                  const statusColor = r.isDefaultStaff
                    ? "bg-blue-50 text-blue-600 border-blue-200"
                    : r.effectiveStatus === "active"
                    ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                    : "bg-slate-100 text-slate-500 border-slate-200";
                  return (
                    <tr
                      key={r.uid}
                      className="border-b border-slate-100 last:border-0 hover:bg-slate-50/70"
                    >
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="h-9 w-9 rounded-full bg-gradient-to-br from-slate-600 to-slate-800 flex items-center justify-center text-xs font-semibold text-white shrink-0">
                            {r.name?.[0]?.toUpperCase() || "?"}
                          </div>
                          <div>
                            <p className="font-medium text-slate-800">
                              {r.name}
                              {isSelf && (
                                <span className="text-xs text-slate-400 font-normal"> (Anda)</span>
                              )}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-500">{r.email || "-"}</td>
                      <td className="px-4 py-3 text-slate-500">{r.divisionName || "-"}</td>
                      <td className="px-4 py-3 text-slate-500">{r.jabatan || "-"}</td>
                      <td className="px-4 py-3">
                        <Badge label={ROLE_LABEL[r.role]} colorClass={ROLE_BADGE_COLOR[r.role]} />
                      </td>
                      <td className="px-4 py-3">
                        <Badge label={statusLabel} colorClass={statusColor} />
                      </td>
                      <td className="px-4 py-3 text-slate-500">
                        {r.lastLoginAt ? formatDate(r.lastLoginAt) : "-"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <RowActionsMenu
                          roleActions={roleActions}
                          canToggleStatus={canToggleStatus}
                          isActive={r.effectiveStatus === "active"}
                          onPickRole={(newRole) => setPending({ type: "role", target: r, newRole })}
                          onToggleStatus={() =>
                            setPending({
                              type: "status",
                              target: r,
                              newStatus: r.effectiveStatus === "active" ? "inactive" : "active",
                            })
                          }
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmModal
        open={!!pending}
        title={
          pending?.type === "role"
            ? `Jadikan ${ROLE_LABEL[pending.newRole]}`
            : pending?.newStatus === "active"
            ? "Aktifkan Akun"
            : "Nonaktifkan Akun"
        }
        description={
          pending?.type === "role"
            ? `${pending.target.name} akan diubah rolenya menjadi ${ROLE_LABEL[pending.newRole]}.`
            : `${pending?.target.name} akan ${
                pending?.newStatus === "active" ? "diaktifkan" : "dinonaktifkan"
              } aksesnya di QHSE Care.`
        }
        confirmLabel={processing ? "Memproses..." : "Konfirmasi"}
        danger={pending?.type === "status" && pending.newStatus === "inactive"}
        onConfirm={handleConfirm}
        onCancel={() => setPending(null)}
      />

      <Toast toast={toast} onClose={() => setToast(null)} />
    </ProtectedLayout>
  );
}

// Section C — dropdown "Aksi" per baris, menggantikan tombol memanjang.
// Ditutup lewat backdrop transparan (fixed inset-0) daripada listener
// document supaya tidak perlu effect/cleanup tambahan per baris.
function RowActionsMenu({
  roleActions,
  canToggleStatus,
  isActive,
  onPickRole,
  onToggleStatus,
}: {
  roleActions: AppRole[];
  canToggleStatus: boolean;
  isActive: boolean;
  onPickRole: (role: AppRole) => void;
  onToggleStatus: () => void;
}) {
  const [open, setOpen] = useState(false);

  if (roleActions.length === 0 && !canToggleStatus) {
    return <span className="text-xs text-slate-400">-</span>;
  }

  return (
    <div className="relative inline-block text-left">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 cursor-pointer hover:bg-slate-50"
      >
        Aksi
        <MoreVertical size={14} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 mt-2 w-52 rounded-xl border border-slate-200 bg-white shadow-lg z-20 py-1.5">
            {roleActions.map((newRole) => (
              <button
                key={newRole}
                type="button"
                onClick={() => {
                  onPickRole(newRole);
                  setOpen(false);
                }}
                className="flex h-9 w-full items-center gap-2 px-3 text-sm font-medium text-slate-600 cursor-pointer hover:bg-slate-50"
              >
                <ShieldCheck size={14} />
                Jadikan {ROLE_LABEL[newRole]}
              </button>
            ))}
            {canToggleStatus && (
              <button
                type="button"
                onClick={() => {
                  onToggleStatus();
                  setOpen(false);
                }}
                className={`flex h-9 w-full items-center gap-2 px-3 text-sm font-medium cursor-pointer hover:bg-red-50 ${
                  isActive ? "text-red-600" : "text-emerald-600"
                }`}
              >
                <Power size={14} />
                {isActive ? "Nonaktifkan" : "Aktifkan"}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function CounterCard({
  label,
  value,
  tone = "slate",
}: {
  label: string;
  value: number;
  tone?: "slate" | "blue" | "emerald" | "purple" | "red" | "amber";
}) {
  const toneClass = {
    slate: "text-slate-800",
    blue: "text-blue-600",
    emerald: "text-emerald-600",
    purple: "text-purple-600",
    red: "text-red-600",
    amber: "text-amber-600",
  }[tone];

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4">
      <p className="text-xs text-slate-400 mb-1">{label}</p>
      <p className={`text-2xl font-semibold ${toneClass}`}>{value}</p>
    </div>
  );
}
