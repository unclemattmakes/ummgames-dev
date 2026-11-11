/**
 * A random direction on the unit sphere, drawn from an `Rng`. Kept apart from `rng.ts` because it
 * calls the engine's own `Math.cos` and `Math.sin`, which can differ between engines in the last
 * bit: a sim that bans engine trig copies `rng.ts` and leaves this file out.
 *
 * It takes the same two draws, in the same order, as the `unit` method an `Rng` once had, so a
 * game that called `rng.unit(out)` gets the same directions from `unitOnSphere(rng, out)`.
 */
import type { Rng } from './rng'

/** A uniform direction on the unit sphere, written into `out`. Two draws: z, then the angle. */
export function unitOnSphere(
  rng: Pick<Rng, 'range'>,
  out: [number, number, number],
): [number, number, number] {
  const z = rng.range(-1, 1)
  const a = rng.range(0, Math.PI * 2)
  const r = Math.sqrt(1 - z * z)
  out[0] = r * Math.cos(a)
  out[1] = r * Math.sin(a)
  out[2] = z
  return out
}
