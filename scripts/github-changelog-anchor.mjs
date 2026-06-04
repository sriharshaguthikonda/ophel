#!/usr/bin/env node

import fs from "node:fs"

const [fileName, versionInput] = process.argv.slice(2)

if (!fileName || !versionInput) {
  console.error("Usage: node scripts/github-changelog-anchor.mjs <changelog-file> <version>")
  process.exit(1)
}

const version = versionInput.startsWith("v") ? versionInput.slice(1) : versionInput
const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
const content = fs.readFileSync(fileName, "utf8")
const heading = content.match(new RegExp(`^## \\[${escapedVersion}\\](?:[^\\n]*)?$`, "m"))?.[0]

if (!heading) {
  console.error(`Missing changelog heading for ${version} in ${fileName}`)
  process.exit(1)
}

console.log(createGithubHeadingAnchor(heading))

function createGithubHeadingAnchor(heading) {
  const headingText = heading
    .replace(/^#+\s+/u, "")
    .replace(/\[([^\]]+)\](?:\[[^\]]*\]|\([^)]+\))?/gu, "$1")
    .trim()

  return headingText
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/gu, "-")
}
