'use client';
// Detailed 3D model of one concept on the real Vexcel aerial of the site. Everything is built from the same
// geometry as the 2D plan: storeys, individual racks, aisle containment, cable trays, equipment in each room, outdoor plant.
// In edit mode the building and each outdoor item can be dragged; the parent re-checks the numbers on release.
import { Component, Suspense, lazy, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Canvas, useLoader, useThree, type ThreeEvent } from '@react-three/fiber';
import { Line, OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { vexcelOrthoUrl } from '@/lib/plotstar-api';
import type { Concept, Room, RoomType } from './types';
import { ROUTE_COLOR } from './types';
import type { Layers } from './plan2d';

const VexcelContext = lazy(() => import('./vexcel-context'));

const WALL = 4.2;
const FLOOR: Record<RoomType, string> = {
  data_hall: '#dde5dc', electrical: '#efe2c4', battery: '#ecd3c8', mechanical: '#cfe1ea', corridor: '#c6d4c1', support: '#e4e0ee',
  network: '#dbd3ea', loading: '#e6e0d0', reserve: '#eef0ea', yard_sub: '#b9bdb6', yard_gen: '#cfc8b4', yard_cool: '#c5d6de',
  yard_water: '#c9d6dc', yard_bess: '#d6dad3', yard_solar: '#c9d3c4', yard_parking: '#565b58', yard_wall: '#aab1aa',
  yard_trees: '#b7c9ae', yard_guard: '#cfc8b4',
};
/** Rough height of what stands on each outdoor item, used only for its ground shadow. */
const SHADOW_H: Partial<Record<RoomType, number>> = { yard_sub: 3.6, yard_cool: 2.6, yard_water: 8, yard_bess: 2.9, yard_solar: 3.7, yard_wall: 6, yard_trees: 6, yard_guard: 3.5 };
/** One box in site coordinates: x east, y north, z up (metres), from its minimum corner. */
interface B { x: number; y: number; z: number; w: number; d: number; h: number; color: string; code?: string }
interface Cyl { x: number; y: number; r: number; h: number; color: string }
interface Rect { x: number; y: number; w: number; d: number }
export interface MoveEdit { code: string; dx: number; dy: number }
export type ViewPreset = { preset: 'iso' | 'top'; n: number };

/** Deterministic 0..1 value, so dressing (cars, trees) does not change between renders. */
const rnd = (a: number, b: number) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };

function fill(out: B[], r: Room, z: number, u: { w: number; d: number; h: number; color: string }, max: number, aisle = 1.4) {
  const m = 1.2, along = r.w >= r.d;
  const len = (along ? r.w : r.d) - 2 * m, span = (along ? r.d : r.w) - 2 * m;
  if (len < u.w || span < u.d) return;
  const perRow = Math.floor(len / (u.w + 0.06)), rows = Math.max(1, Math.floor((span + aisle) / (u.d + aisle)));
  let n = 0;
  for (let j = 0; j < rows && n < max; j++)
    for (let i = 0; i < perRow && n < max; i++, n++) {
      const a = m + i * (u.w + 0.06), b = m + j * (u.d + aisle);
      out.push(along ? { x: r.x + a, y: r.y + b, z: z + 0.12, w: u.w, d: u.d, h: u.h, color: u.color, code: r.code }
        : { x: r.x + b, y: r.y + a, z: z + 0.12, w: u.d, d: u.w, h: u.h, color: u.color, code: r.code });
    }
}

