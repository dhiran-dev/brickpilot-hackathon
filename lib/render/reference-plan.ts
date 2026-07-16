import type { Building, Floor } from "@/lib/building/schema";

const WIDTH = 1600;
const BOARD_PADDING = 56;
const GAP = 44;
const HEADER_HEIGHT = 112;
const FLOOR_HEIGHT = 650;

function escapeXml(value: string) {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&apos;",
    '"': "&quot;",
  })[character] as string);
}

function floorPanel(floor: Floor, panelX: number, panelY: number, panelWidth: number, selectedSpaceId?: string) {
  const captionHeight = 50;
  const drawingPadding = 34;
  const availableWidth = panelWidth - drawingPadding * 2;
  const availableHeight = FLOOR_HEIGHT - captionHeight - drawingPadding * 2;
  const scale = Math.min(availableWidth / floor.envelope.width, availableHeight / floor.envelope.depth);
  const drawingWidth = floor.envelope.width * scale;
  const drawingHeight = floor.envelope.depth * scale;
  const originX = panelX + (panelWidth - drawingWidth) / 2;
  const originY = panelY + captionHeight + (FLOOR_HEIGHT - captionHeight - drawingHeight) / 2;
  const x = (value: number) => originX + (value - floor.envelope.x) * scale;
  const y = (value: number) => originY + (value - floor.envelope.y) * scale;
  const parts: string[] = [
    `<rect x="${panelX}" y="${panelY}" width="${panelWidth}" height="${FLOOR_HEIGHT}" fill="#11100e" stroke="#8e5a31" stroke-opacity="0.7"/>`,
    `<text x="${panelX + 22}" y="${panelY + 32}" fill="#c97940" font-family="Avenir Next, sans-serif" font-size="17" font-weight="700" letter-spacing="2">${escapeXml(floor.label.toUpperCase())} · LEVEL ${floor.level}</text>`,
  ];
  for (const space of floor.spaces) {
    const selected = space.id === selectedSpaceId;
    parts.push(`<rect x="${x(space.bounds.x)}" y="${y(space.bounds.y)}" width="${space.bounds.width * scale}" height="${space.bounds.depth * scale}" fill="${selected ? "#53220d" : "#1d1a16"}" stroke="${selected ? "#ff4e00" : "#6d543f"}" stroke-width="${selected ? 5 : 1.5}"/>`);
    const centreX = x(space.bounds.x + space.bounds.width / 2);
    const centreY = y(space.bounds.y + space.bounds.depth / 2);
    const areaM2 = space.areaMm2 / 1_000_000;
    parts.push(`<text x="${centreX}" y="${centreY - 5}" text-anchor="middle" fill="#fff6ea" font-family="Avenir Next, sans-serif" font-size="${Math.max(11, Math.min(18, Math.sqrt(space.areaMm2) * scale * 0.016))}" font-weight="600">${escapeXml(space.name)}</text>`);
    parts.push(`<text x="${centreX}" y="${centreY + 15}" text-anchor="middle" fill="#b5a697" font-family="Avenir Next, sans-serif" font-size="11">${areaM2.toFixed(1)} m²${selected ? " · INTERIOR SOURCE" : ""}</text>`);
  }
  for (const wall of floor.walls) {
    parts.push(`<line x1="${x(wall.start.x)}" y1="${y(wall.start.y)}" x2="${x(wall.end.x)}" y2="${y(wall.end.y)}" stroke="${wall.type === "exterior" ? "#fff6ea" : "#c8b9a9"}" stroke-width="${Math.max(2, wall.thicknessMm * scale)}" stroke-linecap="square"/>`);
  }
  const byWall = new Map(floor.walls.map((wall) => [wall.id, wall]));
  for (const opening of floor.openings) {
    const wall = byWall.get(opening.wallId);
    if (!wall) continue;
    const length = Math.hypot(wall.end.x - wall.start.x, wall.end.y - wall.start.y);
    if (length === 0) continue;
    const ux = (wall.end.x - wall.start.x) / length;
    const uy = (wall.end.y - wall.start.y) / length;
    const startX = wall.start.x + ux * opening.offsetMm;
    const startY = wall.start.y + uy * opening.offsetMm;
    const endX = startX + ux * opening.widthMm;
    const endY = startY + uy * opening.widthMm;
    parts.push(`<line x1="${x(startX)}" y1="${y(startY)}" x2="${x(endX)}" y2="${y(endY)}" stroke="#ff8d49" stroke-width="${Math.max(4, wall.thicknessMm * scale + 2)}"/>`);
  }
  return parts.join("");
}

export function buildReferencePlanSvg(building: Building, options: { projectName: string; selectedSpaceId?: string }) {
  const floors = [...building.floors].sort((left, right) => left.level - right.level);
  const columns = floors.length === 1 ? 1 : 2;
  const rows = Math.ceil(floors.length / columns);
  const panelWidth = (WIDTH - BOARD_PADDING * 2 - GAP * (columns - 1)) / columns;
  const height = HEADER_HEIGHT + BOARD_PADDING + rows * FLOOR_HEIGHT + Math.max(0, rows - 1) * GAP + BOARD_PADDING;
  const selected = floors.flatMap((floor) => floor.spaces).find((space) => space.id === options.selectedSpaceId);
  const panels = floors.map((floor, index) => {
    const column = index % columns;
    const row = Math.floor(index / columns);
    return floorPanel(
      floor,
      BOARD_PADDING + column * (panelWidth + GAP),
      HEADER_HEIGHT + BOARD_PADDING + row * (FLOOR_HEIGHT + GAP),
      panelWidth,
      options.selectedSpaceId,
    );
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}" viewBox="0 0 ${WIDTH} ${height}" role="img" aria-label="Marked multi-floor plan reference">
<rect width="${WIDTH}" height="${height}" fill="#090908"/>
<text x="${BOARD_PADDING}" y="52" fill="#fff6ea" font-family="Iowan Old Style, Palatino, serif" font-size="32">${escapeXml(options.projectName)}</text>
<text x="${BOARD_PADDING}" y="84" fill="#c97940" font-family="Avenir Next, sans-serif" font-size="14" font-weight="700" letter-spacing="2">CANONICAL MULTI-FLOOR REFERENCE · ${floors.length} STOREY${floors.length === 1 ? "" : "S"}</text>
<text x="${WIDTH - BOARD_PADDING}" y="52" text-anchor="end" fill="#b5a697" font-family="Avenir Next, sans-serif" font-size="13">Geometry ${escapeXml(building.candidate.geometryHash)}</text>
<text x="${WIDTH - BOARD_PADDING}" y="80" text-anchor="end" fill="#ff8d49" font-family="Avenir Next, sans-serif" font-size="13">${selected ? `Interior source: ${escapeXml(selected.name)} · ${escapeXml(selected.floorId)}` : "Exterior grounding set"}</text>
${panels}
</svg>`;
}
