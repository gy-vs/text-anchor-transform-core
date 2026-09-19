import { test } from 'node:test';
import assert from 'node:assert/strict';
import { transform, TransformError, type Anchor, type Replacement } from '../src/index.js';

const point = (offset: number, affinity: 'left' | 'right' = 'left'): Anchor => ({
  kind: 'point',
  offset,
  affinity,
});

test('no edits: identity text, anchors and reverse mapping', () => {
  const result = transform('hello', [], [point(0), point(5, 'right'), {
    kind: 'range',
    start: 1,
    end: 4,
    startAffinity: 'left',
    endAffinity: 'right',
  }]);
  assert.equal(result.text, 'hello');
  assert.deepEqual(result.anchors, [
    { kind: 'point', offset: 0 },
    { kind: 'point', offset: 5 },
    { kind: 'range', start: 1, end: 4 },
  ]);
  assert.deepEqual(result.reverse.query(3), { type: 'exact', offset: 3 });
  assert.deepEqual(result.reverse.query(5), { type: 'exact', offset: 5 });
  assert.equal(result.reverse.length, 5);
});

test('anchors array may be omitted', () => {
  const result = transform('abc', [{ start: 1, end: 2, text: 'X' }]);
  assert.equal(result.text, 'aXc');
  assert.deepEqual(result.anchors, []);
});

test('insertions at the same point keep order; affinity picks the side', () => {
  const result = transform(
    'hello world',
    [
      { start: 5, end: 5, text: '!' },
      { start: 5, end: 5, text: '?' },
    ],
    [
      point(5, 'left'), // stays before both insertions
      point(5, 'right'), // moves after both insertions
      point(4, 'right'), // untouched
      point(6, 'left'), // shifted by both insertions
      { kind: 'range', start: 5, end: 5, startAffinity: 'right', endAffinity: 'left' },
    ],
  );
  assert.equal(result.text, 'hello!? world');
  assert.deepEqual(result.anchors, [
    { kind: 'point', offset: 5 },
    { kind: 'point', offset: 7 },
    { kind: 'point', offset: 4 },
    { kind: 'point', offset: 8 },
    // endpoints cross (7 vs 5) and are normalized, covering the inserted "!?"
    { kind: 'range', start: 5, end: 7 },
  ]);
  // inserted text reports its source boundaries, not a fake offset
  assert.deepEqual(result.reverse.query(5), { type: 'inserted', left: 5, right: 5 });
  assert.deepEqual(result.reverse.query(6), { type: 'inserted', left: 5, right: 5 });
  assert.deepEqual(result.reverse.query(7), { type: 'exact', offset: 5 });
});

test('full-range replacement collapses every anchor into the replacement', () => {
  const result = transform(
    'hello world',
    [{ start: 0, end: 11, text: 'hi' }],
    [
      point(0, 'left'),
      point(0, 'right'),
      point(5, 'left'), // strictly inside the deleted span
      point(5, 'right'),
      point(11, 'left'), // end of the deleted span
      { kind: 'range', start: 2, end: 8, startAffinity: 'left', endAffinity: 'right' },
    ],
  );
  assert.equal(result.text, 'hi');
  assert.deepEqual(result.anchors, [
    { kind: 'point', offset: 0 },
    { kind: 'point', offset: 2 },
    { kind: 'point', offset: 0 },
    { kind: 'point', offset: 2 },
    { kind: 'point', offset: 2 },
    { kind: 'range', start: 0, end: 2 },
  ]);
  assert.deepEqual(result.reverse.query(0), { type: 'inserted', left: 0, right: 11 });
  assert.deepEqual(result.reverse.query(2), { type: 'inserted', left: 0, right: 11 });
});

test('deleting the whole text to empty collapses everything to 0', () => {
  const result = transform(
    'hello world',
    [{ start: 0, end: 11, text: '' }],
    [point(0), point(5, 'right'), point(11), {
      kind: 'range',
      start: 3,
      end: 7,
      startAffinity: 'left',
      endAffinity: 'right',
    }],
  );
  assert.equal(result.text, '');
  assert.deepEqual(result.anchors, [
    { kind: 'point', offset: 0 },
    { kind: 'point', offset: 0 },
    { kind: 'point', offset: 0 },
    { kind: 'range', start: 0, end: 0 },
  ]);
  assert.equal(result.reverse.length, 0);
  // the only position of the empty text maps back to the deleted span's bounds
  assert.deepEqual(result.reverse.query(0), { type: 'inserted', left: 0, right: 11 });
});

