"use client";

import { forwardRef, useId } from "react";

import { areaLabel } from "@/lib/drawing/build-drawing";
import { visibilityForPreset, type DrawingAppearance, type DrawingDimension, type DrawingFloorArtifact, type DrawingFurniture, type DrawingOpening, type DrawingRoadCorridor, type LayerVisibility, type RoomZone } from "@/lib/drawing/schema";
import type { Rectangle } from "@/lib/building/schema";

type Theme = {
  canvas: string;
  sheet: string;
  ink: string;
  secondary: string;
  construction: string;
  accent: string;
  danger: string;
  warning: string;
  info: string;
  route: string;
  zoning: Record<RoomZone, string>;
};

const THEMES: Record<DrawingAppearance, Theme> = {
  "cad-dark": {
    canvas: "#090908",
    sheet: "#12110f",
    ink: "#fff6ea",
    secondary: "#c9b9a7",
    construction: "#8e5a31",
    accent: "#ff7a2f",
    danger: "#ff5b45",
    warning: "#f2b84b",
    info: "#64b5d6",
    route: "#f4d35e",
    zoning: { social: "#c98b38", private: "#4a78b8", kitchen: "#bc6335", wet: "#2f8b8b", circulation: "#74716c", outdoor: "#4e885d", utility: "#667787", work: "#5862a7", sacred: "#865a9f" },
  },
  "paper-light": {
    canvas: "#d8d3ca",
    sheet: "#fffdf7",
    ink: "#161514",
    secondary: "#514d47",
    construction: "#86786b",
    accent: "#a3481f",
    danger: "#b62b21",
    warning: "#9a6500",
    info: "#236c89",
    route: "#886d00",
    zoning: { social: "#f0d7a5", private: "#c9d9ee", kitchen: "#edc0a6", wet: "#bde0df", circulation: "#d7d4cf", outdoor: "#c9e2cb", utility: "#ced7df", work: "#d2d4ee", sacred: "#ded0e7" },
  },
};

const ZONE_LABEL: Record<RoomZone, string> = {
  social: "Social",
  private: "Private",
  kitchen: "Kitchen",
  wet: "Wet service",
  circulation: "Circulation",
  outdoor: "Outdoor",
  utility: "Utility",
  work: "Work",
  sacred: "Sacred",
};

const ROOM_MARK: Record<string, string> = {
  living: "LIV",
  dining: "DIN",
  kitchen: "KIT",
  bedroom: "BED",
  bathroom: "WC",
  pooja: "PUJ",
  utility: "UTL",
  foyer: "ENT",
  parking: "CAR",
  study: "WRK",
  balcony: "OUT",
  circulation: "CIR",
  stair: "UP",
  store: "STO",
  courtyard: "CYD",
  terrace: "TER",
};

function polygonPoints(points: { x: number; y: number }[]) {
  return points.map(({ x, y }) => `${x},${y}`).join(" ");
}

function Dimension({ dimension, theme }: { dimension: DrawingDimension; theme: Theme }) {
  const horizontal = dimension.orientation === "horizontal";
  const offsetX = horizontal ? 0 : dimension.offsetMm;
  const offsetY = horizontal ? dimension.offsetMm : 0;
  const x1 = dimension.start.x + offsetX;
  const y1 = dimension.start.y + offsetY;
  const x2 = dimension.end.x + offsetX;
  const y2 = dimension.end.y + offsetY;
  const midX = (x1 + x2) / 2;
  const midY = (y1 + y2) / 2;
  return (
    <g aria-label={dimension.label}>
      <line stroke={theme.secondary} strokeDasharray="90 45" strokeWidth="1" vectorEffect="non-scaling-stroke" x1={dimension.start.x} x2={x1} y1={dimension.start.y} y2={y1} />
      <line stroke={theme.secondary} strokeDasharray="90 45" strokeWidth="1" vectorEffect="non-scaling-stroke" x1={dimension.end.x} x2={x2} y1={dimension.end.y} y2={y2} />
      <line markerEnd="url(#cad-arrow)" markerStart="url(#cad-arrow)" stroke={theme.secondary} strokeWidth="1" vectorEffect="non-scaling-stroke" x1={x1} x2={x2} y1={y1} y2={y2} />
      <rect fill={theme.sheet} height="350" opacity="0.94" width={horizontal ? 1160 : 950} x={midX - (horizontal ? 580 : 475)} y={midY - 175} />
      <text fill={theme.secondary} fontFamily="Avenir Next, Gill Sans, sans-serif" fontSize="240" fontWeight="600" letterSpacing="22" textAnchor="middle" transform={horizontal ? undefined : `rotate(-90 ${midX} ${midY})`} x={midX} y={midY + 82}>{dimension.label}</text>
    </g>
  );
}

