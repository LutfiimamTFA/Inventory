"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { collection, onSnapshot, query, where } from "firebase/firestore";
import {
  Package,
  CheckCircle2,
  Clock,
  Wrench,
  AlertTriangle,
  Wallet,
  ArrowRight,
  Inbox,
  CalendarClock,
} from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { Asset, AssetBorrowing, AssetIssueTicket, MaintenanceWorkOrder } from "@/lib/types";
import {
  ASSET_STATUS_COLOR,
  ASSET_STATUS_LABEL,
  formatDate,
  isProblemAsset,
} from "@/lib/utils";
import { isWorkOrderOverdueRecord } from "@/lib/reports";
import {
  formatRupiah,
  getAssetPrice,
  hasInvoice,
  hasPrice,
  isFinanceComplete,
} from "@/lib/assetFinance";
import ProtectedLayout from "@/components/ProtectedLayout";
import PageHeader from "@/components/PageHeader";
import StatCard from "@/components/StatCard";
import Badge from "@/components/Badge";
import EmptyState from "@/components/EmptyState";

export default function DashboardPage() {
  const { firebaseUser, role, assetUser, loading } = useAuth();
  const authReady = !loading && !!firebaseUser && !!assetUser && !!role;
  const [assets, setAssets] = useState<Asset[]>([]);
  const [activeBorrowings, setActiveBorrowings] = useState<AssetBorrowing[]>(
    []
  );
  const [tickets, setTickets] = useState<AssetIssueTicket[]>([]);
  const [workOrders, setWorkOrders] = useState<MaintenanceWorkOrder[]>([]);

  // Section A — Asset Finance TIDAK boleh akses maintenance/kendala sama
  // sekali (bukan ranahnya, dan rules Firestore memang tidak mengizinkan) —
  // listener-nya harus di-skip, bukan cuma disembunyikan di UI, supaya tidak
  // memicu "Missing or insufficient permissions".
  const isAssetFinanceRole = role === "asset_finance";
  const isAssetAdminRole = role === "asset_admin";
  const isSuperAdminRole = role === "super_admin";
  const isItTeamRole = role === "it_team";
  const canViewMaintenanceDashboard = isSuperAdminRole || isAssetAdminRole || isItTeamRole;

  useEffect(() => {
    if (!authReady) return;
    const unsub = onSnapshot(
      collection(db, "assets"),
      (snap) => {
        console.log("[DashboardPage Listener] assets success:", snap.size);
        setAssets(
          snap.docs.map((d) => ({ id: d.id, ...d.data() } as Asset))
        );
      },
      (error) => {
        console.error("[DashboardPage Listener] assets error:", error);
      }
    );
    return () => unsub();
  }, [authReady]);

  useEffect(() => {
    if (!authReady) return;
    const q = query(
      collection(db, "asset_borrowings"),
      where("status", "==", "borrowed")
    );
    const unsub = onSnapshot(
      q,
      (snap) => {
        console.log("[DashboardPage Listener] asset_borrowings success:", snap.size);
        setActiveBorrowings(
          snap.docs.map((d) => ({ id: d.id, ...d.data() } as AssetBorrowing))
        );
      },
      (error) => {
        console.error("[DashboardPage Listener] asset_borrowings error:", error);
      }
    );
    return () => unsub();
  }, [authReady]);

  useEffect(() => {
    if (!authReady) return;
    // Section C — bukan ranah Asset Finance, skip listener sama sekali.
    if (isAssetFinanceRole) {
      console.log("[DashboardPage] skip asset_issue_tickets listener for asset_finance");
      return;
    }
    const unsub = onSnapshot(
      collection(db, "asset_issue_tickets"),
      (snap) => {
        console.log("[DashboardPage Listener] asset_issue_tickets success:", snap.size);
        setTickets(snap.docs.map((d) => ({ id: d.id, ...d.data() } as AssetIssueTicket)));
      },
      (error) => {
        console.error("[DashboardPage Listener] asset_issue_tickets error:", error);
      }
    );
    return () => unsub();
  }, [authReady, isAssetFinanceRole]);

  useEffect(() => {
    if (!authReady) return;
    // Section B — rules Firestore tidak mengizinkan role selain Super
    // Admin/Asset Admin/Tim IT membaca work order maintenance, jadi listener
    // ini WAJIB di-skip (bukan cuma disembunyikan di UI) supaya tidak
    // memicu "Missing or insufficient permissions" untuk role lain
    // (termasuk Asset Finance, Staff, Location PIC).
    if (!canViewMaintenanceDashboard) {
      console.log("[DashboardPage] skip asset_maintenance_work_orders listener for role:", role);
      return;
    }
    const unsub = onSnapshot(
      collection(db, "asset_maintenance_work_orders"),
      (snap) => {
        console.log("[DashboardPage Listener] asset_maintenance_work_orders success:", snap.size);
        setWorkOrders(
          snap.docs.map((d) => ({ id: d.id, ...d.data() } as MaintenanceWorkOrder))
        );
      },
      (error) => {
        console.error("[DashboardPage Listener] asset_maintenance_work_orders error:", error);
      }
    );
    return () => unsub();
  }, [authReady, role, canViewMaintenanceDashboard]);

  const total = assets.length;
  const available = assets.filter((a) => a.assetStatus === "available").length;
  const borrowed = assets.filter((a) => a.assetStatus === "borrowed").length;
  const maintenance = assets.filter(
    (a) => a.assetStatus === "maintenance"
  ).length;
  // Section 3/10 — pakai isProblemAsset (SATU sumber kebenaran, sama dengan
  // yang dipakai summary card & filter di halaman Assets) supaya laporan
  // kendala staff yang belum divalidasi QHSE (hasActiveIssue) ikut kehitung,
  // bukan cuma assetStatus "broken"/"lost" yang biasanya baru diisi manual.
  const broken = assets.filter(isProblemAsset).length;
  // Section A/D — nominal harga di dashboard utama HANYA dihitung untuk
  // Asset Finance. QHSE/Asset Admin, Tim IT, Staff — bahkan Super Admin di
  // dashboard utama ini — tidak boleh lihat nominal, jadi tidak perlu
  // dihitung sama sekali untuk mereka.
  const canViewFinancialValue = isAssetFinanceRole;

  // Section C/D — dashboard finance untuk Asset Finance, dihitung MURNI dari
  // collection assets (tidak butuh maintenance/tickets sama sekali), dan
  // HANYA dihitung kalau role-nya memang Asset Finance.
  const financeSummary = useMemo(() => {
    if (!canViewFinancialValue) {
      return {
        totalAssetValue: 0,
        pricedCount: 0,
        noPriceCount: 0,
        noInvoiceCount: 0,
        completeCount: 0,
        noInvoiceValue: 0,
        thisMonthValue: 0,
        averageAssetValue: 0,
      };
    }
    const pricedAssets = assets.filter(hasPrice);
    const noPriceCount = assets.filter((a) => !hasPrice(a)).length;
    const noInvoiceAssets = assets.filter((a) => !hasInvoice(a));
    const completeCount = assets.filter(isFinanceComplete).length;
    const totalAssetValue = assets.reduce((sum, a) => sum + getAssetPrice(a), 0);
    const noInvoiceValue = noInvoiceAssets.reduce((sum, a) => sum + getAssetPrice(a), 0);
    const averageAssetValue = pricedAssets.length > 0 ? totalAssetValue / pricedAssets.length : 0;

    const now = new Date();
    const thisMonthValue = assets.reduce((sum, a) => {
      if (!a.purchaseDate) return sum;
      const d = new Date(a.purchaseDate);
      if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) {
        return sum + getAssetPrice(a);
      }
      return sum;
    }, 0);

    return {
      totalAssetValue,
      pricedCount: pricedAssets.length,
      noPriceCount,
      noInvoiceCount: noInvoiceAssets.length,
      completeCount,
      noInvoiceValue,
      thisMonthValue,
      averageAssetValue,
    };
  }, [assets, canViewFinancialValue]);

  const recentAssets = [...assets]
    .sort((a, b) => {
      const ta = (a.createdAt as { seconds?: number })?.seconds || 0;
      const tb = (b.createdAt as { seconds?: number })?.seconds || 0;
      return tb - ta;
    })
    .slice(0, 5);

  const unresolvedTickets = tickets.filter(
    (t) => !["completed", "cancelled", "resolved", "closed", "rejected"].includes(t.status)
  ).length;

  const myRoutineWorkOrders = useMemo(
    () => workOrders.filter((w) => w.assignedToUid === assetUser?.uid),
    [workOrders, assetUser?.uid]
  );
  const routineToday = myRoutineWorkOrders.filter((w) =>
    ["created", "accepted", "scheduled_by_it", "assigned"].includes(w.status)
  ).length;
  const routineOverdue = myRoutineWorkOrders.filter((w) => isWorkOrderOverdueRecord(w)).length;

  const now = new Date();
  const scheduleThisMonth = workOrders.filter(
    (w) => w.startMonth === now.getMonth() + 1 && w.startYear === now.getFullYear()
  ).length;
  const maintenanceCompleted = workOrders.filter((w) => w.status === "completed").length;
  const maintenanceOverdueAll = workOrders.filter((w) => isWorkOrderOverdueRecord(w)).length;
  const staffReportsPending = tickets.filter((t) =>
    ["reported", "under_review", "need_more_info"].includes(t.status)
  ).length;

  // Section K — widget ringkas "Monitoring Pekerjaan Aktif", 4 card saja
  // (bukan Kanban besar) dengan tombol ke Workflow Board penuh. Rutin dan
  // Kendala Staff dihitung dari status masing-masing alur sendiri, BUKAN
  // dari satu kolom kanban gabungan (keduanya punya arti berbeda).
  const workflowSummary = useMemo(() => {
    const created = workOrders.filter((w) => ["draft", "created", "overdue"].includes(w.status)).length +
      tickets.filter((t) => t.status === "reported").length;
    const inProgress = workOrders.filter((w) => ["in_progress", "partially_completed"].includes(w.status)).length +
      tickets.filter((t) => t.status === "in_progress").length;
    const waitingQhse = workOrders.filter((w) => w.status === "report_submitted" && w.needsQhseReview).length +
      tickets.filter((t) => t.status === "waiting_reporter_confirmation" || t.status === "reporter_confirmed").length;
    const needsFollowUp = workOrders.filter((w) => w.status === "revision_requested").length +
      tickets.filter((t) => t.status === "needs_follow_up").length;
    return { created, inProgress, waitingQhse, needsFollowUp };
  }, [workOrders, tickets]);

  return (
    <ProtectedLayout>
      <PageHeader
        title="Dashboard"
        subtitle="Ringkasan kondisi seluruh aset perusahaan saat ini."
      />

      {isAssetFinanceRole ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <StatCard
            icon={Wallet}
            label="Total Nilai Aset"
            value={formatRupiah(financeSummary.totalAssetValue)}
            tone="blue"
          />
          <StatCard
            icon={CheckCircle2}
            label="Aset Sudah Ada Harga"
            value={financeSummary.pricedCount}
            tone="emerald"
          />
          <StatCard
            icon={AlertTriangle}
            label="Aset Belum Ada Harga"
            value={financeSummary.noPriceCount}
            tone="red"
          />
          <StatCard
            icon={Inbox}
            label="Aset Belum Ada Invoice"
            value={financeSummary.noInvoiceCount}
            tone="amber"
          />
          <StatCard
            icon={CheckCircle2}
            label="Data Finance Lengkap"
            value={financeSummary.completeCount}
            tone="emerald"
          />
          <StatCard
            icon={Wallet}
            label="Nilai Aset Tanpa Invoice"
            value={formatRupiah(financeSummary.noInvoiceValue)}
            tone="amber"
          />
          <StatCard
            icon={Wallet}
            label="Pembelian Bulan Ini"
            value={formatRupiah(financeSummary.thisMonthValue)}
            tone="blue"
          />
          <StatCard
            icon={Wallet}
            label="Rata-rata Nilai Aset"
            value={formatRupiah(financeSummary.averageAssetValue)}
            tone="slate"
          />
        </div>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-6">
          <StatCard icon={Package} label="Total Aset" value={total} tone="slate" />
          <StatCard
            icon={CheckCircle2}
            label="Tersedia"
            value={available}
            tone="emerald"
          />
          <StatCard icon={Clock} label="Dipinjam" value={borrowed} tone="amber" />
          <StatCard
            icon={Wrench}
            label="Maintenance"
            value={maintenance}
            tone="purple"
          />
          <StatCard
            icon={AlertTriangle}
            label="Aset Bermasalah"
            value={broken}
            tone="red"
          />
        </div>
      )}

      {role === "super_admin" && (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
          <StatCard icon={Inbox} label="Ticket Kendala Belum Selesai" value={unresolvedTickets} tone="amber" />
          <StatCard icon={CalendarClock} label="Tugas Maintenance Rutin Belum Dikerjakan" value={routineToday} tone="purple" />
          <StatCard icon={AlertTriangle} label="Tugas Maintenance Rutin Overdue" value={routineOverdue} tone="red" />
        </div>
      )}

      {role === "asset_admin" && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <StatCard icon={CalendarClock} label="Jadwal Maintenance Bulan Ini" value={scheduleThisMonth} tone="blue" />
          <StatCard icon={CheckCircle2} label="Maintenance Selesai" value={maintenanceCompleted} tone="emerald" />
          <StatCard icon={AlertTriangle} label="Maintenance Overdue" value={maintenanceOverdueAll} tone="red" />
          <StatCard icon={Inbox} label="Laporan Kendala Staff Belum Ditangani" value={staffReportsPending} tone="amber" />
        </div>
      )}

      {canViewMaintenanceDashboard && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-800">Monitoring Pekerjaan Aktif</h2>
            <Link
              href="/workflow-board"
              className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
            >
              Lihat Workflow Board
              <ArrowRight size={12} />
            </Link>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard icon={Inbox} label="Laporan Masuk" value={workflowSummary.created} tone="blue" />
            <StatCard icon={Wrench} label="Sedang Dikerjakan" value={workflowSummary.inProgress} tone="purple" />
            <StatCard icon={CheckCircle2} label="Menunggu Review QHSE" value={workflowSummary.waitingQhse} tone="slate" />
            <StatCard icon={AlertTriangle} label="Butuh Tindakan Lanjutan" value={workflowSummary.needsFollowUp} tone="red" />
          </div>
        </div>
      )}

      <div className="grid lg:grid-cols-2 gap-5">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-800">Aset Terbaru</h2>
            <Link
              href="/assets"
              className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
            >
              Lihat semua
              <ArrowRight size={12} />
            </Link>
          </div>
          {recentAssets.length === 0 ? (
            <EmptyState
              icon={Package}
              title="Belum ada aset"
              description="Aset yang baru ditambahkan akan muncul di sini."
            />
          ) : (
            <div className="divide-y divide-slate-100">
              {recentAssets.map((a) => (
                <Link
                  key={a.id}
                  href={`/assets/${a.id}`}
                  className="flex items-center justify-between py-3 first:pt-0 last:pb-0 hover:bg-slate-50 -mx-2 px-2 rounded-lg transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">
                      {a.assetName}
                    </p>
                    <p className="text-xs text-slate-400">{a.assetCode}</p>
                  </div>
                  <Badge
                    label={ASSET_STATUS_LABEL[a.assetStatus]}
                    colorClass={ASSET_STATUS_COLOR[a.assetStatus]}
                  />
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-800">Peminjaman Aktif</h2>
            <Link
              href="/borrowings"
              className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
            >
              Lihat semua
              <ArrowRight size={12} />
            </Link>
          </div>
          {activeBorrowings.length === 0 ? (
            <EmptyState
              icon={Clock}
              title="Tidak ada peminjaman aktif"
              description="Aset yang sedang dipinjam akan muncul di sini."
            />
          ) : (
            <div className="divide-y divide-slate-100">
              {activeBorrowings.slice(0, 5).map((b) => (
                <div key={b.id} className="flex items-center justify-between py-3 first:pt-0 last:pb-0">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">
                      {b.assetName}
                    </p>
                    <p className="text-xs text-slate-400">
                      {b.borrowedByName} · sejak {formatDate(b.borrowedAt)}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </ProtectedLayout>
  );
}
