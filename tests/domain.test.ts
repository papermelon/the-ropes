import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canAsk, captureStepReady, codedValidations, confirmRule, confirmedRules, deleteSegment, draftFromAnswer, hasProvenance, mapReady, newSession, PrivacyGate, readyToTeach, SaveGate, topics, ReportSchema, trainingReport, tutor } from '../src/domain';
import { unseenCase } from '../src/cases';
import { AnalysisSchema, analyse, capturePrompt, safeTutorContext } from '../src/providers';
import { completeReview, confirmedFixture, oracle, wrongChoices } from './fixtures';

test('fresh session has no learned expertise; reference/coded checks never become learned', () => {
  const s = newSession(); assert.equal(s.rules.length, 0); assert.equal(readyToTeach(s), false);
  assert.deepEqual(tutor(trainingReport, s), []); assert.deepEqual(confirmedRules(s), []);
  assert.ok(codedValidations(trainingReport).length);
});
test('missing quarterly benchmark leaves past delivery uncertain while annual outlook can be assessed', () => {
  const r = unseenCase('delivery');
  const corrected = { ...r, review: { ...r.review, ...completeReview, ...oracle.delivery } };
  assert.equal(corrected.review.annualOutlook, 'achievable');
  assert.equal(corrected.review.readiness, 'needs-clarification');
  assert.deepEqual(codedValidations(corrected), []); assert.deepEqual(tutor(corrected, confirmedFixture()), []);
  assert.equal(trainingReport.review.pastDelivery, 'not-assessed');
});
test('a recovery forecast never erases a missed agreed milestone', () => {
  const r = { ...unseenCase('outlook'), review: { ...completeReview, ...wrongChoices.outlook } }; const s = confirmedFixture();
  assert.ok(tutor(r,s).some(c => c.topic === 'outlook'));
  const corrected = { ...r, review: { ...r.review, ...completeReview, ...oracle.outlook } };
  assert.equal(corrected.review.annualOutlook, 'achievable'); assert.deepEqual(tutor(corrected,s), []);
  assert.equal(corrected.milestones[0].delivery, 'missed');
});
test('KPI linkage is context and neither outcome nor causal proof; no direct link is valid', () => {
  const r = unseenCase('delivery'); const s = confirmedFixture();
  for (const kpiInterpretation of ['outcome-proof', 'causal-proof'] as const) {
    assert.ok(tutor({ ...r, review: { ...r.review, ...completeReview, ...oracle.delivery, kpiInterpretation } },s).some(c => c.topic === 'delivery'));
  }
  assert.deepEqual(tutor({ ...r, linkedKpis: [], review: { ...r.review, ...completeReview, ...oracle.delivery } },s), []);
});
test('future milestone proposals require a recorded confirmation and never replace original commitments', () => {
  const r = unseenCase('delivery'); const original = JSON.stringify(r.milestones);
  const proposed = { ...r, review: { ...r.review, ...completeReview, ...oracle.delivery, proposedMilestone: 'Trial with two partners by 28 February; record completed handovers.' } };
  assert.deepEqual(codedValidations(proposed), []); assert.equal(JSON.stringify(proposed.milestones), original);
  assert.ok(codedValidations({ ...proposed, review: { ...proposed.review, proposalState: 'confirmed' } }).some(e => /confirmation/.test(e)));
  assert.deepEqual(codedValidations({ ...proposed, review: { ...proposed.review, proposalState: 'confirmed', proposalConfirmation: 'TEST owner confirmed the future proposal on 4 January.' } }), []);
  assert.equal(ReportSchema.safeParse({ ...r, review: { ...r.review, recommendedStatus: 'Needs clarification' } }).success, false);
});
test('approval requires exact quote, timestamped frame, topic, conditions and exceptions', () => {
  const s = confirmedFixture(); const rule = s.rules[0]; assert.ok(hasProvenance(s, rule));
  for (const invalid of [{ ...rule, evidence: [] }, { ...rule, evidence: [{ ...rule.evidence[0], quote: 'invented words' }] }, { ...rule, conditions: '' }, { ...rule, exceptions: '' }]) {
    const altered = { ...s, rules: [invalid] }; assert.throws(() => confirmRule(altered, invalid.id));
  }
  assert.equal(hasProvenance({ ...s, frames: s.frames.map(f => ({ ...f, role: 'novice' as const })) }, rule), false);
  assert.equal(hasProvenance({ ...s, frames: s.frames.map(f => ({ ...f, at: 999 })) }, rule), false);
});
test('rejected/unconfirmed rules cannot coach; a confirmed map is required', () => {
  const s = confirmedFixture(); assert.ok(readyToTeach(s));
  assert.equal(readyToTeach({ ...s, mapApproved: false }), false);
  assert.deepEqual(tutor(trainingReport, { ...s, rules: s.rules.map(r => ({ ...r, status: 'draft' as const })) }), []);
  assert.deepEqual(tutor(trainingReport, { ...s, rules: s.rules.map(r => ({ ...r, status: 'rejected' as const })) }), []);
});
test('three unique Capture answers + guardrail + three new debrief answers are required', () => {
  const s = confirmedFixture(); assert.ok(mapReady(s));
  assert.equal(mapReady({ ...s, questions: s.questions.map(q => ({ ...q, guardrail: false })) }), false);
  assert.equal(mapReady({ ...s, questions: s.questions.filter(q => q.phase === 'capture') }), false);
});
test('deletion cascades to dependent evidence/rules and invalidates map', () => {
  const s = confirmedFixture(); const removed = s.segments[0].id;
  s.voiceEvents = [{ at: 200, segmentId: removed, type: 'agent-text', text: 'TEST deleted words' }, { at: 201, segmentId: s.segments[1].id, type: 'listening' }];
  s.teachBack = { at: 202, summary: 'TEST deleted words', delivery: 'spoken-request', confirmedAt: 203 };
  s.practices.push({ at: 200, segmentIds: ['test-novice'], humanSelfDeclared: false, prediction: 'TEST', firstAttempt: trainingReport, savedDraft: trainingReport, concerns: ['TEST'], ruleIds: [s.rules[0].id] }); const next = deleteSegment(s, removed); assert.equal(next.practices.length,0);
  assert.equal(next.frames.length, 2); assert.equal(next.transcripts.length, 4); assert.equal(next.rules.length, 2); assert.equal(next.mapApproved, false);
  assert.ok(next.questions.every(q => q.segmentId !== removed));
  assert.deepEqual(next.voiceEvents, [s.voiceEvents[1]]); assert.equal(next.teachBack, undefined);
});
test('partial evidence deletion requires re-confirmation rather than retaining approval', () => {
  const s = confirmedFixture(); const rule = s.rules[0]; const f = s.frames[0]; const t = s.transcripts[0];
  const extraSegment = 'extra';
  s.segments.push({ id: extraSegment, at: 90, role: 'expert' }); s.frames.push({ ...f, id: 'extra-frame', segmentId: extraSegment }); s.transcripts.push({ ...t, id: 'extra-transcript', segmentId: extraSegment, questionId: 'extra-question' }); s.questions.push({ ...s.questions[0], id: 'extra-question', segmentId: extraSegment, transcriptId: 'extra-transcript', frameId: 'extra-frame' });
  rule.evidence.push({ ...rule.evidence[0], frameId: 'extra-frame', transcriptId: 'extra-transcript' });
  const next = deleteSegment(s, f.segmentId); assert.equal(next.rules.find(r => r.id === rule.id)?.status, 'draft');
});
test('held-out positive controls catch before save and corrections clear all three themes', () => {
  const s = confirmedFixture();
  for (const topic of topics) {
    const current = { ...unseenCase(topic), review: { ...completeReview, ...wrongChoices[topic] } }; const caught = tutor(current, s); assert.ok(caught.some(c => c.topic === topic));
    assert.deepEqual(tutor({ ...current, review: { ...current.review, ...oracle[topic] } }, s), []);
  }
  assert.ok(tutor({ ...unseenCase('delivery'), review: { ...unseenCase('delivery').review, ...completeReview, ...oracle.delivery, exceptionReview: true } }, s).length);
});
test('privacy epoch rejects queued or late results across off record/reconnect/reset', async () => {
  const gate = new PrivacyGate(); const first = gate.begin(); assert.ok(gate.accepts(first)); gate.stop(); assert.equal(gate.accepts(first), false);
  const second = gate.begin(); assert.equal(gate.accepts(first), false); assert.ok(gate.accepts(second)); gate.stop();
  assert.equal(gate.accepts(second), false);
});
test('quiet interval never proves reading is finished; speaking and reading block Ask now', () => {
  assert.ok(canAsk(30000, 0, 0, false, false, 0));
  assert.equal(canAsk(30000, 0, 0, true, false, 0, true), false);
  assert.equal(canAsk(30000, 0, 0, false, true, 0, true), false);
  assert.equal(canAsk(30000, 29900, 0, false, false, 0), false);
  assert.equal(canAsk(30000, 0, 29900, false, false, 0, true), false);
});
test('double-click and stale async results cannot save a newer revision', () => {
  const gate = new SaveGate(); const first = gate.begin(); assert.throws(() => gate.begin()); gate.edit(); assert.equal(gate.finish(first), false);
  const second = gate.begin(); assert.ok(gate.finish(second));
});
test('malformed model output is rejected and mock frame interpretation is honestly labelled', async () => {
  assert.equal(AnalysisSchema.safeParse({ topic: 'delivery', question: 'why?' }).success, false);
  const input = { frame: 'data:image/jpeg;base64,/9j/2Q==', report: trainingReport, topic: 'delivery' as const, previous: [] };
  const output = await analyse('mock', input, new AbortController().signal); assert.match(output.observation, /Simulated/); assert.ok(output.guardrail);
});
test('Capture prompt has no held-out content; tutor context contains only current report and confirmed rule excerpts', () => {
  const prompt = capturePrompt({ frame: 'data:image/jpeg;base64,/9j/2Q==', report: trainingReport, topic: 'delivery', previous: [] });
  assert.doesNotMatch(prompt, /Alder|Neighbourhood access|30 June 2027|12 Dec/);
  const context = JSON.stringify(safeTutorContext(unseenCase('delivery'), confirmedFixture().rules));
  assert.doesNotMatch(context, /expectedAnswer|oracle|testOracle/); assert.match(context, /expertQuotes/);
});