function FurnitureSymbol({ furniture, theme }: { furniture: DrawingFurniture; theme: Theme }) {
  const { x, y, width, depth } = furniture.bounds;
  const cx = x + width / 2;
  const cy = y + depth / 2;
  const fixture = furniture.kind === "bath" || furniture.kind === "stair";
  const common = { fill: "none", opacity: fixture ? 0.82 : 0.46, stroke: fixture ? theme.ink : theme.secondary, strokeWidth: fixture ? 1.25 : 0.9, vectorEffect: "non-scaling-stroke" as const };
  if (furniture.kind === "bed") return <g {...common}><rect height={depth} rx="80" width={width} x={x} y={y} /><line x1={x} x2={x + width} y1={y + depth * 0.25} y2={y + depth * 0.25} /><rect height={depth * 0.18} rx="40" width={width * 0.35} x={x + width * 0.1} y={y + depth * 0.04} /><rect height={depth * 0.18} rx="40" width={width * 0.35} x={x + width * 0.55} y={y + depth * 0.04} /></g>;
  if (furniture.kind === "sofa") return <g {...common}><rect height={depth * 0.52} rx="120" width={width} x={x} y={y + depth * 0.24} /><line x1={x + width * 0.18} x2={x + width * 0.18} y1={y + depth * 0.27} y2={y + depth * 0.73} /><line x1={x + width * 0.82} x2={x + width * 0.82} y1={y + depth * 0.27} y2={y + depth * 0.73} /></g>;
  if (furniture.kind === "table") return <g {...common}><ellipse cx={cx} cy={cy} rx={width * 0.34} ry={depth * 0.34} /><circle cx={x + width * 0.12} cy={cy} r={Math.min(width, depth) * 0.09} /><circle cx={x + width * 0.88} cy={cy} r={Math.min(width, depth) * 0.09} /></g>;
  if (furniture.kind === "counter") return <g {...common}><path d={`M ${x} ${y} H ${x + width} V ${y + depth * 0.25} H ${x + width * 0.25} V ${y + depth} H ${x} Z`} /><circle cx={x + width * 0.13} cy={y + depth * 0.13} r={Math.min(width, depth) * 0.04} /></g>;
  if (furniture.kind === "bath") return <g {...common} aria-label="Bathroom fixtures"><rect height={depth * 0.42} rx="100" width={width * 0.36} x={x} y={y} /><circle cx={x + width * 0.18} cy={y + depth * 0.21} r={Math.min(width, depth) * 0.055} /><g transform={`translate(${x + width * 0.72} ${y + depth * 0.58})`}><rect height={depth * 0.16} rx="35" width={width * 0.28} x={-width * 0.14} y={-depth * 0.29} /><ellipse cx="0" cy="0" rx={width * 0.19} ry={depth * 0.26} /><ellipse cx="0" cy={depth * 0.01} rx={width * 0.105} ry={depth * 0.15} /></g><circle cx={x + width * 0.76} cy={y + depth * 0.12} r={Math.min(width, depth) * 0.085} /><line x1={x + width * 0.68} x2={x + width * 0.84} y1={y + depth * 0.12} y2={y + depth * 0.12} /></g>;
  if (furniture.kind === "desk") return <g {...common}><rect height={depth * 0.32} width={width} x={x} y={y} /><rect height={depth * 0.32} rx="80" width={width * 0.42} x={x + width * 0.29} y={y + depth * 0.55} /></g>;
  if (furniture.kind === "storage") return <g {...common}><rect height={depth} width={width} x={x} y={y} /><line x1={x} x2={x + width} y1={cy} y2={cy} /><line x1={cx} x2={cx} y1={y} y2={y + depth} /></g>;
  if (furniture.kind === "car") return <g {...common}><rect height={depth * 0.7} rx="260" width={width * 0.68} x={x + width * 0.16} y={y + depth * 0.15} /><line x1={x + width * 0.31} x2={x + width * 0.69} y1={y + depth * 0.32} y2={y + depth * 0.32} /><line x1={x + width * 0.31} x2={x + width * 0.69} y1={y + depth * 0.68} y2={y + depth * 0.68} /></g>;
  if (furniture.kind === "stair") return <g {...common} aria-label="Stair flight up"><rect height={depth} width={width} x={x} y={y} />{Array.from({ length: 11 }, (_, index) => <line key={index} x1={x} x2={x + width} y1={y + (depth / 11) * index} y2={y + (depth / 11) * index} />)}<path d={`M ${cx} ${y + depth * 0.88} V ${y + depth * 0.18} l -120 180 m 120 -180 l 120 180`} /><text fill={theme.ink} fontFamily="Avenir Next, Gill Sans, sans-serif" fontSize={Math.min(220, width * 0.14)} fontWeight="600" opacity="1" stroke="none" textAnchor="middle" x={cx + width * 0.14} y={y + depth * 0.55}>UP</text></g>;
  if (furniture.kind === "landscape") return <g {...common}><circle cx={cx} cy={cy} r={Math.min(width, depth) * 0.25} /><path d={`M ${cx} ${cy - depth * 0.34} V ${cy + depth * 0.34} M ${cx - width * 0.34} ${cy} H ${cx + width * 0.34} M ${cx - width * 0.24} ${cy - depth * 0.24} L ${cx + width * 0.24} ${cy + depth * 0.24}`} /></g>;
  if (furniture.kind === "altar") return <g {...common}><rect height={depth * 0.45} width={width * 0.8} x={x + width * 0.1} y={y + depth * 0.45} /><path d={`M ${x + width * 0.2} ${y + depth * 0.45} L ${cx} ${y} L ${x + width * 0.8} ${y + depth * 0.45}`} /></g>;
  return null;
}

