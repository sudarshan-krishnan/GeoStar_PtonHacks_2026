'use client';
// 3D preview of an imported drawing: every visible closed shape is extruded; the footprint stands taller in the accent.
// Plan coordinates are metres with y pointing north; the group is turned so extrusions rise along +Y.
import { useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import type { Shape } from './import-design';

const MAX_SHAPES = 600;

export default function Import3D({ shapes, footprintId, center, span, height }: {
  shapes: Shape[]; footprintId: string | null; center: [number, number]; span: number; height: number;
}) {
  const meshes = useMemo(() => shapes.filter((p) => p.closed && p.points.length >= 3).slice(0, MAX_SHAPES).map((p) => {
    const sh = new THREE.Shape(p.points.map(([x, y]) => new THREE.Vector2(x - center[0], y - center[1])));
    const foot = p.id === footprintId;
    const geo = new THREE.ExtrudeGeometry(sh, { depth: foot ? height : Math.max(0.4, height * 0.45), bevelEnabled: false });
    return { id: p.id, geo, foot };
  }), [shapes, footprintId, center, height]);
  const d = Math.max(20, span);
  return (
    <Canvas camera={{ position: [d * 0.7, d * 0.6, d * 0.8], fov: 40, near: 0.1, far: d * 20 }} dpr={[1, 2]}>
      <color attach="background" args={['#f5f6f2']} />
      <hemisphereLight args={['#ffffff', '#c9d2c4', 0.9]} />
      <directionalLight position={[d, d * 1.5, d * 0.6]} intensity={1.1} />
      <gridHelper args={[d * 2, 20, '#cfd6cb', '#e3e8df']} />
      <group rotation={[-Math.PI / 2, 0, 0]}>
        {meshes.map((m) => (
          <mesh key={m.id} geometry={m.geo}>
            {/* rooms opaque; the footprint is a see-through shell that never hides what is inside it */}
            {m.foot ? <meshStandardMaterial color="#34664b" transparent opacity={0.3} depthWrite={false} roughness={0.85} />
              : <meshStandardMaterial color="#dfe6dc" roughness={0.85} />}
          </mesh>
        ))}
      </group>
      <OrbitControls makeDefault maxPolarAngle={Math.PI / 2.05} />
    </Canvas>
  );
}
