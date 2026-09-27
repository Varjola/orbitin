export function speedFromSlider(value: number, maxSpeed: number): number {
  return Math.exp(Math.log(maxSpeed) * (value / 100))
}

export function sliderFromSpeed(speed: number, maxSpeed: number): number {
  return (Math.log(Math.max(1, speed)) / Math.log(maxSpeed)) * 100
}
