/**
 * SAMPLE data (flagged is_sample) derived from the original practice scenario.
 * Safe to run repeatedly – existing records are never overwritten or deleted.
 */
import type pg from 'pg';
import { nextCode } from '../services/codes.js';
import { postMovement } from '../services/inventory.js';
import { query, queryOne, withTransaction } from './pool.js';

/** Deterministic LCG so the sample data is identical on every machine. */
function lcg(seed: number) {
  let r = seed;
  return () => (r = (Math.imul(r, 1664525) + 1013904223) >>> 0) / 4294967296;
}

const TEAM: [string, string, string, string][] = [
  ['Anita Rao', 'PM', 'Pune', 'anita.rao'], ['Sandeep Joshi', 'PM', 'Mumbai', 'sandeep.joshi'],
  ['Rajesh Khanna', 'PROC_HEAD', 'Mumbai', 'rajesh.khanna'], ['Vivek Sharma', 'ARCH', 'Pune', 'vivek.sharma'],
  ['Ravi Iyer', 'OSCM', 'Pune', 'ravi.iyer'], ['Divya Menon', 'OSCM', 'Bengaluru', 'divya.menon'],
  ['Amit Verma', 'MRP', 'Pune', 'amit.verma'], ['Meera Shah', 'PROC_CONS', 'Mumbai', 'meera.shah'],
  ['Imran Qureshi', 'PROC_CONS', 'Delhi NCR', 'imran.qureshi'], ['Karan Patil', 'WH', 'Pune', 'karan.patil'],
  ['Lakshmi Reddy', 'WH', 'Hyderabad', 'lakshmi.reddy'], ['Subir Das', 'WH', 'Kolkata', 'subir.das'],
  ['Neha Kapoor', 'SALES', 'Delhi NCR', 'neha.kapoor'], ['Arvind Nambiar', 'SALES', 'Bengaluru', 'arvind.nambiar'],
  ['Sneha Nair', 'FIN', 'Bengaluru', 'sneha.nair'], ['Harish Gupta', 'FIN', 'Delhi NCR', 'harish.gupta'],
  ['Vikram Mehta', 'BU', 'Pune', 'vikram.mehta'], ['Priya Singh', 'BU', 'Delhi NCR', 'priya.singh'],
  ['Farhan Sheikh', 'BU', 'Hyderabad', 'farhan.sheikh'], ['Rekha Banerjee', 'BU', 'Kolkata', 'rekha.banerjee'],
  ['Pooja Desai', 'TESTER', 'Pune', 'pooja.desai'], ['Rohit Bansal', 'TESTER', 'Bengaluru', 'rohit.bansal'],
  ['Ishita Roy', 'TESTER', 'Kolkata', 'ishita.roy'], ['Arjun Kulkarni', 'TECH', 'Pune', 'arjun.kulkarni'],
  ['Nandini Rao', 'TECH', 'Bengaluru', 'nandini.rao'], ['Gaurav Malhotra', 'BASIS', 'Pune', 'gaurav.malhotra'],
  ['Shalini Pillai', 'CHANGE', 'Mumbai', 'shalini.pillai'],
];

