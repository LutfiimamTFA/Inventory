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
}

const AUTO_ZOOM_START_DELAY_MS = 2000;
const AUTO_ZOOM_INTERVAL_MS = 1500;
const AUTO_ZOOM_STEP = 0.2;

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

        // Section C — resolusi tinggi + focusMode continuous kalau
        // browser/device dukung. Kalau constraint ini gagal (Overconstrained),
        // fallback ke constraint standar supaya scan tetap jalan.
        const idealConstraints: MediaStreamConstraints = {
          video: {
            ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: "environment" } }),
            width: { ideal: 1920 },
            height: { ideal: 1080 },
            advanced: [{ focusMode: "continuous" } as ExtendedTrackConstraintSet],
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
        setScanning(true);
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
    [autoZoomEnabled, handleDecoded, onError, selectedDeviceId, startAutoZoomLoop]
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

  useEffect(() => {
    return () => {
      stopScanner();
    };
  }, [stopScanner]);

  return (
    <div>
      <div className="relative overflow-hidden rounded-2xl bg-slate-900">
        <video
          ref={videoRef}
          className="h-[320px] w-full object-cover md:h-[360px]"
          muted
          playsInline
        />

        {scanning && (
          <>
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div className="h-64 w-64 rounded-3xl border-2 border-cyan-400 shadow-[0_0_0_9999px_rgba(15,23,42,0.45)] md:h-80 md:w-80" />
            </div>
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full bg-black/60 px-4 py-2 text-xs text-white">
              Arahkan QR ke dalam kotak
            </div>
          </>
        )}

        {!scanning && (
          <button
            type="button"
            onClick={() => startScanner()}
            disabled={starting}
            className="flex h-[320px] w-full flex-col items-center justify-center gap-2 text-sm font-medium text-white disabled:opacity-70 md:h-[360px]"
          >
            <Camera size={30} />
            {starting ? "Membuka kamera..." : "Mulai Scan"}
          </button>
        )}
      </div>

      {error && (
        <p className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
          {error}
        </p>
      )}

      <p className="mt-3 text-xs text-slate-400">
        Pastikan QR tidak blur, cukup cahaya, dan masuk ke kotak panduan.
      </p>

      {scanning && (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={stopScanner}
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <VideoOff size={14} />
              Stop Kamera
            </button>
            {devices.length > 1 && (
              <button
                type="button"
                onClick={switchCamera}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                <RefreshCw size={14} />
                Ganti Kamera
              </button>
            )}
            {torchSupported && (
              <button
                type="button"
                onClick={toggleTorch}
                className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
              >
                {torchOn ? <Flashlight size={14} /> : <FlashlightOff size={14} />}
                Flash
              </button>
            )}
          </div>

          {zoomCapability ? (
            <div className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="mb-2 flex items-center justify-between text-xs font-semibold text-slate-600">
                <span className="flex items-center gap-1.5">
                  <ZoomIn size={14} />
                  Zoom Kamera
                </span>
                <label className="flex items-center gap-1.5 font-normal text-slate-500">
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
              Zoom kamera tidak didukung di perangkat ini.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
