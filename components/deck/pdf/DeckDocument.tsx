import { Document, Image, Line, Page, StyleSheet, Svg, Text, View } from "@react-pdf/renderer";
import type { ComponentProps } from "react";

import { floorPlanToPdfPrimitives } from "@/components/deck/pdf/floorPlanPdf";
import { buildDrawing } from "@/lib/drawing/build-drawing";
import { formatCurrencyMinor } from "@/lib/cost/format";
import { deriveDeckSlides, type DeckPayload } from "@/lib/design/deck";

const INK = "#090908";
const SURFACE = "#171512";
const COPPER = "#c97940";
const LINE = "#8e5a31";
const IVORY = "#fff6ea";
const MUTED = "#b5a697";

const styles = StyleSheet.create({
  page: { backgroundColor: INK, color: IVORY, fontFamily: "Helvetica", padding: 28 },
  eyebrow: { fontSize: 8, fontFamily: "Helvetica-Bold", letterSpacing: 2, color: COPPER, textTransform: "uppercase", marginBottom: 6 },
  headline: { fontSize: 22, fontFamily: "Times-Roman", color: IVORY, marginBottom: 14 },
  titleBlock: { position: "absolute", bottom: 20, left: 28, right: 28, flexDirection: "row", justifyContent: "space-between", borderTopWidth: 1, borderTopColor: LINE, paddingTop: 8 },
  titleBlockText: { fontSize: 7, fontFamily: "Helvetica-Bold", letterSpacing: 1, textTransform: "uppercase", color: MUTED },
  row: { flexDirection: "row" },
  col: { flexDirection: "column" },
});

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
          const scale = 480 / primitives.viewBox.width;
          return (
            <Page key={`floor-${slide.floorId}`} orientation="landscape" size="A4" style={styles.page}>
              <Text style={styles.eyebrow}>Sheet {slide.sheetNumber} — Vector Floor Plan</Text>
              <Text style={styles.headline}>{artifact.floorLabel}</Text>
              <Svg style={{ width: 480, height: primitives.viewBox.depth * scale }} viewBox={`0 0 ${primitives.viewBox.width} ${primitives.viewBox.depth}`}>
                {primitives.walls.map((wall, index) => (
                  <Line key={index} stroke={wall.stroke} strokeWidth={wall.thicknessMm} x1={wall.x1 - primitives.viewBox.x} x2={wall.x2 - primitives.viewBox.x} y1={wall.y1 - primitives.viewBox.y} y2={wall.y2 - primitives.viewBox.y} />
                ))}
                {primitives.roomLabels.map((room, index) => {
                  const labelProps = { fill: IVORY, fontSize: 200, textAnchor: "middle" as const, x: room.x - primitives.viewBox.x, y: room.y - primitives.viewBox.y } as ComponentProps<typeof Text>;
                  return <Text {...labelProps} key={index}>{room.name}</Text>;
                })}
              </Svg>
              <TitleBlock label={`${artifact.floorLabel} · Vector Plan`} payload={payload} sheetNumber={slide.sheetNumber} sheetTotal={slide.sheetTotal} />
            </Page>
          );
        }

        if (slide.kind === "render_gallery") {
          const tiles: Array<{ role: string; label: string }> = [
            { role: "exterior_front", label: "Front / road perspective" },
            { role: "exterior_collage", label: "Four-view collage" },
            { role: "exterior_top", label: "High front-right perspective" },
            { role: "interior", label: "Furnished interior concept" },
          ];
          return (
            <Page key="renders" orientation="landscape" size="A4" style={styles.page}>
              <Text style={styles.eyebrow}>Sheet {slide.sheetNumber} — Concept Renders</Text>
              <Text style={styles.headline}>Camera-locked exterior &amp; interior studies</Text>
              <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
                {tiles.map((tile) => {
                  const src = renderImages.get(tile.role);
                  return (
                    <View key={tile.role} style={{ width: 240, height: 160, backgroundColor: SURFACE }}>
                      {src ? <Image src={src} style={{ width: 240, height: 160 }} /> : null}
                      <Text style={{ fontSize: 7, color: IVORY, position: "absolute", bottom: 4, left: 4 }}>{tile.label}</Text>
                    </View>
                  );
                })}
              </View>
              <TitleBlock label="Concept Renders" payload={payload} sheetNumber={slide.sheetNumber} sheetTotal={slide.sheetTotal} />
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
              {validation.findings.map((finding, index) => (
                <Text key={index} style={{ fontSize: 9, marginBottom: 4, color: finding.severity === "warning" ? "#d9a856" : MUTED }}>{finding.severity.toUpperCase()} · {finding.message}</Text>
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
