import { AssetLocationNode, LocationType } from "@/lib/types";

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
