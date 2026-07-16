"use client";

import { AssetLocationNode } from "@/lib/types";
import { getChildren } from "@/lib/locations";
import SearchableSelect, { SearchableSelectItem } from "@/components/SearchableSelect";

export interface LocationSelection {
  buildingId: string;
  buildingName: string;
  floorId: string;
  floorName: string;
  roomId: string;
  roomName: string;
  areaId: string;
  areaName: string;
}

export const EMPTY_LOCATION_SELECTION: LocationSelection = {
  buildingId: "",
  buildingName: "",
  floorId: "",
  floorName: "",
  roomId: "",
  roomName: "",
  areaId: "",
  areaName: "",
};

function toItems(nodes: AssetLocationNode[], label: (n: AssetLocationNode) => string): SearchableSelectItem[] {
  return nodes.map((n) => ({ id: n.id, label: label(n), searchText: label(n) }));
}

export default function LocationCascadeFields({
  locations,
  value,
  onChange,
  size = "md",
  columns = 4,
}: {
  locations: AssetLocationNode[];
  value: LocationSelection;
  onChange: (next: LocationSelection) => void;
  size?: "md" | "sm";
  columns?: 2 | 4;
}) {
  const activeLocations = locations.filter((n) => n.status === "active");

  const buildingItems = toItems(
    getChildren(activeLocations, null).filter((n) => n.locationType === "building"),
    (n) => n.buildingName || ""
  );
  const floorItems = value.buildingId
    ? toItems(
        getChildren(activeLocations, value.buildingId).filter((n) => n.locationType === "floor"),
        (n) => n.floorName || ""
      )
    : [];
  const roomItems = value.floorId
    ? toItems(
        getChildren(activeLocations, value.floorId).filter((n) => n.locationType === "room"),
        (n) => n.roomName || ""
      )
    : [];
  const areaItems = value.roomId
    ? toItems(
        getChildren(activeLocations, value.roomId).filter((n) => n.locationType === "area"),
        (n) => n.areaName || ""
      )
    : [];

  const inputClass = size === "sm" ? "text-sm" : "";
  const gridClass = columns === 2 ? "grid grid-cols-1 sm:grid-cols-2 gap-3" : "grid grid-cols-2 sm:grid-cols-4 gap-2";

  return (
    <div className={gridClass}>
      <div className={inputClass}>
        <label className="block text-[11px] font-medium text-slate-500 mb-1">
          Gedung <span className="text-red-500">*</span>
        </label>
        <SearchableSelect
          items={buildingItems}
          value={value.buildingId}
          onChange={(id) => {
            const node = activeLocations.find((n) => n.id === id);
            onChange({
              ...EMPTY_LOCATION_SELECTION,
              buildingId: id,
              buildingName: node?.buildingName || "",
            });
          }}
          placeholder="Pilih gedung"
          searchPlaceholder="Cari gedung..."
          emptyText="Belum ada data Gedung di Master Lokasi."
        />
      </div>
      <div className={inputClass}>
        <label className="block text-[11px] font-medium text-slate-500 mb-1">
          Lantai <span className="text-red-500">*</span>
        </label>
        <SearchableSelect
          items={floorItems}
          value={value.floorId}
          onChange={(id) => {
            const node = activeLocations.find((n) => n.id === id);
            onChange({
              ...value,
              floorId: id,
              floorName: node?.floorName || "",
              roomId: "",
              roomName: "",
              areaId: "",
              areaName: "",
            });
          }}
          placeholder="Pilih lantai"
          searchPlaceholder="Cari lantai..."
          emptyText="Belum ada Lantai di gedung ini."
          disabled={!value.buildingId}
          disabledHint="Pilih gedung dulu"
        />
      </div>
      <div className={inputClass}>
        <label className="block text-[11px] font-medium text-slate-500 mb-1">
          Ruangan <span className="text-red-500">*</span>
        </label>
        <SearchableSelect
          items={roomItems}
          value={value.roomId}
          onChange={(id) => {
            const node = activeLocations.find((n) => n.id === id);
            onChange({
              ...value,
              roomId: id,
              roomName: node?.roomName || "",
              areaId: "",
              areaName: "",
            });
          }}
          placeholder="Pilih ruangan"
          searchPlaceholder="Cari ruangan..."
          emptyText="Belum ada Ruangan di lantai ini."
          disabled={!value.floorId}
          disabledHint="Pilih lantai dulu"
        />
      </div>
      <div className={inputClass}>
        <label className="block text-[11px] font-medium text-slate-500 mb-1">Area</label>
        <SearchableSelect
          items={areaItems}
          value={value.areaId}
          onChange={(id) => {
            const node = activeLocations.find((n) => n.id === id);
            onChange({ ...value, areaId: id, areaName: node?.areaName || "" });
          }}
          placeholder="Pilih area jika ada"
          searchPlaceholder="Cari area..."
          emptyText="Belum ada Area di ruangan ini."
          disabled={!value.roomId}
          disabledHint="Pilih ruangan dulu"
        />
      </div>
    </div>
  );
}
