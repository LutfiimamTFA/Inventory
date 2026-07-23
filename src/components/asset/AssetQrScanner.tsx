"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BarcodeFormat,
  BrowserMultiFormatReader,
  type IScannerControls,
} from "@zxing/browser";
import {
  Camera,
  FlashlightOff,
  Flashlight,
  RefreshCw,
  RotateCw,
  Video,
  VideoOff,
  ZoomIn,
} from "lucide-react";

// Section F/G — capabilities zoom/torch belum masuk lib.dom.d.ts standar
// (masih draft W3C), jadi getCapabilities()/applyConstraints() perlu tipe
// longgar di sini. Tidak mempengaruhi kode lain di luar file ini.
interface ExtendedTrackCapabilities extends MediaTrackCapabilities {
  zoom?: { min: number; max: number; step: number };
  torch?: boolean;
}
interface ExtendedTrackSettings extends MediaTrackSettings {
  zoom?: number;
  torch?: boolean;
}
interface ExtendedTrackConstraintSet extends MediaTrackConstraintSet {
  zoom?: number;
  torch?: boolean;
  focusMode?: string;
  exposureMode?: string;
  whiteBalanceMode?: string;
}

// Section A/B — BarcodeDetector native (Chrome/Android) belum masuk
// lib.dom.d.ts baku, jadi dideklarasikan manual di sini saja.
interface NativeBarcodeResult {
  rawValue: string;
}
interface NativeBarcodeDetector {
  detect(source: CanvasImageSource): Promise<NativeBarcodeResult[]>;
}
interface NativeBarcodeDetectorConstructor {
  new (options?: { formats: string[] }): NativeBarcodeDetector;
}
declare global {
  interface Window {
    BarcodeDetector?: NativeBarcodeDetectorConstructor;
  }
}

// Section B — SATU sumber ukuran viewport kamera, dipakai identik untuk
// video aktif maupun placeholder "Mulai Scan", supaya tidak ada lompatan
// tinggi saat kamera dinyalakan/dimatikan. Sengaja fixed height (BUKAN
// aspect-video) karena aspect-video di card lebar bikin tinggi ikut
// membesar mengikuti lebar card.
const SCANNER_VIEWPORT_CLASS = "h-[220px] w-full sm:h-[240px] lg:h-[260px]";

const AUTO_ZOOM_START_DELAY_MS = 1500;
const AUTO_ZOOM_INTERVAL_MS = 1300;
const AUTO_ZOOM_STEP = 0.25;

export interface AssetQrScannerProps {
  onScan: (rawValue: string) => void;
  onError?: (message: string) => void;
}

function pickBackCameraId(devices: MediaDeviceInfo[]): string | undefined {
  const backKeywords = /back|rear|environment|belakang|kamera belakang/i;
  const back = devices.find((d) => backKeywords.test(d.label));
  return (back || devices[0])?.deviceId;
}

function getCameraErrorMessage(error: unknown): string {
  const name = error instanceof Error ? error.name : "";
  switch (name) {
    case "NotAllowedError":
      return "Izin kamera ditolak. Buka pengaturan browser lalu izinkan kamera untuk QHSE Care.";
    case "NotFoundError":
      return "Kamera tidak ditemukan di perangkat ini.";
    case "NotReadableError":
      return "Kamera sedang dipakai aplikasi lain. Tutup aplikasi kamera/meeting lalu coba lagi.";
    case "OverconstrainedError":
      return "Kamera tidak mendukung pengaturan yang diminta. Sistem akan mencoba mode kamera standar.";
    case "SecurityError":
      return "Kamera hanya bisa digunakan pada HTTPS atau localhost.";
    default:
      return "Kamera belum bisa diakses. Gunakan input manual kode asset.";
  }
}

