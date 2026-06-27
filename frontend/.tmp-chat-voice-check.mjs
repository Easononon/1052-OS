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
  const composer = document.querySelector('.composer')?.getBoundingClientRect()
  const mic = Array.from(document.querySelectorAll('.composer .icon-btn')).find((button) => button.getAttribute('title') === '语音输入')?.getBoundingClientRect()
  const user = document.querySelector('.msg.user')?.getBoundingClientRect()
  const body = document.querySelector('.msg.user .msg-body')?.getBoundingClientRect()
  const chat = document.querySelector('.chat-inner')?.getBoundingClientRect()
  return {
    composer: composer && { left: Math.round(composer.left), right: Math.round(composer.right), width: Math.round(composer.width) },
    mic: mic && { left: Math.round(mic.left), right: Math.round(mic.right) },
    user: user && { left: Math.round(user.left), right: Math.round(user.right), width: Math.round(user.width) },
    userBody: body && { left: Math.round(body.left), right: Math.round(body.right), width: Math.round(body.width) },
    chat: chat && { left: Math.round(chat.left), right: Math.round(chat.right), width: Math.round(chat.width) },
  }
})
console.log(JSON.stringify(info, null, 2))
await page.screenshot({ path: '/tmp/1052-chat-voice-restored.png', fullPage: false })
await browser.close()
