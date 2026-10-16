import { ruleViolation } from '../lib/errors.js';

export const PRIORITIES = ['Very High', 'High', 'Medium', 'Low'] as const;
export const SEVERITIES = ['Critical', 'High', 'Medium', 'Low'] as const;
export const FIT = ['Yes', 'Partly', 'No'] as const;

export const REQUIREMENT_STATUSES = ['New', 'Fit-to-Standard', 'In Realization', 'In Test', 'Approved', 'Rejected'] as const;
export const TASK_STATUSES = ['Open', 'In Progress', 'Blocked', 'Done'] as const;
export const DEFECT_STATUSES = ['New', 'In Process', 'Fixed', 'Retest', 'Closed', 'Rejected'] as const;

type Transitions<S extends string> = Record<S, readonly S[]>;

export const requirementTransitions: Transitions<(typeof REQUIREMENT_STATUSES)[number]> = {
  New: ['Fit-to-Standard', 'Rejected'],
  'Fit-to-Standard': ['In Realization', 'New', 'Rejected'],
  'In Realization': ['In Test', 'Fit-to-Standard'],
  'In Test': ['Approved', 'In Realization'],
  Approved: ['In Realization'],
  Rejected: ['New'],
};

export const taskTransitions: Transitions<(typeof TASK_STATUSES)[number]> = {
  Open: ['In Progress', 'Blocked', 'Done'],
  'In Progress': ['Done', 'Blocked', 'Open'],
  Blocked: ['In Progress', 'Open'],
  Done: ['In Progress'],
};

export const defectTransitions: Transitions<(typeof DEFECT_STATUSES)[number]> = {
  New: ['In Process', 'Rejected'],
  'In Process': ['Fixed', 'Rejected'],
  Fixed: ['Retest', 'In Process'],
  Retest: ['Closed', 'In Process'],
  Closed: ['In Process'],
  Rejected: ['New'],
};

export function assertTransition<S extends string>(kind: string, map: Transitions<S>, from: S, to: S) {
  if (from === to) return;
  if (!map[from]?.includes(to)) {
    throw ruleViolation(`${kind} status cannot change from “${from}” to “${to}”. Allowed: ${map[from].join(', ') || 'none'}.`);
  }
}

/** Statuses that count as "open work" for dashboards and workload. */
export const OPEN_TASK = ['Open', 'In Progress', 'Blocked'];
export const OPEN_DEFECT = ['New', 'In Process', 'Fixed', 'Retest'];
