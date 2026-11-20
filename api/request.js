import { put } from '@vercel/blob';
import { createHash, randomUUID } from 'node:crypto';

const NAME_MAX = 80;
const TEXT_MAX = 2000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OUTCOMES = new Set(['time-back', 'leads-going-cold', 'admin-piling-up', 'follow-up-mess']);
const TOOLS = new Set(['email', 'spreadsheets', 'crm', 'booking', 'invoicing', 'social-dms', 'other']);

function readBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return req.body;
  }
  const raw = typeof req.body === 'string' ? req.body : (req.body ? req.body.toString('utf8') : '');
  if (!raw) return {};
  const contentType = String(req.headers['content-type'] || '');
  if (contentType.includes('application/json')) {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  const params = new URLSearchParams(raw);
  const data = Object.fromEntries(params.entries());
  data.tools = params.getAll('tools');
  return data;
}

function clean(value, max) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function listFrom(value) {
  const items = Array.isArray(value) ? value : String(value || '').split(',');
  return items.map((item) => clean(item, 40)).filter(Boolean);
}

function fail(res, status, error) {
  res.status(status).json({ ok: false, error });
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  if (req.method !== 'POST') {
    fail(res, 405, 'Method not allowed');
    return;
  }

  const body = readBody(req);

  // Honeypot: silently succeed so bots think it worked.
  if (body.company_fax) {
    res.status(200).json({ ok: true });
    return;
  }

  const name = clean(body.name, NAME_MAX);
  const email = clean(body.email, 254).toLowerCase();
  const phone = clean(body.phone, 40);
  const businessName = clean(body.businessName, 120);
  const businessWebsite = clean(body.businessWebsite, 200);
  const outcome = clean(body.outcome, 40);
  const problem = clean(body.problem, TEXT_MAX);
  const repeatedTask = clean(body.repeatedTask, TEXT_MAX);
  const friction = clean(body.friction, TEXT_MAX);
  const hoursOwner = clean(body.hoursOwner, TEXT_MAX);
  const tools = listFrom(body.tools).filter((tool) => TOOLS.has(tool));
  const toolsOther = clean(body.toolsOther, 200);

  if (!name) return fail(res, 400, 'Please add your name.');
  if (!EMAIL_RE.test(email)) return fail(res, 400, 'Please add a valid email address.');
  if (!phone) return fail(res, 400, 'Please add a phone number I can reach you on.');
  if (!businessName) return fail(res, 400, 'Please add your business name.');
  if (!OUTCOMES.has(outcome)) return fail(res, 400, 'Please choose the main thing you want help with.');
  if (problem.length < 8) return fail(res, 400, 'Please tell me the one thing that’s doing your head in.');
  if (repeatedTask.length < 8) return fail(res, 400, 'Please tell me the annoying job you keep doing on loop.');
  if (friction.length < 8) return fail(res, 400, 'Please tell me where it usually goes sideways.');
  if (hoursOwner.length < 4) return fail(res, 400, 'Please add a rough time estimate and who does it.');
  if (!tools.length) return fail(res, 400, 'Please tick the tools you already use — even if it’s just email.');

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    fail(res, 500, 'Assessment storage is not configured on this preview yet. Please email letschat@lienpham.space instead.');
    return;
  }

  const emailHash = createHash('sha256').update(email).digest('hex').slice(0, 16);
  const createdAt = new Date().toISOString();
  const record = {
    id: randomUUID(),
    name,
    email,
    phone,
    businessName,
    businessWebsite,
    outcome,
    problem,
    repeatedTask,
    friction,
    hoursOwner,
    tools,
    toolsOther,
    createdAt,
    source: 'lienpham-site-v2',
  };

  await put(`assessments/${createdAt.slice(0, 10)}-${emailHash}.json`, JSON.stringify(record), {
    access: 'private',
    addRandomSuffix: true,
    allowOverwrite: false,
    contentType: 'application/json',
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });

  res.status(200).json({ ok: true });
}
