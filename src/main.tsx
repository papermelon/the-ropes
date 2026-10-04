import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { canAsk, captureStepReady, codedValidations, confirmRule, confirmedRules, debriefQuestions, deleteSegment, draftFromAnswer, hasProvenance, judgmentReady, mapReady, newSession, PrivacyGate, questionProgress, readyToTeach, ReportSchema, SaveGate, topicLabels, performanceStatuses, triggerDescriptions, topics, trainingReport, tutor, uid, type Frame, type Intervention, type Mode, type Question, type Report, type Review, type Rule, type Session, type Topic } from './domain';
import { AnalysisSchema, safeTutorContext } from './providers';
import { ScreenCapture, SpeechActivity } from './capture';
import { LiveVoice, type VoiceState } from './voice';
import { applyMapSynthesis, mapInput, mockMapSynthesis } from './map';
import { createPrivateExport, parsePrivateExport, PRIVATE_FILE_MAX_BYTES } from './private-session';
import './style.css';

type View = 'capture' | 'map' | 'teach';
type Status = { claude: boolean; elevenlabs: boolean; agent: boolean; approved: boolean; liveRequests: number; maxRequests: number; approvedCapUSD: number; committedUSD: number; knownActualUSD: number; unknownHeldUSD: number; remainingUSD: number; disabled: boolean };
const rootPath = '/api/session/';
async function post<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal });
  const data = await response.json(); if (!response.ok) throw new Error(data.error || 'Local API unavailable.'); return data as T;
}
const errorText = (e: unknown) => e instanceof Error ? e.message : 'Unexpected error. Retry deliberately.';
function App() {
  const [view, setView] = useState<View>('capture');
  const [started, setStarted] = useState(false);
  const [setupOpen, setSetupOpen] = useState(false); const [questionOpen, setQuestionOpen] = useState(false); const [toolsOpen, setToolsOpen] = useState(false);
  const [ruleReview, setRuleReview] = useState(false); const [ruleIndex, setRuleIndex] = useState(0);
  const [practiceChoice, setPracticeChoice] = useState<Topic>('delivery'); const [coachingOpen, setCoachingOpen] = useState(false);
  const menu = useRef<HTMLDetailsElement>(null);
  const [session, setSession] = useState<Session>(() => newSession()); const sessionRef = useRef(session);
  const [report, setReport] = useState<Report>(structuredClone(trainingReport)); const reportRef = useRef(report); const expertReport = useRef(structuredClone(trainingReport));
  const [terms, setTerms] = useState({ owner: 'Lead division', period: 'Reporting period', statuses: [...performanceStatuses] as string[] });
  const [teachBackRead, setTeachBackRead] = useState(false);
  const [mapBusy, setMapBusy] = useState(false); const mapping = useRef(false); const starting = useRef(false); const startAttempt = useRef(0);
  const [restored, setRestored] = useState(false);
  const [mode, setMode] = useState<Mode>('mock');
  const [providerStatus, setProviderStatus] = useState<Status>();
  const [screenConsent, setScreenConsent] = useState(false); const [micConsent, setMicConsent] = useState(false);
  const [captureState, setCaptureState] = useState('idle'); const captureStateRef = useRef(captureState);
  const [voiceState, setVoiceState] = useState<VoiceState>('paused'); const voiceStateRef = useRef(voiceState);
  const [preview, setPreview] = useState(''); const [previewConfirmed, setPreviewConfirmed] = useState(false);
  const answerSource = useRef<'typed-expert' | 'scribe' | 'scribe-reviewed'>('typed-expert');
  const [message, setMessage] = useState(''); const [answer, setAnswer] = useState(''); const [currentQuestion, setCurrentQuestion] = useState<Question>(); const questionRef = useRef(currentQuestion);
  const [topic, setTopic] = useState<Topic>('delivery'); const topicRef = useRef(topic);
  const [reading, setReading] = useState(false); const readingRef = useRef(reading);
  const [selectedFrame, setSelectedFrame] = useState<Frame>();
  const [interventions, setInterventions] = useState<Intervention[]>([]); const [hint, setHint] = useState(0);
  const [saveStatus, setSaveStatus] = useState(''); const [saved, setSaved] = useState<Report>(); const [initialAttempt, setInitialAttempt] = useState<Report>(); const [practiceConcerns, setPracticeConcerns] = useState<string[]>([]);
  const [human, setHuman] = useState(false); const [prediction, setPrediction] = useState(''); const [caseTopic, setCaseTopic] = useState<Topic>();
  const caseRequest = useRef(0); const segmentRef = useRef(''); const ticketRef = useRef(''); const gate = useRef(new PrivacyGate()); const saveGate = useRef(new SaveGate());
  const practiceSegments = useRef<string[]>([]);
  const lastUI = useRef(Date.now()); const lastSpeech = useRef(0); const lastAsked = useRef(0); const busyQuestion = useRef(false); const requests = useRef(new Set<AbortController>());
  const automaticQuestionsBlocked = useRef(false);
  const screen = useRef<ScreenCapture | undefined>(undefined); const speech = useRef<SpeechActivity | undefined>(undefined); const voice = useRef<LiveVoice | undefined>(undefined);
  function commit(next: Session | ((s: Session) => Session)) { const value = typeof next === 'function' ? next(sessionRef.current) : next; sessionRef.current = value; setSession(value); }
  function status(value: string) { captureStateRef.current = value; setCaptureState(value); }
  function voiceStatus(value: VoiceState) { voiceStateRef.current = value; setVoiceState(value); }
  function chooseQuestion(q?: Question) { questionRef.current = q; setCurrentQuestion(q); setQuestionOpen(!!q); setAnswer(''); answerSource.current = 'typed-expert'; }
  function activity() { lastUI.current = Date.now(); voice.current?.userActivity(); }
  function refreshProviderStatus() { void fetch('/api/status').then(r => r.json()).then(setProviderStatus).catch(() => setMessage('Provider status unavailable. Do not start paid sessions until restored.')); }
  function stop(reason = 'paused') {
    caseRequest.current++; startAttempt.current++; starting.current = false;
    gate.current.stop(); requests.current.forEach(c => c.abort()); requests.current.clear(); busyQuestion.current = false;
    screen.current?.stop(); speech.current?.stop(); void voice.current?.stop();
    const old = ticketRef.current; ticketRef.current = ''; segmentRef.current = '';
    if (old) void post(`${rootPath}${old}/revoke`, {}).catch(() => setMessage('Local revocation could not be acknowledged. Acquisition stopped; in-flight provider requests may already have been received.'));
    setPreview(''); setPreviewConfirmed(false); setReading(false); readingRef.current = false;
    automaticQuestionsBlocked.current = false; status(reason); voiceStatus(reason === 'off-record' ? 'off-record' : 'paused');
  }
  if (!screen.current) screen.current = new ScreenCapture(() => { stop('sharing stopped'); setMessage('Screen sharing stopped. Tracks and queued work were closed. Re-select the workspace to reconnect.'); });
  if (!speech.current) speech.current = new SpeechActivity();
  if (!voice.current) voice.current = new LiveVoice(voiceStatus, text => {
    if (!gate.current.active || !questionRef.current) return;
    lastSpeech.current = Date.now(); answerSource.current = 'scribe'; setAnswer(a => `${a}${a ? ' ' : ''}${text}`.slice(0,4000));
  }, text => { stop('connection failed'); setMessage(text); voiceStatus('disconnected'); }, () => { lastSpeech.current = Date.now(); }, event => {
    if (!gate.current.active || !segmentRef.current) return;
    const retained = { ...event, at: Date.now(), segmentId: segmentRef.current };
    commit(s => ({ ...s, voiceEvents: [...(s.voiceEvents || []), retained].slice(-120) }));
  });
  useEffect(() => { if (started) document.querySelector<HTMLHeadingElement>('main h1')?.focus(); }, [started, view, ruleReview, ruleIndex, coachingOpen, saved]);
  useEffect(() => {
    void fetch('/api/status').then(r => r.json()).then(setProviderStatus).catch(() => setMessage('Start the local API with npm run dev.'));
    return () => { gate.current.stop(); screen.current?.stop(); speech.current?.stop(); void voice.current?.stop(); requests.current.forEach(c => c.abort()); };
  }, []);
  useEffect(() => {
    const timer = setInterval(() => { if (captureStateRef.current === 'recording' && view === 'capture') void ask(false); }, 1000);
    return () => clearInterval(timer);
  }, [view]);
  function changeReport(next: Report) { if (view === 'capture') expertReport.current = structuredClone(next); reportRef.current = next; setReport(next); saveGate.current.edit(); setSaved(undefined); setSaveStatus(''); activity(); }
  function changeTopic(next: Topic) { topicRef.current = next; setTopic(next); activity(); requestAnimationFrame(() => document.getElementById('task-title')?.focus()); }
  async function selectScreen() {
    if (!screenConsent) { setMessage('Give visible screen consent first.'); return; }
    if (captureStateRef.current === 'selecting') return;
    stop(); status('selecting'); setMessage('');
    const attempt = ++startAttempt.current;
    try { const image = await screen.current!.select(); if (attempt === startAttempt.current) { setPreview(image); status('preview'); } }
    catch (e) { if (attempt === startAttempt.current) { screen.current!.stop(); status('permission denied or device failure'); setMessage(errorText(e)); } }
  }
  async function beginSegment(role: 'expert' | 'novice') {
    const epoch = gate.current.begin(); const controller = new AbortController(); requests.current.add(controller);
    try {
      if (mode === 'live' && micConsent) await voice.current!.prepareMicrophone();
      if (!gate.current.accepts(epoch)) throw new Error('Segment start cancelled.');
      const ticket = await post<{ id: string }>('/api/session', { mode, consent: true }, controller.signal);
      if (!gate.current.accepts(epoch)) { void post(`${rootPath}${ticket.id}/revoke`, {}).catch(() => {}); throw new Error('Segment start cancelled.'); }
      ticketRef.current = ticket.id; segmentRef.current = uid();
      if (role === 'novice') practiceSegments.current.push(segmentRef.current);
      commit(s => ({ ...s, mode, segments: [...s.segments, { id: segmentRef.current, at: Date.now(), role }] }));
      if (micConsent) {
        if (mode === 'mock') await speech.current!.start(() => { lastSpeech.current = Date.now(); }, () => { stop('microphone stopped'); setMessage('Microphone stopped. Your pending answer is retained.'); });
        else {
          const credentials = await post<{ agentPath: string; scribePath: string; maxSeconds: number }>(`${rootPath}${ticket.id}/voice`, {}, controller.signal);
          refreshProviderStatus();
          if (gate.current.accepts(epoch)) await voice.current!.start(credentials);
        }
      }
      if (!gate.current.accepts(epoch)) throw new Error('Segment start cancelled.');
      voiceStatus('listening');
    } finally { requests.current.delete(controller); }
  }
  function appendFrame(image: string, role: 'expert' | 'novice') {
    if (!gate.current.active || !segmentRef.current) return;
    const s = sessionRef.current;
    const pinned = new Set([...s.questions.flatMap(q => q.frameId ? [q.frameId] : []), ...s.rules.flatMap(r => r.evidence.map(e => e.frameId)), ...(selectedFrame ? [selectedFrame.id] : [])]);
    const discard = s.frames.length >= 80 ? s.frames.find(frame => !pinned.has(frame.id)) : undefined;
    if (s.frames.length >= 80 && !discard) { stop('frame limit reached'); setMessage('All 80 retained frames support evidence. Export before beginning another session.'); return; }
    const f: Frame = { id: uid(), segmentId: segmentRef.current, at: Date.now(), image, topic: topicRef.current, observation: 'Actual selected-screen frame; interpretation pending.', mode, role };
    commit(s => ({ ...s, frames: [...s.frames.filter(frame => frame.id !== discard?.id), f] }));
  }
  async function startCapture() {
    if (starting.current || gate.current.active || !previewConfirmed || !screenConsent || (mode === 'live' && !micConsent)) return;
    starting.current = true; const attempt = ++startAttempt.current;
    status('processing');
    try {
      await beginSegment(view === 'teach' ? 'novice' : 'expert');
      if (attempt !== startAttempt.current) return;
      appendFrame(screen.current!.snapshot(), view === 'teach' ? 'novice' : 'expert');
      screen.current!.sample(image => appendFrame(image, view === 'teach' ? 'novice' : 'expert'));
      status('recording'); activity(); setSetupOpen(false); setMessage('On record. Review at your own pace; Still reading holds questions.');
      if (view === 'teach') voice.current?.update(JSON.stringify(safeTutorContext(reportRef.current, confirmedRules(sessionRef.current))));
    } catch (e) { if (attempt === startAttempt.current) { stop('connection failed'); setMessage(errorText(e)); } }
    finally { if (attempt === startAttempt.current) starting.current = false; }
  }
  async function ask(explicit: boolean) {
    const s = sessionRef.current; const now = Date.now();
    if (!explicit && automaticQuestionsBlocked.current) return;
    if (!gate.current.active || captureStateRef.current !== 'recording' || busyQuestion.current || questionRef.current || !canAsk(now, lastUI.current, lastSpeech.current, voiceStateRef.current === 'speaking', readingRef.current, lastAsked.current, explicit)) {
      if (explicit) setMessage('Waiting for quiet, no active speech, and no unanswered question. “Still reading” holds questions.'); return;
    }
    const answered = s.questions.filter(q => q.phase === 'capture' && q.disposition === 'answered').map(q => q.topic);
    if (!explicit && answered.includes(topicRef.current)) return;
    const f = [...s.frames].reverse().find(f => f.topic === topicRef.current && f.role === 'expert' && f.segmentId === segmentRef.current);
    if (!f || now - f.at > 6000) { if (explicit) setMessage('Waiting for a fresh actual screen frame for this review.'); return; }
    busyQuestion.current = true; voiceStatus('processing'); const epoch = gate.current.epoch;
    const controller = new AbortController(); requests.current.add(controller);
    try {
      const data = AnalysisSchema.parse(await post(`${rootPath}${ticketRef.current}/reason`, { frame: f.image, report: reportRef.current, topic: f.topic, previous: s.questions.filter(q => q.phase === 'capture').map(q => q.text).slice(-12) }, controller.signal));
      if (!gate.current.accepts(epoch)) return;
      if (!canAsk(Date.now(), lastUI.current, lastSpeech.current, voiceStateRef.current === 'speaking', readingRef.current, lastAsked.current, explicit)) { setMessage('Analysis arrived during activity; question deferred until another pause.'); return; }
      automaticQuestionsBlocked.current = false;
      const q: Question = { id: uid(), phase: 'capture', topic: f.topic, text: data.question, frameId: f.id, segmentId: f.segmentId, at: Date.now(), guardrail: data.guardrail, disposition: 'asked' };
      commit(current => ({ ...current, frames: current.frames.map(frame => frame.id === f.id ? { ...frame, observation: `${data.observation} ${data.uncertainty}` } : frame), questions: [...current.questions, q] }));
      chooseQuestion(q); lastAsked.current = Date.now(); voice.current?.update(JSON.stringify(data)); voice.current?.ask(q.text);
    } catch (e) { if (gate.current.accepts(epoch)) { automaticQuestionsBlocked.current = true; setMessage(`${errorText(e)} Automatic questions are paused; use Ask now after resolving the error.`); } }
    finally { requests.current.delete(controller); refreshProviderStatus(); if (gate.current.accepts(epoch)) { busyQuestion.current = false; if (voiceStateRef.current === 'processing') voiceStatus('listening'); } }
  }
  function submitAnswer() {
    const q = questionRef.current;
    if (!gate.current.active || !q || !answer.trim() || answer.length > 4000) return;
    const text = answer.trim(); const transcriptId = uid();
    commit(s => ({ ...s, mapApproved: false, transcripts: [...s.transcripts, { id: transcriptId, segmentId: segmentRef.current, at: Date.now(), text, source: answerSource.current, questionId: q.id }], questions: s.questions.map(old => old.id === q.id ? { ...old, disposition: 'answered', transcriptId } : old) }));
    chooseQuestion(); activity(); setMessage('Explanation kept. Your interpretation still needs confirmation.');
  }
  function disposition(value: 'deferred' | 'dismissed') {
    if (!currentQuestion) return;
    commit(s => ({ ...s, questions: s.questions.map(q => q.id === currentQuestion.id ? { ...q, disposition: value } : q) })); chooseQuestion(); activity();
  }
  async function startDebrief() {
    if (starting.current || gate.current.active) return;
    if (!screenConsent || (mode === 'live' && !micConsent)) { setMessage('Consent to the displayed provider routing before recording the debrief.'); return; }
    stop(); starting.current = true; const attempt = ++startAttempt.current; setMessage(''); status('processing');
    try { await beginSegment('expert'); if (attempt === startAttempt.current) { status('recording'); activity(); } }
    catch (e) { if (attempt === startAttempt.current) { stop('connection failed'); setMessage(errorText(e)); } }
    finally { if (attempt === startAttempt.current) starting.current = false; }
  }
  function askDebrief(topic: Topic, text: string) {
    if (!gate.current.active || currentQuestion || !canAsk(Date.now(), lastUI.current, lastSpeech.current, voiceStateRef.current === 'speaking', readingRef.current, lastAsked.current, true)) { setMessage('Wait for a quiet interval before asking the next debrief question.'); return; }
    const q: Question = { id: uid(), phase: 'debrief', topic, text, segmentId: segmentRef.current, at: Date.now(), guardrail: true, disposition: 'asked' };
    commit(s => ({ ...s, questions: [...s.questions, q] })); chooseQuestion(q); voice.current?.ask(text); lastAsked.current = Date.now();
  }
  async function generateMap() {
    if (mapping.current) return;
    if (!mapReady(sessionRef.current)) { setMessage('Complete three distinct Capture answers, including a guardrail, and three new debrief answers first.'); return; }
    if (codedValidations(expertReport.current).length) { setMessage('Finish the expert’s three assessments and reasons before building the input guide.'); return; }
    if (mode === 'live' && (!gate.current.active || !ticketRef.current)) { setMessage('Start the debrief on record before sending retained expert words for synthesis.'); return; }
    setTeachBackRead(false); const oldCount = sessionRef.current.rules.length; setRuleReview(true);
    commit(s => ({ ...s, mapApproved: false, rules: [...s.rules, ...s.questions.filter(q => q.phase === 'capture' && q.disposition === 'answered' && !s.rules.some(r => r.evidence.some(e => e.transcriptId === q.transcriptId))).map(q => draftFromAnswer(s, q))] }));
    setRuleIndex(sessionRef.current.rules.length > oldCount ? oldCount : Math.max(0,sessionRef.current.rules.findIndex(r => r.status === 'draft')));
    mapping.current = true; setMapBusy(true); const epoch = gate.current.epoch; const controller = new AbortController(); requests.current.add(controller);
    try {
      const input = mapInput(sessionRef.current);
      const result = mode === 'mock' ? mockMapSynthesis(input) : await post(`${rootPath}${ticketRef.current}/map`, input, controller.signal);
      if (mode === 'live' && !gate.current.accepts(epoch)) return;
      commit(applyMapSynthesis(sessionRef.current, input, result));
      setMessage(mode === 'live' ? 'Claude drafted a cited interpretation of your Capture and debrief words. Check every statement and missing passage; link supporting screens before approval.' : 'Mock extraction complete. Correct the draft and link supporting screen evidence; no live synthesis is claimed.');
    } catch (e) { if (gate.current.accepts(epoch)) setMessage(`${errorText(e)} Extracted drafts remain for expert correction. No successful synthesis is claimed.`); }
    finally { mapping.current = false; setMapBusy(false); requests.current.delete(controller); refreshProviderStatus(); }
  }
  function updateRule(rule: Rule) { setTeachBackRead(false); saveGate.current.edit(); commit(s => ({ ...s, mapApproved: false, rules: s.rules.map(r => r.id === rule.id ? { ...rule, synthesis: undefined, status: 'draft', history: [...r.history, { at: Date.now(), action: 'corrected', detail: 'Expert edited interpretation; prior confirmation invalidated.' }] } : r) })); }
  function approveRule(id: string) { setTeachBackRead(false); try { commit(confirmRule(sessionRef.current, id)); setMessage('Rule approved by expert.'); } catch (e) { setMessage(errorText(e)); } }
  function rejectRule(id: string) { setTeachBackRead(false); commit(s => ({ ...s, mapApproved: false, rules: s.rules.map(r => r.id === id ? { ...r, status: 'rejected', history: [...r.history, { at: Date.now(), action: 'rejected', detail: 'Expert rejected this interpretation.' }] } : r) })); }
  function spokenTeachBackReady(s: Session) {
    if (mode === 'mock') return true;
    if (!s.teachBack) return false;
    const events = (s.voiceEvents || []).filter(e => e.at >= s.teachBack!.at);
    const speaking = events.findIndex(e => e.type === 'speaking');
    return speaking >= 0 && events.some(e => e.type === 'agent-text') && events.slice(speaking + 1).some(e => e.type === 'listening') && !events.some(e => e.type === 'interrupted' || e.type === 'disconnected') && voiceStateRef.current === 'listening';
  }
  function approveMap() {
    const s = sessionRef.current;
    if (!teachBackRead || !mapReady(s) || !confirmedRules(s).length || s.rules.some(r => r.status === 'draft')) { setMessage('Resolve every draft and confirm at least one evidence-backed rule first.'); return; }
    if (!spokenTeachBackReady(s)) { setMessage('Wait for the live spoken teach-back to finish. If interrupted, request it again, listen and correct it before confirming.'); return; }
    commit({ ...s, mapApproved: true, teachBack: s.teachBack && { ...s.teachBack, confirmedAt: Date.now() } }); voice.current?.update(`The expert confirmed this teach-back: ${JSON.stringify(confirmedRules(s).map(r => ({ decision: r.decision, rationale: r.rationale, guardrail: r.guardrail })))}`); setMessage('Teach-back explicitly confirmed. Unseen human practice is ready.');
  }
  async function loadCase(kind: Topic) {
    if (!readyToTeach(sessionRef.current) || !confirmedRules(sessionRef.current).some(r => r.topic === kind)) return;
    stop(); setScreenConsent(false); setMicConsent(false); practiceSegments.current = []; setCoachingOpen(false); setSetupOpen(false); setSaved(undefined); setInterventions([]); setInitialAttempt(undefined); setPracticeConcerns([]); setPrediction(''); setSaveStatus(''); setCaseTopic(undefined); const requestId = caseRequest.current;
    try {
      const ticket = await post<{ id: string }>('/api/session', { mode: 'mock', consent: true });
      try { const next = ReportSchema.parse(await post(`${rootPath}${ticket.id}/case`, { topic: kind })); if (requestId !== caseRequest.current) return; changeReport(next); changeTopic(kind); setCaseTopic(kind); }
      finally { await post(`${rootPath}${ticket.id}/revoke`, {}); }
    } catch (e) { setMessage(errorText(e)); }
  }
  async function save() {
    if (!readyToTeach(sessionRef.current) || !caseTopic) { setSaveStatus('Not ready: confirm the Work Map and load a matching unseen case.'); return; }
    if (!prediction.trim()) { setSaveStatus('Explain what you will check before sending this update.'); return; }
    if (!gate.current.active || !screen.current?.stream) { setSaveStatus('Start novice screen sharing before the pre-save check.'); return; }
    let revision: number;
    try { revision = saveGate.current.begin(); } catch (e) { setSaveStatus(errorText(e)); return; }
    setSaveStatus('Checking this report revision before save…');
    const epoch = gate.current.epoch; const mapSnapshot = JSON.stringify(sessionRef.current.rules);
    const candidate = structuredClone(reportRef.current);
    try {
      appendFrame(screen.current.snapshot(), 'novice');
      voice.current?.update(JSON.stringify(safeTutorContext(candidate, confirmedRules(sessionRef.current))));
      // Async boundary models a provider check and keeps newer edits from being saved unchecked.
      await new Promise(resolve => setTimeout(resolve, 250));
      if (!saveGate.current.finish(revision) || !gate.current.accepts(epoch) || mapSnapshot !== JSON.stringify(sessionRef.current.rules) || !readyToTeach(sessionRef.current)) { setSaveStatus('Report, evidence or recording changed. Check the current revision again.'); return; }
      const errors = codedValidations(candidate);
      if (errors.length) { setSaveStatus(`Coded validation: ${errors.join(' ')}`); return; }
      const caught = tutor(candidate, sessionRef.current);
      if (caught.length) { setInterventions(caught); setCoachingOpen(true); setHint(0); setInitialAttempt(old => old || candidate); setPracticeConcerns(old => [...new Set([...old, ...caught.map(c => c.question)])]); setSaveStatus('Paused before save · an expert-confirmed guardrail needs your decision.'); voice.current?.ask(caught[0].question); return; }
      commit(s => ({ ...s, practices: [...s.practices, { at: Date.now(), segmentIds: [...practiceSegments.current], humanSelfDeclared: human, prediction, firstAttempt: initialAttempt || candidate, savedDraft: candidate, concerns: practiceConcerns, ruleIds: confirmedRules(s).map(r => r.id) }] }));
      setInterventions([]); setCoachingOpen(false); setSaved(candidate); setSaveStatus('Checked update saved locally for this practice.'); stop('off-record'); setMessage('');
    } catch (e) { saveGate.current.finish(revision); setSaveStatus(errorText(e)); }
  }
  function navigate(next: View) { if (questionRef.current && next !== view) { setMessage('Your pending answer is retained. Keep it, Ask later or Skip question before changing stages.'); if (menu.current) menu.current.open = false; return; } stop(); if ((next === 'teach') !== (view === 'teach')) { setScreenConsent(false); setMicConsent(false); } setStarted(true); setSetupOpen(false); setToolsOpen(false); setCoachingOpen(false); if (menu.current) menu.current.open = false; saveGate.current.edit(); if (next === 'capture') changeReport(structuredClone(expertReport.current)); if (next === 'map') { const draft = sessionRef.current.rules.findIndex(r => r.status === 'draft'); setRuleIndex(Math.max(0,draft)); setRuleReview(draft >= 0); } setView(next); setMessage(''); }
  function reset() { setStarted(false); setSetupOpen(false); setQuestionOpen(false); setToolsOpen(false); setRuleReview(false); setRuleIndex(0); setCoachingOpen(false); if (menu.current) menu.current.open = false; setSelectedFrame(undefined); setHuman(false); setScreenConsent(false); setMicConsent(false); practiceSegments.current = []; setPrediction(''); changeTopic('delivery'); expertReport.current = structuredClone(trainingReport); setTeachBackRead(false); stop(); chooseQuestion(); setRestored(false); saveGate.current.edit(); commit(newSession(mode)); changeReport(structuredClone(trainingReport)); setCaseTopic(undefined); setSaved(undefined); setInterventions([]); setInitialAttempt(undefined); setPracticeConcerns([]); setView('capture'); status('idle'); setMessage(''); }
  function removeSegment(id: string) { setSelectedFrame(undefined); setTeachBackRead(false); setRuleIndex(0); setRuleReview(true); stop('paused'); saveGate.current.edit(); const next = deleteSegment(sessionRef.current, id); commit(next); practiceSegments.current = practiceSegments.current.filter(id => next.segments.some(seg => seg.id === id)); if (questionRef.current && !next.questions.some(q => q.id === questionRef.current!.id)) chooseQuestion(); setSaved(undefined); setInitialAttempt(undefined); setPracticeConcerns([]); setInterventions([]); setMessage('Segment, dependent questions/transcripts and unsupported rules deleted locally. Remaining changed rules need re-confirmation. Remote deletion is not asserted.'); }
  function exportSession() {
    try {
      const data = createPrivateExport(sessionRef.current, { view, topic, report: reportRef.current, expertReport: expertReport.current, human, prediction, caseTopic, pendingQuestionId: questionRef.current?.id, answer, answerSource: answerSource.current, initialAttempt, saved, practiceConcerns, practiceSegments: practiceSegments.current });
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      if (blob.size > PRIVATE_FILE_MAX_BYTES) throw new Error('Private export exceeds the 64 MB limit. Export a smaller session.');
      const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'private-work-map.json'; a.click(); URL.revokeObjectURL(url);
    } catch (e) { setMessage(errorText(e)); }
  }
  async function restoreSession(file?: File) {
    if (!file) return;
    stop('off-record'); const attempt = ++startAttempt.current;
    try {
      if (file.size > PRIVATE_FILE_MAX_BYTES) throw new Error('Private file exceeds the 64 MB limit.');
      const text = await file.text(); if (attempt !== startAttempt.current) return;
      const data = parsePrivateExport(text); const resume = data.resume;
      chooseQuestion(); setSelectedFrame(undefined); setScreenConsent(false); setMicConsent(false); setTeachBackRead(false); setRestored(true); saveGate.current.edit();
      commit({ id: data.id, createdAt: data.createdAt, mode: data.mode, segments: data.segments, frames: data.frames, transcripts: data.transcripts, questions: data.questions, rules: data.rules, practices: data.practices, voiceEvents: data.voiceEvents, mapApproved: false, teachBack: data.teachBack });
      setMode(data.mode); expertReport.current = resume.expertReport; reportRef.current = resume.report; setReport(resume.report); topicRef.current = resume.topic; setTopic(resume.topic); setHuman(resume.human); setPrediction(resume.prediction); setCaseTopic(resume.caseTopic); setInitialAttempt(resume.initialAttempt); setSaved(resume.saved); setPracticeConcerns(resume.practiceConcerns); practiceSegments.current = resume.practiceSegments;
      const pending = data.questions.find(q => q.id === resume.pendingQuestionId);
      chooseQuestion(pending); setAnswer(resume.answer); answerSource.current = resume.answerSource;
      setView(pending ? (pending.phase === 'capture' ? 'capture' : 'map') : data.rules.length ? 'map' : resume.view); setStarted(true); setSetupOpen(false); setToolsOpen(false); setRuleIndex(Math.max(0, data.rules.findIndex(r => r.status === 'draft'))); setRuleReview(data.rules.some(r => r.status === 'draft')); setInterventions([]); setCoachingOpen(false); setSaveStatus('');
      setMessage('Private evidence restored as historical. Nothing is recording. Give fresh consent to resume; present and confirm the teach-back again before new practice.');
    } catch (e) { if (attempt === startAttempt.current) setMessage(errorText(e)); }
  }
  const progress = questionProgress(session); const currentRules = confirmedRules(session);
  const teachBack = currentRules.map(r => `${r.title}. ${r.decision} Applies when: ${r.conditions}. Exceptions: ${r.exceptions}. Why: ${r.rationale}. Stop or check: ${r.guardrail}.`).join(' Then ');
  function readTeachBack() {
    if ((mode === 'live' && !gate.current.active) || !teachBack || session.rules.some(r => r.status === 'draft')) { setMessage('Start the debrief on record and resolve drafts before the teach-back.'); return; }
    if (mode === 'live' && (!micConsent || voiceStateRef.current === 'disconnected' || !voice.current?.conversation)) { setMessage('Reconnect live voice for the spoken teach-back.'); return; }
    if (mode === 'live' && (voiceStateRef.current === 'speaking' || voiceStateRef.current === 'processing')) { setMessage('Wait for the current voice turn to finish before requesting the teach-back.'); return; }
    commit(s => ({ ...s, mapApproved: false, teachBack: { at: Date.now(), summary: teachBack, delivery: mode === 'mock' ? 'simulated-text' : 'spoken-request' } }));
    voice.current?.update(JSON.stringify({ role: 'expert teach-back', proposedSummary: teachBack }));
    if (mode === 'live') { voiceStatus('processing'); voice.current?.teachBack(teachBack); }
    setTeachBackRead(true);
    setMessage(mode === 'mock' ? 'Simulated teach-back presented below. Read it, correct any interpretation, then explicitly confirm. No spoken delivery is claimed.' : 'Spoken teach-back requested. Listen, correct any interpretation, then explicitly confirm.');
  }
  function chooseMode(next: Mode) {
    if (sessionRef.current.frames.length || next === mode) return;
    stop(); setScreenConsent(false); setMicConsent(false); setTeachBackRead(false); setMode(next); commit(newSession(next));
  }
  function ModeChoice() { return <label>Session mode<select aria-label="Session mode" value={mode} disabled={session.frames.length > 0} onChange={e => chooseMode(e.target.value as Mode)}><option value="mock">Mock · text only · no API spend</option><option value="live" disabled={!providerStatus?.approved || !providerStatus?.claude || !providerStatus?.elevenlabs || !providerStatus?.agent}>Live · ElevenLabs voice + Claude screen reasoning</option></select><small>{session.frames.length ? 'Mode stays fixed once evidence is captured. Start a new session to change it.' : 'Choose before recording. Live requires configured providers and your approved cap.'}</small></label>; }
  function PrivacyConsent() { return <div className="consent-inline"><h3>{view === 'teach' ? 'Division officer’s consent · a new participant' : 'Expert’s consent'}</h3><p className="fine">{mode === 'mock' ? 'Selected screen → local mock analysis. Microphone → local activity meter only.' : 'JPEG screen frames, report context and retained expert words → our server → Anthropic. Microphone → our server → ElevenAgents and ElevenLabs Scribe. Review/confirmed-rule context → ElevenAgents. On Render, this server relay is hosted by Render.'}</p><label className="check"><input type="checkbox" checked={screenConsent} onChange={e => { if (!e.target.checked) stop('off-record'); setScreenConsent(e.target.checked); }}/>I consent to selected screen preview/capture and the provider routing shown above.</label><label className="check"><input type="checkbox" checked={micConsent} onChange={e => { if (!e.target.checked) stop('off-record'); setMicConsent(e.target.checked); }}/>I consent to microphone acquisition. In live mode, audio goes to ElevenLabs through the routes above.</label><details><summary>Privacy & retention</summary><p>Choose only this fictional workspace. Check the preview. Off record stops acquisition, connections and queued results. Frames and retained answers stay in browser memory until private export; refresh clears this tab. Restore is explicit and requires fresh consent and teach-back confirmation. Providers may retain transmitted data. Local deletion does not prove remote deletion. Other tabs are not automatically redacted.</p></details></div>; }
  const nextFollowup = debriefQuestions(session).find(q => !session.questions.some(old => old.phase === 'debrief' && old.text === q.text && old.disposition === 'answered'));
  const practiceTopics = currentRules.map(r => r.topic).filter((t, i, all) => all.indexOf(t) === i);
  const practiceKind = practiceTopics.includes(practiceChoice) ? practiceChoice : practiceTopics[0];
  const activeRule = session.rules[ruleIndex];
  const hasNewDemonstration = session.questions.some(q => q.phase === 'capture' && q.disposition === 'answered' && !session.rules.some(r => r.evidence.some(e => e.transcriptId === q.transcriptId)));
  const concern = interventions[0];
  const concernRule = concern && session.rules.find(r => r.id === concern.ruleId);
  return <>
    <a className="skip" href="#main">Skip to session</a>
    <header className="top">
      <a className="brand" href="/" aria-label="The Ropes home"><span className="mark" aria-hidden="true">r</span>The Ropes</a>
      <div className="top-actions"><span className="mode-badge">{mode === 'mock' ? 'Mock · text only' : 'Live · ElevenLabs'}</span>
        <details className="session-menu" ref={menu}><summary aria-label="Session menu">Session <span aria-hidden="true">⌄</span></summary><nav aria-label="Session navigation">
          <button onClick={() => navigate('capture')}>Capture expertise</button><button onClick={() => navigate('map')}>Map the judgment</button><button onClick={() => navigate('teach')}>Teach a new case</button>
          <button onClick={() => { if (menu.current) menu.current.open = false; setToolsOpen(true); }}>Evidence & settings</button><button onClick={reset}>New session</button>
        </nav></details>
      </div>
    </header>
    <main id="main" className={!started ? 'welcome' : 'guided-session'}>
      {!started ? <section className="welcome-scene">
        <div className="welcome-copy"><div className="eyebrow">FOR STRATEGY & PERFORMANCE TEAMS</div><h1 tabIndex={-1}>Better inputs.<br/><em>Shared understanding.</em></h1><p className="lead">Show how you review an initiative update. The Ropes learns your reasoning, then helps division officers prepare the inputs you need.</p>
          <button className="primary begin" onClick={() => { setStarted(true); activity(); }}>Begin expert review <span aria-hidden="true">↗</span></button><p className="session-promise">One fictional initiative · screen & voice when you choose<br/>Nothing is recording. Knowledge starts empty.</p>
          <div className="journey-preview"><span><b>01</b> Show your review</span><span><b>02</b> Confirm the guidance</span><span><b>03</b> Help a colleague</span></div>
        </div>
        <div className="artifact-scene" aria-label="Illustrative preview of a fictional initiative review">
          <div className="review-pack">
            <span className="folder-tab">Q2 / REVIEW PACK</span>
            <article className="case-preview">
              <span className="binder-clip" aria-hidden="true"/>
              <div className="paper-label">INITIATIVE UPDATE <span className="review-stamp">FOR REVIEW</span></div>
              <h2>{report.initiative}</h2>
              <dl className="preview-meta"><div><dt>Prepared by</dt><dd>Service Design Division</dd></div><div><dt>Reporting period</dt><dd>{report.period}</dd></div></dl>
              <div className="preview-status"><span>Submitted status</span><span className="status-tag">{report.submittedStatus}</span></div>
              <div className="preview-quote"><span className="eyebrow">PROGRESS THIS QUARTER</span><ol><li>3 partner discussions.</li><li>Handover template drafted.</li><li><mark>March launch forecast.</mark></li></ol></div>
              <div className="preview-benchmark"><span className="eyebrow">QUARTERLY BENCHMARK</span><p>{report.milestones.find(m => m.quarter === report.currentQuarter)?.statement}</p></div>
              <span className="paper-footnote">Fictional case · illustration, not learned guidance</span>
            </article>
            <aside className="review-sticky"><span>ONE QUESTION</span><p>What would you<br/>need to know?</p><span className="sticky-arrow" aria-hidden="true">↖</span></aside>
          </div>
          <div className="learning-note"><div className="voice-orb" aria-hidden="true"><span/><span/><span/><span/><span/></div><div><span className="eyebrow">FROM YOUR EXPERIENCE</span><p>Your explanation becomes<br/><strong>guidance a colleague can use.</strong></p></div></div>
        </div>
        <div className="welcome-purpose"><span className="purpose-line" aria-hidden="true"/><p>You know what a useful update looks like.<br/><strong>Help your team see what you see.</strong></p><span className="purpose-detail">The reviewer teaches.<br/>The reporting officer prepares.</span></div>
      </section> : <>
        <div className="phase-line"><span>{view === 'capture' ? '01 / LEARN YOUR REVIEW' : view === 'map' ? '02 / CONFIRM THE UNDERSTANDING' : '03 / PREPARE A DIVISION UPDATE'}</span><span>{view === 'capture' ? `${Math.min(topics.indexOf(topic) + 1,3)} of 3 judgments` : view === 'map' ? `${currentRules.length} confirmed rules` : 'Unseen fictional initiative'}</span></div>
        {!setupOpen && !toolsOpen && Notice()}{restored && <p className="fine" role="status">Historical evidence imported · a replay is not a new human validation. Fresh recording and consent are required for new practice.</p>}
        {view === 'teach' && !saved && !coachingOpen && saveStatus && <div className="notice" role="status">{saveStatus}</div>}
        {view === 'capture' && <InitiativeWorkbench report={report} onChange={changeReport} terms={terms} topic={topic} onTopic={changeTopic} phase="capture" pendingQuestion={!!currentQuestion} captureReady={captureStepReady(session,report,topic) && (topic !== 'readiness' || (progress.capture >= 3 && progress.guardrail))} onDone={() => navigate('map')}/>}
        {view === 'map' && MapTask()}
        {view === 'teach' && (!readyToTeach(session) ? <section className="focused-message"><div className="large-orb" aria-hidden="true">a</div><h1 tabIndex={-1}>Not ready to teach.</h1><p>First, capture the expert’s reasoning, confirm the evidence-backed interpretations, and confirm the teach-back.</p><button className="primary" onClick={() => navigate('map')}>Return to the Work Map →</button></section> : saved ? <PracticeResult historical={restored} saved={saved} firstAttempt={initialAttempt || saved} concerns={practiceConcerns} human={human} prediction={prediction} topic={caseTopic} onExport={exportSession} onAgain={() => { stop(); setCaseTopic(undefined); setSaved(undefined); }}/>
 : coachingOpen && concern && concernRule ? <section className="focused-message coaching-moment"><div className="eyebrow">PAUSED BEFORE SAVE · EXPERT-CONFIRMED REASONING</div><div className="voice-orb" aria-hidden="true"><span/><span/><span/><span/><span/></div><h1 tabIndex={-1}>{concern.question}</h1><p>{concern.reason}</p><blockquote>“{concernRule.evidence[0].quote}”<small>The expert’s exact words · {topicLabels[concern.topic]}</small></blockquote><div className="evidence-actions"><button className="text-button" onClick={() => setSelectedFrame(session.frames.find(f => f.id === concernRule.evidence[0].frameId))}>Replay expert frame ↗</button><button className="text-button" onClick={() => setHint(h => Math.min(h + 1,3))}>Show a hint</button></div>{hint > 0 && <p className="hint">{concern.hints[Math.min(hint - 1,2)]}</p>}<p className="fine">{saveStatus}</p><button className="primary" onClick={() => { setCoachingOpen(false); changeTopic(concern.topic); }}>Return to my update →</button></section> : !caseTopic ? <section className="focused-message handoff"><div className="eyebrow">HAND THE SESSION TO A DIVISION OFFICER</div><h1 tabIndex={-1}>Help a colleague<br/>prepare better inputs.</h1><p>You taught The Ropes what matters in a review. Now a division reporting or planning officer prepares an update for a different initiative.</p><label className="check"><input type="checkbox" checked={human} onChange={e => setHuman(e.target.checked)}/>A separate human colleague is preparing this update (self-declared; not independently verified).</label><label>Principle to practise<select aria-label="Principle to practise" value={practiceKind || ''} onChange={e => setPracticeChoice(e.target.value as Topic)}>{practiceTopics.map(t => <option key={t} value={t}>{topicLabels[t]}</option>)}</select></label><button className="primary" disabled={!practiceKind} onClick={() => void loadCase(practiceKind)}>Open unseen initiative →</button><p className="fine">{human ? 'The colleague writes their own draft and gives fresh consent before sharing.' : 'Development role simulation until a separate human participates.'} The draft starts empty.</p></section> : <InitiativeWorkbench report={report} onChange={changeReport} terms={terms} topic={topic} onTopic={changeTopic} phase="teach">
          <section className="save-panel"><label>Before you send, what will you check?<textarea maxLength={1500} value={prediction} onChange={e => { setPrediction(e.target.value); activity(); }} placeholder="Which benchmark, evidence or dependency will you verify before sending?"/></label><button className="primary full" disabled={saveGate.current.busy} onClick={() => void save()}>Check & save update →</button>{interventions.length > 0 && <button className="text-button" onClick={() => setCoachingOpen(true)}>Revisit the expert’s concern ↗</button>}</section>
        </InitiativeWorkbench>)}
      </>}
    </main>
    {started && (gate.current.active || !(view === 'teach' && (!readyToTeach(session) || !caseTopic || saved || coachingOpen))) && <aside className="voice-dock" aria-label="The Ropes recording controls">
      {VoicePanel()}<div className="dock-controls">
        {gate.current.active ? <><label className="check hold"><input type="checkbox" checked={reading} onChange={e => { readingRef.current = e.target.checked; setReading(e.target.checked); activity(); }}/>Still reading / thinking</label>{view === 'capture' && <button className="text-button" onClick={() => void ask(true)}>Ask now</button>}<button className="off-record" onClick={() => stop('off-record')}>■ Off record</button></> : view === 'map' && (!screenConsent || (mode === 'live' && !micConsent)) ? <button className="dock-action" onClick={() => { setMessage(''); setSetupOpen(true); }}>Review debrief consent</button> : view === 'map' ? <button className="dock-action" disabled={!screenConsent || progress.capture < 3 || !progress.guardrail || (mode === 'live' && !micConsent) || captureState === 'processing'} onClick={() => void startDebrief()}>Start debrief on record</button> : <button className="dock-action" onClick={() => { setMessage(''); setSetupOpen(true); }}>{captureState === 'off-record' || captureState.includes('stopped') || captureState === 'connection failed' ? 'Reconnect screen' : 'Set up screen & voice'}</button>}
        {view === 'capture' && currentQuestion && <button className="dock-action question-ready" onClick={() => setQuestionOpen(open => !open)}>Answer question <span aria-hidden="true">↗</span></button>}
      </div>
    </aside>}
    {started && view === 'capture' && currentQuestion && questionOpen && <aside className="question-sheet" aria-label="The Ropes question"><button className="sheet-close" aria-label="Minimise question" onClick={() => setQuestionOpen(false)}>−</button>{QuestionCard()}</aside>}
    {setupOpen && <SessionDialog title="Let The Ropes observe" onClose={() => { stop('off-record'); setSetupOpen(false); }}><p className="dialog-intro">Share only this fictional workspace. Check the preview before recording begins.</p>{Notice()}{ModeChoice()}{PrivacyConsent()}{view === 'map' ? <button className="primary full" disabled={captureState === 'processing' || !screenConsent || (mode === 'live' && !micConsent)} onClick={() => { setSetupOpen(false); void startDebrief(); }}>Start debrief on record</button> : <CaptureControls/>}</SessionDialog>}
    {toolsOpen && <SessionDialog title="Session evidence & settings" onClose={() => setToolsOpen(false)}>{Notice()}{gate.current.active && <button className="danger" onClick={() => stop('off-record')}>Off record · stop acquisition</button>}{Timeline()}
      <details className="panel diagnostics"><summary>Session controls & provider diagnostics <span className="pill">{mode === 'mock' ? 'Simulated providers' : 'Live providers'}</span></summary><div className="diagnostic-grid"><section>{ModeChoice()}<ul className="provider-list">{[['Claude reasoning', providerStatus?.claude], ['ElevenLabs API', providerStatus?.elevenlabs], ['Expressive agent ID', providerStatus?.agent], ['Approved usage cap', providerStatus?.approved]].map(([label, configured]) => <li key={String(label)}><span>{label}</span><span className={configured ? 'pill ok' : 'pill'}>{configured ? 'configured' : 'not configured'}</span></li>)}</ul><p className="fine">Changing provider mode starts a fresh session; export evidence and use New session first. Earlier provider smoke used synthetic audio. The revised relay and full human voice/screen loop still require rehearsal. Provider API keys stay on the server; only one-use, bounded app voice access reaches this tab.</p>{providerStatus && <p className="fine">Budget: US${providerStatus.committedUSD?.toFixed(2)} used/held of US${providerStatus.approvedCapUSD?.toFixed(2)} · US${providerStatus.remainingUSD?.toFixed(2)} available for reservations. {providerStatus.liveRequests}/{providerStatus.maxRequests} new metered requests. Provider charges beyond verified metadata remain unknown.{providerStatus.disabled && ' Live usage disabled.'}</p>}</section><section><h3>Private evidence</h3><p>Export before refreshing. The private file retains screen pixels, exact words, pending answers and practice drafts. Restore requires fresh consent and teach-back confirmation.</p><button className="secondary" onClick={exportSession} disabled={!session.frames.length}>Export private Work Map</button><label>Restore private Work Map<input type="file" accept="application/json,.json" onChange={e => { void restoreSession(e.target.files?.[0]); e.target.value = ''; }}/></label>{restored && <p className="fine">Imported evidence is historical. This session does not establish a new human rehearsal.</p>}</section><section><h3>Local terminology</h3><p className="fine">Display labels only. Proposed guidance still needs expert confirmation; labels do not establish agency policy.</p><label>Owner field label<input value={terms.owner} maxLength={60} onChange={e => setTerms({ ...terms, owner: e.target.value })}/></label><label>Period field label<input value={terms.period} maxLength={60} onChange={e => setTerms({ ...terms, period: e.target.value })}/></label>{performanceStatuses.map((st,i) => <label key={st}>{st} display label<input value={terms.statuses[i]} maxLength={40} onChange={e => setTerms({ ...terms, statuses: terms.statuses.map((old,j) => i === j ? e.target.value : old) })}/></label>)}</section></div></details>
      <details className="panel framework"><summary>RBM & Theory of Change · reference, coded checks and learned judgment</summary><Reference/></details>

    </SessionDialog>}
    {selectedFrame && <EvidenceDialog frame={selectedFrame} onClose={() => setSelectedFrame(undefined)}/>}
    <footer className="session-footer">Fictional records · proposed guidance for expert confirmation <span>Held in this tab · export privately before refreshing.</span></footer>
  </>;
  function Notice() { return message && <div className="notice" role="status">{message}<button aria-label="Dismiss status message" onClick={() => setMessage('')}>×</button></div>; }
  function CaptureControls() {
    return <section className="capture-controls"><button className={preview ? 'secondary full' : 'primary full'} disabled={!screenConsent || captureState === 'selecting' || captureState === 'processing'} onClick={() => void selectScreen()}>{captureState === 'off-record' || captureState.includes('stopped') ? 'Reconnect screen' : 'Share review workspace'}</button>{preview && <div className="preview"><img src={preview} alt="Selected screen preview, not recorded or sent to providers"/><label className="check"><input type="checkbox" checked={previewConfirmed} onChange={e => setPreviewConfirmed(e.target.checked)}/>This preview shows only the fictional initiative workspace.</label><button className="primary full" disabled={captureState === 'processing' || !previewConfirmed || (mode === 'live' && !micConsent)} onClick={() => void startCapture()}>Start on record →</button></div>}</section>;
  }
  function VoicePanel() { return <div className="voice" data-state={voiceState}><div className="voice-orb" aria-hidden="true"><span/><span/><span/><span/><span/></div><div><strong>{captureState === 'recording' ? 'On record' : captureState === 'idle' ? 'Nothing is recording' : captureState === 'off-record' ? 'Off record' : captureState === 'preview' ? 'Preview only' : captureState === 'processing' ? 'Connecting' : captureState === 'selecting' ? 'Choosing a screen' : captureState.charAt(0).toUpperCase() + captureState.slice(1)}</strong><p>{mode === 'mock' ? 'The Ropes · mock · text only' : `ElevenLabs · ${voiceState}`}{view === 'capture' && ` · ${progress.capture}/3 explanations`}</p></div></div>; }
  function QuestionCard() { return <div className="question"><div className="eyebrow">{view === 'map' ? 'A NEW DEBRIEF QUESTION' : 'THE ROPES ASKS'}</div>{currentQuestion && <><h2>{currentQuestion.text}</h2>{currentQuestion.frameId && <button className="text-button" onClick={() => setSelectedFrame(session.frames.find(f => f.id === currentQuestion.frameId))}>View linked screen moment ↗</button>}<label>Expert answer · exact words<textarea maxLength={4000} value={answer} onChange={e => { answerSource.current = answerSource.current === 'typed-expert' ? 'typed-expert' : 'scribe-reviewed'; setAnswer(e.target.value); activity(); }} placeholder={mode === 'mock' ? 'Explain the judgment in your own words…' : 'Review the Scribe transcript before keeping it…'}/></label><button className="primary full" disabled={!gate.current.active || !answer.trim()} onClick={submitAnswer}>Keep this explanation →</button><div className="question-options"><button className="text-button" onClick={() => disposition('deferred')}>Ask later</button><button className="text-button" onClick={() => disposition('dismissed')}>Skip question</button></div></>}</div>; }
  function MapTask() {
    if (!session.rules.length && (!topics.every(t => captureStepReady(session,expertReport.current,t)) || !progress.guardrail)) return <section className="focused-message"><div className="eyebrow">CAPTURE COMES FIRST</div><h1 tabIndex={-1}>Show me your reasoning first.</h1><p>Complete the three review assessments and keep a screen-linked explanation for each, including when to stop or ask for evidence. Then we can debrief the reasoning.</p><p className="fine">{progress.capture}/3 explanations kept · {progress.guardrail ? 'guardrail discussed' : 'guardrail pending'}</p><button className="primary" onClick={() => navigate('capture')}>Return to the expert review →</button></section>;
    if (!session.rules.length) return <section className="focused-message debrief-task"><div className="eyebrow">{progress.debrief < 3 ? `DEBRIEF · ${Math.min(progress.debrief + 1,3)} OF 3` : 'EXPLANATIONS CAPTURED'}</div><h1 tabIndex={-1}>{progress.debrief < 3 ? 'Tell me what I’m missing.' : 'Let me teach it back.'}</h1>{currentQuestion ? QuestionCard() : nextFollowup ? <><p className="debrief-question">{nextFollowup.text}</p><button className="primary" disabled={!gate.current.active} onClick={() => askDebrief(nextFollowup.topic,nextFollowup.text)}>Ask this follow-up →</button></> : <><p>I will combine your Capture explanations and debrief clarifications into an editable input guide. The draft uses your words; you correct it and confirm its visual support.</p><button className="primary" disabled={mapBusy || !mapReady(session)} onClick={() => void generateMap()}>Build editable teach-back →</button>{!mapReady(session) && <p className="fine">Capture still needs three distinct explanations and a guardrail. <button className="text-button" onClick={() => navigate('capture')}>Return to the expert review</button></p>}</>}<p className="fine">{progress.capture}/3 Capture explanations · {progress.debrief}/3 new debrief answers · {progress.guardrail ? 'guardrail discussed' : 'guardrail pending'}</p></section>;
    if (ruleReview && activeRule) return <section className="rule-task"><div className="guided-heading"><div className="eyebrow">INTERPRETATION {ruleIndex + 1} OF {session.rules.length} · {topicLabels[activeRule.topic]}</div><h1 tabIndex={-1}>Did I understand you?</h1><p>Check the draft extracted from your Capture and debrief explanations. Link each clarification to the screen moment it supports. New ideas need a new demonstration.</p></div><div className="new-demonstration">{mode === 'live' && session.rules.some(r => r.status === 'draft') && <button className="secondary" disabled={mapBusy || !gate.current.active} onClick={() => void generateMap()}>Retry cited synthesis</button>}{mapBusy && <p className="fine" role="status">Building the cited interpretation…</p>}{hasNewDemonstration && <button className="secondary" disabled={mapBusy} onClick={() => void generateMap()}>Include new demonstration →</button>}</div><RuleCard onDemonstrate={() => { changeTopic(activeRule.topic); navigate('capture'); }} rule={activeRule} session={session} onChange={updateRule} onApprove={() => approveRule(activeRule.id)} onReject={() => rejectRule(activeRule.id)} onFrame={setSelectedFrame}/><button className="primary" disabled={activeRule.status === 'draft'} onClick={() => { if (ruleIndex + 1 < session.rules.length) setRuleIndex(i => i + 1); else setRuleReview(false); }}>{ruleIndex + 1 < session.rules.length ? 'Next interpretation →' : 'Hear the full teach-back →'}</button></section>;
    return <section className="teach-back-task"><div className="guided-heading"><div className="eyebrow">THE EXPERT’S CONFIRMATION</div><h1 tabIndex={-1}>{session.mapApproved ? 'Ready to pass it on.' : 'Here’s what I learned.'}</h1><p>{session.mapApproved ? 'A division officer can now use this guidance to prepare an update for an unseen initiative.' : 'Hear the reasoning, check the evidence, and tell me what needs correcting.'}</p></div><div className="teach-back-list">{currentRules.map(r => <article key={r.id}><h2>{topicLabels[r.topic]}</h2><p>{r.decision}</p><p><strong>Why:</strong> {r.rationale}</p><details><summary>Conditions, exceptions & evidence</summary><p><strong>Applies when:</strong> {r.conditions}</p><p><strong>Exceptions:</strong> {r.exceptions}</p><p><strong>Stop or check:</strong> {r.guardrail}</p>{r.evidence.map(e => <blockquote key={e.transcriptId}>“{e.quote}”<small>Exact span {e.start}–{e.end}</small><button className="text-button" onClick={() => setSelectedFrame(session.frames.find(f => f.id === e.frameId))}>View supporting frame ↗</button></blockquote>)}</details><button className="text-button" aria-label={`Edit ${topicLabels[r.topic].toLowerCase()} rule`} onClick={() => { setRuleIndex(session.rules.findIndex(rule => rule.id === r.id)); setRuleReview(true); }}>Correct this interpretation ↗</button></article>)}</div>{session.rules.some(r => r.status === 'rejected') && <details className="excluded-rules"><summary>Excluded interpretations ({session.rules.filter(r => r.status === 'rejected').length})</summary><p>Rejected interpretations do not teach the novice. You can revisit them here.</p>{session.rules.filter(r => r.status === 'rejected').map(r => <button key={r.id} className="text-button" aria-label={`Review excluded ${topicLabels[r.topic].toLowerCase()} rule`} onClick={() => { setRuleIndex(session.rules.findIndex(rule => rule.id === r.id)); setRuleReview(true); }}>Review {topicLabels[r.topic].toLowerCase()} interpretation ↗</button>)}</details>}<div className="teach-back-actions">{!session.mapApproved ? <><button className={teachBackRead ? 'secondary' : 'primary'} disabled={!currentRules.length || session.rules.some(r => r.status === 'draft') || (mode === 'live' && !gate.current.active)} onClick={readTeachBack}>{mode === 'mock' ? 'Present simulated teach-back' : 'Speak the teach-back'}</button>{teachBackRead && <button className="primary" onClick={approveMap} disabled={!currentRules.length || session.rules.some(r => r.status === 'draft') || !mapReady(session) || !spokenTeachBackReady(session)}>Yes, this is how I review · confirm teach-back</button>}</> : <><span className="confirmed-note">Teach-back confirmed ✓</span><button className="primary" onClick={() => navigate('teach')}>Help a colleague prepare →</button></>}<p className="fine">{mode === 'mock' ? 'Text presentation in mock mode; no spoken delivery is claimed.' : 'Confirm after listening to the spoken teach-back.'} A correction requires confirmation again.</p></div></section>;
  }
  function Timeline() { return <section className="panel timeline"><div className="section-heading"><h2>Clickable Work Map & evidence</h2><span className="pill">{session.frames.length}/80 frames</span></div>{!session.frames.length ? <p className="muted">No captured frames. Consent and share the synthetic tab to begin.</p> : <div className="frame-strip">{session.frames.filter((f, i) => session.questions.some(q => q.frameId === f.id) || i === session.frames.length - 1).map(f => <button className="frame" onClick={() => setSelectedFrame(f)} key={f.id}><img src={f.image} alt={`Captured ${f.topic} review`}/><span>{new Date(f.at).toLocaleTimeString()} · {f.topic}</span><small>{f.observation === 'Actual selected-screen frame; interpretation pending.' ? 'Real frame / interpretation pending' : f.mode === 'mock' ? 'Real frame / simulated interpretation' : 'Real frame / live reasoning'}</small></button>)}</div>}<div className="segment-list">{session.segments.map((seg, i) => <details key={seg.id}><summary>Segment {i + 1} · {seg.role} · {new Date(seg.at).toLocaleTimeString()} · {session.transcripts.filter(t => t.segmentId === seg.id).length} retained answers</summary>{session.transcripts.filter(t => t.segmentId === seg.id).map(t => <blockquote key={t.id}>“{t.text}”<small>Transcript {t.id.slice(0, 8)} · span 0–{t.text.length} · {t.source}</small></blockquote>)}<button className="danger" onClick={() => removeSegment(seg.id)}>Delete segment & dependent evidence/rules</button></details>)}</div></section>; }
}
function SessionDialog({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog className="modal session-dialog" aria-label={title} ref={ref} onCancel={onClose}><div className="dialog-heading"><h2>{title}</h2><button className="text-button" aria-label={`Close ${title}`} onClick={onClose}>×</button></div>{children}</dialog>;
}
function EvidenceDialog({ frame, onClose }: { frame: Frame; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className="modal" aria-label="Captured screen evidence" onCancel={onClose} onClick={e => { if (e.target === e.currentTarget) onClose(); }}><div><button className="secondary" autoFocus onClick={onClose}>Close evidence</button><h2>Screen moment · {new Date(frame.at).toLocaleTimeString()}</h2><img src={frame.image} alt={`Actual captured ${frame.role} screen at ${new Date(frame.at).toISOString()}`}/><p>{frame.observation}</p></div></dialog>;
}
type Terms = { owner: string; period: string; statuses: string[] };
function InitiativeWorkbench({ report: r, onChange, terms, topic, onTopic, phase, pendingQuestion = false, captureReady = false, onDone, children }: { report: Report; onChange: (r: Report) => void; terms: Terms; topic: Topic; onTopic: (t: Topic) => void; phase: 'capture' | 'teach'; pendingQuestion?: boolean; captureReady?: boolean; onDone?: () => void; children?: ReactNode }) {
  const v = r.review; const preparing = phase === 'teach';
  const assessmentLabels = {
    delivery: { 'not-assessed': 'Not assessed', met: 'Benchmark met', 'partly-met': 'Partly met', missed: 'Benchmark missed', 'not-assessable': 'Not assessable' }[v.pastDelivery],
    outlook: { 'not-assessed': 'Not assessed', achievable: 'Achievable', 'at-risk': 'At risk', unlikely: 'Unlikely', achieved: 'Achieved' }[v.annualOutlook],
    readiness: { 'not-assessed': 'Not assessed', ready: 'Ready for reporting', 'needs-clarification': 'Needs clarification' }[v.readiness],
  };
  function selectTopic(next: Topic) { onTopic(next); }
  function set<K extends keyof Review>(key: K, value: Review[K]) { onChange({ ...r, review: { ...v, [key]: value, ...(key === 'proposedMilestone' ? { proposalState: 'proposed' as const, proposalConfirmation: '' } : {}) } }); }
  function notes(key: 'deliveryReason' | 'outlookReason' | 'readinessReason' | 'assumptions' | 'clarification' | 'managementDecision' | 'proposedMilestone' | 'proposalConfirmation', label: string, placeholder: string) {
    return <label>{label}<textarea aria-label={label} value={v[key]} maxLength={1500} onChange={e => set(key,e.target.value)} placeholder={placeholder}/></label>;
  }
  function milestone(m: Report['milestones'][number]) {
    return <article className={m.quarter === r.currentQuarter ? 'milestone current' : 'milestone'} key={m.quarter}>
      <div><strong>{m.quarter}{m.quarter === r.currentQuarter ? ' · this review' : ''}</strong><span className={`pill ${m.agreement === 'missing' ? 'warn' : ''}`}>{m.agreement === 'missing' ? 'Not agreed' : m.agreement}</span></div>
      <p>{m.statement}</p>{m.agreement === 'agreed' && <small>Recorded delivery: {m.delivery}</small>}
    </article>;
  }
  const annual = <section className="source-section"><h3>Annual commitment <span className="pill">{r.annualAgreement}</span></h3><p>{r.annualCommitment}</p><p className="due">Due {r.annualDue}</p></section>;
  const milestones = <section className="source-section"><h3>Quarterly milestones</h3><div className="milestones">{r.milestones.filter(m => m.quarter === r.currentQuarter).map(milestone)}</div><details><summary>Other quarters</summary><div className="milestones">{r.milestones.filter(m => m.quarter !== r.currentQuarter).map(milestone)}</div></details></section>;
  const evidence = <section className="source-section"><h3>Evidence supplied</h3>{r.evidence.map(e => <article className="evidence-item" key={e.label}><strong>{e.label}</strong><p>{e.detail}</p></article>)}</section>;
  const dependencies = <section className="source-section"><h3>Dependencies</h3>{r.dependencies.map(d => <article key={d.item} className="dependency"><p>{d.item}</p><small>{d.resolution === 'pending' ? 'Confirmation pending' : 'Confirmed'}</small></article>)}</section>;
  const titles = preparing ? { delivery: 'What did your division deliver?', outlook: 'What is the plan for the year?', readiness: 'What should leadership know?' } : { delivery: 'What was delivered this quarter?', outlook: 'Can the annual commitment still be met?', readiness: 'Is this ready for leadership?' };
  return <section className="review-task">
    <div className="guided-heading"><div className="case-line">{r.initiative} <span>· {r.period}</span></div><h1 id="task-title" tabIndex={-1}>{titles[topic]}</h1><p>{phase === 'capture' ? 'Review the update as you would at work. Explain which inputs you need and why.' : 'Use the case brief to write your division’s update. Make your claims, evidence and uncertainties clear.'}</p></div>
    <div className="initiative-grid"><section className="original" aria-label={preparing ? 'Fictional case brief' : 'Original initiative submission'}>
      <div className="source-title"><h2>{preparing ? 'Your case brief' : 'Original submission'}</h2><span className="status-tag">{preparing ? 'Case claim' : 'Submitted'}: {terms.statuses[performanceStatuses.indexOf(r.submittedStatus)]}</span></div>
      <p className="source-owner">{r.owner}<br/>Annual commitment due {r.annualDue}</p>{annual}{topic !== 'readiness' && milestones}
      <section className="source-section"><h3>{preparing ? 'Recorded progress · facts to work from' : 'Submitted progress'}</h3><p>{r.progress}</p></section>
      {topic !== 'outlook' && evidence}{topic !== 'delivery' && dependencies}
      <details className="full-submission"><summary>Full submission & supporting context</summary><dl className="record-meta"><dt>{terms.owner}</dt><dd>{r.owner}</dd><dt>Supporting teams</dt><dd>{r.supporting}</dd><dt>{terms.period}</dt><dd>{r.period} · {r.cadence}</dd></dl>{topic === 'readiness' && milestones}{topic === 'outlook' && evidence}{topic === 'delivery' && dependencies}
        <section className="source-section"><h3>Management request</h3><p>{r.submittedDecision}</p></section><section className="source-section"><h3>Corporate KPI & results context</h3>{r.linkedKpis.map(k => <div className="kpi" key={k.id}><strong>{k.id} · {k.title}</strong><p>{k.relationship}</p></div>)}{!r.linkedKpis.length && <p>No direct Corporate KPI link supplied.</p>}<p className="fine">A KPI link alone does not establish an outcome or causation.</p><h3>Proposed results pathway</h3><p>{r.resultsPath}</p></section>
      </details>
    </section>
    <section className="review-column" aria-label={preparing ? 'Division update draft' : 'Reviewer assessment'}>
      <div className="review-draft"><h2>{preparing ? 'Your division update' : 'Your assessment'}</h2><p className="review-intro">{preparing ? 'Your words · nothing is prefilled or automatically corrected' : `${topicLabels[topic]} · separate from the other judgments`}</p>
        <section hidden={topic !== 'delivery'} aria-label="Past delivery judgment" id="judgment-delivery" className="judgment">
          <div className="form-grid"><label>{preparing ? 'Quarterly delivery claim' : 'Past delivery assessment'}<select aria-label={preparing ? 'Quarterly delivery claim' : 'Past delivery assessment'} value={v.pastDelivery} onChange={e => set('pastDelivery',e.target.value as Review['pastDelivery'])}><option value="not-assessed">Choose assessment</option><option value="met">Met the benchmark</option><option value="partly-met">Partly met</option><option value="missed">Missed the benchmark</option><option value="not-assessable">Not assessable against a benchmark</option></select></label><label>Benchmark basis<select aria-label="Benchmark basis" value={v.deliveryBasis} onChange={e => set('deliveryBasis',e.target.value as Review['deliveryBasis'])}><option value="not-reviewed">Choose basis</option><option value="agreed-milestone">Agreed quarterly milestone</option><option value="missing-benchmark">No agreed quarterly benchmark</option><option value="retrospective-assumption">Assumed retrospective benchmark</option></select></label></div>
          {notes('deliveryReason',preparing ? 'Quarterly progress & evidence' : 'Past delivery reasoning',preparing ? 'Write what was done, the evidence it produced and the benchmark it can be compared with. State what is unknown.' : 'Point to the agreed benchmark and the evidence. If one is missing, say so.')}
        </section>
        <section hidden={topic !== 'outlook'} aria-label="Annual outlook judgment" id="judgment-outlook" className="judgment">
          <label>{preparing ? 'Annual forecast' : 'Annual outlook assessment'}<select aria-label={preparing ? 'Annual forecast' : 'Annual outlook assessment'} value={v.annualOutlook} onChange={e => set('annualOutlook',e.target.value as Review['annualOutlook'])}><option value="not-assessed">Choose outlook</option><option value="achievable">Achievable with stated assumptions</option><option value="at-risk">At risk</option><option value="unlikely">Unlikely to be achieved</option><option value="achieved">Already achieved</option></select></label>
          {notes('outlookReason',preparing ? 'Plan & annual forecast' : 'Annual outlook reasoning','What remains to be done? Which evidence makes the plan credible?')}{notes('assumptions',preparing ? 'Dependencies, owners & risks' : 'Forecast assumptions & risks','What needs to hold true? Who must confirm it, by when? What changes if it slips?')}
        </section>
        <section hidden={topic !== 'readiness'} aria-label="Review readiness judgment" id="judgment-readiness" className="judgment">
          <label>{preparing ? 'Ready to send?' : 'Review readiness flag'}<select aria-label={preparing ? 'Ready to send?' : 'Review readiness flag'} value={v.readiness} onChange={e => set('readiness',e.target.value as Review['readiness'])}><option value="not-assessed">Choose readiness</option><option value="ready">Ready for reporting</option><option value="needs-clarification">Needs clarification</option></select></label>
          <div className="form-grid"><label>{preparing ? 'How well is your status supported?' : 'Submitted status assessment'}<select aria-label={preparing ? 'How well is your status supported?' : 'Submitted status assessment'} value={v.statusAssessment} onChange={e => set('statusAssessment',e.target.value as Review['statusAssessment'])}><option value="not-reviewed">Choose assessment</option><option value="supported">Supported by evidence</option><option value="qualified">Qualified / provisional</option><option value="questioned">Questioned</option></select></label><label>{preparing ? 'Division performance status' : 'Reviewer performance status'}<select aria-label={preparing ? 'Division performance status' : 'Reviewer performance status'} value={v.recommendedStatus} onChange={e => set('recommendedStatus',e.target.value as Review['recommendedStatus'])}><option value="not-assessed">Choose status</option>{performanceStatuses.map((st,i) => <option key={st} value={st}>{terms.statuses[i]}</option>)}</select></label></div>
          {notes('readinessReason',preparing ? 'Why this status?' : 'Review readiness reasoning','Explain the evidence supporting the status and any qualifications.')}{notes('clarification',preparing ? 'Unconfirmed details to flag' : 'Clarification request to division','What evidence is missing? Who should confirm it, by when, and why does it matter?')}{preparing && notes('managementDecision','Management support requested','What decision or coordination would help your division? State the owner, timing and consequence.')}
        </section>
      <div className="task-footer"><label className="jump-focus">{preparing ? 'Update section' : 'Review focus'}<select aria-label={preparing ? 'Update section' : 'Review focus'} value={topic} onChange={e => selectTopic(e.target.value as Topic)}>{topics.map((t,i) => <option key={t} value={t}>{`0${i + 1} ${topicLabels[t]}`}</option>)}</select></label>{phase === 'capture' && <button className="primary" disabled={pendingQuestion || !captureReady} onClick={() => topic === 'readiness' ? onDone?.() : selectTopic(topics[topics.indexOf(topic) + 1])}>{topic === 'readiness' ? 'Finish task & open debrief →' : topic === 'delivery' ? 'Next: annual outlook →' : 'Next: review readiness →'}</button>}{preparing && topic !== 'readiness' && <button className="primary" disabled={!judgmentReady(r,topic)} onClick={() => selectTopic(topics[topics.indexOf(topic) + 1])}>{topic === 'delivery' ? 'Next: annual plan →' : 'Next: leadership update →'}</button>}</div>{phase === 'capture' && !captureReady && <p className="step-requirement">Choose your assessment, explain why, and keep a screen-linked explanation before continuing.</p>}
        <details className="assessment-summary"><summary>{preparing ? 'Preview your division update' : 'Your three draft judgments'}</summary>{preparing && <DraftPreview report={r}/>}{topics.map(t => <div key={t}><span>{topicLabels[t]}</span><button className="text-button" onClick={() => selectTopic(t)} aria-label={`Edit ${topicLabels[t].toLowerCase()} assessment`}>{assessmentLabels[t]} ↗</button></div>)}<p className="fine">Held in this tab. Refresh clears the draft.</p></details>
      </div>
      <details className="actions"><summary>Follow-up & management action</summary><div className="follow-up-fields">
        {!preparing && notes('managementDecision','Management decision needed','What decision or coordination should leadership provide?')}{notes('proposedMilestone','Proposed future milestone','Set a future deliverable, scale, due date and evidence. Keep past commitments intact.')}
        <div className="proposal-state"><span className="pill">{v.proposalState === 'confirmed' ? (v.proposalConfirmation.trim() ? 'Confirmation recorded' : 'Proposal · confirmation record needed') : 'Proposal · not an agreed commitment'}</span><label className="check"><input type="checkbox" checked={v.proposalState === 'confirmed'} disabled={!v.proposedMilestone.trim()} onChange={e => set('proposalState',e.target.checked ? 'confirmed' : 'proposed')}/>Record a confirmation of this future proposal</label>{v.proposalState === 'confirmed' && notes('proposalConfirmation','Future milestone confirmation record','Who agreed it, when, and what did they confirm? Software cannot verify agreement.')}</div>
        <label>How are you using the Corporate KPI link?<select aria-label="How are you using the Corporate KPI link?" value={v.kpiInterpretation} onChange={e => set('kpiInterpretation',e.target.value as Review['kpiInterpretation'])}><option value="context">Context / possible contribution</option><option value="outcome-proof">Treating the link alone as outcome proof</option><option value="causal-proof">Treating the link alone as causal proof</option></select></label>
        <label className="check"><input type="checkbox" checked={v.exceptionReview} onChange={e => set('exceptionReview',e.target.checked)}/>This case may be an exception · stop for expert review.</label>
      </div></details>

      {(!preparing || topic === 'readiness') && children}
    </section></div>
  </section>;
}
function RuleCard({ rule, session, onChange, onApprove, onReject, onFrame, onDemonstrate }: { rule: Rule; session: Session; onChange: (r: Rule) => void; onApprove: () => void; onReject: () => void; onFrame: (f?: Frame) => void; onDemonstrate: () => void }) {
  return <article className="panel rule"><div className="section-heading"><span className="eyebrow">PROPOSED INPUT GUIDANCE / {rule.topic}</span><span className={`pill ${rule.status === 'confirmed' ? 'ok' : ''}`}>{rule.status}</span></div><p className="fine draft-method">{rule.synthesis?.mode === 'live-claude' ? 'Claude interpretation · cited Capture + debrief words · expert correction required' : rule.synthesis?.mode === 'mock-extractive' ? 'Mock extraction · Capture + debrief words · expert correction required' : 'Expert-editable draft · exact evidence retained · confirmation required'}</p>{rule.synthesis?.uncertainties.length ? <ul className="fine">{rule.synthesis.uncertainties.map((text,i) => <li key={i}>{text}</li>)}</ul> : null}<div className="rule-fields">{(['title', 'decision', 'conditions', 'exceptions', 'rationale', 'guardrail'] as const).map(key => <label key={key}>{key}<textarea value={rule[key]} maxLength={key === 'title' ? 200 : 1500} onChange={e => onChange({ ...rule, [key]: e.target.value })} placeholder={`Expert: explain the ${key}…`}/></label>)}</div><p className="fine">Coded trigger proposed for expert approval: {triggerDescriptions[rule.topic]} Custom exceptions require human review; this prototype cannot evaluate arbitrary policy.</p>
    {rule.evidence.map((e, i) => {
      const transcript = session.transcripts.find(t => t.id === e.transcriptId);
      const debrief = session.questions.some(q => q.id === transcript?.questionId && q.phase === 'debrief');
      const frame = session.frames.find(f => f.id === e.frameId);
      return <div className="provenance" key={`${e.transcriptId}-${i}`}><blockquote>“{e.quote}”<small>{debrief ? 'Debrief clarification' : 'Capture explanation'} · exact span {e.start}–{e.end} · {transcript && new Date(transcript.at).toLocaleTimeString()}</small></blockquote>
        {debrief && <label>Supporting screen for debrief<select aria-label="Supporting screen for debrief" value={e.frameId} onChange={event => onChange({ ...rule, evidence: rule.evidence.map((old, index) => index === i ? { ...old, frameId: event.target.value } : old) })}><option value="">Choose evidence · no link assumed</option>{session.frames.filter(f => f.role === 'expert' && f.topic === rule.topic && f.at <= (transcript?.at || 0) && session.questions.some(q => q.frameId === f.id && q.phase === 'capture')).map(f => <option key={f.id} value={f.id}>{topicLabels[f.topic]} · {new Date(f.at).toLocaleTimeString()}</option>)}</select><small>Select only if the visible demonstration supports this clarification. New guidance needs a new demonstration and explanation.</small></label>}
        <button className="secondary" disabled={!frame} onClick={() => onFrame(frame)}>{frame ? `View supporting frame · ${new Date(frame.at).toLocaleTimeString()}` : 'Screen support still needed'}</button><label>Supporting quote · exact substring<input value={e.quote} onChange={event => { const quote = event.target.value; const start = transcript?.text.indexOf(quote) ?? -1; onChange({ ...rule, evidence: rule.evidence.map((old, index) => index === i ? { ...old, quote, start, end: start + quote.length } : old) }); }}/></label></div>;
    })}
    {!hasProvenance(session, rule) && <p className="error">Missing screen/quote provenance. Link supporting evidence or capture another demonstration before approval.</p>}<div className="button-row"><button className="primary" disabled={rule.status === 'confirmed'} onClick={onApprove}>Approve this interpretation</button><button className="danger" onClick={onReject}>Reject</button><button className="text-button" onClick={onDemonstrate}>Capture another demonstration ↗</button></div><details><summary>Confirmation & correction history ({rule.history.length})</summary>{rule.history.map((h, i) => <p key={i}>{new Date(h.at).toLocaleTimeString()} · {h.action}: {h.detail}</p>)}</details></article>;
}
function draftRows(r: Report): [string, string][] {
  const v = r.review;
  const delivery = { 'not-assessed': 'Not stated', met: 'Benchmark met', 'partly-met': 'Partly met', missed: 'Benchmark missed', 'not-assessable': 'No assessable benchmark' }[v.pastDelivery];
  const outlook = { 'not-assessed': 'Not stated', achievable: 'Achievable with assumptions', 'at-risk': 'At risk', unlikely: 'Unlikely', achieved: 'Achieved' }[v.annualOutlook];
  return [['Quarterly delivery', delivery], ['Progress & evidence', v.deliveryReason || 'Not written'], ['Annual plan & forecast', `${outlook}. ${v.outlookReason}`], ['Dependencies, owners & risks', v.assumptions || 'Not written'], ['Performance status', `${v.recommendedStatus === 'not-assessed' ? 'Not stated' : v.recommendedStatus} · ${v.statusAssessment === 'not-reviewed' ? 'support not stated' : v.statusAssessment}. ${v.readinessReason}`], ['Ready to send?', v.readiness === 'ready' ? 'Ready for reporting' : v.readiness === 'needs-clarification' ? 'Clarifications flagged' : 'Not stated'], ['Unconfirmed details', v.clarification || 'None stated'], ['Management support', v.managementDecision || 'None requested'], ['Future milestone proposal', v.proposedMilestone ? `${v.proposedMilestone} (${v.proposalState === 'confirmed' ? `confirmation recorded: ${v.proposalConfirmation}` : 'provisional · not agreed'})` : 'None proposed']];
}
function DraftPreview({ report }: { report: Report }) { return <article className="draft-preview"><h3>{report.initiative} · {report.period}</h3><dl>{draftRows(report).map(([label,value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></article>; }
function PracticeResult({ historical, saved, firstAttempt, concerns, human, prediction, topic, onAgain, onExport }: { historical: boolean; saved: Report; firstAttempt: Report; concerns: string[]; human: boolean; prediction: string; topic?: Topic; onAgain: () => void; onExport: () => void }) {
  const first = draftRows(firstAttempt); const changes = draftRows(saved).flatMap(([label,value], i) => value !== first[i][1] ? [{ label, before: first[i][1], after: value }] : []);
  return <section className="focused-message practice-result"><div className="eyebrow">{historical ? 'HISTORICAL IMPORT · NOT A NEW VALIDATION' : human ? 'HUMAN PARTICIPATION SELF-DECLARED' : 'DEVELOPMENT ROLE SIMULATION'}</div><div className="result-mark" aria-hidden="true">✓</div><h1 tabIndex={-1}>An update with<br/>the reasoning included.</h1><p role="status">Checked update saved locally for this practice.</p><p>The reporting officer prepared the inputs. The Ropes checked them against the reviewer’s confirmed guidance.</p><div className="result-details"><h2>What changed in this practice</h2><p><strong>Principle:</strong> {topic && topicLabels[topic]}</p><p><strong>Your prediction:</strong> {prediction}</p>{concerns.map(c => <p key={c}><strong>Concern raised:</strong> {c}</p>)}{changes.length ? <table className="change-comparison"><thead><tr><th>Input</th><th>First check</th><th>Saved draft</th></tr></thead><tbody>{changes.map(c => <tr key={c.label}><th scope="row">{c.label}</th><td>{c.before}</td><td>{c.after}</td></tr>)}</tbody></table> : <p>No guardrail correction was observed at the save check.</p>}<details><summary>Read the saved division update</summary><DraftPreview report={saved}/></details></div><p className="fine">This records one practice and the edits observed, not lasting mastery or an official submission. Unconfirmed dependencies and forecasts still need checking. Refresh clears the session; the private export includes drafts, screen pixels and exact words.</p><div className="result-actions"><button className="primary" onClick={onAgain}>Try another case →</button><button className="text-button" onClick={onExport}>Export private practice & evidence ↗</button></div></section>;
}

function Reference() { return <section className="panel reference"><div className="section-heading"><h2>Three layers. Different authority.</h2><span className="pill">Reference ≠ learned</span></div><div className="reference-grid"><div><span className="eyebrow">01 / RBM & THEORY OF CHANGE</span><p>Activities are work done; outputs are delivered products or services; outcomes are changes for people; impact concerns wider effects. A baseline is the starting value, a target the desired value. A ToC describes the expected path to change and its assumptions. Contribution helps explain a result; attribution claims a causal link.</p><a href="https://www.oecd.org/en/publications/glossary-of-key-terms-in-evaluation-and-results-based-management-for-sustainable-development-second-edition_632da462-en-fr-es.html" target="_blank" rel="noreferrer">OECD glossary, 2023 ↗</a></div><div><span className="eyebrow">02 / CODED VALIDATIONS</span><p>Required review fields and proposal confirmation records are authored checks. Three separate judgments prevent a reporting gap from automatically becoming a performance status. These checks do not establish agency policy. Bounded tutor triggers activate only after an expert confirms the rule and its applicability.</p><a href="https://www.international.gc.ca/world-monde/funding-financement/rbm-gar/tip_sheet_2_1-fiche_conseil_2_1.aspx?lang=eng" target="_blank" rel="noreferrer">GAC checklist 2.1 ↗</a><p className="fine">GAC-specific practice is attributed to GAC, not universal policy.</p></div><div><span className="eyebrow">03 / EXPERT-CONFIRMED HEURISTICS</span><p>Contextual decisions learned in this session. Each needs a real frame, exact expert words, conditions, exceptions, rationale and confirmation. Fresh sessions start empty. Only this confirmed layer supplies novice coaching.</p></div></div></section>; }

createRoot(document.getElementById('root')!).render(<App/>);
