import type { EvalFunction } from 'mathjs';

export type Variable = string;
export type CoordinateSystem = 'cartesian' | 'cylindrical' | 'spherical';

export type BoundOrder = string;

export interface BoundPair {
  lower: string;
  upper: string;
}

export interface IntegralInput {
  integrand: string;
  jacobian?: string;
  showJacobian?: boolean;
  coordinateSystem: CoordinateSystem;
  variables: [Variable, Variable, Variable];
  selectedOrder: BoundOrder;
  bounds: Record<Variable, BoundPair>;
}

export interface ParsedIntegral {
  input: IntegralInput;
  orderInnerToOuter: Variable[];
  orderOuterToInner: Variable[];
  integrand?: EvalFunction;
  jacobian?: EvalFunction;
  bounds: Partial<Record<Variable, { lower: EvalFunction; upper: EvalFunction }>>;
  validationErrors: string[];
}

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

export interface BoundingBox {
  x: [number, number];
  y: [number, number];
  z: [number, number];
}

export interface RegionSample {
  points: Point3[];
  coordinatePoints: Array<Record<Variable, number>>;
  insideFlags: boolean[];
  boundingBox: BoundingBox;
  coordinateBoundingBox: Record<Variable, [number, number]>;
  coordinateSystem: CoordinateSystem;
  variables: [Variable, Variable, Variable];
  jacobianLabel: string;
  estimatedVolume: number;
  integralEstimate: number;
  confidenceRadius: number;
  sampleCount: number;
  insideCount: number;
  quality: 'high' | 'medium' | 'low';
  warnings: string[];
}

export interface SliceSummary {
  variable: Variable;
  at: number;
  min: number;
  max: number;
  sampleCount: number;
}

export interface SwitchedBoundsEstimate {
  order: BoundOrder;
  perVariableRanges: Record<Variable, [number, number] | null>;
  sliceSummaries: SliceSummary[];
  warnings: string[];
  qualityScore: number;
}
