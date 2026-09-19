/**
 * Error thrown for invalid edits, anchors, or query positions.
 * The `code` field is stable and safe to switch on programmatically.
 */
export type TransformErrorCode =
  /** Malformed replacement (non-integer offsets, non-string text, ...). */
  | 'INVALID_EDIT'
  /** Replacements are not sorted by ascending `start`. */
  | 'NOT_SORTED'
  /** Two replacements overlap in original coordinates. */
  | 'OVERLAP'
  /** An offset lies outside the valid range of its text. */
  | 'OUT_OF_BOUNDS'
  /** An edit boundary or anchor would split a UTF-16 surrogate pair. */
  | 'SURROGATE_SPLIT'
  /** Malformed anchor (bad kind, affinity, or range). */
  | 'INVALID_ANCHOR';

export class TransformError extends Error {
  readonly code: TransformErrorCode;

  constructor(code: TransformErrorCode, message: string) {
    super(message);
    this.name = 'TransformError';
    this.code = code;
  }
}
