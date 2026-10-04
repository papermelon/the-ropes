import { useState, type FormEvent, type ReactNode } from 'react';
import { emptyReview, performanceStatuses, ReportSchema, uid, type Report } from './domain';

/** A local form: nothing is uploaded or sent to providers until the recording flow is consented. */
export function ProjectForm({ initial, onSave, onCancel }: { initial?: Report; onSave: (report: Report) => void; onCancel: () => void }) {
  const [error, setError] = useState('');
  const [counts, setCounts] = useState({ milestones: initial?.milestones.length || 1, evidence: initial?.evidence.length || 0, dependencies: initial?.dependencies.length || 0, linkedKpis: initial?.linkedKpis.length || 0 });
  function field(name: string, label: string, value = '', required = false, maxLength = 1500, multiline = false) {
    return <label key={name}>{label}{multiline ? <textarea name={name} defaultValue={value} required={required} maxLength={maxLength}/> : <input name={name} defaultValue={value} required={required} maxLength={maxLength}/>}</label>;
  }
  function choice(name: string, label: string, options: Record<string, string>, value = '') {
    return <label>{label}<select aria-label={label} name={name} defaultValue={value} required><option value="">Choose…</option>{Object.entries(options).map(([key, text]) => <option value={key} key={key}>{text}</option>)}</select></label>;
  }
  function rows(kind: keyof typeof counts, title: string, max: number, render: (index: number) => ReactNode) {
    return <section className="project-section"><h3>{title}</h3>{Array.from({ length: counts[kind] }, (_, i) => <fieldset key={i}><legend>{title} {i + 1}</legend>{render(i)}</fieldset>)}<div className="button-row"><button type="button" className="text-button" disabled={counts[kind] >= max} onClick={() => setCounts(c => ({ ...c, [kind]: c[kind] + 1 }))}>Add {title.toLowerCase()}</button>{counts[kind] > (kind === 'milestones' ? 1 : 0) && <button type="button" className="text-button" onClick={() => setCounts(c => ({ ...c, [kind]: c[kind] - 1 }))}>Remove last {title.toLowerCase()}</button>}</div></section>;
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); const data = new FormData(event.currentTarget);
    const value = (name: string) => String(data.get(name) || '').trim();
    const entries = (kind: keyof typeof counts, keys: string[]) => Array.from({ length: counts[kind] }, (_, i) => Object.fromEntries(keys.map(key => [key, value(`${kind}.${i}.${key}`)])));
    const parsed = ReportSchema.safeParse({ source: 'user-provided', id: initial?.id || uid(), ...Object.fromEntries(['initiative', 'owner', 'supporting', 'period', 'cadence', 'currentQuarter', 'annualCommitment', 'annualAgreement', 'annualDue', 'progress', 'submittedStatus', 'resultsPath', 'submittedDecision'].map(key => [key, value(key)])), milestones: entries('milestones', ['quarter', 'statement', 'agreement', 'delivery']), evidence: entries('evidence', ['label', 'detail']), dependencies: entries('dependencies', ['item', 'resolution']), linkedKpis: entries('linkedKpis', ['id', 'title', 'relationship']), review: { ...emptyReview } });
    if (!parsed.success) { setError(parsed.error.issues.map(issue => issue.message).join(' ')); return; }
    onSave(parsed.data);
  }
  return <form className="project-form" onSubmit={submit}>
    <p>Enter the initiative update you want to review. Use only facts you can share with the voice and screen providers. These details stay in this tab until you start a consented recording or export them privately.</p>
    {error && <p className="error" role="alert">{error}</p>}
    <div className="form-grid">{field('initiative', 'Project / initiative name', initial?.initiative, true, 160)}{field('owner', 'Lead division / owner', initial?.owner, true, 160)}{field('period', 'Reporting period', initial?.period, true, 100)}{field('currentQuarter', 'Current period identifier · match a milestone below', initial?.currentQuarter, true, 100)}{field('cadence', 'Reporting cadence', initial?.cadence, false, 100)}{field('supporting', 'Supporting teams', initial?.supporting, false, 300)}</div>
    {field('annualCommitment', 'Annual commitment / goal', initial?.annualCommitment, true, 1500, true)}
    <div className="form-grid">{choice('annualAgreement', 'Annual commitment agreement', { agreed: 'Agreed', draft: 'Draft / unconfirmed' }, initial?.annualAgreement)}{field('annualDue', 'Annual due date · or state unknown', initial?.annualDue, true, 100)}</div>
    {rows('milestones', 'Milestone', 4, i => <><div className="form-grid">{field(`milestones.${i}.quarter`, 'Period identifier', initial?.milestones[i]?.quarter, true, 100)}{choice(`milestones.${i}.agreement`, 'Milestone agreement', { agreed: 'Agreed', draft: 'Draft / unconfirmed', missing: 'No agreed benchmark' }, initial?.milestones[i]?.agreement)}</div>{field(`milestones.${i}.statement`, 'Milestone / missing benchmark explanation', initial?.milestones[i]?.statement, true, 1500, true)}{choice(`milestones.${i}.delivery`, 'Recorded delivery', { met: 'Met', missed: 'Missed', pending: 'Pending', unknown: 'Unknown' }, initial?.milestones[i]?.delivery)}</>)}
    {field('progress', 'Submitted progress / update', initial?.progress, true, 1500, true)}
    {choice('submittedStatus', 'Submitted performance status', Object.fromEntries(performanceStatuses.map(status => [status, status])), initial?.submittedStatus)}
    {rows('evidence', 'Evidence', 8, i => <>{field(`evidence.${i}.label`, 'Evidence label / reference', initial?.evidence[i]?.label, true, 200)}{field(`evidence.${i}.detail`, 'What the evidence establishes', initial?.evidence[i]?.detail, true, 1500, true)}</>)}
    {rows('dependencies', 'Dependency', 8, i => <>{field(`dependencies.${i}.item`, 'Dependency / uncertainty', initial?.dependencies[i]?.item, true, 1500, true)}{choice(`dependencies.${i}.resolution`, 'Dependency confirmation', { pending: 'Unconfirmed', confirmed: 'Confirmed' }, initial?.dependencies[i]?.resolution)}</>)}
    {rows('linkedKpis', 'KPI link', 8, i => <>{field(`linkedKpis.${i}.id`, 'KPI identifier', initial?.linkedKpis[i]?.id, true, 100)}{field(`linkedKpis.${i}.title`, 'KPI title', initial?.linkedKpis[i]?.title, true, 300)}{field(`linkedKpis.${i}.relationship`, 'Relationship / possible contribution', initial?.linkedKpis[i]?.relationship, true, 1500, true)}</>)}
    {field('resultsPath', 'Results pathway / assumptions · optional', initial?.resultsPath, false, 1500, true)}
    {field('submittedDecision', 'Management support request · optional', initial?.submittedDecision, false, 1500, true)}
    <div className="button-row"><button className="primary" type="submit">Use this project →</button><button className="secondary" type="button" onClick={onCancel}>Cancel</button></div>
  </form>;
}
