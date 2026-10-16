'use client';

import { Plus, Shuffle, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { DEFAULT_START_SECONDS, type FleetDef, type NpcParams, type Scenario } from '../../contracts';
import { RAIN_MM_PER_HOUR_AT_FULL } from '../../contracts/mocks';
import { NpcParamsSchema } from '../../contracts/schemas';
import { useSceneStore } from '../../bridge/sceneStore';
import { formatTimeOfDay } from '../city';
import { updateScenario } from '../../ui/panels/ParamsPanel';
import { useEditorStore } from '../../ui/store/editorStore';
import { Flyout, Segmented, Slider, Stepper } from '../primitives';
import styles from '../shell.module.css';

const STORMS: { id: string; label: string; apply: (s: Scenario) => void }[] = [
  {
    id: 'steady',
    label: 'Steady rain',
    apply: (s) => {
      s.weather.floodKind = 'growing';
      s.weather.rain = [{ t: 0, intensity: 0.15 }, { t: 600, intensity: 0.35 }, { t: 2400, intensity: 0.45 }, { t: 3600, intensity: 0.1 }];
      s.weather.wind = [{ t: 0, speed: 0.2 }];
    },
  },
  {
    id: 'cloudburst',
    label: 'Cloudburst',
    apply: (s) => {
      s.weather.floodKind = 'flash';
      s.weather.rain = [{ t: 0, intensity: 0.05 }, { t: 300, intensity: 1 }, { t: 1200, intensity: 1 }, { t: 1500, intensity: 0.1 }];
      s.weather.wind = [{ t: 0, speed: 0.35 }];
    },
  },
  {
    id: 'compound',
    label: 'Compound storm',
    apply: (s) => {
      s.weather.floodKind = 'compound';
      s.weather.rain = [{ t: 0, intensity: 0.1 }, { t: 420, intensity: 0.3 }, { t: 675, intensity: 0.7 }, { t: 1200, intensity: 1 }, { t: 1800, intensity: 1 }, { t: 2400, intensity: 0.3 }, { t: 3000, intensity: 0 }];
      s.weather.wind = [{ t: 0, speed: 0.2 }, { t: 900, speed: 0.6 }, { t: 1200, speed: 0.8 }, { t: 2100, speed: 0.4 }];
    },
  },
];

const STARTS = [
  { id: String(DEFAULT_START_SECONDS), label: 'Morning', title: '08:00 — clear morning (default); the 24 h storm runs into the night' },
  { id: String(14 * 3600), label: 'Afternoon', title: '14:00 — bright afternoon' },
  { id: String(17 * 3600 + 15 * 60), label: 'Evening', title: '17:15 — daylight into sunset' },
  { id: String(0), label: 'Midnight', title: '00:00 — deep night, city lights' },
];

const ENGINE_HELP = {
  core: 'AK’s deterministic simulator: flood, power, traffic, reports, ambulances, boats, hospital balancing, and independent police traffic, escort and crowd guidance. Helicopters are not yet modeled.',
  preview: 'Visual showcase engine with helicopters, waterlogging set-pieces and cutaways. Use Core for evidence-backed judging runs.',
} as const;

function SimulationGroup({ disabled }: { disabled: boolean }) {
  const settings = useSceneStore((s) => s.runSettings);
  const setRunSettings = useSceneStore((s) => s.setRunSettings);
  const playing = useSceneStore((s) => s.playing);
  const preset = STARTS.some((s) => Number(s.id) === settings.startSeconds) ? String(settings.startSeconds) : '';
  return (
    <div className={styles.group}>
      <div className={styles.groupTitle}>
        Simulation <span>starts {formatTimeOfDay(settings.startSeconds)}</span>
      </div>
      <Segmented
        label="Simulator"
        value={settings.engine}
        disabled={disabled}
        onChange={(engine) => setRunSettings({ engine })}
        options={[
          { id: 'core', label: 'Core', title: ENGINE_HELP.core },
          { id: 'preview', label: 'Preview', title: ENGINE_HELP.preview },
        ]}
      />
      <p className={styles.hint}>{ENGINE_HELP[settings.engine]}</p>
      <Segmented
        label="Start time"
        value={preset}
        disabled={playing}
        onChange={(v) => setRunSettings({ startSeconds: Number(v) })}
        options={STARTS}
      />
      <Slider
        label="Start clock"
        value={settings.startSeconds}
        display={formatTimeOfDay(settings.startSeconds)}
        min={0}
        max={86340}
        step={300}
        disabled={playing}
        help="Morning default. Play advances a 24 h flood into afternoon and night. Pause, change start, and the run restarts from that clock."
        onChange={(startSeconds) => setRunSettings({ startSeconds })}
      />
    </div>
  );
}

const BEHAVIOUR: { key: keyof NpcParams; label: string; help: string }[] = [
  { key: 'complianceMean', label: 'Follow orders', help: 'Share who act on evacuation and police instructions.' },
  { key: 'awarenessMean', label: 'Awareness', help: 'How quickly people notice water and warnings.' },
  { key: 'panicMean', label: 'Panic', help: 'Rises with hazards and crowds; worsens choices.' },
  { key: 'riskToleranceMean', label: 'Risk taking', help: 'Willingness to wade or drive through water.' },
  { key: 'altruismMean', label: 'Helping others', help: 'Likelihood of waiting for or guiding neighbours.' },
];

interface Preset {
  name: string;
  help: string;
  params: Partial<NpcParams>;
  /** Multiplies doctors, nurses, officers and boat crew. */
  staff?: number;
}

const PRESETS: Preset[] = [
  {
    name: 'Calm and compliant',
    help: 'Prepared residents who follow orders; early warning.',
    params: { panicMean: 0.1, complianceMean: 0.95, riskToleranceMean: 0.15, awarenessMean: 0.9, falseReportRate: 0.02, commsDelay: 5, warningDelay: 30, staffFatigueRate: 0.01 },
  },
  {
    name: 'Panicky',
    help: 'People notice late, wade into water and flood HQ with calls.',
    params: { panicMean: 0.75, complianceMean: 0.45, riskToleranceMean: 0.7, awarenessMean: 0.4, falseReportRate: 0.25, commsDelay: 40 },
  },
  {
    name: 'Understaffed',
    help: 'Half the doctors, nurses, officers and boat crew; fatigue sets in faster.',
    params: { staffFatigueRate: 0.08 },
    staff: 0.5,
  },
  {
    name: 'Worst night',
    help: 'Late warning, slow radio, false reports and a thin response.',
    params: { panicMean: 0.85, complianceMean: 0.25, awarenessMean: 0.2, riskToleranceMean: 0.8, warningDelay: 360, commsDelay: 120, falseReportRate: 0.4, staffFatigueRate: 0.15 },
    staff: 0.5,
  },
];

const STAFF: (keyof FleetDef)[] = ['doctors', 'nurses', 'policeOfficers', 'boatOperators'];

const FLEET: [keyof FleetDef, string][] = [
  ['ambulances', 'Ambulances'],
  ['boats', 'Rescue boats'],
  ['helicopters', 'Helicopters'],
  ['policeCars', 'Police cars'],
  ['doctors', 'Doctors'],
  ['nurses', 'Nurses'],
  ['policeOfficers', 'Police officers'],
  ['boatOperators', 'Boat crew'],
];

const W = 280;
const H = 84;

function RainProfile({ disabled }: { disabled: boolean }) {
  const scenario = useEditorStore((s) => s.scenario);
  const svg = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<number | null>(null);
  if (!scenario) return null;
  const pts = scenario.weather.rain;
  const maxT = Math.max(3600, ...pts.map((p) => p.t));
  const X = (t: number) => (t / maxT) * W;
  const Y = (i: number) => H - i * (H - 6);
  let total = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[i + 1] ?? { t: maxT, intensity: a.intensity };
    total += ((a.intensity + b.intensity) / 2) * ((b.t - a.t) / 3600) * RAIN_MM_PER_HOUR_AT_FULL;
  }
  const peak = Math.max(...pts.map((p) => p.intensity)) * RAIN_MM_PER_HOUR_AT_FULL;
  const line = pts.map((p) => `${X(p.t).toFixed(1)},${Y(p.intensity).toFixed(1)}`).join(' ');
  const move = (e: React.PointerEvent) => {
    if (drag === null || disabled) return;
    const r = svg.current?.getBoundingClientRect();
    if (!r) return;
    const t = Math.round((((e.clientX - r.left) / r.width) * maxT) / 30) * 30;
    const v = Math.max(0, Math.min(1, (H - ((e.clientY - r.top) / r.height) * H) / (H - 6)));
    updateScenario((s) => {
      const lo = (s.weather.rain[drag - 1]?.t ?? -1) + 1;
      const hi = (s.weather.rain[drag + 1]?.t ?? maxT + 1) - 1;
      s.weather.rain[drag] = { t: drag === 0 ? 0 : Math.max(lo, Math.min(hi, t)), intensity: Math.round(v * 100) / 100 };
    });
  };
  return (
    <div className={styles.group}>
      <div className={styles.groupTitle}>
        Rain profile
        <span>
          peak {Math.round(peak)} mm/h · total {Math.round(total)} mm
        </span>
      </div>
      <svg
        ref={svg}
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: '100%', height: 'auto', touchAction: 'none', background: 'rgba(30,111,217,0.05)', borderRadius: 8 }}
        onPointerMove={move}
        onPointerUp={() => setDrag(null)}
        onPointerCancel={() => setDrag(null)}
        aria-label="Rain intensity over time. Drag the points."
      >
        {[0.25, 0.5, 0.75].map((g) => (
          <line key={g} x1={0} x2={W} y1={Y(g)} y2={Y(g)} stroke="rgba(21,35,45,0.08)" />
        ))}
        <polygon points={`0,${H} ${line} ${W},${Y(pts.at(-1)?.intensity ?? 0)} ${W},${H}`} fill="rgba(30,111,217,0.16)" />
        <polyline points={line} fill="none" stroke="#1e6fd9" strokeWidth={1.8} strokeLinejoin="round" />
        {pts.map((p, i) => (
          <circle
            key={i}
            cx={X(p.t)}
            cy={Y(p.intensity)}
            r={drag === i ? 6 : 4.5}
            fill="#fff"
            stroke="#1e6fd9"
            strokeWidth={2}
            style={{ cursor: disabled ? 'default' : 'grab' }}
            onPointerDown={(e) => {
              if (disabled) return;
              setDrag(i);
              svg.current?.setPointerCapture(e.pointerId);
            }}
          />
        ))}
      </svg>
      <div className={styles.ticks}>
        <span>0 min</span>
        <span>{Math.round(maxT / 120)} min</span>
        <span>{Math.round(maxT / 60)} min</span>
      </div>
      <div className={styles.row}>
        <button type="button" className={`${styles.button} ${styles.grow}`} disabled={disabled} onClick={() => updateScenario((s) => void s.weather.rain.push({ t: Math.min(maxT, (pts.at(-1)?.t ?? 0) + 300), intensity: 0 }))}>
          <Plus size={14} /> Point
        </button>
        <button type="button" className={`${styles.button} ${styles.grow}`} disabled={disabled || pts.length < 2} onClick={() => updateScenario((s) => void s.weather.rain.pop())}>
          <Trash2 size={14} /> Last point
        </button>
      </div>
    </div>
  );
}

