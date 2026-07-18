# BrickPilot Architectural Remediation Implementation Plan v2

**Date:** 2026-07-18  
**Status:** Normative implementation plan, revised after three independent reviews  
**Reference design:** `a3c15af1-f251-4bbd-8526-4299cff5765c`  
**Reference project:** `ce04575c-f599-4330-a66a-11adcaba6ad4`  
**Purpose:** Correct project lifecycle, spatial planning, architectural geometry, validation, massing, and GPT elevation behavior without changing unrelated product functionality.

This document supersedes the earlier plan and its inline adversarial amendments. Everything here is normative. There is no “old solution” text for implementers to interpret.

## 1. Required outcomes

The implementation is complete only when all of these are true:

1. Starting a new project never hydrates answers from an older project or draft.
2. Projects classified as legacy remain viewable and deletable but cannot run AI analysis, create derived layouts, change schemes, upload new render references, or generate/retry GPT renders.
3. Scheme cards represent genuinely different spatial topologies when the plot supports them.
4. Parking and exterior verandahs do not act as unrestricted corridors into private rooms.
5. Door dimensions and appearance follow semantic roles; the main door is larger and visually distinct.
6. A sloped-roof choice produces deterministic pitched geometry in plan outputs, massing, quantity takeoff, deck, and render references.
7. Every canopy/pergola roof has explicit wall, ledger, or post support.
8. The main entry and premium designer elevation are placed on a feasible road side.
9. Every elevated balcony/verandah open edge has compliant edge protection.
10. An open-pergola selection produces actual open slatted geometry.
11. Project deletion removes the project’s exact object-storage assets and database rows through a durable, retry-safe flow.
12. GPT image 2 shows the primary road/main-entry elevation with sophisticated materials while preserving canonical geometry.
13. Parking, foyer, balcony, verandah, and other spaces remain within room-type-specific target tolerances.
14. A plan has one primary entry and at most one optional secondary/service entry unless the brief explicitly permits more.
15. Structural support validation covers all roof systems, not only vehicle openings.
16. The main entry door is larger than interior doors and has a separate material/color token.

## 2. Reference-design audit

### Saved intent

| Input | Persisted value |
|---|---|
| Plot | 20 m × 18 m |
| Roads | South and east |
| Facing | North |
| Floors | Ground + 2 |
| Form | `articulated_wings` |
| Roof | `sloped` |
| Style | `courtyard_vernacular` |
| Materials | `earthy_textured` |
| Finish | Premium |
| Parking target | 18 m², south preferred |
| Foyer target | 5 m², south preferred |
| Courtyard target | 14 m² |
| Balcony targets | 7 m² on floors 1 and 2 |

### Persisted output defects

| Expected | Actual | Root failure |
|---|---|---|
| 18 m² parking | 75.6 m² covered parking | Rectangular residual-space filling |
| 5 m² foyer | 17.2 m² foyer | No maximum target tolerance |
| Controlled outdoor circulation | 19.7 m² + 18.1 m² open/covered galleries | Verandah classified as circulation backbone |
| 7 m² balcony | 53.6 m² synthetic covered verandah | Unused upper floor forced into covered space |
| Main entrance door | Leafless `open_connection`, width clamped by wall | Entrance kind and role are not canonical |
| Sloped roof | Flat slab primitives | Roof intent never becomes geometry |
| Supported canopies | Missing parking/verandah supports | Supports depend on a vehicle-opening record |
| Safe elevated edges | No balcony/verandah rails | Edge protection is not modeled |
| Distinct directions | Three nearly identical plans | All partis use the same aligned tiler |
| Valid architectural result | Score 100/100 | Validators omit the reported architectural rules |

### Verified existing behavior to reuse

- `MAIN_ENTRY_CLEAR_WIDTH_MM = 1200` already exists in `lib/building/openings.ts`. Reuse it; do not introduce a second constant.
- Road-side camera selection already exists and has tests. Extend its semantic inputs rather than replacing it.
- Replicate job finalization is already idempotent against terminal job states and stores exact asset keys.
- `generated_assets.storage_key` must become the authoritative asset manifest before project deletion ships. Today, reference and Replicate output writes can succeed before their asset-row transaction; every storage-write path must add compensating exact-key deletion for partial upload or post-upload database failure.
- Existing ownership, quotas, latest-version checks, deterministic geometry hashes, drawings, cost estimation, deck generation, and asset authorization must remain in place.

## 3. Root-cause map

```text
QUESTIONNAIRE
  |
  +-- global browser draft ----------------------------> old answers in new projects
  |
  +-- intent JSON without provenance/geometry ---------> stale courtyard, no pergola/roof geometry
  |
  v
PARTI SELECTION
  |
  +-- climate sorted before explicit form -------------> wrong preferred parti
  +-- one aligned tiler for every label ---------------> near-identical schemes
  +-- full-envelope tiling -----------------------------> oversized parking/verandahs
  |
  v
ACCESS + OPENINGS
  |
  +-- all verandahs are access spines -----------------> excessive/private-room doors
  +-- verandah entrance becomes open_connection -------> no main door leaf/style
  |
  v
CANONICAL BUILDING V2
  |
  +-- no roof/support/guard/pergola/facade model ------> missing architecture
  |
  v
VALIDATION
  |
  +-- consistency rules only --------------------------> flawed plan scores 100
  |
  v
MASSING + GPT
  |
  +-- flat slabs + geometry-lock prompt ---------------> GPT preserves the defects
```

## 4. Normative product and data decisions

### 4.1 Project capability profiles

Use three persisted profiles during rollout:

```ts
type ProjectCapabilityProfile =
  | "legacy_view_only"
  | "current_v2"
  | "current_v3";

type ProjectCapabilities = {
  canView: boolean;
  canReadAssets: boolean;
  canDelete: boolean;
  canApplyAiSuggestion: boolean;
  canSelectScheme: boolean;
  canGenerateRender: boolean;
  canRetryRender: boolean;
};
```

Do not create a separate `canRefreshReference` server capability. Reference capture/upload is part of render generation and is governed by `canGenerateRender`.

Profile behavior:

| Profile | View existing | Delete | AI/layout mutation | Scheme mutation | New/retry render |
|---|---:|---:|---:|---:|---:|
| `legacy_view_only` | Yes | Yes | No | No | No |
| `current_v2` | Yes | Yes | Yes | Yes | Yes |
| `current_v3` | Yes | Yes | Yes | Yes | Yes |

The profile records lifecycle policy; `buildingSchemaVersion` records the actual geometry contract. Resolve capabilities from both values:

```ts
resolveProjectCapabilities(profile, projectStatus): ProjectCapabilities;
```

Status overlay:

| Status | Normal view/assets | Delete | Mutations | Special access |
|---|---:|---:|---:|---|
| `generating` | No | No | No | Generation status only |
| `ready` | Per profile | Yes | Per profile | — |
| `failed` | Failure summary | Yes | No | — |
| `archived` | Yes | Yes | No | Archived results only |
| `deleting` | No | Existing job only | No | Deletion status/retry only |

At project creation, choose a target generator contract before reservation. Do not hold a database transaction open while generation runs:

```text
feature flag/allowlist + rollout epoch
        |
        v
reserve project/job with target contract + intended profile
        |
        v
run version-dispatched pipeline outside DB transaction
        |
        v
completion transaction verifies actual schema == reserved contract
        |
        +-- match ----> persist layout + ready status + final profile
        |
        +-- mismatch --> fail generation; never mint a ready project
```

- Persist `generatorContractVersion` and `rolloutEpoch` at reservation time.
- `generating` status disables normal capabilities even though the intended profile is reserved.
- V2 output must never become ready as `current_v3`.
- V3 output must never become ready as `current_v2`.
- The database default is a safety fallback, not the primary issuance mechanism.
- During internal rollout, allowlisted owners receive explicit `current_v3`; everyone else receives `current_v2`.
- At general availability, newly generated v3 projects receive `current_v3`.
- On rollback, explicit v2 issuance must write `current_v2`, generator contract `2`, and the rollback epoch on every new project; do not rely on the GA database defaults, which intentionally remain v3.
- Existing pre-migration projects are backfilled to `legacy_view_only`.
- At v3 general availability, drain pre-cutoff v2 reservations before conversion or finalize any late v2 completion directly as `legacy_view_only`. A one-time conversion alone is insufficient because a pre-cutoff reservation may finish afterward.
- Remaining ready `current_v2` projects become `legacy_view_only` unless product explicitly chooses a later cutoff.

The server capability mapper is authoritative. UI disabling is explanatory only.

### 4.2 In-flight job policy

Already-authorized jobs may finish after their project becomes `legacy_view_only`.

- Capability checks gate new user-initiated mutations.
- Replicate webhooks and reconciliation may finalize jobs created before the cutoff.
- A legacy user cannot retry a failed job or initiate another job.
- Migration tests must cover a job that is `processing` during the profile backfill.
- Deletion is different: a project entering `deleting` must cancel or wait for active jobs according to the deletion state machine in §9.10.

### 4.3 Version-dispatched v2/v3 pipelines

