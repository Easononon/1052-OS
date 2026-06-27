import { describe, expect, it } from 'vitest'
import { prepareSpeechText } from './useVoiceIO'

describe('prepareSpeechText', () => {
  it('removes markdown and noisy blocks for spoken output', () => {
    const text = `# 结论

建议先检查风机联锁。

\`\`\`ts
console.log('skip')
\`\`\`

- 第一步：确认电流
- 第二步：查看报警

工具：读取了 3 个文件
详情见 [文档](https://example.com/doc)`

    expect(prepareSpeechText(text)).toBe(
      '结论。建议先检查风机联锁。第一步：确认电流。第二步：查看报警。详情见 文档',
    )
  })

  it('removes markdown markers even when they are attached to text', () => {
    expect(prepareSpeechText('###故障分析\n**结论**：#1 风机需要检查\n*检查电流')).toBe(
      '故障分析。结论：1 风机需要检查。检查电流',
    )
  })

  it('filters tool process narration and normalizes weather dates', () => {
    const text = `下周天气来了！用天气 API 查石家庄未来预报！
API 查不到未来多天的预报数据，换用搜索查一下石家庄下周的天气预报！
📅 石家庄下周天气预报
2026-06-24（周三）~ 2026-06-29（周一）
📌 下周要点
🔴 周二周三（6/24-25）有降雨，可能影响户外施工/调试安排
☀️ 周四起转晴升温，周末最高 35°C，注意防暑`

    expect(prepareSpeechText(text)).toBe(
      '石家庄下周天气预报。2026年6月24日（周三）~ 2026年6月29日（周一）。下周要点。周二周三（6月24日到25日）有降雨，可能影响户外施工/调试安排。周四起转晴升温，周末最高 35摄氏度，注意防暑',
    )
  })

  it('reads temperature ranges naturally and removes emoji', () => {
    expect(prepareSpeechText('🌤️ 多云 25~31°C\n⛈️ 中雨 24-29°C')).toBe(
      '多云 25到31摄氏度。中雨 24到29摄氏度',
    )
  })

  it('limits long content', () => {
    expect(prepareSpeechText('一'.repeat(1000))).toHaveLength(600)
  })
})