function buildBuilding(c: Concept, racks: boolean, only: number | null, zOf: (level: number) => number) {
  const solid: B[] = [], glass: B[] = [], glow: B[] = [];
  const t = 0.25, b = c.building;
  const levels = Array.from({ length: b.storeys }, (_, i) => i).filter((l) => only === null || l === only);
  for (const r of c.rooms) {
    const lvl = r.level ?? 0;
    if (!levels.includes(lvl)) continue;
    const z = zOf(lvl);
    solid.push({ x: r.x, y: r.y, z, w: r.w, d: r.d, h: 0.12, color: FLOOR[r.type], code: r.code });
    if (r.type === 'corridor' || r.type === 'reserve') continue;
    for (const w of [{ x: r.x, y: r.y, w: r.w, d: t }, { x: r.x, y: r.y + r.d - t, w: r.w, d: t }, { x: r.x, y: r.y, w: t, d: r.d }, { x: r.x + r.w - t, y: r.y, w: t, d: r.d }])
      solid.push({ ...w, z, h: WALL, color: '#eceee9', code: r.code });
    if (r.type === 'data_hall' && racks) {
      const rows = r.rows ?? [];
      rows.forEach((w, j) => {
        const unit = (w.v ? w.d : w.w) / w.cap, nx = rows[j + 1];
        for (let i = 0; i < w.n; i++)
          solid.push(w.v ? { x: w.x, y: w.y + i * unit + 0.02, z: z + 0.12, w: w.w, d: unit - 0.04, h: 2.1, color: i % 9 === 4 ? '#2c353b' : '#1d2327', code: r.code }
            : { x: w.x + i * unit + 0.02, y: w.y, z: z + 0.12, w: unit - 0.04, d: w.d, h: 2.1, color: i % 9 === 4 ? '#2c353b' : '#1d2327', code: r.code });
        if (w.n) {
          const used = unit * w.n;
          glow.push(w.v ? { x: w.x + w.w - 0.03, y: w.y, z: z + 1.85, w: 0.05, d: used, h: 0.07, color: '#58c8ff' } : { x: w.x, y: w.y + w.d - 0.03, z: z + 1.85, w: used, d: 0.05, h: 0.07, color: '#58c8ff' });
          solid.push(w.v ? { x: w.x + 0.35, y: w.y, z: z + 2.55, w: 0.5, d: w.d, h: 0.08, color: '#d7a23c', code: r.code } : { x: w.x, y: w.y + 0.35, z: z + 2.55, w: w.w, d: 0.5, h: 0.08, color: '#d7a23c', code: r.code });
        }
        if (j % 2 === 0 && nx && w.n && nx.n)
          glass.push(w.v ? { x: w.x + w.w, y: w.y, z: z + 0.12, w: nx.x - w.x - w.w, d: w.d, h: 2.25, color: '#7fc4e8' } : { x: w.x, y: w.y + w.d, z: z + 0.12, w: w.w, d: nx.y - w.y - w.d, h: 2.25, color: '#7fc4e8' });
      });
    } else if (r.type === 'electrical') {
      if (r.code.startsWith('SWG')) fill(solid, r, z, { w: 1.0, d: 1.6, h: 2.3, color: '#8d9398' }, 24);
      else fill(solid, r, z, { w: 0.8, d: 0.9, h: 2.0, color: '#5f7384' }, 40);
    } else if (r.type === 'battery') fill(solid, r, z, { w: 0.6, d: 1.0, h: 1.9, color: '#3f6b54' }, 60, 1.2);
    else if (r.type === 'mechanical') {
      fill(solid, r, z, { w: 1.4, d: 2.2, h: 2.2, color: '#4f86a6' }, 20, 2);
      const along = r.w >= r.d;
      for (const k of [0.35, 0.65])
        solid.push(along ? { x: r.x + 0.8, y: r.y + r.d * k, z: z + 3.1, w: r.w - 1.6, d: 0.32, h: 0.32, color: '#2f7fb0', code: r.code }
          : { x: r.x + r.w * k, y: r.y + 0.8, z: z + 3.1, w: 0.32, d: r.d - 1.6, h: 0.32, color: '#2f7fb0', code: r.code });
    } else if (r.type === 'network') fill(solid, r, z, { w: 0.6, d: 1.0, h: 2.1, color: '#3a3350' }, 16);
    else if (r.type === 'loading') fill(solid, r, z, { w: 1.2, d: 1.2, h: 1.1, color: '#c9a24a' }, 14, 2.6);
    else if (r.type === 'support') {
      fill(solid, r, z, { w: 1.6, d: 0.8, h: 0.75, color: '#b6a888' }, r.code.startsWith('NOC') ? 12 : r.code.startsWith('SEC') ? 3 : 24, 2);
      if (r.code.startsWith('NOC')) glow.push({ x: r.x + 0.6, y: r.y + r.d - 0.5, z: z + 1.1, w: Math.min(r.w - 1.2, 9), d: 0.1, h: 1.9, color: '#3ea6ff' });
    }
  }
  // structure: a slab under every upper storey, and the outer wall of each storey with a darker base band
  const e = 0.45, hx = WALL + 0.8;
  for (const lvl of levels) {
    const z = zOf(lvl);
    if (lvl > 0) solid.push({ x: b.x - e, y: b.y - e, z: z - 0.45, w: b.w + 2 * e, d: b.d + 2 * e, h: 0.45, color: '#a8afa7' });
    for (const w of [{ x: b.x - e, y: b.y - e, w: b.w + 2 * e, d: e }, { x: b.x - e, y: b.y + b.d, w: b.w + 2 * e, d: e }, { x: b.x - e, y: b.y, w: e, d: b.d }, { x: b.x + b.w, y: b.y, w: e, d: b.d }]) {
      solid.push({ ...w, z, h: hx, color: '#d2d8cf' });
      solid.push({ x: w.x - 0.06, y: w.y - 0.06, z, w: w.w + 0.12, d: w.d + 0.12, h: 0.7, color: '#8f988f' });
    }
  }
  return { solid, glass, glow };
}

