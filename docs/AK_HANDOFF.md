# AK handoff — intelligence import onto Guwahati mainline (2026-10-16)

AJ imported **AK simulation intelligence only** onto the Guwahati showcase line and kept AJ’s atlas/shell UI as the product surface. AK’s DecisionPanel UI was **not** merged.

Use this file as the context handoff for AK’s next slices.

---

## What landed (sim intelligence)

### Core dispatch / agents (pure `src/sim`)

| Area | Files | Notes |
|---|---|---|
| Boat rescue (M3C) | `src/sim/dispatch/boats.ts` (+ tests) | Finite operator-bounded fleet, navigable water, seat limits |
| Police traffic (M3D) | `src/sim/dispatch/police.ts` (+ tests) | Gridlock ownership, arrival control, deterministic arbitration |
| Police escort (M3E) | `src/sim/dispatch/police-escort.ts` (+ tests) | Roadside rendezvous; guidance only after arrival |
| Police crowd (M3F) | `src/sim/dispatch/police-crowd.ts` (+ tests) | Chokepoint / shelter pressure, critical preemption |
| Runner wiring | `src/sim/runner.ts` (+ tests) | Integrates boats/police into the headless tick |
| Agents / flood / movement | `src/sim/agents/system.ts`, `flood/solver.ts`, `invariants/movement.ts` | Supporting fixes from AK mainline |

### Worker / bridge (outside pure sim)

| Area | Files | Notes |
|---|---|---|
| Host playback / seek | `src/worker/host.ts` | Busy catch-up, seek supersede, speed clamp **256×** |
| Engines | `src/worker/engines.ts` (+ test) | Core vs preview factory |
| AK adapter | `src/worker/akAdapter.ts` | Injectable mapping, snapshot/event bridging |
| Optional AK worker path | `src/bridge/akSim.worker.ts`, `akSimAdapter.ts` | Present for alternate wiring; **default browser worker remains** `src/worker/sim.worker.ts` via `createSimWorker` |
| Scene defaults | `src/bridge/sceneStore.ts` | Default engine = **`core`** |
| Decision event filter | `src/shell/decisionEvents.ts` | Selector only — **no DecisionPanel UI** |

### Contracts / stress

- `src/contracts/sim-schemas.ts`, `scenario.ts` — AK injectable shapes kept in sync
- `src/shell/tools/StressTool.tsx` — core-safe injections
- `FloodSimApp` demo:stress — boat/shelter/substation only when present; no heli grounding on core
- Transport: rescue teams disabled on **core** (boats dispatch from sim)

### Specs / plans (documentation only)

Under `docs/superpowers/plans/` and `docs/superpowers/specs/` for M3C–M3F + mainline stabilization, plus updates to `docs/AK_STATUS.md`, `ROADMAP.md`, `SIM_SPEC.md`.

---

## What AJ deliberately did **not** take from AK

- **DecisionPanel** (or any AK-only decision chrome) — not mounted; use `decisionEvents` if a future panel is needed
- AK-specific shell layout that conflicted with Guwahati atlas / Six Mile showcase
- Replacing AJ’s OpenRouter critic path, cloud wipe, or atlas UX

---

## Engine policy (current product)

| Surface | Engine | Why |
|---|---|---|
| Default / sandbox | **core** | Validated sim for judging / critic |
| Six Mile `/six-mile/simulate` | **preview** (forced) | Showcase set-pieces: waterlogging, heli, rescue release |
| Scenario tool | User can pick core \| preview | Help text explains the split |

---

## AJ product work on the same branch (context for AK)

Not AK’s lane, but affects demo and integration:

- Guwahati atlas terrain (ridges, Deepor, Brahmaputra), zoom clamp, Paltan → `/sandbox`
- Six Mile hollows/ridges, stronger local waterlogging hyetograph (`docs/FLOOD_DESIGN.md`)
- Transport timeline repair: growing window, ±10 min skip, optimistic scrub, 1×–256× speed snaps
- Atlas back link inside identity; `features.md` inventory
- Critic: OpenRouter (`OPENROUTER_API_KEY` / `OPENROUTER_MODEL`)

---

## Still open for AK (please pick up)

Update/confirm against `docs/REQUESTS.md` `[AJ -> AK]` lines. Highest impact for demo:

1. **Core flood calibration** — templates still saturate; need outflow / rate recalibration so districts differ
2. **Negotiation vs centralised** — confirm metrics actually diverge under contention
3. **Live `inject` at current tick** — stress buttons should not always restart from 0 on core
4. **`hqBelief.water`**, richer **inspect** (buildings/ambulances), **homesFlooded / residentsAffected / roadsClosedPct**
5. **Helicopters in core** (rooftop / medevac / wind) — still preview-only for showcase
6. **WEATHER spam** — emit on change or ≤1/min
7. **Core speed** — catch-up/seek still heavy on large maps (AJ raised busy slice; core step cost remains)

Boats + police **are now in core** on this branch; older REQUESTS lines that say they are “missing from core” should be marked DONE when you verify on your side.

---

## How to verify locally

```bash
pnpm test -- src/sim/dispatch src/sim/runner.test.ts src/worker/host.test.ts src/bridge/sceneStore.test.ts
pnpm exec tsc --noEmit
pnpm dev
# Atlas / → Six Mile (preview) · Paltan → sandbox (core)
# Scenario tool: confirm Core vs Preview help text
```

Focused dispatch suites (boats/police/escort/crowd) were green when imported. Full `host` template×engine matrix can be slow on core (coastal-grid); that is a performance issue, not a missing feature.

---

## Branch / merge note

Work was integrated on `aj/guwahati-six-mile-showcase` and merged to **`main`** for this handoff. Prefer small follow-up PRs for core calibration and heli rather than another large intelligence dump.
