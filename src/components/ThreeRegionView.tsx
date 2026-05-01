import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { BoundOrder, ParsedIntegral, Point3, RegionSample } from '../types';
import { orderToInnerOuter } from '../lib/orders';
import { buildCoordinateSliceGeometries } from '../lib/sliceGeometry';

type Axis = keyof Point3;

interface ThreeRegionViewProps {
  sample: RegionSample;
  parsed: ParsedIntegral;
  order: BoundOrder;
  opacity: number;
  sliceCount: number;
  visibleSliceCount: number;
  showSlice: boolean;
  showAllSlices: boolean;
}

const AXIS_COLORS: Record<Axis, number> = {
  x: 0xd34a32,
  y: 0x26885b,
  z: 0x286fc7,
};

const Z_UP = new THREE.Vector3(0, 0, 1);

export function ThreeRegionView({
  sample,
  parsed,
  order,
  opacity,
  sliceCount,
  visibleSliceCount,
  showSlice,
  showAllSlices,
}: ThreeRegionViewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<{
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    renderer: THREE.WebGLRenderer;
    controls: OrbitControls;
    cloud?: THREE.Points;
    sliceMeshes?: THREE.Mesh[];
    frame?: number;
  } | null>(null);

  const renderedPoints = useMemo(() => {
    if (!showSlice) return sample.points;
    return [];
  }, [sample.points, showSlice]);

  const sliceGeometries = useMemo(() => {
    if (!showSlice) return [];
    return buildCoordinateSliceGeometries(parsed, {
      sliceVariable: orderToInnerOuter(order)[0],
      sliceCount,
      visibleSliceCount,
      showAllSlices,
    });
  }, [order, parsed, showAllSlices, showSlice, sliceCount, visibleSliceCount]);

  useEffect(() => {
    if (!containerRef.current) return undefined;

    const container = containerRef.current;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf7f9fb);
    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
    camera.up.copy(Z_UP);
    camera.position.set(4.5, 4.2, 3.8);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(container.clientWidth, container.clientHeight);
    container.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;

    scene.add(new THREE.HemisphereLight(0xffffff, 0xcdd8e5, 1.75));
    const directional = new THREE.DirectionalLight(0xffffff, 1.4);
    directional.position.set(3, 4, 5);
    scene.add(directional);
    const grid = new THREE.GridHelper(6, 12, 0xd6dee8, 0xe7edf3);
    grid.rotation.x = Math.PI / 2;
    scene.add(grid);

    addAxes(scene);

    const resize = () => {
      if (!container.clientWidth || !container.clientHeight) return;
      camera.aspect = container.clientWidth / container.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(container.clientWidth, container.clientHeight);
    };
    resize();
    window.addEventListener('resize', resize);

    let frame = 0;
    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      frame = window.requestAnimationFrame(animate);
    };
    animate();

    sceneRef.current = { scene, camera, renderer, controls, frame };

    return () => {
      window.removeEventListener('resize', resize);
      window.cancelAnimationFrame(frame);
      controls.dispose();
      renderer.dispose();
      container.removeChild(renderer.domElement);
      sceneRef.current = null;
    };
  }, []);

  useEffect(() => {
    const current = sceneRef.current;
    if (!current) return;
    if (current.cloud) {
      current.scene.remove(current.cloud);
      current.cloud.geometry.dispose();
      const material = current.cloud.material;
      if (Array.isArray(material)) material.forEach((item) => item.dispose());
      else material.dispose();
    }

    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(renderedPoints.length * 3);
    const colors = new Float32Array(renderedPoints.length * 3);
    const bbox = sample.boundingBox;
    const color = new THREE.Color();

    renderedPoints.forEach((point, index) => {
      positions[index * 3] = point.x;
      positions[index * 3 + 1] = point.y;
      positions[index * 3 + 2] = point.z;
      const zMix = normalize(point.z, bbox.z[0], bbox.z[1]);
      color.setHSL(0.56 - zMix * 0.24, 0.72, 0.5);
      colors[index * 3] = color.r;
      colors[index * 3 + 1] = color.g;
      colors[index * 3 + 2] = color.b;
    });

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({
      size: 0.045,
      vertexColors: true,
      transparent: true,
      opacity,
      depthWrite: false,
    });
    current.cloud = new THREE.Points(geometry, material);
    current.scene.add(current.cloud);
    current.controls.target.set(centerOf(bbox.x), centerOf(bbox.y), centerOf(bbox.z));
  }, [opacity, renderedPoints, sample.boundingBox]);

  useEffect(() => {
    const current = sceneRef.current;
    if (!current) return;
    disposeSliceMeshes(current);
    if (!showSlice || !sliceGeometries.length) return;

    const variable = orderToInnerOuter(order)[0];
    const variableIndex = sample.variables.indexOf(variable);
    const sliceColor = new THREE.Color(colorForVariableIndex(variableIndex));
    const sliceObjects: THREE.Mesh[] = [];
    sliceGeometries.forEach((slice, index) => {
      const color = sliceColor.clone().offsetHSL(0, -0.08, showAllSlices ? (index / Math.max(sliceGeometries.length - 1, 1) - 0.5) * 0.14 : 0);
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(slice.positions, 3));
      geometry.setIndex(slice.indices);
      geometry.computeVertexNormals();
      const material = new THREE.MeshStandardMaterial({
        color,
        transparent: false,
        opacity: 1,
        side: THREE.DoubleSide,
        depthWrite: true,
        roughness: 0.72,
        metalness: 0,
      });
      const mesh = new THREE.Mesh(geometry, material);
      current.scene.add(mesh);
      sliceObjects.push(mesh);
    });
    current.sliceMeshes = sliceObjects;
  }, [order, sample.variables, showAllSlices, showSlice, sliceGeometries]);

  return (
    <div className="viewer-wrap">
      <div className="viewer" ref={containerRef} />
      {!sample.points.length && <div className="viewer-empty">Enter valid bounds to render a region.</div>}
    </div>
  );
}

