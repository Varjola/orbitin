import { format, text } from '../i18n/index.ts'
import type { SubSatellitePoint } from '../simulation/groundTrack.ts'

export function formatGroundTrackLatitude(point: SubSatellitePoint): string {
  return format().latitude(point.geocentricLatitudeRad, 1)
}

export function formatGroundTrackLongitude(point: SubSatellitePoint): string {
  return point.longitudeRad === null ? text().inspector.longitudeUndefined : format().longitude(point.longitudeRad, 1)
}
