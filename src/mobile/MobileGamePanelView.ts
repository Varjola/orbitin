import { text } from '../i18n/index.ts'
import { html, trusted } from '../ui/markup.ts'
import { GameSummary } from '../ui/GameSummary.ts'
import type { ManeuverPanelModel } from '../ui/maneuverPanelModel.ts'
import { GOAL_KEYS, ORBIT_ROWS } from '../ui/maneuverWording.ts'
import type { UiCallbacks } from '../ui/uiTypes.ts'
import { budgetsMarkup } from '../ui/routeResultMarkup.ts'

/** The short note the info button opens: what a Hohmann transfer is. */
export class MobileHohmannPanelView {
  readonly root: HTMLElement

  constructor(documentRef: Document) {
    this.root = documentRef.createElement('div')
    this.root.className = 'm-hohmann'
    this.root.innerHTML = text().maneuvers.hohmann.paragraphs.map((paragraph) => html`<p>${paragraph}</p>`).join('')
  }
}

/** The note the info button opens in Routes: what Δv real satellites carry. */
export class MobileRouteBudgetsPanelView {
  readonly root: HTMLElement

  constructor(documentRef: Document) {
    this.root = documentRef.createElement('div')
    this.root.className = 'm-hohmann m-route-budgets'
    this.root.innerHTML = budgetsMarkup()
  }
}

/** The phone's game panel: the game actions, the result, the goal, the tank,
 *  where the target is, both orbits and the burn log. */
export class MobileGamePanelView {
  readonly root: HTMLElement
  private readonly summary: GameSummary

  constructor(documentRef: Document, callbacks: UiCallbacks) {
    const t = text().maneuvers
    this.root = documentRef.createElement('div')
    this.root.className = 'm-game'
    this.root.innerHTML = html`
      <div class="m-button-row">
        <button class="m-button m-game-new" type="button">${t.newGame}</button>
        <button class="m-button m-game-restart" type="button">${t.restart}</button>
      </div>
      <div class="m-game-confirm" role="group" hidden>
        <p class="m-line m-game-confirm-text"></p>
        <div class="m-button-row"><button class="m-button is-primary m-game-confirm-yes" type="button"></button><button class="m-button m-game-confirm-no" type="button">${t.cancel}</button></div>
      </div>
      <p class="m-game-status" role="status" hidden></p>
      <p class="m-line m-game-intro">${t.intro}</p>
      <h3 class="m-subheading">${t.goal}</h3>
      <ul class="m-game-goals">${trusted(GOAL_KEYS.map((key) => html`<li class="m-game-goal" data-goal="${key}"><span class="m-game-goal-mark" aria-hidden="true"></span><span class="m-game-goal-label"></span><span class="m-game-goal-value"></span></li>`).join(''))}</ul>
      <h3 class="m-subheading">${t.tank}</h3>
      <div class="m-game-tank" aria-hidden="true"><span class="m-game-tank-fill"></span></div>
      <p class="m-line m-game-tank-value"></p>
      <p class="m-line m-game-tank-empty" hidden>${t.tankEmpty}</p>
      <dl class="m-game-facts"><dt>${t.relative}</dt><dd class="m-game-phase">—</dd><dt>${t.distance}</dt><dd class="m-game-distance">—</dd></dl>
      <table class="m-game-orbits">
        <thead><tr><th scope="col"><span class="sr-only">${t.yourOrbit}</span></th><th scope="col" class="m-game-you">${t.yourOrbit}</th><th scope="col" class="m-game-target">${t.targetOrbit}</th></tr></thead>
        <tbody>${trusted(ORBIT_ROWS.map((row) => html`<tr data-row="${row.key}"><th scope="row">${row.label()}</th><td data-of="player">—</td><td data-of="target">—</td></tr>`).join(''))}</tbody>
      </table>
      <p class="m-line m-game-low" hidden>${t.lowPeriapsis}</p>
      <h3 class="m-subheading">${t.burns}</h3>
      <ol class="m-game-burns"></ol>
      <p class="m-line m-game-no-burns">${t.noBurns}</p>
      <details class="m-game-model"><summary>${t.modelHeading}</summary><ul>${trusted(t.modelNotes.map((note) => html`<li>${note}</li>`).join(''))}</ul></details>
    `
    this.summary = new GameSummary(this.root, {
      newGame: '.m-game-new', restart: '.m-game-restart', confirm: '.m-game-confirm', confirmText: '.m-game-confirm-text',
      confirmYes: '.m-game-confirm-yes', confirmNo: '.m-game-confirm-no', status: '.m-game-status',
      goalLabel: '.m-game-goal-label', goalValue: '.m-game-goal-value', tankFill: '.m-game-tank-fill', tankValue: '.m-game-tank-value',
      tankEmpty: '.m-game-tank-empty', phase: '.m-game-phase', distance: '.m-game-distance', lowPeriapsis: '.m-game-low',
      burns: '.m-game-burns', noBurns: '.m-game-no-burns',
    }, callbacks)
  }

  sync(model: ManeuverPanelModel | null, loading: boolean): void { this.summary.sync(model, loading) }

  dispose(): void { this.root.remove() }
}
