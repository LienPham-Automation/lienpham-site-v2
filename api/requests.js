import { list, get } from '@vercel/blob';
import { timingSafeEqual } from 'node:crypto';

function keyMatches(provided, expected) {
  if (!provided || !expected) return false;
  const a = Buffer.from(String(provided));
  const b = Buffer.from(String(expected));
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function outcomeLabel(row) {
  const value = row.desiredOutcome || row.outcome;
  return {
    'more-money': 'Make more money',
    'give-back-hours': 'Get more hours back',
    'happier-customers': 'Make customers happier',
    'hours-back': 'Get more hours back',
    'time-back': 'I need time back in my week',
    'leads-going-cold': 'Leads and enquiries are going cold',
    'admin-piling-up': 'Invoices and admin are piling up',
    'follow-up-mess': 'Follow-up is a bit of a mess',
  }[value] || value || '';
}

function hoursOwner(row) {
  return row.weeklyHoursAndOwner || row.hoursOwner || '';
}

function desiredChange(row) {
  return row.desiredChange || row.changeIfFixed || '';
}

function toolsLabel(row) {
  const names = {
    email: 'Email inbox',
    spreadsheets: 'Spreadsheets',
    crm: 'A CRM',
    booking: 'A booking tool',
    invoicing: 'Invoicing software',
    'social-dms': 'Social DMs',
    other: 'Something else',
  };
  const selected = Array.isArray(row.tools) ? row.tools : String(row.tools || '').split(',').filter(Boolean);
  const labels = selected.map((tool) => names[tool] || tool);
  if (row.toolsOther) labels.push(row.toolsOther);
  return labels.join(', ');
}

function toCsv(rows) {
  const header = [
    'Timestamp (UTC)',
    'Name',
    'Email',
    'Business phone',
    'Business name',
    'Business website',
    'Desired outcome',
    'Specific problem',
    'Repeated task',
    'Where it gets stuck',
    'Hours and who',
    'What would change',
    'Tools (older submissions)',
  ];
  const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  return (
    [
      header,
      ...rows.map((r) => [
        r.createdAt,
        r.name,
        r.email,
        r.businessPhone || r.phone,
        r.businessName,
        r.businessWebsite,
        outcomeLabel(r),
        r.specificProblem || r.problem || '',
        r.repeatedTask,
        r.friction,
        hoursOwner(r),
        desiredChange(r),
        toolsLabel(r),
      ]),
    ]
      .map((cols) => cols.map(escape).join(','))
      .join('\n') + '\n'
  );
}

function renderHtml(rows) {
  const items = rows
    .map((r) => {
      const detail = [
        ['Desired outcome', outcomeLabel(r)],
        ['Specific problem', r.specificProblem || r.problem || ''],
        ['Repeated task', r.repeatedTask],
        ['Where it gets stuck', r.friction],
        ['Hours and who', hoursOwner(r)],
        ['What would change', desiredChange(r)],
      ];
      if (toolsLabel(r)) detail.push(['Tools (older submission)', toolsLabel(r)]);
      const body = detail
        .map(([label, value]) => `<p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>`)
        .join('');
      return `<article class="card">
        <h2>${escapeHtml(r.name)} · ${escapeHtml(r.businessName)}</h2>
        <p class="meta">${escapeHtml(r.createdAt)} · ${escapeHtml(r.email)} · ${escapeHtml(r.businessPhone || r.phone)}${r.businessWebsite ? ` · ${escapeHtml(r.businessWebsite)}` : ''}</p>
        ${body}
      </article>`;
    })
    .join('');

  return `<!doctype html>
<html lang="en-AU">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex, nofollow">
  <title>Assessment requests</title>
  <style>
    body { margin: 0; font-family: system-ui, sans-serif; background: #F3EBDB; color: #113F34; }
    main { max-width: 880px; margin: 0 auto; padding: 32px 20px 64px; }
    h1 { font-size: 1.4rem; margin: 0 0 8px; }
    h2 { font-size: 1.05rem; margin: 0 0 6px; }
    p { color: #4F5A52; }
    a { color: #F41C5E; }
    .card { background: #FFFDF7; border: 1px solid #D9CBB7; border-radius: 16px; padding: 18px 20px; margin: 16px 0; }
    .meta { font-size: 0.9rem; }
    .empty { padding: 24px; background: #FFFDF7; border-radius: 12px; }
  </style>
</head>
<body>
  <main>
    <h1>Assessment requests</h1>
    <p>${rows.length} request${rows.length === 1 ? '' : 's'}. <a href="?format=csv">Download CSV</a></p>
    ${rows.length ? items : '<p class="empty">No assessment requests yet.</p>'}
  </main>
</body>
</html>`;
}

async function readRecord(blob) {
  try {
    const result = await get(blob.pathname, {
      access: 'private',
      useCache: false,
      token: process.env.BLOB_READ_WRITE_TOKEN,
    });
    if (!result || result.statusCode !== 200 || !result.stream) return null;
    const text = await new Response(result.stream).text();
    const data = JSON.parse(text);
    if (!data || !data.email) return null;
    return data;
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');

  if (req.method !== 'GET') {
    res.status(405).json({ ok: false, error: 'Method not allowed' });
    return;
  }

  const url = new URL(req.url, `https://${req.headers.host}`);
  const provided = url.searchParams.get('key') || req.headers['x-signups-key'] || '';

  if (!keyMatches(provided, process.env.SIGNUPS_VIEW_KEY)) {
    res.status(401).send('Unauthorized');
    return;
  }

  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    res.status(500).send('Assessment storage is not configured yet.');
    return;
  }

  const blobs = [];
  let cursor;
  do {
    const page = await list({
      prefix: 'assessments/',
      token: process.env.BLOB_READ_WRITE_TOKEN,
      cursor,
    });
    blobs.push(...page.blobs);
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);

  const rows = [];
  for (const blob of blobs) {
    const row = await readRecord(blob);
    if (row) rows.push(row);
  }
  rows.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

  const format = (url.searchParams.get('format') || '').toLowerCase();
  if (format === 'json') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.status(200).send(JSON.stringify({ count: rows.length, requests: rows }, null, 2));
    return;
  }
  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="assessment-requests.csv"');
    res.status(200).send(toCsv(rows));
    return;
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(renderHtml(rows));
}
