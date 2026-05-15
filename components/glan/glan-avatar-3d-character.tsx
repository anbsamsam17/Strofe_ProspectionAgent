'use client'

// ============================================================
// GlanAvatar3DCharacter — personnage 3D stylisé en R3F
//
// Avatar character (pas une boule, pas une forme abstraite) :
//   - Tête sphérique avec léger displacement vivant
//   - Yeux : sclères blanches + iris foncé + reflet lumineux (look anime sobre)
//   - Cheveux : couronne procédurale d'écailles spheres + cones (couleur état)
//   - Cou + buste très court (juste suggéré)
//   - Orbital ring autour de la tête + particules micro-lumineuses
//   - 3 lumières colorées (key/rim/fill) qui changent selon état
//   - Float drei pour léger flottement vertical
//   - La tête suit doucement le pointeur (limite ±15°)
//
// 4 états : dormant / working / done / error.
// `prefers-reduced-motion` : animations gelées, head-tracking désactivé.
//
// ⚠ Client-only — importer via dynamic({ ssr: false }) côté consommateur
// (cf glan-character-loader.tsx).
// ============================================================

import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Float } from '@react-three/drei'
import * as THREE from 'three'

import type { GlanState } from './glan-avatar'

export interface GlanAvatar3DCharacterProps {
  state?: GlanState
  /** Taille canvas px. Défaut 320. */
  size?: number
  /** Active mouse-follow head. Défaut true. Ignoré si reduced-motion. */
  interactive?: boolean
  className?: string
}

// ── Palette par état ────────────────────────────────────────────────────────

interface StatePalette {
  hair: string
  hairAccent: string
  skin: string
  skinShadow: string
  eye: string
  iris: string
  mouth: string
  blush: string | null
  key: string
  rim: string
  fill: string
  halo: string
  particle: string
  ring: string
}

const STATE_PALETTE: Record<GlanState, StatePalette> = {
  dormant: {
    hair: '#5b6478',
    hairAccent: '#7c8aa3',
    skin: '#f0d8b8',
    skinShadow: '#d4b894',
    eye: '#0f172a',
    iris: '#1a2030',
    mouth: '#7a5b4c',
    blush: null,
    key: '#6366f1',
    rim: '#8b5cf6',
    fill: '#1e293b',
    halo: '#6366f1',
    particle: '#a5b4fc',
    ring: '#94a3b8',
  },
  working: {
    hair: '#22c55e',
    hairAccent: '#4ade80',
    skin: '#f0d8b8',
    skinShadow: '#d4b894',
    eye: '#0f172a',
    iris: '#052e16',
    mouth: '#7a5b4c',
    blush: null,
    key: '#06b6d4',
    rim: '#22c55e',
    fill: '#0f172a',
    halo: '#22c55e',
    particle: '#67e8f9',
    ring: '#06b6d4',
  },
  done: {
    hair: '#eab308',
    hairAccent: '#facc15',
    skin: '#f5dcc0',
    skinShadow: '#dbb98a',
    eye: '#0f172a',
    iris: '#3f2d05',
    mouth: '#7a5b4c',
    blush: '#f4a8a8',
    key: '#fbbf24',
    rim: '#f59e0b',
    fill: '#1e293b',
    halo: '#eab308',
    particle: '#fde68a',
    ring: '#fbbf24',
  },
  error: {
    hair: '#ef4444',
    hairAccent: '#f87171',
    skin: '#e8c8c0',
    skinShadow: '#c9a39a',
    eye: '#1a0606',
    iris: '#450a0a',
    mouth: '#5b1f1f',
    blush: null,
    key: '#ef4444',
    rim: '#dc2626',
    fill: '#1e0a0a',
    halo: '#ef4444',
    particle: '#fca5a5',
    ring: '#fca5a5',
  },
}

// ── Hook reduced-motion ─────────────────────────────────────────────────────

function usePrefersReducedMotion(): boolean {
  const [prefers, setPrefers] = useState(false)
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    setPrefers(mq.matches)
    const handler = (e: MediaQueryListEvent) => setPrefers(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])
  return prefers
}

// ── Pointer normalisé partagé via ref (-1..1 par axe) ───────────────────────

