# Questions: answering what agents ask

Agents working in a repo keep a questions file for the person who makes the calls: one line per
open question, each with a recommendation. Read as a document, a long one is slow to answer, and
the answers end up in chat where the next session cannot see them. `umm-dev questions` turns every
questions file into a page of cards: read one, press a key, and the next one is up. Each answer is
written at once to `ANSWERS.md` beside the questions file, where the repo's next session picks it
up.

It is **linked**: it runs from `node_modules/@ummgames/dev` and ships nothing in a game.

## Quick start

In one repo:

```sh
pnpm exec umm-dev questions
```

Across every repo in a folder (each main checkout one level down):

```sh
pnpm exec umm-dev questions --root ..
```

The page opens at `http://localhost:4646/`. For each card:

| Key | What it does | What is written |
|---|---|---|
| `Y` | Go with the recommendation | "Yes, go with the recommendation." |
| `N` | No | "No." |
| `/`, then type, then `Enter` | Answer in your own words | your words |
| `D` | Drop it: the question is stale or no longer needed | "Drop this question: it is no longer needed." |
| `S` or `→` | Later: move it to the end of the queue for this sitting | nothing |
| `←` | Back to the card before | nothing |
| `U` | Undo the last answer | removes its entry |
| `L` | Switch between one at a time and the list | nothing |

A note typed in the box goes with `Y`, `N` or `D` too: press `Esc` to leave the box, then the key.
The list view answers a row with one click, and "Go with all N recs shown" answers yes to every
question in view, each as its own entry. Links in a question open the linked file as text.

The page reads the files again when its tab comes back into focus and once a minute, so a question
an agent adds shows up without a restart.

## `umm-dev questions [serve]`

Starts the page on 127.0.0.1 and opens it in the browser. Stop it with Ctrl-C. If the page is
already running on the port, it opens that one and exits.

| Option | Default | What it does |
|---|---|---|
| `--root <dir>` | the current directory | A repo, or a folder whose subfolders are repos. Repeat for more. |
| `--port <n>` | `4646` | The port. |
| `--no-open` | off | Do not open a browser. |
| `--idle <m>` | `0` | Stop after `m` minutes with no request from a page. `0` never stops. |

## `umm-dev questions list`

Prints the open questions as text, urgent first, grouped by file.

| Option | Default | What it does |
|---|---|---|
| `--root <dir>` | the current directory | As for `serve`. |
| `--json` | off | Print `{ open, files }` as JSON instead. |

Exit codes: `0`; `1` the port is taken by something else; `64` usage.

## The questions file

**Where.** In `docs/` or at the repo's root, named `QUESTIONS.md`, `questions-for-<name>.md` or
anything else starting with `questions` and ending in `.md`. Two names for one file, on a disk that
ignores case, count once. Only main checkouts are read: a linked worktree holds a branch's copy.

**The format to write.** One list item per open question, starting at the left margin:

```md
# Questions

One line each, with a recommendation. Nothing here blocks work.

1. **Should the clock carry between rooms?** Keeping it through a door rewards flow; resetting it
   makes each room fair. Recommend carry, and judging it after a few runs.
2. **Which engine for the menu music?** Recommend the chip sequencer, since the tracks are in it.
```

- **The question** is the bold lead-in. Without bold, it is the text up to the first `?`, or up
  to the first colon or full stop. A bold label such as `**Flight:**` takes the question after
  it into the headline. A `?` inside a code span or a link, or followed by a letter
  (`?debug=1`), does not end a question.
- **The recommendation** starts at the first "Recommend", "Rec:" or "*Rec:". The page shows it in
  its own box and says so when there is none. The `Y` key needs one.
- **The context** is everything between the two.
- **A number** (`1.` or `1)`) is kept and shown. Give each question one and never reuse it, so
  other docs can cite it.
- **Wrapped lines** belong to the item above while they are indented, or until a blank line.
  Nested bullets join their parent.
- **Sections.** A heading names a section, shown on the card. Items under a heading with "urgent",
  "first", "blocking" or "needs you" come before everything else. Items under a heading with
  "answered", "settled", "closed", "done", "history", "archive" or "rules" are skipped.
