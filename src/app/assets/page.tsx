"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
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
  MapPin,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  X,
  ChevronsLeft,
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
} from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { Asset, AssetCategory } from "@/lib/types";
import {
  formatDate,
  getAssetConditionColor,
  getAssetConditionLabel,
  isProblemAsset,
} from "@/lib/utils";
import { writeAssetLog } from "@/lib/firestore-helpers";
import { getAssetInvoicePreviewUrl } from "@/lib/assets/asset-status";
import { getAssetNumber, getAssetQuantity, INVOICE_STATUS_COLOR, INVOICE_STATUS_LABEL } from "@/lib/assets/inventory";
import { isAssetInMyPicLocation } from "@/lib/locations";
import { getResolvedPersonDisplay, useEmployeeDirectory } from "@/lib/employeeDirectory";
import {
  formatRupiah,
  getAssetPrice,
  getFinanceStatus,
  hasInvoice,
  hasPrice,
  isFinanceComplete,
  FINANCE_STATUS_LABEL,
  FINANCE_STATUS_COLOR,
} from "@/lib/assetFinance";
import ProtectedLayout from "@/components/ProtectedLayout";
import PageHeader from "@/components/PageHeader";
import FilterCard from "@/components/FilterCard";
import Badge from "@/components/Badge";
import EmptyState from "@/components/EmptyState";
import ConfirmModal from "@/components/ConfirmModal";
import QrLabelModal from "@/components/QrLabelModal";
import BulkQrLabelModal from "@/components/BulkQrLabelModal";
import { Toast, ToastState } from "@/components/Toast";

export default function AssetsPage() {
  return (
    <Suspense fallback={null}>
      <AssetsPageContent />
    </Suspense>
  );
}

