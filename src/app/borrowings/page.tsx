"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { collection, onSnapshot, orderBy, query } from "firebase/firestore";
import { Search, ClipboardList } from "lucide-react";
import { db } from "@/lib/firebase";
import { AssetBorrowing, BorrowingStatus } from "@/lib/types";
import {
  BORROWING_STATUS_COLOR,
  BORROWING_STATUS_LABEL,
  formatDate,
} from "@/lib/utils";
import ProtectedLayout from "@/components/ProtectedLayout";
import PageHeader from "@/components/PageHeader";
import FilterCard from "@/components/FilterCard";
import Badge from "@/components/Badge";
import EmptyState from "@/components/EmptyState";

export default function BorrowingsPage() {
  const [borrowings, setBorrowings] = useState<AssetBorrowing[]>([]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<BorrowingStatus | "">("");

  useEffect(() => {
    const q = query(collection(db, "asset_borrowings"), orderBy("borrowedAt", "desc"));
    const unsub = onSnapshot(q, (snap) => {
      setBorrowings(
        snap.docs.map((d) => ({ id: d.id, ...d.data() } as AssetBorrowing))
      );
    });
    return () => unsub();
  }, []);

  const filtered = borrowings.filter((b) => {
    if (
      search &&
      !`${b.assetName} ${b.assetCode} ${b.borrowedByName}`
        .toLowerCase()
        .includes(search.toLowerCase())
    )
      return false;
    if (statusFilter && b.status !== statusFilter) return false;
    return true;
  });

  return (
    <ProtectedLayout>
      <PageHeader
        title="Borrowings"
        subtitle="Pantau seluruh transaksi peminjaman aset perusahaan."
      />

      <FilterCard>
        <div className="relative md:col-span-2 lg:col-span-4">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari aset/peminjam..."
            className="input pl-9"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as BorrowingStatus | "")}
          className="input"
        >
          <option value="">Semua Status</option>
          <option value="borrowed">Dipinjam</option>
          <option value="returned">Dikembalikan</option>
          <option value="overdue">Terlambat</option>
        </select>
      </FilterCard>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {filtered.length === 0 ? (
          <EmptyState
            icon={ClipboardList}
            title="Tidak ada data peminjaman"
            description="Transaksi peminjaman aset akan muncul di sini."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-200 bg-slate-50/60">
                  <th className="px-4 py-3 font-semibold">Aset</th>
                  <th className="px-4 py-3 font-semibold">Peminjam</th>
                  <th className="px-4 py-3 font-semibold">Tgl Pinjam</th>
                  <th className="px-4 py-3 font-semibold">Est. Kembali</th>
                  <th className="px-4 py-3 font-semibold">Tgl Kembali</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((b) => (
                  <tr key={b.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/70">
                    <td className="px-4 py-3">
                      <Link href={`/assets/${b.assetId}`} className="block">
                        <p className="font-medium text-slate-800">{b.assetName}</p>
                        <p className="text-xs text-slate-400">{b.assetCode}</p>
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{b.borrowedByName}</td>
                    <td className="px-4 py-3 text-slate-500">{formatDate(b.borrowedAt)}</td>
                    <td className="px-4 py-3 text-slate-500">
                      {b.estimatedReturnAt || "-"}
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {b.returnedAt ? formatDate(b.returnedAt) : "-"}
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        label={BORROWING_STATUS_LABEL[b.status]}
                        colorClass={BORROWING_STATUS_COLOR[b.status]}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </ProtectedLayout>
  );
}
