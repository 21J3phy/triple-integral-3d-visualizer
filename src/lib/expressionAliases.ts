import type { CoordinateSystem, Variable } from '../types';

const CONSTANT_ALIASES: Record<string, string> = {
  π: 'pi',
};

export function normalizeExpressionAliases(
  expression: string,
  coordinateSystem: CoordinateSystem,
  variables: [Variable, Variable, Variable],
): string {
  return replaceSymbols(replaceConstants(expression), coordinateVariableAliases(coordinateSystem, variables));
}

function coordinateVariableAliases(
  coordinateSystem: CoordinateSystem,
  variables: [Variable, Variable, Variable],
): Record<string, string> {
  const [first, second, third] = variables;

  if (coordinateSystem === 'cartesian') {
    const radius = `sqrt(${first}^2 + ${second}^2 + ${third}^2)`;
    return {
      rho: radius,
      ρ: radius,
      theta: `atan2(${second}, ${first})`,
      θ: `atan2(${second}, ${first})`,
      phi: `acos(${third} / ${radius})`,
      φ: `acos(${third} / ${radius})`,
    };
  }

  if (coordinateSystem === 'cylindrical') {
    const sphericalRadius = `sqrt(${first}^2 + ${third}^2)`;
    return {
      rho: sphericalRadius,
      ρ: sphericalRadius,
      theta: second,
      θ: second,
      phi: `acos(${third} / ${sphericalRadius})`,
      φ: `acos(${third} / ${sphericalRadius})`,
    };
  }

  if (coordinateSystem === 'spherical') {
    return {
      rho: first,
      ρ: first,
      theta: second,
      θ: second,
      phi: third,
      φ: third,
    };
  }

  return {};
}

function replaceConstants(expression: string): string {
  return Object.entries(CONSTANT_ALIASES).reduce((current, [alias, replacement]) => current.split(alias).join(replacement), expression);
}

function replaceSymbols(expression: string, replacements: Record<string, string>): string {
  const names = Object.keys(replacements)
    .filter((name) => name !== replacements[name])
    .sort((a, b) => b.length - a.length);
  if (!names.length) return expression;
  const pattern = new RegExp(`(^|[^\\p{L}\\p{N}_])(${names.map(escapeRegExp).join('|')})(?=$|[^\\p{L}\\p{N}_])`, 'gu');
  return expression.replace(pattern, (_match, prefix: string, name: string) => `${prefix}${parenthesize(replacements[name] ?? name)}`);
}

function parenthesize(expression: string): string {
  const trimmed = expression.trim();
  if (/^[\p{L}_][\p{L}\p{N}_]*$/u.test(trimmed) || /^[0-9.]+$/u.test(trimmed)) return trimmed;
  if (/^\([^()]+\)$/u.test(trimmed)) return trimmed;
  return `(${trimmed})`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
