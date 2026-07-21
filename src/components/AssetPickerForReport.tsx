"use client";

import { useMemo, useState } from "react";
import { CheckCircle2, MapPin, PackageSearch, Search, UserRound, X } from "lucide-react";
import { Asset } from "@/lib/types";
import {
  ASSET_STATUS_COLOR,
  ASSET_STATUS_LABEL,
  CONDITION_LABEL,
} from "@/lib/utils";
import Badge from "@/components/Badge";
import SearchableSelect, { SearchableSelectItem } from "@/components/SearchableSelect";

interface ReportAssetFilters {
  search: string;
  category: string;
  company: string;
  division: string;
  building: string;
  floor: string;
  roomArea: string;
  status: string;
}

const DEFAULT_FILTERS: ReportAssetFilters = {
  search: "",
  category: "",
  company: "",
  division: "",
  building: "",
  floor: "",
  roomArea: "",
  status: "",
};

function uniqueSorted(values: (string | undefined | null)[]) {
  return Array.from(new Set(values.filter((v): v is string => !!v && v.trim() !== ""))).sort((a, b) =>
    a.localeCompare(b)
  );
}

function toItems(values: string[]): SearchableSelectItem[] {
  return values.map((value) => ({ id: value, label: value, searchText: value }));
}

function assetLocationText(asset: Asset) {
  return [asset.buildingName, asset.floor, asset.roomName, asset.areaName].filter(Boolean).join(" / ") ||
    asset.locationText ||
    asset.location ||
    "-";
}

function assetPicText(asset: Asset) {
  return (
    asset.currentHolderName ||
    asset.custodianName ||
    asset.responsiblePersonName ||
    asset.picName ||
    asset.areaPicName ||
    "-"
  );
}

