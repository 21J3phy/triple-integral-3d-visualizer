import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { IntegralInput } from '../types';
import { parseIntegral, sampleRegion } from '../lib/integral';
import { buildCoordinateSliceGeometries } from '../lib/sliceGeometry';
import { orderToInnerOuter } from '../lib/orders';

interface PresetPreviewProps {
  input: IntegralInput;
}

const PREVIEW_SIZE = 120;
const PREVIEW_RESOLUTION = 24;

export function PresetPreview({ input }: PresetPreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<{
    renderer: THREE.WebGLRenderer;
  } | null>(null);

  useEffect(() => {
    if (!containerRef.current) return undefined;
    const container = containerRef.current;

    const parsed = parseIntegral(input);
    const sample = sampleRegion(parsed, 100); // Low sample just for bounding box

    const scene = new THREE.Scene();
    scene.background = null;

    const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 100);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(PREVIEW_SIZE, PREVIEW_SIZE);
    container.appendChild(renderer.domElement);

    // Compute center of bounding box
    const bbox = sample.boundingBox;
    const cx = (bbox.x[0] + bbox.x[1]) / 2;
    const cy = (bbox.y[0] + bbox.y[1]) / 2;
    const cz = (bbox.z[0] + bbox.z[1]) / 2;

    // Auto-fit: compute distance based on bounding box size
    const sx = bbox.x[1] - bbox.x[0];
    const sy = bbox.y[1] - bbox.y[0];
    const sz = bbox.z[1] - bbox.z[0];
    const maxSpan = Math.max(sx, sy, sz, 0.5);
    const dist = maxSpan * 2.2;
    camera.position.set(cx + dist * 0.75, cy + dist * 0.7, cz + dist * 0.9);
    camera.lookAt(cx, cy, cz);

    // Lighting
    scene.add(new THREE.HemisphereLight(0xffffff, 0xcdd8e5, 1.8));
    const directional = new THREE.DirectionalLight(0xffffff, 1.2);
    directional.position.set(3, 4, 5);
    scene.add(directional);

    // Solid Meshes
    const slices = buildCoordinateSliceGeometries(parsed, {
      sliceVariable: orderToInnerOuter(input.selectedOrder)[0],
      sliceCount: 1,
      visibleSliceCount: 1,
      showAllSlices: true,
      resolution: PREVIEW_RESOLUTION,
    });

    const meshes: THREE.Mesh[] = [];
    slices.forEach((slice) => {
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(slice.positions, 3));
      geometry.setIndex(slice.indices);
      geometry.computeVertexNormals();

      const material = new THREE.MeshStandardMaterial({
        color: 0x4a90e2,
        roughness: 0.6,
        metalness: 0.1,
        side: THREE.DoubleSide,
      });

      const mesh = new THREE.Mesh(geometry, material);
      scene.add(mesh);
      meshes.push(mesh);
    });

    renderer.render(scene, camera);

    sceneRef.current = { renderer };

    return () => {
      meshes.forEach((mesh) => {
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      });
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      sceneRef.current = null;
    };
  }, [input]);

  return <div className="preset-preview" ref={containerRef} />;
}
