"use client";

import { useMemo } from "react";

import { PLAN_COLORS, planPrimitives } from "@/components/deck/planPrimitives";
import type { DrawingFloorArtifact } from "@/lib/drawing/schema";

/**
 * Presentation floor plan drawn from the same `planPrimitives` the PDF sheet
 * uses — cropped to the geometry, no embedded title block or legend (the
 * slide's own frame and sidebar carry that). What you see here is what the
 * PDF exports.
 */
export function DeckPlan({ artifact, className = "" }: { artifact: DrawingFloorArtifact; className?: string }) {
  const plan = useMemo(() => planPrimitives(artifact), [artifact]);
  const labelFont = "Avenir Next, Gill Sans, sans-serif";

  return (
    <svg aria-label={`${artifact.floorLabel} floor plan`} className={className} preserveAspectRatio="xMidYMid meet" role="img" viewBox={`${plan.view.x} ${plan.view.y} ${plan.view.width} ${plan.view.depth}`}>
      <rect fill={PLAN_COLORS.panel} height={plan.view.depth} width={plan.view.width} x={plan.view.x} y={plan.view.y} />

      {plan.roads.map((road, index) => (
        <g key={`road-${index}`} opacity="0.85">
          <rect fill={PLAN_COLORS.construction} fillOpacity="0.12" height={road.bounds.depth} width={road.bounds.width} x={road.bounds.x} y={road.bounds.y} />
          <text fill={PLAN_COLORS.construction} fontFamily={labelFont} fontSize="190" fontWeight="700" letterSpacing="30" textAnchor="middle" transform={road.vertical ? `rotate(-90 ${road.labelX} ${road.labelY})` : undefined} x={road.labelX} y={road.labelY}>{road.label}</text>
        </g>
      ))}

      <rect fill="none" height={plan.site.depth} stroke={PLAN_COLORS.construction} strokeDasharray="170 95" strokeWidth="1.4" vectorEffect="non-scaling-stroke" width={plan.site.width} x={plan.site.x} y={plan.site.y} />
      <rect fill="none" height={plan.envelope.depth} stroke={PLAN_COLORS.accent} strokeDasharray="100 80" strokeOpacity="0.75" strokeWidth="1" vectorEffect="non-scaling-stroke" width={plan.envelope.width} x={plan.envelope.x} y={plan.envelope.y} />

      {plan.roomFills.map((room, index) => (
        <polygon fill={room.fill} fillOpacity="0.16" key={`fill-${index}`} points={room.points} stroke={room.openEdge ? PLAN_COLORS.construction : "none"} strokeDasharray={room.openEdge ? "170 110" : undefined} strokeWidth={room.openEdge ? 1.1 : 0} vectorEffect="non-scaling-stroke" />
      ))}
      {plan.intentionalUnbuilt.map((region, index) => <polygon fill="none" key={`unbuilt-${index}`} points={region.points} stroke={PLAN_COLORS.construction} strokeDasharray="220 140" strokeWidth="1.2" vectorEffect="non-scaling-stroke" />)}
      {plan.roofLines.map((line, index) => <line key={`roof-${index}`} stroke={PLAN_COLORS.accent} strokeDasharray={line.dashed ? "100 65" : undefined} strokeWidth="1.1" vectorEffect="non-scaling-stroke" x1={line.x1} x2={line.x2} y1={line.y1} y2={line.y2} />)}
      {plan.supportLines.map((line, index) => <line key={`support-line-${index}`} stroke={PLAN_COLORS.construction} strokeWidth="2" vectorEffect="non-scaling-stroke" x1={line.x1} x2={line.x2} y1={line.y1} y2={line.y2} />)}
      {plan.supportPoints.map((point, index) => <circle cx={point.x} cy={point.y} fill={PLAN_COLORS.construction} key={`support-${index}`} r="115" />)}
      {plan.guardLines.map((line, index) => <line key={`guard-${index}`} stroke={PLAN_COLORS.info} strokeDasharray="100 55" strokeWidth="2" vectorEffect="non-scaling-stroke" x1={line.x1} x2={line.x2} y1={line.y1} y2={line.y2} />)}

      {plan.walls.map((wall, index) => (
        <line key={`wall-${index}`} opacity={wall.stroke === PLAN_COLORS.ink ? 0.9 : 0.62} stroke={wall.stroke} strokeLinecap="square" strokeWidth={wall.thicknessMm} x1={wall.x1} x2={wall.x2} y1={wall.y1} y2={wall.y2} />
      ))}

      {plan.columns.map((column, index) => (
        <rect fill={PLAN_COLORS.ink} height={column.depth} key={`col-${index}`} opacity="0.92" width={column.width} x={column.x} y={column.y} />
      ))}

      {plan.openings.map((opening, index) => (
        <g key={`opening-${index}`}>
          <line stroke={PLAN_COLORS.panel} strokeWidth={opening.erase.width} x1={opening.erase.x1} x2={opening.erase.x2} y1={opening.erase.y1} y2={opening.erase.y2} />
          {opening.lines.map((line, lineIndex) => (
            <line key={lineIndex} stroke={line.stroke} strokeDasharray={line.dashed ? "90 70" : undefined} strokeWidth="1.4" vectorEffect="non-scaling-stroke" x1={line.x1} x2={line.x2} y1={line.y1} y2={line.y2} />
          ))}
          {opening.arcPoints.length > 1 ? (
            <polyline fill="none" opacity="0.85" points={opening.arcPoints.map((point) => `${point.x},${point.y}`).join(" ")} stroke={PLAN_COLORS.secondary} strokeWidth="1.1" vectorEffect="non-scaling-stroke" />
          ) : null}
          {opening.entrance ? (
            <g>
              <line stroke={PLAN_COLORS.accent} strokeWidth="2" vectorEffect="non-scaling-stroke" x1={opening.entrance.shaft.x1} x2={opening.entrance.shaft.x2} y1={opening.entrance.shaft.y1} y2={opening.entrance.shaft.y2} />
              <polygon fill={PLAN_COLORS.accent} points={opening.entrance.head.map((point) => `${point.x},${point.y}`).join(" ")} />
              <text fill={PLAN_COLORS.accent} fontFamily={labelFont} fontSize="175" fontWeight="700" letterSpacing="20" textAnchor="middle" x={opening.entrance.labelX} y={opening.entrance.labelY}>MAIN ENTRY</text>
            </g>
          ) : null}
        </g>
      ))}

      {plan.furniture.map((item, index) => (
        <g key={`furniture-${index}`} opacity={item.kind === "stair" || item.kind === "bath" ? 0.8 : 0.42} stroke={item.kind === "stair" || item.kind === "bath" ? PLAN_COLORS.ink : PLAN_COLORS.secondary} strokeWidth="1" vectorEffect="non-scaling-stroke">
          <rect fill="none" height={item.rect.depth} width={item.rect.width} x={item.rect.x} y={item.rect.y} />
          {item.inner.map((line, lineIndex) => (
            <line key={lineIndex} x1={line.x1} x2={line.x2} y1={line.y1} y2={line.y2} />
          ))}
          {item.kind === "stair" ? (
            <text fill={PLAN_COLORS.ink} fontFamily={labelFont} fontSize="200" fontWeight="700" stroke="none" textAnchor="middle" x={item.rect.x + item.rect.width / 2} y={item.rect.y + item.rect.depth / 2 + 70}>UP</text>
          ) : null}
        </g>
      ))}

      {plan.dimensions.map((dimension, index) => (
        <g key={`dim-${index}`} opacity="0.9">
          {dimension.extensions.map((extension, extensionIndex) => (
            <line key={extensionIndex} stroke={PLAN_COLORS.secondary} strokeDasharray="80 50" strokeWidth="0.8" vectorEffect="non-scaling-stroke" x1={extension.x1} x2={extension.x2} y1={extension.y1} y2={extension.y2} />
          ))}
          <line stroke={PLAN_COLORS.secondary} strokeWidth="1" vectorEffect="non-scaling-stroke" x1={dimension.line.x1} x2={dimension.line.x2} y1={dimension.line.y1} y2={dimension.line.y2} />
          <rect fill={PLAN_COLORS.panel} height="300" opacity="0.92" rx="40" width="1150" x={dimension.anchor === "middle" ? dimension.labelX - 575 : dimension.labelX - 1150} y={dimension.labelY - 230} />
          <text fill={PLAN_COLORS.secondary} fontFamily={labelFont} fontSize="215" fontWeight="600" letterSpacing="20" textAnchor={dimension.anchor} x={dimension.labelX} y={dimension.labelY}>{dimension.label}</text>
        </g>
      ))}

      {plan.roomLabels.map((label, index) => (
        <text fill={PLAN_COLORS.ink} fontFamily={labelFont} fontSize={label.fontSize} fontWeight="600" key={`label-${index}`} letterSpacing="14" textAnchor="middle" x={label.x} y={label.y}>{label.name}</text>
      ))}
      {plan.areaLabels.map((label, index) => (
        <text fill={PLAN_COLORS.secondary} fontFamily={labelFont} fontSize={label.fontSize} fontWeight="500" key={`area-${index}`} letterSpacing="10" textAnchor="middle" x={label.x} y={label.y}>{label.label}</text>
      ))}

      <g aria-label="North" transform={`translate(${plan.compass.x} ${plan.compass.y})`}>
        <circle cx="0" cy="0" fill={PLAN_COLORS.panel} fillOpacity="0.85" r="360" stroke={PLAN_COLORS.secondary} strokeWidth="1" vectorEffect="non-scaling-stroke" />
        <polygon fill={PLAN_COLORS.accent} points="0,-290 100,55 0,10 -100,55" />
        <text fill={PLAN_COLORS.ink} fontFamily={labelFont} fontSize="170" fontWeight="700" textAnchor="middle" x="0" y="-440">N</text>
      </g>

      <g aria-label="Scale" transform={`translate(${plan.scaleBar.x} ${plan.scaleBar.y})`}>
        <rect fill={PLAN_COLORS.ink} height="140" width={plan.scaleBar.widthMm / 2} x="0" y="0" />
        <rect fill="none" height="140" stroke={PLAN_COLORS.ink} strokeWidth="1" vectorEffect="non-scaling-stroke" width={plan.scaleBar.widthMm / 2} x={plan.scaleBar.widthMm / 2} y="0" />
        <text fill={PLAN_COLORS.secondary} fontFamily={labelFont} fontSize="200" fontWeight="600" x="0" y="430">0</text>
        <text fill={PLAN_COLORS.secondary} fontFamily={labelFont} fontSize="200" fontWeight="600" textAnchor="end" x={plan.scaleBar.widthMm} y="430">{plan.scaleBar.label}</text>
      </g>
    </svg>
  );
}
