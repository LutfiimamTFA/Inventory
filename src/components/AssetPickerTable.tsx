"use client";

import { useEffect, useMemo } from "react";
import { Search, X } from "lucide-react";
import { Asset } from "@/lib/types";
import { ASSET_STATUS_LABEL, CONDITION_LABEL } from "@/lib/utils";
import SearchableSelect, { SearchableSelectItem } from "@/components/SearchableSelect";

export interface AssetPickerFilters {
  search: string;
  buildingName: string;
  floor: string;
  roomName: string;
  areaName: string;
  category: string;
  status: string;
  condition: string;
}

export const DEFAULT_ASSET_PICKER_FILTERS: AssetPickerFilters = {
  search: "",
  buildingName: "",
  floor: "",
  roomName: "",
  areaName: "",
  category: "",
  status: "",
  condition: "",
};

const FILTER_CHIP_LABELS: Record<keyof AssetPickerFilters, string> = {
  search: "Cari",
  buildingName: "Gedung",
  floor: "Lantai",
  roomName: "Ruangan",
  areaName: "Area",
  category: "Kategori",
  status: "Status",
  condition: "Kondisi",
};

export function uniqueSortedValues(values: (string | undefined)[]): string[] {
  return Array.from(new Set(values.filter((v): v is string => !!v && v.trim() !== ""))).sort(
    (a, b) => a.localeCompare(b)
  );
}

function toSelectItems(values: string[]): SearchableSelectItem[] {
  return values.map((v) => ({ id: v, label: v, searchText: v }));
}

