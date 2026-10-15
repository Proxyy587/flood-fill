'use client';

import { Anchor, Ban, CloudLightning, Construction, Home, MessageSquareWarning, RadioTower, Wind, type LucideIcon } from 'lucide-react';
import { useState } from 'react';
import { useSceneStore } from '../../bridge/sceneStore';
import type { SimBridge } from '../../bridge/SimBridge';
import { BlockType, VehicleKind, type InjectedEvent } from '../../contracts';
import { useEditorStore } from '../../ui/store/editorStore';
import { clockOf } from '../city';
import { Flyout } from '../primitives';
import styles from '../shell.module.css';

interface StressEvent {
  kind: InjectedEvent['kind'];
  label: string;
  caption: string;
  icon: LucideIcon;
  type?: BlockType;
  vehicle?: VehicleKind;
  supported?: boolean;
  requiresSelectedLocation?: boolean;
}

const EVENTS: StressEvent[] = [
  { kind: 'bridge_closed', label: 'Close a bridge', caption: 'Traffic must find another crossing.', icon: Ban, type: BlockType.Bridge },
  { kind: 'substation_flooded', label: 'Trip a substation', caption: 'Its whole service area goes dark.', icon: CloudLightning, type: BlockType.Substation },
  { kind: 'road_blocked_by_debris', label: 'Block a road', caption: 'Debris closes one street.', icon: Construction, type: BlockType.Road },
  { kind: 'shelter_overflow', label: 'Fill a shelter', caption: 'Evacuees are turned away.', icon: Home, type: BlockType.Shelter },
  { kind: 'boat_failure', label: 'Boat breaks down', caption: 'One rescue boat drops out.', icon: Anchor, vehicle: VehicleKind.Boat },
  { kind: 'helicopter_grounded_wind', label: 'Ground helicopters', caption: 'Aircraft follow-on; not yet supported by the AK runner.', icon: Wind, supported: false },
  { kind: 'comms_outage', label: 'Radio outage', caption: 'Reports stop reaching HQ for a while.', icon: RadioTower },
  { kind: 'false_report', label: 'False report', caption: 'Select a map location for HQ to receive a false flood report.', icon: MessageSquareWarning, requiresSelectedLocation: true },
];

export function StressTool({ bridge, onClose }: { bridge: SimBridge; onClose: () => void }) {
  const scenario = useEditorStore((s) => s.scenario);
  const mode = useEditorStore((s) => s.mode);
  const tick = useSceneStore((s) => s.tick);
  const selected = useSceneStore((s) => s.selected);
  const [log, setLog] = useState<{ label: string; tick: number }[]>([]);
  const running = mode === 'run';

  const inject = (event: StressEvent) => {
    const chosen = selected?.kind === 'cell' ? selected.id : selected?.kind === 'building' ? scenario?.buildings.find((b) => b.id === selected.id)?.cells[0] : undefined;
    const cell = event.type === undefined ? chosen : chosen !== undefined && scenario?.blocks[chosen] === event.type ? chosen : scenario?.blocks.findIndex((b) => b === event.type);
    const snap = bridge.snapshot;
    const building = cell !== undefined ? scenario?.buildings.find((b) => b.cells.includes(cell)) : undefined;
    const target = event.kind === 'shelter_overflow' ? building?.id : event.kind === 'substation_flooded' ? building?.powerNode : undefined;
    const vi = event.vehicle !== undefined ? snap?.vehicles.kind.findIndex((k) => k === event.vehicle) : undefined;
    bridge.inject({
      t: tick,
      kind: event.kind,
      ...(cell !== undefined && cell >= 0 ? { cell } : {}),
      ...(target !== undefined ? { target } : {}),
      ...(vi !== undefined && vi >= 0 && snap ? { target: snap.vehicles.id[vi] } : {}),
      durationTicks: 180,
    });
    setLog((l) => [{ label: event.label, tick }, ...l].slice(0, 5));
  };

  const available = (e: StressEvent) =>
    running && e.supported !== false && (!e.requiresSelectedLocation || selected?.kind === 'cell' || selected?.kind === 'building') &&
    (e.type === undefined || !!scenario?.blocks.includes(e.type)) && (e.vehicle === undefined || !!bridge.snapshot?.vehicles.kind.includes(e.vehicle));

  return (
    <Flyout title="Stress events" subtitle="Break something mid-storm and watch the city adapt." onClose={onClose}>
      {!running && <p className={styles.note}>Start the storm first. Events land at the current moment of the run.</p>}
      <ul className={styles.list}>
        {EVENTS.map((e) => (
          <li key={e.kind}>
            <button type="button" className={styles.listItem} disabled={!available(e)} onClick={() => inject(e)}>
              <span className={styles.listIcon}>
                <e.icon size={16} />
              </span>
              <span>
                <strong>{e.label}</strong>
                <span>{e.caption}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      <p className={styles.hint}>Select a bridge, substation, road or shelter on the map first to target it; otherwise the first matching site is used.</p>
      {log.length > 0 && (
        <div className={styles.group}>
          <div className={styles.groupTitle}>Injected this run</div>
          {log.map((l, i) => (
            <div key={i} className={styles.hint}>
              {clockOf(l.tick)} · {l.label}
            </div>
          ))}
        </div>
      )}
    </Flyout>
  );
}
