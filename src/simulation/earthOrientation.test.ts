import { expect, it } from 'vitest'
import { degToRad, radToDeg, TAU, wrapRadiansSigned } from '../core/angles.ts'
import { MIN_SIMULATION_INSTANT, MAX_SIMULATION_INSTANT, SIMULATION_START_INSTANT } from '../core/constants.ts'
import { julianCenturiesSinceJ2000 } from '../core/julianDate.ts'
import { applyMat3, identityMat3, multiplyMat3, rotationYMat3, rotationZMat3, transposeMat3, type Mat3 } from '../core/mat3.ts'
import { earthFixedToProjectInertial, projectInertialToEarthFixed } from '../core/referenceFrames.ts'
import { earthFixedOrientationToRender } from '../core/renderFrame.ts'
import { lengthVec3 } from '../core/vec3.ts'
import { equatorialToDirectionEci } from '../starfield/celestial.ts'
import { earthOrientationAt, greenwichMeanSiderealTime } from './earthOrientation.ts'

const instants = [MIN_SIMULATION_INSTANT, { unixSeconds: 0 }, { unixSeconds: 946728000 }, SIMULATION_START_INSTANT, MAX_SIMULATION_INSTANT]
function matrixClose(a: Mat3, b: Mat3) { a.forEach((n, i) => expect(n).toBeCloseTo(b[i], 12)) }
it('anchors GMST and the sidereal rate, including precision at the range edges', () => {
  expect(radToDeg(greenwichMeanSiderealTime({ unixSeconds: 946728000 }))).toBeCloseTo(280.46061837, 6)
  for (const t of instants) {
    const g = greenwichMeanSiderealTime(t)
    expect(g).toBeGreaterThanOrEqual(0); expect(g).toBeLessThan(TAU)
    expect(Math.abs(wrapRadiansSigned(greenwichMeanSiderealTime({ unixSeconds: t.unixSeconds + 86164.0905 }) - g))).toBeLessThan(1e-6)
    expect(wrapRadiansSigned(greenwichMeanSiderealTime({ unixSeconds: t.unixSeconds + 60 }) - g)).toBeGreaterThan(0)
  }
  // At T=±0.5 the 876600-hour term is exactly 18262.5 whole days; split it off.
  for (const t of [MIN_SIMULATION_INSTANT, MAX_SIMULATION_INSTANT]) {
    const T = julianCenturiesSinceJ2000(t)
    const smallSeconds = 67310.54841 + 8640184.812866 * T + 0.093104 * T * T - 0.0000062 * T ** 3
    const split = (smallSeconds + 43200) % 86400 * TAU / 86400
    expect(Math.abs(wrapRadiansSigned(greenwichMeanSiderealTime(t) - split))).toBeLessThan(1e-10)
  }
})
it('preserves orientation, length, handedness and inverse frame transforms', () => {
  matrixClose(earthOrientationAt({ unixSeconds: 946728000 }).precessionToMeanOfDate, identityMat3())
  for (const instant of instants) {
    const o = earthOrientationAt(instant)
    matrixClose(o.earthFixedToProjectInertial, transposeMat3(o.projectInertialToEarthFixed))
    for (const m of [o.precessionToMeanOfDate, o.projectInertialToEarthFixed, o.earthFixedToProjectInertial]) {
      matrixClose(multiplyMat3(transposeMat3(m), m), identityMat3())
      const det = m[0]*(m[4]*m[8]-m[5]*m[7])-m[1]*(m[3]*m[8]-m[5]*m[6])+m[2]*(m[3]*m[7]-m[4]*m[6])
      expect(det).toBeCloseTo(1, 12)
    }
    for (const v of [{ x: 1, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }, { x: -2, y: 3, z: 5 }]) {
      const fixed = projectInertialToEarthFixed(v, o)
      expect(lengthVec3(fixed)).toBeCloseTo(lengthVec3(v), 12)
      const back = earthFixedToProjectInertial(fixed, o)
      expect(back.x).toBeCloseTo(v.x, 12); expect(back.y).toBeCloseTo(v.y, 12); expect(back.z).toBeCloseTo(v.z, 12)
    }
  }
})
it('ties vector rotations and the Earth mesh to the positive Y render rotation', () => {
  for (const g of [0, Math.PI / 2, -1.4, 6]) {
    const v = applyMat3(rotationZMat3(g), { x: 1, y: 0, z: 0 })
    expect(v.x).toBeCloseTo(Math.cos(g), 12); expect(v.y).toBeCloseTo(Math.sin(g), 12)
    matrixClose(earthFixedOrientationToRender(rotationZMat3(-g)), rotationYMat3(g))
    const a = rotationZMat3(g), b = rotationYMat3(0.3), c = rotationZMat3(-0.7)
    matrixClose(multiplyMat3(multiplyMat3(a,b),c), multiplyMat3(a,multiplyMat3(b,c)))
  }
  const o = { ...earthOrientationAt({ unixSeconds: 946728000 }), projectInertialToEarthFixed: rotationZMat3(-Math.PI / 2) }
  expect(projectInertialToEarthFixed({x:1,y:0,z:0},o).y).toBeCloseTo(-1,12)
})
it('agrees with independent scalar precession and general precession in longitude', () => {
  for (const instant of instants) {
    const T = julianCenturiesSinceJ2000(instant)
    const zeta = degToRad((2306.2181*T+0.30188*T*T+0.017998*T**3)/3600)
    const z = degToRad((2306.2181*T+1.09468*T*T+0.018203*T**3)/3600)
    const theta = degToRad((2004.3109*T-0.42665*T*T-0.041833*T**3)/3600)
    const p = earthOrientationAt(instant).precessionToMeanOfDate
    // Meeus eq.21.4 scalar reduction, independent of matrix composition.
    for (const [ra, dec] of [[0,0],[1,0.4],[2,-0.8],[3,1.2],[4,-1.4],[5,0.1]]) {
      const A = Math.cos(dec)*Math.sin(ra+zeta)
      const B = Math.cos(theta)*Math.cos(dec)*Math.cos(ra+zeta)-Math.sin(theta)*Math.sin(dec)
      const C = Math.sin(theta)*Math.cos(dec)*Math.cos(ra+zeta)+Math.cos(theta)*Math.sin(dec)
      const v = applyMat3(p, equatorialToDirectionEci({rightAscensionRad:ra,declinationRad:dec}))
      expect(Math.abs(wrapRadiansSigned(Math.atan2(v.y,v.x)-(Math.atan2(A,B)+z)))).toBeLessThan(1e-9)
      expect(Math.asin(v.z)).toBeCloseTo(Math.asin(C), 9)
    }
    const v = applyMat3(p,{x:1,y:0,z:0}), e = degToRad(23.439-0.013*T)
    const longitude = Math.atan2(Math.cos(e)*v.y+Math.sin(e)*v.z,v.x)
    expect(Math.abs(radToDeg(longitude)*3600-5029.0966*T)).toBeLessThan(2)
  }
})
it('reproduces Meeus Theta Persei worked example including proper motion', () => {
  // Astronomical Algorithms, 2nd ed., example 21.a, p.135; retrieved 2026-09-08.
  // Published reproduction: https://pymeeus.readthedocs.io/en/stable/examples/ex-Coordinates.html
  // 2028 Nov 13.19 dynamical date is used numerically as the polynomial argument;
  // no UTC/TT conversion is being tested. Proper motion applied explicitly.
  const instant = { unixSeconds: Date.UTC(2028,10,13)/1000 + 0.19*86400 }
  const years = julianCenturiesSinceJ2000(instant)*100
  const ra = degToRad(15*(2+44/60+(11.986+0.03425*years)/3600))
  const dec = degToRad(49+13/60+(42.48-0.0895*years)/3600)
  const v = applyMat3(earthOrientationAt(instant).precessionToMeanOfDate,equatorialToDirectionEci({rightAscensionRad:ra,declinationRad:dec}))
  expect(Math.abs(radToDeg(Math.atan2(v.y,v.x))-15*(2+46/60+11.331/3600))*3600).toBeLessThan(0.1)
  expect(Math.abs(radToDeg(Math.asin(v.z))-(49+20/60+54.54/3600))*3600).toBeLessThan(0.1)
})
