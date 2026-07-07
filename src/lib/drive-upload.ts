import { DriveUploadResult } from "@/lib/types";

export type DriveUploadType = "asset_photo" | "invoice";

const FOLDER_BY_TYPE: Record<DriveUploadType, string> = {
  asset_photo: "assetview/assets",
  invoice: "assetview/invoices",
};

export function uploadToDrive(
  file: File,
  type: DriveUploadType,
  meta?: { assetCode?: string; assetName?: string },
  onProgress?: (percent: number) => void
): Promise<DriveUploadResult> {
  return new Promise((resolve, reject) => {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("folder", FOLDER_BY_TYPE[type]);
    formData.append("type", type);
    formData.append("assetCode", meta?.assetCode || "");
    formData.append("assetName", meta?.assetName || "");

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/upload-drive");

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };

    xhr.onload = () => {
      let json: { success?: boolean; message?: string; error?: string } & Partial<DriveUploadResult>;
      try {
        json = JSON.parse(xhr.responseText);
      } catch {
        reject(new Error("Respons upload tidak valid."));
        return;
      }
      if (xhr.status >= 200 && xhr.status < 300 && json.success) {
        resolve(json as DriveUploadResult);
      } else {
        reject(new Error(json.message || json.error || "Gagal mengunggah file."));
      }
    };

    xhr.onerror = () => reject(new Error("Gagal mengunggah file. Periksa koneksi Anda."));
    xhr.send(formData);
  });
}
