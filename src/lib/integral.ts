import { create, all, type EvalFunction, type MathJsInstance, type MathNode } from 'mathjs';
import type {
  BoundOrder,
  BoundingBox,
  ParsedIntegral,
  Point3,
  RegionSample,
  SliceSummary,
  SwitchedBoundsEstimate,
  Variable,
  IntegralInput,
} from '../types';
import { areValidVariables, coordinateJacobian, fromCartesian, jacobianLabel, toCartesian } from './coordinates';
import { normalizeExpressionAliases } from './expressionAliases';
import { allOrdersForVariables, orderToInnerOuter, orderToOuterInner } from './orders';

const math = create(all, {}) as MathJsInstance;
const ALLOWED_NON_VARIABLE_SYMBOLS = new Set(['e', 'E', 'i', 'Infinity', 'NaN', 'pi', 'PI', 'tau']);

type Scope = Partial<Record<Variable, number>>;

export function parseIntegral(input: IntegralInput): ParsedIntegral {
  const validationErrors: string[] = [];
  const orderInnerToOuter = orderToInnerOuter(input.selectedOrder);
  const orderOuterToInner = orderToOuterInner(input.selectedOrder);
  const compiledBounds: ParsedIntegral['bounds'] = {};
  let integrand: ParsedIntegral['integrand'];

  if (!areValidVariables(input.variables)) {
    validationErrors.push('Variables must be three unique names using letters, numbers, and underscores.');
  }

  try {
    const node = math.parse(normalizeExpression(input.integrand, input)) as MathNode;
    const unknown = unknownSymbols(node, input.variables);
    if (unknown.length) {
      validationErrors.push(`Integrand has unknown symbol(s): ${unknown.join(', ')}.`);
    }
    integrand = node.compile();
  } catch (error) {
    validationErrors.push(`Integrand could not be parsed: ${messageFrom(error)}.`);
  }

  for (const variable of input.variables) {
    const bound = input.bounds[variable];
    const compiled: Partial<{ lower: EvalFunction; upper: EvalFunction }> = {};
    for (const side of ['lower', 'upper'] as const) {
      try {
        const node = math.parse(normalizeExpression(bound[side], input)) as MathNode;
        const unknown = unknownSymbols(node, input.variables);
        if (unknown.length) {
          validationErrors.push(`${variable} ${side} bound has unknown symbol(s): ${unknown.join(', ')}.`);
        }
        const deps = variableDependencies(node, input.variables);
        const allowed = allowedDependencies(variable, orderOuterToInner);
        const illegal = deps.filter((dep) => !allowed.includes(dep));
        if (illegal.length) {
          validationErrors.push(
            `${variable} ${side} bound depends on ${illegal.join(', ')}, but only outer variable(s) ${allowed.join(', ') || 'none'} are allowed for ${input.selectedOrder}.`,
          );
        }
        compiled[side] = node.compile();
      } catch (error) {
        validationErrors.push(`${variable} ${side} bound could not be parsed: ${messageFrom(error)}.`);
      }
    }
    if (compiled.lower && compiled.upper) {
      compiledBounds[variable] = { lower: compiled.lower, upper: compiled.upper };
    }
  }

  return {
    input,
    orderInnerToOuter,
    orderOuterToInner,
    integrand,
    bounds: compiledBounds,
    validationErrors,
  };
}

export function sampleRegion(parsed: ParsedIntegral, sampleBudget = 7000): RegionSample {
  if (parsed.validationErrors.length || !parsed.integrand) {
    return emptySample(parsed.input, parsed.validationErrors);
  }

  const rng = seededRandom(8191);
  const nested = sampleNested(parsed, sampleBudget, rng);
  const bbox = boundingBoxFor(nested.points);
  const coordinateBoundingBox = coordinateBoundingBoxFor(nested.coordinatePoints, parsed.input.variables);
  const warnings = [...nested.warnings];

  if (nested.points.length < 80) {
    warnings.push('The sampled region is sparse. Bound switching and surfaces may be noisy.');
  }

  const spread = bboxVolume(bbox);
  if (!Number.isFinite(spread) || spread <= 0) {
    warnings.push('The bounding box collapsed in at least one direction.');
  }

  const quality = nested.points.length > 1000 && warnings.length === 0 ? 'high' : nested.points.length > 250 ? 'medium' : 'low';

  return {
    points: nested.points,
    coordinatePoints: nested.coordinatePoints,
    insideFlags: nested.points.map(() => true),
    boundingBox: bbox,
    coordinateBoundingBox,
    coordinateSystem: parsed.input.coordinateSystem,
    variables: parsed.input.variables,
    jacobianLabel: jacobianLabel(parsed.input.coordinateSystem, parsed.input.variables),
    estimatedVolume: nested.volume,
    integralEstimate: nested.integral,
    confidenceRadius: nested.confidenceRadius,
    sampleCount: sampleBudget,
    insideCount: nested.points.length,
    quality,
    warnings,
  };
}

