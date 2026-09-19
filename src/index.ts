export { TransformError, type TransformErrorCode } from './errors.js';
export { ReverseIndex, type KeptSegment, type InsertedSegment, type Segment } from './reverse.js';
export { transform } from './transform.js';
export {
  type Affinity,
  type Anchor,
  type MappedAnchor,
  type MappedAnchorOf,
  type MappedPoint,
  type MappedRange,
  type PointAnchor,
  type RangeAnchor,
  type Replacement,
  type ReverseExact,
  type ReverseInserted,
  type ReverseMapping,
  type TransformResult,
} from './types.js';
export { splitsSurrogatePair, validateAnchors, validateReplacements } from './validate.js';
