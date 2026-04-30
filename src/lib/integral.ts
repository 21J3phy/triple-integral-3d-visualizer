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
type Exponents = [number, number, number];
type Polynomial = Map<string, ExactScalar>;

export interface ExactIntegralResult {
  fraction: string;
  decimal: number;
}

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

export function solveIntegralExactly(parsed: ParsedIntegral): ExactIntegralResult | null {
  if (parsed.validationErrors.length) return null;

  const variables = parsed.input.variables;
  let polynomial = parsePolynomial(parsed.input.integrand, parsed.input, variables);
  if (!polynomial) return null;

  let sineJacobianVariable: number | null = null;
  if (parsed.input.coordinateSystem === 'cylindrical') {
    polynomial = multiplyPolynomials(polynomial, variablePolynomial(variables.indexOf(variables[0])));
  } else if (parsed.input.coordinateSystem === 'spherical') {
    const radiusIndex = variables.indexOf(variables[0]);
    sineJacobianVariable = variables.indexOf(variables[2]);
    polynomial = multiplyPolynomials(polynomial, powerPolynomial(variablePolynomial(radiusIndex), 2));
  }

  for (const variable of parsed.orderInnerToOuter) {
    const variableIndex = variables.indexOf(variable);
    const bounds = parsed.input.bounds[variable];
    const lower = parsePolynomial(bounds.lower, parsed.input, variables);
    const upper = parsePolynomial(bounds.upper, parsed.input, variables);
    if (!lower || !upper) return null;

    if (variableIndex === sineJacobianVariable) {
      const sineIntegral = integrateSineJacobian(lower, upper);
      if (!sineIntegral || polynomialDependsOn(polynomial, variableIndex)) return null;
      polynomial = multiplyPolynomialByScalar(polynomial, sineIntegral);
      continue;
    }

    const antiderivative = integratePolynomial(polynomial, variableIndex);
    polynomial = subtractPolynomials(
      evaluatePolynomialAt(antiderivative, variableIndex, upper),
      evaluatePolynomialAt(antiderivative, variableIndex, lower),
    );
  }

  const value = constantTerm(polynomial);
  if (!value) return null;
  return {
    fraction: value.toString(),
    decimal: value.toNumber(),
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

    if (Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z)) {
      points.push(point);
      coordinatePoints.push(coordinateScope);
      const f = evaluate(parsed.integrand!, scope);
      const contribution = Number.isFinite(f) ? f * jacobian : 0;
      weightedVolumes.push(jacobian);
      weightedIntegrands.push(contribution);
    } else {
      weightedVolumes.push(0);
      weightedIntegrands.push(0);
    }
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
  try {
    const value = compiled.evaluate(scope);
    return typeof value === 'number' ? value : Number(value);
  } catch {
    return NaN;
  }
}

class Fraction {
  private constructor(
    readonly numerator: bigint,
    readonly denominator: bigint,
  ) {}

  static zero() {
    return new Fraction(0n, 1n);
  }

  static one() {
    return new Fraction(1n, 1n);
  }

  static fromInteger(value: number) {
    return new Fraction(BigInt(value), 1n);
  }

  static fromString(value: string): Fraction | null {
    const trimmed = value.trim();
    if (/^[+-]?\d+$/.test(trimmed)) return Fraction.normalize(BigInt(trimmed), 1n);

    const decimal = trimmed.match(/^([+-])?(?:(\d+)\.(\d*)|\.(\d+))$/);
    if (!decimal) return null;

    const sign = decimal[1] === '-' ? -1n : 1n;
    const whole = decimal[2] ?? '0';
    const fractional = decimal[3] ?? decimal[4] ?? '';
    const denominator = 10n ** BigInt(fractional.length);
    const numerator = sign * BigInt(`${whole}${fractional || '0'}`);
    return Fraction.normalize(numerator, denominator);
  }

  add(other: Fraction) {
    return Fraction.normalize(this.numerator * other.denominator + other.numerator * this.denominator, this.denominator * other.denominator);
  }

  subtract(other: Fraction) {
    return this.add(other.negate());
  }

  multiply(other: Fraction) {
    return Fraction.normalize(this.numerator * other.numerator, this.denominator * other.denominator);
  }

  divide(other: Fraction) {
    if (other.isZero()) return null;
    return Fraction.normalize(this.numerator * other.denominator, this.denominator * other.numerator);
  }

  negate() {
    return new Fraction(-this.numerator, this.denominator);
  }

  isZero() {
    return this.numerator === 0n;
  }

  toNumber() {
    return Number(this.numerator) / Number(this.denominator);
  }

  toString() {
    if (this.denominator === 1n) return this.numerator.toString();
    return `${this.numerator}/${this.denominator}`;
  }

