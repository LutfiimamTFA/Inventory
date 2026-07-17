import { AppRole, AssetUser } from "@/lib/types";

export const ROLE_LABEL: Record<AppRole, string> = {
  super_admin: "Super Admin",
  asset_admin: "Asset Admin",
  asset_finance: "Asset Finance",
  it_team: "Tim IT",
  staff: "Staff",
};

export const ROLE_BADGE_COLOR: Record<AppRole, string> = {
  super_admin: "bg-purple-50 text-purple-700 border-purple-200",
  asset_admin: "bg-blue-50 text-blue-700 border-blue-200",
  asset_finance: "bg-amber-50 text-amber-700 border-amber-200",
  it_team: "bg-emerald-50 text-emerald-700 border-emerald-200",
  staff: "bg-slate-100 text-slate-500 border-slate-200",
};

export function getAssetRoleHelpers(currentAssetUser?: Pick<AssetUser, "role"> | null) {
  const isSuperAdminRole = currentAssetUser?.role === "super_admin";
  const isAssetAdminRole = currentAssetUser?.role === "asset_admin";
  const isAssetFinanceRole = currentAssetUser?.role === "asset_finance";
  const isItTeamRole = currentAssetUser?.role === "it_team";
  const isStaffRole = currentAssetUser?.role === "staff";

  const canManageAssetSystem = isSuperAdminRole;
  const canManageSchedule = isAssetAdminRole;
  const canOperateMaintenance = isItTeamRole;
  const canReportIssue =
    isStaffRole || isItTeamRole || isAssetAdminRole || isSuperAdminRole;
  // Section A/G — Asset Finance cuma boleh kelola data finance (harga,
  // invoice, vendor, sumber dana, dll), TIDAK boleh sentuh lokasi/custodian/
  // pemakaian/maintenance. Asset Admin/QHSE boleh lihat data finance
  // read-only supaya tidak wajib tahu harga tapi tetap bisa cek kalau perlu.
  const canViewAssetFinance = isSuperAdminRole || isAssetFinanceRole || isAssetAdminRole;
  const canEditAssetFinance = isSuperAdminRole || isAssetFinanceRole;

  return {
    isSuperAdminRole,
    isAssetAdminRole,
    isAssetFinanceRole,
    isItTeamRole,
    isStaffRole,
    canManageAssetSystem,
    canManageSchedule,
    canOperateMaintenance,
    canReportIssue,
    canViewAssetFinance,
    canEditAssetFinance,
  };
}

export function getAssignedMaintenanceRole(role?: AppRole | null): "it_team" | "super_admin" {
  return role === "super_admin" ? "super_admin" : "it_team";
}
