import { describe, expect, it } from 'vitest';
import { rewriteBoundsForOrder } from './bounds';
import { convertIntegralToCoordinateSystem } from './coordinates';
import { parseIntegral, sampleRegion, estimateSwitchedBounds, solveIntegralExactly } from './integral';
import { buildCoordinateSliceGeometries, type CoordinateSliceGeometry } from './sliceGeometry';
import { PRESETS } from './presets';
import type { IntegralInput } from '../types';

const cube: IntegralInput = {
  integrand: '1',
  coordinateSystem: 'cartesian',
  variables: ['x', 'y', 'z'],
  selectedOrder: 'dz dy dx',
  bounds: {
    x: { lower: '0', upper: '1' },
    y: { lower: '0', upper: '1' },
    z: { lower: '0', upper: '1' },
  },
};

const tetrahedron: IntegralInput = {
  integrand: '1',
  coordinateSystem: 'cartesian',
  variables: ['x', 'y', 'z'],
  selectedOrder: 'dz dy dx',
  bounds: {
    x: { lower: '0', upper: '1' },
    y: { lower: '0', upper: '1 - x' },
    z: { lower: '0', upper: '1 - x - y' },
  },
};

const unitSphere: IntegralInput = {
  integrand: '1',
  coordinateSystem: 'spherical',
  variables: ['ρ', 'θ', 'φ'],
  selectedOrder: 'dρ dφ dθ',
  bounds: {
    ρ: { lower: '0', upper: '1' },
    θ: { lower: '0', upper: '2*pi' },
    φ: { lower: '0', upper: 'pi' },
  },
};

describe('parseIntegral', () => {
  it('accepts constants, variables, and dependent bounds', () => {
    const parsed = parseIntegral({
      ...tetrahedron,
      integrand: 'x + y + z',
    });
    expect(parsed.validationErrors).toEqual([]);
  });

  it('rejects bounds that depend on inner variables', () => {
    const parsed = parseIntegral({
      ...cube,
      bounds: {
        ...cube.bounds,
        x: { lower: '0', upper: 'z + 1' },
      },
    });
    expect(parsed.validationErrors.join('\n')).toContain('x upper bound depends on z');
  });

  it('returns validation errors for unknown symbols', () => {
    const parsed = parseIntegral({ ...cube, integrand: 'x + kitten' });
    expect(parsed.validationErrors.join('\n')).toContain('unknown symbol');
  });

  it('accepts custom variable names', () => {
    const parsed = parseIntegral({
      integrand: 'u + v + w',
      coordinateSystem: 'cartesian',
      variables: ['u', 'v', 'w'],
      selectedOrder: 'dw dv du',
      bounds: {
        u: { lower: '0', upper: '1' },
        v: { lower: '0', upper: '1 - u' },
        w: { lower: '0', upper: '1 - u - v' },
      },
    });
    expect(parsed.validationErrors).toEqual([]);
  });

  it('accepts typed spherical aliases for the default Greek variables', () => {
    const parsed = parseIntegral({
      ...unitSphere,
      integrand: 'rho^2 * sin(phi)',
      bounds: {
        ...unitSphere.bounds,
        ρ: { lower: '0', upper: '1 + 0 * theta' },
        θ: { lower: '0', upper: '2π' },
        φ: { lower: '0', upper: 'pi' },
      },
    });

    expect(parsed.validationErrors).toEqual([]);
  });

  it('accepts spherical coordinate names inside Cartesian integrands', () => {
    const parsed = parseIntegral({
      ...cube,
      integrand: 'rho + theta + phi + π',
    });

    expect(parsed.validationErrors).toEqual([]);
  });
});

describe('sampleRegion', () => {
  it('estimates the unit cube volume', () => {
    const sample = sampleRegion(parseIntegral(cube), 3500);
    expect(sample.estimatedVolume).toBeCloseTo(1, 2);
    expect(sample.integralEstimate).toBeCloseTo(1, 2);
  });

  it('estimates tetrahedron volume', () => {
    const sample = sampleRegion(parseIntegral(tetrahedron), 8000);
    expect(sample.estimatedVolume).toBeGreaterThan(0.14);
    expect(sample.estimatedVolume).toBeLessThan(0.20);
  });

  it('produces plausible switched bounds for a simple cube', () => {
    const sample = sampleRegion(parseIntegral(cube), 2000);
    const estimate = estimateSwitchedBounds(sample, 'dx dz dy');
    expect(estimate.perVariableRanges.x?.[0]).toBeLessThan(0.08);
    expect(estimate.perVariableRanges.x?.[1]).toBeGreaterThan(0.92);
    expect(estimate.perVariableRanges.y?.[0]).toBeLessThan(0.08);
    expect(estimate.perVariableRanges.z?.[1]).toBeGreaterThan(0.92);
  });

  it('includes the cylindrical Jacobian', () => {
    const cylinder: IntegralInput = {
      integrand: '1',
      coordinateSystem: 'cylindrical',
      variables: ['r', 'θ', 'z'],
      selectedOrder: 'dz dr dθ',
      bounds: {
        r: { lower: '0', upper: '1' },
        θ: { lower: '0', upper: '2*pi' },
        z: { lower: '0', upper: '1' },
      },
    };
    const sample = sampleRegion(parseIntegral(cylinder), 8000);
    expect(sample.estimatedVolume).toBeCloseTo(Math.PI, 1);
  });

  it('includes the spherical Jacobian', () => {
    const sample = sampleRegion(parseIntegral(unitSphere), 12000);
    expect(sample.estimatedVolume).toBeCloseTo((4 * Math.PI) / 3, 1);
  });
});

