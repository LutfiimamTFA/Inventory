"use client";

import { useMemo, useState } from "react";
import { doc, serverTimestamp, updateDoc, arrayUnion } from "firebase/firestore";
import { MapPin, X, CheckCircle2 } from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { writeAssetLog } from "@/lib/firestore-helpers";
import { Asset, AssetLocationNode } from "@/lib/types";
import { buildFullPath, resolveAreaPic } from "@/lib/locations";
import {
  LegacyLocationAssetRow,
  NO_LOCATION_KEY,
  groupLegacyLocations,
} from "@/lib/import/legacy-location-sync";
import LocationCascadeFields, { EMPTY_LOCATION_SELECTION, LocationSelection } from "@/components/LocationCascadeFields";
import ConfirmModal from "@/components/ConfirmModal";
import EmptyState from "@/components/EmptyState";

// Section "Sinkronkan Lokasi Asset Lama" — mapping dilakukan per KELOMPOK
// lokasi lama (mis. "MDS"), BUKAN per aset satu-satu. Klik satu kelompok ->
// seluruh aset di kelompok itu otomatis terseleksi -> tentukan Master Lokasi
// sekali -> "Terapkan" mengubah semuanya sekaligus. Grouping dihitung dari
// assets/locations yang SUDAH di-fetch parent (/locations) lewat props,
// tidak query Firestore sendiri (lihat lib/import/legacy-location-sync.ts).

