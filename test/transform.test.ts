import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createTransformer,
  transform,
  EditValidationError,
  type Anchor,
  type ReverseResult,
} from '../src/index.js';

describe('same-point insertion', () => {
  test('anchor at the insertion point follows its affinity', () => {
    const t = createTransformer('hello', [{ start: 2, end: 2, text: 'XY' }]);
    assert.equal(t.text, 'heXYllo');
    assert.equal(t.length, 7);
    // Insertion exactly at the anchor: left stays before, right moves after.
    assert.equal(t.mapAnchor(2, 'left'), 2);
    assert.equal(t.mapAnchor(2, 'right'), 4);
    // Untouched and shifted anchors.
    assert.equal(t.mapAnchor(0, 'left'), 0);
    assert.equal(t.mapAnchor(1, 'right'), 1);
    assert.equal(t.mapAnchor(3, 'left'), 5);
    assert.equal(t.mapAnchor(5, 'right'), 7);
  });

  test('two insertions at the same point are applied in order', () => {
    const t = createTransformer('ab', [
      { start: 1, end: 1, text: 'X' },
      { start: 1, end: 1, text: 'Y' },
    ]);
    assert.equal(t.text, 'aXYb');
    assert.equal(t.mapAnchor(1, 'left'), 1); // before "X"
    assert.equal(t.mapAnchor(1, 'right'), 3); // after "Y"
    assert.deepEqual(t.mapBack(1), { kind: 'mapped', offset: 1 });
    assert.deepEqual(t.mapBack(2), { kind: 'inserted', left: 1, right: 1 });
    assert.deepEqual(t.mapBack(3), { kind: 'mapped', offset: 1 });
  });

  test('reverse query reports source boundaries for inserted content', () => {
    const t = createTransformer('hello', [{ start: 2, end: 2, text: 'XY' }]);
    assert.deepEqual(t.mapBack(0), { kind: 'mapped', offset: 0 });
    // Exact edges of the insertion resolve to the neighbouring kept content.
    assert.deepEqual(t.mapBack(2), { kind: 'mapped', offset: 2 });
    assert.deepEqual(t.mapBack(4), { kind: 'mapped', offset: 2 });
    // Strictly inside: no single original coordinate exists.
    assert.deepEqual(t.mapBack(3), { kind: 'inserted', left: 2, right: 2 });
    assert.deepEqual(t.mapBack(7), { kind: 'mapped', offset: 5 });
  });
});

describe('full-span deletion and replacement', () => {
  test('deleting the whole text collapses every anchor to 0', () => {
    const t = createTransformer('hello world', [{ start: 0, end: 11, text: '' }]);
    assert.equal(t.text, '');
    assert.equal(t.length, 0);
    for (const affinity of ['left', 'right'] as const) {
      for (const offset of [0, 5, 11]) {
        assert.equal(t.mapAnchor(offset, affinity), 0);
      }
    }
    assert.deepEqual(t.mapBack(0), { kind: 'mapped', offset: 0 });
  });

  test('replacing the whole text collapses anchors to the replacement ends', () => {
    const t = createTransformer('hello world', [{ start: 0, end: 11, text: 'bye' }]);
    assert.equal(t.text, 'bye');
    assert.equal(t.mapAnchor(0, 'left'), 0);
    assert.equal(t.mapAnchor(0, 'right'), 3);
    assert.equal(t.mapAnchor(5, 'left'), 0);
    assert.equal(t.mapAnchor(5, 'right'), 3);
    assert.equal(t.mapAnchor(11, 'left'), 0);
    assert.equal(t.mapAnchor(11, 'right'), 3);
    // The whole new text is inserted content with no kept neighbours.
    assert.deepEqual(t.mapBack(0), { kind: 'inserted', left: 0, right: 11 });
    assert.deepEqual(t.mapBack(2), { kind: 'inserted', left: 0, right: 11 });
    assert.deepEqual(t.mapBack(3), { kind: 'inserted', left: 0, right: 11 });
  });

  test('pure deletion in the middle', () => {
    const t = createTransformer('abcde', [{ start: 1, end: 4, text: '' }]);
    assert.equal(t.text, 'ae');
    assert.equal(t.mapAnchor(1, 'left'), 1);
    assert.equal(t.mapAnchor(1, 'right'), 1);
    assert.equal(t.mapAnchor(2, 'left'), 1);
    assert.equal(t.mapAnchor(2, 'right'), 1);
    assert.equal(t.mapAnchor(4, 'left'), 1);
    assert.equal(t.mapAnchor(4, 'right'), 1);
    assert.equal(t.mapAnchor(5, 'right'), 2);
  });
});

