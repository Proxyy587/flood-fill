# AI_CRITIC

Goal: after a run, produce a **useful, evidence-backed critique** and **testable improvement proposals** for the city design and response plan. The principle is **LLM proposes, simulator verifies**.

## 1. Pipeline

```
RunSummary (metrics + events + hotspots)
   │
   ├─► Deterministic analysers (no LLM)           src/ai/analysers/*
   │     • gridlock hotspots (cells with speed≈0 for T ticks)
   │     • isolated zones (components cut from every hospital/shelter by closures)
   │     • hospital imbalance (peak util, std-dev, diversion time)
   │     • power cascade (which trip cut what)
   │     • drainage coverage (ponding cells with no drain within R)
   │     • response gaps (districts with worst time-to-service)
   │
   ├─► Evidence pack (compact JSON, ≤ ~6k tokens)   src/ai/evidence.ts
   │
   ├─► LLM critic (Next route /api/critic)           app/api/critic/route.ts
   │     returns: Report { summary, findings[], proposals[] }  (JSON, schema-validated)
   │
   ├─► Patch compiler: proposals → ScenarioPatch (EditCommand[])
   │     only whitelisted commands, cost-capped, within grid bounds
   │
   └─► Verifier: re-run batch (same seeds) with patch → before/after metrics
         Report shows measured delta, not the LLM's claim
```

## 2. What it may propose (whitelist)

- Add/move: road segment, bridge, drainage block, levee/sandbag line, helipad, shelter, hospital, boat depot, police post, substation relocation, generator.
- Add traffic control posts at named intersections.
- Change policy knobs: evacuation warning timing, contraflow on a named road, hospital diversion threshold.
- It may **not**: delete the player's buildings wholesale, exceed `budget`, or edit outside the grid.

## 3. Output schema (Zod-validated; reject and retry once on failure)

```ts
interface CriticReport {
  summary: string;                         // ≤ 120 words
  findings: {
    id: string; severity: 'low'|'medium'|'high';
    title: string; explanation: string;
    evidence: { eventTicks?: number[]; cells?: number[]; metric?: string; value?: number }[];
    confidence: 'low'|'medium'|'high';     // must justify, and say what is missing
  }[];
  proposals: {
    id: string; addresses: string[];       // finding ids
    title: string; rationale: string;
    commands: EditCommand[];               // whitelisted kinds only
    expectedEffect: string;                // a hypothesis, not a promise
    cost: number;
  }[];
  limitations: string[];                   // always non-empty
}
```

## 4. Prompting rules

- System prompt: role = "emergency-planning simulation analyst". Rules: cite evidence ids; never claim real-world authority; never invent metrics not in the pack; prefer small, cheap changes first; say when evidence is insufficient.
- Provide a short **legend** (cell = 4 m, block types, units).
- Give the grid as **named landmarks and districts** and hotspot coordinates, not the raw grid (a raw grid wastes tokens and confuses the model). Optionally an ASCII mini-map (≤ 64×64) of closures and hotspots.
- Temperature low. Request JSON only. Validate. Retry once with the validation error appended.

## 5. Verification (this is what makes it credible)

For each accepted proposal:
1. Apply the patch to a copy of the scenario.
2. Run K seeds (default 12) in both the baseline and patched scenario, same seeds.
3. Report the mean ± spread for: time-to-service p90, unmet %, gridlock minutes, hospital balance score, stranded count.
4. Mark the proposal **Verified improvement / No clear effect / Worse**. Never hide "worse".

Run these in a Web Worker pool (or Node via an API route for heavier batches). Keep K small in the live demo, and keep a pre-computed run for safety.

## 6. UI

- "Critique run" button after a run. Streams findings into a side panel.
- Clicking a finding highlights its cells and jumps the replay to the evidence ticks.
- Each proposal has **Preview** (ghost blocks in the 3D view), **Apply**, and **Verify**.
- A before/after comparison chart per proposal.
- A visible "AI-generated hypothesis, verified by simulation" label.

## 7. Failure handling

- API down or key missing: fall back to analyser-only report (templated text from the deterministic findings). The demo must never depend on the network.
- Invalid JSON twice: show the analyser findings and a "critic unavailable" notice.
- Pre-cache a critic report for each template scenario for offline demos.

## 8. Key hygiene

- `ANTHROPIC_API_KEY` only in server env. Never in client bundles. Rate-limit the route.
- Only send the evidence pack, which is synthetic and contains no personal data.
