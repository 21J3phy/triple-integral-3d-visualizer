import type { IntegralInput } from '../types';
import { defaultJacobianExpression } from './coordinates';
import { normalizeExpressionAliases } from './expressionAliases';

/**
 * Encode an IntegralInput into a compact URL-safe base64 string.
 */
export function encodeEquation(input: IntegralInput): string {
  const json = JSON.stringify(input);
  return btoa(unescape(encodeURIComponent(json)));
}

/**
 * Decode a base64 string back into an IntegralInput.
 * Returns null if the string is invalid or cannot be parsed.
 */
export function decodeEquation(encoded: string): IntegralInput | null {
  const raw = encoded.startsWith('#') ? encoded.slice(1) : encoded;
  if (!raw) return null;
  try {
    const json = decodeURIComponent(escape(atob(raw)));
    const parsed = JSON.parse(json);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      typeof parsed.integrand === 'string' &&
      typeof parsed.coordinateSystem === 'string' &&
      Array.isArray(parsed.variables) &&
      parsed.variables.length === 3 &&
      typeof parsed.selectedOrder === 'string' &&
      typeof parsed.bounds === 'object'
    ) {
      return withJacobianDefault(parsed as IntegralInput);
    }
    return null;
  } catch {
    return null;
  }
}

export function withJacobianDefault(input: IntegralInput): IntegralInput {
  if (input.jacobian != null || input.showJacobian != null) return input;

  const jacobian = defaultJacobianExpression(input.coordinateSystem, input.variables);
  if (canonicalExpression(jacobian, input) === '1') return input;

  if (canonicalExpression(input.integrand, input).includes(canonicalExpression(jacobian, input))) {
    return {
      ...input,
      jacobian: '1',
      showJacobian: false,
    };
  }

  return input;
}

function canonicalExpression(expression: string, input: IntegralInput): string {
  return normalizeExpressionAliases(expression, input.coordinateSystem, input.variables)
    .replace(/\s+/g, '')
    .replace(/\*/g, '');
}

/**
 * Build a shareable URL for the given equation.
 * Stores the full state in the URL hash so no backend is needed.
 */
export function buildShareUrl(input: IntegralInput): string {
  const hash = encodeEquation(input);
  return `${window.location.origin}${window.location.pathname}#${hash}`;
}

/**
 * Try to extract a shared equation from the current URL hash.
 */
export function getSharedEquation(): IntegralInput | null {
  const hash = window.location.hash;
  if (!hash || hash === '#') return null;
  return decodeEquation(hash.slice(1));
}

/**
 * Copy text to clipboard with fallback for older browsers.
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      return true;
    } catch {
      return false;
    }
  }
}