describe('adjacent edits', () => {
  const t = createTransformer('abcdefgh', [
    { start: 2, end: 4, text: 'X' },
    { start: 4, end: 6, text: 'YZ' },
  ]);

  test('apply simultaneously against the original coordinates', () => {
    assert.equal(t.text, 'abXYZgh');
  });

  test('anchors inside each edit collapse to that edit', () => {
    assert.equal(t.mapAnchor(2, 'left'), 2);
    assert.equal(t.mapAnchor(2, 'right'), 3);
    assert.equal(t.mapAnchor(3, 'left'), 2);
    assert.equal(t.mapAnchor(3, 'right'), 3);
    assert.equal(t.mapAnchor(5, 'left'), 3);
    assert.equal(t.mapAnchor(5, 'right'), 5);
    assert.equal(t.mapAnchor(6, 'left'), 3);
    assert.equal(t.mapAnchor(6, 'right'), 5);
    assert.equal(t.mapAnchor(7, 'right'), 6);
  });

  test('anchor at the shared boundary binds by affinity', () => {
    // Left affinity binds to the earliest edit touching the point,
    // right affinity to the latest.
    assert.equal(t.mapAnchor(4, 'left'), 2); // left end of [2,4) -> "X"
    assert.equal(t.mapAnchor(4, 'right'), 5); // right end of [4,6) -> "YZ"
  });

  test('reverse queries across adjacent inserted segments', () => {
    assert.deepEqual(t.mapBack(2), { kind: 'mapped', offset: 2 });
    assert.deepEqual(t.mapBack(3), { kind: 'inserted', left: 4, right: 6 });
    assert.deepEqual(t.mapBack(4), { kind: 'inserted', left: 4, right: 6 });
    assert.deepEqual(t.mapBack(5), { kind: 'mapped', offset: 6 });
    assert.deepEqual(t.mapBack(7), { kind: 'mapped', offset: 8 });
  });
});

describe('surrogate pair boundaries', () => {
  const emoji = 'a\u{1F600}b'; // 'a', '😀' (2 UTF-16 code units), 'b'

  test('offsets are UTF-16 code units', () => {
    assert.equal(emoji.length, 4);
  });

  test('replacing an astral character', () => {
    const t = createTransformer(emoji, [{ start: 1, end: 3, text: '?' }]);
    assert.equal(t.text, 'a?b');
    assert.equal(t.mapAnchor(1, 'left'), 1);
    assert.equal(t.mapAnchor(1, 'right'), 2);
    // Offset 2 is the middle of the surrogate pair: it is strictly inside the
    // replaced range and collapses like any other interior offset.
    assert.equal(t.mapAnchor(2, 'left'), 1);
    assert.equal(t.mapAnchor(2, 'right'), 2);
    assert.equal(t.mapAnchor(3, 'left'), 1);
    assert.equal(t.mapAnchor(3, 'right'), 2);
    assert.equal(t.mapAnchor(4, 'right'), 3);
    assert.deepEqual(t.mapBack(1), { kind: 'mapped', offset: 1 });
    assert.deepEqual(t.mapBack(2), { kind: 'mapped', offset: 3 });
  });

  test('inserting right after an astral character', () => {
    const t = createTransformer(emoji, [{ start: 3, end: 3, text: 'x' }]);
    assert.equal(t.text, 'a\u{1F600}xb');
    assert.equal(t.mapAnchor(3, 'left'), 3);
    assert.equal(t.mapAnchor(3, 'right'), 4);
    assert.equal(t.mapAnchor(4, 'right'), 5);
    assert.deepEqual(t.mapBack(4), { kind: 'mapped', offset: 3 });
  });

  test('deleting up to an astral character', () => {
    const t = createTransformer(emoji, [{ start: 0, end: 1, text: '' }]);
    assert.equal(t.text, '\u{1F600}b');
    assert.equal(t.mapAnchor(1, 'left'), 0);
    assert.equal(t.mapAnchor(1, 'right'), 0);
    assert.equal(t.mapAnchor(3, 'right'), 2); // after the emoji
    assert.equal(t.mapAnchor(4, 'right'), 3);
  });
});

