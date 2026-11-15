'use client';
import { useEffect, useMemo, useRef, useState, type ComponentRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Line, OrbitControls } from '@react-three/drei';
import { Vector3 } from 'three';
import { BuildingBatch, STATIC_BUILDING_PARTS } from './haven/building-shell';
import { floorY } from './haven/building-layout';
import {
  AnimationTicker,
  FireEffect,
  PulseGroup,
  WaterEffect,
  useReducedMotion,
} from './haven/hazard-effects';
import {
  demoScenarios,
  evacuationPlans,
  monitoringPoints,
  type Point3,
} from '@/lib/haven/config';
import {
  activeIncidents,
  effectivePlan,
  routeAvailability,
  type ProtectionState,
} from '@/lib/haven/engine';

function Camera({
  floor,
  command,
  focus,
}: {
  floor: number | null;
  command: { sequence: number; action: string };
  /** Hazard point to frame closely while an incident on this floor is in view. */
  focus: Point3 | null;
}) {
  const { camera, invalidate } = useThree();
  const controls = useRef<ComponentRef<typeof OrbitControls>>(null);
  const previousFloor = useRef(floor);
  const focusX = focus?.[0] ?? null;
  const focusZ = focus?.[2] ?? null;
  useEffect(() => {
    const framed = focusX !== null && focusZ !== null && floor !== null;
    const target = framed
      ? new Vector3(focusX, floorY(floor) + 0.4, focusZ)
      : new Vector3(0, floor ? floorY(floor) + 0.2 : 4.2, 0);
    if (previousFloor.current === floor && (command.action === 'in' || command.action === 'out'))
      camera.position
        .sub(target)
        .multiplyScalar(command.action === 'in' ? 0.8 : 1.2)
        .add(target);
    else if (framed) camera.position.copy(target).add(new Vector3(6.2, 5.4, 7.4));
    else camera.position.set(16, (floor ? floorY(floor) : 4) + 11, 18);
    controls.current?.target.copy(target);
    camera.lookAt(target);
    controls.current?.update();
    previousFloor.current = floor;
    invalidate();
  }, [camera, floor, command, focusX, focusZ, invalidate]);
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      minDistance={6}
      maxDistance={60}
      maxPolarAngle={Math.PI / 2.05}
      enableDamping={false}
    />
  );
}

/** Evacuation route; the dashes flow toward the exit while a hazard is being animated. */
function RouteSegment({ points, flowing }: { points: Point3[]; flowing: boolean }) {
  const line = useRef<ComponentRef<typeof Line>>(null);
  useFrame((_, delta) => {
    if (flowing && line.current) line.current.material.dashOffset -= delta * 0.9;
  });
  return (
    <Line
      ref={line}
      points={points}
      color="#2f5a3f"
      lineWidth={6}
      dashed
      dashSize={0.32}
      gapSize={0.16}
      depthTest={false}
      renderOrder={10}
    />
  );
}

/** Base of the corridor floor at a scenario's configured hazard point on Level 4. */
const hazardBase = ([x, , z]: Point3, dx = 0): Point3 => [x + dx, floorY(4) + 0.16, z];

