"use client";

import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Download, Printer, X, Copy, Check, ChevronLeft, ChevronRight } from "lucide-react";
import { toPng } from "html-to-image";
import { Asset } from "@/lib/types";
import {
  ASSET_STATUS_COLOR,
  ASSET_STATUS_LABEL,
  CONDITION_LABEL,
  getAppBaseUrl,
  getAssetActionUrl,
  getQrDomainNotice,
} from "@/lib/utils";
import Badge from "@/components/Badge";

const LABEL_SIZES = {
  "50x30": { label: "50mm x 30mm", width: 50, height: 30 },
  "60x40": { label: "60mm x 40mm", width: 60, height: 40 },
  "70x50": { label: "70mm x 50mm", width: 70, height: 50 },
} as const;

type LabelSizeKey = keyof typeof LABEL_SIZES | "custom";
type PrintMode = "single" | "a4";
type Orientation = "portrait" | "landscape";

const SCREEN_DPI = 96;
const EXPORT_DPI = 300;
const PX_PER_MM = SCREEN_DPI / 25.4; // referensi 96dpi untuk preview di layar

const A4_LONG_MM = 297;
const A4_SHORT_MM = 210;

const MARGIN_PRESETS = { "0": 0, "5": 5, "10": 10 } as const;
type MarginPresetKey = keyof typeof MARGIN_PRESETS | "custom";
const GAP_PRESETS = { "0": 0, "2": 2, "4": 4 } as const;
type GapPresetKey = keyof typeof GAP_PRESETS | "custom";

const A4_PREVIEW_MAX_WIDTH_PX = 340;

const CUSTOM_WIDTH_MIN = 30;
const CUSTOM_WIDTH_MAX = 150;
const CUSTOM_HEIGHT_MIN = 20;
const CUSTOM_HEIGHT_MAX = 100;

const LABEL_COUNT_MIN = 1;
const LABEL_COUNT_MAX = 500;

const OFFSCREEN_EXPORT_STYLE: CSSProperties = {
  position: "fixed",
  left: -10000,
  top: 0,
  zIndex: -1,
  pointerEvents: "none",
  backgroundColor: "#ffffff",
};

function mmToPx(mm: number, dpi = EXPORT_DPI) {
  return Math.round((mm / 25.4) * dpi);
}

function scaleScreenPx(px: number, dpi = EXPORT_DPI) {
  return Math.max(1, Math.round((px / SCREEN_DPI) * dpi));
}

function getQrLogoImageSettings(qrPixelSize: number) {
  const logoSize = Math.round(qrPixelSize * 0.18);
  return {
    src: "/logo.png",
    height: logoSize,
    width: logoSize,
    excavate: true,
  };
}

function getLabelQrSizeMm(labelWidthMm: number, labelHeightMm: number) {
  const availableAfterTextMm = Math.max(10, labelHeightMm - 10);
  return Math.max(
    12,
    Math.min(Math.min(labelWidthMm, labelHeightMm) * 0.62, availableAfterTextMm)
  );
}

function QrLabelContent({
  asset,
  qrValue,
  qrPixelSize,
  nameClassName,
  codeClassName,
  nameStyle,
  codeStyle,
  gap = 6,
}: {
  asset: Asset;
  qrValue: string;
  qrPixelSize: number;
  nameClassName?: string;
  codeClassName?: string;
  nameStyle?: CSSProperties;
  codeStyle?: CSSProperties;
  gap?: number;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center w-full h-full"
      style={{ gap }}
    >
      {/* SVG (vektor) supaya QR tetap tajam saat dirasterkan 3-4x untuk export/print */}
      <QRCodeSVG
        value={qrValue}
        size={qrPixelSize}
        level="H"
        includeMargin
        imageSettings={getQrLogoImageSettings(qrPixelSize)}
      />
      <p className={nameClassName} style={nameStyle}>
        {asset.assetName}
      </p>
      <p className={codeClassName} style={codeStyle}>
        {asset.assetCode}
      </p>
    </div>
  );
}

