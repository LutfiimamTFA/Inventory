import { AppRole, AssetUser } from "@/lib/types";

export const ROLE_LABEL: Record<AppRole, string> = {
  super_admin: "Super Admin",
  asset_admin: "Asset Admin",
  it_team: "Tim IT",
  staff: "Staff",
};

export const ROLE_BADGE_COLOR: Record<AppRole, string> = {
  super_admin: "bg-purple-50 text-purple-700 border-purple-200",
  asset_admin: "bg-blue-50 text-blue-700 border-blue-200",
  it_team: "bg-emerald-50 text-emerald-700 border-emerald-200",
  staff: "bg-slate-100 text-slate-500 border-slate-200",
};

export function getAssetRoleHelpers(currentAssetUser?: Pick<AssetUser, "role"> | null) {
  const isSuperAdminRole = currentAssetUser?.role === "super_admin";
  const isAssetAdminRole = currentAssetUser?.role === "asset_admin";
  const isItTeamRole = currentAssetUser?.role === "it_team";
  const isStaffRole = currentAssetUser?.role === "staff";

  const canManageAssetSystem = isSuperAdminRole;
  const canManageSchedule = isAssetAdminRole;
  const canOperateMaintenance = isItTeamRole;
  const canReportIssue =
    isStaffRole || isItTeamRole || isAssetAdminRole || isSuperAdminRole;

  return {
    isSuperAdminRole,
    isAssetAdminRole,
    isItTeamRole,
    isStaffRole,
    canManageAssetSystem,
    canManageSchedule,
    canOperateMaintenance,
    canReportIssue,
  };
}

export function getAssignedMaintenanceRole(role?: AppRole | null): "it_team" | "super_admin" {
  return role === "super_admin" ? "super_admin" : "it_team";
}
