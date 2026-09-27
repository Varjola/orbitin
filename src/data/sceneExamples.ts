import type { ProductMode } from '../state/AppState.ts'

/** Curated example scenes: ordinary `s1`
 *  scene links, maintained here and opened from Examples on desktop and in
 *  the mobile menu. They must keep opening like every other shared link, so
 *  a link is never edited in place: a changed example gets a new link.
 *  Their words are in the message catalogues under `examples`.
 *
 *  Catalogue examples name objects by NORAD id and load the newest
 *  published element sets when opened; members absent from the loaded
 *  catalogue are reported like in any shared scene. */
export interface SceneExample {
  readonly id: string
  readonly mode: ProductMode
  /** The fragment of the link, without `#`: `scene=s1.<payload>`. */
  readonly fragment: string
}

export const SCENE_EXAMPLES: readonly SceneExample[] = [
  { id: 'gps-now', mode: 'realObjects', fragment: 'scene=s1.AV3IvQqCUACA0Ws_U0Sv0Bv5Hj1FkFtDbVGQ0FQtiRBK9kO0BA5Bi0hGIMSVAqGlLSsQIu53xlOuC6GJitsQuWqtfdTHB0385NEJEeYZ4V0QfoyYScQoQRgvRDND7D-ISa-gxm2IsC3E20akc8TaQUwXCOkhghVisEEst4jHDhEHiFOEMCXiniKiDHG1imq0EoT_RBjdkhpu_x9f' },
  { id: 'navigation-systems', mode: 'realObjects', fragment: 'scene=s1.AV3Tz0oCYRiF8VGrTUQX1DWI-y6hq5DUIAy0WkRDCm0ag3QaKc3RyhFBEjKlnERLMkKxHIj-EZROIBR9z1n-Ni-Hwzs5L0kOaTq9II0zMxuseZSKQ_rNGEINQPQGoLcB5Q4g0QVs9wD-b4B3CCjZgNiGU4R-BKCpgJEGsA4AxynAbgbQ1QFmDiCfALJ5wHMB0DEBzRYg2gU8WoDWEPCgukTw9QDld4A_PCFCevM_fCzOmYpThGvCmQrIZwAG4S4H0E8BpsGzhPMiwFcC-AkBwhJBrQL2CRohSdi7AsQJCYJKWA24RFgjVGqAKmF0C7AJjRWM3RTA47bXhTf1uO3lISBICMlOEcKE5BbgSQEMCBbhVQMUDwHGEeBLB7wUANkLwNslQKkDgk2WawMS94C6BfiMuEQI7QD6MUDcAMgWIOXFlIPw1B_8AA' },
  { id: 'space-stations', mode: 'realObjects', fragment: 'scene=s1.AWNnYmRgZGTg3p7FAAay_OEn_p84zsgAA7L8q_v_T_rJBBcAAA' },
  { id: 'geostationary-ring', mode: 'realObjects', fragment: 'scene=s1.AWPnZ2BgZODensUABrz839vWfHjIyAADYIH1u5lQBebsQxOYeBBNYMYxNIE36AKzjqMJPL6MJrD-GprAir9oAl1TmVEFrq9GE7i0EU3g3Rk0gadXEQIA' },
  { id: 'arctic-orbits', mode: 'realObjects', fragment: 'scene=s1.AWNnZmRgZGTg3p7FAAay_C-3hLXdYGaAAbBAO4pA1-b_308ywgUA' },
  { id: 'orbit-shapes', mode: 'orbitLab', fragment: 'scene=s1.AWNhYWDg4Xee_5-hd3qekPK9XQ4MUMD-1WZt6OE39gyYYINv_i1HGIfZx9WfiYe_-6I_hP_hJtwIq39_0w5uf2cvoesS8lvxpT26ERDxn_bMvq7-zDz839vWMHBdX1zQOu2JAwNhgGQEpwOzu6s_Cw__yy1hEMlfNx3WuT-sEln33P7_d17Rjt0f7S8pGtfX3GRygNBCDuge4XL18fEMCPF0dvRhAwA' },
]

/** The public link of an example: the site address, `?example=<id>` so
 *  anonymous visit counts can tell examples apart, and the scene fragment. */
export function sceneExampleUrl(example: SceneExample, origin: string): string {
  return `${origin}/?example=${example.id}#${example.fragment}`
}