export default function QrLabelModal({
  asset,
  open,
  onClose,
}: {
  asset: Asset;
  open: boolean;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<PrintMode>("single");
  const [sizeKey, setSizeKey] = useState<LabelSizeKey>("60x40");
  const [customWidthMm, setCustomWidthMm] = useState(80);
  const [customHeightMm, setCustomHeightMm] = useState(45);
  const [marginPreset, setMarginPreset] = useState<MarginPresetKey>("5");
  const [marginCustomMm, setMarginCustomMm] = useState(5);
  const [gapPreset, setGapPreset] = useState<GapPresetKey>("2");
  const [gapCustomMm, setGapCustomMm] = useState(2);
  const [orientation, setOrientation] = useState<Orientation>("portrait");
  const [labelCountInput, setLabelCountInput] = useState("18");
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [copied, setCopied] = useState(false);
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const singleLabelRef = useRef<HTMLDivElement>(null);
  const activePageRef = useRef<HTMLDivElement>(null);
  const exportSingleLabelRef = useRef<HTMLDivElement>(null);
  const exportActivePageRef = useRef<HTMLDivElement>(null);

  const isCustom = sizeKey === "custom";
  const customValid =
    !isCustom ||
    (customWidthMm >= CUSTOM_WIDTH_MIN &&
      customWidthMm <= CUSTOM_WIDTH_MAX &&
      customHeightMm >= CUSTOM_HEIGHT_MIN &&
      customHeightMm <= CUSTOM_HEIGHT_MAX);

  const resolvedLabelWidthMm = isCustom ? customWidthMm : LABEL_SIZES[sizeKey].width;
  const resolvedLabelHeightMm = isCustom ? customHeightMm : LABEL_SIZES[sizeKey].height;

  const resolvedMarginMm =
    marginPreset === "custom" ? marginCustomMm : MARGIN_PRESETS[marginPreset];
  const resolvedGapMm = gapPreset === "custom" ? gapCustomMm : GAP_PRESETS[gapPreset];

  const a4WidthMm = orientation === "portrait" ? A4_SHORT_MM : A4_LONG_MM;
  const a4HeightMm = orientation === "portrait" ? A4_LONG_MM : A4_SHORT_MM;
  const a4WidthPx = Math.round(a4WidthMm * PX_PER_MM);
  const a4HeightPx = Math.round(a4HeightMm * PX_PER_MM);
  const a4Scale = useMemo(
    () => Math.min(1, A4_PREVIEW_MAX_WIDTH_PX / a4WidthPx),
    [a4WidthPx]
  );

  const availableWidthMm = a4WidthMm - resolvedMarginMm * 2;
  const availableHeightMm = a4HeightMm - resolvedMarginMm * 2;
  const columns = Math.max(
    0,
    Math.floor((availableWidthMm + resolvedGapMm) / (resolvedLabelWidthMm + resolvedGapMm))
  );
  const rows = Math.max(
    0,
    Math.floor((availableHeightMm + resolvedGapMm) / (resolvedLabelHeightMm + resolvedGapMm))
  );
  const calculatedLabelsPerPage = columns * rows;

  const labelCount = parseInt(labelCountInput, 10);
  const labelCountValid =
    !isNaN(labelCount) &&
    labelCount >= LABEL_COUNT_MIN &&
    labelCount <= LABEL_COUNT_MAX &&
    calculatedLabelsPerPage >= 1;

  const totalPages =
    labelCountValid && calculatedLabelsPerPage >= 1
      ? Math.ceil(labelCount / calculatedLabelsPerPage)
      : 0;

  // Clamp currentPageIndex setiap kali totalPages berubah (ukuran/margin/gap/
  // orientasi/jumlah label) supaya tidak pernah menunjuk halaman yang sudah
  // tidak ada lagi.
  useEffect(() => {
    queueMicrotask(() => {
      setCurrentPageIndex((prev) => {
        if (totalPages <= 1) return 0;
        if (prev >= totalPages) return totalPages - 1;
        if (prev < 0) return 0;
        return prev;
      });
    });
  }, [totalPages]);

  if (!open) return null;

  // Section C — QR sekarang berisi URL /asset-action lengkap (domain
  // production dari NEXT_PUBLIC_APP_URL), bukan lagi kode asset polos,
  // supaya kamera bawaan HP bisa langsung membuka halaman aksi asset.
  const qrValue = getAssetActionUrl(asset.assetCode || asset.qrCodeValue || asset.id);
  const domainNotice = getQrDomainNotice(getAppBaseUrl());
  const singleWidth = Math.round(resolvedLabelWidthMm * PX_PER_MM);
  const singleHeight = Math.round(resolvedLabelHeightMm * PX_PER_MM);
  const singleQrSizeMm = getLabelQrSizeMm(resolvedLabelWidthMm, resolvedLabelHeightMm);
  const singleQrSize = Math.round(singleQrSizeMm * PX_PER_MM);
  const exportSingleWidth = mmToPx(resolvedLabelWidthMm);
  const exportSingleHeight = mmToPx(resolvedLabelHeightMm);
  const exportSingleQrSize = mmToPx(singleQrSizeMm);
  const exportA4WidthPx = mmToPx(a4WidthMm);
  const exportA4HeightPx = mmToPx(a4HeightMm);
  const exportLabelWidthPx = mmToPx(resolvedLabelWidthMm);
  const exportLabelHeightPx = mmToPx(resolvedLabelHeightMm);
  const exportGapPx = mmToPx(resolvedGapMm);
  const exportMarginPx = mmToPx(resolvedMarginMm);

  const canOutput = customValid && (mode === "single" || labelCountValid);
  const safePageIndex = Math.min(currentPageIndex, Math.max(totalPages - 1, 0));

  function getLabelsOnPage(pageIndex: number) {
    const startIndex = pageIndex * calculatedLabelsPerPage;
    const remaining = labelCount - startIndex;
    return Math.max(0, Math.min(calculatedLabelsPerPage, remaining));
  }

  const labelsOnCurrentPage = getLabelsOnPage(safePageIndex);

  console.debug("[QR Label] currentPageIndex", safePageIndex);
  console.debug("[QR Label] totalPages", totalPages);
  console.debug("[QR Label] labelsPerPage", calculatedLabelsPerPage);
  console.debug("[QR Label] labelsOnCurrentPage", labelsOnCurrentPage);

  const goPrevPage = () => {
    console.debug("[QR Label] go prev");
    setCurrentPageIndex((prev) => Math.max(0, prev - 1));
  };

  const goNextPage = () => {
    console.debug("[QR Label] go next");
    setCurrentPageIndex((prev) => Math.min(totalPages - 1, prev + 1));
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(asset.assetCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard tidak tersedia — abaikan diam-diam
    }
  };

  // Section J — Copy QR URL, supaya admin bisa langsung memverifikasi isi
  // QR yang bakal dicetak itu URL /asset-action yang benar, bukan kebetulan
  // kepotong data vCard/kontak lain.
  const handleCopyUrl = async () => {
    try {
      await navigator.clipboard.writeText(qrValue);
      setCopiedUrl(true);
      setTimeout(() => setCopiedUrl(false), 1500);
    } catch {
      // clipboard tidak tersedia — abaikan diam-diam
    }
  };

  const handleDownload = async () => {
    if (!canOutput) return;
    const target =
      mode === "single" ? exportSingleLabelRef.current : exportActivePageRef.current;
    if (!target) return;
    console.debug("[QR Label] download page", safePageIndex + 1);
    setDownloading(true);
    try {
      const dataUrl = await toPng(target, {
        pixelRatio: 1,
        backgroundColor: "#ffffff",
        cacheBust: true,
      });
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download =
        mode === "single"
          ? `QR-${asset.assetCode}.png`
          : totalPages > 1
          ? `QR-SHEET-${asset.assetCode}-PAGE-${safePageIndex + 1}.png`
          : `QR-SHEET-${asset.assetCode}.png`;
      a.click();
    } catch (err) {
      console.error("[QR Label] download PNG gagal", err);
    } finally {
      setDownloading(false);
    }
  };

  const handlePrint = () => {
    if (!canOutput) return;
    window.print();
  };

  const handleLabelCountBlur = () => {
    const parsed = parseInt(labelCountInput, 10);
    if (isNaN(parsed) || parsed < LABEL_COUNT_MIN) {
      setLabelCountInput(String(LABEL_COUNT_MIN));
      return;
    }
    if (parsed > LABEL_COUNT_MAX) {
      setLabelCountInput(String(LABEL_COUNT_MAX));
    }
  };

  const a4LabelQrSizeMm = getLabelQrSizeMm(
    resolvedLabelWidthMm,
    resolvedLabelHeightMm
  );
  const previewLabelQrSize = Math.round(a4LabelQrSizeMm * PX_PER_MM);
  const exportLabelQrSize = mmToPx(a4LabelQrSizeMm);

  const exportSingleNameStyle: CSSProperties = {
    color: "#0f172a",
    fontSize: scaleScreenPx(11),
    fontWeight: 700,
    lineHeight: 1.15,
    maxWidth: "100%",
    overflow: "hidden",
    paddingLeft: scaleScreenPx(4),
    paddingRight: scaleScreenPx(4),
    textAlign: "center",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };
  const exportSingleCodeStyle: CSSProperties = {
    color: "#334155",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    fontSize: scaleScreenPx(10),
    lineHeight: 1.15,
    textAlign: "center",
  };
  const exportSheetNameStyle: CSSProperties = {
    ...exportSingleNameStyle,
    fontSize: scaleScreenPx(7),
    paddingLeft: scaleScreenPx(3),
    paddingRight: scaleScreenPx(3),
  };
  const exportSheetCodeStyle: CSSProperties = {
    ...exportSingleCodeStyle,
    fontSize: scaleScreenPx(6),
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 print:p-0 print:bg-white">
      <style>{`
        .print-only-a4 { display: none; }
        @media print {
          body * { visibility: hidden; }
          .print-area, .print-area * { visibility: visible; }
          .print-area {
            position: absolute;
            left: 0;
            top: 0;
          }
          .no-print { display: none !important; }
          .print-area { transform: none !important; }
          .print-only-a4 { display: flex !important; flex-direction: column; }
          .a4-page { margin: 0 !important; page-break-after: always; }
          .a4-page:last-child { page-break-after: auto; }
          @page {
            size: ${
              mode === "single"
                ? `${resolvedLabelWidthMm}mm ${resolvedLabelHeightMm}mm`
                : `A4 ${orientation}`
            };
            margin: 0;
          }
        }
      `}</style>

      <div
        className="absolute inset-0 bg-black/50 no-print"
        onClick={onClose}
      />

      <div className="relative bg-white rounded-2xl shadow-lg border border-slate-200 w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 pt-6 mb-1 no-print">
          <h2 className="text-lg font-semibold text-slate-900">QR Label Asset</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 cursor-pointer rounded-lg p-1 hover:bg-slate-100"
          >
            <X size={18} />
          </button>
        </div>

        {/* Section D — info domain QR, HANYA di layar (no-print), supaya
            admin tahu label yang akan dicetak bisa langsung dibuka kamera
            HP atau cuma untuk testing lokal. */}
        <div
          className={`mx-6 mb-3 rounded-xl border px-3 py-2 text-xs no-print ${
            domainNotice.tone === "success"
              ? "border-emerald-200 bg-emerald-50 text-emerald-700"
              : domainNotice.tone === "warning"
              ? "border-amber-200 bg-amber-50 text-amber-700"
              : "border-blue-200 bg-blue-50 text-blue-700"
          }`}
        >
          {domainNotice.message}
        </div>

        <div className="grid md:grid-cols-2 gap-6 px-6 pb-6">
          {/* Kiri: preview */}
          <div className="flex flex-col items-center">
            <div className="flex items-center gap-2 mb-4 flex-wrap self-start no-print">
              <Badge
                label={ASSET_STATUS_LABEL[asset.assetStatus]}
                colorClass={ASSET_STATUS_COLOR[asset.assetStatus]}
              />
              <Badge
                label={CONDITION_LABEL[asset.condition]}
                colorClass="bg-slate-100 text-slate-600 border-slate-200"
              />
            </div>

            {/* Section K — hint layar saja, TIDAK ikut tercetak di label
                fisik (label tetap cuma QR + nama + kode). */}
            <p className="mb-2 self-start text-[11px] text-slate-400 no-print">
              Scan kamera HP untuk membuka asset.
            </p>

            {!customValid ? (
              <p className="text-sm text-red-600 py-8 text-center">
                Ukuran custom tidak valid.
              </p>
            ) : mode === "single" ? (
              <div className="flex justify-center items-center py-4 w-full overflow-auto">
                <div
                  ref={singleLabelRef}
                  className="print-area bg-white border border-slate-300 rounded-md flex items-center justify-center shrink-0"
                  style={{ width: singleWidth, height: singleHeight, padding: 8 }}
                >
                  <QrLabelContent
                    asset={asset}
                    qrValue={qrValue}
                    qrPixelSize={singleQrSize}
                    nameClassName="text-[11px] font-bold text-slate-900 text-center leading-tight px-1 truncate max-w-full"
                    codeClassName="text-[10px] font-mono text-slate-500 text-center leading-tight"
                    gap={5}
                  />
                </div>
              </div>
            ) : calculatedLabelsPerPage < 1 ? (
              <p className="text-sm text-amber-600 py-8 text-center">
                Ukuran label terlalu besar untuk A4.
              </p>
            ) : (
              <>
                {/* Preview layar: hanya halaman aktif */}
                <div className="flex flex-col items-center gap-1.5 w-full py-4">
                  <p className="text-xs text-slate-400">
                    Halaman {safePageIndex + 1} dari {totalPages}
                  </p>
                  <div
                    className="a4-scale-wrapper"
                    style={{
                      width: a4WidthPx * a4Scale,
                      height: a4HeightPx * a4Scale,
                    }}
                  >
                    <div
                      ref={activePageRef}
                      className="a4-page bg-white shadow-sm origin-top-left"
                      style={{
                        width: a4WidthPx,
                        height: a4HeightPx,
                        padding: Math.round(resolvedMarginMm * PX_PER_MM),
                        transform: `scale(${a4Scale})`,
                      }}
                    >
                      <div
                        className="grid w-full"
                        style={{
                          gridTemplateColumns: `repeat(${columns}, ${Math.round(
                            resolvedLabelWidthMm * PX_PER_MM
                          )}px)`,
                          gridAutoRows: `${Math.round(resolvedLabelHeightMm * PX_PER_MM)}px`,
                          gap: Math.round(resolvedGapMm * PX_PER_MM),
                        }}
                      >
                        {Array.from({ length: labelsOnCurrentPage }).map((_, i) => (
                          <div
                            key={i}
                            className="border border-dashed border-slate-300 rounded flex items-center justify-center overflow-hidden"
                          >
                            <QrLabelContent
                              asset={asset}
                              qrValue={qrValue}
                              qrPixelSize={previewLabelQrSize}
                              nameClassName="text-[7px] font-bold text-slate-900 text-center leading-tight px-1 truncate max-w-full"
                              codeClassName="text-[6px] font-mono text-slate-500 text-center leading-tight"
                              gap={2}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Print area tersembunyi di layar: render semua halaman */}
                <div className="print-only-a4 print-area">
                  {Array.from({ length: totalPages }).map((_, pageIndex) => (
                    <div
                      key={pageIndex}
                      className="a4-page bg-white"
                      style={{
                        width: a4WidthPx,
                        height: a4HeightPx,
                        padding: Math.round(resolvedMarginMm * PX_PER_MM),
                      }}
                    >
                      <div
                        className="grid w-full"
                        style={{
                          gridTemplateColumns: `repeat(${columns}, ${Math.round(
                            resolvedLabelWidthMm * PX_PER_MM
                          )}px)`,
                          gridAutoRows: `${Math.round(resolvedLabelHeightMm * PX_PER_MM)}px`,
                          gap: Math.round(resolvedGapMm * PX_PER_MM),
                        }}
                      >
                        {Array.from({ length: getLabelsOnPage(pageIndex) }).map((_, i) => (
                          <div
                            key={i}
                            className="border border-dashed border-slate-300 rounded flex items-center justify-center overflow-hidden"
                          >
                            <QrLabelContent
                              asset={asset}
                              qrValue={qrValue}
                              qrPixelSize={previewLabelQrSize}
                              nameClassName="text-[7px] font-bold text-slate-900 text-center leading-tight px-1 truncate max-w-full"
                              codeClassName="text-[6px] font-mono text-slate-500 text-center leading-tight"
                              gap={2}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {canOutput && (
              <div
                aria-hidden="true"
                className="no-print"
                style={OFFSCREEN_EXPORT_STYLE}
              >
                {mode === "single" ? (
                  <div
                    ref={exportSingleLabelRef}
                    className="bg-white flex items-center justify-center"
                    style={{
                      width: exportSingleWidth,
                      height: exportSingleHeight,
                      padding: scaleScreenPx(8),
                      border: `${scaleScreenPx(1)}px solid #cbd5e1`,
                      borderRadius: scaleScreenPx(6),
                      boxSizing: "border-box",
                    }}
                  >
                    <QrLabelContent
                      asset={asset}
                      qrValue={qrValue}
                      qrPixelSize={exportSingleQrSize}
                      nameStyle={exportSingleNameStyle}
                      codeStyle={exportSingleCodeStyle}
                      gap={scaleScreenPx(5)}
                    />
                  </div>
                ) : (
                  <div
                    ref={exportActivePageRef}
                    className="bg-white"
                    style={{
                      width: exportA4WidthPx,
                      height: exportA4HeightPx,
                      padding: exportMarginPx,
                      boxSizing: "border-box",
                    }}
                  >
                    <div
                      className="grid w-full"
                      style={{
                        gridTemplateColumns: `repeat(${columns}, ${exportLabelWidthPx}px)`,
                        gridAutoRows: `${exportLabelHeightPx}px`,
                        gap: exportGapPx,
                      }}
                    >
                      {Array.from({ length: labelsOnCurrentPage }).map((_, i) => (
                        <div
                          key={i}
                          className="flex items-center justify-center overflow-hidden"
                          style={{
                            border: `${scaleScreenPx(1)}px dashed #cbd5e1`,
                            borderRadius: scaleScreenPx(4),
                            boxSizing: "border-box",
                          }}
                        >
                          <QrLabelContent
                            asset={asset}
                            qrValue={qrValue}
                            qrPixelSize={exportLabelQrSize}
                            nameStyle={exportSheetNameStyle}
                            codeStyle={exportSheetCodeStyle}
                            gap={scaleScreenPx(2)}
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            {mode === "a4" && customValid && calculatedLabelsPerPage >= 1 && labelCountValid && (
              <p className="text-xs text-slate-400 mt-2 text-center no-print">
                {labelCount} label akan dicetak dalam {totalPages} halaman A4. Kapasitas{" "}
                {calculatedLabelsPerPage} label per halaman ({columns} kolom x {rows} baris).
              </p>
            )}
          </div>

          {/* Kanan: pengaturan */}
          <div className="flex flex-col no-print">
            <div className="mb-4">
              <label className="block text-xs font-medium text-slate-500 mb-1.5">
                Mode Cetak
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setMode("single")}
                  className={`rounded-xl border px-3 py-2 text-sm font-medium cursor-pointer transition-colors ${
                    mode === "single"
                      ? "border-blue-500 bg-blue-50 text-blue-700"
                      : "border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  Single Label
                </button>
                <button
                  type="button"
                  onClick={() => setMode("a4")}
                  className={`rounded-xl border px-3 py-2 text-sm font-medium cursor-pointer transition-colors ${
                    mode === "a4"
                      ? "border-blue-500 bg-blue-50 text-blue-700"
                      : "border-slate-200 text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  A4 Sheet
                </button>
              </div>
            </div>

            <div className="mb-4">
              <label className="block text-xs font-medium text-slate-500 mb-1.5">
                Ukuran Label
              </label>
              <select
                value={sizeKey}
                onChange={(e) => setSizeKey(e.target.value as LabelSizeKey)}
                className="input cursor-pointer"
              >
                {Object.entries(LABEL_SIZES).map(([key, s]) => (
                  <option key={key} value={key}>
                    {s.label}
                  </option>
                ))}
                <option value="custom">Custom Size</option>
              </select>
            </div>

            {isCustom && (
              <div className="mb-4 grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">
                    Lebar Label (mm)
                  </label>
                  <input
                    type="number"
                    inputMode="numeric"
                    value={customWidthMm}
                    onChange={(e) => setCustomWidthMm(Number(e.target.value))}
                    className="input cursor-text"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">
                    Tinggi Label (mm)
                  </label>
                  <input
                    type="number"
                    inputMode="numeric"
                    value={customHeightMm}
                    onChange={(e) => setCustomHeightMm(Number(e.target.value))}
                    className="input cursor-text"
                  />
                </div>
                <p className="col-span-2 text-xs text-slate-400">
                  Preview mengikuti ukuran custom yang diisi.
                </p>
                {!customValid && (
                  <p className="col-span-2 text-xs text-red-600">
                    Ukuran custom tidak valid.
                  </p>
                )}
              </div>
            )}

            {mode === "a4" && (
              <>
                <div className="mb-4">
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">
                    Orientasi
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      onClick={() => setOrientation("portrait")}
                      className={`rounded-xl border px-3 py-2 text-sm font-medium cursor-pointer transition-colors ${
                        orientation === "portrait"
                          ? "border-blue-500 bg-blue-50 text-blue-700"
                          : "border-slate-200 text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      Portrait
                    </button>
                    <button
                      type="button"
                      onClick={() => setOrientation("landscape")}
                      className={`rounded-xl border px-3 py-2 text-sm font-medium cursor-pointer transition-colors ${
                        orientation === "landscape"
                          ? "border-blue-500 bg-blue-50 text-blue-700"
                          : "border-slate-200 text-slate-600 hover:bg-slate-50"
                      }`}
                    >
                      Landscape
                    </button>
                  </div>
                </div>

                <div className="mb-4 grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1.5">
                      Margin A4
                    </label>
                    <select
                      value={marginPreset}
                      onChange={(e) => setMarginPreset(e.target.value as MarginPresetKey)}
                      className="input cursor-pointer"
                    >
                      <option value="0">Rapat / 0mm</option>
                      <option value="5">Kecil / 5mm</option>
                      <option value="10">Normal / 10mm</option>
                      <option value="custom">Custom</option>
                    </select>
                    {marginPreset === "custom" && (
                      <input
                        type="number"
                        inputMode="numeric"
                        value={marginCustomMm}
                        onChange={(e) => setMarginCustomMm(Number(e.target.value))}
                        className="input cursor-text mt-2"
                        placeholder="mm"
                      />
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1.5">
                      Jarak Antar Label
                    </label>
                    <select
                      value={gapPreset}
                      onChange={(e) => setGapPreset(e.target.value as GapPresetKey)}
                      className="input cursor-pointer"
                    >
                      <option value="0">0mm</option>
                      <option value="2">2mm</option>
                      <option value="4">4mm</option>
                      <option value="custom">Custom</option>
                    </select>
                    {gapPreset === "custom" && (
                      <input
                        type="number"
                        inputMode="numeric"
                        value={gapCustomMm}
                        onChange={(e) => setGapCustomMm(Number(e.target.value))}
                        className="input cursor-text mt-2"
                        placeholder="mm"
                      />
                    )}
                  </div>
                </div>

                <div className="mb-4">
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">
                    Jumlah Label
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={labelCountInput}
                    onChange={(e) =>
                      setLabelCountInput(e.target.value.replace(/[^0-9]/g, ""))
                    }
                    onBlur={handleLabelCountBlur}
                    className="input cursor-text"
                  />
                  <p className="text-xs text-slate-400 mt-1">
                    {calculatedLabelsPerPage >= 1
                      ? `Kapasitas ${calculatedLabelsPerPage} label per halaman. Total ${
                          totalPages || 0
                        } halaman.`
                      : "Ukuran label terlalu besar untuk A4."}
                  </p>
                  {!labelCountValid && calculatedLabelsPerPage >= 1 && (
                    <p className="text-xs text-red-600 mt-1">
                      {isNaN(labelCount) || labelCount < LABEL_COUNT_MIN
                        ? "Jumlah label minimal 1."
                        : `Jumlah label maksimal ${LABEL_COUNT_MAX}.`}
                    </p>
                  )}
                </div>

                {totalPages > 1 && (
                  <div className="mb-4">
                    <label className="block text-xs font-medium text-slate-500 mb-1.5">
                      Halaman untuk Download PNG
                    </label>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={goPrevPage}
                        disabled={safePageIndex === 0}
                        className="p-2 rounded-lg border border-slate-200 text-slate-500 cursor-pointer hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <ChevronLeft size={15} />
                      </button>
                      <span className="text-sm text-slate-600 flex-1 text-center">
                        Halaman {safePageIndex + 1} dari {totalPages}
                      </span>
                      <button
                        type="button"
                        onClick={goNextPage}
                        disabled={safePageIndex === totalPages - 1}
                        className="p-2 rounded-lg border border-slate-200 text-slate-500 cursor-pointer hover:bg-slate-100 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <ChevronRight size={15} />
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* Section J — preview isi QR yang bakal dicetak, supaya admin
                bisa memastikan ini URL /asset-action yang benar (bukan
                vCard/kontak lain yang kebetulan tersimpan). */}
            <div className="mb-3 rounded-xl border border-slate-200 bg-slate-50 p-3 no-print">
              <p className="mb-1 text-[11px] font-semibold uppercase text-slate-400">QR Value</p>
              <p className="break-all font-mono text-xs text-slate-700">{qrValue}</p>
            </div>

            <button
              type="button"
              onClick={handleCopyUrl}
              className="w-full mb-2 inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 cursor-pointer hover:bg-slate-50"
            >
              {copiedUrl ? (
                <Check size={15} className="text-emerald-600" />
              ) : (
                <Copy size={15} />
              )}
              {copiedUrl ? "URL Tersalin" : "Copy QR URL"}
            </button>

            <button
              type="button"
              onClick={handleCopy}
              className="w-full mb-4 inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 cursor-pointer hover:bg-slate-50"
            >
              {copied ? (
                <Check size={15} className="text-emerald-600" />
              ) : (
                <Copy size={15} />
              )}
              {copied ? "Kode Tersalin" : "Copy Kode Asset"}
            </button>

            <div className="mt-auto flex gap-2 pt-2">
              <button
                type="button"
                onClick={handleDownload}
                disabled={downloading || !canOutput}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 cursor-pointer hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Download size={15} />
                {downloading
                  ? "Menyiapkan..."
                  : mode === "a4" && totalPages > 1
                  ? "Download PNG Halaman Ini"
                  : "Download PNG"}
              </button>
              <button
                type="button"
                onClick={handlePrint}
                disabled={!canOutput}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-teal-500 text-white px-4 py-2.5 text-sm font-medium cursor-pointer hover:brightness-105 shadow-md shadow-blue-900/20 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Printer size={15} />
                Print
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
