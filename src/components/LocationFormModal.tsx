"use client";

import { ComponentType, ReactNode, useEffect, useState } from "react";
import { addDoc, collection, doc, serverTimestamp, updateDoc } from "firebase/firestore";
import { AlertCircle, Building2, DoorOpen, Layers3, MapPinned, Save, X } from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { AssetLocationNode, LocationType } from "@/lib/types";
import { buildFullPath, getChildren, LOCATION_TYPE_LABEL } from "@/lib/locations";
import SearchableSelect, { SearchableSelectItem } from "@/components/SearchableSelect";

const TYPE_ORDER: LocationType[] = ["building", "floor", "room", "area"];
type LocationIcon = ComponentType<{ size?: number; className?: string }>;

const TYPE_META: Record<
  LocationType,
  { icon: LocationIcon; iconClass: string; iconBgClass: string; hint: string }
> = {
  building: {
    icon: Building2,
    iconClass: "text-blue-600",
    iconBgClass: "bg-blue-50 border-blue-100",
    hint: "Level utama",
  },
  floor: {
    icon: Layers3,
    iconClass: "text-cyan-600",
    iconBgClass: "bg-cyan-50 border-cyan-100",
    hint: "Di dalam gedung",
  },
  room: {
    icon: DoorOpen,
    iconClass: "text-violet-600",
    iconBgClass: "bg-violet-50 border-violet-100",
    hint: "Di dalam lantai",
  },
  area: {
    icon: MapPinned,
    iconClass: "text-emerald-600",
    iconBgClass: "bg-emerald-50 border-emerald-100",
    hint: "Di dalam ruangan",
  },
};

