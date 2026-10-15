import type { EditCommand, EntityRef } from '../contracts';

type Listener<T> = (value: T) => void;

const channel = <T>() => {
  const listeners = new Set<Listener<T>>();
  return {
    emit: (value: T) => listeners.forEach((fn) => fn(value)),
    on: (fn: Listener<T>) => {
      listeners.add(fn);
      return () => {
        listeners.delete(fn);
      };
    },
  };
};

const focus = channel<EntityRef>();
const select = channel<EntityRef | null>();
const highlight = channel<number[]>();

/** Selection and camera focus requests from any panel (inspector, replay, critic). */
export const selectBus = {
  /** Select the entity and move the camera to it. */
  focus: (ref: EntityRef) => focus.emit(ref),
  /** Select without moving the camera. `null` clears the selection. */
  select: (ref: EntityRef | null) => select.emit(ref),
  /** Highlight evidence cells on the map (empty array clears). */
  highlightCells: (cells: number[]) => highlight.emit(cells),
  onFocus: focus.on,
  onSelect: select.on,
  onHighlight: highlight.on,
};

const seek = channel<number>();

/** Replay timeline → sim. */
export const replayBus = {
  seek: (tick: number) => seek.emit(tick),
  onSeek: seek.on,
};

const dispatch = channel<EditCommand>();

/** Editor → sim. The editor never mutates the world directly. */
export const editorBus = {
  dispatch: (cmd: EditCommand) => dispatch.emit(cmd),
  onDispatch: dispatch.on,
};
