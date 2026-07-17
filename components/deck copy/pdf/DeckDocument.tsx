import { Circle, Document, Font, G, Image, Line, Page, Polygon, Polyline, Rect, StyleSheet, Svg, Text, View } from "@react-pdf/renderer";
import { existsSync } from "fs";
import { join } from "path";
import { createElement, type ComponentProps } from "react";

import { PLAN_COLORS, planPrimitives, type PlanPrimitives } from "@/components/deck/planPrimitives";
import { buildDrawing } from "@/lib/drawing/build-drawing";
import { deckBriefView, deckCostView, deckCoverView, deckDate, deckOverviewView, deckReviewView, deckScheduleView, deckValidationView } from "@/lib/design/deck-content";
import { deriveDeckSlides, type DeckPayload } from "@/lib/design/deck";

// Bundled open fonts (assets/fonts/) so the PDF embeds the same serif/sans
// voices as the product — and renders ₹, ✓, ×, — correctly (PDF core fonts
// can't). Falls back to core fonts if the files are ever absent.
const FONT_DIR = join(process.cwd(), "assets", "fonts");
const HAS_BUNDLED_FONTS = ["texgyrepagella-regular.otf", "IBMPlexSans-Regular.ttf"].every((file) => existsSync(join(FONT_DIR, file)));
if (HAS_BUNDLED_FONTS) {
  Font.register({
    family: "DeckSerif",
    fonts: [
      { src: join(FONT_DIR, "texgyrepagella-regular.otf"), fontWeight: 400 },
      { src: join(FONT_DIR, "texgyrepagella-bold.otf"), fontWeight: 700 },
      { src: join(FONT_DIR, "texgyrepagella-italic.otf"), fontStyle: "italic" },
    ],
  });
  Font.register({
    family: "DeckSans",
    fonts: [
      { src: join(FONT_DIR, "IBMPlexSans-Regular.ttf"), fontWeight: 400 },
      { src: join(FONT_DIR, "IBMPlexSans-Bold.ttf"), fontWeight: 700 },
      { src: join(FONT_DIR, "IBMPlexSans-Italic.ttf"), fontStyle: "italic" },
    ],
  });
}

const SERIF = HAS_BUNDLED_FONTS ? "DeckSerif" : "Times-Roman";
const SANS = HAS_BUNDLED_FONTS ? "DeckSans" : "Helvetica";
const SANS_BOLD = HAS_BUNDLED_FONTS ? "DeckSans" : "Helvetica-Bold";

/** Currency strings carry glyphs (₹) the serif face lacks — render the leading symbol in sans, the figures as set. */
function Money({ value, style }: { value: string; style?: object }) {
  const match = /^([^\d(]+)(.*)$/.exec(value);
  const outer = { style } as ComponentProps<typeof Text>;
  if (!match) return createElement(Text, outer, value);
  return createElement(Text, outer, createElement(Text, { style: { fontFamily: SANS } } as ComponentProps<typeof Text>, match[1]), match[2]);
}

/** react-pdf's types omit font props on SVG text (runtime supports them) — the cast matches the pattern this codebase already used. */
function SvgText(props: { fill: string; fontSize: number; fontWeight?: number; letterSpacing?: number; textAnchor?: "start" | "middle" | "end"; transform?: string; x: number; y: number; children: React.ReactNode }) {
  return createElement(Text, props as unknown as ComponentProps<typeof Text>);
}

const INK = "#090908";
const PANEL = "#0b0a09";
const SURFACE = "#171512";
const COPPER = "#c97940";
const ORANGE = "#ff4e00";
const LINE = "#8e5a31";
const IVORY = "#fff6ea";
const MUTED = "#b5a697";
const DIM = "#786d62";
const WARNING = "#d9a856";
const ERROR = "#e2665a";
const OK = "#7bc79e";

const styles = StyleSheet.create({
  page: { backgroundColor: INK, color: IVORY, fontFamily: SANS, paddingTop: 24, paddingHorizontal: 40, paddingBottom: 44 },
  header: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end", borderBottomWidth: 0.75, borderBottomColor: LINE, paddingBottom: 8, marginBottom: 14 },
  headerNumber: { fontFamily: SERIF, fontSize: 17, color: COPPER, marginRight: 12 },
  headerTitle: { fontFamily: SERIF, fontSize: 15, color: IVORY },
  headerSubtitle: { fontSize: 6.5, color: MUTED, marginTop: 2 },
  headerSheet: { fontSize: 6, fontFamily: SANS_BOLD, fontWeight: 700, letterSpacing: 1.4, color: DIM, textTransform: "uppercase" },
  footer: { position: "absolute", bottom: 20, left: 40, right: 40, flexDirection: "row", justifyContent: "space-between", borderTopWidth: 0.75, borderTopColor: LINE, paddingTop: 7 },
  footerText: { fontSize: 5.8, fontFamily: SANS_BOLD, fontWeight: 700, letterSpacing: 1.1, textTransform: "uppercase", color: DIM },
  chip: { borderWidth: 0.75, borderColor: COPPER, paddingVertical: 3, paddingHorizontal: 6, alignSelf: "flex-start" },
  chipText: { fontSize: 5.4, fontFamily: SANS_BOLD, fontWeight: 700, letterSpacing: 0.9, textTransform: "uppercase", color: COPPER },
  sectionLabel: { fontSize: 6, fontFamily: SANS_BOLD, fontWeight: 700, letterSpacing: 1.4, textTransform: "uppercase", color: MUTED },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" },
  factLabel: { fontSize: 6, fontFamily: SANS_BOLD, fontWeight: 700, letterSpacing: 1.2, textTransform: "uppercase", color: DIM },
});

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function Footer({ payload, sheetNumber, sheetTotal }: { payload: DeckPayload; sheetNumber: number; sheetTotal: number }) {
  return (
    <View style={styles.footer}>
      <Text style={styles.footerText}>{payload.title}</Text>
      <Text style={[styles.footerText, { color: "#5d534b" }]}>Concept design deck · Not for construction</Text>
      <Text style={styles.footerText}>{payload.location} · {deckDate(payload.generatedAt)} · Sheet {pad2(sheetNumber)} / {sheetTotal}</Text>
    </View>
  );
}

function SheetPage({ payload, sheetNumber, sheetTotal, title, subtitle, children }: {
  payload: DeckPayload;
  sheetNumber: number;
  sheetTotal: number;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <Page orientation="landscape" size="A4" style={styles.page}>
      <View style={styles.header}>
        <View style={{ flexDirection: "row", alignItems: "flex-end", flexShrink: 1 }}>
          <Text style={styles.headerNumber}>{pad2(sheetNumber)}</Text>
          <View>
            <Text style={styles.headerTitle}>{title}</Text>
            {subtitle ? <Text style={styles.headerSubtitle}>{subtitle}</Text> : null}
          </View>
        </View>
        <Text style={styles.headerSheet}>Sheet {pad2(sheetNumber)} / {sheetTotal}</Text>
      </View>
      <View style={{ flex: 1, flexDirection: "column" }}>{children}</View>
      <Footer payload={payload} sheetNumber={sheetNumber} sheetTotal={sheetTotal} />
    </Page>
  );
}

// ---------------------------------------------------------------------------
// Cover

function CoverPage({ payload, sheetTotal, heroSrc }: { payload: DeckPayload; sheetTotal: number; heroSrc: string | null }) {
  const cover = deckCoverView(payload);
  return (
    <Page orientation="landscape" size="A4" style={{ backgroundColor: INK }}>
      {heroSrc ? <Image src={heroSrc} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, objectFit: "cover" }} /> : null}
      <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, backgroundColor: INK, opacity: heroSrc ? 0.42 : 0.92 }} />
      <View style={{ position: "absolute", top: 0, left: 0, right: 0, height: 64, backgroundColor: INK, opacity: 0.55 }} />
      <View style={{ position: "absolute", bottom: 0, left: 0, right: 0, height: 250, backgroundColor: INK, opacity: 0.5 }} />
      <View style={{ position: "absolute", left: 40, right: 40, bottom: 34 }}>
        <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 12 }}>
          <View style={{ height: 0.75, width: 30, backgroundColor: COPPER }} />
          <Text style={{ fontSize: 7, fontFamily: SANS_BOLD, letterSpacing: 2.2, color: COPPER, textTransform: "uppercase", marginLeft: 8 }}>
            Concept design deck · Residential feasibility study
          </Text>
        </View>
        <Text style={{ fontFamily: SERIF, fontSize: 42, color: IVORY, marginBottom: 16 }}>{payload.title}</Text>
        <View style={{ flexDirection: "row", borderTopWidth: 0.75, borderTopColor: LINE }}>
          {cover.facts.map((fact, index) => (
            <View key={fact.label} style={[{ paddingTop: 8, paddingRight: 22 }, index > 0 ? { borderLeftWidth: 0.5, borderLeftColor: LINE, paddingLeft: 16 } : {}]}>
              <Text style={styles.factLabel}>{fact.label}</Text>
              <Text style={{ fontSize: 9, color: IVORY, marginTop: 3 }}>{fact.value}</Text>
            </View>
          ))}
        </View>
      </View>
      <View style={{ position: "absolute", top: 24, left: 40, right: 40, flexDirection: "row", justifyContent: "space-between" }}>
        <Text style={{ fontFamily: SERIF, fontSize: 13, color: IVORY }}>BrickPilot</Text>
        <Text style={styles.footerText}>01 / {sheetTotal} sheets</Text>
      </View>
    </Page>
  );
}