export function ScenarioTool({ onClose }: { onClose: () => void }) {
  const { scenario, params, setParam, mode } = useEditorStore();
  const disabled = mode !== 'edit';
  if (!scenario) return null;
  const wind = scenario.weather.wind.reduce((m, p) => Math.max(m, p.speed), 0);
  const applyPreset = (preset: Preset) => {
    const next = NpcParamsSchema.parse({ ...useEditorStore.getState().params, ...preset.params });
    useEditorStore.setState({ params: next });
    updateScenario((s) => {
      s.population.mix.carOwners = next.carOwnership;
      s.weather.warningDelay = next.warningDelay;
      if (preset.staff) for (const k of STAFF) s.fleet[k] = Math.max(1, Math.round(s.fleet[k] * preset.staff));
    });
  };
  return (
    <Flyout title="Scenario" subtitle="The storm, the people and the responders." onClose={onClose}>
      {disabled && <p className={styles.note}>City settings are locked while the storm runs. Pause to change the start time, or branch the city to edit.</p>}

      <SimulationGroup disabled={disabled} />

      <div className={styles.group}>
        <div className={styles.groupTitle}>Storm</div>
        <div className={styles.chips}>
          {STORMS.map((st) => (
            <button key={st.id} type="button" disabled={disabled} onClick={() => updateScenario(st.apply)}>
              {st.label}
            </button>
          ))}
        </div>
      </div>
      <RainProfile disabled={disabled} />
      <Slider
        label="Peak wind"
        value={wind}
        display={wind >= 0.75 ? 'Grounds helicopters' : `${Math.round(wind * 100)}%`}
        min={0}
        max={1}
        step={0.05}
        disabled={disabled}
        help="Helicopters cannot fly above 75%."
        onChange={(v) => updateScenario((s) => (s.weather.wind = s.weather.wind.length ? s.weather.wind.map((p) => ({ ...p, speed: wind > 0 ? (p.speed / wind) * v : v })) : [{ t: 0, speed: v }]))}
      />
      <Slider
        label="Warning delay"
        value={params.warningDelay}
        display={`${Math.round(params.warningDelay / 60)} min`}
        min={0}
        max={1800}
        step={30}
        disabled={disabled}
        help="Time from first flooding to the evacuation order."
        onChange={(v) => setParam('warningDelay', v)}
      />

      <div className={styles.group}>
        <div className={styles.groupTitle}>People</div>
        <div className={styles.chips}>
          {PRESETS.map((p) => (
            <button key={p.name} type="button" disabled={disabled} title={p.help} onClick={() => applyPreset(p)}>
              {p.name}
            </button>
          ))}
        </div>
        <Stepper label="Residents" value={scenario.population.count} min={0} max={1500} step={20} disabled={disabled} onChange={(v) => updateScenario((s) => (s.population.count = v))} />
        <Slider label="Own a car" value={params.carOwnership} display={`${Math.round(params.carOwnership * 100)}%`} min={0} max={1} step={0.05} disabled={disabled} onChange={(v) => setParam('carOwnership', v)} />
        <details className={styles.details}>
          <summary>
            Behaviour <span>{Math.round(params.complianceMean * 100)}% follow orders</span>
          </summary>
          <div className={styles.group}>
            {BEHAVIOUR.map((b) => (
              <Slider key={b.key} label={b.label} value={params[b.key]} display={`${Math.round(params[b.key] * 100)}%`} min={0} max={1} step={0.05} disabled={disabled} help={b.help} onChange={(v) => setParam(b.key, v)} />
            ))}
          </div>
        </details>
      </div>

      <div className={styles.group}>
        <div className={styles.groupTitle}>Responders</div>
        {FLEET.map(([key, label]) => (
          <Stepper key={key} label={label} value={scenario.fleet[key]} min={0} max={60} disabled={disabled} onChange={(v) => updateScenario((s) => (s.fleet[key] = v))} />
        ))}
      </div>

      <div className={styles.group}>
        <div className={styles.groupTitle}>Dispatch</div>
        <Segmented
          label="Dispatch policy"
          value={scenario.defaults.dispatchMode}
          disabled={disabled}
          onChange={(v) => updateScenario((s) => (s.defaults.dispatchMode = v))}
          options={[
            { id: 'negotiation', label: 'Units negotiate', title: 'Each unit bids for nearby requests' },
            { id: 'centralised', label: 'HQ assigns', title: 'One dispatcher assigns everything' },
          ]}
        />
        <Slider label="Report delay" value={params.commsDelay} display={`${params.commsDelay} s`} min={0} max={300} step={5} disabled={disabled} help="Time for a call to reach HQ." onChange={(v) => setParam('commsDelay', v)} />
        <Slider label="False reports" value={params.falseReportRate} display={`${Math.round(params.falseReportRate * 100)}%`} min={0} max={1} step={0.05} disabled={disabled} onChange={(v) => setParam('falseReportRate', v)} />
        <div className={styles.row}>
          <span className={styles.grow} style={{ fontSize: 12, color: 'var(--ink-2)' }}>
            Seed <b style={{ color: 'var(--ink)' }}>{scenario.defaults.seed}</b>
          </span>
          <button type="button" className={styles.button} disabled={disabled} onClick={() => updateScenario((s) => (s.defaults.seed = crypto.getRandomValues(new Uint32Array(1))[0]))}>
            <Shuffle size={14} /> New seed
          </button>
        </div>
        <p className={styles.hint}>The same city, settings and seed always replay the same storm.</p>
      </div>
    </Flyout>
  );
}
