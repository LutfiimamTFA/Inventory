"use client";

import { useEffect, useState } from "react";
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
} from "lucide-react";
import { db } from "@/lib/firebase";
import { Asset, AssetBorrowing } from "@/lib/types";
import {
  ASSET_STATUS_COLOR,
  ASSET_STATUS_LABEL,
  formatCurrency,
  formatDate,
} from "@/lib/utils";
import ProtectedLayout from "@/components/ProtectedLayout";
import PageHeader from "@/components/PageHeader";
import StatCard from "@/components/StatCard";
import Badge from "@/components/Badge";
import EmptyState from "@/components/EmptyState";

export default function DashboardPage() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [activeBorrowings, setActiveBorrowings] = useState<AssetBorrowing[]>(
    []
  );

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "assets"), (snap) => {
      setAssets(
        snap.docs.map((d) => ({ id: d.id, ...d.data() } as Asset))
      );
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const q = query(
      collection(db, "asset_borrowings"),
      where("status", "==", "borrowed")
    );
    const unsub = onSnapshot(q, (snap) => {
      setActiveBorrowings(
        snap.docs.map((d) => ({ id: d.id, ...d.data() } as AssetBorrowing))
      );
    });
    return () => unsub();
  }, []);

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
