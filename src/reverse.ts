import { TransformError } from './errors.js';
import type { ReverseMapping } from './types.js';

/** A span of the new text copied unchanged from the original. */
export interface KeptSegment {
  readonly kind: 'kept';
  readonly newStart: number;
  readonly newEnd: number;
  readonly origStart: number;
  readonly origEnd: number;
}

/** A span of the new text produced by a replacement (inserted text). */
export interface InsertedSegment {
  readonly kind: 'inserted';
  readonly newStart: number;
  readonly newEnd: number;
  /** Original offset of the edit's left boundary (`start`). */
  readonly origStart: number;
  /** Original offset of the edit's right boundary (`end`). */
  readonly origEnd: number;
}

export type Segment = KeptSegment | InsertedSegment;

/**
 * Reverse query structure mapping new-text offsets back to original
 * positions. Segments are half-open `[newStart, newEnd)`: an offset on a
 * boundary resolves to the segment starting there, except the end-of-text
 * offset, which resolves to the last segment.
 */
export class ReverseIndex {
  /** Length of the new text (valid query range is `[0, length]`). */
  readonly length: number;

  private readonly segments: readonly Segment[];
  private readonly emptyFallback: ReverseMapping;

  /** @internal Built by {@link transform}; not meant to be constructed directly. */
  constructor(
    segments: readonly Segment[],
    length: number,
    emptyFallback: ReverseMapping,
  ) {
    this.segments = segments;
    this.length = length;
    this.emptyFallback = emptyFallback;
  }

  /**
   * Map a new-text offset back to the original text.
   *
   * - Inside kept text: `{ type: 'exact', offset }` with the exact
   *   original offset.
   * - Inside inserted text: `{ type: 'inserted', left, right }` with the
   *   original offsets bounding the edit, instead of a fabricated single
   *   coordinate.
   *
   * @throws {TransformError} with code `'OUT_OF_BOUNDS'` for positions
   *         outside `[0, length]`.
   */
  query(position: number): ReverseMapping {
    if (!Number.isInteger(position) || position < 0 || position > this.length) {
      throw new TransformError(
        'OUT_OF_BOUNDS',
        `reverse query position ${position} is not an integer in [0, ${this.length}]`,
      );
    }
    const segments = this.segments;
    if (segments.length === 0) {
      // The new text is empty: either the original was empty too, or it
      // was entirely replaced by empty text.
      return this.emptyFallback;
    }
    // First segment whose newEnd is strictly past `position`. For
    // position === length no segment qualifies and the last one is used.
    let lo = 0;
    let hi = segments.length - 1;
    let index = segments.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (segments[mid]!.newEnd > position) {
        index = mid;
        hi = mid - 1;
      } else {
        lo = mid + 1;
      }
    }
    const segment = segments[index]!;
    if (segment.kind === 'kept') {
      return { type: 'exact', offset: segment.origStart + (position - segment.newStart) };
    }
    return { type: 'inserted', left: segment.origStart, right: segment.origEnd };
  }

  /**
   * Batch version of {@link query}: returns one mapping per input
   * position, aligned by index.
   */
  queryMany(positions: readonly number[]): ReverseMapping[] {
    return positions.map((position) => this.query(position));
  }
}