interface PointerRef {
  x: number
  y: number
}

// ── Tête : sphère avec léger displacement vivant ────────────────────────────

const HEAD_VERTEX_SHADER = /* glsl */ `
  uniform float u_time;
  uniform float u_breathe;
  varying vec3 v_normal;
  varying vec3 v_pos;
  void main() {
    v_normal = normalize(normalMatrix * normal);
    // Léger pulse sphérique vivant (respiration).
    float pulse = 1.0 + sin(u_time * 0.9) * 0.012 * u_breathe;
    vec3 displaced = position * pulse;
    v_pos = displaced;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(displaced, 1.0);
  }
`

const HEAD_FRAGMENT_SHADER = /* glsl */ `
  uniform vec3 u_skin;
  uniform vec3 u_shadow;
  uniform vec3 u_rim;
  varying vec3 v_normal;
  void main() {
    // Lambert doux + rim fresnel
    vec3 lightDir = normalize(vec3(0.6, 0.7, 1.0));
    float diff = max(dot(v_normal, lightDir), 0.0);
    float wrap = diff * 0.5 + 0.5;
    vec3 base = mix(u_shadow, u_skin, wrap);
    float fresnel = pow(1.0 - max(dot(v_normal, vec3(0.0, 0.0, 1.0)), 0.0), 2.5);
    vec3 final = base + u_rim * fresnel * 0.35;
    gl_FragColor = vec4(final, 1.0);
  }
`

interface HeadProps {
  palette: StatePalette
  pointerRef: React.MutableRefObject<PointerRef>
  reducedMotion: boolean
  state: GlanState
}

