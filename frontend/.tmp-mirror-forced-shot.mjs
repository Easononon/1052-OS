import { chromium } from 'playwright'

const base = 'http://localhost:10052'

async function capture(name, { popover = false } = {}) {
  const browser = await chromium.launch({ headless: true })
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await ctx.newPage()

  await page.route('**/api/appearance/themes', async (route) => {
    const res = await route.fetch()
    const data = await res.json()
    const mirror = data.profiles?.find((p) => p.id === 'builtin:mirror-dark')
    if (mirror) {
      data.activeProfileId = mirror.id
      data.activeProfile = mirror
    }
    await route.fulfill({
      status: res.status(),
      headers: { ...res.headers(), 'content-type': 'application/json' },
      body: JSON.stringify(data),
    })
  })

  await page.addInitScript(() => {
    try {
      sessionStorage.setItem('mirror_pour_seen', '1')
      localStorage.setItem('1052os.onboarding.completed', 'true')
    } catch {}
  })

  await page.goto(`${base}/chat`, { waitUntil: 'domcontentloaded' })
  await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined)
  await page.waitForTimeout(1500)

  if (popover) {
    await page.locator('.modal-backdrop').evaluate((el) => el.remove()).catch(() => undefined)
    await page.locator('.mr-model-trigger').click({ timeout: 5000 })
    await page.waitForTimeout(300)
  }

  const info = await page.evaluate(() => ({
    baseProfile: document.documentElement.dataset.baseProfile,
    theme: document.documentElement.dataset.theme,
    title: document.querySelector('.mr-page-title, h1')?.textContent,
    workbar: document.querySelectorAll('.mr-workbar').length,
    modelSelector: document.querySelectorAll('.mr-model-selector').length,
    popover: document.querySelectorAll('.mr-model-popover').length,
  }))
  console.log(`[${name}] ${JSON.stringify(info)}`)
  await page.screenshot({ path: `/tmp/${name}.png`, fullPage: false })
  console.log(`saved /tmp/${name}.png`)
  await browser.close()
}

await capture('mirror-chat-dark')
await capture('mirror-chat-model-popover', { popover: true })
