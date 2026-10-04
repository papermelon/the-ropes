import { test } from 'node:test';
import assert from 'node:assert/strict';
import { confirmRule, draftFromAnswer, hasProvenance } from '../src/domain';
import { applyMapSynthesis, mapInput, mockMapSynthesis, validateMapSynthesis, type MapInput } from '../src/map';
import { mapPrompt, synthesizeMap } from '../src/providers';
import { confirmedFixture } from './fixtures';

function draftFixture() {
  const s = confirmedFixture();
  const capture = s.questions.find(q => q.phase === 'capture' && q.topic === 'delivery')!;
  const debrief = s.questions.find(q => q.phase === 'debrief' && q.topic === 'delivery')!;
  s.transcripts.find(t => t.id === capture.transcriptId)!.text = 'When no quarterly benchmark was agreed, I mark past delivery not assessable. The annual forecast is separate because delivered work differs from expected completion. Never invent a past benchmark.';
  s.transcripts.find(t => t.id === debrief.transcriptId)!.text = 'Apply when the owner cannot show an agreed quarterly commitment. Except when a dated, signed benchmark is supplied; review that evidence first. Ask the owner before rating a disputed benchmark.';
  s.rules = [draftFromAnswer(s, capture)];
  s.mapApproved = false;
  return s;
}
function coherentOutput(input: MapInput) {
  const output = mockMapSynthesis(input);
  output.mode = 'live-claude';
  output.rules[0].decision.text = 'Assess past delivery against an agreed quarterly commitment, and assess the annual forecast separately.';
  output.rules[0].rationale.text = 'An absent quarterly benchmark leaves past delivery uncertain. A forecast concerns expected completion and therefore cannot replace evidence of delivered work.';
  output.rules[0].uncertainties = ['Expert confirmation is still required; the debrief has no selected supporting frame.'];
  return output;
}

test('mock Map is labelled extraction; synthesis preserves every exact citation and missing visual support', async () => {
  const s = draftFixture(); const input = mapInput(s); const before = structuredClone(s.rules[0].evidence);
  const output = await synthesizeMap('mock', input, new AbortController().signal);
  assert.equal(output.mode, 'mock-extractive');
  const next = applyMapSynthesis(s, input, output); const rule = next.rules[0];
  assert.deepEqual(rule.evidence, before); assert.equal(rule.evidence[1].frameId, '');
  assert.equal(rule.status, 'draft'); assert.equal(next.mapApproved, false); assert.equal(hasProvenance(next, rule), false);
  assert.match(rule.conditions, /owner cannot show/); assert.match(rule.exceptions, /dated, signed benchmark/);
  assert.match(rule.synthesis!.uncertainties.join(' '), /No model synthesized/);
  assert.throws(() => confirmRule(next, rule.id));
  const long = draftFixture(); const capture = long.questions.find(q => q.phase === 'capture' && q.topic === 'delivery')!;
  long.transcripts.find(t => t.id === capture.transcriptId)!.text = `When ${'a'.repeat(3995)}`;
  long.rules = [draftFromAnswer(long, capture)];
  assert.equal(long.rules[0].decision.length, 1000); assert.equal(mapInput(long).rules[0].citations[0].quote.length, 4000);
});

