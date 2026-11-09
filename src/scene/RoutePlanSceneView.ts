import * as THREE from 'three'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { RENDER_UNITS_PER_KM } from '../core/constants.ts'
import type { ProjectInertialVec3 } from '../core/referenceFrames.ts'
import { projectInertialToRender } from '../core/renderFrame.ts'
import { crossVec3, lengthVec3, normalizeVec3, type Vec3 } from '../core/vec3.ts'
import { elementsFromState } from '../orbital/elementsFromState.ts'
import { deriveOrbitValues, type OrbitGeometry } from '../orbital/geometry.ts'
import { j2SecularRates } from '../orbital/j2Secular.ts'
import type { SimulationInstant } from '../core/time.ts'
import { burnStage, burnVectors, currentOrbit, legAt, normalOf, orbitNormal, orbitRing, recentPath, ringOf, routeInstant, satelliteTrail, triangleIsThin } from '../simulation/route/routeDrawing.ts'
import type { Route, RouteLeg, RouteSatellite } from '../simulation/route/routeModel.ts'
import { satelliteState, stateOnRoute, targetStateOnRoute } from '../simulation/route/routeState.ts'
import { OrbitalBodyView } from './OrbitalBodyView.ts'
import { VectorArrowView } from './VectorArrowView.ts'

/** Sky blue for the interceptor and yellow for the target, as in Interception, and
 *  vermillion for thrust. The key in the corner names the two, and in playback the
 *  interceptor's orbit is dashed and the target's solid, so no meaning rests on
 *  colour alone. */
export const ROUTE_COLORS = { own: 0x56b4e9, target: 0xf0e442, thrust: 0xd55e00, mark: 0xe7fbff } as const
const MARKER_SIZE_RENDER_UNITS = 0.022
const TRAIL_TAIL_BRIGHTNESS = 0.15
/** The interceptor's dashes, as shares of its orbit's semi-major axis, so every
 *  orbit has about as many. */
const DASH_SHARE = 0.045
const GAP_SHARE = 0.03
/** A drifting orbit's ring is redrawn once it has turned this far. */
const RING_REDRAW_RAD = 0.002
const PLANE_OPACITY = 0.08
/** On screen: the thrust arrow, and the longer of the two velocities. */
const THRUST_PX = 84
const VELOCITY_PX = 170
/** A part smaller than this share of the burn is not drawn; one that is drawn is at
 *  least this long on screen, so its head and label have room. */
const MIN_PART_SHARE = 0.06
const MIN_PART_PX = 18
/** A part this close to the whole burn points where the thrust arrow does, which
 *  says it alone. */
const WHOLE_PART_SHARE = 0.995
/** On screen: how far beside the thrust arrow the velocity lies when the burn hardly turns it. */
const SIDE_GAP_PX = 10

export interface RouteSceneFrame {
  readonly route: Route
  /** Simulated seconds from the route's start. */
  readonly seconds: number
  readonly burn: { readonly index: number; readonly progress: number } | null
  readonly planesShown: boolean
  /** So fast that a dot would only strobe: the orbits are drawn brighter, without
   *  the dots and the tail. */
  readonly drifting: boolean
  /** Render units per CSS pixel at a render-frame point. */
  readonly unitsPerPixelAt: (point: THREE.Vector3) => number
}

/** The two objects running before any route. */
export interface RouteLiveFrame {
  readonly own: RouteSatellite
  readonly target: RouteSatellite
  readonly instant: SimulationInstant
  readonly planesShown: boolean
}

/** Render-frame anchors for the labels drawn over a burn. */
export interface RouteSceneAnchors {
  readonly thrust: THREE.Vector3 | null
  readonly parts: { readonly prograde: THREE.Vector3 | null; readonly normal: THREE.Vector3 | null; readonly outward: THREE.Vector3 | null }
  readonly before: THREE.Vector3 | null
  readonly after: THREE.Vector3 | null
}

