import { afterEach, expect, it } from 'vitest'
import { activeLocale, text } from '../i18n/index.ts'
import { setActiveLocale } from '../i18n/active.ts'
import { pseudoCatalogue } from '../i18n/messages/pseudo.ts'
import { LOCALE_STORAGE_KEY, LocaleController, resolveInitialLocale, type LocaleEnvironment, type LocaleStorage } from './LocaleController.ts'

afterEach(() => setActiveLocale('en'))

function memoryStorage(initial: Record<string, string> = {}): LocaleStorage & { readonly values: Map<string, string> } {
  const values = new Map(Object.entries(initial))
  return { values, getItem: (key) => values.get(key) ?? null, setItem: (key, value) => { values.set(key, value) } }
}

function environment(storage: () => LocaleStorage | null): LocaleEnvironment & { readonly documentElement: { lang: string } } {
  return { storage, documentElement: { lang: 'en' } }
}

it('opens in Finnish only when this browser remembers Finnish', () => {
  expect(resolveInitialLocale('fi')).toBe('fi')
  for (const stored of [null, 'en', 'FI', 'sv', '', ' fi', 'fi-FI']) expect(resolveInitialLocale(stored), String(stored)).toBe('en')
})

it('never consults the browser language', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator')
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { language: 'fi-FI', languages: ['fi-FI', 'fi'] } })
  try {
    expect(new LocaleController(environment(() => memoryStorage())).locale).toBe('en')
  } finally {
    if (original) Object.defineProperty(globalThis, 'navigator', original)
    else delete (globalThis as { navigator?: unknown }).navigator
  }
})

it('reads the remembered choice defensively and applies it with the document language', () => {
  const remembered = environment(() => memoryStorage({ [LOCALE_STORAGE_KEY]: 'fi' }))
  expect(new LocaleController(remembered).locale).toBe('fi')
  expect(remembered.documentElement.lang).toBe('fi')
  expect(activeLocale()).toBe('fi')
  expect(text().shell.modes.orbitLab).toBe('Kiertoradan mekaniikat')
  const blocked = environment(() => { throw new Error('SecurityError') })
  expect(new LocaleController(blocked).locale).toBe('en')
  expect(blocked.documentElement.lang).toBe('en')
})

it('applies and remembers a change at once, and does nothing for the current language', () => {
  const storage = memoryStorage()
  const env = environment(() => storage)
  const controller = new LocaleController(env)
  const heard: string[] = []
  controller.onChange((locale) => heard.push(locale))
  controller.change('en')
  expect(heard).toEqual([])
  expect(storage.values.size).toBe(0)
  controller.change('fi')
  expect(heard).toEqual(['fi'])
  expect(storage.values.get(LOCALE_STORAGE_KEY)).toBe('fi')
  expect(env.documentElement.lang).toBe('fi')
  controller.change('en')
  expect(storage.values.get(LOCALE_STORAGE_KEY)).toBe('en')
  expect(text().shell.modes.orbitLab).toBe('Orbit Lab')
})

it('keeps the choice for this page when storage refuses it', () => {
  const env = environment(() => ({ getItem: () => null, setItem: () => { throw new Error('QuotaExceededError') } }))
  const controller = new LocaleController(env)
  const heard: string[] = []
  controller.onChange((locale) => heard.push(locale))
  expect(() => controller.change('fi')).not.toThrow()
  expect(heard).toEqual(['fi'])
  expect(controller.locale).toBe('fi')
})

it('runs the pseudo-locale as English wrapped, without remembering it', () => {
  const storage = memoryStorage()
  const env = environment(() => storage)
  const controller = new LocaleController(env)
  controller.usePseudo(pseudoCatalogue())
  expect(controller.locale).toBe('pseudo')
  expect(env.documentElement.lang).toBe('en')
  expect(text().shell.inspector).toMatch(/^⟦Inspector~+⟧$/)
  expect(storage.values.size).toBe(0)
})
