# Dotonomy v0.1

Working prototype: goal-to-outcome runtime. Contract, Dot registry, preflight verifier (P1-P5, P7, P8), purpose-bound Context filtering, label propagation, outcome verifier, signed hash-chained receipts (ed25519), trial gating. Fixture data only. Read-only. No real connectors yet.

## Run
    npm install && npm test && npm start     # http://localhost:3000

## Push to GitHub
    git init -b main && git add . && git commit -m "Dotonomy v0.1"
    git remote add origin https://github.com/<you>/dotonomy.git && git push -u origin main

## Deploy on Railway
1. New Project > Deploy from GitHub repo > pick dotonomy. Railway reads railway.json.
2. Variables: `SIGNING_KEY_PEM` (see below), `DATA_DIR=/data`, optional `TRIAL_RUNS=5`, `ALLOW_DEMO_UNLOCK=false` once real billing exists.
3. Add a Volume mounted at `/data` so receipts and the key survive redeploys.
4. Settings > Networking > Generate Domain.

Generate a key: `node -e "console.log(require('crypto').generateKeyPairSync('ed25519').privateKey.export({type:'pkcs8',format:'pem'}).replace(/\n/g,'\\\\n'))"`

## Known limits
- JSON-file storage (single instance). Move to Postgres before scaling.
- The Unlock button is a demo switch. No payment provider is wired.
- Not implemented yet: P6, P9-P12, real connectors, auth/SSO, replay, SDK.

## Benchmark
`npm run bench` compares the Dotonomy runtime with two SIMULATED plain-agent baselines on 8 cases (ambiguity, stale data, permission, confidential data to external model, injection, no match, malformed tool output). The baselines are rule-coded, so the result validates the harness only. To make it evidence, replace `agent()` in bench.js with a real LLM tool-calling agent using the same fixtures, run each case many times, and report variance.

### Real-LLM baseline
    export ANTHROPIC_API_KEY=sk-ant-...        # never commit this; .env is git-ignored
    npm run bench:llm -- --runs 10             # writes bench-llm-results.json
    npm run bench:llm -- --mock                # tests the harness without a key (numbers are meaningless)
Cases C5 and C8 do not apply to an LLM baseline. Set pass/fail thresholds BEFORE running.

## Website (v0.3)
`public/index.html` is the marketing site, built from the Stitch design by `tools/build_site.py` (`python3 tools/build_site.py tools/stitch-source.html`). It calls the real engine: the live demo runs `/api/run` with `sample:true` (signed, marked as a sample, unmetered, not stored, rate-limited), the verifier calls `/api/verify`, and the trial form calls `/api/auth/signup` then opens `/app.html`. `node verify-cli.js receipt.json public-key.pem` checks a receipt offline (`/api/public-key` serves the key). Pages `privacy.html` and `terms.html` are drafts pending legal review. Source-conflict detection (requirement R7) is live. Tailwind still loads from its CDN; compile it before production.

## Calendar connector and funnel (v0.4)
**Calendar:** logged-in users paste their calendar's secret iCal link in the app. Only titles, times and attendee names for the next 14 days are read; the link is stored AES-256-GCM encrypted (key derived from `SESSION_SECRET`; rotating it disconnects calendars). Fetches are https-only, size- and time-limited, and refuse private, loopback and metadata addresses (validated at connection time, so DNS tricks cannot bypass it). A connected calendar replaces the sample meetings; CRM, email and documents are still sample data, so a real meeting only briefs fully if its client exists in the sample CRM (otherwise the run is BLOCKED, honestly). Limits: recurring-event rules are ignored and times without a trailing Z are treated as UTC.
**Funnel:** the server logs sign-up, run, demo run, unlock and calendar-connect events per workspace. Set `ADMIN_TOKEN` and call `GET /api/admin/funnel` with header `x-admin-token` for counts of signups, activated users, 3+ runs, returned-on-another-day users and calendar connections. Unlock is a demo switch, so paid conversion is not measurable until billing exists.

## Calendar connector and funnel (v0.4)
Logged-in users can connect a calendar read-only by pasting its secret iCal link (`POST /api/connectors/calendar`). The link is fetched over HTTPS only, with private/loopback/metadata addresses blocked at DNS-lookup time, an 8s timeout, a 2MB cap and no redirects; it is stored AES-256-GCM encrypted (key derived from `SESSION_SECRET`, so rotating that secret disconnects calendars). Briefs then use real meetings from the next 14 days, and receipts record `live_sources:["calendar-ics"]`. CRM, email and documents are still sample data, so a real meeting only produces a full brief if its client matches a sample CRM account; otherwise the run is BLOCKED (no account), which is the honest result.
Known limits: recurring events are not expanded (only the first occurrence is read); events with a TZID but no UTC marker are read as UTC, so times can be off by the zone offset; a connected calendar that cannot be reached returns an error instead of silently falling back to sample data.
Funnel: product events are stored per workspace. Set `ADMIN_TOKEN` and call `GET /api/admin/funnel` with header `x-admin-token`. It reports demo runs, signups, first runs, 3+ runs, returns on another day, calendar connections and demo unlocks. Unlock is a demo switch, not a payment.
