"use client";

import { useState } from "react";
import { X, ChevronLeft, ChevronRight } from "lucide-react";

export interface LightboxImage {
  src: string;
  label?: string;
}

export default function ImageLightboxModal({
  open,
  images,
  initialIndex = 0,
  onClose,
  title,
}: {
  open: boolean;
  images: LightboxImage[];
  initialIndex?: number;
  onClose: () => void;
  title?: string;
}) {
  const [index, setIndex] = useState(initialIndex);
  // Reset index saat modal baru saja dibuka (bukan lewat effect — setState
  // sinkron di effect body memicu render tambahan yang tidak perlu; ini pola
  // "adjust state during render" yang direkomendasikan React untuk kasus
  // reset-dari-prop seperti ini).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) setIndex(initialIndex);
  }

  if (!open || images.length === 0) return null;

  const current = images[Math.min(index, images.length - 1)];
  const hasMultiple = images.length > 1;

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-950/80 p-4"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute right-4 top-4 rounded-full bg-white/90 p-2 text-slate-700 shadow hover:bg-white"
        aria-label="Tutup preview"
      >
        <X size={18} />
      </button>

      {hasMultiple && (
        <>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIndex((i) => (i - 1 + images.length) % images.length);
            }}
            className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full bg-white/90 p-2 text-slate-700 shadow hover:bg-white"
            aria-label="Sebelumnya"
          >
            <ChevronLeft size={18} />
          </button>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setIndex((i) => (i + 1) % images.length);
            }}
            className="absolute right-4 top-1/2 -translate-y-1/2 rounded-full bg-white/90 p-2 text-slate-700 shadow hover:bg-white"
            aria-label="Berikutnya"
          >
            <ChevronRight size={18} />
          </button>
        </>
      )}

      <div className="flex flex-col items-center gap-2" onClick={(e) => e.stopPropagation()}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={current.src}
          alt={current.label || title || "Preview"}
          className="max-h-[80vh] max-w-[92vw] rounded-xl bg-white object-contain shadow-2xl"
        />
        {(title || current.label || hasMultiple) && (
          <p className="text-sm text-white/80">
            {title && <span className="font-medium text-white">{title}</span>}
            {title && current.label && " — "}
            {current.label}
            {hasMultiple && ` (${index + 1}/${images.length})`}
          </p>
        )}
      </div>
    </div>
  );
}
