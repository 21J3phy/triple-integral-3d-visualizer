import type { CoordinateSystem, Point3, Variable } from '../types';
import type { IntegralInput } from '../types';
import { orderFromOuterToInner } from './orders';

export const DEFAULT_VARIABLES: Record<CoordinateSystem, [Variable, Variable, Variable]> = {
  cartesian: ['x', 'y', 'z'],
  cylindrical: ['r', 'θ', 'z'],
  spherical: ['ρ', 'θ', 'φ'],
};

export const COORDINATE_LABELS: Record<CoordinateSystem, string> = {
  cartesian: 'Cartesian',
  cylindrical: 'Cylindrical',
  spherical: 'Spherical',
};

const RESERVED_SYMBOLS = new Set([
  'Infinity',
  'NaN',
  'abs',
  'acos',
  'asin',
  'atan',
  'cos',
  'e',
  'exp',
  'i',
  'log',
  'max',
  'min',
  'pi',
  'sin',
  'sqrt',
  'tan',
  'tau',
]);

export function isValidVariableName(name: string): boolean {
  return /^[\p{L}_][\p{L}\p{N}_]*$/u.test(name) && !RESERVED_SYMBOLS.has(name);
}

export function areValidVariables(variables: Variable[]): variables is [Variable, Variable, Variable] {
  return variables.length === 3 && variables.every(isValidVariableName) && new Set(variables).size === 3;
}

export function defaultOuterToInner(system: CoordinateSystem, variables: [Variable, Variable, Variable]): Variable[] {
  if (system === 'cylindrical') return [variables[1], variables[0], variables[2]];
  if (system === 'spherical') return [variables[1], variables[2], variables[0]];
  return [variables[0], variables[1], variables[2]];
}

export function coordinateJacobian(system: CoordinateSystem, variables: [Variable, Variable, Variable], scope: Record<Variable, number>): number {
  if (system === 'cylindrical') return Math.abs(scope[variables[0]] ?? 0);
  if (system === 'spherical') {
    const radius = scope[variables[0]] ?? 0;
    const polar = scope[variables[2]] ?? 0;
    return Math.abs(radius * radius * Math.sin(polar));
  }
  return 1;
}

export function jacobianLabel(system: CoordinateSystem, variables: [Variable, Variable, Variable]): string {
  if (system === 'cylindrical') return variables[0];
  if (system === 'spherical') return `${variables[0]}^2 sin(${variables[2]})`;
  return '1';
}

export function toCartesian(system: CoordinateSystem, variables: [Variable, Variable, Variable], scope: Record<Variable, number>): Point3 {
  const first = scope[variables[0]] ?? 0;
  const second = scope[variables[1]] ?? 0;
  const third = scope[variables[2]] ?? 0;

  if (system === 'cylindrical') {
    return {
      x: first * Math.cos(second),
      y: first * Math.sin(second),
      z: third,
    };
  }

  if (system === 'spherical') {
    return {
      x: first * Math.sin(third) * Math.cos(second),
      y: first * Math.sin(third) * Math.sin(second),
      z: first * Math.cos(third),
    };
  }

  return { x: first, y: second, z: third };
}

export function fromCartesian(system: CoordinateSystem, variables: [Variable, Variable, Variable], point: Point3): Record<Variable, number> {
  if (system === 'cylindrical') {
    return {
      [variables[0]]: Math.hypot(point.x, point.y),
      [variables[1]]: Math.atan2(point.y, point.x),
      [variables[2]]: point.z,
    };
  }

  if (system === 'spherical') {
    const radius = Math.hypot(point.x, point.y, point.z);
    return {
      [variables[0]]: radius,
      [variables[1]]: Math.atan2(point.y, point.x),
      [variables[2]]: radius > 0 ? Math.acos(point.z / radius) : 0,
    };
  }

  return {
    [variables[0]]: point.x,
    [variables[1]]: point.y,
    [variables[2]]: point.z,
  };
}

export function convertIntegralToCoordinateSystem(input: IntegralInput, targetSystem: CoordinateSystem): IntegralInput {
  if (input.coordinateSystem === targetSystem) return input;

  const targetVariables = DEFAULT_VARIABLES[targetSystem];
  const transformedIntegrand = transformExpression(input.integrand, input.coordinateSystem, input.variables, targetSystem, targetVariables);
  const converted = convertBounds(input, targetSystem, targetVariables);

  return {
    integrand: transformedIntegrand,
    coordinateSystem: targetSystem,
    variables: targetVariables,
    selectedOrder: converted.selectedOrder,
    bounds: converted.bounds,
  };
}