export function estimateSwitchedBounds(sample: RegionSample, order: BoundOrder): SwitchedBoundsEstimate {
  const variables = orderToOuterInner(order);
  const points = sample.coordinatePoints;
  const warnings: string[] = [];
  const perVariableRanges: SwitchedBoundsEstimate['perVariableRanges'] = Object.fromEntries(sample.variables.map((variable) => [variable, null]));

  for (const variable of sample.variables) {
    const values = points.map((point) => point[variable]).filter(Number.isFinite).sort((a, b) => a - b);
    perVariableRanges[variable] = robustRange(values);
  }

  if (points.length < 250) warnings.push('Too few points for stable switched bounds.');
  if (looksDisconnected(points, variables[0])) {
    warnings.push(`Projection along ${variables[0]} appears to have gaps, so a single interval can hide disconnected pieces.`);
  }

  const sliceSummaries: SliceSummary[] = [];
  const outer = variables[0];
  const middle = variables[1];
  const inner = variables[2];
  const outerRange = perVariableRanges[outer];
  const middleRange = perVariableRanges[middle];

  if (outerRange) {
    for (const at of linspace(outerRange[0], outerRange[1], 5)) {
      const width = Math.max((outerRange[1] - outerRange[0]) / 18, 0.04);
      const near = points.filter((point) => Math.abs(point[outer] - at) <= width);
      const middleValues = near.map((point) => point[middle]).sort((a, b) => a - b);
      const range = robustRange(middleValues);
      if (range) sliceSummaries.push({ variable: middle, at, min: range[0], max: range[1], sampleCount: near.length });
    }
  }

  if (middleRange) {
    const at = (middleRange[0] + middleRange[1]) / 2;
    const width = Math.max((middleRange[1] - middleRange[0]) / 12, 0.04);
    const near = points.filter((point) => Math.abs(point[middle] - at) <= width);
    const innerValues = near.map((point) => point[inner]).sort((a, b) => a - b);
    const range = robustRange(innerValues);
    if (range) sliceSummaries.push({ variable: inner, at, min: range[0], max: range[1], sampleCount: near.length });
  }

  const qualityScore = clamp((points.length / 1800) * (warnings.length ? 0.62 : 1), 0.1, 0.98);

  return {
    order,
    perVariableRanges,
    sliceSummaries,
    warnings,
    qualityScore,
  };
}

export function membership(parsed: ParsedIntegral, point: Point3): boolean {
  if (parsed.validationErrors.length) return false;
  const pointScope = fromCartesian(parsed.input.coordinateSystem, parsed.input.variables, point);
  const scope: Scope = {};
  for (const variable of parsed.orderOuterToInner) {
    const compiled = parsed.bounds[variable];
    if (!compiled) return false;
    const lower = evaluate(compiled.lower, scope);
    const upper = evaluate(compiled.upper, scope);
    const value = pointScope[variable];
    if (!finiteRange(lower, upper) || value < lower - 1e-8 || value > upper + 1e-8) return false;
    scope[variable] = value;
  }
  return true;
}

function sampleNested(parsed: ParsedIntegral, sampleBudget: number, rng: () => number) {
  const points: Point3[] = [];
  const coordinatePoints: Array<Record<Variable, number>> = [];
  const weightedIntegrands: number[] = [];
  const weightedVolumes: number[] = [];
  const warnings: string[] = [];
  let invalidIntervals = 0;

  for (let i = 0; i < sampleBudget; i += 1) {
    const scope: Scope = {};
    let intervalVolume = 1;
    let valid = true;

    for (const variable of parsed.orderOuterToInner) {
      const compiled = parsed.bounds[variable];
      if (!compiled) {
        valid = false;
        break;
      }
      const lower = evaluate(compiled.lower, scope);
      const upper = evaluate(compiled.upper, scope);
      if (!finiteRange(lower, upper)) {
        invalidIntervals += 1;
        valid = false;
        break;
      }
      intervalVolume *= upper - lower;
      scope[variable] = lower + rng() * (upper - lower);
    }

    if (!valid) {
      weightedVolumes.push(0);
      weightedIntegrands.push(0);
      continue;
    }

    const coordinateScope = Object.fromEntries(parsed.input.variables.map((variable) => [variable, scope[variable] ?? 0])) as Record<Variable, number>;
    const transformJacobian = coordinateJacobian(parsed.input.coordinateSystem, parsed.input.variables, coordinateScope);
    const jacobian = intervalVolume * transformJacobian;
    const point = toCartesian(parsed.input.coordinateSystem, parsed.input.variables, coordinateScope);
    points.push(point);
    coordinatePoints.push(coordinateScope);
    const f = evaluate(parsed.integrand!, scope);
    const contribution = Number.isFinite(f) ? f * jacobian : 0;
    weightedVolumes.push(jacobian);
    weightedIntegrands.push(contribution);
  }

  if (invalidIntervals > sampleBudget * 0.05) {
    warnings.push('Some sampled bound intervals were invalid or reversed.');
  }

  return {
    points,
    coordinatePoints,
    volume: mean(weightedVolumes),
    integral: mean(weightedIntegrands),
    confidenceRadius: 1.96 * stddev(weightedIntegrands) / Math.sqrt(Math.max(weightedIntegrands.length, 1)),
    warnings,
  };
}

