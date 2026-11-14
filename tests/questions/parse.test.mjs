// @ts-check
/**
 * The questions parser, on each shape a questions file has taken in practice, and the answers
 * file it writes.
 */
import { describe, expect, it } from 'vitest'
import {
  addEntry,
  answeredIds,
  parseQuestions,
  questionId,
  questionMark,
  removeEntry,
  splitItem,
} from '../../src/questions/parse.mjs'

const heads = (/** @type {string} */ md) => parseQuestions(md).map((q) => q.headline)

describe('parseQuestions', () => {
  it('reads numbered items with a bold question, and keeps their numbers', () => {
    const qs = parseQuestions(
      '# Questions\n\nOne line each.\n\n1. **Is the title right?** It came from the pitch. Recommend keeping it.\n3. **Which engine?** Two are close. Recommend the lighter one.\n',
    )
    expect(qs.map((q) => [q.num, q.headline, q.context, q.rec])).toEqual([
      ['1', 'Is the title right?', 'It came from the pitch.', 'Recommend keeping it.'],
      ['3', 'Which engine?', 'Two are close.', 'Recommend the lighter one.'],
    ])
  })

  it('reads plain bullets, cutting the headline at the question mark', () => {
    const qs = parseQuestions(
      '- Should the clock carry between rooms? Recommend carry: it rewards flow.\n',
    )
    expect(qs[0]).toMatchObject({
      num: null,
      headline: 'Should the clock carry between rooms?',
      rec: 'Recommend carry: it rewards flow.',
    })
  })

  it('takes a lead-in to the colon as the headline when there is no question mark', () => {
    const [q] = parseQuestions('- Phone: there are no touch controls yet. Recommend waiting.\n')
    expect(q).toMatchObject({ headline: 'Phone', context: 'there are no touch controls yet.' })
  })

  it('joins a bold label to the question after it', () => {
    const [q] = parseQuestions('2. **Flight:** jet, or hover-jet? Recommend hover-jet.\n')
    expect(q?.headline).toBe('Flight: jet, or hover-jet?')
    const [r] = parseQuestions(
      '- **The pass.** A worn `?debug=1` capture. Recommend one session.\n',
    )
    expect(r?.headline).toBe('The pass.')
  })

  it('joins wrapped lines and nested bullets into their item', () => {
    const md = [
      '- **Ship it?** The build is',
      '  ready. *Rec: yes, after one',
      '  look.* Detail: [notes.md](notes.md).',
      '  - a nested point',
      '- Next one? Recommend no.',
    ].join('\n')
    const qs = parseQuestions(md)
    expect(qs).toHaveLength(2)
    expect(qs[0]?.context).toBe('The build is ready.')
    expect(qs[0]?.rec).toBe('yes, after one look. Detail: [notes.md](notes.md). a nested point')
    expect(qs[0]?.line).toBe(1)
    expect(qs[1]?.line).toBe(5)
  })

  it('skips ticked boxes, closed sections, settled items and plain notes', () => {
    const md = [
      '## Open',
      '- [ ] **Budget?** Recommend 30 hours.',
      '- [x] **Cast:** answered, see D6.',
      '5. **Runts:** settled by D15. Kept for numbering.',
      '2. **Superseded by D32.** **Old?** Recommend yes.',
      '- A note with no question and no recommendation.',
      '## Answered',
      '- Was it right? Recommend yes.',
      '```',
      '- In a fence? Recommend no.',
      '```',
    ].join('\n')
    expect(heads(md)).toEqual(['Budget?'])
  })

  it('marks items under an urgent heading', () => {
    const qs = parseQuestions(
      '## URGENT\n\n- Pay the bill? Recommend yes.\n\n## Later\n\n- Rename? Recommend no.\n',
    )
    expect(qs.map((q) => [q.section, q.urgent])).toEqual([
      ['URGENT', true],
      ['Later', false],
    ])
  })

  it('reads a table with question and recommendation columns', () => {
    const md = [
      '| # | Question | Recommendation |',
      '|---|---|---|',
      '| 1 | Keep the hub? It exists. | Keep it for now |',
      '| 2 | Two HUDs? | One |',
    ].join('\n')
    expect(parseQuestions(md).map((q) => [q.num, q.headline, q.context, q.rec])).toEqual([
      ['1', 'Keep the hub?', 'It exists.', 'Keep it for now'],
      ['2', 'Two HUDs?', '', 'One'],
    ])
  })

  it('reads CRLF files the same', () => {
    expect(heads('- A?\r\n  more. Recommend b.\r\n- C? Recommend d.\r\n')).toEqual(['A?', 'C?'])
  })
})