function convertBounds(
  input: IntegralInput,
  targetSystem: CoordinateSystem,
  targetVariables: [Variable, Variable, Variable],
): Pick<IntegralInput, 'selectedOrder' | 'bounds'> {
  if (input.coordinateSystem === 'spherical' && targetSystem === 'cartesian') {
    const converted = sphereToCartesianBounds(input, targetVariables);
    if (converted) return converted;
  }

  if (input.coordinateSystem === 'spherical' && targetSystem === 'cylindrical') {
    const converted = sphereToCylindricalBounds(input, targetVariables);
    if (converted) return converted;
  }

  if (input.coordinateSystem === 'cylindrical' && targetSystem === 'cartesian') {
    const converted = cylinderToCartesianBounds(input, targetVariables);
    if (converted) return converted;
  }

  return defaultBoundsForCoordinateSystem(targetSystem, targetVariables);
}

function sphereToCartesianBounds(
  input: IntegralInput,
  targetVariables: [Variable, Variable, Variable],
): Pick<IntegralInput, 'selectedOrder' | 'bounds'> | null {
  const [radius, azimuth, polar] = input.variables;
  const radiusBounds = input.bounds[radius];
  const azimuthBounds = input.bounds[azimuth];
  const polarBounds = input.bounds[polar];
  if (!isZero(radiusBounds.lower) || !isFullTurn(azimuthBounds) || !isZeroToPi(polarBounds) || hasAnyVariable(radiusBounds.upper, input.variables)) {
    return null;
  }

  const [x, y, z] = targetVariables;
  const r = parenthesize(radiusBounds.upper);
  const xyDisk = `${r}^2 - ${x}^2`;
  const ballSlice = `${r}^2 - ${x}^2 - ${y}^2`;
  return {
    selectedOrder: orderFromOuterToInner([x, y, z]),
    bounds: {
      [x]: { lower: `-${r}`, upper: r },
      [y]: { lower: `-sqrt(${xyDisk})`, upper: `sqrt(${xyDisk})` },
      [z]: { lower: `-sqrt(${ballSlice})`, upper: `sqrt(${ballSlice})` },
    },
  };
}

function sphereToCylindricalBounds(
  input: IntegralInput,
  targetVariables: [Variable, Variable, Variable],
): Pick<IntegralInput, 'selectedOrder' | 'bounds'> | null {
  const [radius, azimuth, polar] = input.variables;
  const radiusBounds = input.bounds[radius];
  const azimuthBounds = input.bounds[azimuth];
  const polarBounds = input.bounds[polar];
  if (!isZero(radiusBounds.lower) || !isFullTurn(azimuthBounds) || !isZeroToPi(polarBounds) || hasAnyVariable(radiusBounds.upper, input.variables)) {
    return null;
  }

  const [r, theta, z] = targetVariables;
  const sphereRadius = parenthesize(radiusBounds.upper);
  const height = `${sphereRadius}^2 - ${r}^2`;
  return {
    selectedOrder: orderFromOuterToInner([theta, r, z]),
    bounds: {
      [r]: { lower: '0', upper: sphereRadius },
      [theta]: { lower: '0', upper: '2*pi' },
      [z]: { lower: `-sqrt(${height})`, upper: `sqrt(${height})` },
    },
  };
}

function cylinderToCartesianBounds(
  input: IntegralInput,
  targetVariables: [Variable, Variable, Variable],
): Pick<IntegralInput, 'selectedOrder' | 'bounds'> | null {
  const [radius, azimuth, height] = input.variables;
  const radiusBounds = input.bounds[radius];
  const azimuthBounds = input.bounds[azimuth];
  if (!isZero(radiusBounds.lower) || !isFullTurn(azimuthBounds) || hasAnyVariable(radiusBounds.upper, input.variables)) {
    return null;
  }

  const [x, y, z] = targetVariables;
  const r = parenthesize(radiusBounds.upper);
  const disk = `${r}^2 - ${x}^2`;
  return {
    selectedOrder: orderFromOuterToInner([x, y, z]),
    bounds: {
      [x]: { lower: `-${r}`, upper: r },
      [y]: { lower: `-sqrt(${disk})`, upper: `sqrt(${disk})` },
      [z]: {
        lower: transformExpression(input.bounds[height].lower, input.coordinateSystem, input.variables, 'cartesian', targetVariables),
        upper: transformExpression(input.bounds[height].upper, input.coordinateSystem, input.variables, 'cartesian', targetVariables),
      },
    },
  };
}

