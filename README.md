# The Ropes · Better division inputs

The Ropes is a hackathon MVP for transferring expert judgment through **Capture → Map → Teach**. A strategy/performance officer explains how they review an initiative update. An ER-division reporting/planning officer then prepares an unseen update with guidance grounded in the expert's confirmed words and screen evidence. The human roles are complementary.

The problem is simple: a reporting template says which fields to fill, but rarely explains why an experienced officer questions a benchmark, forecast or unsupported status. The Ropes makes that reasoning teachable. Built-in cases are fictional; users may enter their own initiative facts. No organizational policy or endorsement is claimed.

## Run locally

Requires Node.js 22 or later.

```sh
npm ci
npm run dev
```

Open http://127.0.0.1:5184. The backend defaults to http://127.0.0.1:8787. To run the production build locally:

```sh
npm run build
npm start
```

Then open http://127.0.0.1:8787. Mock mode is the default. It needs no provider keys and remains visibly labelled as simulated. Browser tests also label their simulated media fixtures; neither establishes human voice or learning transfer.

## Your own project

Choose **Use my own project** on the opening screen. Enter the original initiative facts, reporting period, annual commitment, milestones, progress, evidence and dependencies. The form starts blank and validates period links; no sample facts or judgments are copied. Edit source details before recording. For Teach, **Use colleague’s project** accepts a different initiative or reporting period with a blank assessment and fresh consent.

Entered facts stay in the browser until consented recording or explicit private export. Export is available before recording, with deliberate restore later. Enter only information approved for the provider routes shown in consent. This remains an initiative-update pilot using the existing bounded expert-confirmed triggers.

## The loop

1. **Capture:** an expert reviews a fictional update. Give screen/microphone consent, select only the approved initiative workspace and inspect the preview. The apprentice asks at pauses, after typing/speech activity and reading holds permit it. Retain an assessment, reason and screen-linked explanation for each topic; at least three useful questions and a guardrail are required.
2. **Map:** answer at least three new debrief questions. In live mode, Claude can draft a coherent cited interpretation from retained same-topic expert words; mock uses labelled extraction. Conditions, exceptions and guardrails require exact supporting passages. All drafts remain editable and unconfirmed. Missing screen links block approval; new judgment needs a supporting demonstration. The expert listens to or reads the labelled teach-back, corrects it and explicitly confirms.
3. **Teach:** a separate human reporting/planning officer opens an unseen case. Their update starts blank. With fresh consent, they write their own claims and predict what to verify. Before save, a confirmed-rule tutor can raise a relevant concern using the expert's quote and frame. The officer chooses the correction. The result preserves the actual first-checked and saved drafts and remaining uncertainty.

Do not preload an error into a live learner's draft or call an automated role simulation human validation. A deliberately seeded mistake is an error-recovery exercise. One observed correction does not prove lasting mastery.

## Architecture and actual ElevenLabs integration

React/TypeScript and Vite supply the browser workspace. A Node HTTP/WebSocket server validates bounded requests and keeps long-lived provider keys server-side. Zod validates data and model outputs; `ws` provides both bounded voice relays.

- Selected-screen JPEG frames and bounded context go through the API to Claude for vision. Map synthesis uses exact supplied citations, with expert approval required.
- **ElevenAgents** uses the existing private agent with V3 Conversational and Expressive mode. The signed provider URL stays on the server; the browser SDK uses a one-use same-origin Agent WebSocket relay.
- **Scribe v2 Realtime** receives 16 kHz PCM audio through its one-use same-origin server relay. The provider token stays on the server. The voice API supplies `{agentPath, scribePath, maxSeconds}` only. Both relays apply authentication, Host/Origin, revoke/kill and server duration bounds. Microphone permission/format preflight happens before paid reservation. Transcripts/activity inform timing; pauses are a heuristic, not proof that someone has stopped thinking.
- A disk-backed budget ledger preserves conservative reservations and known/unknown usage across restarts. Paid calls remain capped, rate/concurrency-limited and protected by access controls in public mode. There is no automatic live-to-mock success fallback.

See [architecture](docs/architecture.md) for evidence and privacy boundaries, and [deployment runbook](docs/deployment.md) for the verified hosting shape and remaining human rehearsal checks.

## Safe live setup

Copy `.env.example` to `.env` only if no local `.env` already exists. Enter credentials securely in your editor or the approved host's secret settings. Never put keys in chat, source, logs, screenshots or `VITE_` variables.

