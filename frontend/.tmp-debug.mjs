import { chromium } from 'playwright'
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage()
await page.goto('http://localhost:10052/chat', { waitUntil: 'domcontentloaded' })
await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined)
await page.waitForTimeout(1500)
const info = await page.evaluate(() => ({
  baseProfile: document.documentElement.dataset.baseProfile,
  theme: document.documentElement.dataset.theme,
  hasShell: !!document.querySelector('.mr-shell, .app'),
  hasWorkbar: !!document.querySelector('.workbar, .mr-workbar'),
  hasChat: !!document.querySelector('.chat, .mr-page'),
  body: document.body.className,
  h1: document.querySelector('h1, .mr-page-title')?.textContent?.slice(0, 60),
}))
console.log(JSON.stringify(info, null, 2))
await browser.close()