function buildRoof(c: Concept, z: number) {
  const b = c.building, out: B[] = [];
  const mx = b.w * 0.11, my = b.d * 0.11; // panels on the central ~60% of the roof
  for (let y = b.y + my; y + 3.6 < b.y + b.d - my; y += 4.4)
    for (let x = b.x + mx; x + 5.8 < b.x + b.w - mx; x += 6.2) out.push({ x, y, z, w: 5.8, d: 3.6, h: 0.1, color: '#1f3a5f' });
  return out;
}

function buildYard(r: Room, c: Concept) {
  const solid: B[] = [{ x: r.x, y: r.y, z: 0, w: r.w, d: r.d, h: r.type === 'yard_wall' ? 0.02 : 0.1, color: FLOOR[r.type], code: r.code }];
  const cyl: Cyl[] = [], cones: Cyl[] = [], shadows: (Rect & { h: number })[] = [];
  const grid = (uw: number, ud: number, gx: number, gy: number, max: number, each: (x: number, y: number, n: number) => void) => {
    let n = 0;
    for (let y = r.y + 1.5; y + ud <= r.y + r.d - 1 && n < max; y += ud + gy)
      for (let x = r.x + 1.5; x + uw <= r.x + r.w - 1 && n < max; x += uw + gx, n++) each(x, y, n);
  };
  if (SHADOW_H[r.type]) shadows.push({ x: r.x, y: r.y, w: r.w, d: r.d, h: SHADOW_H[r.type]! });
  if (r.type === 'yard_gen') {
    for (const g of c.equipment) {
      solid.push({ x: g.x - 0.15, y: g.y, z: 0.1, w: g.w + 0.3, d: g.d, h: 0.6, color: '#3b3f3c', code: r.code });
      solid.push({ x: g.x, y: g.y + 0.2, z: 0.7, w: g.w, d: g.d - 0.4, h: 2.9, color: '#e3ddcb', code: r.code });
      solid.push({ x: g.x + 0.1, y: g.y + 0.2, z: 0.9, w: g.w - 0.2, d: 0.12, h: 2.3, color: '#8f978f', code: r.code });
      solid.push({ x: g.x + g.w / 2 - 0.25, y: g.y + g.d - 2.2, z: 3.6, w: 0.5, d: 0.5, h: 1.7, color: '#2b2f2d', code: r.code });
      shadows.push({ x: g.x, y: g.y, w: g.w, d: g.d, h: 3.6 });
    }
  } else if (r.type === 'yard_sub') {
    const along = r.w >= r.d, n = Math.max(2, Math.min(4, Math.round((r.w * r.d) / 500)));
    for (let i = 0; i < n; i++) {
      const f = (i + 0.5) / n;
      const tx = along ? r.x + r.w * f - 2 : r.x + r.w / 2 - 2, ty = along ? r.y + r.d / 2 - 2.5 : r.y + r.d * f - 2.5;
      solid.push({ x: tx, y: ty, z: 0.1, w: 4, d: 5, h: 3.6, color: '#6f7d74', code: r.code });
      solid.push({ x: tx - 0.8, y: ty + 0.4, z: 0.4, w: 0.7, d: 4.2, h: 2.8, color: '#58645c', code: r.code }, { x: tx + 4.1, y: ty + 0.4, z: 0.4, w: 0.7, d: 4.2, h: 2.8, color: '#58645c', code: r.code });
      for (const k of [0.8, 1.85, 2.9]) solid.push({ x: tx + k, y: ty + 2.3, z: 3.7, w: 0.3, d: 0.3, h: 1.6, color: '#cfc7b3', code: r.code });
    }
    const gy = r.y + r.d - 3;
    solid.push({ x: r.x + 3, y: gy, z: 0.1, w: 0.4, d: 0.4, h: 9, color: '#8a918b', code: r.code }, { x: r.x + r.w - 3.4, y: gy, z: 0.1, w: 0.4, d: 0.4, h: 9, color: '#8a918b', code: r.code },
      { x: r.x + 3, y: gy, z: 8.8, w: r.w - 6, d: 0.4, h: 0.4, color: '#8a918b', code: r.code });
    for (const w of [{ x: r.x, y: r.y, w: r.w, d: 0.1 }, { x: r.x, y: r.y + r.d - 0.1, w: r.w, d: 0.1 }, { x: r.x, y: r.y, w: 0.1, d: r.d }, { x: r.x + r.w - 0.1, y: r.y, w: 0.1, d: r.d }])
      solid.push({ ...w, z: 0.1, h: 2.4, color: '#7b857e', code: r.code });
  } else if (r.type === 'yard_cool') {
    grid(2.4, 6, 1.4, 1.6, 80, (x, y) => {
      solid.push({ x, y, z: 0.1, w: 2.4, d: 6, h: 2.5, color: '#dfe7ea', code: r.code });
      for (const k of [0.6, 3.5]) solid.push({ x: x + 0.3, y: y + k, z: 2.6, w: 1.8, d: 1.8, h: 0.12, color: '#2e3b42', code: r.code });
    });
  } else if (r.type === 'yard_water') cyl.push({ x: r.x + r.w / 2, y: r.y + r.d / 2, r: Math.max(1, Math.min(r.w, r.d) / 2 - 1), h: r.h ?? 8, color: '#c9d9e2' });
  else if (r.type === 'yard_bess') {
    grid(6, 2.4, 1.6, 1.4, 60, (x, y) => {
      solid.push({ x, y, z: 0.1, w: 6, d: 2.4, h: 2.9, color: '#f4f5f2', code: r.code });
      solid.push({ x: x + 0.2, y: y - 0.03, z: 0.4, w: 1.4, d: 0.06, h: 2.2, color: '#3b8f5e', code: r.code });
    });
  } else if (r.type === 'yard_solar') {
    for (const [px, py] of [[0.5, 0.5], [r.w - 0.8, 0.5], [0.5, r.d - 0.8], [r.w - 0.8, r.d - 0.8], [r.w / 2, 0.5], [r.w / 2, r.d - 0.8]])
      solid.push({ x: r.x + px, y: r.y + py, z: 0.1, w: 0.25, d: 0.25, h: 3.6, color: '#8a918b', code: r.code });
    for (let y = r.y + 0.2; y + 3.6 <= r.y + r.d; y += 3.9)
      for (let x = r.x + 0.2; x + 5.8 <= r.x + r.w; x += 6.0) solid.push({ x, y, z: 3.7, w: 5.8, d: 3.6, h: 0.1, color: '#1f3a5f', code: r.code });
  } else if (r.type === 'yard_parking') {
    const along = r.w >= r.d; // stalls 2.6 m wide in two rows along the long side
    const n = Math.floor(((along ? r.w : r.d) - 1) / 2.6);
    for (let i = 0; i <= n; i++) {
      const a = 0.5 + i * 2.6;
      for (const side of [0, 1]) {
        const off = side ? (along ? r.d : r.w) - 5.4 : 0.4;
        solid.push(along ? { x: r.x + a, y: r.y + off, z: 0.1, w: 0.12, d: 5, h: 0.02, color: '#e9ece8', code: r.code } : { x: r.x + off, y: r.y + a, z: 0.1, w: 5, d: 0.12, h: 0.02, color: '#e9ece8', code: r.code });
        if (i < n && rnd(i, side + r.x) < 0.45) {
          const col = ['#c7ccd1', '#2f3a44', '#8d1f1f', '#e9ebe8', '#3d5a80'][Math.floor(rnd(i + 7, side) * 5)];
          solid.push(along ? { x: r.x + a + 0.45, y: r.y + off + 0.4, z: 0.12, w: 1.8, d: 4.2, h: 1.35, color: col, code: r.code } : { x: r.x + off + 0.4, y: r.y + a + 0.45, z: 0.12, w: 4.2, d: 1.8, h: 1.35, color: col, code: r.code });
        }
      }
    }
  } else if (r.type === 'yard_wall') {
    solid.push({ x: r.x, y: r.y, z: 0, w: r.w, d: r.d, h: 6, color: '#b5bcb4', code: r.code });
    const along = r.w >= r.d;
    for (let a = 0; a <= (along ? r.w : r.d); a += 5)
      solid.push(along ? { x: r.x + a - 0.15, y: r.y - 0.15, z: 0, w: 0.3, d: r.d + 0.3, h: 6.2, color: '#8f988f', code: r.code } : { x: r.x - 0.15, y: r.y + a - 0.15, z: 0, w: r.w + 0.3, d: 0.3, h: 6.2, color: '#8f988f', code: r.code });
  } else if (r.type === 'yard_trees') {
    for (let y = r.y + 3; y < r.y + r.d - 1; y += 6)
      for (let x = r.x + 3; x < r.x + r.w - 1; x += 6) {
        const jx = (rnd(x, y) - 0.5) * 2.4, jy = (rnd(y, x) - 0.5) * 2.4, s = 0.8 + rnd(x + 3, y + 5) * 0.5;
        cones.push({ x: x + jx, y: y + jy, r: 2.3 * s, h: 6.5 * s, color: rnd(x, y + 1) < 0.5 ? '#4f7f55' : '#5f8f5c' });
      }
  } else if (r.type === 'yard_guard') {
    solid.push({ x: r.x + 0.5, y: r.y + 0.5, z: 0.1, w: r.w - 1, d: r.d - 1, h: 3, color: '#e3ddcb', code: r.code });
    solid.push({ x: r.x, y: r.y, z: 3.1, w: r.w, d: r.d, h: 0.25, color: '#59625c', code: r.code });
    solid.push({ x: r.x + r.w, y: r.y + r.d / 2, z: 1, w: 6, d: 0.14, h: 0.14, color: '#c8322b', code: r.code });
  }
  return { solid, cyl, cones, shadows };
}

