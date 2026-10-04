// Server-only fictional cases. No expected-answer annotations enter Capture/Map or the client bundle.
import { emptyReview, trainingReport, type Report, type Topic } from './domain';
export function unseenCase(topic: Topic): Report {
  const base: Report = { ...structuredClone(trainingReport), id: `practice-${topic}`, initiative: 'Neighbourhood access trial', owner: 'Community Partnerships Division · Alder Civic Trust', supporting: 'Operations; five community partners', period: 'Q3 · Oct–Dec 2026', currentQuarter: 'Q3',
    annualCommitment: 'Test and launch an accessible appointment pathway with five community partners, including a documented handover and an adoption review.', annualDue: '30 June 2027',
    milestones: [{ quarter: 'Q3', statement: 'No Q3 benchmark was agreed.', agreement: 'missing', delivery: 'unknown' }, { quarter: 'Q4', statement: 'Trial with two partners and document accessibility feedback.', agreement: 'draft', delivery: 'pending' }],
    progress: 'Two partners completed design sessions. The team proposes a February trial and June launch. Coordinators have not committed to the proposed dates.',
    evidence: [{ label: 'Design notes · 12 Dec', detail: 'Two design sessions held. The notes describe needs and a draft process; they contain no trial results or confirmed dates.' }],
    dependencies: [{ item: 'Five partner coordinators must confirm availability and trial dates.', resolution: 'pending' }],
    linkedKpis: [{ id: 'KPI P4', title: 'Accessible service experience', relationship: 'This trial may contribute to a corporate measure shared with other initiatives. No adoption or service outcome is measured yet.' }],
    submittedDecision: 'Seek management support to confirm coordinators.',
    review: { ...emptyReview }
  };
  if (topic === 'delivery') return base;
  if (topic === 'outlook') return { ...base,
    milestones: [{ quarter: 'Q3', statement: 'Complete an accessibility trial with two partners by 31 December.', agreement: 'agreed', delivery: 'missed' }, ...base.milestones.slice(1)],
    progress: 'The agreed December trial has not started. A February recovery trial is proposed; the owner still expects a June launch.',
    evidence: [{ label: 'Trial register · 31 Dec', detail: 'No trial completed against the agreed December milestone. Design sessions are complete.' }]
  };
  return base;
}
