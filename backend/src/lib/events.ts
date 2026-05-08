import { EventEmitter } from 'events'

export const inboundEmitter = new EventEmitter()

export function emitInboundChanged(): void {
  inboundEmitter.emit('changed')
}
