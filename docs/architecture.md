# Architecture and trust boundaries

React/TypeScript with Vite, a native Node HTTP/WebSocket API, Zod, `ws` and the ElevenLabs client SDK. One instance and one persistent private budget disk are the intended hosting shape. There is no database, browser extension, Office/Power BI integration or shared-team capture store.

| Module | Responsibility |
|---|---|
| `src/domain.ts` | Empty learned store, evidence/approval/history/deletion, Capture/Map gates, separate initiative judgments, confirmed-rule tutor, revision/epoch guards |
| `src/capture.ts` | User-selected screen, preview, bounded local JPEG sampling and media teardown |
| `src/voice.ts` | Microphone preflight, ElevenAgents/Scribe app relay clients, contextual updates, explicit question turns, speech/interrupt audit and disconnect/time bounds |
| `src/map.ts` | Exact expert citation input, structured synthesis validation, supported applicability passages and stale-result protection |
| `src/providers.ts` | Labelled mock adapters, bounded Claude vision and Map synthesis, safe current-case tutor context |
| `src/server.ts` | HTTP/API and same-origin Agent/Scribe WebSockets, ticket/cancellation, host/origin/auth gates, provider credentials, request/rate/concurrency bounds |
| `src/agent-relay.ts`, `src/scribe-relay.ts` | Server-only Agent signed URL/Scribe token; bounded one-use same-origin relay transport; server duration/kill/revoke checks |
| `src/budget.ts` | Atomic private disk ledger, conservative reservations, known/unknown costs, preserved history, bounded voice lease |
| `src/private-session.ts` | Explicit local private export/import, size/schema/reference checks, historical labels and fresh-consent requirements |
| `src/cases.ts` | Fictional held-out facts with blank reporting-officer drafts; no expected-answer annotations |
| `src/main.tsx`, `src/style.css` | Guided cool-mist review workspace, consent/preview, recording dock, editable cited Map, pre-save coaching and private export/resume |
| `tests/` | Seeded-confirmed positives, absent/unconfirmed negatives, held-out oracles and labelled simulated browser media |

## Capture and question timing

The user selects a narrow tab/window with `getDisplayMedia`. Preview confirmation precedes retention/transmission. Local frames are sampled every two seconds at no more than 1280 px width and JPEG quality 0.65. Live vision analyzes a recent topic-matched frame at a relevant pause/action; it does not transmit every sample continuously. This differs from the brief's suggested one-to-two-second provider cadence and preserves the bounded budget.

Automatic questions require quiet UI/speech intervals, no current Agent speech, no reading hold, no outstanding question and a minimum question gap. Ask now still respects speech and reading holds. Activity signals are heuristics; silence does not prove cognition has stopped. Human interruption and real microphone behaviour require actual rehearsal.

Microphone audio goes through same-origin app relays to ElevenLabs Agents and Scribe v2 Realtime. The server keeps both the provider signed Agent URL and Scribe token; `/voice` returns only `{agentPath, scribePath, maxSeconds}`. The SDK connects to the one-use app Agent WebSocket, while Scribe forwards bounded 16 kHz PCM without writing audio files. Both transport upgrades apply authentication/Host/Origin checks and server duration/revoke/kill limits. Published V3/Expressive configuration and provider duration are checked before minting; the current agent maximum is verified at 120 seconds. Microphone permission/format preflight precedes the paid reservation. The rolling 80-frame store retains cited evidence.

## Evidence-backed Map

Three useful Capture explanations including a guardrail, expert assessments and three new debrief answers gate generation. Extractive candidates include retained same-topic Capture and debrief words. Live Claude synthesis can paraphrase a decision/rationale with supplied citation IDs; conditions, exceptions and guardrails must identify exact source passages. Schema validation rejects invented citation IDs/spans. Mock extraction is labelled and does not claim model understanding.

