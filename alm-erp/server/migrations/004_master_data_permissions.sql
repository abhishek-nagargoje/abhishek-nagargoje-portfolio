-- Material master maintenance and project creation are separate, auditable permissions.
INSERT INTO permissions (code, description) VALUES
  ('material.manage', 'Create and edit material master data');

-- Administrators hold every permission; grant the new one explicitly (002 only covered permissions that existed then).
INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, 'material.manage' FROM roles r WHERE r.code IN ('ADMIN', 'PROC_HEAD', 'PROC_CONS', 'MRP', 'WH')
ON CONFLICT DO NOTHING;

-- Project activity queries join on these columns.
CREATE INDEX IF NOT EXISTS test_cases_project_idx ON test_cases (project_id);
