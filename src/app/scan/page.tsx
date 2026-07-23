"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  collection,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
} from "firebase/firestore";
import AssetQrScanner from "@/components/asset/AssetQrScanner";
import {
  Search,
  ScanLine,
  PackageSearch,
  AlertTriangle,
  Boxes,
  History,
  ClipboardList,
  ClipboardPlus,
  Eye,
  User,
  MapPin,
  Clock,
  CheckCircle2,
  Wrench,
  Pencil,
  RotateCcw,
} from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { Asset, AssetBorrowing, AssetLog, AssetIssueTicket, TrackingMode } from "@/lib/types";
import {
  ASSET_STATUS_COLOR,
  ASSET_STATUS_LABEL,
  ASSET_USAGE_STATUS_COLOR,
  TRACKING_MODE_LABEL,
  CONDITION_LABEL,
  extractAssetCodeFromQr,
  formatDate,
  formatDateTime,
} from "@/lib/utils";
import { handoverTemporary, returnToCustodian } from "@/lib/custodian-actions";
import { EmployeeOption, fetchActiveEmployeeOptions } from "@/lib/firestore-helpers";
import ProtectedLayout from "@/components/ProtectedLayout";
import PageHeader from "@/components/PageHeader";
import Badge from "@/components/Badge";
import EmptyState from "@/components/EmptyState";
import { BorrowModal, ReturnModal } from "@/components/BorrowReturnModal";
import ReportIssueModal from "@/components/ReportIssueModal";
import SearchableSelect, { SearchableSelectItem } from "@/components/SearchableSelect";
import ConfirmModal from "@/components/ConfirmModal";
import { Toast, ToastState } from "@/components/Toast";


// "Riwayat Scan Saya" belum punya collection Firestore sendiri — dipersist
// ringan di localStorage per-user supaya panel idle & section riwayat sama
// sekali tidak butuh backend/rules baru, tapi tetap persisten antar sesi.
interface ScanHistoryEntry {
  assetId: string;
  assetName: string;
  assetCode: string;
  assetStatus: Asset["assetStatus"];
  scannedAt: number;
}
const SCAN_HISTORY_LIMIT = 10;

function scanHistoryKey(uid: string) {
  return `assetview_scan_history_${uid}`;
}

