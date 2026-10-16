-- Reference/configuration data required by the application (not sample business data).

INSERT INTO permissions (code, description) VALUES
  ('admin.users',          'Create users, assign roles, reset passwords'),
  ('admin.settings',       'Change business configuration (approval threshold, tax rate)'),
  ('admin.audit',          'View the security audit log'),
  ('project.manage',       'Edit project status'),
  ('req.create',           'Create requirements'),
  ('req.edit',             'Edit requirements and change their status'),
  ('req.signoff',          'Give business sign-off (Approved) on requirements'),
  ('task.create',          'Create tasks'),
  ('task.edit',            'Edit tasks and change their status'),
  ('test.manage',          'Create and edit test cases and steps'),
  ('test.execute',         'Execute test cases'),
  ('defect.create',        'Report defects'),
  ('defect.edit',          'Edit defects and change their status'),
  ('defect.close',         'Close defects after successful retest'),
  ('deploy.qa',            'Record promotion DEV → QA'),
  ('deploy.prod',          'Record promotion QA → PROD'),
  ('incident.manage',      'Create, investigate and resolve monitoring incidents'),
  ('pr.create',            'Create purchase requisitions'),
  ('po.create',            'Create purchase orders'),
  ('po.approve',           'Approve or reject purchase orders that require approval'),
  ('gr.post',              'Post goods receipts'),
  ('mrp.run',              'Run MRP and convert proposals to requisitions'),
  ('inventory.transfer',   'Post stock transfers between plants'),
  ('inventory.adjust',     'Post stock adjustments'),
  ('so.create',            'Create sales orders'),
  ('delivery.create',      'Create outbound deliveries'),
  ('delivery.pick',        'Confirm picking and packing'),
  ('delivery.goods_issue', 'Post goods issue for deliveries'),
  ('invoice.create',       'Create customer invoices'),
  ('company.manage',       'Create and edit customers and vendors'),
  ('company.sensitive',    'View contact details and credit limits of customers and vendors');

INSERT INTO roles (code, name, description) VALUES
  ('ADMIN',     'Administrator',              'Full access including user and configuration management'),
  ('PM',        'Project Manager',            'Leads the implementation project'),
  ('PROC_HEAD', 'Procurement Head',           'Approves purchase orders above the approval threshold'),
  ('PROC_CONS', 'Procurement Consultant',     'Configures and runs procure-to-pay'),
  ('ARCH',      'Solution Architect',         'Owns solution design'),
  ('OSCM',      'OSCM Consultant',            'Operations and supply chain consultant'),
  ('MRP',       'MRP Planner',                'Material requirements planning'),
  ('WH',        'Warehouse Consultant',       'Inventory, goods receipt and goods issue'),
  ('SALES',     'Sales Consultant',           'Order to cash'),
  ('FIN',       'Finance Consultant',         'Billing and finance'),
  ('BU',        'Business User',              'Key user providing requirements and acceptance'),
  ('TESTER',    'Tester',                     'Executes tests and verifies fixes'),
  ('TECH',      'Technical Team',             'Development and integration'),
  ('BASIS',     'Basis & Security Admin',     'System landscape and security'),
  ('CHANGE',    'Change & Training Manager',  'Organisational change and training');

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, p.code FROM roles r CROSS JOIN permissions p WHERE r.code = 'ADMIN';

