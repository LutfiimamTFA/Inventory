"use client";

import { useState } from "react";
import { Download, UploadCloud, RefreshCw, Hash, Tags } from "lucide-react";
import { useAuth } from "@/lib/auth-context";
import { downloadTemplateXlsx } from "@/lib/import/excel";
import { PhotoSyncHandoff } from "@/lib/import/asset-photo-sync";
import ProtectedLayout from "@/components/ProtectedLayout";
import PageHeader from "@/components/PageHeader";
import ImportNewAssetsTab from "@/components/bulk-upload/ImportNewAssetsTab";
import SyncPhotosTab from "@/components/bulk-upload/SyncPhotosTab";
import SyncAssetNumberTab from "@/components/bulk-upload/SyncAssetNumberTab";
import SyncCategoryTab from "@/components/bulk-upload/SyncCategoryTab";

type TabKey = "import" | "sync" | "sync-number" | "sync-category";

const TABS: { key: TabKey; label: string; icon: typeof UploadCloud; description: string; financeAllowed: boolean }[] = [
  {
    key: "import",
    label: "Import Aset Baru",
    icon: UploadCloud,
    description: "Gunakan untuk memasukkan data aset baru secara massal dari Excel.",
    financeAllowed: true,
  },
  {
    key: "sync",
    label: "Sinkronkan Foto Excel",
    icon: RefreshCw,
    description:
      "Gunakan untuk mengambil foto dari Excel dan memasangkannya ke aset yang sudah ada berdasarkan Kode Aset.",
    financeAllowed: true,
  },
  {
    key: "sync-number",
    label: "Sinkronkan No. Aset",
    icon: Hash,
    description:
      "Gunakan untuk mengisi No. Aset pada data yang sudah lebih dulu diimport, dicocokkan lewat Kode Aset.",
    financeAllowed: true,
  },
  {
    key: "sync-category",
    label: "Sinkronkan Kategori",
    icon: Tags,
    description:
      "Gunakan untuk merapikan Kategori Aset pada data yang sudah lebih dulu diimport, dicocokkan lewat Kode Aset.",
    // Section "Kategori Aset ikuti Master Kategori" — Asset Finance TIDAK
    // punya izin mengubah categoryId/categoryName di Firestore rules
    // (kategori bukan data finansial, tetap milik Asset Admin/Super Admin),
    // jadi tab ini disembunyikan untuk role tersebut supaya tidak nyoba
    // sinkron lalu gagal permission.
    financeAllowed: false,
  },
];

export default function BulkUploadPage() {
  const { role, loading, firebaseUser, assetUser } = useAuth();
  const authReady = !loading && !!firebaseUser && !!assetUser && !!role;
  // Section "Rombak permission Asset" — Asset Finance sekarang juga boleh
  // Import Aset (termasuk Sinkronkan Foto/No. Aset, satu gate yang sama
  // untuk ketiga tab, lihat ticket poin 26). Preview/payload finance-nya
  // sendiri tetap role-aware di dalam masing-masing tab.
  const canImport = role === "super_admin" || role === "asset_admin" || role === "asset_finance";
  const visibleTabs = TABS.filter((t) => role !== "asset_finance" || t.financeAllowed);
  const [tab, setTab] = useState<TabKey>("import");
  // Handoff dari tab Import ketika sheet+company yang dipilih sudah pernah
  // diimport — file/sheet/company dibawa ke tab Sinkronkan Foto TANPA user
  // upload/pilih ulang (lihat ImportNewAssetsTab -> onNeedPhotoSync).
  const [syncHandoff, setSyncHandoff] = useState<PhotoSyncHandoff | null>(null);

  if (!canImport && authReady) {
    return (
      <ProtectedLayout>
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-center text-sm text-amber-800">
          Halaman Import Aset hanya bisa diakses oleh Super Admin, Asset Admin, dan Asset Finance.
        </div>
      </ProtectedLayout>
    );
  }

  const activeTab = visibleTabs.find((t) => t.key === tab) || visibleTabs[0];

  return (
    <ProtectedLayout>
      <PageHeader
        title="Import Aset"
        subtitle="Import data aset massal dari Excel, atau sinkronkan foto Excel ke aset yang sudah ada."
        actions={
          <button
            type="button"
            onClick={downloadTemplateXlsx}
            className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <Download size={15} />
            Download Template Excel
          </button>
        }
      />

      <div className="mb-5 inline-flex flex-wrap rounded-xl border border-slate-200 bg-white p-1 shadow-sm">
        {visibleTabs.map((t) => {
          const Icon = t.icon;
          const active = t.key === tab;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                active ? "bg-slate-900 text-white shadow" : "text-slate-600 hover:bg-slate-50"
              }`}
            >
              <Icon size={15} />
              {t.label}
            </button>
          );
        })}
      </div>

      <p className="mb-5 text-sm text-slate-500">{activeTab.description}</p>

      {tab === "sync" && (
        <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs font-medium text-amber-800">
          Fitur ini tidak membuat aset baru dan tidak mengubah data aset selain foto/bukti fisik.
        </div>
      )}
      {tab === "sync-number" && (
        <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs font-medium text-amber-800">
          Fitur ini tidak membuat aset baru dan tidak mengubah data aset selain No. Aset.
        </div>
      )}
      {tab === "sync-category" && (
        <div className="mb-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs font-medium text-amber-800">
          Fitur ini tidak membuat aset baru dan tidak mengubah data aset selain Kategori.
        </div>
      )}

      {tab === "import" && (
        <ImportNewAssetsTab
          onNeedPhotoSync={(handoff) => {
            setSyncHandoff(handoff);
            setTab("sync");
          }}
        />
      )}
      {tab === "sync" && (
        <SyncPhotosTab handoff={syncHandoff} onHandoffConsumed={() => setSyncHandoff(null)} />
      )}
      {tab === "sync-number" && <SyncAssetNumberTab />}
      {tab === "sync-category" && <SyncCategoryTab />}
    </ProtectedLayout>
  );
}
