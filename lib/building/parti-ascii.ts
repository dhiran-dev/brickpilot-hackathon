import type { Floor, Space } from "@/lib/building/schema";

function symbol(space: Space | undefined) {
  if (!space) return " ";
  if (space.type === "stair") return "S";
  if (space.type === "circulation") return "C";
  if (space.type === "verandah") return "V";
  if (space.type === "courtyard" || space.type === "terrace") return "O";
  if (space.type === "bathroom" || space.type === "utility" || space.type === "store" || space.type === "pooja") return "s";
  return "R";
}

/** Stable coarse topology snapshot: R room, s service, C circulation, V verandah, O open, S stair. */
export function renderFloorPartiAscii(floor: Floor, columns = 16, rows = 12) {
  const { envelope } = floor;
  return Array.from({ length: rows }, (_, row) => Array.from({ length: columns }, (_, column) => {
    const x = envelope.x + (column + 0.5) * envelope.width / columns;
    const y = envelope.y + (row + 0.5) * envelope.depth / rows;
    return symbol(floor.spaces.find((space) => (
      x >= space.bounds.x && x < space.bounds.x + space.bounds.width
      && y >= space.bounds.y && y < space.bounds.y + space.bounds.depth
    )));
  }).join("")).join("\n");
}
