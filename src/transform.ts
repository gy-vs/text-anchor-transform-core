import { ReverseIndex, type Segment } from './reverse.js';
import type {
  Affinity,
  Anchor,
  MappedAnchorOf,
  Replacement,
  ReverseMapping,
  TransformResult,
} from './types.js';
import { validateAnchors, validateReplacements } from './validate.js';

/** A replacement preprocessed for mapping: same coordinates plus its length delta. */
interface Edit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
  /** `text.length - (end - start)` — how much this edit shifts later offsets. */
  readonly delta: number;
}

/**
 * Map one original offset through the edits.
 *
 * Edits touching the offset (`start <= offset <= end`) form a consecutive
 * group with the shape:
 *
 *   [deletion ending at offset]? [insertions at offset]* [deletion starting at offset]?
 *
 * (an edit strictly containing the offset is always alone in its group).
 *
 * - Left affinity lands on the left edge of that group: after a deletion
 *   ending exactly at the offset if present (the natural position of the
 *   kept character there), otherwise before all inserted/replacement text.
 * - Right affinity lands on the right edge: after the replacement text of
 *   a containing/starting deletion, else after the last insertion at the
 *   offset, else the same as left.
 *
 * An offset strictly inside a deleted span (or at the start of one) is
 * collapsed to the corresponding end of the replacement text.
 */
function mapPoint(edits: readonly Edit[], offset: number, affinity: Affinity): number {
  // Edits fully before the offset only contribute their length delta.
  let delta = 0;
  let i = 0;
  while (i < edits.length && edits[i]!.end < offset) {
    delta += edits[i]!.delta;
    i++;
  }
  if (i === edits.length || edits[i]!.start > offset) {
    return offset + delta;
  }

  // Collect the group of edits touching the offset.
  let j = i;
  while (j < edits.length && edits[j]!.start <= offset) {
    j++;
  }

  let groupDelta = 0;
  let firstNewStart = -1;
  let deletionEndingRight = -1; // right edge of a deletion ending exactly at offset
  let insertionRight = -1; // right edge of the last insertion at offset
  let collapseRight = -1; // right edge of a deletion containing/starting at offset
  for (let k = i; k < j; k++) {
    const edit = edits[k]!;
    const newStart = edit.start + delta + groupDelta;
    const newEnd = newStart + edit.text.length;
    if (firstNewStart < 0) {
      firstNewStart = newStart;
    }
    if (edit.start < offset) {
      if (offset < edit.end) {
        collapseRight = newEnd; // strictly inside the deleted span
      } else {
        deletionEndingRight = newEnd; // edit.end === offset
      }
    } else if (edit.end === offset) {
      insertionRight = newEnd; // pure insertion at the offset
    } else {
      collapseRight = newEnd; // edit.start === offset, deletion starting here
    }
    groupDelta += edit.delta;
  }

  const left = deletionEndingRight >= 0 ? deletionEndingRight : firstNewStart;
  const right =
    collapseRight >= 0 ? collapseRight : insertionRight >= 0 ? insertionRight : left;
  return affinity === 'left' ? left : right;
}

/** Build the new text and the kept/inserted segments in one pass. */
function applyEdits(
  original: string,
  edits: readonly Edit[],
): { text: string; segments: Segment[] } {
  const parts: string[] = [];
  const segments: Segment[] = [];
  let origCursor = 0;
  let newCursor = 0;

  for (const edit of edits) {
    if (edit.start > origCursor) {
      parts.push(original.slice(origCursor, edit.start));
      segments.push({
        kind: 'kept',
        newStart: newCursor,
        newEnd: newCursor + (edit.start - origCursor),
        origStart: origCursor,
        origEnd: edit.start,
      });
      newCursor += edit.start - origCursor;
    }
    if (edit.text.length > 0) {
      parts.push(edit.text);
      segments.push({
        kind: 'inserted',
        newStart: newCursor,
        newEnd: newCursor + edit.text.length,
        origStart: edit.start,
        origEnd: edit.end,
      });
      newCursor += edit.text.length;
    }
    origCursor = edit.end;
  }
  if (origCursor < original.length) {
    parts.push(original.slice(origCursor));
    segments.push({
      kind: 'kept',
      newStart: newCursor,
      newEnd: newCursor + (original.length - origCursor),
      origStart: origCursor,
      origEnd: original.length,
    });
  }
  return { text: parts.join(''), segments };
}

/**
 * Apply a batch of replacements — all expressed in the coordinates of
 * `original` — and map every anchor into the new text.
 *
 * The replacements are validated first (sorted, in bounds, non-overlapping,
 * surrogate-safe) and applied as a single batch; offsets are never
 * reinterpreted against intermediate text.
 *
 * @returns the new text, the mapped anchors (aligned by index), and a
 *          {@link ReverseIndex} for new-to-original queries.
 * @throws {TransformError} on invalid replacements or anchors.
 */
export function transform<A extends Anchor>(
  original: string,
  replacements: readonly Replacement[],
  anchors: readonly A[] = [],
): TransformResult<A> {
  validateReplacements(original, replacements);
  validateAnchors(original, anchors);

  const edits: Edit[] = replacements.map((r) => ({
    start: r.start,
    end: r.end,
    text: r.text,
    delta: r.text.length - (r.end - r.start),
  }));

  const { text, segments } = applyEdits(original, edits);

  const mapped = anchors.map((anchor): MappedAnchorOf<A> => {
    if (anchor.kind === 'point') {
      return {
        kind: 'point',
        offset: mapPoint(edits, anchor.offset, anchor.affinity),
      } as MappedAnchorOf<A>;
    }
    const start = mapPoint(edits, anchor.start, anchor.startAffinity);
    const end = mapPoint(edits, anchor.end, anchor.endAffinity);
    // Each endpoint keeps its own affinity; if they cross, normalize so
    // the range never runs backwards.
    return {
      kind: 'range',
      start: Math.min(start, end),
      end: Math.max(start, end),
    } as MappedAnchorOf<A>;
  });

  const emptyFallback: ReverseMapping =
    edits.length > 0
      ? { type: 'inserted', left: edits[0]!.start, right: edits[edits.length - 1]!.end }
      : { type: 'exact', offset: 0 };

  return {
    text,
    anchors: mapped,
    reverse: new ReverseIndex(segments, text.length, emptyFallback),
  };
}