function Boxes({ boxes, cx, cz, kind = 'solid', onPick, onDown }: {
  boxes: B[]; cx: number; cz: number; kind?: 'solid' | 'glass' | 'glow'; onPick?: (code: string | null) => void;
  onDown?: (e: ThreeEvent<PointerEvent>, code: string | undefined) => void;
}) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), col = new THREE.Color();
    boxes.forEach((b, i) => {
      m.compose(new THREE.Vector3(b.x + b.w / 2 - cx, b.z + b.h / 2, cz - (b.y + b.d / 2)), q, new THREE.Vector3(b.w, b.h, b.d));
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, col.set(b.color));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [boxes, cx, cz]);
  if (!boxes.length) return null;
  return (
    <instancedMesh ref={ref} key={boxes.length} args={[undefined, undefined, boxes.length]}
      onClick={onPick ? (e) => { e.stopPropagation(); onPick(boxes[e.instanceId ?? 0]?.code ?? null); } : undefined}
      onPointerDown={onDown ? (e) => onDown(e, boxes[e.instanceId ?? 0]?.code) : undefined}>
      <boxGeometry args={[1, 1, 1]} />
      {kind === 'glow' ? <meshBasicMaterial toneMapped={false} />
        : kind === 'glass' ? <meshStandardMaterial transparent opacity={0.26} roughness={0.15} depthWrite={false} />
          : <meshStandardMaterial roughness={0.8} metalness={0.05} />}
    </instancedMesh>
  );
}