function Head({ palette, pointerRef, reducedMotion, state }: HeadProps) {
  const groupRef = useRef<THREE.Group>(null)
  const matRef = useRef<THREE.ShaderMaterial>(null)
  const blinkRef = useRef({ next: 3, closing: 0 })

  const uniforms = useMemo(
    () => ({
      u_time: { value: 0 },
      u_breathe: { value: 1 },
      u_skin: { value: new THREE.Color(palette.skin) },
      u_shadow: { value: new THREE.Color(palette.skinShadow) },
      u_rim: { value: new THREE.Color(palette.rim) },
    }),
    [palette.skin, palette.skinShadow, palette.rim],
  )

  // Yeux animés via group child (pour pouvoir cligner + suivre cursor)
  const leftEyeRef = useRef<THREE.Group>(null)
  const rightEyeRef = useRef<THREE.Group>(null)
  const leftLidRef = useRef<THREE.Mesh>(null)
  const rightLidRef = useRef<THREE.Mesh>(null)

  useFrame((_, dt) => {
    if (matRef.current && !reducedMotion) {
      matRef.current.uniforms.u_time.value += dt
    }

    // Head tracking — orientation douce vers pointer (±15° = ±0.26rad)
    if (groupRef.current && !reducedMotion) {
      const targetY = pointerRef.current.x * 0.26
      const targetX = -pointerRef.current.y * 0.18
      groupRef.current.rotation.y += (targetY - groupRef.current.rotation.y) * 0.08
      groupRef.current.rotation.x += (targetX - groupRef.current.rotation.x) * 0.08
    }

    // Pupille tracking (working/done only — yeux ouverts)
    const eyesOpen = state === 'working' || state === 'done'
    if (eyesOpen && !reducedMotion) {
      const px = pointerRef.current.x * 0.04
      const py = -pointerRef.current.y * 0.03
      if (leftEyeRef.current) {
        leftEyeRef.current.position.x = -0.18 + px
        leftEyeRef.current.position.y = 0.05 + py
      }
      if (rightEyeRef.current) {
        rightEyeRef.current.position.x = 0.18 + px
        rightEyeRef.current.position.y = 0.05 + py
      }
    }

    // Clignement aléatoire (working/done)
    if (eyesOpen && !reducedMotion) {
      blinkRef.current.next -= dt
      if (blinkRef.current.next <= 0) {
        blinkRef.current.closing = 0.15
        blinkRef.current.next = 2.5 + Math.random() * 3
      }
      const lid = blinkRef.current.closing > 0 ? Math.min(1, blinkRef.current.closing * 8) : 0
      blinkRef.current.closing = Math.max(0, blinkRef.current.closing - dt)
      if (leftLidRef.current) leftLidRef.current.scale.y = lid
      if (rightLidRef.current) rightLidRef.current.scale.y = lid
    }
  })

  const eyesOpen = state === 'working' || state === 'done'
  const eyesArced = state === 'dormant' // arcs (yeux fermés)
  const eyesFrowny = state === 'error'

  return (
    <group ref={groupRef}>
      {/* Tête — sphère légèrement aplatie aux pôles */}
      <mesh scale={[1, 1.05, 0.95]}>
        <sphereGeometry args={[1, 64, 48]} />
        <shaderMaterial
          ref={matRef}
          vertexShader={HEAD_VERTEX_SHADER}
          fragmentShader={HEAD_FRAGMENT_SHADER}
          uniforms={uniforms}
        />
      </mesh>

      {/* Cheveux : calotte + mèches */}
      <Hair palette={palette} />

      {/* Yeux */}
      {eyesOpen && (
        <>
          <group ref={leftEyeRef} position={[-0.18, 0.05, 0.86]}>
            {/* Sclère */}
            <mesh scale={[1, 1.2, 0.5]}>
              <sphereGeometry args={[0.12, 24, 16]} />
              <meshStandardMaterial color="#ffffff" roughness={0.2} metalness={0} />
            </mesh>
            {/* Iris */}
            <mesh position={[0, 0, 0.06]}>
              <sphereGeometry args={[0.07, 24, 16]} />
              <meshStandardMaterial color={palette.iris} roughness={0.4} />
            </mesh>
            {/* Pupille */}
            <mesh position={[0, 0, 0.1]}>
              <sphereGeometry args={[0.035, 16, 12]} />
              <meshBasicMaterial color={palette.eye} />
            </mesh>
            {/* Reflet */}
            <mesh position={[0.025, 0.03, 0.13]}>
              <sphereGeometry args={[0.018, 12, 8]} />
              <meshBasicMaterial color="#ffffff" />
            </mesh>
            {/* Paupière (pour clignement) */}
            <mesh ref={leftLidRef} position={[0, 0, 0.14]} scale={[1, 0, 1]}>
              <boxGeometry args={[0.26, 0.28, 0.02]} />
              <meshBasicMaterial color={palette.skin} />
            </mesh>
          </group>
          <group ref={rightEyeRef} position={[0.18, 0.05, 0.86]}>
            <mesh scale={[1, 1.2, 0.5]}>
              <sphereGeometry args={[0.12, 24, 16]} />
              <meshStandardMaterial color="#ffffff" roughness={0.2} metalness={0} />
            </mesh>
            <mesh position={[0, 0, 0.06]}>
              <sphereGeometry args={[0.07, 24, 16]} />
              <meshStandardMaterial color={palette.iris} roughness={0.4} />
            </mesh>
            <mesh position={[0, 0, 0.1]}>
              <sphereGeometry args={[0.035, 16, 12]} />
              <meshBasicMaterial color={palette.eye} />
            </mesh>
            <mesh position={[0.025, 0.03, 0.13]}>
              <sphereGeometry args={[0.018, 12, 8]} />
              <meshBasicMaterial color="#ffffff" />
            </mesh>
            <mesh ref={rightLidRef} position={[0, 0, 0.14]} scale={[1, 0, 1]}>
              <boxGeometry args={[0.26, 0.28, 0.02]} />
              <meshBasicMaterial color={palette.skin} />
            </mesh>
          </group>
        </>
      )}

      {eyesArced && (
        <>
          {/* Yeux fermés (arc sourire) — tore tronqué */}
          <mesh position={[-0.18, 0.05, 0.88]} rotation={[0, 0, 0]}>
            <torusGeometry args={[0.08, 0.012, 8, 16, Math.PI]} />
            <meshBasicMaterial color={palette.eye} />
          </mesh>
          <mesh position={[0.18, 0.05, 0.88]} rotation={[0, 0, 0]}>
            <torusGeometry args={[0.08, 0.012, 8, 16, Math.PI]} />
            <meshBasicMaterial color={palette.eye} />
          </mesh>
        </>
      )}

      {eyesFrowny && (
        <>
          {/* Yeux froncés (triangles inclinés) */}
          <mesh position={[-0.18, 0.05, 0.88]} rotation={[0, 0, -0.35]}>
            <boxGeometry args={[0.16, 0.025, 0.02]} />
            <meshBasicMaterial color={palette.eye} />
          </mesh>
          <mesh position={[0.18, 0.05, 0.88]} rotation={[0, 0, 0.35]}>
            <boxGeometry args={[0.16, 0.025, 0.02]} />
            <meshBasicMaterial color={palette.eye} />
          </mesh>
          {/* Sourcils */}
          <mesh position={[-0.18, 0.22, 0.86]} rotation={[0, 0, -0.5]}>
            <boxGeometry args={[0.18, 0.028, 0.02]} />
            <meshBasicMaterial color={palette.eye} />
          </mesh>
          <mesh position={[0.18, 0.22, 0.86]} rotation={[0, 0, 0.5]}>
            <boxGeometry args={[0.18, 0.028, 0.02]} />
            <meshBasicMaterial color={palette.eye} />
          </mesh>
        </>
      )}

      {/* Bouche */}
      <Mouth state={state} palette={palette} />

      {/* Joues rosées (done only) */}
      {state === 'done' && palette.blush && (
        <>
          <mesh position={[-0.4, -0.15, 0.78]} scale={[1, 0.5, 0.2]}>
            <sphereGeometry args={[0.08, 16, 12]} />
            <meshBasicMaterial color={palette.blush} transparent opacity={0.5} />
          </mesh>
          <mesh position={[0.4, -0.15, 0.78]} scale={[1, 0.5, 0.2]}>
            <sphereGeometry args={[0.08, 16, 12]} />
            <meshBasicMaterial color={palette.blush} transparent opacity={0.5} />
          </mesh>
        </>
      )}

      {/* Cou + suggestion de buste */}
      <Neck palette={palette} />
    </group>
  )
}

