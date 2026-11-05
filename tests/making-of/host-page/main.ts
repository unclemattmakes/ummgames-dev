// A page of toys shorter than the screen, so more of them sit inside the host's near margin than
// its cap allows, in the mix a playground has: worlds that take a while to build, and flat toys.

import { mountToysOnPage, type ToyDef } from '../../../runtime/making-of/toy-host'

const BUILD_MS = 40

const stripes = (stage: HTMLElement): HTMLCanvasElement => {
  const canvas = document.createElement('canvas')
  canvas.width = 320
  canvas.height = 180
  const g = canvas.getContext('2d')
  for (let x = 0; g && x < 320; x += 4) {
    g.fillStyle = `hsl(${x}, 80%, 50%)`
    g.fillRect(x, 0, 4, 180)
  }
  stage.append(canvas)
  return canvas
}

const toys: ToyDef[] = Array.from({ length: 14 }, (_, i) => {
  const kind = i % 3 === 1 ? '2d' : '3d'
  return {
    id: `toy-${i}`,
    title: `Toy ${i}`,
    about: 'A toy.',
    caption: 'A toy.',
    kind,
    async mount({ stage }) {
      if (kind === '3d') await new Promise((done) => setTimeout(done, BUILD_MS))
      const canvas = stripes(stage)
      return { dispose: () => canvas.remove() }
    },
  }
})

for (const t of toys) {
  const slot = document.createElement('div')
  slot.dataset.toy = t.id
  document.body.append(slot)
}
mountToysOnPage(toys)
