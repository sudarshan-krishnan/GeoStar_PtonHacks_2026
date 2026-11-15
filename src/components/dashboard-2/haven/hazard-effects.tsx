'use client';
// Animated hazard visuals for the simple HAVEN twin (scene units: ~1.45 per level, corridor ~1.16 wide).
// The canvas renders on demand, so <AnimationTicker> keeps frames coming only while a hazard is shown.
// With prefers-reduced-motion, every effect renders a single static pose instead of animating.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import {
  AdditiveBlending,
  ConeGeometry,
  MeshBasicMaterial,
  type Group,
  type Mesh,
  type PointLight,
} from 'three';
import type { Point3 } from '@/lib/haven/config';

const STILL_TIME = 0.35;

export function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}

/** Keeps the on-demand canvas drawing while something is animating. */
export function AnimationTicker({ active }: { active: boolean }) {
  const { invalidate } = useThree();
  useEffect(() => {
    if (active) invalidate();
  }, [active, invalidate]);
  useFrame(() => {
    if (active) invalidate();
  });
  return null;
}

/** Disposable per-instance materials (each puff or ring fades independently). */
function useMaterials(count: number, color: string, additive = false) {
  const materials = useMemo(
    () =>
      Array.from(
        { length: count },
        () =>
          new MeshBasicMaterial({
            color,
            transparent: true,
            depthWrite: false,
            toneMapped: false,
            blending: additive ? AdditiveBlending : undefined,
          }),
      ),
    [count, color, additive],
  );
  useEffect(() => () => materials.forEach((m) => m.dispose()), [materials]);
  return materials;
}

// [x, z, height, phase]: flames spread along the corridor (x), kept within its width (z).
const FLAMES: [number, number, number, number][] = [
  [0, 0, 1, 0],
  [0.3, 0.14, 0.78, 1.7],
  [-0.28, -0.12, 0.84, 3.1],
  [0.14, -0.24, 0.62, 4.4],
  [-0.12, 0.22, 0.68, 5.3],
  [0.52, -0.04, 0.52, 2.4],
  [-0.5, 0.06, 0.58, 0.9],
];
const SMOKE_PUFFS = 9;
const ALERT_RINGS = 2;