// ── Bouche ──────────────────────────────────────────────────────────────────

function Mouth({ state, palette }: { state: GlanState; palette: StatePalette }) {
  if (state === 'done') {
    // Sourire — arc demi-cercle
    return (
      <mesh position={[0, -0.35, 0.86]} rotation={[0, 0, Math.PI]}>
        <torusGeometry args={[0.13, 0.018, 8, 24, Math.PI]} />
        <meshBasicMaterial color={palette.mouth} />
      </mesh>
    )
  }
  if (state === 'working') {
    // Bouche neutre légèrement étirée
    return (
      <mesh position={[0, -0.35, 0.86]}>
        <boxGeometry args={[0.18, 0.025, 0.02]} />
        <meshBasicMaterial color={palette.mouth} />
      </mesh>
    )
  }
  if (state === 'error') {
    // Bouche inversée (frown)
    return (
      <mesh position={[0, -0.32, 0.86]}>
        <torusGeometry args={[0.12, 0.018, 8, 24, Math.PI]} />
        <meshBasicMaterial color={palette.mouth} />
      </mesh>
    )
  }
  // dormant — petite ligne
  return (
    <mesh position={[0, -0.35, 0.86]}>
      <boxGeometry args={[0.14, 0.018, 0.02]} />
      <meshBasicMaterial color={palette.mouth} transparent opacity={0.7} />
    </mesh>
  )
}

// ── Cheveux : couronne procédurale d'écailles ────────────────────────────────

