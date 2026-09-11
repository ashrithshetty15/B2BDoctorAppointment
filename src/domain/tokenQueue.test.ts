import { describe, expect, it } from 'vitest';
import { nextRollingAverage } from './tokenQueue';

describe('nextRollingAverage', () => {
  it('adopts the first real measurement outright', () => {
    expect(nextRollingAverage(10, 0, 6)).toBe(6);
  });

  it('behaves as a plain mean while below the window', () => {
    // avg 10 over 1 sample, next consult 20 -> 15
    expect(nextRollingAverage(10, 1, 20)).toBe(15);
    // avg 10 over 3 samples, next consult 14 -> 11
    expect(nextRollingAverage(10, 3, 14)).toBe(11);
  });

  it('keeps tracking recent reality once the window is full', () => {
    // At the window size, a slow consult nudges rather than shifts the average.
    const nudged = nextRollingAverage(10, 20, 30);
    expect(nudged).toBeGreaterThan(10);
    expect(nudged).toBeLessThan(12);
  });

  it('converges towards a sustained new pace', () => {
    let avg = 10;
    for (let i = 0; i < 200; i += 1) {
      avg = nextRollingAverage(avg, 50, 6);
    }
    expect(avg).toBeCloseTo(6, 1);
  });
});
