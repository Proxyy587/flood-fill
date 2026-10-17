# FloodSim

Synthetic **2.5D voxel city flood sandbox** for Code-E-Manipal 2.0 (PS 27 + city-planning demo).

Build or load a city → run a compound flood → watch civilians, traffic, power and rescue respond → get a resilience **score** and **AI suggestions** you can preview, verify, and apply. Optional **Laya** ONNX decisions can set Core-run dispatch/hospital preferences before tick 0.

Simulation output only — not an emergency-planning authority. Synthetic data only; no live maps or personal feeds.

---

## Routes

| Route | What you get |
|---|---|
| `/` | **City atlas** — stylised Guwahati overview; pick a district |
| `/six-mile/simulate` | **Six Mile** district storm (image-inspired Guwahati twin, imperfect drainage) |
| `/sandbox` | Freestyle riverside city — edit + run (Core by default) |
| `/laya` | Browser Laya ONNX shadow lab (opt-in; does not alter the city by itself) |

Atlas pins: **Six Mile** → district sim · **Paltan Bazaar** → sandbox · **Biswanath Town** → preview only.

---

## Features (current)

### City atlas & handoff
- Interactive Guwahati overview (Brahmaputra, ridges, basins, Six Mile SE)
- Cloud wipe + camera dive into Six Mile for a clean atlas → sim transition
- Prefetch of simulate/sandbox routes for snappy navigation

### 2.5D viewer
- Voxel city with day/night sky, rain, water depth
- Orbit / focus / follow camera, compass
- Lenses: people, traffic, depth, exposure, power (+ overlays)
- Incident board, docked alerts, news ticker, city vitals

### Edit mode
- Roads, buildings, drainage, terrain brushes; hotbar; undo/redo
- Save / load; scenario templates
- Branch a city when applying AI patches

### Storm transport
- Play / pause, scrub timeline forward & back (replay recorded ticks or catch up ahead)
- **Presentation clock:** at **1×**, ~1 wall-minute ≈ 1 simulated hour; slider **1 / 2 / 4 / 8 / 16×** (default 4×)
- Skip ±10 simulated minutes; Live jump to the furthest simulated moment
- Engines: **Core** (AK deterministic sim) or **Preview** (showcase set-pieces). Six Mile forces Preview
- Inject stress events; rescue boat release on Preview

### Rescue & living city (sim)
- Civilians commute; cars, ambulances, boats, police, helicopters (by engine)
- Negotiation vs centralised dispatch
- Hospital triage / beds / generators; uncertain incident reports
- Safety invariants (depth limits, no double-allocation, capacity rules)

### Score → Suggestions → Apply
- Explainable **city resilience score** (lives, homes, response, mobility, power, care)
- Report panel: score, charts, why/replay, **Suggestions**, dispatch compare
- AI critic (OpenRouter) or rule-based fallback: findings + budgeted proposals
- Budget strip: **Low / Mid / High** + **Eco**
- Whitelisted patches: drains, roads, bridges, levees, trees, helipads, hospital / police / shelter / boat depot
- **Green create / red alter** map ghosts + camera focus; Verify in a worker; human Apply

### Laya (optional)
- `/laya` shadow lab: local ONNX English checkpoint via dedicated worker
- Scenario → **Prepare Laya decisions** for the next **Core** run (dispatch mode + injury-tier hospital prefs)
- Simulator remains authoritative for feasibility, beds, power, routes
- Model files are gitignored; prepare with `pnpm laya:prepare` (see `docs/LAYA_BROWSER.md`)

### Quality / architecture
- Sim in a **Web Worker**; pure deterministic `src/sim` (seeded RNG)
- Contracts in `src/contracts`; Zod-validated scenarios
- Vitest; headless `pnpm sim:batch` / `pnpm sim:compare`

---

## Quick start

Node **24+**, pnpm **10.28.0**.

```bash
pnpm install
pnpm dev                 # http://localhost:3000
```

Optional critic:

```bash
# .env
OPENROUTER_API_KEY=…
OPENROUTER_MODEL=openai/gpt-4o-mini   # optional override
```

Optional Laya model (~1.7 GB, local only):

```bash
python3 -m venv .venv-laya
.venv-laya/bin/pip install "laya[onnx]==0.3.20" onnx onnxscript huggingface_hub hf_xet
pnpm laya:prepare        # → public/models/laya/
pnpm dev                 # open /laya → Load local model
```

---

## Commands

```bash
pnpm dev
pnpm test
pnpm lint
pnpm typecheck
pnpm validate
pnpm build
pnpm health              # lint + typecheck + test + validate
pnpm sim:batch
pnpm sim:compare
pnpm critic:cache
pnpm laya:prepare
```

---

## Demo path (hackathon)

1. Open `/` → enter **Six Mile**
2. Start the storm; scrub the timeline; watch flood + response
3. Open **Report → Score**; note the mid-range score on the imperfect twin
4. **Ask for feedback** → pick budget → Preview (green/red) → Verify → Apply
5. Re-run and compare score
6. (Optional) Sandbox + Core → Scenario → Prepare Laya decisions → run

---

## Docs

| Doc | Topic |
|---|---|
| `AGENTS.md` | Repo rules, lanes, stack |
| `features.md` | Product feature checklist |
| `docs/LAYA_BROWSER.md` | Browser Laya setup |
| `docs/FLOOD_DESIGN.md` | Six Mile flood design |
| `docs/AK_HANDOFF.md` | Core/preview engine notes |
| `docs/CHANGELOG.md` | Change log |

---

## Ownership

Read `AGENTS.md` and `workers/`. Shared types live in `src/contracts`. Contract changes need a changelog note; cross-lane asks go in `docs/REQUESTS.md`.
