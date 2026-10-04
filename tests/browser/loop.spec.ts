import { test, expect, type Page } from '@playwright/test';

// Browser media is deliberately mocked here. These are automated development checks, not competition evidence.
async function mediaHarness(page: Page) {
  await page.addInitScript(() => {
    const streams: MediaStream[] = [];
    Object.defineProperty(window, '__testStreams', { value: streams });
    Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { value: async () => {
      const canvas = document.createElement('canvas'); canvas.width = 1000; canvas.height = 600;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#f5f5ef'; ctx.fillRect(0, 0, 1000, 600); ctx.fillStyle = '#234f3a'; ctx.font = '28px sans-serif';
      ctx.fillText('AUTOMATED TEST · SIMULATED SCREEN', 35, 80); ctx.font = '20px sans-serif';
      ctx.fillText('Synthetic initiative: past delivery / annual outlook / readiness', 35, 150);
      const stream = canvas.captureStream(1); streams.push(stream); return stream;
    } });
  });
}

test('off-record reconnect and explicit private restore preserve the pending answer without granting consent', async ({ page }) => {
  await mediaHarness(page); await consent(page); await share(page);
  await page.waitForTimeout(2200);
  await page.getByRole('button', { name: 'Ask now', exact: true }).click();
  const exactWords = 'AUTOMATED TEST pending explanation: no agreed benchmark; stop rather than invent a past commitment.';
  await page.getByLabel('Expert answer · exact words').fill(exactWords);
  await page.getByRole('button', { name: /Off record/ }).click();
  await expect(page.getByLabel('Expert answer · exact words')).toHaveValue(exactWords);
  await expect(page.getByRole('button', { name: 'Keep this explanation' })).toBeDisabled();
  expect(await page.evaluate(() => (window as unknown as { __testStreams: MediaStream[] }).__testStreams.every(s => s.getTracks().every(t => t.readyState === 'ended')))).toBe(true);
  await sessionAction(page, 'Evidence & settings');
  await page.getByText('Session controls & provider diagnostics', { exact: false }).click();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export private Work Map', exact: true }).click();
  const filePath = (await (await downloadEvent).path())!;
  const fs = await import('node:fs/promises'); const exported = JSON.parse(await fs.readFile(filePath, 'utf8'));
  expect(exported.resume.answer).toBe(exactWords); expect(exported.questions).toHaveLength(1);
  await page.reload(); await page.getByRole('button', { name: 'Begin expert review' }).click();
  await sessionAction(page, 'Evidence & settings');
  await page.getByText('Session controls & provider diagnostics', { exact: false }).click();
  await page.getByLabel('Restore private Work Map').setInputFiles(filePath);
  await expect(page.getByText('Private evidence restored as historical.', { exact: false })).toBeVisible();
  await expect(page.getByLabel('Expert answer · exact words')).toHaveValue(exactWords);
  await expect(page.getByRole('button', { name: 'Keep this explanation' })).toBeDisabled();
  await page.getByRole('button', { name: 'Reconnect screen', exact: true }).click();
  const setup = page.getByRole('dialog', { name: 'Let your apprentice observe' });
  await expect(setup.getByLabel('I consent to selected screen')).not.toBeChecked();
  await expect(setup.getByLabel('I consent to microphone')).not.toBeChecked();
  await share(page);
  await expect(page.getByLabel('Expert answer · exact words')).toHaveValue(exactWords);
  await page.getByRole('button', { name: 'Keep this explanation' }).click();
  await expect(page.getByText('1/3 explanations', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: /Off record/ }).click();
});