// ---------------------------------------------------------------------------
// Brief

function BriefPage({ payload, sheetNumber, sheetTotal }: { payload: DeckPayload; sheetNumber: number; sheetTotal: number }) {
  const brief = deckBriefView(payload);
  const roomCount = brief.roomsByFloor.reduce((sum, floor) => sum + floor.rooms.length, 0);
  return (
    <SheetPage payload={payload} sheetNumber={sheetNumber} sheetTotal={sheetTotal} subtitle="What the household asked for — the inputs every following sheet answers to" title="The brief">
      <View style={{ flex: 1, flexDirection: "row" }}>
        <View style={{ width: "40%", borderRightWidth: 0.5, borderRightColor: LINE, paddingRight: 22, paddingTop: 14 }}>
          {brief.facts.map((fact, index) => (
            <View key={fact.label} style={[styles.rowBetween, { borderBottomWidth: index === brief.facts.length - 1 ? 0 : 0.5, borderBottomColor: LINE, paddingVertical: 6 }]}>
              <Text style={styles.factLabel}>{fact.label}</Text>
              <Text style={{ fontSize: 8.5, color: IVORY, textAlign: "right", maxWidth: 170 }}>{fact.value}</Text>
            </View>
          ))}
          <View style={{ borderWidth: 0.75, borderColor: LINE, backgroundColor: PANEL, padding: 10, marginTop: 14 }}>
            <Text style={[styles.factLabel, { color: COPPER }]}>Design direction</Text>
            {brief.direction.map((entry) => (
              <Text key={entry.label} style={{ fontSize: 7.5, color: MUTED, marginTop: 4 }}>
                <Text style={{ color: "#5d534b" }}>{entry.label} · </Text>{entry.value}
              </Text>
            ))}
          </View>
        </View>
        <View style={{ flex: 1, paddingLeft: 22, paddingTop: 14 }}>
          <Text style={[styles.sectionLabel, { marginBottom: 10 }]}>Rooms requested · {roomCount} spaces</Text>
          <View style={{ flexDirection: "row" }}>
            {brief.roomsByFloor.map((floor, floorIndex) => (
              <View key={floor.floorLabel} style={{ flex: 1, marginRight: floorIndex === brief.roomsByFloor.length - 1 ? 0 : 18 }}>
                <Text style={{ fontFamily: SERIF, fontSize: 10.5, color: IVORY, borderBottomWidth: 0.75, borderBottomColor: COPPER, paddingBottom: 5 }}>{floor.floorLabel}</Text>
                {floor.rooms.map((room, roomIndex) => (
                  <View key={`${room.name}-${roomIndex}`} style={[styles.rowBetween, { borderBottomWidth: 0.5, borderBottomColor: "#2a2620", paddingVertical: 4 }]}>
                    <Text style={{ fontSize: 7.5, color: MUTED, maxWidth: 105 }}>{room.name}</Text>
                    <Text style={{ fontSize: 7.5, color: IVORY }}>{room.targetM2}</Text>
                  </View>
                ))}
              </View>
            ))}
          </View>
        </View>
      </View>
    </SheetPage>
  );
}

// ---------------------------------------------------------------------------
// Overview