Staged rollout requires both current-v2 and current-v3 projects to remain executable temporarily. Freeze the existing behavior behind explicit v2 contracts before editing the shared generator:

```ts
runDesignPipelineV2(legacyRequirements): Promise<LegacyPipelineResult>;
runDesignPipelineV3(currentRequirements): Promise<CurrentPipelineResult>;
runDesignPipelineForContract(contractVersion, readableRequirements): Promise<ReadablePipelineResult>;
```

- V2 requirements, building, validation, costing, architectural review, prompt, and render behavior remain frozen except for lifecycle/storage safety fixes.
- V3 requirements enter only the v3 generator and v3 validators.
- A current-v2 AI suggestion dispatches to v2; current-v3 dispatches to v3.
- Render/finalization parses the readable building union but chooses the render contract from the persisted building version.
- Once all current-v2 projects are made legacy, v2 mutation dispatch may be removed in a separate cleanup; v2 reading remains.

### 4.4 Clean new project versus resumable draft

- “New project” creates a new draft ID and canonical defaults.
- “Resume draft” is a separate explicit action.
- Draft storage key: `brickpilot:draft:<draftId>`.
- A small index may contain draft ID, updated time, title/label, and consumed state.
- Successful project creation consumes and removes that draft payload.
- Saved-project requirements always outrank browser drafts.
- Project creation sends a stable `clientRequestId` derived from the draft ID. Enforce a unique `(ownerId, clientRequestId)` reservation so double-click/two-tab replays return the same pending/completed project instead of creating duplicates.

### 4.5 Legacy compatibility

- Parse v2 buildings for viewing, drawings, cost, deck, and completed asset access.
- Do not rewrite persisted v2 JSON into v3.
- Do not allow v2 buildings into v3 mutation or rerender paths.
- V2 output must remain behaviorally and visually regression-equivalent. Byte identity is not required unless an existing test explicitly depends on it.

## 5. Requirements contract v3

Define explicit schema boundaries in `lib/building/requirements.ts`:

```ts
legacyBuildingRequirementsSchema;   // v2 mutation during staged rollout + legacy read
currentBuildingRequirementsSchema;  // v3 generation/mutation
readableBuildingRequirementsSchema; // discriminated v2 | v3 union
```

Export distinct `LegacyBuildingRequirements`, `CurrentBuildingRequirements`, and `ReadableBuildingRequirements` types. V3 generators accept only `CurrentBuildingRequirements`; no downstream consumer receives an ambiguous union unless it is explicitly a read adapter/dispatcher.

Add provenance so inferred defaults can be removed without deleting explicit choices:

```ts
type ChoiceSource = "user" | "inferred" | "default";

type SourcedChoice<T> = {
  value: T;
  source: ChoiceSource;
};

type EntryRequirements = {
  primarySide: SourcedChoice<"north" | "east" | "south" | "west" | "auto_road_side">;
  secondaryEntry: SourcedChoice<"none" | "rear" | "service_side" | "auto">;
  primaryDoorClearWidthMm: number;
};

type ShadeStructureRequirement = {
  id: string;
  type: "open_pergola" | "solid_canopy";
  location: "front_entry" | "parking" | "verandah" | "terrace";
  targetAreaM2?: number;
  source: ChoiceSource;
};
```

Requirements must also include:

- Vehicle count and parking target/minimum/maximum.
- Balcony and verandah target/minimum/maximum by floor.
- Courtyard choice with provenance.
- Roof character with provenance.
- Intended use above parking: occupied rooms, balcony, terrace, unbuilt, or auto.
- Maximum exterior pedestrian entry count, default 2.

When form strategy changes, remove only incompatible `inferred` features. Explicit user choices either survive or produce a clear incompatibility/relaxation message.

### Room-area policy

Do not use one universal percentage for every room. Add a room-type policy table with:

- Absolute minimum and maximum where known.
- Target-relative warning and failure bands.
- Flexibility class: fixed, normal, or flexible/combined.
- Outdoor-area cap as both target-relative and percentage-of-floor.
- Parking bound derived from vehicle count and maneuvering policy.

Initial product-feasibility defaults:

| Class | Examples | Warning above target | Hard maximum |
|---|---|---:|---:|
| Fixed/service | bathroom, utility, store, pooja, foyer | 125% | max(150%, target + 4 m²) |
| Normal | bedroom, kitchen, study | 130% | 160% |
| Flexible/combined | living/dining, family lounge | 140% | 175% |
| Parking | derived from vehicle count/target | 125% | 150% |
| Balcony/verandah | effective outdoor target | 150% of effective target area | `min(2 × effectiveTargetArea, 0.15 × usableFloorArea)` |

- Parking uses `max(user target, vehicleCount × 15 m²)` before tolerance, with maneuvering/access validated separately. For the reference one-car 18 m² request, hard maximum is 27 m².
- For an explicitly requested balcony/verandah without a size, derive `effectiveTargetArea = clamp(6 m², 0.08 × usableFloorArea, 12 m²)`. When the feature is not requested, its target is zero and the generator may not create it merely to absorb residual area; a minimal protected arrival canopy is a separately typed requirement/system.
- A candidate exceeding a hard maximum is rejected at that relaxation rung. If every candidate fails, return `PROGRAM_AREA_INFEASIBLE` with the affected requirement IDs; do not silently enlarge spaces.
- These values are conceptual product heuristics, not building-code or engineering certification. Keep them in one versioned policy module and tune only with fixture changes plus explicit review.

## 6. Building schema v3

Keep explicit schemas:

```ts
legacyBuildingSchema;   // v2, view-only compatibility
currentBuildingSchema;  // v3, generation and mutation
readableBuildingSchema; // discriminated v2 | v3 union
```

### 6.1 Opening roles

```ts
type OpeningRole =
  | "main_entry"
  | "secondary_entry"
  | "service_entry"
  | "interior_door"
  | "vehicle_entry"
  | "open_passage";
```

Every pedestrian/vehicle opening must have a role. Main-entry role drives width, validation, materials, drawing symbol, and prompt metadata.

### 6.2 Occupied and intentional-unbuilt regions

Do not create competing `space.bounds`, `planningCellPolygon`, and floor-region authorities. V3 uses one canonical orthogonal partition:

```ts
type FloorRegion = {
  id: string;
  kind: "interior" | "covered_outdoor" | "open_to_sky" | "intentional_unbuilt";
  polygon: OrthogonalPolygon;
  spaceId?: string;
};
```

- Spaces reference exactly one region; bounds and area are derived, never independently authored.
- Wall derivation, coverage, slabs, dimensions, schedules, and costing all consume the canonical region partition.
- V3 is limited to simple orthogonal polygons on the integer-millimetre grid. Arbitrary angled/curved planning polygons and polygon holes are out of scope.
- Normalize clockwise winding, omit repeated closing point, reject self-intersections, and use the shared tolerances in §6.7.
- The region union covers the declared floor envelope without overlap. `intentional_unbuilt` is excluded from built-up area, roof area, room schedules, and cost quantities.

### 6.3 Roof systems

Roof geometry must be explicit enough that drawing, massing, validation, and quantity takeoff produce the same result.

```ts
type RoofPlane = {
  id: string;
  vertices: Point3[];
  drainageDirection?: Vector2;
};

type EnclosureRoofSystem = {
  id: string;
  servesSpaceIds: string[];
  footprint: Polygon;
  kind: "flat_slab" | "gable" | "hip" | "shed" | "solid_canopy";
  planes: RoofPlane[];
  eaveHeightMm: number;
  overhangMm: number;
};

type LinearMember = {
  id: string;
  start: Point3;
  end: Point3;
  sectionMm: { width: number; depth: number };
};

type OpenPergolaSystem = {
  id: string;
  kind: "open_pergola";
  hostFloorId: string;
  hostSpaceId?: string;
  footprint: Polygon;
  frameMembers: LinearMember[];
  slatMembers: LinearMember[];
  slatOrientation: "x" | "y";
  slatSpacingMm: number;
  openAreaRatio: number;
  topElevationMm: number;
};

type RoofSystem = EnclosureRoofSystem | OpenPergolaSystem;
```

Invariants:

- Enclosure roof planes exactly cover the roof footprint without overlap/gaps beyond numeric tolerance.
- Each enclosure plane has at least three non-collinear 3D vertices with consistent winding.
- Plane vertices/elevations are canonical. Pitch and ridge segments are derived output, not independently persisted competing truths.
- `open_pergola` member geometry is canonical. Slat spacing and open-area ratio are derived from members and footprint, or schema validation proves persisted cached values match the derived values within §6.7 tolerance. Solid-plane coverage does not apply.
- Quantity takeoff uses actual sloped plane area.
- L/articulated footprints may use multiple roof systems rather than forcing one invalid ridge.

### 6.4 Supports

