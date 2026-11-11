/**
 * runtime/sim, run in node. The files are TypeScript, which Vitest transforms; the path is built at
 * run time so this repo's own typecheck leaves them to runtime/tsconfig.json. The goldens come from
 * the games' own copies (sim-goldens.mjs says how), and `toBe` compares with `Object.is`, so a
 * float must match to the bit, -0 and NaN included.
 */
import { describe, expect, it } from 'vitest'
import { DET, fold, RNG, SWEEPS, SWEPT } from './sim-goldens.mjs'

/** @param {string} rel @returns {Promise<any>} */
const load = (rel) =>
  import(/* @vite-ignore */ new URL(`../../runtime/${rel}`, import.meta.url).href)

/** @param {number} n @param {(_: unknown, i: number) => any} f */
const times = (n, f) => Array.from({ length: n }, f)
const N = 8

/** Every element by `Object.is`, so -0 and NaN count. @param {any[]} got @param {any[]} want */
function exact(got, want) {
  expect(got.length).toBe(want.length)
  got.forEach((g, i) => {
    if (!Object.is(g, want[i])) expect.fail(`[${i}]: got ${g}, want ${want[i]}`)
  })
}

describe('sim/rng: the same draws as the games', async () => {
  const rng = await load('sim/rng.ts')
  const { Rng, mulberry32, range, pick, pickWeighted, GOLDEN_SEED } = rng

  for (const seed of RNG.seeds) {
    const want = RNG.bySeed[String(seed)]
    it(`seed ${seed}`, () => {
      const r = () => new Rng(seed)
      const f = () => mulberry32(seed)
      let a = r()
      exact(
        times(N, () => a.next()),
        want.next,
      )
      const fn = f()
      exact(
        times(N, () => fn()),
        want.next,
      )

      a = r()
      exact(
        times(N, () => a.range(-2.5, 7)),
        want.range,
      )
      const fr = f()
      exact(
        times(N, () => range(fr, -2.5, 7)),
        want.range,
      )

      a = r()
      exact(
        times(N, () => a.int(3, 9)),
        want.intLoHi,
      )
      a = r()
      exact(
        times(N, () => a.int(10)),
        want.intN,
      )
      a = r()
      exact(
        times(N, () => a.int(2.5)),
        want.intFrac,
      )
      a = r()
      expect(times(N, () => a.chance(0.3))).toEqual(want.chance)

      a = r()
      expect(times(N, () => a.pick(RNG.list))).toEqual(want.pick)
      const fp = f()
      expect(times(N, () => pick(fp, RNG.list))).toEqual(want.pick)

      a = r()
      exact(
        times(N, () => a.weighted(RNG.weights)),
        want.weighted,
      )
      const fw = f()
      expect(times(N, () => pickWeighted(fw, RNG.pairs))).toEqual(want.pickWeighted)

      a = r()
      const ten = () => times(10, (_, i) => i)
      expect([a.shuffle(ten()), a.shuffle(ten())]).toEqual(want.shuffle)

      a = r()
      const units = times(3, () => [...a.unit([0, 0, 0])])
      for (const [i, u] of units.entries()) exact(u, want.unit[i])

      a = r()
      a.next()
      a.next()
      a.next()
      expect(a.state).toBe(want.stateAfter3)
    })
  }

  it('starts a seed of 0 at 0, or at zeroSeed', () => {
    const plain = new Rng(0)
    exact(
      times(N, () => plain.next()),
      RNG.zero.plain,
    )
    const fn = mulberry32(0)
    exact(
      times(N, () => fn()),
      RNG.zero.plain,
    )
    const golden = new Rng(0, { zeroSeed: GOLDEN_SEED })
    expect(golden.state).toBe(RNG.zero.goldenState)
    exact(
      times(N, () => golden.next()),
      RNG.zero.golden,
    )
    // zeroSeed touches only a seed of 0.
    expect(new Rng(42, { zeroSeed: GOLDEN_SEED }).next()).toBe(RNG.bySeed['42'].next[0])
    expect(new Rng(2 ** 32, { zeroSeed: GOLDEN_SEED }).state).toBe(GOLDEN_SEED)
  })

  it('restores from state', () => {
    const r = new Rng(5)
    r.state = -12345
    exact(
      times(N, () => r.next()),
      RNG.stateSet,
    )
    const a = new Rng(9)
    a.next()
    const b = new Rng(1)
    b.state = a.state
    expect(b.next()).toBe(a.next())
  })

  it('hashes text, numbers and int triples as the games did', () => {
    expect(RNG.texts.map(rng.seedFromString)).toEqual(RNG.seedFromString)
    expect(RNG.texts.map(rng.seedFromText)).toEqual(RNG.seedFromString)
    expect(RNG.hashParts.map((/** @type {number[]} */ p) => rng.hashSeed(...p))).toEqual(
      RNG.hashSeed,
    )
    exact(
      RNG.hash3Args.map((/** @type {number[]} */ a) => rng.hash3(...a)),
      RNG.hash3,
    )
  })

  it('folds 100000 draws to the same fingerprint', () => {
    const r = new Rng(12345)
    expect(fold(times(100000, () => r.next()))).toBe(SWEPT.draws)
    const f = mulberry32(12345)
    expect(fold(times(100000, () => f()))).toBe(SWEPT.draws)
  })

  it('pick throws on an empty list unless told to carry on; either way it draws', () => {
    expect(() => new Rng(1).pick([])).toThrow(/empty/)
    expect(() => pick(mulberry32(1), [])).toThrow(/empty/)
    expect(() => pickWeighted(mulberry32(1), [])).toThrow(/empty/)
    const loose = new Rng(1, { emptyPick: 'undefined' })
    expect(loose.pick([])).toBeUndefined()
    expect(loose.next()).toBe(RNG.bySeed['1'].next[1])
  })

  it('weighted returns -1 without a draw when no weight is over 0', () => {
    const r = new Rng(1)
    expect(r.weighted([0, -2])).toBe(-1)
    expect(r.weighted([])).toBe(-1)
    expect(r.next()).toBe(RNG.bySeed['1'].next[0])
  })
})