test('adjacent edits share a boundary without interfering', () => {
  const result = transform(
    'abcdefgh',
    [
      { start: 2, end: 4, text: 'X' },
      { start: 4, end: 6, text: 'YZ' },
    ],
    [
      point(2, 'left'),
      point(2, 'right'),
      point(3, 'left'), // inside first edit
      point(4, 'left'), // junction of the two edits
      point(4, 'right'),
      point(6, 'left'), // right edge of second edit
      point(8, 'right'), // end of text
    ],
  );
  assert.equal(result.text, 'abXYZgh');
  assert.deepEqual(result.anchors, [
    { kind: 'point', offset: 2 },
    { kind: 'point', offset: 3 },
    { kind: 'point', offset: 2 },
    { kind: 'point', offset: 3 }, // after "X", before "YZ"
    { kind: 'point', offset: 5 }, // after "YZ"
    { kind: 'point', offset: 5 },
    { kind: 'point', offset: 7 },
  ]);
  assert.deepEqual(result.reverse.query(2), { type: 'inserted', left: 2, right: 4 });
  assert.deepEqual(result.reverse.query(3), { type: 'inserted', left: 4, right: 6 });
  assert.deepEqual(result.reverse.query(4), { type: 'inserted', left: 4, right: 6 });
  assert.deepEqual(result.reverse.query(5), { type: 'exact', offset: 6 });
});

test('anchors inside a deleted span collapse to the replacement ends by affinity', () => {
  const result = transform(
    'abcdefghij',
    [{ start: 3, end: 7, text: 'Z' }],
    [
      point(3, 'left'), // left edge of the deletion
      point(3, 'right'),
      point(4, 'left'), // strictly inside
      point(4, 'right'),
      point(6, 'left'),
      point(6, 'right'),
      point(7, 'left'), // right edge: kept character, lands after "Z"
      point(7, 'right'),
    ],
  );
  assert.equal(result.text, 'abcZhij');
  assert.deepEqual(result.anchors, [
    { kind: 'point', offset: 3 },
    { kind: 'point', offset: 4 },
    { kind: 'point', offset: 3 },
    { kind: 'point', offset: 4 },
    { kind: 'point', offset: 3 },
    { kind: 'point', offset: 4 },
    { kind: 'point', offset: 4 },
    { kind: 'point', offset: 4 },
  ]);
});

test('all edits are applied in original coordinates, not sequentially', () => {
  // If offsets were reinterpreted after the first edit, the second edit
  // [4, 5) would hit the wrong text after "LONG" shifted everything by 3.
  const result = transform(
    'abcdef',
    [
      { start: 0, end: 1, text: 'LONG' },
      { start: 4, end: 5, text: 'X' },
    ],
    [point(1), point(4, 'left'), point(4, 'right'), point(5)],
  );
  assert.equal(result.text, 'LONGbcdXf');
  assert.deepEqual(result.anchors, [
    { kind: 'point', offset: 4 }, // 'b'
    { kind: 'point', offset: 7 }, // before "X"
    { kind: 'point', offset: 8 }, // after "X"
    { kind: 'point', offset: 8 }, // 'f'
  ]);
  assert.deepEqual(result.reverse.query(0), { type: 'inserted', left: 0, right: 1 });
  assert.deepEqual(result.reverse.query(4), { type: 'exact', offset: 1 });
  assert.deepEqual(result.reverse.query(7), { type: 'inserted', left: 4, right: 5 });
  assert.deepEqual(result.reverse.query(8), { type: 'exact', offset: 5 });
  assert.deepEqual(result.reverse.query(9), { type: 'exact', offset: 6 });
});