```ts
type SecondaryRoofSupport = {
  id: string;
  role: "canopy_post" | "pergola_post" | "ledger";
  floorId: string;
  baseElevationMm: number;
  topElevationMm: number;
  roofSystemIds: string[];
  geometry: Point2 | Segment2;
  sectionMm?: { x: number; y: number };
};

type RoofBearingLine = {
  id: string;
  segment: Segment2;
  role: "perimeter" | "interior";
  bearingWallIds: string[];
  structuralColumnIds: string[];
  secondarySupportIds: string[];
};

type RoofSupportReference = {
  roofSystemId: string;
  bearingLines: RoofBearingLine[];
};
```

Primary building columns remain authoritative in `structuralConcept`; do not duplicate them in a second support collection. Canopy/pergola posts and ledgers are secondary roof supports and are not forced into the all-floor continuity model.

`RoofBearingLine.segment` is the canonical conceptual bearing geometry. Its IDs are references to authoritative walls, primary structural columns, or secondary supports; they are not duplicate structural objects. A bearing line is backed when it overlaps a referenced bearing-wall segment within §6.7 tolerance, or when its endpoints/intermediate breaks are resolved to referenced columns/supports. Unsupported reach is measured in plan as the maximum shortest distance from any point in the enclosure roof's projected footprint (excluding its declared overhang band) to a backed bearing line.

Support-completeness rules:

- Enclosure roofs: every bearing line is backed by its referenced authoritative objects; the entire projected footprint is within the 3000 mm support-reach threshold after excluding a declared overhang no greater than 750 mm. This is equivalent to a conservative conceptual 6000 mm maximum span between support lines.
- Solid canopies: every host edge is a bearing wall/ledger or a post-supported edge; unsupported corners are prohibited.
- Pergolas: frame corners and member spans are supported by host wall/ledger or pergola posts within the spacing threshold.

### 6.5 Edge protection

```ts
type EdgeProtection = {
  id: string;
  floorId: string;
  edge: Segment2;
  kind: "parapet" | "metal_rail" | "glass_rail";
  heightMm: number;
  dropHeightMm: number;
};
```

Generate guards where drop height exceeds the configured threshold. Do not add unnecessary rails to ground-level edges without a hazardous drop.

### 6.6 Facade zones

```ts
type FacadeZone = {
  side: CardinalDirection;
  exteriorWallIds: string[];
  articulationPolygons: Polygon3[];
  role: "primary_road_elevation" | "secondary_road_elevation" | "garden" | "service";
  containsMainEntry: boolean;
  allowedMaterialArticulation: string[];
};
```

The primary facade is derived from feasible road access and the actual main-entry geometry, not `site.facing` alone.

### 6.7 Normative geometry/feasibility constants

Keep these in versioned modules and use the same values in generation and validation:

| Constant | Initial value | Meaning |
|---|---:|---|
| Coordinate grid | 1 mm | Persisted coordinates are integer millimetres |
| Edge equality tolerance | 1 mm | Topology/coverage comparison |
| Area tolerance | 100 mm² | Polygon coverage arithmetic |
| Main door target | 1200 mm | Reuse existing constant |
| Main door hard minimum | 1000 mm | Candidate invalid below this |
| Door junction clearance | 50 mm each side | Reserve at least 1300 mm main-entry wall run |
| Vehicle aperture minimum | 2400 mm | Reuse existing validation constant |
| Guard-trigger drop | 600 mm | Conceptual safety threshold |
| Guard height | 1100 mm | Conceptual default, configurable by regional pack |
| Enclosure roof support reach | 3000 mm max | Maximum plan distance to a backed bearing line; conceptual 6000 mm span |
| Enclosure roof overhang | 750 mm max | Portion excluded from support-reach measurement |
| Canopy unsupported span | 4000 mm | Conceptual feasibility threshold |
| Pergola post spacing | 3500 mm max | Conceptual feasibility threshold |
| Pergola slat spacing | 150–450 mm | Product geometry range |
| Pergola open-area ratio | 0.50 minimum | Must read visually as open |
| Parti variation retries | 3 per surviving parti | Deterministic bounded fallback |
| Render eval samples | 5 independent samples | Provider has no verified seed control |

These are feasibility defaults, not licensed structural or jurisdictional approval.

### 6.8 Massing primitive contract

Pitched planes and pergola/guard members cannot fit the existing box-only primitive. Use a discriminated render contract:

```ts
type MassingPrimitiveBase = {
  id: string;
  semanticKind: "site" | "slab" | "roof" | "exterior_wall" | "interior_wall" | "column" | "support" | "guard" | "pergola" | "stair" | "window_glass" | "door_leaf";
  floorId?: string;
  sourceId?: string;
  materialToken: MaterialToken;
};

type MassingPrimitive = MassingPrimitiveBase & (
  | { shape: "box"; center: Point3; size: Vector3 }
  | { shape: "mesh"; vertices: Point3[]; triangleIndices: number[] }
  | { shape: "linear_member"; start: Point3; end: Point3; sectionMm: { width: number; depth: number } }
);
```

Bounds, camera framing, capture labels, edge rendering, and geometry hashing must support all three branches. Roof ridge height participates in visual bounds.

## 7. Spatial and generation contracts

### 7.1 Arrival and privacy topology

Required graph:

```text
ROAD / ARRIVAL
      |
      v
MAIN ENTRY DOOR
      |
      v
FOYER / ENTRY HALL ----> INTERNAL LIVING / CIRCULATION ----> PRIVATE ROOMS
      ^                                  |
      |                                  +----> STAIR
PARKING PEDESTRIAN ROUTE                 +----> SERVICE ZONE

OPTIONAL REAR/SERVICE ENTRY ---> UTILITY/KITCHEN CIRCULATION
```

Rules:

- Exactly one main entry.
- Default maximum one secondary/service entry.
- Main entry must use a feasible road side where one exists.
- Parking is not an access spine.
- Outdoor verandah is not an access spine.
- A protected gallery may be an access spine only when explicitly typed and privacy-valid.
- Bedrooms, bathrooms, and pooja cannot open directly to parking or an exterior open gallery.
- WS4/WS5 topology generation reserves a road-facing foyer wall run of at least 1300 mm before walls are finalized. Main door uses the existing 1200 mm target and must not be clamped below 1000 mm. WS6 realizes/validates the reservation; it must not mutate finished room/wall geometry.
- Vehicle aperture placement is part of WS6 opening topology, including parking that directly touches a road. WS7 renders the already-canonical aperture/support system.
- Standard interior, accessible interior, service, secondary, and vehicle openings have role-specific policies.

### 7.2 Distinct parti generation

Explicit user form priority outranks climate preference. Climate is a feasibility/tie-break input after hard brief compliance.

Implement distinct topology templates or generators for:

- Courtyard/ring.
- Compact bar/rectangle.
- L/articulated wings.
- T-hub.

Use one shared `scheme-topology-v1` fingerprint/near-duplicate evaluator in generation and `validateSchemeSet()`:

- Replace room IDs with `(floor, roomType, stable road-relative centroid order)` tokens.
- Normalize translation to the buildable-envelope origin and quantize coordinates to 100 mm; do not normalize scale.
- Preserve the site’s road-relative orientation. Rotations/mirrors are not equivalent when they change road, main-entry, or service-side relationships.
- Fingerprint exact fields: normalized adjacency edges, main/secondary entry side+target token, courtyard/void count and centroid class, wing count/orientation, and occupied footprint polygons by floor.
- Two schemes are near-duplicates when adjacency-edge Jaccard similarity is at least 0.90 **and** area-weighted floor-footprint intersection-over-union is at least 0.85, with matching entry/courtyard/wing signatures.
- `lib/building/scheme-fingerprint.ts` is the sole implementation used by WS4 generation and WS8 scheme-set validation.

Deduplication fallback is bounded:

1. Generate each feasible parti with deterministic seed.
2. Deduplicate by topology and near-identical footprint signature.
3. Retry controlled parameter variation with a fixed maximum attempt count.
4. If fewer than three distinct options remain, return the smaller honest set with relaxation findings naming infeasible/rejected partis.
5. Never loop indefinitely and never pad with duplicate schemes.

The reference fixture must produce three distinct schemes. A constrained-plot fixture must prove that one or two honest schemes are supported.

### 7.3 Program-driven floor plates

- Allocate requested rooms within room-type policy bands before expanding the footprint.
- Do not let a single room absorb an unused wing.
- Do not convert residual area automatically to covered verandah.
- Area above parking must be intentionally occupied, balcony, terrace, or unbuilt.
- Penalize unrequested covered/outdoor area.
- Coverage uses occupied + covered outdoor + open-to-sky + intentional-unbuilt polygons.

## 8. Validation contract

Version the persisted validation payload instead of widening the current v2 enums in place:

```ts
type ValidationCategoryV3 =
  | ValidationCategoryV2
  | "circulation"
  | "accessibility"
  | "architecture"
  | "site"
  | "safety"
  | "scheme_set";

type ValidationSourceKindV3 =
  | "geometry"
  | "requirement"
  | "requirement_and_geometry"
  | "baseline_heuristic"
  | "jurisdiction_source"
  | "scheme_set";

type ValidationFindingV3 = Omit<ValidationFindingV2, "category" | "sourceKind"> & {
  category: ValidationCategoryV3;
  sourceKind: ValidationSourceKindV3;
};

type ValidationReportV3 = {
  schemaVersion: "validation-report-v3";
  rulePackVersion: string;
  valid: boolean;
  score: number;
  counts: Record<ValidationSeverity, number>;
  findings: Array<ValidationFindingV3>;
};
```

