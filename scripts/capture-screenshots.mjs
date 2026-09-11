// Captures screenshots of every dashboard page plus a hero video tour.
// Run with: BIRDCURVE_DASHBOARD_URL=http://localhost:5173 npx playwright capture-screenshots.mjs
//   (or just: node scripts/capture-screenshots.mjs)
//
// Output: docs/screenshots/page-<name>.png + docs/screenshots/hero-tour.webm

import { chromium } from 'playwright'
import { mkdirSync, existsSync, renameSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')
const OUT_DIR = resolve(REPO_ROOT, 'docs/screenshots')
const BASE_URL = process.env.BIRDCURVE_DASHBOARD_URL || 'http://localhost:5173'

// Wide-but-not-huge viewport — crisp at 2x deviceScaleFactor on retina.
const VIEWPORT = { width: 1600, height: 900 }
const PAGES = [
  { slug: 'commodities', path: '/commodities' },
  { slug: 'electricity', path: '/electricity' },
  { slug: 'forecast', path: '/forecast' },
  { slug: 'ml', path: '/ml' },
  { slug: 'ancillary', path: '/ancillary' },
  { slug: 'scenarios', path: '/scenarios' },
]

mkdirSync(OUT_DIR, { recursive: true })

// Wait for charts (ECharts + TradingView lightweight-charts) to finish drawing.
// TanStack Query resolves on networkidle, but chart libraries animate after.
async function settle(page) {
  await page.waitForLoadState('networkidle', { timeout: 15000 }).catch(() => {})
  // Belt-and-suspenders pause for chart animations. Chart libs don't expose
  // a single "rendered" event, so a fixed wait is the pragmatic choice.
  await page.waitForTimeout(1500)
}

async function captureScreenshots(browser) {
  // No-video context — screenshots only, fastest path.
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
  })
  const page = await ctx.newPage()

  // Prime the Zustand store: /forecast mounts ScenarioSelector, which auto-
  // picks the first scenario as soon as /api/scenarios/list resolves.
  // Three pages (Forecast, Ancillary, Scenarios) render an empty placeholder
  // until scenario != ''.
  console.log('Priming scenario store via /forecast …')
  await page.goto(`${BASE_URL}/forecast`)
  await settle(page)

  for (const { slug, path } of PAGES) {
    process.stdout.write(`  → ${slug.padEnd(12)} `)
    await page.goto(`${BASE_URL}${path}`)
    await settle(page)
    const out = resolve(OUT_DIR, `page-${slug}.png`)
    await page.screenshot({ path: out, fullPage: false })
    console.log(`saved ${out.replace(REPO_ROOT + '/', '')}`)
  }

  await ctx.close()
}

async function recordTour(browser) {
  // Fresh context with video — only the tour, nothing else.
  // Lower deviceScaleFactor=1 keeps the recorded video small (and the GIF tiny).
  const ctx = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    recordVideo: { dir: OUT_DIR, size: { width: 1280, height: 720 } },
  })
  const page = await ctx.newPage()

  console.log('Priming scenario store …')
  await page.goto(`${BASE_URL}/forecast`)
  await settle(page)

  console.log('Recording hero tour …')
  for (const { slug, path } of PAGES) {
    await page.goto(`${BASE_URL}${path}`)
    // Tighter cadence than screenshot pass — the GIF should feel snappy.
    await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => {})
    await page.waitForTimeout(900)
    process.stdout.write(`    visited ${slug}\n`)
  }

  await page.close()
  const videoPath = await page.video()?.path()
  await ctx.close()

  if (videoPath && existsSync(videoPath)) {
    const target = resolve(OUT_DIR, 'hero-tour.webm')
    renameSync(videoPath, target)
    console.log(`Hero video saved to ${target.replace(REPO_ROOT + '/', '')}`)
  } else {
    console.warn('No video was produced.')
  }
}

async function main() {
  console.log(`Launching Chromium against ${BASE_URL}`)
  const browser = await chromium.launch()
  await captureScreenshots(browser)
  await recordTour(browser)
  await browser.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
