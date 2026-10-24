// @ts-check
// A stand-in for a GPU job: logs when it starts (with its pid) and ends, holding <ms> between.
//   node hold.mjs <log file> <tag> <ms>
import fs from 'node:fs'

const [log = '', tag = '', ms = '0'] = process.argv.slice(2)
fs.appendFileSync(log, `${tag} start ${Date.now()} ${process.pid}\n`)
setTimeout(() => fs.appendFileSync(log, `${tag} end ${Date.now()}\n`), Number(ms))
