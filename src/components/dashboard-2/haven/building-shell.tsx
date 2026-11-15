// Reused from HAVEN (285ed0ffd8c79b06c08dedef9468dffad5c40451), C:/Users/ksuda/Documents/Cal_Hacks_2026.
// Geometry and instanced rendering only; the source repository is unchanged.
"use client";

import { useLayoutEffect, useMemo, useRef } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import { Color, InstancedMesh, Object3D } from "three";
import { BUILDING_LAYOUT, floorY, type Point3 } from "./building-layout";

export interface BuildingPart { entity: string; floor: number | null; position: Point3; size: Point3; color: string; roof?: boolean }
const parts: BuildingPart[] = [];
const add = (entity: string, floor: number | null, position: Point3, size: Point3, color: string) => parts.push({ entity, floor, position, size, color });
for (const level of BUILDING_LAYOUT.floors) {
  const y = floorY(level), floorId = `floor-${level}`;
  add(floorId, level, [0, y, 0], [12, .16, 6.4], "#e5e6dd");
  add(floorId, level, [0, y - .08, 3.18], [12, .12, .1], "#9aaba6");
  add(floorId, level, [0, y + .62, -3.12], [12, 1.04, .12], "#d2d9d2");
  add(`corridor-${level}`, level, [0, y + .12, .55], [10.5, .06, 1.16], "#c9d9cc");
  for (const x of [-5.8, -3.8, -1.6, .65, 2.8, 5.8]) add(floorId, level, [x, y + .62, -3.22], [.085, 1.02, .09], "#5f7471");
  for (const x of [-5, -2.9, -.65, 1.6, 4.7]) {
    add(floorId, level, [x, y + .66, -3.195], [1.35, .56, .05], "#809d9c");
    add(floorId, level, [x, y + .63, -3.23], [.04, .6, .04], "#c3cfca");
  }
  for (const room of BUILDING_LAYOUT.entities.filter(e => e.floor === level && e.kind === "room")) {
    const [x, , z] = room.position, rear = z < 0;
    add(room.id, level, [x, y + .12, z], room.size, "#e0cfb3");
    for (const edge of [-1.02, 1.02]) add(room.id, level, [x + edge, y + .47, z], [.065, .65, room.size[2]], "#edece4");
    const doorZ = rear ? -.55 : 1.2;
    for (const edge of [-.65, .65]) add(room.id, level, [x + edge, y + .45, doorZ], [.72, .6, .075], "#e8e8df");
    add(room.id, level, [x + .12, y + .38, doorZ], [.04, .5, .06], "#ac9776");
    // Repeated furnishings are instances, not hundreds of separate draw calls.
    add(room.id, level, [x - .52, y + .25, z + (rear ? -.22 : .17)], [.68, .22, 1.12], "#ab9271");
    add(room.id, level, [x - .52, y + .39, z + (rear ? -.22 : .17)], [.65, .08, 1.06], "#e7ece8");
    add(room.id, level, [x - .52, y + .44, z + (rear ? -.58 : .5)], [.49, .06, .26], "#f8f7ed");
    add(room.id, level, [x + .54, y + .44, z - .35], [.62, .06, .48], "#b19a79");
    add(room.id, level, [x + .54, y + .27, z - .35], [.4, .32, .3], "#d5ddd5");
    add(room.id, level, [x + .58, y + .44, z + .5], [.5, .62, .4], "#c1b197");
  }
  for (const stair of BUILDING_LAYOUT.entities.filter(e => e.floor === level && e.kind === "stairs")) {
    const [x, , z] = stair.position;
    add(stair.id, level, [x, y + .12, z], [stair.size[0], .08, stair.size[2]], "#b8c7c5");
    for (let step = 0; step < 9; step++) add(stair.id, level, [x, y + .17 + step * .15, z - .78 + step * .17], [1.05, .1, .2], step % 2 ? "#a1b4b1" : "#c0cfcb");
    for (const side of [-.62, .62]) add(stair.id, level, [x + side, y + .62, z], [.045, .9, 1.9], "#718e88");
  }
  add(`service-${level}`, level, [5.4, y + .14, -1.65], [1.05, .1, 2.5], "#b7c5bd");
  if (level !== 4) {
    add(`service-${level}`, level, [5.65, y + .57, -1.45], [.23, .72, .6], "#7d9290");
    add(`service-${level}`, level, [5.66, y + .62, -1.05], [.1, .18, .18], "#c5a16c");
  }
  add(floorId, level, [0, y + .32, 3.08], [12, .08, .07], "#9eb2ae");
  for (const x of [-5.7, -3.5, -1.2, 1.2, 3.5, 5.7]) add(floorId, level, [x, y + .25, 3.08], [.04, .35, .04], "#9eb2ae");
  for (const x of [-5.85, 5.85]) add(floorId, level, [x, y + .65, .1], [.12, 1.12, .12], "#d8ddd3");
}
const roofStart = parts.length;
add("floor-6", 6, [0, floorY(6) + 1.2, -2.15], [12.15, .18, 2.35], "#bbc9c1");
add("service-6", 6, [3.9, floorY(6) + 1.43, -2.2], [1.6, .34, .85], "#879b98");
for (const x of [-2.2, -.5, 1.2]) add("service-6", 6, [x, floorY(6) + 1.33, -2.3], [1.2, .08, .85], "#6b8991");
parts.slice(roofStart).forEach(part => { part.roof = true; });
add("main-entrance", 1, [-.65, .18, 4.15], [3.3, .12, 2.6], "#c5d0ca");
add("main-entrance", 1, [-.65, 1.65, 3.5], [3, .12, 1.6], "#7b9390");
for (const x of [-2, .7]) add("main-entrance", 1, [x, .9, 4.1], [.06, 1.4, .06], "#899d96");
for (const x of [-5.8, 4.5]) {
  add("main-entrance", 1, [x, .16, 4.3], [1.4, .26, .7], "#adbfb0");
  add("main-entrance", 1, [x, .36, 4.3], [1.25, .28, .6], "#74957a");
}
export const STATIC_BUILDING_PARTS = parts;

export function BuildingBatch({ items, onPick }: { items: BuildingPart[]; onPick: (id: string) => void }) {
  const mesh = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    if (!mesh.current) return;
    const object = new Object3D(), color = new Color();
    items.forEach((item, index) => {
      object.position.set(...item.position); object.scale.set(...item.size); object.updateMatrix();
      mesh.current!.setMatrixAt(index, object.matrix);
      mesh.current!.setColorAt(index, color.set(item.color));
    });
    mesh.current.instanceMatrix.needsUpdate = true;
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true;
    mesh.current.computeBoundingSphere();
  }, [items]);
  function pick(event: ThreeEvent<MouseEvent>) {
    if (event.instanceId === undefined) return;
    event.stopPropagation(); onPick(items[event.instanceId].entity);
  }
  return <instancedMesh key={items.length} ref={mesh} args={[undefined, undefined, items.length]} onClick={pick}><boxGeometry args={[1, 1, 1]} /><meshStandardMaterial roughness={.85} /></instancedMesh>;
}

