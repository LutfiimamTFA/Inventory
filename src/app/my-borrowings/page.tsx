"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { collection, doc, onSnapshot, orderBy, query, serverTimestamp, updateDoc, where } from "firebase/firestore";
import { AlertTriangle, Eye, History, MapPin, Undo2 } from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { Asset, AssetBorrowing } from "@/lib/types";
import {
  formatDateTimeLong,
  formatExpectedReturn,
  isBorrowingLate,
  toDisplayDate,
} from "@/lib/utils";
import ProtectedLayout from "@/components/ProtectedLayout";
import PageHeader from "@/components/PageHeader";
import Badge from "@/components/Badge";
import EmptyState from "@/components/EmptyState";
import { ReturnModal } from "@/components/BorrowReturnModal";
import ReportIssueModal from "@/components/ReportIssueModal";
import { Toast, ToastState } from "@/components/Toast";

const BORROWED_LIKE_STATUSES = [
  "borrowed",
  "sedang_dipinjam",
  "sedang_dipakai",
  "in_use",
  "with_custodian",
  "temporary_used_by_other",
];

// Section D — filter KETAT: aset HANYA dianggap "sedang dipinjam" kalau (1)
// benar dipegang user login DAN (2) currentUsageStatus-nya memang status
// borrowed-like. currentUsageStatus === "available" SELALU dianggap sudah
// kembali walau field holder lama kebetulan belum/terlambat kosong (mis. race
// antara dua listener) — supaya aset yang baru saja dikembalikan tidak
// nyangkut tampil di "Aset Sedang Dipinjam" DAN "Riwayat Pengembalian"
// sekaligus.
function isActivelyBorrowedByMe(
  asset: Asset,
  uid: string | null | undefined,
  email: string | null | undefined
): boolean {
  const isHeldByMe =
    asset.currentHolderUid === uid ||
    (!!email && (asset.currentHolderEmail || "").toLowerCase() === email) ||
    asset.currentBorrowerUid === uid;
  if (!isHeldByMe) return false;

  const status = String(asset.currentUsageStatus || "").toLowerCase();
  if (status === "available") return false;
  if (BORROWED_LIKE_STATUSES.includes(status)) return true;

  // Data lama belum punya currentUsageStatus sama sekali — fallback ke
  // assetStatus lama, TAPI tetap tolak kalau sudah "available".
  if (!status) {
    const legacy = String(asset.assetStatus || "").toLowerCase();
    return legacy === "borrowed" || legacy === "in_use";
  }
  return false;
}

