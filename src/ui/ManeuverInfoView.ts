import { text } from '../i18n/index.ts'
import { html, trusted } from './markup.ts'

/** The Interception right drawer: the Hohmann transfer note, then the model notes. */
export class ManeuverInfoView {
  readonly root: HTMLElement

  constructor(container: HTMLElement) {
    this.root = container
    this.root.dataset.region = 'maneuverInfo'
    const t = text().maneuvers
    this.root.innerHTML = html`
      <section class="maneuver-hohmann" aria-labelledby="inspector-heading">
        ${trusted(t.hohmann.paragraphs.map((paragraph) => html`<p>${paragraph}</p>`).join(''))}
      </section>
      <details class="field-group maneuver-model">
        <summary>${t.modelHeading}</summary>
        <ul>${trusted(t.modelNotes.map((note) => html`<li>${note}</li>`).join(''))}</ul>
      </details>
    `
  }

  dispose(): void { this.root.textContent = '' }
}
