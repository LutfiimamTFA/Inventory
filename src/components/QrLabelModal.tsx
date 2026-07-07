"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { Download, Printer, X, Copy, Check } from "lucide-react";
import { toPng } from "html-to-image";
import { Asset } from "@/lib/types";
import {
  ASSET_STATUS_COLOR,
  ASSET_STATUS_LABEL,
  CONDITION_LABEL,
} from "@/lib/utils";
import Badge from "@/components/Badge";

const LABEL_SIZES = {
  "50x30": { label: "50mm x 30mm", width: 50, height: 30 },
  "60x40": { label: "60mm x 40mm", width: 60, height: 40 },
  "70x50": { label: "70mm x 50mm", width: 70, height: 50 },
} as const;

type LabelSizeKey = keyof typeof LABEL_SIZES | "custom";
type PrintMode = "single" | "a4";

const PX_PER_MM = 3.78; // referensi ~96dpi untuk preview di layar

const A4_WIDTH_MM = 210;
const A4_HEIGHT_MM = 297;
const A4_PADDING_MM = 10;
const A4_GAP_MM = 4;

const A4_PREVIEW_MAX_WIDTH_PX = 340;

const CUSTOM_WIDTH_MIN = 30;
const CUSTOM_WIDTH_MAX = 150;
const CUSTOM_HEIGHT_MIN = 20;
const CUSTOM_HEIGHT_MAX = 100;

