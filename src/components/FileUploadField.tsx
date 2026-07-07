"use client";

import { useEffect, useRef, useState } from "react";
import { UploadCloud, FileText, ImageOff, X, RefreshCw } from "lucide-react";
import { uploadToDrive, DriveUploadType } from "@/lib/drive-upload";
import { DriveUploadResult } from "@/lib/types";

export interface FileUploadValue {
  url: string;
  thumbnailUrl?: string;
  driveFileId?: string;
  fileName: string;
  mimeType?: string;
  size?: number;
}

const EXT_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  pdf: "application/pdf",
};

export default function FileUploadField({
  kind,
  uploadType,
  accept,
  maxSizeMB,
  value,
  meta,
  onUploaded,
  onRemove,
  onError,
  onUploadStateChange,
}: {
  kind: "image" | "file";
  uploadType: DriveUploadType;
  accept: string[]; // ekstensi tanpa titik, mis. ["jpg","jpeg","png","webp"]
  maxSizeMB: number;
  value: FileUploadValue | null;
  meta?: { assetCode?: string; assetName?: string };
  onUploaded: (result: DriveUploadResult) => void;
  onRemove: () => void;
  onError: (message: string) => void;
  onUploadStateChange?: (uploading: boolean) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [localPreviewUrl, setLocalPreviewUrl] = useState<string | null>(null);
  const [imgError, setImgError] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const localPreviewRef = useRef<string | null>(null);

  useEffect(() => {
    return () => {
      if (localPreviewRef.current) URL.revokeObjectURL(localPreviewRef.current);
    };
  }, []);

  const acceptAttr = accept.map((e) => EXT_MIME[e] || `.${e}`).join(",");

  const validate = (file: File): string | null => {
    const ext = file.name.split(".").pop()?.toLowerCase() || "";
    if (!accept.includes(ext)) {
      return `Format file harus salah satu dari: ${accept.join(", ").toUpperCase()}.`;
    }
    if (file.size > maxSizeMB * 1024 * 1024) {
      return `Ukuran file maksimal ${maxSizeMB}MB.`;
    }
    return null;
  };

  const logTag = uploadType === "asset_photo" ? "[Asset Photo]" : "[Invoice]";

  const handleFile = async (file: File) => {
    const error = validate(file);
    if (error) {
      onError(error);
      return;
    }

    console.debug(`${logTag} selected file:`, file.name);

    setImgError(false);
    setPendingFile(file);

    if (kind === "image") {
      if (localPreviewRef.current) URL.revokeObjectURL(localPreviewRef.current);
      const previewUrl = URL.createObjectURL(file);
      localPreviewRef.current = previewUrl;
      setLocalPreviewUrl(previewUrl);
    }

    setUploading(true);
    setProgress(0);
    onUploadStateChange?.(true);
    try {
      const result = await uploadToDrive(file, uploadType, meta, setProgress);
      console.debug(`${logTag} upload response:`, {
        success: true,
        fileId: result.fileId,
        fileUrl: result.url,
        thumbnailUrl: result.thumbnailUrl,
      });
      onUploaded(result);
    } catch (err) {
      console.debug(`${logTag} upload response:`, {
        success: false,
        message: err instanceof Error ? err.message : String(err),
      });
      onError(err instanceof Error ? err.message : "Gagal mengunggah file.");
    } finally {
      setUploading(false);
      setPendingFile(null);
      onUploadStateChange?.(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const handleRemove = () => {
    if (localPreviewRef.current) {
      URL.revokeObjectURL(localPreviewRef.current);
      localPreviewRef.current = null;
    }
    setLocalPreviewUrl(null);
    setImgError(false);
    setPendingFile(null);
    onRemove();
  };

  const displayFileName = pendingFile?.name || value?.fileName || "";
  const displaySize = pendingFile?.size ?? value?.size;
  if (kind === "image" && !localPreviewUrl) {
    console.debug(`${logTag} drive file id:`, value?.driveFileId);
  }
  const imageSrc = imgError
    ? null
    : localPreviewUrl ||
      (value?.driveFileId ? `/api/drive-image?fileId=${value.driveFileId}` : null);
  if (kind === "image") {
    console.debug(`${logTag} image src:`, imageSrc);
  }

  const hasContent = Boolean(displayFileName || imageSrc);

  if (hasContent) {
    return (
      <div className="rounded-xl border border-slate-200 p-3 flex items-center gap-3">
        {kind === "image" ? (
          imageSrc ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageSrc}
              alt={displayFileName || "Foto asset"}
              className="h-16 w-16 rounded-lg object-cover border border-slate-100 shrink-0"
              onError={() => {
                console.debug(`${logTag} image load failed:`, imageSrc);
                setImgError(true);
              }}
            />
          ) : (
            <div
              className="h-16 w-16 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center shrink-0"
              title="Foto belum dapat ditampilkan"
            >
              <ImageOff size={22} className="text-slate-300" />
            </div>
          )
        ) : (
          <div className="h-16 w-16 rounded-lg bg-slate-50 border border-slate-100 flex items-center justify-center shrink-0">
            <FileText size={22} className="text-slate-400" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-700 truncate">
            {displayFileName || "Berkas"}
          </p>
          {displaySize !== undefined && (
            <p className="text-xs text-slate-400">{(displaySize / 1024).toFixed(0)} KB</p>
          )}
          {kind === "image" && imgError && (
            <p className="text-xs text-amber-600">Foto belum dapat ditampilkan</p>
          )}
          {uploading && (
            <div className="mt-1.5 w-full max-w-[160px] h-1 rounded-full bg-slate-200 overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {uploading ? (
            <RefreshCw size={16} className="text-blue-500 animate-spin" />
          ) : (
            <>
              <button
                type="button"
                onClick={() => inputRef.current?.click()}
                className="text-xs font-medium text-blue-600 hover:bg-blue-50 rounded-lg px-2 py-1.5"
              >
                {kind === "image" ? "Ganti Foto" : "Ganti File"}
              </button>
              <button
                type="button"
                onClick={handleRemove}
                className="text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg p-1.5"
              >
                <X size={15} />
              </button>
            </>
          )}
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={acceptAttr}
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
      </div>
    );
  }

  return (
    <label
      className="file-drop"
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      <UploadCloud size={20} className="text-slate-400" />
      <span className="text-xs text-slate-500 text-center">
        Klik atau drag & drop {kind === "image" ? "foto" : "file"} di sini
      </span>
      <span className="text-[11px] text-slate-400">
        {accept.join(", ").toUpperCase()} · maks {maxSizeMB}MB
      </span>
      <input
        type="file"
        accept={acceptAttr}
        className="hidden"
        onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
      />
    </label>
  );
}
