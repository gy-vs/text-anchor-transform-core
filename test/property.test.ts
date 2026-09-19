import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transform, type Anchor, type Replacement } from '../src/index.js';

/** Deterministic PRNG (LCG) so the "fuzz" run is reproducible. */
function makeRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/** Build a random valid batch: sorted, non-overlapping, in bounds. */
function randomEdits(rand: () => number, length: number): Replacement[] {
  const edits: Replacement[] = [];
  let cursor = 0;
  while (cursor <= length && rand() < 0.7) {
    const start = cursor + Math.floor(rand() * 3);
    if (start > length) break;
    const end = start + Math.floor(rand() * 3);
    if (end > length) break;
    const text = 'XYZ'.slice(0, Math.floor(rand() * 4));
    edits.push({ start, end, text });
    cursor = end + (rand() < 0.3 ? 0 : 1); // sometimes adjacent / same-point
  }
  return edits;
}

/** Reference implementation of the new text, built by splicing backwards. */
function expectedText(original: string, edits: readonly Replacement[]): string {
  let text = original;
  for (let i = edits.length - 1; i >= 0; i--) {
    const { start, end, text: insert } = edits[i]!;
    text = text.slice(0, start) + insert + text.slice(end);
  }
  return text;
}

test('invariants hold across randomized batches (seeded)', () => {
  const rand = makeRandom(0x5eed);
  const alphabet = 'abcde';

  for (let iteration = 0; iteration < 500; iteration++) {
    const length = Math.floor(rand() * 20);
    const original = Array.from(
      { length },
      () => alphabet[Math.floor(rand() * alphabet.length)],
    ).join('');
    const edits = randomEdits(rand, length);
    const offsets = Array.from({ length: 8 }, () =>
      Math.floor(rand() * (length + 1)),
    ).sort((a, b) => a - b);
    const anchors: Anchor[] = offsets.map((offset) => ({
      kind: 'point',
      offset,
      affinity: rand() < 0.5 ? 'left' : 'right',
    }));
    anchors.push({
      kind: 'range',
      start: offsets[0] ?? 0,
      end: offsets[offsets.length - 1] ?? 0,
      startAffinity: 'right',
      endAffinity: 'left',
    });

    const result = transform(original, edits, anchors);

    // text matches the independent reference construction
    assert.equal(result.text, expectedText(original, edits), `text @${iteration}`);
    assert.equal(result.reverse.length, result.text.length);

    const mappedPoints: number[] = [];
    anchors.forEach((anchor, i) => {
      const mapped = result.anchors[i]!;
      if (anchor.kind === 'point') {
        assert.equal(mapped.kind, 'point');
        if (mapped.kind !== 'point') return;
        assert.ok(mapped.offset >= 0 && mapped.offset <= result.text.length);
        mappedPoints.push(mapped.offset);
        const back = result.reverse.query(mapped.offset);
        // An offset untouched by any edit must round-trip to its exact
        // origin. "Untouched" means: not inside a replaced span, not an
        // insertion point, and not the end-of-text offset when the text
        // tail was edited (the new end-of-text gap resolves to the last
        // segment, which cannot encode how much was deleted after it).
        const untouched = edits.every(
          (e) =>
            !(e.start <= anchor.offset && anchor.offset < e.end) &&
            !(e.start === anchor.offset && e.end === anchor.offset) &&
            !(anchor.offset === original.length && e.end === anchor.offset),
        );
        if (untouched) {
          assert.deepEqual(back, { type: 'exact', offset: anchor.offset },
            `round trip @${iteration}`);
        } else if (back.type === 'exact') {
          // collapsed onto deleted text: the nearest kept offset is returned
          assert.ok(back.offset >= 0 && back.offset <= original.length);
        } else {
          assert.ok(back.left <= back.right);
        }
      } else {
        assert.equal(mapped.kind, 'range');
        if (mapped.kind !== 'range') return;
        assert.ok(mapped.start <= mapped.end, `range not inverted @${iteration}`);
        assert.ok(mapped.end <= result.text.length);
      }
    });

    // forward mapping is monotonic per affinity run: re-map the sorted
    // offsets with a single affinity and expect non-decreasing results
    for (const affinity of ['left', 'right'] as const) {
      const remapped = transform(
        original,
        edits,
        offsets.map((offset) => ({ kind: 'point' as const, offset, affinity })),
      ).anchors.map((a) => (a.kind === 'point' ? a.offset : -1));
      for (let k = 1; k < remapped.length; k++) {
        assert.ok(
          remapped[k]! >= remapped[k - 1]!,
          `monotonic (${affinity}) @${iteration}`,
        );
      }
    }
  }
});
