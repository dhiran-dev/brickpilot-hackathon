# BrickPilot v3 Universal Planning Solver — Option A Implementation Plan

**Date:** 2026-07-19  
**Status:** Implemented and verified  
**Owner:** Primary integration agent  
**Scope:** Schema-v3 detached residential generation on rectangular buildable envelopes  
**Supersedes:** The dense-allocation implementation details in WS5/WS6 of `BRICKPILOT-ARCHITECTURAL-REMEDIATION-IMPLEMENTATION-PLAN-V2.md`. All other lifecycle, rendering, structure, validation, deletion, and legacy-read-only contracts remain normative.

## 1. Outcome

BrickPilot must generate a deterministic, hard-valid concept for every physically feasible schema-v3 brief within its supported scope. It must not make a brief fit by deleting a requested room, changing a hard user choice, allowing access through parking, violating room minimums, or inventing unsupported geometry.

When a brief is physically impossible, the product must return a typed, floor-specific explanation with the smallest useful set of questionnaire changes. It must never collapse an allocation failure into generic `GENERATION_FAILED`.

The reported three-floor Chennai brief is the first regression fixture, not a one-off special case.

## 2. Supported scope

### Included

- Detached residential projects.
- Rectangular site/buildable envelopes.
- One to four modeled floors supported by the current questionnaire contract.
- One or more road edges.
- Compact, articulated/L, T-hub, and courtyard/ring parti intentions.
- Interior rooms, protected circulation, parking, balconies, verandahs, terraces, and courtyards.
- One primary road-side entry and at most the configured secondary entry count.
- Aligned vertical circulation.
- Existing v3 roof, support, guard, facade, drawing, cost, deck, and render consumers.

### Not silently claimed

- Irregular/non-orthogonal sites.
- Apartments, commercial buildings, institutional plans, or mixed-use programs.
- Structural member sizing, foundations, MEP routing, code/permit approval, or licensed architectural approval.

An out-of-scope brief must produce an explicit unsupported-scope result. It must not masquerade as geometric infeasibility.

## 3. Root cause established by reproduction

The saved failed brief has a 9.6 m × 14 m buildable envelope, three floors, and a ground-floor program containing 15 spaces after the required stair is inferred.

- Ground minimum program: approximately 102.4 m².
- Ground requested target: approximately 155 m².
- Ground buildable area: 134.4 m².
- The minimum program is physically plausible.
- The requested target must be softened toward minimums.
- All current topology candidates fail `PROGRAM_AREA_INFEASIBLE:*:dense_connected_partition`.

The existing allocator activates a single rectangular dense partition when requested target area exceeds 90% of the envelope. That partition:

1. Treats indoor rooms, parking, verandah, courtyard, and circulation as peers in one guillotine partition.
2. Requires every pedestrian destination to touch one of a small set of relay rectangles.
3. Represents circulation as one rectangular room instead of a network.
4. Spends its bounded permutation search mostly on boundary-order variants.
5. Cannot form a frontage arrival band plus a rear/branched indoor plan.
6. Rejects the whole feasible brief even though removing only the study or only the verandah makes the current heuristic pass.

The pipeline then catches circulation and validation stage failures but not `V3AllocationGenerationError`, so the API replaces the useful allocation error with generic `GENERATION_FAILED`.

## 4. Non-negotiable invariants

### Requirements

- Every requested room remains present unless its explicit schema policy allows zero area.
- Every allocated room stays within its hard minimum and hard maximum.
- Soft targets may shrink only through a deterministic, recorded target-relaxation policy.
- Explicit entry side, parking side, roof, courtyard, verandah, balcony, shade structure, and above-parking choices remain authoritative.
- Inferred stairs stay aligned between served floors.

### Access and privacy