function Hair({ palette }: { palette: StatePalette }) {
  // Génère un set de "mèches" en cônes + sphères placées en haut/sur les côtés.
  const scales = useMemo(() => {
    const out: { pos: [number, number, number]; rot: [number, number, number]; scale: number; type: 'cone' | 'sphere' }[] = []
    // Calotte arrière : sphères sur le pourtour
    const calotte = 16
    for (let i = 0; i < calotte; i++) {
      const angle = (i / calotte) * Math.PI * 2
      const r = 0.95
      const y = 0.55 + Math.sin(i * 1.3) * 0.05
      out.push({
        pos: [Math.cos(angle) * r * 0.6, y, Math.sin(angle) * r * 0.6 - 0.05],
        rot: [0, angle, 0],
        scale: 0.22 + (i % 3) * 0.04,
        type: 'sphere',
      })
    }
    // Frange — 5 mèches devant
    const fringe = 6
    for (let i = 0; i < fringe; i++) {
      const t = i / (fringe - 1) - 0.5
      out.push({
        pos: [t * 1.0, 0.5, 0.78],
        rot: [0.2, 0, t * 0.3],
        scale: 0.18 + Math.abs(t) * 0.04,
        type: 'cone',
      })
    }
    // Mèches latérales (asymétriques pour signature visuelle)
    out.push({ pos: [-0.85, 0.2, 0.3], rot: [0, 0, -0.5], scale: 0.32, type: 'cone' })
    out.push({ pos: [0.88, 0.25, 0.25], rot: [0, 0, 0.55], scale: 0.28, type: 'cone' })
    // Pointe sommet
    out.push({ pos: [-0.15, 0.95, 0.2], rot: [-0.3, 0, -0.3], scale: 0.25, type: 'cone' })
    return out
  }, [])

  return (
    <group>
      {scales.map((s, i) => (
        <mesh key={i} position={s.pos} rotation={s.rot}>
          {s.type === 'cone' ? (
            <coneGeometry args={[s.scale * 0.55, s.scale * 1.3, 8]} />
          ) : (
            <sphereGeometry args={[s.scale, 16, 12]} />
          )}
          <meshStandardMaterial
            color={i % 4 === 0 ? palette.hairAccent : palette.hair}
            roughness={0.55}
            metalness={0.15}
            emissive={palette.hair}
            emissiveIntensity={0.08}
          />
        </mesh>
      ))}
    </group>
  )
}

// ── Cou + suggestion buste ──────────────────────────────────────────────────

function Neck({ palette }: { palette: StatePalette }) {
  return (
    <group position={[0, -1.05, 0]}>
      {/* Cou */}
      <mesh>
        <cylinderGeometry args={[0.28, 0.32, 0.3, 24]} />
        <meshStandardMaterial color={palette.skinShadow} roughness={0.6} />
      </mesh>
      {/* Col tech / buste suggéré */}
      <mesh position={[0, -0.3, 0]}>
        <cylinderGeometry args={[0.55, 0.75, 0.35, 32]} />
        <meshStandardMaterial
          color={palette.fill}
          roughness={0.4}
          metalness={0.5}
          emissive={palette.rim}
          emissiveIntensity={0.15}
        />
      </mesh>
      {/* Liseré lumineux brand */}
      <mesh position={[0, -0.13, 0]}>
        <torusGeometry args={[0.55, 0.018, 8, 48]} />
        <meshBasicMaterial color={palette.rim} />
      </mesh>
    </group>
  )
}

// ── Orbital ring (anneau tech autour de la tête) ────────────────────────────

function OrbitalRing({ palette, reducedMotion }: { palette: StatePalette; reducedMotion: boolean }) {
  const ref = useRef<THREE.Mesh>(null)
  useFrame((_, dt) => {
    if (ref.current && !reducedMotion) {
      ref.current.rotation.y += dt * 0.25
      ref.current.rotation.z += dt * 0.08
    }
  })
  return (
    <mesh ref={ref} rotation={[Math.PI / 2.3, 0, 0]}>
      <torusGeometry args={[1.45, 0.008, 8, 96]} />
      <meshBasicMaterial color={palette.ring} transparent opacity={0.55} />
    </mesh>
  )
}

// ── Particules micro-lumineuses orbitales ───────────────────────────────────

