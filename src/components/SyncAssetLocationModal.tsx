"use client";

import { useMemo, useState } from "react";
import { doc, serverTimestamp, writeBatch } from "firebase/firestore";
import { MapPin, X } from "lucide-react";
import { db } from "@/lib/firebase";
import { Asset, AssetLocationNode } from "@/lib/types";
import { buildFullPath } from "@/lib/locations";
import LocationCascadeFields, {
  EMPTY_LOCATION_SELECTION,
  LocationSelection,
} from "@/components/LocationCascadeFields";
import EmptyState from "@/components/EmptyState";

export default function SyncAssetLocationModal({
  open,
  onClose,
  assets,
  locations,
}: {
  open: boolean;
  onClose: () => void;
  assets: Asset[];
  locations: AssetLocationNode[];
}) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selection, setSelection] = useState<LocationSelection>(EMPTY_LOCATION_SELECTION);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(0);

  const unassignedAssets = useMemo(() => assets.filter((a) => !a.buildingId), [assets]);

  if (!open) return null;

  const toggleOne = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    setSelectedIds((prev) =>
      prev.size === unassignedAssets.length ? new Set() : new Set(unassignedAssets.map((a) => a.id))
    );
  };

  const handleClose = () => {
    setSelectedIds(new Set());
    setSelection(EMPTY_LOCATION_SELECTION);
    setError("");
    setDone(0);
    onClose();
  };

  const handleApply = async () => {
    if (selectedIds.size === 0) {
      setError("Pilih minimal 1 asset.");
      return;
    }
    if (!selection.buildingId) {
      setError("Pilih lokasi (minimal Gedung) untuk di-assign ke asset terpilih.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const locationText = buildFullPath({
        buildingName: selection.buildingName,
        floorName: selection.floorName,
        roomName: selection.roomName,
        areaName: selection.areaName,
      });
      const ids = Array.from(selectedIds);
      const CHUNK = 400;
      for (let i = 0; i < ids.length; i += CHUNK) {
        const batch = writeBatch(db);
        ids.slice(i, i + CHUNK).forEach((id) => {
          batch.update(doc(db, "assets", id), {
            buildingId: selection.buildingId,
            buildingName: selection.buildingName,
            floorId: selection.floorId || null,
            floor: selection.floorName || "",
            roomId: selection.roomId || null,
            roomName: selection.roomName || "",
            areaId: selection.areaId || null,
            areaName: selection.areaName || "",
            locationText,
            updatedAt: serverTimestamp(),
          });
        });
        await batch.commit();
        setDone((d) => d + Math.min(CHUNK, ids.length - i));
      }
      setSelectedIds(new Set());
    } catch (err) {
      console.error("[Sync Lokasi Asset] gagal update", err);
      setError("Gagal menyinkronkan lokasi. Coba lagi.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={handleClose} />
      <div className="relative bg-white rounded-2xl shadow-lg border border-slate-200 w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold text-slate-900">Sinkronkan Lokasi Asset Lama</h2>
          <button
            type="button"
            onClick={handleClose}
            className="text-slate-400 hover:text-slate-700 cursor-pointer rounded-lg p-1 hover:bg-slate-100"
          >
            <X size={18} />
          </button>
        </div>
        <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 mb-4">
          Asset di bawah ini belum punya lokasi dari Master Lokasi (masih pakai teks lokasi lama
          atau kosong). Pilih asset, tentukan lokasi master-nya, lalu terapkan.
        </p>

        {unassignedAssets.length === 0 ? (
          <EmptyState icon={MapPin} title="Semua asset sudah punya lokasi master" />
        ) : (
          <>
            <div className="border border-slate-200 rounded-xl overflow-hidden max-h-56 overflow-y-auto mb-4">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-50">
                  <tr className="text-left text-slate-500 border-b border-slate-200">
                    <th className="px-3 py-2 w-8">
                      <input
                        type="checkbox"
                        checked={selectedIds.size === unassignedAssets.length}
                        onChange={toggleAll}
                        className="cursor-pointer"
                      />
                    </th>
                    <th className="px-3 py-2 font-semibold">Asset</th>
                    <th className="px-3 py-2 font-semibold">Kode</th>
                    <th className="px-3 py-2 font-semibold">Lokasi Lama (teks bebas)</th>
                  </tr>
                </thead>
                <tbody>
                  {unassignedAssets.map((a) => (
                    <tr key={a.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/70">
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(a.id)}
                          onChange={() => toggleOne(a.id)}
                          className="cursor-pointer"
                        />
                      </td>
                      <td className="px-3 py-2 font-medium text-slate-800">{a.assetName}</td>
                      <td className="px-3 py-2 text-slate-400">{a.assetCode}</td>
                      <td className="px-3 py-2 text-slate-600">{a.location || "-"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <p className="text-xs text-slate-500 mb-2">
              {selectedIds.size} asset dipilih dari {unassignedAssets.length} asset belum bersinkron.
            </p>

            <label className="block text-xs font-medium text-slate-500 mb-1.5">
              Assign ke Lokasi Master
            </label>
            <LocationCascadeFields locations={locations} value={selection} onChange={setSelection} />

            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2 mt-3">
                {error}
              </p>
            )}
            {done > 0 && !error && (
              <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 mt-3">
                {done} asset berhasil disinkronkan.
              </p>
            )}

            <button
              type="button"
              onClick={handleApply}
              disabled={submitting}
              className="w-full mt-4 rounded-xl bg-gradient-to-r from-blue-600 to-teal-500 text-white px-4 py-2.5 text-sm font-medium cursor-pointer hover:brightness-105 shadow-md shadow-blue-900/20 disabled:opacity-60"
            >
              {submitting ? "Menyinkronkan..." : "Terapkan Lokasi ke Asset Terpilih"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
