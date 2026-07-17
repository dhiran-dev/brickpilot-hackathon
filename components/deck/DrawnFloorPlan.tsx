"use client";

import { motion, useReducedMotion } from "framer-motion";

import type { DrawingFloorArtifact, RoomZone } from "@/lib/drawing/schema";

const ZONE_FILL: Record<RoomZone, string> = {
  social: "#fff6ea",
  private: "#b5a697",
  kitchen: "#c97940",
  wet: "#c97940",
  circulation: "#8e5a31",
  outdoor: "#38765a",
  utility: "#8e5a31",
  work: "#b5a697",
  sacred: "#c97940",
};

function polygonPoints(points: { x: number; y: number }[]) {
  return points.map((point) => `${point.x},${point.y}`).join(" ");
}

export function DrawnFloorPlan({ artifact }: { artifact: DrawingFloorArtifact }) {
  const reduce = useReducedMotion();
  const vb = artifact.viewBox;
  const wallDuration = reduce ? 0 : 1.1;
  const roomDelay = reduce ? 0 : 0.15;
  const wallDelay = reduce ? 0 : 0.55;
  const labelDelay = reduce ? 0 : 1.5;

  return (
    <svg
      aria-label={`${artifact.floorLabel} vector plan`}
      className="h-full w-full"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      viewBox={`${vb.x} ${vb.y} ${vb.width} ${vb.depth}`}
    >
      <rect fill="#0b0a09" height={vb.depth} width={vb.width} x={vb.x} y={vb.y} />
      <rect
        fill="none"
        height={artifact.siteBounds.depth}
        stroke="#8e5a31"
        strokeDasharray="160 90"
        strokeWidth={vb.width * 0.0015}
        width={artifact.siteBounds.width}
        x={artifact.siteBounds.x}
        y={artifact.siteBounds.y}
      />

      {artifact.rooms.map((room, index) => (
        <motion.polygon
          animate={{ opacity: 0.16 }}
          fill={ZONE_FILL[room.zone]}
          initial={{ opacity: 0 }}
          key={`fill-${room.id}`}
          points={polygonPoints(room.polygon)}
          transition={{ duration: 0.5, delay: roomDelay + index * (reduce ? 0 : 0.05) }}
        />
      ))}

      {artifact.walls.map((wall, index) => (
        <motion.line
          animate={{ pathLength: 1, opacity: 1 }}
          initial={{ pathLength: 0, opacity: 0 }}
          key={wall.id}
          stroke={wall.type === "exterior" ? "#fff6ea" : "#cdbdab"}
          strokeLinecap="square"
          strokeWidth={wall.thicknessMm}
          transition={{ duration: wallDuration, delay: wallDelay + index * (reduce ? 0 : 0.015), ease: "easeInOut" }}
          x1={wall.start.x}
          x2={wall.end.x}
          y1={wall.start.y}
          y2={wall.end.y}
        />
      ))}

      {artifact.rooms.map((room, index) => (
        <motion.g
          animate={{ opacity: 1 }}
          initial={{ opacity: 0 }}
          key={`label-${room.id}`}
          transition={{ duration: 0.4, delay: labelDelay + index * (reduce ? 0 : 0.06) }}
        >
          <text fill="#fff6ea" fontFamily="Avenir Next, Gill Sans, sans-serif" fontSize={room.label.fontSizeMm * 0.62} fontWeight={600} textAnchor="middle" x={room.label.x} y={room.label.y - 45}>
            {room.name.toUpperCase()}
          </text>
          <text fill="#b5a697" fontFamily="Avenir Next, Gill Sans, sans-serif" fontSize={room.label.fontSizeMm * 0.4} letterSpacing={12} textAnchor="middle" x={room.label.x} y={room.label.y + 40}>
            {(room.areaMm2 / 1_000_000).toFixed(1)} SQM
          </text>
        </motion.g>
      ))}

      {artifact.dimensions.overall.length > 0 ? (
        <motion.g animate={{ opacity: 1 }} initial={{ opacity: 0 }} transition={{ duration: 0.4, delay: labelDelay }}>
          {artifact.dimensions.overall.map((dimension) => (
            <text
              fill="#c97940"
              fontFamily="Avenir Next, Gill Sans, sans-serif"
              fontSize={220}
              key={dimension.label}
              letterSpacing={16}
              textAnchor="middle"
              x={(dimension.start.x + dimension.end.x) / 2}
              y={(dimension.start.y + dimension.end.y) / 2 - 60}
            >
              {dimension.label}
            </text>
          ))}
        </motion.g>
      ) : null}
    </svg>
  );
}
