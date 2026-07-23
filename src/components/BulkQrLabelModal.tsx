"use client";

import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Download, Printer, X, ChevronLeft, ChevronRight } from "lucide-react";
import { toPng } from "html-to-image";
import { Asset } from "@/lib/types";
import { getAppBaseUrl, getAssetActionUrl, getQrDomainNotice } from "@/lib/utils";

const LABEL_SIZES = {
  "50x30": { label: "50mm x 30mm", width: 50, height: 30 },
  "60x40": { label: "60mm x 40mm", width: 60, height: 40 },
  "70x50": { label: "70mm x 50mm", width: 70, height: 50 },
} as const;

type LabelSizeKey = keyof typeof LABEL_SIZES | "custom";
type Orientation = "portrait" | "landscape";

const SCREEN_DPI = 96;
const EXPORT_DPI = 300;
const PX_PER_MM = SCREEN_DPI / 25.4;

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

function BulkLabelCell({
  asset,
  qrPixelSize,
  nameStyle,
  codeStyle,
  gap = 4,
  borderWidth,
  borderRadius,
}: {
  asset: Asset;
  qrPixelSize: number;
  nameStyle?: CSSProperties;
  codeStyle?: CSSProperties;
  gap?: number;
  borderWidth?: number;
  borderRadius?: number;
}) {
  // Section C — sama seperti QrLabelModal: QR berisi URL /asset-action
  // penuh, bukan lagi kode asset polos.
  const qrValue = getAssetActionUrl(asset.assetCode || asset.qrCodeValue || asset.id);
  return (
    <div
      className="border border-dashed border-slate-300 rounded flex items-center justify-center overflow-hidden"
      style={{
        borderWidth,
        borderRadius,
        boxSizing: "border-box",
      }}
    >
      <div
        className="flex flex-col items-center justify-center w-full h-full"
        style={{ gap }}
      >
        <QRCodeSVG
          value={qrValue}
          size={qrPixelSize}
          level="H"
          includeMargin
          imageSettings={getQrLogoImageSettings(qrPixelSize)}
        />
        <p
          className="text-[7px] font-bold text-slate-900 text-center leading-tight px-1 truncate max-w-full"
          style={nameStyle}
        >
          {asset.assetName}
        </p>
        <p
          className="text-[6px] font-mono text-slate-500 text-center leading-tight"
          style={codeStyle}
        >
          {asset.assetCode}
        </p>
      </div>
    </div>
  );
}