function loadScanHistory(uid: string): ScanHistoryEntry[] {
  try {
    const raw = window.localStorage.getItem(scanHistoryKey(uid));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveScanHistory(uid: string, entries: ScanHistoryEntry[]) {
  try {
    window.localStorage.setItem(scanHistoryKey(uid), JSON.stringify(entries));
  } catch {
    // localStorage penuh/diblokir browser — riwayat scan cukup dilewati,
    // bukan alasan untuk memutus alur utama (lihat detail aset tetap jalan).
  }
}

// Field "dipakai sekarang" vs "PIC/Custodian" SENGAJA dibedakan. Model
// custodian baru (currentHolderName/custodianName) diprioritaskan; fallback
// ke skema lama (currentBorrowerName untuk "borrowed", responsiblePersonName
// untuk "in_use") untuk aset yang belum pernah disentuh fitur custodian.
// Aset lama belum punya trackingMode tersimpan — diturunkan dari usageType
// lama supaya tidak ada aset yang "hilang" dari kedua sisi (fixed vs
// bergerak) cuma karena field baru belum diisi.
function resolveTrackingMode(a: Asset): TrackingMode {
  return a.trackingMode || (a.usageType === "assigned_daily" ? "assigned_pic" : "shared_borrowable");
}

function usedByName(a: Asset): string | null {
  if (a.currentHolderName) return a.currentHolderName;
  if (a.assetStatus === "borrowed") return a.currentBorrowerName || null;
  if (a.assetStatus === "in_use") return a.responsiblePersonName || null;
  // Aset "assigned_daily" yang masih bersama custodian (belum pernah
  // diserahkan sementara) — pemegangnya = custodian, sama seperti panel
  // detail asset (custodianIsCurrentHolder).
  if (a.usageType === "assigned_daily" || a.currentUsageStatus === "with_custodian") {
    return custodianOrPicName(a);
  }
  return null;
}

function custodianOrPicName(a: Asset): string | null {
  return a.custodianName || a.responsiblePersonName || a.picName || null;
}

// PersonRef untuk currentHolder — mengikuti cascade fallback yang sama
// dengan usedByName di atas, tapi menyertakan uid/email supaya bisa
// diresolusi ke employeeMap.
function holderPersonRef(a: Asset): PersonRef {
  if (a.currentHolderName || a.currentHolderUid || a.currentHolderEmail) {
    return {
      uid: a.currentHolderUid,
      email: a.currentHolderEmail,
      currentHolderName: a.currentHolderName,
      currentHolderDivision: a.currentHolderDivision,
    };
  }
  if (a.assetStatus === "borrowed") {
    return { uid: a.currentBorrowerUid, currentHolderName: a.currentBorrowerName };
  }
  if (a.assetStatus === "in_use") {
    return {
      uid: a.responsiblePersonUid,
      email: a.responsiblePersonEmail,
      responsiblePersonName: a.responsiblePersonName,
      responsiblePersonDivision: a.responsiblePersonDivision,
    };
  }
  if (a.usageType === "assigned_daily" || a.currentUsageStatus === "with_custodian") {
    return custodianPersonRef(a);
  }
  return {};
}

function custodianPersonRef(a: Asset): PersonRef {
  return {
    uid: a.custodianUid || a.responsiblePersonUid,
    email: a.custodianEmail || a.responsiblePersonEmail,
    custodianName: a.custodianName,
    responsiblePersonName: a.responsiblePersonName,
    picName: a.picName,
    custodianDivision: a.custodianDivision || a.responsiblePersonDivision,
  };
}

// ── Resolusi nama orang TANPA pernah jatuh ke email di UI ────────────────
// employeeMap dibangun sekali dari daftar karyawan aktif (fetchActiveEmployeeOptions)
// dan dipakai untuk "menerjemahkan" uid/email mentah yang tersimpan di aset
// jadi nama asli — supaya tabel tidak pernah menampilkan
// "nurullatifah@gmail.com" lagi. Email cuma dipakai sebagai KUNCI pencarian
// di sini, bukan ditampilkan.
interface EmployeeMap {
  byUid: Record<string, EmployeeOption>;
  byEmail: Record<string, EmployeeOption>;
}

interface PersonRef {
  uid?: string | null;
  email?: string | null;
  currentHolderName?: string | null;
  custodianName?: string | null;
  responsiblePersonName?: string | null;
  picName?: string | null;
  currentHolderDivision?: string | null;
  custodianDivision?: string | null;
  responsiblePersonDivision?: string | null;
}

function resolveEmployee(ref: PersonRef, employeeMap?: EmployeeMap): EmployeeOption | undefined {
  const uid = ref.uid || undefined;
  const email = ref.email ? ref.email.toLowerCase() : undefined;
  return (uid && employeeMap?.byUid[uid]) || (email && employeeMap?.byEmail[email]) || undefined;
}

// Nama karyawan dulu (dari employeeMap ATAU field name yang sudah tersimpan
// di aset), baru kalau benar-benar tidak ada nama sama sekali, fallback ke
// email — TIDAK PERNAH email duluan.
function getPersonDisplayName(ref: PersonRef, employeeMap?: EmployeeMap): string {
  const employee = resolveEmployee(ref, employeeMap);
  return (
    employee?.name ||
    ref.currentHolderName ||
    ref.custodianName ||
    ref.responsiblePersonName ||
    ref.picName ||
    ref.email ||
    "-"
  );
}

function getPersonSubInfo(ref: PersonRef, employeeMap?: EmployeeMap): string {
  const employee = resolveEmployee(ref, employeeMap);
  return (
    employee?.divisionName ||
    employee?.brandName ||
    employee?.roleLabel ||
    ref.currentHolderDivision ||
    ref.custodianDivision ||
    ref.responsiblePersonDivision ||
    ""
  );
}

// Panel hasil scan (section F/G) — pakai currentUsageStatus (model
// custodian baru) kalau sudah diisi, fallback ke assetStatus lama untuk
// aset yang belum pernah disentuh fitur custodian sama sekali.
function getUsagePanel(a: Asset): { badge: string; colorClass: string; message: string } {
  const status = a.currentUsageStatus;

  if (status === "with_custodian") {
    return {
      badge: "Bersama Custodian",
      colorClass: ASSET_USAGE_STATUS_COLOR.with_custodian,
      message: `Aset ini berada pada PIC utama: ${a.custodianName || "-"}.`,
    };
  }
  if (status === "temporary_used_by_other") {
    return {
      badge: "Dipakai Sementara",
      colorClass: ASSET_USAGE_STATUS_COLOR.temporary_used_by_other,
      message: `Aset sedang dipakai sementara oleh ${a.currentHolderName || "-"}.`,
    };
  }
  if (status === "borrowed" || (!status && a.assetStatus === "borrowed")) {
    const name = usedByName(a) || "-";
    return {
      badge: "Dipinjam",
      colorClass: ASSET_USAGE_STATUS_COLOR.borrowed,
      message: `Aset ini sedang dipakai oleh ${name}.`,
    };
  }
  if (status === "maintenance" || (!status && a.assetStatus === "maintenance")) {
    return {
      badge: "Maintenance",
      colorClass: ASSET_USAGE_STATUS_COLOR.maintenance,
      message: "Aset sedang dalam proses maintenance.",
    };
  }
  if (status === "available" || (!status && a.assetStatus === "available")) {
    return {
      badge: "Tersedia",
      colorClass: ASSET_USAGE_STATUS_COLOR.available,
      message: "Aset tersedia dan bisa diajukan untuk dipakai.",
    };
  }
  // Fallback lama: assetStatus "in_use" (data sebelum fitur custodian ada).
  if (!status && a.assetStatus === "in_use") {
    return {
      badge: "Sedang Dipakai",
      colorClass: "bg-blue-50 text-blue-700 border-blue-200",
      message: `Aset ini sedang dipakai oleh ${usedByName(a) || "-"}.`,
    };
  }
  return {
    badge: "Tidak Tersedia",
    colorClass: ASSET_USAGE_STATUS_COLOR.unavailable,
    message: "Aset tidak tersedia sementara.",
  };
}

// Aset dianggap "sedang dipakai" kalau currentUsageStatus (model baru) ada
// isinya dan bukan "available", ATAU (fallback data lama) assetStatus-nya
// borrowed/in_use/maintenance.
function isUsageCandidate(a: Asset): boolean {
  if (a.currentUsageStatus) return a.currentUsageStatus !== "available";
  return ["borrowed", "in_use", "maintenance"].includes(a.assetStatus);
}

// ── Baris tunggal untuk section "Status Pemakaian Aset Kantor" ────────────
// Summary card dan tabel WAJIB dihitung dari array yang SAMA
// (assetUsageRows) — sebelumnya summary dihitung dari allAssets (semua
// status termasuk "available") sedangkan tabel cuma dari usageCandidates
// (assetStatus borrowed/in_use/maintenance saja, "available" DIBUANG),
// makanya total di summary vs jumlah baris di tabel tidak pernah sinkron.
type AssetUsageStatusGroup = "available" | "in_use" | "maintenance";

interface AssetUsageRow {
  id: string;
  assetId: string;
  assetName: string;
  assetCode: string;
  status: AssetUsageStatusGroup;
  statusLabel: string;
  currentHolderName: string;
  currentHolderUid: string | null;
  currentHolderSubInfo: string;
  custodianName: string;
  custodianUid: string | null;
  custodianSubInfo: string;
  locationText: string;
  startedAt: unknown;
  expectedReturnAt: string | null;
  usageType: "shared_pool" | "assigned_daily";
  trackingMode: TrackingMode;
  raw: Asset;
}

function normalizeUsageStatus(a: Asset): AssetUsageStatusGroup {
  const usageStatus = a.currentUsageStatus || a.assetStatus || "available";
  if (usageStatus === "maintenance") return "maintenance";
  if (
    usageStatus === "with_custodian" ||
    usageStatus === "temporary_used_by_other" ||
    usageStatus === "borrowed" ||
    usageStatus === "in_use"
  ) {
    return "in_use";
  }
  return "available";
}

const USAGE_STATUS_GROUP_LABEL: Record<AssetUsageStatusGroup, string> = {
  in_use: "Sedang Dipakai",
  maintenance: "Maintenance",
  available: "Tersedia",
};

function isOverdue(expectedReturnAt: string | null | undefined): boolean {
  if (!expectedReturnAt) return false;
  const due = new Date(expectedReturnAt);
  if (Number.isNaN(due.getTime())) return false;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return due < today;
}

type UsageFilter =
  | "all"
  | "available"
  | "in_use"
  | "assigned_pic"
  | "shared_borrowable"
  | "temporary_used_by_other"
  | "overdue"
  | "mine";

const USAGE_FILTERS: { key: UsageFilter; label: string }[] = [
  { key: "all", label: "Semua" },
  { key: "available", label: "Tersedia" },
  { key: "in_use", label: "Sedang Digunakan" },
  { key: "assigned_pic", label: "Aset dengan PIC" },
  { key: "shared_borrowable", label: "Aset Bersama Bisa Dipakai" },
  { key: "temporary_used_by_other", label: "Dipakai Sementara" },
  { key: "overdue", label: "Terlambat Kembali" },
  { key: "mine", label: "Tanggung Jawab Saya" },
];

export default function ScanPage() {
  return (
    <Suspense
      fallback={
        <ProtectedLayout>
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 rounded-full border-2 border-slate-200 border-t-slate-900 animate-spin" />
          </div>
        </ProtectedLayout>
      }
    >
      <ScanPageContent />
    </Suspense>
  );
}

function ScanPageContent() {
  const { assetUser, role } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  const isManager = role === "asset_admin" || role === "super_admin";
  const [toast, setToast] = useState<ToastState | null>(null);
  const [manualCode, setManualCode] = useState("");
  const [asset, setAsset] = useState<Asset | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState("");
  const [borrowOpen, setBorrowOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [reportIssueOpen, setReportIssueOpen] = useState(false);
  const [allAssets, setAllAssets] = useState<Asset[]>([]);
  const [activeBorrowings, setActiveBorrowings] = useState<AssetBorrowing[]>([]);
  const [myReportCount, setMyReportCount] = useState(0);
  const [scanHistory, setScanHistory] = useState<ScanHistoryEntry[]>([]);
  const [usageFilter, setUsageFilter] = useState<UsageFilter>("all");
  const [usageSearch, setUsageSearch] = useState("");
  const [handoverModalAsset, setHandoverModalAsset] = useState<Asset | null>(null);
  const [handoverToUid, setHandoverToUid] = useState("");
  const [handoverPurpose, setHandoverPurpose] = useState("");
  const [handoverExpectedReturnAt, setHandoverExpectedReturnAt] = useState("");
  const [handoverSaving, setHandoverSaving] = useState(false);
  const [handoverError, setHandoverError] = useState("");
  const [returnSaving, setReturnSaving] = useState(false);
  const [employeeOptions, setEmployeeOptions] = useState<EmployeeOption[]>([]);
  const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
  const [assetDetailModalOpen, setAssetDetailModalOpen] = useState(false);
  const [modalLogs, setModalLogs] = useState<AssetLog[]>([]);
  const [modalTickets, setModalTickets] = useState<AssetIssueTicket[]>([]);
  const [modalHistoryLoading, setModalHistoryLoading] = useState(false);

  // Debug SEMENTARA (hapus setelah overflow mobile terkonfirmasi beres) —
  // cari elemen mana persis di dalam .scan-page yang scrollWidth-nya lebih
  // lebar dari clientWidth-nya, supaya tidak nebak-nebak lagi class mana
  // yang jadi biang overflow horizontal di HP.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.innerWidth >= 768) return;

    const overflowing = Array.from(document.querySelectorAll(".scan-page *"))
      .filter((el) => {
        const element = el as HTMLElement;
        return element.scrollWidth > element.clientWidth + 2;
      })
      .slice(0, 30)
      .map((el) => {
        const element = el as HTMLElement;
        return {
          tag: element.tagName,
          className: element.className,
          scrollWidth: element.scrollWidth,
          clientWidth: element.clientWidth,
          text: element.textContent?.slice(0, 50),
        };
      });

    console.log("[Scan Mobile Overflow Debug]", overflowing);
  }, []);

  // Daftar karyawan aktif — dimuat sekali saat halaman dibuka (bukan lazy
  // lagi) karena sekarang dipakai untuk menerjemahkan uid/email jadi nama di
  // SELURUH tabel "Status Pemakaian Aset Kantor", bukan cuma modal Serahkan
  // Sementara.
  useEffect(() => {
    let cancelled = false;
    fetchActiveEmployeeOptions()
      .then((options) => {
        if (!cancelled) setEmployeeOptions(options);
      })
      .catch((err) => console.error("[ScanPage] gagal memuat daftar karyawan aktif", err));
    return () => {
      cancelled = true;
    };
  }, []);

  const employeeMap: EmployeeMap = useMemo(() => {
    const byUid: Record<string, EmployeeOption> = {};
    const byEmail: Record<string, EmployeeOption> = {};
    employeeOptions.forEach((e) => {
      byUid[e.uid] = e;
      if (e.email) byEmail[e.email.toLowerCase()] = e;
    });
    return { byUid, byEmail };
  }, [employeeOptions]);

  const employeeSelectItems: SearchableSelectItem[] = useMemo(
    () =>
      employeeOptions.map((u) => ({
        id: u.uid,
        label: u.name,
        sublabel: u.divisionName || u.brandName || u.roleLabel,
        searchText: [u.name, u.email, u.divisionName, u.brandName, u.roleLabel]
          .filter(Boolean)
          .join(" "),
      })),
    [employeeOptions]
  );

  // Modal Detail Ringkas (section H) — riwayat pemakaian & kendala singkat,
  // dimuat sekali tiap kali modal dibuka untuk aset yang berbeda, BUKAN
  // realtime listener (modal ringan, tidak perlu update live).
  useEffect(() => {
    if (!assetDetailModalOpen || !selectedAsset) {
      Promise.resolve().then(() => {
        setModalLogs([]);
        setModalTickets([]);
      });
      return;
    }
    let cancelled = false;
    Promise.resolve().then(() => setModalHistoryLoading(true));
    const logsQuery = query(
      collection(db, "asset_logs"),
      where("assetId", "==", selectedAsset.id),
      orderBy("timestamp", "desc"),
      limit(3)
    );
    const ticketsQuery = query(
      collection(db, "asset_issue_tickets"),
      where("assetId", "==", selectedAsset.id)
    );
    Promise.all([getDocs(logsQuery), getDocs(ticketsQuery)])
      .then(([logsSnap, ticketsSnap]) => {
        if (cancelled) return;
        setModalLogs(logsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as AssetLog)));
        const tickets = ticketsSnap.docs.map((d) => ({ id: d.id, ...d.data() } as AssetIssueTicket));
        tickets.sort((a, b) => {
          const at = (a.reportedAt as { toMillis?: () => number })?.toMillis?.() || 0;
          const bt = (b.reportedAt as { toMillis?: () => number })?.toMillis?.() || 0;
          return bt - at;
        });
        setModalTickets(tickets.slice(0, 3));
      })
      .catch((err) => console.error("[ScanPage] gagal memuat riwayat aset untuk modal detail", err))
      .finally(() => {
        if (!cancelled) setModalHistoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [assetDetailModalOpen, selectedAsset]);

  // Riwayat scan lokal — dimuat sekali per user begitu login diketahui.
  // setState dibungkus microtask supaya tidak "setState sinkron di dalam
  // effect" (bisa memicu cascading render menurut react-hooks lint).
  useEffect(() => {
    if (!assetUser?.uid) return;
    const uid = assetUser.uid;
    Promise.resolve().then(() => setScanHistory(loadScanHistory(uid)));
  }, [assetUser?.uid]);

  const pushScanHistory = (a: Asset) => {
    if (!assetUser?.uid) return;
    const uid = assetUser.uid;
    setScanHistory((prev) => {
      const withoutThisAsset = prev.filter((e) => e.assetId !== a.id);
      const next = [
        {
          assetId: a.id,
          assetName: a.assetName,
          assetCode: a.assetCode,
          assetStatus: a.assetStatus,
          scannedAt: Date.now(),
        },
        ...withoutThisAsset,
      ].slice(0, SCAN_HISTORY_LIMIT);
      saveScanHistory(uid, next);
      return next;
    });
  };

  // Seluruh aset kantor — dipakai untuk section "Status Pemakaian Aset
  // Kantor" (bukan hanya milik user login) + ringkasan Tersedia/Maintenance.
  // Pola ini sama dengan halaman /assets (admin) yang juga listen seluruh
  // collection secara realtime.
  useEffect(() => {
    const q = query(collection(db, "assets"), orderBy("assetName", "asc"));
    const unsub = onSnapshot(
      q,
      (snap) => setAllAssets(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Asset))),
      (err) => console.error("[ScanPage Listener] assets error:", err)
    );
    return () => unsub();
  }, []);

  // Peminjaman aktif seluruh kantor — dipakai untuk tanggal pinjam/estimasi
  // kembali per aset dan deteksi "Terlambat Kembali".
  useEffect(() => {
    const q = query(collection(db, "asset_borrowings"), where("status", "==", "borrowed"));
    const unsub = onSnapshot(
      q,
      (snap) => setActiveBorrowings(snap.docs.map((d) => ({ id: d.id, ...d.data() } as AssetBorrowing))),
      (err) => console.error("[ScanPage Listener] asset_borrowings error:", err)
    );
    return () => unsub();
  }, []);

  // "Laporan Saya" — cukup jumlahnya untuk summary card di panel idle.
  useEffect(() => {
    if (!assetUser?.uid) return;
    const q = query(
      collection(db, "asset_issue_tickets"),
      where("reportedByUid", "==", assetUser.uid)
    );
    const unsub = onSnapshot(
      q,
      (snap) => setMyReportCount(snap.size),
      (err) => console.error("[ScanPage Listener] asset_issue_tickets error:", err)
    );
    return () => unsub();
  }, [assetUser?.uid]);

  const borrowingByAssetId = useMemo(() => {
    const map = new Map<string, AssetBorrowing>();
    activeBorrowings.forEach((b) => map.set(b.assetId, b));
    return map;
  }, [activeBorrowings]);

  // SATU sumber data untuk summary card + tabel — lihat komentar di
  // AssetUsageRow di atas. HANYA aset bergerak (assigned_pic/
  // shared_borrowable) — aset "fixed_location" (AC, meja, CCTV, dll) SENGAJA
  // tidak masuk sama sekali supaya tabel ini tidak ramai oleh aset yang
  // memang tidak mungkin dipinjam/dipegang siapa pun (section C).
  const assetUsageRows = useMemo<AssetUsageRow[]>(() => {
    const rows = allAssets
      .filter((a) => resolveTrackingMode(a) !== "fixed_location")
      .map((a) => {
        const borrowing = borrowingByAssetId.get(a.id);
        const status = normalizeUsageStatus(a);
        const usageType: "shared_pool" | "assigned_daily" =
          a.usageType || (a.assetStatus === "in_use" ? "assigned_daily" : "shared_pool");
        const expectedReturnAt =
          a.currentUsageExpectedReturnAt ||
          a.temporaryUseExpectedReturnAt ||
          borrowing?.estimatedReturnAt ||
          null;
        const holderRef = holderPersonRef(a);
        const custodianRef = custodianPersonRef(a);
        return {
          id: a.id,
          assetId: a.id,
          assetName: a.assetName || "-",
          assetCode: a.assetCode || "-",
          status,
          statusLabel: USAGE_STATUS_GROUP_LABEL[status],
          currentHolderName: getPersonDisplayName(holderRef, employeeMap),
          currentHolderUid: holderRef.uid || null,
          currentHolderSubInfo: getPersonSubInfo(holderRef, employeeMap),
          custodianName: getPersonDisplayName(custodianRef, employeeMap),
          custodianUid: custodianRef.uid || null,
          custodianSubInfo: getPersonSubInfo(custodianRef, employeeMap),
          locationText: a.locationText || a.location || "-",
          startedAt: a.currentUsageStartedAt || borrowing?.borrowedAt || a.temporaryUseStartedAt || null,
          expectedReturnAt,
          usageType,
          trackingMode: resolveTrackingMode(a),
          raw: a,
        };
      });
    console.log("[Asset Usage Debug]", {
      assetsCount: allAssets.length,
      employeeCount: employeeOptions.length,
      assetUsageRows: rows.map((row) => ({
        id: row.id,
        assetId: row.assetId,
        assetName: row.assetName,
        status: row.status,
        currentHolderName: row.currentHolderName,
        custodianName: row.custodianName,
      })),
    });
    return rows;
  }, [allAssets, borrowingByAssetId, employeeMap, employeeOptions.length]);

  const summary = useMemo(
    () => ({
      sedangDipakai: assetUsageRows.filter((row) => row.status === "in_use").length,
      tersedia: assetUsageRows.filter((row) => row.status === "available").length,
      maintenance: assetUsageRows.filter((row) => row.status === "maintenance").length,
      terlambat: assetUsageRows.filter((row) => isOverdue(row.expectedReturnAt)).length,
    }),
    [assetUsageRows]
  );

  const filteredUsageRows = useMemo(() => {
    const term = usageSearch.trim().toLowerCase();
    const rows = assetUsageRows.filter((row) => {
      if (usageFilter === "available" && row.status !== "available") return false;
      if (usageFilter === "in_use" && row.status !== "in_use") return false;
      if (usageFilter === "assigned_pic" && row.trackingMode !== "assigned_pic") return false;
      if (usageFilter === "shared_borrowable" && row.trackingMode !== "shared_borrowable") return false;
      if (
        usageFilter === "temporary_used_by_other" &&
        row.raw.currentUsageStatus !== "temporary_used_by_other"
      )
        return false;
      if (usageFilter === "overdue" && !isOverdue(row.expectedReturnAt)) return false;
      // "Tanggung Jawab Saya" cuma cek PIC operasional (custodianUid) — SENGAJA
      // tidak ikut cek currentHolderUid, karena badge ini soal tanggung jawab
      // operasional, bukan siapa yang lagi pegang barang sekarang.
      if (usageFilter === "mine" && row.custodianUid !== assetUser?.uid) return false;
      // usageFilter === "all" -> tidak difilter sama sekali, termasuk "available".
      if (!term) return true;
      const haystack = [row.assetName, row.assetCode, row.currentHolderName || "", row.custodianName || "", row.locationText]
        .join(" ")
        .toLowerCase();
      return haystack.includes(term);
    });
    console.log("[Asset Usage Debug]", {
      activeUsageFilter: usageFilter,
      filteredCount: rows.length,
    });
    return rows;
  }, [assetUsageRows, usageFilter, usageSearch, assetUser?.uid]);

  const lookupAsset = async (code: string) => {
    setError("");
    setNotFound(false);
    setAsset(null);
    // Section I — dukung QR lama (kode polos) maupun QR baru (URL penuh
    // /asset-action?code=...) dari kamera bawaan HP maupun scanner internal.
    const trimmed = extractAssetCodeFromQr(code).trim();
    if (!trimmed) {
      setError("QR tidak berisi kode asset yang valid.");
      return;
    }
    // Scan HANYA membaca data — tidak ada write/ubah status di sini sama
    // sekali, perubahan status hanya lewat aksi eksplisit (Pinjam/
    // Kembalikan/Lapor Kendala/Ubah Status admin) di bawah.
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
    const found = { id: d.id, ...d.data() } as Asset;
    setAsset(found);
    pushScanHistory(found);
  };

  // Section J — dipakai tombol "Pinjam Asset"/"Kembalikan Asset" di
  // /asset-action supaya user diarahkan ke alur pinjam/kembalikan yang
  // SUDAH lengkap di halaman ini (custodian/handover/dll), bukan
  // duplikasi logic borrow/return di halaman quick-action.
  useEffect(() => {
    if (!assetUser) return;
    const code = searchParams.get("code");
    if (!code) return;
    queueMicrotask(() => {
      lookupAsset(code);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetUser, searchParams]);


  const isFixedLocationAsset = asset ? resolveTrackingMode(asset) === "fixed_location" : false;
  const isBorrowedByMe = asset?.currentBorrowerUid === assetUser?.uid;
  const isInUseByMe = asset?.responsiblePersonUid === assetUser?.uid && asset?.assetStatus === "in_use";
  const isMyCustodianAsset = asset?.custodianUid === assetUser?.uid;
  const isCurrentHolderMe = asset?.currentHolderUid === assetUser?.uid;
  const canBorrow =
    asset &&
    (asset.currentUsageStatus || asset.assetStatus) === "available" &&
    asset.isBorrowable &&
    !isBorrowedByMe;
  const usedBySomeoneElse =
    asset &&
    isUsageCandidate(asset) &&
    (asset.currentUsageStatus || asset.assetStatus) !== "maintenance" &&
    !isBorrowedByMe &&
    !isInUseByMe &&
    !isCurrentHolderMe &&
    !isMyCustodianAsset;
  const canHandoverTemporary =
    asset &&
    asset.usageType === "assigned_daily" &&
    asset.currentUsageStatus !== "temporary_used_by_other" &&
    (isMyCustodianAsset || isCurrentHolderMe || isManager);
  const canReturnToCustodianNow =
    asset &&
    asset.currentUsageStatus === "temporary_used_by_other" &&
    (isCurrentHolderMe || isMyCustodianAsset || isManager);

  const openReturnFor = async (a: Asset) => {
    // Baris di tabel cuma punya Asset ringkas dari listener assets — sudah
    // cukup lengkap (beda dengan borrowing doc), jadi bisa langsung dipakai.
    setAsset(a);
    setReturnOpen(true);
  };

  const handleReturnToCustodianNow = async (a: Asset) => {
    setReturnSaving(true);
    try {
      await returnToCustodian({
        asset: a,
        performedBy: { uid: assetUser?.uid || "", name: assetUser?.name || "" },
      });
      if (asset?.id === a.id) lookupAsset(a.qrCodeValue);
    } catch (err) {
      console.error("[ScanPage] gagal mengembalikan ke custodian", err);
    } finally {
      setReturnSaving(false);
    }
  };

  const closeHandoverModal = () => {
    setHandoverModalAsset(null);
    setHandoverToUid("");
    setHandoverPurpose("");
    setHandoverExpectedReturnAt("");
    setHandoverError("");
  };

  const handleSubmitHandover = async () => {
    if (!handoverModalAsset) return;
    const selected = employeeOptions.find((u) => u.uid === handoverToUid);
    if (!selected) {
      setHandoverError("Pilih siapa yang akan memakai aset ini.");
      return;
    }
    if (!handoverPurpose.trim()) {
      setHandoverError("Keperluan wajib diisi.");
      return;
    }
    setHandoverSaving(true);
    setHandoverError("");
    try {
      await handoverTemporary({
        asset: handoverModalAsset,
        toUid: selected.uid,
        toName: selected.name,
        toEmail: selected.email || undefined,
        toDivision: selected.divisionName || undefined,
        purpose: handoverPurpose.trim(),
        expectedReturnAt: handoverExpectedReturnAt || undefined,
        performedBy: { uid: assetUser?.uid || "", name: assetUser?.name || "" },
      });
      if (asset?.id === handoverModalAsset.id) lookupAsset(handoverModalAsset.qrCodeValue);
      closeHandoverModal();
    } catch (err) {
      console.error("[ScanPage] gagal menyerahkan aset sementara", err);
      setHandoverError("Gagal menyerahkan aset. Coba lagi.");
    } finally {
      setHandoverSaving(false);
    }
  };

  return (
    <ProtectedLayout>
      <div className="scan-page min-h-screen w-full max-w-full overflow-x-hidden bg-slate-50 px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-4 md:px-6 md:pb-6 md:pt-0">
      <div className="block md:hidden rounded-xl bg-green-50 p-2 text-xs font-semibold text-green-700">
        Mobile Scan Layout Aktif
      </div>

      <PageHeader
        title="Scan QR Aset"
        subtitle="Arahkan kamera ke QR code pada aset, atau masukkan kode secara manual."
      />

      <div className="grid w-full max-w-full grid-cols-1 gap-5 md:grid-cols-2">
        {/* Kiri: area scan — tidak diubah alurnya, cuma dipertahankan */}
        <div className="w-full min-w-0 max-w-full overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
          <div className="flex items-center gap-2 mb-4">
            <div className="h-9 w-9 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
              <ScanLine size={18} />
            </div>
            <h2 className="font-semibold text-slate-800">Kamera Scanner</h2>
          </div>

          <AssetQrScanner onScan={lookupAsset} />
          {error && (
            <p className="text-sm text-red-600 mt-3 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
              {error}
            </p>
          )}

          <div className="mt-6 pt-5 border-t border-slate-100">
            <h3 className="text-sm font-semibold text-slate-700 mb-2">
              Input Manual Kode Aset
            </h3>
            <div className="grid w-full min-w-0 grid-cols-1 gap-2 md:grid-cols-[1fr_auto]">
              <input
                value={manualCode}
                onChange={(e) => setManualCode(e.target.value)}
                placeholder="mis. LAP-2601-AB12"
                className="input w-full min-w-0"
              />
              <button
                onClick={() => lookupAsset(manualCode)}
                className="w-full md:w-auto rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50 inline-flex items-center justify-center gap-1.5 shrink-0 cursor-pointer"
              >
                <Search size={14} />
                Cari
              </button>
            </div>
          </div>
          <Link
            href="/staff-reports/new"
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-semibold text-blue-700 hover:bg-blue-100"
          >
            <ClipboardPlus size={15} />
            Buat Laporan Tanpa QR
          </Link>
        </div>

        {/* Kanan: hasil scan, atau panel informasi ringkas kalau belum scan */}
        <div className="w-full min-w-0 max-w-full overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
          {notFound && (
            <>
              <h2 className="font-semibold text-slate-800 mb-4">Hasil</h2>
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                Asset dengan kode tersebut tidak ditemukan.
              </p>
            </>
          )}

          {!asset && !notFound && (
            <div className="space-y-5">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                <SummaryStat
                  icon={Boxes}
                  label="Sedang Dipakai"
                  value={summary.sedangDipakai}
                  colorClass="bg-blue-50 text-blue-600"
                />
                <SummaryStat
                  icon={ClipboardList}
                  label="Laporan Saya"
                  value={myReportCount}
                  colorClass="bg-red-50 text-red-600"
                />
                <SummaryStat
                  icon={AlertTriangle}
                  label="Terlambat Kembali"
                  value={summary.terlambat}
                  colorClass="bg-amber-50 text-amber-600"
                />
              </div>

              <div>
                <h3 className="text-sm font-semibold text-slate-700 mb-2">
                  Terakhir Dilihat
                </h3>
                {scanHistory.length === 0 ? (
                  <EmptyState
                    icon={PackageSearch}
                    title="Belum ada aset dipindai"
                    description="Scan QR, masukkan kode aset, atau buat laporan tanpa QR."
                  />
                ) : (
                  <ul className="space-y-1.5">
                    {scanHistory.slice(0, 4).map((h) => (
                      <li key={h.assetId}>
                        <button
                          type="button"
                          onClick={() => lookupAsset(h.assetCode)}
                          className="w-full flex items-center justify-between gap-2 rounded-xl border border-slate-200 px-3 py-2 text-left hover:bg-slate-50 cursor-pointer"
                        >
                          <span className="min-w-0">
                            <span className="block text-sm font-medium text-slate-800 truncate">
                              {h.assetName}
                            </span>
                            <span className="block text-xs text-slate-400 truncate">
                              {h.assetCode}
                            </span>
                          </span>
                          <Badge
                            label={ASSET_STATUS_LABEL[h.assetStatus]}
                            colorClass={ASSET_STATUS_COLOR[h.assetStatus]}
                          />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}

          {/* Aset "fixed_location" (AC, meja, CCTV, dll) — section D: TIDAK
              ada Pinjam/Serahkan Sementara/Kembalikan/Pemegang Saat Ini,
              cukup lokasi, PIC lokasi, kondisi, status maintenance, riwayat
              kendala, dan tombol Laporkan Kendala. */}
          {asset && isFixedLocationAsset && (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link
                    href={`/assets/${asset.id}`}
                    className="font-semibold text-slate-900 hover:underline text-lg"
                  >
                    {asset.assetName}
                  </Link>
                  <p className="text-sm text-slate-400">{asset.assetCode}</p>
                </div>
                <Badge label={TRACKING_MODE_LABEL.fixed_location} colorClass="bg-slate-100 text-slate-600 border-slate-200" />
              </div>

              <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-3">
                <Info label="Lokasi" value={asset.locationText || asset.location} />
                <Info label="PIC Lokasi" value={getPersonDisplayName(custodianPersonRef(asset), employeeMap)} />
                <Info label="Kondisi" value={CONDITION_LABEL[asset.condition]} />
                <Info label="Status Maintenance" value={ASSET_STATUS_LABEL[asset.assetStatus]} />
              </div>

              <div className="flex flex-wrap gap-2 pt-1">
                <button
                  onClick={() => setReportIssueOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 text-red-700 px-5 py-2.5 text-sm font-medium hover:bg-red-100 cursor-pointer"
                >
                  <AlertTriangle size={15} />
                  Laporkan Kendala
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedAsset(asset);
                    setAssetDetailModalOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-medium hover:bg-slate-50 cursor-pointer"
                >
                  <Eye size={15} />
                  Lihat Detail
                </button>
                {isManager && (
                  <Link
                    href={`/assets/${asset.id}/edit`}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-medium hover:bg-slate-50"
                  >
                    <Pencil size={15} />
                    Ubah Status
                  </Link>
                )}
              </div>
            </div>
          )}

          {asset && !isFixedLocationAsset && (
            <div className="space-y-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <Link
                    href={`/assets/${asset.id}`}
                    className="font-semibold text-slate-900 hover:underline text-lg"
                  >
                    {asset.assetName}
                  </Link>
                  <p className="text-sm text-slate-400">{asset.assetCode}</p>
                </div>
                <Badge label={getUsagePanel(asset).badge} colorClass={getUsagePanel(asset).colorClass} />
              </div>

              {/* Status pemakaian — section G: pesan singkat + lokasi/tanggal
                  supaya jelas tanpa perlu buka detail. */}
              <div className="rounded-xl border border-slate-200 bg-slate-50 px-3.5 py-2.5 space-y-1">
                <p className="text-sm text-slate-700">{getUsagePanel(asset).message}</p>
                {(asset.assetStatus === "borrowed" || asset.assetStatus === "in_use") && (
                  <>
                    <p className="text-xs text-slate-500">
                      Lokasi terakhir: {asset.locationText || asset.location || "-"}
                    </p>
                    <p className="text-xs text-slate-500">
                      Mulai dipakai:{" "}
                      {asset.assetStatus === "borrowed"
                        ? borrowingByAssetId.get(asset.id)?.borrowedAt
                          ? formatDate(borrowingByAssetId.get(asset.id)!.borrowedAt)
                          : "-"
                        : asset.updatedAt
                        ? formatDate(asset.updatedAt)
                        : "-"}
                    </p>
                  </>
                )}
              </div>

              <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm bg-slate-50 border border-slate-200 rounded-xl px-3.5 py-3">
                <Info label="Kategori" value={asset.categoryName} />
                <Info label="Merk" value={asset.brand} />
                <Info label="Lokasi" value={asset.locationText || asset.location} />
                <Info label="Kondisi" value={CONDITION_LABEL[asset.condition]} />
                <Info label="PIC / Custodian" value={getPersonDisplayName(custodianPersonRef(asset), employeeMap)} />
                <Info label="Dipakai oleh" value={getPersonDisplayName(holderPersonRef(asset), employeeMap)} />
                {asset.currentUsageStatus === "temporary_used_by_other" && (
                  <>
                    <Info label="Keperluan" value={asset.temporaryUsePurpose || undefined} />
                    <Info
                      label="Estimasi Kembali"
                      value={
                        asset.temporaryUseExpectedReturnAt
                          ? formatDate(asset.temporaryUseExpectedReturnAt)
                          : undefined
                      }
                    />
                  </>
                )}
                <Info
                  label="Update Terakhir"
                  value={asset.updatedAt ? formatDateTime(asset.updatedAt) : undefined}
                />
              </div>

              {usedBySomeoneElse && (
                <p className="flex items-center gap-1.5 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">
                  <User size={14} className="shrink-0" />
                  Sedang dipakai oleh{" "}
                  <span className="font-medium">
                    {getPersonDisplayName(holderPersonRef(asset), employeeMap)}
                  </span>{" "}
                  — Anda
                  tidak bisa langsung mengambil alih aset ini.
                </p>
              )}
              {isInUseByMe && (
                <p className="text-sm text-blue-700 bg-blue-50 border border-blue-200 rounded-xl px-3 py-2">
                  Aset ini sedang Anda pakai secara tetap.
                </p>
              )}

              {/* Quick action — beda tergantung siapa yang sedang memakai aset.
                  Scan sendiri TIDAK PERNAH mengubah status; status hanya berubah
                  lewat salah satu tombol aksi eksplisit di bawah ini. */}
              <div className="flex flex-wrap gap-2 pt-1">
                {canBorrow && (
                  <button
                    onClick={() => setBorrowOpen(true)}
                    className="rounded-xl bg-gradient-to-r from-blue-600 to-teal-500 text-white px-5 py-2.5 text-sm font-medium hover:brightness-105 shadow-md shadow-blue-900/20 cursor-pointer"
                  >
                    Ajukan Pinjam
                  </button>
                )}
                {isBorrowedByMe && (
                  <button
                    onClick={() => setReturnOpen(true)}
                    className="rounded-xl bg-emerald-600 text-white px-5 py-2.5 text-sm font-medium hover:bg-emerald-700 shadow-md shadow-emerald-900/10 cursor-pointer"
                  >
                    Kembalikan
                  </button>
                )}
                {(isBorrowedByMe || isInUseByMe) && (
                  <Link
                    href="/my-borrowings"
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-medium hover:bg-slate-50"
                  >
                    <History size={15} />
                    Lihat Riwayat
                  </Link>
                )}
                <button
                  onClick={() => setReportIssueOpen(true)}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-red-200 bg-red-50 text-red-700 px-5 py-2.5 text-sm font-medium hover:bg-red-100 cursor-pointer"
                >
                  <AlertTriangle size={15} />
                  Laporkan Kendala
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedAsset(asset);
                    setAssetDetailModalOpen(true);
                  }}
                  className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-medium hover:bg-slate-50 cursor-pointer"
                >
                  <Eye size={15} />
                  Lihat Detail
                </button>
                {canHandoverTemporary && (
                  <button
                    onClick={() => {
                      setHandoverModalAsset(asset);
                      setHandoverToUid("");
                      setHandoverPurpose("");
                      setHandoverExpectedReturnAt("");
                      setHandoverError("");
                    }}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-medium hover:bg-slate-50 cursor-pointer"
                  >
                    <User size={15} />
                    Serahkan Sementara
                  </button>
                )}
                {canReturnToCustodianNow && (
                  <button
                    onClick={() => handleReturnToCustodianNow(asset)}
                    disabled={returnSaving}
                    className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 text-white px-5 py-2.5 text-sm font-medium hover:bg-emerald-700 cursor-pointer disabled:opacity-60"
                  >
                    <RotateCcw size={15} />
                    {returnSaving ? "Memproses..." : "Kembalikan ke Custodian"}
                  </button>
                )}
                {isManager && asset.assetStatus === "borrowed" && !isBorrowedByMe && (
                  <button
                    onClick={() => setReturnOpen(true)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-medium hover:bg-slate-50 cursor-pointer"
                  >
                    <RotateCcw size={15} />
                    Paksa Kembalikan
                  </button>
                )}
                {isManager && (
                  <Link
                    href={`/assets/${asset.id}/edit`}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-medium hover:bg-slate-50"
                  >
                    <Pencil size={15} />
                    Ubah Status
                  </Link>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Status Pemakaian Aset Kantor — daftar aset kantor (bukan cuma
          milik user login) yang sedang dipinjam/dipakai/maintenance, supaya
          satu kantor tahu posisi barang. */}
      <div className="w-full min-w-0 max-w-full overflow-hidden rounded-2xl border border-slate-200 bg-white p-5 shadow-sm md:p-6 mt-5">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <h2 className="font-semibold text-slate-800">Status Pemakaian Aset Kantor</h2>
            <p className="text-sm text-slate-500 mt-0.5">
              Lihat posisi, PIC operasional, dan pemegang saat ini untuk aset kantor.
            </p>
          </div>
        </div>

        {/* Summary cards — ringkasan utama, tampil sebelum filter/daftar,
            angka global (bukan cuma milik user login). */}
        <div className="grid w-full min-w-0 grid-cols-1 gap-3 mb-4 sm:grid-cols-2 lg:grid-cols-4">
          <SummaryStat icon={Boxes} label="Sedang Dipakai" value={summary.sedangDipakai} colorClass="bg-blue-50 text-blue-600" />
          <SummaryStat icon={CheckCircle2} label="Tersedia" value={summary.tersedia} colorClass="bg-emerald-50 text-emerald-600" />
          <SummaryStat icon={Wrench} label="Maintenance" value={summary.maintenance} colorClass="bg-purple-50 text-purple-600" />
          <SummaryStat icon={AlertTriangle} label="Terlambat Kembali" value={summary.terlambat} colorClass="bg-red-50 text-red-600" />
        </div>

        <div className="flex gap-2 overflow-x-auto pb-2 md:flex-wrap md:overflow-visible mb-3 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          {USAGE_FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setUsageFilter(f.key)}
              className={`shrink-0 rounded-xl border px-3 py-1.5 text-sm font-medium cursor-pointer transition-colors ${
                usageFilter === f.key
                  ? "border-blue-500 bg-blue-50 text-blue-700"
                  : "border-slate-200 text-slate-600 hover:bg-slate-50"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <input
          value={usageSearch}
          onChange={(e) => setUsageSearch(e.target.value)}
          placeholder="Cari nama aset, kode, pemakai, lokasi..."
          className="input text-sm w-full mb-4"
        />

        {filteredUsageRows.length === 0 ? (
          <EmptyState
            icon={Boxes}
            title="Belum ada aset yang sedang dipakai"
            description="Saat ada aset yang dipinjam atau digunakan karyawan, datanya akan muncul di sini."
          />
        ) : (
          <>
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full min-w-[880px] text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-200 bg-slate-50/60">
                  <th className="px-4 py-3 font-semibold">Nama Aset</th>
                  <th className="px-4 py-3 font-semibold">Kode</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">PIC Operasional</th>
                  <th className="px-4 py-3 font-semibold">Pemegang Saat Ini</th>
                  <th className="px-4 py-3 font-semibold">Lokasi</th>
                  <th className="px-4 py-3 font-semibold">Estimasi Kembali</th>
                  <th className="px-4 py-3 font-semibold text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {filteredUsageRows.map((row) => {
                  const a = row.raw;
                  const overdue = isOverdue(row.expectedReturnAt);
                  const mineBorrowed = a.currentBorrowerUid === assetUser?.uid;
                  const mineInUse =
                    a.responsiblePersonUid === assetUser?.uid && a.assetStatus === "in_use";
                  // Penanda "aset saya" (section E/G) — dicek dari uid, BUKAN
                  // dari nama (nama bisa ambigu/duplikat, uid tidak).
                  const isMineHolder = !!assetUser?.uid && row.currentHolderUid === assetUser.uid;
                  const isMineCustodian = !!assetUser?.uid && row.custodianUid === assetUser.uid;
                  const rowHighlight = isMineHolder
                    ? "bg-blue-50/50"
                    : isMineCustodian
                    ? "bg-emerald-50/40"
                    : "";
                  return (
                    <tr key={row.id} className={`border-b border-slate-100 last:border-0 ${rowHighlight}`}>
                      <td className="px-4 py-3 font-medium text-slate-800">
                        {row.assetName}
                        {isMineHolder && (
                          <span className="ml-2 inline-block rounded-full bg-blue-100 text-blue-700 px-2 py-0.5 text-[10px] font-semibold align-middle">
                            Aset sedang Anda pegang
                          </span>
                        )}
                        {!isMineHolder && isMineCustodian && (
                          <span className="ml-2 inline-block rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5 text-[10px] font-semibold align-middle">
                            Tanggung jawab Anda
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-slate-500">{row.assetCode}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <Badge
                            label={row.statusLabel}
                            colorClass={
                              row.status === "in_use"
                                ? "bg-blue-100 text-blue-700"
                                : row.status === "maintenance"
                                ? "bg-purple-100 text-purple-700"
                                : "bg-emerald-100 text-emerald-700"
                            }
                          />
                          {overdue && <Badge label="Terlambat" colorClass="bg-red-100 text-red-700" />}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <PersonCell
                          name={row.custodianName}
                          subInfo={row.custodianSubInfo}
                          badge={
                            isMineHolder && isMineCustodian
                              ? undefined
                              : isMineCustodian
                              ? "Tanggung Jawab Saya"
                              : undefined
                          }
                        />
                      </td>
                      <td className="px-4 py-3">
                        <PersonCell
                          name={row.currentHolderName}
                          subInfo={row.currentHolderSubInfo}
                          badge={
                            isMineHolder && isMineCustodian
                              ? "PIC & Pemegang Saat Ini"
                              : isMineHolder
                              ? "Sedang Saya Pegang"
                              : undefined
                          }
                        />
                      </td>
                      <td className="px-4 py-3 text-slate-600">{row.locationText}</td>
                      <td className="px-4 py-3 text-slate-500">
                        {row.expectedReturnAt ? formatDate(row.expectedReturnAt) : "-"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="inline-flex items-center gap-3 flex-wrap justify-end">
                          <button
                            type="button"
                            onClick={() => {
                              if (!row.assetId) {
                                setToast({ type: "error", message: "ID aset tidak ditemukan." });
                                return;
                              }
                              const found = allAssets.find((item) => item.id === row.assetId);
                              if (!found) {
                                setToast({ type: "error", message: "Data aset tidak ditemukan." });
                                return;
                              }
                              setSelectedAsset(found);
                              setAssetDetailModalOpen(true);
                            }}
                            className="text-sm font-medium text-blue-600 hover:underline cursor-pointer"
                          >
                            Lihat Detail
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setAsset(a);
                              setReportIssueOpen(true);
                            }}
                            className="text-sm font-medium text-red-600 hover:underline cursor-pointer"
                          >
                            Laporkan Kendala
                          </button>
                          {/* Staff hanya boleh kembalikan barang yang dia pinjam
                              sendiri — TIDAK BOLEH ambil alih/mengembalikan
                              punya orang lain. */}
                          {mineBorrowed && (
                            <button
                              type="button"
                              onClick={() => openReturnFor(a)}
                              className="text-sm font-medium text-emerald-600 hover:underline cursor-pointer"
                            >
                              Kembalikan
                            </button>
                          )}
                          {mineInUse && (
                            <Link
                              href="/my-borrowings"
                              className="text-sm font-medium text-slate-500 hover:underline"
                            >
                              Riwayat
                            </Link>
                          )}
                          {isManager && (
                            <>
                              {a.assetStatus === "borrowed" && !mineBorrowed && (
                                <button
                                  type="button"
                                  onClick={() => openReturnFor(a)}
                                  className="text-sm font-medium text-slate-500 hover:underline cursor-pointer"
                                >
                                  Paksa Kembalikan
                                </button>
                              )}
                              <Link
                                href={`/assets/${row.assetId}/edit`}
                                className="text-sm font-medium text-slate-500 hover:underline"
                              >
                                Ubah Status
                              </Link>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile — card list menggantikan table (section C). */}
          <div className="block md:hidden space-y-3">
            {filteredUsageRows.map((row) => {
              const a = row.raw;
              const overdue = isOverdue(row.expectedReturnAt);
              const mineBorrowed = a.currentBorrowerUid === assetUser?.uid;
              const mineInUse =
                a.responsiblePersonUid === assetUser?.uid && a.assetStatus === "in_use";
              const isMineHolder = !!assetUser?.uid && row.currentHolderUid === assetUser.uid;
              const isMineCustodian = !!assetUser?.uid && row.custodianUid === assetUser.uid;
              return (
                <div
                  key={row.id}
                  className="w-full max-w-full rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold text-slate-900 break-words">
                        {row.assetName || "-"}
                      </h3>
                      <p className="mt-0.5 text-xs text-slate-500 break-all">{row.assetCode || "-"}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <Badge
                        label={row.statusLabel}
                        colorClass={
                          row.status === "in_use"
                            ? "bg-blue-100 text-blue-700"
                            : row.status === "maintenance"
                            ? "bg-purple-100 text-purple-700"
                            : "bg-emerald-100 text-emerald-700"
                        }
                      />
                      {overdue && <Badge label="Terlambat" colorClass="bg-red-100 text-red-700" />}
                    </div>
                  </div>

                  <div className="mt-4 space-y-3 text-sm">
                    <div>
                      <p className="text-xs text-slate-400">PIC Operasional</p>
                      <PersonCell
                        name={row.custodianName}
                        subInfo={row.custodianSubInfo}
                        badge={
                          isMineHolder && isMineCustodian
                            ? undefined
                            : isMineCustodian
                            ? "Tanggung Jawab Saya"
                            : undefined
                        }
                      />
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Pemegang Saat Ini</p>
                      <PersonCell
                        name={row.currentHolderName}
                        subInfo={row.currentHolderSubInfo}
                        badge={
                          isMineHolder && isMineCustodian
                            ? "PIC & Pemegang Saat Ini"
                            : isMineHolder
                            ? "Sedang Saya Pegang"
                            : undefined
                        }
                      />
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Lokasi</p>
                      <p className="font-medium text-slate-700 break-words">{row.locationText || "-"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Estimasi Kembali</p>
                      <p className="font-medium text-slate-700">
                        {row.expectedReturnAt ? formatDate(row.expectedReturnAt) : "-"}
                      </p>
                    </div>
                  </div>

                  <div className="mt-4 grid grid-cols-1 gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (!row.assetId) {
                          setToast({ type: "error", message: "ID aset tidak ditemukan." });
                          return;
                        }
                        const found = allAssets.find((item) => item.id === row.assetId);
                        if (!found) {
                          setToast({ type: "error", message: "Data aset tidak ditemukan." });
                          return;
                        }
                        setSelectedAsset(found);
                        setAssetDetailModalOpen(true);
                      }}
                      className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 cursor-pointer hover:bg-slate-50"
                    >
                      Lihat Detail
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setAsset(a);
                        setReportIssueOpen(true);
                      }}
                      className="w-full rounded-xl border border-red-200 px-3 py-2 text-sm font-medium text-red-600 cursor-pointer hover:bg-red-50"
                    >
                      Laporkan Kendala
                    </button>
                    {mineBorrowed && (
                      <button
                        type="button"
                        onClick={() => openReturnFor(a)}
                        className="w-full rounded-xl border border-emerald-200 px-3 py-2 text-sm font-medium text-emerald-700 cursor-pointer hover:bg-emerald-50"
                      >
                        Kembalikan
                      </button>
                    )}
                    {mineInUse && (
                      <Link
                        href="/my-borrowings"
                        className="w-full text-center rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
                      >
                        Riwayat
                      </Link>
                    )}
                    {isManager && (
                      <>
                        {a.assetStatus === "borrowed" && !mineBorrowed && (
                          <button
                            type="button"
                            onClick={() => openReturnFor(a)}
                            className="w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 cursor-pointer hover:bg-slate-50"
                          >
                            Paksa Kembalikan
                          </button>
                        )}
                        <Link
                          href={`/assets/${row.assetId}/edit`}
                          className="w-full text-center rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
                        >
                          Ubah Status
                        </Link>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
          </>
        )}
      </div>

      {/* Riwayat scan saya — riwayat lokal per-user (lihat catatan di
          loadScanHistory/saveScanHistory di atas). */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 md:p-6 mt-5">
        <h2 className="font-semibold text-slate-800 mb-4">Riwayat Scan Saya</h2>
        {scanHistory.length === 0 ? (
          <EmptyState icon={History} title="Belum ada riwayat scan" />
        ) : (
          <>
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-200 bg-slate-50/60">
                  <th className="px-4 py-3 font-semibold">Nama Aset</th>
                  <th className="px-4 py-3 font-semibold">Kode Aset</th>
                  <th className="px-4 py-3 font-semibold">Waktu Scan</th>
                  <th className="px-4 py-3 font-semibold">Status Saat Discan</th>
                  <th className="px-4 py-3 font-semibold text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {scanHistory.map((h) => (
                  <tr key={`${h.assetId}-${h.scannedAt}`} className="border-b border-slate-100 last:border-0">
                    <td className="px-4 py-3 font-medium text-slate-800">{h.assetName}</td>
                    <td className="px-4 py-3 text-slate-500">{h.assetCode}</td>
                    <td className="px-4 py-3 text-slate-500">
                      <span className="inline-flex items-center gap-1.5">
                        <Clock size={13} className="text-slate-400" />
                        {formatDateTime(new Date(h.scannedAt))}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <Badge label={ASSET_STATUS_LABEL[h.assetStatus]} colorClass={ASSET_STATUS_COLOR[h.assetStatus]} />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => lookupAsset(h.assetCode)}
                        className="text-sm font-medium text-blue-600 hover:underline cursor-pointer"
                      >
                        Lihat Detail
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="block md:hidden space-y-3">
            {scanHistory.map((h) => (
              <div
                key={`${h.assetId}-${h.scannedAt}`}
                className="w-full max-w-full rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold text-slate-900 break-words">{h.assetName}</h3>
                    <p className="mt-0.5 text-xs text-slate-500 break-all">{h.assetCode}</p>
                  </div>
                  <Badge label={ASSET_STATUS_LABEL[h.assetStatus]} colorClass={ASSET_STATUS_COLOR[h.assetStatus]} />
                </div>
                <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-slate-500">
                  <Clock size={13} className="text-slate-400" />
                  {formatDateTime(new Date(h.scannedAt))}
                </p>
                <button
                  type="button"
                  onClick={() => lookupAsset(h.assetCode)}
                  className="mt-3 w-full rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 cursor-pointer hover:bg-slate-50"
                >
                  Lihat Detail
                </button>
              </div>
            ))}
          </div>
          </>
        )}
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
          <ReportIssueModal
            asset={asset}
            open={reportIssueOpen}
            onClose={() => setReportIssueOpen(false)}
          />
        </>
      )}

      <ConfirmModal
        open={!!handoverModalAsset}
        title="Serahkan Sementara"
        description="Catat siapa yang sedang memegang aset ini sementara — begitu selesai, kembalikan lewat tombol Kembalikan ke Custodian."
        confirmLabel={handoverSaving ? "Menyimpan..." : "Serahkan"}
        onConfirm={handleSubmitHandover}
        onCancel={closeHandoverModal}
      >
        <div className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Dipakai oleh</label>
            <SearchableSelect
              items={employeeSelectItems}
              value={handoverToUid}
              onChange={setHandoverToUid}
              placeholder="Pilih karyawan"
              searchPlaceholder="Cari nama karyawan..."
              emptyText="Karyawan tidak ditemukan"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">
              Keperluan <span className="text-red-500">*</span>
            </label>
            <input
              value={handoverPurpose}
              onChange={(e) => setHandoverPurpose(e.target.value)}
              placeholder="mis. Shooting konten kantor"
              className="input text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Estimasi Kembali</label>
            <input
              type="date"
              value={handoverExpectedReturnAt}
              onChange={(e) => setHandoverExpectedReturnAt(e.target.value)}
              className="input text-sm"
            />
          </div>
          {handoverError && <p className="text-sm text-red-600">{handoverError}</p>}
        </div>
      </ConfirmModal>

      {assetDetailModalOpen && selectedAsset && (
        <AssetQuickDetailModal
          asset={selectedAsset}
          employeeMap={employeeMap}
          currentUserUid={assetUser?.uid || null}
          isManager={isManager}
          logs={modalLogs}
          tickets={modalTickets}
          historyLoading={modalHistoryLoading}
          onClose={() => {
            setAssetDetailModalOpen(false);
            setSelectedAsset(null);
          }}
          onRequestTemporaryUse={() => {
            setAsset(selectedAsset);
            setBorrowOpen(true);
            setAssetDetailModalOpen(false);
          }}
          onHandoverTemporary={() => {
            setHandoverModalAsset(selectedAsset);
            setHandoverToUid("");
            setHandoverPurpose("");
            setHandoverExpectedReturnAt("");
            setHandoverError("");
            setAssetDetailModalOpen(false);
          }}
          onReturnToCustodian={() => {
            handleReturnToCustodianNow(selectedAsset);
            setAssetDetailModalOpen(false);
          }}
          onReportIssue={() => {
            setAsset(selectedAsset);
            setReportIssueOpen(true);
            setAssetDetailModalOpen(false);
          }}
          onOpenAdminDetail={() => {
            router.push(`/assets/${selectedAsset.id}`);
            setAssetDetailModalOpen(false);
          }}
        />
      )}

      <Toast toast={toast} onClose={() => setToast(null)} />
      </div>
    </ProtectedLayout>
  );
}

function SummaryStat({
  icon: Icon,
  label,
  value,
  colorClass,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: number;
  colorClass: string;
}) {
  return (
    <div className="rounded-2xl border border-slate-200 p-3 flex flex-col gap-1.5">
      <div className={`h-8 w-8 rounded-lg flex items-center justify-center ${colorClass}`}>
        <Icon size={15} />
      </div>
      <p className="text-xl font-semibold text-slate-900 leading-none">{value}</p>
      <p className="text-xs text-slate-500 leading-tight">{label}</p>
    </div>
  );
}

function Info({ label, value }: { label: string; value?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-slate-400 flex items-center gap-1">
        {label === "Lokasi" && <MapPin size={11} />}
        {label}
      </p>
      <p className="font-medium text-slate-800 truncate">{value || "-"}</p>
    </div>
  );
}

// Label singkat untuk riwayat pemakaian (section H, item 13) — aksi custodian
// dari writeAssetLog di custodian-actions.ts, fallback ke action mentah untuk
// log lama/lain yang belum dikenal di sini.
const ASSET_LOG_ACTION_SUMMARY: Record<string, (log: AssetLog) => string> = {
  assigned_to_custodian: (log) => `PIC diatur ke ${log.toName || log.custodianName || "-"} oleh ${log.userName}`,
  custodian_changed: (log) => `PIC diubah ke ${log.toName || log.custodianName || "-"} oleh ${log.userName}`,
  temporary_handover: (log) => `Dipakai sementara oleh ${log.toName || "-"}`,
  temporary_returned: (log) => `Dikembalikan ke ${log.toName || log.custodianName || "-"}`,
  forced_return: (log) => `Dipaksa kembalikan oleh ${log.userName}`,
  holder_corrected: (log) => `Pemegang dikoreksi oleh ${log.userName}`,
};

function summarizeAssetLog(log: AssetLog): string {
  const summarize = ASSET_LOG_ACTION_SUMMARY[log.action];
  if (summarize) return summarize(log);
  return log.detail || `${log.action} oleh ${log.userName}`;
}

function AssetQuickDetailModal({
  asset,
  employeeMap,
  currentUserUid,
  isManager,
  logs,
  tickets,
  historyLoading,
  onClose,
  onRequestTemporaryUse,
  onHandoverTemporary,
  onReturnToCustodian,
  onReportIssue,
  onOpenAdminDetail,
}: {
  asset: Asset;
  employeeMap: EmployeeMap;
  currentUserUid: string | null;
  isManager: boolean;
  logs: AssetLog[];
  tickets: AssetIssueTicket[];
  historyLoading: boolean;
  onClose: () => void;
  onRequestTemporaryUse: () => void;
  onHandoverTemporary: () => void;
  onReturnToCustodian: () => void;
  onReportIssue: () => void;
  onOpenAdminDetail: () => void;
}) {
  const isMyCustodian = asset.custodianUid === currentUserUid;
  const isCurrentHolderMe = asset.currentHolderUid === currentUserUid;
  const isBorrowedByMe = asset.currentBorrowerUid === currentUserUid;
  const canBorrow =
    (asset.currentUsageStatus || asset.assetStatus) === "available" &&
    asset.isBorrowable &&
    !isBorrowedByMe;
  const canHandoverTemporary =
    asset.usageType === "assigned_daily" &&
    asset.currentUsageStatus !== "temporary_used_by_other" &&
    (isMyCustodian || isCurrentHolderMe || isManager);
  const canReturnToCustodianNow =
    asset.currentUsageStatus === "temporary_used_by_other" &&
    (isCurrentHolderMe || isMyCustodian || isManager);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4">
      <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-xl">
        <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
          <div className="min-w-0">
            <h3 className="font-semibold text-slate-900">Detail Aset</h3>
            <p className="text-sm text-slate-800 truncate mt-0.5">{asset.assetName}</p>
            <p className="text-xs text-slate-400">{asset.assetCode}</p>
          </div>
          <Badge label={getUsagePanel(asset).badge} colorClass={getUsagePanel(asset).colorClass} />
        </div>

        <div className="px-5 py-4 space-y-4">
          <div>
            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Informasi</h4>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
              <Info label="Kategori" value={asset.categoryName} />
              <Info label="Merk / Model" value={[asset.brand, asset.model].filter(Boolean).join(" / ")} />
              <Info label="Kondisi" value={CONDITION_LABEL[asset.condition]} />
              <Info label="Lokasi" value={asset.locationText || asset.location} />
            </div>
          </div>

          <div>
            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Pemakaian</h4>
            <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-sm">
              <Info label="PIC Operasional" value={getPersonDisplayName(custodianPersonRef(asset), employeeMap)} />
              <Info label="Pemegang Saat Ini" value={getPersonDisplayName(holderPersonRef(asset), employeeMap)} />
              <Info label="Status Pemakaian" value={getUsagePanel(asset).badge} />
              {asset.currentUsageStatus === "temporary_used_by_other" && (
                <>
                  <Info label="Keperluan" value={asset.temporaryUsePurpose || undefined} />
                  <Info
                    label="Estimasi Kembali"
                    value={
                      asset.temporaryUseExpectedReturnAt
                        ? formatDate(asset.temporaryUseExpectedReturnAt)
                        : undefined
                    }
                  />
                </>
              )}
            </div>
          </div>

          <div>
            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Riwayat Singkat</h4>
            {historyLoading ? (
              <p className="text-sm text-slate-400">Memuat...</p>
            ) : logs.length === 0 ? (
              <p className="text-sm text-slate-400">Belum ada riwayat pemakaian.</p>
            ) : (
              <ul className="space-y-1.5">
                {logs.map((log) => (
                  <li key={log.id} className="text-sm text-slate-600">
                    {summarizeAssetLog(log)}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div>
            <h4 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Kendala Singkat</h4>
            {historyLoading ? (
              <p className="text-sm text-slate-400">Memuat...</p>
            ) : tickets.length === 0 ? (
              <p className="text-sm text-slate-400">Belum ada laporan kendala.</p>
            ) : (
              <ul className="space-y-1.5">
                {tickets.map((t) => (
                  <li key={t.id} className="text-sm text-slate-600">
                    {t.symptomType} — {t.status}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="flex flex-wrap gap-2 border-t border-slate-100 px-5 py-4">
          {canBorrow && (
            <button
              type="button"
              onClick={onRequestTemporaryUse}
              className="rounded-xl bg-gradient-to-r from-blue-600 to-teal-500 text-white px-4 py-2 text-sm font-medium hover:brightness-105 cursor-pointer"
            >
              Minta Pakai Sementara
            </button>
          )}
          {canHandoverTemporary && (
            <button
              type="button"
              onClick={onHandoverTemporary}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50 cursor-pointer"
            >
              Serahkan Sementara
            </button>
          )}
          {canReturnToCustodianNow && (
            <button
              type="button"
              onClick={onReturnToCustodian}
              className="rounded-xl bg-emerald-600 text-white px-4 py-2 text-sm font-medium hover:bg-emerald-700 cursor-pointer"
            >
              Kembalikan ke Custodian
            </button>
          )}
          <button
            type="button"
            onClick={onReportIssue}
            className="rounded-xl border border-red-200 bg-red-50 text-red-700 px-4 py-2 text-sm font-medium hover:bg-red-100 cursor-pointer"
          >
            Lapor Kendala
          </button>
          {isManager && (
            <button
              type="button"
              onClick={onOpenAdminDetail}
              className="rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium hover:bg-slate-50 cursor-pointer"
            >
              Buka Detail Admin
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-xl border border-slate-200 px-4 py-2 text-sm font-medium text-slate-500 hover:bg-slate-50 cursor-pointer"
          >
            Tutup
          </button>
        </div>
      </div>
    </div>
  );
}

// Sel "Dipakai Oleh"/"PIC Aset" di tabel Status Pemakaian Aset Kantor — nama
// besar, sub-info (divisi/brand/role) kecil di bawahnya, badge kepemilikan
// kalau relevan. TIDAK PERNAH menampilkan email di sini.
function PersonCell({
  name,
  subInfo,
  badge,
}: {
  name: string;
  subInfo?: string;
  badge?: string;
}) {
  if (name === "-") return <span className="text-slate-400">-</span>;
  return (
    <div>
      <div className="font-medium text-slate-900">{name}</div>
      {subInfo && <div className="text-xs text-slate-500">{subInfo}</div>}
      {badge && (
        <span className="mt-0.5 inline-block rounded-full bg-slate-100 text-slate-600 px-2 py-0.5 text-[10px] font-semibold">
          {badge}
        </span>
      )}
    </div>
  );
}
