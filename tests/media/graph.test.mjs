import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  cardFilter,
  joinGraph,
  lookFilters,
  musicGraph,
  planCut,
  trimChain,
} from '../../src/media/graph.mjs'

const root = path.resolve('/game')
/** @type {import('../../src/media/graph.mjs').PlanContext['resolveClip']} */
const resolveClip = (clip, dir, fps) => ({
  args: ['-i', path.join(dir, clip, `${clip}.mp4`)],
  retime: `setpts=N/${fps}/TB`,
})

/** @param {string[]} args */
const filter = (args) => args[args.indexOf('-filter_complex') + 1]

describe('filter pieces', () => {
  it('fits a clip to the frame: reframe, cover-scale, crop, grade', () => {
    expect(lookFilters({ crop: '960:1080:480:0', grade: 'eq=gamma=1.1' }, 1080, 1620)).toEqual([
      'crop=960:1080:480:0',
      'scale=1080:1620:force_original_aspect_ratio=increase:flags=lanczos:out_range=tv',
      'crop=1080:1620',
      'eq=gamma=1.1',
      'setsar=1',
      'format=yuv420p',
    ])
  })

  it('trims in game time, then speeds and reverses', () => {
    expect(trimChain({ clip: 'a', in: 1.5, dur: 2 }, 'setpts=N/60/TB')).toBe(
      'setpts=N/60/TB,trim=start=1.5:duration=2,setpts=PTS-STARTPTS',
    )
    expect(trimChain({ clip: 'a', in: 0, dur: 2, speed: 0.5, reverse: true }, 'R')).toBe(
      'R,trim=start=0:duration=1,setpts=(PTS-STARTPTS)/0.5,reverse',
    )
  })

  it('joins with concat or a dissolve at the right offset', () => {
    const j = joinGraph([{ dur: 2 }, { dur: 3, dissolve: 0.5 }, { dur: 1 }])
    expect(j.parts).toEqual([
      '[0:v][1:v]xfade=transition=fade:duration=0.5:offset=1.5[c1]',
      '[c1][2:v]concat=n=2:v=1:a=0[c2]',
    ])
    expect(j.label).toBe('[c2]')
    expect(j.total).toBe(5.5)
  })

  it('puts every segment on one timebase when a dissolve follows a hard cut', () => {
    const j = joinGraph([{ dur: 2 }, { dur: 3 }, { dur: 1, dissolve: 0.5 }])
    expect(j.parts).toEqual([
      '[0:v]settb=AVTB[t0]',
      '[1:v]settb=AVTB[t1]',
      '[2:v]settb=AVTB[t2]',
      '[t0][t1]concat=n=2:v=1:a=0[c1]',
      '[c1][t2]xfade=transition=fade:duration=0.5:offset=4.5[c2]',
    ])
    expect(j.total).toBe(5.5)
  })

  it('escapes a card’s text and turns expansion off', () => {
    const f = cardFilter({ text: "It's 100%: go", at: 1, to: 3 }, 'C:\\fonts\\ui.ttf')
    expect(f).toContain("fontfile='C\\:/fonts/ui.ttf'")
    expect(f).toContain('expansion=none')
    expect(f).toContain("text='It\u2019s 100\\%\\: go'")
    expect(f).toContain("enable='between(t,1,3)'")
    expect(f).toContain('if(lt(t,1.4),(t-1)/0.4')
  })

  it('splices music ranges with crossfades and fades the end', () => {
    expect(
      musicGraph(
        {
          ranges: [
            [8, 48],
            [196, 212],
          ],
          gain: 0.8,
        },
        4,
        52,
      ),
    ).toEqual([
      '[4:a]asplit=2[s0][s1]',
      '[s0]atrim=8:48.06,asetpts=PTS-STARTPTS[m0]',
      '[s1]atrim=196:212,asetpts=PTS-STARTPTS[m1]',
      '[m0][m1]acrossfade=d=0.06:c1=tri:c2=tri[mx1]',
      '[mx1]afade=t=out:st=49:d=3,atrim=0:52,volume=0.8[a]',
    ])
  })
})

