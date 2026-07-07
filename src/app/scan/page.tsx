"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  collection,
  getDocs,
  limit,
  query,
  where,
} from "firebase/firestore";
import { Html5Qrcode } from "html5-qrcode";
import { Camera, Search, ScanLine, PackageSearch } from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { Asset } from "@/lib/types";
import { ASSET_STATUS_COLOR, ASSET_STATUS_LABEL } from "@/lib/utils";
import ProtectedLayout from "@/components/ProtectedLayout";
import PageHeader from "@/components/PageHeader";
import Badge from "@/components/Badge";
import EmptyState from "@/components/EmptyState";
import { BorrowModal, ReturnModal } from "@/components/BorrowReturnModal";

const SCANNER_ID = "qr-scanner-region";

export default function ScanPage() {
  const { assetUser } = useAuth();
  const [scanning, setScanning] = useState(false);
  const [manualCode, setManualCode] = useState("");
  const [asset, setAsset] = useState<Asset | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState("");
  const [borrowOpen, setBorrowOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);

  const lookupAsset = async (code: string) => {
    setError("");
    setNotFound(false);
    setAsset(null);
    const trimmed = code.trim();
    if (!trimmed) return;
    const q = query(
      collection(db, "assets"),
      where("qrCodeValue", "==", trimmed),
      limit(1)
    );
    const snap = await getDocs(q);
    if (snap.empty) {
      setNotFound(true);
      return;
    }
    const d = snap.docs[0];
    setAsset({ id: d.id, ...d.data() } as Asset);
  };

  const startScanner = async () => {
    setError("");
    setScanning(true);
  };

  useEffect(() => {
    if (!scanning) return;
    const scanner = new Html5Qrcode(SCANNER_ID);
    scannerRef.current = scanner;
    let isRunning = false;

    const safeStop = async () => {
      if (!isRunning) return;
      isRunning = false;
      try {
        await scanner.stop();
      } catch {
        // scanner sudah berhenti/tidak sempat mulai — abaikan
      }
    };

    scanner
      .start(
        { facingMode: "environment" },
        { fps: 10, qrbox: 240 },
        async (decodedText) => {
          await lookupAsset(decodedText);
          await safeStop();
          setScanning(false);
        },
        undefined
      )
      .then(() => {
        isRunning = true;
      })
      .catch(() => {
        setError("Tidak bisa mengakses kamera. Gunakan input manual.");
        setScanning(false);
      });

    return () => {
      safeStop();
    };
  }, [scanning]);

  const isBorrowedByMe = asset?.currentBorrowerUid === assetUser?.uid;
  const canBorrow =
    asset && asset.assetStatus === "available" && asset.isBorrowable && !isBorrowedByMe;
  const borrowedByOther =
    asset && asset.assetStatus === "borrowed" && !isBorrowedByMe;

  return (
    <ProtectedLayout>
      <PageHeader
        title="Scan QR Aset"
        subtitle="Arahkan kamera ke QR code pada aset, atau masukkan kode secara manual."
      />

      <div className="grid md:grid-cols-2 gap-5">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 md:p-6">
          <div className="flex items-center gap-2 mb-4">
            <div className="h-9 w-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
              <ScanLine size={18} />
            </div>
            <h2 className="font-semibold text-slate-800">Kamera Scanner</h2>
          </div>

          {!scanning ? (
            <button
              onClick={startScanner}
              className="w-full inline-flex flex-col items-center justify-center gap-2 rounded-2xl bg-gradient-to-br from-blue-600 to-teal-500 text-white py-10 text-sm font-medium hover:brightness-105 shadow-md shadow-blue-900/20"
            >
              <Camera size={30} />
              Mulai Scan
            </button>
          ) : (
            <div
              id={SCANNER_ID}
              className="w-full rounded-2xl overflow-hidden border border-slate-200"
            />
          )}
          {error && (
            <p className="text-sm text-red-600 mt-3 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
              {error}
            </p>
          )}

          <div className="mt-6 pt-5 border-t border-slate-100">
            <h3 className="text-sm font-semibold text-slate-700 mb-2">
              Input Manual Kode Aset
            </h3>
            <div className="flex gap-2">
              <input
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                placeholder="mis. LAP-2601-AB12"
                className="input"
              />
              <button
                onClick={() => lookupAsset(manualCode)}
                className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50 inline-flex items-center gap-1.5 shrink-0"
              >
                <Search size={14} />
                Cari
              </button>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 md:p-6">
          <h2 className="font-semibold text-slate-800 mb-4">Hasil</h2>
          {notFound && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
              Kode aset tidak ditemukan.
            </p>
          )}
          {!asset && !notFound && (
            <EmptyState
              icon={PackageSearch}
              title="Belum ada aset dipindai"
              description="Scan QR atau masukkan kode aset untuk melihat detail."
            />
          )}
          {asset && (
            <div className="space-y-4">
              <div>
                <Link
                  href={`/assets/${asset.id}`}
                  className="font-semibold text-slate-900 hover:underline text-lg"
                >
                  {asset.assetName}
                </Link>
                <p className="text-sm text-slate-400">{asset.assetCode}</p>
              </div>
              <Badge
                label={ASSET_STATUS_LABEL[asset.assetStatus]}
                colorClass={ASSET_STATUS_COLOR[asset.assetStatus]}
              />
              {borrowedByOther && (
                <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                  Sedang dipinjam oleh {asset.currentBorrowerName}.
                </p>
              )}
              <div className="flex gap-2 pt-2">
                {canBorrow && (
                  <button
                    onClick={() => setBorrowOpen(true)}
                    className="rounded-xl bg-gradient-to-r from-blue-600 to-teal-500 text-white px-5 py-2.5 text-sm font-medium hover:brightness-105 shadow-md shadow-blue-900/20"
                  >
                    Pinjam
                  </button>
                )}
                {isBorrowedByMe && (
                  <button
                    onClick={() => setReturnOpen(true)}
                    className="rounded-xl bg-emerald-600 text-white px-5 py-2.5 text-sm font-medium hover:bg-emerald-700 shadow-md shadow-emerald-900/10"
                  >
                    Kembalikan
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {asset && (
        <>
          <BorrowModal
            asset={asset}
            open={borrowOpen}
            onClose={() => setBorrowOpen(false)}
            onDone={() => {
              setBorrowOpen(false);
              lookupAsset(asset.qrCodeValue);
            }}
          />
          <ReturnModal
            asset={asset}
            open={returnOpen}
            onClose={() => setReturnOpen(false)}
            onDone={() => {
              setReturnOpen(false);
              lookupAsset(asset.qrCodeValue);
            }}
          />
        </>
      )}
    </ProtectedLayout>
  );
}
