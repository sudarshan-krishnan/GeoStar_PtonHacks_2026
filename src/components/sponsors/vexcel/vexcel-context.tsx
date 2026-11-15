'use client';
// Vexcel 3D mesh of the surroundings (existing buildings, trees, terrain) around the site, where Vexcel has coverage.
// The mesh is real captured geometry; it is shown for context only and is not measured or edited.
import { useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { TilesPlugin, TilesRenderer } from '3d-tiles-renderer/r3f';
import { GLTFExtensionsPlugin, ReorientationPlugin } from '3d-tiles-renderer/plugins';

const DEG = Math.PI / 180;
const DOWN = new THREE.Vector3(0, -1, 0);
/** Where the ground height is sampled: the site centre and four points 70 m out, so a roof under the centre is not mistaken for ground. */
const PROBES: [number, number][] = [[0, 0], [70, 0], [-70, 0], [0, 70], [0, -70]];

export default function VexcelContext({ url, lat, lon }: { url: string; lat: number; lon: number }) {
  const gl = useThree((s) => s.gl);
  const ext = useMemo(() => ({
    dracoLoader: new DRACOLoader().setDecoderPath('/decoders/draco/'),
    ktxLoader: new KTX2Loader().setTranscoderPath('/decoders/basis/').detectSupport(gl),
  }), [gl]);
  const orient = useMemo(() => ({ lat: lat * DEG, lon: lon * DEG, height: 0, up: '+y', recenter: true }), [lat, lon]);
  const group = useRef<THREE.Group>(null);
  const [ground, setGround] = useState<number | null>(null);
  const probe = useRef({ frame: 0, ray: new THREE.Raycaster(), stable: 0 });
  // Find the mesh's ground height so the model sits on it. The mesh stays in place (invisible) while it loads:
  // tiles are only fetched for what the camera can see, so moving it out of view would stop it loading.
  useFrame(() => {
    const p = probe.current, g = group.current;
    if (!g || p.stable > 4 || ++p.frame % 30) return;
    let low: number | null = null;
    for (const [x, z] of PROBES) {
      p.ray.set(new THREE.Vector3(x, 9000, z), DOWN);
      for (const hit of p.ray.intersectObject(g, true)) low = low === null ? hit.point.y : Math.min(low, hit.point.y);
    }
    if (low === null) return;
    const y = low - g.position.y;
    if (ground !== null && Math.abs(y - ground) < 0.2) p.stable++;
    else { p.stable = 0; setGround(y); }
  });
  return (
    <group ref={group} position={[0, ground === null ? 0 : -ground - 0.4, 0]} visible={ground !== null}>
      <TilesRenderer url={url} errorTarget={28} loadSiblings={false} maxDepth={12}>
        <TilesPlugin plugin={GLTFExtensionsPlugin} args={[ext]} />
        <TilesPlugin plugin={ReorientationPlugin} args={[orient]} />
      </TilesRenderer>
    </group>
  );
}
