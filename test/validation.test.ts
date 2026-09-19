import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transform, TransformError, type Anchor } from '../src/index.js';

const point = (offset: number, affinity: 'left' | 'right' = 'left'): Anchor => ({
  kind: 'point',
  offset,
  affinity,
});

test('replacements must be sorted by start', () => {
  assert.throws(
    () =>
      transform('abcdef', [
        { start: 4, end: 5, text: 'x' },
        { start: 1, end: 2, text: 'y' },
      ]),
    (err: unknown) => err instanceof TransformError && err.code === 'NOT_SORTED',
  );
});

test('overlapping replacements are rejected', () => {
  assert.throws(
    () =>
      transform('abcdef', [
        { start: 1, end: 4, text: 'x' },
        { start: 3, end: 5, text: 'y' },
      ]),
    (err: unknown) => err instanceof TransformError && err.code === 'OVERLAP',
  );
  // a replacement containing another is overlap, not "unsorted"
  assert.throws(
    () =>
      transform('abcdef', [
        { start: 1, end: 5, text: 'x' },
        { start: 2, end: 3, text: 'y' },
      ]),
    (err: unknown) => err instanceof TransformError && err.code === 'OVERLAP',
  );
});

test('adjacent and same-point replacements are not overlap', () => {
  // touching spans: [0,2) and [2,4)
  const adjacent = transform('abcdef', [
    { start: 0, end: 2, text: 'X' },
    { start: 2, end: 4, text: 'Y' },
  ]);
  assert.equal(adjacent.text, 'XYef');
  // two insertions at the same offset, applied in the given order
  const samePoint = transform('abc', [
    { start: 1, end: 1, text: 'X' },
    { start: 1, end: 1, text: 'Y' },
  ]);
  assert.equal(samePoint.text, 'aXYbc');
});

test('out-of-bounds and malformed replacements are rejected', () => {
  const cases: Array<{ edits: unknown; code: string }> = [
    { edits: [{ start: -1, end: 1, text: '' }], code: 'OUT_OF_BOUNDS' },
    { edits: [{ start: 0, end: 4, text: '' }], code: 'OUT_OF_BOUNDS' }, // text length is 3
    { edits: [{ start: 2, end: 1, text: '' }], code: 'OUT_OF_BOUNDS' }, // end < start
    { edits: [{ start: 0.5, end: 1, text: '' }], code: 'INVALID_EDIT' }, // non-integer
    { edits: [{ start: 0, end: 1, text: 42 }], code: 'INVALID_EDIT' }, // non-string text
    { edits: [null], code: 'INVALID_EDIT' },
  ];
  for (const { edits, code } of cases) {
    assert.throws(
      () => transform('abc', edits as never),
      (err: unknown) => err instanceof TransformError && err.code === code,
      `expected ${code}`,
    );
  }
});

test('invalid anchors are rejected', () => {
  const badAnchors: unknown[] = [
    [point(4)], // beyond end of 'abc'
    [point(-1)],
    [point(1.5)],
    [{ kind: 'point', offset: 1, affinity: 'up' }],
    [{ kind: 'range', start: 2, end: 1, startAffinity: 'left', endAffinity: 'left' }],
    [{ kind: 'range', start: 0, end: 4, startAffinity: 'left', endAffinity: 'right' }],
    [{ kind: 'selection', offset: 1 }],
    [null],
  ];
  for (const anchors of badAnchors) {
    assert.throws(
      () => transform('abc', [], anchors as never),
      (err: unknown) =>
        err instanceof TransformError &&
        (err.code === 'INVALID_ANCHOR' || err.code === 'SURROGATE_SPLIT'),
      `expected INVALID_ANCHOR for ${JSON.stringify(anchors)}`,
    );
  }
});

test('reverse query positions are bounds-checked', () => {
  const { reverse } = transform('abc', [{ start: 1, end: 2, text: 'X' }]);
  assert.equal(reverse.length, 3);
  for (const bad of [-1, 4, 0.5, Number.NaN]) {
    assert.throws(
      () => reverse.query(bad),
      (err: unknown) => err instanceof TransformError && err.code === 'OUT_OF_BOUNDS',
    );
  }
});