describe('sim/det: the same floats as the games, to the bit', async () => {
  const { M, sq, powi, powf } = await load('sim/det.ts')

  /** @param {string} name @param {any[]} inputs @param {(x: any) => number} f */
  const check = (name, inputs, f) =>
    it(name, () => {
      exact(inputs.map(f), DET[name])
    })

  check('sin', DET.angles, M.sin)
  check('cos', DET.angles, M.cos)
  check('tan', DET.angles, M.tan)
  check('atan', DET.ratios, M.atan)
  check('atan2', DET.yx, ([y, x]) => M.atan2(y, x))
  check('asin', DET.unit, M.asin)
  check('acos', DET.unit, M.acos)
  check('exp', DET.exps, M.exp)
  check('ln', DET.logs, M.ln)
  check('hypot', DET.hyp, ([x, y]) => M.hypot(x, y))
  check('hypot3', DET.hyp3, ([x, y, z]) => M.hypot(x, y, z))
  check('tanh', DET.tanhs, M.tanh)
  check('powf', DET.powfs, ([x, p]) => powf(x, p))
  check('powi', DET.powis, ([x, n]) => powi(x, n))
  check('sq', DET.sqs, sq)

  // Thousands of inputs a function, folded: one ulp anywhere changes the fingerprint.
  /** @type {Record<string, (a: any) => number>} */
  const swept = {
    sin: M.sin,
    cos: M.cos,
    tan: M.tan,
    atan: M.atan,
    atan2: ([y, x]) => M.atan2(y, x),
    asin: M.asin,
    acos: M.acos,
    exp: M.exp,
    ln: M.ln,
    hypot: ([x, y]) => M.hypot(x, y),
    tanh: M.tanh,
    powf: ([x, p]) => powf(x, p),
  }
  for (const [name, f] of Object.entries(swept)) {
    it(`${name} over a sweep`, () => {
      expect(fold(SWEEPS[name]().map(f))).toBe(SWEPT[name])
    })
  }

  it('M holds exactly the functions the copies shared', () => {
    expect(Object.keys(M).sort()).toEqual(
      ['acos', 'asin', 'atan', 'atan2', 'cos', 'exp', 'hypot', 'ln', 'sin', 'tan', 'tanh'].sort(),
    )
  })

  it('stays close to the engine where both are defined', () => {
    for (const x of DET.angles) {
      expect(M.sin(x)).toBeCloseTo(Math.sin(x), 12)
      expect(M.cos(x)).toBeCloseTo(Math.cos(x), 12)
    }
    for (const x of [-5, -0.5, 0, 0.5, 5]) expect(M.exp(x) / Math.exp(x)).toBeCloseTo(1, 13)
    for (const x of [0.001, 0.5, 2, 1e6]) expect(M.ln(x)).toBeCloseTo(Math.log(x), 12)
  })
})

describe('sim/fixed-step', async () => {
  const { createFixedStepper, SIM_DT, SIM_HZ } = await load('sim/fixed-step.ts')

  it('runs two 120 Hz steps a 60 Hz frame, never alternating 1 and 3', () => {
    expect(SIM_HZ).toBe(120)
    expect(SIM_DT).toBe(1 / 120)
    const s = createFixedStepper()
    const steps = times(600, () => s.advance(1 / 60).steps)
    expect(new Set(steps)).toEqual(new Set([2]))
  })

  it('carries the remainder as alpha, under 1', () => {
    const s = createFixedStepper({ stepSeconds: 0.1 })
    const a = s.advance(0.25)
    expect(a.steps).toBe(2)
    expect(a.alpha).toBeCloseTo(0.5, 9)
    expect(a.dropped).toBe(false)
    expect(s.advance(0.05).steps).toBe(1)
  })

  it('clamps a long frame and drops a backlog past the step cap', () => {
    const s = createFixedStepper({ stepSeconds: 0.01, maxStepsPerFrame: 4, maxFrameSeconds: 0.25 })
    const long = s.advance(10)
    expect(long).toMatchObject({ steps: 4, alpha: 0, dropped: true })
    const s2 = createFixedStepper({ stepSeconds: 0.1, maxFrameSeconds: 0.25 })
    expect(s2.advance(1)).toMatchObject({ steps: 2, dropped: true })
  })

  it('treats a bad frame as no time, and forgets on reset', () => {
    const s = createFixedStepper({ stepSeconds: 0.1 })
    for (const bad of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
      expect(s.advance(bad)).toMatchObject({ steps: 0, alpha: 0, dropped: false })
    }
    s.advance(0.05)
    s.reset()
    expect(s.advance(0.05).steps).toBe(0)
  })

  it('returns the same object every frame, so a frame allocates nothing', () => {
    const s = createFixedStepper()
    expect(s.advance(0.01)).toBe(s.advance(0.01))
    expect(s.stepSeconds).toBe(SIM_DT)
  })
})
