import { describe, expect, it } from 'vitest'
import { frontChartLayout } from './RouteFrontChart.ts'
import type { RouteFrontPointModel } from './routePanelModel.ts'

const HOUR = 3600
const DAY = 86_400
const FRONT: readonly RouteFrontPointModel[] = [
  { deltaVKmPerSecond: 1.8, arrivalSeconds: 2 * HOUR, family: 'direct', burns: 2 },
  { deltaVKmPerSecond: 0.4, arrivalSeconds: 9 * HOUR, family: 'turnAtNode', burns: 3 },
  { deltaVKmPerSecond: 0.11, arrivalSeconds: DAY, family: 'goHigh', burns: 4 },
]

describe('the front chart', () => {
  it('places later routes further right on a log axis, and cheaper ones lower', () => {
    const { points, plot } = frontChartLayout(FRONT, DAY, null)
    for (let index = 1; index < points.length; index += 1) {
      expect(points[index]!.x).toBeGreaterThan(points[index - 1]!.x)
      expect(points[index]!.y).toBeGreaterThan(points[index - 1]!.y)
    }
    for (const point of points) {
      expect(point.x).toBeGreaterThanOrEqual(plot.left)
      expect(point.x).toBeLessThanOrEqual(plot.right)
      expect(point.y).toBeGreaterThanOrEqual(plot.top)
      expect(point.y).toBeLessThanOrEqual(plot.bottom)
    }
    // Equal ratios of time are equal distances.
    const at = (seconds: number) => frontChartLayout([...FRONT, { deltaVKmPerSecond: 1, arrivalSeconds: seconds, family: 'direct', burns: 2 }], DAY, null).points[3]!.x
    expect(at(4 * HOUR) - at(2 * HOUR)).toBeCloseTo(at(8 * HOUR) - at(4 * HOUR), 9)
  })

  it('puts round Δv ticks on a log axis, and keeps ticks apart and inside', () => {
    const { deltaVTicks, timeTicks, plot, points } = frontChartLayout(FRONT, DAY, null)
    expect(deltaVTicks.length).toBeGreaterThanOrEqual(3)
    for (let index = 1; index < deltaVTicks.length; index += 1) {
      expect(deltaVTicks[index]!.value).toBeGreaterThan(deltaVTicks[index - 1]!.value)
      expect(deltaVTicks[index - 1]!.at - deltaVTicks[index]!.at).toBeGreaterThanOrEqual(16)
    }
    for (const tick of deltaVTicks) expect(tick.at).toBeLessThanOrEqual(plot.bottom)
    // A tenfold cost is always the same height.
    const tenfold = frontChartLayout([{ deltaVKmPerSecond: 0.1, arrivalSeconds: HOUR, family: 'direct', burns: 2 }, { deltaVKmPerSecond: 1, arrivalSeconds: 2 * HOUR, family: 'direct', burns: 2 }, { deltaVKmPerSecond: 10, arrivalSeconds: 3 * HOUR, family: 'direct', burns: 2 }], null, null).points
    expect(tenfold[0]!.y - tenfold[1]!.y).toBeCloseTo(tenfold[1]!.y - tenfold[2]!.y, 9)
    expect(points[0]!.y).toBeGreaterThan(plot.top)
    expect(timeTicks.length).toBeGreaterThanOrEqual(2)
    for (let index = 1; index < timeTicks.length; index += 1) expect(timeTicks[index]!.at - timeTicks[index - 1]!.at).toBeGreaterThanOrEqual(42)
    for (const tick of timeTicks) expect(tick.at).toBeGreaterThanOrEqual(plot.left)
  })

  it('draws the time limit, and a budget only when it does not squash the routes', () => {
    const limited = frontChartLayout(FRONT, 2 * DAY, null)
    expect(limited.limitX).toBeGreaterThan(limited.points[2]!.x)
    expect(limited.limitX).toBeLessThanOrEqual(limited.plot.right)
    expect(frontChartLayout(FRONT, null, 1).budgetY).not.toBeNull()
    expect(frontChartLayout(FRONT, null, 20).budgetY).toBeNull()
  })

  it('draws a front of one route', () => {
    const { points, plot } = frontChartLayout([FRONT[0]!], null, null)
    expect(points[0]!.x).toBeGreaterThan(plot.left)
    expect(points[0]!.x).toBeLessThan(plot.right)
  })
})
