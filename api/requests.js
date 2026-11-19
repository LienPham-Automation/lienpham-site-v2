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

function outcomeLabel(value) {
  return {
    'more-money': 'Make more money',
    'hours-back': 'Get hours back',
    'happier-customers': 'Make customers happier',
  }[value] || value || '';
}

function toCsv(rows) {
  const header = [
    'Timestamp (UTC)',
    'Name',
    'Email',
    'Phone',
    'Business',
    'Website',
    'Outcome',
    'Problem',
    'Repeated task',
    'Friction',
    'Hours and owner',
    'What would change',
  ];
  const escape = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  return (
    [
      header,
      ...rows.map((r) => [
        r.createdAt,
        r.name,
        r.email,
        r.phone,
        r.businessName,
        r.businessWebsite,
        outcomeLabel(r.outcome),
        r.problem,
        r.repeatedTask,
        r.friction,
        r.hoursOwner,
        r.changeIfFixed,
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
        ['Outcome', outcomeLabel(r.outcome)],
        ['Problem', r.problem],
        ['Repeated task', r.repeatedTask],
        ['Friction', r.friction],
        ['Hours and owner', r.hoursOwner],
        ['What would change', r.changeIfFixed],
      ]
        .map(([label, value]) => `<p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value)}</p>`)
        .join('');
      return `<article class="card">
        <h2>${escapeHtml(r.name)} · ${escapeHtml(r.businessName)}</h2>
        <p class="meta">${escapeHtml(r.createdAt)} · ${escapeHtml(r.email)} · ${escapeHtml(r.phone)}${r.businessWebsite ? ` · ${escapeHtml(r.businessWebsite)}` : ''}</p>
        ${detail}
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
