"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { collection, onSnapshot, orderBy, query, where } from "firebase/firestore";
import { History } from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { AssetBorrowing } from "@/lib/types";
import {
  BORROWING_STATUS_COLOR,
  BORROWING_STATUS_LABEL,
  formatDate,
} from "@/lib/utils";
import ProtectedLayout from "@/components/ProtectedLayout";
import PageHeader from "@/components/PageHeader";
import Badge from "@/components/Badge";
import EmptyState from "@/components/EmptyState";

export default function MyBorrowingsPage() {
  const { assetUser } = useAuth();
  const [borrowings, setBorrowings] = useState<AssetBorrowing[]>([]);

  useEffect(() => {
    if (!assetUser) return;
    const q = query(
      collection(db, "asset_borrowings"),
      where("borrowedByUid", "==", assetUser.uid),
      orderBy("borrowedAt", "desc")
    );
    const unsub = onSnapshot(q, (snap) => {
      setBorrowings(
        snap.docs.map((d) => ({ id: d.id, ...d.data() } as AssetBorrowing))
      );
    });
    return () => unsub();
  }, [assetUser]);

  const active = borrowings.filter((b) => b.status === "borrowed");
  const history = borrowings.filter((b) => b.status !== "borrowed");

  return (
    <ProtectedLayout>
      <PageHeader
        title="My Borrowings"
        subtitle="Aset yang sedang Anda pinjam dan riwayat peminjaman Anda."
      />

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 mb-5">
        <h2 className="font-semibold text-slate-800 mb-3">Sedang Dipinjam</h2>
        <BorrowingList items={active} />
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
        <h2 className="font-semibold text-slate-800 mb-3">Riwayat Peminjaman</h2>
        <BorrowingList items={history} />
      </div>
    </ProtectedLayout>
  );
}

function BorrowingList({ items }: { items: AssetBorrowing[] }) {
  if (items.length === 0) {
    return <EmptyState icon={History} title="Tidak ada data" />;
  }
  return (
    <div className="divide-y divide-slate-100">
      {items.map((b) => (
        <div
          key={b.id}
          className="flex items-center justify-between text-sm py-3 first:pt-0 last:pb-0"
        >
          <div>
            <Link
              href={`/assets/${b.assetId}`}
              className="font-medium text-slate-800 hover:underline"
            >
              {b.assetName}
            </Link>
            <p className="text-xs text-slate-400">
              {b.assetCode} · dipinjam {formatDate(b.borrowedAt)}
              {b.returnedAt ? ` · dikembalikan ${formatDate(b.returnedAt)}` : ""}
            </p>
          </div>
          <Badge
            label={BORROWING_STATUS_LABEL[b.status]}
            colorClass={BORROWING_STATUS_COLOR[b.status]}
          />
        </div>
      ))}
    </div>
  );
}