function defaultBoundsForCoordinateSystem(
  coordinateSystem: CoordinateSystem,
  variables: [Variable, Variable, Variable],
): Pick<IntegralInput, 'selectedOrder' | 'bounds'> {
  const selectedOrder = orderFromOuterToInner(defaultOuterToInner(coordinateSystem, variables));
  if (coordinateSystem === 'cylindrical') {
    return {
      selectedOrder,
      bounds: {
        [variables[0]]: { lower: '0', upper: '1' },
        [variables[1]]: { lower: '0', upper: '2*pi' },
        [variables[2]]: { lower: '0', upper: '1' },
      },
    };
  }
  if (coordinateSystem === 'spherical') {
    return {
      selectedOrder,
      bounds: {
        [variables[0]]: { lower: '0', upper: '1' },
        [variables[1]]: { lower: '0', upper: '2*pi' },
        [variables[2]]: { lower: '0', upper: 'pi' },
      },
    };
  }
  return {
    selectedOrder,
    bounds: {
      [variables[0]]: { lower: '0', upper: '1' },
      [variables[1]]: { lower: '0', upper: '1' },
      [variables[2]]: { lower: '0', upper: '1' },
    },
  };
}

function transformExpression(
  expression: string,
  sourceSystem: CoordinateSystem,
  sourceVariables: [Variable, Variable, Variable],
  targetSystem: CoordinateSystem,
  targetVariables: [Variable, Variable, Variable],
): string {
  const sourceToCartesian = variablesFromCartesian(sourceSystem, sourceVariables);
  const targetToCartesian = cartesianFromVariables(targetSystem, targetVariables);
  const sourceToTarget = Object.fromEntries(
    sourceVariables.map((variable) => [variable, replaceSymbols(sourceToCartesian[variable], targetToCartesian)]),
  );
  return replaceSymbols(expression, sourceToTarget);
}

function variablesFromCartesian(system: CoordinateSystem, variables: [Variable, Variable, Variable]): Record<Variable, string> {
  if (system === 'cylindrical') {
    return {
      [variables[0]]: 'sqrt(x^2 + y^2)',
      [variables[1]]: 'atan2(y, x)',
      [variables[2]]: 'z',
    };
  }
  if (system === 'spherical') {
    return {
      [variables[0]]: 'sqrt(x^2 + y^2 + z^2)',
      [variables[1]]: 'atan2(y, x)',
      [variables[2]]: 'acos(z / sqrt(x^2 + y^2 + z^2))',
    };
  }
  return {
    [variables[0]]: 'x',
    [variables[1]]: 'y',
    [variables[2]]: 'z',
  };
}

function cartesianFromVariables(system: CoordinateSystem, variables: [Variable, Variable, Variable]): Record<string, string> {
  if (system === 'cylindrical') {
    return {
      x: `${variables[0]} * cos(${variables[1]})`,
      y: `${variables[0]} * sin(${variables[1]})`,
      z: variables[2],
    };
  }
  if (system === 'spherical') {
    return {
      x: `${variables[0]} * sin(${variables[2]}) * cos(${variables[1]})`,
      y: `${variables[0]} * sin(${variables[2]}) * sin(${variables[1]})`,
      z: `${variables[0]} * cos(${variables[2]})`,
    };
  }
  return {
    x: variables[0],
    y: variables[1],
    z: variables[2],
  };
}

function replaceSymbols(expression: string, replacements: Record<string, string>): string {
  const names = Object.keys(replacements).sort((a, b) => b.length - a.length);
  if (!names.length) return expression;
  const pattern = new RegExp(`(^|[^\\p{L}\\p{N}_])(${names.map(escapeRegExp).join('|')})(?=$|[^\\p{L}\\p{N}_])`, 'gu');
  return expression.replace(pattern, (_match, prefix: string, name: string) => `${prefix}${parenthesize(replacements[name])}`);
}

function hasAnyVariable(expression: string, variables: Variable[]): boolean {
  return variables.some((variable) => replaceSymbols(expression, { [variable]: '__hit__' }).includes('__hit__'));
}

function isZero(expression: string): boolean {
  return normalizeExpression(expression) === '0';
}

function isFullTurn(bounds: { lower: string; upper: string }): boolean {
  const lower = normalizeExpression(bounds.lower);
  const upper = normalizeExpression(bounds.upper);
  return lower === '0' && (upper === '2*pi' || upper === 'tau' || upper === '2π');
}

function isZeroToPi(bounds: { lower: string; upper: string }): boolean {
  return normalizeExpression(bounds.lower) === '0' && normalizeExpression(bounds.upper) === 'pi';
}

function normalizeExpression(expression: string): string {
  return expression.replace(/\s+/g, '').replace(/π/g, 'pi');
}

function parenthesize(expression: string): string {
  const trimmed = expression.trim();
  if (/^[\p{L}\p{N}_.]+$/u.test(trimmed)) return trimmed;
  if (/^\([^()]+\)$/u.test(trimmed)) return trimmed;
  return `(${trimmed})`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
