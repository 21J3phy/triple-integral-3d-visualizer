const GREEK_SYMBOLS: Record<string, string> = {
  alpha: 'α',
  beta: 'β',
  gamma: 'γ',
  delta: 'δ',
  epsilon: 'ε',
  zeta: 'ζ',
  eta: 'η',
  theta: 'θ',
  iota: 'ι',
  kappa: 'κ',
  lambda: 'λ',
  mu: 'μ',
  nu: 'ν',
  xi: 'ξ',
  omicron: 'ο',
  pi: 'π',
  rho: 'ρ',
  sigma: 'σ',
  tau: 'τ',
  upsilon: 'υ',
  phi: 'φ',
  chi: 'χ',
  psi: 'ψ',
  omega: 'ω',
  Alpha: 'Α',
  Beta: 'Β',
  Gamma: 'Γ',
  Delta: 'Δ',
  Epsilon: 'Ε',
  Zeta: 'Ζ',
  Eta: 'Η',
  Theta: 'Θ',
  Iota: 'Ι',
  Kappa: 'Κ',
  Lambda: 'Λ',
  Mu: 'Μ',
  Nu: 'Ν',
  Xi: 'Ξ',
  Omicron: 'Ο',
  Pi: 'Π',
  Rho: 'Ρ',
  Sigma: 'Σ',
  Tau: 'Τ',
  Upsilon: 'Υ',
  Phi: 'Φ',
  Chi: 'Χ',
  Psi: 'Ψ',
  Omega: 'Ω',
};

const MATH_SYMBOLS: Record<string, string> = {
  sqrt: '√',
  '^2': '²',
  '^3': '³',
  '^1': '¹',
};

/**
 * Automatically replaces text aliases with mathematical and Greek symbols.
 * This is intended to be used in onChange handlers for expression inputs.
 */
export function autoReplaceMathSymbols(text: string): string {
  let result = text;

  // Replace math symbols first (longer patterns like ^2 before /)
  for (const [alias, symbol] of Object.entries(MATH_SYMBOLS)) {
    result = result.split(alias).join(symbol);
  }

  // Replace Greek symbols
  // We use a regex to ensure we replace whole words or specific patterns
  // However, in a math context, sometimes symbols are concatenated (e.g. "2pi")
  // So we'll look for the aliases and replace them.
  // To avoid replacing partial matches (like "p" in "pi"), we sort by length descending.
  const greekAliases = Object.keys(GREEK_SYMBOLS).sort((a, b) => b.length - a.length);
  for (const alias of greekAliases) {
    // We want to replace "pi" but not "pin" if "pin" was a thing.
    // For math inputs, usually any occurrence of "pi" should be π.
    // But let's be slightly careful. We'll use a boundary check if possible,
    // or just a simple replacement if that's what's expected for math apps.
    // Most math apps replace "pi" as soon as it's typed.
    const pattern = new RegExp(`(?<![a-zA-Z])${alias}(?![a-zA-Z])`, 'g');
    result = result.replace(pattern, GREEK_SYMBOLS[alias]);
  }

  return result;
}
