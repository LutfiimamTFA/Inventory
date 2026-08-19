"use client";

import { useRef, useState } from "react";
import { Trash2, UploadCloud, X } from "lucide-react";
import { buildPhysicalEvidenceFileName, uploadImageWithRetry } from "@/lib/import/asset-image-upload";
import { getAssetFilePreviewUrl } from "@/lib/drive-file-id";
import ImageLightboxModal from "@/components/ImageLightboxModal";

const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_SIZE_MB = 10;

export default function PhysicalEvidenceManager({
  images,
  onChange,
  assetCode,
  assetName,
  disabled,
  onError,
}: {
  images: string[];
  onChange: (urls: string[]) => void;
  assetCode: string;
  assetName?: string;
  disabled?: boolean;
  onError: (message: string) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const nextUrls = [...images];
      for (const file of Array.from(files)) {
        if (!ACCEPTED_TYPES.includes(file.type)) {
          onError(`Format "${file.name}" tidak didukung — gunakan JPG/PNG/WEBP/GIF.`);
          continue;
        }
        if (file.size > MAX_SIZE_MB * 1024 * 1024) {
          onError(`"${file.name}" melebihi batas ${MAX_SIZE_MB}MB.`);
          continue;
        }
        // Pipeline SAMA dengan foto aset manual — uploadToDrive lewat
        // /api/upload-drive, BUKAN Firebase Storage.
        const fileName = buildPhysicalEvidenceFileName(assetCode, nextUrls.length, file.type);
        try {
          const uploaded = await uploadImageWithRetry(file, fileName, file.type, { assetCode, assetName });
          nextUrls.push(getAssetFilePreviewUrl(uploaded.fileId));
        } catch (err) {
          const errorInfo =
            err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : { raw: String(err) };
          console.error("[Physical Evidence] Google Drive upload gagal", {
            assetCode,
            fileName: file.name,
            fileSize: file.size,
            mimeType: file.type,
            error: errorInfo,
          });
          onError(`Gagal mengupload "${file.name}".`);
        }
      }
      onChange(nextUrls);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const handleDelete = (url: string) => {
    // Tidak ada mekanisme hapus file Google Drive di project ini (hanya
    // upload-drive & proxy /api/asset-files) — cukup lepas referensinya dari
    // dokumen aset. File di Drive tidak terhapus otomatis.
    onChange(images.filter((u) => u !== url));
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {images.map((url, i) => (
          <div key={url} className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl border border-slate-200">
            <button
              type="button"
              onClick={() => setPreviewIndex(i)}
              className="block h-full w-full"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={url} alt={`Bukti fisik ${i + 1}`} className="h-full w-full object-cover" />
            </button>
            {!disabled && (
              <button
                type="button"
                onClick={() => handleDelete(url)}
                className="absolute right-1 top-1 rounded-full bg-red-600/90 p-1 text-white hover:bg-red-700"
                aria-label="Hapus foto"
              >
                <X size={12} />
              </button>
            )}
          </div>
        ))}

        {!disabled && (
          <label className="flex h-20 w-20 shrink-0 cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-slate-300 bg-slate-50 text-slate-400 hover:bg-slate-100">
            {uploading ? (
              <span className="block h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
            ) : (
              <>
                <UploadCloud size={16} />
                <span className="text-[10px] font-medium">Tambah</span>
              </>
            )}
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPTED_TYPES.join(",")}
              multiple
              className="hidden"
              disabled={uploading}
              onChange={(e) => handleFiles(e.target.files)}
            />
          </label>
        )}
      </div>

      {images.length === 0 && (
        <p className="flex items-center gap-1.5 text-xs text-slate-400">
          <Trash2 size={12} className="opacity-0" />
          Belum ada foto bukti fisik.
        </p>
      )}

      <ImageLightboxModal
        open={previewIndex !== null}
        images={images.map((url, i) => ({ src: url, label: `Bukti Fisik ${i + 1}` }))}
        initialIndex={previewIndex || 0}
        onClose={() => setPreviewIndex(null)}
      />
    </div>
  );
}
