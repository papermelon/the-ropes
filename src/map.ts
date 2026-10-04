import { z } from 'zod';
import { topics, type Rule, type Session } from './domain';

const id = z.string().min(1).max(160);
const fields = { title: z.string().max(200), decision: z.string().max(1500), conditions: z.string().max(1500), exceptions: z.string().max(1500), rationale: z.string().max(1500), guardrail: z.string().max(1500) };
const CitationSchema = z.object({ id, transcriptId: id, frameId: z.string().max(160), start: z.number().int().min(0), end: z.number().int().min(1), quote: z.string().min(1).max(4000), phase: z.enum(['capture', 'debrief']) }).strict().refine(c => c.end - c.start === c.quote.length, 'Citation span must match the supplied exact quote.');
export const MapInputSchema = z.object({ rules: z.array(z.object({ id, topic: z.enum(topics), ...fields, citations: z.array(CitationSchema).min(1).max(12) }).strict()).min(1).max(12) }).strict().superRefine((input, context) => {
  if (new Set(input.rules.map(r => r.id)).size !== input.rules.length) context.addIssue({ code: 'custom', message: 'Rule IDs must be distinct.' });
  for (const rule of input.rules) if (new Set(rule.citations.map(c => c.id)).size !== rule.citations.length) context.addIssue({ code: 'custom', message: 'Citation IDs must be distinct within each rule.' });
});
export type MapInput = z.infer<typeof MapInputSchema>;
const StatementSchema = z.object({ text: z.string().max(1500), citations: z.array(id).max(12) }).strict();
const PassageSchema = z.object({ citationId: id, start: z.number().int().min(0), end: z.number().int().min(1), text: z.string().min(1).max(1500) }).strict();
export const MapSynthesisBodySchema = z.object({ rules: z.array(z.object({ id, topic: z.enum(topics), decision: StatementSchema, rationale: StatementSchema, conditions: z.array(PassageSchema).max(4), exceptions: z.array(PassageSchema).max(4), guardrail: z.array(PassageSchema).max(4), uncertainties: z.array(z.string().min(1).max(500)).max(8) }).strict()).min(1).max(12) }).strict();
export const MapSynthesisSchema = MapSynthesisBodySchema.extend({ mode: z.enum(['live-claude', 'mock-extractive']) }).strict();
export type MapSynthesis = z.infer<typeof MapSynthesisSchema>;

/** Include only retained expert words. Screens stay local; absent debrief links remain absent. */
export function mapInput(s: Session, rules: Rule[] = s.rules.filter(r => r.status === 'draft')): MapInput {
  return MapInputSchema.parse({ rules: rules.map(r => ({ id: r.id, topic: r.topic, title: r.title, decision: r.decision, conditions: r.conditions, exceptions: r.exceptions, rationale: r.rationale, guardrail: r.guardrail, citations: r.evidence.map(e => {
    const t = s.transcripts.find(t => t.id === e.transcriptId);
    const q = s.questions.find(q => q.id === t?.questionId && q.transcriptId === t?.id && q.disposition === 'answered' && q.topic === r.topic);
    if (!t || !q || !s.segments.some(seg => seg.id === t.segmentId && seg.role === 'expert') || t.text.slice(e.start, e.end) !== e.quote) throw new Error('Map needs retained, exact, same-topic expert citations.');
    return { ...e, id: `${e.transcriptId}:${e.start}:${e.end}`, phase: q.phase };
  }) })) });
}

