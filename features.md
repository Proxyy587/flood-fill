# FloodSim — current features

What you can do in the product today. Synthetic cities only; output is simulation, not emergency-planning advice.

## Entry points

| Route | What it is |
|---|---|
| `/` | **City atlas** — stylised Guwahati overview; pick a district pin |
| `/six-mile/simulate` | **Six Mile district storm** — compound flood demo on the image-inspired district |
| `/sandbox` | **Test sandbox** — freestyle city (riverside template) for edit + run |

**Atlas pins**

- **Six Mile** → district simulator (cloud handoff)
- **Paltan Bazaar** → sandbox city
- **Biswanath Town** → location preview only (no full district yet)

## City atlas (`/`)

- Interactive 2.5D Guwahati map: Brahmaputra, Deepor Bil, Nilachal / southern ridges, dense basins, Six Mile SE, airport, NH27 edge
- Terrain highs (forested ridges) and lows (flood basins) so the city is not a flat slab
- Zoom clamped so you cannot pull back past city overview; pan/tilt limited
- District list panel + map pins; Labels toggle in the header
- Sandbox link in the header

## Simulation shell (Six Mile + sandbox)

### Watch

- 2.5D voxel city with day/night sky, rain, water depth colours
- Camera: orbit, focus, follow; compass
- Lenses: people, traffic, depth, exposure, power (+ overlays)
- Incident board (showcase checklist) and docked alerts / news ticker
- City vitals, score badge, hover tip on cells

### Edit (design mode)

- Build / erase roads, buildings, drainage, terrain brush
- Hotbar, undo/redo
- Save / load cities; load scenario templates from files
- Branch a city when applying critic patches

### Run the storm

- Play / pause, snapping speed slider (1×–256×), scrub timeline (replay or simulate ahead), seek / replay
- **Engines:** Core (AK validated sim, default) or Preview (showcase model with helicopters, waterlogging set-pieces)
- Six Mile forces **preview** for district set-pieces
- Morning start (~08:00) and long compound-flood hyetograph on Six Mile
- Inject stress events (bridge closed, boat failure, shelter overflow, substation flood, … — core-safe set)
- Release rescue boat teams (preview; disabled on core — boats dispatch from the sim)

### Rescue & dispatch intelligence (sim)

- Ambulances, hospital triage / diversion / generators
- Boats with operator/seat limits (core)
- Police: traffic control at gridlock, civilian escort, crowd control (core)
- Negotiation vs centralised dispatch modes
- Uncertainty-tagged incident reports
- Safety invariants (depth limits, no double-allocation, etc.)

### AI critic

- After a run: analyse metrics + event log
- Proposes a **ScenarioPatch** via OpenRouter (`OPENROUTER_API_KEY` / `OPENROUTER_MODEL`) — never silent city edits
- Multi-seed verification of accepted patches
- Offline fallback / cached reports when the API is unavailable

## Six Mile district specifically

- Image-inspired Guwahati district with APDCL campus grove
- Ridge shelves vs channel / underpass / junction hollows
- Named waterlogging hotspots + storm drains
- Compound flood: rain hyetograph + channel sources (see `docs/FLOOD_DESIGN.md`)
- Atlas → simulate cloud wipe transition

## Tooling & quality

- Sim runs in a **Web Worker** (main thread stays responsive)
- Deterministic sim (`src/sim`, seeded RNG)
- Vitest suite; Zod-validated scenarios
- Headless batch / compare scripts (`pnpm sim:batch`, `pnpm sim:compare`)
- `pnpm validate` for scenario JSON

## What you cannot do yet

- Live maps / real GIS / personal data feeds
- Full Paltan or Biswanath district models (Paltan uses sandbox; Biswanath is preview-only)
- Silent AI city mutation without human accept + re-run
- Claiming a universal winner between negotiation and centralised dispatch

## Quick start

```bash
pnpm install
pnpm dev          # atlas at http://localhost:3000
# optional critic:
# OPENROUTER_API_KEY=… OPENROUTER_MODEL=… in .env
```
