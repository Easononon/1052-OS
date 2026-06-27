// Mirror-profile chat screenshot with seeded tool-call data so the
// WorkBar can be exercised. Renders both dark and light.
import { chromium } from 'playwright'

async function seedToolCalls(page) {
  // Inject three sample tool calls so the WorkBar shows real rows.
  await page.evaluate(() => {
    const evt = new CustomEvent('mr-seed-tool-calls', { detail: 'sentinel' })
    window.dispatchEvent(evt)
  })
}

async function capture(theme) {
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()

  await page.addInitScript((t) => {
    try {
      localStorage.setItem('appearance:activeProfileId', 'builtin:mirror-dark')
      sessionStorage.setItem('mirror_pour_seen', '1')
    } catch {}
    document.documentElement.setAttribute('data-theme', t)
    document.documentElement.setAttribute('data-base-profile', 'mirror')
  }, theme)

  await page.goto('http://localhost:10052/chat', { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined)
  await page.waitForTimeout(1500)

  const url = page.url()
  const wb = await page.locator('.mr-workbar').count()
  const ms = await page.locator('.mr-model-selector').count()
  console.log(`[${theme}] url=${url} workbar=${wb} modelSelector=${ms}`)

  await page.screenshot({ path: `/tmp/mirror-${theme}.png`, fullPage: false })
  console.log(`saved /tmp/mirror-${theme}.png`)
  await browser.close()
}

await capture('dark')
await capture('light')