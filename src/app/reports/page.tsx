"use client";

import { useEffect, useMemo, useState } from "react";
import {
  addDoc,
  collection,
  collectionGroup,
  onSnapshot,
  serverTimestamp,
} from "firebase/firestore";
import { Camera } from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import {
  Asset,
  AssetBorrowing,
  AssetCategory,
  AssetIssueTicket,
  MaintenanceWorkOrder,
  MaintenanceWorkOrderItem,
} from "@/lib/types";
import {
  assetMatchesFilters,
  DEFAULT_REPORT_FILTERS,
  isMaintenanceOverdue,
  isWithinRange,
  resolveDateRange,
} from "@/lib/reports";
import ProtectedLayout from "@/components/ProtectedLayout";
import PageHeader from "@/components/PageHeader";
import ReportsFilterBar from "@/components/reports/ReportsFilterBar";
import OverviewTab from "@/components/reports/tabs/OverviewTab";
import AssetHealthTab from "@/components/reports/tabs/AssetHealthTab";
import TicketReportTab from "@/components/reports/tabs/TicketReportTab";
import MaintenanceReportTab from "@/components/reports/tabs/MaintenanceReportTab";
import BorrowingReportTab from "@/components/reports/tabs/BorrowingReportTab";
import LocationReportTab from "@/components/reports/tabs/LocationReportTab";
import CostReportTab from "@/components/reports/tabs/CostReportTab";
import RecommendationReportTab from "@/components/reports/tabs/RecommendationReportTab";
import ExportTab from "@/components/reports/tabs/ExportTab";
import FinanceReportTab from "@/components/reports/tabs/FinanceReportTab";

type TabKey =
  | "overview"
  | "asset_health"
  | "ticket"
  | "maintenance"
  | "borrowing"
  | "location"
  | "cost"
  | "export"
  | "finance";

const TABS: { key: TabKey; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "asset_health", label: "Asset Health" },
  { key: "ticket", label: "Ticket Kendala" },
  { key: "maintenance", label: "Maintenance" },
  { key: "borrowing", label: "Borrowing" },
  { key: "location", label: "Lokasi & Ruangan" },
  { key: "cost", label: "Cost & Recommendation" },
  { key: "export", label: "Export" },
];

// Section "Rekap Laporan Finance" — Finance TIDAK diberi akses baca
// asset_maintenance_work_orders/asset_maintenance_work_order_items/
// asset_issue_tickets (firestore.rules TETAP tidak diubah), jadi Finance
// sama sekali tidak bisa dapat tab yang bergantung pada data itu (Asset
// Health, Ticket Kendala, Maintenance, Borrowing/Location — semuanya
// menerima props tickets/workOrders untuk hitung overdue/temuan). Satu tab
// baru "Rekap Finance" (lihat FinanceReportTab) menggantikan semuanya,
// dihitung murni dari assets/categories/borrowings.
const FINANCE_TABS: { key: TabKey; label: string }[] = [
  { key: "finance", label: "Rekap Finance" },
];