function OpeningSymbol({ opening, theme }: { opening: DrawingOpening; theme: Theme }) {
  const horizontal = opening.start.y === opening.end.y;
  const eraseStroke = opening.wallThicknessMm + 70;
  if (opening.kind === "window") {
    const dx = horizontal ? 0 : 95;
    const dy = horizontal ? 95 : 0;
    return <g><line stroke={theme.sheet} strokeWidth={eraseStroke} x1={opening.start.x} x2={opening.end.x} y1={opening.start.y} y2={opening.end.y} /><line stroke={theme.info} strokeWidth="1.5" vectorEffect="non-scaling-stroke" x1={opening.start.x - dx} x2={opening.end.x - dx} y1={opening.start.y - dy} y2={opening.end.y - dy} /><line stroke={theme.info} strokeWidth="1.5" vectorEffect="non-scaling-stroke" x1={opening.start.x + dx} x2={opening.end.x + dx} y1={opening.start.y + dy} y2={opening.end.y + dy} /></g>;
  }
  if (opening.kind === "open_connection") {
    const tickX = horizontal ? 0 : opening.wallThicknessMm * 0.72;
    const tickY = horizontal ? opening.wallThicknessMm * 0.72 : 0;
    const midX = (opening.start.x + opening.end.x) / 2;
    const midY = (opening.start.y + opening.end.y) / 2;
    return <g aria-label="Open connection"><line stroke={theme.sheet} strokeWidth={eraseStroke} x1={opening.start.x} x2={opening.end.x} y1={opening.start.y} y2={opening.end.y} /><line stroke={theme.secondary} strokeWidth="1.25" vectorEffect="non-scaling-stroke" x1={opening.start.x - tickX} x2={opening.start.x + tickX} y1={opening.start.y - tickY} y2={opening.start.y + tickY} /><line stroke={theme.secondary} strokeWidth="1.25" vectorEffect="non-scaling-stroke" x1={opening.end.x - tickX} x2={opening.end.x + tickX} y1={opening.end.y - tickY} y2={opening.end.y + tickY} /><line stroke={theme.construction} strokeDasharray="80 65" strokeWidth="0.8" vectorEffect="non-scaling-stroke" x1={opening.start.x} x2={opening.end.x} y1={opening.start.y} y2={opening.end.y} />{opening.widthMm >= 1200 ? <text fill={theme.secondary} fontFamily="Avenir Next, Gill Sans, sans-serif" fontSize="135" fontWeight="550" letterSpacing="18" textAnchor="middle" transform={horizontal ? undefined : `rotate(-90 ${midX} ${midY})`} x={midX} y={midY - 105}>OPEN</text> : null}</g>;
  }
  const closedPoint = opening.hingePoint.x === opening.start.x && opening.hingePoint.y === opening.start.y ? opening.end : opening.start;
  const sweep = opening.swing === "counterclockwise" ? 0 : 1;
  const midpoint = { x: (opening.start.x + opening.end.x) / 2, y: (opening.start.y + opening.end.y) / 2 };
  const interior = opening.interiorPoint ?? opening.leafPoint;
  const vector = { x: interior.x - midpoint.x, y: interior.y - midpoint.y };
  const length = Math.hypot(vector.x, vector.y) || 1;
  const outside = { x: midpoint.x - (vector.x / length) * 760, y: midpoint.y - (vector.y / length) * 760 };
  const label = { x: midpoint.x - (vector.x / length) * 1020, y: midpoint.y - (vector.y / length) * 1020 };
  return <g><line stroke={theme.sheet} strokeWidth={eraseStroke} x1={opening.start.x} x2={opening.end.x} y1={opening.start.y} y2={opening.end.y} /><line stroke={theme.ink} strokeWidth="1.15" vectorEffect="non-scaling-stroke" x1={opening.hingePoint.x} x2={opening.leafPoint.x} y1={opening.hingePoint.y} y2={opening.leafPoint.y} /><path d={`M ${closedPoint.x} ${closedPoint.y} A ${opening.widthMm} ${opening.widthMm} 0 0 ${sweep} ${opening.leafPoint.x} ${opening.leafPoint.y}`} fill="none" opacity="0.82" stroke={theme.secondary} strokeWidth="0.9" vectorEffect="non-scaling-stroke" />{opening.isEntrance ? <g aria-label="Main entry"><line markerEnd="url(#cad-entry-arrow)" stroke={theme.accent} strokeWidth="1.7" vectorEffect="non-scaling-stroke" x1={outside.x} x2={midpoint.x} y1={outside.y} y2={midpoint.y} /><text fill={theme.accent} fontFamily="Avenir Next, Gill Sans, sans-serif" fontSize="180" fontWeight="700" letterSpacing="18" textAnchor="middle" x={label.x} y={label.y + 60}>MAIN ENTRY</text></g> : null}</g>;
}

