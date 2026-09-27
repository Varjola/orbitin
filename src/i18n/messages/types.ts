import type { english } from './en.ts'

/** The shape every locale's catalogue must satisfy: the English catalogue's
 *  keys, and its message functions' parameters. Strings are compared for
 *  structure only. */
export type MessageCatalogue = ReturnType<typeof english>