- Exactly one primary exterior pedestrian entry.
- Primary entry is on a feasible road side.
- Parking, verandah, courtyard, terrace, kitchen, utility, bedroom, bathroom, study, pooja, and store never relay general pedestrian access.
- A protected `circulation` region, foyer, living, dining, or stair may relay access.
- Every attached bathroom connects only through its declared bedroom.
- No private room obtains direct pedestrian access from parking or open exterior space.
- Vehicle access remains independent from pedestrian access.

### Geometry

- Canonical floor regions have no overlaps, no uncovered gaps within the declared floor envelope, and no area outside the envelope.
- Intentional unbuilt area remains explicit.
- Covered outdoor spaces and open-to-sky voids are not classified as interior.
- Main-entry and vehicle-aperture wall-run reservations survive allocation.
- Allocation does not mutate geometry after circulation or validation begins.

### Downstream compatibility

- Current schema-v3 building, validation, drawing, massing, cost, deck, render, support, guard, roof, and facade contracts remain readable.
- Schema-v2 remains frozen and legacy projects remain view-only.
- No database migration is expected for this solver change.
- If implementation reveals a persisted-contract change, work stops at that boundary and requests migration approval.

## 5. Architecture

### 5.1 Program classification

Introduce one authoritative classifier used by allocation and tests:

```ts
type PlanningZoneClass =
  | "interior_relay"
  | "interior_destination"
  | "covered_outdoor"
  | "open_to_sky";
```

Required mapping:

| Class | Room types |
|---|---|
| `interior_relay` | foyer, circulation, living, dining, stair |
| `interior_destination` | bedroom, bathroom, kitchen, utility, study, pooja, store |
| `covered_outdoor` | parking, balcony, verandah |
| `open_to_sky` | courtyard, terrace |

The classifier is semantic. It does not decide final position by itself.

### 5.2 Hard and soft constraints

Represent constraints before search:

```ts
type PlanningConstraint = {
  id: string;
  kind:
    | "area"
    | "boundary"
    | "adjacency"
    | "privacy"
    | "vertical_alignment"
    | "zone"
    | "coverage";
  hardness: "hard" | "soft";
  requirementIds: string[];
  floorId: string;
  measured?: number;
  required?: number;
};
```

Hard constraints may reject a candidate. Soft constraints only affect score or deterministic target relaxation.

Hard:

- Minimum/hard-maximum areas.
- Site/envelope containment.
- Entry and vehicle boundary reservations.
- Attached-bathroom adjacency.
- Vertical stair alignment.
- Privacy/non-relay semantics.
- No overlap and canonical coverage.
- Requested zone existence.

Soft:

- Effective target area above minimum.
- Preferred centroid/zone.
- Compactness and aspect preference.
- Parti resemblance after hard feasibility.
- Surplus/unbuilt-area penalty.

### 5.3 Layered floor model

Allocation runs in layers:

1. **Arrival layer:** reserve the primary entry/foyer wall run and vehicle aperture on feasible road edges.
2. **Exterior layer:** place parking, verandahs, balconies, and terraces in boundary-connected site zones without consuming the interior access graph.
3. **Void layer:** place courtyards/open-to-sky regions as explicit voids with required room exposure.
4. **Circulation layer:** build a connected orthogonal circulation network from foyer/stair to interior destinations.
5. **Room layer:** place rooms around the circulation network while enforcing area and adjacency policies.
6. **Coverage layer:** emit intentional-unbuilt regions for residual cells and audit the complete partition.

The result remains a set of canonical orthogonal polygons. Rectangular rooms remain preferred, but circulation may be composed from multiple connected rectangles and normalized into one orthogonal region.

### 5.4 Deterministic planning structures

The bounded search must attempt structures, not only room permutations:

1. `frontage_backplate`
   - Entry, parking, and optional verandah occupy a road-side arrival band.
   - A protected connector leads to a rear indoor plate.
   - Works for dense same-road arrival programs.
2. `sidecar_spine`
   - Covered outdoor uses occupy a side strip.
   - Interior rooms organize along a longitudinal spine that still reaches the road-side foyer.