- `ANTHROPIC_API_KEY` and `ANTHROPIC_MODEL`: a supported Claude vision model; the current adapter supports the configured Sonnet path.
- `ELEVENLABS_API_KEY`: restricted Speech to Text Access and ElevenAgents Write scopes; signed-session minting requires `convai_write`.
- `ELEVENLABS_AGENT_ID`: the actual agent ID, not API Key ID. Configure and publish V3 Conversational with Expressive mode, an empty first message, patient turn behaviour and a provider-enforced conversation duration no greater than the app's 120-second hard maximum. The current published agent's 120-second maximum and other listed settings have been verified; actual human voice behavior remains unrun. Any account/security change is deliberate.
- `LIVE_USAGE_APPROVED`, `PROVIDER_TOTAL_CAP_USD` and the private ledger: keep live approval false until an operator approves a concrete total budget. Do not reset reservations or enlarge a cap to bypass a gate. Unknown provider charges stay unknown. Subscription credits do not authorize unrestricted use.

Request clamps remain **eight new metered operations persisted across restarts** and **120 seconds per voice connection**, with no automatic retries. Deliberate reconnect creates a fresh segment and requires capture selection/consent as appropriate; it preserves retained answers/evidence and ledger history. The 80-frame rolling store keeps cited evidence and discards only unreferenced samples; it stops if all frames are pinned. Longer workflows must remain inside both operation/budget gates. Verify the published agent's provider duration is at most 120 seconds before connecting.

## Privacy, resume and limitations

Preview is inspected before transmission. On-record capture stays in browser memory until the user explicitly exports a private evidence file. Off record/pause ends capture, stops media tracks/connections, revokes the server ticket and rejects late results. Deleting a segment removes dependent evidence/rules/practices and revokes affected approvals.

Private export/import supports deliberate local resume, with schema/reference checks. Imported evidence is labelled historical, does not connect providers, requires fresh consent and does not itself grant whole-map approval. Keep these exports outside public source and sharing services. There is no shared-team persistence or automatic cloud storage of captures.

Local deletion cannot retract material already sent to a provider. Remote deletion, zero retention and automatic screen redaction are not claimed. Share only the initiative workspace approved for provider processing. The MVP covers initiative updates and bounded expert-confirmed coaching triggers; arbitrary institutional policy, KPI/dataset coordination, Office/Power BI integration and broad enterprise rollout remain outside scope.

## Verification status

The own-project revision passed **lint, typecheck/build, 36 unit/API tests and all ten browser checks**, including private project roundtrip and the colleague handoff, cited Map synthesis, persistent ledger, private resume and voice relay/teardown checks. Earlier Claude vision, Expressive ElevenAgents audio and Scribe component checks used fictional pixels and synthetic speech. **Human microphone, interruptions, spoken teach-back and independent unseen transfer remain unrun.** Hosted HTTPS health/authentication, authenticated app/status, invalid-Origin rejection and blocked unauthenticated WSS upgrade passed. The complete disk ledger survived a restart with initialization disabled. The user confirmed a fresh Chrome sign-in and homepage. These checks establish hosted access, not successful human voice transport or transfer. The sanitized source and built bundle were scanned before publication. Automated fixtures and synthetic speech do not establish human success.

```sh
npm run lint
npm run typecheck
npm run test
npm run build
npm run test:browser
```

Browser checks need Playwright Chromium. The suite does not call providers. The separate smoke script is opt-in, billable and should run only under an approved remaining budget. Development test oracles stay in `tests/`; production prompts do not import them.

## Judge demo access

**[Open The Ropes](https://the-ropes.onrender.com)**. The hosted homepage is live behind native Basic authentication. Judges receive the demo username/password separately through an approved private route; those credentials and provider keys are never in this repository. Exact HTTPS Host/Origin checks, rate/concurrency limits and a persistent ledger protect paid routes. Mock is the default; paid calls remain disabled pending the consenting human rehearsal. The operator must verify and document the actual human result before claiming live learning transfer. A clearly labelled mock walkthrough is available while that proof is pending. Source: [papermelon/the-ropes](https://github.com/papermelon/the-ropes). The Render service is named **The Ropes**, and the application package is `the-ropes`. The hosted URL is `https://the-ropes.onrender.com`; the migration preserves the existing demo access and complete provider usage ledger, with initialization and paid calls disabled.

## License

Original project code is [MIT licensed](LICENSE). Attribution currently uses the builder's GitHub alias `papermelon`; preferred copyright attribution is awaiting confirmation. Dependencies retain their respective licenses. Private reference documents, captures, recordings and provider services are not licensed by this repository.
