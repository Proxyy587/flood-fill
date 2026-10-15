import { expect, it } from "vitest";
import { sampleTimeline } from "./timeline";

it("interpolates weather and clamps to endpoint values", () => {
  const points = [{ t: 0, value: 0 }, { t: 10, value: 1 }];
  expect(sampleTimeline(points, 5)).toBe(0.5);
  expect(sampleTimeline(points, 20)).toBe(1);
  expect(sampleTimeline([{ t: 10, value: 0.5 }], 0)).toBe(0.5);
});
it("rejects empty, unsorted and nonfinite weather", () => {
  expect(() => sampleTimeline([], 0)).toThrow();
  expect(() => sampleTimeline([{ t: 2, value: 0 }, { t: 1, value: 1 }], 1)).toThrow();
  expect(() => sampleTimeline([{ t: 0, value: Infinity }], 0)).toThrow();
});