3. `dual_loaded_spine`
   - Interior destinations occupy both sides of a corridor.
   - Attached bathroom/bedroom pairs are allocated as a cluster.
4. `branched_t_spine`
   - A short entry stem meets a cross spine.
   - Supports wider and shallower envelopes and T-hub briefs.
5. `courtyard_loop`
   - An open-to-sky void is reserved first.
   - Protected interior circulation wraps enough of the void to reach all destinations.
6. Existing sparse greedy allocation remains a low-density fallback after it is updated to use the same zone and privacy contracts.

For each structure, test road-relative orientations and the topology’s deterministic variants. Stop at a fixed candidate budget and record rejection reasons.

### 5.5 Target relaxation

Do not use one global scale without proof that every room remains legal.

For each floor:

1. Compute the sum of hard minimums by zone.
2. Reject immediately only if hard minimum geometry/area cannot fit.
3. Start at effective targets.
4. Reduce flexible spaces first, then normal rooms, then fixed service spaces, never below minimum.
5. Preserve explicit parking/outdoor maxima and minimums.
6. Record each reduction as a diagnostic containing room ID, requested target, realized target, and reason.
7. Never remove a room or turn covered outdoor space into intentional unbuilt area.

### 5.6 Circulation network realization

Replace the assumption that one rectangular circulation room must touch all destinations.

- A circulation requirement may realize as one normalized orthogonal polygon composed from connected rectangular cells.
- Door-host edges are derived from room-to-network shared boundaries.
- Foyer and stair connect to the network.
- Living/dining may relay access where the existing semantic contract permits, but a feasible candidate should prefer the explicit circulation network.
- Attached bathrooms are excluded from the general network and connect only to their bedroom.
- Non-relay destinations can be graph leaves only.
- The final `V3CirculationGraph` must reach every required destination without parking or open-exterior relay.

### 5.7 Failure contract

`V3AllocationGenerationError` must be caught by `runDesignPipelineV3`.

Map genuine spatial infeasibility to:

```ts
{
  status: "failed",
  code: "NO_FEASIBLE_LAYOUT",
  message: "The requested minimum program cannot fit while preserving access and area rules.",
  conflicts: ValidationFindingV3[],
  diagnostics: { ...allocationDiagnostics }
}
```

Every conflict must contain:

- Stable rule code.
- `floorId`.
- Affected requirement/object IDs.
- Measured and required values when available.
- One concrete suggested questionnaire action.

Generic `GENERATION_FAILED` is reserved for unexpected faults.

## 6. Implementation work packages

### A0 — Baseline cleanup and regression fixture

**Owns**

- `lib/building/fixtures/dense-courtyard-current.ts` (new)
- `lib/building/v3-allocation.test.ts`

**Tasks**

- Remove the unverified frontage/spine and shuffled-permutation experiment currently embedded in `denseProgramPlacements`.
- Add the exact failed questionnaire as a named fixture.
- Prove the fixture fails on the old allocator before the new allocator is wired.
- Record its floor programs, road edges, entry, roof, parking, courtyard, verandah, balconies, and shade structures.

**Exit evidence**

- Fixture parses under `currentBuildingRequirementsSchema`.
- Test failure is specifically `V3AllocationGenerationError`, not contract parsing.

### A1 — Planning-zone and constraint contracts

**Owns**

- `lib/building/planning-zones-v3.ts` (new)
- `lib/building/planning-zones-v3.test.ts` (new)

**Tasks**

- Implement the authoritative zone classifier.
- Implement hard/soft constraint records and deterministic room clusters.
- Cluster attached bedroom/bathroom pairs.
- Export helpers without changing v2 modules.

**Exit evidence**

- Every current `RoomType` maps exactly once.
- Tests prove no private/service/outdoor room is classified as a relay.

### A2 — General-purpose zoned allocator

