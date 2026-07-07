export type AppRole = "super_admin" | "asset_admin" | "staff";

export type AssetStatus =
  | "available"
  | "borrowed"
  | "in_use"
  | "maintenance"
  | "broken"
  | "incomplete"
  | "lost"
  | "inactive"
  | "disposed";

export type AssetCondition =
  | "new"
  | "good"
  | "fair"
  | "minor_damage"
  | "heavy_damage";

export type OwnershipStatus =
  | "Aset Perusahaan"
  | "Barang Sewa"
  | "Barang Titipan"
  | "Barang Pinjaman Vendor"
  | "Barang Pribadi Karyawan"
  | "Lainnya";

export type FundingSource =
  | "Kas Perusahaan"
  | "Reimbursement"
  | "Dana Proyek"
  | "Hibah"
  | "Sponsor"
  | "Pembelian Pribadi Dialihkan ke Kantor"
  | "Lainnya";

export interface Asset {
  id: string;
  assetName: string;
  assetCode: string;
  categoryId: string;
  categoryName: string;
  subCategory?: string;
  brand?: string;
  model?: string;
  serialNumber?: string;
  imei?: string;
  description?: string;
  photoUrl?: string;
  photoThumbnailUrl?: string;
  photoFileName?: string;
  photoDriveFileId?: string;
  photoMimeType?: string;
  photoSize?: number;
  photoUploadedAt?: unknown;

  companyOwnerId?: string;
  companyOwnerName?: string;
  divisionOwnerId?: string;
  divisionOwnerName?: string;
  location?: string;
  responsiblePersonUid?: string;
  responsiblePersonName?: string;
  responsiblePersonEmail?: string;
  responsiblePersonDivision?: string;
  responsiblePersonJobTitle?: string;
  ownershipStatus: OwnershipStatus;

  purchaseDate?: string;
  purchasePrice?: number;
  vendorName?: string;
  invoiceNumber?: string;
  invoiceFileUrl?: string;
  invoiceFileName?: string;
  invoiceDriveFileId?: string;
  invoiceMimeType?: string;
  invoiceSize?: number;
  invoiceUploadedAt?: unknown;
  fundingSource?: FundingSource;
  purchaseMethod?: string;
  estimatedUsefulLife?: string;
  financeNotes?: string;

  assetStatus: AssetStatus;
  condition: AssetCondition;
  isBorrowable: boolean;
  requiresApproval: boolean;
  accessories?: string;
  operationalNotes?: string;
  qrCodeValue: string;

  currentBorrowingId?: string | null;
  currentBorrowerUid?: string | null;
  currentBorrowerName?: string | null;

  createdByUid: string;
  createdByName: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export interface AssetCategory {
  id: string;
  categoryName: string;
  categoryCode: string;
  description?: string;
  status: "active" | "inactive";
  createdByUid: string;
  createdByName: string;
  createdAt: unknown;
  updatedAt: unknown;
}

export type BorrowingStatus = "borrowed" | "returned" | "overdue";

export interface AssetBorrowing {
  id: string;
  assetId: string;
  assetName: string;
  assetCode: string;
  borrowedByUid: string;
  borrowedByName: string;
  borrowedByEmail: string;
  borrowedAt: unknown;
  estimatedReturnAt?: string;
  returnedAt?: unknown;
  status: BorrowingStatus;
  borrowNotes?: string;
  returnCondition?: AssetCondition;
  returnNotes?: string;
}

export interface AssetLog {
  id: string;
  assetId: string;
  assetName: string;
  assetCode: string;
  action: string;
  userUid: string;
  userName: string;
  timestamp: unknown;
  detail?: string;
}

export interface AssetUser {
  uid: string;
  name: string;
  email: string;
  role: AppRole;
  status: "active" | "inactive";
  createdByUid?: string;
  createdByName?: string;
  createdAt?: unknown;
  updatedAt?: unknown;
  lastLoginAt?: unknown;
}

export type AssetUserLogAction = "change_role" | "enable_user" | "disable_user" | "create_user";

export interface AssetUserLog {
  id: string;
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
  timestamp: unknown;
  detail?: string;
}

export interface HrpBrand {
  id: string;
  name: string;
  status?: string;
}

export interface DriveUploadResult {
  url: string;
  thumbnailUrl: string;
  fileId: string;
  fileName: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
}

export interface HrpDivision {
  id: string;
  name: string;
}

export interface EmployeeProfile {
  uid: string;
  name: string;
  email: string;
  status: "active" | "inactive";
  divisionId?: string;
  divisionName?: string;
  companyId?: string;
  companyName?: string;
  [key: string]: unknown;
}
