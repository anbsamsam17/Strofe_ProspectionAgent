import '@testing-library/jest-dom'
import { vi } from 'vitest'

// jsdom ne supporte pas `Element.prototype.scrollIntoView` nativement.
// Plusieurs composants UI l'utilisent (multi-select à la `NafCodeMultiSelect`,
// menus avec navigation clavier) — on stub pour éviter
// `TypeError: node?.scrollIntoView is not a function` en tests.
if (typeof window !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn()
}

// jsdom ne fournit pas `window.matchMedia` par défaut. Plusieurs composants
// l'utilisent pour `prefers-reduced-motion` (PipelineClient tilt 3D,
// GlanAvatar3DCharacter head-tracking, GlanCharacterLoader fallback).
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }))
}

// jsdom ne fournit pas `ResizeObserver` (utilisé par PipelineClient pour
// recalculer la disposition des colonnes Kanban, ainsi que par plusieurs
// primitives Radix/headless). Sans ce stub : `ResizeObserver is not defined`.
if (typeof globalThis !== 'undefined' && !('ResizeObserver' in globalThis)) {
  class ResizeObserverStub {
    observe = vi.fn()
    unobserve = vi.fn()
    disconnect = vi.fn()
  }
  globalThis.ResizeObserver =
    ResizeObserverStub as unknown as typeof ResizeObserver
}

// jsdom ne fournit pas non plus `IntersectionObserver` (gap classique) —
// utilisé pour le lazy-loading / les animations à l'apparition. On stub
// pour éviter `IntersectionObserver is not defined` en tests.
if (typeof globalThis !== 'undefined' && !('IntersectionObserver' in globalThis)) {
  class IntersectionObserverStub {
    readonly root = null
    readonly rootMargin = ''
    readonly thresholds: ReadonlyArray<number> = []
    observe = vi.fn()
    unobserve = vi.fn()
    disconnect = vi.fn()
    takeRecords = vi.fn(() => [])
  }
  globalThis.IntersectionObserver =
    IntersectionObserverStub as unknown as typeof IntersectionObserver
}
