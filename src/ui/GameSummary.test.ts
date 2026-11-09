import { describe, expect, it } from 'vitest'
import type { SimulationInstant } from '../core/time.ts'
import { createGame, type BurnRecord } from '../simulation/maneuverGame.ts'
import { GameSummary, type GameSummaryPart } from './GameSummary.ts'
import { buildManeuverPanelModel, type ManeuverPanelModel } from './maneuverPanelModel.ts'

const START: SimulationInstant = { unixSeconds: Date.UTC(2026, 10, 3) / 1000 }
const PARTS = Object.fromEntries(([
  'newGame', 'restart', 'confirm', 'confirmText', 'confirmYes', 'confirmNo', 'status', 'goalLabel', 'goalValue',
  'tankFill', 'tankValue', 'tankEmpty', 'phase', 'distance', 'lowPeriapsis', 'burns', 'noBurns',
] as const).map((part) => [part, `.${part}`])) as Record<GameSummaryPart, string>
const BUTTONS = ['.newGame', '.restart', '.confirmYes', '.confirmNo']

/** One element per selector, made when first asked for: enough of a panel to
 *  follow its buttons, its confirmation and the focus. */
class FakeElement {
  readonly selector: string
  readonly panel: FakePanel
  readonly classList = { toggle: () => {} }
  readonly dataset: Record<string, string> = {}
  readonly style: Record<string, string> = {}
  readonly listeners = new Map<string, () => void>()
  hidden = false
  disabled = false
  textContent = ''
  innerHTML = ''
  childElementCount = 0

  constructor(panel: FakePanel, selector: string) { this.panel = panel; this.selector = selector }
  addEventListener(type: string, listener: () => void): void { this.listeners.set(type, listener) }
  click(): void { this.listeners.get('click')?.() }
  focus(): void { this.panel.ownerDocument.activeElement = this }
  querySelector(selector: string): FakeElement { return this.panel.querySelector(selector) }
  /** The confirmation holds its two answers. */
  contains(other: unknown): boolean {
    return other === this || (this.selector === '.confirm' && other instanceof FakeElement && ['.confirmYes', '.confirmNo'].includes(other.selector))
  }
}

class FakePanel {
  readonly ownerDocument: { activeElement: FakeElement | null } = { activeElement: null }
  private readonly elements = new Map<string, FakeElement>()
  querySelector(selector: string): FakeElement {
    if (!this.elements.has(selector)) this.elements.set(selector, new FakeElement(this, selector))
    return this.elements.get(selector)!
  }
  querySelectorAll(selector: string): FakeElement[] { return selector === 'button' ? BUTTONS.map((button) => this.querySelector(button)) : [] }
}

const BURN: BurnRecord = { direction: 'prograde', start: START, end: START, deltaVKmPerSecond: 0.01, periapsisAltitudeKm: 400, apoapsisAltitudeKm: 430 }

function setup() {
  const panel = new FakePanel()
  const log: string[] = []
  const summary = new GameSummary(panel as unknown as HTMLElement, PARTS, { onNewManeuverGame: () => log.push('new'), onRestartManeuverGame: () => log.push('restart') })
  const fresh = buildManeuverPanelModel(createGame(7, START), START, 'altitude', false)
  const played: ManeuverPanelModel = { ...fresh, burns: [BURN] }
  const part = (name: GameSummaryPart) => panel.querySelector(PARTS[name])
  return { panel, log, summary, fresh, played, part, focused: () => panel.ownerDocument.activeElement?.selector }
}

describe('GameSummary', () => {
  it('replaces a game with no burns at once', () => {
    const { summary, fresh, part, log, focused } = setup()
    summary.sync(fresh, false)
    part('restart').click()
    expect(log).toEqual(['restart'])
    expect(focused()).toBeUndefined()
  })

  it('asks before replacing a game with burns, and Cancel puts the focus back on the button that asked', () => {
    const { summary, played, part, log, focused } = setup()
    summary.sync(played, false)
    part('newGame').click()
    expect(part('confirm').hidden).toBe(false)
    expect(focused()).toBe('.confirmYes')
    part('confirmNo').click()
    expect(part('confirm').hidden).toBe(true)
    expect(focused()).toBe('.newGame')
    expect(log).toEqual([])
  })

  it('runs the action on Yes, with the focus back on the button that asked', () => {
    const { summary, played, part, log, focused } = setup()
    summary.sync(played, false)
    part('restart').click()
    part('confirmYes').click()
    expect(log).toEqual(['restart'])
    expect(part('confirm').hidden).toBe(true)
    expect(focused()).toBe('.restart')
  })

  it('closes the question when the game is decided meanwhile, without losing the focus', () => {
    const { summary, played, part, focused } = setup()
    summary.sync(played, false)
    part('newGame').click()
    summary.sync({ ...played, outcome: 'reentered' }, false)
    expect(part('confirm').hidden).toBe(true)
    expect(focused()).toBe('.newGame')
  })
})