const BASES: [string, string, number, number, string][] = [
  ['ECHO', 'Echo Dot (5th Gen)', 3200, 4999, 'Smart Speakers'], ['ESH5', 'Echo Show 5', 5500, 8999, 'Smart Speakers'],
  ['ESH8', 'Echo Show 8', 8200, 12999, 'Smart Speakers'], ['EPOP', 'Echo Pop', 2400, 3999, 'Smart Speakers'],
  ['ESTU', 'Echo Studio', 14000, 19999, 'Smart Speakers'], ['EBUD', 'Echo Buds', 6000, 9999, 'Smart Speakers'],
  ['FTVL', 'Fire TV Stick Lite', 2000, 3499, 'Fire TV'], ['FTV', 'Fire TV Stick 4K', 3800, 5999, 'Fire TV'],
  ['FTVM', 'Fire TV Stick 4K Max', 4600, 7499, 'Fire TV'], ['FTVC', 'Fire TV Cube', 9000, 13999, 'Fire TV'],
  ['FOMN', 'Fire TV Omni 43"', 21000, 29999, 'Fire TV'], ['KBAS', 'Kindle (11th Gen)', 5800, 9999, 'Kindle'],
  ['KPW', 'Kindle Paperwhite', 9500, 14999, 'Kindle'], ['KSCR', 'Kindle Scribe', 24000, 34999, 'Kindle'],
  ['KKID', 'Kindle Kids', 7000, 11999, 'Kindle'], ['FT7', 'Fire 7 Tablet', 4500, 7999, 'Tablets'],
  ['FHD8', 'Fire HD 8 Tablet', 6000, 9999, 'Tablets'], ['FHD', 'Fire HD 10 Tablet', 8000, 12999, 'Tablets'],
  ['FKID', 'Fire HD 8 Kids', 7000, 11999, 'Tablets'], ['RNG', 'Ring Video Doorbell', 6500, 9999, 'Smart Home'],
  ['RCAM', 'Ring Indoor Cam', 3000, 4999, 'Smart Home'], ['ROUT', 'Ring Stick Up Cam', 5500, 8999, 'Smart Home'],
  ['RFLD', 'Ring Floodlight Cam', 14000, 21999, 'Smart Home'], ['EERO', 'eero 6 Mesh Wi-Fi', 9000, 13999, 'Smart Home'],
  ['BLNK', 'Blink Mini Camera', 1800, 2999, 'Smart Home'], ['CBL', 'Basics USB-C Cable', 150, 399, 'Accessories'],
  ['CHRG', 'Basics 20W Charger', 450, 999, 'Accessories'], ['HDMI', 'Basics HDMI Cable', 250, 599, 'Accessories'],
  ['BATT', 'Basics AA Batteries', 200, 449, 'Accessories'], ['MOUS', 'Basics Wireless Mouse', 500, 1099, 'Accessories'],
];
const COLOURS = ['Black', 'White', 'Blue', 'Grey', 'Red', 'Green'];

function materials() {
  const out: { code: string; description: string; cost: number; list: number; category: string }[] = [];
  for (const [code, name, cost, list, category] of BASES) {
    for (let i = 0; i < 18; i++) {
      const pack = [1, 2, 3][i % 3];
      const colour = COLOURS[Math.floor(i / 3)];
      out.push({
        code: code + String(i + 1).padStart(2, '0'),
        description: `${name} – ${colour}, ${pack}-pack`,
        cost: cost * pack,
        list: Math.round(list * pack * (pack > 1 ? 0.95 : 1)),
        category,
      });
    }
  }
  return out;
}

const CITY: [string, string][] = [
  ['Pune', 'Maharashtra'], ['Mumbai', 'Maharashtra'], ['Delhi NCR', 'Delhi'], ['Bengaluru', 'Karnataka'], ['Hyderabad', 'Telangana'],
  ['Kolkata', 'West Bengal'], ['Chennai', 'Tamil Nadu'], ['Ahmedabad', 'Gujarat'], ['Jaipur', 'Rajasthan'], ['Lucknow', 'Uttar Pradesh'],
  ['Kochi', 'Kerala'], ['Indore', 'Madhya Pradesh'],
];
const P1 = ['Sunrise', 'Bharat', 'Apex', 'Zenith', 'Orbit', 'Vertex', 'Lotus', 'Kaveri', 'Himalaya', 'Konark', 'Trident', 'Sapphire', 'Nova',
  'Pioneer', 'Surya', 'Ganga', 'Narmada', 'Aravali', 'Deccan', 'Malabar', 'Coromandel', 'Vindhya', 'Satpura', 'Meridian', 'Horizon',
  'Crest', 'Falcon', 'Emerald', 'Orchid', 'Jade'];
const CSX: [string, string][] = [['Retail Pvt Ltd', 'Electronics Retail'], ['Digital Mart', 'E-commerce'], ['Telecom Traders', 'Telecom Reseller'],
  ['Infotech Solutions', 'Corporate IT'], ['Education Trust', 'Education'], ['Hospitality Group', 'Hospitality'], ['Healthcare Ltd', 'Healthcare'],
  ['Distributors LLP', 'Distribution'], ['Enterprises', 'Corporate IT'], ['Smart Stores', 'Electronics Retail']];
const VSX: [string, string][] = [['Components Pvt Ltd', 'Electronic Components'], ['Contract Mfg Ltd', 'Contract Manufacturing'],
  ['Packaging Industries', 'Packaging'], ['Logistics Ltd', 'Logistics'], ['Battery Systems', 'Batteries'], ['Display Technologies', 'Displays'],
  ['Plastics & Moulding', 'Moulding'], ['Cables & Wires', 'Cables']];
const FN = ['Aarav', 'Vihaan', 'Ananya', 'Diya', 'Rohan', 'Kavya', 'Ishaan', 'Meera', 'Karthik', 'Sanya', 'Rahul', 'Pooja', 'Aditya', 'Neha',
  'Siddharth', 'Tanvi'];