export default function ReportsPage() {
  const { firebaseUser, assetUser, role, loading } = useAuth();
  const authReady = !loading && !!firebaseUser && !!assetUser && !!role;

  // Section A — Recharts menghasilkan id SVG (clipPath, dst) yang beda
  // antara render server dan client (counter internal Recharts tidak
  // deterministic lintas proses), jadi chart WAJIB baru dirender setelah
  // client mounted — bukan langsung ikut initial render/hydration.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    Promise.resolve().then(() => setMounted(true));
  }, []);

  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [filters, setFilters] = useState(DEFAULT_REPORT_FILTERS);

  const [assets, setAssets] = useState<Asset[]>([]);
  const [categories, setCategories] = useState<AssetCategory[]>([]);
  const [tickets, setTickets] = useState<AssetIssueTicket[]>([]);
  const [workOrders, setWorkOrders] = useState<MaintenanceWorkOrder[]>([]);
  const [items, setItems] = useState<MaintenanceWorkOrderItem[]>([]);
  const [borrowings, setBorrowings] = useState<AssetBorrowing[]>([]);
  const [loadError, setLoadError] = useState("");
  const [snapshotSaving, setSnapshotSaving] = useState(false);
  const [snapshotSaved, setSnapshotSaved] = useState(false);
  const canViewReports =
    authReady && (role === "super_admin" || role === "asset_admin" || role === "asset_finance");

  // Section "Rekap Laporan Finance" — Finance TIDAK boleh membaca
  // asset_maintenance_work_orders/asset_maintenance_work_order_items/
  // asset_issue_tickets (rules collection itu TETAP tidak diubah), jadi
  // query/listener-nya wajib berhenti untuk role ini, bukan cuma disembunyikan
  // di UI — kalau tetap jalan, Firestore balas "Missing or insufficient
  // permissions" persis seperti bug yang dilaporkan.
  const isFinance = role === "asset_finance";
  const canLoadMaintenanceReport =
    authReady && (role === "super_admin" || role === "asset_admin" || role === "it_team");

  // Section "Pemisahan data finance per role" — SATU-SATUNYA helper yang
  // dipakai untuk memutuskan boleh/tidaknya melihat nominal Rupiah aset
  // (Harga Perolehan, Total Nilai Asset, Invoice, Vendor, dst) di Reports.
  // Asset Admin/QHSE/IT tetap boleh baca collection `assets` penuh untuk
  // kebutuhan operasional (lokasi/kondisi/maintenance) — yang dibatasi di
  // sini murni tampilan/agregasi finance-nya, BUKAN akses datanya.
  const canViewFinanceData = role === "asset_finance" || role === "super_admin";

  // Tab "Cost & Recommendation" berisi nominal Rupiah — untuk role yang
  // tidak boleh lihat data finance, labelnya diganti "Recommendation" (isi
  // tab-nya sendiri juga dikosongkan dari harga, lihat CostReportTab).
  const visibleTabs = (isFinance ? FINANCE_TABS : TABS).map((t) =>
    t.key === "cost" && !canViewFinanceData ? { ...t, label: "Recommendation" } : t
  );
  // "Adjust state during render" (bukan useEffect) — begitu role diketahui
  // finance, activeTab yang defaultnya "overview" (tidak ada di FINANCE_TABS)
  // langsung dipindah ke tab pertama yang valid untuk role ini.
  const visibleTabKey = visibleTabs.map((t) => t.key).join(",");
  const [prevVisibleTabKey, setPrevVisibleTabKey] = useState("");
  if (visibleTabKey !== prevVisibleTabKey) {
    setPrevVisibleTabKey(visibleTabKey);
    if (!visibleTabs.some((t) => t.key === activeTab)) {
      setActiveTab(visibleTabs[0].key);
    }
  }

  const handleIndexError = (label: string) => (err: unknown) => {
    console.error(`[Reports] error loading ${label}`, err);
    setLoadError(
      "Firestore membutuhkan index untuk filter ini. Cek console untuk link pembuatan index."
    );
  };

  useEffect(() => {
    if (!canViewReports) return;
    console.debug("[Reports] loading assets");
    const unsub = onSnapshot(
      collection(db, "assets"),
      (snap) => {
        console.log("[Reports Listener] assets success:", snap.size);
        setAssets(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Asset)));
      },
      handleIndexError("assets")
    );
    return () => unsub();
  }, [canViewReports]);

  useEffect(() => {
    if (!canViewReports) return;
    const unsub = onSnapshot(
      collection(db, "asset_categories"),
      (snap) => {
        console.log("[Reports Listener] asset_categories success:", snap.size);
        setCategories(snap.docs.map((d) => ({ id: d.id, ...d.data() } as AssetCategory)));
      },
      handleIndexError("asset_categories")
    );
    return () => unsub();
  }, [canViewReports]);

  useEffect(() => {
    // Finance TIDAK punya izin baca asset_issue_tickets — listener wajib
    // tidak pernah dibuat untuk role ini (bukan cuma di-unsubscribe setelah
    // error permission).
    if (!canLoadMaintenanceReport) return;
    console.debug("[Reports] loading tickets");
    const unsub = onSnapshot(
      collection(db, "asset_issue_tickets"),
      (snap) => {
        console.log("[Reports Listener] asset_issue_tickets success:", snap.size);
        setTickets(snap.docs.map((d) => ({ id: d.id, ...d.data() } as AssetIssueTicket)));
      },
      handleIndexError("tickets")
    );
    return () => unsub();
  }, [canLoadMaintenanceReport]);

  useEffect(() => {
    // Sama seperti tickets di atas — asset_maintenance_work_orders di luar
    // izin baca Finance.
    if (!canLoadMaintenanceReport) return;
    console.debug("[Reports] loading maintenance");
    const unsub = onSnapshot(
      collection(db, "asset_maintenance_work_orders"),
      (snap) => {
        console.log("[Reports Listener] asset_maintenance_work_orders success:", snap.size);
        setWorkOrders(snap.docs.map((d) => ({ id: d.id, ...d.data() } as MaintenanceWorkOrder)));
      },
      handleIndexError("maintenance work orders")
    );
    return () => unsub();
  }, [canLoadMaintenanceReport]);

  useEffect(() => {
    // collectionGroup("items") ada di bawah asset_maintenance_work_orders/
    // {id}/items — subcollection yang sama, izin bacanya sama, jadi gate-nya
    // juga canLoadMaintenanceReport (bukan canViewReports).
    if (!canLoadMaintenanceReport) return;
    const unsub = onSnapshot(
      collectionGroup(db, "items"),
      (snap) => {
        console.log("[Reports Listener] collectionGroup items success:", snap.size);
        setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() } as MaintenanceWorkOrderItem)));
      },
      handleIndexError("maintenance work order items")
    );
    return () => unsub();
  }, [canLoadMaintenanceReport]);

  useEffect(() => {
    if (!canViewReports) return;
    console.debug("[Reports] loading borrowings");
    const unsub = onSnapshot(
      collection(db, "asset_borrowings"),
      (snap) => {
        console.log("[Reports Listener] asset_borrowings success:", snap.size);
        setBorrowings(snap.docs.map((d) => ({ id: d.id, ...d.data() } as AssetBorrowing)));
      },
      handleIndexError("borrowings")
    );
    return () => unsub();
  }, [canViewReports]);

  useEffect(() => {
    console.debug("[Reports] filters", filters);
  }, [filters]);

  // Debug SEMENTARA (hapus setelah overflow mobile terkonfirmasi beres) —
  // cari elemen mana persis di dalam .reports-page yang scrollWidth-nya
  // lebih lebar dari clientWidth-nya.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (window.innerWidth >= 768) return;

    const overflowing = Array.from(document.querySelectorAll(".reports-page *"))
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
          text: element.textContent?.slice(0, 60),
        };
      });

    console.log("[Reports Mobile Overflow Debug]", overflowing);
  }, []);

  const { from: dateFrom, to: dateTo } = useMemo(
    () => resolveDateRange(filters.datePreset, filters.customFrom, filters.customTo),
    [filters.datePreset, filters.customFrom, filters.customTo]
  );

  const filteredAssets = useMemo(
    () => assets.filter((a) => assetMatchesFilters(a, filters)),
    [assets, filters]
  );
  const filteredAssetIds = useMemo(() => new Set(filteredAssets.map((a) => a.id)), [filteredAssets]);

  const filteredTickets = useMemo(
    () => tickets.filter((t) => !!t.assetId && filteredAssetIds.has(t.assetId)),
    [tickets, filteredAssetIds]
  );
  const filteredWorkOrders = useMemo(
    () => workOrders.filter((w) => w.assetIds?.some((id) => filteredAssetIds.has(id))),
    [workOrders, filteredAssetIds]
  );
  const filteredBorrowings = useMemo(
    () => borrowings.filter((b) => assets.some((a) => a.id && a.assetCode === b.assetCode && filteredAssetIds.has(a.id))),
    [borrowings, assets, filteredAssetIds]
  );

  const handleGenerateSnapshot = async () => {
    setSnapshotSaving(true);
    try {
      const ticketsInRange = tickets.filter((t) => isWithinRange(t.reportedAt, dateFrom, dateTo));
      const totalCost = assets.reduce((sum, a) => sum + (a.purchasePrice || 0), 0);
      await addDoc(collection(db, "asset_report_snapshots"), {
        period: filters.datePreset,
        periodStart: dateFrom.toISOString(),
        periodEnd: dateTo.toISOString(),
        totalAssets: assets.length,
        totalTickets: ticketsInRange.length,
        totalMaintenance: workOrders.length,
        totalBorrowings: borrowings.length,
        totalOverdueMaintenance: assets.filter(isMaintenanceOverdue).length,
        totalCost,
        generatedAt: serverTimestamp(),
        generatedByUid: assetUser?.uid || "",
        generatedByName: assetUser?.name || "",
      });
      setSnapshotSaved(true);
      setTimeout(() => setSnapshotSaved(false), 2500);
    } finally {
      setSnapshotSaving(false);
    }
  };

  // Skeleton sebelum client mounted — markup-nya SENGAJA sederhana dan sama
  // persis di server maupun client pass pertama, supaya tidak ada apapun
  // yang bisa mismatch. Chart/tab sungguhan baru dirender sesudah ini.
  if (!mounted) {
    return (
      <ProtectedLayout>
        <div className="reports-page min-h-screen w-full max-w-full overflow-x-hidden bg-slate-50 px-4 pb-[calc(7rem+env(safe-area-inset-bottom))] pt-4 md:px-6 md:pb-6 md:pt-0">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="h-24 rounded-2xl bg-white shadow-sm" />
            <div className="h-24 rounded-2xl bg-white shadow-sm" />
            <div className="h-24 rounded-2xl bg-white shadow-sm" />
            <div className="h-24 rounded-2xl bg-white shadow-sm" />
          </div>
          <div className="mt-4 h-64 rounded-2xl bg-white shadow-sm" />
        </div>
      </ProtectedLayout>
    );
  }

  return (
    <ProtectedLayout>
      <div className="reports-page min-h-screen w-full max-w-full overflow-x-hidden bg-slate-50 px-4 pb-[calc(7rem+env(safe-area-inset-bottom))] pt-4 md:px-6 md:pb-6 md:pt-0">
      <PageHeader
        title="Reports & Analytics"
        subtitle="Analisis data asset untuk pengambilan keputusan."
        actions={
          // Snapshot bulanan ikut menulis totalTickets/totalMaintenance —
          // datanya sengaja tidak pernah dimuat untuk Finance, jadi tombol
          // ini disembunyikan supaya Finance tidak menulis snapshot dengan
          // angka Maintenance/Ticket yang keliru (selalu 0).
          !isFinance && (
            <button
              type="button"
              onClick={handleGenerateSnapshot}
              disabled={snapshotSaving}
              className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium cursor-pointer hover:bg-slate-50 disabled:opacity-60"
            >
              <Camera size={15} />
              {snapshotSaving ? "Menyimpan..." : snapshotSaved ? "Snapshot Tersimpan" : "Simpan Snapshot Bulanan"}
            </button>
          )
        }
      />

      {loadError && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 mb-4">
          {loadError}
        </p>
      )}

      {/* Rekap Finance punya filter global sendiri (Perusahaan/Tahun
          Perolehan/Kategori) di dalam FinanceReportTab — lebih ringkas
          daripada ReportsFilterBar (lokasi/PIC/dst tidak relevan buat
          dashboard finance), jadi filter bar & tab bar role lain
          disembunyikan untuk Finance (toh cuma ada 1 tab). */}
      {!isFinance && (
        <>
          <ReportsFilterBar filters={filters} onChange={setFilters} assets={assets} categories={categories} />

          <div className="flex items-center gap-1 mb-5 border-b border-slate-200 overflow-x-auto">
            {visibleTabs.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setActiveTab(t.key)}
                className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap cursor-pointer border-b-2 -mb-px transition-colors ${
                  activeTab === t.key
                    ? "border-blue-600 text-blue-700"
                    : "border-transparent text-slate-500 hover:text-slate-700"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </>
      )}

      {activeTab === "overview" && (
        <OverviewTab
          assets={filteredAssets}
          tickets={filteredTickets}
          workOrders={filteredWorkOrders}
          dateFrom={dateFrom}
          dateTo={dateTo}
        />
      )}
      {activeTab === "asset_health" && (
        <AssetHealthTab assets={filteredAssets} tickets={filteredTickets} workOrders={filteredWorkOrders} />
      )}
      {activeTab === "ticket" && <TicketReportTab tickets={filteredTickets} />}
      {activeTab === "maintenance" && (
        <MaintenanceReportTab assets={filteredAssets} workOrders={filteredWorkOrders} items={items} />
      )}
      {activeTab === "borrowing" && <BorrowingReportTab borrowings={filteredBorrowings} />}
      {activeTab === "location" && (
        <LocationReportTab assets={filteredAssets} tickets={filteredTickets} workOrders={filteredWorkOrders} />
      )}
      {activeTab === "cost" &&
        (canViewFinanceData ? (
          <CostReportTab assets={filteredAssets} tickets={filteredTickets} borrowings={filteredBorrowings} />
        ) : (
          <RecommendationReportTab
            assets={filteredAssets}
            tickets={filteredTickets}
            borrowings={filteredBorrowings}
          />
        ))}
      {activeTab === "export" && (
        <ExportTab
          assets={filteredAssets}
          tickets={filteredTickets}
          workOrders={filteredWorkOrders}
          items={items}
          borrowings={filteredBorrowings}
          canViewFinanceData={canViewFinanceData}
        />
      )}
      {activeTab === "finance" && <FinanceReportTab assets={assets} />}
      </div>
    </ProtectedLayout>
  );
}
