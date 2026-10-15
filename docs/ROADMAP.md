# ROADMAP (36-hour sprint)

Ambition is high, so this roadmap is built around **vertical slices** and **explicit cut lines**. At every milestone the project must be demoable. If we're behind, cut from the bottom of the list, never from the top.

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
- `src/contracts/*` frozen from `CONTRACTS.md`, Zod schemas, mocks
- Worker bridge stub: sim worker emits fake snapshots, the renderer draws them
- Workers start on mocks as soon as M0 is merged

### M1 — The living city, dry (H3–H10) · MUST
- Grid world, scenario load, blocks rendered as chunked voxels (AJ)
- Road graph, A*, flow fields, intersections, basic traffic (AK)
- Civilians commute, cars drive, staff go to work and return (AK)
- Camera: overview, focus, follow, inspector panel (AJ + W2)
- Editor: place and erase blocks, roads, buildings; save/load; 1 template (W2, W1)
- **Demo:** an active city you can edit and watch

### M2 — Water arrives (H10–H18) · MUST
- Flood solver with pooling and drainage; mass-conservation test (AK)
- Water rendering, depth colours, rain (AJ)
- Passability by mode; road closures; REROUTE events with reasons (AK)
- Weather timeline, flash-burst source (AK)
- Evacuation to shelters via flow fields (AK)
- **Demo:** a city that floods and traffic that adapts

### M3 — Rescue and dispatch (H18–H26) · MUST
- Requests, reports with uncertainty, HQ belief map (AK)
- Negotiation and centralised baseline, same seed (AK)
- Boats, ambulances, police; hospital balancing with diversion (AK)
- Metrics and `sim:compare`; dashboard with comparison charts (W3)
- Event log, replay timeline, "why was this rerouted" panel (W3 + W2)
- **Demo:** negotiation vs baseline with numbers

### M4 — Critic loop (H26–H31) · MUST (a thin version)
- Analysers → evidence pack → `/api/critic` → report UI (W3)
- Patch preview/apply, verify run with K seeds (W3 + AK)
- Offline fallback and pre-cached reports (W3)
- **Demo:** "the AI says add a drain here, and the sim confirms p90 response improved 18%"

### M5 — Chaos and polish (H31–H34) · SHOULD
- Power grid with trips, generators, signals off (AK)
- Helicopters (rooftop rescue, medevac) (AK + W1 model)
- Injected-event panel: bridge + boat + shelter stress scenario (AK + W2)
- Truth vs HQ-belief toggle (AJ)

### M6 — Demo hardening (H34–H36) · MUST
- 3-minute demo script, pre-recorded fallback video, seeded "golden" run
- Limitations note, README, screenshots
- Freeze. No new features.

## Cut lines (cut in this order if behind)
1. Helicopters
2. Power grid detail (keep a simple "substation floods → hospital on generator")
3. Contraflow, trees falling, clogged drains
4. Truth-vs-belief toggle
5. Cinematic camera, rain particles, day/night
6. Number of templates (keep 2)
7. Verification K seeds (drop to 6)

**Never cut:** flood with pooling, dispatch comparison, metrics, event log with reasons, replay, critic with verified delta, invariants.

## Daily rhythm
- Every 4 hours: **merge window**. Workers push; AK/AJ merge, run `pnpm lint test validate`, fix contracts, rebroadcast.
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
