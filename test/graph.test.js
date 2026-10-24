import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPlan, preflight, validatePlan, execute, DOTS } from '../engine.js';

const grants = ['calendar.read', 'crm.read', 'mail.read', 'docs.read'];

test('the standard plan passes graph validation', () => {
  assert.deepEqual(validatePlan(buildPlan()), { ok: true, errors: [] });
  assert.equal(preflight(buildPlan(), grants).checks.find(c => c.id === 'P0').result, 'pass');
});

test('missing dependencies fail before execution', () => {
  const plan = buildPlan();
  plan[1].deps = ['does-not-exist'];
  const result = validatePlan(plan);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some(e => e.includes('missing dependency')));
  assert.equal(preflight(plan, grants).checks.find(c => c.id === 'P0').result, 'fail');
});

test('duplicate step IDs are rejected', () => {
  const plan = buildPlan();
  plan[1].id = plan[0].id;
  assert.ok(validatePlan(plan).errors.some(e => e.includes('duplicate step id')));
});

test('unregistered Dots are rejected', () => {
  const plan = buildPlan();
  plan[0].dot = 'unknown.dot';
  assert.ok(validatePlan(plan).errors.some(e => e.includes('unregistered Dot')));
});

test('forward dependencies are rejected because execution is ordered', () => {
  const plan = buildPlan();
  plan[0].deps = ['s2'];
  assert.ok(validatePlan(plan).errors.some(e => e.includes('must precede')));
});

test('dependency cycles are explicitly detected', () => {
  const plan = [
    { id: 'a', dot: 'calendar.find_meeting', deps: ['b'] },
    { id: 'b', dot: 'crm.get_account', deps: ['a'] }
  ];
  assert.ok(validatePlan(plan).errors.some(e => e.includes('dependency cycle')));
});

test('non-array plans are rejected safely', () => {
  assert.equal(validatePlan(null).ok, false);
});

test('empty plans are rejected before execution', () => {
  assert.ok(
    validatePlan([]).errors.some(e => e.includes('at least one step'))
  );

  const result = execute([], 'Northstar');

  assert.equal(result.halted.code, 'E_INVALID_PLAN');
  assert.deepEqual(result.inv, []);
  assert.deepEqual(result.D, {});
});

test('execute rejects an invalid graph before running any Dot', () => {
  const plan = buildPlan();
  plan[1].deps = ['does-not-exist'];

  let calls = 0;
  const registry = Object.fromEntries(
    Object.entries(DOTS).map(([id, dot]) => [
      id,
      {
        ...dot,
        run(...args) {
          calls++;
          return dot.run(...args);
        }
      }
    ])
  );

  const result = execute(plan, 'Northstar', registry);

  assert.equal(result.halted.code, 'E_INVALID_PLAN');
  assert.ok(result.halted.candidates.some(e => e.includes('missing dependency')));
  assert.deepEqual(result.inv, []);
  assert.deepEqual(result.D, {});
  assert.equal(calls, 0);
});
