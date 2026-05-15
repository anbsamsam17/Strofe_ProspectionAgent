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
