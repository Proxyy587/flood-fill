# ROADMAP (36-hour sprint)

Ambition is high, so this roadmap is built around **vertical slices** and **explicit cut lines**. At every milestone the project must be demoable. If we're behind, cut from the bottom of the list, never from the top.

## AK checkpoint status (2026-10-15)

Tooling repaired after syncing main 181ea06. Contracts, schemas/mocks, deterministic
grid/navigation, flood/power primitives and headless API/CLI are implemented with
health tests. See AK_STATUS.md for exact gates and local checkpoint commits.
M0 remains partial until AJ's mock-snapshot renderer/bridge exists. M1 now has
headless commuting agents/cars/staff, mode hazard grids and basic traffic; browser
integration and independent review approval are still pending. M2 now has delayed
warnings and capacity-reserved shelter evacuation; powered pump configuration and
expanded hazard integration remain. Blackout traffic is implemented.
M3-M6 remain pending. Dispatch comparison is labelled
unavailable; no performance/response benefit has been measured. W1 templates are
missing and the strict release-validation command correctly fails.

## Team

| Who | Role |
|---|---|
| **AK** | Sim core (flood, nav, agents, dispatch, hospitals, power, helicopters), integration |
| **AJ** | three.js renderer, camera and picking, worker bridge, integration |
| **Worker 1** | Voxel assets, palette, scenario templates |
| **Worker 2** | Editor tools, UI panels, NPC sliders, save/load |
| **Worker 3** | Metrics dashboard, replay, AI critic and report |

## Milestones

### M0 — Contracts and skeleton (H0–H3) · MUST
- Repo, Next.js, TS strict, lint rules (sim purity, determinism), Vitest
- `src/contracts/*` frozen from `docs/CONTRACTS.md`, Zod schemas, mocks (including power grid & helicopter types)
- Worker bridge stub: sim worker emits fake snapshots, the renderer draws them
- Workers start on mocks as soon as M0 is merged

### M1 — The living city, dry (H3–H10) · MUST
- Grid world, scenario load, blocks rendered as chunked voxels (AJ)
- Road graph, A*, flow fields, intersections, basic traffic (AK)
- Voxel assets: helicopter (with animated rotor), helipads, substation, power plant, poles (W1)
- Civilians commute, cars drive, staff go to work and return (AK)
- Camera: overview, focus, follow, inspector panel (AJ + W2)
- Editor: place and erase blocks, roads, power lines, buildings; save/load; 1 template (W2, W1)
- **Demo:** an active city you can edit and watch

### M2 — Water arrives & Power cuts (H10–H18) · MUST
- Flood solver with pooling and drainage; mass-conservation test (AK)
- Water rendering, depth colours, rain (AJ)
- Passability by mode; road closures; REROUTE events with reasons (AK)
- **Power grid solver**: Substation depth triggers trip; cascading blackout propagation; unpowered signals become 4-way stops (capacity ×0.5); hospital generators engage with fuel countdown; pumps lose power (AK)
- Weather timeline, flash-burst source (AK)
- Evacuation to shelters via flow fields (AK)
- **Demo:** a city that floods, power cascades, and traffic that adapts

### M3 — Rescue, Aerial Ops & Dispatch (H18–H26) · MUST
- Requests, reports with uncertainty, HQ belief map (AK)
- Negotiation and centralised baseline, same seed (AK)
- Boats, ambulances, police; hospital balancing with diversion (AK)
- **Helicopters**: Rooftop rescue of stranded civilians; medevac transfers between helipads; weather constraints (grounded if wind > threshold); air graph routing (AK)
- Metrics and `sim:compare`; dashboard with comparison charts, power outage %, and aerial rescue stats (W3)
- Event log, replay timeline, "why was this rerouted" panel (W3 + W2)
- **Demo:** negotiation vs baseline with numbers, including blackout handling and air rescues

### M4 — Critic loop (H26–H31) · MUST (a thin version)
- Analysers → evidence pack (including `powerCascade` and `isolatedRooftops`) → `/api/critic` → report UI (W3)
- Critic proposals: drainage, road links, levees, backup generators, substation relocation, helipads (W3 + AK)
- Patch preview/apply, verify run with K seeds (W3 + AK)
- Offline fallback and pre-cached reports (W3)
- **Demo:** "the AI says add a generator and helipad here, and the sim confirms response improved 18%"

### M5 — Chaos and polish (H31–H34) · MUST
- Full stress scenario: Simultaneous bridge closure + boat failure + shelter overflow + substation flood + gale wind grounding helicopters (AK + W1 + W2)
- Injected-event panel: trip substation, ground helicopters, cut comms, flood bridge (AK + W2)
- Truth vs HQ-belief toggle (AJ)
- Visual polish: blackout building tint, darkened signals, rotating helicopter blades (AJ)

### M6 — Demo hardening (H34–H36) · MUST
- 3-minute demo script, pre-recorded fallback video, seeded "golden" run
- Limitations note, README, screenshots
- Freeze. No new features.

## Cut lines (cut in this order if behind)
1. Contraflow on evacuation roads
2. Trees falling in high wind and blocking roads
3. Clogged stormwater drains
4. Truth-vs-belief toggle
5. Cinematic camera, rain particles, day/night lighting
6. Number of templates (keep 2)
7. Verification K seeds (drop to 6)

**Never cut:** flood with pooling, dispatch comparison (negotiation vs centralised), power grid trips & cascading blackouts, helicopter rooftop/medevac rescues, metrics, event log with reasons, replay, critic with verified delta, invariants.

## Daily rhythm
- Every 4 hours: **merge window**. Workers push; AK/AJ merge, run `pnpm health`, fix contracts, rebroadcast. Once templates exist, also run `pnpm validate --require-templates`; schema/presence validation does not replace template connectivity or full-release gates.
- Workers post blockers in `docs/REQUESTS.md`, not in chat threads.
- Always keep `main` runnable. Workers branch as `w1/...`, `w2/...`, `w3/...`.

## Risks
| Risk | Mitigation |
|---|---|
| Sim too slow with 1000 NPCs | typed arrays, flow fields, staggered decisions, cap at default 600 |
| Flood solver unstable | CFL-safe `k`, clamp, conservation test, fallback to simple threshold spread |
| Render/worker data copying | transferable typed arrays, snapshot cap 20 Hz |
| Workers diverge from contracts | Zod validation in CI, mocks in repo |
| LLM output invalid or offline | schema validation, retry once, analyser-only fallback, cached reports |
| Scope explosion | cut lines above; M-gates are demoable |
