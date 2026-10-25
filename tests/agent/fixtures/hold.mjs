// @ts-check
// A stand-in for a GPU job: logs when it starts (with its pid) and ends, holding between for <ms>,
// or, given a path instead, until that file exists (so a test decides when it lets go).
//   node hold.mjs <log file> <tag> <ms | release file>
import fs from 'node:fs'

const [log = '', tag = '', hold = '0'] = process.argv.slice(2)
fs.appendFileSync(log, `${tag} start ${Date.now()} ${process.pid}\n`)
const end = () => fs.appendFileSync(log, `${tag} end ${Date.now()}\n`)
if (/^\d+$/.test(hold)) {
  setTimeout(end, Number(hold))
} else {
  const poll = setInterval(() => {
    if (!fs.existsSync(hold)) return
    clearInterval(poll)
    end()
  }, 20)
}