function Model({
  state,
  floor,
  operational,
  still,
  onPick,
}: {
  state: ProtectionState;
  floor: number | null;
  operational: boolean;
  still: boolean;
  onPick: (id: string) => void;
}) {
  const incidents = activeIncidents(state);
  const fire = operational && incidents.some((i) => i.kind === 'fire');
  const leak = operational && incidents.some((i) => i.kind === 'leak');
  const plan = effectivePlan(state);
  const available = routeAvailability(state);
  const level4 = floor === null || floor === 4;
  const parts = useMemo(
    () =>
      STATIC_BUILDING_PARTS.filter((p) => floor === null || (p.floor === floor && !p.roof)).map(
        (p) => ({
          ...p,
          // Rooms in the affected east half of Level 4 take the hazard's colour. The corridor
          // stays neutral so the flames and the puddle read clearly against it.
          color:
            (fire || leak) &&
            p.floor === 4 &&
            p.position[0] > 1 &&
            p.entity.startsWith('room')
              ? fire
                ? '#f0937f'
                : '#cfe0bb'
              : p.color,
        }),
      ),
    [floor, fire, leak],
  );
  const path = plan ? evacuationPlans[plan].points : [];
  const segments: Point3[][] = [];
  for (let i = 1; i < path.length; i++)
    if (
      floor === null ||
      (Math.abs(path[i][1] - (floorY(floor) + 0.3)) < 0.15 &&
        Math.abs(path[i - 1][1] - path[i][1]) < 0.15)
    )
      segments.push([path[i - 1], path[i]]);
  const animating = (fire || leak) && level4 && !still;
  return (
    <group>
      <AnimationTicker active={animating} />
      <mesh position={[0, -0.06, 0]}>
        <boxGeometry args={[20, 0.12, 15]} />
        <meshStandardMaterial color="#dde5d6" />
      </mesh>
      <BuildingBatch items={parts} onPick={onPick} />
      {operational &&
        monitoringPoints
          .filter(
            (s) => state.config[s.protection].enabled && (floor === null || floor === s.floor),
          )
          .map((sensor) => {
            const alerting = incidents.some((i) => i.kind === sensor.protection);
            return (
              <PulseGroup
                key={sensor.id}
                position={sensor.position}
                active={alerting}
                still={still}
              >
                <mesh
                  onClick={(e) => {
                    e.stopPropagation();
                    onPick(sensor.id);
                  }}
                >
                  <sphereGeometry args={[0.14, 14, 12]} />
                  <meshStandardMaterial
                    color={
                      alerting
                        ? '#e45b4b'
                        : sensor.protection === 'leak' || sensor.protection === 'waterUsage'
                          ? '#3f6b4e'
                          : '#6fa24e'
                    }
                    emissive={alerting ? '#ff2d1a' : '#1d3a2c'}
                    emissiveIntensity={alerting ? 0.9 : 0.25}
                  />
                </mesh>
              </PulseGroup>
            );
          })}
      {/* The evacuation route is guidance for an active fire or leak; with the building healthy it stays hidden. */}
      {operational &&
        (fire || leak) &&
        segments.map((points, i) => <RouteSegment key={i} points={points} flowing={animating} />)}
      {operational &&
        Object.entries(evacuationPlans).map(([id, route]) => (
          <group key={id} position={route.exitPosition}>
            <mesh
              onClick={() =>
                onPick(
                  `${route.name} · ${available[id as keyof typeof evacuationPlans] ? 'scenario-clear' : 'blocked in demo'}`,
                )
              }
            >
              <boxGeometry args={[0.45, 0.7, 0.45]} />
              <meshStandardMaterial
                color={available[id as keyof typeof evacuationPlans] ? '#3f6b4e' : '#ce5b4b'}
              />
            </mesh>
            {!available[id as keyof typeof evacuationPlans] && (
              <Line
                points={[
                  [-0.3, 0.5, 0],
                  [0.3, -0.3, 0],
                ]}
                color="#b3493c"
                lineWidth={5}
                depthTest={false}
              />
            )}
          </group>
        ))}
      {/* Demo hazards sit at each scenario's configured point in the east corridor. With both
          active, the leak is drawn a little further east so the two effects stay readable. */}
      {fire && level4 && (
        <FireEffect position={hazardBase(demoScenarios.fire.hazardPosition, leak ? -0.4 : 0)} still={still} />
      )}
      {leak && level4 && (
        <WaterEffect position={hazardBase(demoScenarios.leak.hazardPosition, fire ? 1.2 : 0)} still={still} />
      )}
    </group>
  );
}
export default function TwinCanvas({
  state,
  floor,
  command,
  operational,
  onPick,
  onUnavailable,
}: {
  state: ProtectionState;
  floor: number | null;
  command: { sequence: number; action: string };
  operational: boolean;
  onPick: (id: string) => void;
  onUnavailable: () => void;
}) {
  const [ready, setReady] = useState(false);
  const still = useReducedMotion();
  const kinds = new Set(activeIncidents(state).map((i) => i.kind));
  // Frame the configured hazard point when a fire or leak is shown on its floor (Level 4).
  const focus: Point3 | null =
    operational && floor === 4 && (kinds.has('fire') || kinds.has('leak'))
      ? kinds.has('fire') && kinds.has('leak')
        ? [2.6, 0, 0.55]
        : (kinds.has('fire') ? demoScenarios.fire : demoScenarios.leak).hazardPosition
      : null;
  useEffect(() => {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl2');
    if (!context) {
      onUnavailable();
      return;
    }
    context.getExtension('WEBGL_lose_context')?.loseContext();
    setReady(true);
  }, [onUnavailable]);
  return (
    <div
      className="hv-canvas"
      role="img"
      aria-label={`${state.facility.name} representative 3D digital twin`}
    >
      {ready ? (
        <Canvas
          frameloop="demand"
          dpr={[1, 1.5]}
          camera={{ position: [16, 15, 18], fov: 38 }}
          gl={{ antialias: true, powerPreference: 'low-power' }}
        >
          <color attach="background" args={['#f3f7ee']} />
          <ambientLight intensity={1.8} />
          <directionalLight position={[10, 20, 12]} intensity={2.2} />
          <Model
            state={state}
            floor={floor}
            operational={operational}
            still={still}
            onPick={onPick}
          />
          <Camera floor={floor} command={command} focus={focus} />
        </Canvas>
      ) : (
        <div className="hv-model-loading">Preparing the 3D renderer…</div>
      )}
    </div>
  );
}