describe('solveIntegralExactly', () => {
  it('solves the starter tetrahedron volume as a fraction', () => {
    const exact = solveIntegralExactly(parseIntegral(tetrahedron));
    expect(exact?.fraction).toBe('1/6');
    expect(exact?.decimal).toBeCloseTo(1 / 6);
  });

  it('integrates polynomial Cartesian inputs with fractional output', () => {
    const exact = solveIntegralExactly(
      parseIntegral({
        ...tetrahedron,
        integrand: 'x + y + z',
      }),
    );

    expect(exact?.fraction).toBe('1/8');
  });

  it('solves cylindrical volumes with the radial Jacobian', () => {
    const exact = solveIntegralExactly(parseIntegral(PRESETS[4].input));
    expect(exact?.fraction).toBe('π');
    expect(exact?.decimal).toBeCloseTo(Math.PI);
  });

  it('solves polynomial cylindrical integrals as pi fractions', () => {
    const exact = solveIntegralExactly(
      parseIntegral({
        integrand: 'r^2 + 2z',
        coordinateSystem: 'cylindrical',
        variables: ['r', 'θ', 'z'],
        selectedOrder: 'dz dr dθ',
        bounds: {
          r: { lower: '0', upper: '1' },
          θ: { lower: '0', upper: '2*pi' },
          z: { lower: '0', upper: '1' },
        },
      }),
    );

    expect(exact?.fraction).toBe('3π/2');
  });

  it('solves spherical volumes with the sine Jacobian', () => {
    const exact = solveIntegralExactly(parseIntegral(unitSphere));
    expect(exact?.fraction).toBe('4π/3');
    expect(exact?.decimal).toBeCloseTo((4 * Math.PI) / 3);
  });

  it('solves polynomial spherical integrals as pi fractions', () => {
    const exact = solveIntegralExactly(
      parseIntegral({
        ...unitSphere,
        integrand: 'ρ^2',
      }),
    );

    expect(exact?.fraction).toBe('4π/5');
  });

  it('returns null for non-polynomial Cartesian inputs that need numeric estimation', () => {
    const exact = solveIntegralExactly(parseIntegral(PRESETS[2].input));
    expect(exact).toBeNull();
  });
});

