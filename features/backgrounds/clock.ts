// One animation clock shared by every webview window. Date.now() is the
// same system clock in every process and the day-anchor is computed
// identically everywhere, so all windows agree on u_time with zero
// coordination — that is what frame-locks previews to the outputs. The
// day-anchor keeps the value small enough for shader float precision; the
// only artifact is a one-frame discontinuity at local midnight.
const DAY_MS = 86_400_000

export function sharedTimeAt(nowMs: number): number {
  return (nowMs - Math.floor(nowMs / DAY_MS) * DAY_MS) / 1000
}

export function sharedTime(): number {
  return sharedTimeAt(Date.now())
}