export function FireEffect({ position, still }: { position: Point3; still: boolean }) {
  const cone = useMemo(() => new ConeGeometry(1, 1, 12, 1, true).translate(0, 0.5, 0), []);
  useEffect(() => () => cone.dispose(), [cone]);
  const outer = useRef<(Mesh | null)[]>([]);
  const inner = useRef<(Mesh | null)[]>([]);
  const puffs = useRef<(Mesh | null)[]>([]);
  const rings = useRef<(Mesh | null)[]>([]);
  const glow = useRef<Mesh>(null);
  const light = useRef<PointLight>(null);
  const smoke = useMaterials(SMOKE_PUFFS, '#5f6368');
  const ringMaterials = useMaterials(ALERT_RINGS, '#ff3b30');
  useFrame(({ clock }) => {
    const t = still ? STILL_TIME : clock.elapsedTime;
    FLAMES.forEach(([, , h, phase], i) => {
      const flicker = 0.78 + 0.22 * Math.sin(t * 9 + phase) + 0.12 * Math.sin(t * 23 + phase * 2);
      const sway = 0.9 + 0.1 * Math.sin(t * 6 + phase);
      outer.current[i]?.scale.set(0.15 * sway, 0.62 * h * flicker, 0.15 * sway);
      inner.current[i]?.scale.set(0.08 * sway, 0.4 * h * flicker, 0.08 * sway);
    });
    for (let i = 0; i < SMOKE_PUFFS; i++) {
      const puff = puffs.current[i];
      if (!puff) continue;
      const u = (t * 0.28 + i / SMOKE_PUFFS) % 1;
      puff.position.set(
        Math.sin(u * 4 + i) * 0.18 + ((i % 3) - 1) * 0.2,
        0.45 + u * 1.05,
        Math.cos(u * 3 + i) * 0.1,
      );
      puff.scale.setScalar(0.12 + u * 0.32);
      smoke[i].opacity = 0.6 * (1 - u) * Math.min(1, u * 6);
    }
    for (let i = 0; i < ALERT_RINGS; i++) {
      const u = (t * 0.55 + i / ALERT_RINGS) % 1;
      rings.current[i]?.scale.setScalar(0.35 + u * 1.6);
      ringMaterials[i].opacity = 0.85 * (1 - u);
    }
    glow.current?.scale.set(
      1.35 + 0.12 * Math.sin(t * 5),
      0.62 + 0.06 * Math.sin(t * 5),
      1,
    );
    if (light.current) light.current.intensity = 5 + 1.6 * Math.sin(t * 13) + Math.sin(t * 29);
  });
  return (
    <group position={position}>
      <pointLight ref={light} color="#ff7a33" distance={4} decay={1.4} position={[0, 0.5, 0]} />
      <mesh ref={glow} position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={6}>
        <circleGeometry args={[1, 40]} />
        <meshBasicMaterial
          color="#ff4d2e"
          transparent
          opacity={0.55}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      {Array.from({ length: ALERT_RINGS }, (_, i) => (
        <mesh
          key={i}
          ref={(m) => {
            rings.current[i] = m;
          }}
          position={[0, 0.03, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          material={ringMaterials[i]}
          renderOrder={7}
        >
          <ringGeometry args={[0.92, 1, 48]} />
        </mesh>
      ))}
      {FLAMES.map(([x, z], i) => (
        <group key={i} position={[x, 0.02, z]}>
          <mesh
            ref={(m) => {
              outer.current[i] = m;
            }}
            geometry={cone}
            renderOrder={8}
          >
            <meshBasicMaterial
              color="#ff5a1f"
              transparent
              opacity={0.85}
              depthWrite={false}
              blending={AdditiveBlending}
              toneMapped={false}
            />
          </mesh>
          <mesh
            ref={(m) => {
              inner.current[i] = m;
            }}
            geometry={cone}
            renderOrder={9}
          >
            <meshBasicMaterial
              color="#ffd166"
              transparent
              opacity={0.95}
              depthWrite={false}
              blending={AdditiveBlending}
              toneMapped={false}
            />
          </mesh>
        </group>
      ))}
      {smoke.map((material, i) => (
        <mesh
          key={i}
          ref={(m) => {
            puffs.current[i] = m;
          }}
          material={material}
          renderOrder={10}
        >
          <sphereGeometry args={[1, 12, 10]} />
        </mesh>
      ))}
    </group>
  );
}

const RIPPLES = 3;
const DRIPS = 5;
// [x, z] drip points under the leaking pipe.
const DRIP_POINTS: [number, number][] = [
  [-0.35, 0.05],
  [0.1, -0.08],
  [0.45, 0.1],
  [-0.05, 0.16],
  [0.3, -0.15],
];
const PIPE_Y = 1.22;

export function WaterEffect({ position, still }: { position: Point3; still: boolean }) {
  const puddle = useRef<Mesh>(null);
  const sheen = useRef<Mesh>(null);
  const ripples = useRef<(Mesh | null)[]>([]);
  const drips = useRef<(Mesh | null)[]>([]);
  const rippleMaterials = useMaterials(RIPPLES, '#1f6fff');
  const sheenMaterial = useRef<MeshBasicMaterial>(null);
  const started = useRef<number | null>(null);
  useFrame(({ clock }) => {
    const t = still ? STILL_TIME : clock.elapsedTime;
    started.current ??= t;
    // The puddle spreads out over ~2 s after the leak appears, then breathes gently.
    const grow = still ? 1 : Math.min(1, 0.25 + (t - started.current) * 0.4);
    const breathe = 1 + 0.04 * Math.sin(t * 2.2);
    puddle.current?.scale.set(1.5 * grow * breathe, 0.5 * grow * breathe, 1);
    sheen.current?.scale.set(0.9 * grow, 0.26 * grow, 1);
    if (sheenMaterial.current) sheenMaterial.current.opacity = 0.35 + 0.2 * Math.sin(t * 3.4);
    for (let i = 0; i < RIPPLES; i++) {
      const u = (t * 0.5 + i / RIPPLES) % 1;
      ripples.current[i]?.scale.set((0.2 + u * 1.2) * grow, (0.12 + u * 0.42) * grow, 1);
      rippleMaterials[i].opacity = 0.9 * (1 - u) * grow;
    }
    for (let i = 0; i < DRIPS; i++) {
      const u = (t * 0.85 + i / DRIPS) % 1;
      drips.current[i]?.position.set(DRIP_POINTS[i][0], PIPE_Y - 0.06 - u * u * (PIPE_Y - 0.05), DRIP_POINTS[i][1]);
    }
  });
  return (
    <group position={position}>
      {/* Leaking overhead pipe, so the drips have a visible source. */}
      <mesh position={[0, PIPE_Y, 0]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.06, 0.06, 1.8, 12]} />
        <meshStandardMaterial color="#8a94a6" metalness={0.4} roughness={0.4} />
      </mesh>
      <mesh ref={puddle} position={[0, 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={6}>
        <circleGeometry args={[1, 48]} />
        <meshBasicMaterial
          color="#2f7bff"
          transparent
          opacity={0.6}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <mesh ref={sheen} position={[0.1, 0.03, -0.04]} rotation={[-Math.PI / 2, 0, 0]} renderOrder={7}>
        <circleGeometry args={[1, 40]} />
        <meshBasicMaterial
          ref={sheenMaterial}
          color="#bfe0ff"
          transparent
          opacity={0.45}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      {rippleMaterials.map((material, i) => (
        <mesh
          key={i}
          ref={(m) => {
            ripples.current[i] = m;
          }}
          position={[0, 0.04, 0]}
          rotation={[-Math.PI / 2, 0, 0]}
          material={material}
          renderOrder={8}
        >
          <ringGeometry args={[0.9, 1, 48]} />
        </mesh>
      ))}
      {DRIP_POINTS.map((_, i) => (
        <mesh
          key={i}
          ref={(m) => {
            drips.current[i] = m;
          }}
          scale={[0.045, 0.075, 0.045]}
          renderOrder={9}
        >
          <sphereGeometry args={[1, 10, 8]} />
          <meshBasicMaterial color="#2f7bff" toneMapped={false} />
        </mesh>
      ))}
    </group>
  );
}

/** A sensor that is reporting an incident pulses so it reads at a glance. */
export function PulseGroup({
  active,
  still,
  children,
  position,
}: {
  active: boolean;
  still: boolean;
  children: React.ReactNode;
  position: Point3;
}) {
  const group = useRef<Group>(null);
  useFrame(({ clock }) => {
    if (!group.current) return;
    const s = active && !still ? 1.25 + 0.35 * Math.sin(clock.elapsedTime * 6) : active ? 1.4 : 1;
    group.current.scale.setScalar(s);
  });
  return (
    <group ref={group} position={position}>
      {children}
    </group>
  );
}