const SOURCE_LABEL: Record<LegacyLocationAssetRow["source"], string> = {
  location: "Field Lokasi",
  assetCode: "Kode Aset",
  none: "-",
};

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
  const { firebaseUser, assetUser, role } = useAuth();

  const [locationFilterKey, setLocationFilterKey] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selection, setSelection] = useState<LocationSelection>(EMPTY_LOCATION_SELECTION);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [applying, setApplying] = useState(false);
  const [applyProgress, setApplyProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState("");
  const [resultMessage, setResultMessage] = useState("");

  // "Adjust state during render" — reset seleksi/filter setiap kali modal
  // berpindah dari tertutup ke terbuka (BUKAN useEffect, konsisten dengan
  // pola yang sudah dipakai modal lain di project ini).
  const [prevOpen, setPrevOpen] = useState(false);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setLocationFilterKey("");
      setSelectedIds(new Set());
      setSelection(EMPTY_LOCATION_SELECTION);
      setError("");
      setResultMessage("");
    }
  }

  const { groups, assetRows } = useMemo(() => groupLegacyLocations(assets, locations), [assets, locations]);

  if (!open) return null;

  const filteredRows = locationFilterKey ? assetRows.filter((r) => r.legacyLocationKey === locationFilterKey) : assetRows;

  const selectedGroupLabel = (() => {
    if (selectedIds.size === 0) return null;
    const keys = new Set(assetRows.filter((r) => selectedIds.has(r.id)).map((r) => r.legacyLocationKey));
    if (keys.size !== 1) return null;
    return groups.find((g) => g.key === Array.from(keys)[0])?.displayLabel || null;
  })();

  const handleClickGroup = (groupKey: string, assetIds: string[]) => {
    setLocationFilterKey(groupKey);
    setSelectedIds(new Set(assetIds));
    setError("");
    setResultMessage("");
  };

  const handleSelectAllFiltered = () => setSelectedIds(new Set(filteredRows.map((r) => r.id)));
  const handleClearSelection = () => setSelectedIds(new Set());
  const toggleRow = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleClose = () => {
    if (applying) return;
    onClose();
  };

  const selectionComplete = !!(selection.buildingId && selection.floorId && selection.roomId);

  const handleApply = async () => {
    setConfirmOpen(false);
    const targetId = selection.areaId || selection.roomId || selection.floorId || selection.buildingId;
    if (!targetId || selectedIds.size === 0) return;

    const selectedRows = assetRows.filter((r) => selectedIds.has(r.id));
    const rawVariants = Array.from(
      new Set(selectedRows.map((r) => r.legacyLocationLabel).filter((label) => label !== "Tanpa Lokasi"))
    );

    setApplying(true);
    setError("");
    setApplyProgress({ done: 0, total: selectedRows.length });
    try {
      // Simpan alias lokasi lama ke node Master Lokasi paling spesifik yang
      // dipilih — arrayUnion supaya tidak duplicate kalau alias yang sama
      // sudah ada. Ini yang membuat import berikutnya dengan lokasi yang
      // sama otomatis dikenali tanpa perlu mapping ulang.
      if (rawVariants.length > 0) {
        await updateDoc(doc(db, "asset_locations", targetId), {
          legacyAliases: arrayUnion(...rawVariants),
          updatedAt: serverTimestamp(),
        });
      }

      const locationText = buildFullPath(selection);
      const areaPic = resolveAreaPic(locations, {
        buildingId: selection.buildingId,
        floorId: selection.floorId,
        roomId: selection.roomId,
        areaId: selection.areaId,
      });
      const currentUserUid = firebaseUser?.uid || assetUser?.uid || "";
      const currentUserName = assetUser?.name || firebaseUser?.email || "";

      let done = 0;
      for (const row of selectedRows) {
        try {
          // HANYA field lokasi terstruktur — locationRaw/location (histori
          // lokasi lama) TIDAK disentuh, dan TIDAK PERNAH menyentuh
          // No./Kode/Nama Aset, Qty, Tanggal Perolehan, Harga, Invoice,
          // Foto, QR, Finance, Maintenance, Peminjaman.
          await updateDoc(doc(db, "assets", row.id), {
            buildingId: selection.buildingId || null,
            buildingName: selection.buildingName || "",
            floorId: selection.floorId || null,
            floor: selection.floorName || "",
            roomId: selection.roomId || null,
            roomName: selection.roomName || "",
            areaId: selection.areaId || null,
            areaName: selection.areaName || "",
            locationId: targetId,
            locationText,
            location: locationText,
            areaPicUid: areaPic?.uid || null,
            areaPicName: areaPic?.name || null,
            areaPicEmail: areaPic?.email || null,
            areaPicLocationId: areaPic?.locationId || null,
            areaPicLocationName: areaPic?.locationName || null,
            updatedAt: serverTimestamp(),
          });
          await writeAssetLog({
            assetId: row.id,
            assetName: row.assetName,
            assetCode: row.assetCode,
            action: "SYNC_LEGACY_LOCATION",
            userUid: currentUserUid,
            userName: currentUserName,
            editedByRole: role || "",
            detail: `Lokasi disinkronkan dari "${row.legacyLocationLabel}" menjadi "${locationText}"`,
          });
        } catch (err) {
          console.error("[Sync Lokasi Asset] gagal update aset", { assetId: row.id, err });
        }
        done += 1;
        setApplyProgress({ done, total: selectedRows.length });
      }

      setResultMessage(`${selectedRows.length} asset berhasil disinkronkan ke lokasi "${locationText}".`);
      setSelectedIds(new Set());
      setSelection(EMPTY_LOCATION_SELECTION);
    } catch (err) {
      console.error("[Sync Lokasi Asset] gagal menerapkan mapping", err);
      setError("Gagal menyinkronkan lokasi. Coba lagi.");
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={handleClose} />
      <div className="relative bg-white rounded-2xl shadow-lg border border-slate-200 w-full max-w-3xl max-h-[90vh] overflow-y-auto p-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-lg font-semibold text-slate-900">Sinkronkan Lokasi Asset Lama</h2>
          <button
            type="button"
            onClick={handleClose}
            disabled={applying}
            className="text-slate-400 hover:text-slate-700 cursor-pointer rounded-lg p-1 hover:bg-slate-100 disabled:opacity-50"
          >
            <X size={18} />
          </button>
        </div>
        <p className="text-xs text-slate-500 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 mb-4">
          Aset di bawah ini belum punya lokasi dari Master Lokasi (masih pakai teks lokasi lama atau kosong).
          Klik satu kelompok lokasi lama untuk langsung memilih SEMUA asetnya, tentukan Master Lokasi sekali,
          lalu terapkan ke seluruh kelompok sekaligus.
        </p>

        {groups.length === 0 ? (
          <EmptyState icon={MapPin} title="Semua asset sudah punya lokasi master" />
        ) : (
          <>
            <div className="mb-4">
              <p className="mb-2 text-xs font-medium text-slate-500">Kelompok Lokasi Lama — klik untuk bulk-select</p>
              <div className="flex flex-wrap gap-2">
                {groups.map((g) => (
                  <button
                    key={g.key}
                    type="button"
                    onClick={() => handleClickGroup(g.key, g.assetIds)}
                    className={`inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-medium cursor-pointer ${
                      locationFilterKey === g.key
                        ? "border-slate-900 bg-slate-900 text-white"
                        : "border-slate-200 text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    {g.displayLabel} • {g.assetCount} Asset
                    {g.mappedNode && (
                      <CheckCircle2 size={13} className={locationFilterKey === g.key ? "text-emerald-300" : "text-emerald-500"} />
                    )}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 mb-3">
              <label className="text-xs font-medium text-slate-500">Lokasi Lama</label>
              <select
                value={locationFilterKey}
                onChange={(e) => {
                  setLocationFilterKey(e.target.value);
                  setError("");
                  setResultMessage("");
                }}
                className="input !w-auto text-sm"
              >
                <option value="">Semua Lokasi Lama ({assetRows.length})</option>
                {groups.map((g) => (
                  <option key={g.key} value={g.key}>
                    {g.displayLabel} ({g.assetCount})
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={handleSelectAllFiltered}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Pilih Semua Hasil Filter
              </button>
              <button
                type="button"
                onClick={handleClearSelection}
                className="rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                Batalkan Pilihan
              </button>
              <span className="ml-auto text-sm font-medium text-slate-700">{selectedIds.size} asset dipilih</span>
            </div>

            <div className="border border-slate-200 rounded-xl overflow-hidden max-h-56 overflow-y-auto mb-4">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-slate-50">
                  <tr className="text-left text-slate-500 border-b border-slate-200">
                    <th className="px-3 py-2 w-8"></th>
                    <th className="px-3 py-2 font-semibold">Asset</th>
                    <th className="px-3 py-2 font-semibold">Kode</th>
                    <th className="px-3 py-2 font-semibold">Lokasi Lama</th>
                    <th className="px-3 py-2 font-semibold">Sumber</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map((row) => (
                    <tr key={row.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50/70">
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={selectedIds.has(row.id)}
                          onChange={() => toggleRow(row.id)}
                          className="cursor-pointer"
                        />
                      </td>
                      <td className="px-3 py-2 font-medium text-slate-800">{row.assetName || "-"}</td>
                      <td className="px-3 py-2 text-slate-400">{row.assetCode || "-"}</td>
                      <td className="px-3 py-2 text-slate-600">
                        {row.legacyLocationKey === NO_LOCATION_KEY ? (
                          <span className="text-slate-400">{row.legacyLocationLabel}</span>
                        ) : (
                          row.legacyLocationLabel
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-500">{SOURCE_LABEL[row.source]}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <label className="block text-xs font-medium text-slate-500 mb-1.5">
              Petakan {selectedIds.size} Asset{selectedGroupLabel ? ` ${selectedGroupLabel}` : ""} ke Master Lokasi
            </label>
            <LocationCascadeFields locations={locations} value={selection} onChange={setSelection} />

            {error && (
              <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-xl px-3 py-2 mt-3">{error}</p>
            )}
            {resultMessage && !error && (
              <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 mt-3">
                {resultMessage}
              </p>
            )}
            {applying && (
              <p className="text-xs text-slate-500 mt-2">
                Menyinkronkan {applyProgress.done} / {applyProgress.total} aset...
              </p>
            )}

            <button
              type="button"
              onClick={() => {
                if (selectedIds.size === 0) {
                  setError("Pilih minimal 1 asset (klik salah satu kelompok lokasi lama di atas).");
                  return;
                }
                if (!selectionComplete) {
                  setError("Lengkapi Gedung, Lantai, dan Ruangan untuk di-assign ke asset terpilih.");
                  return;
                }
                setError("");
                setConfirmOpen(true);
              }}
              disabled={applying}
              className="w-full mt-4 inline-flex items-center justify-center gap-1.5 rounded-xl bg-gradient-to-r from-blue-600 to-teal-500 text-white px-4 py-2.5 text-sm font-medium cursor-pointer hover:brightness-105 shadow-md shadow-blue-900/20 disabled:opacity-60"
            >
              <MapPin size={15} />
              {applying
                ? "Menyinkronkan..."
                : `Terapkan ke ${selectedIds.size} Asset${selectedGroupLabel ? ` ${selectedGroupLabel}` : ""}`}
            </button>
          </>
        )}
      </div>

      <ConfirmModal
        open={confirmOpen}
        title="Terapkan Mapping Lokasi?"
        description={`Terapkan lokasi ini ke ${selectedIds.size} asset${
          selectedGroupLabel ? ` dengan lokasi lama "${selectedGroupLabel}"` : ""
        }?`}
        confirmLabel={`Ya, Terapkan ${selectedIds.size} Asset`}
        onConfirm={handleApply}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}
