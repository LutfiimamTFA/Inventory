"use client";

import { useMemo, useRef, useState } from "react";
import Image from "next/image";
import {
  ArrowLeft,
  CheckCircle2,
  PackageSearch,
  RotateCcw,
  Search,
  ShoppingBag,
  Undo2,
  XCircle,
} from "lucide-react";
import AssetQrScanner from "@/components/asset/AssetQrScanner";
import {
  PUBLIC_BORROW_DIRECTORY,
  searchEmployeesInDivision,
} from "@/lib/publicBorrowDirectory";

// Section "Halaman Utama Peminjaman Tanpa Login" — seluruh alur kios publik
// (pinjam/kembalikan tanpa login) sengaja dibuat dalam SATU file dengan state
// machine sederhana (bukan router Next.js multi-halaman, bukan library state
// tambahan) supaya Tahap 1 ini tetap terkontrol dan mudah direview. Dipanggil
// dari src/app/page.tsx HANYA untuk pengunjung yang belum login — user yang
// sudah login tetap diarahkan ke dashboard sesuai role seperti sebelumnya.
//
// Semua baca/tulis di sini lewat API route Admin SDK (/api/public/assets/
// by-code, /api/public/borrow, /api/public/return) — TIDAK ada akses
// Firestore client SDK langsung dari komponen ini, dan firestore.rules tidak
// diubah sama sekali untuk fitur ini.

type Mode = "borrow" | "return";

type Step =
  | "idle"
  | "scanning"
  | "asset_not_found"
  | "asset_not_borrowable"
  | "picking_borrower"
  | "current_holder"
  | "confirming"
  | "submitting"
  | "success"
  | "error";

interface PublicAssetPayload {
  id: string;
  assetCode: string;
  assetName: string;
  categoryName: string;
  locationText: string;
  photoUrl: string | null;
  assetStatusLabel: string;
  trackingMode: string | null;
  isBorrowable: boolean;
  borrowAvailability: "available_to_borrow" | "not_borrowable_tracking_mode" | "currently_borrowed" | "unavailable_other";
  currentHolderName: string | null;
  currentHolderDivision: string | null;
  currentBorrowingId: string | null;
}

interface SuccessSummary {
  mode: Mode;
  assetName: string;
  assetCode: string;
  referenceNumber: string;
  borrowerName?: string;
  borrowerDivision?: string;
  transactionAt: Date;
}

function notBorrowableReason(payload: PublicAssetPayload): string {
  switch (payload.borrowAvailability) {
    case "not_borrowable_tracking_mode":
      return "Aset ini bukan jenis barang yang bisa dipinjam lewat kios (statusnya terpasang tetap/ditugaskan ke PIC tertentu).";
    case "currently_borrowed":
      return "Aset ini sedang dipinjam orang lain.";
    case "unavailable_other":
      return `Aset ini sedang tidak tersedia (status: ${payload.assetStatusLabel}).`;
    default:
      return "Aset ini sedang tidak tersedia untuk dipinjam.";
  }
}

