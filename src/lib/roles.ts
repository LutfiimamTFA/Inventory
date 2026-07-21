import { AppRole, AssetUser } from "@/lib/types";

export const ROLE_LABEL: Record<AppRole, string> = {
  super_admin: "Super Admin",
  asset_admin: "Asset Admin",
  asset_finance: "Asset Finance",
  location_pic: "PIC Lokasi",
  it_team: "Tim IT",
  staff: "Staff",
};

export const ROLE_BADGE_COLOR: Record<AppRole, string> = {
  super_admin: "bg-purple-50 text-purple-700 border-purple-200",
  asset_admin: "bg-blue-50 text-blue-700 border-blue-200",
  asset_finance: "bg-amber-50 text-amber-700 border-amber-200",
  location_pic: "bg-teal-50 text-teal-700 border-teal-200",
  it_team: "bg-emerald-50 text-emerald-700 border-emerald-200",
  staff: "bg-slate-100 text-slate-500 border-slate-200",
};

export const DEFAULT_ROUTE_BY_ROLE: Record<AppRole, string> = {
  super_admin: "/dashboard",
  asset_admin: "/dashboard",
  asset_finance: "/assets",
  location_pic: "/dashboard",
  it_team: "/maintenance",
  staff: "/scan",
};

export function getDefaultRouteForRole(role?: AppRole | null) {
  return role ? DEFAULT_ROUTE_BY_ROLE[role] : "/login";
}

export function getAssetRoleHelpers(currentAssetUser?: Pick<AssetUser, "role"> | null) {
  const isSuperAdminRole = currentAssetUser?.role === "super_admin";
  const isAssetAdminRole = currentAssetUser?.role === "asset_admin";
  const isAssetFinanceRole = currentAssetUser?.role === "asset_finance";
  const isLocationPicRole = currentAssetUser?.role === "location_pic";
  const isItTeamRole = currentAssetUser?.role === "it_team";
  const isStaffRole = currentAssetUser?.role === "staff";

  const canManageAssetSystem = isSuperAdminRole;
  const canManageSchedule = isAssetAdminRole;
  const canOperateMaintenance = isItTeamRole;
  const canReportIssue =
    isStaffRole || isItTeamRole || isAssetAdminRole || isSuperAdminRole;
  // Asset Finance adalah SATU-SATUNYA role (selain Super Admin) yang boleh
  // melihat/mengedit nominal harga, invoice, vendor, sumber dana, dll.
  // Asset Admin/QHSE, Staff, Tim IT TIDAK boleh melihat harga sama sekali —
  // tugas mereka murni data fisik aset (lihat spec "Perbaiki Create/Edit/
  // Detail Asset agar data Finance hanya tampil untuk role Asset Finance").
  const canViewAssetFinance = isSuperAdminRole || isAssetFinanceRole;
  const canEditAssetFinance = isSuperAdminRole || isAssetFinanceRole;

  return {
    isSuperAdminRole,
    isAssetAdminRole,
    isAssetFinanceRole,
    isLocationPicRole,
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
