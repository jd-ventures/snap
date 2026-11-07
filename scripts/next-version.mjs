// Works out the next store version from the commits since the last release
// tag (v<version>), by Conventional Commits:
//   feat: …                         → minor (0.3.0 → 0.4.0)
//   fix: … / perf: …                → patch (0.3.0 → 0.3.1)
//   feat!: … / BREAKING CHANGE: …   → major (0.3.0 → 1.0.0)
// Anything else (chore, docs, ci, refactor, test, style, build) ships nothing.
//
//   node scripts/next-version.mjs   → prints the next version, or nothing
//
// The deploy workflow uses the printed version; empty output means there is
// nothing to release.
import { execSync } from 'node:child_process'

const git = (cmd) => execSync(`git ${cmd}`, { encoding: 'utf8' }).trim()

let last
try {
  last = git(`describe --tags --abbrev=0 --match "v[0-9]*"`)
} catch {
  throw new Error('no v<version> tag to count from; tag the live version first (git tag v0.3.0 && git push --tags)')
}

const SEP = '\u001e'
const log = git(`log ${last}..HEAD --format=%B${SEP}`)
const commits = log.split(SEP).map((c) => c.trim()).filter(Boolean)

const RANK = { none: 0, patch: 1, minor: 2, major: 3 }
let bump = 'none'
for (const message of commits) {
  const subject = message.split('\n')[0]
  const head = /^(\w+)(\([^)]*\))?(!)?:/.exec(subject)
  let level = 'none'
  if (head?.[3] || /^BREAKING[ -]CHANGE:/m.test(message)) level = 'major'
  else if (head?.[1] === 'feat') level = 'minor'
  else if (head?.[1] === 'fix' || head?.[1] === 'perf') level = 'patch'
  if (RANK[level] > RANK[bump]) bump = level
}

if (bump !== 'none') {
  const [major, minor, patch] = last.slice(1).split('.').map(Number)
  const next =
    bump === 'major' ? [major + 1, 0, 0] :
    bump === 'minor' ? [major, minor + 1, 0] :
    [major, minor, (patch ?? 0) + 1]
  console.log(next.join('.'))
}
