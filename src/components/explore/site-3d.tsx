'use client';
// Real 3D of a site: Vexcel photogrammetric city mesh where covered, otherwise the Vexcel orthophoto as ground.
// Overlays are analytical, not a design: the parcel's square-equivalent footprint and a translucent conceptual
// envelope (data hall, generator yard, switchyard) sized from the MW target at the team's density assumptions.
import { Component, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useLoader, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import * as THREE from 'three';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import { TilesPlugin, TilesRenderer } from '3d-tiles-renderer/r3f';
import { GLTFExtensionsPlugin, ReorientationPlugin } from '3d-tiles-renderer/plugins';
import { vexcel3dRootUrl, vexcelOrthoUrl } from '@/lib/plotstar-api';

const DEG = Math.PI / 180;
const GROUND_HALF = 200; // m; matches the ortho buffer
const SQM_PER_ACRE = 4046.8564224;

export function campusLayout(mw: number, floors = 2) {
  const gfa = mw * 230; // m² GFA per MW IT (team assumption, shared with the design engine)
  const footprint = gfa / floors;
  const width = Math.sqrt(footprint * 1.6);
  const depth = footprint / width;
  const height = floors * 6;
  const generators = Math.ceil(mw / 2.5); // 2.5 MW gensets, N (team assumption)
  const genYard = { w: Math.min(generators, 10) * 8 + 10, d: Math.ceil(generators / 10) * 7 + 10 };
  const switchyard = { w: 45, d: 32 };
  return { gfa, footprint, width, depth, height, floors, generators, genYard, switchyard };
}

function Outline({ w, d, y, color = '#1f2a24' }: { w: number; d: number; y: number; color?: string }) {
  const geo = useMemo(() => new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(-w / 2, y, -d / 2), new THREE.Vector3(w / 2, y, -d / 2),
    new THREE.Vector3(w / 2, y, d / 2), new THREE.Vector3(-w / 2, y, d / 2),
  ]), [w, d, y]);
  return <lineLoop renderOrder={11}><primitive object={geo} attach="geometry" /><lineBasicMaterial color={color} depthTest={false} /></lineLoop>;
}