test('unseen drafts are empty; Map includes debrief but cannot invent its visual support', () => {
  for (const topic of topics) {
    const r = unseenCase(topic);
    assert.equal(r.review.pastDelivery, 'not-assessed'); assert.equal(r.review.deliveryReason, ''); assert.equal(r.review.recommendedStatus, 'not-assessed');
    assert.ok(codedValidations(r).length); assert.deepEqual(tutor(r,newSession()), []);
  }
  const s = confirmedFixture(); const capture = s.questions.find(q => q.phase === 'capture' && q.topic === 'delivery')!;
  const debrief = s.transcripts.find(t => t.questionId === s.questions.find(q => q.phase === 'debrief' && q.topic === 'delivery')!.id)!;
  debrief.text = 'Apply when a quarterly benchmark is missing. Except when a signed benchmark is supplied. Ask the owner before rating past delivery.';
  const r = draftFromAnswer(s,capture);
  assert.match(r.rationale, /signed benchmark/); assert.match(r.conditions, /quarterly benchmark is missing/); assert.match(r.exceptions, /signed benchmark/);
  assert.equal(r.evidence.length,2); assert.equal(r.evidence[1].frameId,''); assert.equal(hasProvenance(s,r),false);
  s.rules = [r]; assert.throws(() => confirmRule(s,r.id));
  r.evidence[1].frameId = capture.frameId!;
  assert.ok(hasProvenance(s,r)); assert.ok(confirmRule(s,r.id).rules[0].status === 'confirmed');
  assert.equal(captureStepReady(s,trainingReport,'delivery'),false);
  assert.ok(captureStepReady(s,{ ...trainingReport, review: completeReview },'delivery'));
  const withoutDebrief = deleteSegment(s,debrief.segmentId); assert.equal(withoutDebrief.mapApproved,false);
});