export default function BulkQrLabelModal({
  assets,
  open,
  onClose,
}: {
  assets: Asset[];
  open: boolean;
  onClose: () => void;
}) {
  const [sizeKey, setSizeKey] = useState<LabelSizeKey>("60x40");
  const [customWidthMm, setCustomWidthMm] = useState(80);
  const [customHeightMm, setCustomHeightMm] = useState(45);
  const [marginPreset, setMarginPreset] = useState<MarginPresetKey>("5");
  const [marginCustomMm, setMarginCustomMm] = useState(5);
  const [gapPreset, setGapPreset] = useState<GapPresetKey>("2");
  const [gapCustomMm, setGapCustomMm] = useState(2);
  const [orientation, setOrientation] = useState<Orientation>("portrait");
  const [currentPageIndex, setCurrentPageIndex] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const activePageRef = useRef<HTMLDivElement>(null);
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
  const labelsPerPage = columns * rows;

  const totalPages = labelsPerPage >= 1 ? Math.ceil(assets.length / labelsPerPage) : 0;

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

  const safePageIndex = Math.min(currentPageIndex, Math.max(totalPages - 1, 0));

  function getAssetsOnPage(pageIndex: number) {
    const startIndex = pageIndex * labelsPerPage;
    return assets.slice(startIndex, startIndex + labelsPerPage);
  }

  const assetsOnCurrentPage = getAssetsOnPage(safePageIndex);
  const canOutput = customValid && labelsPerPage >= 1 && assets.length > 0;

  const labelQrSizeMm = getLabelQrSizeMm(resolvedLabelWidthMm, resolvedLabelHeightMm);
  const previewLabelQrSize = Math.round(labelQrSizeMm * PX_PER_MM);
  const exportLabelQrSize = mmToPx(labelQrSizeMm);
  const exportA4WidthPx = mmToPx(a4WidthMm);
  const exportA4HeightPx = mmToPx(a4HeightMm);
  const exportLabelWidthPx = mmToPx(resolvedLabelWidthMm);
  const exportLabelHeightPx = mmToPx(resolvedLabelHeightMm);
  const exportMarginPx = mmToPx(resolvedMarginMm);
  const exportGapPx = mmToPx(resolvedGapMm);

  const goPrevPage = () => setCurrentPageIndex((p) => Math.max(0, p - 1));
  const goNextPage = () => setCurrentPageIndex((p) => Math.min(totalPages - 1, p + 1));

  const handleDownload = async () => {
    if (!canOutput || !exportActivePageRef.current) return;
    setDownloading(true);
    try {
      const dataUrl = await toPng(exportActivePageRef.current, {
        pixelRatio: 1,
        backgroundColor: "#ffffff",
        cacheBust: true,
      });
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = `QR-BULK-PAGE-${safePageIndex + 1}.png`;
      a.click();
    } catch (err) {
      console.error("[Bulk QR Label] download PNG gagal", err);
    } finally {
      setDownloading(false);
    }
  };

  const handlePrint = () => {
    if (!canOutput) return;
    window.print();
  };

  const gridStyle = {
    gridTemplateColumns: `repeat(${columns}, ${Math.round(resolvedLabelWidthMm * PX_PER_MM)}px)`,
    gridAutoRows: `${Math.round(resolvedLabelHeightMm * PX_PER_MM)}px`,
    gap: Math.round(resolvedGapMm * PX_PER_MM),
  };
  const exportGridStyle = {
    gridTemplateColumns: `repeat(${columns}, ${exportLabelWidthPx}px)`,
    gridAutoRows: `${exportLabelHeightPx}px`,
    gap: exportGapPx,
  };
  const exportNameStyle: CSSProperties = {
    color: "#0f172a",
    fontSize: scaleScreenPx(7),
    fontWeight: 700,
    lineHeight: 1.15,
    maxWidth: "100%",
    overflow: "hidden",
    paddingLeft: scaleScreenPx(3),
    paddingRight: scaleScreenPx(3),
    textAlign: "center",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  };
  const exportCodeStyle: CSSProperties = {
    color: "#334155",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
    fontSize: scaleScreenPx(6),
    lineHeight: 1.15,
    textAlign: "center",
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 print:p-0 print:bg-white">
      <style>{`
        .bulk-print-only { display: none; }
        @media print {
          body * { visibility: hidden; }
          .bulk-print-area, .bulk-print-area * { visibility: visible; }
          .bulk-print-area {
            position: absolute;
            left: 0;
            top: 0;
          }
          .no-print { display: none !important; }
          .bulk-print-area { transform: none !important; }
          .bulk-print-only { display: flex !important; flex-direction: column; }
          .a4-page { margin: 0 !important; page-break-after: always; }
          .a4-page:last-child { page-break-after: auto; }
          @page {
            size: A4 ${orientation};
            margin: 0;
          }
        }
      `}</style>

      <div className="absolute inset-0 bg-black/50 no-print" onClick={onClose} />

      <div className="relative bg-white rounded-2xl shadow-lg border border-slate-200 w-full max-w-3xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 pt-6 mb-1 no-print">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Bulk QR Label</h2>
            <p className="text-xs text-slate-400 mt-0.5">{assets.length} asset dipilih</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-700 cursor-pointer rounded-lg p-1 hover:bg-slate-100"
          >
            <X size={18} />
          </button>
        </div>

        {/* Section D — info domain QR, sama seperti QrLabelModal. */}
        {(() => {
          const domainNotice = getQrDomainNotice(getAppBaseUrl());
          return (
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
          );
        })()}

        <div className="grid md:grid-cols-2 gap-6 px-6 pb-6">
          {/* Kiri: preview */}
          <div className="flex flex-col items-center">
            {assets.length === 0 ? (
              <p className="text-sm text-slate-400 py-8 text-center">
                Belum ada asset dipilih.
              </p>
            ) : !customValid ? (
              <p className="text-sm text-red-600 py-8 text-center">
                Ukuran custom tidak valid.
              </p>
            ) : labelsPerPage < 1 ? (
              <p className="text-sm text-amber-600 py-8 text-center">
                Ukuran label terlalu besar untuk A4.
              </p>
            ) : (
              <>
                <div className="flex flex-col items-center gap-1.5 w-full py-4">
                  <p className="text-xs text-slate-400">
                    Halaman {safePageIndex + 1} dari {totalPages}
                  </p>
                  <div
                    className="a4-scale-wrapper"
                    style={{ width: a4WidthPx * a4Scale, height: a4HeightPx * a4Scale }}
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
                      <div className="grid w-full" style={gridStyle}>
                        {assetsOnCurrentPage.map((asset) => (
                          <BulkLabelCell
                            key={asset.id}
                            asset={asset}
                            qrPixelSize={previewLabelQrSize}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Print area tersembunyi: semua halaman */}
                <div className="bulk-print-only bulk-print-area">
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
                      <div className="grid w-full" style={gridStyle}>
                        {getAssetsOnPage(pageIndex).map((asset) => (
                          <BulkLabelCell
                            key={asset.id}
                            asset={asset}
                            qrPixelSize={previewLabelQrSize}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>

                <div
                  aria-hidden="true"
                  className="no-print"
                  style={OFFSCREEN_EXPORT_STYLE}
                >
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
                    <div className="grid w-full" style={exportGridStyle}>
                      {assetsOnCurrentPage.map((asset) => (
                        <BulkLabelCell
                          key={asset.id}
                          asset={asset}
                          qrPixelSize={exportLabelQrSize}
                          nameStyle={exportNameStyle}
                          codeStyle={exportCodeStyle}
                          gap={scaleScreenPx(2)}
                          borderWidth={scaleScreenPx(1)}
                          borderRadius={scaleScreenPx(4)}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                <p className="text-xs text-slate-400 mt-2 text-center no-print">
                  {assets.length} QR asset akan dicetak dalam {totalPages} halaman A4. Kapasitas{" "}
                  {labelsPerPage} label per halaman ({columns} kolom x {rows} baris).
                </p>
              </>
            )}
          </div>

          {/* Kanan: pengaturan */}
          <div className="flex flex-col no-print">
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
                {!customValid && (
                  <p className="col-span-2 text-xs text-red-600">
                    Ukuran custom tidak valid.
                  </p>
                )}
              </div>
            )}

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

            <div className="mt-auto flex gap-2 pt-2">
              <button
                type="button"
                onClick={handleDownload}
                disabled={downloading || !canOutput}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 cursor-pointer hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Download size={15} />
                {downloading ? "Menyiapkan..." : "Download PNG Halaman Ini"}
              </button>
              <button
                type="button"
                onClick={handlePrint}
                disabled={!canOutput}
                className="flex-1 inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-teal-500 text-white px-4 py-2.5 text-sm font-medium cursor-pointer hover:brightness-105 shadow-md shadow-blue-900/20 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <Printer size={15} />
                Print Semua Halaman
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