function RoadEdge({ road, theme }: { road: DrawingRoadCorridor; theme: Theme }) {
  const horizontal = road.labelRotation === 0;
  const centerX = road.labelPoint.x;
  const centerY = road.labelPoint.y;
  return <g aria-label={`${road.edge} road access`} opacity="0.78"><rect fill={theme.construction} fillOpacity="0.13" height={road.bounds.depth} stroke={theme.construction} strokeWidth="0.8" vectorEffect="non-scaling-stroke" width={road.bounds.width} x={road.bounds.x} y={road.bounds.y} /><line stroke={theme.construction} strokeDasharray="240 150" strokeWidth="1" vectorEffect="non-scaling-stroke" x1={horizontal ? road.bounds.x : centerX} x2={horizontal ? road.bounds.x + road.bounds.width : centerX} y1={horizontal ? centerY : road.bounds.y} y2={horizontal ? centerY : road.bounds.y + road.bounds.depth} /><text fill={theme.construction} fontFamily="Avenir Next, Gill Sans, sans-serif" fontSize="155" fontWeight="650" letterSpacing="25" textAnchor="middle" transform={horizontal ? undefined : `rotate(-90 ${centerX} ${centerY})`} x={centerX} y={centerY + 55}>ROAD ACCESS · {road.edge.toUpperCase()}</text></g>;
}