function toDateOrNull(value: unknown): Date | null {
  if (!value) return null;
  const withToDate = value as { toDate?: () => Date };
  if (typeof withToDate.toDate === "function") return withToDate.toDate();
  const d = new Date(value as string);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Section D — pengaman UI TAMBAHAN (bukan pengganti perbaikan utama di
// BorrowReturnModal): kalau ternyata SUDAH ada riwayat "returned" untuk aset
// ini yang lebih baru dari waktu mulai pinjam, jangan tampilkan sebagai aktif
// walau dokumen assets kebetulan belum/gagal ter-update jadi "available" (data
// nyangkut/stale) — supaya satu aset tidak pernah muncul di dua section
// sekaligus di mata user, apa pun kondisi dokumen assets-nya.
function hasReturnedAfterBorrow(asset: Asset, returnedBorrowings: AssetBorrowing[]): boolean {
  const borrowedDate =
    toDateOrNull(asset.currentUsageStartedAt) || new Date(0);

  return returnedBorrowings.some((item) => {
    const sameAsset = item.assetId === asset.id || item.assetCode === asset.assetCode;
    if (!sameAsset || item.status !== "returned") return false;
    const returnedDate = toDateOrNull(item.returnedAt);
    if (!returnedDate) return false;
    return returnedDate.getTime() >= borrowedDate.getTime();
  });
}

export default function MyBorrowingsPage() {
  const { firebaseUser, assetUser, role, loading } = useAuth();
  const authReady = !loading && !!firebaseUser && !!assetUser && !!role;
  const [activeAssets, setActiveAssets] = useState<Asset[]>([]);
  const [history, setHistory] = useState<AssetBorrowing[]>([]);
  const [returnTarget, setReturnTarget] = useState<Asset | null>(null);
  const [reportTarget, setReportTarget] = useState<Asset | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);

  const [activeBorrowings, setActiveBorrowings] = useState<AssetBorrowing[]>([]);

  // Section A — aset yang SEDANG dipinjam dibaca langsung dari collection
  // assets (bukan asset_borrowings) supaya lokasi/estimasi kembali selalu
  // data TERBARU, dan supaya aset tetap terdeteksi walau asset_borrowings
  // aktifnya tidak pernah tercatat (mis. dipegang lewat jalur custodian/PIC).
  // currentHolderUid adalah sumber utama; currentBorrowerUid (skema lama) dan
  // currentHolderEmail jadi fallback untuk data yang belum/tidak lengkap.
  useEffect(() => {
    if (!authReady || !assetUser?.uid) return;
    const uid = assetUser.uid;
    const email = (assetUser.email || "").toLowerCase();

    const merged = new Map<string, Asset>();
    let cancelled = false;
    const apply = () => {
      if (cancelled) return;
      setActiveAssets(Array.from(merged.values()));
    };

    const subs = [
      onSnapshot(
        query(collection(db, "assets"), where("currentHolderUid", "==", uid)),
        (snap) => {
          snap.docs.forEach((d) => merged.set(d.id, { id: d.id, ...d.data() } as Asset));
          apply();
        },
        (error) => console.error("[Peminjaman Saya] gagal memuat currentHolderUid", error)
      ),
      onSnapshot(
        query(collection(db, "assets"), where("currentBorrowerUid", "==", uid)),
        (snap) => {
          snap.docs.forEach((d) => merged.set(d.id, { id: d.id, ...d.data() } as Asset));
          apply();
        },
        (error) => console.error("[Peminjaman Saya] gagal memuat currentBorrowerUid", error)
      ),
    ];

    if (email) {
      subs.push(
        onSnapshot(
          query(collection(db, "assets"), where("currentHolderEmail", "==", email)),
          (snap) => {
            snap.docs.forEach((d) => merged.set(d.id, { id: d.id, ...d.data() } as Asset));
            apply();
          },
          (error) => console.error("[Peminjaman Saya] gagal memuat currentHolderEmail", error)
        )
      );
    }

    return () => {
      cancelled = true;
      subs.forEach((unsub) => unsub());
    };
  }, [authReady, assetUser?.uid, assetUser?.email]);

  // Section H — riwayat pengembalian dari asset_borrowings, difilter
  // client-side ke status "returned".
  useEffect(() => {
    if (!authReady || !assetUser?.uid) return;
    const q = query(
      collection(db, "asset_borrowings"),
      where("borrowedByUid", "==", assetUser.uid),
      orderBy("borrowedAt", "desc")
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setHistory(snap.docs.map((d) => ({ id: d.id, ...d.data() } as AssetBorrowing)));
      },
      (error) => {
        console.error("[Peminjaman Saya] gagal memuat riwayat peminjaman", error);
      }
    );
    return () => unsub();
  }, [authReady, assetUser?.uid]);

  // Section E — asset_borrowings AKTIF (kalau ada) dipakai untuk MELENGKAPI
  // tanggal pinjam/estimasi kembali aset dari `assets`, BUKAN untuk menentukan
  // kosong/tidaknya "Aset Sedang Dipinjam" (itu tugas query di atas).
  useEffect(() => {
    if (!authReady || !assetUser?.uid) return;
    const q = query(
      collection(db, "asset_borrowings"),
      where("borrowedByUid", "==", assetUser.uid),
      where("status", "==", "borrowed")
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        setActiveBorrowings(snap.docs.map((d) => ({ id: d.id, ...d.data() } as AssetBorrowing)));
      },
      (error) => console.error("[Peminjaman Saya] gagal memuat asset_borrowings aktif", error)
    );
    return () => unsub();
  }, [authReady, assetUser?.uid]);

  const returnedHistory = history.filter((b) => b.status === "returned");

  // Section B/C/D — filter hanya aset yang BENAR-BENAR sedang dipinjam/
  // dipakai user login (status bukan "available") DAN belum ada riwayat
  // "returned" yang lebih baru dari waktu mulai pinjam — dua lapis supaya
  // satu aset tidak pernah nyangkut di "Aset Sedang Dipinjam" DAN "Riwayat
  // Pengembalian" sekaligus, walau dokumen assets-nya kebetulan stale.
  const activeBorrowedAssets = activeAssets.filter(
    (asset) =>
      isActivelyBorrowedByMe(asset, assetUser?.uid, (assetUser?.email || "").toLowerCase()) &&
      !hasReturnedAfterBorrow(asset, returnedHistory)
  );

  const activeBorrowingByAssetId = new Map<string, AssetBorrowing>();
  activeBorrowings.forEach((b) => activeBorrowingByAssetId.set(b.assetId, b));

  // Section G — aset yang lolos isActivelyBorrowedByMe TAPI ketahuan sudah
  // ada riwayat "returned" lebih baru (hasReturnedAfterBorrow) berarti
  // dokumen assets-nya STALE/nyangkut (gagal ter-update saat return dulu).
  // Auto-koreksi diam-diam ke "available" + kosongkan holder supaya data
  // utama benar-benar bersih, bukan cuma disembunyikan di UI.
  const staleReturnedAssets = activeAssets.filter(
    (asset) =>
      isActivelyBorrowedByMe(asset, assetUser?.uid, (assetUser?.email || "").toLowerCase()) &&
      hasReturnedAfterBorrow(asset, returnedHistory)
  );
  const staleReturnedIds = staleReturnedAssets.map((a) => a.id).join(",");

  // Section G — "Sinkronkan Status Pengembalian" otomatis (bukan tombol
  // manual): jalan sekali per aset per sesi (syncedIdsRef) supaya tidak
  // spam-write kalau render berkali-kali sebelum listener assets ikut update.
  const syncedIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!authReady || staleReturnedAssets.length === 0) return;
    staleReturnedAssets.forEach((asset) => {
      if (syncedIdsRef.current.has(asset.id)) return;
      syncedIdsRef.current.add(asset.id);
      console.log("[Return Asset] Sinkronkan Status Pengembalian (auto)", {
        assetId: asset.id,
        assetCode: asset.assetCode,
        currentUsageStatus: asset.currentUsageStatus,
        currentHolderUid: asset.currentHolderUid,
      });
      updateDoc(doc(db, "assets", asset.id), {
        currentUsageStatus: "available",
        currentUsageStatusLabel: "Tersedia",
        currentBorrowingId: null,
        currentBorrowerUid: null,
        currentBorrowerName: null,
        currentHolderUid: null,
        currentHolderName: null,
        currentHolderEmail: null,
        currentHolderDivision: null,
        currentUsageExpectedReturnAt: null,
        updatedAt: serverTimestamp(),
        updatedByName: "System Sync",
      }).catch((err) => {
        syncedIdsRef.current.delete(asset.id);
        console.warn("[Return Asset] gagal sinkronkan status pengembalian", asset.id, err);
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady, staleReturnedIds]);

  useEffect(() => {
    if (!authReady) return;
    console.log("[My Borrowings Render Debug]", {
      uid: firebaseUser?.uid,
      email: firebaseUser?.email,
      activeBorrowedAssets: activeBorrowedAssets.map((asset) => ({
        id: asset.id,
        code: asset.assetCode,
        status: asset.currentUsageStatus,
        holderUid: asset.currentHolderUid,
        holderName: asset.currentHolderName,
      })),
      returnedBorrowings: returnedHistory.map((item) => ({
        id: item.id,
        assetCode: item.assetCode,
        status: item.status,
      })),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authReady, activeBorrowedAssets.length, activeBorrowings.length, returnedHistory.length]);

  return (
    <ProtectedLayout>
      <PageHeader
        title="Peminjaman Saya"
        subtitle="Aset yang sedang Anda pinjam dan riwayat peminjaman Anda."
      />

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 mb-5">
        <h2 className="font-semibold text-slate-800 mb-3">Aset Sedang Dipinjam</h2>
        {activeBorrowedAssets.length === 0 ? (
          <EmptyState icon={History} title="Belum ada aset yang sedang dipinjam" />
        ) : (
          <div className="space-y-3">
            {activeBorrowedAssets.map((asset) => (
              <ActiveBorrowCard
                key={asset.id}
                asset={asset}
                borrowing={activeBorrowingByAssetId.get(asset.id)}
                onReturn={() => setReturnTarget(asset)}
                onReport={() => setReportTarget(asset)}
              />
            ))}
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
        <h2 className="font-semibold text-slate-800 mb-3">Riwayat Pengembalian</h2>
        {returnedHistory.length === 0 ? (
          <EmptyState icon={History} title="Belum ada riwayat pengembalian" />
        ) : (
          <div className="divide-y divide-slate-100">
            {returnedHistory.map((b) => (
              <HistoryRow key={b.id} borrowing={b} />
            ))}
          </div>
        )}
      </div>

      {returnTarget && (
        <ReturnModal
          asset={returnTarget}
          open={!!returnTarget}
          onClose={() => setReturnTarget(null)}
          onDone={() => {
            setToast({ type: "success", message: "Aset berhasil dikembalikan." });
            setReturnTarget(null);
          }}
        />
      )}

      {reportTarget && (
        <ReportIssueModal
          asset={reportTarget}
          open={!!reportTarget}
          onClose={() => setReportTarget(null)}
        />
      )}

      <Toast toast={toast} onClose={() => setToast(null)} />
    </ProtectedLayout>
  );
}

function ActiveBorrowCard({
  asset,
  borrowing,
  onReturn,
  onReport,
}: {
  asset: Asset;
  borrowing?: AssetBorrowing;
  onReturn: () => void;
  onReport: () => void;
}) {
  // Section E — asset_borrowings aktif (kalau ada) MELENGKAPI tanggal dari
  // assets, bukan sebaliknya — assets tetap sumber utama untuk deteksi aktif.
  const borrowedAt = borrowing?.borrowedAt || asset.currentUsageStartedAt;
  const expectedReturnAt = borrowing?.estimatedReturnAt || asset.currentUsageExpectedReturnAt;
  const late = isBorrowingLate({ currentUsageExpectedReturnAt: expectedReturnAt });

  return (
    <div className="rounded-2xl border border-slate-200 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={`/assets/${asset.id}`} className="font-semibold text-slate-800 hover:underline">
            {asset.assetName}
          </Link>
          <p className="font-mono text-xs text-slate-400">{asset.assetCode}</p>
        </div>
        <Badge
          label={late ? "Terlambat Dikembalikan" : "Sedang Dipinjam"}
          colorClass={
            late
              ? "bg-red-50 text-red-700 border-red-200"
              : "bg-amber-50 text-amber-700 border-amber-200"
          }
        />
      </div>

      <div className="mt-3 space-y-1 text-xs text-slate-500">
        <p className="flex items-center gap-1.5">
          <MapPin size={12} className="shrink-0 text-slate-400" />
          {asset.location || asset.locationText || "-"}
        </p>
        <p>Dipinjam pada: {formatDateTimeLong(borrowedAt)}</p>
        {expectedReturnAt && <p>Estimasi kembali: {formatExpectedReturn(expectedReturnAt)}</p>}
      </div>

      {late && (
        <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-red-600">
          <AlertTriangle size={12} className="shrink-0" />
          Catatan: Aset ini melewati estimasi waktu kembali.
        </p>
      )}

      {!borrowing && (
        <p className="mt-2 text-[11px] text-slate-400">
          Data peminjaman aktif belum memiliki catatan riwayat. Aset tetap terdeteksi sedang Anda pegang.
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onReturn}
          className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-teal-500 px-3 py-2 text-xs font-semibold text-white hover:brightness-105"
        >
          <Undo2 size={13} />
          Kembalikan Aset
        </button>
        <Link
          href={`/assets/${asset.id}`}
          className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          <Eye size={13} />
          Lihat Detail
        </Link>
        <button
          type="button"
          onClick={onReport}
          className="inline-flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-700 hover:bg-amber-100"
        >
          <AlertTriangle size={13} />
          Laporkan Kendala
        </button>
      </div>
    </div>
  );
}

function HistoryRow({ borrowing }: { borrowing: AssetBorrowing }) {
  const borrowedDate = toDisplayDate(borrowing.borrowedAt);
  const returnedDate = toDisplayDate(borrowing.returnedAt);
  const durationText =
    borrowedDate && returnedDate
      ? formatDurationBetween(borrowedDate, returnedDate)
      : null;

  return (
    <div className="py-3 first:pt-0 last:pb-0 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/assets/${borrowing.assetId}`}
            className="font-medium text-slate-800 hover:underline"
          >
            {borrowing.assetName}
          </Link>
          <p className="text-xs text-slate-400">{borrowing.assetCode}</p>
        </div>
        <Badge
          label={borrowing.isLate ? "Terlambat saat Dikembalikan" : "Sudah Dikembalikan"}
          colorClass={
            borrowing.isLate
              ? "bg-red-50 text-red-700 border-red-200"
              : "bg-emerald-50 text-emerald-700 border-emerald-200"
          }
        />
      </div>
      <div className="mt-1.5 space-y-0.5 text-xs text-slate-500">
        <p>Dipinjam pada: {formatDateTimeLong(borrowing.borrowedAt)}</p>
        <p>Dikembalikan pada: {formatDateTimeLong(borrowing.returnedAt)}</p>
        {durationText && <p>Durasi peminjaman: {durationText}</p>}
        {borrowing.locationText && <p>Lokasi: {borrowing.locationText}</p>}
        {borrowing.returnNotes && <p>Catatan pengembalian: {borrowing.returnNotes}</p>}
      </div>
    </div>
  );
}

function formatDurationBetween(start: Date, end: Date): string {
  const diffMs = Math.max(0, end.getTime() - start.getTime());
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  if (diffHours < 1) return "Kurang dari 1 jam";
  if (diffHours < 24) return `${diffHours} jam`;
  const diffDays = Math.floor(diffHours / 24);
  const remainingHours = diffHours % 24;
  return remainingHours > 0 ? `${diffDays} hari ${remainingHours} jam` : `${diffDays} hari`;
}