`ValidationFindingV3` retains the existing measured/required/object-ID evidence fields while using the v3 category and source unions. WS3 owns the v2/v3 read union and persisted-study adapter in `lib/validation/types.ts` and `lib/design/persisted-study.ts`; WS8 consumes that contract without widening it. WS7B updates deck/PDF/drawing presentation and grouping so every new category renders safely. V2 reports remain readable and are not rewritten.

Add stable rule codes:

| Code | Category/source | Default severity | Reject candidate | Purpose/measurement |
|---|---|---|---:|---|
| `AREA_TARGET_EXCEEDED` | planning / requirement_and_geometry | warning inside warning band; error above hard max | Error only | Measured m² versus room-policy warning/hard maximum |
| `SCHEME_NOT_DISTINCT` | scheme_set / scheme_set | error | Reject duplicate direction | Shared v1 fingerprint similarity/thresholds |
| `MAIN_ENTRY_MISSING` | circulation / geometry | error | Yes | Main-entry role count must equal 1 |
| `MAIN_ENTRY_NOT_ROAD_SIDE` | planning / requirement_and_geometry | error when feasible road edge exists | Yes | Entry side versus feasible road sides |
| `MAIN_ENTRY_TOO_NARROW` | accessibility / geometry | error | Yes | Clear width ≥1000 mm; target 1200 mm |
| `EXTERIOR_ENTRY_COUNT_EXCEEDED` | circulation / requirement_and_geometry | error | Yes | Exterior pedestrian-role count versus requested/default maximum |
| `PRIVATE_ROOM_EXTERIOR_EXPOSURE` | circulation / geometry | error | Yes | Forbidden exterior/parking path to private room |
| `PARKING_VEHICLE_ACCESS_MISSING` | circulation / geometry | error | Yes | Explicit aperture clear width ≥2400 mm |
| `ROOF_INTENT_NOT_REALIZED` | architecture / requirement_and_geometry | error | Yes | Requested roof kind versus realized system |
| `ROOF_GEOMETRY_INVALID` | geometry / geometry | error | Yes | Plane coverage, winding, non-collinearity, tolerance |
| `ROOF_SITE_BOUNDARY_CONFLICT` | site / geometry | error | Yes | Roof/pergola/canopy versus site/overhang policy |
| `ROOF_SUPPORT_INCOMPLETE` | structure / geometry | error | Yes | System-specific support rules and unsupported span |
| `SUPPORT_CLEARANCE_CONFLICT` | structure / geometry | error | Yes | Post/column versus vehicle/door/circulation clearance |
| `EDGE_PROTECTION_MISSING` | safety / geometry | error | Yes | Drop ≥600 mm requires 1100 mm protection |
| `SHADE_STRUCTURE_NOT_REALIZED` | architecture / requirement_and_geometry | error for explicit request; warning for inferred | Error only | Requested type/location versus realized system |
| `FACADE_ENTRY_CONFLICT` | architecture / geometry | error | Yes | Primary facade must contain main entry and feasible road relation |

Rewrite the existing full-envelope coverage validator for v3 polygons in the same change window as the generator’s polygon coverage. Preserve existing setback, overlap, accessibility, stair, and structural-column rules unless their input adapter must change.

Validation output must trace every relevant questionnaire choice to realized geometry or an explicit relaxation. Candidate evidence must use actual entry/facade geometry rather than `site.facing` prose.

Distinctness is a scheme-set concern, not a single-building validator. Implement `validateSchemeSet()` for `SCHEME_NOT_DISTINCT`; keep `validateBuilding()` focused on one building.

Add canonical realization records:

```ts
type IntentRealization = {
  requirementPath: string;
  requirementId?: string;
  requestedValue: unknown;
  realizedObjectIds: string[];
  status: "realized" | "relaxed" | "incompatible";
  relaxationCode?: string;
};
```

AI review, evidence, UI traceability, and render prompts consume these records rather than reconstructing intent from prose.

## 9. Implementation workstreams

### WS0 — Reference fixtures and green characterization tests

**Owner:** Test-contract agent  
**Dependencies:** None  
**Owns:** New fixtures and focused tests only

- [ ] Add a redacted fixture reproducing the reference questionnaire.
- [ ] Snapshot current areas, adjacency, openings, massing, and scheme fingerprints as green before-state characterizations.
- [ ] Add a constrained-plot fixture where only one parti is feasible.
- [ ] Add explicit-versus-inferred courtyard transition fixtures.
- [ ] Record future v3 acceptance cases as `test.todo` or fixture assertions that do not break the shared branch. Each owning workstream converts its cases to executable tests atomically with production behavior.

Suggested files:

- `lib/building/fixtures/reference-articulated-sloped.ts`
- `lib/building/reference-regression.test.ts`
- `lib/validation/architectural-intent.test.ts`
- `lib/render/reference-contract.test.ts`

### WS1 — Capability profiles, explicit issuance, and legacy API gates

**Owner:** Lifecycle/API agent  
**Dependencies:** WS0 contract names, WS3A compatibility exports  
**Owns:** DB migration, capability helper, project/design API mutations and API tests. Does not own workspace UI or shared schemas.

- [ ] Add the three-value capability profile enum/column.
- [ ] Add reservation-time `generatorContractVersion`, `rolloutEpoch`, and stable `clientRequestId`; enforce unique `(ownerId, clientRequestId)` replay.
- [x] Backfill existing projects to `legacy_view_only`; migration `0008` used `current_v2` as its migration-time safety default, while `0013` later changes only the defaults for future rows to v3 without rewriting existing projects.
- [ ] Add `lib/server/project-capabilities.ts` as the only capability mapping.
- [ ] Reserve the intended contract/profile in the short reservation transaction; run generation outside it; verify actual schema matches in the completion transaction before marking ready.
- [ ] Include profile and resolved capabilities in GET results.
- [ ] Gate AI suggestion, scheme selection, and render generation/retry with `409 PROJECT_VIEW_ONLY`.
- [ ] Perform a fast preflight capability check and an authoritative profile/status recheck under the same project lifecycle lock/transaction that commits each mutation. Return `PROJECT_VIEW_ONLY` or `PROJECT_DELETING` to the losing request.
- [ ] For work performed outside that transaction, re-lock immediately before provider dispatch or final persistence. If legacy/deleting wins, cancel the reserved local job and discard/compensating-delete intermediate assets.
- [ ] Gate render reference uploads through the render POST; there is no separate reference-refresh route.
- [ ] Audit all API mutation exports with `rg`; do not gate read-only deck/PDF GET routes.
- [ ] Allow pre-cutoff Replicate jobs to finalize; block new legacy retries.
- [ ] Emit structured, PII-free lifecycle events for reserved/actual contract mismatches, capability denials, and mutation-versus-profile/status races. Include project/layout/job IDs and the resolved profile/status.
- [ ] Add internal-v3, general-availability, and rollback issuance tests.
- [ ] Add current-v2, current-v3, legacy, and processing-during-backfill tests.
- [ ] Add double-click/two-tab project-creation replay tests.

Primary files:

- `lib/db/schema.ts`
- `drizzle/*_project_capability_profile.sql`
- `lib/server/project-capabilities.ts`
- `app/api/designs/route.ts`
- `app/api/designs/[layoutVersionId]/route.ts`
- `app/api/designs/[layoutVersionId]/apply-suggestion/route.ts`
- `app/api/designs/[layoutVersionId]/select-scheme/route.ts`
- `app/api/designs/[layoutVersionId]/renders/route.ts`
- `lib/render/finalize-job.ts`

### WS1B — Capability UI integration

**Owner:** Lifecycle UI agent  
**Dependencies:** WS1 and WS2  
**Owns:** Workspace capability presentation only

- [ ] Consume capabilities returned by list/detail APIs.
- [ ] Disable/hide AI, scheme, render, retry, and reference-capture controls for legacy projects with one consistent explanation.
- [ ] Show deletion pending/failed status without normal project access.
- [ ] Add UI tests for legacy, current, generating, failed, and deleting status overlays.

Primary files:

- `components/design-workspace.tsx`
- Massing/render workspace component containing actions

### WS2 — Clean draft lifecycle

**Owner:** Intake/UI agent  
**Dependencies:** None  
**Owns:** Draft storage and intake/workspace draft behavior. Does not own shared requirement schema/model.

- [ ] Add unique draft IDs and `brickpilot:draft:<draftId>` storage.
- [ ] Separate New project from Resume draft.
- [ ] Remount GuidedIntake for a clean new draft.
- [ ] Consume/remove a draft on successful project creation.
- [ ] Ensure saved-project requirements override browser storage.
- [ ] Test refresh, resume, new project, saved project, and consumed draft.

Primary files:

- `components/guided-intake/GuidedIntake.tsx`
- `components/design-workspace.tsx`
- New `lib/design/draft-storage.ts`