export default function LocationFormModal({
  open,
  onClose,
  locations,
  defaultType = "building",
  defaultParentId = null,
  editingNode,
}: {
  open: boolean;
  onClose: () => void;
  locations: AssetLocationNode[];
  defaultType?: LocationType;
  defaultParentId?: string | null;
  editingNode?: AssetLocationNode | null;
}) {
  const { assetUser } = useAuth();
  const [locationType, setLocationType] = useState<LocationType>(defaultType);
  const [buildingId, setBuildingId] = useState("");
  const [floorId, setFloorId] = useState("");
  const [roomId, setRoomId] = useState("");
  const [name, setName] = useState("");
  const [buildingCode, setBuildingCode] = useState("");
  const [roomFunction, setRoomFunction] = useState("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => {
      if (editingNode) {
        setLocationType(editingNode.locationType);
        setName(
          editingNode.locationType === "building"
            ? editingNode.buildingName || ""
            : editingNode.locationType === "floor"
            ? editingNode.floorName || ""
            : editingNode.locationType === "room"
            ? editingNode.roomName || ""
            : editingNode.areaName || ""
        );
        setBuildingCode(editingNode.buildingCode || "");
        setRoomFunction(editingNode.roomFunction || "");
        setNotes(editingNode.notes || "");
        const parentChain = editingNode.parentPath;
        setBuildingId(parentChain[0] || "");
        setFloorId(parentChain[1] || "");
        setRoomId(parentChain[2] || "");
      } else {
        setLocationType(defaultType);
        setName("");
        setBuildingCode("");
        setRoomFunction("");
        setNotes("");
        if (defaultType === "building") {
          setBuildingId("");
          setFloorId("");
          setRoomId("");
        } else {
          const parentNode = locations.find((n) => n.id === defaultParentId);
          if (parentNode) {
            if (parentNode.locationType === "building") setBuildingId(parentNode.id);
            if (parentNode.locationType === "floor") {
              setBuildingId(parentNode.parentPath[0] || "");
              setFloorId(parentNode.id);
            }
            if (parentNode.locationType === "room") {
              setBuildingId(parentNode.parentPath[0] || "");
              setFloorId(parentNode.parentPath[1] || "");
              setRoomId(parentNode.id);
            }
          }
        }
      }
      setError("");
    });
  }, [open, editingNode, defaultType, defaultParentId, locations]);

  if (!open) return null;

  const buildingItems: SearchableSelectItem[] = getChildren(locations, null)
    .filter((n) => n.locationType === "building" && n.status === "active")
    .map((n) => ({ id: n.id, label: n.buildingName || "", searchText: n.buildingName || "" }));

  const floorItems: SearchableSelectItem[] = buildingId
    ? getChildren(locations, buildingId)
        .filter((n) => n.locationType === "floor" && n.status === "active")
        .map((n) => ({ id: n.id, label: n.floorName || "", searchText: n.floorName || "" }))
    : [];

  const roomItems: SearchableSelectItem[] = floorId
    ? getChildren(locations, floorId)
        .filter((n) => n.locationType === "room" && n.status === "active")
        .map((n) => ({ id: n.id, label: n.roomName || "", searchText: n.roomName || "" }))
    : [];

  const handleClose = () => {
    onClose();
  };

  const validate = () => {
    if (!name.trim()) return `Nama ${LOCATION_TYPE_LABEL[locationType]} wajib diisi.`;
    if (locationType !== "building" && !buildingId) return "Gedung wajib dipilih.";
    if ((locationType === "room" || locationType === "area") && !floorId) return "Lantai wajib dipilih.";
    if (locationType === "area" && !roomId) return "Ruangan wajib dipilih.";
    return "";
  };

  const handleSubmit = async () => {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const buildingNode = locations.find((n) => n.id === buildingId);
      const floorNode = locations.find((n) => n.id === floorId);
      const roomNode = locations.find((n) => n.id === roomId);

      let parentId: string | null = null;
      let parentPath: string[] = [];
      if (locationType === "floor") {
        parentId = buildingId;
        parentPath = [buildingId];
      } else if (locationType === "room") {
        parentId = floorId;
        parentPath = [buildingId, floorId];
      } else if (locationType === "area") {
        parentId = roomId;
        parentPath = [buildingId, floorId, roomId];
      }

      const payload: Record<string, unknown> = {
        locationType,
        buildingName: locationType === "building" ? name.trim() : buildingNode?.buildingName || "",
        floorName:
          locationType === "floor" ? name.trim() : locationType === "building" ? "" : floorNode?.floorName || "",
        roomName:
          locationType === "room"
            ? name.trim()
            : locationType === "area"
            ? roomNode?.roomName || ""
            : "",
        areaName: locationType === "area" ? name.trim() : "",
        buildingCode: locationType === "building" ? buildingCode.trim() : "",
        roomFunction: locationType === "room" ? roomFunction.trim() : "",
        notes: notes.trim(),
        parentId,
        parentPath,
        updatedAt: serverTimestamp(),
      };
      payload.locationLabel = name.trim();
      payload.fullPath = buildFullPath({
        buildingName: payload.buildingName as string,
        floorName: payload.floorName as string,
        roomName: payload.roomName as string,
        areaName: payload.areaName as string,
      });

      if (editingNode) {
        await updateDoc(doc(db, "asset_locations", editingNode.id), payload);
      } else {
        await addDoc(collection(db, "asset_locations"), {
          ...payload,
          status: "active",
          createdByUid: assetUser?.uid || "",
          createdByName: assetUser?.name || "",
          createdAt: serverTimestamp(),
        });
      }
      onClose();
    } catch (err) {
      console.error("[Master Lokasi] gagal menyimpan lokasi", err);
      setError("Gagal menyimpan lokasi. Coba lagi.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6">
      <div className="absolute inset-0 bg-slate-950/45 backdrop-blur-sm" onClick={handleClose} />
      <div className="relative flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl shadow-slate-900/15">
        <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-5 sm:px-6">
          <div>
            <p className="text-xs font-semibold uppercase text-blue-600">
              {editingNode ? "Edit data lokasi" : "Tambah lokasi baru"}
            </p>
            <h2 className="mt-1 text-xl font-semibold text-slate-950">
              {editingNode ? `Edit ${LOCATION_TYPE_LABEL[locationType]}` : "Tambah Lokasi"}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Lengkapi informasi lokasi agar struktur AssetView tetap mudah ditelusuri.
            </p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Tutup modal"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <X size={18} />
          </button>
        </div>

        <div className="space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
          {!editingNode && (
            <div>
              <FormLabel>Tipe Lokasi</FormLabel>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {TYPE_ORDER.map((t) => {
                  const meta = TYPE_META[t];
                  const Icon = meta.icon;
                  const active = locationType === t;

                  return (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setLocationType(t)}
                      className={`rounded-2xl border p-3 text-left transition-all ${
                        active
                          ? "border-blue-200 bg-blue-50 shadow-sm shadow-blue-900/5"
                          : "border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50"
                      }`}
                    >
                      <span
                        className={`mb-3 flex h-9 w-9 items-center justify-center rounded-xl border ${meta.iconBgClass}`}
                      >
                        <Icon size={18} className={meta.iconClass} />
                      </span>
                      <span className="block text-sm font-semibold text-slate-900">
                        {LOCATION_TYPE_LABEL[t]}
                      </span>
                      <span className="mt-1 block text-xs font-medium text-slate-400">{meta.hint}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {locationType !== "building" && (
            <div>
              <FormLabel>
                Gedung <span className="text-red-500">*</span>
              </FormLabel>
              <SearchableSelect
                items={buildingItems}
                value={buildingId}
                onChange={(v) => {
                  setBuildingId(v);
                  setFloorId("");
                  setRoomId("");
                }}
                placeholder="Pilih Gedung"
                searchPlaceholder="Cari gedung..."
                emptyText="Belum ada Gedung. Tambahkan Gedung terlebih dahulu."
              />
            </div>
          )}

          {(locationType === "room" || locationType === "area") && (
            <div>
              <FormLabel>
                Lantai <span className="text-red-500">*</span>
              </FormLabel>
              <SearchableSelect
                items={floorItems}
                value={floorId}
                onChange={(v) => {
                  setFloorId(v);
                  setRoomId("");
                }}
                placeholder="Pilih Lantai"
                searchPlaceholder="Cari lantai..."
                emptyText="Belum ada Lantai di gedung ini."
                disabled={!buildingId}
                disabledHint="Pilih Gedung terlebih dahulu"
              />
            </div>
          )}

          {locationType === "area" && (
            <div>
              <FormLabel>
                Ruangan <span className="text-red-500">*</span>
              </FormLabel>
              <SearchableSelect
                items={roomItems}
                value={roomId}
                onChange={setRoomId}
                placeholder="Pilih Ruangan"
                searchPlaceholder="Cari ruangan..."
                emptyText="Belum ada Ruangan di lantai ini."
                disabled={!floorId}
                disabledHint="Pilih Lantai terlebih dahulu"
              />
            </div>
          )}

          <div>
            <FormLabel>
              Nama {LOCATION_TYPE_LABEL[locationType]} <span className="text-red-500">*</span>
            </FormLabel>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`mis. ${
                locationType === "building"
                  ? "Gedung A"
                  : locationType === "floor"
                  ? "Lantai 2"
                  : locationType === "room"
                  ? "Ruang Finance"
                  : "Area Printer"
              }`}
              className="input min-h-12 rounded-xl"
            />
          </div>

          {locationType === "building" && (
            <div>
              <FormLabel>Kode Gedung (opsional)</FormLabel>
              <input
                value={buildingCode}
                onChange={(e) => setBuildingCode(e.target.value)}
                placeholder="mis. GDA"
                className="input min-h-12 rounded-xl"
              />
            </div>
          )}

          {locationType === "room" && (
            <div>
              <FormLabel>Fungsi Ruangan (opsional)</FormLabel>
              <input
                value={roomFunction}
                onChange={(e) => setRoomFunction(e.target.value)}
                placeholder="mis. Ruang Kerja Finance"
                className="input min-h-12 rounded-xl"
              />
            </div>
          )}

          <div>
            <FormLabel>Catatan (opsional)</FormLabel>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={4}
              placeholder="Tambahkan catatan singkat tentang akses, fungsi, atau keterangan lokasi."
              className="input min-h-28 resize-y rounded-xl"
            />
          </div>

          {error && (
            <p className="flex items-start gap-2 rounded-xl border border-red-100 bg-red-50 px-3 py-2.5 text-sm font-medium text-red-600">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              {error}
            </p>
          )}
        </div>

        <div className="flex flex-col-reverse gap-2 border-t border-slate-100 bg-slate-50/70 px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
          <button
            type="button"
            onClick={handleClose}
            disabled={submitting}
            className="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-60"
          >
            Batal
          </button>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-blue-900/20 transition-colors hover:bg-blue-700 disabled:opacity-60"
          >
            <Save size={16} />
            {submitting ? "Menyimpan..." : editingNode ? "Simpan Perubahan" : "Simpan Lokasi"}
          </button>
        </div>
      </div>
    </div>
  );
}

function FormLabel({ children }: { children: ReactNode }) {
  return <label className="mb-2 block text-sm font-semibold text-slate-700">{children}</label>;
}
