# WS3 schema importer inventory

Generated 2026-07-18 with:

```bash
rg -l '@/lib/building/schema' --glob '!**/*.test.*' --glob '!node_modules/**' --glob '!reference/**' .
rg -l '@/lib/building/requirements' --glob '!**/*.test.*' --glob '!node_modules/**' --glob '!reference/**' .
```

This inventory covers every non-test importer found at the WS3 merge boundary. Existing imports remain pinned to the frozen v2 aliases unless the owning workstream deliberately adopts `Current*` or `Readable*` contracts.

## WS3 — schema/read/dispatch adapters

- `components/guided-intake/model.ts`
- `lib/building/requirements.ts`
- `lib/building/schema.ts`
- `lib/design/persisted-study.ts`
- `lib/design/study-result.ts`
- `lib/server/design-pipeline.ts`

## WS4–WS8 — generation, topology, physical systems, and validation

- `lib/building/access-contract.ts` — WS6
- `lib/building/candidates/balcony-remainder.ts` — WS5
- `lib/building/candidates/parti-tiler.ts` — WS4/WS5
- `lib/building/candidates/recursive-slicing.ts` — WS4/WS5
- `lib/building/candidates/spine-growth.ts` — WS4/WS5
- `lib/building/candidates/types.ts` — WS4/WS5
- `lib/building/circulation.ts` — WS6
- `lib/building/dimensions.ts` — WS5/WS6
- `lib/building/fixtures.ts` — WS4–WS8 fixture migration
- `lib/building/fixtures/reference-articulated-sloped.ts` — WS4–WS8 fixture migration
- `lib/building/form.ts` — WS4
- `lib/building/generate.ts` — WS4/WS5
- `lib/building/openings.ts` — WS6
- `lib/building/parti-ascii.ts` — WS4
- `lib/building/partis.ts` — WS4
- `lib/building/room-defaults.ts` — WS5
- `lib/building/scoring.ts` — WS8
- `lib/building/space-semantics.ts` — WS6
- `lib/building/structure.ts` — WS7
- `lib/building/topology.ts` — WS5/WS6
- `lib/building/vertical.ts` — WS5/WS7
- `lib/validation/shape-rule-fixtures.ts` — WS8
- `lib/validation/shape-rule-sweep.ts` — WS8
- `lib/validation/shape-rules.ts` — WS8
- `lib/validation/validate.ts` — WS8

## WS7/WS7B — massing and output consumers

- `components/massing/MassingViewer.tsx` — WS7
- `components/massing/MassingWorkspace.tsx` — WS7
- `components/cad-plan/CadPlan.tsx` — WS7B
- `components/cad-workspace/CadWorkspace.tsx` — WS7B
- `components/deck/planPrimitives.ts` — WS7B
- `lib/cost/estimate.ts` — WS7B
- `lib/cost/quantity.ts` — WS7B
- `lib/cost/selection.ts` — WS7B
- `lib/design/deck.ts` — WS7B
- `lib/drawing/build-drawing.ts` — WS7B
- `lib/drawing/schema.ts` — WS7B
- `lib/render/massing.ts` — WS7

## WS9 — AI, prompt, and render-reference consumers

- `lib/ai/apply-delta.ts`
- `lib/ai/architectural-review.ts`
- `lib/ai/intake.ts`
- `lib/ai/schema.ts`
- `lib/render/prompts.ts`
- `lib/render/reference-plan.ts`

## WS1/WS10 — lifecycle and mutation boundaries

- `app/api/designs/route.ts` — WS1 contract reservation/dispatch
- `app/api/designs/[layoutVersionId]/route.ts` — WS1 readable project response
- `app/api/designs/[layoutVersionId]/apply-suggestion/route.ts` — WS1 capability plus version dispatch
- `app/api/designs/[layoutVersionId]/select-scheme/route.ts` — WS1 capability plus version dispatch
- `app/api/designs/[layoutVersionId]/renders/route.ts` — WS10 lifecycle gate/read adapter
- `lib/render/finalize-job.ts` — WS10 lifecycle/read adapter

## WS1B — UI capability/read boundaries

- `components/design-workspace.tsx`
- `components/guided-intake/GuidedIntake.tsx`
- `components/guided-intake/NaturalLanguageIntake.tsx`

## Other read-only policy consumers

- `lib/design/regional-packs.ts` — keep v2 alias until a v3 regional-policy workstream is explicitly assigned

No importer in this list may switch the historical `Building`, `BuildingRequirements`, `buildingSchema`, or `buildingRequirementsSchema` aliases to a readable union implicitly. Version-aware adoption must use the explicit `Legacy*`, `Current*`, or `Readable*` export matching the consumer's role.
