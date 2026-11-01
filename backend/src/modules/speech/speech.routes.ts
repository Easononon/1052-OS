import { Router } from 'express'
import multer from 'multer'
import { httpError } from '../../http-error.js'
import { synthesizeEdgeTts, transcribeSpeech } from './speech.service.js'

export const speechRouter: Router = Router()

const speechUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
})

speechRouter.post('/asr', speechUpload.single('audio'), async (req, res, next) => {
  try {
    if (!req.file) throw httpError(400, 'audio 必填')
    const text = await transcribeSpeech({
      audio: req.file.buffer,
      mimeType: req.file.mimetype,
      fileName: req.file.originalname,
    })
    res.json({ text })
  } catch (error) {
    next(error)
  }
})

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
