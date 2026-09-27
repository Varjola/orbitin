export type { R2BucketLike, R2ListResultLike, R2ObjectLike, WorkerAssets, WorkerExecutionContext } from '../shared/types.ts'
import type { R2BucketLike } from '../shared/types.ts'
import type { AlertMailEnv } from '../shared/alertMail.ts'

/** Operator alerts: the optional `CATALOGUE_ALERT_EMAIL`
 *  send_email binding and the `CATALOGUE_ALERT_TO` / `CATALOGUE_ALERT_FROM`
 *  secrets come from `AlertMailEnv`. Like the Space-Track secrets they are
 *  never logged or stored, and nothing in `src/` may read them. */
export interface CatalogueWorkerEnv extends AlertMailEnv {
  readonly CATALOGUE_BUCKET: R2BucketLike
  readonly CATALOGUE_CONFIG_REVISION?: string
  readonly CATALOGUE_ENABLED?: string
  /** Which ingestion provider this deployment uses: `fixture` (default) or
   * `space-track`. Declared in the catalogue Worker config; never a secret. */
  readonly CATALOGUE_PROVIDER?: string
  /** Retrieval shape: `selected-ids` (default; the twice-daily batched
   * query) or `gp-sweep` (the hourly persistent keyset sweep of the
   * automatic catalogue). `gp-sweep` needs an hourly Cron. Never a secret. */
  readonly CATALOGUE_RETRIEVAL?: string
  /** Fixture provider only: size of the synthetic catalogue served to
   * `gp-sweep`, for scale and Worker memory measurement. Absent serves the defined
   * catalogue members. */
  readonly CATALOGUE_FIXTURE_SWEEP_RECORDS?: string
  /** Preview/local operator-only failure injection. It is accepted only with
   * the fixture provider, so production Space-Track ingestion cannot be
   * faulted accidentally by a leftover development binding. */
  readonly CATALOGUE_TEST_FAULT?: string
  /** Space-Track credentials. These are Cloudflare Worker secrets, supplied
   * with `wrangler secret put`. They exist only in the scheduled ingestion
   * path, are never written to R2, never returned by an API response and never
   * logged. Nothing in `src/` may read them. */
  readonly SPACETRACK_IDENTITY?: string
  readonly SPACETRACK_PASSWORD?: string
}
