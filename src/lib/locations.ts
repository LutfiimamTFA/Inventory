import { Asset, AssetLocationNode, LocationType } from "@/lib/types";
import type { LocationSelection } from "@/components/LocationCascadeFields";

export const LOCATION_TYPE_LABEL: Record<LocationType, string> = {
  building: "Gedung",
  floor: "Lantai",
  room: "Ruangan",
  area: "Area",
};

export function locationLabelOf(node: Pick<AssetLocationNode, "locationType" | "buildingName" | "floorName" | "roomName" | "areaName">) {
  switch (node.locationType) {
    case "building":
      return node.buildingName || "";
    case "floor":
      return node.floorName || "";
    case "room":
      return node.roomName || "";
    case "area":
      return node.areaName || "";
  }
}

export function buildFullPath(
  node: Pick<AssetLocationNode, "buildingName" | "floorName" | "roomName" | "areaName">
) {
  return [node.buildingName, node.floorName, node.roomName, node.areaName]
    .filter(Boolean)
    .join(" / ");
}

// Section D — cari PIC Lokasi yang berlaku untuk sebuah aset dengan cascade
// dari level paling spesifik ke paling umum: Area > Ruangan > Lantai >
// Gedung. Begitu ketemu level yang punya PIC, langsung dipakai — TIDAK
// digabung dari beberapa level sekaligus (area punya PIC sendiri berarti
// area itu yang jadi acuan, bukan PIC lantai/gedungnya).
export function resolveAreaPic(
  locations: AssetLocationNode[],
  ids: { buildingId?: string | null; floorId?: string | null; roomId?: string | null; areaId?: string | null }
): {
  uid: string;
  name: string;
  email: string | null;
  locationId: string;
  locationName: string;
} | null {
  const candidateIds = [ids.areaId, ids.roomId, ids.floorId, ids.buildingId].filter(Boolean) as string[];
  for (const id of candidateIds) {
    const node = locations.find((n) => n.id === id);
    if (node?.picUid) {
      return {
        uid: node.picUid,
        name: node.picName || "",
        email: node.picEmail || null,
        locationId: node.id,
        locationName: node.locationLabel,
      };
    }
  }
  return null;
}

// Section F/G — dipakai form tambah/edit asset PIC Lokasi: dari SATU node
// lokasi tanggung jawab PIC (Gedung/Lantai/Ruangan/Area), rekonstruksi
// LocationSelection lengkap 4-level dengan menelusuri parentPath, supaya
// payload asset tetap konsisten dengan yang dihasilkan dropdown cascade
// biasa — cuma dikunci readonly, bukan struktur data yang berbeda.
export function resolveLocationSelectionForNode(
  locations: AssetLocationNode[],
  nodeId: string
): LocationSelection {
  const empty: LocationSelection = {
    buildingId: "",
    buildingName: "",
    floorId: "",
    floorName: "",
    roomId: "",
    roomName: "",
    areaId: "",
    areaName: "",
  };

  const node = locations.find((n) => n.id === nodeId);
  if (!node) return empty;

  const chain = [...node.parentPath, node.id]
    .map((id) => locations.find((n) => n.id === id))
    .filter((n): n is AssetLocationNode => !!n);

  const selection = { ...empty };
  chain.forEach((n) => {
    if (n.locationType === "building") {
      selection.buildingId = n.id;
      selection.buildingName = n.buildingName || "";
    }
    if (n.locationType === "floor") {
      selection.floorId = n.id;
      selection.floorName = n.floorName || "";
    }
    if (n.locationType === "room") {
      selection.roomId = n.id;
      selection.roomName = n.roomName || "";
    }
    if (n.locationType === "area") {
      selection.areaId = n.id;
      selection.areaName = n.areaName || "";
    }
  });

  return selection;
}

export function getChildren(nodes: AssetLocationNode[], parentId: string | null) {
  return nodes
    .filter((n) => n.parentId === parentId)
    .sort((a, b) => locationLabelOf(a).localeCompare(locationLabelOf(b)));
}