function Envelope({ mw, ground, acres }: { mw: number; ground: number; acres: number | null }) {
  const L = useMemo(() => campusLayout(mw), [mw]);
  const side = acres ? Math.sqrt(acres * SQM_PER_ACRE) : null;
  const edges = useMemo(() => new THREE.EdgesGeometry(new THREE.BoxGeometry(L.width, L.height, L.depth)), [L]);
  const y0 = ground + 0.25;
  const hallZ = -L.depth / 2 - 6;              // hall toward the back, yards in front
  const genX = -L.width / 2 + L.genYard.w / 2;
  const genZ = L.depth / 2 + 10 + L.genYard.d / 2 - 6;
  const swX = L.width / 2 - L.switchyard.w / 2;
  const swZ = genZ;
  return (
    <group>
      {side && (
        <>
          <mesh position={[0, y0, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={9}>
            <planeGeometry args={[side, side]} />
            <meshBasicMaterial color="#264d39" transparent opacity={0.10} depthWrite={false} depthTest={false} />
          </mesh>
          <Outline w={side} d={side} y={y0 + 0.05} color="#264d39" />
        </>
      )}
      <group position={[0, 0, hallZ]}>
        <mesh position={[0, y0 + L.height / 2, 0]} renderOrder={10}>
          <boxGeometry args={[L.width, L.height, L.depth]} />
          <meshStandardMaterial color="#9fb7a6" transparent opacity={0.35} depthWrite={false} depthTest={false} roughness={0.9} />
        </mesh>
        <lineSegments position={[0, y0 + L.height / 2, 0]} renderOrder={11}><primitive object={edges} attach="geometry" /><lineBasicMaterial color="#1f2a24" depthTest={false} /></lineSegments>
      </group>
      <group position={[genX, 0, genZ]}>
        <mesh position={[0, y0, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={9}><planeGeometry args={[L.genYard.w, L.genYard.d]} /><meshBasicMaterial color="#6b5e4e" transparent opacity={0.35} depthWrite={false} depthTest={false} /></mesh>
        <Outline w={L.genYard.w} d={L.genYard.d} y={y0 + 0.05} />
      </group>
      <group position={[swX, 0, swZ]}>
        <mesh position={[0, y0, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={9}><planeGeometry args={[L.switchyard.w, L.switchyard.d]} /><meshBasicMaterial color="#2d5f8f" transparent opacity={0.32} depthWrite={false} depthTest={false} /></mesh>
        <Outline w={L.switchyard.w} d={L.switchyard.d} y={y0 + 0.05} />
      </group>
    </group>
  );
}

function AerialGround({ parcelId }: { parcelId: string }) {
  const tex = useLoader(THREE.TextureLoader, vexcelOrthoUrl(parcelId, GROUND_HALF));
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[GROUND_HALF * 2, GROUND_HALF * 2]} />
      <meshStandardMaterial map={tex} roughness={1} />
    </mesh>
  );
}

/** Lowest mesh surface across the footprint (a grid of rays), so the overlay sits on the ground, not on a roof. */
function GroundProbe({ target, span, onGround }: { target: React.RefObject<THREE.Group | null>; span: number; onGround: (y: number) => void }) {
  const ray = useMemo(() => new THREE.Raycaster(), []);
  const frames = useRef(0);
  const last = useRef<number | null>(null);
  useFrame(() => {
    if (!target.current || frames.current++ % 30) return;
    let minY: number | null = null;
    const n = 5;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++) {
        const x = (i / (n - 1) - 0.5) * span, z = (j / (n - 1) - 0.5) * span;
        ray.set(new THREE.Vector3(x, 3000, z), new THREE.Vector3(0, -1, 0));
        const hits = ray.intersectObject(target.current, true);
        if (hits.length) {
          const y = hits[hits.length - 1].point.y;
          minY = minY == null ? y : Math.min(minY, y);
        }
      }
    if (minY != null && (last.current == null || Math.abs(minY - last.current) > 0.2)) {
      last.current = minY;
      onGround(minY);
    }
  });
  return null;
}

function VexcelMesh({ url, lat, lon, mw, acres, concept }: { url: string; lat: number; lon: number; mw: number; acres: number | null; concept: boolean }) {
  const gl = useThree((s) => s.gl);
  const ext = useMemo(() => ({
    dracoLoader: new DRACOLoader().setDecoderPath('/decoders/draco/'),
    ktxLoader: new KTX2Loader().setTranscoderPath('/decoders/basis/').detectSupport(gl),
  }), [gl]);
  const orient = useMemo(() => ({ lat: lat * DEG, lon: lon * DEG, height: 0, up: '+y', recenter: true }), [lat, lon]);
  const group = useRef<THREE.Group>(null);
  const [ground, setGround] = useState(0);
  const span = Math.max(80, Math.sqrt((acres ?? 10) * SQM_PER_ACRE));
  return (
    <>
      <group ref={group}>
        <TilesRenderer url={url} errorTarget={40} loadSiblings={false} maxDepth={12}>
          <TilesPlugin plugin={GLTFExtensionsPlugin} args={[ext]} />
          <TilesPlugin plugin={ReorientationPlugin} args={[orient]} />
        </TilesRenderer>
      </group>
      <GroundProbe target={group} span={span} onGround={setGround} />
      {concept && <Envelope mw={mw} ground={ground} acres={acres} />}
    </>
  );
}

class Boundary extends Component<{ children: React.ReactNode; fallback: React.ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  render() { return this.state.error ? this.props.fallback : this.props.children; }
}

export default function Site3D({ parcelId, lat, lng, mw, acres = null }: { parcelId: string; lat: number; lng: number; mw: number; acres?: number | null }) {
  const [mesh, setMesh] = useState<{ url: string; collection: string } | null | undefined>(undefined);
  const [concept, setConcept] = useState(true);
  useEffect(() => {
    let alive = true;
    fetch(vexcel3dRootUrl(lat, lng))
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && setMesh(d ? { url: d.tileset_url, collection: d.collection } : null))
      .catch(() => alive && setMesh(null));
    return () => { alive = false; };
  }, [lat, lng]);
  const L = campusLayout(mw);
  const span = Math.max(L.width, L.depth, acres ? Math.sqrt(acres * SQM_PER_ACRE) : 0) + 140;
  return (
    <div className="real-3d-wrap">
      {mesh === undefined ? (
        <div className="real-3d-status">Loading site…</div>
      ) : (
        <Boundary fallback={<div className="real-3d-status">3D view unavailable on this device.</div>}>
          <Canvas camera={{ position: [span * 0.7, span * 0.55, span * 0.7], fov: 42, near: 1, far: 20000 }}>
            <color attach="background" args={['#dfe3da']} />
            <hemisphereLight args={['#ffffff', '#b9c4b0', 1.0]} />
            <directionalLight position={[300, 500, 200]} intensity={1.2} />
            <Suspense fallback={null}>
              {mesh ? (
                <VexcelMesh url={mesh.url} lat={lat} lon={lng} mw={mw} acres={acres} concept={concept} />
              ) : (
                <>
                  <AerialGround parcelId={parcelId} />
                  {concept && <Envelope mw={mw} ground={0} acres={acres} />}
                </>
              )}
            </Suspense>
            <OrbitControls makeDefault maxPolarAngle={Math.PI / 2.05} minDistance={30} maxDistance={3000} />
          </Canvas>
        </Boundary>
      )}
      <div className="real-3d-legend">
        {acres && <span><i style={{ background: 'rgba(38,77,57,0.25)', borderColor: '#264d39' }} />Parcel {acres.toFixed(1)} ac · square-equivalent {Math.round(Math.sqrt(acres * SQM_PER_ACRE))} m</span>}
        <span><i style={{ background: 'rgba(159,183,166,0.6)' }} />Data hall {Math.round(L.width)} × {Math.round(L.depth)} m · {L.floors} floors · {Math.round(L.gfa).toLocaleString()} m² GFA</span>
        <span><i style={{ background: 'rgba(107,94,78,0.5)' }} />Generator yard · {L.generators} × 2.5 MW</span>
        <span><i style={{ background: 'rgba(45,95,143,0.45)' }} />Switchyard · {Math.round(mw * 1.4)} MW grid request</span>
      </div>
      <div className="real-3d-note">
        <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center', marginRight: 10 }}>
          <input type="checkbox" checked={concept} onChange={(e) => setConcept(e.target.checked)} /> Conceptual envelope
        </label>
        {mesh ? `Vexcel 3D mesh ${mesh.collection} (Sourced). ` : mesh === null ? 'Vexcel orthophoto ground (Sourced); no 3D mesh coverage here. ' : ''}
        Overlay is drawn through the existing structure (x-ray) at probed ground level: a planning envelope at team density assumptions, not a design.
      </div>
    </div>
  );
}
