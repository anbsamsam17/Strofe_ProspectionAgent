'use client'

// ============================================================
// GlanAvatar3D — scène R3F tech immersive (refonte 2026-05-14)
//
// Plus une simple sphere Perlin : un "cockpit IA" complet :
//   - Core central déformé (icosahedron + shader Perlin)
//   - 6 satellites orbitant à vitesses + axes différents
//   - Champ de 400 particules ambient
//   - 3 lumières colorées (key vert, rim cyan, fill violet)
//   - Anneau orbital wireframe
//   - Halo radial glow derrière le canvas
//
// ⚠ Client-only — importer via dynamic({ ssr: false }).
// ============================================================

import { Suspense, useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Float } from '@react-three/drei'
import * as THREE from 'three'

import type { GlanState } from './glan-avatar'

interface GlanAvatar3DProps {
  state?: GlanState
  size?: number
  className?: string
}

// ── Shader Perlin pour le core central ──────────────────────────────────────

const VERTEX_SHADER = /* glsl */ `
  uniform float u_time;
  uniform float u_intensity;
  varying vec2 v_uv;
  varying float v_displacement;
  varying vec3 v_normal;

  vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x, 289.0);}
  vec4 taylorInvSqrt(vec4 r){return 1.79284291400159 - 0.85373472095314 * r;}
  vec3 fade(vec3 t){return t*t*t*(t*(t*6.0-15.0)+10.0);}

  float cnoise(vec3 P){
    vec3 Pi0 = floor(P); vec3 Pi1 = Pi0 + vec3(1.0);
    Pi0 = mod(Pi0, 289.0); Pi1 = mod(Pi1, 289.0);
    vec3 Pf0 = fract(P); vec3 Pf1 = Pf0 - vec3(1.0);
    vec4 ix = vec4(Pi0.x, Pi1.x, Pi0.x, Pi1.x);
    vec4 iy = vec4(Pi0.yy, Pi1.yy);
    vec4 iz0 = Pi0.zzzz; vec4 iz1 = Pi1.zzzz;
    vec4 ixy = permute(permute(ix) + iy);
    vec4 ixy0 = permute(ixy + iz0); vec4 ixy1 = permute(ixy + iz1);
    vec4 gx0 = ixy0 / 7.0; vec4 gy0 = fract(floor(gx0) / 7.0) - 0.5; gx0 = fract(gx0);
    vec4 gz0 = vec4(0.5) - abs(gx0) - abs(gy0);
    vec4 sz0 = step(gz0, vec4(0.0));
    gx0 -= sz0 * (step(0.0, gx0) - 0.5); gy0 -= sz0 * (step(0.0, gy0) - 0.5);
    vec4 gx1 = ixy1 / 7.0; vec4 gy1 = fract(floor(gx1) / 7.0) - 0.5; gx1 = fract(gx1);
    vec4 gz1 = vec4(0.5) - abs(gx1) - abs(gy1);
    vec4 sz1 = step(gz1, vec4(0.0));
    gx1 -= sz1 * (step(0.0, gx1) - 0.5); gy1 -= sz1 * (step(0.0, gy1) - 0.5);
    vec3 g000 = vec3(gx0.x, gy0.x, gz0.x);
    vec3 g100 = vec3(gx0.y, gy0.y, gz0.y);
    vec3 g010 = vec3(gx0.z, gy0.z, gz0.z);
    vec3 g110 = vec3(gx0.w, gy0.w, gz0.w);
    vec3 g001 = vec3(gx1.x, gy1.x, gz1.x);
    vec3 g101 = vec3(gx1.y, gy1.y, gz1.y);
    vec3 g011 = vec3(gx1.z, gy1.z, gz1.z);
    vec3 g111 = vec3(gx1.w, gy1.w, gz1.w);
    vec4 norm0 = taylorInvSqrt(vec4(dot(g000, g000), dot(g010, g010), dot(g100, g100), dot(g110, g110)));
    g000 *= norm0.x; g010 *= norm0.y; g100 *= norm0.z; g110 *= norm0.w;
    vec4 norm1 = taylorInvSqrt(vec4(dot(g001, g001), dot(g011, g011), dot(g101, g101), dot(g111, g111)));
    g001 *= norm1.x; g011 *= norm1.y; g101 *= norm1.z; g111 *= norm1.w;
    float n000 = dot(g000, Pf0);
    float n100 = dot(g100, vec3(Pf1.x, Pf0.yz));
    float n010 = dot(g010, vec3(Pf0.x, Pf1.y, Pf0.z));
    float n110 = dot(g110, vec3(Pf1.xy, Pf0.z));
    float n001 = dot(g001, vec3(Pf0.xy, Pf1.z));
    float n101 = dot(g101, vec3(Pf1.x, Pf0.y, Pf1.z));
    float n011 = dot(g011, vec3(Pf0.x, Pf1.yz));
    float n111 = dot(g111, Pf1);
    vec3 fade_xyz = fade(Pf0);
    vec4 n_z = mix(vec4(n000, n100, n010, n110), vec4(n001, n101, n011, n111), fade_xyz.z);
    vec2 n_yz = mix(n_z.xy, n_z.zw, fade_xyz.y);
    return 2.2 * mix(n_yz.x, n_yz.y, fade_xyz.x);
  }

  void main() {
    v_uv = uv;
    v_normal = normal;
    float noise = cnoise(position * 1.8 + u_time * 0.5);
    v_displacement = noise;
    vec3 displaced = position + normal * noise * u_intensity;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
  }
`

const FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 u_color_a;
  uniform vec3 u_color_b;
  uniform vec3 u_color_c;
  varying vec2 v_uv;
  varying float v_displacement;
  varying vec3 v_normal;

  void main() {
    float t = clamp(v_displacement * 0.5 + 0.5, 0.0, 1.0);
    vec3 c1 = mix(u_color_b, u_color_a, t);
    // Fresnel-like rim glow
    float rim = 1.0 - max(dot(normalize(v_normal), vec3(0.0, 0.0, 1.0)), 0.0);
    rim = pow(rim, 2.5);
    vec3 final = mix(c1, u_color_c, rim * 0.6);
    gl_FragColor = vec4(final, 1.0);
  }
`

// ── Palette par état (5 couleurs) ───────────────────────────────────────────

const STATE_PALETTE: Record<GlanState, {
  a: string; b: string; c: string; light1: string; light2: string
}> = {
  dormant: {
    a: '#5b6478', b: '#1a2030', c: '#86efac',
    light1: '#10b981', light2: '#06b6d4',
  },
  working: {
    a: '#52f29a', b: '#0f7a3e', c: '#86efac',
    light1: '#22c55e', light2: '#06b6d4',
  },
  done: {
    a: '#fde8a4', b: '#c5982a', c: '#f5c547',
    light1: '#eab308', light2: '#22c55e',
  },
  error: {
    a: '#f08a8a', b: '#7a1f1f', c: '#fca5a5',
    light1: '#ef4444', light2: '#a855f7',
  },
}

// ── Core central (Perlin sphere) ─────────────────────────────────────────────

function Core({ state }: { state: GlanState }) {
  const matRef = useRef<THREE.ShaderMaterial>(null)
  const palette = STATE_PALETTE[state]

  const uniforms = useMemo(
    () => ({
      u_time: { value: 0 },
      u_intensity: { value: 0.18 },
      u_color_a: { value: new THREE.Color(palette.a) },
      u_color_b: { value: new THREE.Color(palette.b) },
      u_color_c: { value: new THREE.Color(palette.c) },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state],
  )

  useFrame((_, dt) => {
    if (matRef.current) matRef.current.uniforms.u_time.value += dt
  })

  return (
    <Float speed={1.5} rotationIntensity={0.4} floatIntensity={0.5}>
      <mesh>
        <icosahedronGeometry args={[1, 40]} />
        <shaderMaterial
          ref={matRef}
          vertexShader={VERTEX_SHADER}
          fragmentShader={FRAGMENT_SHADER}
          uniforms={uniforms}
        />
      </mesh>
    </Float>
  )
}

// ── Satellites orbitant autour du core ───────────────────────────────────────

interface SatelliteConfig {
  radius: number
  speed: number
  axis: [number, number, number]
  phase: number
  size: number
  color: string
}

function Satellite({ config }: { config: SatelliteConfig }) {
  const meshRef = useRef<THREE.Mesh>(null)
  const time = useRef(config.phase)
  const axis = useMemo(() => new THREE.Vector3(...config.axis).normalize(), [config.axis])

  useFrame((_, dt) => {
    time.current += dt
    if (meshRef.current) {
      const t = time.current * config.speed
      const perp1 = new THREE.Vector3(1, 0, 0).cross(axis).normalize()
      if (perp1.lengthSq() < 0.01) perp1.set(0, 1, 0).cross(axis).normalize()
      const perp2 = axis.clone().cross(perp1).normalize()
      const pos = perp1
        .clone()
        .multiplyScalar(Math.cos(t) * config.radius)
        .add(perp2.multiplyScalar(Math.sin(t) * config.radius))
      meshRef.current.position.copy(pos)
      meshRef.current.rotation.x += dt * 0.5
      meshRef.current.rotation.y += dt * 0.7
    }
  })

  return (
    <mesh ref={meshRef}>
      <octahedronGeometry args={[config.size, 0]} />
      <meshStandardMaterial
        color={config.color}
        emissive={config.color}
        emissiveIntensity={1.5}
        metalness={0.6}
        roughness={0.3}
      />
    </mesh>
  )
}

function Satellites({ state }: { state: GlanState }) {
  const palette = STATE_PALETTE[state]

  const configs = useMemo<SatelliteConfig[]>(
    () => [
      { radius: 1.7, speed: 0.6, axis: [0, 1, 0.2], phase: 0, size: 0.09, color: palette.light1 },
      { radius: 1.9, speed: -0.4, axis: [0.3, 1, 0], phase: 1.5, size: 0.12, color: palette.c },
      { radius: 2.1, speed: 0.5, axis: [0.5, 0.5, 1], phase: 3, size: 0.07, color: palette.light2 },
      { radius: 1.6, speed: -0.7, axis: [1, 0.3, 0.3], phase: 4.5, size: 0.1, color: palette.light1 },
      { radius: 2.0, speed: 0.35, axis: [0, 0.5, 1], phase: 0.8, size: 0.08, color: palette.c },
      { radius: 1.8, speed: 0.55, axis: [1, 1, 0], phase: 2.2, size: 0.11, color: palette.light2 },
    ],
    [palette],
  )

  return (
    <>
      {configs.map((c, i) => (
        <Satellite key={i} config={c} />
      ))}
    </>
  )
}

// ── Anneau orbital wireframe ────────────────────────────────────────────────

function OrbitRing({ color }: { color: string }) {
  const ref = useRef<THREE.Mesh>(null)
  useFrame((_, dt) => {
    if (ref.current) {
      ref.current.rotation.x += dt * 0.1
      ref.current.rotation.z += dt * 0.05
    }
  })
  return (
    <mesh ref={ref} rotation={[Math.PI / 2.5, 0, 0]}>
      <torusGeometry args={[1.85, 0.005, 8, 100]} />
      <meshBasicMaterial color={color} transparent opacity={0.45} />
    </mesh>
  )
}

// ── Champ de particules ambient ─────────────────────────────────────────────

function Particles({ color }: { color: string }) {
  const count = 400
  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      const r = 2.5 + Math.random() * 2.5
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(2 * Math.random() - 1)
      arr[i * 3] = r * Math.sin(phi) * Math.cos(theta)
      arr[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta)
      arr[i * 3 + 2] = r * Math.cos(phi)
    }
    return arr
  }, [count])

  const ref = useRef<THREE.Points>(null)
  useFrame((_, dt) => {
    if (ref.current) {
      ref.current.rotation.y += dt * 0.05
      ref.current.rotation.x += dt * 0.02
    }
  })

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
          count={positions.length / 3}
        />
      </bufferGeometry>
      <pointsMaterial
        color={color}
        size={0.018}
        sizeAttenuation
        transparent
        opacity={0.7}
        depthWrite={false}
      />
    </points>
  )
}

// ── Scène complète ─────────────────────────────────────────────────────────

function Scene({ state }: { state: GlanState }) {
  const palette = STATE_PALETTE[state]

  return (
    <>
      <ambientLight intensity={0.25} color="#1a2030" />
      <pointLight position={[3, 3, 4]} intensity={3} color={palette.light1} distance={10} decay={1.5} />
      <pointLight position={[-3, 1, 3]} intensity={2.5} color={palette.light2} distance={8} decay={1.5} />
      <pointLight position={[0, -3, 2]} intensity={1.8} color="#a855f7" distance={8} decay={2} />
      <directionalLight position={[0, 5, 5]} intensity={0.4} />

      <Core state={state} />
      <Satellites state={state} />
      <OrbitRing color={palette.light2} />
      <Particles color={palette.c} />
    </>
  )
}

// ── Composant export principal ──────────────────────────────────────────────

export function GlanAvatar3D({ state = 'working', size = 360, className = '' }: GlanAvatar3DProps) {
  return (
    <div
      className={`relative ${className}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`Avatar 3D de Glan en état ${state}`}
    >
      {/* Halo radial derrière le canvas */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background: `radial-gradient(circle at center, ${STATE_PALETTE[state].light1}33 0%, transparent 60%)`,
          filter: 'blur(40px)',
        }}
      />
      <Canvas
        camera={{ position: [0, 0, 4.2], fov: 45 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
      >
        <Suspense fallback={null}>
          <Scene state={state} />
        </Suspense>
      </Canvas>
    </div>
  )
}
