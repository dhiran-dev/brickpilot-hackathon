import { Document, Image, Line, Page, Polygon, Rect, StyleSheet, Svg, Text, View } from "@react-pdf/renderer";
import type { ComponentProps } from "react";

import { floorPlanToPdfPrimitives } from "@/components/deck/pdf/floorPlanPdf";
import { areaLabel } from "@/lib/drawing/build-drawing";
import { buildDrawing } from "@/lib/drawing/build-drawing";
import { formatCurrencyMinor } from "@/lib/cost/format";
import { deriveDeckSlides, type DeckPayload } from "@/lib/design/deck";

const INK = "#090908";
const SURFACE = "#171512";
const COPPER = "#c97940";
const LINE = "#8e5a31";
const IVORY = "#fff6ea";
const MUTED = "#b5a697";
const DIM = "#5d534b";
const WARNING = "#d9a856";

const styles = StyleSheet.create({
  page: { backgroundColor: INK, color: IVORY, fontFamily: "Helvetica", padding: 28 },
  eyebrow: { fontSize: 8, fontFamily: "Helvetica-Bold", letterSpacing: 2, color: COPPER, textTransform: "uppercase", marginBottom: 6 },
  headline: { fontSize: 22, fontFamily: "Times-Roman", color: IVORY, marginBottom: 14 },
  titleBlock: { position: "absolute", bottom: 20, left: 28, right: 28, flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: LINE, paddingTop: 8 },
  titleBlockText: { fontSize: 7, fontFamily: "Helvetica-Bold", letterSpacing: 1, textTransform: "uppercase", color: MUTED },
  row: { flexDirection: "row" },
  col: { flexDirection: "column" },
  sidebarSection: { fontSize: 7, fontFamily: "Helvetica-Bold", letterSpacing: 1.5, textTransform: "uppercase", color: COPPER, marginBottom: 6 },
  sidebarRow: { flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 0.5, borderBottomColor: LINE, paddingVertical: 3 },
  sidebarRowText: { fontSize: 8, color: IVORY },
  sidebarRowValue: { fontSize: 8, color: IVORY },
  statBox: { backgroundColor: INK, paddingVertical: 6, paddingHorizontal: 8 },
  statValue: { fontSize: 14, fontFamily: "Times-Roman", color: IVORY },
  statLabel: { fontSize: 5.5, fontFamily: "Helvetica-Bold", letterSpacing: 0.8, textTransform: "uppercase", color: DIM, marginTop: 1 },
});

const RENDER_TILES: Array<{ role: string; label: string }> = [
  { role: "exterior_front", label: "Front / road perspective" },
  { role: "exterior_collage", label: "Four-view collage" },
  { role: "exterior_top", label: "High front-right perspective" },
  { role: "interior", label: "Furnished interior concept" },
];

function TitleBlock({ payload, sheetNumber, sheetTotal, label }: { payload: DeckPayload; sheetNumber: number; sheetTotal: number; label: string }) {
  return (
    <View style={styles.titleBlock}>
      <Text style={styles.titleBlockText}>{payload.title}</Text>
      <Text style={[styles.titleBlockText, { color: COPPER }]}>{label}</Text>
      <Text style={styles.titleBlockText}>Sheet {sheetNumber} / {sheetTotal}</Text>
    </View>
  );
}

