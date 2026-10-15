import { z } from 'zod';
import type { Scenario } from '../contracts';
import * as Ak from '../contracts/ak';
import { ScenarioSchema } from '../contracts/schemas';
import { fromCoreScenario } from './akAdapter';

export const TemplateEntrySchema = z.object({
  id: z.string(),
  name: z.string(),
  file: z.string(),
  description: z.string().optional(),
  size: z.object({ w: z.number(), h: z.number() }).optional(),
  population: z.number().optional(),
  floodKind: z.string().optional(),
});
export type TemplateEntry = z.infer<typeof TemplateEntrySchema>;

/** `scenarios/index.json` is an array; accept `{ templates: [...] }` too. */
export const parseManifest = (raw: unknown): TemplateEntry[] =>
  z.array(TemplateEntrySchema).parse(raw && typeof raw === 'object' && 'templates' in raw ? raw.templates : raw);

/**
 * Template files are written in AK's simulator contract (injected `tick`,
 * typed target ids, wind in m/s). Validate them there, then convert.
 */
export const parseTemplate = (raw: unknown): Scenario => ScenarioSchema.parse(fromCoreScenario(Ak.ScenarioSchema.parse(raw)));
