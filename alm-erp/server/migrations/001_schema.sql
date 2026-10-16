-- Meridian ALM – core schema
-- Conventions: integer surrogate keys, timestamptz audit columns, CHECK constraints
-- for enumerations, money as numeric(15,2), stock quantities as integers (unit EA).

-- ───────────────────────── Identity & access ─────────────────────────
CREATE TABLE roles (
  id          serial PRIMARY KEY,
  code        text NOT NULL UNIQUE,
  name        text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT ''
);

CREATE TABLE permissions (
  code        text PRIMARY KEY,
  description text NOT NULL
);

CREATE TABLE role_permissions (
  role_id         int  NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_code text NOT NULL REFERENCES permissions(code) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_code)
);

CREATE TABLE users (
  id                   serial PRIMARY KEY,
  email                text NOT NULL CHECK (position('@' in email) > 1),
  full_name            text NOT NULL CHECK (length(full_name) BETWEEN 1 AND 120),
  location             text,
  password_hash        text,              -- NULL: account cannot sign in until an administrator sets a password
  is_active            boolean NOT NULL DEFAULT true,
  is_sample            boolean NOT NULL DEFAULT false,
  must_change_password boolean NOT NULL DEFAULT false,
  failed_login_count   int NOT NULL DEFAULT 0,
  locked_until         timestamptz,
  last_login_at        timestamptz,
  password_changed_at  timestamptz,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_lower_uq ON users (lower(email));

CREATE TABLE user_roles (
  user_id int NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id int NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  PRIMARY KEY (user_id, role_id)
);
CREATE INDEX user_roles_role_idx ON user_roles (role_id);

CREATE TABLE sessions (
  id                  bigserial PRIMARY KEY,
  token_hash          text NOT NULL UNIQUE,
  user_id             int  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  csrf_token          text NOT NULL,
  created_at          timestamptz NOT NULL DEFAULT now(),
  last_seen_at        timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  ip                  text,
  user_agent          text
);
CREATE INDEX sessions_user_idx ON sessions (user_id);
CREATE INDEX sessions_expiry_idx ON sessions (expires_at);

CREATE TABLE app_settings (
  key         text PRIMARY KEY,
  value       jsonb NOT NULL,
  description text NOT NULL DEFAULT '',
  updated_by  int REFERENCES users(id),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ───────────────────────── Projects & processes ─────────────────────────
CREATE TABLE projects (
  id          serial PRIMARY KEY,
  code        text NOT NULL UNIQUE,
  name        text NOT NULL,
  customer    text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  status      text NOT NULL DEFAULT 'On Track' CHECK (status IN ('On Track','At Risk','Off Track','Closed')),
  is_sample   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE project_phases (
  id         serial PRIMARY KEY,
  project_id int NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name       text NOT NULL CHECK (name IN ('Prepare','Explore','Realize','Deploy','Run')),
  seq        smallint NOT NULL,
  start_date date NOT NULL,
  end_date   date NOT NULL,
  CHECK (end_date >= start_date),
  UNIQUE (project_id, name),
  UNIQUE (project_id, seq)
);

CREATE TABLE business_processes (
  id          serial PRIMARY KEY,
  code        text NOT NULL UNIQUE,
  name        text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT '',
  seq         smallint NOT NULL DEFAULT 0
);

-- record_type links a step to the records that evidence it; NULL = not tracked by this system.
CREATE TABLE process_steps (
  id          serial PRIMARY KEY,
  process_id  int NOT NULL REFERENCES business_processes(id) ON DELETE CASCADE,
  seq         smallint NOT NULL,
  name        text NOT NULL,
  record_type text CHECK (record_type IN ('requirement','PR','PO','GR','SO','DL','GI','INV','MRP')),
  UNIQUE (process_id, seq)
);

-- ───────────────────────── ALM: requirements, tasks, tests, defects ─────────────────────────
CREATE SEQUENCE requirement_code_seq;
CREATE SEQUENCE task_code_seq;
CREATE SEQUENCE test_case_code_seq;
CREATE SEQUENCE defect_code_seq;
CREATE SEQUENCE incident_code_seq;

CREATE TABLE requirements (
  id               serial PRIMARY KEY,
  code             text NOT NULL UNIQUE,
  project_id       int  NOT NULL REFERENCES projects(id),
  process_id       int  REFERENCES business_processes(id),
  title            text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  description      text NOT NULL DEFAULT '',
  priority         text NOT NULL CHECK (priority IN ('Very High','High','Medium','Low')),
  status           text NOT NULL DEFAULT 'New'
                   CHECK (status IN ('New','Fit-to-Standard','In Realization','In Test','Approved','Rejected')),
  fit_decision     text NOT NULL DEFAULT 'Partly' CHECK (fit_decision IN ('Yes','Partly','No')),
  fit_notes        text NOT NULL DEFAULT '',
  assignee_id      int  REFERENCES users(id),
  created_by       int  NOT NULL REFERENCES users(id),
  approved_by      int  REFERENCES users(id),
  approved_at      timestamptz,
  deployment_stage text NOT NULL DEFAULT 'DEV' CHECK (deployment_stage IN ('DEV','QA','PROD')),
  is_sample        boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX requirements_project_status_idx ON requirements (project_id, status);
CREATE INDEX requirements_assignee_idx ON requirements (assignee_id);
CREATE INDEX requirements_process_idx ON requirements (process_id);

CREATE TABLE tasks (
  id             serial PRIMARY KEY,
  code           text NOT NULL UNIQUE,
  project_id     int  NOT NULL REFERENCES projects(id),
  requirement_id int  REFERENCES requirements(id),
  title          text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  description    text NOT NULL DEFAULT '',
  priority       text NOT NULL CHECK (priority IN ('Very High','High','Medium','Low')),
  status         text NOT NULL DEFAULT 'Open' CHECK (status IN ('Open','In Progress','Blocked','Done')),
  assignee_id    int  REFERENCES users(id),
  created_by     int  NOT NULL REFERENCES users(id),
  due_date       date,
  completed_at   timestamptz,
  is_sample      boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX tasks_project_status_idx ON tasks (project_id, status);
CREATE INDEX tasks_assignee_idx ON tasks (assignee_id, status);
CREATE INDEX tasks_requirement_idx ON tasks (requirement_id);

CREATE TABLE test_cases (
  id             serial PRIMARY KEY,
  code           text NOT NULL UNIQUE,
  project_id     int  NOT NULL REFERENCES projects(id),
  requirement_id int  REFERENCES requirements(id),
  title          text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  description    text NOT NULL DEFAULT '',
  priority       text NOT NULL CHECK (priority IN ('Very High','High','Medium','Low')),
  -- Derived by the server from steps and executions; never set directly by clients.
  status         text NOT NULL DEFAULT 'Draft' CHECK (status IN ('Draft','Ready','In Execution','Passed','Failed')),
  assignee_id    int  REFERENCES users(id),
  created_by     int  NOT NULL REFERENCES users(id),
  is_sample      boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX test_cases_requirement_idx ON test_cases (requirement_id);
CREATE INDEX test_cases_project_status_idx ON test_cases (project_id, status);

CREATE TABLE test_steps (
  id              serial PRIMARY KEY,
  test_case_id    int  NOT NULL REFERENCES test_cases(id) ON DELETE CASCADE,
  seq             smallint NOT NULL CHECK (seq > 0),
  action          text NOT NULL CHECK (length(action) BETWEEN 1 AND 1000),
  expected_result text NOT NULL DEFAULT '',
  retired_at      timestamptz           -- steps are retired (not deleted) so execution history stays intact
);
CREATE UNIQUE INDEX test_steps_active_seq_uq ON test_steps (test_case_id, seq) WHERE retired_at IS NULL;

CREATE TABLE test_executions (
  id           serial PRIMARY KEY,
  test_case_id int  NOT NULL REFERENCES test_cases(id) ON DELETE CASCADE,
  executed_by  int  NOT NULL REFERENCES users(id),
  status       text NOT NULL DEFAULT 'In Progress' CHECK (status IN ('In Progress','Passed','Failed')),
  started_at   timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
-- At most one open execution per test case.
CREATE UNIQUE INDEX test_executions_open_uq ON test_executions (test_case_id) WHERE completed_at IS NULL;

CREATE TABLE test_step_results (
  execution_id  int  NOT NULL REFERENCES test_executions(id) ON DELETE CASCADE,
  step_id       int  NOT NULL REFERENCES test_steps(id),
  result        text NOT NULL CHECK (result IN ('Passed','Failed')),
  actual_result text NOT NULL DEFAULT '',
  executed_by   int  NOT NULL REFERENCES users(id),
  executed_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (execution_id, step_id)
);

CREATE TABLE monitoring_incidents (
  id          serial PRIMARY KEY,
  code        text NOT NULL UNIQUE,
  title       text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  description text NOT NULL DEFAULT '',
  severity    text NOT NULL CHECK (severity IN ('Critical','High','Medium','Low')),
  status      text NOT NULL DEFAULT 'Open' CHECK (status IN ('Open','Investigating','Resolved')),
  process_id  int  REFERENCES business_processes(id),
  source      text NOT NULL DEFAULT 'Manual' CHECK (source IN ('Manual','Rule')),
  is_sample   boolean NOT NULL DEFAULT false,   -- demonstration incident, not real telemetry
  assignee_id int  REFERENCES users(id),
  created_by  int  NOT NULL REFERENCES users(id),
  resolved_by int  REFERENCES users(id),
  resolved_at timestamptz,
  resolution  text NOT NULL DEFAULT '',
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CHECK ((status = 'Resolved') = (resolved_at IS NOT NULL))
);
CREATE INDEX incidents_status_idx ON monitoring_incidents (status, created_at DESC);

CREATE TABLE incident_notes (
  id          serial PRIMARY KEY,
  incident_id int  NOT NULL REFERENCES monitoring_incidents(id) ON DELETE CASCADE,
  author_id   int  NOT NULL REFERENCES users(id),
  kind        text NOT NULL CHECK (kind IN ('Investigation','Action','Resolution')),
  body        text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX incident_notes_incident_idx ON incident_notes (incident_id, created_at);

CREATE TABLE defects (
  id                 serial PRIMARY KEY,
  code               text NOT NULL UNIQUE,
  project_id         int  NOT NULL REFERENCES projects(id),
  requirement_id     int  REFERENCES requirements(id),
  test_case_id       int  REFERENCES test_cases(id),
  test_execution_id  int  REFERENCES test_executions(id),
  test_step_id       int  REFERENCES test_steps(id),
  incident_id        int  REFERENCES monitoring_incidents(id),
  title              text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  description        text NOT NULL DEFAULT '',
  steps_to_reproduce text NOT NULL DEFAULT '',
  expected_result    text NOT NULL DEFAULT '',
  actual_result      text NOT NULL DEFAULT '',
  severity           text NOT NULL CHECK (severity IN ('Critical','High','Medium','Low')),
  priority           text NOT NULL CHECK (priority IN ('Very High','High','Medium','Low')),
  status             text NOT NULL DEFAULT 'New'
                     CHECK (status IN ('New','In Process','Fixed','Retest','Closed','Rejected')),
  assignee_id        int  REFERENCES users(id),
  created_by         int  NOT NULL REFERENCES users(id),
  resolution         text NOT NULL DEFAULT '',
  closed_by          int  REFERENCES users(id),
  closed_at          timestamptz,
  is_sample          boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  -- One automatically raised defect per failed step per execution.
  UNIQUE (test_execution_id, test_step_id)
);
CREATE INDEX defects_project_status_idx ON defects (project_id, status);
CREATE INDEX defects_requirement_idx ON defects (requirement_id);
CREATE INDEX defects_test_case_idx ON defects (test_case_id);
CREATE INDEX defects_assignee_idx ON defects (assignee_id);

CREATE TABLE comments (
  id          serial PRIMARY KEY,
  entity_type text NOT NULL CHECK (entity_type IN ('requirement','task','test_case','defect')),
  entity_id   int  NOT NULL,
  author_id   int  NOT NULL REFERENCES users(id),
  body        text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX comments_entity_idx ON comments (entity_type, entity_id, created_at);

-- Promotion workflow records (DEV → QA → PROD). These are workflow records, not real transports.
CREATE TABLE deployment_records (
  id             serial PRIMARY KEY,
  requirement_id int  NOT NULL REFERENCES requirements(id),
  from_stage     text NOT NULL CHECK (from_stage IN ('DEV','QA','PROD')),
  to_stage       text NOT NULL CHECK (to_stage IN ('DEV','QA','PROD')),
  performed_by   int  NOT NULL REFERENCES users(id),
  notes          text NOT NULL DEFAULT '',
  checks         jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX deployment_records_req_idx ON deployment_records (requirement_id, created_at DESC);

-- ───────────────────────── Notifications & audit ─────────────────────────
CREATE TABLE notifications (
  id         bigserial PRIMARY KEY,
  user_id    int  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  actor_id   int  REFERENCES users(id),
  message    text NOT NULL,
  link       text,
  is_read    boolean NOT NULL DEFAULT false,
  read_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);
CREATE INDEX notifications_unread_idx ON notifications (user_id) WHERE NOT is_read;

CREATE TABLE activity_log (
  id          bigserial PRIMARY KEY,
  actor_id    int  REFERENCES users(id),
  category    text NOT NULL DEFAULT 'business' CHECK (category IN ('business','security')),
  action      text NOT NULL,
  entity_type text,
  entity_id   int,
  entity_ref  text,
  summary     text NOT NULL,
  details     jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip          text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX activity_created_idx ON activity_log (category, created_at DESC);
CREATE INDEX activity_entity_idx ON activity_log (entity_type, entity_id);

-- ───────────────────────── ERP master data ─────────────────────────
CREATE TABLE companies (
  id             serial PRIMARY KEY,
  code           text NOT NULL UNIQUE,
  name           text NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  type           text NOT NULL CHECK (type IN ('Customer','Vendor')),
  industry       text NOT NULL DEFAULT '',
  address_line   text NOT NULL DEFAULT '',
  city           text NOT NULL DEFAULT '',
  state          text NOT NULL DEFAULT '',
  postal_code    text NOT NULL DEFAULT '',
  -- Indian GSTIN; validated for format when supplied. Sample companies carry none.
  gstin          text CHECK (gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  contact_name   text NOT NULL DEFAULT '',
  email          text NOT NULL DEFAULT '',
  phone          text NOT NULL DEFAULT '',
  payment_terms  text NOT NULL DEFAULT 'Net 30' CHECK (payment_terms IN ('Immediate','Net 15','Net 30','Net 45','Net 60')),
  credit_limit   numeric(15,2) NOT NULL DEFAULT 0 CHECK (credit_limit >= 0),
  vendor_rating  smallint NOT NULL DEFAULT 0 CHECK (vendor_rating BETWEEN 0 AND 5),
  status         text NOT NULL DEFAULT 'Active' CHECK (status IN ('Active','Blocked')),
  is_sample      boolean NOT NULL DEFAULT false,
  created_by     int REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX companies_type_idx ON companies (type, status);
CREATE INDEX companies_name_idx ON companies (lower(name));

CREATE TABLE plants (
  id       serial PRIMARY KEY,
  code     text NOT NULL UNIQUE,
  plant_no text NOT NULL UNIQUE,
  name     text NOT NULL,
  city     text NOT NULL DEFAULT ''
);

CREATE TABLE materials (
  id          serial PRIMARY KEY,
  code        text NOT NULL UNIQUE CHECK (code ~ '^[A-Z0-9-]{2,20}$'),
  description text NOT NULL,
  category    text NOT NULL,
  uom         text NOT NULL DEFAULT 'EA',
  cost_price  numeric(15,2) NOT NULL CHECK (cost_price >= 0),
  list_price  numeric(15,2) NOT NULL CHECK (list_price >= 0),
  is_active   boolean NOT NULL DEFAULT true,
  is_sample   boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX materials_category_idx ON materials (category);

-- Negative stock is never permitted: enforced by the CHECK constraint.
CREATE TABLE inventory_balances (
  material_id int NOT NULL REFERENCES materials(id),
  plant_id    int NOT NULL REFERENCES plants(id),
  on_hand     int NOT NULL DEFAULT 0 CHECK (on_hand >= 0),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (material_id, plant_id)
);
CREATE INDEX inventory_balances_plant_idx ON inventory_balances (plant_id);

CREATE TABLE inventory_movements (
  id               bigserial PRIMARY KEY,
  material_id      int  NOT NULL REFERENCES materials(id),
  plant_id         int  NOT NULL REFERENCES plants(id),
  quantity         int  NOT NULL CHECK (quantity <> 0),
  movement_type    text NOT NULL CHECK (movement_type IN
                   ('INITIAL','GOODS_RECEIPT','GOODS_ISSUE','TRANSFER_OUT','TRANSFER_IN','ADJUSTMENT')),
  reference_type   text,
  reference_id     int,
  reference_number text,
  reason           text NOT NULL DEFAULT '',
  created_by       int  REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX inventory_movements_mat_idx ON inventory_movements (material_id, plant_id, created_at DESC);
CREATE INDEX inventory_movements_created_idx ON inventory_movements (created_at DESC);

-- ───────────────────────── ERP transactions ─────────────────────────
CREATE SEQUENCE pr_number_seq  START 10000001;
CREATE SEQUENCE po_number_seq  START 4500000001;
CREATE SEQUENCE gr_number_seq  START 5000000001;
CREATE SEQUENCE so_number_seq  START 1000001;
CREATE SEQUENCE dl_number_seq  START 80000001;
CREATE SEQUENCE inv_number_seq START 90000001;
CREATE SEQUENCE st_number_seq  START 60000001;

CREATE TABLE purchase_requisitions (
  id          serial PRIMARY KEY,
  number      bigint NOT NULL UNIQUE DEFAULT nextval('pr_number_seq'),
  plant_id    int NOT NULL REFERENCES plants(id),
  material_id int NOT NULL REFERENCES materials(id),
  quantity    int NOT NULL CHECK (quantity > 0),
  customer_id int REFERENCES companies(id),
  source      text NOT NULL DEFAULT 'Manual' CHECK (source IN ('Manual','MRP')),
  status      text NOT NULL DEFAULT 'Open' CHECK (status IN ('Open','Ordered','Cancelled')),
  notes       text NOT NULL DEFAULT '',
  created_by  int NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pr_status_idx ON purchase_requisitions (status, plant_id, material_id);

CREATE TABLE sales_orders (
  id                      serial PRIMARY KEY,
  number                  bigint NOT NULL UNIQUE DEFAULT nextval('so_number_seq'),
  customer_id             int NOT NULL REFERENCES companies(id),
  plant_id                int NOT NULL REFERENCES plants(id),
  status                  text NOT NULL DEFAULT 'Open'
                          CHECK (status IN ('Open','Partially Delivered','Delivered','Cancelled')),
  requested_delivery_date date,
  net_amount              numeric(15,2) NOT NULL CHECK (net_amount >= 0),
  tax_amount              numeric(15,2) NOT NULL CHECK (tax_amount >= 0),
  total_amount            numeric(15,2) NOT NULL CHECK (total_amount >= 0),
  currency                char(3) NOT NULL DEFAULT 'INR',
  created_by              int NOT NULL REFERENCES users(id),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX so_status_idx ON sales_orders (status, plant_id);
CREATE INDEX so_customer_idx ON sales_orders (customer_id);

CREATE TABLE sales_order_items (
  id            serial PRIMARY KEY,
  sales_order_id int NOT NULL REFERENCES sales_orders(id) ON DELETE CASCADE,
  line_no       smallint NOT NULL CHECK (line_no > 0),
  material_id   int NOT NULL REFERENCES materials(id),
  quantity      int NOT NULL CHECK (quantity > 0),
  unit_price    numeric(15,2) NOT NULL CHECK (unit_price >= 0),
  net_amount    numeric(15,2) NOT NULL CHECK (net_amount >= 0),
  delivered_qty int NOT NULL DEFAULT 0,   -- quantity placed on outbound deliveries
  CHECK (delivered_qty BETWEEN 0 AND quantity),
  UNIQUE (sales_order_id, line_no)
);
CREATE INDEX so_items_material_idx ON sales_order_items (material_id);

CREATE TABLE purchase_orders (
  id                serial PRIMARY KEY,
  number            bigint NOT NULL UNIQUE DEFAULT nextval('po_number_seq'),
  vendor_id         int NOT NULL REFERENCES companies(id),
  customer_id       int REFERENCES companies(id),
  plant_id          int NOT NULL REFERENCES plants(id),
  requisition_id    int UNIQUE REFERENCES purchase_requisitions(id),
  sales_order_id    int REFERENCES sales_orders(id),
  status            text NOT NULL CHECK (status IN
                    ('Pending Approval','Approved','Partially Received','Received','Rejected','Cancelled')),
  net_amount        numeric(15,2) NOT NULL CHECK (net_amount >= 0),
  tax_amount        numeric(15,2) NOT NULL CHECK (tax_amount >= 0),
  total_amount      numeric(15,2) NOT NULL CHECK (total_amount >= 0),
  currency          char(3) NOT NULL DEFAULT 'INR',
  approval_required boolean NOT NULL DEFAULT false,
  approved_by       int REFERENCES users(id),
  approved_at       timestamptz,
  rejection_reason  text NOT NULL DEFAULT '',
  created_by        int NOT NULL REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX po_status_idx ON purchase_orders (status, plant_id);
CREATE INDEX po_vendor_idx ON purchase_orders (vendor_id);
CREATE INDEX po_so_idx ON purchase_orders (sales_order_id);

CREATE TABLE purchase_order_items (
  id                serial PRIMARY KEY,
  purchase_order_id int NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  line_no           smallint NOT NULL CHECK (line_no > 0),
  material_id       int NOT NULL REFERENCES materials(id),
  quantity          int NOT NULL CHECK (quantity > 0),
  unit_price        numeric(15,2) NOT NULL CHECK (unit_price >= 0),
  net_amount        numeric(15,2) NOT NULL CHECK (net_amount >= 0),
  received_qty      int NOT NULL DEFAULT 0,
  CHECK (received_qty BETWEEN 0 AND quantity),
  UNIQUE (purchase_order_id, line_no)
);
CREATE INDEX po_items_material_idx ON purchase_order_items (material_id);

CREATE TABLE goods_receipts (
  id                serial PRIMARY KEY,
  number            bigint NOT NULL UNIQUE DEFAULT nextval('gr_number_seq'),
  purchase_order_id int NOT NULL REFERENCES purchase_orders(id),
  plant_id          int NOT NULL REFERENCES plants(id),
  notes             text NOT NULL DEFAULT '',
  posted_by         int NOT NULL REFERENCES users(id),
  posted_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX gr_po_idx ON goods_receipts (purchase_order_id);

CREATE TABLE goods_receipt_items (
  id                     serial PRIMARY KEY,
  goods_receipt_id       int NOT NULL REFERENCES goods_receipts(id) ON DELETE CASCADE,
  purchase_order_item_id int NOT NULL REFERENCES purchase_order_items(id),
  material_id            int NOT NULL REFERENCES materials(id),
  quantity               int NOT NULL CHECK (quantity > 0)
);

CREATE TABLE deliveries (
  id               serial PRIMARY KEY,
  number           bigint NOT NULL UNIQUE DEFAULT nextval('dl_number_seq'),
  sales_order_id   int NOT NULL REFERENCES sales_orders(id),
  plant_id         int NOT NULL REFERENCES plants(id),
  status           text NOT NULL DEFAULT 'Created' CHECK (status IN ('Created','Picked','Goods Issued','Billed')),
  created_by       int NOT NULL REFERENCES users(id),
  picked_by        int REFERENCES users(id),
  picked_at        timestamptz,
  goods_issued_by  int REFERENCES users(id),
  goods_issued_at  timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX deliveries_so_idx ON deliveries (sales_order_id);
CREATE INDEX deliveries_status_idx ON deliveries (status);

CREATE TABLE delivery_items (
  id                  serial PRIMARY KEY,
  delivery_id         int NOT NULL REFERENCES deliveries(id) ON DELETE CASCADE,
  sales_order_item_id int NOT NULL REFERENCES sales_order_items(id),
  material_id         int NOT NULL REFERENCES materials(id),
  quantity            int NOT NULL CHECK (quantity > 0)
);
CREATE INDEX delivery_items_so_item_idx ON delivery_items (sales_order_item_id);

CREATE TABLE invoices (
  id             serial PRIMARY KEY,
  number         bigint NOT NULL UNIQUE DEFAULT nextval('inv_number_seq'),
  delivery_id    int NOT NULL UNIQUE REFERENCES deliveries(id),   -- one invoice per delivery: prevents double billing
  sales_order_id int NOT NULL REFERENCES sales_orders(id),
  customer_id    int NOT NULL REFERENCES companies(id),
  net_amount     numeric(15,2) NOT NULL CHECK (net_amount >= 0),
  tax_rate_bp    int NOT NULL CHECK (tax_rate_bp BETWEEN 0 AND 10000),
  tax_amount     numeric(15,2) NOT NULL CHECK (tax_amount >= 0),
  total_amount   numeric(15,2) NOT NULL CHECK (total_amount >= 0),
  currency       char(3) NOT NULL DEFAULT 'INR',
  status         text NOT NULL DEFAULT 'Posted' CHECK (status IN ('Posted','Cancelled')),
  created_by     int NOT NULL REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (total_amount = net_amount + tax_amount)
);
CREATE INDEX invoices_customer_idx ON invoices (customer_id);

CREATE TABLE stock_transfers (
  id            serial PRIMARY KEY,
  number        bigint NOT NULL UNIQUE DEFAULT nextval('st_number_seq'),
  material_id   int NOT NULL REFERENCES materials(id),
  from_plant_id int NOT NULL REFERENCES plants(id),
  to_plant_id   int NOT NULL REFERENCES plants(id),
  quantity      int NOT NULL CHECK (quantity > 0),
  notes         text NOT NULL DEFAULT '',
  created_by    int NOT NULL REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (from_plant_id <> to_plant_id)
);

-- Replays of transaction requests carrying the same Idempotency-Key return the stored response.
CREATE TABLE idempotency_keys (
  user_id     int  NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  key         text NOT NULL CHECK (length(key) BETWEEN 8 AND 100),
  endpoint    text NOT NULL,
  status_code int  NOT NULL,
  response    jsonb NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);

-- Unified document index used by the document list and global search.
CREATE VIEW document_index AS
  SELECT 'PR'::text AS doc_type, pr.id, pr.number, pr.plant_id, pr.status, pr.created_by, pr.created_at,
         pr.customer_id AS partner_id, NULL::numeric AS amount
    FROM purchase_requisitions pr
  UNION ALL
  SELECT 'PO', po.id, po.number, po.plant_id, po.status, po.created_by, po.created_at, po.vendor_id, po.total_amount
    FROM purchase_orders po
  UNION ALL
  SELECT 'GR', gr.id, gr.number, gr.plant_id, 'Posted', gr.posted_by, gr.posted_at, po.vendor_id, NULL
    FROM goods_receipts gr JOIN purchase_orders po ON po.id = gr.purchase_order_id
  UNION ALL
  SELECT 'SO', so.id, so.number, so.plant_id, so.status, so.created_by, so.created_at, so.customer_id, so.total_amount
    FROM sales_orders so
  UNION ALL
  SELECT 'DL', d.id, d.number, d.plant_id, d.status, d.created_by, d.created_at, so.customer_id, NULL
    FROM deliveries d JOIN sales_orders so ON so.id = d.sales_order_id
  UNION ALL
  SELECT 'INV', i.id, i.number, d.plant_id, i.status, i.created_by, i.created_at, i.customer_id, i.total_amount
    FROM invoices i JOIN deliveries d ON d.id = i.delivery_id
  UNION ALL
  SELECT 'ST', st.id, st.number, st.from_plant_id, 'Posted', st.created_by, st.created_at, NULL, NULL
    FROM stock_transfers st;