  private static normalize(numerator: bigint, denominator: bigint) {
    if (denominator < 0n) {
      numerator = -numerator;
      denominator = -denominator;
    }
    if (numerator === 0n) return new Fraction(0n, 1n);
    const divisor = gcd(absBigInt(numerator), denominator);
    return new Fraction(numerator / divisor, denominator / divisor);
  }
}

class ExactScalar {
  private constructor(private readonly terms: Map<number, Fraction>) {}

  static zero() {
    return new ExactScalar(new Map());
  }

  static one() {
    return ExactScalar.fromFraction(Fraction.one());
  }

  static pi() {
    return ExactScalar.fromTerm(1, Fraction.one());
  }

  static fromInteger(value: number) {
    return ExactScalar.fromFraction(Fraction.fromInteger(value));
  }

  static fromFraction(coefficient: Fraction) {
    return ExactScalar.fromTerm(0, coefficient);
  }

  static fromString(value: string): ExactScalar | null {
    const fraction = Fraction.fromString(value);
    return fraction ? ExactScalar.fromFraction(fraction) : null;
  }

  add(other: ExactScalar) {
    const terms = new Map(this.terms);
    for (const [power, coefficient] of other.terms) {
      setScalarTerm(terms, power, (terms.get(power) ?? Fraction.zero()).add(coefficient));
    }
    return new ExactScalar(terms);
  }

  subtract(other: ExactScalar) {
    return this.add(other.negate());
  }

  multiply(other: ExactScalar) {
    const terms = new Map<number, Fraction>();
    for (const [leftPower, leftCoefficient] of this.terms) {
      for (const [rightPower, rightCoefficient] of other.terms) {
        const power = leftPower + rightPower;
        setScalarTerm(terms, power, (terms.get(power) ?? Fraction.zero()).add(leftCoefficient.multiply(rightCoefficient)));
      }
    }
    return new ExactScalar(terms);
  }

  divide(other: ExactScalar) {
    const divisor = other.singleTerm();
    if (!divisor || divisor.coefficient.isZero()) return null;

    const terms = new Map<number, Fraction>();
    for (const [power, coefficient] of this.terms) {
      const nextCoefficient = coefficient.divide(divisor.coefficient);
      if (!nextCoefficient) return null;
      setScalarTerm(terms, power - divisor.power, nextCoefficient);
    }
    return new ExactScalar(terms);
  }

  negate() {
    return new ExactScalar(new Map([...this.terms].map(([power, coefficient]) => [power, coefficient.negate()])));
  }

  isZero() {
    return this.terms.size === 0;
  }

  integerValue(): number | null {
    const term = this.singleTerm();
    if (!term || term.power !== 0 || term.coefficient.denominator !== 1n) return null;
    return Number(term.coefficient.numerator);
  }

  rationalPiMultiple(): Fraction | null {
    if (this.isZero()) return Fraction.zero();
    const term = this.singleTerm();
    return term?.power === 1 ? term.coefficient : null;
  }

  toNumber() {
    return [...this.terms].reduce((sum, [power, coefficient]) => sum + coefficient.toNumber() * Math.PI ** power, 0);
  }

  toString() {
    if (this.isZero()) return '0';

    const pieces = [...this.terms]
      .sort(([leftPower], [rightPower]) => rightPower - leftPower)
      .map(([power, coefficient]) => formatScalarTerm(power, coefficient));

    return pieces.reduce((text, piece, index) => {
      if (index === 0) return piece;
      return piece.startsWith('-') ? `${text} - ${piece.slice(1)}` : `${text} + ${piece}`;
    }, '');
  }

  private singleTerm(): { power: number; coefficient: Fraction } | null {
    if (this.terms.size !== 1) return null;
    const [power, coefficient] = [...this.terms][0];
    return { power, coefficient };
  }

  private static fromTerm(power: number, coefficient: Fraction) {
    const terms = new Map<number, Fraction>();
    setScalarTerm(terms, power, coefficient);
    return new ExactScalar(terms);
  }
}

function parsePolynomial(expression: string, input: IntegralInput, variables: [Variable, Variable, Variable]): Polynomial | null {
  try {
    return nodeToPolynomial(math.parse(normalizeExpression(expression, input)) as MathNode, variables);
  } catch {
    return null;
  }
}

