import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { z } from 'zod';

const EntrySchema = z.object({ id: z.string(), kind: z.enum(['historical', 'reason', 'map', 'voice']), at: z.string(), reservedUSD: z.number().finite().nonnegative(), actualUSD: z.number().finite().nonnegative().nullable(), state: z.enum(['held', 'released', 'reconciled']), note: z.string(), voiceLeaseUntil: z.number().nonnegative().optional(), knownWithinHoldUSD: z.number().finite().nonnegative().optional() }).strict().refine(entry => (entry.knownWithinHoldUSD || 0) <= entry.reservedUSD, 'Known charge cannot exceed the retained hold.');
const LedgerSchema = z.object({ version: z.literal(1), approvedCapUSD: z.number().finite().nonnegative(), liveRequests: z.number().int().nonnegative(), entries: z.array(EntrySchema), capChanges: z.array(z.object({ at: z.string(), fromUSD: z.number(), toUSD: z.number() }).strict()) }).strict();
type Ledger = z.infer<typeof LedgerSchema>;
export type BudgetSnapshot = { approvedCapUSD: number; committedUSD: number; knownActualUSD: number; unknownHeldUSD: number; remainingUSD: number; liveRequests: number };
const money = (amount: number) => Math.round(amount * 1_000_000) / 1_000_000;

/** One process and one persistent disk. Never reset a corrupt/missing previously configured disk to gain credit. */
export class BudgetLedger {
  private data?: Ledger;
  private queue: Promise<unknown> = Promise.resolve();
  constructor(private readonly path: string, private readonly cap: () => number, private readonly initialHeldUSD = 1.8, private readonly knownHistoricalUSD = 0.031261, private readonly allowInitialize = false) {}

