"use client";

import { Asset, AssetCategory } from "@/lib/types";
import {
  ASSET_STATUS_LABEL,
  CONDITION_LABEL,
} from "@/lib/utils";
import { DATE_RANGE_PRESET_LABEL, DateRangePreset, ReportFilters } from "@/lib/reports";

export default function ReportsFilterBar({
  filters,
  onChange,
  assets,
  categories,
}: {
  filters: ReportFilters;
  onChange: (next: ReportFilters) => void;
  assets: Asset[];
  categories: AssetCategory[];
}) {
  const set = <K extends keyof ReportFilters>(key: K, value: ReportFilters[K]) =>
    onChange({ ...filters, [key]: value });

  const companies = Array.from(new Set(assets.map((a) => a.companyOwnerName).filter(Boolean))) as string[];
  const divisions = Array.from(new Set(assets.map((a) => a.divisionOwnerName).filter(Boolean))) as string[];
  const buildings = Array.from(new Set(assets.map((a) => a.buildingName).filter(Boolean))) as string[];
  const floors = Array.from(new Set(assets.map((a) => a.floor).filter(Boolean))) as string[];
  const rooms = Array.from(new Set(assets.map((a) => a.roomName).filter(Boolean))) as string[];
  const pics = Array.from(
    new Set(assets.map((a) => a.responsiblePersonName).filter(Boolean))
  ) as string[];

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 mb-5">
      <div className="grid sm:grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-2.5">
        <select
          value={filters.datePreset}
          onChange={(e) => set("datePreset", e.target.value as DateRangePreset)}
          className="input text-sm cursor-pointer"
        >
          {Object.entries(DATE_RANGE_PRESET_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>

        {filters.datePreset === "custom" && (
          <>
            <input
              type="date"
              value={filters.customFrom}
              onChange={(e) => set("customFrom", e.target.value)}
              className="input text-sm cursor-text"
            />
            <input
              type="date"
              value={filters.customTo}
              onChange={(e) => set("customTo", e.target.value)}
              className="input text-sm cursor-text"
            />
          </>
        )}

        <select
          value={filters.companyFilter}
          onChange={(e) => set("companyFilter", e.target.value)}
          className="input text-sm cursor-pointer"
        >
          <option value="">Semua Brand/Company</option>
          {companies.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>

        <select
          value={filters.divisionFilter}
          onChange={(e) => set("divisionFilter", e.target.value)}
          className="input text-sm cursor-pointer"
        >
          <option value="">Semua Divisi</option>
          {divisions.map((d) => (
            <option key={d} value={d}>
              {d}
            </option>
          ))}
        </select>

        <select
          value={filters.categoryFilter}
          onChange={(e) => set("categoryFilter", e.target.value)}
          className="input text-sm cursor-pointer"
        >
          <option value="">Semua Kategori</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.categoryName}
            </option>
          ))}
        </select>

        <select
          value={filters.buildingFilter}
          onChange={(e) => set("buildingFilter", e.target.value)}
          className="input text-sm cursor-pointer"
        >
          <option value="">Semua Gedung</option>
          {buildings.map((b) => (
            <option key={b} value={b}>
              {b}
            </option>
          ))}
        </select>

        <select
          value={filters.floorFilter}
          onChange={(e) => set("floorFilter", e.target.value)}
          className="input text-sm cursor-pointer"
        >
          <option value="">Semua Lantai</option>
          {floors.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>

        <select
          value={filters.roomFilter}
          onChange={(e) => set("roomFilter", e.target.value)}
          className="input text-sm cursor-pointer"
        >
          <option value="">Semua Ruangan</option>
          {rooms.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>

        <select
          value={filters.statusFilter}
          onChange={(e) => set("statusFilter", e.target.value)}
          className="input text-sm cursor-pointer"
        >
          <option value="">Semua Status Asset</option>
          {Object.entries(ASSET_STATUS_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>

        <select
          value={filters.conditionFilter}
          onChange={(e) => set("conditionFilter", e.target.value)}
          className="input text-sm cursor-pointer"
        >
          <option value="">Semua Kondisi</option>
          {Object.entries(CONDITION_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>

        <select
          value={filters.picFilter}
          onChange={(e) => set("picFilter", e.target.value)}
          className="input text-sm cursor-pointer"
        >
          <option value="">Semua PIC</option>
          {pics.map((p) => (
            <option key={p} value={p}>
              {p}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