function OverviewPage({ payload, sheetNumber, sheetTotal }: { payload: DeckPayload; sheetNumber: number; sheetTotal: number }) {
  const overview = deckOverviewView(payload);
  return (
    <SheetPage payload={payload} sheetNumber={sheetNumber} sheetTotal={sheetTotal} subtitle={`${payload.scheme.name} — the selected parti, and why it won`} title="Project overview">
      <View style={{ flex: 1, flexDirection: "row" }}>
        <View style={{ width: "56%", borderRightWidth: 0.5, borderRightColor: LINE, paddingRight: 24, justifyContent: "center" }}>
          <Text style={{ fontFamily: SERIF, fontSize: 12.5, lineHeight: 1.65, color: IVORY }}>{payload.scheme.rationale}</Text>
          <View style={{ marginTop: 16 }}>
            {overview.evidence.map((line, index) => (
              <View key={line} style={{ flexDirection: "row", borderTopWidth: 0.5, borderTopColor: "#2a2620", paddingVertical: 6 }}>
                <Text style={{ fontFamily: SERIF, fontSize: 9, color: COPPER, width: 22 }}>{pad2(index + 1)}</Text>
                <Text style={{ fontSize: 8, lineHeight: 1.5, color: MUTED, flex: 1 }}>{line}</Text>
              </View>
            ))}
          </View>
        </View>
        <View style={{ flex: 1, paddingLeft: 24, justifyContent: "center" }}>
          <Text style={styles.factLabel}>Total scheduled area</Text>
          <Text style={{ fontFamily: SERIF, fontSize: 34, color: IVORY, marginTop: 2, marginBottom: 14 }}>
            {overview.builtUpM2}<Text style={{ fontSize: 15, color: MUTED }}> m²</Text>
          </Text>
          {overview.stats.map((stat) => (
            <View key={stat.label} style={[styles.rowBetween, { borderTopWidth: 0.5, borderTopColor: "#2a2620", paddingVertical: 5 }]}>
              <Text style={styles.factLabel}>{stat.label}</Text>
              <Text style={{ fontSize: 8.5, color: IVORY, textAlign: "right" }}>{stat.value}</Text>
            </View>
          ))}
        </View>
      </View>
    </SheetPage>
  );
}

// ---------------------------------------------------------------------------
// Floor plan — the same planPrimitives the on-screen DeckPlan renders.

function FloorPlanSvg({ plan, maxWidth, maxHeight }: { plan: PlanPrimitives; maxWidth: number; maxHeight: number }) {
  const scale = Math.min(maxWidth / plan.view.width, maxHeight / plan.view.depth);
  const width = plan.view.width * scale;
  const height = plan.view.depth * scale;
  const thin = 40;
  const hairline = 26;

  return (
    <Svg style={{ width, height }} viewBox={`${plan.view.x} ${plan.view.y} ${plan.view.width} ${plan.view.depth}`}>
      <Rect fill={PANEL} height={plan.view.depth} width={plan.view.width} x={plan.view.x} y={plan.view.y} />

      {plan.roads.map((road, index) => (
        <G key={`road-${index}`}>
          <Rect fill={LINE} fillOpacity={0.12} height={road.bounds.depth} width={road.bounds.width} x={road.bounds.x} y={road.bounds.y} />
          <SvgText fill={LINE} fontSize={190} fontWeight={700} textAnchor="middle" transform={road.vertical ? `rotate(-90 ${road.labelX} ${road.labelY})` : undefined} x={road.labelX} y={road.labelY}>{road.label}</SvgText>
        </G>
      ))}

      <Rect fill="none" height={plan.site.depth} stroke={LINE} strokeDasharray="170 95" strokeWidth={thin} width={plan.site.width} x={plan.site.x} y={plan.site.y} />
      <Rect fill="none" height={plan.envelope.depth} stroke={PLAN_COLORS.accent} strokeDasharray="100 80" strokeOpacity={0.75} strokeWidth={hairline} width={plan.envelope.width} x={plan.envelope.x} y={plan.envelope.y} />

      {plan.roomFills.map((room, index) => (
        <Polygon fill={room.fill} fillOpacity={0.16} key={`fill-${index}`} points={room.points} stroke={room.openEdge ? LINE : "none"} strokeDasharray={room.openEdge ? "170 110" : undefined} strokeWidth={room.openEdge ? hairline : 0} />
      ))}

      {plan.walls.map((wall, index) => (
        <Line key={`wall-${index}`} opacity={wall.stroke === PLAN_COLORS.ink ? 0.9 : 0.62} stroke={wall.stroke} strokeLinecap="square" strokeWidth={wall.thicknessMm} x1={wall.x1} x2={wall.x2} y1={wall.y1} y2={wall.y2} />
      ))}

      {plan.columns.map((column, index) => (
        <Rect fill={PLAN_COLORS.ink} height={column.depth} key={`col-${index}`} opacity={0.92} width={column.width} x={column.x} y={column.y} />
      ))}

      {plan.openings.map((opening, index) => (
        <G key={`opening-${index}`}>
          <Line stroke={PANEL} strokeWidth={opening.erase.width} x1={opening.erase.x1} x2={opening.erase.x2} y1={opening.erase.y1} y2={opening.erase.y2} />
          {opening.lines.map((line, lineIndex) => (
            <Line key={lineIndex} stroke={line.stroke} strokeDasharray={line.dashed ? "90 70" : undefined} strokeWidth={thin} x1={line.x1} x2={line.x2} y1={line.y1} y2={line.y2} />
          ))}
          {opening.arcPoints.length > 1 ? (
            <Polyline fill="none" opacity={0.85} points={opening.arcPoints.map((point) => `${point.x},${point.y}`).join(" ")} stroke={PLAN_COLORS.secondary} strokeWidth={hairline} />
          ) : null}
          {opening.entrance ? (
            <G>
              <Line stroke={PLAN_COLORS.accent} strokeWidth={thin + 20} x1={opening.entrance.shaft.x1} x2={opening.entrance.shaft.x2} y1={opening.entrance.shaft.y1} y2={opening.entrance.shaft.y2} />
              <Polygon fill={PLAN_COLORS.accent} points={opening.entrance.head.map((point) => `${point.x},${point.y}`).join(" ")} />
              <SvgText fill={PLAN_COLORS.accent} fontSize={175} fontWeight={700} textAnchor="middle" x={opening.entrance.labelX} y={opening.entrance.labelY}>MAIN ENTRY</SvgText>
            </G>
          ) : null}
        </G>
      ))}

      {plan.furniture.map((item, index) => (
        <G key={`furniture-${index}`} opacity={item.kind === "stair" || item.kind === "bath" ? 0.8 : 0.42}>
          <Rect fill="none" height={item.rect.depth} stroke={item.kind === "stair" || item.kind === "bath" ? PLAN_COLORS.ink : PLAN_COLORS.secondary} strokeWidth={hairline} width={item.rect.width} x={item.rect.x} y={item.rect.y} />
          {item.inner.map((line, lineIndex) => (
            <Line key={lineIndex} stroke={item.kind === "stair" || item.kind === "bath" ? PLAN_COLORS.ink : PLAN_COLORS.secondary} strokeWidth={hairline} x1={line.x1} x2={line.x2} y1={line.y1} y2={line.y2} />
          ))}
          {item.kind === "stair" ? (
            <SvgText fill={PLAN_COLORS.ink} fontSize={200} fontWeight={700} textAnchor="middle" x={item.rect.x + item.rect.width / 2} y={item.rect.y + item.rect.depth / 2 + 70}>UP</SvgText>
          ) : null}
        </G>
      ))}

      {plan.dimensions.map((dimension, index) => (
        <G key={`dim-${index}`} opacity={0.9}>
          {dimension.extensions.map((extension, extensionIndex) => (
            <Line key={extensionIndex} stroke={PLAN_COLORS.secondary} strokeDasharray="80 50" strokeWidth={hairline} x1={extension.x1} x2={extension.x2} y1={extension.y1} y2={extension.y2} />
          ))}
          <Line stroke={PLAN_COLORS.secondary} strokeWidth={hairline} x1={dimension.line.x1} x2={dimension.line.x2} y1={dimension.line.y1} y2={dimension.line.y2} />
          <Rect fill={PANEL} height={300} opacity={0.92} width={1150} x={dimension.anchor === "middle" ? dimension.labelX - 575 : dimension.labelX - 1150} y={dimension.labelY - 230} />
          <SvgText fill={PLAN_COLORS.secondary} fontSize={215} fontWeight={600} textAnchor={dimension.anchor} x={dimension.labelX} y={dimension.labelY}>{dimension.label}</SvgText>
        </G>
      ))}

      {plan.roomLabels.map((label, index) => (
        <SvgText fill={PLAN_COLORS.ink} fontSize={label.fontSize} fontWeight={600} key={`label-${index}`} textAnchor="middle" x={label.x} y={label.y}>{label.name}</SvgText>
      ))}
      {plan.areaLabels.map((label, index) => (
        <SvgText fill={PLAN_COLORS.secondary} fontSize={label.fontSize} fontWeight={500} key={`area-${index}`} textAnchor="middle" x={label.x} y={label.y}>{label.label}</SvgText>
      ))}

      <G>
        <Circle cx={plan.compass.x} cy={plan.compass.y} fill={PANEL} fillOpacity={0.85} r={360} stroke={PLAN_COLORS.secondary} strokeWidth={hairline} />
        <Polygon fill={PLAN_COLORS.accent} points={`${plan.compass.x},${plan.compass.y - 290} ${plan.compass.x + 100},${plan.compass.y + 55} ${plan.compass.x},${plan.compass.y + 10} ${plan.compass.x - 100},${plan.compass.y + 55}`} />
        <SvgText fill={PLAN_COLORS.ink} fontSize={170} fontWeight={700} textAnchor="middle" x={plan.compass.x} y={plan.compass.y - 440}>N</SvgText>
      </G>

      <G>
        <Rect fill={PLAN_COLORS.ink} height={140} width={plan.scaleBar.widthMm / 2} x={plan.scaleBar.x} y={plan.scaleBar.y} />
        <Rect fill="none" height={140} stroke={PLAN_COLORS.ink} strokeWidth={hairline} width={plan.scaleBar.widthMm / 2} x={plan.scaleBar.x + plan.scaleBar.widthMm / 2} y={plan.scaleBar.y} />
        <SvgText fill={PLAN_COLORS.secondary} fontSize={200} fontWeight={600} x={plan.scaleBar.x} y={plan.scaleBar.y + 430}>0</SvgText>
        <SvgText fill={PLAN_COLORS.secondary} fontSize={200} fontWeight={600} textAnchor="end" x={plan.scaleBar.x + plan.scaleBar.widthMm} y={plan.scaleBar.y + 430}>{plan.scaleBar.label}</SvgText>
      </G>
    </Svg>
  );
}

