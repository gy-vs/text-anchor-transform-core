# text-anchor-transform-core

Map cursors and half-open ranges through a batch of text replacements, and
query new-text positions back to their origin. Pure library, no editor or
diff dependencies. TypeScript + Node.js 20, all offsets are **UTF-16 code
units** (the same coordinates `String.prototype.slice` uses).

## Model

- A **replacement** `{ start, end, text }` replaces the half-open span
  `[start, end)` of the *original* text with `text`. `start === end` is a
  pure insertion.
- All replacements in one call refer to the **same original text** and are
  applied as a single batch — offsets are never reinterpreted against
  intermediate text.
- Replacements must be sorted by ascending `start`, in bounds, and
  non-overlapping (`next.start >= prev.end`; adjacent edits and multiple
  insertions at the same point are allowed and applied in the given order).
- No edit boundary or anchor may split a UTF-16 surrogate pair.
- Violations throw `TransformError` with a stable `code`
  (`INVALID_EDIT`, `NOT_SORTED`, `OVERLAP`, `OUT_OF_BOUNDS`,
  `SURROGATE_SPLIT`, `INVALID_ANCHOR`).

## Anchors and affinity

- **Point anchor** `{ kind: 'point', offset, affinity }` — a cursor.
- **Range anchor** `{ kind: 'range', start, end, startAffinity, endAffinity }`
  — a half-open selection `[start, end)`. Each endpoint is mapped with its
  own affinity; if the mapped endpoints would cross, the result is
  normalized to `[min, max]` so a range never runs backwards.

Affinity decides what happens when text is inserted **exactly at** an
anchor: `'left'` stays before the inserted text, `'right'` moves after it.
An anchor inside a deleted span collapses to the left or right end of the
replacement text according to its affinity.

## Usage

```ts
import { transform } from 'text-anchor-transform-core';

const result = transform(
  'hello world',
  [
    { start: 5, end: 5, text: '!' },   // insert at the gap
    { start: 6, end: 11, text: 'there' },
  ],
  [
    { kind: 'point', offset: 5, affinity: 'left' },   // -> 5 (before "!")
    { kind: 'point', offset: 5, affinity: 'right' },  // -> 6 (after "!")
    { kind: 'range', start: 6, end: 11,
      startAffinity: 'left', endAffinity: 'right' },  // -> [7, 12)
  ],
);

result.text;     // 'hello! there'
result.anchors;  // mapped anchors, aligned by index with the input
```

## Reverse queries

`result.reverse` is a `ReverseIndex` over the new text:

```ts
result.reverse.query(7);
// kept text:      { type: 'exact', offset: 6 }
// inserted text:  { type: 'inserted', left: 6, right: 11 }
//                 ^ the two original offsets bounding the edit,
//                   never a fabricated single coordinate

result.reverse.queryMany([0, 5, 7]); // batch, aligned by index
```

Segments are half-open: an offset on a boundary resolves to the segment
starting there, except the end-of-text offset, which resolves to the last
segment. Valid query range is `[0, reverse.length]`.

## Development

```sh
npm install
npm test   # compiles to dist/ and runs node --test
```

Layout: `src/` (library), `test/` (node:test suites, compiled alongside).
