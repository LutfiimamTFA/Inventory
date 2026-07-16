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
