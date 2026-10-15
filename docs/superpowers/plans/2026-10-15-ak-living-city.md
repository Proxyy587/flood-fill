# AK Living City Implementation Plan

> Use superpowers subagent-driven-development, TDD and verification-before-completion.

**Goal:** Replace empty entity tables with seeded commuting civilians/staff/cars,
hazard-safe movement and traffic in the existing pure headless runner.

**Architecture:** Typed-array population + cached routes; deterministic hazard and
traffic modules; one fixed-order step with independent snapshot/inspector outputs.

**Tech Stack:** Existing strict TypeScript, Vitest, Zod; no new dependencies.

## Stage A — contracts and planning

- [x] Add failing tests for bridge metadata, custom schedule and run options.
- [x] Implement types/schemas and update CONTRACTS/CHANGELOG in the same stage.
- [x] Add World bridgeDeck data with a synthetic ground+1m fallback.

## Stage B — independent primitives

- [x] Main: create seeded typed-array population and housing/work allocation tests;
      implement after observing red. Include staff roles and stable vehicle IDs.
- [x] Delegate src/sim/nav/hazards.ts + tests: foot/car/emergency/boat depth limits,
      entrances, explicit closures, bridge overtopping, quantized finite costs.
- [x] Delegate src/sim/traffic/** + tests: deterministic throughput/blackout factors,
      fair tick rotation hook, BPR costs and connected sustained-gridlock episodes.
- [x] Review primitives against spec and code quality; update docs with test evidence.

## Stage C — agents and runner integration

- [x] Failing tests: office/night/custom schedules, foot and car round trips,
      no teleport on disconnected routes, closure reroute, car stall and safety.
- [x] Implement routes/behaviour/movement, then integrate runner snapshots, metrics,
      inspect and supported road/bridge fault injection.
- [x] Preserve undispatched fleet/aircraft/response metric disclosure. No policy
      improvement claims. Add a labelled living mock fixture for CLI smoke evidence.

## Stage D — verification checkpoint

- [x] Full health, build, multi-seed 600+ tick batch/compare, default/stress population
      performance checks and every entered-cell safety regression.
- [ ] Independent post-implementation review; fix and reverify actual findings.
- [x] Update README, SIM_SPEC, ARCHITECTURE, ROADMAP, AK_STATUS, CHANGELOG and review
      ledger with implemented-versus-pending boundaries; local checkpoint commit.

Follow-on: evacuation, beliefs/reports, resource dispatch, hospital balancing,
helicopters, patch verification and full stress. Preserve the original roadmap.

Review gate remains INCONCLUSIVE, not silently completed: substantive Luna-medium
QA/quality/security rechecks pass, but CodeRabbit and security-review prerequisites
are unavailable. Actual reproduced defects were fixed. See AK_REVIEW.md. Resource
budgets defer planning under load; the 8ms tick target is not established.
