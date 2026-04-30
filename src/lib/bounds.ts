import type { BoundPair, IntegralInput, Variable } from '../types';
import { orderFromOuterToInner, orderToOuterInner } from './orders';

type VariableMap = Record<Variable, Variable>;

export function rewriteBoundsForOrder(input: IntegralInput, nextOuterToInner: Variable[]): IntegralInput {
  if (input.coordinateSystem !== 'cartesian') {
    return {
      ...input,
      selectedOrder: orderFromOuterToInner(nextOuterToInner),
    };
  }

  const currentOuterToInner = orderToOuterInner(input.selectedOrder);
  const variableMap = mapVariablesByPosition(currentOuterToInner, nextOuterToInner);
  return renameIntegralVariables(input, variableMap, nextOuterToInner);
}

export function rewriteVariables(input: IntegralInput, nextVariables: [Variable, Variable, Variable]): IntegralInput {
  const variableMap = Object.fromEntries(input.variables.map((variable, index) => [variable, nextVariables[index]])) as VariableMap;
  const nextOuterToInner = orderToOuterInner(input.selectedOrder).map((variable) => variableMap[variable] ?? variable);
  return {
    ...renameIntegralVariables(input, variableMap, nextOuterToInner),
    variables: nextVariables,
  };
}

function renameIntegralVariables(input: IntegralInput, variableMap: VariableMap, nextOuterToInner: Variable[]): IntegralInput {
  const bounds: Partial<Record<Variable, BoundPair>> = {};

  for (const variable of input.variables) {
    bounds[variableMap[variable]] = renameBoundPair(input.bounds[variable], variableMap);
  }

  return {
    ...input,
    integrand: renameExpressionVariables(input.integrand, variableMap),
    jacobian: input.jacobian ? renameExpressionVariables(input.jacobian, variableMap) : input.jacobian,
    selectedOrder: orderFromOuterToInner(nextOuterToInner),
    bounds: bounds as Record<Variable, BoundPair>,
  };
}

function mapVariablesByPosition(currentOuterToInner: Variable[], nextOuterToInner: Variable[]): VariableMap {
  return Object.fromEntries(currentOuterToInner.map((variable, index) => [variable, nextOuterToInner[index]])) as VariableMap;
}

function renameBoundPair(bound: BoundPair, variableMap: VariableMap): BoundPair {
  return {
    lower: renameExpressionVariables(bound.lower, variableMap),
    upper: renameExpressionVariables(bound.upper, variableMap),
  };
}

export function renameExpressionVariables(expression: string, variableMap: VariableMap): string {
  const names = Object.keys(variableMap)
    .filter((name) => name !== variableMap[name])
    .sort((a, b) => b.length - a.length);
  if (!names.length) return expression;
  const pattern = new RegExp(`(^|[^\\p{L}\\p{N}_])(${names.map(escapeRegExp).join('|')})(?=$|[^\\p{L}\\p{N}_])`, 'gu');
  return expression.replace(pattern, (_match, prefix: string, name: string) => `${prefix}${variableMap[name] ?? name}`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
