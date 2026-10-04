import { z } from 'zod';
import { hasProvenance, ReportSchema, topics, type Session } from './domain';

export const PRIVATE_FILE_MAX_BYTES = 64 * 1024 * 1024;
export const PRIVATE_EXPORT_LABEL = 'Private local evidence; contains actual screen captures. Human participation not verified by software.';
const id = z.string().min(1).max(160).regex(/^[A-Za-z0-9:_-]+$/);
const at = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const topic = z.enum(topics);
const source = z.enum(['typed-expert', 'scribe', 'scribe-reviewed']);
const evidence = z.object({ frameId: z.string().max(160), transcriptId: id, start: z.number().int().min(0), end: z.number().int().min(1), quote: z.string().min(1).max(4000) }).strict();
const support = z.object({ decision: z.array(id).max(160), conditions: z.array(id).max(160), exceptions: z.array(id).max(160), rationale: z.array(id).max(160), guardrail: z.array(id).max(160) }).strict();
const rule = z.object({ id, topic, title: z.string().max(4000), decision: z.string().max(4000), conditions: z.string().max(4000), exceptions: z.string().max(4000), rationale: z.string().max(4000), guardrail: z.string().max(4000), evidence: z.array(evidence).min(1).max(160), synthesis: z.object({ mode: z.enum(['live-claude', 'mock-extractive']), at, uncertainties: z.array(z.string().max(500)).max(16), support }).strict().optional(), status: z.enum(['draft', 'confirmed', 'rejected']), history: z.array(z.object({ at, action: z.string().min(1).max(100), detail: z.string().max(1500) }).strict()).min(1).max(100) }).strict();
const voiceEvent = z.object({ at, segmentId: id, type: z.enum(['connected', 'speaking', 'listening', 'agent-text', 'interrupted', 'disconnected']), text: z.string().max(1500).optional(), conversationId: id.optional() }).strict();
const sessionFields = {
  id, createdAt: at, mode: z.enum(['mock', 'live']),
  segments: z.array(z.object({ id, at, role: z.enum(['expert', 'novice']) }).strict()).max(160),
  frames: z.array(z.object({ id, segmentId: id, at, image: z.string().max(600000).regex(/^data:image\/jpeg;base64,\/9j[A-Za-z0-9+/]*={0,2}$/), topic, observation: z.string().max(1500), mode: z.enum(['mock', 'live']), role: z.enum(['expert', 'novice']) }).strict()).max(80),
  transcripts: z.array(z.object({ id, segmentId: id, at, text: z.string().min(1).max(4000), source, questionId: id }).strict()).max(160),
  questions: z.array(z.object({ id, phase: z.enum(['capture', 'debrief']), topic, text: z.string().min(1).max(1500), frameId: id.optional(), segmentId: id, at, guardrail: z.boolean(), disposition: z.enum(['asked', 'answered', 'deferred', 'dismissed']), transcriptId: id.optional() }).strict()).max(160),
  rules: z.array(rule).max(80),
  practices: z.array(z.object({ at, segmentIds: z.array(id).min(1).max(160), humanSelfDeclared: z.boolean(), prediction: z.string().max(1500), firstAttempt: ReportSchema, savedDraft: ReportSchema, concerns: z.array(z.string().max(1500)).max(80), ruleIds: z.array(id).min(1).max(80) }).strict()).max(40),
  voiceEvents: z.array(voiceEvent).max(120).optional(), mapApproved: z.boolean(),
  teachBack: z.object({ at, summary: z.string().max(30000), delivery: z.enum(['simulated-text', 'spoken-request']), confirmedAt: at.optional() }).strict().optional()
};
export const PrivateResumeSchema = z.object({ view: z.enum(['capture', 'map', 'teach']), topic, report: ReportSchema, expertReport: ReportSchema, human: z.boolean(), prediction: z.string().max(1500), caseTopic: topic.optional(), pendingQuestionId: id.optional(), answer: z.string().max(4000), answerSource: source, initialAttempt: ReportSchema.optional(), saved: ReportSchema.optional(), practiceConcerns: z.array(z.string().max(1500)).max(80), practiceSegments: z.array(id).max(160) }).strict();
export type PrivateResume = z.infer<typeof PrivateResumeSchema>;
const restore = z.object({ importedAt: at, historical: z.literal(true), freshConsentRequired: z.literal(true) }).strict();
export const PrivateExportSchema = z.object({ ...sessionFields, schemaVersion: z.literal(1), exportLabel: z.literal(PRIVATE_EXPORT_LABEL), resume: PrivateResumeSchema, restore: restore.optional() }).strict();
export type PrivateExport = z.infer<typeof PrivateExportSchema>;