/** Critical applicability passages are verbatim. Paraphrases are explicitly unconfirmed interpretations. */
export function validateMapSynthesis(input: MapInput, value: unknown): MapSynthesis {
  const parsed = MapSynthesisSchema.parse(value);
  if (parsed.rules.length !== input.rules.length || new Set(parsed.rules.map(r => r.id)).size !== parsed.rules.length) throw new Error('Map synthesis must cover exactly the supplied rules.');
  for (const rule of parsed.rules) {
    const original = input.rules.find(r => r.id === rule.id && r.topic === rule.topic);
    if (!original) throw new Error('Map synthesis referenced an unsupplied rule or topic.');
    for (const statement of [rule.decision, rule.rationale]) {
      if (statement.text.trim() && !statement.citations.length) throw new Error('Every synthesized statement needs supplied citations.');
      if (statement.citations.some(id => !original.citations.some(c => c.id === id))) throw new Error('Map synthesis referenced an unsupplied citation.');
    }
    for (const passage of [...rule.conditions, ...rule.exceptions, ...rule.guardrail]) {
      const citation = original.citations.find(c => c.id === passage.citationId);
      if (!citation || passage.end <= passage.start || passage.end > citation.quote.length || citation.quote.slice(passage.start, passage.end) !== passage.text) throw new Error('Map applicability, exceptions and guardrails must be exact supplied passages.');
    }
    if ([rule.conditions, rule.exceptions, rule.guardrail].some(passages => passages.map(p => p.text).join('\n').length > 1500)) throw new Error('Map applicability passages exceed the editable field bound.');
  }
  return parsed;
}

export function mockMapSynthesis(input: MapInput): MapSynthesis {
  return validateMapSynthesis(input, { mode: 'mock-extractive', rules: input.rules.map(rule => {
    const exact = (text: string) => {
      const citation = text ? rule.citations.find(c => c.quote.includes(text)) : undefined;
      if (!citation) return [];
      const start = citation.quote.indexOf(text);
      return [{ citationId: citation.id, start, end: start + text.length, text }];
    };
    return { id: rule.id, topic: rule.topic, decision: { text: rule.decision, citations: rule.citations.map(c => c.id) }, rationale: { text: rule.rationale, citations: rule.citations.map(c => c.id) }, conditions: exact(rule.conditions), exceptions: exact(rule.exceptions), guardrail: exact(rule.guardrail), uncertainties: ['Mock mode: deterministic extraction only. No model synthesized or verified this interpretation.'] };
  }) });
}

/** Reject late results after a correction/deletion; never change evidence or confirmation on a model's behalf. */
export function applyMapSynthesis(s: Session, input: MapInput, value: unknown): Session {
  const result = validateMapSynthesis(input, value);
  const current = s.rules.filter(r => input.rules.some(source => source.id === r.id));
  if (current.some(r => r.status !== 'draft') || JSON.stringify(mapInput(s, current)) !== JSON.stringify(input)) throw new Error('Map evidence or draft changed. Build the current interpretation again.');
  const at = Date.now();
  return { ...s, mapApproved: false, teachBack: undefined, rules: s.rules.map(r => {
    const synthesized = result.rules.find(candidate => candidate.id === r.id);
    if (!synthesized) return r;
    const gaps = (['conditions', 'exceptions', 'guardrail'] as const).filter(field => !synthesized[field].length).map(field => `No explicit ${field} passage was found. Ask the expert; do not infer it.`);
    for (const field of ['decision', 'rationale'] as const) if (!synthesized[field].text.trim()) gaps.push(`No supported ${field} was found. Ask the expert; do not infer it.`);
    return { ...r, decision: synthesized.decision.text, rationale: synthesized.rationale.text, conditions: synthesized.conditions.map(p => p.text).join('\n'), exceptions: synthesized.exceptions.map(p => p.text).join('\n'), guardrail: synthesized.guardrail.map(p => p.text).join('\n'), synthesis: { mode: result.mode, at, uncertainties: [...synthesized.uncertainties, ...gaps], support: { decision: synthesized.decision.citations, rationale: synthesized.rationale.citations, conditions: synthesized.conditions.map(p => p.citationId), exceptions: synthesized.exceptions.map(p => p.citationId), guardrail: synthesized.guardrail.map(p => p.citationId) } }, status: 'draft', history: [...r.history, { at, action: result.mode === 'live-claude' ? 'synthesized' : 'mock-extracted', detail: result.mode === 'live-claude' ? 'Claude drafted a cited interpretation. Conditions, exceptions and guardrails are exact source passages; expert correction, visual support and confirmation remain required.' : 'Deterministic mock extraction. No live synthesis or learned interpretation is claimed.' }] };
  }) };
}