function toRender(point: Vec3, scale = RENDER_UNITS_PER_KM): THREE.Vector3 {
  const render = projectInertialToRender({ x: point.x * scale, y: point.y * scale, z: point.z * scale })
  return new THREE.Vector3(render.x, render.y, render.z)
}

function renderPositions(points: readonly ProjectInertialVec3[]): number[] {
  const positions: number[] = []
  for (const point of points) {
    const render = toRender(point)
    positions.push(render.x, render.y, render.z)
  }
  return positions
}

function solidColors(count: number, colorHex: number, brightness = 1): number[] {
  const color = new THREE.Color(colorHex).multiplyScalar(brightness)
  const colors: number[] = []
  for (let index = 0; index < count; index += 1) colors.push(color.r, color.g, color.b)
  return colors
}

interface Ring {
  readonly line: Line2
  readonly satellite: RouteSatellite
  readonly color: number
  readonly driftRadPerSecond: number
  /** Unix seconds of the instant it was drawn for. */
  drawnAt: number | null
}

/** The Route Planner in the 3D view. Before a route, the two objects running on
 *  their solid orbits, with their trails. With a route, the target on its solid
 *  orbit, and the interceptor with a short tail on the orbit of the route's phase it
 *  is in, dashed and whole: each burn reshapes it as the velocity turns, and the
 *  orbit it leaves is gone. The orbit planes, and the arrows of a burn while it is
 *  held. Nothing here is pickable. */
export class RoutePlanSceneView {
  private readonly group = new THREE.Group()
  private readonly own: OrbitalBodyView
  private readonly target: OrbitalBodyView
  private readonly ownRing: Line2
  private readonly targetRing: Line2
  private readonly ownTrail: Line2
  private readonly targetTrail: Line2
  private readonly nodeLine: Line2
  /** The orbit the interceptor is on now, in playback. */
  private readonly currentRing: Line2
  private currentDrawn: { readonly leg: RouteLeg | null; readonly seconds: number; readonly bright: boolean; readonly burn: string | null } | null = null
  private readonly planes: readonly THREE.Mesh[]
  private readonly thrust: VectorArrowView
  private readonly parts: { readonly prograde: VectorArrowView; readonly normal: VectorArrowView; readonly outward: VectorArrowView }
  private readonly before: VectorArrowView
  private readonly current: VectorArrowView
  private readonly turn: VectorArrowView
  private readonly materials: LineMaterial[] = []
  private readonly registerMaterial: (material: LineMaterial) => void
  private readonly unregisterMaterial: (material: LineMaterial) => void
  private route: Route | null = null
  /** The live scene's pair, while it is drawn. */
  private livePair: { readonly own: RouteSatellite; readonly target: RouteSatellite } | null = null
  private rings: Ring[] = []
  private visible = false
  private disposed = false