function AssetsPageContent() {
  const { firebaseUser, assetUser, role, loading, isLocationPicRole, assignedPicLocations } = useAuth();
  const authReady = !loading && !!firebaseUser && !!assetUser && !!role;
  const router = useRouter();
  const searchParams = useSearchParams();
  const [pageToast, setPageToast] = useState<ToastState | null>(null);

  // Section 8 — pesan sukses "Aset berhasil ditambahkan pada lokasi
  // tanggung jawab Anda." dibawa lewat query param dari /assets/new supaya
  // tetap terlihat setelah redirect (pola sama dengan /my-reports?submitted=1).
  useEffect(() => {
    if (searchParams.get("created") !== "1") return;
    queueMicrotask(() =>
      setPageToast({ type: "success", message: "Aset berhasil ditambahkan pada lokasi tanggung jawab Anda." })
    );
    router.replace("/assets");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
  // Section C — staff yang ditunjuk PIC di Master Lokasi (isLocationPicRole
  // dari auth-context) diperlakukan SAMA seperti role "location_pic"
  // literal untuk seluruh halaman ini, tanpa mengubah role backend-nya.
  const isLocationPicScoped = role === "location_pic" || isLocationPicRole;
  // Section H/I — resolve nama asli PIC/custodian dari direktori karyawan
  // kalau custodianName asset kebetulan cuma email/kosong (data lama).
  const employeeDirectory = useEmployeeDirectory();
  const custodianDisplay = (a: Asset) =>
    getResolvedPersonDisplay(
      { name: a.custodianName || a.picName || a.responsiblePersonName, email: a.custodianEmail || a.picEmail, uid: a.custodianUid || a.picUid },
      employeeDirectory
    );
  const [assets, setAssets] = useState<Asset[]>([]);
  const [categories, setCategories] = useState<AssetCategory[]>([]);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [companyFilter, setCompanyFilter] = useState("");
  const [divisionFilter, setDivisionFilter] = useState("");
  const [locationFilter, setLocationFilter] = useState("");
  const [financeStatusFilter, setFinanceStatusFilter] = useState("");
  const [vendorFilter, setVendorFilter] = useState("");
  const [fundingSourceFilter, setFundingSourceFilter] = useState("");
  // Filter rentang "No. Aset" — angka, BUKAN dropdown (bisa ratusan nilai).
  // String kosong = tidak dibatasi pada sisi itu.
  const [assetNumberFrom, setAssetNumberFrom] = useState("");
  const [assetNumberTo, setAssetNumberTo] = useState("");
  // Sort SATU kolom aktif pada satu waktu — "No." (assetNumber) atau "Qty",
  // keduanya numerik dengan null di paling bawah. Diterapkan SETELAH filter.
  // Default saat halaman pertama dibuka/reload: No. Aset ascending — BUKAN
  // urutan bawaan Firestore (createdAt) dan BUKAN nomor urut render. Tidak
  // pernah ada state "tanpa sorting" — toggle hanya bolak-balik asc/desc
  // pada kolom yang sama, atau pindah kolom (reset ke asc).
  type SortColumn = "number" | "qty";
  const [sortColumn, setSortColumn] = useState<SortColumn>("number");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const toggleSort = (column: SortColumn) => {
    if (sortColumn !== column) {
      setSortColumn(column);
      setSortDir("asc");
    } else {
      setSortDir((prev) => (prev === "asc" ? "desc" : "asc"));
    }
  };
  // Pagination — page size dipertahankan lintas kunjungan lewat localStorage
  // (key "assets_table_page_size"), nomor halaman TIDAK (selalu mulai dari 1
  // tiap kali halaman Assets dibuka).
  const PAGE_SIZE_OPTIONS = [10, 20, 50, 100] as const;
  // Lazy initializer (BUKAN useEffect+setState) — baca localStorage sekali
  // saat komponen pertama kali mount di browser, supaya tidak ada
  // setState-in-effect ekstra render.
  const [pageSize, setPageSizeState] = useState<number>(() => {
    if (typeof window === "undefined") return 20;
    const saved = window.localStorage.getItem("assets_table_page_size");
    const n = saved ? Number(saved) : 20;
    return (PAGE_SIZE_OPTIONS as readonly number[]).includes(n) ? n : 20;
  });
  const [currentPage, setCurrentPage] = useState(1);
  const setPageSize = (n: number) => {
    setPageSizeState(n);
    setCurrentPage(1);
    window.localStorage.setItem("assets_table_page_size", String(n));
  };
  const [assetsLoading, setAssetsLoading] = useState(true);
  const [deactivateTarget, setDeactivateTarget] = useState<Asset | null>(null);
  const [processing, setProcessing] = useState(false);
  const [qrLabelTarget, setQrLabelTarget] = useState<Asset | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkModalOpen, setBulkModalOpen] = useState(false);
  const [confirmSelectAllFiltered, setConfirmSelectAllFiltered] = useState(false);

  const canManage = role === "super_admin" || role === "asset_admin";
  // Section "Rombak permission Asset" — Asset Finance sekarang juga boleh
  // Create/Edit Asset (form-nya sendiri menyesuaikan porsi field per role,
  // lihat /assets/new & /assets/[id]/edit). SENGAJA dipisah dari canManage
  // supaya aksi lain yang canManage-gated (nonaktifkan, bulk QR, checkbox
  // seleksi) TIDAK ikut kebuka untuk Finance — itu bukan bagian dari ticket.
  const canCreateOrEditAssetRole = canManage || role === "asset_finance";
  // Section C — PIC Lokasi boleh menambah/edit aset dasar (dikunci ke
  // lokasinya sendiri di form create/edit), TAPI TIDAK boleh nonaktifkan/
  // hapus aset atau pakai aksi bulk — itu tetap khusus canManage.
  const canCreateOrEditAsset = canCreateOrEditAssetRole || isLocationPicScoped;
  // Section 3 — tombol "Tambah Aset" HANYA untuk PIC Lokasi yang benar-benar
  // punya minimal satu lokasi tanggung jawab (assignedPicLocations dari
  // auth-context) — kalau isLocationPicScoped true tapi belum ditetapkan
  // sebagai PIC lokasi manapun, tombolnya disembunyikan (bukan ditampilkan
  // lalu macet di form /assets/new).
  const canCreateNewAsset = canCreateOrEditAssetRole || (isLocationPicScoped && assignedPicLocations.length > 0);

  // Section M — debug sementara untuk memastikan staff yang ditunjuk PIC di
  // Master Lokasi benar-benar terdeteksi di halaman Assets.
  useEffect(() => {
    if (!authReady) return;
    console.log("[Location PIC Access Debug] /assets", {
      uid: firebaseUser?.uid,
      email: firebaseUser?.email,
      role,
      isLocationPicScoped,
      canOpenAssetsMenu: true,
      canCreateAsset: canCreateOrEditAsset,
    });
  }, [authReady, firebaseUser?.uid, firebaseUser?.email, role, isLocationPicScoped, canCreateOrEditAsset]);

  // Section A — Asset Finance dapat tampilan halaman Assets yang berbeda
  // total: summary card, kolom table, filter, dan aksi semuanya berorientasi
  // finance (harga/invoice/vendor), BUKAN data operasional (lokasi/kondisi/
  // maintenance/PIC).
  const isAssetFinanceRole = role === "asset_finance";

  // Section "Finance QR/Barcode" — Finance boleh melihat QR, buka preview,
  // pilih banyak aset, dan cetak/download barcode massal — TAPI TIDAK ikut
  // mendapat aksi canManage lain (nonaktifkan, dst). QR yang dipakai persis
  // sama dengan Asset Admin/Super Admin (lihat getAssetQrTarget di
  // lib/utils.ts, SATU-SATUNYA sumber nilai QR) — tidak ada QR baru khusus
  // Finance, cuma akses UI yang dibuka.
  const canBulkQr = canManage || isAssetFinanceRole;
  const canViewAssetQr = canManage || isLocationPicScoped || isAssetFinanceRole;

  // Section B/C — PIC Lokasi harus melihat SEMUA asset yang berada di lokasi
  // tanggung jawabnya, walau bukan dia yang input (createdByUid beda) dan
  // walau asset lama belum punya locationPicUid/allowedLocationPicUids sama
  // sekali. isAssetInMyPicLocation fallback ke match lokasi (id, lalu
  // path/nama) kalau field PIC belum terisi — lihat lib/locations.ts.
  const visibleAssets = useMemo(() => {
    if (!isLocationPicScoped) return assets;
    return assets.filter((a) => isAssetInMyPicLocation(a, assignedPicLocations, firebaseUser?.uid));
  }, [assets, isLocationPicScoped, assignedPicLocations, firebaseUser?.uid]);

  // Section F/K — ringkasan aset tetap lokasi vs bergerak (AC/meja/CCTV
  // dipisah dari HP/laptop/kamera). Aset lama belum punya trackingMode
  // tersimpan, diturunkan dari usageType lama supaya tetap terhitung. HANYA
  // dipakai untuk role selain Asset Finance (lihat financeSummary di bawah).
  // Dihitung dari visibleAssets supaya PIC Lokasi lihat ringkasan lokasinya
  // sendiri, bukan seluruh aset kantor.
  const trackingSummary = useMemo(() => {
    let fixedLocation = 0;
    let moving = 0;
    let maintenance = 0;
    let reportedIssue = 0;
    visibleAssets.forEach((a) => {
      const mode = a.trackingMode || (a.usageType === "assigned_daily" ? "assigned_pic" : "shared_borrowable");
      if (mode === "fixed_location") fixedLocation += 1;
      else moving += 1;
      if (a.assetStatus === "maintenance") maintenance += 1;
      // Section 3/10 — isProblemAsset() adalah SATU sumber kebenaran yang
      // sama dipakai Dashboard, supaya angka "Aset Bermasalah" TIDAK PERNAH
      // beda antar halaman.
      if (isProblemAsset(a)) reportedIssue += 1;
    });
    return { fixedLocation, moving, maintenance, reportedIssue };
  }, [visibleAssets]);

  // Section B/D/E — ringkasan finance untuk Asset Finance: total nilai
  // aset, kelengkapan harga/invoice, dan pembelian bulan berjalan.
  const financeSummary = useMemo(() => {
    const pricedAssets = assets.filter(hasPrice);
    const assetsWithoutPrice = assets.filter((a) => !hasPrice(a));
    const assetsWithoutInvoice = assets.filter((a) => !hasInvoice(a));
    const financeCompleteAssets = assets.filter(isFinanceComplete);

    const totalAssetValue = assets.reduce((sum, a) => sum + getAssetPrice(a), 0);
    const averageAssetValue = pricedAssets.length > 0 ? totalAssetValue / pricedAssets.length : 0;
    const assetWithoutInvoiceValue = assetsWithoutInvoice.reduce(
      (sum, a) => sum + getAssetPrice(a),
      0
    );

    const now = new Date();
    const thisMonthValue = assets.reduce((sum, a) => {
      if (!a.purchaseDate) return sum;
      const d = new Date(a.purchaseDate);
      if (d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()) {
        return sum + getAssetPrice(a);
      }
      return sum;
    }, 0);

    let mostExpensive: Asset | null = null;
    assets.forEach((a) => {
      if (getAssetPrice(a) > (mostExpensive ? getAssetPrice(mostExpensive) : 0)) mostExpensive = a;
    });

    const vendorCounts = new Map<string, number>();
    assets.forEach((a) => {
      if (a.vendorName) vendorCounts.set(a.vendorName, (vendorCounts.get(a.vendorName) || 0) + 1);
    });
    let topVendor = "-";
    let topVendorCount = 0;
    vendorCounts.forEach((count, vendor) => {
      if (count > topVendorCount) {
        topVendor = vendor;
        topVendorCount = count;
      }
    });

    return {
      totalAssetValue,
      pricedCount: pricedAssets.length,
      noPriceCount: assetsWithoutPrice.length,
      noInvoiceCount: assetsWithoutInvoice.length,
      completeCount: financeCompleteAssets.length,
      thisMonthValue,
      averageAssetValue,
      mostExpensive: mostExpensive as Asset | null,
      topVendor,
      assetWithoutInvoiceValue,
    };
  }, [assets]);

  const vendorOptions = useMemo(
    () => Array.from(new Set(assets.map((a) => a.vendorName).filter(Boolean))) as string[],
    [assets]
  );
  const fundingSourceOptions = useMemo(
    () => Array.from(new Set(assets.map((a) => a.fundingSource).filter(Boolean))) as string[],
    [assets]
  );

  useEffect(() => {
    if (!authReady) return;
    const q = query(collection(db, "assets"), orderBy("createdAt", "desc"));
    const unsub = onSnapshot(
      q,
      (snap) => {
        console.log("[AssetsPage Listener] assets success:", snap.size);
        setAssets(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Asset)));
        setAssetsLoading(false);
      },
      (error) => {
        console.error("[AssetsPage Listener] assets error:", error);
        setAssetsLoading(false);
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
  // Section E — opsi filter "Kondisi Aset" diturunkan dari label gabungan
  // yang SAMA dipakai badge tabel (getAssetConditionLabel), bukan enum
  // assetStatus mentah — supaya pilihan filter konsisten dengan apa yang
  // sebenarnya user lihat di kolom Kondisi Aset.
  const conditionOptions = useMemo(
    () => Array.from(new Set(assets.map((a) => getAssetConditionLabel(a)))),
    [assets]
  );
  const divisions = useMemo(
    () =>
      Array.from(
        new Set(assets.map((a) => a.divisionOwnerName).filter(Boolean))
      ) as string[],
    [assets]
  );
  // Section E — untuk PIC Lokasi, opsi filter lokasi HANYA berisi lokasi
  // yang jadi tanggung jawabnya sendiri (bukan seluruh lokasi kantor).
  const locations = useMemo(() => {
    const source = isLocationPicScoped ? visibleAssets : assets;
    return Array.from(new Set(source.map((a) => a.location).filter(Boolean))) as string[];
  }, [assets, visibleAssets, isLocationPicScoped]);

  const filtered = visibleAssets
    .filter((a) => {
      if (search) {
        const q = search.trim().toLowerCase();
        // Section — assetNumber ditambahkan ke pencarian dengan EXACT match
        // (bukan substring) supaya mengetik "1" tidak ikut menarik aset
        // dengan No. 10/11/100/dst. Nama/Kode Aset/Lokasi tetap prioritas
        // utama (substring match seperti semula).
        const matchesText = `${a.assetName} ${a.assetCode} ${a.location || ""} ${a.locationText || ""}`
          .toLowerCase()
          .includes(q);
        const assetNumberValue = getAssetNumber(a);
        const matchesNumber = assetNumberValue !== null && String(assetNumberValue) === search.trim();
        if (!matchesText && !matchesNumber) return false;
      }
      if (categoryFilter && a.categoryId !== categoryFilter) return false;
      if (statusFilter && getAssetConditionLabel(a) !== statusFilter) return false;
      if (companyFilter && a.companyOwnerName !== companyFilter) return false;
      if (divisionFilter && a.divisionOwnerName !== divisionFilter) return false;
      if (locationFilter && a.location !== locationFilter) return false;
      if (financeStatusFilter && getFinanceStatus(a) !== financeStatusFilter) return false;
      if (vendorFilter && a.vendorName !== vendorFilter) return false;
      if (fundingSourceFilter && a.fundingSource !== fundingSourceFilter) return false;
      // Section — filter rentang "No. Aset" (angka, bukan dropdown). Aset
      // tanpa assetNumber (null) tidak pernah lolos filter rentang, sama
      // seperti perilaku umum "range filter tidak match kalau data kosong".
      if (assetNumberFrom !== "" || assetNumberTo !== "") {
        const n = getAssetNumber(a);
        if (n === null) return false;
        if (assetNumberFrom !== "" && n < Number(assetNumberFrom)) return false;
        if (assetNumberTo !== "" && n > Number(assetNumberTo)) return false;
      }
      return true;
    })
    .sort((a, b) => {
      // Section — sort kolom "No."/"Qty" numerik (BUKAN string), null/kosong
      // selalu di paling bawah terlepas dari arah sort. Satu kolom aktif
      // pada satu waktu (lihat toggleSort) — default "number" asc saat
      // halaman pertama dibuka, diterapkan SETELAH search+filter dan
      // SEBELUM pagination (lihat `paginated` di bawah).
      const va = sortColumn === "number" ? getAssetNumber(a) : getAssetQuantity(a);
      const vb = sortColumn === "number" ? getAssetNumber(b) : getAssetQuantity(b);
      if (va === null && vb === null) return 0;
      if (va === null) return 1;
      if (vb === null) return -1;
      return sortDir === "asc" ? va - vb : vb - va;
    });

  // Section — rekap "215 Data Aset • 347 Total Unit" mengikuti filter aktif
  // (dihitung dari `filtered`, BUKAN dari seluruh `assets`, dan SEBELUM
  // pagination — halaman hanya memotong tampilan, bukan hasil filter).
  // Bedakan jumlah RECORD aset dari jumlah UNIT fisik (sum quantity) — dua
  // makna berbeda.
  const filteredTotalUnits = filtered.reduce((sum, a) => sum + getAssetQuantity(a), 0);

  const hasFilters = !!(
    search ||
    categoryFilter ||
    statusFilter ||
    companyFilter ||
    divisionFilter ||
    locationFilter ||
    financeStatusFilter ||
    vendorFilter ||
    fundingSourceFilter ||
    assetNumberFrom ||
    assetNumberTo
  );
  const activeFilterCount = [
    search,
    categoryFilter,
    statusFilter,
    companyFilter,
    divisionFilter,
    locationFilter,
    financeStatusFilter,
    vendorFilter,
    fundingSourceFilter,
    assetNumberFrom,
    assetNumberTo,
  ].filter(Boolean).length;

  const handleResetFilters = () => {
    setSearch("");
    setCategoryFilter("");
    setStatusFilter("");
    setCompanyFilter("");
    setDivisionFilter("");
    setLocationFilter("");
    setFinanceStatusFilter("");
    setVendorFilter("");
    setFundingSourceFilter("");
    setAssetNumberFrom("");
    setAssetNumberTo("");
  };

  // Section — urutan wajib Data -> Search -> Filter -> Sorting -> Pagination
  // (`filtered` di atas sudah search+filter+sort; pagination memotong hasil
  // itu SETELAH semuanya, jadi tidak pernah memotong sebelum filter jalan).
  //
  // Reset ke halaman 1 setiap kali kombinasi search/filter berubah — dicek
  // dengan membandingkan "signature" filter aktif terhadap render sebelumnya
  // (pola "adjust state during render" React, BUKAN useEffect, supaya tidak
  // kena react-hooks/set-state-in-effect dan tidak ada render tambahan).
  const filterSignature = JSON.stringify([
    search,
    categoryFilter,
    statusFilter,
    companyFilter,
    divisionFilter,
    locationFilter,
    financeStatusFilter,
    vendorFilter,
    fundingSourceFilter,
    assetNumberFrom,
    assetNumberTo,
  ]);
  const [prevFilterSignature, setPrevFilterSignature] = useState(filterSignature);
  if (filterSignature !== prevFilterSignature) {
    setPrevFilterSignature(filterSignature);
    setCurrentPage(1);
  }

  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  // Halaman efektif — dihitung, BUKAN disimpan lagi ke state, supaya kalau
  // data realtime berubah (mis. aset dihapus) dan currentPage jadi lebih
  // besar dari totalPages, tampilan langsung "nyangkut" ke halaman terakhir
  // yang valid tanpa render tambahan.
  const effectivePage = Math.min(currentPage, totalPages);
  const paginated = filtered.slice((effectivePage - 1) * pageSize, effectivePage * pageSize);
  const paginationStart = filtered.length === 0 ? 0 : (effectivePage - 1) * pageSize + 1;
  const paginationEnd = Math.min(effectivePage * pageSize, filtered.length);
  const goToPage = (page: number) => setCurrentPage(Math.min(Math.max(1, page), totalPages));
  // Nomor halaman dengan elipsis — selalu tampilkan halaman pertama/terakhir
  // + tetangga current page, sisanya "..." (jangan render ratusan tombol).
  const pageNumbers = useMemo(() => {
    const delta = 1;
    const range: (number | "ellipsis")[] = [];
    const left = Math.max(2, effectivePage - delta);
    const right = Math.min(totalPages - 1, effectivePage + delta);
    range.push(1);
    if (left > 2) range.push("ellipsis");
    for (let p = left; p <= right; p++) range.push(p);
    if (right < totalPages - 1) range.push("ellipsis");
    if (totalPages > 1) range.push(totalPages);
    return range;
  }, [effectivePage, totalPages]);

  const allVisibleSelected =
    paginated.length > 0 && paginated.every((a) => selectedIds.has(a.id));
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
        paginated.forEach((a) => next.delete(a.id));
      } else {
        paginated.forEach((a) => next.add(a.id));
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
        title={isLocationPicScoped ? "Asset Lokasi Saya" : "Assets"}
        subtitle={
          isLocationPicScoped
            ? "Anda hanya melihat asset pada lokasi yang menjadi tanggung jawab Anda."
            : "Kelola data master, lokasi, kondisi, dan identitas aset perusahaan."
        }
        actions={
          <>
            <Link
              href="/scan"
              className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50 shadow-sm"
            >
              <QrCode size={16} />
              Scan QR
            </Link>
            {canBulkQr && (
              <button
                type="button"
                onClick={handleBulkQrClick}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-700 cursor-pointer hover:bg-slate-50 shadow-sm"
              >
                <QrCode size={16} />
                Bulk QR Label
              </button>
            )}
            {canCreateNewAsset && (
              <Link
                href="/assets/new"
                className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-blue-600 to-teal-500 text-white px-4 py-2.5 text-sm font-medium hover:brightness-105 shadow-md shadow-blue-900/20"
              >
                <Plus size={16} />
                Tambah Aset
              </Link>
            )}
          </>
        }
      />

      {/* Section 3 — PIC Lokasi TANPA lokasi tanggung jawab tidak melihat
          tombol Tambah Aset sama sekali — beri tahu kenapa. */}
      {isLocationPicScoped && !canManage && assignedPicLocations.length === 0 && (
        <p className="-mt-4 mb-4 text-xs font-medium text-amber-600">
          Anda belum ditetapkan sebagai PIC lokasi.
        </p>
      )}

      {/* Section E — badge mode PIC Lokasi, supaya Daniel dkk langsung sadar
          daftar ini sudah disaring ke lokasi tanggung jawabnya, bukan bug
          "asset hilang". */}
      {isLocationPicScoped && (
        <div className="mb-5 flex items-center gap-2 rounded-2xl border border-teal-200 bg-teal-50 px-4 py-3 text-sm text-teal-800">
          <MapPin size={16} className="shrink-0" />
          {assignedPicLocations.length === 1 ? (
            <span className="font-semibold">{assignedPicLocations[0].fullPath}</span>
          ) : assignedPicLocations.length > 1 ? (
            <span className="font-semibold">{assignedPicLocations.length} lokasi tanggung jawab</span>
          ) : (
            <span className="font-semibold">Mode PIC Lokasi</span>
          )}
        </div>
      )}

      {isAssetFinanceRole ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mb-5">
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-xs text-slate-500">Total Nilai Aset</p>
            <p className="text-xl font-semibold text-slate-900 mt-1">
              {formatRupiah(financeSummary.totalAssetValue)}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-xs text-slate-500">Aset Sudah Ada Harga</p>
            <p className="text-2xl font-semibold text-emerald-600 mt-1">{financeSummary.pricedCount}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-xs text-slate-500">Aset Belum Ada Harga</p>
            <p className="text-2xl font-semibold text-red-600 mt-1">{financeSummary.noPriceCount}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-xs text-slate-500">Aset Belum Ada Invoice</p>
            <p className="text-2xl font-semibold text-amber-600 mt-1">{financeSummary.noInvoiceCount}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-xs text-slate-500">Data Finance Lengkap</p>
            <p className="text-2xl font-semibold text-emerald-600 mt-1">{financeSummary.completeCount}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-xs text-slate-500">Pembelian Bulan Ini</p>
            <p className="text-xl font-semibold text-slate-900 mt-1">
              {formatRupiah(financeSummary.thisMonthValue)}
            </p>
          </div>

          {/* Section C — opsional, ditambahkan karena datanya sudah dihitung
              di financeSummary. */}
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-xs text-slate-500">Rata-rata Nilai Aset</p>
            <p className="text-xl font-semibold text-slate-900 mt-1">
              {formatRupiah(financeSummary.averageAssetValue)}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-xs text-slate-500">Aset Termahal</p>
            <p className="text-sm font-semibold text-slate-900 mt-1 truncate">
              {financeSummary.mostExpensive?.assetName || "-"}
            </p>
            <p className="text-xs text-slate-500">
              {financeSummary.mostExpensive ? formatRupiah(getAssetPrice(financeSummary.mostExpensive)) : ""}
            </p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-xs text-slate-500">Vendor Terbanyak</p>
            <p className="text-xl font-semibold text-slate-900 mt-1 truncate">{financeSummary.topVendor}</p>
          </div>
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-xs text-slate-500">Total Nilai Tanpa Invoice</p>
            <p className="text-xl font-semibold text-amber-600 mt-1">
              {formatRupiah(financeSummary.assetWithoutInvoiceValue)}
            </p>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-5">
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
          <div className="rounded-2xl border border-slate-200 bg-white p-4">
            <p className="text-xs text-slate-500">Aset Bermasalah</p>
            <p className="text-2xl font-semibold text-amber-600 mt-1">{trackingSummary.reportedIssue}</p>
          </div>
        </div>
      )}

      <FilterCard>
        <div className="relative lg:col-span-2">
          <Search
            size={16}
            className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari nama/kode aset..."
            className="input h-11 w-full !pl-11 pr-4"
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
          <option value="">Semua Kondisi</option>
          {conditionOptions.map((label) => (
            <option key={label} value={label}>
              {label}
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
        {isAssetFinanceRole ? (
          <>
            <select
              value={financeStatusFilter}
              onChange={(e) => setFinanceStatusFilter(e.target.value)}
              className="input"
            >
              <option value="">Semua Status Finance</option>
              {Object.entries(FINANCE_STATUS_LABEL).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
            <select
              value={vendorFilter}
              onChange={(e) => setVendorFilter(e.target.value)}
              className="input"
            >
              <option value="">Semua Vendor</option>
              {vendorOptions.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
            <select
              value={fundingSourceFilter}
              onChange={(e) => setFundingSourceFilter(e.target.value)}
              className="input"
            >
              <option value="">Semua Sumber Dana</option>
              {fundingSourceOptions.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </>
        ) : (
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
        )}
        <div className="flex items-center gap-2">
          <input
            type="number"
            inputMode="numeric"
            value={assetNumberFrom}
            onChange={(e) => setAssetNumberFrom(e.target.value)}
            placeholder="No. Dari"
            className="input min-w-0"
          />
          <span className="text-xs text-slate-400 shrink-0">s/d</span>
          <input
            type="number"
            inputMode="numeric"
            value={assetNumberTo}
            onChange={(e) => setAssetNumberTo(e.target.value)}
            placeholder="No. Sampai"
            className="input min-w-0"
          />
        </div>
      </FilterCard>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <p className="text-xs font-medium text-slate-500">
          {filtered.length} Data Aset • {filteredTotalUnits} Total Unit
        </p>
        {activeFilterCount > 0 && (
          <span className="rounded-full bg-blue-50 text-blue-700 border border-blue-200 px-2 py-0.5 text-[11px] font-medium">
            {activeFilterCount} Filter Aktif
          </span>
        )}
        {hasFilters && (
          <button
            type="button"
            onClick={handleResetFilters}
            className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2.5 py-0.5 text-[11px] font-medium text-slate-600 hover:bg-slate-50"
          >
            <X size={11} /> Reset Filter
          </button>
        )}
      </div>

      {canBulkQr && selectedIds.size > 0 && (
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
              Cetak {selectedIds.size} Barcode
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
        {assetsLoading ? (
          <div className="p-4 space-y-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-12 rounded-xl bg-slate-100 animate-pulse" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={Package}
            title={hasFilters ? "Tidak ada aset yang sesuai dengan filter." : "Belum ada asset"}
            description={
              hasFilters
                ? "Coba ubah kata kunci atau filter pencarian."
                : "Mulai dengan menambahkan asset pertama perusahaan."
            }
            action={
              hasFilters ? (
                <button
                  type="button"
                  onClick={handleResetFilters}
                  className="inline-flex items-center gap-2 rounded-xl bg-slate-900 text-white px-4 py-2 text-sm font-medium hover:bg-slate-800"
                >
                  <X size={16} />
                  Reset Filter
                </button>
              ) : (
                canManage && (
                  <Link
                    href="/assets/new"
                    className="inline-flex items-center gap-2 rounded-xl bg-slate-900 text-white px-4 py-2 text-sm font-medium hover:bg-slate-800"
                  >
                    <Plus size={16} />
                    Tambah Aset
                  </Link>
                )
              )
            }
          />
        ) : (
          <>
          {/* Desktop/tablet — table seperti sebelumnya, cuma dibungkus
              "hidden md:block" supaya tidak ikut dipaksa render (dan
              melebar) di mobile. min-w-[880px] SENGAJA cuma dipakai di
              sini, di dalam wrapper overflow-x-auto khusus desktop. */}
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full min-w-[880px] text-sm">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-200 bg-slate-50/60">
                  {canBulkQr && (
                    <th className="px-4 py-3 w-10" title="Pilih Semua">
                      <input
                        type="checkbox"
                        checked={allVisibleSelected}
                        onChange={toggleSelectAllVisible}
                        className="cursor-pointer"
                        aria-label="Pilih semua asset yang tampil"
                      />
                    </th>
                  )}
                  <th className="px-2 py-3 font-semibold w-16">
                    <button
                      type="button"
                      onClick={() => toggleSort("number")}
                      className="inline-flex items-center gap-1 cursor-pointer hover:text-slate-700"
                      title="Urutkan No."
                    >
                      No.
                      {sortColumn === "number" ? (
                        sortDir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />
                      ) : (
                        <ArrowUpDown size={12} className="opacity-40" />
                      )}
                    </button>
                  </th>
                  <th className="px-4 py-3 font-semibold">Asset</th>
                  <th className="px-4 py-3 font-semibold">Kategori</th>
                  <th className="px-2 py-3 font-semibold w-16">
                    <button
                      type="button"
                      onClick={() => toggleSort("qty")}
                      className="inline-flex items-center gap-1 cursor-pointer hover:text-slate-700"
                      title="Urutkan Qty"
                    >
                      Qty
                      {sortColumn === "qty" ? (
                        sortDir === "asc" ? <ArrowUp size={12} /> : <ArrowDown size={12} />
                      ) : (
                        <ArrowUpDown size={12} className="opacity-40" />
                      )}
                    </button>
                  </th>
                  <th className="px-2 py-3 font-semibold w-24">Tanggal Perolehan</th>
                  {isAssetFinanceRole ? (
                    <>
                      <th className="px-4 py-3 font-semibold">Perusahaan / Divisi</th>
                      <th className="px-4 py-3 font-semibold">Harga Perolehan</th>
                      <th className="px-4 py-3 font-semibold">Status Finance</th>
                      <th className="px-4 py-3 font-semibold">Status Invoice</th>
                      <th className="px-4 py-3 font-semibold">Invoice</th>
                      <th className="px-4 py-3 font-semibold">Vendor</th>
                    </>
                  ) : (
                    <>
                      <th className="px-4 py-3 font-semibold">Lokasi</th>
                      <th className="px-4 py-3 font-semibold">Perusahaan / Divisi</th>
                      <th className="px-4 py-3 font-semibold">Kondisi Aset</th>
                    </>
                  )}
                  <th className="px-4 py-3 font-semibold text-right">Aksi</th>
                </tr>
              </thead>
              <tbody>
                {paginated.map((a) => (
                  <tr
                    key={a.id}
                    className="border-b border-slate-100 last:border-0 hover:bg-slate-50/70 transition-colors"
                  >
                    {canBulkQr && (
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
                    <td className="px-2 py-3 text-slate-500">{getAssetNumber(a) ?? "-"}</td>
                    <td className="px-4 py-3">
                      <Link href={`/assets/${a.id}`} className="block">
                        <p className="font-medium text-slate-800">{a.assetName}</p>
                        <p className="text-xs text-slate-400">{a.assetCode}</p>
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{a.categoryName}</td>
                    <td className="px-2 py-3 text-slate-500">{getAssetQuantity(a)}</td>
                    <td className="px-2 py-3 text-slate-500 whitespace-nowrap">
                      {formatDate(a.acquisitionDate || a.purchaseDate)}
                    </td>
                    {isAssetFinanceRole ? (
                      <>
                        <td className="px-4 py-3 text-slate-500">
                          <p>{a.companyOwnerName || "-"}</p>
                          <p className="text-xs text-slate-400">{a.divisionOwnerName || ""}</p>
                        </td>
                        <td className="px-4 py-3 text-slate-500">{formatRupiah(getAssetPrice(a))}</td>
                        <td className="px-4 py-3">
                          <Badge
                            label={FINANCE_STATUS_LABEL[getFinanceStatus(a)]}
                            colorClass={FINANCE_STATUS_COLOR[getFinanceStatus(a)]}
                          />
                        </td>
                        <td className="px-4 py-3">
                          {a.invoiceStatus ? (
                            <Badge
                              label={INVOICE_STATUS_LABEL[a.invoiceStatus]}
                              colorClass={INVOICE_STATUS_COLOR[a.invoiceStatus]}
                            />
                          ) : (
                            <span className="text-slate-300">-</span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-500">
                          {getAssetInvoicePreviewUrl(a) ? (
                            <a
                              href={getAssetInvoicePreviewUrl(a)!}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:underline"
                            >
                              {a.invoiceNumber || "Lihat file"}
                            </a>
                          ) : (
                            a.invoiceNumber || "-"
                          )}
                        </td>
                        <td className="px-4 py-3 text-slate-500">{a.vendorName || "-"}</td>
                      </>
                    ) : (
                      <>
                        <td className="px-4 py-3 text-slate-500">{a.location || "-"}</td>
                        <td className="px-4 py-3 text-slate-500">
                          <p>{a.companyOwnerName || "-"}</p>
                          <p className="text-xs text-slate-400">{a.divisionOwnerName || ""}</p>
                        </td>
                        <td className="px-4 py-3">
                          <Badge
                            label={getAssetConditionLabel(a)}
                            colorClass={getAssetConditionColor(a)}
                          />
                          {a.hasActiveIssue && a.activeIssueTicketNo && (
                            <p className="mt-1 font-mono text-[11px] text-amber-600">{a.activeIssueTicketNo}</p>
                          )}
                        </td>
                      </>
                    )}
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <Link
                          href={`/assets/${a.id}`}
                          title="Lihat Detail"
                          className="p-1.5 rounded-lg cursor-pointer transition-colors hover:bg-slate-100 text-slate-500"
                        >
                          <Eye size={15} />
                        </Link>
                        {isAssetFinanceRole && (
                          <Link
                            href={`/assets/${a.id}/edit?mode=finance`}
                            title={isFinanceComplete(a) ? "Edit Finance" : "Lengkapi Finance"}
                            className="p-1.5 rounded-lg cursor-pointer transition-colors hover:bg-slate-100 text-slate-500"
                          >
                            <Pencil size={15} />
                          </Link>
                        )}
                        {(canManage || (isLocationPicScoped && isAssetInMyPicLocation(a, assignedPicLocations, firebaseUser?.uid))) && (
                          <Link
                            href={`/assets/${a.id}/edit`}
                            title="Edit Asset"
                            className="p-1.5 rounded-lg cursor-pointer transition-colors hover:bg-slate-100 text-slate-500"
                          >
                            <Pencil size={15} />
                          </Link>
                        )}
                        {canViewAssetQr && (
                          <button
                            type="button"
                            onClick={() => setQrLabelTarget(a)}
                            title="QR/Barcode"
                            className="p-1.5 rounded-lg cursor-pointer transition-colors hover:bg-slate-100 text-slate-500"
                          >
                            <QrCode size={15} />
                          </button>
                        )}
                        {canManage && (
                          <button
                            type="button"
                            onClick={() => setDeactivateTarget(a)}
                            title="Nonaktifkan Asset"
                            className="p-1.5 rounded-lg cursor-pointer transition-colors hover:bg-red-50 text-slate-500 hover:text-red-600"
                          >
                            <Power size={15} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile — card list per aset menggantikan table (section A/B).
              Field yang tampil beda per role, sama seperti kolom table di
              atas: Asset Finance fokus harga/invoice/vendor, role lain
              fokus data inventaris fisik (No./Kode/Qty/Tanggal Perolehan/
              Lokasi/Kondisi) — harga TIDAK PERNAH tampil di luar role
              Asset Finance, dipindah seluruhnya ke modul Finance. */}
          <div className="block md:hidden space-y-3 p-3">
            {paginated.map((a) => (
              <div
                key={a.id}
                className="w-full max-w-full rounded-2xl border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/assets/${a.id}`} className="block">
                      <h3 className="text-sm font-semibold text-slate-900 break-words">
                        {getAssetNumber(a) !== null && (
                          <span className="text-slate-400 font-normal">No. {getAssetNumber(a)} · </span>
                        )}
                        {a.assetName || "-"}
                      </h3>
                      <p className="mt-0.5 text-xs text-slate-500 break-all">{a.assetCode || "-"}</p>
                    </Link>
                  </div>
                  <div className="text-right shrink-0">
                    <Badge
                      label={
                        isAssetFinanceRole
                          ? FINANCE_STATUS_LABEL[getFinanceStatus(a)]
                          : getAssetConditionLabel(a)
                      }
                      colorClass={
                        isAssetFinanceRole
                          ? FINANCE_STATUS_COLOR[getFinanceStatus(a)]
                          : getAssetConditionColor(a)
                      }
                    />
                    {!isAssetFinanceRole && a.hasActiveIssue && a.activeIssueTicketNo && (
                      <p className="mt-1 font-mono text-[11px] text-amber-600">{a.activeIssueTicketNo}</p>
                    )}
                  </div>
                </div>

                <div className="mt-4 grid grid-cols-1 gap-3 text-sm">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-2">
                      <p className="text-xs text-slate-400">Kategori</p>
                      <p className="font-medium text-slate-700 break-words">{a.categoryName || "-"}</p>
                    </div>
                    <div>
                      <p className="text-xs text-slate-400">Qty</p>
                      <p className="font-medium text-slate-700">{getAssetQuantity(a)}</p>
                    </div>
                  </div>

                  <div>
                    <p className="text-xs text-slate-400">Tanggal Perolehan</p>
                    <p className="font-medium text-slate-700">{formatDate(a.acquisitionDate || a.purchaseDate)}</p>
                  </div>

                  {isAssetFinanceRole ? (
                    <>
                      <div>
                        <p className="text-xs text-slate-400">Perusahaan / Divisi</p>
                        <p className="font-medium text-slate-700 break-words">
                          {a.companyOwnerName || "-"}
                        </p>
                        <p className="text-xs text-slate-500 break-words">{a.divisionOwnerName || ""}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-400">Harga Perolehan</p>
                        <p className="font-semibold text-slate-900">{formatRupiah(getAssetPrice(a))}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-400">Status Invoice</p>
                        {a.invoiceStatus ? (
                          <Badge
                            label={INVOICE_STATUS_LABEL[a.invoiceStatus]}
                            colorClass={INVOICE_STATUS_COLOR[a.invoiceStatus]}
                          />
                        ) : (
                          <p className="text-sm text-slate-400">-</p>
                        )}
                      </div>
                      <div>
                        <p className="text-xs text-slate-400">Invoice</p>
                        <p className="font-medium text-slate-700 break-words">
                          {getAssetInvoicePreviewUrl(a) ? (
                            <a
                              href={getAssetInvoicePreviewUrl(a)!}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:underline"
                            >
                              {a.invoiceNumber || "Lihat file"}
                            </a>
                          ) : (
                            a.invoiceNumber || "-"
                          )}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-400">Vendor</p>
                        <p className="font-medium text-slate-700 break-words">{a.vendorName || "-"}</p>
                      </div>
                    </>
                  ) : (
                    <>
                      <div>
                        <p className="text-xs text-slate-400">Lokasi</p>
                        <p className="font-medium text-slate-700 break-words">
                          {a.locationText || a.location || "-"}
                        </p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-400">Perusahaan / Divisi</p>
                        <p className="font-medium text-slate-700 break-words">
                          {a.companyOwnerName || "-"}
                        </p>
                        <p className="text-xs text-slate-500 break-words">{a.divisionOwnerName || ""}</p>
                      </div>
                      <div>
                        <p className="text-xs text-slate-400">PIC Operasional</p>
                        <p className="font-medium text-slate-700 break-words">
                          {custodianDisplay(a).name}
                        </p>
                        {custodianDisplay(a).sub && (
                          <p className="text-xs text-slate-500 break-words">{custodianDisplay(a).sub}</p>
                        )}
                      </div>
                    </>
                  )}
                </div>

                <div className="mt-4 flex flex-wrap justify-end gap-2">
                  <Link
                    href={`/assets/${a.id}`}
                    className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                  >
                    Lihat Detail
                  </Link>
                  {isAssetFinanceRole && (
                    <Link
                      href={`/assets/${a.id}/edit?mode=finance`}
                      className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      {isFinanceComplete(a) ? "Edit Finance" : "Lengkapi Finance"}
                    </Link>
                  )}
                  {(canManage || (isLocationPicScoped && isAssetInMyPicLocation(a, assignedPicLocations, firebaseUser?.uid))) && (
                    <Link
                      href={`/assets/${a.id}/edit`}
                      className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      Edit Asset
                    </Link>
                  )}
                  {canViewAssetQr && (
                    <button
                      type="button"
                      onClick={() => setQrLabelTarget(a)}
                      className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
                    >
                      <QrCode size={14} />
                      QR/Barcode
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-slate-100 px-4 py-3">
            <p className="text-xs text-slate-500 order-2 sm:order-1">
              Menampilkan {paginationStart}–{paginationEnd} dari {filtered.length} data
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3 order-1 sm:order-2">
              <label className="flex items-center gap-1.5 text-xs text-slate-500">
                Tampilkan
                <select
                  value={pageSize}
                  onChange={(e) => setPageSize(Number(e.target.value))}
                  className="input !w-auto !py-1 !px-2 text-xs"
                >
                  {PAGE_SIZE_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
                per halaman
              </label>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => goToPage(1)}
                  disabled={effectivePage === 1}
                  className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                  title="Halaman pertama"
                >
                  <ChevronsLeft size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => goToPage(effectivePage - 1)}
                  disabled={effectivePage === 1}
                  className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                  title="Sebelumnya"
                >
                  <ChevronLeft size={14} />
                </button>
                {pageNumbers.map((p, i) =>
                  p === "ellipsis" ? (
                    <span key={`ellipsis-${i}`} className="px-1.5 text-xs text-slate-400">
                      …
                    </span>
                  ) : (
                    <button
                      key={p}
                      type="button"
                      onClick={() => goToPage(p)}
                      className={`min-w-[1.75rem] rounded-lg px-2 py-1 text-xs font-medium cursor-pointer ${
                        p === effectivePage
                          ? "bg-slate-900 text-white"
                          : "text-slate-600 border border-slate-200 hover:bg-slate-50"
                      }`}
                    >
                      {p}
                    </button>
                  )
                )}
                <button
                  type="button"
                  onClick={() => goToPage(effectivePage + 1)}
                  disabled={effectivePage === totalPages}
                  className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                  title="Berikutnya"
                >
                  <ChevronRight size={14} />
                </button>
                <button
                  type="button"
                  onClick={() => goToPage(totalPages)}
                  disabled={effectivePage === totalPages}
                  className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
                  title="Halaman terakhir"
                >
                  <ChevronsRight size={14} />
                </button>
              </div>
            </div>
          </div>
          </>
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

      <Toast toast={pageToast} onClose={() => setPageToast(null)} />
    </ProtectedLayout>
  );
}
