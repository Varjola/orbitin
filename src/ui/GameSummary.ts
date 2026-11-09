import { text } from '../i18n/index.ts'
import { html } from './markup.ts'
import type { ManeuverPanelModel } from './maneuverPanelModel.ts'
import { burnLine, distanceText, goalLines, ORBIT_ROWS, orbitValue, phaseText, replacingNeedsConfirmation, statusText, tankText } from './maneuverWording.ts'
import type { UiCallbacks } from './uiTypes.ts'

type GameAction = 'newGame' | 'restart'

/** The parts of a game panel, each found by a selector in that panel's markup.
 *  Goals are `[data-goal]` items holding `goalLabel` and `goalValue`; the orbit
 *  table's cells are `[data-row] [data-of]`. */
export type GameSummaryPart =
  | 'newGame' | 'restart' | 'confirm' | 'confirmText' | 'confirmYes' | 'confirmNo' | 'status'
  | 'goalLabel' | 'goalValue' | 'tankFill' | 'tankValue' | 'tankEmpty' | 'phase' | 'distance'
  | 'lowPeriapsis' | 'burns' | 'noBurns'

/** What the desktop drawer and the phone's game panel share: the game actions
 *  with their confirmation, the result, the goal, the tank, where the target is,
 *  both orbits and the burn log. Each panel has its own markup. */
export class GameSummary {
  private readonly root: HTMLElement
  private readonly parts: Readonly<Record<GameSummaryPart, string>>
  private readonly callbacks: Pick<UiCallbacks, 'onNewManeuverGame' | 'onRestartManeuverGame'>
  private model: ManeuverPanelModel | null = null
  private pending: GameAction | null = null
  private status = ''

  constructor(root: HTMLElement, parts: Readonly<Record<GameSummaryPart, string>>, callbacks: Pick<UiCallbacks, 'onNewManeuverGame' | 'onRestartManeuverGame'>) {
    this.root = root
    this.parts = parts
    this.callbacks = callbacks
    this.find<HTMLButtonElement>('newGame').addEventListener('click', () => this.request('newGame'))
    this.find<HTMLButtonElement>('restart').addEventListener('click', () => this.request('restart'))
    this.find<HTMLButtonElement>('confirmYes').addEventListener('click', () => this.confirm())
    this.find<HTMLButtonElement>('confirmNo').addEventListener('click', () => this.setPending(null))
  }

  sync(model: ManeuverPanelModel | null, loading: boolean): void {
    this.model = model
    for (const button of this.root.querySelectorAll<HTMLButtonElement>('button')) button.disabled = loading || !model
    if (!model) return
    for (const goal of goalLines(model)) {
      const item = this.root.querySelector<HTMLElement>(`[data-goal="${goal.key}"]`)!
      item.classList.toggle('is-met', goal.met)
      item.querySelector(this.parts.goalLabel)!.textContent = goal.label
      item.querySelector(this.parts.goalValue)!.textContent = goal.value
    }
    this.find('tankFill').style.width = `${(100 * model.remainingKmPerSecond / model.tankKmPerSecond).toFixed(1)}%`
    this.find('tankValue').textContent = tankText(model)
    this.find('tankEmpty').hidden = model.remainingKmPerSecond > 0 || model.outcome !== null
    this.find('phase').textContent = phaseText(model)
    this.find('distance').textContent = distanceText(model.goals.distanceKm)
    for (const row of ORBIT_ROWS) {
      this.root.querySelector(`[data-row="${row.key}"] [data-of="player"]`)!.textContent = orbitValue(model.player, row.key)
      this.root.querySelector(`[data-row="${row.key}"] [data-of="target"]`)!.textContent = orbitValue(model.target, row.key)
    }
    this.root.querySelector('[data-row="periapsisAltitudeKm"] [data-of="player"]')!.classList.toggle('is-warning', model.lowPeriapsis)
    this.find('lowPeriapsis').hidden = !model.lowPeriapsis || model.outcome !== null
    const list = this.find('burns')
    this.find('noBurns').hidden = model.burns.length > 0
    if (list.childElementCount !== model.burns.length) list.innerHTML = model.burns.map((burn) => html`<li>${burnLine(burn)}</li>`).join('')
    this.renderStatus(model)
    // A decided game has nothing left to replace by mistake.
    if (model.outcome && this.pending) this.setPending(null)
  }

  private find<T extends HTMLElement = HTMLElement>(part: GameSummaryPart): T {
    return this.root.querySelector<T>(this.parts[part])!
  }

  private renderStatus(model: ManeuverPanelModel): void {
    const status = statusText(model)
    if (status === this.status) return
    this.status = status
    const element = this.find('status')
    element.hidden = status === ''
    element.dataset.outcome = model.outcome ?? ''
    element.textContent = status
  }

  private request(action: GameAction): void {
    if (replacingNeedsConfirmation(this.model)) this.setPending(action)
    else this.run(action)
  }

  private confirm(): void {
    const action = this.pending
    this.setPending(null)
    if (action) this.run(action)
  }

  private run(action: GameAction): void {
    if (action === 'newGame') this.callbacks.onNewManeuverGame()
    else this.callbacks.onRestartManeuverGame()
  }

  /** Asking puts the focus on the answer; answering, or a game decided while
   *  asking, puts it back on the button that asked. */
  private setPending(action: GameAction | null): void {
    const asked = this.pending
    this.pending = action
    const confirm = this.find('confirm')
    const hadFocus = confirm.contains(this.root.ownerDocument.activeElement)
    confirm.hidden = action === null
    if (!action) {
      if (asked && hadFocus) this.find<HTMLButtonElement>(asked).focus()
      return
    }
    const t = text().maneuvers
    this.find('confirmText').textContent = action === 'newGame' ? t.confirmNewGame : t.confirmRestart
    const yes = this.find<HTMLButtonElement>('confirmYes')
    yes.textContent = action === 'newGame' ? t.newGame : t.restart
    yes.focus()
  }
}