function FloorPlanPage({ payload, slide, plan, artifact }: { payload: DeckPayload; slide: { sheetNumber: number; sheetTotal: number }; plan: PlanPrimitives; artifact: ReturnType<typeof buildDrawing>["floors"][number] }) {
  const scheduledM2 = artifact.areaSchedule.reduce((sum, row) => sum + row.achievedAreaMm2, 0) / 1_000_000;
  const envelopeM2 = (artifact.envelope.width * artifact.envelope.depth) / 1_000_000;
  const efficiency = scheduledM2 > 0 && envelopeM2 > 0 ? Math.round((scheduledM2 / envelopeM2) * 100) : 0;
  const doorCount = artifact.openings.filter((opening) => opening.kind === "door").length;
  const windowCount = artifact.openings.filter((opening) => opening.kind === "window").length;

  return (
    <SheetPage payload={payload} sheetNumber={slide.sheetNumber} sheetTotal={slide.sheetTotal} subtitle={`${artifact.rooms.length} rooms · dimensioned vector plan, drawn from the same geometry as the on-screen sheet`} title={`${artifact.floorLabel} plan`}>
      <View style={{ flex: 1, flexDirection: "row" }}>
        <View style={{ flex: 1, backgroundColor: PANEL, alignItems: "center", justifyContent: "center", marginRight: 14 }}>
          <FloorPlanSvg maxHeight={445} maxWidth={560} plan={plan} />
        </View>
        <View style={{ width: 168, backgroundColor: PANEL, padding: 12 }}>
          <View style={[styles.rowBetween, { alignItems: "baseline" }]}>
            <Text style={{ fontFamily: SERIF, fontSize: 19, color: IVORY }}>{scheduledM2.toFixed(1)}<Text style={{ fontSize: 8, color: MUTED }}> m²</Text></Text>
            <Text style={{ fontSize: 5.5, color: DIM }}>{efficiency}% of plate</Text>
          </View>
          <View style={{ flexDirection: "row", borderTopWidth: 0.5, borderTopColor: LINE, borderBottomWidth: 0.5, borderBottomColor: LINE, marginTop: 8 }}>
            {([["Rooms", artifact.rooms.length], ["Doors", doorCount], ["Windows", windowCount]] as const).map(([label, value], index) => (
              <View key={label} style={{ flex: 1, paddingVertical: 5, paddingHorizontal: 4, borderLeftWidth: index === 0 ? 0 : 0.5, borderLeftColor: LINE }}>
                <Text style={{ fontFamily: SERIF, fontSize: 11, color: IVORY }}>{value}</Text>
                <Text style={{ fontSize: 5, fontFamily: SANS_BOLD, letterSpacing: 0.8, textTransform: "uppercase", color: DIM, marginTop: 1 }}>{label}</Text>
              </View>
            ))}
          </View>

          <Text style={[styles.factLabel, { color: COPPER, marginTop: 10, marginBottom: 2 }]}>Schedule · achieved / target</Text>
          {artifact.areaSchedule.map((row) => (
            <View key={row.ref} style={[styles.rowBetween, { borderBottomWidth: 0.5, borderBottomColor: "#2a2620", paddingVertical: 3 }]}>
              <Text style={{ fontSize: 6.8, color: IVORY, maxWidth: 95 }}>{row.name}</Text>
              <Text style={{ fontSize: 6.8, color: row.underTarget ? WARNING : IVORY }}>
                {(row.achievedAreaMm2 / 1_000_000).toFixed(1)}
                {row.targetAreaMm2 ? <Text style={{ color: "#5d534b", fontSize: 5.8 }}> / {(row.targetAreaMm2 / 1_000_000).toFixed(1)}</Text> : null}
              </Text>
            </View>
          ))}

          {artifact.dimensions.overall.length > 0 ? (
            <Text style={[styles.factLabel, { color: COPPER, marginTop: 10, marginBottom: 2 }]}>Overall dimensions</Text>
          ) : null}
          {artifact.dimensions.overall.map((dim) => (
            <View key={dim.id} style={[styles.rowBetween, { paddingVertical: 2 }]}>
              <Text style={{ fontSize: 5.8, color: DIM, textTransform: "uppercase" }}>{dim.orientation}</Text>
              <Text style={{ fontSize: 6.8, color: IVORY }}>{dim.label}</Text>
            </View>
          ))}

          <Text style={{ fontSize: 5, color: "#5d534b", marginTop: "auto", paddingTop: 8 }}>
            {(artifact.envelope.width / 1000).toFixed(1)}×{(artifact.envelope.depth / 1000).toFixed(1)} m plate · Seed {artifact.metadata.seed}
          </Text>
        </View>
      </View>
    </SheetPage>
  );
}

