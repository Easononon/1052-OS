import { Router } from 'express'
import { httpError } from '../../http-error.js'
import { synthesizeEdgeTts } from './speech.service.js'

export const speechRouter: Router = Router()

speechRouter.post('/tts', async (req, res, next) => {
  try {
    const body = req.body ?? {}
    const text = typeof body.text === 'string' ? body.text : ''
    if (!text.trim()) throw httpError(400, 'text 必填')

    const audio = await synthesizeEdgeTts({
      text,
      voice: typeof body.voice === 'string' ? body.voice : undefined,
      rate: typeof body.rate === 'number' ? body.rate : undefined,
      pitch: typeof body.pitch === 'number' ? body.pitch : undefined,
    })

    res.setHeader('Content-Type', 'audio/mpeg')
    res.setHeader('Cache-Control', 'no-store')
    res.send(audio)
  } catch (error) {
    next(error)
  }
})
