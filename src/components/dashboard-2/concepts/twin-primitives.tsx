// Reused from HAVEN (C:/Users/ksuda/Documents/Cal_Hacks_2026, src/components/twin-primitives.tsx).
// Illustrative concept geometry, not a surveyed replica. Imports repointed to ./types.
"use client";

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { BufferGeometry, Color, DoubleSide, Euler, Float32BufferAttribute, IcosahedronGeometry, Object3D, Quaternion, Vector3, type InstancedMesh } from "three";
import type { Point3 } from "./types";

export type ShapeKind = "box" | "cylinder" | "rod" | "crown" | "shrub" | "cone" | "leaf" | "grass";
export interface Part { shape: ShapeKind; p: Point3; s: Point3; color: string; rotation?: Point3; id?: string }

/** Stable samples keep planting fixed across telemetry updates and floor changes. */
export function sample(seed: number) {
  const n = Math.sin(seed * 127.1 + 311.7) * 43758.5453123;
  return n - Math.floor(n);
}

export function beam(parts: Part[], a: Point3, b: Point3, radius: number, color: string, id?: string) {
  const from = new Vector3(...a), to = new Vector3(...b), direction = to.clone().sub(from);
  const rotation = new Euler().setFromQuaternion(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction.clone().normalize()));
  // Thin connected rails and ribs need no hidden end caps or dense round sections.
  parts.push({ shape: "rod", p: from.add(to).multiplyScalar(.5).toArray() as Point3, s: [radius, direction.length(), radius], color, id, rotation: [rotation.x, rotation.y, rotation.z] });
}

function foliageGeometry(grass: boolean) {
  const positions: number[] = [];
  if (grass) {
    for (let i = 0; i < 3; i++) {
      const a = i * Math.PI / 3, x = Math.cos(a) * .5, z = Math.sin(a) * .5;
      positions.push(-x, 0, -z, x, 0, z, x * .3, 1, z * .3);
    }
  } else {
    // A bent lance leaf catches daylight without a texture or alpha sorting.
    const vertices = [[0, 0, 0], [-.5, .17, .35], [0, .28, .56], [.5, .17, .35], [0, .04, 1]];
    for (const face of [[0, 1, 2], [0, 2, 3], [1, 4, 2], [2, 4, 3]]) for (const index of face) positions.push(...vertices[index]);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return geometry;
}

function crownGeometry() {
  const geometry = new IcosahedronGeometry(1, 1), position = geometry.getAttribute("position"), tint: number[] = [];
  for(let i=0;i<position.count;i++) {
    const x=position.getX(i),y=position.getY(i),z=position.getZ(i);
    const radius=.98+.1*Math.sin(x*11+z*8)*Math.cos(y*9)+.055*Math.sin(x*19-y*13+z*7);
    position.setXYZ(i,x*radius,y*radius,z*radius);
    const value=.86+.14*(.5+.5*Math.sin(x*15+y*12+z*17));tint.push(value,value,value*.96);
  }
  geometry.setAttribute("color",new Float32BufferAttribute(tint,3));
  return geometry;
}

function coniferGeometry() {
  const positions:number[]=[], rings=[.36,1,.7,.85,.55,.65,.37,.44,.22,.25,0];
  const point=(row:number,column:number)=>{
    const a=column/12*Math.PI*2, radius=rings[row]*(.88+.12*Math.sin(column*2.7+row*1.4));
    return [Math.cos(a)*radius,row/(rings.length-1)-.5,Math.sin(a)*radius];
  };
  for(let row=0;row<rings.length-1;row++)for(let col=0;col<12;col++){
    for(const v of [point(row,col),point(row+1,col),point(row,col+1),point(row,col+1),point(row+1,col),point(row+1,col+1)])positions.push(...v);
  }
  const geometry=new BufferGeometry();geometry.setAttribute("position",new Float32BufferAttribute(positions,3));geometry.computeVertexNormals();return geometry;
}

function InstanceBatch({ shape, parts, onPick }: { shape: ShapeKind; parts: Part[]; onPick: (id: string) => void }) {
  const mesh = useRef<InstancedMesh>(null);
  const foliage = useMemo(() => shape === "leaf" || shape === "grass" ? foliageGeometry(shape === "grass") : shape === "crown" ? crownGeometry() : shape === "cone" ? coniferGeometry() : undefined, [shape]);
  useEffect(() => () => { foliage?.dispose(); }, [foliage]);
  useLayoutEffect(() => {
    if (!mesh.current) return;
    const dummy = new Object3D(), color = new Color();
    parts.forEach((p, i) => {
      dummy.position.set(...p.p); dummy.scale.set(...p.s); dummy.rotation.set(...(p.rotation ?? [0, 0, 0] as Point3)); dummy.updateMatrix();
      mesh.current!.setMatrixAt(i, dummy.matrix); mesh.current!.setColorAt(i, color.set(p.color));
    });
    mesh.current.instanceMatrix.needsUpdate = true;
    if (mesh.current.instanceColor) mesh.current.instanceColor.needsUpdate = true;
    mesh.current.computeBoundingSphere();
  }, [parts]);
  return <instancedMesh ref={mesh} args={[undefined, undefined, parts.length]} castShadow={shape === "crown" || shape === "box" || shape === "cone"} receiveShadow onClick={event => {
    const part = parts[event.instanceId ?? -1];
    if (part?.id) { event.stopPropagation(); onPick(part.id); }
  }}>
    {foliage ? <primitive object={foliage} attach="geometry" /> : shape === "box" ? <boxGeometry /> : shape === "rod" ? <cylinderGeometry args={[1, 1, 1, 6, 1, true]} /> : shape === "cylinder" ? <cylinderGeometry args={[1, 1, 1, 8]} /> : shape === "cone" ? <coneGeometry args={[1, 1, 10]} /> : <icosahedronGeometry args={[1, shape === "shrub" ? 0 : 1]} />}
    <meshStandardMaterial roughness={shape === "leaf" ? .65 : .9} vertexColors={shape === "crown"} side={shape === "leaf" || shape === "grass" ? DoubleSide : undefined} />
  </instancedMesh>;
}

/** Hundreds of details share primitive batches rather than individual meshes. */
export function PartBatches({ parts, onPick }: { parts: Part[]; onPick: (id: string) => void }) {
  const batches=useMemo(()=>(["box", "cylinder", "rod", "crown", "shrub", "cone", "leaf", "grass"] as const).map(shape=>({shape,parts:parts.filter(part=>part.shape===shape)})),[parts]);
  return <>{batches.map(batch=>batch.parts.length?<InstanceBatch key={`${batch.shape}:${batch.parts.length}`} shape={batch.shape} parts={batch.parts} onPick={onPick}/>:null)}</>;
}
