// Real Blackwell Hall model, reused from HAVEN (Haven_Dev-main: src/components/real-building.tsx,
// public/models/blackwell-*.glb, src/lib/blackwell-twin.json). Two meshopt GLBs, ~160K triangles:
// a ghosted facade shell and the floor plates. Mounted once, rendered on demand.
'use client';

import { useEffect, useLayoutEffect } from 'react';
import { useThree } from '@react-three/fiber';
import { useGLTF } from '@react-three/drei';
import { Mesh, type Material, type Object3D } from 'three';
import { levelY, type Point3 } from '@/lib/haven/config';
import twin from './blackwell-twin.json';

export const BLACKWELL_URLS = ['/models/blackwell-shell.glb', '/models/blackwell-interior.glb'];
/** Whole-building orbit centre and home camera, in Blackwell metres (model z = -spec y). */
export const BLACKWELL_CENTER: Point3 = [23, 9, -34];
export const BLACKWELL_HOME: Point3 = [-62, 78, 46];

const levelIndex = (id: string) => twin.levels.find((l) => l.id === id)?.index ?? 0;
export const blackwellElevation = (floor: number) =>
  twin.levels.find((l) => l.id === `L${floor}`)?.elevation ?? 0;

/**
 * The dashboard's monitoring points and routes are authored on the six-level sample topology
 * (12 x 6.4 units, 1.45 units per level). This projects them onto Blackwell's south bar
 * (x 0–40 m, spec y 0–14 m) and its real level elevations. It is a placement mapping for the demo,
 * not surveyed Blackwell sensor or route positions.
 */
const X0 = 20;
const XS = 3.3;
const Z0 = -7;
const ZS = 2.2;
const LEVEL_SCALE = 2.1;
export const MARKER_SCALE = 3;
export function toBlackwell([x, y, z]: Point3): Point3 {
  const floor = Math.min(7, Math.max(1, Math.round((y - levelY(1)) / 1.45) + 1));
  return [X0 + x * XS, blackwellElevation(floor) + (y - levelY(floor)) * LEVEL_SCALE, Z0 + z * ZS];
}
export const scaleFootprint = ([w, d]: [number, number]): [number, number] => [w * XS, d * ZS];

const levelOfNode = (name: string) =>
  name.startsWith('level_')
    ? name.slice(6)
    : (/(?:^|[_-])(B1|L\d)(?:[_-]|$)/.exec(name)?.[1] ?? null);

/** Cutaway: with a floor isolated, it and the floors below stay visible; the roof and upper floors hide. */
function applyLevels(root: Object3D, floor: number | null) {
  for (const child of root.children) {
    const level = levelOfNode(child.name);
    child.visible =
      floor === null || level === null || (level !== 'roof' && levelIndex(level) <= floor);
  }
}

export function BlackwellModel({ floor }: { floor: number | null }) {
  const [shell, interior] = useGLTF(BLACKWELL_URLS, false, true) as unknown as {
    scene: Object3D;
  }[];
  const { invalidate } = useThree();
  // One-time material setup: the facade becomes a light ghost so floors and overlays read through it.
  useLayoutEffect(() => {
    shell.scene.traverse((node) => {
      if (!(node instanceof Mesh)) return;
      const materials = (
        Array.isArray(node.material) ? node.material : [node.material]
      ) as Material[];
      materials.forEach((m) => {
        m.transparent = true;
        m.opacity = 0.16;
        m.depthWrite = false;
        m.forceSinglePass = true;
      });
      node.renderOrder = 2;
      node.raycast = () => undefined;
    });
    interior.scene.traverse((node) => {
      if (node instanceof Mesh) node.raycast = () => undefined;
    });
    invalidate();
  }, [shell, interior, invalidate]);
  useEffect(() => {
    applyLevels(shell.scene, floor);
    applyLevels(interior.scene, floor);
    invalidate();
  }, [shell, interior, floor, invalidate]);
  return (
    <>
      <primitive object={interior.scene} />
      <primitive object={shell.scene} />
    </>
  );
}

useGLTF.preload(BLACKWELL_URLS, false, true);
