"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  collection,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from "firebase/firestore";
import {
  Plus,
  Search,
  QrCode,
  Eye,
  Pencil,
  Power,
  Package,
} from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { Asset, AssetCategory } from "@/lib/types";
import {
  ASSET_STATUS_COLOR,
  ASSET_STATUS_LABEL,
  CONDITION_LABEL,
  formatCurrency,
} from "@/lib/utils";
import { writeAssetLog } from "@/lib/firestore-helpers";
import ProtectedLayout from "@/components/ProtectedLayout";
import PageHeader from "@/components/PageHeader";
import FilterCard from "@/components/FilterCard";
import Badge from "@/components/Badge";
import EmptyState from "@/components/EmptyState";
import ConfirmModal from "@/components/ConfirmModal";
import QrLabelModal from "@/components/QrLabelModal";
import BulkQrLabelModal from "@/components/BulkQrLabelModal";

export default function AssetsPage() {
  const { firebaseUser, assetUser, role, loading } = useAuth();
  const authReady = !loading && !!firebaseUser && !!assetUser && !!role;
  const [assets, setAssets] = useState<Asset[]>([]);
  const [categories, setCategories] = useState<AssetCategory[]>([]);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [companyFilter, setCompanyFilter] = useState("");
  const [divisionFilter, setDivisionFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [deactivateTarget, setDeactivateTarget] = useState<Asset | null>(null);
  const [processing, setProcessing] = useState(false);
  const [qrLabelTarget, setQrLabelTarget] = useState<Asset | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [confirmSelectAllFiltered, setConfirmSelectAllFiltered] = useState(false);

  const canManage = role === "super_admin" || role === "asset_admin";

  // Section F — ringkasan aset tetap lokasi vs bergerak (AC/meja/CCTV
  // dipisah dari HP/laptop/kamera). Aset lama belum punya trackingMode
  // tersimpan, diturunkan dari usageType lama supaya tetap terhitung.
  const trackingSummary = useMemo(() => {
    let fixedLocation = 0;
    let moving = 0;
    let maintenance = 0;
    assets.forEach((a) => {
      const mode = a.trackingMode || (a.usageType === "assigned_daily" ? "assigned_pic" : "shared_borrowable");
      if (mode === "fixed_location") fixedLocation += 1;
      else moving += 1;
      if (a.assetStatus === "maintenance") maintenance += 1;
    });
    return { fixedLocation, moving, maintenance };
  }, [assets]);

  useEffect(() => {
    if (!authReady) return;
    const q = query(collection(db, "assets"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        console.log("[AssetsPage Listener] assets success:", snap.size);
        setAssets(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Asset)));
      },
      (error) => {
        console.error("[AssetsPage Listener] assets error:", error);
      }
    );
    return () => unsub();
  }, [authReady]);

  useEffect(() => {
    if (!authReady) return;
    const unsub = onSnapshot(
      collection(db, "asset_categories"),
      (snap) => {
        console.log("[AssetsPage Listener] asset_categories success:", snap.size);
        setCategories(
          snap.docs.map((d) => ({ id: d.id, ...d.data() } as AssetCategory))
        );
      },
      (error) => {
        console.error("[AssetsPage Listener] asset_categories error:", error);
      }
    );
    return () => unsub();
  }, [authReady]);

  const companies = useMemo(
    () =>
      Array.from(
        new Set(assets.map((a) => a.companyOwnerName).filter(Boolean))
      ) as string[],
    [assets]
  );
  const divisions = useMemo(
    () =>
      Array.from(
        new Set(assets.map((a) => a.divisionOwnerName).filter(Boolean))
      ) as string[],
    [assets]
  );
  const locations = useMemo(
    () =>
      Array.from(new Set(assets.map((a) => a.location).filter(Boolean))) as string[],
    [assets]
  );

  const filtered = assets.filter((a) => {
    if (
      search &&
      !`${a.assetName} ${a.assetCode}`
        .toLowerCase()
        .includes(search.toLowerCase())
    )
      return false;
    if (categoryFilter && a.categoryId !== categoryFilter) return false;
    if (statusFilter && a.assetStatus !== statusFilter) return false;
    if (companyFilter && a.companyOwnerName !== companyFilter) return false;
    if (divisionFilter && a.divisionOwnerName !== divisionFilter) return false;
    if (locationFilter && a.location !== locationFilter) return false;
    return true;
  });

  const hasFilters =
    search || categoryFilter || statusFilter || companyFilter || divisionFilter || locationFilter;

  const allVisibleSelected =
    filtered.length > 0 && filtered.every((a) => selectedIds.has(a.id));
  const selectedAssets = assets.filter((a) => selectedIds.has(a.id));

  const toggleSelectOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAllVisible = () => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) {
        filtered.forEach((a) => next.delete(a.id));
      } else {
        filtered.forEach((a) => next.add(a.id));
      }
      return next;
    });
  };

  const clearSelection = () => setSelectedIds(new Set());

  const handleBulkQrClick = () => {
    if (selectedIds.size > 0) {
      setBulkModalOpen(true);
    } else if (filtered.length > 0) {
      setConfirmSelectAllFiltered(true);
    }
  };

  const handleConfirmSelectAllFiltered = () => {
    setSelectedIds(new Set(filtered.map((a) => a.id)));
    setConfirmSelectAllFiltered(false);
    setBulkModalOpen(true);
  };

  const handleDeactivate = async () => {
    if (!deactivateTarget) return;
    setProcessing(true);
    try {
      await updateDoc(doc(db, "assets", deactivateTarget.id), {
        assetStatus: "inactive",
        updatedAt: serverTimestamp(),
      });
      await writeAssetLog({
        assetId: deactivateTarget.id,
        assetName: deactivateTarget.assetName,
        assetCode: deactivateTarget.assetCode,
        action: "deactivate",
        userUid: assetUser?.uid || "",
        userName: assetUser?.name || "",
        detail: "Aset dinonaktifkan",
      });
      setDeactivateTarget(null);
    } finally {
      setProcessing(false);
    }
  };

  return (
    <ProtectedLayout>
      <PageHeader
        title="Assets"
        subtitle="Kelola seluruh aset perusahaan dalam satu tempat."
        actions={
          <>
            <Link
              href="/scan"
              className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 shadow-sm"
            >
              <QrCode size={16} />
              Scan QR
            </Link>
            {canManage && (
              <button
                type="button"
                onClick={handleBulkQrClick}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 cursor-pointer hover:bg-slate-50 shadow-sm"
              >
                <QrCode size={16} />
                Bulk QR Label
              </button>
            )}
            {canManage && (
              <Link
                href="/assets/new"
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-teal-500 text-white px-4 py-2.5 text-sm font-medium hover:brightness-105 shadow-md shadow-blue-900/20"
              >
                <Plus size={16} />
                Create Asset
              </Link>
            )}
          </>
        }
      />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">Total Aset Tetap Lokasi</p>
          <p className="text-2xl font-semibold text-slate-900 mt-1">{trackingSummary.fixedLocation}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">Total Aset Bergerak</p>
          <p className="text-2xl font-semibold text-slate-900 mt-1">{trackingSummary.moving}</p>
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-4">
          <p className="text-xs text-slate-500">Total Aset Maintenance</p>
          <p className="text-2xl font-semibold text-slate-900 mt-1">{trackingSummary.maintenance}</p>
        </div>
      </div>

      <FilterCard>
        <div className="relative lg:col-span-2">
          <Search
            size={16}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari nama/kode aset..."
            className="input pl-9"
          />
        </div>
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
          {Object.entries(ASSET_STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
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
        <select
          value={divisionFilter}
          onChange={(e) => setDivisionFilter(e.target.value)}
          className="input"
        >
          <option value="">Semua Divisi</option>
          {divisions.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>
        <select
          value={locationFilter}
          onChange={(e) => setLocationFilter(e.target.value)}
          className="input"
        >
          <option value="">Semua Lokasi</option>
          {locations.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </select>
      </FilterCard>

      {canManage && selectedIds.size > 0 && (
        <div className="flex items-center justify-between gap-3 mb-4 rounded-xl border border-blue-200 bg-blue-50 px-4 py-2.5">
          <p className="text-sm text-blue-800 font-medium">
            {selectedIds.size} asset dipilih
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setBulkModalOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 text-white px-3 py-1.5 text-xs font-medium cursor-pointer hover:bg-blue-700"
            >
              <QrCode size={13} />
              Cetak QR Terpilih
            </button>
            <button
              type="button"
              onClick={clearSelection}
              className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 cursor-pointer hover:bg-slate-50"
            >
              Clear
            </button>
          </div>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {filtered.length === 0 ? (
          <EmptyState
            icon={Package}
            title={hasFilters ? "Tidak ada aset yang cocok" : "Belum ada asset"}
            description={
              hasFilters
                ? "Coba ubah kata kunci atau filter pencarian."
                : "Mulai dengan menambahkan asset pertama perusahaan."
            }
            action={
              canManage &&
              !hasFilters && (
                <Link
                  href="/assets/new"
                  className="inline-flex items-center gap-2 rounded-xl bg-slate-900 text-white px-4 py-2 text-sm font-medium hover:bg-slate-800"
                >
                  <Plus size={16} />
                  Create Asset
                </Link>
              )
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-200 bg-slate-50/60">
                  {canManage && (
                    <th className="px-4 py-3 w-10">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={toggleSelectAllVisible}
                        className="cursor-pointer"
                        aria-label="Pilih semua asset yang tampil"
                      />
                    </th>
                  )}
                  <th className="px-4 py-3 font-semibold">Asset</th>
                  <th className="px-4 py-3 font-semibold">Kategori</th>
                  <th className="px-4 py-3 font-semibold">Lokasi</th>
                  <th className="px-4 py-3 font-semibold">Perusahaan / Divisi</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3 font-semibold">Kondisi</th>
                  <th className="px-4 py-3 font-semibold">Nilai Asset</th>
                  <th className="px-4 py-3 font-semibold text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((a) => (
                  <tr
                    key={a.id}
                    className="border-b border-slate-100 last:border-0 hover:bg-slate-50/70 transition-colors"
                  >
                    {canManage && (
                      <td className="px-4 py-3">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(a.id)}
                          onChange={() => toggleSelectOne(a.id)}
                          className="cursor-pointer"
                          aria-label={`Pilih ${a.assetName}`}
                        />
                      </td>
                    )}
                    <td className="px-4 py-3">
                      <Link href={`/assets/${a.id}`} className="block">
                        <p className="font-medium text-slate-800">{a.assetName}</p>
                        <p className="text-xs text-slate-400">{a.assetCode}</p>
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{a.categoryName}</td>
                    <td className="px-4 py-3 text-slate-500">{a.location || "-"}</td>
                    <td className="px-4 py-3 text-slate-500">
                      <p>{a.companyOwnerName || "-"}</p>
                      <p className="text-xs text-slate-400">{a.divisionOwnerName || ""}</p>
                    </td>
                    <td className="px-4 py-3">
                      <Badge
                        label={ASSET_STATUS_LABEL[a.assetStatus]}
                        colorClass={ASSET_STATUS_COLOR[a.assetStatus]}
                      />
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {CONDITION_LABEL[a.condition]}
                    </td>
                    <td className="px-4 py-3 text-slate-500">
                      {formatCurrency(a.purchasePrice)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Link
                          href={`/assets/${a.id}`}
                          title="Lihat Detail"
                          className="p-1.5 rounded-lg cursor-pointer transition-colors hover:bg-slate-100 text-slate-500"
                        >
                          <Eye size={15} />
                        </Link>
                        {canManage && (
                          <>
                            <Link
                              href={`/assets/${a.id}/edit`}
                              title="Edit Asset"
                              className="p-1.5 rounded-lg cursor-pointer transition-colors hover:bg-slate-100 text-slate-500"
                            >
                              <Pencil size={15} />
                            </Link>
                            <button
                              type="button"
                              onClick={() => setQrLabelTarget(a)}
                              title="QR Label / Cetak Stiker"
                              className="p-1.5 rounded-lg cursor-pointer transition-colors hover:bg-slate-100 text-slate-500"
                            >
                              <QrCode size={15} />
                            </button>
                            <button
                              type="button"
                              onClick={() => setDeactivateTarget(a)}
                              title="Nonaktifkan Asset"
                              className="p-1.5 rounded-lg cursor-pointer transition-colors hover:bg-red-50 text-slate-500 hover:text-red-600"
                            >
                              <Power size={15} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmModal
        open={!!deactivateTarget}
        title="Nonaktifkan Asset"
        description={`Asset "${deactivateTarget?.assetName}" akan ditandai nonaktif.`}
        confirmLabel={processing ? "Memproses..." : "Nonaktifkan"}
        danger
        onConfirm={handleDeactivate}
        onCancel={() => setDeactivateTarget(null)}
      />

      {qrLabelTarget && (
        <QrLabelModal
          asset={qrLabelTarget}
          open={!!qrLabelTarget}
          onClose={() => setQrLabelTarget(null)}
        />
      )}

      <ConfirmModal
        open={confirmSelectAllFiltered}
        title="Pilih semua asset dari hasil filter ini?"
        description={`${filtered.length} asset pada hasil filter/pencarian saat ini akan dipilih untuk dicetak QR-nya.`}
        confirmLabel="Pilih Semua"
        onConfirm={handleConfirmSelectAllFiltered}
        onCancel={() => setConfirmSelectAllFiltered(false)}
      />

      {bulkModalOpen && (
        <BulkQrLabelModal
          assets={selectedAssets}
          open={bulkModalOpen}
          onClose={() => setBulkModalOpen(false)}
        />
      )}
    </ProtectedLayout>
  );
}
