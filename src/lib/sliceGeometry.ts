import type { ParsedIntegral, Point3, Variable } from '../types';
import { toCartesian } from './coordinates';

export interface CoordinateSliceGeometry {
  positions: number[];
  indices: number[];
  start: number;
  end: number;
}

interface SliceGeometryOptions {
  sliceVariable: Variable;
  sliceCount: number;
  visibleSliceCount: number;
  showAllSlices: boolean;
  resolution?: number;
}

const DEFAULT_RESOLUTION = 34;
const EPSILON = 1e-9;

type Scope = Partial<Record<Variable, number>>;

export function buildCoordinateSliceGeometries(parsed: ParsedIntegral, options: SliceGeometryOptions): CoordinateSliceGeometry[] {
  if (parsed.validationErrors.length) return [];
  const [outer, middle, inner] = parsed.orderOuterToInner;
  if (!outer || !middle || !inner || options.sliceVariable !== inner) return [];

  const resolution = Math.max(4, Math.floor(options.resolution ?? DEFAULT_RESOLUTION));
  const range = estimateInnerVariableRange(parsed, outer, middle, inner, resolution);
  if (!range) return [];

  const [rangeStart, rangeEnd] = range;
  const span = rangeEnd - rangeStart;
  if (!Number.isFinite(span) || span <= EPSILON) return [];

  const sliceCount = Math.max(1, Math.floor(options.sliceCount));
  const visibleCount = options.showAllSlices ? Math.min(Math.max(1, Math.floor(options.visibleSliceCount)), sliceCount) : 1;

  const geometries: CoordinateSliceGeometry[] = [];
  for (let index = 0; index < visibleCount; index += 1) {
    const start = rangeStart + (span * index) / sliceCount;
    const end = rangeStart + (span * (index + 1)) / sliceCount;
    const geometry = buildInnerSliceGeometry(parsed, outer, middle, inner, start, end, resolution);
    if (geometry.indices.length) geometries.push(geometry);
  }
  return geometries;
}

function estimateInnerVariableRange(
  parsed: ParsedIntegral,
  outer: Variable,
  middle: Variable,
  inner: Variable,
  resolution: number,
): [number, number] | null {
  const outerBounds = evaluateBounds(parsed, outer, {});
  if (!outerBounds) return null;

  let min = Infinity;
  let max = -Infinity;
  for (let outerIndex = 0; outerIndex <= resolution; outerIndex += 1) {
    const outerValue = interpolate(outerBounds, outerIndex / resolution);
    const outerScope: Scope = { [outer]: outerValue };
    const middleBounds = evaluateBounds(parsed, middle, outerScope);
    if (!middleBounds) continue;

    for (let middleIndex = 0; middleIndex <= resolution; middleIndex += 1) {
      const middleValue = interpolate(middleBounds, middleIndex / resolution);
      const scope: Scope = { ...outerScope, [middle]: middleValue };
      const innerBounds = evaluateBounds(parsed, inner, scope);
      if (!innerBounds) continue;
      min = Math.min(min, innerBounds[0]);
      max = Math.max(max, innerBounds[1]);
    }
  }

  return Number.isFinite(min) && Number.isFinite(max) && max > min ? [min, max] : null;
}

function buildInnerSliceGeometry(
  parsed: ParsedIntegral,
  outer: Variable,
  middle: Variable,
  inner: Variable,
  start: number,
  end: number,
  resolution: number,
): CoordinateSliceGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  const outerBounds = evaluateBounds(parsed, outer, {});
  if (!outerBounds) return { positions, indices, start, end };

  for (let outerIndex = 0; outerIndex < resolution; outerIndex += 1) {
    const outerMix0 = outerIndex / resolution;
    const outerMix1 = (outerIndex + 1) / resolution;

    for (let middleIndex = 0; middleIndex < resolution; middleIndex += 1) {
      const middleMix0 = middleIndex / resolution;
      const middleMix1 = (middleIndex + 1) / resolution;
      const corners = [
        coordinateCorner(parsed, outer, middle, inner, outerBounds, outerMix0, middleMix0, start, end),
        coordinateCorner(parsed, outer, middle, inner, outerBounds, outerMix1, middleMix0, start, end),
        coordinateCorner(parsed, outer, middle, inner, outerBounds, outerMix1, middleMix1, start, end),
        coordinateCorner(parsed, outer, middle, inner, outerBounds, outerMix0, middleMix1, start, end),
      ];

      if (corners.some((corner) => !corner)) continue;
      pushHexCell(positions, indices, corners as [SliceCorner, SliceCorner, SliceCorner, SliceCorner]);
    }
  }

  return { positions, indices, start, end };
}

