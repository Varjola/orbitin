import { text } from '../i18n/index.ts'
import { GameSummary } from './GameSummary.ts'
import { html, trusted } from './markup.ts'
import type { ManeuverPanelModel } from './maneuverPanelModel.ts'
import { GOAL_KEYS, ORBIT_ROWS } from './maneuverWording.ts'
import type { UiCallbacks } from './uiTypes.ts'

/** The Interception workspace: the game actions, the goal, the tank, where the
 *  target is, both orbits and the burn log. */
export class ManeuverDrawerView {
  readonly root: HTMLElement
  private readonly summary: GameSummary

  constructor(container: HTMLElement, callbacks: UiCallbacks) {
    this.root = container
    this.root.dataset.region = 'maneuversDrawer'
    const t = text().maneuvers
    this.root.innerHTML = html`
      <div class="maneuver-game-actions">
        <div class="button-row">
          <button id="maneuver-new-game" class="action-button" type="button">${t.newGame}</button>
          <button id="maneuver-restart" class="action-button" type="button">${t.restart}</button>
        </div>
        <div id="maneuver-confirm" class="maneuver-confirm" role="group" hidden>
          <p id="maneuver-confirm-text" class="time-note"></p>
          <div class="button-row"><button id="maneuver-confirm-yes" class="action-button primary-action" type="button"></button><button id="maneuver-confirm-no" class="action-button" type="button">${t.cancel}</button></div>
        </div>
      </div>
      <p id="maneuver-status" class="maneuver-status" role="status" hidden></p>
      <div class="workspace-intro"><p class="time-note">${t.intro}</p></div>
      <section class="field-group" aria-labelledby="maneuver-goal-heading">
        <div class="group-heading"><span id="maneuver-goal-heading">${t.goal}</span></div>
        <ul class="maneuver-goals">${trusted(GOAL_KEYS.map((key) => html`<li class="maneuver-goal" data-goal="${key}"><span class="maneuver-goal-mark" aria-hidden="true"></span><span class="maneuver-goal-label"></span><span class="maneuver-goal-value"></span></li>`).join(''))}</ul>
      </section>
      <section class="field-group" aria-labelledby="maneuver-tank-heading">
        <div class="group-heading"><span id="maneuver-tank-heading">${t.tank}</span><span id="maneuver-tank-value" class="group-hint"></span></div>
        <div class="maneuver-tank" aria-hidden="true"><span id="maneuver-tank-fill"></span></div>
        <p id="maneuver-tank-empty" class="time-note" hidden>${t.tankEmpty}</p>
      </section>
      <section class="field-group" aria-labelledby="maneuver-relative-heading">
        <div class="group-heading"><span id="maneuver-relative-heading">${t.relative}</span></div>
        <div class="readout-grid"><span>${t.relative}</span><strong id="maneuver-phase">—</strong><span>${t.distance}</span><strong id="maneuver-distance">—</strong></div>
      </section>
      <section class="field-group">
        <table class="maneuver-orbits">
          <thead><tr><th scope="col"><span class="sr-only">${t.yourOrbit}</span></th><th scope="col" class="maneuver-you">${t.yourOrbit}</th><th scope="col" class="maneuver-target">${t.targetOrbit}</th></tr></thead>
          <tbody>${trusted(ORBIT_ROWS.map((row) => html`<tr data-row="${row.key}"><th scope="row">${row.label()}</th><td data-of="player">—</td><td data-of="target">—</td></tr>`).join(''))}</tbody>
        </table>
        <p id="maneuver-low-periapsis" class="maneuver-warning" hidden>${t.lowPeriapsis}</p>
      </section>
      <section class="field-group" aria-labelledby="maneuver-burns-heading">
        <div class="group-heading"><span id="maneuver-burns-heading">${t.burns}</span></div>
        <ol id="maneuver-burns" class="maneuver-burns"></ol>
        <p id="maneuver-no-burns" class="time-note">${t.noBurns}</p>
      </section>
    `
    this.summary = new GameSummary(this.root, {
      newGame: '#maneuver-new-game', restart: '#maneuver-restart', confirm: '#maneuver-confirm', confirmText: '#maneuver-confirm-text',
      confirmYes: '#maneuver-confirm-yes', confirmNo: '#maneuver-confirm-no', status: '#maneuver-status',
      goalLabel: '.maneuver-goal-label', goalValue: '.maneuver-goal-value', tankFill: '#maneuver-tank-fill', tankValue: '#maneuver-tank-value',
      tankEmpty: '#maneuver-tank-empty', phase: '#maneuver-phase', distance: '#maneuver-distance', lowPeriapsis: '#maneuver-low-periapsis',
      burns: '#maneuver-burns', noBurns: '#maneuver-no-burns',
    }, callbacks)
  }

  sync(model: ManeuverPanelModel | null, loading: boolean): void {
    this.root.toggleAttribute('aria-busy', loading)
    this.summary.sync(model, loading)
  }

  dispose(): void { this.root.textContent = '' }
}
