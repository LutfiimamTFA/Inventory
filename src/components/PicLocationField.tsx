"use client";

import { MapPin } from "lucide-react";
import { AssetLocationNode } from "@/lib/types";
import { resolveLocationSelectionForNode } from "@/lib/locations";

// Section F/G/H — PIC Lokasi TIDAK memakai dropdown cascade Gedung/Lantai/
// Ruangan/Area biasa (isinya cuma lokasi dia sendiri, jadi dropdown itu
// tidak praktis). Kalau cuma pegang 1 lokasi, langsung readonly. Kalau
// pegang beberapa, pilih dulu dari daftar tanggung jawabnya (bukan dropdown
// lokasi global), baru detailnya tampil readonly. Admin (super_admin/
// asset_admin) TETAP pakai <LocationCascadeFields> biasa — komponen ini
// HANYA untuk mode PIC Lokasi.
export default function PicLocationField({
  assignedPicLocations,
  locations,
  selectedLocationId,
  onSelectLocation,
}: {
  assignedPicLocations: AssetLocationNode[];
  locations: AssetLocationNode[];
  selectedLocationId: string;
  onSelectLocation: (id: string) => void;
}) {
  if (assignedPicLocations.length === 0) {
    return (
      <p className="text-xs text-amber-600">
        Anda belum ditetapkan sebagai PIC lokasi manapun — hubungi Asset Admin/QHSE.
      </p>
    );
  }

  const selection = selectedLocationId
    ? resolveLocationSelectionForNode(locations, selectedLocationId)
    : null;
  const selectedNode = assignedPicLocations.find((n) => n.id === selectedLocationId);

  return (
    <div className="space-y-3">
      {assignedPicLocations.length > 1 && (
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-500">
            Pilih Lokasi Tanggung Jawab <span className="text-red-500">*</span>
          </label>
          <select
            value={selectedLocationId}
            onChange={(e) => onSelectLocation(e.target.value)}
            className="input"
          >
            <option value="">Pilih lokasi...</option>
            {assignedPicLocations.map((loc) => (
              <option key={loc.id} value={loc.id}>
                {loc.fullPath}
              </option>
            ))}
          </select>
        </div>
      )}

      {selection && selectedNode && (
        <div className="rounded-xl border border-teal-200 bg-teal-50 p-3.5">
          <div className="flex items-start gap-2">
            <MapPin size={16} className="mt-0.5 shrink-0 text-teal-600" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-teal-900">{selectedNode.fullPath}</p>
              <p className="mt-0.5 text-xs text-teal-700">
                Asset ini akan dicatat pada lokasi tanggung jawab Anda.
              </p>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
            <div>
              <p className="text-teal-600">Gedung</p>
              <p className="font-medium text-teal-900">{selection.buildingName || "-"}</p>
            </div>
            <div>
              <p className="text-teal-600">Lantai</p>
              <p className="font-medium text-teal-900">{selection.floorName || "-"}</p>
            </div>
            <div>
              <p className="text-teal-600">Ruangan</p>
              <p className="font-medium text-teal-900">{selection.roomName || "-"}</p>
            </div>
            <div>
              <p className="text-teal-600">Area</p>
              <p className="font-medium text-teal-900">{selection.areaName || "-"}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
