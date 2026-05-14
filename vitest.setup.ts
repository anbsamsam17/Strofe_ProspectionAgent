import '@testing-library/jest-dom'
import { vi } from 'vitest'

// jsdom ne supporte pas `Element.prototype.scrollIntoView` nativement.
// Plusieurs composants UI l'utilisent (multi-select à la `NafCodeMultiSelect`,
// menus avec navigation clavier) — on stub pour éviter
// `TypeError: node?.scrollIntoView is not a function` en tests.
if (typeof window !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = vi.fn()
}