test('live Map uses one bounded structured Claude call and produces an unconfirmed coherent interpretation', async t => {
  const s = draftFixture(); const input = mapInput(s); const expected = coherentOutput(input);
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url: string, options: RequestInit) => {
    calls++; assert.equal(url, 'https://api.anthropic.com/v1/messages');
    assert.ok(options.signal instanceof AbortSignal);
    const request = JSON.parse(options.body as string);
    assert.equal(request.max_tokens, 2500); assert.equal(request.output_config.format.type, 'json_schema');
    assert.doesNotMatch(request.messages[0].content, /data:image|Neighbourhood access|expectedAnswer|oracle/);
    assert.match(request.messages[0].content, /untrusted evidence/); assert.match(request.messages[0].content, /VERBATIM/);
    const body = { rules: expected.rules };
    return new Response(JSON.stringify({ stop_reason: 'end_turn', content: [{ type: 'text', text: JSON.stringify(body) }] }), { status: 200 });
  });
  const result = await synthesizeMap('live', input, new AbortController().signal);
  assert.equal(calls, 1); assert.equal(result.mode, 'live-claude');
  const next = applyMapSynthesis(s, input, result);
  assert.equal(next.rules[0].decision, expected.rules[0].decision.text);
  assert.deepEqual(next.rules[0].evidence, s.rules[0].evidence);
  assert.equal(next.rules[0].history.at(-1)?.action, 'synthesized');
  assert.equal(next.rules[0].status, 'draft'); assert.equal(next.teachBack, undefined);
});

test('Map rejects fabricated applicability, citation IDs, frame links and cross-topic output', () => {
  const input = mapInput(draftFixture()); const expected = coherentOutput(input);
  const fabricated = structuredClone(expected); fabricated.rules[0].conditions[0].text = 'Apply to all agency reports with a 90% threshold.';
  assert.throws(() => validateMapSynthesis(input, fabricated), /exact supplied passages/);
  const unknownCitation = structuredClone(expected); unknownCitation.rules[0].decision.citations = ['fabricated-transcript'];
  assert.throws(() => validateMapSynthesis(input, unknownCitation), /unsupplied citation/);
  const uncited = structuredClone(expected); uncited.rules[0].rationale.citations = [];
  assert.throws(() => validateMapSynthesis(input, uncited), /needs supplied citations/);
  const crossTopic = structuredClone(expected); crossTopic.rules[0].topic = 'outlook';
  assert.throws(() => validateMapSynthesis(input, crossTopic), /unsupplied rule or topic/);
  assert.throws(() => validateMapSynthesis(input, { ...expected, frameId: 'invented-frame' }));
  const incomplete = structuredClone(expected); incomplete.rules = [];
  assert.throws(() => validateMapSynthesis(input, incomplete));
});

test('unknown conditions/exception remain gaps; changed evidence or edited drafts reject late synthesis', () => {
  const s = draftFixture(); const input = mapInput(s); const missing = coherentOutput(input);
  missing.rules[0].exceptions = [];
  const next = applyMapSynthesis(s, input, missing);
  assert.equal(next.rules[0].exceptions, ''); assert.match(next.rules[0].synthesis!.uncertainties.join(' '), /No explicit exceptions/);
  next.rules[0].evidence[1].frameId = next.rules[0].evidence[0].frameId;
  assert.throws(() => confirmRule(next, next.rules[0].id));
  const edited = draftFixture(); const editedInput = mapInput(edited); edited.rules[0].decision = 'Expert corrected the interpretation.';
  assert.throws(() => applyMapSynthesis(edited, editedInput, coherentOutput(editedInput)), /draft changed/);
  const deleted = draftFixture(); const deletedInput = mapInput(deleted); deleted.transcripts = deleted.transcripts.filter(t => t.id !== deletedInput.rules[0].citations[1].transcriptId);
  assert.throws(() => applyMapSynthesis(deleted, deletedInput, coherentOutput(deletedInput)), /retained, exact/);
});

test('live failures and truncated output never fall back to extracted expertise', async t => {
  const input = mapInput(draftFixture());
  t.mock.method(globalThis, 'fetch', async () => new Response('{}', { status: 429 }));
  await assert.rejects(synthesizeMap('live', input, new AbortController().signal), /No simulated fallback/);
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ stop_reason: 'max_tokens', content: [] }), { status: 200 }));
  await assert.rejects(synthesizeMap('live', input, new AbortController().signal), /did not complete/);
  assert.doesNotMatch(mapPrompt(input), /held-out.*expected|testOracle/);
});