### WS3A — Freeze v2 compatibility and dispatch boundaries

**Owner:** Compatibility/schema agent  
**Dependencies:** WS0  
**Owns:** Legacy/readable schema exports, v2 pipeline freeze, dispatch adapters

- [ ] Rename/freeze existing requirement/building schemas as explicit legacy-v2 contracts without behavior change.
- [ ] Add readable v2/v3 discriminators and geometry-hash adapter.
- [ ] Extract `runDesignPipelineV2` from current behavior and add a contract dispatcher seam before v3 implementation changes shared modules.
- [ ] Keep v2 validation, cost, AI review, prompts, render, and finalization executable during staged rollout.
- [ ] Add v2 behavior-regression and in-flight render-finalization tests.

Primary files:

- `lib/building/requirements.ts`
- `lib/building/schema.ts`
- `lib/server/design-pipeline.ts`
- `lib/design/persisted-study.ts`
- Read adapters used by render finalization

### WS3 — Requirements and building schema v3

**Owner:** Schema agent  
**Dependencies:** WS3A  
**Owns:** Shared schemas/adapters only

- [ ] Version requirements with provenance, entries, shade structures, parking, outdoor bounds, and above-parking use.
- [ ] Implement explicit v2/v3/read-union building schemas.
- [ ] Add opening roles, polygon floor regions, roof planes/systems, supports, edge protection, and facade zones.
- [ ] Add the discriminated v2/v3 validation finding/report types and persisted-study read union defined in §8; preserve v2 reports without rewriting them.
- [ ] Define numeric geometry tolerances once for generator, validation, drawing, massing, and costing.
- [ ] Ensure v2 remains readable; `current_v2` mutations dispatch only through the frozen v2 pipeline until cutoff and never enter v3 mutation paths.
- [ ] Add round-trip and unsupported-version tests.
- [ ] Generate and commit a `rg`-based inventory of every non-test importer of `lib/building/schema` and `lib/building/requirements`; assign each importer to WS3 adapter, WS4–WS8 implementation, WS7B output, WS9 render/AI, WS10 lifecycle, or WS1B UI before merging v3 types.

Primary files:

- `components/guided-intake/model.ts`
- `lib/building/requirements.ts`
- `lib/building/schema.ts`
- `lib/validation/types.ts`
- `lib/design/persisted-study.ts`
- `lib/server/design-pipeline.ts`
- `lib/design/study-result.ts`

Merge WS3 before WS4–WS9 production work.

### WS4 — Distinct parti engine

**Owner:** Plan-engine agent  
**Dependencies:** WS3  
**Owns:** Parti selection/generators and multi-scheme tests

- [ ] Make user form priority precede climate scoring.
- [ ] Implement distinct courtyard, compact, articulated-L, and T-hub topology templates.
- [ ] Reserve a feasible road-facing foyer wall run of at least 1300 mm and an explicit vehicle aperture during topology generation.
- [ ] Add deterministic topology/footprint fingerprints.
- [ ] Add bounded variation/dedup fallback and honest smaller result sets.
- [ ] Preserve deterministic generation for a fixed seed.
- [ ] Emit structured scheme-set metrics for generated count, distinct count, rejected fingerprints/partis, relaxation reasons, and v3 canary generation success.

Primary files:

- `lib/building/partis.ts`
- New `lib/building/scheme-fingerprint.ts`
- `lib/building/candidates/*`
- `lib/building/generate.ts`
- `lib/building/multi-scheme.test.ts`

### WS5 — Program-driven allocation and partial floor plates

**Owner:** Plan-engine agent  
**Dependencies:** WS3, WS4  
**Owns:** Allocation, area policy application, canonical floor-region generation, topology/wall derivation

- [ ] Introduce room-type-specific area policy.
- [ ] Allocate requested program before expanding footprints.
- [ ] Model intentional-unbuilt regions rather than synthetic verandahs.
- [ ] Program the area above parking explicitly.
- [ ] Penalize unrequested covered/outdoor surplus.
- [ ] Produce polygon coverage compatible with WS8.
- [ ] Make canonical floor regions the only geometry authority; derive space bounds/area, walls, constructed footprints, and unbuilt regions from them.
- [ ] Add orthogonal polygon normalization/coverage utilities with the §6.7 tolerances.
- [ ] Verify reference parking, foyer, balcony, and verandah areas.

Primary files:

- Allocation/tiler modules under `lib/building/candidates/`
- `lib/building/topology.ts`
- New orthogonal polygon/partition utilities
- Focused area/coverage/topology tests

### WS6 — Arrival, privacy, and openings

**Owner:** Topology/openings agent  
**Dependencies:** WS3, WS4, WS5  
**Owns:** Space semantics, circulation graph, openings and tests

- [ ] Split interior circulation, protected gallery, outdoor verandah, parking, and arrival court semantics.
- [ ] Remove parking/outdoor verandah from default access spines.
- [ ] Place the main door before interior-door synthesis.
- [ ] Reuse the existing 1200 mm main-entry constant.
- [ ] Realize the reserved main-entry wall run and fail the candidate if it is absent; do not mutate finalized room/wall geometry.
- [ ] Create the canonical vehicle aperture even when parking directly touches a road.
- [ ] Enforce one main and default maximum one secondary/service entry.
- [ ] Prevent private-room access from parking/open exterior circulation.
- [ ] Add role-specific dimensions and material tokens.

Primary files:

- `lib/building/space-semantics.ts`
- `lib/building/circulation.ts`
- `lib/building/openings.ts`
- `lib/building/openings.test.ts`

### WS7 — Roofs, supports, guards, pergolas, and massing

**Owner:** Structure/massing agent  
**Dependencies:** WS3, WS5, WS6  
**Owns:** Physical-system derivation, primitives, viewer tests

- [ ] Generate valid enclosure roof footprints/planes for flat, gable, hip, shed, and solid-canopy systems; derive pitch/ridges from canonical plane vertices.
- [ ] Support articulated footprints with multiple roof systems.
- [ ] Generate open pergola slats/beams and open-area ratio.
- [ ] Generate canopy/pergola posts independently of all-floor columns.
- [ ] Consume WS6 vehicle apertures; do not synthesize openings in massing.
- [ ] Generate guard/parapet geometry from drop height.
- [ ] Render the wider main door with a separate material token.
- [ ] Replace the box-only massing primitive with a discriminated `box | mesh | linear_member` union. Add indexed roof meshes, member rendering, vertex-derived bounds, edge rendering, and ridge-aware camera/massing metrics.
- [ ] Add roof-plane, support-completeness, guard, pergola, and massing tests.

Primary files:

- `lib/building/structure.ts`
- New `lib/building/roofs.ts`
- New `lib/building/edge-protection.ts`
- `lib/render/massing.ts`
- `components/massing/MassingViewer.tsx`
- Massing viewer material/mesh/bounds/capture tests

### WS7B — Drawing, costing, deck, and CAD v3 consumers

**Owner:** Output-consumer agent  
**Dependencies:** WS3, WS5, WS6, WS7  
**Owns:** Non-massing downstream building consumers

- [ ] Draw v3 roof plans/ridges, supports, guards, main-entry symbols, and unbuilt regions.
- [ ] Version the drawing-floor artifact and add constructed footprint, unbuilt regions, supports, guards, main-entry role, and a roof overlay/sheet.
- [ ] Produce informational actual roof surface, canopy/pergola post, and edge-protection quantities. Keep the existing GFA feasibility estimate and document that these elements remain included in the base rate; do not add unreviewed unit rates or double-count them.
- [ ] Exclude intentional-unbuilt regions from built-up schedules and costs.
- [ ] Update deck content/slides to match v3 plans and areas.
- [ ] Render and group every v3 validation category/source safely in deck, PDF, and drawing consumers while preserving v2 labels.
- [ ] Update CAD rendering for partial/non-rectangular occupied floors.
- [ ] Preserve behaviorally equivalent v2 drawing/cost/deck output.
- [ ] Cross-check area totals across drawing, cost, deck, CAD, and massing.

Primary files:

- `lib/drawing/build-drawing.ts`
- `lib/drawing/schema.ts`
- Drawing DOM/PDF primitives/components
- `lib/cost/quantity.ts`
- `lib/cost/schema.ts`
- `lib/cost/estimate.ts`
- `lib/design/deck.ts`
- `lib/design/deck-content.ts`
- `lib/design/deck-loader.ts`
- Affected deck components
- `components/cad-plan/CadPlan.tsx`
- `components/cad-workspace/*`

### WS8 — Validation and scoring

**Owner:** Validation agent  
**Dependencies:** WS3, WS4, WS5, WS6, and WS7  
**Owns:** Validation/scoring and fixtures, no generator implementation