function Sparkles({ palette, reducedMotion, state }: { palette: StatePalette; reducedMotion: boolean; state: GlanState }) {
  const count = state === 'done' ? 80 : 50
  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3)
    for (let i = 0; i < count; i++) {
      const r = 1.6 + Math.random() * 0.9
      const theta = Math.random() * Math.PI * 2
      const phi = Math.acos(2 * Math.random() - 1)
      arr[i * 3] = r * Math.sin(phi) * Math.cos(theta)
      arr[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta) * 0.6
      arr[i * 3 + 2] = r * Math.cos(phi)
    }
    return arr
  }, [count])

  const ref = useRef<THREE.Points>(null)
  const matRef = useRef<THREE.PointsMaterial>(null)
  useFrame((clock, dt) => {
    if (ref.current && !reducedMotion) {
      ref.current.rotation.y += dt * 0.15
    }
    if (matRef.current && !reducedMotion) {
      // Scintillement
      matRef.current.opacity = 0.6 + Math.sin(clock.clock.elapsedTime * 2) * 0.2
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
        ref={matRef}
        color={palette.particle}
        size={state === 'done' ? 0.035 : 0.022}
        sizeAttenuation
        transparent
        opacity={0.7}
        depthWrite={false}
      />
    </points>
  )
}

// ── Scène complète ──────────────────────────────────────────────────────────

interface SceneProps {
  state: GlanState
  pointerRef: React.MutableRefObject<PointerRef>
  reducedMotion: boolean
}

function Scene({ state, pointerRef, reducedMotion }: SceneProps) {
  const palette = STATE_PALETTE[state]

  return (
    <>
      {/* Lumières */}
      <ambientLight intensity={0.4} color={palette.fill} />
      {/* Key — face/haut */}
      <pointLight position={[2, 3, 4]} intensity={2.5} color={palette.key} distance={12} decay={1.5} />
      {/* Rim — arrière */}
      <pointLight position={[-2, 1, -3]} intensity={2} color={palette.rim} distance={10} decay={1.8} />
      {/* Fill — bas doux */}
      <pointLight position={[0, -2, 2]} intensity={0.8} color={palette.fill} distance={8} decay={2} />
      <directionalLight position={[0, 5, 5]} intensity={0.3} />

      {/* Float drei : flottement vertical doux. Désactivé si reduced-motion. */}
      <Float
        speed={reducedMotion ? 0 : 1.2}
        rotationIntensity={reducedMotion ? 0 : 0.15}
        floatIntensity={reducedMotion ? 0 : 0.4}
      >
        <Head palette={palette} pointerRef={pointerRef} reducedMotion={reducedMotion} state={state} />
      </Float>

      <OrbitalRing palette={palette} reducedMotion={reducedMotion} />
      <Sparkles palette={palette} reducedMotion={reducedMotion} state={state} />
    </>
  )
}

// ── Composant export principal ──────────────────────────────────────────────

const STATE_LABEL: Record<GlanState, string> = {
  dormant: 'Glan au repos',
  working: 'Glan travaille',
  done: 'Glan a terminé',
  error: 'Glan a rencontré une erreur',
}

export function GlanAvatar3DCharacter({
  state = 'dormant',
  size = 320,
  interactive = true,
  className = '',
}: GlanAvatar3DCharacterProps) {
  const reducedMotion = usePrefersReducedMotion()
  const pointerRef = useRef<PointerRef>({ x: 0, y: 0 })
  const containerRef = useRef<HTMLDivElement>(null)

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!interactive || reducedMotion || !containerRef.current) return
    const rect = containerRef.current.getBoundingClientRect()
    // Normalise -1..1 par axe (centre = 0).
    pointerRef.current.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    pointerRef.current.y = ((e.clientY - rect.top) / rect.height) * 2 - 1
  }

  const handlePointerLeave = () => {
    pointerRef.current.x = 0
    pointerRef.current.y = 0
  }

  const palette = STATE_PALETTE[state]
  // Camera adaptative : plus la taille est petite, plus on s'éloigne un peu.
  const cameraZ = size < 200 ? 3.6 : size < 280 ? 3.3 : 3.1

  return (
    <div
      ref={containerRef}
      className={`relative ${className}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label={STATE_LABEL[state]}
      onPointerMove={handlePointerMove}
      onPointerLeave={handlePointerLeave}
    >
      {/* Halo glow radial externe */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 -z-10"
        style={{
          background: `radial-gradient(circle at center, ${palette.halo}55 0%, ${palette.halo}11 35%, transparent 65%)`,
          filter: 'blur(28px)',
        }}
      />
      <Canvas
        camera={{ position: [0, 0.05, cameraZ], fov: 38 }}
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
      >
        <Suspense fallback={null}>
          <Scene state={state} pointerRef={pointerRef} reducedMotion={reducedMotion} />
        </Suspense>
      </Canvas>
    </div>
  )
}

export default GlanAvatar3DCharacter
