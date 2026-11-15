'use client';
// Live 3D sketch of the project type picked in Locate. The geometry is HAVEN's illustrative
// concept models (see the headers in this folder); none of them is a surveyed replica.
import { useEffect, useRef } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import type { ComponentRef } from 'react';
import { BuildingBatch, STATIC_BUILDING_PARTS } from '../haven/building-shell';
import type { PreviewProjectType } from '../sample-data';
import { DataCenterGeometry } from './data-center-geometry';
import { PrincetonGeometry } from './princeton-geometry';
import { SolarFarmGeometry } from './solar-farm-geometry';
import { WindFarmGeometry } from './wind-farm-geometry';
import { CommunityParkGeometry } from './community-park-geometry';
import type { Point3, PropertyConfig } from './types';
import dataCenter from './data/atlas-data-center.json';
import princeton from './data/princeton-jrr-las.json';
import solar from './data/sunridge-solar-farm.json';
import wind from './data/ridgeway-wind-farm.json';
import park from './data/meadow-community-park.json';

const CONFIGS: Partial<Record<PreviewProjectType, PropertyConfig>> = {
  'data-center': dataCenter as unknown as PropertyConfig,
  commercial: princeton as unknown as PropertyConfig,
  solar: solar as unknown as PropertyConfig,
  wind: wind as unknown as PropertyConfig,
  park: park as unknown as PropertyConfig,
};

/** Camera framing per type. Residential is HAVEN's procedural six-storey hall (12 x 6.4 units). */
function framing(type: PreviewProjectType): { camera: Point3; target: Point3; far: number; outdoor: boolean } {
  const config = CONFIGS[type];
  if (!config) return { camera: [15, 12, 17], target: [0, 4.2, 0], far: 200, outdoor: false };
  return {
    camera: config.geometry.camera,
    target: config.geometry.target,
    far: config.outdoor ? 720 : 240,
    outdoor: !!config.outdoor,
  };
}

const NO_COLORS: Record<string, string> = {};
// HAVEN draws a rotor as healthy (white, spinning) only when its asset reports the normal colour.
const WIND_NORMAL: Record<string, string> = Object.fromEntries(
  (CONFIGS.wind?.outdoor?.features ?? [])
    .filter((f) => f.kind === 'turbine' && f.assetId)
    .map((f) => [f.assetId!, '#6c9991']),
);
const noop = () => {};

function Controls({ camera, target }: { camera: Point3; target: Point3 }) {
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const { camera: cam, size, invalidate } = useThree();
  useEffect(() => {
    // Narrow viewports pull the camera back so the whole site stays in frame.
    cam.position.set(...camera);
    const t = controls.current?.target;
    t?.set(...target);
    const scale = Math.max(1, 1.35 / (size.width / size.height));
    if (t) cam.position.sub(t).multiplyScalar(scale).add(t);
    cam.lookAt(...target);
    controls.current?.update();
    invalidate();
  }, [cam, camera, target, size.width, size.height, invalidate]);
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      target={target}
      minDistance={6}
      maxDistance={400}
      maxPolarAngle={Math.PI / 2.1}
      minPolarAngle={0.18}
      enableDamping
      onChange={() => invalidate()}
    />
  );
}

function Geometry({ type }: { type: PreviewProjectType }) {
  const config = CONFIGS[type];
  const props = { floor: null, exterior: true, colors: NO_COLORS, onPick: noop };
  switch (type) {
    case 'data-center':
      return <DataCenterGeometry config={config!} {...props} />;
    case 'commercial':
      return <PrincetonGeometry config={config!} {...props} />;
    case 'solar':
      return <SolarFarmGeometry config={config!} {...props} />;
    case 'wind':
      return <WindFarmGeometry config={config!} {...props} colors={WIND_NORMAL} animate selected="" />;
    case 'park':
      return <CommunityParkGeometry config={config!} {...props} />;
    default:
      return (
        <group>
          <mesh position={[0, -0.06, 0]} receiveShadow>
            <boxGeometry args={[20, 0.12, 15]} />
            <meshStandardMaterial color="#ebe7e0" />
          </mesh>
          <BuildingBatch items={STATIC_BUILDING_PARTS} onPick={noop} />
        </group>
      );
  }
}

export default function ConceptModel({ type }: { type: PreviewProjectType }) {
  const view = framing(type);
  return (
    <Canvas
      key={type}
      shadows
      frameloop="demand"
      dpr={[1, 1.5]}
      camera={{ position: view.camera, fov: 39, near: 0.1, far: view.far }}
      gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }}
    >
      <hemisphereLight args={['#f6f3ea', '#8f9c8c', 1.1]} />
      <ambientLight intensity={0.9} />
      <directionalLight
        castShadow
        position={view.outdoor ? [-35, 85, 45] : [-24, 52, 38]}
        intensity={2}
        color="#fff5df"
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={view.outdoor ? -100 : -55}
        shadow-camera-right={view.outdoor ? 100 : 55}
        shadow-camera-top={view.outdoor ? 100 : 55}
        shadow-camera-bottom={view.outdoor ? -100 : -55}
        shadow-camera-far={view.outdoor ? 300 : 120}
        shadow-bias={-0.0004}
        shadow-normalBias={0.04}
      />
      <Geometry type={type} />
      <Controls camera={view.camera} target={view.target} />
    </Canvas>
  );
}