- [ ] Rewrite v3 coverage over occupied/covered/open/unbuilt polygons.
- [ ] Update shape-rule fixtures and sweep for partial floor plates.
- [ ] Add all rule codes in §8.
- [ ] Implement `validateSchemeSet()` separately from `validateBuilding()`.
- [ ] Persist/validate `intentRealizations` and use them for traceability.
- [ ] Classify hard failures, warnings, and scoring penalties.
- [ ] Prevent 100/100 when any warning/failure remains.
- [ ] Trace requirements to geometry/relaxations.
- [ ] Derive evidence from actual main entry/facade.
- [ ] Emit validation counts by stable rule code and severity, with fixture/cohort identifiers but no questionnaire PII, so WS11 can establish and compare the canary baseline.
- [ ] Keep unrelated existing validators active.

Primary files:

- `lib/validation/validate.ts`
- `lib/validation/rules.ts`
- `lib/validation/shape-rules.ts`
- `lib/building/scoring.ts`
- Shape-rule fixtures/sweep/tests

### WS9 — Road-side designer elevation and render evaluation

**Owner:** Render/prompt agent  
**Dependencies:** WS3, WS6, WS7, WS8  
**Owns:** Semantic views, prompt compilation, prompt tests, visual eval definition

- [ ] Define semantic render views: primary road elevation, secondary context, aerial.
- [ ] Position GPT image 2 to show the main entry and primary road facade.
- [ ] Pass facade zones, main door, roofs, supports, guards, and pergolas into prompt facts.
- [ ] Concentrate sophisticated material articulation on the primary facade.
- [ ] Preserve all canonical geometry and prevent structural invention.
- [ ] Add deterministic prompt tests.
- [ ] Add a visual eval rubric with hard failures:
  - wrong facade/main-entry side;
  - sloped roof missing/changed;
  - support posts missing;
  - guardrails missing;
  - pergola solid or missing;
  - main door not visible/distinct;
  - footprint/openings materially changed.
- [ ] Evaluate 5 independent provider samples for the reference fixture; do not claim deterministic seed coverage unless the provider contract first adds and verifies seed support.
- [ ] Require manual or approved vision-evaluator review before general availability.
- [ ] Store prompt, input references, semantic camera, geometry hash, provider/model version, output image, evaluator/version, rubric result, and human disposition for every release-eval sample.
- [ ] Emit one structured release-eval record per provider sample plus an aggregate record containing structural and aesthetic pass rates.
- [ ] Release gate: 5/5 samples pass every structural hard criterion; at least 4/5 pass aesthetic/material criteria; one human reviewer confirms all five.

Primary files:

- `lib/render/prompts.ts`
- `lib/render/camera.ts` or current camera helper
- `lib/render/reference-plan.ts`
- `lib/ai/architectural-review.ts`
- Render prompt/tests
- New render-eval fixture/rubric files

### WS10 — Durable project and asset deletion

**Owner:** Lifecycle/storage agent  
**Dependencies:** WS1 capability helper  
**Owns:** Deletion state, exact-key storage deletion, API/UI/tests

There is no existing queue/worker/cron infrastructure. Do not leave “worker” undefined and do not add a queue solely for this feature.

Durable job contract:

```ts
type ProjectDeletionJob = {
  id: string;
  originalProjectId: string; // unique; retained after project cascade
  ownerId: string;
  confirmationDigest: string;
  state: "pending" | "quiescing" | "deleting_assets" | "deleting_database" | "failed" | "completed";
  manifestKeys: string[];
  attemptCount: number;
  leaseToken?: string;
  leaseAcquiredAt?: Date;
  lastError?: string;
  createdAt: Date;
  updatedAt: Date;
};
```

Only one deletion job may exist per original project ID. Immutable owner/project/confirmation fields and the manifest survive deletion of the project row.

State machine:

```text
ACTIVE
  |
  | DELETE + exact title confirmation
  v
DELETING / deletion_job.pending
  |
  v
deletion_job.quiescing
  |
  +-- queued job ------------> local cancel
  +-- provider processing ---> provider cancel/reconcile
  +-- finalizing ------------> wait/retry; it owns a reserved asset manifest
  |
  v
deletion_job.deleting_assets
  |
  v
snapshot + delete exact R2 keys only after no writer can start
  |
  +-- transient failure --> deletion_job.failed --> explicit idempotent retry
  |
  v
delete project row + cascades
  |
  v
deletion_job.completed
```

Execution:

- [ ] Add one shared project-lifecycle advisory-lock helper used by render reservation, render/source finalization, profile/status transitions, mutating design routes, and deletion.
- [ ] Make storage writes manifest-first: under the lock, verify project state, move the job to `finalizing`, and reserve deterministic `generated_assets` rows/keys before external upload. After upload, re-lock and either complete the rows/job or compensating-delete the just-written keys if deletion/state change won.
- [ ] Update both reference upload and Replicate output paths to track successful puts and compensating-delete on partial multi-upload or post-upload DB failure. Use `Promise.allSettled` or equivalent exact successful-key accounting.
- [ ] For historical partial uploads, build the deletion manifest as the union of asset rows plus exact candidate keys deterministically derived from the project’s layout/job IDs, render purposes/output counts, package IDs, scheme IDs, and geometry hashes. Do not delete by unresolved prefix.
- [ ] In one transaction, authorize/lock project, mark it deleting, and create/return the unique deletion job. Do not snapshot assets until render work is quiescent.
- [ ] Add durable job states `pending | quiescing | deleting_assets | deleting_database | failed | completed`, attempt count/timestamps, and a compare-and-set or row-lock execution lease. Concurrent DELETE/retry returns the existing job/status.
- [ ] Add `finalizing` to `generation_status` in a migration. Treat it as active everywhere: render state/reconciliation/reservation, `finalize-job.ts`, scheme-selection conflicts, AI-suggestion render conflicts, and deletion quiescence. Add a repository-wide status-classifier test/sweep so no active-state branch remains limited to only `queued | processing`.
- [ ] Quiesce active work: locally cancel queued jobs; call provider cancellation for processing jobs; wait/retry while any job is `finalizing`; never allow a deleting-project callback to upload output.
- [ ] Add a `finalizingStartedAt` lease. A finalizing lease older than 15 minutes is reconciled against provider state and reserved asset rows before deletion proceeds; it is never cleared blindly.
- [ ] After quiescence, lock again, snapshot the exact manifest, then delete objects and finally the project row/cascades.
- [ ] Attempt deletion synchronously after the transaction.
- [ ] Return success if complete; return `202` with deletion-job status if retry is required.
- [ ] Add an authenticated idempotent retry/status endpoint scoped to the owner and deletion job.
- [ ] Treat object-not-found as success.
- [ ] Never use bucket-wide prefixes or listings as deletion targets.
- [ ] Hide deleting projects and deny new asset access/mutations.
- [ ] Cancel or deterministically settle active jobs before deleting assets/project rows.
- [ ] Add UI confirmation, pending, failed, and retry states.

Primary files:

- `lib/db/schema.ts`
- New deletion migration
- `lib/render/storage.ts`
- `lib/render/replicate.ts`
- `lib/render/finalize-job.ts`
- `app/api/designs/[layoutVersionId]/renders/route.ts`
- `app/api/assets/[...key]/route.ts`
- New `lib/server/delete-project.ts`
- New project deletion/status/retry route(s)
- Dashboard/project header components

Provider cancellation behavior:

- Queued local job without provider ID: cancel locally.
- Processing Replicate job: call `cancelReplicatePrediction`, then reconcile provider state.
- Already succeeded: finalizer either completes before quiescence or discards/compensating-deletes under the shared protocol.
- Provider not-found/already terminal: reconcile as terminal.
- Transient cancellation failure: keep deletion pending/failed for retry; never delete the project prematurely.

Storage/deletion tests must cover partial reference upload, partial multi-output upload, DB failure after upload, callback/deletion race, already-missing object, zero assets, concurrent DELETE, concurrent retry, and provider-cancel failure.

Operational evidence:

- [ ] Emit structured deletion-job state transitions, age, attempt count, compensation failures, provider-cancel outcomes, and suppressed-callback reasons using project/job IDs and no questionnaire PII.
- [ ] Provide a query/report helper that identifies unresolved compensation, failed jobs, and jobs older than the 15-minute hold threshold.

### WS11 — Integration, migration rehearsal, and E2E

**Owner:** Integration agent  
**Dependencies:** WS1–WS10, including WS7B  
**Owns:** Cross-system tests and rollout evidence

- [ ] E2E clean new project and explicit resume draft.
- [ ] E2E legacy view-only UI plus direct API mutation denial.
- [ ] Migration rehearsal with existing, current-v2, current-v3, and processing-job fixtures.
- [ ] Reference generation: three distinct schemes, correct selection, areas, topology, roofs, supports, guards, pergola, and main door.
- [ ] Cross-output consistency: drawing, cost, deck, CAD, massing.
- [ ] GPT image 2 visual evaluation across five independent samples.
- [ ] Delete project and verify database and object storage cleanup, including partial-failure retry.
- [ ] Add a required isolated-database integration command. Existing DB integration tests that use `RUN_DB_INTEGRATION=1` must run in release verification.
- [ ] Add Playwright (or the repository-approved equivalent) with named browser tests for new/resume draft, legacy UI, render denial, and deletion status/retry. Remove `--pass-with-no-tests`; release verification fails if integration/E2E discovers zero tests.
- [ ] Add a migration-rehearsal script that creates v2/current-v2/current-v3/processing/deleting fixtures, applies migrations, and asserts final states.
- [ ] Produce a release-observability report from the structured lifecycle, generation, validation, render-eval, and deletion events. Establish the canary baseline and evaluate every automatic hold condition in §14 without requiring a new telemetry platform.
- [ ] Run typecheck, full unit, non-optional integration, build, and non-empty E2E suites.