function nodeToPolynomial(node: MathNode, variables: [Variable, Variable, Variable]): Polynomial | null {
  const typedNode = node as MathNode & {
    args?: MathNode[];
    content?: MathNode;
    fn?: string;
    isConstantNode?: boolean;
    isOperatorNode?: boolean;
    isParenthesisNode?: boolean;
    isSymbolNode?: boolean;
    name?: string;
    op?: string;
    value?: string | number;
  };

  if (typedNode.isParenthesisNode && typedNode.content) return nodeToPolynomial(typedNode.content, variables);

  if (typedNode.isConstantNode && typedNode.value != null) {
    const coefficient = ExactScalar.fromString(String(typedNode.value));
    return coefficient ? constantPolynomial(coefficient) : null;
  }

  if (typedNode.isSymbolNode && typedNode.name) {
    const variableIndex = variables.indexOf(typedNode.name);
    if (variableIndex >= 0) return variablePolynomial(variableIndex);
    if (typedNode.name === 'pi' || typedNode.name === 'PI') return constantPolynomial(ExactScalar.pi());
    if (typedNode.name === 'tau') return constantPolynomial(ExactScalar.fromInteger(2).multiply(ExactScalar.pi()));
    return null;
  }

  if (!typedNode.isOperatorNode || !typedNode.args) return null;

  if (typedNode.fn === 'unaryMinus') {
    const value = nodeToPolynomial(typedNode.args[0], variables);
    return value ? negatePolynomial(value) : null;
  }

  const [leftNode, rightNode] = typedNode.args;
  const left = nodeToPolynomial(leftNode, variables);
  const right = rightNode ? nodeToPolynomial(rightNode, variables) : null;

  if (typedNode.op === '+' && left && right) return addPolynomials(left, right);
  if (typedNode.op === '-' && left && right) return subtractPolynomials(left, right);
  if (typedNode.op === '*' && left && right) return multiplyPolynomials(left, right);
  if (typedNode.op === '/' && left && right) {
    const scalar = constantTerm(right);
    return scalar ? dividePolynomial(left, scalar) : null;
  }
  if (typedNode.op === '^' && left && right) {
    const exponent = constantTerm(right);
    const power = exponent?.integerValue();
    return power != null && Number.isInteger(power) && power >= 0 ? powerPolynomial(left, power) : null;
  }

  return null;
}

function constantPolynomial(coefficient: ExactScalar): Polynomial {
  return coefficient.isZero() ? new Map() : new Map([[keyFor([0, 0, 0]), coefficient]]);
}

function variablePolynomial(variableIndex: number): Polynomial {
  const exponents: Exponents = [0, 0, 0];
  exponents[variableIndex] = 1;
  return new Map([[keyFor(exponents), ExactScalar.one()]]);
}

function addPolynomials(left: Polynomial, right: Polynomial): Polynomial {
  const result = new Map(left);
  for (const [key, coefficient] of right) {
    setTerm(result, key, (result.get(key) ?? ExactScalar.zero()).add(coefficient));
  }
  return result;
}

function subtractPolynomials(left: Polynomial, right: Polynomial): Polynomial {
  return addPolynomials(left, negatePolynomial(right));
}

function negatePolynomial(polynomial: Polynomial): Polynomial {
  return mapPolynomial(polynomial, (coefficient) => coefficient.negate());
}

function multiplyPolynomials(left: Polynomial, right: Polynomial): Polynomial {
  const result: Polynomial = new Map();
  for (const [leftKey, leftCoefficient] of left) {
    const leftExponents = exponentsFor(leftKey);
    for (const [rightKey, rightCoefficient] of right) {
      const rightExponents = exponentsFor(rightKey);
      const exponents: Exponents = [
        leftExponents[0] + rightExponents[0],
        leftExponents[1] + rightExponents[1],
        leftExponents[2] + rightExponents[2],
      ];
      const key = keyFor(exponents);
      setTerm(result, key, (result.get(key) ?? ExactScalar.zero()).add(leftCoefficient.multiply(rightCoefficient)));
    }
  }
  return result;
}

function dividePolynomial(polynomial: Polynomial, scalar: ExactScalar): Polynomial | null {
  if (scalar.isZero()) return null;
  const result: Polynomial = new Map();
  for (const [key, coefficient] of polynomial) {
    const divided = coefficient.divide(scalar);
    if (!divided) return null;
    setTerm(result, key, divided);
  }
  return result;
}

function powerPolynomial(polynomial: Polynomial, power: number): Polynomial {
  let result = constantPolynomial(ExactScalar.one());
  for (let index = 0; index < power; index += 1) {
    result = multiplyPolynomials(result, polynomial);
  }
  return result;
}

function integratePolynomial(polynomial: Polynomial, variableIndex: number): Polynomial {
  const result: Polynomial = new Map();
  for (const [key, coefficient] of polynomial) {
    const exponents = exponentsFor(key);
    const nextExponent = exponents[variableIndex] + 1;
    exponents[variableIndex] = nextExponent;
    const nextCoefficient = coefficient.divide(ExactScalar.fromInteger(nextExponent));
    if (nextCoefficient) setTerm(result, keyFor(exponents), nextCoefficient);
  }
  return result;
}