- **Skipped items:** a ticked task box (`- [x]`), an item that starts "Settled", "Superseded",
  "Answered", "Closed", "Done", "Withdrawn" or "Dropped", and an item with neither a `?` nor a
  recommendation (a note, not a question). Fenced code is skipped.
- **Tables** work too: a table whose header has a "Question" column, with optional
  "Recommendation" and `#` columns, gives one question per row.

**Ids.** Each question's id is a hash of its number and its question text, ignoring emphasis and
spacing. Editing the context or the recommendation keeps the id, so an answer stays attached.
Rewording the question makes it a new one, which is asked again.

## The answers file

`ANSWERS.md` beside the questions file. The page creates it with a header that tells agents what
to do, then appends one entry per answer, in the order given:

```md
## 2026-01-02 15:04, question 7
<!-- question 3f9a1c2b4d yes -->

**Q:** Should the clock carry between rooms?

**Answer:** Yes, go with the recommendation.

> Only for the first three rooms.

The recommendation was: Recommend carry, and judging it after a few runs.
```

The heading says `question <n>` for a numbered item and `line <n>` otherwise. The comment holds
the id and the choice (`yes`, `no`, `drop` or `reply`); the page hides every question whose id is
in it. The quote is the note, when there is one. Undo removes the entry, and the file when it is
the last.

## For agents

Put this in the repo's CLAUDE.md, or follow it where the user's own rules already say so:

- **Asking.** A question for the person goes in the questions file, in the format above: one item,
  a bold question, the context, then a sentence starting "Recommend". Never block on it; work to
  the recommendation until it is answered.
- **Answers come back in `ANSWERS.md`.** At the start of a session, and before you rewrite a
  handover, look for one beside the questions file. For each entry:
  1. Record it in the decision log as the person's call, dated, in the entry's words. "Yes, go
     with the recommendation" means the recommendation as written in the entry.
  2. Remove the question from the questions file, or rewrite it if the answer opens a new one.
  3. Delete the entry. Delete the file when no entries are left.
  4. Commit the three files together, then act on the answer.
- **"Drop"** means the question is stale: remove it, and log that it was dropped.
- **Never edit `ANSWERS.md` except to remove an entry you have recorded.** The page appends to it
  while the person is answering.

## How it works

`src/questions/parse.mjs` reads a questions file into items and writes answer entries.
`scan.mjs` finds the files and orders the open questions: urgent first, then the repos with the
newest commit, then file order. `server.mjs` serves `page/` and three routes:

- `GET /api/questions`: a fresh scan on every call. Nothing is cached but each repo's last commit
  time, for ten minutes.
- `POST /api/answer` (`{ key, choice, note }`): finds the question again in its file, so an answer
  always matches the words on disk, then appends the entry.
- `POST /api/undo` (`{ key }`): removes the entry.

The page moves to the next card at once and saves behind it, one write at a time, so an undo never
overtakes the answer it undoes. A save that fails puts the card back.

**Safety.** The server listens on 127.0.0.1 only. It answers only a `Host` of `localhost`,
`127.0.0.1` or `[::1]` on its own port, which stops DNS rebinding. A write must be a JSON POST, and
one with an `Origin` must come from the page itself, so another site cannot post a form to it. A
linked file opens only if it is inside its repo, outside `.git`, and text (`.md`, `.txt`, `.json`,
`.yaml`, `.toml`, `.csv`, `.log`). Every response sends the kit's security headers (without
HSTS, since this is plain http on loopback) and a strict Content-Security-Policy.

## Troubleshooting

**A question is missing.** Run `umm-dev questions list` in its repo. If it is not listed, check
that the item starts at the left margin, that it has a `?` or a recommendation, and that its
heading is not one of the skipped ones.

**An answered question came back.** Its question text changed after the answer, so it has a new
id. Answer it again, or have the agent fold the old entry in first.

**"port 4646 is taken by something else".** Pass `--port`.