test('repeated start clicks create one segment and rolling capture retains cited frames beyond the 80-frame window', async ({ page }) => {
  await page.clock.install(); await mediaHarness(page); await consent(page);
  let starts = 0; page.on('request', request => { if (request.method() === 'POST' && new URL(request.url()).pathname === '/api/session') starts++; });
  const setup = page.getByRole('dialog', { name: 'Let your apprentice observe' });
  await setup.getByRole('button', { name: 'Share review workspace' }).click();
  await setup.getByLabel('This preview shows only').check();
  await setup.getByRole('button', { name: 'Start on record' }).dblclick();
  await expect(page.getByText('On record', { exact: true })).toBeVisible(); expect(starts).toBe(1);
  await page.waitForTimeout(2200); await page.getByRole('button', { name: 'Ask now', exact: true }).click();
  await page.getByLabel('Expert answer · exact words').fill('AUTOMATED TEST: retain this exact explanation and supporting frame through a longer bounded capture.');
  await page.getByRole('button', { name: 'Keep this explanation' }).click();
  await page.getByLabel('Still reading / thinking').check();
  await page.clock.runFor(180000);
  await expect(page.getByText('On record', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Off record/ }).click();
  await sessionAction(page, 'Evidence & settings'); await page.getByText('Session controls & provider diagnostics', { exact: false }).click();
  const downloadEvent = page.waitForEvent('download'); await page.getByRole('button', { name: 'Export private Work Map', exact: true }).click();
  const path = (await (await downloadEvent).path())!;
  const data = JSON.parse(await import('node:fs/promises').then(fs => fs.readFile(path, 'utf8')));
  expect(data.frames).toHaveLength(80); expect(data.segments).toHaveLength(1);
  expect(data.frames.some((frame: { id: string }) => frame.id === data.questions[0].frameId)).toBe(true);
});
async function start(page: Page) {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Better inputs. Shared understanding.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Begin expert review' })).toBeVisible();
  await page.getByRole('button', { name: 'Begin expert review' }).click();
  await expect(page.getByRole('heading', { name: 'What was delivered this quarter?' })).toBeVisible();
}
async function sessionAction(page: Page, name: string) {
  await page.getByLabel('Session menu').click();
  await page.getByRole('button', { name, exact: true }).click();
}
async function focus(page: Page, topic: string) {
  await page.getByRole('combobox', { name: /^(Review focus|Update section)$/ }).selectOption(topic);
}
async function practice(page: Page, topic: string) {
  if (await page.getByRole('button', { name: 'Try another case' }).isVisible()) await page.getByRole('button', { name: 'Try another case' }).click();
  await page.getByRole('combobox', { name: 'Principle to practise' }).selectOption(topic);
  await page.getByRole('button', { name: 'Open unseen initiative' }).click();
}
async function consent(page: Page) {
  await start(page);
  await page.getByRole('button', { name: 'Set up screen & voice' }).click();
  await page.getByLabel('I consent to selected screen').check();
}
async function share(page: Page) {
  const setup = page.getByRole('dialog', { name: 'Let your apprentice observe' });
  if (!(await setup.isVisible())) await page.getByRole('button', { name: /Set up screen & voice|^Reconnect screen$/ }).click();
  if (await page.getByRole('region', { name: 'Division update draft' }).count()) { await expect(setup.getByLabel('I consent to selected screen')).not.toBeChecked(); await expect(setup.getByLabel('I consent to microphone')).not.toBeChecked(); }
  await setup.getByLabel('I consent to selected screen').check();
  await setup.getByRole('button', { name: /Share review workspace|Reconnect screen/ }).click();
  await setup.getByLabel('This preview shows only').check();
  await setup.getByRole('button', { name: 'Start on record' }).click();
  await expect(setup).toHaveCount(0);
  await expect(page.getByText('On record', { exact: true })).toBeVisible();
}
async function answerCapture(page: Page, focus: string, words: string) {
  await page.getByRole('combobox', { name: 'Review focus', exact: true }).selectOption(focus);
  // Wait for a sampled image after the review focus changed, then deliberately ask at quiet.
  await page.waitForTimeout(2200);
  if (!(await page.getByLabel('Expert answer · exact words').isVisible())) await page.getByRole('button', { name: 'Ask now', exact: true }).click();
  await expect(page.getByLabel('Expert answer · exact words')).toBeVisible();
  await page.getByLabel('Expert answer · exact words').fill(words);
  await page.getByRole('button', { name: 'Keep this explanation' }).click();
}
async function fillDraft(page: Page, expert = false, kind = '') {
  await focus(page,'delivery');
  await page.getByLabel(expert ? 'Past delivery assessment' : 'Quarterly delivery claim', { exact: true }).selectOption(kind === 'delivery' ? 'missed' : kind === 'outlook' ? 'met' : 'not-assessable');
  await page.getByLabel('Benchmark basis', { exact: true }).selectOption(kind === 'outlook' ? 'agreed-milestone' : 'missing-benchmark');
  await page.getByLabel(expert ? 'Past delivery reasoning' : 'Quarterly progress & evidence', { exact: true }).fill('AUTOMATED TEST: design sessions completed; trial evidence and benchmark must be distinguished.');
  await focus(page,'outlook');
  await page.getByLabel(expert ? 'Annual outlook assessment' : 'Annual forecast', { exact: true }).selectOption('achievable');
  await page.getByLabel(expert ? 'Annual outlook reasoning' : 'Plan & annual forecast', { exact: true }).fill('AUTOMATED TEST: annual launch depends on partner dates and a credible trial.');
  await page.getByLabel(expert ? 'Forecast assumptions & risks' : 'Dependencies, owners & risks', { exact: true }).fill('AUTOMATED TEST: owner must confirm coordinator capacity, trial dates and delay consequences.');
  await focus(page,'readiness');
  await page.getByLabel(expert ? 'Review readiness flag' : 'Ready to send?', { exact: true }).selectOption(kind === 'readiness' ? 'ready' : 'needs-clarification');
  await page.getByLabel(expert ? 'Submitted status assessment' : 'How well is your status supported?', { exact: true }).selectOption(kind === 'readiness' ? 'supported' : 'qualified');
  await page.getByLabel(expert ? 'Reviewer performance status' : 'Division performance status', { exact: true }).selectOption(kind === 'delivery' ? 'Off track' : 'On track');
  await page.getByLabel(expert ? 'Review readiness reasoning' : 'Why this status?', { exact: true }).fill('AUTOMATED TEST: status is assessed separately from quarterly delivery and input completeness.');
  await page.getByLabel(expert ? 'Clarification request to division' : 'Unconfirmed details to flag', { exact: true }).fill('AUTOMATED TEST: owner to confirm coordinators, dates and consequence of delay.');
  if (!expert) await page.getByLabel('Management support requested', { exact: true }).fill('AUTOMATED TEST: coordinate partner availability before the proposed trial.');
}
async function learn(page: Page) {
  await consent(page); await share(page); await fillDraft(page,true);
  await answerCapture(page, 'delivery', 'A missing quarterly benchmark does not prove a missed commitment. Stop before inventing a retrospective milestone or using a KPI link as outcome proof.');
  await answerCapture(page, 'outlook', 'Assess the annual outlook against the known commitment and credible recovery evidence. A forecast does not erase missed quarterly delivery.');
  await answerCapture(page, 'readiness', 'A report with unconfirmed dependencies needs a qualified assessment or clarification. Ask for the owner, dates, evidence and consequence; review readiness is separate from performance status.');
  await page.getByRole('button', { name: 'Finish task & open debrief' }).click();
  await page.getByRole('button', { name: 'Start debrief on record' }).click();
  for (const words of ['A future milestone should state deliverable, scale, due date and evidence. It must be agreed by the owner; never invent a past commitment.', 'I would keep the missed milestone visible and test the recovery plan against partner capacity, timing and contingency.', 'An external dependency might justify a qualified update if its owner and contingency are explicit. Management coordination is a separate decision.']) {
    await page.waitForTimeout(600);
    await page.getByRole('button', { name: 'Ask this follow-up →', exact: true }).first().click();
    await page.getByLabel('Expert answer · exact words').fill(words);
    await page.getByRole('button', { name: 'Keep this explanation' }).click();
  }
  await page.getByRole('button', { name: 'Build editable teach-back' }).click();
  const cards = page.locator('article.rule'); await expect(cards).toHaveCount(1);
  for (let i = 0; i < 3; i++) {
    const card = cards.first();
    for (const key of ['title', 'decision', 'conditions', 'exceptions', 'rationale', 'guardrail']) await card.getByRole('textbox', { name: new RegExp('^' + key + '$', 'i') }).fill(`TEST expert-approved ${key}: apply within the shown evidence; stop and ask if uncertain.`);
    await expect(card.getByText('Debrief clarification', { exact: false })).toBeVisible();
    await expect(card.getByRole('combobox', { name: 'Supporting screen for debrief' })).toHaveValue('');
    if (i === 0) { await card.getByRole('button', { name: 'Approve this interpretation' }).click(); await expect(page.locator('.notice')).toContainText('Rule needs a real supporting frame'); }
    await card.getByRole('combobox', { name: 'Supporting screen for debrief' }).selectOption({ index: 1 });
    await card.getByRole('button', { name: 'Approve this interpretation' }).click();
    await expect(card.getByText('confirmed', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: i < 2 ? 'Next interpretation' : 'Hear the full teach-back' }).click();
  }
  await page.getByRole('button', { name: 'Present simulated teach-back' }).click();
  await page.getByRole('button', { name: /Yes, this is how I review/ }).click();
  await expect(page.getByText('Teach-back confirmed ✓', { exact: true })).toBeVisible();
}
test('complete simulated Capture → Map → Teach catches before save, lets novice correct, and deletes dependencies', async ({ page }) => {
  await mediaHarness(page); await learn(page);
  await sessionAction(page, 'Teach a new case');
  await practice(page, 'delivery');
  await expect(page.getByLabel('Quarterly delivery claim', { exact: true })).toHaveValue('not-assessed');
  await expect(page.getByLabel('Quarterly progress & evidence', { exact: true })).toHaveValue('');
  await fillDraft(page,false,'delivery');
  await page.screenshot({ path: 'test-results/division-update-draft.png', fullPage: true });
  await expect(page.locator('.case-line')).toContainText('Neighbourhood access trial');
  await share(page);
  await page.getByLabel('Before you send, what will you check?').fill('I would check whether a quarterly benchmark was agreed, then assess the annual forecast separately.');
  await page.getByRole('button', { name: 'Check & save update' }).click();
  await expect(page.getByText('Paused before save · an expert-confirmed guardrail needs your decision.', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'What agreed benchmark supports that past-delivery judgment?' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Off record/ })).toBeVisible();
  await page.screenshot({ path: 'test-results/guided-coaching.png', fullPage: true });
  await page.getByRole('button', { name: 'Replay expert frame' }).click();
  await expect(page.getByRole('dialog')).toBeVisible(); await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', { name: 'Return to my update' }).click();
  await page.getByRole('combobox', { name: 'Quarterly delivery claim', exact: true }).selectOption('not-assessable');
  await focus(page, 'readiness');
  await page.getByRole('combobox', { name: 'Division performance status', exact: true }).selectOption('On track');
  await focus(page, 'delivery');
  await page.getByRole('textbox', { name: 'Quarterly progress & evidence', exact: true }).fill('No Q3 benchmark was agreed. Seek clarification without inventing a past commitment.');
  await focus(page,'readiness');
  await page.getByRole('button', { name: 'Check & save update' }).click();
  await focus(page,'delivery');
  await page.getByRole('textbox', { name: 'Quarterly progress & evidence', exact: true }).fill('Unchecked new judgment claims a missing benchmark proves failure.');
  await expect(page.getByText('Report, evidence or recording changed. Check the current revision again.', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Quarterly progress & evidence', exact: true }).fill('No Q3 benchmark was agreed. Seek clarification without inventing a past commitment.');
  await focus(page,'readiness');
  await page.getByRole('button', { name: 'Check & save update' }).click();
  await expect(page.getByText('Checked update saved locally for this practice.', { exact: true })).toBeVisible();
  await expect(page.getByText('DEVELOPMENT ROLE SIMULATION', { exact: false })).toBeVisible();
  await page.screenshot({ path: 'test-results/practice-comparison.png', fullPage: true });
  await expect(page.getByRole('table')).toContainText('Off track');
  await expect(page.getByRole('table')).toContainText('On track');
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export private practice & evidence' }).click();
  const download = await downloadEvent; const contents = await import('node:fs/promises').then(fs => download.path().then(path => fs.readFile(path!, 'utf8')));
  const exported = JSON.parse(contents); expect(exported.practices[0].firstAttempt.review.recommendedStatus).toBe('Off track'); expect(exported.practices[0].savedDraft.review.recommendedStatus).toBe('On track');
  expect(exported.practices[0].humanSelfDeclared).toBe(false);
  expect(await page.evaluate(() => (window as unknown as { __testStreams: MediaStream[] }).__testStreams.every(s => s.getTracks().every(t => t.readyState === 'ended')))).toBe(true);
  await practice(page, 'outlook'); await fillDraft(page,false,'outlook');
  await share(page);
  await page.getByLabel('Before you send, what will you check?').fill('Check past milestone delivery separately from the recovery forecast.');
  await page.getByRole('button', { name: 'Check & save update' }).click();
  await expect(page.getByRole('heading', { name: 'Does the annual forecast change what was delivered against the agreed quarterly milestone?' })).toBeVisible();
  await page.getByRole('button', { name: 'Return to my update' }).click();
  await focus(page, 'delivery');
  await page.getByLabel('Quarterly delivery claim', { exact: true }).selectOption('missed');
  await page.getByLabel('Quarterly progress & evidence', { exact: true }).fill('December trial missed; annual June forecast depends on the recovery plan.');
  await focus(page,'readiness');
  await page.getByRole('button', { name: 'Check & save update' }).click();
  await expect(page.getByText('Checked update saved locally for this practice.', { exact: true })).toBeVisible();
  await practice(page, 'readiness'); await fillDraft(page,false,'readiness');
  await share(page);
  await page.getByLabel('Before you send, what will you check?').fill('Test whether pending partner commitments support readiness.');
  await page.getByRole('button', { name: 'Check & save update' }).click();
  await expect(page.getByRole('heading', { name: 'What evidence supports accepting this status with the dependencies still unconfirmed?' })).toBeVisible();
  await page.getByRole('button', { name: 'Return to my update' }).click();
  await page.getByLabel('Ready to send?', { exact: true }).selectOption('needs-clarification');
  await page.getByLabel('How well is your status supported?', { exact: true }).selectOption('qualified');
  await page.getByLabel('Unconfirmed details to flag', { exact: true }).fill('Owner to confirm coordinator names, dates and effect of a delay on the June commitment.');
  await focus(page,'readiness');
  await page.getByRole('button', { name: 'Check & save update' }).click();
  await expect(page.getByText('Checked update saved locally for this practice.', { exact: true })).toBeVisible();
  await sessionAction(page, 'Map the judgment');
  await page.getByRole('button', { name: 'Edit past delivery rule' }).click();
  const card = page.locator('article.rule').first();
  await card.getByRole('textbox', { name: 'rationale', exact: true }).fill('Corrected by TEST expert: clarify missing benchmarks without inventing a past commitment.');
  await expect(card.getByText('draft', { exact: true })).toBeVisible();
  await sessionAction(page, 'Teach a new case');
  await expect(page.getByRole('heading', { name: 'Not ready to teach.' })).toBeVisible();
  await sessionAction(page, 'Map the judgment');
  await card.getByRole('button', { name: 'Reject', exact: true }).click();
  await expect(card.getByText('rejected', { exact: true })).toBeVisible();
  await sessionAction(page, 'Map the judgment');
  await page.getByText('Excluded interpretations (1)', { exact: true }).click();
  await page.getByRole('button', { name: 'Review excluded past delivery rule' }).click();
  await card.getByRole('button', { name: 'Approve this interpretation' }).click();
  await sessionAction(page, 'Map the judgment');
  await page.getByRole('button', { name: 'Present simulated teach-back' }).click();
  await page.getByRole('button', { name: /Yes, this is how I review/ }).click();
  await sessionAction(page, 'Evidence & settings');
  await page.locator('.segment-list details').first().locator('summary').click();
  await page.getByRole('button', { name: 'Delete segment & dependent evidence/rules' }).first().click();
  await expect(page.locator('article.rule')).toHaveCount(0);
  await page.getByRole('button', { name: 'Close Session evidence & settings' }).click();
  await sessionAction(page, 'Teach a new case');
  await expect(page.getByRole('heading', { name: 'Not ready to teach.' })).toBeVisible();
  await page.screenshot({ path: 'test-results/loop-after-deletion.png', fullPage: true });
});
test('consent denial and not-ready state are visible; no implicit seeded rules', async ({ page }) => {
  await start(page);
  await page.getByRole('button', { name: 'Set up screen & voice' }).click();
  await expect(page.getByRole('button', { name: 'Share review workspace' })).toBeDisabled();
  await page.getByLabel('I consent to selected screen').check();
  await page.addInitScript(() => Object.defineProperty(navigator.mediaDevices, 'getDisplayMedia', { value: async () => { throw new DOMException('Test permission denied', 'NotAllowedError'); } }));
  await page.reload(); await consent(page);
  await page.getByRole('button', { name: 'Share review workspace' }).click();
  await expect(page.locator('.notice')).toContainText('Test permission denied');
  await page.getByRole('button', { name: 'Close Let your apprentice observe' }).click();
  await sessionAction(page, 'Map the judgment');
  await expect(page.getByRole('heading', { name: 'Show me your reasoning first.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Return to the expert review' })).toBeVisible();
  await sessionAction(page, 'Teach a new case'); await expect(page.getByRole('heading', { name: 'Not ready to teach.' })).toBeVisible();
});
test('off record stops acquisition and discards a delayed analysis; reconnect and stopped sharing are explicit', async ({ page }) => {
  await mediaHarness(page); await consent(page); await share(page);
  let reasonCalls = 0;
  await page.route('**/reason', async route => { reasonCalls++; await new Promise(resolve => setTimeout(resolve, 1500)); try { await route.fulfill({ json: { topic: 'delivery', observation: 'Delayed test analysis', question: 'LATE MUST NOT APPEAR', guardrail: true, uncertainty: 'TEST' } }); } catch { /* cancelled request */ } });
  await page.waitForTimeout(700); await page.getByRole('button', { name: 'Ask now', exact: true }).click();
  await page.getByRole('button', { name: /Off record/ }).click();
  await page.waitForTimeout(2400);
  await expect(page.getByText('LATE MUST NOT APPEAR')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __testStreams: MediaStream[] }).__testStreams.every(s => s.getTracks().every(t => t.readyState === 'ended')))).toBe(true);
  const count = reasonCalls; await page.waitForTimeout(2100); expect(reasonCalls).toBe(count);
  await share(page);
  await page.evaluate(() => { const streams = (window as unknown as { __testStreams: MediaStream[] }).__testStreams; streams.at(-1)!.getVideoTracks()[0].dispatchEvent(new Event('ended')); });
  await expect(page.getByRole('button', { name: 'Reconnect screen' })).toBeVisible();
});
test('reading hold blocks questions, provider errors remain errors, and reset empties evidence', async ({ page }) => {
  await mediaHarness(page); await consent(page); await share(page);
  await page.getByLabel('Still reading / thinking').check();
  await page.waitForTimeout(4000); await expect(page.getByLabel('Expert answer · exact words')).toHaveCount(0);
  await page.getByRole('button', { name: 'Ask now', exact: true }).click(); await expect(page.getByText('Waiting for quiet', { exact: false })).toBeVisible();
  await page.getByLabel('Still reading / thinking').uncheck();
  let calls = 0;
  await page.route('**/reason', route => { calls++; return route.fulfill({ status: 429, json: { error: 'TEST rate limit · reconnect deliberately' } }); });
  await page.waitForTimeout(650); await page.getByRole('button', { name: 'Ask now', exact: true }).click();
  await expect(page.locator('.notice')).toContainText('TEST rate limit · reconnect deliberately');
  await page.waitForTimeout(2300); expect(calls).toBe(1);
  await sessionAction(page, 'New session');
  await sessionAction(page, 'Teach a new case'); await expect(page.getByRole('heading', { name: 'Not ready to teach.' })).toBeVisible();
});
test('malformed analysis never creates a question and text controls preserve keyboard focus', async ({ page }) => {
  await mediaHarness(page); await consent(page); await share(page);
  await page.route('**/reason', route => route.fulfill({ json: { question: 'Invented question without evidence schema' } }));
  await page.waitForTimeout(700); await page.getByRole('button', { name: 'Ask now', exact: true }).click();
  await expect(page.getByLabel('Expert answer · exact words')).toHaveCount(0);
  await page.unroute('**/reason'); await page.waitForTimeout(700); await page.getByRole('button', { name: 'Ask now', exact: true }).click();
  const input = page.getByLabel('Expert answer · exact words'); await expect(input).toBeVisible();
  await input.pressSequentially('Expert keyboard answer'); await expect(input).toHaveValue('Expert keyboard answer'); await expect(input).toBeFocused();
});