function QrLabelContent({
  asset,
  qrValue,
  qrPixelSize,
  nameClassName,
  codeClassName,
  gap = 6,
}: {
  asset: Asset;
  qrValue: string;
  qrPixelSize: number;
  nameClassName: string;
  codeClassName: string;
  gap?: number;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center w-full h-full"
      style={{ gap }}
    >
      <QRCodeCanvas
        value={qrValue}
        size={qrPixelSize}
        level="H"
        includeMargin
        imageSettings={{
          src: "/logo.png",
          height: Math.round(qrPixelSize * 0.2),
          width: Math.round(qrPixelSize * 0.2),
          excavate: true,
        }}
      />
      <p className={nameClassName}>{asset.assetName}</p>
      <p className={codeClassName}>{asset.assetCode}</p>
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
  const [labelCountInput, setLabelCountInput] = useState("18");
  const [isLabelCountManualEdited, setIsLabelCountManualEdited] = useState(false);
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const singleLabelRef = useRef<HTMLDivElement>(null);
  const sheetRef = useRef<HTMLDivElement>(null);

  const a4WidthPx = Math.round(A4_WIDTH_MM * PX_PER_MM);
  const a4HeightPx = Math.round(A4_HEIGHT_MM * PX_PER_MM);
  const a4Scale = useMemo(
    () => Math.min(1, A4_PREVIEW_MAX_WIDTH_PX / a4WidthPx),
    [a4WidthPx]
  );

  const isCustom = sizeKey === "custom";
  const customValid =
    !isCustom ||
    (customWidthMm >= CUSTOM_WIDTH_MIN &&
      customWidthMm <= CUSTOM_WIDTH_MAX &&
      customHeightMm >= CUSTOM_HEIGHT_MIN &&
      customHeightMm <= CUSTOM_HEIGHT_MAX);

  const resolvedLabelWidthMm = isCustom ? customWidthMm : LABEL_SIZES[sizeKey].width;
  const resolvedLabelHeightMm = isCustom ? customHeightMm : LABEL_SIZES[sizeKey].height;

  const availableWidthMm = A4_WIDTH_MM - A4_PADDING_MM * 2;
  const availableHeightMm = A4_HEIGHT_MM - A4_PADDING_MM * 2;
  const columns = Math.max(
    0,
    Math.floor((availableWidthMm + A4_GAP_MM) / (resolvedLabelWidthMm + A4_GAP_MM))
  );
  const rows = Math.max(
    0,
    Math.floor((availableHeightMm + A4_GAP_MM) / (resolvedLabelHeightMm + A4_GAP_MM))
  );
  const calculatedMaxLabels = columns * rows;

  const labelCount = parseInt(labelCountInput, 10);
  const labelCountValid =
    !isNaN(labelCount) && labelCount >= 1 && labelCount <= Math.max(calculatedMaxLabels, 0);

  // Set/adjust default label count whenever size changes, unless user has
  // manually typed a value that still fits within the new maximum.
  useEffect(() => {
    queueMicrotask(() => {
      if (!isLabelCountManualEdited) {
        setLabelCountInput(String(Math.max(calculatedMaxLabels, 0)));
        return;
      }
      setLabelCountInput((prev) => {
        const current = parseInt(prev, 10);
        if (!isNaN(current) && current > calculatedMaxLabels) {
          return String(Math.max(calculatedMaxLabels, 0));
        }
        return prev;
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [calculatedMaxLabels]);

  if (!open) return null;

  const qrValue = asset.qrCodeValue || asset.assetCode || asset.id;
  const singleWidth = Math.round(resolvedLabelWidthMm * PX_PER_MM);
  const singleHeight = Math.round(resolvedLabelHeightMm * PX_PER_MM);
  const minSideMm = Math.min(resolvedLabelWidthMm, resolvedLabelHeightMm);
  const singleQrSizeMm = Math.max(
    18,
    Math.min(minSideMm * 0.62, resolvedLabelHeightMm - 12)
  );
  const singleQrSize = Math.round(singleQrSizeMm * PX_PER_MM);

  const canOutput = customValid && (mode === "single" || labelCountValid);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(asset.assetCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard tidak tersedia — abaikan diam-diam
    }
  };

  const handleDownload = async () => {
    if (!canOutput) return;
    const target = mode === "single" ? singleLabelRef.current : sheetRef.current;
    if (!target) return;
    setDownloading(true);
    try {
      const dataUrl = await toPng(target, {
        pixelRatio: 3,
        backgroundColor: "#ffffff",
      });
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download =
        mode === "single"
          ? `QR-${asset.assetCode}.png`
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
    setIsLabelCountManualEdited(true);
    const parsed = parseInt(labelCountInput, 10);
    if (isNaN(parsed) || parsed < 1) {
      setLabelCountInput("1");
      return;
    }
    if (parsed > calculatedMaxLabels) {
      setLabelCountInput(String(Math.max(calculatedMaxLabels, 0)));
    }
  };

  const previewLabelCount = labelCountValid ? labelCount : 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 print:p-0 print:bg-white">
      <style>{`
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
          @page {
            size: ${
              mode === "single"
                ? `${resolvedLabelWidthMm}mm ${resolvedLabelHeightMm}mm`
                : "A4"
            };
            margin: ${mode === "single" ? "0" : `${A4_PADDING_MM}mm`};
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
            ) : calculatedMaxLabels < 1 ? (
              <p className="text-sm text-amber-600 py-8 text-center">
                Ukuran label terlalu besar untuk A4.
              </p>
            ) : (
              <div className="w-full flex justify-center py-4">
                <div
                  className="a4-scale-wrapper"
                  style={{
                    width: a4WidthPx * a4Scale,
                    height: a4HeightPx * a4Scale,
                  }}
                >
                  <div
                    ref={sheetRef}
                    className="print-area bg-white shadow-sm origin-top-left"
                    style={{
                      width: a4WidthPx,
                      height: a4HeightPx,
                      padding: Math.round(A4_PADDING_MM * PX_PER_MM),
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
                        gap: Math.round(A4_GAP_MM * PX_PER_MM),
                      }}
                    >
                      {Array.from({ length: previewLabelCount }).map((_, i) => (
                        <div
                          key={i}
                          className="border border-dashed border-slate-300 rounded flex items-center justify-center overflow-hidden"
                        >
                          <QrLabelContent
                            asset={asset}
                            qrValue={qrValue}
                            qrPixelSize={Math.round(
                              Math.min(resolvedLabelWidthMm, resolvedLabelHeightMm) *
                                PX_PER_MM *
                                0.55
                            )}
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
            )}
            {mode === "a4" && customValid && calculatedMaxLabels >= 1 && (
              <p className="text-xs text-slate-400 mt-2 text-center">
                {previewLabelCount} label akan dicetak dalam A4 ({columns} kolom x {rows} baris,
                maksimal {calculatedMaxLabels} label).
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
              <div className="mb-4">
                <label className="block text-xs font-medium text-slate-500 mb-1.5">
                  Jumlah Label
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={labelCountInput}
                  onChange={(e) => {
                    setIsLabelCountManualEdited(true);
                    setLabelCountInput(e.target.value.replace(/[^0-9]/g, ""));
                  }}
                  onBlur={handleLabelCountBlur}
                  className="input cursor-text"
                />
                <p className="text-xs text-slate-400 mt-1">
                  Maksimal {calculatedMaxLabels} label untuk ukuran ini.
                </p>
                {!labelCountValid && (
                  <p className="text-xs text-red-600 mt-1">
                    {calculatedMaxLabels < 1
                      ? "Ukuran label terlalu besar untuk A4."
                      : parseInt(labelCountInput, 10) > calculatedMaxLabels
                      ? `Maksimal ${calculatedMaxLabels} label untuk ukuran ini.`
                      : "Jumlah label minimal 1."}
                  </p>
                )}
              </div>
            )}

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
                {downloading ? "Menyiapkan..." : "Download PNG"}
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