INSERT INTO role_permissions (role_id, permission_code)
SELECT r.id, x.perm
FROM (VALUES
  ('PM','project.manage'),('PM','req.create'),('PM','req.edit'),('PM','req.signoff'),('PM','task.create'),('PM','task.edit'),
  ('PM','test.manage'),('PM','test.execute'),('PM','defect.create'),('PM','defect.edit'),('PM','defect.close'),
  ('PM','deploy.qa'),('PM','deploy.prod'),('PM','incident.manage'),('PM','company.sensitive'),
  ('PROC_HEAD','req.create'),('PROC_HEAD','req.edit'),('PROC_HEAD','req.signoff'),('PROC_HEAD','task.create'),('PROC_HEAD','task.edit'),
  ('PROC_HEAD','defect.create'),('PROC_HEAD','defect.edit'),('PROC_HEAD','pr.create'),('PROC_HEAD','po.create'),('PROC_HEAD','po.approve'),
  ('PROC_HEAD','gr.post'),('PROC_HEAD','company.manage'),('PROC_HEAD','company.sensitive'),
  ('PROC_CONS','req.create'),('PROC_CONS','req.edit'),('PROC_CONS','task.create'),('PROC_CONS','task.edit'),('PROC_CONS','test.manage'),
  ('PROC_CONS','defect.create'),('PROC_CONS','defect.edit'),('PROC_CONS','pr.create'),('PROC_CONS','po.create'),('PROC_CONS','gr.post'),
  ('PROC_CONS','mrp.run'),('PROC_CONS','incident.manage'),('PROC_CONS','company.manage'),('PROC_CONS','company.sensitive'),
  ('ARCH','req.create'),('ARCH','req.edit'),('ARCH','task.create'),('ARCH','task.edit'),('ARCH','test.manage'),
  ('ARCH','defect.create'),('ARCH','defect.edit'),('ARCH','deploy.qa'),
  ('OSCM','req.create'),('OSCM','req.edit'),('OSCM','task.create'),('OSCM','task.edit'),('OSCM','test.manage'),('OSCM','defect.create'),
  ('OSCM','defect.edit'),('OSCM','pr.create'),('OSCM','mrp.run'),('OSCM','inventory.transfer'),('OSCM','incident.manage'),
  ('MRP','task.edit'),('MRP','defect.create'),('MRP','pr.create'),('MRP','mrp.run'),
  ('WH','task.edit'),('WH','defect.create'),('WH','defect.edit'),('WH','gr.post'),('WH','inventory.transfer'),('WH','inventory.adjust'),
  ('WH','delivery.create'),('WH','delivery.pick'),('WH','delivery.goods_issue'),
  ('SALES','task.create'),('SALES','task.edit'),('SALES','defect.create'),('SALES','so.create'),('SALES','delivery.create'),
  ('SALES','invoice.create'),('SALES','company.manage'),('SALES','company.sensitive'),
  ('FIN','task.edit'),('FIN','defect.create'),('FIN','invoice.create'),('FIN','company.sensitive'),
  ('BU','req.create'),('BU','req.signoff'),('BU','task.edit'),('BU','test.execute'),('BU','defect.create'),
  ('TESTER','task.edit'),('TESTER','test.manage'),('TESTER','test.execute'),('TESTER','defect.create'),('TESTER','defect.edit'),('TESTER','defect.close'),
  ('TECH','task.create'),('TECH','task.edit'),('TECH','defect.create'),('TECH','defect.edit'),('TECH','deploy.qa'),('TECH','incident.manage'),
  ('BASIS','task.edit'),('BASIS','defect.create'),('BASIS','deploy.qa'),('BASIS','deploy.prod'),('BASIS','incident.manage'),('BASIS','admin.audit'),
  ('CHANGE','task.create'),('CHANGE','task.edit'),('CHANGE','defect.create')
) AS x(role_code, perm)
JOIN roles r ON r.code = x.role_code;

INSERT INTO business_processes (code, name, description, seq) VALUES
  ('S2P', 'Source to Pay',   'Procurement of materials from requirement to vendor payment', 1),
  ('P2P', 'Plan to Produce', 'Demand-driven planning through production',                  2),
  ('L2C', 'Lead to Cash',    'Customer order through delivery, billing and payment',          3);

INSERT INTO process_steps (process_id, seq, name, record_type)
SELECT p.id, x.seq, x.name, x.rt
FROM (VALUES
  ('S2P',1,'Requirement','requirement'),('S2P',2,'Purchase Requisition','PR'),('S2P',3,'Purchase Order','PO'),
  ('S2P',4,'Goods Receipt','GR'),('S2P',5,'Supplier Invoice',NULL),('S2P',6,'Payment',NULL),
  ('P2P',1,'Demand','SO'),('P2P',2,'MRP','MRP'),('P2P',3,'Production Planning',NULL),('P2P',4,'Production',NULL),
  ('P2P',5,'Finished Goods',NULL),
  ('L2C',1,'Customer',NULL),('L2C',2,'Sales Order','SO'),('L2C',3,'Delivery','DL'),('L2C',4,'Goods Issue','GI'),
  ('L2C',5,'Billing','INV'),('L2C',6,'Payment',NULL)
) AS x(pcode, seq, name, rt)
JOIN business_processes p ON p.code = x.pcode;

INSERT INTO plants (code, plant_no, name, city) VALUES
  ('PUN','1000','Pune DC','Pune'),
  ('MUM','1100','Mumbai FC','Mumbai'),
  ('DEL','1200','Delhi NCR FC','Delhi NCR'),
  ('BLR','1300','Bengaluru FC','Bengaluru'),
  ('HYD','1400','Hyderabad FC','Hyderabad'),
  ('CCU','1500','Kolkata FC','Kolkata');

INSERT INTO app_settings (key, value, description) VALUES
  ('po_approval_threshold', '"1000000.00"', 'Purchase orders with a net amount above this value (INR) require Procurement Head approval'),
  ('gst_rate_bp',           '1800',         'GST rate in basis points (1800 = 18%) applied to purchase orders, sales orders and invoices'),
  ('allow_self_approval',   'false',        'Whether the creator of a purchase order may approve it'),
  ('po_stuck_after_hours',  '48',           'A purchase order pending approval for longer than this is reported as stuck in monitoring');