export default function PublicBorrowLanding() {
  const [step, setStep] = useState<Step>("idle");
  const [mode, setMode] = useState<Mode>("borrow");
  const [manualCode, setManualCode] = useState("");
  const [scanError, setScanError] = useState("");
  const [asset, setAsset] = useState<PublicAssetPayload | null>(null);
  const [borrowerDivisionId, setBorrowerDivisionId] = useState("");
  const [borrowerName, setBorrowerName] = useState("");
  const [nameSearch, setNameSearch] = useState("");
  const [estimatedReturnAt, setEstimatedReturnAt] = useState("");
  const [returnCondition, setReturnCondition] = useState<"good" | "minor_damage" | "heavy_damage">("good");
  const [errorMessage, setErrorMessage] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [summary, setSummary] = useState<SuccessSummary | null>(null);
  const [loadingLookup, setLoadingLookup] = useState(false);
  // Section "Hindari transaksi ganda akibat tombol ditekan berulang" — guard
  // sinkron (bukan cuma state `step`) supaya dua klik cepat sebelum React
  // sempat re-render tidak memicu dua request submit sekaligus.
  const submitLockRef = useRef(false);

  const divisionEmployees = useMemo(
    () => searchEmployeesInDivision(borrowerDivisionId, nameSearch),
    [borrowerDivisionId, nameSearch]
  );

  function resetAll() {
    submitLockRef.current = false;
    setStep("idle");
    setMode("borrow");
    setManualCode("");
    setScanError("");
    setAsset(null);
    setBorrowerDivisionId("");
    setBorrowerName("");
    setNameSearch("");
    setEstimatedReturnAt("");
    setReturnCondition("good");
    setErrorMessage("");
    setErrorCode("");
    setSummary(null);
  }

  function startFlow(nextMode: Mode) {
    setMode(nextMode);
    setAsset(null);
    setScanError("");
    setManualCode("");
    setBorrowerDivisionId("");
    setBorrowerName("");
    setNameSearch("");
    // Section "Langkah 2 — Isi Identitas Peminjam" — untuk Pinjam Barang,
    // identitas peminjam diisi DULU, baru scan QR di langkah berikutnya.
    // Alur Kembalikan Barang tidak butuh isi identitas (identitas peminjam
    // asli diambil dari transaksi aktif tersimpan, ditampilkan setelah
    // scan), jadi langsung ke step scanning.
    setStep(nextMode === "borrow" ? "picking_borrower" : "scanning");
  }

  async function lookupAsset(rawCode: string) {
    const trimmed = rawCode.trim();
    if (!trimmed || loadingLookup) return;
    setLoadingLookup(true);
    setScanError("");
    try {
      const res = await fetch(`/api/public/assets/by-code?code=${encodeURIComponent(trimmed)}`);
      if (res.status === 404) {
        setStep("asset_not_found");
        return;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setScanError(data?.error || "Gagal memuat data asset. Coba lagi.");
        return;
      }
      const data = await res.json();
      const payload = data.asset as PublicAssetPayload;
      setAsset(payload);

      if (mode === "borrow") {
        if (payload.borrowAvailability !== "available_to_borrow") {
          setStep("asset_not_borrowable");
          return;
        }
        // Section — identitas peminjam sudah dipilih di langkah sebelumnya
        // (picking_borrower terjadi SEBELUM scan untuk alur Pinjam Barang),
        // jadi begitu asset ketemu & tersedia, langsung ke ringkasan.
        setStep("confirming");
      } else {
        if (payload.borrowAvailability !== "currently_borrowed") {
          setStep("asset_not_borrowable");
          return;
        }
        setStep("current_holder");
      }
    } catch {
      setScanError("Tidak bisa terhubung ke server. Periksa koneksi internet lalu coba lagi.");
    } finally {
      setLoadingLookup(false);
    }
  }

  function pickBorrower(name: string) {
    setBorrowerName(name);
    setScanError("");
    setManualCode("");
    setStep("scanning");
  }

  async function submitBorrow() {
    if (!asset || submitLockRef.current) return;
    submitLockRef.current = true;
    setStep("submitting");
    try {
      const res = await fetch("/api/public/borrow", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: asset.assetCode,
          borrowerDivisionId,
          borrowerName,
          estimatedReturnAt: estimatedReturnAt || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMessage(data?.error || "Gagal memproses peminjaman.");
        setErrorCode(data?.code || "");
        setStep("error");
        return;
      }
      setSummary({
        mode: "borrow",
        assetName: data.assetName,
        assetCode: data.assetCode,
        referenceNumber: data.borrowingId,
        borrowerName: data.borrowerName,
        borrowerDivision: data.borrowerDivision,
        transactionAt: new Date(),
      });
      setStep("success");
    } catch {
      setErrorMessage("Tidak bisa terhubung ke server. Periksa koneksi internet lalu coba lagi.");
      setErrorCode("");
      setStep("error");
    } finally {
      submitLockRef.current = false;
    }
  }

  async function submitReturn() {
    if (!asset || submitLockRef.current) return;
    submitLockRef.current = true;
    setStep("submitting");
    try {
      const res = await fetch("/api/public/return", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: asset.assetCode,
          borrowingId: asset.currentBorrowingId || undefined,
          returnCondition,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErrorMessage(data?.error || "Gagal memproses pengembalian.");
        setErrorCode(data?.code || "");
        setStep("error");
        return;
      }
      setSummary({
        mode: "return",
        assetName: data.assetName,
        assetCode: data.assetCode,
        referenceNumber: data.assetCode,
        transactionAt: new Date(),
      });
      setStep("success");
    } catch {
      setErrorMessage("Tidak bisa terhubung ke server. Periksa koneksi internet lalu coba lagi.");
      setErrorCode("");
      setStep("error");
    } finally {
      submitLockRef.current = false;
    }
  }

  function retryAfterError() {
    submitLockRef.current = false;
    if (errorCode === "ALREADY_BORROWED" || errorCode === "NO_ACTIVE_BORROWING" || errorCode === "NOT_BORROWABLE") {
      setStep("scanning");
    } else {
      setStep("confirming");
    }
  }

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-8">
      <div className="mx-auto w-full max-w-md">
        <header className="mb-6 flex flex-col items-center text-center">
          <Image src="/logo.png" alt="Environesia" width={56} height={56} className="mb-3 rounded-xl" />
          <h1 className="text-lg font-bold text-slate-900">Inventory & Asset Management</h1>
          <p className="text-sm text-slate-500">Environesia</p>
        </header>

        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
          {step === "idle" && (
            <div className="space-y-4">
              <p className="text-center text-sm text-slate-500">
                Pilih salah satu untuk mulai. Scan QR di barang menggunakan kamera HP.
              </p>
              <button
                type="button"
                onClick={() => startFlow("borrow")}
                className="flex w-full min-h-12 items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 py-3 text-base font-semibold text-white hover:bg-blue-700"
              >
                <ShoppingBag size={18} />
                Pinjam Barang
              </button>
              <button
                type="button"
                onClick={() => startFlow("return")}
                className="flex w-full min-h-12 items-center justify-center gap-2 rounded-2xl border border-slate-300 bg-white px-4 py-3 text-base font-semibold text-slate-700 hover:bg-slate-50"
              >
                <Undo2 size={18} />
                Kembalikan Barang
              </button>
            </div>
          )}

          {step === "scanning" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {mode === "borrow" && (
                    <button type="button" onClick={() => setStep("picking_borrower")} className="text-slate-400">
                      <ArrowLeft size={18} />
                    </button>
                  )}
                  <h2 className="text-sm font-semibold text-slate-800">
                    {mode === "borrow" ? "Scan Barang yang Dipinjam" : "Scan Barang yang Dikembalikan"}
                  </h2>
                </div>
                <button type="button" onClick={resetAll} className="text-xs font-medium text-slate-400">
                  Batal
                </button>
              </div>

              {mode === "borrow" && borrowerName && (
                <p className="rounded-xl bg-blue-50 px-3 py-2 text-sm text-blue-700">
                  Peminjam: <span className="font-semibold">{borrowerName}</span> (
                  {PUBLIC_BORROW_DIRECTORY.find((d) => d.id === borrowerDivisionId)?.label})
                </p>
              )}

              <AssetQrScanner onScan={(code) => lookupAsset(code)} onError={(message) => setScanError(message)} />

              {scanError && (
                <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600">
                  {scanError}
                </p>
              )}

              <div className="border-t border-slate-100 pt-4">
                <p className="mb-2 text-xs font-semibold text-slate-600">Atau masukkan kode aset manual</p>
                <div className="flex gap-2">
                  <input
                    value={manualCode}
                    onChange={(e) => setManualCode(e.target.value)}
                    placeholder="mis. AST-LAP-2026-0001"
                    className="min-h-12 w-full min-w-0 rounded-xl border border-slate-300 px-3 text-sm"
                  />
                  <button
                    type="button"
                    disabled={loadingLookup}
                    onClick={() => lookupAsset(manualCode)}
                    className="flex min-h-12 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 disabled:opacity-60"
                  >
                    <Search size={15} />
                    Cari
                  </button>
                </div>
              </div>
            </div>
          )}

          {step === "asset_not_found" && (
            <div className="space-y-4 text-center">
              <PackageSearch className="mx-auto text-slate-400" size={40} />
              <p className="text-sm text-slate-600">Asset tidak ditemukan. Pastikan QR/kode sudah benar.</p>
              <button
                type="button"
                onClick={() => setStep("scanning")}
                className="min-h-12 w-full rounded-2xl bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700"
              >
                Scan Ulang
              </button>
              <button type="button" onClick={resetAll} className="text-xs font-medium text-slate-400">
                Batal
              </button>
            </div>
          )}

          {step === "asset_not_borrowable" && asset && (
            <div className="space-y-4 text-center">
              <XCircle className="mx-auto text-amber-500" size={40} />
              <p className="text-sm font-semibold text-slate-800">{asset.assetName}</p>
              <p className="text-sm text-slate-600">
                {mode === "borrow"
                  ? notBorrowableReason(asset)
                  : "Asset ini tidak sedang dalam status dipinjam, jadi tidak bisa dikembalikan lewat kios ini."}
              </p>
              <button
                type="button"
                onClick={() => setStep("scanning")}
                className="min-h-12 w-full rounded-2xl bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700"
              >
                Scan Ulang
              </button>
              <button type="button" onClick={resetAll} className="text-xs font-medium text-slate-400">
                Batal
              </button>
            </div>
          )}

          {step === "picking_borrower" && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <button type="button" onClick={resetAll} className="text-slate-400">
                  <ArrowLeft size={18} />
                </button>
                <h2 className="text-sm font-semibold text-slate-800">Siapa yang meminjam?</h2>
              </div>

              <p className="text-xs text-slate-400">
                Nama dipilih sendiri, belum diverifikasi lewat akun login.
              </p>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Divisi</label>
                <select
                  value={borrowerDivisionId}
                  onChange={(e) => {
                    setBorrowerDivisionId(e.target.value);
                    setNameSearch("");
                    setBorrowerName("");
                  }}
                  className="min-h-12 w-full rounded-xl border border-slate-300 px-3 text-sm"
                >
                  <option value="">Pilih divisi...</option>
                  {PUBLIC_BORROW_DIRECTORY.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </div>

              {borrowerDivisionId && (
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">Nama</label>
                  <input
                    value={nameSearch}
                    onChange={(e) => setNameSearch(e.target.value)}
                    placeholder="Cari nama..."
                    className="mb-2 min-h-12 w-full rounded-xl border border-slate-300 px-3 text-sm"
                  />
                  <div className="max-h-56 overflow-y-auto rounded-xl border border-slate-200">
                    {divisionEmployees.length === 0 ? (
                      <p className="px-3 py-3 text-sm text-slate-400">Nama tidak ditemukan.</p>
                    ) : (
                      divisionEmployees.map((name) => (
                        <button
                          key={name}
                          type="button"
                          onClick={() => pickBorrower(name)}
                          className="block w-full min-h-12 border-b border-slate-100 px-3 py-3 text-left text-sm text-slate-700 last:border-b-0 hover:bg-slate-50"
                        >
                          {name}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}

              <button type="button" onClick={resetAll} className="text-xs font-medium text-slate-400">
                Batal
              </button>
            </div>
          )}

          {step === "current_holder" && asset && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => setStep("scanning")} className="text-slate-400">
                  <ArrowLeft size={18} />
                </button>
                <h2 className="text-sm font-semibold text-slate-800">Konfirmasi Pengembalian</h2>
              </div>

              <div className="rounded-xl bg-slate-50 px-3 py-3 text-sm text-slate-700">
                <p className="font-semibold">{asset.assetName}</p>
                <p className="text-slate-400">{asset.assetCode}</p>
                <p className="mt-2">
                  Sedang dipinjam oleh: <span className="font-semibold">{asset.currentHolderName || "-"}</span>
                  {asset.currentHolderDivision ? ` (${asset.currentHolderDivision})` : ""}
                </p>
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-slate-600">Kondisi barang saat dikembalikan</label>
                <select
                  value={returnCondition}
                  onChange={(e) => setReturnCondition(e.target.value as typeof returnCondition)}
                  className="min-h-12 w-full rounded-xl border border-slate-300 px-3 text-sm"
                >
                  <option value="good">Baik</option>
                  <option value="minor_damage">Rusak Ringan</option>
                  <option value="heavy_damage">Rusak Berat</option>
                </select>
              </div>

              <button
                type="button"
                onClick={() => setStep("confirming")}
                className="min-h-12 w-full rounded-2xl bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700"
              >
                Lanjut
              </button>
              <button type="button" onClick={resetAll} className="text-xs font-medium text-slate-400">
                Batal
              </button>
            </div>
          )}

          {step === "confirming" && asset && (
            <div className="space-y-4">
              <h2 className="text-sm font-semibold text-slate-800">Konfirmasi {mode === "borrow" ? "Peminjaman" : "Pengembalian"}</h2>

              <div className="space-y-1 rounded-xl bg-slate-50 px-3 py-3 text-sm text-slate-700">
                <p className="font-semibold">{asset.assetName}</p>
                <p className="text-slate-400">{asset.assetCode}</p>
                {mode === "borrow" ? (
                  <>
                    <p>
                      Peminjam: <span className="font-semibold">{borrowerName}</span>
                    </p>
                    <p className="text-slate-500">
                      Divisi: {PUBLIC_BORROW_DIRECTORY.find((d) => d.id === borrowerDivisionId)?.label}
                    </p>
                  </>
                ) : (
                  <p>
                    Kondisi: <span className="font-semibold">{returnCondition === "good" ? "Baik" : returnCondition === "minor_damage" ? "Rusak Ringan" : "Rusak Berat"}</span>
                  </p>
                )}
              </div>

              {mode === "borrow" && (
                <div>
                  <label className="mb-1 block text-xs font-semibold text-slate-600">
                    Estimasi tanggal kembali (opsional)
                  </label>
                  <input
                    type="date"
                    value={estimatedReturnAt}
                    onChange={(e) => setEstimatedReturnAt(e.target.value)}
                    className="min-h-12 w-full rounded-xl border border-slate-300 px-3 text-sm"
                  />
                </div>
              )}

              <button
                type="button"
                onClick={mode === "borrow" ? submitBorrow : submitReturn}
                className="min-h-12 w-full rounded-2xl bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700"
              >
                Konfirmasi
              </button>
              <button
                type="button"
                onClick={() => setStep(mode === "borrow" ? "scanning" : "current_holder")}
                className="text-xs font-medium text-slate-400"
              >
                Kembali
              </button>
            </div>
          )}

          {step === "submitting" && (
            <div className="flex flex-col items-center gap-3 py-8 text-center">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-blue-600" />
              <p className="text-sm text-slate-500">Memproses transaksi...</p>
            </div>
          )}

          {step === "success" && summary && (
            <div className="space-y-4 text-center">
              <CheckCircle2 className="mx-auto text-green-500" size={44} />
              <p className="text-sm font-semibold text-slate-800">
                {summary.mode === "borrow" ? "Peminjaman berhasil dicatat" : "Pengembalian berhasil dicatat"}
              </p>
              <div className="space-y-1 rounded-xl bg-slate-50 px-3 py-3 text-left text-sm text-slate-600">
                <p>
                  Barang: <span className="font-semibold text-slate-800">{summary.assetName}</span> ({summary.assetCode})
                </p>
                {summary.borrowerName && (
                  <p>
                    Peminjam: <span className="font-semibold text-slate-800">{summary.borrowerName}</span>
                  </p>
                )}
                <p>
                  Waktu:{" "}
                  <span className="font-semibold text-slate-800">
                    {summary.transactionAt.toLocaleString("id-ID", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </span>
                </p>
                <p className="break-all text-xs text-slate-400">Ref: {summary.referenceNumber}</p>
              </div>
              <button
                type="button"
                onClick={resetAll}
                className="min-h-12 w-full rounded-2xl bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700"
              >
                Selesai
              </button>
            </div>
          )}

          {step === "error" && (
            <div className="space-y-4 text-center">
              <XCircle className="mx-auto text-red-500" size={40} />
              <p className="text-sm text-slate-600">{errorMessage}</p>
              <button
                type="button"
                onClick={retryAfterError}
                className="flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700"
              >
                <RotateCcw size={16} />
                Coba Lagi
              </button>
              <button type="button" onClick={resetAll} className="text-xs font-medium text-slate-400">
                Batal
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
