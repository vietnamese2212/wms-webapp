// Shared AudioContext – must be created/resumed inside a user-gesture handler.
// Call unlockAudio() on button click, then playBeep() anytime after.
let sharedCtx: AudioContext | null = null

export function unlockAudio() {
  try {
    if (!sharedCtx) sharedCtx = new AudioContext()
    if (sharedCtx.state === 'suspended') sharedCtx.resume()
  } catch {}
}

export function playBeep(frequency = 880, duration = 0.12) {
  try {
    const ctx = sharedCtx ?? new AudioContext()
    const osc  = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.type = 'sine'
    osc.frequency.value = frequency
    gain.gain.setValueAtTime(0.5, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration)
    osc.start(ctx.currentTime)
    osc.stop(ctx.currentTime + duration)
  } catch {}
}
