/**
 * text-anchor-transform
 *
 * Applies a batch of non-overlapping replacements — all expressed in the
 * coordinates of the SAME original text — and maps cursor anchors and
 * half-open ranges from original coordinates to the coordinates of the new
 * text. Also provides reverse queries from new coordinates back to original
 * ones. All offsets are UTF-16 code unit offsets (i.e. `string.length` units).
 *
 * Anchor semantics for a replacement [s, e) -> text of length L:
 *  - o < s:        unchanged.
 *  - o > e:        shifted by the accumulated length delta.
 *  - s <= o <= e:  left affinity collapses to the LEFT end of the replacement
 *                  in the new text, right affinity to the RIGHT end.
 *                  This covers pure insertions (s == e): a left anchor stays
 *                  before the inserted text, a right anchor moves after it.
 * When adjacent replacements share a boundary point, a left-affinity anchor
 * at that point binds to the earliest replacement containing it, a
 * right-affinity anchor to the latest.
 */

/** Which side of an insertion an anchor sticks to. */
export type Affinity = 'left' | 'right';

/** A single replacement of the original range [start, end) with `text`. */
export interface Replacement {
  /** Start offset in the original text, inclusive (UTF-16 code units). */
  start: number;
  /** End offset in the original text, exclusive. */
  end: number;
  /** Text that replaces the [start, end) range. */
  text: string;
}

/** A cursor-like position in original coordinates with an affinity. */
export interface Anchor {
  offset: number;
  affinity: Affinity;
}

/** A half-open range [start, end) in original coordinates, one affinity per end. */
export interface RangeSpec {
  start: number;
  startAffinity: Affinity;
  end: number;
  endAffinity: Affinity;
}

/**
 * Result of a reverse query.
 * - `mapped`: the offset corresponds to kept original content; `offset` is the
 *   exact original position.
 * - `inserted`: the offset falls inside inserted content, which has no single
 *   original counterpart; `left`/`right` are the original offsets bounding the
 *   replacement that produced it (equal for a pure insertion).
 */
export type ReverseResult =
  | { kind: 'mapped'; offset: number }
  | { kind: 'inserted'; left: number; right: number };

/** Reverse query structure: new-text coordinates -> original coordinates. */
export interface ReverseMap {
  /** Length of the new text in UTF-16 code units. */
  readonly length: number;
  /** Map one new-text offset back to original coordinates. */
  mapBack(offset: number): ReverseResult;
  /** Batch version of {@link mapBack}. */
  mapBackAll(offsets: readonly number[]): ReverseResult[];
}

/** A prepared transform: the new text plus forward and reverse mapping. */
export interface Transformer extends ReverseMap {
  /** The new text after applying all replacements. */
  readonly text: string;
  /** Length of the original text in UTF-16 code units. */
  readonly originalLength: number;
  /** Map one original offset with the given affinity to new coordinates. */
  mapAnchor(offset: number, affinity: Affinity): number;
  /** Batch version of {@link mapAnchor}. */
  mapAnchors(anchors: readonly Anchor[]): number[];
  /**
   * Map a half-open range, applying each end's own affinity. If the mapped
   * start would end up after the mapped end (both ends swallowed by the same
   * replacement), the range collapses to the start's mapped position so the
   * result is never reversed.
   */
  mapRange(range: RangeSpec): { start: number; end: number };
}

/** Convenience result of {@link transform}. */
export interface TransformResult {
  /** The new text. */
  text: string;
  /** New offsets of the input anchors, in the same order. */
  anchors: number[];
  /** Reverse queries from new coordinates back to original ones. */
  reverse: ReverseMap;
}

/** Thrown when replacements, anchors, ranges or query offsets are invalid. */
export class EditValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EditValidationError';
  }
}

interface NormReplacement {
  start: number;
  end: number;
  text: string;
  /** text.length - (end - start) */
  delta: number;
}

type Segment =
  | { kind: 'kept'; newStart: number; newEnd: number; origStart: number }
  | { kind: 'inserted'; newStart: number; newEnd: number; left: number; right: number };

function assertOffset(value: unknown, what: string, max: number): asserts value is number {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw new EditValidationError(`${what} must be an integer, got ${String(value)}`);
  }
  if (value < 0 || value > max) {
    throw new EditValidationError(`${what} ${value} is out of bounds [0, ${max}]`);
  }
}

function assertAffinity(value: unknown, what: string): asserts value is Affinity {
  if (value !== 'left' && value !== 'right') {
    throw new EditValidationError(`${what} must be 'left' or 'right', got ${String(value)}`);
  }
}

/**
 * Validates that replacements are integer-ranged, in bounds, sorted by start
 * and non-overlapping (adjacent ranges and multiple empty insertions at the
 * same point are allowed), then attaches precomputed length deltas.
 */
function normalizeReplacements(
  original: string,
  replacements: readonly Replacement[],
): NormReplacement[] {
  if (!Array.isArray(replacements)) {
    throw new EditValidationError('replacements must be an array');
  }
  const out: NormReplacement[] = [];
  let prevEnd = 0;
  for (let i = 0; i < replacements.length; i++) {
    const r = replacements[i];
    if (r === null || typeof r !== 'object') {
      throw new EditValidationError(`replacement #${i} must be an object`);
    }
    assertOffset(r.start, `replacement #${i} start`, original.length);
    assertOffset(r.end, `replacement #${i} end`, original.length);
    if (r.start > r.end) {
      throw new EditValidationError(
        `replacement #${i} has start (${r.start}) greater than end (${r.end})`,
      );
    }
    if (typeof r.text !== 'string') {
      throw new EditValidationError(`replacement #${i} text must be a string`);
    }
    if (r.start < prevEnd) {
      throw new EditValidationError(
        `replacement #${i} [${r.start}, ${r.end}) overlaps a previous replacement or is ` +
          `out of order (previous replacement ends at ${prevEnd}); replacements must be ` +
          'sorted by start offset and must not overlap',
      );
    }
    prevEnd = r.end;
    out.push({ start: r.start, end: r.end, text: r.text, delta: r.text.length - (r.end - r.start) });
  }
  return out;
}