/** A soft dark patch on the ground: the footprint swept along the sun direction by the object's height. */
function GroundShadow({ r, h, cx, cz }: { r: Rect; h: number; cx: number; cz: number }) {
  const geo = useMemo(() => {
    const sx = -h * 0.55, sy = h * 0.32; // sun from the south-east
    const p: [number, number][] = [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.d], [r.x + r.w + sx, r.y + r.d + sy], [r.x + sx, r.y + r.d + sy], [r.x + sx, r.y + sy]];
    const s = new THREE.Shape(p.map(([x, y]) => new THREE.Vector2(x - cx, y - cz)));
    return new THREE.ShapeGeometry(s);
  }, [r.x, r.y, r.w, r.d, h, cx, cz]);
  useEffect(() => () => geo.dispose(), [geo]);
  return (
    <mesh geometry={geo} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]} renderOrder={1}>
      <meshBasicMaterial color="#0c1611" transparent opacity={0.24} depthWrite={false} />
    </mesh>
  );
}

function Tag({ text, at, strong }: { text: string; at: [number, number, number]; strong?: boolean }) {
  const { tex, aspect } = useMemo(() => {
    const c = document.createElement('canvas'), g = c.getContext('2d')!;
    const font = '600 30px Arial, Helvetica, sans-serif';
    g.font = font;
    const w = Math.ceil(g.measureText(text).width) + 44, h = 60;
    c.width = w; c.height = h;
    g.font = font;
    g.fillStyle = strong ? '#264d39' : '#ffffff';
    g.strokeStyle = strong ? '#264d39' : '#9fb0a3';
    g.lineWidth = 3;
    g.beginPath(); g.roundRect(2, 2, w - 4, h - 4, 12); g.fill(); g.stroke();
    g.fillStyle = strong ? '#ffffff' : '#18231d';
    g.textBaseline = 'middle';
    g.fillText(text, 22, h / 2 + 1);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return { tex: t, aspect: w / h };
  }, [text, strong]);
  useEffect(() => () => tex.dispose(), [tex]);
  return (
    // constant size on screen, so tags stay readable without growing when you zoom in
    <sprite position={at} scale={[0.024 * aspect, 0.024, 1]} renderOrder={20}>
      <spriteMaterial map={tex} depthTest={false} transparent sizeAttenuation={false} />
    </sprite>
  );
}

class Safe extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? null : this.props.children; }
}

