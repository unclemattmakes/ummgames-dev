# Upgrading to a newer version

**A game moves to a new version of the kit only when it chooses to.** Nothing changes under a
game until its pinned tag changes.

## Versions

Releases are git tags, `v<major>.<minor>.<patch>`. A tag never moves once it is published.

| Change | Meaning for a game |
|---|---|
| Patch (`v0.1.0` to `v0.1.1`) | Fixes and docs. Safe to take. |
| Minor (`v0.1` to `v0.2`) | New tools or options. While the major version is 0, a minor can also rename or remove something: read the changelog. |
| Major | Breaking changes, listed in the changelog with what to change. |

[CHANGELOG.md](../CHANGELOG.md) lists every release.

## Steps

1. **Read the changelog** between your tag and the new one. Look for renamed options and outputs,
   and for runtime files that changed.
2. **Move the pin:**
   ```sh
   pnpm add -D github:unclemattmakes/ummgames-dev#v0.3.0     # npm: npm i -D …
   ```
3. **Run the game's full check.** The linked tools have changed; fix anything the changelog said
   would break.
4. **Bring the runtime copies along.** Copies never change by themselves:
   ```sh
   pnpm exec umm-dev drift
   ```

   | drift says | What it means | What to do |
   |---|---|---|
   | `current` | Nothing to do. | Nothing. |
   | `changed upstream` | The kit changed the file; your copy is untouched. | `umm-dev copy <runtime path>` (with the same `--to` as before) updates it in place. |
   | `changed here` | You changed the copy; the kit did not. | Nothing. |
   | `changed here and upstream` | Both changed. | See below. |
   | `no longer shipped` | The kit removed or renamed the file. | Read the changelog. The copy is yours now: keep it or replace it. |

   **When both changed:**
   1. Run `umm-dev drift --diff` to see the two changes side by side.
   2. Take the new version with `umm-dev copy <runtime path> --to <your path> --force`.
   3. Re-apply your own change by hand.

   Drift then reads `changed here` against the new version, which is the truth.
5. **Run the full check again, and commit** the pin, the lockfile and the copies together.

## Finding the original of a copy

`drift --diff` needs the version a copy was taken from. It fetches that from the public repo, at
the tag in the copy's header.

**Offline:** point `UMM_DEV_REPO` at a local clone of this repo, and drift reads the tag from
there instead. With neither available, it compares the copy with the installed file, and says so.