export default function AssetQrScanner({ onScan, onError }: AssetQrScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const codeReaderRef = useRef<BrowserMultiFormatReader | null>(null);
  const controlsRef = useRef<IScannerControls | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const hasScannedRef = useRef(false);
  const autoZoomTimeoutRef = useRef<number | null>(null);
  const autoZoomIntervalRef = useRef<number | null>(null);
  const nativeDetectorRef = useRef<NativeBarcodeDetector | null>(null);
  const nativeScanFrameRef = useRef<number | null>(null);

  const [scanning, setScanning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState("");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string | undefined>(undefined);

  const [zoomCapability, setZoomCapability] = useState<{ min: number; max: number; step: number } | null>(null);
  const [zoomValue, setZoomValue] = useState(0);
  const [hasManualZoom, setHasManualZoom] = useState(false);
  const [autoZoomEnabled, setAutoZoomEnabled] = useState(true);
  const [torchSupported, setTorchSupported] = useState(false);
  const [torchOn, setTorchOn] = useState(false);

  const clearAutoZoomTimers = useCallback(() => {
    if (autoZoomTimeoutRef.current) window.clearTimeout(autoZoomTimeoutRef.current);
    if (autoZoomIntervalRef.current) window.clearInterval(autoZoomIntervalRef.current);
    autoZoomTimeoutRef.current = null;
    autoZoomIntervalRef.current = null;
  }, []);

  const getVideoTrack = useCallback((): MediaStreamTrack | null => {
    return streamRef.current?.getVideoTracks()[0] || null;
  }, []);

  const applyZoom = useCallback(async (nextZoom: number) => {
    const track = getVideoTrack();
    if (!track) return;
    try {
      await track.applyConstraints({
        advanced: [{ zoom: nextZoom } as ExtendedTrackConstraintSet],
      });
      setZoomValue(nextZoom);
    } catch {
      // applyConstraints bisa gagal di sebagian device — jangan crash,
      // slider/auto zoom cukup berhenti diam-diam.
    }
  }, [getVideoTrack]);

  const stopScanner = useCallback(() => {
    clearAutoZoomTimers();
    if (nativeScanFrameRef.current) cancelAnimationFrame(nativeScanFrameRef.current);
    nativeScanFrameRef.current = null;
    nativeDetectorRef.current = null;
    controlsRef.current?.stop();
    controlsRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setScanning(false);
    setTorchOn(false);
    setZoomCapability(null);
    setHasManualZoom(false);
  }, [clearAutoZoomTimers]);

  const handleDecoded = useCallback(
    (text: string) => {
      if (hasScannedRef.current) return;
      hasScannedRef.current = true;
      navigator.vibrate?.(120);
      stopScanner();
      onScan(text);
    },
    [onScan, stopScanner]
  );

  const startAutoZoomLoop = useCallback(
    (capability: { min: number; max: number; step: number }) => {
      clearAutoZoomTimers();
      autoZoomTimeoutRef.current = window.setTimeout(() => {
        autoZoomIntervalRef.current = window.setInterval(() => {
          if (hasScannedRef.current || hasManualZoom || !autoZoomEnabled) return;
          setZoomValue((prev) => {
            const next = Math.min(prev + AUTO_ZOOM_STEP, capability.max);
            if (next === prev) {
              clearAutoZoomTimers();
              return prev;
            }
            applyZoom(next);
            return next;
          });
        }, AUTO_ZOOM_INTERVAL_MS);
      }, AUTO_ZOOM_START_DELAY_MS);
    },
    [applyZoom, autoZoomEnabled, clearAutoZoomTimers, hasManualZoom]
  );

  // Section C — jalur fallback ZXing, dipakai baik sebagai jalur utama
  // (browser tidak punya BarcodeDetector) maupun sebagai fallback kalau
  // native detector tiba-tiba error di tengah scan.
  const startZxingDecode = useCallback(
    async (stream: MediaStream) => {
      if (!codeReaderRef.current) {
        codeReaderRef.current = new BrowserMultiFormatReader();
        codeReaderRef.current.possibleFormats = [BarcodeFormat.QR_CODE];
      }
      const controls = await codeReaderRef.current.decodeFromStream(
        stream,
        videoRef.current || undefined,
        (result) => {
          if (result) handleDecoded(result.getText());
        }
      );
      controlsRef.current = controls;
    },
    [handleDecoded]
  );

  // Section A/B — scan loop BarcodeDetector native. Membaca SELURUH frame
  // video (bukan cuma area kotak panduan) via requestAnimationFrame supaya
  // seresponsif mungkin di Android Chrome. Kalau native detector error di
  // tengah jalan (jarang, tapi bisa terjadi di sebagian device), turun ke
  // ZXing tanpa mengulang getUserMedia (stream yang sama dipakai lagi).
  // Disimpan lewat ref (bukan langsung useCallback self-reference) supaya
  // pemanggilan rekursif via requestAnimationFrame tidak menangkap closure
  // basi/melanggar aturan react-hooks soal referensi sebelum deklarasi.
  const scanWithNativeDetectorRef = useRef<() => void>(() => {});

  useEffect(() => {
    scanWithNativeDetectorRef.current = () => {
      const detector = nativeDetectorRef.current;
      if (!detector || !videoRef.current || hasScannedRef.current) return;

      detector
        .detect(videoRef.current)
        .then((barcodes) => {
          if (hasScannedRef.current) return;
          const rawValue = barcodes?.[0]?.rawValue;
          if (rawValue) {
            handleDecoded(rawValue);
            return;
          }
          nativeScanFrameRef.current = requestAnimationFrame(() => scanWithNativeDetectorRef.current());
        })
        .catch((err) => {
          console.warn("[QR Native Detector] gagal, fallback ke ZXing:", err);
          nativeDetectorRef.current = null;
          if (streamRef.current) startZxingDecode(streamRef.current).catch(() => {});
        });
    };
  }, [handleDecoded, startZxingDecode]);

  const startScanner = useCallback(
    async (preferredDeviceId?: string) => {
      setError("");
      setStarting(true);
      hasScannedRef.current = false;

      try {
        const videoDevices = await BrowserMultiFormatReader.listVideoInputDevices();
        setDevices(videoDevices);
        const deviceId = preferredDeviceId || selectedDeviceId || pickBackCameraId(videoDevices);
        setSelectedDeviceId(deviceId);

        // Section E — resolusi tinggi + frameRate 30fps kalau browser/device
        // dukung. Kalau constraint ini gagal (Overconstrained), fallback ke
        // constraint standar supaya scan tetap jalan.
        const idealConstraints: MediaStreamConstraints = {
          video: {
            ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: "environment" } }),
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            frameRate: { ideal: 30 },
          } as MediaTrackConstraints,
          audio: false,
        };

        let stream: MediaStream;
        try {
          stream = await navigator.mediaDevices.getUserMedia(idealConstraints);
        } catch (err) {
          if (err instanceof Error && err.name === "OverconstrainedError") {
            onError?.(getCameraErrorMessage(err));
            stream = await navigator.mediaDevices.getUserMedia({
              video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: "environment" },
              audio: false,
            });
          } else {
            throw err;
          }
        }

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }

        const track = stream.getVideoTracks()[0];

        // Section E — focusMode/exposureMode/whiteBalanceMode continuous
        // kalau device dukung. TIDAK boleh bikin proses start gagal kalau
        // tidak didukung — cukup dicoba, diamkan kalau ditolak.
        try {
          await track.applyConstraints({
            advanced: [
              { focusMode: "continuous" },
              { exposureMode: "continuous" },
              { whiteBalanceMode: "continuous" },
            ] as ExtendedTrackConstraintSet[],
          });
        } catch (constraintError) {
          console.warn("[Camera] advanced constraints tidak didukung:", constraintError);
        }

        const capabilities = track.getCapabilities?.() as ExtendedTrackCapabilities | undefined;
        const settings = track.getSettings?.() as ExtendedTrackSettings | undefined;

        if (capabilities?.zoom) {
          const capability = {
            min: capabilities.zoom.min,
            max: capabilities.zoom.max,
            step: capabilities.zoom.step || 0.1,
          };
          setZoomCapability(capability);
          setZoomValue(settings?.zoom || capability.min);
          setHasManualZoom(false);
          if (autoZoomEnabled) startAutoZoomLoop(capability);
        } else {
          setZoomCapability(null);
        }
        setTorchSupported(!!capabilities?.torch);

        // Section A/B — pakai BarcodeDetector native kalau browser dukung
        // (umumnya Android Chrome, lebih cepat), fallback ke ZXing kalau
        // tidak ada.
        const hasNativeBarcodeDetector = typeof window !== "undefined" && "BarcodeDetector" in window;
        if (hasNativeBarcodeDetector && window.BarcodeDetector) {
          nativeDetectorRef.current = new window.BarcodeDetector({ formats: ["qr_code"] });
          setScanning(true);
          scanWithNativeDetectorRef.current();
        } else {
          setScanning(true);
          await startZxingDecode(stream);
        }
      } catch (err) {
        console.error("[AssetQrScanner] gagal mengakses kamera", err);
        const message = getCameraErrorMessage(err);
        setError(message);
        onError?.(message);
        setScanning(false);
      } finally {
        setStarting(false);
      }
    },
    [autoZoomEnabled, onError, selectedDeviceId, startAutoZoomLoop, startZxingDecode]
  );

  const switchCamera = useCallback(() => {
    if (devices.length < 2) return;
    const currentIndex = devices.findIndex((d) => d.deviceId === selectedDeviceId);
    const next = devices[(currentIndex + 1) % devices.length];
    stopScanner();
    startScanner(next.deviceId);
  }, [devices, selectedDeviceId, startScanner, stopScanner]);

  const handleZoomSliderChange = (value: number) => {
    setHasManualZoom(true);
    clearAutoZoomTimers();
    applyZoom(value);
  };

  const toggleTorch = async () => {
    const track = getVideoTrack();
    if (!track) return;
    const next = !torchOn;
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as ExtendedTrackConstraintSet] });
      setTorchOn(next);
    } catch {
      // torch tidak didukung di sebagian besar browser desktop — abaikan.
    }
  };

  // Section G — "Fokus Ulang", buat kasus kamera sempat gagal fokus (mis.
  // sempat digerakkan) — coba re-apply continuous focus/exposure. Aman
  // diabaikan kalau device tidak dukung.
  const refocusCamera = async () => {
    const track = getVideoTrack();
    if (!track) return;
    try {
      await track.applyConstraints({
        advanced: [
          { focusMode: "continuous" },
          { exposureMode: "continuous" },
          { whiteBalanceMode: "continuous" },
        ] as ExtendedTrackConstraintSet[],
      });
    } catch {
      // tidak didukung — abaikan diam-diam.
    }
  };

  useEffect(() => {
    return () => {
      stopScanner();
    };
  }, [stopScanner]);

  return (
    <div className="mx-auto w-full max-w-[640px]">
      <div className={`relative overflow-hidden rounded-3xl bg-slate-950 ${SCANNER_VIEWPORT_CLASS}`}>
        <video ref={videoRef} className="h-full w-full object-cover" muted playsInline autoPlay />

        {scanning && (
          <>
            {/* Section F — kotak ini HANYA bantuan visual. Scanner (native
                detector maupun ZXing decodeFromStream) tetap membaca
                seluruh frame video, bukan cuma area di dalam kotak. */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="h-[140px] w-[140px] rounded-2xl border-2 border-cyan-400 shadow-[0_0_0_9999px_rgba(15,23,42,0.28)] sm:h-[160px] sm:w-[160px]" />
            </div>
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-3 py-1.5 text-xs text-white">
              Arahkan QR ke area kamera
            </div>
          </>
        )}

        {!scanning && (
          <button
            type="button"
            onClick={() => startScanner()}
            disabled={starting}
            className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm font-medium text-white disabled:opacity-70"
          >
            <Camera className="h-6 w-6" />
            {starting ? "Membuka kamera..." : "Mulai Scan"}
          </button>
        )}
      </div>

      {error && (
        <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      )}

      <p className="mt-2 text-xs text-slate-400">
        QR tidak harus pas di kotak, tapi pastikan tidak blur dan cukup cahaya.
      </p>

      {scanning && (
        <div className="mt-3 space-y-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <button
              type="button"
              onClick={stopScanner}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <VideoOff size={14} />
              Stop Kamera
            </button>
            {devices.length > 1 ? (
              <button
                type="button"
                onClick={switchCamera}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                <RefreshCw size={14} />
                Ganti Kamera
              </button>
            ) : (
              <span />
            )}
            <button
              type="button"
              onClick={refocusCamera}
              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <RotateCw size={14} />
              Fokus Ulang
            </button>
            {torchSupported ? (
              <button
                type="button"
                onClick={toggleTorch}
                className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                {torchOn ? <Flashlight size={14} /> : <FlashlightOff size={14} />}
                Flash
              </button>
            ) : (
              <span />
            )}
          </div>

          {zoomCapability ? (
            <div className="rounded-2xl border border-slate-200 p-3">
              <div className="mb-2 flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-sm font-semibold text-slate-600">
                  <ZoomIn size={14} />
                  Zoom Kamera
                </span>
                <label className="flex items-center gap-2 text-sm text-slate-500">
                  <input
                    type="checkbox"
                    checked={autoZoomEnabled}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setAutoZoomEnabled(checked);
                      if (checked && zoomCapability && !hasManualZoom) startAutoZoomLoop(zoomCapability);
                      else clearAutoZoomTimers();
                    }}
                  />
                  Auto Zoom
                </label>
              </div>
              <input
                type="range"
                min={zoomCapability.min}
                max={zoomCapability.max}
                step={zoomCapability.step}
                value={zoomValue}
                onChange={(e) => handleZoomSliderChange(Number(e.target.value))}
                className="w-full"
              />
            </div>
          ) : (
            <p className="flex items-center gap-1.5 text-xs text-slate-400">
              <Video size={13} />
              Auto zoom tidak didukung di perangkat ini.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
