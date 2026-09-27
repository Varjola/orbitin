import { describe, expect, it } from 'vitest'
import { parseOmmArrayJson, parseOmmJson } from './omm.ts'

const RECORD = {
  OBJECT_NAME: 'Educational ISS', OBJECT_ID: '1998-067A', EPOCH: '2026-03-20T12:00:00.123456Z',
  MEAN_MOTION: 15.5, ECCENTRICITY: '0.00042', INCLINATION: 51.64, RA_OF_ASC_NODE: 120,
  ARG_OF_PERICENTER: 40, MEAN_ANOMALY: 220, EPHEMERIS_TYPE: 0, NORAD_CAT_ID: '00025544',
  BSTAR: '1.2e-5', MEAN_MOTION_DOT: '0.000012', MEAN_MOTION_DDOT: 0,
  ELEMENT_SET_NO: 999, REV_AT_EPOCH: 12345, CENTER_NAME: 'Earth', REF_FRAME: 'TEME', TIME_SYSTEM: 'UTC', MEAN_ELEMENT_THEORY: 'SGP4',
}

describe('OMM keyed JSON parser', () => {
  it('normalizes source units once and preserves a post-five-digit id', () => {
    const result = parseOmmJson(JSON.stringify(RECORD))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.definition.format).toBe('omm-keyed-json')
    expect(result.definition.meanElements.catalogId).toBe('25544')
    expect(result.definition.meanElements.epoch.unixSeconds).toBeCloseTo(Date.parse(RECORD.EPOCH) / 1000 + 0.000456, 6)
    expect(result.definition.meanElements.nominalPeriodSeconds).toBeCloseTo(86400 / 15.5)
    expect(result.definition.provenance).toEqual({ kind: 'manual' })
  })

  it('accepts provider arrays but rejects an object where an array is required', () => {
    const result = parseOmmArrayJson(JSON.stringify([RECORD, { ...RECORD, NORAD_CAT_ID: '600001' }]))
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.definitions.map((definition) => definition.meanElements.catalogId)).toEqual(['25544', '600001'])
      expect(result.rejectedRecordCount).toBe(0)
    }
    const rejected = parseOmmArrayJson(JSON.stringify([{ ...RECORD, INCLINATION: 'not-a-number' }, RECORD]))
    expect(rejected.ok).toBe(true)
    if (rejected.ok) expect(rejected.rejectedRecordCount).toBe(1)
    expect(parseOmmArrayJson(JSON.stringify(RECORD)).ok).toBe(false)
  })

  it('reads the Space-Track GP dialect without a Z designator or lower-case centre name', () => {
    // Space-Track GP JSON emits every numeric field as a decimal string, an
    // epoch in the CCSDS ASCII form with no designator, and the header keywords
    // in upper case. CCSDS names the time system in TIME_SYSTEM rather than in
    // the timestamp, so the bare form is UTC by declaration.
    const wire = {
      ...RECORD, CENTER_NAME: 'EARTH', EPOCH: '2026-03-20T12:00:00.123456',
      MEAN_MOTION: '15.50000000', INCLINATION: '51.6400', RA_OF_ASC_NODE: '120.0000',
      ARG_OF_PERICENTER: '40.0000', MEAN_ANOMALY: '220.0000', EPHEMERIS_TYPE: '0',
      ELEMENT_SET_NO: '999', REV_AT_EPOCH: '12345', MEAN_MOTION_DDOT: '0',
      CCSDS_OMM_VERS: '3.0', ORIGINATOR: '18 SPCS', DECAY_DATE: null, OBJECT_TYPE: 'PAYLOAD',
    }
    const result = parseOmmJson(JSON.stringify(wire))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const withZ = parseOmmJson(JSON.stringify(RECORD))
    expect(withZ.ok).toBe(true)
    if (!withZ.ok) return
    // The two dialects describe the same instant and the same elements.
    expect(result.definition.meanElements.epoch.unixSeconds).toBeCloseTo(withZ.definition.meanElements.epoch.unixSeconds, 9)
    expect(result.definition.meanElements.inclinationRad).toBeCloseTo(withZ.definition.meanElements.inclinationRad, 12)
    expect(result.definition.elementSetNumber).toBe(999)
  })

  it('still rejects a genuinely different centre, frame, time system or theory', () => {
    for (const override of [{ CENTER_NAME: 'MARS' }, { REF_FRAME: 'ITRF' }, { TIME_SYSTEM: 'TAI' }, { MEAN_ELEMENT_THEORY: 'DSST' }]) {
      const result = parseOmmJson(JSON.stringify({ ...RECORD, ...override }))
      expect(result.ok, JSON.stringify(override)).toBe(false)
      if (!result.ok) expect(result.errors.some((error) => error.code === 'contract')).toBe(true)
    }
  })

  it('rejects incompatible frame contracts and malformed numeric values', () => {
    const wrongFrame = parseOmmJson(JSON.stringify({ ...RECORD, REF_FRAME: 'ITRF' }))
    expect(wrongFrame.ok).toBe(false)
    if (!wrongFrame.ok) expect(wrongFrame.errors.some((error) => error.code === 'contract')).toBe(true)
    const partial = parseOmmJson(JSON.stringify({ ...RECORD, MEAN_MOTION: '15.5 rev/day' }))
    expect(partial.ok).toBe(false)
    const badId = parseOmmJson(JSON.stringify({ ...RECORD, NORAD_CAT_ID: '1234567890' }))
    expect(badId.ok).toBe(false)
  })
})
