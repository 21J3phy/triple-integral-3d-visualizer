import type { IntegralInput } from '../types';

export interface Preset {
  id: string;
  name: string;
  description: string;
  input: IntegralInput;
}

export const PRESETS: Preset[] = [
  {
    id: 'box',
    name: 'Unit cube',
    description: 'The cube 0 <= x, y, z <= 1, with volume 1.',
    input: {
      integrand: '1',
      coordinateSystem: 'cartesian',
      variables: ['x', 'y', 'z'],
      selectedOrder: 'dz dy dx',
      bounds: {
        x: { lower: '0', upper: '1' },
        y: { lower: '0', upper: '1' },
        z: { lower: '0', upper: '1' },
      },
    },
  },
  {
    id: 'tetrahedron',
    name: 'First-octant tetrahedron',
    description: 'x + y + z <= 1 in the first octant.',
    input: {
      integrand: '1',
      coordinateSystem: 'cartesian',
      variables: ['x', 'y', 'z'],
      selectedOrder: 'dz dy dx',
      bounds: {
        x: { lower: '0', upper: '1' },
        y: { lower: '0', upper: '1 - x' },
        z: { lower: '0', upper: '1 - x - y' },
      },
    },
  },
  {
    id: 'cylinder',
    name: 'Circular cylinder',
    description: 'A radius-1 circular base with height 2.',
    input: {
      integrand: '1',
      coordinateSystem: 'cartesian',
      variables: ['x', 'y', 'z'],
      selectedOrder: 'dz dy dx',
      bounds: {
        x: { lower: '-1', upper: '1' },
        y: { lower: '-sqrt(1 - x^2)', upper: 'sqrt(1 - x^2)' },
        z: { lower: '0', upper: '2' },
      },
    },
  },
  {
    id: 'cap',
    name: 'Paraboloid cap',
    description: 'Under z = 1 - x^2 - y^2 above z = 0.',
    input: {
      integrand: '1',
      coordinateSystem: 'cartesian',
      variables: ['x', 'y', 'z'],
      selectedOrder: 'dz dy dx',
      bounds: {
        x: { lower: '-1', upper: '1' },
        y: { lower: '-sqrt(1 - x^2)', upper: 'sqrt(1 - x^2)' },
        z: { lower: '0', upper: '1 - x^2 - y^2' },
      },
    },
  },
  {
    id: 'cylindrical-unit',
    name: 'Unit cylinder',
    description: 'A radius-1, height-1 cylinder in cylindrical coordinates.',
    input: {
      integrand: '1',
      coordinateSystem: 'cylindrical',
      variables: ['r', 'θ', 'z'],
      selectedOrder: 'dz dr dθ',
      bounds: {
        r: { lower: '0', upper: '1' },
        θ: { lower: '0', upper: '2*pi' },
        z: { lower: '0', upper: '1' },
      },
    },
  },
  {
    id: 'spherical-unit',
    name: 'Unit ball',
    description: 'A radius-1 ball in spherical coordinates.',
    input: {
      integrand: '1',
      coordinateSystem: 'spherical',
      variables: ['ρ', 'θ', 'φ'],
      selectedOrder: 'dρ dφ dθ',
      bounds: {
        ρ: { lower: '0', upper: '1' },
        θ: { lower: '0', upper: '2*pi' },
        φ: { lower: '0', upper: 'pi' },
      },
    },
  },
];
