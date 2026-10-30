// One command to a store-ready package:
//   npm run release            → release/snap-<version>.zip from the current version
//   npm run release -- 0.4.0   → sets that version in both manifests first
// Builds, runs the smoke test if CHROMIUM is set, and zips the CONTENTS of
// dist/ (the store refuses a zip with a wrapping folder).
import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const next = process.argv[2]
const bump = (file) => {
  const json = JSON.parse(readFileSync(file, 'utf8'))
  if (next) json.version = next
  writeFileSync(file, JSON.stringify(json, null, 2) + '\n')
  return json.version
}
const version = bump('public/manifest.json')
const pkgVersion = bump('package.json')
if (version !== pkgVersion)
  throw new Error(`manifest ${version} ≠ package.json ${pkgVersion}; pass a version to set both`)
if (!/^\d+(\.\d+){1,3}$/.test(version))
  throw new Error(`store versions are 1–4 dot-separated integers, got ${version}`)

const run = (cmd) => execSync(cmd, { stdio: 'inherit' })
if (!existsSync('public/icons/128.png')) run('npm run icons')
run('npm run build')
if (process.env.CHROMIUM) run('npm run smoke')
else console.log('CHROMIUM not set; skipping the smoke test')

mkdirSync('release', { recursive: true })
const out = `release/snap-${version}.zip`
run(`rm -f ${out} && cd dist && zip -qr ../${out} .`)
console.log(`\n${out} — upload this at https://chrome.google.com/webstore/devconsole`)