describe('batch queries', () => {
  test('transform returns text, all anchor positions and the reverse map', () => {
    const anchors: Anchor[] = [
      { offset: 0, affinity: 'left' },
      { offset: 6, affinity: 'left' },
      { offset: 6, affinity: 'right' },
      { offset: 7, affinity: 'left' },
      { offset: 7, affinity: 'right' },
      { offset: 8, affinity: 'left' },
      { offset: 8, affinity: 'right' },
      { offset: 11, affinity: 'right' },
    ];
    const result = transform('hello world', [{ start: 6, end: 8, text: 'XYZ' }], anchors);
    assert.equal(result.text, 'hello XYZrld');
    assert.deepEqual(result.anchors, [0, 6, 9, 6, 9, 6, 9, 12]);
    assert.equal(result.reverse.length, 12);
  });

  test('mapBackAll maps a batch of new offsets', () => {
    const result = transform('hello world', [{ start: 6, end: 8, text: 'XYZ' }]);
    const expected: ReverseResult[] = [
      { kind: 'mapped', offset: 0 },
      { kind: 'mapped', offset: 6 },
      { kind: 'inserted', left: 6, right: 8 },
      { kind: 'mapped', offset: 8 },
      { kind: 'mapped', offset: 11 },
    ];
    assert.deepEqual(result.reverse.mapBackAll([0, 6, 7, 9, 12]), expected);
  });

  test('mapAnchors preserves order and validates every anchor', () => {
    const t = createTransformer('abc', [{ start: 1, end: 1, text: 'Z' }]);
    assert.deepEqual(
      t.mapAnchors([
        { offset: 3, affinity: 'right' },
        { offset: 1, affinity: 'left' },
        { offset: 1, affinity: 'right' },
      ]),
      [4, 1, 2],
    );
    assert.throws(
      () => t.mapAnchors([{ offset: 99, affinity: 'left' }]),
      EditValidationError,
    );
  });
});

describe('range mapping', () => {
  const t = createTransformer('hello world', [{ start: 6, end: 8, text: 'XYZW' }]);

  test('each end applies its own affinity', () => {
    assert.equal(t.text, 'hello XYZWrld');
    assert.deepEqual(
      t.mapRange({ start: 4, startAffinity: 'left', end: 9, endAffinity: 'right' }),
      { start: 4, end: 11 },
    );
    // Range exactly over the replaced region maps onto the replacement.
    assert.deepEqual(
      t.mapRange({ start: 6, startAffinity: 'left', end: 8, endAffinity: 'right' }),
      { start: 6, end: 10 },
    );
  });

  test('result is never reversed', () => {
    // Both ends are swallowed by the same replacement and pull in opposite
    // directions; the range collapses to the start's mapped position.
    assert.deepEqual(
      t.mapRange({ start: 6, startAffinity: 'right', end: 8, endAffinity: 'left' }),
      { start: 10, end: 10 },
    );
  });

  test('range endpoints are validated', () => {
    assert.throws(
      () => t.mapRange({ start: 2, startAffinity: 'left', end: 1, endAffinity: 'left' }),
      EditValidationError,
    );
    assert.throws(
      () => t.mapRange({ start: 0, startAffinity: 'left', end: 99, endAffinity: 'right' }),
      EditValidationError,
    );
  });
});

