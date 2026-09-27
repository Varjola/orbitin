# SGP4 fixtures

`vallado.ts` contains fixed, offline regression data. It is not downloaded at
test time.

- `VANGUARD_1_*`: Vanguard-1 / NORAD 00005, from Vallado et al., “Revisiting
  Spacetrack Report #3”, AIAA 2006-6753, Appendix C and Appendix D. The
  published TEME values are in km and km/s at 0 and +4320 minutes from epoch.
  The expected values retain the paper's printed precision.
- `MOLNIYA_2_14_*`: the resonant deep-space verification record from the same
  Appendix D listing. This fixture verifies satellite.js selects its SDP4
  branch; no independent position baseline is asserted here.
- `HIGH_DRAG_*`: the high-drag community-decay regression described in
  [satellite.js issue #152](https://github.com/shashwatak/satellite.js/issues/152).
  It verifies the separate non-standard community check at +745 days and the
  ordinary SGP4 decay error at +215 days.

Primary numerical source: [CelesTrak AIAA 2006-6753](https://celestrak.org/publications/AIAA/2006-6753/),
retrieved 2026-09-09. Community-policy source: the linked satellite.js issue
and the [satellite.js community-decay documentation](https://shashwatak.github.io/satellite-js/docs/propagation/community-decay-check),
retrieved 2026-09-09.