describe('buildCoordinateSliceGeometries', () => {
  it('builds finite solid Cartesian slice geometry', () => {
    const parsed = parseIntegral(tetrahedron);
    const slices = buildCoordinateSliceGeometries(parsed, {
      sliceVariable: 'z',
      sliceCount: 4,
      visibleSliceCount: 2,
      showAllSlices: true,
      resolution: 10,
    });

    expect(slices).toHaveLength(2);
    for (const slice of slices) {
      expectSolidGeometry(slice);
      forEachVertex(slice, (_x, _y, z) => {
        expect(z).toBeGreaterThanOrEqual(slice.start - 1e-8);
        expect(z).toBeLessThanOrEqual(slice.end + 1e-8);
      });
    }
  });

  it('builds cylindrical slices as filled geometry inside the requested radius', () => {
    const cylinder: IntegralInput = {
      integrand: '1',
      coordinateSystem: 'cylindrical',
      variables: ['r', 'θ', 'z'],
      selectedOrder: 'dz dr dθ',
      bounds: {
        r: { lower: '0', upper: '1' },
        θ: { lower: '0', upper: '2*pi' },
        z: { lower: '0', upper: '1' },
      },
    };
    const slices = buildCoordinateSliceGeometries(parseIntegral(cylinder), {
      sliceVariable: 'z',
      sliceCount: 5,
      visibleSliceCount: 3,
      showAllSlices: true,
      resolution: 12,
    });

    expect(slices).toHaveLength(3);
    for (const slice of slices) {
      expectSolidGeometry(slice);
      forEachVertex(slice, (x, y, z) => {
        expect(Math.hypot(x, y)).toBeLessThanOrEqual(1 + 1e-8);
        expect(z).toBeGreaterThanOrEqual(slice.start - 1e-8);
        expect(z).toBeLessThanOrEqual(slice.end + 1e-8);
      });
    }
  });

  it('builds spherical slices as filled geometry inside the requested radius', () => {
    const slices = buildCoordinateSliceGeometries(parseIntegral(unitSphere), {
      sliceVariable: 'ρ',
      sliceCount: 4,
      visibleSliceCount: 4,
      showAllSlices: true,
      resolution: 12,
    });

    expect(slices).toHaveLength(4);
    for (const slice of slices) {
      expectSolidGeometry(slice);
      forEachVertex(slice, (x, y, z) => {
        const radius = Math.hypot(x, y, z);
        expect(radius).toBeGreaterThanOrEqual(slice.start - 1e-8);
        expect(radius).toBeLessThanOrEqual(slice.end + 1e-8);
      });
    }
  });

  it('keeps spherical theta-inner slices bounded and covering the full unit ball', () => {
    const thetaInner = { ...unitSphere, selectedOrder: 'dθ dφ dρ' };
    const slices = buildCoordinateSliceGeometries(parseIntegral(thetaInner), {
      sliceVariable: 'θ',
      sliceCount: 8,
      visibleSliceCount: 8,
      showAllSlices: true,
      resolution: 12,
    });

    expect(slices).toHaveLength(8);
    const extents = geometryExtents(slices);
    expect(extents.radiusMax).toBeLessThanOrEqual(1 + 1e-8);
    expect(extents.x[0]).toBeLessThan(-0.85);
    expect(extents.x[1]).toBeGreaterThan(0.85);
    expect(extents.y[0]).toBeLessThan(-0.85);
    expect(extents.y[1]).toBeGreaterThan(0.85);
    expect(extents.z[0]).toBeLessThan(-0.85);
    expect(extents.z[1]).toBeGreaterThan(0.85);
  });

  it('keeps spherical phi-inner slices bounded and covering both poles', () => {
    const phiInner = { ...unitSphere, selectedOrder: 'dφ dρ dθ' };
    const slices = buildCoordinateSliceGeometries(parseIntegral(phiInner), {
      sliceVariable: 'φ',
      sliceCount: 6,
      visibleSliceCount: 6,
      showAllSlices: true,
      resolution: 12,
    });

    expect(slices).toHaveLength(6);
    const extents = geometryExtents(slices);
    expect(extents.radiusMax).toBeLessThanOrEqual(1 + 1e-8);
    expect(extents.x[0]).toBeLessThan(-0.85);
    expect(extents.x[1]).toBeGreaterThan(0.85);
    expect(extents.y[0]).toBeLessThan(-0.85);
    expect(extents.y[1]).toBeGreaterThan(0.85);
    expect(extents.z[0]).toBeLessThan(-0.95);
    expect(extents.z[1]).toBeGreaterThan(0.95);
  });
});

describe('convertIntegralToCoordinateSystem', () => {
  it('updates a Cartesian tetrahedron integrand and bounds when switching to spherical', () => {
    const converted = convertIntegralToCoordinateSystem(
      {
        ...tetrahedron,
        integrand: 'x + y + z',
      },
      'spherical',
    );

    expect(converted.coordinateSystem).toBe('spherical');
    expect(converted.variables).toEqual(['ρ', 'θ', 'φ']);
    expect(converted.selectedOrder).toBe('dρ dφ dθ');
    expect(converted.integrand).toContain('ρ');
    expect(converted.integrand).toContain('sin(φ)');
    expect(converted.integrand).not.toContain('x');
    expect(converted.bounds.θ).toEqual({ lower: '0', upper: 'pi/2' });
    expect(converted.bounds.φ).toEqual({ lower: '0', upper: 'pi/2' });
    expect(converted.bounds.ρ.upper).toContain('sin(φ) * cos(θ)');
    expect(parseIntegral(converted).validationErrors).toEqual([]);
  });

  it('converts a full spherical ball to Cartesian bounds and variables', () => {
    const sphere: IntegralInput = {
      integrand: 'ρ^2 + sin(φ)',
      coordinateSystem: 'spherical',
      variables: ['ρ', 'θ', 'φ'],
      selectedOrder: 'dρ dφ dθ',
      bounds: {
        ρ: { lower: '0', upper: '2' },
        θ: { lower: '0', upper: '2*pi' },
        φ: { lower: '0', upper: 'pi' },
      },
    };

    const converted = convertIntegralToCoordinateSystem(sphere, 'cartesian');

    expect(converted.coordinateSystem).toBe('cartesian');
    expect(converted.variables).toEqual(['x', 'y', 'z']);
    expect(converted.selectedOrder).toBe('dz dy dx');
    expect(converted.integrand).toContain('sqrt');
    expect(converted.bounds.x).toEqual({ lower: '-2', upper: '2' });
    expect(converted.bounds.y.upper).toBe('sqrt(2^2 - x^2)');
    expect(converted.bounds.z.upper).toBe('sqrt(2^2 - x^2 - y^2)');
    expect(parseIntegral(converted).validationErrors).toEqual([]);
  });

  it('converts spherical integrands written with typed aliases', () => {
    const converted = convertIntegralToCoordinateSystem(
      {
        ...unitSphere,
        integrand: 'rho^2 + sin(phi) + cos(theta)',
      },
      'cartesian',
    );

    expect(converted.integrand).toContain('sqrt');
    expect(converted.integrand).toContain('acos');
    expect(converted.integrand).toContain('atan2');
    expect(parseIntegral(converted).validationErrors).toEqual([]);
  });
});