export default function AssetPickerTable({
  assets,
  selectedIds,
  onChangeSelected,
  filters,
  onFiltersChange,
  onFilteredAssetsChange,
  readOnly = false,
  hideFilters = false,
}: {
  assets: Asset[];
  categories?: unknown;
  selectedIds: Set<string>;
  onChangeSelected: (next: Set<string>) => void;
  filters: AssetPickerFilters;
  onFiltersChange: (next: AssetPickerFilters) => void;
  onFilteredAssetsChange?: (filtered: Asset[]) => void;
  readOnly?: boolean;
  hideFilters?: boolean;
}) {
  const set = <K extends keyof AssetPickerFilters>(key: K, value: AssetPickerFilters[K]) =>
    onFiltersChange({ ...filters, [key]: value });

  const clearOne = (key: keyof AssetPickerFilters) => set(key, "");

  const buildingOptions = useMemo(() => uniqueSortedValues(assets.map((a) => a.buildingName)), [assets]);
  const floorOptions = useMemo(() => {
    const scoped = filters.buildingName
      ? assets.filter((a) => a.buildingName === filters.buildingName)
      : assets;
    return uniqueSortedValues(scoped.map((a) => a.floor));
  }, [assets, filters.buildingName]);
  const roomOptions = useMemo(() => {
    let scoped = assets;
    if (filters.buildingName) scoped = scoped.filter((a) => a.buildingName === filters.buildingName);
    if (filters.floor) scoped = scoped.filter((a) => a.floor === filters.floor);
    return uniqueSortedValues(scoped.map((a) => a.roomName));
  }, [assets, filters.buildingName, filters.floor]);
  const areaOptions = useMemo(() => {
    let scoped = assets;
    if (filters.buildingName) scoped = scoped.filter((a) => a.buildingName === filters.buildingName);
    if (filters.floor) scoped = scoped.filter((a) => a.floor === filters.floor);
    if (filters.roomName) scoped = scoped.filter((a) => a.roomName === filters.roomName);
    return uniqueSortedValues(scoped.map((a) => a.areaName));
  }, [assets, filters.buildingName, filters.floor, filters.roomName]);
  const categoryOptions = useMemo(() => uniqueSortedValues(assets.map((a) => a.categoryName)), [assets]);
  const statusOptions = useMemo(
    () => uniqueSortedValues(assets.map((a) => ASSET_STATUS_LABEL[a.assetStatus])),
    [assets]
  );
  const conditionOptions = useMemo(
    () => uniqueSortedValues(assets.map((a) => CONDITION_LABEL[a.condition])),
    [assets]
  );

  const hasLocationFilters =
    buildingOptions.length > 0 ||
    floorOptions.length > 0 ||
    roomOptions.length > 0 ||
    areaOptions.length > 0;

  const filtered = useMemo(() => {
    const result = assets.filter((a) => {
      if (
        filters.search &&
        !`${a.assetName} ${a.assetCode}`.toLowerCase().includes(filters.search.toLowerCase())
      )
        return false;
      if (filters.buildingName && a.buildingName !== filters.buildingName) return false;
      if (filters.floor && a.floor !== filters.floor) return false;
      if (filters.roomName && a.roomName !== filters.roomName) return false;
      if (filters.areaName && a.areaName !== filters.areaName) return false;
      if (filters.category && a.categoryName !== filters.category) return false;
      if (filters.status && ASSET_STATUS_LABEL[a.assetStatus] !== filters.status) return false;
      if (filters.condition && CONDITION_LABEL[a.condition] !== filters.condition) return false;
      return true;
    });
    return [...result].sort((a, b) => a.assetName.localeCompare(b.assetName));
  }, [assets, filters]);

  useEffect(() => {
    onFilteredAssetsChange?.(filtered);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered]);

  const activeChips = (Object.keys(filters) as (keyof AssetPickerFilters)[])
    .filter((k) => filters[k])
    .map((k) => ({ key: k, label: `${FILTER_CHIP_LABELS[k]}: ${filters[k]}` }));

  const allFilteredSelected = filtered.length > 0 && filtered.every((a) => selectedIds.has(a.id));

  const toggleOne = (id: string) => {
    if (readOnly) return;
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChangeSelected(next);
  };

  const selectAllFiltered = () => {
    const next = new Set(selectedIds);
    filtered.forEach((a) => next.add(a.id));
    onChangeSelected(next);
  };

  const clearSelection = () => onChangeSelected(new Set());

  const resetFilters = () => onFiltersChange(DEFAULT_ASSET_PICKER_FILTERS);

  return (
    <div>
      {!hideFilters && (
        <>
          <div className="relative mb-2">
            <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              value={filters.search}
              onChange={(e) => set("search", e.target.value)}
              placeholder="Cari nama/kode asset..."
              className="input pl-8 text-sm w-full"
            />
          </div>

          {hasLocationFilters && (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 mb-2">
              {buildingOptions.length > 0 && (
                <div>
                  <label className="block text-[11px] font-medium text-slate-500 mb-1">Gedung Asset</label>
                  <SearchableSelect
                    items={toSelectItems(buildingOptions)}
                    value={filters.buildingName}
                    onChange={(v) =>
                      onFiltersChange({ ...filters, buildingName: v, floor: "", roomName: "", areaName: "" })
                    }
                    placeholder="Pilih Gedung Asset"
                    searchPlaceholder="Cari gedung..."
                    emptyText="Tidak ada data gedung."
                  />
                </div>
              )}
              {floorOptions.length > 0 && (
                <div>
                  <label className="block text-[11px] font-medium text-slate-500 mb-1">Lantai Asset</label>
                  <SearchableSelect
                    items={toSelectItems(floorOptions)}
                    value={filters.floor}
                    onChange={(v) => onFiltersChange({ ...filters, floor: v, roomName: "", areaName: "" })}
                    placeholder="Pilih Lantai Asset"
                    searchPlaceholder="Cari lantai..."
                    emptyText="Tidak ada data lantai."
                  />
                </div>
              )}
              {roomOptions.length > 0 && (
                <div>
                  <label className="block text-[11px] font-medium text-slate-500 mb-1">Ruangan Asset</label>
                  <SearchableSelect
                    items={toSelectItems(roomOptions)}
                    value={filters.roomName}
                    onChange={(v) => onFiltersChange({ ...filters, roomName: v, areaName: "" })}
                    placeholder="Pilih Ruangan Asset"
                    searchPlaceholder="Cari ruangan..."
                    emptyText="Tidak ada data ruangan."
                  />
                </div>
              )}
              {areaOptions.length > 0 && (
                <div>
                  <label className="block text-[11px] font-medium text-slate-500 mb-1">Area Asset</label>
                  <SearchableSelect
                    items={toSelectItems(areaOptions)}
                    value={filters.areaName}
                    onChange={(v) => set("areaName", v)}
                    placeholder="Pilih Area Asset"
                    searchPlaceholder="Cari area..."
                    emptyText="Tidak ada data area."
                  />
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 mb-2">
            {categoryOptions.length > 0 && (
              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">Kategori Asset</label>
                <SearchableSelect
                  items={toSelectItems(categoryOptions)}
                  value={filters.category}
                  onChange={(v) => set("category", v)}
                  placeholder="Pilih Kategori Asset"
                  searchPlaceholder="Cari kategori..."
                  emptyText="Tidak ada data kategori."
                />
              </div>
            )}
            {statusOptions.length > 0 && (
              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">Status Asset</label>
                <SearchableSelect
                  items={toSelectItems(statusOptions)}
                  value={filters.status}
                  onChange={(v) => set("status", v)}
                  placeholder="Pilih Status Asset"
                  searchPlaceholder="Cari status..."
                  emptyText="Tidak ada data status."
                />
              </div>
            )}
            {conditionOptions.length > 0 && (
              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">Kondisi Asset</label>
                <SearchableSelect
                  items={toSelectItems(conditionOptions)}
                  value={filters.condition}
                  onChange={(v) => set("condition", v)}
                  placeholder="Pilih Kondisi Asset"
                  searchPlaceholder="Cari kondisi..."
                  emptyText="Tidak ada data kondisi."
                />
              </div>
            )}
            <div className="flex items-end">
              <button
                type="button"
                onClick={resetFilters}
                className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-500 cursor-pointer hover:bg-slate-50"
              >
                Reset Filter
              </button>
            </div>
          </div>
        </>
      )}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 mb-2 text-xs text-slate-500">
        <span>
          Menampilkan <span className="font-medium text-slate-700">{filtered.length}</span> dari{" "}
          <span className="font-medium text-slate-700">{assets.length}</span> asset
        </span>
        <span>
          Dipilih: <span className="font-medium text-slate-700">{selectedIds.size}</span> asset
        </span>
      </div>

      {!hideFilters && activeChips.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 mb-2">
          <span className="text-xs text-slate-400">Filter aktif:</span>
          {activeChips.map((chip) => (
            <span
              key={chip.key}
              className="inline-flex items-center gap-1 rounded-full bg-blue-50 text-blue-700 border border-blue-200 pl-2.5 pr-1.5 py-0.5 text-xs"
            >
              {chip.label}
              <button
                type="button"
                onClick={() => clearOne(chip.key)}
                className="rounded-full p-0.5 cursor-pointer hover:bg-blue-100"
              >
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}

      {!readOnly && (
        <div className="flex flex-wrap gap-2 mb-3">
          <button
            type="button"
            onClick={selectAllFiltered}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium cursor-pointer hover:bg-slate-50"
          >
            Pilih semua hasil filter ({filtered.length})
          </button>
          <button
            type="button"
            onClick={clearSelection}
            className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-500 cursor-pointer hover:bg-slate-50"
          >
            Hapus pilihan
          </button>
        </div>
      )}

      <div className="border border-slate-200 rounded-xl overflow-hidden min-h-[420px] max-h-[520px] overflow-y-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-slate-50 z-10">
            <tr className="text-left text-slate-500 border-b border-slate-200">
              <th className="px-3 py-2 w-8">
                {!readOnly && (
                  <input
                    type="checkbox"
                    checked={allFilteredSelected}
                    onChange={() => (allFilteredSelected ? clearSelection() : selectAllFiltered())}
                    className="cursor-pointer"
                  />
                )}
              </th>
              <th className="px-3 py-2 font-semibold">Asset</th>
              <th className="px-3 py-2 font-semibold">Kode Asset</th>
              <th className="px-3 py-2 font-semibold">Kategori</th>
              <th className="px-3 py-2 font-semibold">Lokasi</th>
              <th className="px-3 py-2 font-semibold">Kondisi</th>
              <th className="px-3 py-2 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-slate-400">
                  Tidak ada asset yang cocok.
                </td>
              </tr>
            ) : (
              filtered.map((a) => (
                <tr key={a.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/70">
                  <td className="px-3 py-2">
                    <input
                      type="checkbox"
                      checked={selectedIds.has(a.id)}
                      onChange={() => toggleOne(a.id)}
                      disabled={readOnly}
                      className={readOnly ? "cursor-not-allowed" : "cursor-pointer"}
                    />
                  </td>
                  <td className="px-3 py-2 font-medium text-slate-800">{a.assetName}</td>
                  <td className="px-3 py-2 text-slate-400">{a.assetCode}</td>
                  <td className="px-3 py-2 text-slate-600">{a.categoryName}</td>
                  <td className="px-3 py-2 text-slate-600">
                    {[a.buildingName, a.floor, a.roomName, a.areaName].filter(Boolean).join(" / ") ||
                      a.location ||
                      "-"}
                  </td>
                  <td className="px-3 py-2 text-slate-600">{CONDITION_LABEL[a.condition]}</td>
                  <td className="px-3 py-2 text-slate-600">{ASSET_STATUS_LABEL[a.assetStatus]}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
