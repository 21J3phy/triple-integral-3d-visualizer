# Triple Integral 3D Visualizer

An interactive multivariable calculus tool for building, rearranging, and visualizing triple integrals in 3D.

The app lets students edit integration bounds, drag integrals to change the order of integration, switch between Cartesian, cylindrical, and spherical coordinates, and inspect sampled 3D regions with adjustable cross-section slices. It also estimates the region volume and integral value from the sampled points.

## Features

- Editable bounds and integrands using math expressions such as `sqrt(1 - x^2)` and `2*pi`
- Drag-and-drop integration order changes with rewritten bounds
- Cartesian, cylindrical, and spherical coordinate modes
- Preset regions for common examples, including a unit box, tetrahedron, cylinder, paraboloid cap, unit cylinder, and unit sphere
- 3D region rendering powered by Three.js
- Adjustable cross-section slice count and visible slice controls
- Live validation messages and numerical estimates

## Tech Stack

- React
- TypeScript
- Vite
- Three.js
- mathjs
- Vitest

## Getting Started

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Build for production:

```bash
npm run build
```

Run tests:

```bash
npm test
```

## Project Structure

```text
src/
  components/       3D visualization components
  lib/              Integral parsing, sampling, bounds, coordinates, and presets
  App.tsx           Main application UI
  main.tsx          React entry point
  styles.css        Application styling
```

## Notes

The numerical estimate is sample-based, so it is best used for visual intuition and quick checking rather than exact symbolic integration.
