"use client";

import type { ComponentType, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { collection, doc, onSnapshot, serverTimestamp, updateDoc } from "firebase/firestore";
import {
  Boxes,
  Building2,
  DoorOpen,
  Layers3,
  MapPin,
  MapPinned,
  Pencil,
  Plus,
  Power,
  PowerOff,
  RefreshCw,
  Search,
  Ticket,
  Wrench,
} from "lucide-react";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { Asset, AssetIssueTicket, AssetLocationNode, LocationType, MaintenanceWorkOrder } from "@/lib/types";
import { countAssetsAtLocation, getChildren, LOCATION_TYPE_LABEL } from "@/lib/locations";
import ProtectedLayout from "@/components/ProtectedLayout";
import PageHeader from "@/components/PageHeader";
import EmptyState from "@/components/EmptyState";
import LocationFormModal from "@/components/LocationFormModal";
import SyncAssetLocationModal from "@/components/SyncAssetLocationModal";
import Badge from "@/components/Badge";

type LocationIcon = ComponentType<{ size?: number; className?: string }>;

const LOCATION_TYPE_META: Record<
  LocationType,
  { icon: LocationIcon; iconClass: string; iconBgClass: string }
> = {
  building: {
    icon: Building2,
    iconClass: "text-blue-600",
    iconBgClass: "bg-blue-50 border-blue-100",
  },
  floor: {
    icon: Layers3,
    iconClass: "text-cyan-600",
    iconBgClass: "bg-cyan-50 border-cyan-100",
  },
  room: {
    icon: DoorOpen,
    iconClass: "text-violet-600",
    iconBgClass: "bg-violet-50 border-violet-100",
  },
  area: {
    icon: MapPinned,
    iconClass: "text-emerald-600",
    iconBgClass: "bg-emerald-50 border-emerald-100",
  },
};

function getNextLocationType(type: LocationType): LocationType | null {
  const childTypeMap: Record<LocationType, LocationType | null> = {
    building: "floor",
    floor: "room",
    room: "area",
    area: null,
  };
  return childTypeMap[type];
}

function locationMatchesSearch(node: AssetLocationNode, search: string) {
  const query = search.trim().toLowerCase();
  if (!query) return true;
  return [
    node.locationLabel,
    node.fullPath,
    node.buildingCode,
    node.roomFunction,
    node.notes,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(query);
}

export default function LocationsPage() {
  const { role } = useAuth();
  const [locations, setLocations] = useState<AssetLocationNode[]>([]);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [tickets, setTickets] = useState<AssetIssueTicket[]>([]);
  const [workOrders, setWorkOrders] = useState<MaintenanceWorkOrder[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedBuildingId, setSelectedBuildingId] = useState<string | null>(null);
  const [selectedFloorId, setSelectedFloorId] = useState<string | null>(null);
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [buildingSearch, setBuildingSearch] = useState("");
  const [floorSearch, setFloorSearch] = useState("");
  const [spaceSearch, setSpaceSearch] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [formDefaultType, setFormDefaultType] = useState<LocationType>("building");
  const [formDefaultParentId, setFormDefaultParentId] = useState<string | null>(null);
  const [editingNode, setEditingNode] = useState<AssetLocationNode | null>(null);
  const [syncOpen, setSyncOpen] = useState(false);

  const canManage = role === "super_admin" || role === "asset_admin";

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "asset_locations"), (snap) => {
      setLocations(snap.docs.map((d) => ({ id: d.id, ...d.data() } as AssetLocationNode)));
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "assets"), (snap) => {
      setAssets(snap.docs.map((d) => ({ id: d.id, ...d.data() } as Asset)));
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "asset_issue_tickets"), (snap) => {
      setTickets(snap.docs.map((d) => ({ id: d.id, ...d.data() } as AssetIssueTicket)));
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, "asset_maintenance_work_orders"), (snap) => {
      setWorkOrders(snap.docs.map((d) => ({ id: d.id, ...d.data() } as MaintenanceWorkOrder)));
    });
    return () => unsub();
  }, []);

  const selectedNode = locations.find((n) => n.id === selectedId) || null;
  const selectedBuilding = locations.find((n) => n.id === selectedBuildingId) || null;
  const selectedFloor = locations.find((n) => n.id === selectedFloorId) || null;
  const selectedRoom = locations.find((n) => n.id === selectedRoomId) || null;
  const selectedChildType = selectedNode ? getNextLocationType(selectedNode.locationType) : null;

  const summary = {
    building: locations.filter((n) => n.locationType === "building").length,
    floor: locations.filter((n) => n.locationType === "floor").length,
    room: locations.filter((n) => n.locationType === "room").length,
    area: locations.filter((n) => n.locationType === "area").length,
  };

  const allBuildings = useMemo(
    () => getChildren(locations, null).filter((n) => n.locationType === "building"),
    [locations]
  );

  const buildings = useMemo(
    () => allBuildings.filter((node) => locationMatchesSearch(node, buildingSearch)),
    [allBuildings, buildingSearch]
  );

  const allFloors = useMemo(
    () =>
      selectedBuildingId
        ? getChildren(locations, selectedBuildingId).filter((n) => n.locationType === "floor")
        : [],
    [locations, selectedBuildingId]
  );

  const floors = useMemo(
    () => allFloors.filter((node) => locationMatchesSearch(node, floorSearch)),
    [allFloors, floorSearch]
  );

  const allRooms = useMemo(
    () =>
      selectedFloorId
        ? getChildren(locations, selectedFloorId).filter((n) => n.locationType === "room")
        : [],
    [locations, selectedFloorId]
  );

  const rooms = useMemo(
    () =>
      allRooms.filter((room) => {
        if (locationMatchesSearch(room, spaceSearch)) return true;
        return getChildren(locations, room.id).some((area) => locationMatchesSearch(area, spaceSearch));
      }),
    [allRooms, locations, spaceSearch]
  );

  const allAreas = useMemo(
    () =>
      selectedRoomId
        ? getChildren(locations, selectedRoomId).filter((n) => n.locationType === "area")
        : [],
    [locations, selectedRoomId]
  );

  const areas = useMemo(
    () => allAreas.filter((node) => locationMatchesSearch(node, spaceSearch)),
    [allAreas, spaceSearch]
  );

  const panelSpaceCount = rooms.length + (selectedRoom ? areas.length : 0);

  const openAddForm = (type: LocationType, parentId: string | null) => {
    setEditingNode(null);
    setFormDefaultType(type);
    setFormDefaultParentId(parentId);
    setFormOpen(true);
  };

  const openAddSubLocation = (node: AssetLocationNode) => {
    const childType = getNextLocationType(node.locationType);
    if (!childType) return;
    openAddForm(childType, node.id);
  };

  const openEditForm = (node: AssetLocationNode) => {
    setEditingNode(node);
    setFormOpen(true);
  };

  const handleToggleStatus = async (node: AssetLocationNode) => {
    await updateDoc(doc(db, "asset_locations", node.id), {
      status: node.status === "active" ? "inactive" : "active",
      updatedAt: serverTimestamp(),
    });
  };

  const handleSelectBuilding = (node: AssetLocationNode) => {
    setSelectedBuildingId(node.id);
    setSelectedFloorId(null);
    setSelectedRoomId(null);
    setSelectedId(node.id);
  };

  const handleSelectFloor = (node: AssetLocationNode) => {
    setSelectedFloorId(node.id);
    setSelectedRoomId(null);
    setSelectedId(node.id);
  };

  const handleSelectRoom = (node: AssetLocationNode) => {
    setSelectedRoomId(node.id);
    setSelectedId(node.id);
  };

  const handleSelectArea = (node: AssetLocationNode) => {
    setSelectedId(node.id);
  };

  const nodeAssetCount = (node: AssetLocationNode) => countAssetsAtLocation(assets, node);
  const nodeTicketCount = (node: AssetLocationNode) => {
    const ids = new Set(assets.filter((a) => matchesNodeAsset(a, node)).map((a) => a.id));
    return tickets.filter((t) => ids.has(t.assetId)).length;
  };
  const nodeActiveWorkOrders = (node: AssetLocationNode) => {
    const ids = new Set(assets.filter((a) => matchesNodeAsset(a, node)).map((a) => a.id));
    return workOrders.filter(
      (w) =>
        w.assetIds?.some((id) => ids.has(id)) &&
        [
          "created",
          "accepted",
          "scheduled_by_it",
          "assigned",
          "in_progress",
          "partially_completed",
          "report_submitted",
        ].includes(w.status)
    ).length;
  };

  function matchesNodeAsset(a: Asset, node: AssetLocationNode) {
    switch (node.locationType) {
      case "building":
        return a.buildingId === node.id;
      case "floor":
        return a.floorId === node.id;
      case "room":
        return a.roomId === node.id;
      case "area":
        return a.areaId === node.id;
    }
  }

  const childSummary = (node: AssetLocationNode) => {
    const childType = getNextLocationType(node.locationType);
    if (!childType) return null;
    const count = getChildren(locations, node.id).filter((child) => child.locationType === childType).length;
    return `${count} ${LOCATION_TYPE_LABEL[childType].toLowerCase()}`;
  };

  return (
    <ProtectedLayout>
      <PageHeader
        title="Master Lokasi"
        subtitle="Kelola struktur gedung, lantai, ruangan, dan area asset."
        actions={
          canManage && (
            <>
              <button
                type="button"
                onClick={() => openAddForm("building", null)}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-blue-900/20 transition-all hover:bg-blue-700 hover:shadow-md"
              >
                <Plus size={16} />
                Tambah Gedung
              </button>
              <button
                type="button"
                onClick={() => setSyncOpen(true)}
                className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 shadow-sm transition-all hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
              >
                <RefreshCw size={15} />
                Sinkronkan Lokasi Lama
              </button>
            </>
          )
        }
      />

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <SummaryCard
          label="Total Gedung"
          value={summary.building}
          icon={Building2}
          colorClass="border-blue-100 bg-blue-50 text-blue-600"
        />
        <SummaryCard
          label="Total Lantai"
          value={summary.floor}
          icon={Layers3}
          colorClass="border-cyan-100 bg-cyan-50 text-cyan-600"
        />
        <SummaryCard
          label="Total Ruangan"
          value={summary.room}
          icon={DoorOpen}
          colorClass="border-violet-100 bg-violet-50 text-violet-600"
        />
        <SummaryCard
          label="Total Area"
          value={summary.area}
          icon={MapPinned}
          colorClass="border-emerald-100 bg-emerald-50 text-emerald-600"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
        <LocationPanel
          title="Gedung"
          subtitle="Level utama"
          count={buildings.length}
          searchValue={buildingSearch}
          onSearchChange={setBuildingSearch}
          searchPlaceholder="Cari gedung..."
          addLabel="Tambah"
          onAdd={canManage ? () => openAddForm("building", null) : undefined}
        >
          {allBuildings.length === 0 ? (
            <PanelEmpty
              icon={Building2}
              title="Belum ada gedung"
              description="Mulai dengan menambahkan gedung pertama."
            />
          ) : buildings.length === 0 ? (
            <PanelEmpty icon={Search} title="Gedung tidak ditemukan" description="Coba kata kunci lain." />
          ) : (
            buildings.map((node) => (
              <LocationListItem
                key={node.id}
                node={node}
                selected={selectedBuildingId === node.id}
                sublabel={childSummary(node) || node.buildingCode || "Gedung"}
                onSelect={() => handleSelectBuilding(node)}
              />
            ))
          )}
        </LocationPanel>

        <LocationPanel
          title="Lantai"
          subtitle={selectedBuilding ? selectedBuilding.locationLabel : "Pilih gedung"}
          count={floors.length}
          searchValue={floorSearch}
          onSearchChange={setFloorSearch}
          searchPlaceholder="Cari lantai..."
          addLabel="Tambah"
          addDisabled={!selectedBuilding}
          onAdd={canManage && selectedBuilding ? () => openAddForm("floor", selectedBuilding.id) : undefined}
        >
          {!selectedBuilding ? (
            <PanelEmpty
              icon={Layers3}
              title="Pilih gedung"
              description="Lantai akan muncul setelah gedung dipilih."
            />
          ) : allFloors.length === 0 ? (
            <PanelEmpty icon={Layers3} title="Belum ada lantai" description="Tambahkan lantai untuk gedung ini." />
          ) : floors.length === 0 ? (
            <PanelEmpty icon={Search} title="Lantai tidak ditemukan" description="Coba kata kunci lain." />
          ) : (
            floors.map((node) => (
              <LocationListItem
                key={node.id}
                node={node}
                selected={selectedFloorId === node.id}
                sublabel={childSummary(node) || selectedBuilding.locationLabel}
                onSelect={() => handleSelectFloor(node)}
              />
            ))
          )}
        </LocationPanel>

        <LocationPanel
          title="Ruangan / Area"
          subtitle={selectedFloor ? selectedFloor.locationLabel : "Pilih lantai"}
          count={panelSpaceCount}
          searchValue={spaceSearch}
          onSearchChange={setSpaceSearch}
          searchPlaceholder="Cari ruangan atau area..."
          addLabel="Ruangan"
          addDisabled={!selectedFloor}
          onAdd={canManage && selectedFloor ? () => openAddForm("room", selectedFloor.id) : undefined}
          extraAction={
            canManage && selectedRoom ? (
              <button
                type="button"
                onClick={() => openAddForm("area", selectedRoom.id)}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-emerald-100 bg-emerald-50 px-2.5 text-xs font-semibold text-emerald-700 transition-colors hover:bg-emerald-100"
              >
                <Plus size={13} />
                Area
              </button>
            ) : null
          }
        >
          {!selectedFloor ? (
            <PanelEmpty
              icon={DoorOpen}
              title="Pilih lantai"
              description="Ruangan akan muncul setelah lantai dipilih."
            />
          ) : (
            <div className="space-y-4">
              <ListSectionTitle label="Ruangan" count={rooms.length} />
              {allRooms.length === 0 ? (
                <CompactEmpty title="Belum ada ruangan di lantai ini." />
              ) : rooms.length === 0 ? (
                <CompactEmpty title="Ruangan tidak ditemukan." />
              ) : (
                <div className="space-y-2">
                  {rooms.map((node) => (
                    <LocationListItem
                      key={node.id}
                      node={node}
                      selected={selectedId === node.id}
                      sublabel={childSummary(node) || node.roomFunction || selectedFloor.locationLabel}
                      onSelect={() => handleSelectRoom(node)}
                    />
                  ))}
                </div>
              )}

              <div className="border-t border-slate-100 pt-4">
                <ListSectionTitle label="Area" count={selectedRoom ? areas.length : 0} />
                {!selectedRoom ? (
                  <CompactEmpty title="Pilih ruangan untuk melihat area." />
                ) : allAreas.length === 0 ? (
                  <CompactEmpty title="Belum ada area di ruangan ini." />
                ) : areas.length === 0 ? (
                  <CompactEmpty title="Area tidak ditemukan." />
                ) : (
                  <div className="space-y-2">
                    {areas.map((node) => (
                      <LocationListItem
                        key={node.id}
                        node={node}
                        selected={selectedId === node.id}
                        sublabel={selectedRoom.locationLabel}
                        onSelect={() => handleSelectArea(node)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </LocationPanel>

        <DetailPanel
          selectedNode={selectedNode}
          selectedChildType={selectedChildType}
          canManage={canManage}
          assetCount={selectedNode ? nodeAssetCount(selectedNode) : 0}
          ticketCount={selectedNode ? nodeTicketCount(selectedNode) : 0}
          maintenanceCount={selectedNode ? nodeActiveWorkOrders(selectedNode) : 0}
          onEdit={() => selectedNode && openEditForm(selectedNode)}
          onAddSub={() => selectedNode && openAddSubLocation(selectedNode)}
          onToggleStatus={() => selectedNode && handleToggleStatus(selectedNode)}
        />
      </div>

      <LocationFormModal
        open={formOpen}
        onClose={() => setFormOpen(false)}
        locations={locations}
        defaultType={formDefaultType}
        defaultParentId={formDefaultParentId}
        editingNode={editingNode}
      />

      <SyncAssetLocationModal
        open={syncOpen}
        onClose={() => setSyncOpen(false)}
        assets={assets}
        locations={locations}
      />
    </ProtectedLayout>
  );
}

function LocationPanel({
  title,
  subtitle,
  count,
  searchValue,
  onSearchChange,
  searchPlaceholder,
  addLabel,
  addDisabled = false,
  onAdd,
  extraAction,
  children,
}: {
  title: string;
  subtitle: string;
  count: number;
  searchValue: string;
  onSearchChange: (value: string) => void;
  searchPlaceholder: string;
  addLabel: string;
  addDisabled?: boolean;
  onAdd?: () => void;
  extraAction?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex min-h-[420px] flex-col rounded-2xl border border-slate-200 bg-white shadow-sm md:h-[640px]">
      <div className="border-b border-slate-100 p-4">
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold text-slate-950">{title}</h2>
              <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-500">
                {count}
              </span>
            </div>
            <p className="mt-1 truncate text-xs font-medium text-slate-500">{subtitle}</p>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {extraAction}
            {onAdd && (
              <button
                type="button"
                onClick={onAdd}
                disabled={addDisabled}
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-blue-100 bg-blue-50 px-2.5 text-xs font-semibold text-blue-700 transition-colors hover:bg-blue-100 disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-400"
              >
                <Plus size={13} />
                {addLabel}
              </button>
            )}
          </div>
        </div>
        <div className="relative">
          <Search
            size={15}
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
          />
          <input
            value={searchValue}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder={searchPlaceholder}
            className="input min-h-10 rounded-xl py-2 pl-9 text-sm"
          />
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">{children}</div>
    </section>
  );
}

function LocationListItem({
  node,
  selected,
  sublabel,
  onSelect,
}: {
  node: AssetLocationNode;
  selected: boolean;
  sublabel: string;
  onSelect: () => void;
}) {
  const meta = LOCATION_TYPE_META[node.locationType];
  const Icon = meta.icon;
  const inactive = node.status === "inactive";

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`w-full rounded-2xl border p-3 text-left transition-all ${
        selected
          ? "border-blue-200 bg-blue-50 shadow-sm shadow-blue-900/5"
          : "border-slate-100 bg-white hover:border-slate-200 hover:bg-slate-50"
      }`}
    >
      <div className="flex items-start gap-3">
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${meta.iconBgClass}`}
        >
          <Icon size={18} className={meta.iconClass} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center justify-between gap-2">
            <span
              className={`truncate text-sm font-semibold ${inactive ? "text-slate-400" : "text-slate-900"}`}
            >
              {node.locationLabel}
            </span>
            <StatusPill status={node.status} />
          </span>
          <span className="mt-1 block truncate text-xs font-medium text-slate-500">{sublabel}</span>
        </span>
      </div>
    </button>
  );
}

function DetailPanel({
  selectedNode,
  selectedChildType,
  canManage,
  assetCount,
  ticketCount,
  maintenanceCount,
  onEdit,
  onAddSub,
  onToggleStatus,
}: {
  selectedNode: AssetLocationNode | null;
  selectedChildType: LocationType | null;
  canManage: boolean;
  assetCount: number;
  ticketCount: number;
  maintenanceCount: number;
  onEdit: () => void;
  onAddSub: () => void;
  onToggleStatus: () => void;
}) {
  return (
    <aside className="flex min-h-[420px] flex-col rounded-2xl border border-slate-200 bg-white shadow-sm md:h-[640px]">
      <div className="border-b border-slate-100 p-4">
        <h2 className="text-base font-semibold text-slate-950">Detail Lokasi</h2>
        <p className="mt-1 text-xs font-medium text-slate-500">Ringkasan lokasi terpilih</p>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {!selectedNode ? (
          <EmptyState
            icon={MapPin}
            title="Pilih lokasi dari daftar untuk melihat detailnya."
          />
        ) : (
          <div className="space-y-5">
            <div className="flex items-start gap-3">
              {(() => {
                const meta = LOCATION_TYPE_META[selectedNode.locationType];
                const Icon = meta.icon;
                return (
                  <div
                    className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl border ${meta.iconBgClass}`}
                  >
                    <Icon size={22} className={meta.iconClass} />
                  </div>
                );
              })()}
              <div className="min-w-0 flex-1">
                <h3 className="text-xl font-semibold leading-tight text-slate-950">
                  {selectedNode.locationLabel}
                </h3>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Badge
                    label={LOCATION_TYPE_LABEL[selectedNode.locationType]}
                    colorClass="border-blue-100 bg-blue-50 text-blue-700"
                  />
                  <Badge
                    label={selectedNode.status === "active" ? "Aktif" : "Nonaktif"}
                    colorClass={
                      selectedNode.status === "active"
                        ? "border-emerald-100 bg-emerald-50 text-emerald-700"
                        : "border-red-100 bg-red-50 text-red-500"
                    }
                  />
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
              <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase text-slate-400">
                <MapPinned size={14} />
                Full Path
              </div>
              <p className="text-sm font-medium leading-6 text-slate-700">
                {selectedNode.fullPath || selectedNode.locationLabel}
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1 2xl:grid-cols-3">
              <MiniStat icon={Boxes} label="Jumlah Asset" value={assetCount} />
              <MiniStat icon={Ticket} label="Ticket Kendala" value={ticketCount} />
              <MiniStat icon={Wrench} label="Maintenance Aktif" value={maintenanceCount} />
            </div>

            {selectedNode.notes && (
              <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3">
                <p className="text-xs font-semibold uppercase text-slate-400">Catatan</p>
                <p className="mt-1 text-sm leading-6 text-slate-700">{selectedNode.notes}</p>
              </div>
            )}

            {canManage && (
              <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
                <button
                  type="button"
                  onClick={onEdit}
                  className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-50"
                >
                  <Pencil size={15} />
                  Edit
                </button>
                <button
                  type="button"
                  onClick={onAddSub}
                  disabled={!selectedChildType}
                  className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-blue-100 bg-blue-50 px-3.5 py-2 text-sm font-semibold text-blue-700 transition-colors hover:bg-blue-100 disabled:border-slate-200 disabled:bg-slate-50 disabled:text-slate-400"
                >
                  <Plus size={15} />
                  Tambah Sub Lokasi
                </button>
                <button
                  type="button"
                  onClick={onToggleStatus}
                  className={`inline-flex min-h-10 items-center gap-2 rounded-xl border px-3.5 py-2 text-sm font-semibold transition-colors ${
                    selectedNode.status === "active"
                      ? "border-red-100 bg-red-50 text-red-600 hover:bg-red-100"
                      : "border-emerald-100 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                  }`}
                >
                  {selectedNode.status === "active" ? <PowerOff size={15} /> : <Power size={15} />}
                  {selectedNode.status === "active" ? "Nonaktifkan" : "Aktifkan"}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

function ListSectionTitle({ label, count }: { label: string; count: number }) {
  return (
    <div className="mb-2 flex items-center justify-between px-1">
      <p className="text-xs font-semibold uppercase text-slate-400">{label}</p>
      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-500">
        {count}
      </span>
    </div>
  );
}

function PanelEmpty({
  icon: Icon,
  title,
  description,
}: {
  icon: LocationIcon;
  title: string;
  description: string;
}) {
  return (
    <div className="flex h-full min-h-[280px] flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 px-4 text-center">
      <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-slate-400 shadow-sm">
        <Icon size={24} />
      </div>
      <p className="text-sm font-semibold text-slate-800">{title}</p>
      <p className="mt-1 max-w-48 text-sm leading-5 text-slate-500">{description}</p>
    </div>
  );
}

function CompactEmpty({ title }: { title: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center text-sm font-medium text-slate-500">
      {title}
    </div>
  );
}

function StatusPill({ status }: { status: "active" | "inactive" }) {
  return (
    <span
      className={`shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${
        status === "active"
          ? "border-emerald-100 bg-emerald-50 text-emerald-700"
          : "border-red-100 bg-red-50 text-red-500"
      }`}
    >
      {status === "active" ? "Aktif" : "Nonaktif"}
    </span>
  );
}

function SummaryCard({
  label,
  value,
  icon: Icon,
  colorClass,
}: {
  label: string;
  value: number;
  icon: LocationIcon;
  colorClass: string;
}) {
  return (
    <div className="group rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition-all hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div className={`flex h-11 w-11 items-center justify-center rounded-xl border ${colorClass}`}>
          <Icon size={20} />
        </div>
        <span className="rounded-full bg-slate-50 px-2.5 py-1 text-[11px] font-semibold text-slate-400">
          Total
        </span>
      </div>
      <p className="text-3xl font-semibold text-slate-950">{value}</p>
      <p className="mt-1 text-sm font-medium text-slate-500">{label}</p>
    </div>
  );
}

function MiniStat({ icon: Icon, label, value }: { icon: LocationIcon; label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 px-3 py-3">
      <div className="mb-2 flex h-8 w-8 items-center justify-center rounded-lg bg-white text-slate-500 shadow-sm">
        <Icon size={16} />
      </div>
      <p className="text-2xl font-semibold text-slate-950">{value}</p>
      <p className="mt-1 text-xs font-medium leading-4 text-slate-500">{label}</p>
    </div>
  );
}