export function DeckDocument({ payload, renderImages }: { payload: DeckPayload; renderImages: Map<string, string> }) {
  const slides = deriveDeckSlides(payload);
  const drawing = buildDrawing(payload.building, { scheme: { name: payload.scheme.name, partiId: payload.scheme.partiId, style: payload.requirements.architecture.style } });

  return (
    <Document>
      {slides.map((slide) => {
        if (slide.kind === "cover") {
          const hero = renderImages.get("exterior_front");
          return (
            <Page key="cover" orientation="landscape" size="A4" style={[styles.page, { justifyContent: "flex-end" }]}>
              {hero ? <Image src={hero} style={{ position: "absolute", top: 0, left: 0, right: 0, bottom: 0, opacity: 0.55 }} /> : null}
              <Text style={styles.eyebrow}>Concept Design Deck</Text>
              <Text style={[styles.headline, { fontSize: 34 }]}>{payload.title}</Text>
              <View style={styles.row}>
                <Text style={{ fontSize: 10, color: MUTED, marginRight: 24 }}>{payload.location}</Text>
                <Text style={{ fontSize: 10, color: MUTED }}>{(payload.requirements.site.widthMm / 1000).toFixed(1)}m x {(payload.requirements.site.depthMm / 1000).toFixed(1)}m</Text>
              </View>
            </Page>
          );
        }

        if (slide.kind === "overview") {
          return (
            <Page key="overview" orientation="landscape" size="A4" style={styles.page}>
              <Text style={styles.eyebrow}>Sheet {slide.sheetNumber} — Project Overview</Text>
              <Text style={styles.headline}>{payload.scheme.name}</Text>
              <Text style={{ fontSize: 11, lineHeight: 1.6, color: IVORY, maxWidth: 420 }}>{payload.scheme.rationale}</Text>
              <TitleBlock label="Project Overview" payload={payload} sheetNumber={slide.sheetNumber} sheetTotal={slide.sheetTotal} />
            </Page>
          );
        }

        if (slide.kind === "floor_plan") {
          const artifact = drawing.floors.find((floor) => floor.floorId === slide.floorId) ?? drawing.floors[0];
          const primitives = floorPlanToPdfPrimitives(artifact);
          const planWidth = 460;
          const scale = planWidth / primitives.viewBox.width;
          const planHeight = primitives.viewBox.depth * scale;
          const totalAchievedM2 = artifact.rooms.reduce((sum, room) => sum + room.areaMm2, 0) / 1_000_000;
          const envelopeM2 = (artifact.envelope.width * artifact.envelope.depth) / 1_000_000;
          const efficiency = totalAchievedM2 > 0 && envelopeM2 > 0 ? Math.round((totalAchievedM2 / envelopeM2) * 100) : 0;
          const roomCount = artifact.rooms.length;
          const wallCount = artifact.walls.length;
          const openingCount = artifact.openings.length;
          const vbx = primitives.viewBox.x;
          const vby = primitives.viewBox.y;
          return (
            <Page key={`floor-${slide.floorId}`} orientation="landscape" size="A4" style={styles.page}>
              <Text style={styles.eyebrow}>Sheet {slide.sheetNumber} — Vector Floor Plan</Text>
              <Text style={styles.headline}>{artifact.floorLabel} · {roomCount} rooms</Text>
              <View style={{ flexDirection: "row", flex: 1 }}>
                <View style={{ flex: 1, backgroundColor: INK, marginRight: 16 }}>
                  <Svg style={{ width: planWidth, height: planHeight }} viewBox={`0 0 ${primitives.viewBox.width} ${primitives.viewBox.depth}`}>
                    <Rect fill="#0b0a09" height={primitives.viewBox.depth} width={primitives.viewBox.width} x={0} y={0} />
                    <Rect fill="none" height={primitives.site.depth - vby} stroke="#8e5a31" strokeDasharray="160 90" strokeWidth={60} width={primitives.site.width} x={primitives.site.x - vbx} y={primitives.site.y - vby} />
                    {primitives.roomFills.map((room, index) => {
                      const fillProps = { fill: room.fill, fillOpacity: room.opacity } as ComponentProps<typeof Polygon>;
                      return <Polygon {...fillProps} key={`fill-${index}`} points={room.points.split(" ").map((p) => {
                        const [px, py] = p.split(",").map(Number);
                        return `${px - vbx},${py - vby}`;
                      }).join(" ")} />;
                    })}
                    {primitives.walls.map((wall, index) => (
                      <Line key={`wall-${index}`} stroke={wall.stroke} strokeWidth={wall.thicknessMm} x1={wall.x1 - vbx} x2={wall.x2 - vbx} y1={wall.y1 - vby} y2={wall.y2 - vby} />
                    ))}
                    {primitives.openings.map((op, index) => (
                      <Line key={`op-${index}`} stroke={op.stroke} strokeWidth={100} x1={op.x1 - vbx} x2={op.x2 - vbx} y1={op.y1 - vby} y2={op.y2 - vby} />
                    ))}
                    {primitives.furniture.map((f, index) => (
                      <Rect key={`fur-${index}`} fill="none" height={f.depth} stroke={f.stroke} strokeWidth={50} width={f.width} x={f.x - vbx} y={f.y - vby} />
                    ))}
                    {primitives.roomLabels.map((room, index) => {
                      const labelProps = { fill: IVORY, fontSize: room.fontSize, textAnchor: "middle" as const, x: room.x - vbx, y: room.y - vby } as ComponentProps<typeof Text>;
                      return <Text {...labelProps} key={`label-${index}`}>{room.name}</Text>;
                    })}
                    {primitives.areaLabels.map((area, index) => {
                      const areaProps = { fill: MUTED, fontSize: Math.max(area.fontSize * 0.65, 100), textAnchor: "middle" as const, x: area.x - vbx, y: area.y - vby } as ComponentProps<typeof Text>;
                      return <Text {...areaProps} key={`area-${index}`}>{area.label}</Text>;
                    })}
                    {primitives.dimensions.map((dim, index) => {
                      const dimProps = { fill: COPPER, fontSize: 200, textAnchor: "middle" as const, x: dim.x - vbx, y: dim.y - vby } as ComponentProps<typeof Text>;
                      return <Text {...dimProps} key={`dim-${index}`}>{dim.label}</Text>;
                    })}
                  </Svg>
                </View>

                <View style={{ width: 180, backgroundColor: "#0c0b09", paddingLeft: 12, paddingRight: 12, paddingTop: 4, paddingBottom: 4 }}>
                  <View style={{ flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", marginBottom: 6 }}>
                    <View style={{ flexDirection: "row", alignItems: "baseline" }}>
                      <Text style={{ fontSize: 24, fontFamily: "Times-Roman", color: IVORY }}>{totalAchievedM2.toFixed(1)}</Text>
                      <Text style={{ fontSize: 8, color: MUTED, marginLeft: 3 }}>m2</Text>
                    </View>
                    <Text style={{ fontSize: 6, color: DIM }}>{efficiency}% eff</Text>
                  </View>

                  <View style={{ flexDirection: "row", borderTopWidth: 0.5, borderTopColor: LINE, borderBottomWidth: 0.5, borderBottomColor: LINE }}>
                    {[["Rooms", roomCount], ["Walls", wallCount], ["Doors", openingCount]].map(([label, value]) => (
                      <View key={label as string} style={{ flex: 1, paddingVertical: 4, paddingHorizontal: 3, borderLeftWidth: label === "Rooms" ? 0 : 0.5, borderLeftColor: LINE }}>
                        <Text style={styles.statValue}>{value}</Text>
                        <Text style={styles.statLabel}>{label}</Text>
                      </View>
                    ))}
                  </View>

                  <Text style={[styles.sidebarSection, { marginTop: 10 }]}>Area Schedule</Text>
                  {artifact.areaSchedule.map((row) => (
                    <View key={row.ref} style={styles.sidebarRow}>
                      <Text style={[styles.sidebarRowText, { flex: 1 }]}>{row.name}</Text>
                      <Text style={[styles.sidebarRowValue, { color: row.underTarget ? WARNING : IVORY }]}>{areaLabel(row.achievedAreaMm2)}</Text>
                    </View>
                  ))}

                  {artifact.dimensions.overall.length > 0 ? (
                    <Text style={[styles.sidebarSection, { marginTop: 10 }]}>Dimensions</Text>
                  ) : null}
                  {artifact.dimensions.overall.map((dim) => (
                    <View key={dim.id} style={styles.sidebarRow}>
                      <Text style={[styles.sidebarRowText, { color: DIM, textTransform: "uppercase" }]}>{dim.orientation}</Text>
                      <Text style={styles.sidebarRowValue}>{dim.label}</Text>
                    </View>
                  ))}

                  <Text style={{ fontSize: 5, color: DIM, marginTop: "auto", paddingTop: 8 }}>
                    {(artifact.envelope.width / 1000).toFixed(1)}x{(artifact.envelope.depth / 1000).toFixed(1)} m plate · Seed {artifact.metadata.seed}
                  </Text>
                </View>
              </View>
              <TitleBlock label={`${artifact.floorLabel} · Vector Plan`} payload={payload} sheetNumber={slide.sheetNumber} sheetTotal={slide.sheetTotal} />
            </Page>
          );
        }

        if (slide.kind === "render") {
          const src = renderImages.get(slide.role);
          return (
            <Page key={`render-${slide.role}`} orientation="landscape" size="A4" style={styles.page}>
              <Text style={styles.eyebrow}>Sheet {slide.sheetNumber} — Concept Render</Text>
              <Text style={styles.headline}>{slide.label}</Text>
              {src ? (
                <Image src={src} style={{ width: 660, height: 400, marginTop: 10 }} />
              ) : (
                <View style={{ width: 660, height: 400, backgroundColor: SURFACE, marginTop: 10, justifyContent: "center", alignItems: "center" }}>
                  <Text style={{ fontSize: 9, color: MUTED }}>{slide.label} · unavailable</Text>
                </View>
              )}
              <TitleBlock label={slide.label} payload={payload} sheetNumber={slide.sheetNumber} sheetTotal={slide.sheetTotal} />
            </Page>
          );
        }

        if (slide.kind === "room_schedule") {
          const rows = drawing.floors.flatMap((floor) => floor.rooms.map((room) => ({ ...room, floorLabel: floor.floorLabel })));
          return (
            <Page key="schedule" orientation="landscape" size="A4" style={styles.page}>
              <Text style={styles.eyebrow}>Sheet {slide.sheetNumber} — Consolidated Room Schedule</Text>
              <Text style={styles.headline}>Every space, both floors, one table</Text>
              <View>
                {rows.map((room) => (
                  <View key={room.id} style={{ flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 0.5, borderBottomColor: LINE, paddingVertical: 4 }}>
                    <Text style={{ fontSize: 9, width: 160 }}>{room.name}</Text>
                    <Text style={{ fontSize: 9, width: 100, color: MUTED }}>{room.floorLabel}</Text>
                    <Text style={{ fontSize: 9, width: 80, textAlign: "right" }}>{(room.areaMm2 / 1_000_000).toFixed(1)} m2</Text>
                  </View>
                ))}
              </View>
              <TitleBlock label="Room Schedule" payload={payload} sheetNumber={slide.sheetNumber} sheetTotal={slide.sheetTotal} />
            </Page>
          );
        }

        if (slide.kind === "validation") {
          const { validation } = payload;
          return (
            <Page key="validation" orientation="landscape" size="A4" style={styles.page}>
              <Text style={styles.eyebrow}>Sheet {slide.sheetNumber} — Validation Report</Text>
              <Text style={styles.headline}>Score {validation.score} / 100</Text>
              <Text style={{ fontSize: 9, color: MUTED, marginBottom: 10 }}>{validation.counts.error} errors · {validation.counts.warning} warnings · {validation.counts.info} info</Text>
              {validation.findings.length === 0 ? (
                <Text style={{ fontSize: 10, color: IVORY }}>No findings — this plan passed every rule with no warnings.</Text>
              ) : validation.findings.map((finding, index) => (
                <Text key={index} style={{ fontSize: 9, marginBottom: 4, color: finding.severity === "warning" ? "#d9a856" : finding.severity === "error" ? "#e2665a" : MUTED }}>{finding.severity.toUpperCase()} · {finding.category} · {finding.message}</Text>
              ))}
              <TitleBlock label="Validation Report" payload={payload} sheetNumber={slide.sheetNumber} sheetTotal={slide.sheetTotal} />
            </Page>
          );
        }

        if (slide.kind === "cost") {
          const { costEstimate } = payload;
          return (
            <Page key="cost" orientation="landscape" size="A4" style={styles.page}>
              <Text style={styles.eyebrow}>Sheet {slide.sheetNumber} — Build Cost Estimate</Text>
              {costEstimate.status === "unavailable" ? (
                <Text style={styles.headline}>Cost estimate unavailable</Text>
              ) : (
                <>
                  <Text style={styles.headline}>{formatCurrencyMinor(costEstimate.total.expectedMinor, costEstimate.currency, costEstimate.locale)} expected total</Text>
                  {costEstimate.lineItems.map((lineItem) => (
                    <View key={lineItem.id} style={{ flexDirection: "row", justifyContent: "space-between", borderBottomWidth: 0.5, borderBottomColor: LINE, paddingVertical: 4 }}>
                      <Text style={{ fontSize: 9, width: 200 }}>{lineItem.label}</Text>
                      <Text style={{ fontSize: 9 }}>{formatCurrencyMinor(lineItem.amounts.expectedMinor, costEstimate.currency, costEstimate.locale)}</Text>
                    </View>
                  ))}
                </>
              )}
              <TitleBlock label="Cost Estimate" payload={payload} sheetNumber={slide.sheetNumber} sheetTotal={slide.sheetTotal} />
            </Page>
          );
        }

        if (slide.kind === "rationale") {
          return (
            <Page key="rationale" orientation="landscape" size="A4" style={styles.page}>
              <Text style={styles.eyebrow}>Sheet {slide.sheetNumber} — Design Rationale</Text>
              <Text style={styles.headline}>Why this scheme</Text>
              <Text style={{ fontSize: 10, lineHeight: 1.6, maxWidth: 420 }}>{payload.scheme.rationale}</Text>
              <TitleBlock label="Design Rationale" payload={payload} sheetNumber={slide.sheetNumber} sheetTotal={slide.sheetTotal} />
            </Page>
          );
        }

        return (
          <Page key="back-cover" orientation="landscape" size="A4" style={[styles.page, { alignItems: "center", justifyContent: "center" }]}>
            <Text style={{ fontFamily: "Times-Roman", fontSize: 26, color: IVORY, marginBottom: 10 }}>BrickPilot</Text>
            <Text style={{ fontSize: 10, color: MUTED, maxWidth: 320, textAlign: "center" }}>
              Catch the expensive mistakes on screen, not on the slab.
            </Text>
          </Page>
        );
      })}
    </Document>
  );
}
