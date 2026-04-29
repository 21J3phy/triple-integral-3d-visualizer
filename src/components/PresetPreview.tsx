import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { IntegralInput } from '../types';
import { parseIntegral, sampleRegion } from '../lib/integral';

interface PresetPreviewProps {
  input: IntegralInput;
}

const PREVIEW_SAMPLE_COUNT = 1200;
const PREVIEW_SIZE = 120;

export function PresetPreview({ input }: PresetPreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<{
    renderer: THREE.WebGLRenderer;
    frame: number;
  } | null>(null);

  useEffect(() => {
    if (!containerRef.current) return undefined;
    const container = containerRef.current;

    const parsed = parseIntegral(input);
    const sample = sampleRegion(parsed, PREVIEW_SAMPLE_COUNT);

    const scene = new THREE.Scene();
    scene.background = null;

    const camera = new THREE.PerspectiveCamera(40, 1, 0.01, 100);
    camera.position.set(3.2, 3, 2.8);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(PREVIEW_SIZE, PREVIEW_SIZE);
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);

    // Compute center of bounding box
    const bbox = sample.boundingBox;
    const cx = (bbox.x[0] + bbox.x[1]) / 2;
    const cy = (bbox.y[0] + bbox.y[1]) / 2;
    const cz = (bbox.z[0] + bbox.z[1]) / 2;
    camera.lookAt(cx, cy, cz);

    // Auto-fit: compute distance based on bounding box size
    const sx = bbox.x[1] - bbox.x[0];
    const sy = bbox.y[1] - bbox.y[0];
    const sz = bbox.z[1] - bbox.z[0];
    const maxSpan = Math.max(sx, sy, sz, 0.5);
    const dist = maxSpan * 1.9;
    const dir = new THREE.Vector3(1, 0.85, 0.9).normalize();
    camera.position.set(cx + dir.x * dist, cy + dir.y * dist, cz + dir.z * dist);
    camera.lookAt(cx, cy, cz);

    // Lighting
    scene.add(new THREE.HemisphereLight(0xffffff, 0xcdd8e5, 1.6));
    const directional = new THREE.DirectionalLight(0xffffff, 1.2);
    directional.position.set(3, 4, 5);
    scene.add(directional);

    // Point cloud
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(sample.points.length * 3);
    const colors = new Float32Array(sample.points.length * 3);
    const color = new THREE.Color();

    sample.points.forEach((point, index) => {
      positions[index * 3] = point.x;
      positions[index * 3 + 1] = point.y;
      positions[index * 3 + 2] = point.z;
      const zNorm = Math.abs(bbox.z[1] - bbox.z[0]) < 1e-9
        ? 0.5
        : Math.max(0, Math.min(1, (point.z - bbox.z[0]) / (bbox.z[1] - bbox.z[0])));
      color.setHSL(0.56 - zNorm * 0.24, 0.72, 0.55);
      colors[index * 3] = color.r;
      colors[index * 3 + 1] = color.g;
      colors[index * 3 + 2] = color.b;
    });

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const material = new THREE.PointsMaterial({
      size: 0.06,
      vertexColors: true,
      transparent: true,
      opacity: 0.82,
      depthWrite: false,
    });
    const cloud = new THREE.Points(geometry, material);
    scene.add(cloud);

    // Slow rotation
    let angle = 0;
    let frame = 0;
    const animate = () => {
      angle += 0.006;
      const r = dist;
      camera.position.set(
        cx + Math.cos(angle) * r * 0.75,
        cy + dir.y * r,
        cz + Math.sin(angle) * r * 0.75,
      );
      camera.lookAt(cx, cy, cz);
      renderer.render(scene, camera);
      frame = window.requestAnimationFrame(animate);
    };
    animate();

    sceneRef.current = { renderer, frame };

    return () => {
      window.cancelAnimationFrame(frame);
      geometry.dispose();
      material.dispose();
      renderer.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      sceneRef.current = null;
    };
  }, [input]);

  return <div className="preset-preview" ref={containerRef} />;
}
