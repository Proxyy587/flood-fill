# Flood design — urban compound flooding

Synthetic Guwahati districts (Six Mile first) use a **compound flood** model: channel
(fluvial) rise plus street-scale ponding (pluvial), with drainage that fails when the
outfall is drowned. This is the mechanism that produces multi-day urban floods after
monsoon bursts — not a single instantaneous dunk.

## Physical pieces (mapped to the preview engine)

| Process | Real-city meaning | Implementation |
|---|---|---|
| **Hyetograph** | Rain intensity over 24–48 h | `Scenario.weather.rain[]` piecewise intensity |
| **Runoff** | Paved streets shed; trees/grass hold | Per-block runoff + infiltration in `MockSim` ponds |
| **Pluvial ponding** | Water fills hollows / underpasses | Catchment ponds → depth thresholds → `WATERLOGGING` |
| **Fluvial stage** | Channel / nullah rises with rain + sources | River `stage` from rain runoff + `weather.sources` |
| **Overbank spill** | Stage above banks floods adjacent cells | BFS fill from `WaterSource` cells, blocked by levees |
| **Drainage** | Storm drains empty ponds when powered | Drain rate; **backflow** when stage ≥ outfall |
| **Recession** | Days of standing water after the peak | Slow stage/pond decay once rain falls |

## Multi-day timeline (default Six Mile run)

Starts **08:00**. One simulated second = one tick. Default `maxTicks` = **86400** (24 h),
so the clock runs morning → afternoon → night → next morning while the flood evolves.

1. **Morning onset (0–3 h)** — light rain, drains keep up; alert names prone cells.
2. **Day-1 peak (3–10 h)** — heavy burst; channel sources on; waterlogging + road closures.
3. **Evening / night (10–18 h)** — rain eases but stage stays high; blackouts / backflow worse.
4. **Overnight recession (18–24 h)** — slow drawdown; secondary ponding in the lowest hollows.

Severity is controlled by the rain curve and source rates, not by painting the whole map wet.

## Engines

- **Preview** (`MockSim`): full compound model above — used for Six Mile demos.
- **Core** (AK): validated solver with its own rates; Six Mile sources stay within gradual
  rise bounds so core batch runs remain meaningful.

## Not in scope yet

Civilian / NPC sub-agents, live telemetry, and real GIS DEMs. All cities remain synthetic.
