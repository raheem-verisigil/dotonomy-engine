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
