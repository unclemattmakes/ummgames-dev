/**
 * Deterministic math for a sim: the same result, to the last bit, on every JavaScript engine.
 * The language leaves `Math.sin` and the rest to each engine, and engines differ: two of them
 * disagreed on about 3% of sines, enough to turn the same inputs into a different run within
 * seconds. These use only + - * / and `Math.sqrt`, which IEEE 754 fixes exactly, so a replay
 * plays the same in any browser, a desktop build and a server. The kernels are FreeBSD msun's
 * (from Sun's fdlibm, freely distributable), cut down: a sim's angles are small, so range
 * reduction needs no big-number path.
 *
 * A sim calls `M.sin` and the rest here, never the engine's own. A test that greps the sim's
 * folder for `Math.sin(` and the like keeps it that way.
 */
const PIO2_1 = 1.5707963267341256 // The first 33 bits of pi/2,
const PIO2_1T = 6.077100506506192e-11 // and what is left.
const INV_PIO2 = 0.6366197723675814

function kSin(x: number): number {
  const z = x * x
  const r =
    0.00833333333332249 +
    z *
      (-0.0001984126982985795 +
        z * (0.0000027557313707070068 + z * (-2.5050760253406863e-8 + z * 1.58969099521155e-10)))
  return x + x * z * (-0.16666666666666632 + z * r)
}

function kCos(x: number): number {
  const z = x * x
  const r =
    z *
    (0.0416666666666666 +
      z *
        (-0.001388888888887411 +
          z *
            (0.00002480158728947673 +
              z *
                (-2.7557314351390663e-7 +
                  z * (2.087572321298175e-9 + z * -1.1359647557788195e-11)))))
  const hz = 0.5 * z
  const w = 1 - hz
  return w + (1 - w - hz + z * r)
}

/** `x` less a whole number of quarter turns, into `reduced`; the number of them, mod 4, back. */
let reduced = 0
function quarterTurns(x: number): number {
  const n = Math.floor(x * INV_PIO2 + 0.5)
  reduced = x - n * PIO2_1 - n * PIO2_1T
  return ((n % 4) + 4) % 4
}

function sin(x: number): number {
  const q = quarterTurns(x)
  const r = reduced
  return q === 0 ? kSin(r) : q === 1 ? kCos(r) : q === 2 ? -kSin(r) : -kCos(r)
}

function cos(x: number): number {
  const q = quarterTurns(x)
  const r = reduced
  return q === 0 ? kCos(r) : q === 1 ? -kSin(r) : q === 2 ? -kCos(r) : kSin(r)
}

const ATAN_HI = [
  0.4636476090008061, 0.7853981633974483, 0.982793723247329, 1.5707963267948966,
] as const
const ATAN_LO = [
  2.2698777452961687e-17, 3.061616997868383e-17, 1.3903311031230998e-17, 6.123233995736766e-17,
] as const

function atan(v: number): number {
  const ax = Math.abs(v)
  if (!(ax < 73786976294838210000)) return ax > 0 ? (v < 0 ? -1 : 1) * 1.5707963267948966 : v
  let x = ax
  let id = -1
  if (ax >= 0.4375) {
    if (ax < 0.6875) {
      id = 0
      x = (2 * ax - 1) / (2 + ax)
    } else if (ax < 1.1875) {
      id = 1
      x = (ax - 1) / (ax + 1)
    } else if (ax < 2.4375) {
      id = 2
      x = (ax - 1.5) / (1 + 1.5 * ax)
    } else {
      id = 3
      x = -1 / ax
    }
  }
  const z = x * x
  const w = z * z
  const s1 =
    z *
    (0.3333333333333293 +
      w *
        (0.14285714272503466 +
          w *
            (0.09090887133436507 +
              w * (0.06661073137387531 + w * (0.049768779946159324 + w * 0.016285820115365782)))))
  const s2 =
    w *
    (-0.19999999999876483 +
      w *
        (-0.11111110405462356 +
          w * (-0.0769187620504483 + w * (-0.058335701337905735 + w * -0.036531572744216916))))
  const r =
    id < 0
      ? x - x * (s1 + s2)
      : (ATAN_HI[id] as number) - (x * (s1 + s2) - (ATAN_LO[id] as number) - x)
  return v < 0 ? -r : r
}

function atan2(y: number, x: number): number {
  if (y === 0) return 1 / x < 0 ? (1 / y < 0 ? -Math.PI : Math.PI) : y
  if (x === 0) return y < 0 ? -Math.PI / 2 : Math.PI / 2
  const z = atan(Math.abs(y / x))
  if (x > 0) return y < 0 ? -z : z
  return y < 0 ? z - Math.PI : Math.PI - z
}

function asin(x: number): number {
  return atan2(x, Math.sqrt((1 - x) * (1 + x)))
}

function acos(x: number): number {
  return atan2(Math.sqrt((1 - x) * (1 + x)), x)
}

function tan(x: number): number {
  return sin(x) / cos(x)
}

function exp(v: number): number {
  const x = v > 700 ? 700 : v < -700 ? -700 : v
  // biome-ignore lint/suspicious/noApproximativeNumericConstant: a literal, never the engine's value.
  const k = Math.floor(1.4426950408889634 * x + 0.5)
  const hi = x - k * 0.6931471803691238
  const lo = k * 1.9082149292705877e-10
  const r = hi - lo
  const t = r * r
  const c =
    r -
    t *
      (0.16666666666666602 +
        t *
          (-0.0027777777777015593 +
            t *
              (0.00006613756321437934 +
                t * (-0.0000016533902205465252 + t * 4.1381367970572385e-8))))
  let y = 1 - (lo - (r * c) / (2 - c) - hi)
  // A power of two is exact, however it is reached.
  for (let i = 0; i < k; i++) y *= 2
  for (let i = 0; i > k; i--) y *= 0.5
  return y
}

function hypot(x: number, y: number, z = 0): number {
  return Math.sqrt(x * x + y * y + z * z)
}

function tanh(x: number): number {
  const e = exp(2 * x)
  return (e - 1) / (e + 1)
}

/**
 * Use these in the sim, never the engine's: `sin`, `cos`, `tan`, `atan`, `atan2`, `asin`, `acos`,
 * `exp`, `ln`, `hypot` (2 or 3 sides) and `tanh`.
 */
export const M = { sin, cos, tan, atan, atan2, asin, acos, exp, ln, hypot, tanh } as const

/** `x` squared. */
export function sq(x: number): number {
  return x * x
}

/** `x` to a whole power, 0 or more. */
export function powi(x: number, n: number): number {
  let out = 1
  for (let i = 0; i < n; i++) out *= x
  return out
}

/**
 * Natural log, by halving into [0.71, 1.41] and the atanh series: only + - * /, so the same
 * everywhere. For a finite `x` over 0 only: at 0, below it or at Infinity the halving never ends.
 */
function ln(x: number): number {
  let m = x
  let k = 0
  while (m > Math.SQRT2) {
    m *= 0.5
    k++
  }
  while (m < Math.SQRT1_2) {
    m *= 2
    k--
  }
  const s = (m - 1) / (m + 1)
  const z = s * s
  let sum = 0
  for (let n = 21; n >= 1; n -= 2) sum = sum * z + 1 / n
  return k * Math.LN2 + 2 * s * sum
}

/** `x` to a fractional power, for a finite `x`; 0 for `x` at 0 or below. Engines disagree on `**`. */
export function powf(x: number, p: number): number {
  return x <= 0 ? 0 : M.exp(p * ln(x))
}
