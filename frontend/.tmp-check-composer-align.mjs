import { chromium } from 'playwright'

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 2048, height: 1152 }, deviceScaleFactor: 1 })
const page = await ctx.newPage()

await page.addInitScript(() => {
  try {
    sessionStorage.setItem('mirror_pour_seen', '1')
    localStorage.setItem('1052os.onboarding.completed', 'true')
    localStorage.setItem('agent.sidebar.collapsed', 'true')
  } catch {}
})

await page.goto('http://localhost:10052/chat', { waitUntil: 'domcontentloaded' })
await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined)
await page.waitForTimeout(800)

const measure = await page.evaluate(() => {
  const doc = document.querySelector('.mr-chat-doc')?.getBoundingClientRect()
  const composer = document.querySelector('.mr-composer-wrap')?.getBoundingClientRect()
  const sidebar = document.querySelector('.mr-sidebar')?.getBoundingClientRect()
  const side = document.querySelector('.mr-chat-side')?.getBoundingClientRect()
  return {
    doc: doc && { left: doc.left, right: doc.right, center: doc.left + doc.width / 2, width: doc.width },
    composer: composer && { left: composer.left, right: composer.right, center: composer.left + composer.width / 2, width: composer.width },
    sidebar: sidebar && { left: sidebar.left, right: sidebar.right, width: sidebar.width, collapsed: document.querySelector('.mr-sidebar')?.classList.contains('is-collapsed') },
    side: side && { left: side.left, right: side.right, width: side.width, display: getComputedStyle(document.querySelector('.mr-chat-side')).display },
  }
})

console.log(JSON.stringify(measure, null, 2))
await page.screenshot({ path: '/tmp/1052-chat-composer-aligned.png', fullPage: false })
await browser.close()