export default function AssetPickerForReport({
  assets,
  selectedAssetId,
  missingAssetSelected,
  onSelectAsset,
  onSelectMissingAsset,
}: {
  assets: Asset[];
  selectedAssetId?: string | null;
  missingAssetSelected: boolean;
  onSelectAsset: (asset: Asset) => void;
  onSelectMissingAsset: () => void;
}) {
  const [filters, setFilters] = useState<ReportAssetFilters>(DEFAULT_FILTERS);

  const setFilter = <K extends keyof ReportAssetFilters>(key: K, value: ReportAssetFilters[K]) =>
    setFilters((prev) => ({ ...prev, [key]: value }));

  const categoryOptions = useMemo(() => uniqueSorted(assets.map((asset) => asset.categoryName)), [assets]);
  const companyOptions = useMemo(() => uniqueSorted(assets.map((asset) => asset.companyOwnerName)), [assets]);
  const divisionOptions = useMemo(() => uniqueSorted(assets.map((asset) => asset.divisionOwnerName)), [assets]);
  const buildingOptions = useMemo(() => uniqueSorted(assets.map((asset) => asset.buildingName)), [assets]);
  const floorOptions = useMemo(() => {
    const scoped = filters.building ? assets.filter((asset) => asset.buildingName === filters.building) : assets;
    return uniqueSorted(scoped.map((asset) => asset.floor));
  }, [assets, filters.building]);
  const roomAreaOptions = useMemo(() => {
    let scoped = assets;
    if (filters.building) scoped = scoped.filter((asset) => asset.buildingName === filters.building);
    if (filters.floor) scoped = scoped.filter((asset) => asset.floor === filters.floor);
    return uniqueSorted(scoped.flatMap((asset) => [asset.roomName, asset.areaName]));
  }, [assets, filters.building, filters.floor]);
  const statusOptions = useMemo(
    () =>
      Object.entries(ASSET_STATUS_LABEL)
        .filter(([key]) => assets.some((asset) => asset.assetStatus === key))
        .map(([id, label]) => ({ id, label, searchText: label })),
    [assets]
  );

  const filteredAssets = useMemo(() => {
    const query = filters.search.trim().toLowerCase();
    return assets
      .filter((asset) => {
        const haystack = [
          asset.assetName,
          asset.assetCode,
          asset.categoryName,
          asset.companyOwnerName,
          asset.divisionOwnerName,
          assetLocationText(asset),
          assetPicText(asset),
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (query && !haystack.includes(query)) return false;
        if (filters.category && asset.categoryName !== filters.category) return false;
        if (filters.company && asset.companyOwnerName !== filters.company) return false;
        if (filters.division && asset.divisionOwnerName !== filters.division) return false;
        if (filters.building && asset.buildingName !== filters.building) return false;
        if (filters.floor && asset.floor !== filters.floor) return false;
        if (filters.roomArea && asset.roomName !== filters.roomArea && asset.areaName !== filters.roomArea) return false;
        if (filters.status && asset.assetStatus !== filters.status) return false;
        return true;
      })
      .sort((a, b) => a.assetName.localeCompare(b.assetName));
  }, [assets, filters]);

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={filters.search}
          onChange={(event) => setFilter("search", event.target.value)}
          placeholder="Cari nama atau kode asset..."
          className="input pl-9"
        />
      </div>

      <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-4">
        <SearchableSelect
          items={toItems(categoryOptions)}
          value={filters.category}
          onChange={(value) => setFilter("category", value)}
          placeholder="Kategori"
          searchPlaceholder="Cari kategori..."
        />
        <SearchableSelect
          items={toItems(companyOptions)}
          value={filters.company}
          onChange={(value) => setFilter("company", value)}
          placeholder="Perusahaan"
          searchPlaceholder="Cari perusahaan..."
        />
        <SearchableSelect
          items={toItems(divisionOptions)}
          value={filters.division}
          onChange={(value) => setFilter("division", value)}
          placeholder="Divisi"
          searchPlaceholder="Cari divisi..."
        />
        <SearchableSelect
          items={statusOptions}
          value={filters.status}
          onChange={(value) => setFilter("status", value)}
          placeholder="Status"
          searchPlaceholder="Cari status..."
        />
        <SearchableSelect
          items={toItems(buildingOptions)}
          value={filters.building}
          onChange={(value) => setFilters((prev) => ({ ...prev, building: value, floor: "", roomArea: "" }))}
          placeholder="Gedung"
          searchPlaceholder="Cari gedung..."
        />
        <SearchableSelect
          items={toItems(floorOptions)}
          value={filters.floor}
          onChange={(value) => setFilters((prev) => ({ ...prev, floor: value, roomArea: "" }))}
          placeholder="Lantai"
          searchPlaceholder="Cari lantai..."
          disabled={!filters.building && buildingOptions.length > 0}
          disabledHint="Pilih gedung dulu"
        />
        <SearchableSelect
          items={toItems(roomAreaOptions)}
          value={filters.roomArea}
          onChange={(value) => setFilter("roomArea", value)}
          placeholder="Ruangan / Area"
          searchPlaceholder="Cari ruangan/area..."
          disabled={!filters.floor && floorOptions.length > 0}
          disabledHint="Pilih lantai dulu"
        />
        <button
          type="button"
          onClick={() => setFilters(DEFAULT_FILTERS)}
          className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-3 text-sm font-semibold text-slate-600 hover:bg-slate-50"
        >
          <X size={15} />
          Reset Filter
        </button>
      </div>

      <button
        type="button"
        onClick={onSelectMissingAsset}
        className={`flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition ${
          missingAssetSelected
            ? "border-blue-300 bg-blue-50 text-blue-800"
            : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
        }`}
      >
        <span className="min-w-0">
          <span className="block text-sm font-semibold">Asset tidak ditemukan / belum terdata</span>
          <span className="block text-xs text-slate-500">Laporan tetap dikirim tanpa asset terkait.</span>
        </span>
        {missingAssetSelected && <CheckCircle2 size={18} className="shrink-0 text-blue-600" />}
      </button>

      <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
        <span>
          Menampilkan <span className="font-semibold text-slate-700">{filteredAssets.length}</span> dari{" "}
          <span className="font-semibold text-slate-700">{assets.length}</span> asset
        </span>
        {selectedAssetId && <span className="font-semibold text-blue-600">Asset dipilih</span>}
      </div>

      <div className="max-h-[520px] space-y-2 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-2">
        {filteredAssets.length === 0 ? (
          <div className="flex min-h-[180px] flex-col items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white px-4 text-center">
            <PackageSearch size={24} className="mb-2 text-slate-300" />
            <p className="text-sm font-semibold text-slate-700">Asset tidak ditemukan</p>
            <p className="text-xs text-slate-400">Ubah filter atau gunakan opsi asset belum terdata.</p>
          </div>
        ) : (
          filteredAssets.map((asset) => {
            const selected = selectedAssetId === asset.id;
            return (
              <div
                key={asset.id}
                className={`rounded-xl border bg-white p-3 transition ${
                  selected ? "border-blue-300 ring-2 ring-blue-100" : "border-slate-200"
                }`}
              >
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 space-y-2">
                    <div>
                      <p className="font-semibold text-slate-900">{asset.assetName}</p>
                      <p className="text-xs font-medium text-slate-400">{asset.assetCode}</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Badge label={asset.categoryName || "Tanpa kategori"} colorClass="bg-slate-100 text-slate-600 border-slate-200" />
                      <Badge label={ASSET_STATUS_LABEL[asset.assetStatus]} colorClass={ASSET_STATUS_COLOR[asset.assetStatus]} />
                    </div>
                    <div className="grid gap-1 text-xs text-slate-500 sm:grid-cols-2">
                      <span className="inline-flex min-w-0 items-center gap-1.5">
                        <MapPin size={13} className="shrink-0 text-slate-400" />
                        <span className="truncate">{assetLocationText(asset)}</span>
                      </span>
                      <span className="inline-flex min-w-0 items-center gap-1.5">
                        <UserRound size={13} className="shrink-0 text-slate-400" />
                        <span className="truncate">{assetPicText(asset)}</span>
                      </span>
                      <span className="truncate">Kondisi: {CONDITION_LABEL[asset.condition]}</span>
                      <span className="truncate">
                        {asset.companyOwnerName || "-"} {asset.divisionOwnerName ? `/ ${asset.divisionOwnerName}` : ""}
                      </span>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => onSelectAsset(asset)}
                    className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold ${
                      selected
                        ? "bg-blue-600 text-white"
                        : "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    {selected && <CheckCircle2 size={16} />}
                    Pilih Asset Ini
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
