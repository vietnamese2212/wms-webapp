// PRNG có SEED để test ngẫu nhiên tái hiện được (không cài fast-check — giữ dependency tối thiểu).
// Đỏ → log in seed; chạy lại `RNG_SEED=<seed> npm test` để ra đúng chuỗi input đó.
export const SEED = Number(process.env.RNG_SEED ?? 20260911)

export type Rng = {
  next(): number
  int(a: number, b: number): number
  pick<T>(arr: readonly T[]): T
  bool(p?: number): boolean
  str(alphabet: string, min: number, max: number): string
}

export function rng(seed: number = SEED): Rng {
  let s = seed >>> 0
  const r: Rng = {
    next() { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296 },
    int(a, b) { return a + Math.floor(r.next() * (b - a + 1)) },
    pick(arr) { return arr[r.int(0, arr.length - 1)] },
    bool(p = 0.5) { return r.next() < p },
    str(alphabet, min, max) {
      const n = r.int(min, max)
      let out = ''
      for (let i = 0; i < n; i++) out += alphabet[r.int(0, alphabet.length - 1)]
      return out
    },
  }
  return r
}

/** Số lượt lặp mặc định cho test ngẫu nhiên — đủ dày để bắt nhánh hiếm, vẫn chạy dưới 1 giây/file. */
export const N = Number(process.env.RNG_N ?? 3000)
