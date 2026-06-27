import { chromium } from 'playwright'

const browser = await chromium.launch({ headless: true })
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1 })
const page = await ctx.newPage()

await page.addInitScript(() => {
  try {
    localStorage.setItem('1052os.onboarding.completed', 'true')
    sessionStorage.setItem('mirror_pour_seen', '1')
  } catch {}
})

await page.route('**/api/agent/history', async (route) => {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      messages: [
        { id: 1, role: 'assistant', content: '你好，我是 Agent。', ts: Date.now() - 60_000 },
        { id: 2, role: 'user', content: '测试用户消息在右侧。', ts: Date.now() - 30_000 },
      ],
    }),
  })
})

await page.goto('http://localhost:10052/chat', { waitUntil: 'domcontentloaded' })
await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined)
await page.waitForTimeout(800)

const info = await page.evaluate(() => {
  const composer = document.querySelector('.mr-composer')?.getBoundingClientRect()
  const mic = Array.from(document.querySelectorAll('.mr-composer .mr-composer-attach')).find((button) => button.getAttribute('aria-label') === '语音输入')?.getBoundingClientRect()
  const user = document.querySelector('.mr-chat-msg.is-user')?.getBoundingClientRect()
  const bubble = document.querySelector('.mr-chat-user-content')?.getBoundingClientRect()
  const doc = document.querySelector('.mr-chat-doc')?.getBoundingClientRect()
  return {
    baseProfile: document.documentElement.dataset.baseProfile,
    composer: composer && { left: Math.round(composer.left), right: Math.round(composer.right), width: Math.round(composer.width) },
    mic: mic && { left: Math.round(mic.left), right: Math.round(mic.right) },
    user: user && { left: Math.round(user.left), right: Math.round(user.right), width: Math.round(user.width) },
    bubble: bubble && { left: Math.round(bubble.left), right: Math.round(bubble.right), width: Math.round(bubble.width) },
    doc: doc && { left: Math.round(doc.left), right: Math.round(doc.right), width: Math.round(doc.width) },
    rightGap: doc && bubble ? Math.round(doc.right - bubble.right) : null,
  }
})
console.log(JSON.stringify(info, null, 2))
await page.screenshot({ path: '/tmp/1052-mirror-chat-voice-restored.png', fullPage: false })
await browser.close()
