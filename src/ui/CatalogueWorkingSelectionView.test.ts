import { expect, it } from 'vitest'
import { catalogueWorkingSelectionMarkup } from './CatalogueWorkingSelectionView.ts'
import viewSource from './CatalogueWorkingSelectionView.ts?raw'

const CATALOGUE_WORKING_SELECTION_MARKUP = catalogueWorkingSelectionMarkup()

const tag = (id: string) => CATALOGUE_WORKING_SELECTION_MARKUP.match(new RegExp(`<[a-z0-9]+ id="${id}"[^>]*>`))?.[0] ?? ''

it('announces outcomes politely, failures and capacity as alerts, and labels tray removal per item', () => {
  expect(tag('catalogue-selection-outcome')).toContain('role="status"')
  expect(tag('catalogue-selection-error')).toContain('role="alert"')
  expect(tag('catalogue-selection-capacity')).toContain('role="alert"')
  expect(tag('catalogue-selection-list')).toContain('aria-labelledby="catalogue-selection-heading"')
  expect(CATALOGUE_WORKING_SELECTION_MARKUP).toMatch(/id="catalogue-selection-clear"[^>]*disabled>Clear working selection</)
  expect(CATALOGUE_WORKING_SELECTION_MARKUP).toMatch(/id="catalogue-view-scene"[^>]*hidden>View scene</)
  expect(viewSource).toContain('labelledAction(text().catalogue.removeFromWorkingSelection, item.name)')
})

it('adds the whole ordered selection through one callback, guards re-entry and offers no scene removal', () => {
  expect(viewSource).toContain('await this.callbacks.onAddSelected(this.model.ids)')
  expect(viewSource).toContain('if (this.pending || !buildWorkingSelectionPresentation(this.model, false).addEnabled) return')
  expect(viewSource).not.toMatch(/CatalogueClient|loadRecord|resolveRecords|addCatalogueRecordsToScene|onRemoveSceneObjects|removeObjects/)
  // Clear is immediate: no confirmation dialog.
  expect(viewSource).not.toMatch(/confirm\(|role="alertdialog"|<dialog/)
})