Every rule remains draft until the expert reviews all fields, supplies actual supporting screen links, corrects/rejects as needed and confirms. Debrief links begin absent; a supporting demonstration is required where visual evidence is missing. Evidence includes the actual frame/timestamp and exact transcript span. Editing/deletion or a late model response cannot inherit approval. Live teach-back confirmation waits for SDK text and speaking → listening without interruption, then explicit human confirmation. Those events do not prove audible or understood playback; human evidence remains required.

## Held-out Teach

The case endpoint supplies held-out facts only after the confirmed map reaches Teach. The reporting officer's draft starts empty. Tutor context contains the current case and confirmed rules/quotes, not expected answers. Coded completeness checks and bounded confirmed-rule triggers remain clearly distinguished from session-learned guidance. They cannot validate arbitrary policies.

Before save, the app captures current practice evidence, clones the draft and checks its revision, consent and Map epoch across async work. A concern cites the expert's reasoning/frame and lets the person choose a correction; the app does not rewrite the update. Success retains the exact checked draft and compares it with the first checked attempt. One correction does not establish lasting mastery. Automated role simulations are not human transfer validation.

## Consent, privacy and deliberate resume

Browser/server invalidate excluded segments before teardown, stop streams/connections, abort requests, revoke tickets and reject late results. Off record and deletion are different: deletion cascades dependent quotes, frames, rules and practices. Participant changes and new unseen practice need fresh consent.

Evidence is browser-memory data until the user explicitly exports a private local file. Import validates size, schema and references, marks evidence historical, strips whole-map confirmation and requires fresh consent. It neither reconnects providers nor creates a new validation result. Do not publish private exports. No automatic cloud capture persistence, automatic image redaction, remote deletion or zero provider retention is claimed.

## Production access and budget

Public mode requires explicit HTTPS host and origin allowlists, strong server-side demo access credentials and an absolute persistent-disk ledger path. The production proxy supplies HTTPS forwarding; the app rejects unapproved HTTP/origins. HTTP and same-origin WebSocket requests apply access gates. Rate/concurrency limits and a live kill switch bound paid endpoints. Do not replace a failing allowlist with wildcards.

The disk ledger preserves historical usage/holds across restarts, writes atomically and records cap changes. Unknown provider charges remain held rather than becoming fabricated actuals. A missing/corrupt expected ledger blocks live use. One deliberate first-boot initialization preserves the historical hold; turn initialization off once the file exists. Account billing controls remain separate from conservative local reservations.

Hard limits remain eight new metered operations recorded in the persistent ledger and 120 seconds per voice connection. No automatic retries or reconnect. Published Agent duration is checked too. Both Agent/Scribe relays enforce bounded transport, cancellation/revoke and kill switch server-side, with provider session material kept server-only. Already transmitted data cannot be claimed remotely deleted by connection teardown. Conservative reservations are vision US$0.25, Map US$0.50 and voice US$1, not retrieved provider prices.

## Validation boundary

The final local check at 16:00 SGT on 4 October 2026 passed lint, typecheck, build, 36 unit/API and nine browser tests. The clean publication snapshot is checked separately before push. Earlier provider checks used synthetic speech/fictional pixels. Actual human speech, interruptions, audible teach-back, independent unseen transfer and a fresh hosted flow remain unrun; automated fixtures do not establish them.

## Provider documentation

- [ElevenAgents JavaScript SDK](https://elevenlabs.io/docs/eleven-agents/libraries/java-script)
- [Scribe realtime WebSocket](https://elevenlabs.io/docs/api-reference/speech-to-text/v-1-speech-to-text-realtime) and [single-use credentials](https://elevenlabs.io/docs/api-reference/tokens/create)
- [Expressive mode](https://elevenlabs.io/docs/eleven-agents/customization/voice/expressive-mode)
- [Claude vision](https://platform.claude.com/docs/en/build-with-claude/vision) and [structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)

Provider/account rights and end-user terms require deliberate review before public use; subscription credits are not unlimited authorization.