describe('planCut', () => {
  const edl = {
    clips: 'cap',
    size: /** @type {[number, number]} */ ([320, 180]),
    out: 'out/cut.mp4',
    cover: { file: 'cover.png', hold: 0.5 },
    shots: [
      { clip: 'a', in: 0, dur: 1, dissolve: 0.25 },
      { clip: 'b', in: 2, dur: 1, wipeFrom: 'c', wipeAt: 0.8, wipe: 0.4 },
    ],
    overlays: [{ file: 'logo.png', at: 0.2, to: 1.5, w: 64, x: 8, y: 8 }],
    fadeOut: 0.5,
  }

  it('makes one command per segment and one to join them', () => {
    const plan = planCut(edl, { root, resolveClip })
    expect(plan.commands.map((c) => c.label)).toEqual([
      'seg 0 cover 0.5s',
      'seg 1 a @0 1s',
      'seg 2 c wipes to b @2 1s',
      'join 3 segments, 2.25 s',
    ])
    expect(plan.out).toBe(path.join(root, 'out/cut.mp4'))
    expect(plan.length).toBe(2.25)
  })

  it('re-times each shot and clamps it to its duration', () => {
    const plan = planCut(edl, { root, resolveClip })
    const seg = plan.commands[1].args
    expect(seg).toContain(path.join(root, 'cap', 'a', 'a.mp4'))
    expect(filter(seg)).toBe(
      '[0:v]setpts=N/60/TB,trim=start=0:duration=1,setpts=PTS-STARTPTS,scale=320:180:force_original_aspect_ratio=increase:flags=lanczos:out_range=tv,crop=320:180,setsar=1,format=yuv420p,fps=60,trim=duration=1[v]',
    )
    expect(seg.at(-1)).toBe(path.join(root, 'out', '.segs-cut', '01.mp4'))
  })

  it('wipes the earlier clip to the later one at the same game time', () => {
    const seg = planCut(edl, { root, resolveClip }).commands[2].args
    const inputs = seg.filter((_, i) => seg[i - 1] === '-i')
    expect(inputs).toEqual([
      path.join(root, 'cap', 'c', 'c.mp4'),
      path.join(root, 'cap', 'b', 'b.mp4'),
    ])
    const f = filter(seg)
    expect(f).toContain('[1:v]setpts=N/60/TB,trim=start=2.4:duration=0.6,')
    expect(f).toContain(
      '[a][b]xfade=transition=wiperight:duration=0.4:offset=0.4,trim=duration=1[v]',
    )
  })

  it('joins, overlays and fades, silent without music, faststart', () => {
    const plan = planCut(edl, { root, resolveClip })
    const join = plan.commands.at(-1)?.args ?? []
    const f = filter(join)
    expect(f).toContain('[0:v][1:v]xfade=transition=fade:duration=0.25:offset=0.25[c1]')
    expect(f).toContain("[c2][ov0]overlay=x=8:y=8:enable='between(t,0.2,1.5)'[o0]")
    expect(f).toContain('[o0]fade=t=out:st=1.75:d=0.5,trim=duration=2.25,format=yuv420p[v]')
    expect(join).toContain('-an')
    expect(join.join(' ')).toContain('-movflags +faststart')
    expect(join.join(' ')).toContain('-crf 18')
  })

  it('adds music as the last input, and a draft writes beside the output', () => {
    const plan = planCut(
      { ...edl, music: { file: 'm.opus', ranges: [[0, 10]] } },
      { root, resolveClip, draft: true },
    )
    const join = plan.commands.at(-1)?.args ?? []
    expect(join).not.toContain('-an')
    expect(join.slice(join.indexOf('-map'), join.indexOf('-map') + 4)).toEqual([
      '-map',
      '[v]',
      '-map',
      '[a]',
    ])
    expect(filter(join)).toContain('[4:a]atrim=0:10,asetpts=PTS-STARTPTS[m0]')
    expect(plan.out).toBe(path.join(root, 'out/cut-draft.mp4'))
    expect(join.join(' ')).toContain('-preset veryfast -crf 24')
  })
})
