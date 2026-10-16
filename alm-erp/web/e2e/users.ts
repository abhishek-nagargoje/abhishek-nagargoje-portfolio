export const USERS = {
  admin: { email: 'e2e-admin@test.example', name: 'Asha Admin', roles: ['ADMIN'] },
  pm: { email: 'e2e-pm@test.example', name: 'Pranav PM', roles: ['PM'] },
  consultant: { email: 'e2e-proc@test.example', name: 'Chitra Consultant', roles: ['PROC_CONS'] },
  head: { email: 'e2e-head@test.example', name: 'Hemant Head', roles: ['PROC_HEAD'] },
  warehouse: { email: 'e2e-wh@test.example', name: 'Wasim Warehouse', roles: ['WH'] },
  tester: { email: 'e2e-tester@test.example', name: 'Tara Tester', roles: ['TESTER'] },
} as const;