// ---------------------------------------------------------------------------
// Render plate

const ROLE_GUIDANCE: Record<string, string> = {
  exterior_front: "Street presence — entry, massing and how the house meets the road.",
  exterior_collage: "Four angles in one plate — read the form as a whole before the details.",
  exterior_top: "The roofscape and court — how the plan breathes from above.",
  interior: "The furnished living space — light, proportion and material mood.",
};

function RenderPage({ payload, sheetNumber, sheetTotal, role, label, src }: { payload: DeckPayload; sheetNumber: number; sheetTotal: number; role: string; label: string; src: string | null }) {
  return (
    <Page orientation="landscape" size="A4" style={{ backgroundColor: PANEL }}>
      {src ? (
        <Image src={src} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, objectFit: "cover" }} />
      ) : (
        <View style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center" }}>
          <Text style={{ fontSize: 8, color: MUTED, textTransform: "uppercase", letterSpacing: 1.4 }}>{label} · unavailable</Text>
        </View>
      )}
      <View style={{ position: "absolute", left: 0, right: 0, bottom: 0, height: 118, backgroundColor: INK, opacity: 0.82 }} />
      <View style={{ position: "absolute", left: 40, right: 40, bottom: 30, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" }}>
        <View style={{ flexDirection: "row", alignItems: "flex-end" }}>
          <Text style={{ fontFamily: SERIF, fontSize: 17, color: COPPER, marginRight: 12 }}>{pad2(sheetNumber)}</Text>
          <View>
            <Text style={{ fontFamily: SERIF, fontSize: 15, color: IVORY }}>{label}</Text>
            <Text style={{ fontSize: 7, color: MUTED, marginTop: 2 }}>{ROLE_GUIDANCE[role] ?? "Concept render."}</Text>
          </View>
        </View>
        <Text style={styles.footerText}>{payload.title} · Sheet {pad2(sheetNumber)} / {sheetTotal} · {deckDate(payload.generatedAt)}</Text>
      </View>
    </Page>
  );
}

// ---------------------------------------------------------------------------
// Room schedule

function RoomSchedulePage({ payload, sheetNumber, sheetTotal }: { payload: DeckPayload; sheetNumber: number; sheetTotal: number }) {
  const schedule = deckScheduleView(payload);
  const roomCount = schedule.floors.reduce((sum, floor) => sum + floor.rows.length, 0);
  return (
    <SheetPage payload={payload} sheetNumber={sheetNumber} sheetTotal={sheetTotal} subtitle={`${roomCount} spaces across ${schedule.floors.length} ${schedule.floors.length === 1 ? "floor" : "floors"} — achieved area against the brief's target`} title="Room schedule">
      <View style={{ flex: 1, justifyContent: "center" }}>
      <View style={{ flexDirection: "row" }}>
        {schedule.floors.map((floor, floorIndex) => (
          <View key={floor.floorLabel} style={{ flex: 1, marginRight: floorIndex === schedule.floors.length - 1 ? 0 : 20 }}>
            <View style={[styles.rowBetween, { borderBottomWidth: 0.75, borderBottomColor: COPPER, paddingBottom: 6, alignItems: "baseline" }]}>
              <Text style={{ fontFamily: SERIF, fontSize: 11.5, color: IVORY }}>{floor.floorLabel}</Text>
              <Text style={{ fontSize: 7, fontFamily: SANS_BOLD, fontWeight: 700, letterSpacing: 1, color: MUTED }}>{floor.totalM2} M²</Text>
            </View>
            {floor.rows.map((row, rowIndex) => (
              <View key={`${row.name}-${rowIndex}`} style={[styles.rowBetween, { borderBottomWidth: 0.5, borderBottomColor: "#2a2620", paddingVertical: 5.5 }]}>
                <Text style={{ fontSize: 8.2, color: IVORY, maxWidth: 135 }}>{row.name}</Text>
                <Text style={{ fontSize: 8.2, color: row.underTarget ? WARNING : MUTED }}>
                  {row.achievedM2}{row.targetM2 ? <Text style={{ color: "#5d534b", fontSize: 6.8 }}> / {row.targetM2}</Text> : null}
                </Text>
              </View>
            ))}
          </View>
        ))}
      </View>
      </View>
      <View style={[styles.rowBetween, { borderTopWidth: 0.75, borderTopColor: LINE, paddingTop: 8, marginTop: 10, alignItems: "baseline" }]}>
        <Text style={styles.factLabel}>Areas in m² · amber flags a space more than 15% under its target</Text>
        <Text style={{ fontSize: 8, color: IVORY }}>Grand total <Text style={{ fontFamily: SERIF, fontSize: 11 }}>{schedule.grandTotalM2} m²</Text></Text>
      </View>
    </SheetPage>
  );
}

// ---------------------------------------------------------------------------
// Validation