interface SliceCorner {
  low: Point3;
  high: Point3;
}

function coordinateCorner(
  parsed: ParsedIntegral,
  outer: Variable,
  middle: Variable,
  inner: Variable,
  outerBounds: [number, number],
  outerMix: number,
  middleMix: number,
  sliceStart: number,
  sliceEnd: number,
): SliceCorner | null {
  const outerValue = interpolate(outerBounds, outerMix);
  const outerScope: Scope = { [outer]: outerValue };
  const middleBounds = evaluateBounds(parsed, middle, outerScope);
  if (!middleBounds) return null;

  const middleValue = interpolate(middleBounds, middleMix);
  const baseScope: Scope = { ...outerScope, [middle]: middleValue };
  const innerBounds = evaluateBounds(parsed, inner, baseScope);
  if (!innerBounds) return null;

  const lowValue = Math.max(innerBounds[0], sliceStart);
  const highValue = Math.min(innerBounds[1], sliceEnd);
  if (!Number.isFinite(lowValue) || !Number.isFinite(highValue) || highValue <= lowValue + EPSILON) return null;

  const lowScope = { ...baseScope, [inner]: lowValue } as Record<Variable, number>;
  const highScope = { ...baseScope, [inner]: highValue } as Record<Variable, number>;
  return {
    low: toCartesian(parsed.input.coordinateSystem, parsed.input.variables, lowScope),
    high: toCartesian(parsed.input.coordinateSystem, parsed.input.variables, highScope),
  };
}

function pushHexCell(positions: number[], indices: number[], corners: [SliceCorner, SliceCorner, SliceCorner, SliceCorner]) {
  const points = [corners[0].low, corners[1].low, corners[2].low, corners[3].low, corners[0].high, corners[1].high, corners[2].high, corners[3].high];

  pushFace(positions, indices, [points[0], points[1], points[2], points[3]]);
  pushFace(positions, indices, [points[4], points[7], points[6], points[5]]);
  pushFace(positions, indices, [points[0], points[4], points[5], points[1]]);
  pushFace(positions, indices, [points[1], points[5], points[6], points[2]]);
  pushFace(positions, indices, [points[2], points[6], points[7], points[3]]);
  pushFace(positions, indices, [points[3], points[7], points[4], points[0]]);
}

function pushFace(positions: number[], indices: number[], points: Point3[]) {
  const vertexStart = positions.length / 3;
  for (const point of points) {
    positions.push(point.x, point.y, point.z);
  }
  indices.push(vertexStart, vertexStart + 1, vertexStart + 2, vertexStart, vertexStart + 2, vertexStart + 3);
}

function evaluateBounds(parsed: ParsedIntegral, variable: Variable, scope: Scope): [number, number] | null {
  const compiled = parsed.bounds[variable];
  if (!compiled) return null;
  const lower = evaluate(compiled.lower, scope);
  const upper = evaluate(compiled.upper, scope);
  if (!Number.isFinite(lower) || !Number.isFinite(upper) || upper < lower) return null;
  return [lower, upper];
}

function evaluate(compiled: { evaluate: (scope?: object) => unknown }, scope: Scope): number {
  try {
    const value = compiled.evaluate(scope);
    return typeof value === 'number' ? value : Number(value);
  } catch {
    return NaN;
  }
}

function interpolate(range: [number, number], mix: number) {
  return range[0] + (range[1] - range[0]) * mix;
}