function evaluatePolynomialAt(polynomial: Polynomial, variableIndex: number, replacement: Polynomial): Polynomial {
  let result: Polynomial = new Map();
  for (const [key, coefficient] of polynomial) {
    const exponents = exponentsFor(key);
    const replacementPower = powerPolynomial(replacement, exponents[variableIndex]);
    exponents[variableIndex] = 0;
    const residual = new Map([[keyFor(exponents), coefficient]]);
    result = addPolynomials(result, multiplyPolynomials(residual, replacementPower));
  }
  return result;
}

function integrateSineJacobian(lower: Polynomial, upper: Polynomial): ExactScalar | null {
  const lowerValue = constantTerm(lower);
  const upperValue = constantTerm(upper);
  if (!lowerValue || !upperValue) return null;

  const lowerCosine = cosineOfPiMultiple(lowerValue);
  const upperCosine = cosineOfPiMultiple(upperValue);
  return lowerCosine && upperCosine ? lowerCosine.subtract(upperCosine) : null;
}

function cosineOfPiMultiple(value: ExactScalar): ExactScalar | null {
  const multiple = value.rationalPiMultiple();
  if (!multiple) return null;

  const normalized = positiveModulo(multiple.numerator, multiple.denominator * 2n);
  const denominator = multiple.denominator;
  if (normalized === 0n) return ExactScalar.one();
  if (normalized === denominator) return ExactScalar.fromInteger(-1);
  if (normalized * 2n === denominator || normalized * 2n === denominator * 3n) return ExactScalar.zero();
  return null;
}

function polynomialDependsOn(polynomial: Polynomial, variableIndex: number): boolean {
  return [...polynomial.keys()].some((key) => exponentsFor(key)[variableIndex] > 0);
}

function multiplyPolynomialByScalar(polynomial: Polynomial, scalar: ExactScalar): Polynomial {
  return mapPolynomial(polynomial, (coefficient) => coefficient.multiply(scalar));
}

function constantTerm(polynomial: Polynomial): ExactScalar | null {
  if (polynomial.size === 0) return ExactScalar.zero();
  if (polynomial.size === 1) return polynomial.get(keyFor([0, 0, 0])) ?? null;
  return null;
}

function mapPolynomial(polynomial: Polynomial, map: (coefficient: ExactScalar) => ExactScalar): Polynomial {
  const result: Polynomial = new Map();
  for (const [key, coefficient] of polynomial) {
    setTerm(result, key, map(coefficient));
  }
  return result;
}

function setTerm(polynomial: Polynomial, key: string, coefficient: ExactScalar) {
  if (coefficient.isZero()) polynomial.delete(key);
  else polynomial.set(key, coefficient);
}

function setScalarTerm(terms: Map<number, Fraction>, power: number, coefficient: Fraction) {
  if (coefficient.isZero()) terms.delete(power);
  else terms.set(power, coefficient);
}

function formatScalarTerm(power: number, coefficient: Fraction): string {
  if (power === 0) return coefficient.toString();

  const isNegative = coefficient.numerator < 0n;
  const numerator = absBigInt(coefficient.numerator);
  const piPart = power === 1 ? 'π' : `π^${power}`;
  const signedPrefix = isNegative ? '-' : '';
  const numeratorText = numerator === 1n ? piPart : `${numerator}${piPart}`;
  if (coefficient.denominator === 1n) return `${signedPrefix}${numeratorText}`;
  return `${signedPrefix}${numeratorText}/${coefficient.denominator}`;
}

function keyFor(exponents: Exponents): string {
  return exponents.join(',');
}

function exponentsFor(key: string): Exponents {
  return key.split(',').map(Number) as Exponents;
}

function gcd(left: bigint, right: bigint): bigint {
  while (right !== 0n) {
    const next = left % right;
    left = right;
    right = next;
  }
  return left;
}

function absBigInt(value: bigint): bigint {
  return value < 0n ? -value : value;
}

function positiveModulo(value: bigint, modulus: bigint): bigint {
  return ((value % modulus) + modulus) % modulus;
}

function normalizeExpression(expression: string, input: IntegralInput): string {
  return normalizeExpressionAliases(expression, input.coordinateSystem, input.variables);
}

function unknownSymbols(node: MathNode, variables: Variable[]): string[] {
  const symbols = new Set<string>();
  node.traverse((child: MathNode, _path: string, parent: MathNode) => {
    const symbol = child as MathNode & { isSymbolNode?: boolean; name?: string };
    if (symbol.isSymbolNode && symbol.name) {
      const name = symbol.name;
      const isVariable = variables.includes(name as Variable);
      const isConstant = ALLOWED_NON_VARIABLE_SYMBOLS.has(name);
      const isFunctionName = parent && parent.type === 'FunctionNode' && (parent as any).fn === child;

      if (!isVariable && !isConstant && !isFunctionName) {
        symbols.add(name);
      }
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