**Owns**

- `lib/building/candidates/v3-zoned-allocation.ts` (new)
- `lib/building/candidates/v3-allocation.ts` integration points only
- `lib/building/v3-zoned-allocation.test.ts` (new)

**Tasks**

- Implement the six deterministic planning structures.
- Allocate exterior/void/interior layers separately.
- Support multi-rectangle normalized circulation regions.
- Apply room-specific target relaxation.
- Return structured candidate rejections.
- Keep bounded runtime and stable output for identical inputs.

**Exit evidence**

- Exact failed fixture generates at least one allocation scheme.
- Reference fixture still generates three honest schemes.
- Constrained fixture still returns the smaller honest set.
- Impossible minimum-area fixture remains rejected.
- Re-running identical input produces identical geometry hashes.

### A3 — Circulation integration

**Owns**

- `lib/building/candidates/v3-circulation.ts`
- `lib/building/v3-circulation.test.ts`

**Tasks**

- Consume orthogonal/multi-cell circulation regions.
- Derive doors from the circulation network.
- Preserve one main entry and independent vehicle aperture.
- Keep attached bathrooms bedroom-only.
- Prohibit parking, verandah, courtyard, terrace, kitchen, utility, and private destinations from relaying access.

**Exit evidence**

- Exact failed fixture has no unreachable spaces.
- No private door connects to parking/open exterior.
- Main entry is wider and materially distinct from interior doors.

### A4 — Typed pipeline failures and UI guidance

**Owns**

- `lib/server/design-pipeline.ts`
- `lib/server/design-pipeline.test.ts`
- `components/design-workspace-state.ts`
- `components/design-workspace-state.test.ts`

**Tasks**

- Catch `V3AllocationGenerationError`.
- Convert it to typed `NO_FEASIBLE_LAYOUT` with floor-specific findings.
- Preserve diagnostics through API persistence.
- Verify the existing workspace UI shows exact actions and does not show generic `GENERATION_FAILED`.

**Exit evidence**

- Expected infeasibility never produces HTTP 500.
- Unexpected exceptions still produce generic failure handling.
- UI state lists affected floor and actionable changes.

### A5 — Matrix, performance, and compatibility verification

**Owns**

- `lib/building/v3-allocation-matrix.test.ts` (new)
- Existing focused tests only when an assertion must be extended

**Matrix axes**

- Entry side: north/east/south/west.
- Road count: one and two adjacent roads.
- Floors: one, two, three, four.
- Form: compact, articulated, T-hub, courtyard.
- Parking: none, one vehicle.
- Outdoor: none, verandah, balcony, terrace.
- Courtyard: none, open-to-sky.
- Above parking: occupied, balcony, terrace, unbuilt.
- Density: sparse, target-dense, minimum-borderline, impossible.

Use a pairwise matrix plus named high-risk combinations. Do not create a Cartesian explosion that makes the test suite unusable.

**Exit evidence**

- At least 24 deterministic pairwise cases.
- Every physically feasible case generates.
- Every impossible case returns typed findings.
- Per-scheme allocation stays within the agreed bounded candidate count and test timeout.
- No schema-v2 import or behavior changes.

## 7. Agent ownership and merge order

| Agent | Work package | Allowed files |
|---|---|---|
| Solver agent | A1 + new solver core for A2 | New planning-zone and zoned-allocation files/tests only |
| Failure-contract agent | A4 | Pipeline and workspace-state files/tests only |
| Verification agent | A0 fixture + A5 matrix | New fixture/matrix test files; may request but not make solver changes |
| Primary agent | Baseline cleanup, `v3-allocation.ts` integration, A3, conflict resolution, full verification | Shared allocator/circulation integration and final audit |

Merge/integration order:

1. A0 fixture lands.
2. A1 contracts land.
3. A2 solver core lands.
4. Primary agent wires A2 into the allocation stage.
5. A3 and A4 land.
6. A5 matrix runs against the integrated state.
7. Full build and runtime reproduction.