test('guided review preserves independent drafts, focus and provisional proposals', async ({ page }) => {
  await start(page);
  const source = page.getByRole('region', { name: 'Original initiative submission' });
  await expect(source.getByText('No quarterly benchmark was agreed.')).toBeVisible();
  await expect(source.locator('input,textarea,select')).toHaveCount(0);
  await page.getByLabel('Past delivery assessment', { exact: true }).selectOption('not-assessable');
  await expect(page.getByRole('button', { name: 'Next: annual outlook' })).toBeDisabled();
  await focus(page,'outlook');
  await expect(page.getByRole('heading', { name: 'Can the annual commitment still be met?' })).toBeFocused();
  await expect(page.getByLabel('Past delivery assessment', { exact: true })).toBeHidden();
  await page.getByLabel('Annual outlook assessment', { exact: true }).selectOption('achievable');
  await focus(page,'readiness');
  await expect(page.getByRole('heading', { name: 'Is this ready for leadership?' })).toBeFocused();
  await page.getByLabel('Review readiness flag', { exact: true }).selectOption('needs-clarification');
  await expect(page.getByLabel('Reviewer performance status', { exact: true })).toHaveValue('not-assessed');
  await focus(page, 'delivery');
  await expect(page.getByLabel('Past delivery assessment', { exact: true })).toHaveValue('not-assessable');
  const summary = page.locator('.assessment-summary');
  await summary.locator('summary').click();
  await expect(summary).toContainText('Not assessable');
  await expect(summary).toContainText('Achievable');
  await expect(summary).toContainText('Needs clarification');
  await page.getByText('Follow-up & management action', { exact: true }).click();
  await page.getByLabel('Proposed future milestone', { exact: true }).fill('Trial two partners by February with documented handovers.');
  await expect(page.getByText('Proposal · not an agreed commitment')).toBeVisible();
  await expect(source.getByText('No quarterly benchmark was agreed.')).toBeVisible();
  await page.getByLabel('Record a confirmation of this future proposal').check();
  await expect(page.getByLabel('Future milestone confirmation record')).toBeVisible();
  await expect(page.getByText('Proposal · confirmation record needed', { exact: true })).toBeVisible();
  await page.getByLabel('Proposed future milestone', { exact: true }).fill('Revised forward proposal requiring new owner agreement.');
  await expect(page.getByText('Proposal · not an agreed commitment')).toBeVisible();
  await expect(page.getByLabel('Future milestone confirmation record')).toHaveCount(0);
  await page.screenshot({ path: 'test-results/guided-review.png', fullPage: true });
});

test('closing the setup step releases preview tracks before anything is recorded', async ({ page }) => {
  await mediaHarness(page); await consent(page);
  let calls = 0;
  await page.route('**/reason', route => { calls++; return route.abort(); });
  await page.getByRole('dialog').getByRole('button', { name: 'Share review workspace' }).click();
  await expect(page.getByAltText('Selected screen preview, not recorded or sent to providers')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Start on record' })).toBeDisabled();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as { __testStreams: MediaStream[] }).__testStreams.every(s => s.getTracks().every(t => t.readyState === 'ended')))).toBe(true);
  await page.waitForTimeout(2300); expect(calls).toBe(0);
  await expect(page.getByRole('button', { name: 'Reconnect screen', exact: true })).toBeVisible();
  await sessionAction(page, 'Evidence & settings');
  await expect(page.getByRole('dialog')).toContainText('No captured frames.');
});
