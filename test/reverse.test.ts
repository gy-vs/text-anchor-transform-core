import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transform, type ReverseMapping } from '../src/index.js';

test('reverse index maps kept text exactly and inserted text to source boundaries', () => {
  // "abcdef" -> "LONGbcdXf"
  const { reverse } = transform('abcdef', [
    { start: 0, end: 1, text: 'LONG' },
    { start: 4, end: 5, text: 'X' },
  ]);
  assert.equal(reverse.length, 9);

  const expected: ReverseMapping[] = [
    { type: 'inserted', left: 0, right: 1 }, // L
    { type: 'inserted', left: 0, right: 1 }, // O
    { type: 'inserted', left: 0, right: 1 }, // N
    { type: 'inserted', left: 0, right: 1 }, // G
    { type: 'exact', offset: 1 }, // b
    { type: 'exact', offset: 2 }, // c
    { type: 'exact', offset: 3 }, // d
    { type: 'inserted', left: 4, right: 5 }, // X
    { type: 'exact', offset: 5 }, // f
  ];
  expected.forEach((mapping, position) => {
    assert.deepEqual(reverse.query(position), mapping, `position ${position}`);
  });
  // end-of-text resolves to the last segment
  assert.deepEqual(reverse.query(9), { type: 'exact', offset: 6 });
});

test('batch reverse queries stay aligned with the input positions', () => {
  const { reverse } = transform('abcdef', [
    { start: 0, end: 1, text: 'LONG' },
    { start: 4, end: 5, text: 'X' },
  ]);
  const positions = [9, 0, 4, 7, 8, 4];
  assert.deepEqual(reverse.queryMany(positions), [
    { type: 'exact', offset: 6 },
    { type: 'inserted', left: 0, right: 1 },
    { type: 'exact', offset: 1 },
    { type: 'inserted', left: 4, right: 5 },
    { type: 'exact', offset: 5 },
    { type: 'exact', offset: 1 },
  ]);
  assert.deepEqual(reverse.queryMany([]), []);
  // batch queries are bounds-checked too
  assert.throws(() => reverse.queryMany([0, 10]));
});

test('reverse query on boundaries resolves to the segment starting there', () => {
  // "hello world" -> "hello!? world": kept[0,5) ins"!"[5,6) ins"?"[6,7) kept[7,13)
  const { reverse } = transform('hello world', [
    { start: 5, end: 5, text: '!' },
    { start: 5, end: 5, text: '?' },
  ]);
  assert.deepEqual(reverse.query(0), { type: 'exact', offset: 0 });
  assert.deepEqual(reverse.query(5), { type: 'inserted', left: 5, right: 5 });
  assert.deepEqual(reverse.query(6), { type: 'inserted', left: 5, right: 5 });
  assert.deepEqual(reverse.query(7), { type: 'exact', offset: 5 });
  assert.deepEqual(reverse.query(13), { type: 'exact', offset: 11 });
});

test('reverse query after deleting everything reports the deleted span bounds', () => {
  const { reverse } = transform('hello world', [{ start: 0, end: 11, text: '' }]);
  assert.equal(reverse.length, 0);
  assert.deepEqual(reverse.query(0), { type: 'inserted', left: 0, right: 11 });
});

test('reverse query on empty input is exact', () => {
  const { reverse } = transform('', []);
  assert.equal(reverse.length, 0);
  assert.deepEqual(reverse.query(0), { type: 'exact', offset: 0 });
});

test('round trip: forward-mapped anchors query back to their origin', () => {
  const original = 'The quick brown fox';
  const edits = [
    { start: 4, end: 9, text: 'slow' }, // quick -> slow
    { start: 16, end: 19, text: 'cat' }, // fox -> cat
  ];
  // anchors on kept characters round-trip exactly (offset 19 is the right
  // edge of the deleted "fox" and would land inside the inserted "cat")
  const anchors = [0, 3, 9, 10, 15].map((offset) => ({
    kind: 'point' as const,
    offset,
    affinity: 'left' as const,
  }));
  const result = transform(original, edits, anchors);
  assert.equal(result.text, 'The slow brown cat');
  result.anchors.forEach((anchor, i) => {
    assert.equal(anchor.kind, 'point');
    if (anchor.kind !== 'point') return;
    const back = result.reverse.query(anchor.offset);
    assert.deepEqual(back, { type: 'exact', offset: anchors[i]!.offset });
  });
});