function ValidationPage({ payload, sheetNumber, sheetTotal }: { payload: DeckPayload; sheetNumber: number; sheetTotal: number }) {
  const view = deckValidationView(payload);
  const severityColor = { error: ERROR, warning: WARNING, info: COPPER } as const;
  return (
    <SheetPage payload={payload} sheetNumber={sheetNumber} sheetTotal={sheetTotal} subtitle={`Deterministic rule pack ${view.rulePackVersion} — run against the exact plan geometry, not a visual estimate`} title="Validation report">
      <View style={{ flex: 1, flexDirection: "row" }}>
        <View style={{ width: 165, borderRightWidth: 0.5, borderRightColor: LINE, paddingRight: 20, justifyContent: "center" }}>
          <Text style={styles.factLabel}>Validation score</Text>
          <Text style={{ fontFamily: SERIF, fontSize: 44, color: IVORY, marginTop: 2 }}>{view.score}<Text style={{ fontSize: 13, color: MUTED }}> / 100</Text></Text>
          <View style={{ height: 3, backgroundColor: "#2a2620", marginTop: 6 }}>
            <View style={{ height: 3, backgroundColor: ORANGE, width: `${Math.max(view.score, 2)}%` }} />
          </View>
          <View style={{ flexDirection: "row", marginTop: 12 }}>
            {([["Errors", view.counts.error, ERROR], ["Warnings", view.counts.warning, WARNING], ["Info", view.counts.info, COPPER]] as const).map(([label, value, color], index) => (
              <View key={label} style={{ flex: 1, borderTopWidth: 2, borderTopColor: color, paddingVertical: 5, paddingHorizontal: 3, marginRight: index === 2 ? 0 : 4, backgroundColor: SURFACE }}>
                <Text style={{ fontFamily: SERIF, fontSize: 12, color: IVORY, textAlign: "center" }}>{value}</Text>
                <Text style={{ fontSize: 4.8, fontFamily: SANS_BOLD, letterSpacing: 0.8, textTransform: "uppercase", color: MUTED, textAlign: "center", marginTop: 1 }}>{label}</Text>
              </View>
            ))}
          </View>
          <Text style={{ fontSize: 6.5, lineHeight: 1.55, color: DIM, marginTop: 12 }}>
            A score of 100 means every deterministic check passed. Warnings mark spaces worth a human look before you brief an architect — not failures.
          </Text>
        </View>

        <View style={{ flex: 1, paddingLeft: 22, justifyContent: "center" }}>
          {view.findings.length === 0 ? (
            <View>
              <Text style={[styles.sectionLabel, { marginBottom: 8 }]}>What was checked</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap" }}>
                {view.categories.map((category, index) => (
                  <View key={category.id} style={{ width: "50%", paddingRight: index % 2 === 0 ? 8 : 0, paddingLeft: index % 2 === 1 ? 8 : 0, marginBottom: 8 }}>
                    <View style={{ flexDirection: "row", backgroundColor: SURFACE, padding: 9 }}>
                      <View style={{ width: 11, height: 11, borderWidth: 0.75, borderColor: category.worst ? severityColor[category.worst] : OK, alignItems: "center", justifyContent: "center", marginRight: 7 }}>
                        <Text style={{ fontSize: 5.5, color: category.worst ? severityColor[category.worst] : OK }}>{category.worst ? category.findings : "✓"}</Text>
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ fontSize: 8, color: IVORY }}>{category.label}</Text>
                        <Text style={{ fontSize: 6.4, lineHeight: 1.45, color: DIM, marginTop: 1.5 }}>{category.blurb}</Text>
                      </View>
                    </View>
                  </View>
                ))}
                <View style={{ width: "50%", paddingLeft: 8, marginBottom: 8 }}>
                  <View style={{ flexDirection: "row", backgroundColor: SURFACE, padding: 9 }}>
                    <View style={{ width: 11, height: 11, borderWidth: 0.75, borderColor: OK, alignItems: "center", justifyContent: "center", marginRight: 7 }}>
                      <Text style={{ fontSize: 5.5, color: OK }}>✓</Text>
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 8, color: IVORY }}>No findings</Text>
                      <Text style={{ fontSize: 6.4, lineHeight: 1.45, color: DIM, marginTop: 1.5 }}>This plan passed every rule with no warnings.</Text>
                    </View>
                  </View>
                </View>
              </View>
            </View>
          ) : (
            view.findings.map((finding, index) => (
              <View key={`${finding.message}-${index}`} style={{ flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#2a2620", paddingVertical: 6 }}>
                <Text style={{ fontFamily: SERIF, fontSize: 10, color: severityColor[finding.severity], width: 22 }}>{pad2(index + 1)}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 5.8, fontFamily: SANS_BOLD, letterSpacing: 1, textTransform: "uppercase", color: severityColor[finding.severity] }}>{finding.severity} · {finding.category}</Text>
                  <Text style={{ fontSize: 8, lineHeight: 1.5, color: IVORY, marginTop: 2 }}>{finding.message}</Text>
                  {finding.action ? <Text style={{ fontSize: 7, lineHeight: 1.45, color: MUTED, marginTop: 1.5 }}>Suggested: {finding.action}</Text> : null}
                </View>
              </View>
            ))
          )}
        </View>
      </View>
    </SheetPage>
  );
}

// ---------------------------------------------------------------------------
// Cost

