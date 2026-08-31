#!/usr/bin/env node
/**
 * Builds `public/models/<slug>.manifest.json` and `public/models/index.json` from the
 * bundled MPD files in `public/models/`.
 *
 * Makes no network requests: parsing an MPD is pure text processing
 * (`src/features/omr/parseMpd.ts`), so the unique part list and brick count a model
 * needs are knowable without resolving a single part. That is the whole point of
 * shipping a manifest per `docs/PREBAKE.md` — it turns opening a model from a serial
 * discovery chain into one parallel prefetch, and this script is what produces it.
 *
 * Usage: node tools/build-model-manifests.ts
 */

import fsp from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'

import { parseMpd } from '../src/features/omr/parseMpd.ts'
import type { BundledModelEntry } from '../src/features/omr/types.ts'
import type { ModelManifest } from '../src/ldraw/types.ts'

const MODELS_DIR = path.resolve('public/models')

/**
 * Curated display names for the bundled corpus. The `.mpd` filename is derived from
 * the LDraw Official Model Repository's own naming; the pretty name shown in the
 * picker is a product decision, same as the chest catalog's curated categories.
 */
const DISPLAY_NAMES: Readonly<Record<string, string>> = {
  '10156-lego-truck': 'LEGO Truck (10156)',
  '1713-shipwrecked-pirate': 'Shipwrecked Pirate (1713)',
  '928-galaxy-explorer': 'Galaxy Explorer (928)',
  '21109-exo-suit': 'Exo Suit (21109)',
  '21309-nasa-apollo-saturn-v': 'NASA Apollo Saturn V (21309)',
}

async function main(): Promise<void> {
  const entries = await fsp.readdir(MODELS_DIR)
  const mpdFiles = entries.filter((f) => f.toLowerCase().endsWith('.mpd')).sort()
  if (mpdFiles.length === 0) {
    throw new Error(`build-model-manifests: no .mpd files found under ${MODELS_DIR}`)
  }

  const index: BundledModelEntry[] = []

  for (const file of mpdFiles) {
    const slug = file.replace(/\.mpd$/i, '')
    const fullPath = path.join(MODELS_DIR, file)
    const [text, stat] = await Promise.all([fsp.readFile(fullPath, 'utf8'), fsp.stat(fullPath)])

    const name = DISPLAY_NAMES[slug] ?? slug
    const parsed = parseMpd(text, name)

    const manifest: ModelManifest = {
      name,
      partIds: parsed.uniquePartIds,
      brickCount: parsed.refs.length,
    }
    const manifestFile = `${slug}.manifest.json`
    await fsp.writeFile(path.join(MODELS_DIR, manifestFile), `${JSON.stringify(manifest, null, 2)}\n`)

    index.push({
      slug,
      name,
      mpdFile: file,
      manifestFile,
      brickCount: parsed.refs.length,
      uniquePartCount: parsed.uniquePartIds.length,
      sizeBytes: stat.size,
      submodelCount: parsed.submodelCount,
      stepCount: parsed.stepBreaks.length,
    })

    console.log(
      `${slug}: ${parsed.refs.length} bricks, ${parsed.uniquePartIds.length} unique parts, ` +
        `${parsed.submodelCount} submodels, ${parsed.stepBreaks.length} steps, ${stat.size} bytes`,
    )
  }

  index.sort((a, b) => a.brickCount - b.brickCount)
  await fsp.writeFile(path.join(MODELS_DIR, 'index.json'), `${JSON.stringify(index, null, 2)}\n`)
  console.log(`\nWrote index.json with ${index.length} models.`)
}

main().catch((err: unknown) => {
  console.error(err)
  process.exitCode = 1
})
