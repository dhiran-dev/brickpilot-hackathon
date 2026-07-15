---
name: BrickPilot
description: A dark, high-contrast AI feasibility studio for residential concept design.
colors:
  ink: "#090908"
  surface: "#171512"
  copper: "#c97940"
  orange: "#ff4e00"
  ivory: "#fff6ea"
  muted: "#b5a697"
  line: "#8e5a31"
typography:
  display:
    fontFamily: "Iowan Old Style, Palatino Linotype, Book Antiqua, Palatino, serif"
    fontSize: "clamp(3.6rem, 7.7vw, 6rem)"
    fontWeight: 400
    lineHeight: 0.9
    letterSpacing: "-0.038em"
  body:
    fontFamily: "Avenir Next, Gill Sans, Trebuchet MS, sans-serif"
    fontSize: "1rem"
    fontWeight: 400
    lineHeight: 1.7
  label:
    fontFamily: "Avenir Next, Helvetica Neue, Gill Sans, sans-serif"
    fontSize: "0.78rem"
    fontWeight: 700
    letterSpacing: "0.12em"
rounded:
  sharp: "0px"
spacing:
  compact: "0.75rem"
  base: "1.25rem"
  generous: "2.4rem"
components:
  button-primary:
    backgroundColor: "{colors.orange}"
    textColor: "{colors.ivory}"
    typography: "{typography.label}"
    rounded: "{rounded.sharp}"
    padding: "1.05rem 1.35rem"
  button-primary-hover:
    backgroundColor: "#e94500"
    textColor: "{colors.ivory}"
    typography: "{typography.label}"
    rounded: "{rounded.sharp}"
    padding: "1.05rem 1.35rem"
---

# Design System: BrickPilot

## Overview

**Creative North Star: "The After-Hours Drafting Table"**

BrickPilot is a dark-only residential feasibility studio. It should feel like an architect’s calm final review: black drafting material, warm ivory type, copper geometry, and one decisive orange action. The interface is deliberate and spatial, never dashboard-generic.

The dark sample at `/dark-sample` is the visual source of truth. Existing warm surfaces are transitional and must migrate to this system when they are next touched.

**Key Characteristics:**
- Quiet black surfaces with structural copper rules.
- A classical display serif against a precise humanist sans.
- Plan boards and measurements used as real product artifacts, never decoration.
- Orange reserved for the primary action and the most important decision.

## Colors

The palette is a low-light material study: graphite carries the canvas, copper carries structure, and orange carries commitment.

### Primary
- **Decision Orange:** used only for the primary action, active markers, and the terminal emphasis in a headline.

### Secondary
- **Drafting Copper:** used for architectural lines, borders, technical labels, and restrained navigation emphasis.

### Neutral
- **Graphite Ink:** the page ground and deepest contrast field.
- **Charcoal Surface:** board and contained-surface material.
- **Warm Ivory:** primary display and action text.
- **Lamp-Down Muted:** body copy and secondary metadata.

**The One Orange Rule.** Orange must occupy less than 10% of a screen. It is a decision signal, never a background theme.

## Typography

**Display Font:** Iowan Old Style with Palatino-family fallbacks.
**Body Font:** Avenir Next with Gill Sans and Trebuchet MS fallbacks.
**Label Font:** Avenir Next with Helvetica Neue and Gill Sans fallbacks.

**Character:** The display face gives a house its gravity; the sans face makes the feasibility evidence feel measured and current. Do not introduce a mono font just to imply technicality.

### Hierarchy
- **Display** (400, `clamp(3.6rem, 7.7vw, 6rem)`, 0.9): hero statements only; use warm ivory, never more negative than `-0.038em` tracking.
- **Headline** (400, `1.35rem–2.5rem`, 1.05): plan summaries and the brand mark.
- **Title** (700, `0.73rem`, 1.2): capability names and dense labels.
- **Body** (400, `1rem`, 1.7): explanatory copy; keep practical reading blocks under 65ch.
- **Label** (700, `0.78rem`, `0.12em`, uppercase): primary actions and technical metadata only.

**The Drafting Hierarchy Rule.** Display serif carries the human promise; labels and measurements carry the proof.

## Elevation

Depth is structural, not soft. Board surfaces use an offset, hard-edged shadow and a fine copper edge; the rest of the page remains flat and matte. Tonal shifts and precise borders create hierarchy before any shadow does.

### Shadow Vocabulary
- **Pinned Board** (`10px 11px 0 rgba(20, 18, 16, 0.82)`): use only for a featured concept board or a deliberately lifted artifact.

**The Pinned Artifact Rule.** Never put a wide soft shadow behind a bordered card. A surface is either flat or physically pinned.

## Components

### Buttons
- **Shape:** square and decisive (`0px` radius).
- **Primary:** Decision Orange with Warm Ivory text, `1.05rem 1.35rem` padding, uppercase Avenir/Helvetica label at `0.12em` tracking.
- **Hover / Focus:** darken only to `#e94500`; lift by at most 2px and show a visible Warm Ivory focus outline.
- **Secondary:** transparent Graphite Ink with a single 1px Drafting Copper border and Warm Ivory text.

### Cards / Containers
- **Corner Style:** no rounding (`0px`).
- **Background:** Charcoal Surface for concept boards; Graphite Ink for ordinary regions.
- **Shadow Strategy:** only featured pinned artifacts receive the Pinned Board shadow.
- **Border:** one 1px Drafting Copper rule at reduced opacity.
- **Internal Padding:** Compact for labels, Base for panels, Generous for a main action group.

### Navigation
- **Style:** a thin copper rule anchors the header. The wordmark is display serif; navigation is a small uppercase sans with restrained tracking.
- **State:** inactive links use Warm Ivory at reduced opacity; hover changes to Drafting Copper. Mobile may collapse navigation, but sign-in remains visible.

### Concept Board
- **Style:** a pinned Charcoal Surface containing an actual floor-plan or site-plan artifact, copper measurement lines, and Warm Ivory wall geometry.
- **State:** static proof pages present the board as evidence; interactive pages may add selection and generation states without changing the material language.

## Do's and Don'ts

### Do:
- **Do** use `#ff4e00` only for a primary decision, active constraint, or a single headline terminal mark.
- **Do** keep every surface square, measured, and materially distinct.
- **Do** use plan lines, dimensions, and site geometry only when they describe an actual design artifact.
- **Do** preserve high contrast: Warm Ivory on Graphite Ink, and never subdued gray text for primary information.
- **Do** respect reduced motion; transitions should only clarify hover and focus state.

### Don't:
- **Don't** reintroduce light, cream, sand, or paper page backgrounds. BrickPilot is dark-only.
- **Don't** use purple gradients, neon accents, glassmorphism, or pill-shaped SaaS controls.
- **Don't** use rounded cards, soft ghost shadows, decorative grid overlays, or colored side stripes.
- **Don't** use mono typography as technical costume or repeat tiny uppercase eyebrows as page scaffolding.
- **Don't** substitute generic dashboard metrics for a concrete plan board, validation evidence, or an actionable decision.