  private async save() {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${crypto.randomUUID()}.tmp`;
    await writeFile(temporary, JSON.stringify(this.data, null, 2) + '\n', { mode: 0o600 });
    await rename(temporary, this.path);
  }
  private async load() {
    if (!this.data) {
      try { this.data = LedgerSchema.parse(JSON.parse(await readFile(this.path, 'utf8'))); }
      catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw new Error('Budget ledger cannot be verified. Live use is blocked; preserve and reconcile the private ledger.');
        if (!this.allowInitialize) throw new Error('Persistent budget ledger is missing. Live use is blocked; restore it or deliberately initialize a new deployment with the preserved historical hold.');
        const at = new Date().toISOString();
        const known = Math.min(this.initialHeldUSD, this.knownHistoricalUSD);
        this.data = { version: 1, approvedCapUSD: this.cap(), liveRequests: 0, capChanges: [], entries: [
          { id: 'historical-known-agent', kind: 'historical', at, reservedUSD: known, actualUSD: known, state: 'reconciled', note: 'Historical synthetic Agent charges verified before this migration, rounded upward to microdollars. This is a reconciled portion of the retained total hold.' },
          { id: 'historical-unresolved', kind: 'historical', at, reservedUSD: money(this.initialHeldUSD - known), actualUSD: null, state: 'held', note: 'Preserves US$1.80 cumulative used/held from prior approved smoke tests. Claude and Scribe charges remain unknown. Prior request count unknown; new persistent request counter begins here.' }
        ] };
        await this.save();
      }
    }
    const cap = this.cap();
    if (!Number.isFinite(cap) || cap <= 0) throw new Error('A positive approved total budget cap is required.');
    if (cap !== this.data.approvedCapUSD) {
      this.data.capChanges.push({ at: new Date().toISOString(), fromUSD: this.data.approvedCapUSD, toUSD: cap });
      this.data.approvedCapUSD = cap; await this.save();
    }
    return this.data;
  }
  private serial<T>(work: () => Promise<T>): Promise<T> {
    // ponytail: a single-process queue; use transactional storage before adding another server instance.
    const next = this.queue.then(work, work); this.queue = next.catch(() => {}); return next;
  }
  private summarize(data: Ledger): BudgetSnapshot {
    const knownActualUSD = money(data.entries.reduce((sum, entry) => sum + (entry.state === 'reconciled' ? entry.actualUSD || 0 : entry.state === 'held' ? entry.knownWithinHoldUSD || 0 : 0), 0));
    const unknownHeldUSD = money(data.entries.reduce((sum, entry) => sum + (entry.state === 'held' ? entry.reservedUSD - (entry.knownWithinHoldUSD || 0) : 0), 0));
    const committedUSD = money(knownActualUSD + unknownHeldUSD);
    return { approvedCapUSD: data.approvedCapUSD, committedUSD, knownActualUSD, unknownHeldUSD, remainingUSD: Math.max(0, money(data.approvedCapUSD - committedUSD)), liveRequests: data.liveRequests };
  }
  snapshot() { return this.serial(async () => this.summarize(await this.load())); }
  reserve(kind: 'reason' | 'map' | 'voice', amountUSD: number, maxRequests: number, voiceSeconds = 120, maxVoiceConcurrency = 1) {
    return this.serial(async () => {
      const data = await this.load(); const snapshot = this.summarize(data);
      if (data.liveRequests >= maxRequests || money(snapshot.committedUSD + amountUSD) > data.approvedCapUSD) throw new Error('Approved cumulative live usage bound reached. Reconcile provider charges or obtain additional approval; restarting cannot reset it.');
      if (kind === 'voice' && data.entries.filter(entry => entry.kind === 'voice' && entry.state === 'held' && (entry.voiceLeaseUntil || 0) > Date.now()).length >= maxVoiceConcurrency) throw new Error('A bounded voice reservation is already active. Stop its session or wait for the bound before reconnecting.');
      const id = crypto.randomUUID(); data.liveRequests++;
      data.entries.push({ id, kind, at: new Date().toISOString(), reservedUSD: amountUSD, actualUSD: null, state: 'held', note: 'Conservative reservation; actual provider charges remain unknown until reconciled.', ...(kind === 'voice' ? { voiceLeaseUntil: Date.now() + Math.min(120, voiceSeconds) * 1000 } : {}) });
      await this.save(); return id;
    });
  }
  release(id: string) {
    return this.serial(async () => { const data = await this.load(); const entry = data.entries.find(item => item.id === id); if (!entry || entry.state !== 'held') throw new Error('Unknown or completed budget reservation.'); entry.state = 'released'; entry.note = 'Credential minting failed before a client relay session became available; no paid audio connection could start. Request count remains consumed.'; await this.save(); });
  }
  stopVoice(id: string) {
    return this.serial(async () => { const data = await this.load(); const entry = data.entries.find(item => item.id === id && item.kind === 'voice'); if (!entry) throw new Error('Unknown voice reservation.'); entry.voiceLeaseUntil = 0; await this.save(); });
  }
  reconcile(id: string, actualUSD: number, note: string) {
    return this.serial(async () => { const data = await this.load(); const entry = data.entries.find(item => item.id === id); if (!entry || entry.state !== 'held' || !Number.isFinite(actualUSD) || actualUSD < 0 || !note.trim()) throw new Error('A retained reservation, verified non-negative provider cost and reconciliation note are required.'); entry.actualUSD = money(actualUSD); entry.state = 'reconciled'; entry.note = note; await this.save(); });
  }
  recordKnownWithinHold(id: string, knownUSD: number, note: string) {
    return this.serial(async () => { const data = await this.load(); const entry = data.entries.find(item => item.id === id && item.state === 'held'); if (!entry || !Number.isFinite(knownUSD) || knownUSD < (entry.knownWithinHoldUSD || 0) || knownUSD > entry.reservedUSD || !note.trim()) throw new Error('A verified known portion and retained unresolved hold are required.'); entry.knownWithinHoldUSD = money(knownUSD); entry.note += `\n${new Date().toISOString()}: ${note} Total hold remains unchanged.`; await this.save(); });
  }
}
