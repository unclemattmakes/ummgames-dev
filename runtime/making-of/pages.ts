// What a making-of site's page scripts call. `createPages` binds the game's chapter list and toy
// loaders once; a chapter page is then `startChapter('flight')`, which loads that chapter's toys
// and mounts whichever `[data-toy]` elements the HTML placed, and the playground is
// `startPlayground()`: every toy, grouped under its chapter.

import { mountToysOnPage, type ToyDef } from './toy-host'

/** The part of a chapter row this file reads. */
export interface ToyChapter {
  readonly slug: string
  readonly number: string
  readonly title: string
  readonly toys: readonly string[]
}

/** A toy's module, loaded only when its page does, so a chapter pays for its own toys. */
export type ToyLoader = () => Promise<{ toy: ToyDef }>

export interface PagesOptions<C extends ToyChapter> {
  readonly chapters: readonly C[]
  /** Every toy, by id. */
  readonly loaders: Readonly<Record<string, ToyLoader>>
  /** Whether a chapter has a page for the playground to link to. Default: all do. */
  readonly hasPage?: (chapter: C) => boolean
}

/** Load toys by id. An id with no loader throws, naming it. */
export const loadToys = (
  loaders: Readonly<Record<string, ToyLoader>>,
  ids: readonly string[],
): Promise<ToyDef[]> =>
  Promise.all(
    ids.map(async (id) => {
      const load = loaders[id]
      if (!load) throw new Error(`making-of: no toy "${id}" in the registry`)
      return (await load()).toy
    }),
  )

export const createPages = <C extends ToyChapter>(options: PagesOptions<C>) => {
  const { chapters, loaders, hasPage = () => true } = options
  return {
    async startChapter(slug: string): Promise<void> {
      const chapter = chapters.find((c) => c.slug === slug)
      if (!chapter) throw new Error(`making-of: no chapter "${slug}" in the chapter list`)
      mountToysOnPage(await loadToys(loaders, chapter.toys))
    },
    async startPlayground(): Promise<void> {
      const host = document.querySelector<HTMLElement>('#playground')
      if (!host) return
      for (const chapter of chapters) {
        const ids = chapter.toys.filter((id) => id in loaders)
        if (!ids.length) continue
        const section = document.createElement('section')
        section.className = 'playground-section'
        const h = document.createElement('h2')
        h.textContent = `${chapter.number} · ${chapter.title}`
        section.append(h)
        // A toy without its chapter's prose is half the story: point at the chapter.
        if (hasPage(chapter)) {
          const read = document.createElement('a')
          read.className = 'playground-read'
          read.href = `/making-of/${chapter.slug}/`
          read.textContent = 'Read the chapter →'
          section.append(read)
        }
        for (const id of ids) {
          const slot = document.createElement('div')
          slot.dataset.toy = id
          section.append(slot)
        }
        host.append(section)
      }
      // No prose here, so each toy says what to try itself.
      mountToysOnPage(await loadToys(loaders, Object.keys(loaders)), 'caption')
    },
  }
}