Commands:

```bash
bun run typecheck
bun test
bun run test:integration
bun run build
bun run test:e2e
bun run test:migrations
```

## 10. Dependency and parallel execution plan

| Workstream | Main modules | Depends on |
|---|---|---|
| WS0 | test fixtures | — |
| WS3A | v2 schemas/pipeline/read adapters | WS0 |
| WS1 | db, APIs, lifecycle | WS3A |
| WS2 | intake UI, draft storage | — |
| WS1B | capability UI | WS1, WS2 |
| WS3 | requirements/building schemas | WS3A |
| WS4 | parti/generation | WS3 |
| WS5 | allocation/floor regions | WS3, WS4 |
| WS6 | circulation/openings | WS3, WS4, WS5 |
| WS7 | structure/roof/massing | WS3, WS5, WS6 |
| WS7B | drawing/cost/deck/CAD | WS3, WS5, WS6, WS7 |
| WS8 | validation | WS3, WS4, WS5, WS6, WS7 |
| WS9 | camera/prompt/eval | WS3, WS6, WS7, WS8 |
| WS10 | deletion/storage | WS1 |
| WS11 | integration/E2E | all |

Execution lanes:

```text
Foundation: WS0 -> WS3A

Lane A: WS3 -> WS4 -> WS5 -> WS6 -> WS7 -> WS7B

Lane B: WS1 -----------------------------> WS10
            \-> WS1B (after WS2)

Lane C: WS2 ------------------------------/

Lane D: WS3 -------- wait for WS4/WS5/WS6/WS7 --------> WS8 -> WS9

Merge all lanes -> WS11
```

Conflict rules:

- WS5 and WS6 are sequential because openings rely on the canonical floor/wall partition.
- WS8 starts only after WS7 geometry is merged. It consumes WS3-owned report types and WS4–WS7 geometry contracts without editing those owned modules.
- WS1 and WS10 both touch DB schema/migrations; use separate ordered migrations and merge WS1 first.
- Shared schema changes belong only to WS3. Other agents request contract changes from WS3 instead of editing `lib/building/schema.ts` independently.

### Exact shared-file ownership

| File/module | Owner | Later owner, only after merge |
|---|---|---|
| `lib/building/requirements.ts` | WS3A | WS3 |
| `lib/building/schema.ts` | WS3A | WS3 |
| `lib/server/design-pipeline.ts` | WS3A | WS3 dispatcher extension |
| `lib/design/persisted-study.ts` | WS3A | WS3 |
| `lib/validation/types.ts` | WS3 | — |
| `components/guided-intake/model.ts` | WS3 | — |
| `components/guided-intake/GuidedIntake.tsx` | WS2 | — |
| `components/design-workspace.tsx` | WS2 | WS1B after WS2 |
| `app/api/designs/[layoutVersionId]/renders/route.ts` | WS1 | WS10 after WS1 |
| `lib/render/finalize-job.ts` | WS1 | WS10 after WS1 |
| `lib/db/schema.ts` and migrations | WS1 | WS10 in a later numbered migration |

No two parallel agents may edit the same file. Later ownership means a strict merge dependency, not concurrent work.

## 11. Test coverage matrix

| Flow | Unit | Integration | E2E/eval |
|---|---|---|---|
| Fresh draft vs resume | storage/model branches | workspace hydration | New → resume → generate |
| Create idempotency | client request mapping | unique owner/request replay | double-click/two-tab returns one project |
| Legacy capabilities | mapper branches | every mutation route | UI disabled + direct API denial |
| Profile issuance | flag/version mapping | project transaction + migration | internal rollout/rollback rehearsal |
| In-flight job | finalizer terminal/active states | backfill + webhook | processing job completes after cutoff |
| Distinct schemes | fingerprints/dedup | constrained fallback | reference direction cards |
| Area policy | room-type boundaries | generator + validator | reference floor review |
| Entry/privacy | graph/opening roles | generator + validator | parking cannot enter private rooms |
| Roof/pergola/support/guards | geometry invariants | validator + massing | deterministic visual review |
| Downstream consumers | drawing/cost/deck functions | cross-output area totals | exported deck/CAD review |
| GPT elevation | prompt snapshots | render request metadata | five independent provider-sample visual eval |
| Deletion | state reducer/storage delete | DB + object-storage failures | confirm → pending/retry → gone |
| Storage manifest | exact-key/compensation helpers | partial upload + DB failure | deletion leaves no derived project keys |
| Finalizer/deletion coordination | lifecycle-lock branches | callback race + provider cancel | deletion waits/retries safely |

Required interaction/error cases:

- Double-click project creation and deletion.
- Two tabs mutating the same project.
- Session expires before a destructive or render request.
- Provider callback arrives after legacy cutoff.
- Provider callback arrives while deletion starts.
- Storage deletion partially succeeds.
- Storage object is already missing.
- Project contains zero assets.
- Constrained plot yields one honest scheme.
- Roof geometry uses an articulated footprint.
- Guard edge intersects a door/vehicle aperture candidate.
- GPT render succeeds technically but fails the visual rubric.

## 12. Acceptance matrix

| Issue | Acceptance | Workstreams |
|---:|---|---|
| 1 | New project uses defaults; only explicit resume restores a draft | WS2, WS11 |
| 2 | Legacy views work; all prohibited APIs are server-blocked | WS1, WS11 |
| 3 | Reference fixture has three distinct schemes; constrained plots return fewer honest options | WS4, WS8, WS11 |
| 4 | Parking/open exterior does not produce redundant/private-room doors | WS6, WS8 |
| 5 | Door sizes follow role policies | WS6, WS7, WS7B |
| 6 | Sloped roof appears consistently in drawing, cost, deck, massing, render | WS3, WS7, WS7B, WS8, WS9 |
| 7 | Parking/verandah roof supports and elevated guards exist | WS7, WS7B, WS8 |
| 8 | Main entry/designer facade uses feasible road side | WS6, WS8, WS9 |
| 9 | Balcony/elevated verandah edges have guards | WS7, WS7B, WS8 |
| 10 | Open pergola is explicit open geometry in all outputs | WS3, WS7, WS7B, WS8, WS9 |
| 11 | Delete removes exact assets and DB project with retry safety | WS10, WS11 |
| 12 | GPT image 2 passes road-side designer-elevation rubric | WS9, WS11 |
| 13 | Room/outdoor/parking areas pass room-type policy | WS5, WS7B, WS8 |
| 14 | One main and at most one default secondary/service entry; privacy graph passes | WS6, WS8 |
| 15 | Every roof system passes support completeness | WS7, WS8 |
| 16 | Main door is wider and materially distinct in deterministic/GPT outputs | WS6, WS7, WS7B, WS9 |

## 13. No-regression requirements

- Existing ownership and non-enumerability of project/design/assets.
- Existing generation/render quotas.
- Idempotency and latest-version protections.
- V2 project viewing, drawing, cost, deck, and completed asset delivery.
- Setback, overlap, accessibility, stair, and existing structural validation.
- Deterministic output for fixed seed/input.
- Asset authorization by owner/project.
- Current-v2 functionality during staged rollout.
- Current-v3 functionality after enablement.
- Other projects/drafts unaffected by new/delete actions.

## 14. Rollout and rollback

### Phase A: compatibility and capability foundation

- Deploy frozen v2 requirements/building/pipeline/read adapters and the version-dispatch seam before any v3 shared-generator change.
- Deploy v2/v3 readable schemas and capability column.
- Backfill existing projects to legacy.
- Explicitly issue `current_v2` for new v2 generation.
- Let already-running jobs finish.
- Keep v3 off for normal users.

### Phase B: internal v3

- Allowlist internal/test owners.
- Explicitly issue `current_v3` only after v3 schema validation succeeds.
- Run fixture matrix and deterministic outputs.

### Phase C: render evaluation

- Enable v3 rendering only for buildings with no hard architectural findings.
- Run the visual rubric across five independent provider samples.
- Block rollout on repeated geometry-preservation or facade-side failures.

Release-eval thresholds:

- Five independent samples for the reference fixture.
- Structural rubric: 5/5 pass required.
- Aesthetic/material rubric: at least 4/5 pass.
- Human review: all five inspected and signed off.

### Phase D: general availability

- Enable v3 generation generally.
- Explicitly issue `current_v3` from actual v3 output.
- Change DB fallback default only after application issuance is deployed.
- Convert remaining current-v2 projects to legacy at the chosen cutoff.
- Drain pre-cutoff v2 reservations or ensure late completions finalize directly as legacy; run a post-drain verification query before declaring conversion complete.
- Enable deletion UI and retry flow.

### Observability and automatic hold conditions

