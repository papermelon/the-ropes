// Test-only synthetic provenance and oracle. Never imported into runtime source.
import { confirmRule, draftFromAnswer, newSession, topics, uid, emptyReview, type Review, type Session } from '../src/domain';
export function confirmedFixture(): Session {
  let s = newSession();
  for (const topic of topics) {
    const seg = uid(); const frameId = uid(); const transcriptId = uid(); const questionId = uid();
    s.segments.push({ id: seg, at: 100, role: 'expert' });
    s.frames.push({ id: frameId, segmentId: seg, at: 101, image: 'data:image/jpeg;base64,/9j/2Q==', topic, observation: 'TEST fixture frame, not a human demo.', mode: 'mock', role: 'expert' });
    const text = `TEST expert: use ${topic} evidence and ask when uncertain.`;
    s.transcripts.push({ id: transcriptId, segmentId: seg, at: 102, text, source: 'typed-expert', questionId });
    const q = { id: questionId, phase: 'capture' as const, topic, text: `TEST question ${topic}`, frameId, segmentId: seg, at: 101, guardrail: topic === 'delivery', disposition: 'answered' as const, transcriptId };
    const debriefId = uid(); const debriefTranscriptId = uid();
    s.questions.push(q, { ...q, id: debriefId, transcriptId: debriefTranscriptId, frameId: undefined, phase: 'debrief', text: `TEST distinct debrief ${topic}` });
    s.transcripts.push({ id: debriefTranscriptId, segmentId: seg, at: 103, text: `TEST debrief: review new exceptions for ${topic}.`, source: 'typed-expert', questionId: debriefId });
    const r = draftFromAnswer(s, q);
    s.rules.push({ ...r, evidence: r.evidence.map(e => ({ ...e, frameId: e.frameId || frameId })), title: topic, decision: `Review ${topic}`, conditions: 'Apply within this fictional evidence design.', exceptions: 'Stop for human review if other evidence exists.', rationale: text, guardrail: 'Ask before unsupported claims.' });
    s = confirmRule(s, r.id);
  }
  s.mapApproved = true;
  return s;
}
export const oracle = {
  delivery: { pastDelivery: 'not-assessable' as const, recommendedStatus: 'On track' as const, deliveryReason: 'No agreed Q3 benchmark; seek clarification without inventing a past commitment.' },
  outlook: { pastDelivery: 'missed' as const, deliveryBasis: 'agreed-milestone' as const, deliveryReason: 'The agreed December trial was missed. The June outlook remains separate and depends on recovery.' },
  readiness: { readiness: 'needs-clarification' as const, statusAssessment: 'qualified' as const, readinessReason: 'Partner dates and coordinator commitments are pending.', clarification: 'Ask the owner for named coordinators, committed trial dates and the consequence of delay for June.' }
};

export const completeReview: Review = { ...emptyReview, pastDelivery: 'not-assessable', deliveryBasis: 'missing-benchmark', deliveryReason: 'TEST: design work documented; no agreed quarterly benchmark.', annualOutlook: 'achievable', outlookReason: 'TEST: annual launch remains possible if partners confirm dates.', assumptions: 'TEST: coordinator capacity and trial timing need confirmation.', readiness: 'needs-clarification', readinessReason: 'TEST: pending partner dates are flagged.', statusAssessment: 'qualified', recommendedStatus: 'On track', clarification: 'TEST: ask the owner for named coordinators, dates and the effect of delay.' };
export const wrongChoices = {
  delivery: { pastDelivery: 'missed' as const, recommendedStatus: 'Off track' as const },
  outlook: { pastDelivery: 'met' as const, deliveryBasis: 'agreed-milestone' as const },
  readiness: { readiness: 'ready' as const, statusAssessment: 'supported' as const }
};