describe('all edits share the original coordinate space', () => {
  test('later edits are not affected by earlier length changes', () => {
    const t = createTransformer('0123456789', [
      { start: 1, end: 2, text: 'AA' },
      { start: 8, end: 9, text: 'BB' },
    ]);
    assert.equal(t.text, '0AA234567BB9');
    assert.equal(t.mapAnchor(2, 'left'), 1);
    assert.equal(t.mapAnchor(2, 'right'), 3);
    assert.equal(t.mapAnchor(8, 'left'), 9);
    assert.equal(t.mapAnchor(8, 'right'), 11);
    assert.equal(t.mapAnchor(9, 'right'), 11);
    assert.equal(t.mapAnchor(10, 'left'), 12);
  });
});

describe('input validation', () => {
  test('overlapping replacements are rejected', () => {
    assert.throws(
      () =>
        createTransformer('abcd', [
          { start: 1, end: 3, text: '' },
          { start: 2, end: 4, text: '' },
        ]),
      EditValidationError,
    );
  });

  test('out-of-order replacements are rejected', () => {
    assert.throws(
      () =>
        createTransformer('abcd', [
          { start: 2, end: 3, text: '' },
          { start: 0, end: 1, text: '' },
        ]),
      EditValidationError,
    );
  });

  test('out-of-bounds and malformed replacements are rejected', () => {
    assert.throws(
      () => createTransformer('abc', [{ start: 0, end: 4, text: '' }]),
      EditValidationError,
    );
    assert.throws(
      () => createTransformer('abc', [{ start: -1, end: 1, text: '' }]),
      EditValidationError,
    );
    assert.throws(
      () => createTransformer('abc', [{ start: 2, end: 1, text: '' }]),
      EditValidationError,
    );
    assert.throws(
      () => createTransformer('abc', [{ start: 1.5, end: 2, text: '' }]),
      EditValidationError,
    );
    assert.throws(
      () => createTransformer('abc', [{ start: 0, end: 1, text: 42 as unknown as string }]),
      EditValidationError,
    );
  });

  test('anchors and reverse queries are validated', () => {
    const t = createTransformer('abc', []);
    assert.throws(() => t.mapAnchor(4, 'left'), EditValidationError);
    assert.throws(() => t.mapAnchor(-1, 'left'), EditValidationError);
    assert.throws(() => t.mapAnchor(1.5, 'left'), EditValidationError);
    assert.throws(() => t.mapAnchor(1, 'up' as never), EditValidationError);
    assert.throws(() => t.mapBack(4), EditValidationError);
    assert.throws(() => t.mapBack(-1), EditValidationError);
  });
});

describe('degenerate cases', () => {
  test('no replacements is the identity', () => {
    const t = createTransformer('abc', []);
    assert.equal(t.text, 'abc');
    assert.deepEqual(
      t.mapAnchors([
        { offset: 0, affinity: 'left' },
        { offset: 3, affinity: 'right' },
      ]),
      [0, 3],
    );
    assert.deepEqual(t.mapBackAll([0, 1, 2, 3]), [
      { kind: 'mapped', offset: 0 },
      { kind: 'mapped', offset: 1 },
      { kind: 'mapped', offset: 2 },
      { kind: 'mapped', offset: 3 },
    ]);
  });

  test('empty replacement is a no-op', () => {
    const t = createTransformer('abc', [{ start: 1, end: 1, text: '' }]);
    assert.equal(t.text, 'abc');
    assert.equal(t.mapAnchor(1, 'left'), 1);
    assert.equal(t.mapAnchor(1, 'right'), 1);
    assert.deepEqual(t.mapBack(1), { kind: 'mapped', offset: 1 });
  });

  test('empty text', () => {
    const t = createTransformer('', []);
    assert.equal(t.text, '');
    assert.equal(t.mapAnchor(0, 'right'), 0);
    assert.deepEqual(t.mapBack(0), { kind: 'mapped', offset: 0 });
  });

  test('transform without anchors defaults to an empty list', () => {
    const result = transform('abc', [{ start: 0, end: 1, text: 'Z' }]);
    assert.equal(result.text, 'Zbc');
    assert.deepEqual(result.anchors, []);
  });
});
