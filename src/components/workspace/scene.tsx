'use client';
import { Component, Suspense, useEffect, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import { OrbitControls, Grid } from '@react-three/drei';
import type { Design, Incident, Sensor, Site } from '@/lib/types';
import { SitePlan } from './site-plan';
class SceneBoundary extends Component<
  { children: React.ReactNode; fallback: React.ReactNode },
  { error: boolean }
> {
  state = { error: false };
  static getDerivedStateFromError() {
    return { error: true };
  }
  render() {
    return this.state.error ? this.props.fallback : this.props.children;
  }
}
function CameraFit({ size }: { size: number }) {
  const { camera } = useThree();
  useEffect(() => {
    camera.position.set(size * 0.76, size * 0.8, size * 0.84);
    camera.lookAt(0, 0, 0);
    camera.updateProjectionMatrix();
  }, [size, camera]);
  return null;
}
function Building({
  d,
  protect = false,
  sensors,
  incidents,
  onSelect,
  floor,
  park = false,
}: {
  d: Design;
  protect?: boolean;
  sensors: Sensor[];
  incidents: Incident[];
  onSelect?: (id: string) => void;
  floor?: number;
  park?: boolean;
}) {
  const height = 3.5,
    bad = new Set(incidents.filter((i) => i.status !== 'resolved').map((i) => i.sensorId));
  const floors = Array.from({ length: d.floors }, (_, i) => i);
  return (
    <group rotation={[0, (d.rotation * Math.PI) / 180, 0]}>
      {floors.map((i) => (
        <group key={i} visible={!protect || !floor || floor === i + 1}>
          <mesh position={[0, i * height + 0.4, 0]} castShadow receiveShadow>
            <boxGeometry args={[d.width, 0.7, d.depth]} />
            <meshStandardMaterial color="#e1dfca" roughness={0.8} />
          </mesh>
          {[0, 1, 2].map((z) => {
            const zone = (
              park
                ? ['Community pavilion', 'Irrigation plant', 'Restrooms']
                : ['West wing', 'Mechanical room', 'East wing']
            )[z];
            const alert = sensors.some(
              (s) => s.floor === i + 1 && s.zone === zone && bad.has(s.id),
            );
            return (
              <mesh
                key={z}
                position={[((z - 1) * d.width) / 3, i * height + height / 2, 0]}
                castShadow
                receiveShadow
              >
                <boxGeometry args={[d.width / 3 - 0.4, height - 0.8, d.depth - 0.5]} />
                <meshStandardMaterial
                  color={alert ? '#ec745b' : protect ? '#769a83' : z === 1 ? '#799486' : '#bcc8b4'}
                  transparent={protect}
                  opacity={protect ? 0.34 : 1}
                  roughness={0.6}
                />
              </mesh>
            );
          })}
          {!protect &&
            Array.from({ length: Math.min(16, Math.floor(d.width / 4)) }, (_, j) => (
              <group key={j}>
                <mesh
                  position={[
                    -d.width / 2 +
                      3 +
                      (j * (d.width - 6)) / Math.max(1, Math.min(16, Math.floor(d.width / 4)) - 1),
                    i * height + 2,
                    d.depth / 2 + 0.05,
                  ]}
                >
                  <boxGeometry args={[1.4, 1.8, 0.08]} />
                  <meshStandardMaterial color="#426458" metalness={0.4} roughness={0.25} />
                </mesh>
                <mesh
                  position={[
                    -d.width / 2 +
                      3 +
                      (j * (d.width - 6)) / Math.max(1, Math.min(16, Math.floor(d.width / 4)) - 1),
                    i * height + 2,
                    -d.depth / 2 - 0.05,
                  ]}
                >
                  <boxGeometry args={[1.4, 1.8, 0.08]} />
                  <meshStandardMaterial color="#426458" metalness={0.4} />
                </mesh>
              </group>
            ))}
        </group>
      ))}
      {!protect && (
        <mesh position={[0, d.floors * height, 0]} receiveShadow>
          <boxGeometry args={[d.width + 0.8, 0.5, d.depth + 0.8]} />
          <meshStandardMaterial color="#a6b584" />
        </mesh>
      )}
      {sensors
        .filter((s) => !floor || floor === s.floor)
        .map((s) => (
          <group key={s.id} position={[s.x, (s.floor - 1) * height + 1.5, s.z]}>
            <mesh
              onClick={(e) => {
                e.stopPropagation();
                onSelect?.(s.id);
              }}
            >
              <sphereGeometry args={[Math.max(0.7, d.width * 0.015), 16, 16]} />
              <meshStandardMaterial
                color={bad.has(s.id) ? '#fb6048' : s.type === 'water' ? '#81d1f0' : '#d1f394'}
                emissive={bad.has(s.id) ? '#c82d1a' : '#537749'}
                emissiveIntensity={0.7}
              />
            </mesh>
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1, 0]}>
              <ringGeometry
                args={[Math.max(2, d.width * 0.08), Math.max(2, d.width * 0.08) + 0.2, 48]}
              />
              <meshBasicMaterial
                color={bad.has(s.id) ? '#e4583e' : '#8ca968'}
                transparent
                opacity={0.65}
              />
            </mesh>
          </group>
        ))}
    </group>
  );
}
export default function Scene({
  design: d,
  site,
  protect = false,
  sensors = [],
  incidents = [],
  onSelect,
  floor,
  park = false,
}: {
  design: Design;
  site: Site;
  protect?: boolean;
  sensors?: Sensor[];
  incidents?: Incident[];
  onSelect?: (id: string) => void;
  floor?: number;
  park?: boolean;
}) {
  const [supported, setSupported] = useState<boolean | null>(null);
  useEffect(() => {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl2');
      setSupported(!!gl);
      gl?.getExtension('WEBGL_lose_context')?.loseContext();
    } catch {
      setSupported(false);
    }
  }, []);
  const size = Math.max(site.width, site.depth, d.floors * 4),
    fallback = (
      <div className="scene-fallback">
        <span>3D requires WebGL · interactive 2D plan available</span>
        <SitePlan
          design={d}
          site={site}
          sensors={sensors}
          incidents={incidents}
          onSelect={onSelect}
          floor={floor}
          park={park}
        />
      </div>
    );
  return (
    <div className={`scene-container ${protect ? 'protect-scene' : ''}`}>
      {supported === false ? (
        fallback
      ) : supported === null ? (
        <div className="loading-panel">Preparing the model…</div>
      ) : (
        <SceneBoundary fallback={fallback}>
          <Canvas
            shadows
            camera={{
              position: [size * 0.76, size * 0.8, size * 0.84],
              fov: 40,
              near: 0.1,
              far: 10000,
            }}
            dpr={[1, 1.5]}
            gl={{ antialias: true, powerPreference: 'high-performance' }}
          >
            <color attach="background" args={[protect ? '#e4eadf' : '#e9ede4']} />
            <ambientLight intensity={1.5} />
            <directionalLight
              position={[size / 2, size, size / 3]}
              intensity={2.5}
              castShadow
              shadow-mapSize={[2048, 2048]}
              shadow-camera-left={-size}
              shadow-camera-right={size}
              shadow-camera-top={size}
              shadow-camera-bottom={-size}
              shadow-camera-far={size * 4}
            />
            <CameraFit size={size} />
            <Suspense fallback={null}>
              <mesh receiveShadow position={[0, -0.6, 0]}>
                <boxGeometry args={[site.width, 1, site.depth]} />
                <meshStandardMaterial color="#c0cdb0" />
              </mesh>
              <Grid
                position={[0, -0.05, 0]}
                args={[site.width, site.depth]}
                cellSize={10}
                cellThickness={0.5}
                cellColor="#82967c"
                sectionSize={50}
                sectionThickness={0.8}
                sectionColor="#82967c"
                fadeDistance={size * 3}
              />
              <mesh position={[0, 0.05, site.depth / 2 - 10]} receiveShadow>
                <boxGeometry args={[site.width, 0.15, 9]} />
                <meshStandardMaterial color="#b1b9aa" />
              </mesh>
              <Building
                d={d}
                protect={protect}
                sensors={sensors}
                incidents={incidents}
                onSelect={onSelect}
                floor={floor}
                park={park}
              />
              {Array.from({ length: 16 }, (_, i) => {
                const x =
                    i < 8
                      ? -site.width / 2 + 12 + (i * (site.width - 24)) / 7
                      : (i - 8) % 2 === 0
                        ? -site.width / 2 + 10
                        : site.width / 2 - 10,
                  z =
                    i < 8
                      ? -site.depth / 2 + 10
                      : -site.depth / 2 + 30 + ((i - 8) * (site.depth - 60)) / 8;
                return (
                  <group key={i} position={[x, 0, z]}>
                    <mesh position={[0, 2, 0]} castShadow>
                      <cylinderGeometry args={[0.5, 0.8, 4, 6]} />
                      <meshStandardMaterial color="#786d4a" />
                    </mesh>
                    <mesh position={[0, 5, 0]} castShadow>
                      <icosahedronGeometry args={[3.5, 1]} />
                      <meshStandardMaterial color={i % 2 ? '#6c8c5b' : '#87a370'} />
                    </mesh>
                  </group>
                );
              })}
              {park && (
                <mesh position={[0, 0.1, -site.depth * 0.28]} rotation={[-Math.PI / 2, 0, 0]}>
                  <circleGeometry args={[Math.min(site.width, site.depth) * 0.15, 64]} />
                  <meshStandardMaterial color="#91b273" />
                </mesh>
              )}
              {Array.from({ length: Math.min(18, d.parking) }, (_, i) => (
                <mesh
                  key={i}
                  position={[
                    -site.width / 2 + 12 + (i * (site.width - 24)) / Math.min(18, d.parking),
                    0.3,
                    site.depth / 2 - 22,
                  ]}
                  receiveShadow
                >
                  <boxGeometry args={[3, 0.2, 6]} />
                  <meshStandardMaterial color="#eff0de" />
                </mesh>
              ))}
            </Suspense>
            <OrbitControls
              makeDefault
              target={[
                0,
                protect ? (floor ? (floor * 3.5) / 2 : d.floors * 1.7) : d.floors * 1.5,
                0,
              ]}
              maxPolarAngle={Math.PI / 2.05}
              minDistance={10}
              maxDistance={size * 4}
              enableDamping
            />
          </Canvas>
        </SceneBoundary>
      )}
      <div className="scene-caption">
        <span>
          <i /> {protect ? 'HAVEN DIGITAL TWIN' : 'CONCEPTUAL MASSING'}
        </span>
        <span>Drag to orbit · Scroll to zoom · Right-drag to pan</span>
      </div>
    </div>
  );
}
