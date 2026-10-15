# WORKER 2 — City Editor and UI Panels

Read `AGENTS.md`, `docs/CONTRACTS.md` (esp. `EditCommand`, `NpcParams`, `InspectorData`) and `docs/SIM_SPEC.md` §1–2, §4 first.

## Your lane
**You may edit only:**
- `src/editor/**`
- `src/ui/panels/**`, `src/ui/hud/**`, `src/ui/store/**`
- `app/page.tsx` and `app/layout.tsx` (layout only; the AJ-owned `<FloodSimApp/>` mounts the canvas)
- `docs/REQUESTS.md` (append only)

Do **not** touch `src/sim`, `src/render`, `src/contracts` (read only), `src/ai`, `src/ui/replay`, `src/ui/dashboard`.

## Mission
Everything the human clicks that isn't the 3D canvas or the charts: the sandbox editor tools, the NPC sliders, the inspector, the run controls.

## How you talk to the rest of the system
- The editor emits **`EditCommand`s** through `editorBus.dispatch(cmd)`. AJ wires the bus to the worker. You never mutate the world directly.
- The editor receives the **cell under the cursor** and the **hover entity** from AJ via `useSceneStore` (`hoverCell`, `hoverEntity`). Until AJ lands it, drive it with a fake 2D grid test harness at `/editor-playground` (your own route).
- Block metadata comes from `BLOCK_META` (Worker 1). Until it exists, stub it locally in `src/editor/mockMeta.ts` and swap later.

## Task A: Editor core (first 4 hours)
- `EditorState`: active tool, active block, brush size, height brush amount, mode (`edit | run | replay`).
- Tools: **Place block**, **Paint rect/line** (drag; roads as a polyline), **Erase**, **Raise/Lower terrain**, **Place building** (multi-cell footprint with a ghost preview and validity check: bounds, overlap, road adjacency for depots/hospitals), **Eyedropper**, **Power line** (connect nodes), **Select/Move**.
- **Undo/redo** (command stack, ≥ 100 deep) over `EditCommand` inverse pairs.
- **Validation rules** shown as warnings in a panel (non-blocking): hospital without road access, building with no road, substation with no downstream loads, shelter capacity 0, no flood HQ placed, disconnected road components.
- Keyboard shortcuts: 1–9 hotbar, `[`/`]` brush size, `Ctrl+Z/Y`, `Space` run/pause, `Esc` back to overview camera.

## Task B: Hotbar and palette UI (hours 4–7)
- Minecraft-style bottom hotbar (9 slots, customisable), plus a categorised block picker (Terrain, Roads, Buildings, Emergency, Utilities, Flood control).
- Tooltip per block: name, footprint, what it does, key stats.
- The editor is **disabled during run/replay** (grey out, show a "Pause and edit" button; edits during a run create a new branch scenario, so ask a confirmation).

## Task C: NPC and scenario sliders (hours 7–11)
`src/ui/panels/ParamsPanel.tsx`:
- Sliders for every field of `NpcParams` (ranges, tooltips, "what this does" text taken from `SIM_SPEC.md` §2).
- Fleet controls (ambulances, boats, police cars, helicopters, staff counts), population count and car-ownership %.
- Weather controls: rain timeline editor (draggable points), flood kind (growing/flash/compound), warning delay, wind.
- **Presets:** "Calm and compliant", "Panicky", "Understaffed", "Worst night".
- A **seed** input and a "randomise seed" button. Show the seed next to every run.
- Dispatch mode toggle: Negotiation / Centralised.

## Task D: Run controls and HUD (hours 11–14)
- Play/pause, speed (1x/4x/16x), step 1 tick, restart with the same seed, "Branch from here" (optional).
- Sim clock (day/time as HH:MM), current rain intensity, live counters (flooded %, stranded, hospitals' utilisation bars).
- Inspector panel for `InspectorData`: attributes, assignment, route toggle, belief, and **lastDecision with alternatives** (top-2 utilities or bids). This panel is the key explainer for judges, so make it clean.
- Injected-event panel: buttons for each injected event (bridge closed, boat failure, shelter overflow, substation flooded, comms outage, false report burst, helicopter grounded) that call `inject(...)`. Mark which scenarios are "stress" ones.

## Task E: Save/load (hours 14–16)
- Save/load scenario JSON (download/upload plus IndexedDB slots), validated through the Zod schema, with friendly errors.
- Load template dropdown reading from `scenarios/index.json` (Worker 1 produces it).
- Autosave every 30 s in edit mode, with a "recover last session" prompt.

## Style
- Tailwind or CSS modules. Dark, high-contrast, large click targets. Every control has a label and works with the keyboard.
- No global state outside Zustand stores under `src/ui/store`.

## Tests
- Unit tests for the command stack (undo/redo invertibility), footprint validation and the rect/line painters.
- A Playwright (or Vitest + testing-library) smoke test: place a road, place a hospital, undo, redo, save, load.

## Done means
- [ ] `/editor-playground` demonstrates every tool against a fake grid
- [ ] All edits are `EditCommand`s, with a test that replaying the command list reproduces the grid
- [ ] Params panel round-trips to `NpcParams` and passes Zod validation
- [ ] Inspector renders `InspectorData` from a mock, including `lastDecision`
- [ ] Save/load works and rejects a malformed file with a readable message
- [ ] CHANGELOG lines added

## If blocked
`docs/REQUESTS.md`: `[W2 → AJ] need hoverCell in useSceneStore`. Keep going with the playground.
