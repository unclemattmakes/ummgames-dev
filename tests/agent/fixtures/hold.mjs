// @ts-check
// A stand-in for a GPU job: logs when it starts and ends, holding for <ms> in between.
//   node hold.mjs <log file> <tag> <ms>
import fs from 'node:fs'

const [log = '', tag = '', ms = '0'] = process.argv.slice(2)
fs.appendFileSync(log, `${tag} start ${Date.now()}\n`)
setTimeout(() => fs.appendFileSync(log, `${tag} end ${Date.now()}\n`), Number(ms))
