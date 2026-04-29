import type { BoundOrder, Variable } from '../types';

export function orderToInnerOuter(order: BoundOrder): Variable[] {
  return order.split(' ').map((token) => token.slice(1) as Variable);
}

export function orderToOuterInner(order: BoundOrder): Variable[] {
  return [...orderToInnerOuter(order)].reverse();
}

export function orderFromOuterToInner(outerToInner: Variable[]): BoundOrder {
  return [...outerToInner]
    .reverse()
    .map((variable) => `d${variable}`)
    .join(' ') as BoundOrder;
}

export function allOrdersForVariables(variables: Variable[]): BoundOrder[] {
  return permutations(variables).map(orderFromOuterToInner);
}

export function variableLabel(variable: Variable): string {
  return variable.toUpperCase();
}

export function formatOrder(order: BoundOrder): string {
  return order;
}

export function rangeText(range: [number, number] | null): string {
  if (!range) return 'not enough samples';
  return `[${range[0].toFixed(3)}, ${range[1].toFixed(3)}]`;
}

function permutations<T>(items: T[]): T[][] {
  if (items.length <= 1) return [items];
  return items.flatMap((item, index) => {
    const remaining = items.filter((_, itemIndex) => itemIndex !== index);
    return permutations(remaining).map((tail) => [item, ...tail]);
  });
}
