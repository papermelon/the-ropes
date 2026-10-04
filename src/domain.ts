import { z } from 'zod';

export const topics = ['delivery', 'outlook', 'readiness'] as const;
export type Topic = typeof topics[number];
export const topicLabels = { delivery: 'Past delivery', outlook: 'Annual outlook', readiness: 'Review readiness' };
export type Mode = 'mock' | 'live';
export const performanceStatuses = ['On track', 'At risk', 'Off track', 'Completed'] as const;
const text = z.string().max(1500);
export const ReviewSchema = z.object({
  pastDelivery: z.enum(['not-assessed', 'met', 'partly-met', 'missed', 'not-assessable']),
  deliveryBasis: z.enum(['not-reviewed', 'agreed-milestone', 'missing-benchmark', 'retrospective-assumption']), deliveryReason: text,
  annualOutlook: z.enum(['not-assessed', 'achievable', 'at-risk', 'unlikely', 'achieved']), outlookReason: text,
  readiness: z.enum(['not-assessed', 'ready', 'needs-clarification']), readinessReason: text,
  statusAssessment: z.enum(['not-reviewed', 'supported', 'qualified', 'questioned']), recommendedStatus: z.enum(['not-assessed', ...performanceStatuses]),
  assumptions: text, clarification: text, managementDecision: text,
  proposedMilestone: text, proposalState: z.enum(['proposed', 'confirmed']), proposalConfirmation: text,
  kpiInterpretation: z.enum(['context', 'outcome-proof', 'causal-proof']), exceptionReview: z.boolean()
}).strict();
export const ReportSchema = z.object({
  id: z.string().max(100), initiative: z.string().min(1).max(160), owner: z.string().max(160), supporting: z.string().max(300), period: z.string().max(100), cadence: z.string().max(100),
  annualCommitment: text, annualAgreement: z.enum(['agreed', 'draft']), annualDue: z.string().max(100),
  milestones: z.array(z.object({ quarter: z.string().max(100), statement: text, agreement: z.enum(['agreed', 'draft', 'missing']), delivery: z.enum(['met', 'missed', 'pending', 'unknown']) }).strict()).min(1).max(4), currentQuarter: z.string().max(100),
  progress: text, evidence: z.array(z.object({ label: z.string().max(200), detail: text }).strict()).max(8), submittedStatus: z.enum(performanceStatuses),
  dependencies: z.array(z.object({ item: text, resolution: z.enum(['confirmed', 'pending']) }).strict()).max(8),
  linkedKpis: z.array(z.object({ id: z.string().max(100), title: z.string().max(300), relationship: text }).strict()).max(8),
  resultsPath: text, submittedDecision: text, review: ReviewSchema
}).strict().superRefine((r, context) => {
  if (!r.milestones.some(m => m.quarter === r.currentQuarter)) context.addIssue({ code: 'custom', message: 'The selected quarter must have a milestone entry.', path: ['currentQuarter'] });
  if (new Set(r.milestones.map(m => m.quarter)).size !== r.milestones.length) context.addIssue({ code: 'custom', message: 'Quarter entries must be distinct.', path: ['milestones'] });
});
export type Report = z.infer<typeof ReportSchema>;
export type Review = Report['review'];
export const emptyReview: Review = { pastDelivery: 'not-assessed', deliveryBasis: 'not-reviewed', deliveryReason: '', annualOutlook: 'not-assessed', outlookReason: '', readiness: 'not-assessed', readinessReason: '', statusAssessment: 'not-reviewed', recommendedStatus: 'not-assessed', assumptions: '', clarification: '', managementDecision: '', proposedMilestone: '', proposalState: 'proposed', proposalConfirmation: '', kpiInterpretation: 'context', exceptionReview: false };
export const trainingReport: Report = {
  id: 'expert-referral-pilot', initiative: 'Partner referral pilot', owner: 'Service Design Division · CivicBridge Network', supporting: 'Digital Services; three partner teams', period: 'Q2 · Jul–Sep 2026', cadence: 'Quarterly', currentQuarter: 'Q2',
  annualCommitment: 'Launch a tested referral pathway with six partner teams, with an agreed handover protocol and an initial adoption review.', annualAgreement: 'agreed', annualDue: '31 March 2027',
  milestones: [
    { quarter: 'Q1', statement: 'Engage partners and start pathway design.', agreement: 'draft', delivery: 'unknown' },
    { quarter: 'Q2', statement: 'No quarterly benchmark was agreed.', agreement: 'missing', delivery: 'unknown' },
    { quarter: 'Q3', statement: 'Trial the pathway with an initial partner group.', agreement: 'draft', delivery: 'pending' },
    { quarter: 'Q4', statement: 'Launch with six partner teams and review adoption.', agreement: 'draft', delivery: 'pending' }
  ],
  progress: 'Three partner discussions held. A handover template is drafted. The team expects to trial in January and launch by March; trial scope and partner commitments are still being discussed.',
  evidence: [{ label: 'Discussion notes · 18 Sep', detail: 'Three teams discussed referral handovers. The notes record interest, without a commitment to trial dates or volume.' }, { label: 'Handover template · v0.2', detail: 'Draft only. No trial, sign-off or adoption evidence yet.' }], submittedStatus: 'On track',
  dependencies: [{ item: 'Partner teams to agree trial scope and nominate coordinators.', resolution: 'pending' }, { item: 'Digital Services to confirm an integration slot.', resolution: 'pending' }],
  linkedKpis: [{ id: 'KPI C2', title: 'Partner experience with joined-up services', relationship: 'May contribute through more reliable handovers. This corporate measure also covers other initiatives; no initiative-level outcome has been observed.' }],
  resultsPath: 'Design and trial → usable handover protocol → partners use the pathway → more reliable referrals. Adoption, partner capacity and integration are assumptions, not established results.',
  submittedDecision: 'Management support requested to secure partner coordinators and the integration slot.', review: { ...emptyReview }
};
export const currentMilestone = (r: Report) => r.milestones.find(m => m.quarter === r.currentQuarter)!;
export function reviewSummary(r: Report) { return `Past delivery: ${r.review.pastDelivery}; annual outlook: ${r.review.annualOutlook}; review readiness: ${r.review.readiness}; performance status: ${r.review.recommendedStatus}. ${r.review.deliveryReason} ${r.review.outlookReason} ${r.review.readinessReason}`; }
export const triggerDescriptions = {
  delivery: 'A missed/Off track judgment based only on a missing benchmark; a retrospective assumed benchmark; or a delivery claim presented as an outcome/causal proof solely from the KPI link.',
  outlook: 'An agreed missed quarterly milestone recorded as met while relying on an optimistic annual forecast.',
  readiness: 'A report marked ready with its submitted status supported while dependencies remain unconfirmed.'
};
export const uid = () => crypto.randomUUID();
export type Frame = { id: string; segmentId: string; at: number; image: string; topic: Topic; observation: string; mode: Mode; role: 'expert' | 'novice' };
export type Transcript = { id: string; segmentId: string; at: number; text: string; source: 'typed-expert' | 'scribe' | 'scribe-reviewed'; questionId: string };
export type Question = { id: string; phase: 'capture' | 'debrief'; topic: Topic; text: string; frameId?: string; segmentId: string; at: number; guardrail: boolean; disposition: 'asked' | 'answered' | 'deferred' | 'dismissed'; transcriptId?: string };
export type Evidence = { frameId: string; transcriptId: string; start: number; end: number; quote: string };
export type Rule = { id: string; topic: Topic; title: string; decision: string; conditions: string; exceptions: string; rationale: string; guardrail: string; evidence: Evidence[]; synthesis?: { mode: 'live-claude' | 'mock-extractive'; at: number; uncertainties: string[]; support: Record<'decision' | 'conditions' | 'exceptions' | 'rationale' | 'guardrail', string[]> }; status: 'draft' | 'confirmed' | 'rejected'; history: { at: number; action: string; detail: string }[] };
export type Practice = { at: number; segmentIds: string[]; humanSelfDeclared: boolean; prediction: string; firstAttempt: Report; savedDraft: Report; concerns: string[]; ruleIds: string[] };
export type VoiceEvent = { at: number; segmentId: string; type: 'connected' | 'speaking' | 'listening' | 'agent-text' | 'interrupted' | 'disconnected'; text?: string; conversationId?: string };
export type Session = { id: string; createdAt: number; mode: Mode; segments: { id: string; at: number; role: 'expert' | 'novice' }[]; frames: Frame[]; transcripts: Transcript[]; questions: Question[]; rules: Rule[]; practices: Practice[]; voiceEvents?: VoiceEvent[]; mapApproved: boolean; teachBack?: { at: number; summary: string; delivery: 'simulated-text' | 'spoken-request'; confirmedAt?: number } };
export function newSession(mode: Mode = 'mock'): Session { return { id: uid(), createdAt: Date.now(), mode, segments: [], frames: [], transcripts: [], questions: [], rules: [], practices: [], mapApproved: false }; }
export function judgmentReady(r: Report, topic: Topic) {
  const v = r.review;
  if (topic === 'delivery') return v.pastDelivery !== 'not-assessed' && v.deliveryBasis !== 'not-reviewed' && !!v.deliveryReason.trim();
  if (topic === 'outlook') return v.annualOutlook !== 'not-assessed' && !!v.outlookReason.trim();
  return v.readiness !== 'not-assessed' && v.recommendedStatus !== 'not-assessed' && v.statusAssessment !== 'not-reviewed' && !!v.readinessReason.trim() && (v.readiness !== 'needs-clarification' || !!v.clarification.trim());
}
export function captureStepReady(s: Session, r: Report, topic: Topic) {
  return judgmentReady(r, topic) && s.questions.some(q => q.phase === 'capture' && q.topic === topic && q.disposition === 'answered' && s.transcripts.some(t => t.id === q.transcriptId && t.text.trim()) && s.frames.some(f => f.id === q.frameId && f.role === 'expert' && f.topic === topic));
}
export function codedValidations(r: Report): string[] {
  const v = r.review; const errors: string[] = [];
  if ([v.pastDelivery, v.annualOutlook, v.readiness, v.recommendedStatus].includes('not-assessed') || v.statusAssessment === 'not-reviewed' || v.deliveryBasis === 'not-reviewed') errors.push('Complete the three judgments, benchmark basis and status assessment before saving.');
  if (![v.deliveryReason, v.outlookReason, v.readinessReason].every(t => t.trim())) errors.push('Give a reason for each judgment.');
  if (v.readiness === 'needs-clarification' && !v.clarification.trim()) errors.push('State a precise clarification request.');
  if (v.proposalState === 'confirmed' && (!v.proposedMilestone.trim() || !v.proposalConfirmation.trim())) errors.push('A confirmed future milestone needs the proposal and a recorded confirmation.');
  return errors;
}
export function hasProvenance(s: Session, rule: Rule): boolean {
  return rule.evidence.length > 0 && rule.evidence.every(e => {
    const f = s.frames.find(f => f.id === e.frameId && f.role === 'expert');
    const t = s.transcripts.find(t => t.id === e.transcriptId);
    return !!f && !!t && f.topic === rule.topic && f.at <= t.at && s.segments.some(seg => seg.id === f.segmentId && seg.role === 'expert')
      && s.segments.some(seg => seg.id === t.segmentId && seg.role === 'expert') && s.questions.some(q => q.id === t.questionId && q.topic === rule.topic && q.disposition === 'answered' && q.transcriptId === t.id) && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(f.image)
      && e.start >= 0 && e.end > e.start && e.end <= t.text.length && e.quote.trim().length > 0 && t.text.slice(e.start, e.end) === e.quote;
  });
}
export function questionProgress(s: Session) {
  const answered = (q: Question) => q.disposition === 'answered' && s.transcripts.some(t => t.id === q.transcriptId && t.questionId === q.id && t.text.trim().length > 0);
  const capture = s.questions.filter(q => q.phase === 'capture' && answered(q) && s.frames.some(f => f.id === q.frameId && f.role === 'expert'));
  const debrief = s.questions.filter(q => q.phase === 'debrief' && answered(q) && !capture.some(c => c.text === q.text));
  return { capture: new Set(capture.map(q => q.text)).size, debrief: new Set(debrief.map(q => q.text)).size, guardrail: capture.some(q => q.guardrail) };
}
export function mapReady(s: Session) { const p = questionProgress(s); return p.capture >= 3 && p.debrief >= 3 && p.guardrail && topics.every(topic => s.questions.some(q => q.phase === 'capture' && q.topic === topic && q.disposition === 'answered' && s.transcripts.some(t => t.id === q.transcriptId && t.text.trim()) && s.frames.some(f => f.id === q.frameId && f.topic === topic && f.role === 'expert'))); }
export function confirmedRules(s: Session) { return s.rules.filter(r => r.status === 'confirmed' && hasProvenance(s, r)); }
export function readyToTeach(s: Session) { return s.mapApproved && mapReady(s) && confirmedRules(s).length > 0; }
export function confirmRule(s: Session, ruleId: string): Session {
  const rule = s.rules.find(r => r.id === ruleId);
  if (!rule || !hasProvenance(s, rule) || ![rule.title, rule.decision, rule.conditions, rule.exceptions, rule.rationale, rule.guardrail].every(v => v.trim())) throw new Error('Rule needs a real supporting frame, exact quote, decision, rationale, conditions and exceptions. Request a supporting demonstration.');
  return { ...s, mapApproved: false, rules: s.rules.map(r => r.id === ruleId ? { ...r, status: 'confirmed', history: [...r.history, { at: Date.now(), action: 'confirmed', detail: 'Expert explicitly approved this interpretation and coded trigger.' }] } : r) };
}
export function draftFromAnswer(s: Session, question: Question): Rule {
  const sources = [question, ...s.questions.filter(q => q.phase === 'debrief' && q.topic === question.topic && q.at >= question.at && q.disposition === 'answered')].flatMap(q => {
    const t = s.transcripts.find(t => t.id === q.transcriptId);
    return t ? [{ q, t }] : [];
  });
  const sentences = sources.flatMap(({ t }) => t.text.match(/[^.!?]+[.!?]?/g)?.map(v => v.trim()) || []);
  const clarifications = sources.filter(({ q }) => q.phase === 'debrief').flatMap(({ t }) => t.text.match(/[^.!?]+[.!?]?/g)?.map(v => v.trim()) || []);
  // Extractive seed and mock path. Live Map synthesis must preserve these exact citations and absent screen links.
  // Debrief quotes deliberately have no screen link until the expert selects supporting visual evidence.
  return { id: uid(), topic: question.topic, title: topicLabels[question.topic], decision: (sentences[0] || '').slice(0,1000), conditions: ([...clarifications,...sentences].find(v => /\b(?:when|applies|if)\b/i.test(v)) || '').slice(0,1000), exceptions: ([...clarifications,...sentences].find(v => /\b(?:unless|except|exception)\b/i.test(v)) || '').slice(0,1000), rationale: sources.map(({ q, t }) => `${q.phase}: ${t.text.slice(0,400)}`).join('\n\n').slice(0,1000), guardrail: (sentences.find(v => /\b(?:stop|never|ask|require|before)\b/i.test(v)) || '').slice(0,1000), status: 'draft', history: [{ at: Date.now(), action: 'drafted', detail: 'Extracted from Capture and same-topic debrief words. Expert must correct the draft and link each clarification to supporting screen evidence.' }], evidence: sources.map(({ q, t }) => ({ frameId: q.frameId || '', transcriptId: t.id, start: 0, end: t.text.length, quote: t.text })) };
}
export function deleteSegment(s: Session, id: string): Session {
  const frames = s.frames.filter(f => f.segmentId !== id);
  const transcripts = s.transcripts.filter(t => t.segmentId !== id);
  const questions = s.questions.filter(q => q.segmentId !== id && (!q.frameId || frames.some(f => f.id === q.frameId)) && (!q.transcriptId || transcripts.some(t => t.id === q.transcriptId)));
  const rules = s.rules.flatMap(r => {
    const evidence = r.evidence.filter(e => frames.some(f => f.id === e.frameId) && transcripts.some(t => t.id === e.transcriptId));
    if (!evidence.length) return [];
    return [{ ...r, evidence, status: evidence.length !== r.evidence.length ? 'draft' as const : r.status, history: evidence.length !== r.evidence.length ? [...r.history, { at: Date.now(), action: 'evidence-deleted', detail: 'Re-confirmation required after supporting segment deletion.' }] : r.history }];
  });
  return { ...s, segments: s.segments.filter(seg => seg.id !== id), frames, transcripts, questions, rules, voiceEvents: s.voiceEvents?.filter(event => event.segmentId !== id), practices: s.practices.filter(p => !p.segmentIds.includes(id) && p.ruleIds.every(ruleId => rules.some(r => r.id === ruleId && r.status === 'confirmed'))), mapApproved: false, teachBack: undefined };
}
export type Intervention = { ruleId: string; topic: Topic; question: string; hints: string[]; reason: string };
// ponytail: explicit, expert-approved sandbox triggers, not agency policy or a general status classifier.
export function tutor(r: Report, s: Session): Intervention[] {
  if (!readyToTeach(s)) return [];
  const v = r.review; const m = currentMilestone(r); const results: Intervention[] = [];
  for (const rule of confirmedRules(s)) {
    let breach = false; let question = ''; let hints: string[] = [];
    if (rule.topic === 'delivery') {
      breach = v.deliveryBasis === 'retrospective-assumption' || (v.deliveryBasis === 'missing-benchmark' && (v.pastDelivery === 'missed' || v.recommendedStatus === 'Off track')) || (r.linkedKpis.length > 0 && v.kpiInterpretation !== 'context');
      question = v.kpiInterpretation !== 'context' ? 'Does the KPI link demonstrate an observed result or a causal effect?' : 'What agreed benchmark supports that past-delivery judgment?';
      hints = ['Separate the benchmark, the evidence of delivery, and the annual forecast.', `The ${r.currentQuarter} benchmark is ${m.agreement}. A missing benchmark does not establish a missed commitment.`, 'Document what can be assessed; seek the missing benchmark without inventing a past commitment. A KPI link describes context, not proof of an outcome or causation.'];
    } else if (rule.topic === 'outlook') {
      breach = m.agreement === 'agreed' && m.delivery === 'missed' && v.pastDelivery === 'met';
      question = 'Does the annual forecast change what was delivered against the agreed quarterly milestone?';
      hints = ['Compare past delivery with the forecast separately.', `The agreed ${r.currentQuarter} milestone is recorded as missed. The annual commitment is due ${r.annualDue}.`, 'Retain the missed milestone and its variance. Assess the annual outlook using a credible recovery plan, evidence and dependencies.'];
    } else {
      breach = v.readiness === 'ready' && v.statusAssessment === 'supported' && r.dependencies.some(d => d.resolution === 'pending');
      question = 'What evidence supports accepting this status with the dependencies still unconfirmed?';
      hints = ['Review readiness is a flag about the report, separate from performance status.', 'Identify which dependency affects the forecast and who can resolve it.', 'Qualify the status assessment or flag the report for clarification. Ask for the owner, timing, evidence and consequence of the dependency; do not silently downgrade the performance status.'];
    }
    if (breach || v.exceptionReview) results.push({ ruleId: rule.id, topic: rule.topic, question: v.exceptionReview ? 'You marked an exception. Stop and ask the expert to review its applicability.' : question, hints, reason: rule.rationale });
  }
  return results;
}
export function captureQuestion(topic: Topic, r: Report, observation: string) {
  const context = observation.slice(0, 100); const m = currentMilestone(r);
  if (topic === 'delivery') return `The ${r.currentQuarter} benchmark is ${m.agreement} (${context}). Why did you choose this delivery assessment, and when would you stop or ask for clarification?`;
  if (topic === 'outlook') return `The submission says “${r.submittedStatus}” with an annual commitment due ${r.annualDue} (${context}). What evidence and dependencies shaped your annual outlook?`;
  return `You are checking whether this update is ready for leadership reporting (${context}). Why is the status supported or qualified, and what precise clarification would change your decision?`;
}
export function debriefQuestions(s: Session) {
  return topics.map((topic, i) => {
    const q = s.questions.find(q => q.phase === 'capture' && q.topic === topic && q.disposition === 'answered');
    const answer = s.transcripts.find(t => t.id === q?.transcriptId)?.text.slice(0, 100) || 'No explanation retained';
    const gap = [
      'What would make a future benchmark meaningful: delivery quantity, adoption, or an observed change? Who must agree it, and how would you avoid inventing a past commitment?',
      'What evidence would change your forecast, and how would you document a recovery trade-off without erasing a missed quarterly milestone?',
      'Which exception would make you accept a qualified update, who resolves it, and what management decision should be separated from the clarification request?'
    ][i];
    return { topic, text: `You said “${answer}”. Still to clarify: ${gap} If this adds a new rule, demonstrate it on screen.` };
  });
}
export function canAsk(now: number, lastUI: number, lastSpeech: number, speaking: boolean, reading: boolean, lastAsked: number, explicit = false) {
  return !speaking && !reading && now - lastUI >= (explicit ? 500 : 3500) && now - lastSpeech >= 1800 && (explicit || now - lastAsked >= 20000);
}
/** Invalidate synchronous work before any async teardown; late results cannot enter a new segment. */
export class PrivacyGate {
  epoch = 0; active = false;
  begin() { this.epoch++; this.active = true; return this.epoch; }
  stop() { this.active = false; this.epoch++; }
  accepts(epoch: number) { return this.active && epoch === this.epoch; }
}
export class SaveGate {
  revision = 0; busy = false;
  edit() { this.revision++; }
  begin() { if (this.busy) throw new Error('A save check is already running.'); this.busy = true; return this.revision; }
  finish(revision: number) { this.busy = false; return this.revision === revision; }
}