const LN = ['Sharma', 'Iyer', 'Patel', 'Reddy', 'Das', 'Khan', 'Nair', 'Gupta', 'Joshi', 'Mehta', 'Singh', 'Banerjee'];

/** Fictitious companies. No tax IDs or phone numbers are generated; emails use the reserved .example domain. */
function companies() {
  const rd = (() => { const r = lcg(777); return (n: number) => Math.floor(r() * n); })();
  const out: { code: string; name: string; type: 'Customer' | 'Vendor'; industry: string; city: string; state: string; contact: string;
    email: string; credit: number; terms: string; rating: number }[] = [];
  const used = new Set<string>();
  const mk = (code: string, name: string, type: 'Customer' | 'Vendor', industry: string) => {
    let n = name, k = 2;
    while (used.has(n)) n = `${name} ${k++}`;
    used.add(n);
    const [city, state] = CITY[rd(CITY.length)];
    const f = FN[rd(FN.length)], l = LN[rd(LN.length)];
    out.push({
      code, name: n, type, industry, city, state, contact: `${f} ${l}`,
      email: `${f}.${l}@${n.toLowerCase().replace(/[^a-z]/g, '')}.example`.toLowerCase(),
      credit: type === 'Customer' ? (5 + rd(95)) * 100000 : 0,
      terms: ['Net 30', 'Net 45', 'Net 60'][rd(3)],
      rating: type === 'Vendor' ? 3 + rd(3) : 0,
    });
  };
  for (let i = 0; i < 75; i++) {
    const s = CSX[(i * 3 + Math.floor(i / 30)) % 10];
    mk(`C${1000 * (i + 1)}`, `${P1[i % 30]} ${s[0]}`, 'Customer', s[1]);
  }
  for (let i = 0; i < 45; i++) {
    const s = VSX[i % 8];
    mk(`V${100 * (i + 1)}`, `${P1[(i * 7 + 3) % 30]} ${s[0]}`, 'Vendor', s[1]);
  }
  return out;
}

async function seedUsers(db: pg.PoolClient) {
  for (const [name, role, city, local] of TEAM) {
    const email = `${local}@abc-manufacturing.example`;
    // Sample team members have no password: they cannot sign in until an administrator sets one.
    const u = await queryOne<{ id: number }>(
      `INSERT INTO users (email, full_name, location, is_sample) VALUES ($1,$2,$3,true)
       ON CONFLICT ((lower(email))) DO UPDATE SET email = users.email RETURNING id`, [email, name, city], db);
    await query(`INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE code = $2 ON CONFLICT DO NOTHING`, [u!.id, role], db);
  }
}

