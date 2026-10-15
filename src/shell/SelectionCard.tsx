'use client';

import { useSceneStore } from '../bridge/sceneStore';

/**
 * Minimal readout of the selected entity's InspectorData.
 * Worker 2's inspector panel (src/ui/panels) replaces this.
 */
export function SelectionCard() {
  const selected = useSceneStore((s) => s.selected);
  const data = useSceneStore((s) => s.inspector);
  const select = useSceneStore((s) => s.select);
  if (!selected) return null;

  return (
    <aside className="absolute bottom-10 right-3 w-72 rounded-lg bg-black/70 p-3 text-sm shadow-lg backdrop-blur" aria-live="polite">
      <div className="mb-2 flex items-start justify-between gap-2">
        <h2 className="font-semibold">{data?.title ?? `${selected.kind} #${selected.id}`}</h2>
        <button type="button" onClick={() => select(null)} className="rounded px-1.5 text-slate-400 hover:bg-slate-700" aria-label="Clear selection">
          ✕
        </button>
      </div>
      {!data && <p className="text-slate-400">Loading…</p>}
      {data && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
          {Object.entries(data.attributes).map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-slate-400">{k}</dt>
              <dd className="truncate font-mono">{String(v)}</dd>
            </div>
          ))}
          {data.assignment && (
            <div className="contents">
              <dt className="text-slate-400">assignment</dt>
              <dd className="font-mono">
                req #{data.assignment.requestId} · {data.assignment.status} · eta {data.assignment.eta}
              </dd>
            </div>
          )}
          {data.route && (
            <div className="contents">
              <dt className="text-slate-400">route</dt>
              <dd className="font-mono">
                {data.route.cells.length} cells · v{data.route.version}
              </dd>
            </div>
          )}
        </dl>
      )}
      {data?.lastDecision && (
        <div className="mt-2 border-t border-slate-700 pt-2 text-xs">
          <p>
            <span className="text-slate-400">Decision t={data.lastDecision.tick}:</span> <strong>{data.lastDecision.chosen}</strong>
          </p>
          <ul className="mt-1">
            {data.lastDecision.alternatives.map((a) => (
              <li key={a.label} className="flex justify-between font-mono">
                <span>{a.label}</span>
                <span>{a.score.toFixed(2)}</span>
              </li>
            ))}
          </ul>
          <p className="mt-1 text-slate-300">{data.lastDecision.reason}</p>
        </div>
      )}
    </aside>
  );
}
