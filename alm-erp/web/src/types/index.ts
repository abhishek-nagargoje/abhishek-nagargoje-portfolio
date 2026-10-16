export interface Page<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface SessionUser {
  id: number;
  email: string;
  fullName: string;
  location: string | null;
  mustChangePassword: boolean;
  roles: { code: string; name: string }[];
  permissions: string[];
}

export type Priority = 'Very High' | 'High' | 'Medium' | 'Low';
export type Severity = 'Critical' | 'High' | 'Medium' | 'Low';

export interface HistoryEntry { id: number; action: string; summary: string; createdAt: string; actorName: string | null }
export interface CommentEntry { id: number; body: string; createdAt: string; authorId: number; authorName: string }

export interface UserLite { id: number; fullName: string; location: string | null; roles: string[]; openItems: number; isSample: boolean }

export interface RequirementRow {
  id: number; code: string; title: string; priority: Priority; status: string; fitDecision: string; deploymentStage: string;
  isSample: boolean; updatedAt: string; assigneeId: number | null; assigneeName: string | null; processId: number | null;
  processName: string | null; taskCount: number; testCount: number;
}
export interface LinkedItem { id: number; code: string; title: string; status: string; priority?: string; severity?: string; assigneeName?: string | null; dueDate?: string | null }
export interface Requirement extends Omit<RequirementRow, 'taskCount' | 'testCount'> {
  description: string; fitNotes: string; createdBy: number; createdByName: string; approvedBy: number | null; approvedByName: string | null;
  approvedAt: string | null; projectName: string; createdAt: string;
  tasks: LinkedItem[]; tests: LinkedItem[]; defects: LinkedItem[];
  deployments: { id: number; fromStage: string; toStage: string; notes: string; createdAt: string; performedByName: string }[];
  history: HistoryEntry[];
}

export interface TaskRow {
  id: number; code: string; title: string; priority: Priority; status: string; dueDate: string | null; isSample: boolean; updatedAt: string;
  assigneeId: number | null; assigneeName: string | null; requirementId: number | null; requirementCode: string | null;
}
export interface Task extends TaskRow { description: string; createdBy: number; createdByName: string; requirementTitle: string | null; completedAt: string | null; createdAt: string; history: HistoryEntry[] }

export interface TestStep { id: number; seq: number; action: string; expectedResult: string }
export interface StepResult { executionId: number; stepId: number; result: 'Passed' | 'Failed'; actualResult: string; executedAt: string; executedByName: string }
export interface Execution { id: number; status: string; startedAt: string; completedAt: string | null; executedByName: string; results: StepResult[] }
export interface TestCaseRow {
  id: number; code: string; title: string; priority: Priority; status: string; isSample: boolean; updatedAt: string; assigneeId: number | null;
  assigneeName: string | null; requirementId: number | null; requirementCode: string | null; stepCount: number; lastExecutedAt: string | null;
}
export interface TestCase extends Omit<TestCaseRow, 'stepCount' | 'lastExecutedAt'> {
  description: string; createdByName: string; requirementTitle: string | null; steps: TestStep[]; executions: Execution[]; defects: LinkedItem[];
}

export interface DefectRow {
  id: number; code: string; title: string; severity: Severity; priority: Priority; status: string; isSample: boolean; updatedAt: string;
  assigneeId: number | null; assigneeName: string | null; requirementId: number | null; requirementCode: string | null;
  testCaseId: number | null; testCaseCode: string | null;
}
export interface Defect extends DefectRow {
  description: string; stepsToReproduce: string; expectedResult: string; actualResult: string; resolution: string; createdByName: string;
  closedByName: string | null; closedAt: string | null; requirementTitle: string | null; testCaseTitle: string | null;
  testCaseStatus: string | null; incidentId: number | null; incidentCode: string | null; createdAt: string; history: HistoryEntry[];
}

export interface Money { amount: string }
export interface Plant { id: number; code: string; plantNo: string; name: string; city: string; units: number; stockValue: string }
export interface Material { id: number; code: string; description: string; category: string; uom: string; costPrice: string; listPrice: string; isSample: boolean }
export interface CompanyRow {
  id: number; code: string; name: string; type: 'Customer' | 'Vendor'; industry: string; city: string; contactName: string | null;
  paymentTerms: string; status: string; isSample: boolean; restricted: boolean;
}
export interface Company extends CompanyRow {
  addressLine: string; state: string; postalCode: string; gstin: string | null; email: string | null; phone: string | null;
  creditLimit: string | null; vendorRating: number; documents: DocRow[];
}
export interface DocRow { docType: string; id: number; number: number; status: string; createdAt: string; amount: string | null; plantCode?: string; partnerName?: string | null; createdByName?: string }

export interface TxResult { id?: number; number?: number; message: string }