| Signal | Hold/rollback condition | Owner |
|---|---|---|
| Reserved contract vs actual schema | Any mismatch | WS1/WS3 |
| V3 canary generation success | Below 95% across at least 20 fixture/canary runs | WS4/WS11 |
| Structural render rubric | Any hard failure | WS9 |
| Aesthetic render rubric | Below 80% | WS9/product reviewer |
| Mutation after legacy/deleting transition | Any confirmed event | WS1 |
| Storage compensation failure | Any unresolved object | WS10 |
| Deletion jobs | More than 1% failed or any job older than 15 minutes | WS10 |
| Suppressed deleting-project webhook | Count and reason recorded; unexpected upload is a hold | WS10 |
| Scheme set size/distinctness | Duplicate presented, or unexplained fewer-than-three result | WS4/WS8 |
| New validation-code distribution | Sudden >20 percentage-point change from canary baseline | WS8 |

Store counts without questionnaire PII. Every hold signal must include project/layout/job IDs needed for internal diagnosis and a documented owner.

### Rollback

- Disable v3 generation.
- New v2 outputs receive `current_v2`, never `current_v3`.
- Existing v3 projects stay readable and may remain mutable if their v3 pipeline remains deployed; otherwise switch them to view-only via the capability mapper.
- Keep v2/v3 readers, migrations, deletion jobs, and exact-key storage deletion deployed.
- Never roll back by reopening legacy mutation endpoints.

## 15. Subagent handoff contract

Every implementation subagent must return:

- Files changed.
- Contract/schema changes.
- Migrations added and rollback behavior.
- Tests added and exact commands run.
- Remaining known gaps.
- Confirmation that unrelated dirty files were not overwritten.

Every subagent must:

- Read this entire plan and its workstream before editing.
- Start after dependencies are merged.
- Edit only owned modules.
- Preserve existing auth, quota, idempotency, and version checks.
- Add tests with production behavior.
- Escalate shared-schema changes to WS3.
- Avoid snapshot updates without semantic review.

## 16. Not in scope

- Regenerating or repairing legacy v2 project geometry.
- Letting GPT invent missing structural architecture.
- Structural engineering certification or construction-ready calculations.
- Bucket-wide storage cleanup unrelated to a selected project.
- Replacing auth, billing, quota, cost catalogs, or unrelated drawing style.
- Adding a general background-job platform solely for project deletion.

## 17. Final review record

Review completed on 2026-07-18 against this document and the current repository. Three independent subagents reviewed lifecycle/data safety, architectural/geometry contracts, and execution/test/rollout readiness. Each reviewer performed an initial adversarial pass, reviewed the integrated corrections, and then received the current file for a final go/no-go decision.

| Review track | Final verdict | Material corrections incorporated before sign-off |
|---|---|---|
| Lifecycle and data safety | **GO** | Explicit profile/status capability matrix; frozen v2 dispatch; atomic mutation recheck; stable create idempotency; shared lifecycle lock; manifest-first storage; `finalizing` state/lease; durable deletion/retry; archived-project policy; lifecycle observability |
| Architectural and geometry contracts | **GO** | One floor-region authority; explicit enclosure/pergola roof union; primary-versus-secondary support ownership; computable bearing-line/reach rules; semantic massing shape union; normative parti fingerprint; versioned validation-report contract; physical-validator dependencies; dimensionally correct outdoor-area policy; drawing/cost/deck/CAD consumers |
| Execution, tests, and rollout | **GO** | Conflict-free file ownership; corrected WS3A/WS3/WS8 dependencies; non-empty integration/E2E commands; five independent provider-sample evaluation; measurable hold conditions; assigned operational evidence; migration rehearsal and rollback behavior |

Final gate: **GO for implementation.** No P1 or P2 review finding remains open. Any implementation-time change to a normative contract in §§4–8, workstream ownership/dependencies in §§9–10, or release gates in §14 requires a new focused review before merge.

## 18. Implementation outcome and verification record

Implementation completed on 2026-07-18. By product decision, the application now issues v3 to every account by default. Explicit `BRICKPILOT_DESIGN_ROLLOUT_MODE=v2` remains the emergency rollback switch, and an invalid non-empty mode fails safely to v2.

### Delivered

- Clean, isolated project drafts with stable create idempotency; old answers are restored only through an explicit draft ID.
- Legacy and archived projects are view-only at both UI and API boundaries; AI suggestions, scheme changes, captures, and renders are denied server-side.
- Durable project deletion with exact-key asset manifests, quiescence, retryable jobs, provider cancellation/reconciliation, and owner-scoped status/retry APIs.
- Schema-v3 questionnaire and pipeline with explicit entry, parking, outdoor-area, above-parking, roof, shade/pergola, facade, and provenance contracts.
- Distinct topology generation, honest smaller scheme sets, program-first allocation, partial floor plates, and canonical polygon regions.
- Arrival/privacy circulation that keeps parking, verandahs, kitchens, service rooms, and private rooms out of access spines; attached bathrooms connect only through their declared bedroom.
- Role-sized openings, a larger materially distinct main door, a real road-side main entry, and a canonical vehicle aperture.
- Canonical exterior daylight windows, fail-closed daylight validation, aligned multi-floor stair regions, and a continuous vertical connector derived from actual stair geometry.
- Sloped/articulated roofs, independent canopy/pergola supports, parking-clear post placement, elevated-edge guards, and open-pergola member geometry.
- Versioned v3 drawing, CAD, deck, PDF, massing, quantity, cost, validation, persistence, scheme-selection, and architectural-review consumers while preserving frozen v2 behavior.
- GPT image 2 semantic camera/prompt binding to the actual primary road facade and main entry, with canonical geometry locks and sophisticated primary-facade material hierarchy.
- Durable five-sample render-evaluation metadata, authenticated disposition API/UI, and aggregate structural/aesthetic release gates.
- Service-only evaluator results, owner-only human disposition, current-geometry evaluation scoping, and an internal five-sample reservation path isolated from normal user quotas.
- Durable provider dispatch tokens and webhook recovery so a provider acceptance cannot be orphaned by a later database failure.
- Drainable pre-provider dispatch leases: stale claims recover the same job/token through compare-and-set, while ambiguous provider attempts are never redriven.
- Exact v2/v3 AI-suggestion dispatch that preserves all v3 intent/provenance while keeping legacy and deleting projects blocked.

### Verification evidence

| Check | Result |
|---|---|
| Supported unit/component/API suite | **440 passed, 1 skipped, 0 failed; 11,173 assertions**. The skipped DB case passed separately in the isolated integration run. |
| Lifecycle E2E contracts | **3 passed, 0 failed** |
| Migration rehearsal | **2 passed, 0 failed** against isolated `brickpilot_test` |
| Database lifecycle + scheme-selection integration | **3 passed, 0 failed** against isolated `brickpilot_test` |
| TypeScript | `tsc --noEmit` passed |
| Production build | Next.js 16.1.7 production build passed; all routes compiled |
| Migration schema | `drizzle-kit check` passed; migrations `0008`-`0012` applied locally; migration count 13, dispatch enum and four dispatch columns verified |
| Source hygiene | `git diff --check` passed; no non-reference `test.todo` remains |
| Fresh runtime check | Dev server restarted successfully; the reported draft URL returned the expected unauthenticated `307 /login` with no fresh auth/database/compaction error |

### Confirmed runtime incident root cause

The reported `Failed to get session`/session SQL error was secondary to local storage exhaustion. Turbopack could not compact its database (`No space left on device`), concurrent persistence batches then backed up, and PostgreSQL was unavailable during the session lookup. After disk recovery, PostgreSQL restart, migration verification, and a fresh Next.js restart, the same workspace request no longer reproduces the 500. No auth-code change was required for that incident.

### External pre-GA hold gates still open

- Produce five real independent GPT Image 2 outputs for one fixed v3 reference batch using deployment credentials/credits.
- Run the approved evaluator and one human reviewer across all five outputs.
- Require 5/5 structural passes and at least 4/5 aesthetic/material passes.
- Smoke-test the deployed Replicate webhook and R2 persistence/finalization path.
- Apply migrations through `0012_drainable_render_dispatch.sql` in every deployment environment before exercising the new render dispatch path.
- Keep the five-sample evaluator gate restricted to the internal service workflow until these checks pass. V3 generation remains the default for all accounts; use explicit `v2` only as an emergency rollback.

### Final adversarial correction pass

The first implementation review returned **NO-GO** despite green component tests. It found missing multi-floor stair continuity, zero-window v3 buildings, parking-support conflicts, false balcony provenance, forgeable/stale release-evaluation gates, an unreachable five-sample production path, provider calls inside a database transaction, and a disabled v3 AI-suggestion path. All findings were repaired and converted into production-path regressions before the final build.

The exact three-floor reference now completes the production pipeline as hard-valid with three aligned stair regions, one continuous F0-F2 connector, 12 canonical exterior windows, no support-clearance finding, and no hard validation finding. The remaining three `AREA_TARGET_EXCEEDED` circulation warnings are explicit, keep the score below 100, and do not bypass validation.
