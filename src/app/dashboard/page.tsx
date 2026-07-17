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
  formatCurrency,
  formatDate,
} from "@/lib/utils";
import { isWorkOrderOverdueRecord } from "@/lib/reports";
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
  }, [authReady]);

  useEffect(() => {
    if (!authReady) return;
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
  }, [authReady]);

  const total = assets.length;
  const available = assets.filter((a) => a.assetStatus === "available").length;
  const borrowed = assets.filter((a) => a.assetStatus === "borrowed").length;
  const maintenance = assets.filter(
    (a) => a.assetStatus === "maintenance"
  ).length;
  const broken = assets.filter(
    (a) => a.assetStatus === "broken" || a.assetStatus === "lost"
  ).length;
  const totalValue = assets.reduce((sum, a) => sum + (a.purchasePrice || 0), 0);

  const recentAssets = [...assets]
    .sort((a, b) => {
      const ta = (a.createdAt as { seconds?: number })?.seconds || 0;
      const tb = (b.createdAt as { seconds?: number })?.seconds || 0;
      return tb - ta;
    })
    .slice(0, 5);

  const unresolvedTickets = tickets.filter(
    (t) => !["resolved", "closed", "rejected"].includes(t.status)
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
    ["open", "review_by_asset_admin", "need_more_info"].includes(t.status)
  ).length;

  return (
    <ProtectedLayout>
      <PageHeader
        title="Dashboard"
        subtitle="Ringkasan kondisi seluruh aset perusahaan saat ini."
      />

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
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
          label="Rusak / Hilang"
          value={broken}
          tone="red"
        />
        <StatCard
          icon={Wallet}
          label="Total Nilai Aset"
          value={formatCurrency(totalValue)}
          tone="blue"
        />
      </div>

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
