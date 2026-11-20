import { put } from '@vercel/blob';
import { createHash, randomUUID } from 'node:crypto';

const NAME_MAX = 80;
const TEXT_MAX = 2000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OUTCOMES = new Set(['more-money', 'give-back-hours', 'happier-customers']);

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
  return Object.fromEntries(new URLSearchParams(raw).entries());
}

function cleanLine(value, max) {
  return String(value || '').trim().replace(/\s+/g, ' ').slice(0, max);
}

function cleanText(value, max) {
  return String(value || '').replace(/\r\n/g, '\n').trim().slice(0, max);
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
  if (body.companyFax || body.company_fax) {
    res.status(200).json({ ok: true });
    return;
  }

  const name = cleanLine(body.name, NAME_MAX);
  const email = cleanLine(body.email, 254).toLowerCase();
  const businessPhone = cleanLine(body.businessPhone || body.phone, 40);
  const businessName = cleanLine(body.businessName, 120);
  const businessWebsite = cleanLine(body.businessWebsite, 200);
  const desiredOutcome = cleanLine(body.desiredOutcome || body.outcome, 40);
  const specificProblem = cleanText(body.specificProblem || body.problem, TEXT_MAX);
  const repeatedTask = cleanText(body.repeatedTask, TEXT_MAX);
  const friction = cleanText(body.friction, TEXT_MAX);
  const weeklyHoursAndOwner = cleanText(body.weeklyHoursAndOwner || body.hoursOwner, TEXT_MAX);
  const desiredChange = cleanText(body.desiredChange || body.changeIfFixed, TEXT_MAX);

  if (!name) return fail(res, 400, 'Please add your name.');
  if (!EMAIL_RE.test(email)) return fail(res, 400, 'Please add a valid email address.');
  if (!businessPhone) return fail(res, 400, 'Please add a business phone number.');
  if (!businessName) return fail(res, 400, 'Please add your business name.');
  if (!businessWebsite) return fail(res, 400, 'Please add a business website. A domain such as company.com is fine.');
  if (!OUTCOMES.has(desiredOutcome)) return fail(res, 400, 'Please choose the result that matters most right now.');
  if (specificProblem.length < 15) return fail(res, 400, 'Please name one specific problem (at least 15 characters).');
  if (repeatedTask.length < 30) return fail(res, 400, 'The repeated task needs at least 30 characters.');
  if (friction.length < 30) return fail(res, 400, 'Where things get stuck needs at least 30 characters.');
  if (weeklyHoursAndOwner.length < 15) return fail(res, 400, 'Hours and who does the work needs at least 15 characters.');
  if (desiredChange.length < 30) return fail(res, 400, 'What would change needs at least 30 characters.');

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
    businessPhone,
    phone: businessPhone,
    businessName,
    businessWebsite,
    desiredOutcome,
    specificProblem,
    repeatedTask,
    friction,
    weeklyHoursAndOwner,
    desiredChange,
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
