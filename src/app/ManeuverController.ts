import { MAX_SIMULATION_INSTANT } from '../core/constants.ts'
import { addSeconds, secondsBetween, type SimulationInstant } from '../core/time.ts'
import { beginBurn, continueBurn, createGame, endBurn, gameScore, restartGame, settleOutcome, type BurnDirection, type ManeuverGame } from '../simulation/maneuverGame.ts'
import { burnCountBucket, efficiencyBucket, type UsageEvent } from './usageEvents.ts'

/** A game's rate when it starts: 2 min/s. */
export const GAME_SPEED_MULTIPLIER = 120
/** A game needs room before the end of the supported time range. */
const END_OF_RANGE_MARGIN_SECONDS = 30 * 86_400
const END_OF_RANGE_SHIFT_SECONDS = 60 * 86_400

export interface ClockSetting {
  readonly speedMultiplier: number
  readonly playing: boolean
}

/** The one shared clock, as the game drives it. Time always runs forward in a
 *  game, so setting the clock also clears reverse playback. */
export interface ManeuverClockPort {
  instant(): SimulationInstant
  setting(): ClockSetting
  set(setting: ClockSetting, instant?: SimulationInstant): void
}

/** Owns the Interception game and its burn input. The game is session-only and
 *  changes every frame during a burn, so it lives here rather than in the
 *  application state. The clock stays the one shared clock: a burn runs it at
 *  1× and a release restores the rate and play state from before the press. */
export class ManeuverController {
  private current: ManeuverGame | null = null
  private beforeBurn: ClockSetting | null = null
  private lastInstant: SimulationInstant | null = null
  private resume: { readonly instant: SimulationInstant; readonly speedMultiplier: number } | null = null
  private readonly clock: ManeuverClockPort
  private readonly record: (event: UsageEvent) => void
  private readonly drawSeed: () => number

  constructor(clock: ManeuverClockPort, record: (event: UsageEvent) => void, drawSeed: () => number = () => Math.floor(Math.random() * 2 ** 32)) {
    this.clock = clock
    this.record = record
    this.drawSeed = drawSeed
  }

  get game(): ManeuverGame | null { return this.current }
  get burning(): BurnDirection | null { return this.current?.activeBurn?.direction ?? null }

  /** Entering the mode. The first entry draws a game and starts it running. A
   *  return puts the clock back at the game's instant and rate, paused, so a
   *  game never moves on unseen. True when a new game was drawn. */
  enter(): boolean {
    if (!this.current) { this.start(); return true }
    this.clock.set({ speedMultiplier: this.resume?.speedMultiplier ?? GAME_SPEED_MULTIPLIER, playing: false }, this.resume?.instant)
    this.lastInstant = this.clock.instant()
    return false
  }

  /** Leaving the mode ends any burn and remembers where the game was. */
  leave(): void {
    this.release()
    this.resume = { instant: this.clock.instant(), speedMultiplier: this.clock.setting().speedMultiplier }
  }

  newGame(): void {
    this.recordAbandoned('new-game')
    this.start()
  }

  /** The same start, a full tank and an empty log. */
  restart(): void {
    const game = this.current
    if (!game) return
    this.recordAbandoned('restarted')
    this.release()
    this.current = restartGame(game)
    this.clock.set({ speedMultiplier: GAME_SPEED_MULTIPLIER, playing: true }, this.current.startInstant)
    this.lastInstant = this.current.startInstant
  }

  /** Starts a burn: the clock runs at 1×, playing, until release. */
  press(direction: BurnDirection): void {
    const game = this.current
    if (!game || game.activeBurn) return
    const at = this.clock.instant()
    const next = beginBurn(game, direction, at)
    if (next === game) return
    this.current = next
    this.beforeBurn = this.clock.setting()
    this.lastInstant = at
    this.clock.set({ speedMultiplier: 1, playing: true })
  }

  /** Ends a burn and restores the clock as it was before the press. */
  release(): void {
    const game = this.current
    if (game?.activeBurn) this.current = endBurn(game, this.lastInstant ?? this.clock.instant())
    this.restoreClock()
  }

  /** One simulation step: thrust while a burn is held, then decide the game. */
  frame(now: SimulationInstant): void {
    const game = this.current
    if (!game) return
    const from = this.lastInstant ?? now
    this.lastInstant = now
    if (game.outcome || secondsBetween(now, from) <= 0) return
    const thrusted = game.activeBurn ? continueBurn(game, from, now) : game
    const next = settleOutcome(thrusted, from, now)
    this.current = next
    if (next.outcome) {
      // The game stops where it was decided: at the re-entry instant itself.
      const speedMultiplier = (this.beforeBurn ?? this.clock.setting()).speedMultiplier
      this.beforeBurn = null
      this.lastInstant = next.outcome.at
      this.clock.set({ speedMultiplier, playing: false }, next.outcome.at)
      this.recordOutcome(next)
    } else if (game.activeBurn && !next.activeBurn) {
      // The tank ran dry: the burn ended without a release.
      this.restoreClock()
    }
  }

  private start(): void {
    this.release()
    const now = this.clock.instant()
    const start = secondsBetween(MAX_SIMULATION_INSTANT, now) < END_OF_RANGE_MARGIN_SECONDS ? addSeconds(now, -END_OF_RANGE_SHIFT_SECONDS) : now
    this.current = createGame(this.drawSeed(), start)
    this.lastInstant = start
    this.clock.set({ speedMultiplier: GAME_SPEED_MULTIPLIER, playing: true }, start)
  }

  private restoreClock(): void {
    const setting = this.beforeBurn
    if (!setting) return
    this.beforeBurn = null
    this.clock.set(setting)
  }

  private recordOutcome(game: ManeuverGame): void {
    const burns = burnCountBucket(game.burns.length)
    if (game.outcome?.kind === 'won') this.record({ type: 'maneuver_result', outcome: 'won', burns, efficiency: efficiencyBucket(gameScore(game).efficiency) })
    else this.record({ type: 'maneuver_result', outcome: 'reentered', burns })
  }

  /** A game left unfinished after at least one burn counts as an attempt. */
  private recordAbandoned(outcome: 'restarted' | 'new-game'): void {
    const game = this.current
    if (game && !game.outcome && game.burns.length > 0) this.record({ type: 'maneuver_result', outcome, burns: burnCountBucket(game.burns.length) })
  }
}
