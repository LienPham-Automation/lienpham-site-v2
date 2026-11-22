# lienpham.space v2: preview only

A shorter rebuild of [lienpham.space](https://lienpham.space), with a free 15-minute assessment as the main offer.

**This repo is a preview.** It is not connected to the `lienpham.space` domain, DNS, or the current live site. Search engines are asked not to index it.

## What this version does

- One primary call to action: a free 15-minute assessment
- A five-question intake on the page (no automatic calendar booking)
- Submissions stored as private JSON in a Vercel Blob store, under `assessments/`
- A placeholder for a later Retell voice assistant (not wired, no API keys)
- Paid audit mentioned without prices: “details on the call”

Nothing is emailed automatically. The Retell widget is not live on this preview.

## View submissions

Open `/api/requests?key=YOUR_SIGNUPS_VIEW_KEY` (HTML table) or add `&format=csv`. The key lives in the Vercel project environment variables. It is not in this repo.

If Blob storage has not been connected yet, the form will say so instead of silently failing.

## Stack

- Static `index.html` (no framework)
- Vercel serverless functions in `api/`
- Vercel Blob for storage

## Local

```bash
npm install
npx vercel dev
```