  constructor(scene: THREE.Scene, registerMaterial: (material: LineMaterial) => void, unregisterMaterial: (material: LineMaterial) => void) {
    this.registerMaterial = registerMaterial
    this.unregisterMaterial = unregisterMaterial
    this.group.name = 'Route Planner'
    scene.add(this.group)
    this.own = new OrbitalBodyView(scene, ROUTE_COLORS.own, MARKER_SIZE_RENDER_UNITS)
    this.target = new OrbitalBodyView(scene, ROUTE_COLORS.target, MARKER_SIZE_RENDER_UNITS)
    const ringMaterial = () => this.material({ color: 0xffffff, vertexColors: true, linewidth: 1.4, transparent: true, opacity: 0.75, depthTest: true, depthWrite: false })
    this.ownRing = this.line(ringMaterial(), 'Your orbit')
    this.targetRing = this.line(ringMaterial(), 'Target orbit')
    const trailMaterial = () => this.material({ color: 0xffffff, vertexColors: true, linewidth: 2.4, transparent: true, opacity: 0.95, depthTest: true, depthWrite: false })
    this.ownTrail = this.line(trailMaterial(), 'Your trail')
    this.targetTrail = this.line(trailMaterial(), 'Target trail')
    this.nodeLine = this.line(this.material({ color: ROUTE_COLORS.mark, linewidth: 1.2, transparent: true, opacity: 0.6, dashed: true, dashSize: 0.03, gapSize: 0.03, depthTest: true, depthWrite: false }), 'Line of nodes')
    this.currentRing = this.line(this.material({ color: 0xffffff, vertexColors: true, linewidth: 2, transparent: true, opacity: 0.95, dashed: true, dashSize: 0.05, gapSize: 0.03, depthTest: true, depthWrite: false }), 'Interceptor orbit')
    const disc = new THREE.CircleGeometry(1, 128)
    this.planes = [ROUTE_COLORS.own, ROUTE_COLORS.target].map((color, index) => {
      const mesh = new THREE.Mesh(index === 0 ? disc : disc.clone(), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: PLANE_OPACITY, side: THREE.DoubleSide, depthWrite: false }))
      mesh.name = index === 0 ? 'Your orbit plane' : 'Target orbit plane'
      mesh.renderOrder = -1
      this.group.add(mesh)
      return mesh
    })
    const arrow = (name: string, color: number, width: number, opacity = 1) => new VectorArrowView(this.group, name, color, width, registerMaterial, unregisterMaterial, opacity)
    this.thrust = arrow('Thrust', ROUTE_COLORS.thrust, 4)
    this.parts = { prograde: arrow('Prograde part', ROUTE_COLORS.mark, 1.5, 0.85), normal: arrow('Normal part', ROUTE_COLORS.mark, 1.5, 0.85), outward: arrow('Outward part', ROUTE_COLORS.mark, 1.5, 0.85) }
    this.before = arrow('Velocity before', ROUTE_COLORS.own, 2, 0.5)
    this.current = arrow('Velocity after', ROUTE_COLORS.own, 3)
    this.turn = arrow('Change of velocity', ROUTE_COLORS.thrust, 2)
    this.setVisible(false)
  }

  setVisible(visible: boolean): void {
    this.visible = visible
    this.group.visible = visible
    this.own.setVisible(visible)
    this.target.setVisible(visible)
  }

  update(frame: RouteSceneFrame): void {
    if (frame.route !== this.route) this.build(frame.route)
    const { route, seconds } = frame
    const instant = routeInstant(route, seconds)
    const own = stateOnRoute(route, seconds)
    const target = targetStateOnRoute(route, seconds)
    this.own.update(own)
    this.target.update(target)
    this.own.setVisible(this.visible && !frame.drifting)
    this.target.setVisible(this.visible && !frame.drifting)
    for (const ring of this.rings) this.drawRing(ring, instant)
    this.drawCurrentOrbit(frame)
    // The target's orbit says where it goes; only the interceptor drags a tail.
    this.targetTrail.visible = false
    if (frame.drifting) this.ownTrail.visible = false
    else this.setTrail(this.ownTrail, recentPath(route, seconds, 'own'), ROUTE_COLORS.own)
    // Your plane is the one you are on now, so it turns with you while drifting.
    const ownOrbit = currentOrbit(route, seconds)
    this.drawPlanes(
      [normalOf(ownOrbit), orbitNormal(route.target, instant)],
      [Math.max(deriveOrbitValues(route.own.geometry).apoapsisRadiusKm, deriveOrbitValues(ownOrbit).apoapsisRadiusKm), deriveOrbitValues(route.target.geometry).apoapsisRadiusKm],
      RoutePlanSceneView.radius(route),
      frame.planesShown,
    )
    this.drawBurn(frame)
  }

  /** The live scene: both objects on their orbits, with trails and planes. */
  updateLive(frame: RouteLiveFrame): void {
    if (this.route !== null) this.clearRoute()
    if (this.livePair?.own !== frame.own || this.livePair.target !== frame.target) {
      this.livePair = { own: frame.own, target: frame.target }
      this.rings = [this.ring(this.ownRing, frame.own, ROUTE_COLORS.own), this.ring(this.targetRing, frame.target, ROUTE_COLORS.target)]
    }
    const { instant } = frame
    this.own.update(satelliteState(frame.own, instant))
    this.target.update(satelliteState(frame.target, instant))
    this.own.setVisible(this.visible)
    this.target.setVisible(this.visible)
    for (const ring of this.rings) this.drawRing(ring, instant)
    this.setTrail(this.ownTrail, satelliteTrail(frame.own, instant), ROUTE_COLORS.own)
    this.setTrail(this.targetTrail, satelliteTrail(frame.target, instant), ROUTE_COLORS.target)
    const reaches = [frame.own, frame.target].map((satellite) => deriveOrbitValues(satellite.geometry).apoapsisRadiusKm)
    this.drawPlanes([orbitNormal(frame.own, instant), orbitNormal(frame.target, instant)], reaches, Math.max(...reaches) * RENDER_UNITS_PER_KM, frame.planesShown)
    this.drawBurn(null)
  }

  anchors(): RouteSceneAnchors {
    return {
      thrust: this.thrust.tip(),
      parts: { prograde: this.parts.prograde.tip(), normal: this.parts.normal.tip(), outward: this.parts.outward.tip() },
      before: this.before.tip(),
      after: this.current.tip(),
    }
  }

  /** The radius that holds both orbits, in render units. */
  static pairRadius(own: RouteSatellite, target: RouteSatellite): number {
    return Math.max(deriveOrbitValues(own.geometry).apoapsisRadiusKm, deriveOrbitValues(target.geometry).apoapsisRadiusKm) * RENDER_UNITS_PER_KM
  }

  /** The radius that holds the whole route, in render units. */
  static radius(route: Route): number {
    const apoapsis = (geometry: RouteSatellite['geometry']) => deriveOrbitValues(geometry).apoapsisRadiusKm
    return Math.max(apoapsis(route.own.geometry), apoapsis(route.target.geometry), ...route.legs.map((leg) => apoapsis(leg.geometry))) * RENDER_UNITS_PER_KM
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.clearRoute()
    this.own.dispose()
    this.target.dispose()
    for (const arrow of [this.thrust, this.parts.prograde, this.parts.normal, this.parts.outward, this.before, this.current, this.turn]) arrow.dispose()
    for (const plane of this.planes) { plane.geometry.dispose(); (plane.material as THREE.Material).dispose() }
    for (const line of [this.ownRing, this.targetRing, this.ownTrail, this.targetTrail, this.nodeLine, this.currentRing]) line.geometry.dispose()
    for (const material of this.materials) { this.unregisterMaterial(material); material.dispose() }
    this.group.removeFromParent()
  }

  private material(parameters: ConstructorParameters<typeof LineMaterial>[0]): LineMaterial {
    const material = new LineMaterial(parameters)
    this.materials.push(material)
    this.registerMaterial(material)
    return material
  }

  private line(material: LineMaterial, name: string, parent: THREE.Object3D = this.group): Line2 {
    const line = new Line2(new LineGeometry(), material)
    line.name = name
    line.visible = false
    parent.add(line)
    return line
  }

  private ring(line: Line2, satellite: RouteSatellite, color: number): Ring {
    const rates = j2SecularRates(satellite.geometry)
    return { line, satellite, color, driftRadPerSecond: Math.abs(rates.raanRadPerSecond) + Math.abs(rates.argOfPeriapsisRadPerSecond), drawnAt: null }
  }

  /** A new route: the target's orbit is the one ring that stays. */
  private build(route: Route): void {
    this.clearRoute()
    this.route = route
    this.ownRing.visible = false
    this.rings = [this.ring(this.targetRing, route.target, ROUTE_COLORS.target)]
  }

  private clearRoute(): void {
    this.rings = []
    this.currentDrawn = null
    this.currentRing.visible = false
    this.route = null
    this.livePair = null
  }

  /** Redrawn only once J2 has turned the orbit enough to see. */
  private drawRing(ring: Ring, instant: SimulationInstant): void {
    if (ring.drawnAt !== null && Math.abs(instant.unixSeconds - ring.drawnAt) * ring.driftRadPerSecond < RING_REDRAW_RAD) return
    ring.drawnAt = instant.unixSeconds
    const points = orbitRing(ring.satellite, instant)
    this.setLine(ring.line, renderPositions(points), solidColors(points.length, ring.color, 0.75))
    ring.line.computeLineDistances()
  }

  /** The whole orbit of the route's phase the interceptor is in, dashed. While a
   *  burn is held it follows the velocity as it turns, so the orbit visibly reshapes;
   *  otherwise it is redrawn when the phase changes or J2 has turned it enough. */
  private drawCurrentOrbit(frame: RouteSceneFrame): void {
    const { route, seconds, drifting } = frame
    const held = frame.burn === null ? null : route.burns[frame.burn.index]
    const leg = legAt(route, seconds)
    const burnKey = held === null || held === undefined ? null : `${frame.burn!.index}:${frame.burn!.progress}`
    const drawn = this.currentDrawn
    const turnRate = leg === null ? 0 : leg.kind === 'transfer' ? Math.abs(leg.nodeRateRadPerSecond) : Math.abs(j2SecularRates(leg.geometry).raanRadPerSecond) + Math.abs(j2SecularRates(leg.geometry).argOfPeriapsisRadPerSecond)
    if (drawn !== null && drawn.burn === burnKey && drawn.leg === leg && drawn.bright === drifting && Math.abs(seconds - drawn.seconds) * turnRate < RING_REDRAW_RAD) { this.currentRing.visible = true; return }
    this.currentDrawn = { leg, seconds, bright: drifting, burn: burnKey }
    let geometry: OrbitGeometry = currentOrbit(route, seconds)
    if (held !== null && held !== undefined && frame.burn !== null) {
      const vectors = burnVectors(held, burnStage(frame.burn.progress))
      geometry = elementsFromState({ positionProjectInertialKm: held.before.positionProjectInertialKm, velocityProjectInertialKmPerSecond: vectors.current }).geometry
    }
    const points = ringOf(geometry)
    this.setLine(this.currentRing, renderPositions(points), solidColors(points.length, ROUTE_COLORS.own, drifting ? 1 : 0.85))
    this.currentRing.computeLineDistances()
    const material = this.currentRing.material as LineMaterial
    const size = geometry.semiMajorAxisKm * RENDER_UNITS_PER_KM
    material.dashSize = DASH_SHARE * size
    material.gapSize = GAP_SHARE * size
  }

  /** The two planes as discs reaching just past their orbits, and the line where
   *  they cross. */
  private drawPlanes(normals: readonly [ProjectInertialVec3, ProjectInertialVec3], reaches: readonly number[], radius: number, shown: boolean): void {
    this.planes.forEach((plane, index) => {
      plane.visible = shown
      if (!shown) return
      plane.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), toRender(normals[index]!, 1).normalize())
      plane.scale.setScalar(reaches[index]! * RENDER_UNITS_PER_KM * 1.12)
    })
    const crossing = crossVec3(normals[0]!, normals[1]!)
    const node = shown && lengthVec3(crossing) >= 1e-6 ? normalizeVec3(crossing) : null
    this.nodeLine.visible = node !== null
    if (node === null) return
    const end = toRender(node, 1).multiplyScalar(radius * 1.2)
    this.setLine(this.nodeLine, [-end.x, -end.y, -end.z, end.x, end.y, end.z], solidColors(2, ROUTE_COLORS.mark))
    this.nodeLine.computeLineDistances()
  }

  /** While a burn is held: the thrust arrow and its parts at a readable size, and
   *  the velocity triangle, before + Δv = after, at one true scale. A burn that
   *  hardly turns the velocity would lay all of them along one line, where before
   *  and the change say nothing the thrust arrow does not: then only the velocity
   *  lies beside the thrust arrow, away from Earth, so the two show whether the burn
   *  speeds the satellite up or slows it down. */
  private drawBurn(frame: RouteSceneFrame | null): void {
    const arrows = [this.thrust, this.parts.prograde, this.parts.normal, this.parts.outward, this.before, this.current, this.turn]
    const burn = frame === null || frame.burn === null ? undefined : frame.route.burns[frame.burn.index]
    if (frame === null || frame.burn === null || burn === undefined || !(burn.sizeKmPerSecond > 0)) { for (const arrow of arrows) arrow.hide(); return }
    const stage = burnStage(frame.burn.progress)
    const vectors = burnVectors(burn, stage)
    const at = toRender(vectors.position)
    const pixel = frame.unitsPerPixelAt(at)
    const direction = (vector: Vec3) => toRender(vector, 1).normalize()
    this.thrust.set(at, direction(vectors.deltaV), THRUST_PX * stage.grown * pixel, pixel)
    for (const name of ['prograde', 'normal', 'outward'] as const) {
      const part = vectors.parts[name]
      const share = lengthVec3(part) / burn.sizeKmPerSecond
      if (share < MIN_PART_SHARE || share > WHOLE_PART_SHARE) this.parts[name].hide()
      else this.parts[name].set(at, direction(part), Math.max(MIN_PART_PX, THRUST_PX * share) * stage.grown * pixel, pixel)
    }
    // One scale for all three, so their proportions are true.
    const perKmPerSecond = VELOCITY_PX * pixel / Math.max(lengthVec3(vectors.before), lengthVec3(vectors.after))
    if (stage.grown < 1) { this.before.hide(); this.current.hide(); this.turn.hide(); return }
    if (triangleIsThin(vectors)) {
      const step = direction(vectors.side).multiplyScalar(SIDE_GAP_PX * pixel)
      this.current.set(at.clone().add(step), direction(vectors.current), lengthVec3(vectors.current) * perKmPerSecond, pixel)
      this.before.hide()
      this.turn.hide()
      return
    }
    this.before.set(at, direction(vectors.before), lengthVec3(vectors.before) * perKmPerSecond, pixel)
    this.current.set(at, direction(vectors.current), lengthVec3(vectors.current) * perKmPerSecond, pixel)
    const turned = { x: vectors.current.x - vectors.before.x, y: vectors.current.y - vectors.before.y, z: vectors.current.z - vectors.before.z }
    const beforeTip = this.before.tip()
    if (beforeTip === null || lengthVec3(turned) === 0) this.turn.hide()
    else this.turn.set(beforeTip.clone(), direction(turned), lengthVec3(turned) * perKmPerSecond, pixel)
  }

  /** Brightens from the tail to the satellite, so the trail reads as a direction of travel. */
  private setTrail(line: Line2, points: readonly ProjectInertialVec3[], colorHex: number): void {
    line.visible = points.length > 1
    if (!line.visible) return
    const base = new THREE.Color(colorHex)
    const colors: number[] = []
    const last = points.length - 1
    for (let index = 0; index <= last; index += 1) {
      const brightness = TRAIL_TAIL_BRIGHTNESS + (1 - TRAIL_TAIL_BRIGHTNESS) * (index / last)
      colors.push(base.r * brightness, base.g * brightness, base.b * brightness)
    }
    this.setLine(line, renderPositions(points), colors)
  }

  private setLine(line: Line2, positions: number[], colors: number[]): void {
    const previous = line.geometry
    const geometry = new LineGeometry()
    geometry.setPositions(positions)
    geometry.setColors(colors)
    line.geometry = geometry
    line.visible = true
    previous.dispose()
  }
}
