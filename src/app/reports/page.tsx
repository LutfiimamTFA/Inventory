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
import ExportTab from "@/components/reports/tabs/ExportTab";

type TabKey =
  | "overview"
  | "asset_health"
  | "ticket"
  | "maintenance"
  | "borrowing"
  | "location"
  | "cost"
  | "export";

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

export default function ReportsPage() {
  const { firebaseUser, assetUser, role, loading } = useAuth();
  const authReady = !loading && !!firebaseUser && !!assetUser && !!role;
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
    if (!canViewReports) return;
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
  }, [canViewReports]);

  useEffect(() => {
    if (!canViewReports) return;
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
  }, [canViewReports]);

  useEffect(() => {
    if (!canViewReports) return;
    const unsub = onSnapshot(
      collectionGroup(db, "items"),
      (snap) => {
        console.log("[Reports Listener] collectionGroup items success:", snap.size);
        setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() } as MaintenanceWorkOrderItem)));
      },
      handleIndexError("maintenance work order items")
    );
    return () => unsub();
  }, [canViewReports]);

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
    () => tickets.filter((t) => filteredAssetIds.has(t.assetId)),
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

  return (
    <ProtectedLayout>
      <PageHeader
        title="Reports & Analytics"
        subtitle="Analisis data asset untuk pengambilan keputusan."
        actions={
          <button
            type="button"
            onClick={handleGenerateSnapshot}
            disabled={snapshotSaving}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium cursor-pointer hover:bg-slate-50 disabled:opacity-60"
          >
            <Camera size={15} />
            {snapshotSaving ? "Menyimpan..." : snapshotSaved ? "Snapshot Tersimpan" : "Simpan Snapshot Bulanan"}
          </button>
        }
      />

      {loadError && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5 mb-4">
          {loadError}
        </p>
      )}

      <ReportsFilterBar filters={filters} onChange={setFilters} assets={assets} categories={categories} />

      <div className="flex items-center gap-1 mb-5 border-b border-slate-200 overflow-x-auto">
        {TABS.map((t) => (
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
      {activeTab === "cost" && (
        <CostReportTab assets={filteredAssets} tickets={filteredTickets} borrowings={filteredBorrowings} />
      )}
      {activeTab === "export" && (
        <ExportTab
          assets={filteredAssets}
          tickets={filteredTickets}
          workOrders={filteredWorkOrders}
          items={items}
          borrowings={filteredBorrowings}
        />
      )}
    </ProtectedLayout>
  );
}
