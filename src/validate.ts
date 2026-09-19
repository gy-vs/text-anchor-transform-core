import { TransformError } from './errors.js';
import type { Anchor, Replacement } from './types.js';

const isHighSurrogate = (code: number): boolean => code >= 0xd800 && code <= 0xdbff;
const isLowSurrogate = (code: number): boolean => code >= 0xdc00 && code <= 0xdfff;

/**
 * True when `offset` falls between the high and low half of a surrogate
 * pair in `text`. All offsets are UTF-16 code-unit indices.
 */
export function splitsSurrogatePair(text: string, offset: number): boolean {
  return (
    offset > 0 &&
    offset < text.length &&
    isHighSurrogate(text.charCodeAt(offset - 1)) &&
    isLowSurrogate(text.charCodeAt(offset))
  );
}

/**
 * Validate a batch of replacements against the original text:
 * integer in-bounds offsets, sorted by ascending `start`, non-overlapping
 * (`next.start >= prev.end`; adjacent and same-point edits are allowed),
 * and no edit boundary may split a surrogate pair.
 *
 * @throws {TransformError} with the appropriate `code`.
 */
export function validateReplacements(
  original: string,
  replacements: readonly Replacement[],
): void {
  let prevStart = -1;
  let prevEnd = -1;

  replacements.forEach((r, index) => {
    if (r === null || typeof r !== 'object') {
      throw new TransformError('INVALID_EDIT', `replacement #${index} is not an object`);
    }
    const { start, end, text } = r;
    if (!Number.isInteger(start) || !Number.isInteger(end) || typeof text !== 'string') {
      throw new TransformError(
        'INVALID_EDIT',
        `replacement #${index} must have integer start/end and string text`,
      );
    }
    if (start < 0 || end < start || end > original.length) {
      throw new TransformError(
        'OUT_OF_BOUNDS',
        `replacement #${index} [${start}, ${end}) is out of bounds for text of length ${original.length}`,
      );
    }
    if (index > 0) {
      if (start < prevStart) {
        throw new TransformError(
          'NOT_SORTED',
          `replacement #${index} starts at ${start}, before the previous start ${prevStart}; ` +
            'replacements must be sorted by ascending start (all in original coordinates)',
        );
      }
      if (start < prevEnd) {
        throw new TransformError(
          'OVERLAP',
          `replacement #${index} [${start}, ${end}) overlaps the previous replacement ` +
            `[${prevStart}, ${prevEnd})`,
        );
      }
    }
    if (splitsSurrogatePair(original, start) || splitsSurrogatePair(original, end)) {
      throw new TransformError(
        'SURROGATE_SPLIT',
        `replacement #${index} [${start}, ${end}) splits a surrogate pair`,
      );
    }
    prevStart = start;
    prevEnd = end;
  });
}

/** Validate anchors against the original text. @throws {TransformError} */
export function validateAnchors(original: string, anchors: readonly Anchor[]): void {
  anchors.forEach((a, index) => {
    const checkOffset = (offset: number, label: string): void => {
      if (!Number.isInteger(offset) || offset < 0 || offset > original.length) {
        throw new TransformError(
          'INVALID_ANCHOR',
          `anchor #${index} ${label} ${offset} is not an integer in [0, ${original.length}]`,
        );
      }
      if (splitsSurrogatePair(original, offset)) {
        throw new TransformError(
          'SURROGATE_SPLIT',
          `anchor #${index} ${label} ${offset} splits a surrogate pair`,
        );
      }
    };
    const checkAffinity = (affinity: string, label: string): void => {
      if (affinity !== 'left' && affinity !== 'right') {
        throw new TransformError(
          'INVALID_ANCHOR',
          `anchor #${index} ${label} must be 'left' or 'right', got ${JSON.stringify(affinity)}`,
        );
      }
    };

    if (a !== null && typeof a === 'object' && a.kind === 'point') {
      checkOffset(a.offset, 'offset');
      checkAffinity(a.affinity, 'affinity');
    } else if (a !== null && typeof a === 'object' && a.kind === 'range') {
      checkOffset(a.start, 'start');
      checkOffset(a.end, 'end');
      if (a.start > a.end) {
        throw new TransformError(
          'INVALID_ANCHOR',
          `anchor #${index} range [${a.start}, ${a.end}) has start > end`,
        );
      }
      checkAffinity(a.startAffinity, 'startAffinity');
      checkAffinity(a.endAffinity, 'endAffinity');
    } else {
      throw new TransformError(
        'INVALID_ANCHOR',
        `anchor #${index} must have kind 'point' or 'range'`,
      );
    }
  });
}
