import { chromium } from 'playwright'

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 })
const page = await ctx.newPage()

await page.addInitScript(() => {
  try {
    sessionStorage.setItem('mirror_pour_seen', '1')
    localStorage.setItem('1052os.onboarding.completed', 'true')
  } catch {}
})

await page.goto('http://localhost:10052/chat', { waitUntil: 'domcontentloaded' })
await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined)
await page.waitForTimeout(800)

const info = await page.evaluate(() => {
  const msg = document.querySelector('.mr-chat-msg.is-user')?.getBoundingClientRect()
  const bubble = document.querySelector('.mr-chat-user-content')?.getBoundingClientRect()
  const doc = document.querySelector('.mr-chat-doc')?.getBoundingClientRect()
  return {
    doc: doc && { left: doc.left, right: doc.right, width: doc.width },
    msg: msg && { left: msg.left, right: msg.right, width: msg.width },
    bubble: bubble && { left: bubble.left, right: bubble.right, width: bubble.width },
    rightGap: doc && bubble ? Math.round(doc.right - bubble.right) : null,
  }
})
console.log(JSON.stringify(info, null, 2))
await page.screenshot({ path: '/tmp/1052-chat-user-right.png', fullPage: false })
await browser.close()