function checkReferences(data: PrivateExport) {
  const fail = () => { throw new Error('Private file has invalid or missing evidence references. Nothing was restored.'); };
  for (const values of [data.segments, data.frames, data.transcripts, data.questions, data.rules]) if (new Set(values.map(value => value.id)).size !== values.length) fail();
  const segment = new Map(data.segments.map(seg => [seg.id, seg]));
  const frames = new Map(data.frames.map(frame => [frame.id, frame]));
  const transcripts = new Map(data.transcripts.map(transcript => [transcript.id, transcript]));
  const questions = new Map(data.questions.map(question => [question.id, question]));
  const rules = new Map(data.rules.map(rule => [rule.id, rule]));
  for (const frame of data.frames) {
    const seg = segment.get(frame.segmentId);
    if (!seg || seg.role !== frame.role || frame.at < seg.at) fail();
  }
  for (const q of data.questions) {
    const seg = segment.get(q.segmentId); const frame = q.frameId ? frames.get(q.frameId) : undefined;
    if (!seg || seg.role !== 'expert' || q.at < seg.at || (q.phase === 'capture' && !frame) || (q.frameId && (!frame || frame.role !== 'expert' || frame.topic !== q.topic || frame.at > q.at))) fail();
    const t = q.transcriptId ? transcripts.get(q.transcriptId) : undefined;
    if (q.disposition === 'answered' ? (!t || t.questionId !== q.id) : !!q.transcriptId) fail();
  }
  for (const t of data.transcripts) {
    const q = questions.get(t.questionId);
    if (segment.get(t.segmentId)?.role !== 'expert' || !q || q.disposition !== 'answered' || q.transcriptId !== t.id || t.at < q.at || !t.text.trim()) fail();
  }
  for (const r of data.rules) {
    for (const e of r.evidence) {
      const t = transcripts.get(e.transcriptId); const q = t ? questions.get(t.questionId) : undefined; const frame = e.frameId ? frames.get(e.frameId) : undefined;
      if (!t || !q || q.topic !== r.topic || e.end <= e.start || e.end > t.text.length || t.text.slice(e.start, e.end) !== e.quote || !e.quote.trim() || (e.frameId && (!frame || frame.role !== 'expert' || frame.topic !== r.topic || frame.at > t.at))) fail();
    }
    if (r.status === 'confirmed' && !hasProvenance(data, r)) fail();
    // Synthesis support is historical audit metadata; deleted/edited citations never grant approval.
    if (r.synthesis && r.status === 'confirmed') {
      const citations = new Set(r.evidence.map(e => `${e.transcriptId}:${e.start}:${e.end}`));
      if (Object.values(r.synthesis.support).some(ids => ids.some(id => !citations.has(id)))) fail();
    }
  }
  for (const practice of data.practices) if (practice.segmentIds.some(id => segment.get(id)?.role !== 'novice') || practice.ruleIds.some(id => !rules.has(id)) || practice.firstAttempt.id !== practice.savedDraft.id) fail();
  for (const event of data.voiceEvents || []) if (!segment.has(event.segmentId) || event.at < segment.get(event.segmentId)!.at) fail();
  if (data.resume.practiceSegments.some(id => segment.get(id)?.role !== 'novice')) fail();
  if (data.resume.pendingQuestionId && questions.get(data.resume.pendingQuestionId)?.disposition !== 'asked') fail();
  if (!data.resume.pendingQuestionId && data.resume.answer) fail();
  if (data.resume.saved && data.resume.saved.id !== data.resume.report.id) fail();
  if (data.resume.initialAttempt && data.resume.initialAttempt.id !== data.resume.report.id) fail();
}
function checkSize(text: string) {
  if (text.length > PRIVATE_FILE_MAX_BYTES || new TextEncoder().encode(text).byteLength > PRIVATE_FILE_MAX_BYTES) throw new Error('Private evidence file exceeds the 64 MB limit. Nothing was restored.');
}
export function createPrivateExport(session: Session, resume: PrivateResume): PrivateExport {
  const data = PrivateExportSchema.parse({ ...session, schemaVersion: 1, exportLabel: PRIVATE_EXPORT_LABEL, resume });
  checkReferences(data); checkSize(JSON.stringify(data)); return data;
}
/** Imported evidence is historical and untrusted; this does not start capture, connect providers or grant consent. */
export function parsePrivateExport(text: string): PrivateExport {
  checkSize(text);
  let data: PrivateExport;
  try { data = PrivateExportSchema.parse(JSON.parse(text)); } catch { throw new Error('Invalid private evidence file or unsupported schema. Nothing was restored.'); }
  checkReferences(data);
  return { ...data, mapApproved: false, teachBack: data.teachBack && { at: data.teachBack.at, summary: data.teachBack.summary, delivery: data.teachBack.delivery }, restore: { importedAt: Date.now(), historical: true, freshConsentRequired: true } };
}