function expectSolidGeometry(slice: CoordinateSliceGeometry) {
  expect(slice.positions.length).toBeGreaterThan(0);
  expect(slice.indices.length).toBeGreaterThan(0);
  expect(slice.positions.length % 3).toBe(0);
  expect(slice.indices.length % 3).toBe(0);
  expect(slice.positions.every(Number.isFinite)).toBe(true);
  expect(slice.indices.every((index) => Number.isInteger(index) && index >= 0 && index < slice.positions.length / 3)).toBe(true);
}

function forEachVertex(slice: CoordinateSliceGeometry, visit: (x: number, y: number, z: number) => void) {
  for (let index = 0; index < slice.positions.length; index += 3) {
    visit(slice.positions[index], slice.positions[index + 1], slice.positions[index + 2]);
  }
}

function geometryExtents(slices: CoordinateSliceGeometry[]) {
  const extents = {
    x: [Infinity, -Infinity] as [number, number],
    y: [Infinity, -Infinity] as [number, number],
    z: [Infinity, -Infinity] as [number, number],
    radiusMax: 0,
  };
  for (const slice of slices) {
    expectSolidGeometry(slice);
    forEachVertex(slice, (x, y, z) => {
      extents.x = [Math.min(extents.x[0], x), Math.max(extents.x[1], x)];
      extents.y = [Math.min(extents.y[0], y), Math.max(extents.y[1], y)];
      extents.z = [Math.min(extents.z[0], z), Math.max(extents.z[1], z)];
      extents.radiusMax = Math.max(extents.radiusMax, Math.hypot(x, y, z));
    });
  }
  return extents;
}

describe('rewriteBoundsForOrder', () => {
  it('carries bound equations by integral position and renames dependencies', () => {
    const rewritten = rewriteBoundsForOrder(tetrahedron, ['x', 'z', 'y']);

    expect(rewritten.selectedOrder).toBe('dy dz dx');
    expect(rewritten.bounds.x).toEqual({ lower: '0', upper: '1' });
    expect(rewritten.bounds.z).toEqual({ lower: '0', upper: '1 - x' });
    expect(rewritten.bounds.y).toEqual({ lower: '0', upper: '1 - x - z' });
    expect(parseIntegral(rewritten).validationErrors).toEqual([]);
  });

  it('renames variables simultaneously when positions are exchanged', () => {
    const rewritten = rewriteBoundsForOrder(tetrahedron, ['y', 'x', 'z']);

    expect(rewritten.selectedOrder).toBe('dz dx dy');
    expect(rewritten.bounds.y).toEqual({ lower: '0', upper: '1' });
    expect(rewritten.bounds.x).toEqual({ lower: '0', upper: '1 - y' });
    expect(rewritten.bounds.z).toEqual({ lower: '0', upper: '1 - y - x' });
    expect(parseIntegral(rewritten).validationErrors).toEqual([]);
  });

  it('keeps spherical coordinate bounds attached to their coordinate variables', () => {
    const rewritten = rewriteBoundsForOrder(unitSphere, ['ρ', 'φ', 'θ']);

    expect(rewritten.selectedOrder).toBe('dθ dφ dρ');
    expect(rewritten.bounds.ρ).toEqual({ lower: '0', upper: '1' });
    expect(rewritten.bounds.θ).toEqual({ lower: '0', upper: '2*pi' });
    expect(rewritten.bounds.φ).toEqual({ lower: '0', upper: 'pi' });
    expect(parseIntegral(rewritten).validationErrors).toEqual([]);
  });
});