export type CadPlanProps = {
  artifact: DrawingFloorArtifact;
  appearance?: DrawingAppearance;
  layers?: LayerVisibility;
  highlightedObjectIds?: string[];
  projectName?: string;
  className?: string;
  displayViewBox?: Rectangle;
};

export const CadPlan = forwardRef<SVGSVGElement, CadPlanProps>(function CadPlan(
  { artifact, appearance = "cad-dark", layers = visibilityForPreset("architectural"), highlightedObjectIds = [], projectName = "BrickPilot feasibility study", className, displayViewBox },
  ref,
) {
  const theme = THEMES[appearance];
  const patternPrefix = useId().replaceAll(":", "");
  const highlighted = new Set(highlightedObjectIds);
  const vb = artifact.viewBox;
  const renderedViewBox = displayViewBox ?? vb;
  const titleY = artifact.annotationLayout.titleY;
  const titleHeight = artifact.annotationLayout.titleHeight;
  const northX = artifact.siteBounds.x + artifact.siteBounds.width - 900;
  const northY = artifact.siteBounds.y + 1200;

  return (
    <svg ref={ref} aria-label={`${artifact.floorLabel} professional architectural concept plan`} className={className} preserveAspectRatio="xMidYMid meet" role="img" viewBox={`${renderedViewBox.x} ${renderedViewBox.y} ${renderedViewBox.width} ${renderedViewBox.depth}`}>
      <title>{projectName} · {artifact.floorLabel}</title>
      <desc>Layered architectural concept drawing with site, room zoning, walls, openings, dimensions, furniture, validation, north arrow, scale bar, legend and title block.</desc>
      <defs>
        <marker id="cad-arrow" markerHeight="6" markerUnits="strokeWidth" markerWidth="6" orient="auto-start-reverse" refX="3" refY="3" viewBox="0 0 6 6"><path d="M 0 3 L 6 0 L 4.5 3 L 6 6 Z" fill={theme.secondary} /></marker>
        <marker id="cad-entry-arrow" markerHeight="8" markerUnits="strokeWidth" markerWidth="8" orient="auto" refX="7" refY="4" viewBox="0 0 8 8"><path d="M 0 0 L 8 4 L 0 8 Z" fill={theme.accent} /></marker>
        {Object.entries(theme.zoning).map(([zone, color], index) => (
          <pattern height="340" id={`${patternPrefix}-${zone}`} key={zone} patternTransform={`rotate(${index % 2 ? 45 : -45})`} patternUnits="userSpaceOnUse" width="340">
            <rect fill={color} fillOpacity={appearance === "cad-dark" ? 0.24 : 0.52} height="340" width="340" />
            <line stroke={color} strokeOpacity="0.7" strokeWidth="42" x1="0" x2="0" y1="0" y2="340" />
          </pattern>
        ))}
      </defs>
      <rect fill={theme.canvas} height={vb.depth} width={vb.width} x={vb.x} y={vb.y} />
      <rect fill={theme.sheet} height={vb.depth - 400} stroke={theme.construction} strokeWidth="1" vectorEffect="non-scaling-stroke" width={vb.width - 400} x={vb.x + 200} y={vb.y + 200} />

      {layers.site ? <g data-layer="site" id="layer-site">
        {artifact.roadCorridors.map((road) => <RoadEdge key={road.edge} road={road} theme={theme} />)}
        <rect fill="none" height={artifact.siteBounds.depth} stroke={theme.construction} strokeDasharray="160 90" strokeWidth="1.2" vectorEffect="non-scaling-stroke" width={artifact.siteBounds.width} x={artifact.siteBounds.x} y={artifact.siteBounds.y} />
        <rect fill="none" height={artifact.envelope.depth} stroke={theme.accent} strokeDasharray="100 75" strokeWidth="1" vectorEffect="non-scaling-stroke" width={artifact.envelope.width} x={artifact.envelope.x} y={artifact.envelope.y} />
        <text fill={theme.construction} fontFamily="Avenir Next, Gill Sans, sans-serif" fontSize="220" fontWeight="700" letterSpacing="36" x={artifact.siteBounds.x + 220} y={artifact.siteBounds.y + 350}>SITE BOUNDARY</text>
      </g> : null}

      {layers.zoning ? <g data-layer="zoning" id="layer-zoning">
        {artifact.rooms.map((room) => <polygon fill={`url(#${patternPrefix}-${room.zone})`} key={room.id} points={polygonPoints(room.polygon)} stroke="none" />)}
      </g> : null}

      {layers.circulation ? <g data-layer="circulation" id="layer-circulation">
        {artifact.routes.map((route) => <polyline fill="none" key={route.id} opacity="0.72" points={polygonPoints(route.points)} stroke={route.accessible ? theme.info : theme.route} strokeDasharray="110 95" strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.15" vectorEffect="non-scaling-stroke" />)}
      </g> : null}

      {layers.walls ? <g data-layer="walls" id="layer-walls">
        {artifact.walls.map((wall) => <line key={wall.id} opacity={highlighted.has(wall.id) ? 1 : wall.type === "exterior" ? 0.72 : wall.type === "shaft" ? 0.62 : 0.52} stroke={highlighted.has(wall.id) ? theme.accent : wall.type === "exterior" ? theme.ink : theme.secondary} strokeLinecap="square" strokeWidth={wall.thicknessMm} x1={wall.start.x} x2={wall.end.x} y1={wall.start.y} y2={wall.end.y} />)}
      </g> : null}

      {layers.openings ? <g data-layer="openings" id="layer-openings">{artifact.openings.map((opening) => <OpeningSymbol key={opening.id} opening={opening} theme={theme} />)}</g> : null}

      {layers.furniture ? <g data-layer="furniture" id="layer-furniture">{artifact.furniture.map((item) => <FurnitureSymbol furniture={item} key={item.id} theme={theme} />)}</g> : null}

      {layers.labels ? <g data-layer="labels" id="layer-labels">
        {artifact.rooms.map((room) => <g key={room.id}>
          {highlighted.has(room.id) ? <rect fill="none" height={room.bounds.depth - 100} stroke={theme.accent} strokeDasharray="100 70" strokeWidth="2" vectorEffect="non-scaling-stroke" width={room.bounds.width - 100} x={room.bounds.x + 50} y={room.bounds.y + 50} /> : null}
          {room.label.mode === "schedule" ? <g aria-label={`${room.label.scheduleRef}, ${room.name}, ${areaLabel(room.areaMm2)}`}>
            <rect fill={theme.sheet} height="460" rx="70" stroke={theme.secondary} strokeWidth="1" vectorEffect="non-scaling-stroke" width="720" x={room.label.x - 360} y={room.label.y - 230} />
            <text fill={theme.ink} fontFamily="Avenir Next, Gill Sans, sans-serif" fontSize="230" fontWeight="620" letterSpacing="16" textAnchor="middle" x={room.label.x} y={room.label.y + 78}>{room.label.scheduleRef}</text>
          </g> : <text fill={theme.ink} fontFamily="Avenir Next, Gill Sans, sans-serif" fontSize={room.label.fontSizeMm} fontWeight="520" letterSpacing={room.label.mode === "compact" ? 12 : 18} textAnchor="middle" x={room.label.x} y={room.label.y - 45}>
            <tspan x={room.label.x}>{room.name.toUpperCase()}</tspan>
            <tspan fill={theme.secondary} fontSize={room.label.fontSizeMm * 0.72} fontWeight="450" letterSpacing="9" x={room.label.x} y={room.label.y + room.label.fontSizeMm * 0.86}>{areaLabel(room.areaMm2)} · {ROOM_MARK[room.type]}</tspan>
          </text>}
        </g>)}
      </g> : null}

      {layers["dimensions-overall"] ? <g data-layer="dimensions-overall" id="layer-dimensions-overall">{artifact.dimensions.overall.map((dimension) => <Dimension dimension={dimension} key={dimension.id} theme={theme} />)}</g> : null}
      {layers["dimensions-internal"] ? <g data-layer="dimensions-internal" id="layer-dimensions-internal">{artifact.dimensions.internal.map((dimension) => <Dimension dimension={dimension} key={dimension.id} theme={theme} />)}</g> : null}

      {layers.validation ? <g data-layer="validation" id="layer-validation">
        {artifact.findings.map((finding, index) => {
          const color = finding.severity === "error" ? theme.danger : finding.severity === "warning" ? theme.warning : theme.info;
          return <g aria-label={finding.message} key={finding.id}><circle cx={finding.point.x} cy={finding.point.y} fill={theme.sheet} r="270" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" /><text fill={color} fontFamily="Avenir Next, Gill Sans, sans-serif" fontSize="260" fontWeight="900" textAnchor="middle" x={finding.point.x} y={finding.point.y + 90}>{index + 1}</text></g>;
        })}
      </g> : null}

      {layers.annotation ? <g data-layer="annotation" id="layer-annotation">
        <g aria-label="Compass rose" transform={`translate(${northX} ${northY})`}><circle cx="0" cy="0" fill={theme.sheet} fillOpacity="0.86" r="370" stroke={theme.secondary} strokeWidth="1" vectorEffect="non-scaling-stroke" /><path d="M 0 -300 L 105 55 L 0 12 L -105 55 Z" fill={theme.accent} /><path d="M 0 300 L 75 -45 L 0 -12 L -75 -45 Z" fill="none" stroke={theme.secondary} strokeWidth="1" vectorEffect="non-scaling-stroke" /><line stroke={theme.secondary} strokeWidth="1" vectorEffect="non-scaling-stroke" x1="-270" x2="270" y1="0" y2="0" /><text fill={theme.ink} fontFamily="Avenir Next, Gill Sans, sans-serif" fontSize="165" fontWeight="700" textAnchor="middle" x="0" y="-430">N</text><text fill={theme.secondary} fontFamily="Avenir Next, Gill Sans, sans-serif" fontSize="120" textAnchor="middle" x="0" y="470">S</text><text fill={theme.secondary} fontFamily="Avenir Next, Gill Sans, sans-serif" fontSize="120" textAnchor="middle" x="470" y="42">E</text><text fill={theme.secondary} fontFamily="Avenir Next, Gill Sans, sans-serif" fontSize="120" textAnchor="middle" x="-470" y="42">W</text></g>
        <g aria-label="Scale bar" transform={`translate(${artifact.annotationLayout.scaleOrigin.x} ${artifact.annotationLayout.scaleOrigin.y})`}><rect fill={theme.ink} height="150" width={artifact.scaleBarMm / 2} x="0" y="0" /><rect fill="none" height="150" stroke={theme.ink} strokeWidth="1" vectorEffect="non-scaling-stroke" width={artifact.scaleBarMm / 2} x={artifact.scaleBarMm / 2} y="0" /><text fill={theme.secondary} fontFamily="Avenir Next, Gill Sans, sans-serif" fontSize="220" fontWeight="700" x="0" y="480">0</text><text fill={theme.secondary} fontFamily="Avenir Next, Gill Sans, sans-serif" fontSize="220" fontWeight="700" textAnchor="middle" x={artifact.scaleBarMm} y="480">{formatScale(artifact.scaleBarMm)}</text></g>
        <g aria-label="Room zoning legend" transform={`translate(${artifact.annotationLayout.legendOrigin.x} ${artifact.annotationLayout.legendOrigin.y})`}>
          {Object.entries(ZONE_LABEL).map(([zone, label], index) => <g key={zone} transform={`translate(${(index % 3) * 2500} ${Math.floor(index / 3) * 430})`}><rect fill={`url(#${patternPrefix}-${zone})`} height="230" stroke={theme.construction} strokeWidth="0.6" vectorEffect="non-scaling-stroke" width="360" x="0" y="-190" /><text fill={theme.secondary} fontFamily="Avenir Next, Gill Sans, sans-serif" fontSize="200" fontWeight="650" x="500" y="0">{label}</text></g>)}
        </g>
        <g aria-label="Title block"><rect fill="none" height={titleHeight} stroke={theme.construction} strokeWidth="1.2" vectorEffect="non-scaling-stroke" width={artifact.siteBounds.width} x={artifact.siteBounds.x} y={titleY} /><line stroke={theme.construction} strokeWidth="1" vectorEffect="non-scaling-stroke" x1={artifact.siteBounds.x + artifact.siteBounds.width * 0.62} x2={artifact.siteBounds.x + artifact.siteBounds.width * 0.62} y1={titleY} y2={titleY + titleHeight} /><text fill={theme.accent} fontFamily="Iowan Old Style, Palatino Linotype, serif" fontSize="520" x={artifact.siteBounds.x + 430} y={titleY + 720}>BrickPilot</text><text fill={theme.ink} fontFamily="Avenir Next, Gill Sans, sans-serif" fontSize="260" fontWeight="800" letterSpacing="28" x={artifact.siteBounds.x + 430} y={titleY + 1260}>{projectName.toUpperCase()}</text><text fill={theme.secondary} fontFamily="Avenir Next, Gill Sans, sans-serif" fontSize="220" letterSpacing="18" x={artifact.siteBounds.x + 430} y={titleY + 1720}>CONCEPT / FEASIBILITY PLAN · NOT FOR CONSTRUCTION</text><text fill={theme.ink} fontFamily="Avenir Next, Gill Sans, sans-serif" fontSize="350" fontWeight="800" x={artifact.siteBounds.x + artifact.siteBounds.width * 0.65} y={titleY + 630}>{artifact.floorLabel.toUpperCase()}</text><text fill={theme.secondary} fontFamily="Avenir Next, Gill Sans, sans-serif" fontSize="210" x={artifact.siteBounds.x + artifact.siteBounds.width * 0.65} y={titleY + 1090}>SEED {artifact.metadata.seed} · {artifact.metadata.algorithmVersion}</text><text fill={theme.secondary} fontFamily="Avenir Next, Gill Sans, sans-serif" fontSize="210" x={artifact.siteBounds.x + artifact.siteBounds.width * 0.65} y={titleY + 1480}>RULES {artifact.metadata.rulePackVersion}</text><text fill={theme.secondary} fontFamily="Avenir Next, Gill Sans, sans-serif" fontSize="210" x={artifact.siteBounds.x + artifact.siteBounds.width * 0.65} y={titleY + 1870}>RENDERER {artifact.rendererVersion}</text></g>
        {artifact.schedule.length ? <g aria-label="Room schedule" transform={`translate(${artifact.annotationLayout.scheduleOrigin.x} ${artifact.annotationLayout.scheduleOrigin.y})`}><text fill={theme.accent} fontFamily="Avenir Next, Gill Sans, sans-serif" fontSize="220" fontWeight="800" letterSpacing="26">ROOM SCHEDULE</text>{artifact.schedule.map((item, index) => <text fill={theme.secondary} fontFamily="Avenir Next, Gill Sans, sans-serif" fontSize="200" key={item.ref} x={(index % 2) * (artifact.siteBounds.width / 2)} y={430 + Math.floor(index / 2) * 350}>{item.ref} · {item.name.toUpperCase()} · {areaLabel(item.areaMm2)}</text>)}</g> : null}
      </g> : null}
    </svg>
  );
});

function formatScale(mm: number) {
  return `${mm / 1000} m`;
}