/**
 * Validates the replacements, applies them all against the same original
 * text, and returns a {@link Transformer} for forward and reverse mapping.
 */
export function createTransformer(
  original: string,
  replacements: readonly Replacement[],
): Transformer {
  if (typeof original !== 'string') {
    throw new EditValidationError('original text must be a string');
  }
  const reps = normalizeReplacements(original, replacements);

  // Apply all replacements simultaneously and record the new text as a
  // sequence of kept / inserted segments for reverse queries.
  const parts: string[] = [];
  const segments: Segment[] = [];
  let origCursor = 0;
  let newCursor = 0;
  for (const rep of reps) {
    if (rep.start > origCursor) {
      parts.push(original.slice(origCursor, rep.start));
      segments.push({
        kind: 'kept',
        newStart: newCursor,
        newEnd: newCursor + (rep.start - origCursor),
        origStart: origCursor,
      });
      newCursor += rep.start - origCursor;
    }
    if (rep.text.length > 0) {
      parts.push(rep.text);
      segments.push({
        kind: 'inserted',
        newStart: newCursor,
        newEnd: newCursor + rep.text.length,
        left: rep.start,
        right: rep.end,
      });
      newCursor += rep.text.length;
    }
    origCursor = rep.end;
  }
  if (origCursor < original.length) {
    parts.push(original.slice(origCursor));
    segments.push({
      kind: 'kept',
      newStart: newCursor,
      newEnd: newCursor + (original.length - origCursor),
      origStart: origCursor,
    });
    newCursor += original.length - origCursor;
  }
  const newText = parts.join('');
  const newLength = newCursor;

  function mapAnchor(offset: number, affinity: Affinity): number {
    assertOffset(offset, 'anchor offset', original.length);
    assertAffinity(affinity, 'affinity');
    let delta = 0;
    let rightResult = -1;
    for (const rep of reps) {
      if (rep.end < offset) {
        delta += rep.delta;
        continue;
      }
      if (rep.start > offset) break;
      // rep.start <= offset <= rep.end: the anchor is touched by this edit.
      // Left affinity binds to the first such edit, right affinity to the last.
      if (affinity === 'left') return rep.start + delta;
      rightResult = rep.start + delta + rep.text.length;
      delta += rep.delta;
    }
    return rightResult >= 0 ? rightResult : offset + delta;
  }

  function mapAnchors(anchors: readonly Anchor[]): number[] {
    if (!Array.isArray(anchors)) {
      throw new EditValidationError('anchors must be an array');
    }
    return anchors.map((a, i) => {
      if (a === null || typeof a !== 'object') {
        throw new EditValidationError(`anchor #${i} must be an object`);
      }
      return mapAnchor(a.offset, a.affinity);
    });
  }

  function mapRange(range: RangeSpec): { start: number; end: number } {
    if (range === null || typeof range !== 'object') {
      throw new EditValidationError('range must be an object');
    }
    assertOffset(range.start, 'range start', original.length);
    assertOffset(range.end, 'range end', original.length);
    if (range.start > range.end) {
      throw new EditValidationError(
        `range start (${range.start}) is greater than range end (${range.end})`,
      );
    }
    const start = mapAnchor(range.start, range.startAffinity);
    const end = mapAnchor(range.end, range.endAffinity);
    // Never return a reversed range: collapse to the start's mapped position.
    return { start, end: end < start ? start : end };
  }

  function mapBack(offset: number): ReverseResult {
    assertOffset(offset, 'reverse query offset', newLength);
    // Segments tile [0, newLength] contiguously; find the last one starting
    // at or before `offset`.
    let lo = 0;
    let hi = segments.length - 1;
    let idx = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (segments[mid]!.newStart <= offset) {
        idx = mid;
        lo = mid + 1;
      } else {
        hi = mid - 1;
      }
    }
    if (idx < 0) {
      // Only reachable when both texts are empty.
      return { kind: 'mapped', offset: 0 };
    }
    const seg = segments[idx]!;
    if (seg.kind === 'kept') {
      return { kind: 'mapped', offset: seg.origStart + (offset - seg.newStart) };
    }
    // Inserted segment: at its exact left edge, prefer the kept segment on
    // the left (an exact original coordinate) over reporting boundaries.
    if (offset === seg.newStart && idx > 0) {
      const prev = segments[idx - 1]!;
      if (prev.kind === 'kept') {
        return { kind: 'mapped', offset: prev.origStart + (offset - prev.newStart) };
      }
    }
    return { kind: 'inserted', left: seg.left, right: seg.right };
  }

  function mapBackAll(offsets: readonly number[]): ReverseResult[] {
    if (!Array.isArray(offsets)) {
      throw new EditValidationError('offsets must be an array');
    }
    return offsets.map(mapBack);
  }

  return {
    text: newText,
    length: newLength,
    originalLength: original.length,
    mapAnchor,
    mapAnchors,
    mapRange,
    mapBack,
    mapBackAll,
  };
}

/**
 * Convenience one-shot API: returns the new text, the new positions of the
 * given anchors (same order), and a reverse query structure.
 */
export function transform(
  original: string,
  replacements: readonly Replacement[],
  anchors: readonly Anchor[] = [],
): TransformResult {
  const t = createTransformer(original, replacements);
  return { text: t.text, anchors: t.mapAnchors(anchors), reverse: t };
}
