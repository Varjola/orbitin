export interface R2ObjectLike {
  readonly body?: ReadableStream<Uint8Array>
  readonly size: number
  readonly etag?: string
  readonly httpEtag?: string
  readonly checksums?: { readonly sha256?: ArrayBuffer | string }
  readonly httpMetadata?: { readonly contentType?: string; readonly cacheControl?: string }
}

/** R2 returns at most 1,000 keys per call; `truncated` and `cursor` continue a
 * listing. */
export interface R2ListResultLike { readonly objects: readonly { readonly key: string }[]; readonly truncated?: boolean; readonly cursor?: string }

export interface R2BucketLike {
  get(key: string, options?: unknown): Promise<R2ObjectLike | null>
  head(key: string): Promise<R2ObjectLike | null>
  put(key: string, value: ArrayBuffer | Uint8Array | string, options?: unknown): Promise<R2ObjectLike | null>
  delete(key: string): Promise<void>
  list(options?: unknown): Promise<R2ListResultLike>
}

/** The only bucket operation catalogue serving needs. Frontend Workers type
 * their binding with this so write methods are not reachable in their code.
 * This is a code boundary, not an R2 permission. */
export type R2ReadableBucketLike = Pick<R2BucketLike, 'get'>

export interface WorkerAssets { fetch(request: Request): Promise<Response> }
export interface WorkerExecutionContext { waitUntil(promise: Promise<unknown>): void }

/** The one Analytics Engine operation the frontend event sink uses. */
export interface AnalyticsEngineDatasetLike {
  writeDataPoint(point: { readonly indexes?: readonly string[]; readonly blobs?: readonly string[]; readonly doubles?: readonly number[] }): void
}
