// DB GIẢ trong bộ nhớ cho test cửa nạp Excel (20/11) — đủ cho các chuỗi PostgREST mà controller upload dùng:
// select/order/in/eq/neq/is/range/limit/maybeSingle/single (đọc), insert/upsert/update/delete (ghi), rpc (tuỳ handler).
// Mục đích: chạy CHÍNH controller với file Excel thật rồi soi bảng sau khi ghi — bắt lỗi "ô trống ghi đè giá trị cũ",
// lệnh ghi lọt trước điểm preflight… mà test helper thuần không chạm tới. Không mô phỏng ràng buộc/trigger của Postgres.
type Row = Record<string, unknown>
type Filter = (r: Row) => boolean

export interface FakeDb {
  tables: Record<string, Row[]>
  writes: { table: string; op: string; rows: Row[] }[]
  rpcs: { name: string; args: unknown }[]
  rpcHandler?: (name: string, args: Record<string, unknown>) => unknown
  from(table: string): Builder
  rpc(name: string, args?: Record<string, unknown>): Promise<{ data: unknown; error: null }>
}

class Builder implements PromiseLike<{ data: unknown; error: null; count?: number }> {
  private filters: Filter[] = []
  private op: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select'
  private payload: Row[] = []
  private patch: Row = {}
  private conflict = 'id'
  private from_ = 0
  private to_ = Infinity
  private single_: 'one' | 'maybe' | null = null
  private wantRows = false
  constructor(private db: FakeDb, private table: string) {}
  private rows() { return (this.db.tables[this.table] ??= []) }
  select(_cols?: string, _o?: unknown) { if (this.op !== 'select') this.wantRows = true; return this }
  order() { return this }
  limit(n: number) { this.to_ = this.from_ + n - 1; return this }
  range(a: number, b: number) { this.from_ = a; this.to_ = b; return this }
  eq(c: string, v: unknown) { this.filters.push(r => r[c] === v); return this }
  neq(c: string, v: unknown) { this.filters.push(r => r[c] !== v); return this }
  is(c: string, v: unknown) { this.filters.push(r => (r[c] ?? null) === v); return this }
  in(c: string, vs: unknown[]) { const s = new Set(vs); this.filters.push(r => s.has(r[c])); return this }
  not(c: string, op: string, v: unknown) {
    this.filters.push(r => (op === 'is' ? (r[c] ?? null) !== v : r[c] !== v)); return this
  }
  ilike(c: string, v: string) { const re = new RegExp('^' + v.replace(/%/g, '.*') + '$', 'i'); this.filters.push(r => re.test(String(r[c] ?? ''))); return this }
  maybeSingle() { this.single_ = 'maybe'; return this }
  single() { this.single_ = 'one'; return this }
  insert(rows: Row | Row[]) { this.op = 'insert'; this.payload = Array.isArray(rows) ? rows : [rows]; return this }
  upsert(rows: Row | Row[], o?: { onConflict?: string }) { this.op = 'upsert'; this.payload = Array.isArray(rows) ? rows : [rows]; this.conflict = o?.onConflict ?? 'id'; return this }
  update(p: Row) { this.op = 'update'; this.patch = p; return this }
  delete() { this.op = 'delete'; return this }
  private match(r: Row) { return this.filters.every(f => f(r)) }
  private run(): { data: unknown; error: null; count?: number } {
    const t = this.rows()
    let out: Row[] = []
    if (this.op === 'select') out = t.filter(r => this.match(r)).slice(this.from_, this.to_ + 1)
    else if (this.op === 'insert') { for (const r of this.payload) t.push({ ...r }); out = this.payload }
    else if (this.op === 'upsert') {
      const keys = this.conflict.split(',').map(s => s.trim())
      for (const r of this.payload) {
        const i = t.findIndex(x => keys.every(k => x[k] === r[k]))
        if (i >= 0) t[i] = { ...t[i], ...r }; else t.push({ ...r })
      }
      out = this.payload
    } else if (this.op === 'update') {
      for (let i = 0; i < t.length; i++) if (this.match(t[i])) { t[i] = { ...t[i], ...this.patch }; out.push(t[i]) }
    } else if (this.op === 'delete') {
      out = t.filter(r => this.match(r)); this.db.tables[this.table] = t.filter(r => !this.match(r))
    }
    if (this.op !== 'select') this.db.writes.push({ table: this.table, op: this.op, rows: out.map(r => ({ ...r })) })
    const data = this.single_ ? (out[0] ?? null) : (this.op === 'select' || this.wantRows ? out : null)
    return { data, error: null, count: out.length }
  }
  then<A = { data: unknown; error: null }, B = never>(ok?: ((v: { data: unknown; error: null; count?: number }) => A | PromiseLike<A>) | null, ko?: ((e: unknown) => B | PromiseLike<B>) | null): PromiseLike<A | B> {
    return Promise.resolve().then(() => this.run()).then(ok, ko)
  }
}

export function fakeDb(tables: Record<string, Row[]> = {}): FakeDb {
  const db: FakeDb = {
    tables, writes: [], rpcs: [],
    from(table: string) { return new Builder(db, table) },
    async rpc(name: string, args: Record<string, unknown> = {}) {
      db.rpcs.push({ name, args })
      return { data: db.rpcHandler ? db.rpcHandler(name, args) : null, error: null }
    },
  }
  return db
}

/** req/res giả cho controller Express: res.body = thân JSON đã trả, res.statusCode. */
export function fakeReqRes(req: Record<string, unknown>) {
  const res = {
    statusCode: 200, body: undefined as unknown,
    status(c: number) { this.statusCode = c; return this },
    json(b: unknown) { this.body = b; return this },
    setHeader() { return this },
  }
  return { req: { query: {}, body: {}, params: {}, headers: {}, ...req } as never, res: res as typeof res & never }
}