describe('splitItem and questionMark', () => {
  it('does not end a question inside code or a link', () => {
    expect(questionMark('Run `x?y=1` now?')).toBe(15)
    expect(questionMark('See [a](b?c=1) first?')).toBe(20)
    expect(questionMark('No question here, ?query=1')).toBe(-1)
  })

  it('drops a bare Rec: prefix the page already labels', () => {
    expect(splitItem('**Q?** Rec: yes.').rec).toBe('yes.')
    expect(splitItem('**Q?** Recommend yes.').rec).toBe('Recommend yes.')
  })
})

describe('questionId', () => {
  it('stays the same when only spacing or emphasis changes, and differs by number', () => {
    expect(questionId('4', '**Ship  it?**')).toBe(questionId('4', 'Ship it?'))
    expect(questionId('4', 'Ship it?')).not.toBe(questionId('5', 'Ship it?'))
  })

  it('keeps an answered question answered when its context is edited', () => {
    const before = parseQuestions('- Ship it? It is ready. Recommend yes.\n')[0]
    const after = parseQuestions('- Ship it? It is ready, and tested. Recommend yes, today.\n')[0]
    expect(after?.id).toBe(before?.id)
  })
})

describe('the answers file', () => {
  const [q] = parseQuestions('7. **Ship it?** It is ready. Recommend yes.\n')
  const [r] = parseQuestions('8. **Rename it?** Recommend no.\n')
  if (!q || !r) throw new Error('fixture')
  const at = '2026-01-02 03:04'

  it('starts the file with its header, then one entry per answer', () => {
    const one = addEntry(null, q, { id: q.id, choice: 'yes', note: '', at })
    expect(one).toMatch(/^# Answers\n/)
    expect(one).toContain(`## ${at}, question 7\n<!-- question ${q.id} yes -->`)
    expect(one).toContain('**Answer:** Yes, go with the recommendation.')
    expect(one).toContain('The recommendation was: Recommend yes.')
    const two = addEntry(one, r, {
      id: r.id,
      choice: 'reply',
      note: 'Call it\nsomething short.',
      at,
    })
    expect(two).toContain('> Call it\n> something short.')
    expect([...answeredIds(two)]).toEqual([q.id, r.id])
  })

  it('undo removes one entry, and the file empties when the last goes', () => {
    const two = addEntry(addEntry(null, q, { id: q.id, choice: 'no', note: '', at }), r, {
      id: r.id,
      choice: 'drop',
      note: '',
      at,
    })
    const one = removeEntry(two, q.id)
    expect([...answeredIds(one)]).toEqual([r.id])
    expect(one).toMatch(/^# Answers\n/)
    expect(removeEntry(one, 'ffffffffff')).toBe(one)
    expect(removeEntry(one, r.id)).toBe('')
  })

  it('keeps CRLF line endings', () => {
    const crlf = addEntry(null, q, { id: q.id, choice: 'yes', note: '', at }).replace(/\n/g, '\r\n')
    const more = addEntry(crlf, r, { id: r.id, choice: 'no', note: '', at })
    expect(more.replace(/\r\n/g, '')).not.toContain('\n')
  })
})
