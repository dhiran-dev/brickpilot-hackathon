# TODOS

Deferred work with full context. Source of truth for "later" — if it isn't here, it doesn't exist.

## P2 — Correct intermediate-floor roof semantics
- **What:** Generate pitched roof systems only over the actual top exterior roof unless a lower-level wing is genuinely exposed. Intermediate occupied floors and transfer slabs should remain flat; lower-floor rooms must not receive partial gable or hip fragments merely because the upper footprint is stepped.
- **Why:** Current exposed-fragment roof synthesis can place a partial sloped roof on ground and intermediate floors. The geometry is technically traceable but visually misleading in floor plans and massing.
- **Temporary product decision:** Roof-character selection is hidden and roof overlays are omitted from 2D floor-plan sheets. Canonical roof geometry remains available to 3D massing, render grounding, validation, and quantities.
- **Acceptance:** A multi-floor stepped scheme shows flat intermediate slabs, pitched geometry only over the true top/exposed roof, and no roof plane intersects an occupied upper storey.
- **Effort:** M. **Priority:** P2.
- **Decision trail:** Deferred by user on 2026-07-19 to avoid spending time on roof generation during workspace cleanup.

## P2 — Regional convention packs (E4)
- **What:** Optional per-region convention packs applied as soft preferences with a questionnaire toggle: India Vastu-lite (NE pooja, E/N entry preference), East Asia feng-shui-lite (entry/kitchen placement), Gulf (majlis / gender-separable reception), Western (mudroom, en-suite conventions).
- **Why:** "Suitable in various regions" beyond climate/materials; cultural placement conventions are real purchase criteria.
- **Pros:** Deepens regional credibility; pure data + soft-scoring wiring on existing preference machinery.
- **Cons:** Each pack needs culturally sensible defaults to avoid caricature; low urgency while climate packs are new.
- **Context:** India pooja/NE handling already exists (`lib/building/room-defaults.ts`, intake). Generalize only after regional taste packs (S4 of the 2026-07-16 implementation plan) ship. Never hard gates — soft preferences only.
- **Effort:** S-M (human ~1 day / CC ~1 h). **Priority:** P2. **Depends on:** S4 regional packs shipped.
- **Decision trail:** Deferred in /plan-ceo-review cherry-pick D3.4 (2026-07-16).

## P2 — International cost rate packs
- **What:** Coarse indexed cost packs beyond India (per economic/climate region, labeled low-confidence) so non-India briefs show a budget band instead of "cost unavailable".
- **Why:** Worldwide suitability promise; cost is half the product's value proposition.
- **Pros:** Completes the regional story; packs are additive data files (`lib/cost/rate-packs/`).
- **Cons:** Sourcing defensible numbers is research work; rough global rates risk misleading users — must carry explicit low-confidence labeling.
- **Context:** Only `india-delhi-feasibility-2026-07.ts` exists; `lib/cost/selection.ts` already degrades gracefully to `unsupported_region`. UI shows an honest empty state today.
- **Effort:** M (human ~2 days incl. research / CC ~1 h once numbers chosen). **Priority:** P2. **Depends on:** nothing.
- **Decision trail:** Deferred in /plan-ceo-review TODO ceremony (2026-07-16).

## P3 — Room labels in massing view (E4)
- **What:** Space-name labels anchored to room centroids in the 3D massing viewer, with occlusion/legibility handling.
- **Why:** External 3D review asked for legibility; labels are the next step after fills/parapets/scale refs.
- **Context:** Deferred from the massing quick-wins plan — label layout/occlusion/anchoring is outside the quick-win blast radius.
- **Effort:** M (human ~1 day / CC ~1 h). **Priority:** P3.
- **Decision trail:** Deferred in /autoplan CEO review E4 (2026-07-17).

## P3 — Demo-rehearsal hardening (E7)
- **What:** Cached known-good renders, a frozen demo project, and a render-failure fallback path for live demos.
- **Why:** A live GPT render failure mid-demo has no recovery path today.
- **Context:** Out of massing blast radius; flagged as a CEO concern at the quick-wins gate.
- **Effort:** M. **Priority:** P3.
- **Decision trail:** Deferred in /autoplan CEO review E7 (2026-07-17).

## P3 — Balcony railing mechanism
- **What:** Balconies (`balcony` room type) get full solid walls today — no railing/parapet mechanism exists for them.
- **Why:** `balcony` is not in `OPEN_TO_SKY_TYPES` (lib/building/topology.ts), so the parapet branch never fires; fixing it means changing balcony wall generation (deeper, riskier).
- **Context:** Documented known gap from massing quick-wins item 3; not silently worked around.
- **Effort:** M. **Priority:** P3.
- **Decision trail:** Scoped out in massing quick-wins plan item 3 / decision D14 (2026-07-17).