async function seedProject(db: pg.PoolClient) {
  const p = await queryOne<{ id: number }>(
    `INSERT INTO projects (code, name, customer, description, status, is_sample)
     VALUES ('ABC-S4', 'ABC Manufacturing – S/4HANA Implementation', 'ABC Manufacturing',
             'Sample implementation project: procurement approval workflow, inventory and order-to-cash.', 'On Track', true)
     ON CONFLICT (code) DO UPDATE SET code = projects.code RETURNING id`, [], db);
  const phases: [string, number, string, string][] = [
    ['Prepare', 1, '2026-08-01', '2026-08-31'], ['Explore', 2, '2026-09-01', '2026-10-15'], ['Realize', 3, '2026-10-16', '2026-12-15'],
    ['Deploy', 4, '2026-12-16', '2027-01-31'], ['Run', 5, '2027-02-01', '2027-03-31'],
  ];
  for (const [name, seq, s, e] of phases) {
    await query(`INSERT INTO project_phases (project_id, name, seq, start_date, end_date) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
      [p!.id, name, seq, s, e], db);
  }
  return p!.id;
}

async function seedAlm(db: pg.PoolClient, projectId: number) {
  const exists = await queryOne("SELECT 1 FROM requirements WHERE is_sample AND title = 'Purchase Order Approval'", [], db);
  if (exists) return;
  const uid = async (local: string) =>
    (await queryOne<{ id: number }>('SELECT id FROM users WHERE email = $1', [`${local}@abc-manufacturing.example`], db))!.id;
  const pm = await uid('anita.rao');
  const s2p = (await queryOne<{ id: number }>("SELECT id FROM business_processes WHERE code = 'S2P'", [], db))!.id;
  const reqCode = await nextCode(db, 'REQ');
  const req = (await queryOne<{ id: number }>(
    `INSERT INTO requirements (code, project_id, process_id, title, description, priority, status, fit_decision, assignee_id, created_by, is_sample)
     VALUES ($1,$2,$3,'Purchase Order Approval','PO above ₹10 lakh must be approved by the Procurement Head.','High','New','Partly',$4,$5,true)
     RETURNING id`, [reqCode, projectId, s2p, await uid('meera.shah'), pm], db))!.id;
  const tasks: [string, string][] = [
    ['Analyze approval workflow', 'ravi.iyer'], ['Configure approval threshold', 'meera.shah'],
    ['Configure Procurement Head role', 'arjun.kulkarni'], ['Test approval', 'pooja.desai'], ['Business-user acceptance', 'vikram.mehta'],
  ];
  for (const [title, who] of tasks) {
    await query(
      `INSERT INTO tasks (code, project_id, requirement_id, title, priority, assignee_id, created_by, due_date, is_sample)
       VALUES ($1,$2,$3,$4,'High',$5,$6,'2026-11-30',true)`,
      [await nextCode(db, 'TSK'), projectId, req, `${title} (${reqCode})`, await uid(who), pm], db);
  }
  const tc = (await queryOne<{ id: number }>(
    `INSERT INTO test_cases (code, project_id, requirement_id, title, description, priority, status, assignee_id, created_by, is_sample)
     VALUES ($1,$2,$3,'PO Approval','Prove the approval threshold works','High','Ready',$4,$5,true) RETURNING id`,
    [await nextCode(db, 'TC'), projectId, req, await uid('pooja.desai'), pm], db))!.id;
  const steps: [string, string][] = [
    ['Create PO with net value ₹5,00,000', 'No Procurement Head approval required'],
    ['Create PO with net value ₹15,00,000', 'Approval request goes to the Procurement Head'],
    ['Procurement Head approves the PO', 'PO status changes to Approved'],
  ];
  for (const [i, [action, expected]] of steps.entries()) {
    await query('INSERT INTO test_steps (test_case_id, seq, action, expected_result) VALUES ($1,$2,$3,$4)', [tc, i + 1, action, expected], db);
  }
}

async function seedMasterData(db: pg.PoolClient) {
  for (const m of materials()) {
    await query(
      `INSERT INTO materials (code, description, category, cost_price, list_price, is_sample) VALUES ($1,$2,$3,$4,$5,true)
       ON CONFLICT (code) DO NOTHING`, [m.code, m.description, m.category, m.cost.toFixed(2), m.list.toFixed(2)], db);
  }
  for (const c of companies()) {
    await query(
      `INSERT INTO companies (code, name, type, industry, city, state, contact_name, email, payment_terms, credit_limit, vendor_rating, is_sample)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true) ON CONFLICT (code) DO NOTHING`,
      [c.code, c.name, c.type, c.industry, c.city, c.state, c.contact, c.email, c.terms, c.credit.toFixed(2), c.rating], db);
  }
}

/** Opening stock, posted once as INITIAL movements so the movement history explains every balance. */
async function seedStock(db: pg.PoolClient) {
  const any = await queryOne('SELECT 1 FROM inventory_movements LIMIT 1', [], db);
  if (any) return false;
  const rnd = lcg(12345);
  const plants = await query<{ id: number; code: string }>('SELECT id, code FROM plants ORDER BY plant_no', [], db);
  const mats = await query<{ id: number; code: string }>('SELECT id, code FROM materials WHERE is_sample ORDER BY code', [], db);
  const byCode = new Map(materials().map((m, i) => [m.code, i]));
  mats.sort((a, b) => (byCode.get(a.code) ?? 0) - (byCode.get(b.code) ?? 0));
  for (const m of mats) {
    for (const p of plants) {
      let qty = rnd() < 0.12 ? 0 : Math.floor(rnd() * 150);
      if (m.code === 'ECHO01' && p.code === 'PUN') qty = 20;
      if (m.code === 'ECHO01' && p.code === 'MUM') qty = 60;
      if (qty > 0) await postMovement(db, { materialId: m.id, plantId: p.id, quantity: qty, type: 'INITIAL', reason: 'Opening stock (sample data)', userId: null });
    }
  }
  return true;
}

export async function seedSampleData(): Promise<{ stockPosted: boolean }> {
  return withTransaction(async (db) => {
    await seedUsers(db);
    const projectId = await seedProject(db);
    await seedMasterData(db);
    await seedAlm(db, projectId);
    return { stockPosted: await seedStock(db) };
  });
}
