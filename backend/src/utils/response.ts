import { Response } from 'express'

export const ok = (res: Response, data: unknown, meta?: unknown) =>
  res.json({ success: true, data, ...(meta ? { meta } : {}) })

export const fail = (res: Response, status: number, code: string, message: string) =>
  res.status(status).json({ success: false, error: { code, message } })