function Aerial({ id, half }: { id: string; half: number }) {
  const tex = useLoader(THREE.TextureLoader, vexcelOrthoUrl(id, Math.round(half)));
  const map = useMemo(() => { tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8; return tex; }, [tex]);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.08, 0]}>
      <planeGeometry args={[half * 2, half * 2]} />
      <meshStandardMaterial map={map} roughness={1} />
    </mesh>
  );
}

function Rig({ view, target, span }: { view: ViewPreset; target: [number, number, number]; span: number }) {
  const { camera, controls } = useThree();
  useEffect(() => {
    if (view.preset === 'top') camera.position.set(target[0], span * 1.7, target[2] + 0.01);
    else camera.position.set(target[0] + span * 0.62, span * 0.72, target[2] + span * 0.86);
    const c = controls as unknown as { target: THREE.Vector3; update: () => void } | null;
    c?.target.set(...target);
    c?.update();
  }, [view, camera, controls, target, span]);
  return null;
}

const TAGGED: RoomType[] = ['data_hall', 'reserve'];

export default function Model3D({ concept, siteW, siteD, setback, layers, selected, onSelect, aerialId, edit, onMove, view, context }: {
  concept: Concept; siteW: number; siteD: number; setback: number; layers: Layers; selected: string | null;
  onSelect: (code: string | null) => void; aerialId: string | null; edit: boolean; onMove: (m: MoveEdit) => void; view: ViewPreset;
  context: { url: string; lat: number; lon: number } | null;
}) {
  const cx = siteW / 2, cz = siteD / 2;
  const b = concept.building;
  const floorH = b.floor_h ?? 6;
  const only = layers.level !== null && layers.level < b.storeys ? layers.level : null;
  const zOf = useMemo(() => (lvl: number) => (only !== null ? 0 : lvl * (floorH + layers.explode * 12)), [only, floorH, layers.explode]);
  const top = only !== null ? WALL : zOf(b.storeys - 1) + WALL;
  const frame = useMemo(() => {
    const all = [b, ...concept.yard];
    const x0 = Math.min(...all.map((r) => r.x)), x1 = Math.max(...all.map((r) => r.x + r.w));
    const y0 = Math.min(...all.map((r) => r.y)), y1 = Math.max(...all.map((r) => r.y + r.d));
    return { target: [(x0 + x1) / 2 - cx, 0, cz - (y0 + y1) / 2] as [number, number, number], span: Math.max(x1 - x0, y1 - y0) * 0.95 + 45 };
    // frame once per concept so the camera does not jump while editing
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [concept.id, siteW, siteD]);
  const building = useMemo(() => buildBuilding(concept, layers.racks, only, zOf), [concept, layers.racks, only, zOf]);
  const roofPanels = useMemo(() => (layers.roof > 0 && only === null ? buildRoof(concept, top + 1.1) : []), [concept, layers.roof, only, top]);
  const yard = useMemo(() => concept.yard.map((r) => ({ r, ...buildYard(r, concept) })), [concept]);
  const fence = useMemo(() => {
    const out: B[] = [], m = Math.min(2, setback / 2);
    for (let x = m; x <= siteW - m; x += 8) out.push({ x: x - 0.06, y: m, z: 0, w: 0.12, d: 0.12, h: 2.4, color: '#5d665f' }, { x: x - 0.06, y: siteD - m, z: 0, w: 0.12, d: 0.12, h: 2.4, color: '#5d665f' });
    for (let y = m; y <= siteD - m; y += 8) out.push({ x: m, y: y - 0.06, z: 0, w: 0.12, d: 0.12, h: 2.4, color: '#5d665f' }, { x: siteW - m, y: y - 0.06, z: 0, w: 0.12, d: 0.12, h: 2.4, color: '#5d665f' });
    for (const z of [1.1, 2.3]) out.push({ x: m, y: m, z, w: siteW - 2 * m, d: 0.05, h: 0.05, color: '#7b857e' }, { x: m, y: siteD - m, z, w: siteW - 2 * m, d: 0.05, h: 0.05, color: '#7b857e' },
      { x: m, y: m, z, w: 0.05, d: siteD - 2 * m, h: 0.05, color: '#7b857e' }, { x: siteW - m, y: m, z, w: 0.05, d: siteD - 2 * m, h: 0.05, color: '#7b857e' });
    return out;
  }, [siteW, siteD, setback]);

  // dragging: `drag` while the pointer is down, `held` between release and the re-checked layout arriving
  const [drag, setDrag] = useState<(MoveEdit & { sx: number; sz: number }) | null>(null);
  const [held, setHeld] = useState<MoveEdit | null>(null);
  useEffect(() => setHeld(null), [concept]);
  const ground = (e: ThreeEvent<PointerEvent>) => e.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), new THREE.Vector3());
  const isYard = (code: string | undefined) => !!code && concept.yard.some((y) => y.code === code);
  const down = (e: ThreeEvent<PointerEvent>, code: string | undefined) => {
    if (!edit || !code) return;
    const p = ground(e);
    if (!p) return;
    e.stopPropagation();
    setDrag({ code: isYard(code) ? code : 'BUILDING', dx: 0, dy: 0, sx: p.x, sz: p.z });
  };
  const move = (e: ThreeEvent<PointerEvent>) => {
    if (!drag) return;
    const p = ground(e);
    if (p) setDrag({ ...drag, dx: Math.round(p.x - drag.sx), dy: Math.round(drag.sz - p.z) });
  };
  useEffect(() => {
    if (!drag) return;
    const up = () => {
      if (drag.dx || drag.dy) { setHeld({ code: drag.code, dx: drag.dx, dy: drag.dy }); onMove({ code: drag.code, dx: drag.dx, dy: drag.dy }); }
      setDrag(null);
    };
    window.addEventListener('pointerup', up);
    return () => window.removeEventListener('pointerup', up);
  }, [drag, onMove]);
  const off = (code: string): [number, number, number] => {
    const m = drag?.code === code ? drag : held?.code === code ? held : null;
    return m ? [m.dx, 0, -m.dy] : [0, 0, 0];
  };

  const sel = [...concept.rooms, ...concept.yard].find((r) => r.code === selected);
  const half = Math.min(600, Math.max(siteW, siteD) / 2 + 90);
  const showAerial = !!aerialId && layers.aerial && !context;
  const reach = Math.max(siteW, siteD) * 0.6 + 60;
  const pos = (r: Rect, y: number): [number, number, number] => [r.x + r.w / 2 - cx, y, cz - (r.y + r.d / 2)];
  const loading = concept.rooms.find((r) => r.type === 'loading');
  const shown = (r: Room) => only === null || (r.level ?? 0) === only;
  const apron = { x: b.x - 6, y: b.y - 6, w: b.w + 12, d: b.d + 12 };

  return (
    <Canvas dpr={[1, 2]} camera={{ position: [frame.target[0] + frame.span * 0.62, frame.span * 0.72, frame.target[2] + frame.span * 0.86], fov: 36, near: 1, far: 14000 }}
      onPointerMissed={() => onSelect(null)} style={{ cursor: drag ? 'grabbing' : edit ? 'grab' : 'auto' }}>
      <color attach="background" args={['#e7ebe4']} />
      <fog attach="fog" args={['#e7ebe4', frame.span * 5, frame.span * 16]} />
      <hemisphereLight args={['#ffffff', '#a4b09d', 0.8]} />
      <directionalLight position={[reach * 0.9, reach * 1.25, reach * 0.55]} intensity={2.0} />
      <directionalLight position={[-reach * 0.6, reach * 0.5, -reach * 0.8]} intensity={0.35} />
      <Rig view={view} target={frame.target} span={frame.span} />

      {/* ground: the real aerial of the site, or the Vexcel 3D mesh of the surroundings */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.12, 0]} onPointerMove={move}>
        <planeGeometry args={[8000, 8000]} />
        <meshStandardMaterial color="#dce2d6" roughness={1} transparent={!!context} opacity={context ? 0 : 1} depthWrite={!context} />
      </mesh>
      {showAerial && <Safe><Suspense fallback={null}><Aerial id={aerialId!} half={half} /></Suspense></Safe>}
      {context && <Safe><Suspense fallback={null}><VexcelContext url={context.url} lat={context.lat} lon={context.lon} /></Suspense></Safe>}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.04, 0]}>
        <planeGeometry args={[siteW, siteD]} />
        <meshStandardMaterial color={showAerial || context ? '#f4f6f1' : '#d5dece'} transparent opacity={showAerial ? 0.18 : context ? 0.5 : 1} roughness={1} />
      </mesh>
      <Line points={[[-cx, 0.05, -cz], [cx, 0.05, -cz], [cx, 0.05, cz], [-cx, 0.05, cz], [-cx, 0.05, -cz]]} color="#2f6a48" lineWidth={2.5} />
      <Line points={[[-cx + setback, 0.05, -cz + setback], [cx - setback, 0.05, -cz + setback], [cx - setback, 0.05, cz - setback], [-cx + setback, 0.05, cz - setback], [-cx + setback, 0.05, -cz + setback]]}
        color="#6f8f79" lineWidth={1.2} dashed dashSize={4} gapSize={3} />
      <Boxes boxes={fence} cx={cx} cz={cz} />

      {/* building: hardstand, ground shadow, every storey */}
      <group position={off('BUILDING')}>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={pos(apron, -0.02)}>
          <planeGeometry args={[apron.w, apron.d]} />
          <meshStandardMaterial color="#c3c7c0" roughness={1} />
        </mesh>
        {loading && b.y > 8 && (
          <mesh position={[loading.x + loading.w / 2 - cx, -0.015, cz - (b.y - 6) / 2]} rotation={[-Math.PI / 2, 0, 0]}>
            <planeGeometry args={[7, b.y - 6]} />
            <meshStandardMaterial color="#5d625f" roughness={1} />
          </mesh>
        )}
        <GroundShadow r={{ x: b.x - 0.45, y: b.y - 0.45, w: b.w + 0.9, d: b.d + 0.9 }} h={top + 1} cx={cx} cz={cz} />
        <Boxes boxes={building.solid} cx={cx} cz={cz} onPick={onSelect} onDown={down} />
        <Boxes boxes={building.glow} cx={cx} cz={cz} kind="glow" />
        <Boxes boxes={building.glass} cx={cx} cz={cz} kind="glass" />
        {layers.roof > 0 && only === null && (
          <>
            <mesh position={pos(b, top + 0.95)}>
              <boxGeometry args={[b.w + 0.9, 0.3, b.d + 0.9]} />
              <meshStandardMaterial color="#f1f3ee" transparent opacity={layers.roof} depthWrite={layers.roof > 0.95} roughness={0.9} />
            </mesh>
            <Boxes boxes={roofPanels} cx={cx} cz={cz} />
          </>
        )}
        {sel && !isYard(sel.code) && shown(sel) && (
          <mesh position={pos(sel, zOf(sel.level ?? 0) + WALL / 2 + 0.2)}>
            <boxGeometry args={[sel.w + 0.3, WALL + 0.5, sel.d + 0.3]} />
            <meshStandardMaterial color="#2f9a63" transparent opacity={0.22} depthWrite={false} />
          </mesh>
        )}
        {layers.tags && concept.rooms.filter((r) => shown(r) && (TAGGED.includes(r.type) || r.code === selected)).map((r) => (
          <Tag key={r.code} text={r.name} at={pos(r, zOf(r.level ?? 0) + WALL + 2.5)} strong={r.code === selected} />
        ))}
      </group>

      {/* outdoor plant: each item moves on its own */}
      {layers.yard && yard.map(({ r, solid, cyl, cones, shadows }) => (
        <group key={r.code} position={off(r.code)}>
          {shadows.map((s, i) => <GroundShadow key={i} r={s} h={s.h} cx={cx} cz={cz} />)}
          <Boxes boxes={solid} cx={cx} cz={cz} onPick={onSelect} onDown={down} />
          {cyl.map((k, i) => (
            <mesh key={i} position={[k.x - cx, k.h / 2 + 0.1, cz - k.y]} onClick={(e) => { e.stopPropagation(); onSelect(r.code); }} onPointerDown={(e) => down(e, r.code)}>
              <cylinderGeometry args={[k.r, k.r, k.h, 40]} />
              <meshStandardMaterial color={k.color} roughness={0.55} metalness={0.25} />
            </mesh>
          ))}
          {cones.map((k, i) => (
            <group key={i} position={[k.x - cx, 0, cz - k.y]}>
              <mesh position={[0, 0.9, 0]}><cylinderGeometry args={[0.28, 0.34, 1.8, 8]} /><meshStandardMaterial color="#6b5540" roughness={1} /></mesh>
              <mesh position={[0, 1.6 + k.h / 2, 0]} onClick={(e) => { e.stopPropagation(); onSelect(r.code); }} onPointerDown={(e) => down(e, r.code)}>
                <coneGeometry args={[k.r, k.h, 9]} /><meshStandardMaterial color={k.color} roughness={1} />
              </mesh>
            </group>
          ))}
          {selected === r.code && (
            <mesh position={pos(r, 2.2)}>
              <boxGeometry args={[r.w + 0.4, 4.4, r.d + 0.4]} />
              <meshStandardMaterial color="#2f9a63" transparent opacity={0.2} depthWrite={false} />
            </mesh>
          )}
          {layers.tags && <Tag text={r.name} at={pos(r, 9)} strong={r.code === selected} />}
        </group>
      ))}

      {(['power', 'cooling', 'data'] as const).map((k, ki) => layers[k] && concept.routes[k].map((line, i) => (
        <Line key={`${k}${i}`} points={line.map(([x, y]) => [x - cx, top + 1.6 + ki * 0.5, cz - y] as [number, number, number])} color={ROUTE_COLOR[k]} lineWidth={2.5} />
      )))}
      <OrbitControls makeDefault enabled={!drag} target={frame.target} maxPolarAngle={Math.PI / 2.06} minDistance={10} maxDistance={frame.span * 7} />
    </Canvas>
  );
}
