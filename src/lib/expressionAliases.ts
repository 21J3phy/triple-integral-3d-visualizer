import type { CoordinateSystem, Variable } from '../types';

const CONSTANT_ALIASES: Record<string, string> = {
  π: 'pi',
  ρ: 'rho',
  θ: 'theta',
  φ: 'phi',
  α: 'alpha',
  β: 'beta',
  γ: 'gamma',
  δ: 'delta',
  ε: 'epsilon',
  ζ: 'zeta',
  η: 'eta',
  ι: 'iota',
  κ: 'kappa',
  λ: 'lambda',
  μ: 'mu',
  ν: 'nu',
  ξ: 'xi',
  ο: 'omicron',
  σ: 'sigma',
  τ: 'tau',
  υ: 'upsilon',
  χ: 'chi',
  ψ: 'psi',
  ω: 'omega',
  Α: 'Alpha',
  Β: 'Beta',
  Γ: 'Gamma',
  Δ: 'Delta',
  Ε: 'Epsilon',
  Ζ: 'Zeta',
  Η: 'Eta',
  Θ: 'Theta',
  Ι: 'Iota',
  Κ: 'Kappa',
  Λ: 'Lambda',
  Μ: 'Mu',
  Ν: 'Nu',
  Ξ: 'Xi',
  Ο: 'Omicron',
  Π: 'Pi',
  Ρ: 'Rho',
  Σ: 'Sigma',
  Τ: 'Tau',
  Υ: 'Upsilon',
  Φ: 'Phi',
  Χ: 'Chi',
  Ψ: 'Psi',
  Ω: 'Omega',
  '√': 'sqrt',
  '²': '^2',
  '³': '^3',
  '¹': '^1',
};

export function normalizeExpressionAliases(
  expression: string,
  coordinateSystem: CoordinateSystem,
  variables: [Variable, Variable, Variable],
): string {
  return replaceSymbols(replaceConstants(normalizeSquareRootShorthand(expression)), coordinateVariableAliases(coordinateSystem, variables));
}

function normalizeSquareRootShorthand(expression: string): string {
  let normalized = '';
  let i = 0;

  while (i < expression.length) {
    if (expression[i] !== '√') {
      normalized += expression[i];
      i++;
      continue;
    }

    i++;
    const radicand = readRadicand(expression, i);
    if (!radicand) {
      normalized += 'sqrt';
      continue;
    }

    normalized += `sqrt(${radicand.value})`;
    i = radicand.end;
  }

  return normalized;
}

function readRadicand(expression: string, start: number): { value: string; end: number } | null {
  if (start >= expression.length) return null;

  let i = start;
  let depth = 0;

  if (expression[i] === '(') {
    depth = 1;
    i++;
    while (i < expression.length && depth > 0) {
      if (expression[i] === '(') depth++;
      else if (expression[i] === ')') depth--;
      i++;
    }
    return { value: expression.slice(start, i), end: i };
  }

  while (i < expression.length) {
    const character = expression[i];
    if (character === '(') depth++;
    else if (character === ')') {
      if (depth === 0) break;
      depth--;
    }

    if (depth === 0 && /[\s+\-*\/=,;]/u.test(character)) break;
    i++;
  }

  if (i === start) return null;
  return { value: expression.slice(start, i), end: i };
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
