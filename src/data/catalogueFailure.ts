/** Why a catalogue operation failed, independent of language. `message` is
 *  the English developer text; the interface words the failure from `kind`. */
export type CatalogueFailureKind =
  | 'unavailable' | 'refresh-failed' | 'http' | 'invalid' | 'not-loaded' | 'not-indexed'
  | 'disposed' | 'closed' | 'snapshot-changed' | 'unknown'

export interface CatalogueFailure {
  readonly kind: CatalogueFailureKind
  readonly message: string
  /** HTTP status of an `http` failure. */
  readonly status?: number
}

/** A catalogue error that carries its failure kind. */
export class CatalogueClientError extends Error {
  readonly cause?: unknown
  readonly kind: CatalogueFailureKind
  readonly status?: number
  constructor(message: string, options: { readonly kind?: CatalogueFailureKind; readonly cause?: unknown; readonly status?: number } = {}) {
    super(message); this.name = 'CatalogueClientError'; this.kind = options.kind ?? 'invalid'; this.cause = options.cause
    if (options.status !== undefined) this.status = options.status
  }
}

/** The language-independent failure of any error a catalogue operation threw. */
export function catalogueFailureOf(error: unknown, fallback: string): CatalogueFailure {
  if (error instanceof CatalogueClientError) return { kind: error.kind, message: error.message, ...(error.status === undefined ? {} : { status: error.status }) }
  return { kind: 'unknown', message: error instanceof Error ? error.message : fallback }
}
