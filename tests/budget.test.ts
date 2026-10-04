import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BudgetLedger } from '../src/budget';

test('budget holds, refunds, reconciliation and request clamps survive restart without spending unknown history', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'apprentice-budget-')); const path = join(directory, 'ledger.json'); let cap = 3;
  try {
    let ledger = new BudgetLedger(path, () => cap, 1.8, 0.031261, true); const before = await ledger.snapshot(); assert.equal(before.committedUSD, 1.8); assert.equal(before.knownActualUSD, 0.031261); assert.equal(before.unknownHeldUSD, 1.768739); assert.equal(before.remainingUSD, 1.2);
    await ledger.recordKnownWithinHold('historical-unresolved', 0.01, 'Synthetic unit-test verified portion; total hold must remain unchanged.'); assert.equal((await ledger.snapshot()).committedUSD, 1.8); assert.equal((await ledger.snapshot()).knownActualUSD, 0.041261); assert.equal((await ledger.snapshot()).remainingUSD, 1.2);
    const voice = await ledger.reserve('voice', 1, 8); await assert.rejects(ledger.reserve('reason', 0.25, 8), /cumulative live usage bound/);
    await ledger.release(voice); assert.equal((await ledger.snapshot()).committedUSD, 1.8); assert.equal((await ledger.snapshot()).liveRequests, 1);
    const reason = await ledger.reserve('reason', 0.25, 8); ledger = new BudgetLedger(path, () => cap); assert.equal((await ledger.snapshot()).committedUSD, 2.05); assert.equal((await ledger.snapshot()).liveRequests, 2);
    await ledger.reconcile(reason, 0.01, 'Verified provider test charge.'); assert.equal((await ledger.snapshot()).committedUSD, 1.81);
    cap = 10; assert.equal((await ledger.snapshot()).approvedCapUSD, 10); const saved = JSON.parse(await readFile(path, 'utf8')); assert.deepEqual(saved.capChanges.map((entry: { fromUSD: number; toUSD: number }) => [entry.fromUSD, entry.toUSD]), [[3, 10]]); assert.equal(saved.entries.find((entry: { id: string }) => entry.id === 'historical-unresolved').state, 'held');
    for (let i = 0; i < 6; i++) await ledger.reserve('map', 0.25, 8); ledger = new BudgetLedger(path, () => cap); await assert.rejects(ledger.reserve('reason', 0.25, 8), /cumulative live usage bound/); assert.equal((await ledger.snapshot()).liveRequests, 8);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('concurrent reservations and voice leases remain bounded across restart; corrupt or absent hosted ledgers block live use', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'apprentice-budget-')); const path = join(directory, 'ledger.json');
  try {
    let ledger = new BudgetLedger(path, () => 3, 1.8, 0.031261, true); const results = await Promise.allSettled([ledger.reserve('voice', 1, 8), ledger.reserve('voice', 1, 8)]); assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    const first = results.find(result => result.status === 'fulfilled'); assert.ok(first && first.status === 'fulfilled');
    ledger = new BudgetLedger(path, () => 10); await assert.rejects(ledger.reserve('voice', 1, 8), /voice reservation is already active/);
    await ledger.stopVoice(first.value); assert.equal((await ledger.snapshot()).committedUSD, 2.8, 'stopping capture does not invent a provider refund'); await ledger.reserve('voice', 1, 8);
    await writeFile(path, '{broken'); await assert.rejects(new BudgetLedger(path, () => 10).snapshot(), /cannot be verified/);
    await assert.rejects(new BudgetLedger(join(directory, 'missing.json'), () => 10, 1.8, 0.026787, false).snapshot(), /ledger is missing/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