test('surrogate pairs: offsets are UTF-16 code units and pairs cannot be split', () => {
  const original = 'a😀b'; // 'a' at 0, '😀' at 1..2, 'b' at 3; length 4
  assert.equal(original.length, 4);

  // an edit boundary between the two halves of '😀' is rejected
  assert.throws(
    () => transform(original, [{ start: 2, end: 3, text: 'x' }]),
    (err: unknown) => err instanceof TransformError && err.code === 'SURROGATE_SPLIT',
  );
  // an anchor between the halves is rejected
  assert.throws(
    () => transform(original, [], [point(2)]),
    (err: unknown) => err instanceof TransformError && err.code === 'SURROGATE_SPLIT',
  );

  // deleting the emoji (offsets 1..3) works and shifts 'b' from 3 to 1
  const deleted = transform(original, [{ start: 1, end: 3, text: '' }], [
    point(1, 'left'),
    point(3, 'left'),
  ]);
  assert.equal(deleted.text, 'ab');
  assert.deepEqual(deleted.anchors, [
    { kind: 'point', offset: 1 },
    { kind: 'point', offset: 1 },
  ]);
  assert.deepEqual(deleted.reverse.query(1), { type: 'exact', offset: 3 });

  // replacing 'b' after the emoji: the anchor at its left edge collapses
  // around the replacement
  const replaced = transform(original, [{ start: 3, end: 4, text: 'c' }], [
    point(1),
    point(3, 'left'),
    point(3, 'right'),
  ]);
  assert.equal(replaced.text, 'a😀c');
  assert.deepEqual(replaced.anchors, [
    { kind: 'point', offset: 1 },
    { kind: 'point', offset: 3 },
    { kind: 'point', offset: 4 },
  ]);
});

test('insertion between two emoji uses UTF-16 offsets', () => {
  const result = transform('😀😀', [{ start: 2, end: 2, text: '!' }], [
    point(2, 'left'),
    point(2, 'right'),
    point(4),
  ]);
  assert.equal(result.text, '😀!😀');
  assert.equal(result.text.length, 5);
  assert.deepEqual(result.anchors, [
    { kind: 'point', offset: 2 },
    { kind: 'point', offset: 3 },
    { kind: 'point', offset: 5 },
  ]);
  assert.deepEqual(result.reverse.query(3), { type: 'exact', offset: 2 });
});

test('ranges keep their own endpoint affinities and never invert', () => {
  // empty range at an insertion point: endpoints disagree, result is normalized
  const inserted = transform('abcde', [{ start: 2, end: 2, text: 'XYZ' }], [
    { kind: 'range', start: 2, end: 2, startAffinity: 'right', endAffinity: 'left' },
  ]);
  assert.equal(inserted.text, 'abXYZcde');
  assert.deepEqual(inserted.anchors, [{ kind: 'range', start: 2, end: 5 }]);

  // range fully inside a deletion: both endpoints collapse, result stays ordered
  const deleted = transform('abcdef', [{ start: 1, end: 5, text: 'Q' }], [
    { kind: 'range', start: 2, end: 4, startAffinity: 'right', endAffinity: 'left' },
  ]);
  assert.equal(deleted.text, 'aQf');
  assert.deepEqual(deleted.anchors, [{ kind: 'range', start: 1, end: 2 }]);

  // ordinary range around a deleted character
  const shrunk = transform('hello world', [{ start: 5, end: 6, text: '' }], [
    { kind: 'range', start: 0, end: 5, startAffinity: 'left', endAffinity: 'right' },
    { kind: 'range', start: 6, end: 11, startAffinity: 'left', endAffinity: 'right' },
  ]);
  assert.equal(shrunk.text, 'helloworld');
  assert.deepEqual(shrunk.anchors, [
    { kind: 'range', start: 0, end: 5 },
    { kind: 'range', start: 5, end: 10 },
  ]);
});

test('empty original text', () => {
  const identity = transform('', [], []);
  assert.equal(identity.text, '');
  assert.deepEqual(identity.reverse.query(0), { type: 'exact', offset: 0 });

  const inserted = transform('', [{ start: 0, end: 0, text: 'hi' }], [
    point(0, 'left'),
    point(0, 'right'),
  ]);
  assert.equal(inserted.text, 'hi');
  assert.deepEqual(inserted.anchors, [
    { kind: 'point', offset: 0 },
    { kind: 'point', offset: 2 },
  ]);
  assert.deepEqual(inserted.reverse.query(1), { type: 'inserted', left: 0, right: 0 });
});

test('mapped anchors keep their kind and stay aligned with the input order', () => {
  const result = transform('abcdef', [{ start: 1, end: 3, text: 'QQ' }], [
    { kind: 'range', start: 0, end: 6, startAffinity: 'left', endAffinity: 'right' },
    point(4, 'right'),
  ]);
  assert.equal(result.text, 'aQQdef');
  assert.deepEqual(result.anchors, [
    { kind: 'range', start: 0, end: 6 },
    { kind: 'point', offset: 4 },
  ]);
});
