# TODOS

Deferred work with full context. Source of truth for "later" — if it isn't here, it doesn't exist.

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