function emptySample(input: IntegralInput, warnings: string[]): RegionSample {
  const coordinateBoundingBox = Object.fromEntries(input.variables.map((variable) => [variable, [0, 1] as [number, number]]));
  return {
    points: [],
    coordinatePoints: [],
    insideFlags: [],
    boundingBox: { x: [0, 1], y: [0, 1], z: [0, 1] },
    coordinateBoundingBox,
    coordinateSystem: input.coordinateSystem,
    variables: input.variables,
    jacobianLabel: jacobianLabel(input.coordinateSystem, input.variables),
    estimatedVolume: 0,
    integralEstimate: 0,
    confidenceRadius: 0,
    sampleCount: 0,
    insideCount: 0,
    quality: 'low',
    warnings,
  };
}

function evaluate(compiled: { evaluate: (scope?: object) => unknown }, scope: Scope): number {
  const value = compiled.evaluate(scope);
  return typeof value === 'number' ? value : Number(value);
}

function normalizeExpression(expression: string, input: IntegralInput): string {
  return normalizeExpressionAliases(expression, input.coordinateSystem, input.variables);
}

function unknownSymbols(node: MathNode, variables: Variable[]): string[] {
  const symbols = new Set<string>();
  node.traverse((child: MathNode) => {
    const symbol = child as MathNode & { isSymbolNode?: boolean; name?: string };
    if (symbol.isSymbolNode && symbol.name) {
      const name = symbol.name;
      const isVariable = variables.includes(name as Variable);
      const isKnown = ALLOWED_NON_VARIABLE_SYMBOLS.has(name) || typeof (math as unknown as Record<string, unknown>)[name] !== 'undefined';
      if (!isVariable && !isKnown) symbols.add(name);
    }
  });
  return [...symbols];
}

function variableDependencies(node: MathNode, variables: Variable[]): Variable[] {
  const deps = new Set<Variable>();
  node.traverse((child: MathNode) => {
    const symbol = child as MathNode & { isSymbolNode?: boolean; name?: string };
    if (symbol.isSymbolNode && symbol.name && variables.includes(symbol.name as Variable)) deps.add(symbol.name as Variable);
  });
  return [...deps];
}

function allowedDependencies(variable: Variable, outerToInner: Variable[]): Variable[] {
  const index = outerToInner.indexOf(variable);
  return index <= 0 ? [] : outerToInner.slice(0, index);
}

function boundingBoxFor(points: Point3[]): BoundingBox {
  if (!points.length) return { x: [0, 1], y: [0, 1], z: [0, 1] };
  return {
    x: paddedRange(points.map((point) => point.x)),
    y: paddedRange(points.map((point) => point.y)),
    z: paddedRange(points.map((point) => point.z)),
  };
}

function paddedRange(values: number[]): [number, number] {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min;
  const pad = span > 1e-9 ? span * 0.08 : 0.5;
  return [min - pad, max + pad];
}

function robustRange(values: number[]): [number, number] | null {
  if (values.length < 8) return null;
  const low = values[Math.floor(values.length * 0.02)];
  const high = values[Math.ceil(values.length * 0.98) - 1];
  return Number.isFinite(low) && Number.isFinite(high) ? [low, high] : null;
}

function finiteRange(lower: number, upper: number): boolean {
  return Number.isFinite(lower) && Number.isFinite(upper) && upper >= lower;
}

function bboxVolume(bbox: BoundingBox): number {
  return (bbox.x[1] - bbox.x[0]) * (bbox.y[1] - bbox.y[0]) * (bbox.z[1] - bbox.z[0]);
}

function coordinateBoundingBoxFor(points: Array<Record<Variable, number>>, variables: Variable[]): Record<Variable, [number, number]> {
  if (!points.length) return Object.fromEntries(variables.map((variable) => [variable, [0, 1] as [number, number]]));
  return Object.fromEntries(variables.map((variable) => [variable, paddedRange(points.map((point) => point[variable]))]));
}

function looksDisconnected(points: Array<Record<Variable, number>>, variable: Variable): boolean {
  if (points.length < 300) return false;
  const values = points.map((point) => point[variable]).sort((a, b) => a - b);
  const range = values[values.length - 1] - values[0];
  if (range <= 0) return false;
  const bucketCount = 24;
  const buckets = new Array(bucketCount).fill(0);
  for (const value of values) {
    const index = Math.min(bucketCount - 1, Math.floor(((value - values[0]) / range) * bucketCount));
    buckets[index] += 1;
  }
  const threshold = points.length / bucketCount / 16;
  return buckets.slice(2, -2).some((count) => count <= threshold);
}

function linspace(start: number, end: number, count: number): number[] {
  if (count === 1) return [start];
  return Array.from({ length: count }, (_, index) => start + ((end - start) * index) / (count - 1));
}

function mean(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stddev(values: number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const variance = mean(values.map((value) => (value - avg) ** 2));
  return Math.sqrt(variance);
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function estimateAllOrders(sample: RegionSample): SwitchedBoundsEstimate[] {
  return allOrdersForVariables(sample.variables).map((order) => estimateSwitchedBounds(sample, order));
}