function addAxes(scene: THREE.Scene) {
  const length = 3;
  for (const variable of ['x', 'y', 'z'] as Axis[]) {
    const direction =
      variable === 'x' ? new THREE.Vector3(1, 0, 0) : variable === 'y' ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
    const arrow = new THREE.ArrowHelper(direction, new THREE.Vector3(0, 0, 0), length, AXIS_COLORS[variable], 0.16, 0.08);
    scene.add(arrow);
    const sprite = axisLabel(variable);
    sprite.position.copy(direction.multiplyScalar(length + 0.28));
    scene.add(sprite);
  }
}

function axisLabel(variable: Axis): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 96;
  canvas.height = 96;
  const context = canvas.getContext('2d')!;
  context.fillStyle = '#172033';
  context.font = '700 54px Inter, Arial, sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(variable, 48, 48);
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(0.38, 0.38, 0.38);
  return sprite;
}

function normalize(value: number, min: number, max: number) {
  if (Math.abs(max - min) < 1e-9) return 0.5;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

function centerOf(range: [number, number]) {
  return (range[0] + range[1]) / 2;
}

function axisForVariableIndex(index: number): Axis | null {
  return index === 0 ? 'x' : index === 1 ? 'y' : index === 2 ? 'z' : null;
}

function colorForVariableIndex(index: number): number {
  const axis = axisForVariableIndex(index) ?? 'z';
  return AXIS_COLORS[axis];
}

function disposeSliceMeshes(current: { scene: THREE.Scene; sliceMeshes?: THREE.Mesh[] }) {
  for (const mesh of current.sliceMeshes ?? []) {
    current.scene.remove(mesh);
    mesh.geometry.dispose();
    const material = mesh.material;
    if (Array.isArray(material)) material.forEach((item) => item.dispose());
    else material.dispose();
  }
  current.sliceMeshes = undefined;
}