export function getDescendantIds(nodes: AssetLocationNode[], rootId: string): string[] {
  const result: string[] = [];
  const stack = [rootId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    const children = nodes.filter((n) => n.parentId === current);
    children.forEach((c) => {
      result.push(c.id);
      stack.push(c.id);
    });
  }
  return result;
}

export function countAssetsAtLocation(
  assets: { buildingId?: string; floorId?: string; roomId?: string; areaId?: string }[],
  node: AssetLocationNode
): number {
  return assets.filter((a) => {
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
  }).length;
}

// Section B — PIC Lokasi harus melihat asset berdasarkan LOKASI, bukan
// berdasarkan siapa yang input. Field seperti locationPicUid/
// allowedLocationPicUids HANYA terisi kalau asset dibuat/di-backfill lewat
// alur PIC Lokasi — asset lama (dibuat admin sebelum PIC ditunjuk) tidak
// akan pernah punya field itu, jadi harus tetap ada fallback match lokasi
// (id langsung, lalu path/nama) supaya asset itu tidak "hilang" dari PIC.
function normalizeText(value: unknown): string {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function isSameText(a: unknown, b: unknown): boolean {
  const normalizedA = normalizeText(a);
  const normalizedB = normalizeText(b);
  return !!normalizedA && normalizedA === normalizedB;
}

function isPathInside(assetPath: unknown, picPath: unknown): boolean {
  const asset = normalizeText(assetPath);
  const pic = normalizeText(picPath);
  if (!asset || !pic) return false;
  return asset === pic || asset.startsWith(`${pic} /`);
}

export function isAssetInMyPicLocation(
  asset: Pick<
    Asset,
    | "locationId"
    | "buildingId"
    | "buildingName"
    | "floorId"
    | "floor"
    | "roomId"
    | "roomName"
    | "areaId"
    | "areaName"
    | "location"
    | "locationText"
    | "areaPicUid"
    | "locationPicUid"
    | "allowedLocationPicUids"
  >,
  assignedPicLocations: AssetLocationNode[] | undefined,
  currentUserUid?: string | null
): boolean {
  if (!assignedPicLocations?.length) return false;

  const assetPath =
    asset.locationText ||
    asset.location ||
    [asset.buildingName, asset.floor, asset.roomName, asset.areaName].filter(Boolean).join(" / ");

  return assignedPicLocations.some((loc) => {
    const locId = loc.id;

    // Match langsung by id — paling akurat, mencakup semua level assignment.
    if (asset.locationId === locId) return true;
    if (asset.buildingId === locId) return true;
    if (asset.floorId === locId) return true;
    if (asset.roomId === locId) return true;
    if (asset.areaId === locId) return true;

    // Field PIC Lokasi yang mungkin sudah tersimpan di asset (create baru
    // atau hasil backfill) — tetap didukung, bukan satu-satunya jalur.
    if (currentUserUid && Array.isArray(asset.allowedLocationPicUids)) {
      if (asset.allowedLocationPicUids.includes(currentUserUid)) return true;
    }
    if (currentUserUid && asset.locationPicUid && asset.locationPicUid === currentUserUid) return true;
    if (currentUserUid && asset.areaPicUid && asset.areaPicUid === currentUserUid) return true;

    // Fallback path/nama — untuk asset lama yang belum pernah tersentuh
    // field id terstruktur ATAU field PIC lokasi sama sekali.
    const locFullPath = loc.fullPath || loc.locationLabel;
    if (isPathInside(assetPath, locFullPath)) return true;

    switch (loc.locationType) {
      case "building":
        return isSameText(asset.buildingName, loc.buildingName);
      case "floor":
        return isSameText(asset.buildingName, loc.buildingName) && isSameText(asset.floor, loc.floorName);
      case "room":
        return (
          isSameText(asset.buildingName, loc.buildingName) &&
          isSameText(asset.floor, loc.floorName) &&
          isSameText(asset.roomName, loc.roomName)
        );
      case "area":
        return (
          isSameText(asset.buildingName, loc.buildingName) &&
          isSameText(asset.floor, loc.floorName) &&
          isSameText(asset.roomName, loc.roomName) &&
          isSameText(asset.areaName, loc.areaName)
        );
      default:
        return false;
    }
  });
}
