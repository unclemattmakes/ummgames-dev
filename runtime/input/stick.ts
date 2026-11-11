/**
 * Analog stick shaping: radial, not per-axis.
 *
 * The stick is read as a direction plus a magnitude. Per-axis dead zones snap
 * near-diagonal input onto the axes (a "cross-shaped" dead zone) and make a
 * shallow diagonal impossible. Here the dead zone is a circle: below `inner` it
 * reads zero, the magnitude rescales from `inner..outer` onto 0..1, and the
 * direction is preserved exactly. The response curve then raises that 0..1 to
 * the power `curve`: 1 is linear, more gives a softer centre.
 */
export interface StickShape {
  /** Radius of the dead zone, 0..1. */
  inner: number
  /** Radius that reads as full, 0..1. */
  outer: number
  /** Exponent on the rescaled magnitude. */
  curve: number
}

/** A movement stick: a small dead zone, linear, so walk and run speeds track the stick. */
export const MOVE_STICK: StickShape = { inner: 0.18, outer: 0.92, curve: 1 }
/** A camera stick: a softer centre for fine aim. */
export const CAMERA_STICK: StickShape = { inner: 0.2, outer: 0.95, curve: 1.6 }

export interface Vec2Out {
  x: number
  y: number
}

/**
 * Shapes a raw stick `(x, y)` into `out` and returns it. Uses `Math.hypot` and `**`, which can
 * differ between engines in the last bit: shape input before a replay records it, not in the sim.
 */
export function shapeStick(x: number, y: number, shape: StickShape, out: Vec2Out): Vec2Out {
  const mag = Math.hypot(x, y)
  if (!(mag > shape.inner)) {
    out.x = 0
    out.y = 0
    return out
  }
  const t = Math.min((mag - shape.inner) / (shape.outer - shape.inner), 1) ** shape.curve
  const k = t / mag
  out.x = x * k
  out.y = y * k
  return out
}

/** Clamps a digital (keyboard) direction to length 1, so diagonals are not 41% faster. */
export function clampUnit(out: Vec2Out): Vec2Out {
  const mag = Math.hypot(out.x, out.y)
  if (mag > 1) {
    out.x /= mag
    out.y /= mag
  }
  return out
}