function CostPage({ payload, sheetNumber, sheetTotal }: { payload: DeckPayload; sheetNumber: number; sheetTotal: number }) {
  const cost = deckCostView(payload);

  if (cost.status === "unavailable") {
    return (
      <SheetPage payload={payload} sheetNumber={sheetNumber} sheetTotal={sheetTotal} subtitle="Why no band is shown, and how to get one" title="Build cost estimate">
        <View style={{ flex: 1, justifyContent: "center" }}>
          <Text style={{ fontFamily: SERIF, fontSize: 13, lineHeight: 1.6, color: IVORY, maxWidth: 400 }}>{cost.reason}</Text>
          {cost.actions.map((action) => (
            <Text key={action} style={{ fontSize: 8, lineHeight: 1.6, color: MUTED, marginTop: 6 }}>— {action}</Text>
          ))}
        </View>
      </SheetPage>
    );
  }

  return (
    <SheetPage payload={payload} sheetNumber={sheetNumber} sheetTotal={sheetTotal} subtitle={`${cost.packName} · ${cost.packVersion} · effective ${cost.effectiveDate}${cost.stale ? " · stale — refresh before budgeting" : ""}`} title="Build cost estimate">
      <View style={{ flex: 1, flexDirection: "row" }}>
        <View style={{ width: 168, borderRightWidth: 0.5, borderRightColor: LINE, paddingRight: 20, justifyContent: "center" }}>
          <View style={styles.chip}><Text style={styles.chipText}>Confidence {cost.confidence} · {cost.match}</Text></View>
          <Money style={{ fontFamily: SERIF, fontSize: 17, color: IVORY, marginTop: 12, lineHeight: 1.2 }} value={cost.expected} />
          <Text style={[styles.factLabel, { marginTop: 3 }]}>Expected total construction cost</Text>
          <Text style={{ fontSize: 6.5, color: DIM, marginTop: 2 }}>{cost.ratePerM2} of gross floor area</Text>

          <View style={{ marginTop: 16, height: 12, justifyContent: "center" }}>
            <View style={{ height: 0.75, backgroundColor: LINE }} />
            <View style={{ position: "absolute", left: `${Math.min(Math.max(cost.bandFraction, 0.02), 0.98) * 100}%`, top: 1, width: 1.6, height: 10, backgroundColor: ORANGE }} />
          </View>
          <View style={[styles.rowBetween, { marginTop: 4 }]}>
            {([["Low", cost.low, IVORY], ["Expected", cost.expected, ORANGE], ["High", cost.high, IVORY]] as const).map(([label, value, color]) => (
              <View key={label}>
                <Text style={{ fontSize: 5.4, fontFamily: SANS_BOLD, letterSpacing: 0.8, textTransform: "uppercase", color: MUTED }}>{label}</Text>
                <Text style={{ fontSize: 6.6, color, marginTop: 1.5 }}>{value}</Text>
              </View>
            ))}
          </View>

          {cost.improveActions.length > 0 ? (
            <View style={{ borderTopWidth: 0.5, borderTopColor: LINE, marginTop: 14, paddingTop: 8 }}>
              <Text style={[styles.factLabel, { color: COPPER }]}>Sharpen this estimate</Text>
              {cost.improveActions.slice(0, 3).map((action) => (
                <Text key={action} style={{ fontSize: 6.5, lineHeight: 1.5, color: MUTED, marginTop: 4 }}>{action}</Text>
              ))}
            </View>
          ) : null}
        </View>

        <View style={{ flex: 1, paddingLeft: 22, justifyContent: "center" }}>
          {cost.lines.map((line) => (
            <View key={line.label} style={[styles.rowBetween, { borderBottomWidth: 0.5, borderBottomColor: "#2a2620", paddingVertical: 4.5, alignItems: "baseline" }]}>
              <View style={{ flex: 1, paddingRight: 10 }}>
                <Text style={{ fontSize: 8.2, color: IVORY }}>{line.label}</Text>
                <Text style={{ fontSize: 6.2, color: DIM, marginTop: 1 }}>{line.basis}</Text>
              </View>
              <Text style={{ fontSize: 8.4, color: IVORY }}>{line.amount}</Text>
            </View>
          ))}
          <View style={[styles.rowBetween, { borderTopWidth: 0.75, borderTopColor: COPPER, paddingTop: 6, alignItems: "baseline" }]}>
            <Text style={styles.factLabel}>Estimated total</Text>
            <Money style={{ fontFamily: SERIF, fontSize: 12, color: IVORY }} value={cost.expected} />
          </View>

          <View style={{ flexDirection: "row", marginTop: 12 }}>
            {([["Included", cost.included], ["Not included", cost.excluded], ["Assumed", cost.assumptions]] as const).map(([heading, entries], index) => (
              <View key={heading} style={{ flex: 1, marginRight: index === 2 ? 0 : 14 }}>
                <Text style={[styles.factLabel, { color: COPPER, borderBottomWidth: 0.5, borderBottomColor: LINE, paddingBottom: 3 }]}>{heading}</Text>
                {entries.slice(0, 4).map((entry) => (
                  <Text key={entry} style={{ fontSize: 6.4, lineHeight: 1.5, color: MUTED, marginTop: 3.5 }}>{entry}</Text>
                ))}
              </View>
            ))}
          </View>
          <Text style={{ fontSize: 6.4, lineHeight: 1.5, color: DIM, fontStyle: "italic", marginTop: 10 }}>{cost.disclaimer}</Text>
        </View>
      </View>
    </SheetPage>
  );
}

// ---------------------------------------------------------------------------
// Rationale

const VERDICT_COPY = {
  concurs: "Architect review · concurs",
  concurs_with_conditions: "Architect review · concurs with conditions",
  unavailable: "Scheme rationale",
} as const;

function RationalePage({ payload, sheetNumber, sheetTotal }: { payload: DeckPayload; sheetNumber: number; sheetTotal: number }) {
  const review = deckReviewView(payload);
  return (
    <SheetPage payload={payload} sheetNumber={sheetNumber} sheetTotal={sheetTotal} subtitle="Why this scheme — the parti reasoning, then what an architect would still watch" title="Design rationale">
      <View style={{ flex: 1, flexDirection: "row" }}>
        <View style={{ width: "48%", borderRightWidth: 0.5, borderRightColor: LINE, paddingRight: 22, justifyContent: "center" }}>
          <View style={styles.chip}>
            <Text style={styles.chipText}>{VERDICT_COPY[review.verdict]}{review.confidence ? ` · ${review.confidence} confidence` : ""}</Text>
          </View>
          <Text style={{ fontFamily: SERIF, fontSize: 11, lineHeight: 1.65, color: IVORY, marginTop: 12 }}>{review.rationale}</Text>
          {review.assumptions.length > 0 ? (
            <View style={{ marginTop: 12 }}>
              <Text style={styles.factLabel}>Assumptions made reading the brief</Text>
              {review.assumptions.map((assumption) => (
                <Text key={assumption} style={{ fontSize: 7.5, lineHeight: 1.55, color: MUTED, marginTop: 4 }}>— {assumption}</Text>
              ))}
            </View>
          ) : null}
        </View>

        <View style={{ flex: 1, paddingLeft: 22, justifyContent: "center" }}>
          {review.concerns.length > 0 ? (
            <View>
              <Text style={[styles.sectionLabel, { marginBottom: 8 }]}>Worth a human look before detailing</Text>
              {review.concerns.map((concern, index) => (
                <View key={concern.recommendation} style={{ flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#2a2620", paddingVertical: 6 }}>
                  <Text style={{ fontFamily: SERIF, fontSize: 10, color: COPPER, width: 22 }}>{pad2(index + 1)}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 5.8, fontFamily: SANS_BOLD, letterSpacing: 1, textTransform: "uppercase", color: MUTED }}>{concern.topic}</Text>
                    <Text style={{ fontSize: 8, lineHeight: 1.5, color: IVORY, marginTop: 2 }}>{concern.recommendation}</Text>
                    <Text style={{ fontSize: 6.8, lineHeight: 1.45, color: MUTED, marginTop: 2 }}>Why it matters: {concern.whyItMatters}</Text>
                    <Text style={{ fontSize: 6.8, lineHeight: 1.45, color: DIM, marginTop: 1 }}>What it saves: {concern.whatItSaves}</Text>
                  </View>
                </View>
              ))}
            </View>
          ) : (
            <View>
              <Text style={[styles.sectionLabel, { marginBottom: 8 }]}>Evidence considered</Text>
              {review.evidence.map((line, index) => (
                <View key={line} style={{ flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: "#2a2620", paddingVertical: 5 }}>
                  <Text style={{ fontFamily: SERIF, fontSize: 9, color: COPPER, width: 20 }}>{pad2(index + 1)}</Text>
                  <Text style={{ fontSize: 7.5, lineHeight: 1.5, color: MUTED, flex: 1 }}>{line}</Text>
                </View>
              ))}
            </View>
          )}
          {review.deltas.length > 0 ? (
            <View style={{ borderWidth: 0.75, borderColor: LINE, backgroundColor: PANEL, padding: 8, marginTop: 10 }}>
              <Text style={[styles.factLabel, { color: COPPER }]}>Suggested brief changes</Text>
              {review.deltas.map((delta) => (
                <Text key={delta} style={{ fontSize: 6.8, lineHeight: 1.5, color: MUTED, marginTop: 3 }}>{delta}</Text>
              ))}
            </View>
          ) : null}
        </View>
      </View>
    </SheetPage>
  );
}

