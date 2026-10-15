# AK foundation review ledger — 2026-10-15

Scope: the approved foundation checkpoint, not completion of the full roadmap.
Review uses superpowers spec/quality gates plus the five-area post-implementation
review. Source is the codex/ak-foundation working tree based on main 181ea06.

## Completed focused reviews

- Contract/navigation spec: PASS after fixes to snapshot IDs/enums, intrinsic
  placement checks, inspector IDs and boat failure targets. Independent probes:
  297 fleet-ID boundaries and 90 distinct snapshot buffers.
- Contract/navigation quality: PASS after reverse building-tile references,
  Float32 headroom bounds and exact fixed-point path-cost fixes. Independent
  checks: 250 weighted grids, 3964 starting cells, 128x128 corridor, max sources.
- Physics/runner: review caught barrier overshoot, source overflow, fault boundary
  mismatch, repeated diversion, stale generator membership and missing exhaustion/
  misleading restore events. Regression tests reproduce and fixes pass; physics
  re-review PASS (52 focused tests). Additional checks: 1000 mixed-sill cases and
  30 closed terrains.

## Final review areas

| Area | Reviewer | State |
|---|---|---|
| Goal/constraints | Bacon | PASS foundation; source checkpoint 7c19583, final evidence recorded |
| Executed QA | Jason | PASS; 20 scenarios, 197 tests at review time |
| Integration quality | Maxwell | PASS re-review; all eight extensions and seed array boundaries verified; 111 focused tests |
| Security | Turing | PASS; inherited dev advisory recorded, production audit clear |
| Context/docs | McClintock | PASS foundation; six findings resolved; 10 independent read-only probes pass |

All five review areas pass for the approved foundation scope after corrections.
This does not mark the broader active goal or full AK roadmap complete.

## Aggregate verification

- Tooling/plan checkpoint d077579; atomic source checkpoint 7c19583.
- Fresh main-agent health on final source: 209/209 tests, lint, route type generation,
  strict types and fixture/schema validation pass. Production build passes.
- Post-commit batch/compare smoke: seeds 0,42,77, 600 ticks, 61 frames/run; dispatch
  unavailable is explicit. HTTP GET / returns 200 (starter page).
- Normal validation reports schema-only, templatesPresent:false, releaseReady:false.
  Strict schema/presence check rejects missing templates. One valid JSON fixture
  does not claim full release readiness (committed regression test).
- Production dependency audit clear. Full audit has the inherited braces advisory;
  no scenario/worker input path into trusted ESLint glob configuration was found.

## Context/docs final re-review (McClintock)

Verdict: PASS for the approved foundation checkpoint; confidence HIGH. No remaining
blocking context findings. This verdict does not approve other pending review areas
or claim the full roadmap is implemented.

- Fleet allocation now includes rounded civilian cars and caps vehicles/staff at
  10000. Independent probes reject the prior Int32 overflow, excess vehicles/staff
  and the half-car rounding overflow; exact limits and below-half rounding pass.
- AK_STATUS distinguishes historical evidence from subsequent stages; the plan
  records completed work and explicitly reserves the atomic source/docs commits
  for the final gate. Authorized pending commit bookkeeping is not a context defect.
- Merge instructions use pnpm health; worker lanes permit append-only changelog
  edits and the approved generator/playground; the browser adapter is outside sim.
- SIM_SPEC retains all five simultaneous stress failures. AI_CRITIC and Worker 3
  agree on initial executable permissions and contract-blocked/deferred extensions.
- Validation explicitly reports schema-only, templatesPresent and releaseReady:false.
  The actual validation function passed in-memory present/missing fixture checks,
  including strict missing-template rejection and manifest exclusion.
- Verification: 10 Node in-memory probes passed with no filesystem writes; reviewed
  current tracked/untracked code, regression tests, docs, worker briefs and local
  history/diffs against 181ea06. No external apps, full health/build rerun or commit
  performed by this reviewer. Aggregate health evidence belongs to the final gate.

## Known residuals

Full AK milestones remain pending (agents, dispatch, aircraft, complete invariants,
stress runs/patch verification). W1 scenario templates and AJ renderer/worker adapter
are absent. Full development dependency audit reports braces GHSA-vfj7-8cjw-p6xm,
with no patched version listed; production audit reports no known vulnerabilities.
