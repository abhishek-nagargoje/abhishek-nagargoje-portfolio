export type Tone = 'positive' | 'negative' | 'critical' | 'information' | 'neutral';

const TONES: Record<string, Tone> = {
  // generic
  Approved: 'positive', Passed: 'positive', Done: 'positive', Closed: 'positive', Resolved: 'positive', Received: 'positive',
  Delivered: 'positive', Billed: 'positive', Posted: 'positive', 'Goods Issued': 'positive', Active: 'positive', Ordered: 'positive',
  'On Track': 'positive',
  Failed: 'negative', Rejected: 'negative', Blocked: 'negative', Critical: 'negative', Cancelled: 'negative', 'Off Track': 'negative',
  'Pending Approval': 'critical', 'In Process': 'critical', 'In Progress': 'critical', Retest: 'critical', Fixed: 'critical',
  Investigating: 'critical', 'Partially Received': 'critical', 'Partially Delivered': 'critical', Picked: 'critical', 'In Execution': 'critical',
  'At Risk': 'critical', High: 'critical',
  New: 'neutral', Open: 'neutral', Ready: 'information', 'In Test': 'information', 'In Realization': 'information',
  'Fit-to-Standard': 'information', Created: 'information',
  Draft: 'neutral', Medium: 'neutral', Low: 'neutral',
};

export const toneOf = (status: string): Tone => TONES[status] ?? 'neutral';

export const PRIORITIES = ['Very High', 'High', 'Medium', 'Low'] as const;
export const SEVERITIES = ['Critical', 'High', 'Medium', 'Low'] as const;
export const REQUIREMENT_STATUSES = ['New', 'Fit-to-Standard', 'In Realization', 'In Test', 'Approved', 'Rejected'] as const;
export const TASK_STATUSES = ['Open', 'In Progress', 'Blocked', 'Done'] as const;
export const DEFECT_STATUSES = ['New', 'In Process', 'Fixed', 'Retest', 'Closed', 'Rejected'] as const;
export const TEST_STATUSES = ['Draft', 'Ready', 'In Execution', 'Passed', 'Failed'] as const;

/** Mirrors the server's transition rules so the UI only offers valid next steps (the server still enforces them). */
export const REQUIREMENT_NEXT: Record<string, string[]> = {
  New: ['Fit-to-Standard', 'Rejected'],
  'Fit-to-Standard': ['In Realization', 'New', 'Rejected'],
  'In Realization': ['In Test', 'Fit-to-Standard'],
  'In Test': ['Approved', 'In Realization'],
  Approved: ['In Realization'],
  Rejected: ['New'],
};
export const TASK_NEXT: Record<string, string[]> = {
  Open: ['In Progress', 'Blocked', 'Done'],
  'In Progress': ['Done', 'Blocked', 'Open'],
  Blocked: ['In Progress', 'Open'],
  Done: ['In Progress'],
};
export const DEFECT_NEXT: Record<string, string[]> = {
  New: ['In Process', 'Rejected'],
  'In Process': ['Fixed', 'Rejected'],
  Fixed: ['Retest', 'In Process'],
  Retest: ['Closed', 'In Process'],
  Closed: ['In Process'],
  Rejected: ['New'],
};
