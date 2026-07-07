"use client";

import { useEffect, useState } from "react";
import { collection, onSnapshot } from "firebase/firestore";
import * as XLSX from "xlsx";
import { FileDown } from "lucide-react";
import { db } from "@/lib/firebase";
import { Asset, AssetBorrowing, AssetCategory } from "@/lib/types";
import { formatDate } from "@/lib/utils";
import ProtectedLayout from "@/components/ProtectedLayout";
import PageHeader from "@/components/PageHeader";

export default function ReportsPage() {
  const [assets, setAssets] = useState<Asset[]>([]);
  const [borrowings, setBorrowings] = useState<AssetBorrowing[]>([]);
  const [categories, setCategories] = useState<AssetCategory[]>([]);

  const [categoryFilter, setCategoryFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [companyFilter, setCompanyFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "assets"), (snap) => {
      setAssets(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Asset)));
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "asset_borrowings"), (snap) => {
      setBorrowings(
        snap.docs.map((d) => ({ id: d.id, ...d.data() } as AssetBorrowing))
      );
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "asset_categories"), (snap) => {
      setCategories(
        snap.docs.map((d) => ({ id: d.id, ...d.data() } as AssetCategory))
      );
    });
    return () => unsub();
  }, []);

  const companies = Array.from(
    new Set(assets.map((a) => a.companyOwnerName).filter(Boolean))
  ) as string[];

  const filteredAssets = assets.filter((a) => {
    if (categoryFilter && a.categoryId !== categoryFilter) return false;
    if (statusFilter && a.assetStatus !== statusFilter) return false;
    if (companyFilter && a.companyOwnerName !== companyFilter) return false;
    if (dateFrom || dateTo) {
      const pd = a.purchaseDate ? new Date(a.purchaseDate) : null;
      if (!pd) return false;
      if (dateFrom && pd < new Date(dateFrom)) return false;
      if (dateTo && pd > new Date(dateTo)) return false;
    }
    return true;
  });

  const exportAssets = () => {
    const data = filteredAssets.map((a) => ({
      "Nama Aset": a.assetName,
      "Kode Aset": a.assetCode,
      Kategori: a.categoryName,
      Merk: a.brand,
      Model: a.model,
      Lokasi: a.location,
      Perusahaan: a.companyOwnerName,
      Divisi: a.divisionOwnerName,
      "Status Aset": a.assetStatus,
      Kondisi: a.condition,
      "Harga Beli": a.purchasePrice,
      "Tanggal Beli": a.purchaseDate,
      Vendor: a.vendorName,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Assets");
    XLSX.writeFile(wb, `assets-report-${Date.now()}.xlsx`);
  };

  const exportBorrowings = () => {
    const data = borrowings.map((b) => ({
      Aset: b.assetName,
      Kode: b.assetCode,
      Peminjam: b.borrowedByName,
      Email: b.borrowedByEmail,
      "Tgl Pinjam": formatDate(b.borrowedAt),
      "Est. Kembali": b.estimatedReturnAt,
      "Tgl Kembali": b.returnedAt ? formatDate(b.returnedAt) : "",
      Status: b.status,
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Borrowings");
    XLSX.writeFile(wb, `borrowings-report-${Date.now()}.xlsx`);
  };

  return (
    <ProtectedLayout>
      <PageHeader
        title="Reports / Export"
        subtitle="Ekspor data aset dan peminjaman ke Excel untuk pelaporan."
      />

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 mb-5">
        <h2 className="font-semibold text-slate-800 mb-4">Filter Laporan Aset</h2>
        <div className="grid md:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="input"
          >
            <option value="">Semua Kategori</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.categoryName}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="input"
          >
            <option value="">Semua Status</option>
            <option value="available">Tersedia</option>
            <option value="borrowed">Dipinjam</option>
            <option value="maintenance">Maintenance</option>
            <option value="broken">Rusak</option>
          </select>
          <select
            value={companyFilter}
            onChange={(e) => setCompanyFilter(e.target.value)}
            className="input"
          >
            <option value="">Semua Perusahaan</option>
            {companies.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="input"
          />
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="input"
          />
        </div>
        <p className="text-sm text-slate-500 mb-4">
          <span className="font-semibold text-slate-800">{filteredAssets.length}</span> aset
          cocok dengan filter.
        </p>
        <button
          onClick={exportAssets}
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-teal-500 text-white px-4 py-2.5 text-sm font-medium hover:brightness-105 shadow-md shadow-blue-900/20"
        >
          <FileDown size={16} />
          Export Aset ke Excel
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5">
        <h2 className="font-semibold text-slate-800 mb-2">Laporan Peminjaman</h2>
        <p className="text-sm text-slate-500 mb-4">
          <span className="font-semibold text-slate-800">{borrowings.length}</span> total data
          peminjaman.
        </p>
        <button
          onClick={exportBorrowings}
          className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-teal-500 text-white px-4 py-2.5 text-sm font-medium hover:brightness-105 shadow-md shadow-blue-900/20"
        >
          <FileDown size={16} />
          Export Peminjaman ke Excel
        </button>
      </div>
    </ProtectedLayout>
  );
}
