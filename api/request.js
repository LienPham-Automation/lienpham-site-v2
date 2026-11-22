import { put } from '@vercel/blob';
import { createHash, randomUUID } from 'node:crypto';

const NAME_MAX = 80;
const TEXT_MAX = 2000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const OUTCOMES = new Set(['more-money', 'give-back-hours', 'happier-customers']);
const OUTCOME_LABELS = {
  'more-money': 'make more money',
  'give-back-hours': 'get more hours back',
  'happier-customers': 'make customers happier',
};

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

// Australian numbers (04XX..., 02/03/07/08..., 61..., +61...) or any +country number -> E.164.
export function toE164(input) {
  const raw = String(input || '').trim();
  const digits = raw.replace(/[^\d]/g, '');
  if (!digits) return null;
  if (raw.startsWith('+')) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
  if (digits.startsWith('61') && digits.length === 11) return `+${digits}`;
  if (/^0[2-478]\d{8}$/.test(digits)) return `+61${digits.slice(1)}`;
  return null;
}

function withinCallHours(now = new Date()) {
  const tz = process.env.CALL_TIMEZONE || 'Australia/Sydney';
  const start = Number(process.env.CALL_HOUR_START || 8);
  const end = Number(process.env.CALL_HOUR_END || 20);
  const hour = Number(new Intl.DateTimeFormat('en-AU', { hour: 'numeric', hourCycle: 'h23', timeZone: tz }).format(now));
  return hour >= start && hour < end;
}

// Speed-to-lead: ask Retell to call the lead straight away.
// Skipped (never fails the form) if Retell isn't configured, consent wasn't given,
// the number can't be read, or it's outside call hours.
async function startRetellCall(record) {
  const apiKey = process.env.RETELL_API_KEY;
  const fromNumber = process.env.RETELL_FROM_NUMBER;
  const agentId = process.env.RETELL_AGENT_ID;
  if (!apiKey || !fromNumber || !agentId) return { call: 'skipped', reason: 'not-configured' };
  if (!record.callConsent) return { call: 'skipped', reason: 'no-consent' };
  const toNumber = toE164(record.businessPhone);
  if (!toNumber) return { call: 'skipped', reason: 'bad-number' };
  if (!withinCallHours()) return { call: 'skipped', reason: 'outside-hours' };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch('https://api.retellai.com/v2/create-phone-call', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        from_number: fromNumber,
        to_number: toNumber,
        override_agent_id: agentId,
        metadata: { submission_id: record.id, source: record.source },
        retell_llm_dynamic_variables: {
          first_name: record.name.split(' ')[0],
          full_name: record.name,
          business_name: record.businessName,
          business_website: record.businessWebsite,
          desired_outcome: OUTCOME_LABELS[record.desiredOutcome] || record.desiredOutcome,
          specific_problem: record.specificProblem,
          repeated_task: record.repeatedTask,
          friction: record.friction,
          weekly_hours_and_owner: record.weeklyHoursAndOwner,
          desired_change: record.desiredChange,
        },
      }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      console.error('Retell call failed', response.status, payload);
      return { call: 'failed', reason: `retell-${response.status}` };
    }
    return { call: 'started', callId: payload.call_id || null };
  } catch (error) {
    console.error('Retell call error', error);
    return { call: 'failed', reason: 'network' };
  } finally {
    clearTimeout(timer);
  }
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
  const callConsent = ['yes', 'true', 'on', true].includes(body.callConsent);

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
    callConsent,
    createdAt,
    source: 'lienpham-site-v2',
  };

  const callResult = await startRetellCall(record);
  record.call = callResult;

  await put(`assessments/${createdAt.slice(0, 10)}-${emailHash}.json`, JSON.stringify(record), {
    access: 'private',
    addRandomSuffix: true,
    allowOverwrite: false,
    contentType: 'application/json',
    token: process.env.BLOB_READ_WRITE_TOKEN,
  });

  res.status(200).json({ ok: true, call: callResult.call });
}
