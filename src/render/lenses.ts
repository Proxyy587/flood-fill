import type { Lens } from '../bridge/sceneStore';

/** `[t, hex, alpha]` colour stops for a continuous lens, or bands for a categorical one. */
export type Stop = readonly [number, number, number];

export interface LensSpec {
  label: string;
  /** One line on what the colours mean, for the legend. */
  caption: string;
  stops: readonly Stop[];
  /** Legend tick labels at the low and high end, or per band. */
  ticks: readonly string[];
  categorical?: boolean;
}

export const LENSES: Record<Exclude<Lens, 'none'>, LensSpec> = {
  people: {
    label: 'People',
    caption: 'Where people are right now, smoothed over about 30 m.',
    stops: [
      [0, 0xfde68a, 0],
      [0.12, 0xfde68a, 0.55],
      [0.4, 0xf59e0b, 0.78],
      [0.7, 0xdc2626, 0.86],
      [1, 0x7e1d5f, 0.92],
    ],
    ticks: ['Sparse', 'Crowded'],
  },
  traffic: {
    label: 'Traffic',
    caption: 'Vehicle presence over the last ten simulated minutes.',
    stops: [
      [0, 0xa5f3fc, 0],
      [0.1, 0xa5f3fc, 0.55],
      [0.4, 0x38bdf8, 0.78],
      [0.72, 0x4f46e5, 0.88],
      [1, 0x1e1b4b, 0.94],
    ],
    ticks: ['Quiet', 'Busy'],
  },
  depth: {
    label: 'Flood depth',
    caption: 'Standing water by what it stops: cars at 0.3 m, wading at 0.6 m.',
    stops: [
      [0.1, 0xf2d16b, 0.85],
      [0.3, 0xf0913a, 0.9],
      [0.6, 0xd94a3a, 0.92],
      [1.2, 0x6b2c8f, 0.95],
    ],
    ticks: ['0.1 m', '0.3 m', '0.6 m', '1.2 m+'],
    categorical: true,
  },
  exposure: {
    label: 'Exposure',
    caption: 'People standing in water deeper than 0.1 m, weighted by depth.',
    stops: [
      [0, 0xfecaca, 0],
      [0.08, 0xfecaca, 0.6],
      [0.45, 0xef4444, 0.85],
      [1, 0x7f1d1d, 0.95],
    ],
    ticks: ['Low', 'Severe'],
  },
  power: {
    label: 'Power',
    caption: 'Grid supply, backup generators and blackout.',
    stops: [
      [0, 0x1f9d63, 0.22],
      [1, 0xe8a317, 0.9],
      [2, 0x334155, 0.82],
    ],
    ticks: ['Grid', 'Generator', 'Blackout'],
    categorical: true,
  },
};