Agents must not edit database schema, migrations, schema-v2 modules, or files owned by another agent. Shared-contract requests return to the primary agent.

## 8. Verification commands

Focused during implementation:

```bash
bun test lib/building/planning-zones-v3.test.ts
bun test lib/building/v3-zoned-allocation.test.ts
bun test lib/building/v3-allocation.test.ts
bun test lib/building/v3-circulation.test.ts
bun test lib/server/design-pipeline.test.ts
bun test components/design-workspace-state.test.ts
bun test lib/building/v3-allocation-matrix.test.ts
```

Integration gates:

```bash
bun run typecheck
bun test
bun run build
```

Runtime gate:

1. Start the dev server with current schema-v3 defaults.
2. Create a fresh project from the exact failed questionnaire fixture.
3. Confirm `POST /api/designs` succeeds.
4. Open the generated project.
5. Confirm at least one selectable, hard-valid plan.
6. Confirm road-side main entry, independent parking access, requested verandah/courtyard, aligned stairs, roof/support/guard output, and no access through parking.
7. Confirm a deliberately impossible brief returns `NO_FEASIBLE_LAYOUT` without HTTP 500.

## 9. Release gates

The implementation is not complete unless all gates pass:

- Exact reported brief generates without dropping a requested feature.
- All named v3 reference fixtures pass.
- Pairwise matrix passes.
- Impossible briefs fail honestly and actionably.
- No hard validation finding in generated schemes.
- No access graph uses parking/open exterior/private/service rooms as relays.
- Main entry and vehicle aperture remain on feasible road edges.
- Room areas remain inside hard policies.
- Identical inputs are deterministic.
- Typecheck, full tests, and production build pass.
- No new database migration is required.
- Existing legacy read-only, project deletion, render restrictions, roof/support/guard, and GPT facade behavior remain green.

## 10. Minimal-compromise policy

Allowed compromises:

- Reduce soft target areas toward declared minimums.
- Return fewer than three schemes when fewer than three distinct hard-valid schemes exist.
- Use explicit intentional-unbuilt regions.
- Prefer a simpler parti when the requested parti cannot satisfy hard constraints, but report the relaxation.

Forbidden compromises:

- Delete requested rooms or outdoor features.
- Violate minimum areas or hard maxima.
- Move the main entry away from all road edges.
- Use parking, verandah, courtyard, terrace, kitchen, utility, bedroom, bathroom, study, pooja, or store as a general corridor.
- Break attached-bathroom privacy.
- Mislabel flat roofs as sloped, solid canopies as pergolas, or unsupported roofs as complete.
- Return duplicate schemes to fill the UI.
- Catch expected infeasibility as generic `GENERATION_FAILED`.

## 11. Subagent return contract

Every subagent returns:

1. Files changed.
2. Contract implemented.
3. Tests run with exact pass/fail counts.
4. Known limitations or assumptions.
5. Shared-file or migration request, if any.
6. A statement that unrelated dirty-worktree changes were preserved.

## 12. Completion evidence table

| Requirement | Authoritative evidence |
|---|---|
| Universal zoning model | Zone classifier tests cover every room type |
| General planning structures | Zoned allocator tests exercise every structure |
| Exact reported failure fixed | Named fixture completes allocation, circulation, physical, and validation stages |
| No feature deletion | Fixture output contains every nonzero requested requirement |
| Privacy preserved | Circulation graph and opening tests |
| Hard areas preserved | Allocation policy assertions and validation report |
| Determinism | Repeated geometry/fingerprint equality |
| Honest impossibility | Typed pipeline test and UI-state test |
| Broad applicability | 24+ pairwise matrix cases |
| No collateral damage | Full `bun test`, typecheck, build, legacy compatibility tests |
| No migration surprise | Git diff contains no DB schema/migration changes for Option A |
