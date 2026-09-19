import type { ReverseIndex } from './reverse.js';

/**
 * Which side of an insertion an anchor sticks to when text is inserted
 * exactly at the anchor's offset.
 *
 * - `'left'`:  the anchor stays before the inserted text.
 * - `'right'`: the anchor moves after the inserted text.
 */
export type Affinity = 'left' | 'right';

/**
 * A single replacement in original-text UTF-16 coordinates:
 * the half-open span `[start, end)` of the original text is replaced
 * by `text`. `start === end` is a pure insertion.
 *
 * All replacements passed to {@link transform} refer to the *same*
 * original text; they are applied as one batch, never sequentially.
 */
export interface Replacement {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/** A cursor-style anchor: a single offset with an affinity. */
export interface PointAnchor {
  readonly kind: 'point';
  readonly offset: number;
  readonly affinity: Affinity;
}

/**
 * A half-open selection-style anchor `[start, end)`. Each endpoint is
 * mapped with its own affinity. If the mapped endpoints would invert,
 * the result is normalized to `[min, max]` so it never runs backwards.
 */
export interface RangeAnchor {
  readonly kind: 'range';
  readonly start: number;
  readonly end: number;
  readonly startAffinity: Affinity;
  readonly endAffinity: Affinity;
}

export type Anchor = PointAnchor | RangeAnchor;

export interface MappedPoint {
  readonly kind: 'point';
  readonly offset: number;
}

export interface MappedRange {
  readonly kind: 'range';
  readonly start: number;
  readonly end: number;
}

export type MappedAnchor = MappedPoint | MappedRange;

/** Maps an input anchor to its output shape, preserving point/range kind. */
export type MappedAnchorOf<A extends Anchor> = A extends RangeAnchor
  ? MappedRange
  : MappedPoint;

/**
 * Result of a reverse query for a position that lies in text kept from
 * the original: the exact original offset.
 */
export interface ReverseExact {
  readonly type: 'exact';
  readonly offset: number;
}

/**
 * Result of a reverse query for a position inside inserted (replacement)
 * text. Inserted text has no single original coordinate, so the two
 * original offsets bounding the edit are returned instead:
 * `left` is the edit's `start`, `right` is the edit's `end`
 * (equal for a pure insertion).
 */
export interface ReverseInserted {
  readonly type: 'inserted';
  readonly left: number;
  readonly right: number;
}

export type ReverseMapping = ReverseExact | ReverseInserted;

export interface TransformResult<A extends Anchor = Anchor> {
  /** The new text after applying all replacements. */
  readonly text: string;
  /** Mapped anchors, aligned by index with the input anchors. */
  readonly anchors: MappedAnchorOf<A>[];
  /** Reverse query structure: new-text offset -> original position. */
  readonly reverse: ReverseIndex;
}