// ---------------------------------------------------------------------------
// Back cover

const NEXT_STEPS = [
  { title: "Walk the plan", body: "Take the floor sheets to the family and the plot. Room sizes read differently on the ground than on screen." },
  { title: "Brief a professional", body: "Hand this deck to a licensed architect or contractor. It is a dimensioned starting brief, not a sanction drawing." },
  { title: "Price it properly", body: "Commission a quantity-surveyor estimate from coordinated drawings before budgeting, finance or construction decisions." },
];

function BackCoverPage({ payload, sheetNumber, sheetTotal }: { payload: DeckPayload; sheetNumber: number; sheetTotal: number }) {
  return (
    <Page orientation="landscape" size="A4" style={[styles.page, { justifyContent: "center" }]}>
      <View style={{ alignItems: "center" }}>
        <Text style={{ fontFamily: SERIF, fontSize: 26, color: IVORY }}>BrickPilot</Text>
        <View style={{ height: 0.75, width: 42, backgroundColor: COPPER, marginVertical: 12 }} />
        <Text style={{ fontSize: 9, lineHeight: 1.7, color: MUTED, textAlign: "center", maxWidth: 380 }}>
          Catch the expensive mistakes on screen, not on the slab. A dimensionally-accurate plan, a validation report and a build-cost band — generated in one sitting.
        </Text>
        <View style={{ flexDirection: "row", marginTop: 24, borderWidth: 0.5, borderColor: LINE }}>
          {NEXT_STEPS.map((step, index) => (
            <View key={step.title} style={{ width: 168, backgroundColor: PANEL, padding: 12, borderLeftWidth: index === 0 ? 0 : 0.5, borderLeftColor: LINE }}>
              <Text style={{ fontFamily: SERIF, fontSize: 11, color: COPPER }}>{pad2(index + 1)}</Text>
              <Text style={{ fontSize: 8.5, color: IVORY, marginTop: 4 }}>{step.title}</Text>
              <Text style={{ fontSize: 6.8, lineHeight: 1.55, color: MUTED, marginTop: 3 }}>{step.body}</Text>
            </View>
          ))}
        </View>
      </View>
      <View style={[styles.footer, { alignItems: "center" }]}>
        <Text style={styles.footerText}>{payload.title} · {payload.location}</Text>
        <Text style={[styles.footerText, { color: "#5d534b" }]}>Generated {deckDate(payload.generatedAt)} · Rule pack {payload.validation.rulePackVersion} · Not for construction</Text>
        <Text style={styles.footerText}>Sheet {pad2(sheetNumber)} / {sheetTotal}</Text>
      </View>
    </Page>
  );
}

// ---------------------------------------------------------------------------

export function DeckDocument({ payload, renderImages }: { payload: DeckPayload; renderImages: Map<string, string> }) {
  const slides = deriveDeckSlides(payload);
  const drawing = buildDrawing(payload.building, { scheme: { name: payload.scheme.name, partiId: payload.scheme.partiId, style: payload.requirements.architecture.style } });
  const cover = deckCoverView(payload);

  return (
    <Document>
      {slides.map((slide) => {
        if (slide.kind === "cover") {
          return createElement(CoverPage, { key: "cover", payload, sheetTotal: slide.sheetTotal, heroSrc: cover.heroUrl ? (renderImages.get("exterior_front") ?? null) : null });
        }
        if (slide.kind === "brief") {
          return createElement(BriefPage, { key: "brief", payload, sheetNumber: slide.sheetNumber, sheetTotal: slide.sheetTotal });
        }
        if (slide.kind === "overview") {
          return createElement(OverviewPage, { key: "overview", payload, sheetNumber: slide.sheetNumber, sheetTotal: slide.sheetTotal });
        }
        if (slide.kind === "floor_plan") {
          const artifact = drawing.floors.find((floor) => floor.floorId === slide.floorId) ?? drawing.floors[0];
          return createElement(FloorPlanPage, { key: `floor-${slide.floorId}`, payload, slide, plan: planPrimitives(artifact), artifact });
        }
        if (slide.kind === "render") {
          return createElement(RenderPage, { key: `render-${slide.role}`, payload, sheetNumber: slide.sheetNumber, sheetTotal: slide.sheetTotal, role: slide.role, label: slide.label, src: renderImages.get(slide.role) ?? null });
        }
        if (slide.kind === "room_schedule") {
          return createElement(RoomSchedulePage, { key: "schedule", payload, sheetNumber: slide.sheetNumber, sheetTotal: slide.sheetTotal });
        }
        if (slide.kind === "validation") {
          return createElement(ValidationPage, { key: "validation", payload, sheetNumber: slide.sheetNumber, sheetTotal: slide.sheetTotal });
        }
        if (slide.kind === "cost") {
          return createElement(CostPage, { key: "cost", payload, sheetNumber: slide.sheetNumber, sheetTotal: slide.sheetTotal });
        }
        if (slide.kind === "rationale") {
          return createElement(RationalePage, { key: "rationale", payload, sheetNumber: slide.sheetNumber, sheetTotal: slide.sheetTotal });
        }
        return createElement(BackCoverPage, { key: "back-cover", payload, sheetNumber: slide.sheetNumber, sheetTotal: slide.sheetTotal });
      })}
    </Document>
  );
}
