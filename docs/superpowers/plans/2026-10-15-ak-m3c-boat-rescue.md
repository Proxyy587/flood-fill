# AK M3C Boat Rescue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add finite, deterministic boat fallback rescue for delivered incidents with no safe ambulance route, returning injured civilians to the existing ambulance/hospital flow and other civilians to shelter or safe shore.

**Architecture:** Keep existing ambulance policies and shared contracts unchanged. Add a typed-array boat fleet using boat hazard routing, then integrate boat ownership and scene discovery with the existing incident/patient lifecycle; preserve civilian and shelter state through explicit passenger handoffs. Runner owns tick ordering, events, snapshots and recovery.

**Tech Stack:** Strict TypeScript, Vitest, existing seeded sim state, hazard grids and pathfinding.

---

### Task 1: Finite boat fleet and safe water movement

**Files:**
- Create: `src/sim/dispatch/boats.ts`
- Create: `src/sim/dispatch/boats.test.ts`
- Read: `src/sim/dispatch/ambulances.ts`, `src/sim/nav/hazards.ts`, `src/sim/invariants/movement.ts`

- [x] Write tests first for fleet count `min(boats, boatOperators)`, stable non-colliding IDs, no-launch unavailability, four-seat capacity, safe depot launch, draft/obstacle constraints, single-cell deterministic movement, and rerouting after `navVersion` changes.
- [x] Run `pnpm exec vitest run src/sim/dispatch/boats.test.ts`; confirm the expected missing-module/behavior failures.
- [x] Implement boat state in typed arrays; initialize only beside configured depots at a safe water-access cell, route with `buildHazardGrid(..., "boat")`/`findPath`, and assert each entered cell with `assertMovementEntry`.
- [x] Re-run the focused boat suite, then ambulance and movement suites.

### Task 2: Incident ownership and field rescue lifecycle

**Files:**
- Modify: `src/sim/dispatch/incidents.ts`
- Modify: `src/sim/dispatch/incidents.test.ts`
- Modify: `src/sim/runner.ts` for fallback after unchanged ambulance policy dispatch
- Modify: `src/sim/dispatch/ambulances.ts` only if shared assignment release needs a narrow helper (not needed)
- Test: `src/sim/runner.test.ts`

- [x] Add red tests proving reachable incidents remain ambulance-owned and boat fallback is used only when no safe ambulance route exists.
- [x] Add tests for scene search exactly once, provenance retention, boat false-report resolution, and four-seat passenger bounds.
- [x] Run focused runner/incident/boat suites and verify the expected missing-boat behavior fails.
- [x] Implement boat assignment after the existing policy dispatch; add route-loss/failure cancellation and requeue while retaining current ambulance eligibility and ranking.
- [x] Re-run incident, runner, and ambulance suites; centralised/negotiation behavior is unchanged and exercised by same-seed policy comparison.

### Task 3: Rescue passenger destinations and reservations

**Files:**
- Modify: `src/sim/runner.ts` for field classification and safe shore selection
- Modify: `src/sim/agents/system.ts` for atomic shelter reservation and civilian handoff
- Modify: `src/sim/dispatch/incidents.ts` for non-hospital served state
- Tests: `src/sim/agents/system.test.ts`, `src/sim/dispatch/incidents.test.ts`

- [x] Write tests for post-arrival incident discovery, atomic shelter assignment, healthy home handoff, and non-hospital incident completion.
- [x] Write tests that full shelter capacity cannot be reserved twice; existing civilian retry behavior retains unmet demand.
- [x] Run focused tests and observe failures before production edits.
- [x] Implement deterministic safe landing selection, atomic shelter reservation reuse, passenger ownership, and ambulance patient requeue after shore unload. Do not expose hidden health/home truth before arrival.
- [x] Re-run destination, agents, hospital, and incident suites.

### Task 4: Runner integration, events, snapshots and adaptive demand

**Files:**
- Modify: `src/sim/runner.ts`
- Modify: `src/sim/runner.test.ts`
- Modify: `src/sim/dispatch/boats.ts` and focused tests as required
- Modify: `docs/CHANGELOG.md` (append one M3C line)

- [x] Add end-to-end tests for delivered report → boat fallback → field verification, ambulance-first ownership, and injected boat failure requeue.
- [x] Preserve existing hotspot-driven ambulance prioritization; no new boat-specific hotspot metric or contract is added.
- [x] Verify snapshots contain copied boat vehicle arrays and no hidden civilian fields; events use existing event types and stable reasons.
- [x] Integrate deterministic tick order after hazards/closures and before metric/snapshot projection; preserve response and hospital metrics without adding contract fields.
- [x] Re-run runner, dispatch, report, movement, and hotspot suites.

### Task 5: Deterministic recovery and full verification

**Files:**
- Modify: focused tests only for regressions exposed by integration
- Modify: `docs/CHANGELOG.md` if the final acceptance status needs a concise addition (do not duplicate the M3C entry)

- [x] Add replay tests comparing events and metrics for identical scenario/seed/mode, boat failure and route-loss recovery, five-casualty repeat trips, simultaneous boat arrivals at distinct incidents, injured boat-to-road-to-ambulance-to-hospital admission, unique scene ownership, and blocked-road handoff rejection.
- [x] Run `pnpm health`, `pnpm build`, `pnpm sim:batch`, `pnpm sim:compare`, and a deterministic multi-seed boat/ambulance smoke using existing schema-valid scenarios.
- [x] Review `git diff --check`, contract diff (must be empty), and changed-file scope; report any acceptance item that remains deferred or unverified.

## Plan self-review

- Covers all design sections: bounded water movement and finite fleet (Task 1); ambulance-first assignment, single owner, provenance and scene-only truth (Task 2); injury triage, hospital handoff, shelter reservation and healthy safe-shore return (Task 3); event/tick/snapshot integration and adaptive demand (Task 4); invariants, recovery and determinism (Task 5).
- No shared-contract edits are allowed. If a required behavior cannot fit the existing contract or AK lane, stop and report the smallest needed approval/request rather than silently expanding scope.
- Fuel/refuelling, police, helicopters, full compound stress, renderer/worker integration and boat-specific metrics remain deferred as specified.
