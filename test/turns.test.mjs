import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { createTurnNotifier, readEndedTurns } from '../src/turns.mjs';

const header = (turnId, endedAt, state = 'completedSuccess', rowId = endedAt) => ({ kind: 'turnHeader', turnId, rowId, endedAt, state });
const range = (rows, hasMore = false, atLogEpoch = 'epoch') => ({ rows, hasMore, atLogEpoch });
async function until(condition) { for (let i = 0; i < 200; i++) { if (condition()) return; await delay(5); } assert.fail('Turn notification timed out'); }

test('Turn history paginates to headers outside the tail window and excludes old/control turns', async () => {
  const calls = [];
  const connection = { async call(_channel, method, params) {
    assert.equal(method, 'conversationRowsRangeV4'); calls.push(params);
    if (params.beforeRowId === undefined) return range([{ kind: 'assistantText', rowId: 30 }, header('latest', 130, 'completedInterrupted', 40)], true);
    return range([header('old', 90, 'completedSuccess', 1), header('long', 110, 'failed', 10), { ...header('command', 120, 'completedSuccess', 20), executionKind: 'controlOnly' }], true);
  } };
  const turns = await readEndedTurns(connection, { workspacePath: '/w' }, 'root', 100);
  assert.deepEqual(turns.map(turn => turn.turnId), ['long', 'latest']);
  assert.equal(calls[1].beforeRowId, 30); assert.equal(calls.length, 2);
});

test('Turn history rejects changing epochs and non-advancing cursors', async () => {
  let calls = 0;
  await assert.rejects(readEndedTurns({ async call() { calls++; return range([{ kind: 'assistantText', rowId: 50 - calls }], true, String(calls)); } }, {}, 's', 0), /epoch changed/);
  await assert.rejects(readEndedTurns({ async call() { return range([{ kind: 'assistantText', rowId: 10 }], true); } }, {}, 's', 0), /did not advance/);
});

test('Conflated short turns and reconnect catch-up notify each terminal turn once', async t => {
  const sent = []; let rows = [header('history', 90)], reads = 0;
  const scope = { workspacePath: '/w' };
  const session = { sessionId: 'root', title: 'Task', phase: 'completedSuccess' };
  const connection = { async call() { reads++; return range(rows); } };
  const notifier = createTurnNotifier({ async notify(value) { sent.push(value); }, delayMs: 1, retryMs: 5 });
  t.after(() => notifier.stop());
  notifier.baseline(connection, scope, session, 100);
  await delay(10); assert.equal(reads, 0); assert.equal(sent.length, 0);
  // No running summary was ever delivered between these completed summaries.
  rows = [header('history', 90), header('fast', 110)];
  notifier.observe(connection, scope, { ...session, lastActivityAt: 110 }, 100);
  await until(() => sent.length === 1); assert.match(sent[0].title, /終了/);
  notifier.observe(connection, scope, session, 100);
  await until(() => reads === 2); assert.equal(sent.length, 1);
  // A reconnect supplies the latest state plus several previously missed turns.
  rows.push(header('stop', 120, 'completedInterrupted'), header('failed', 130, 'failed'));
  const reconnected = { async call() { return range(rows); } };
  notifier.baseline(reconnected, scope, session, 999);
  notifier.observe(reconnected, scope, session, 999);
  await until(() => sent.length === 3);
  assert.match(sent[1].title, /停止/); assert.match(sent[2].title, /エラー/);
  assert.equal(new Set(sent.map(value => value.tag)).size, 3);
  notifier.observe(reconnected, scope, { ...session, sessionId: 'child', parentSessionId: 'root' }, 0);
  await delay(10); assert.equal(sent.length, 3);
});

test('Failed history reads retry without a new index update; deleted sessions do not retry', async t => {
  const sent = [], errors = []; let reads = 0;
  const scope = { workspacePath: '/w' }, session = { sessionId: 'root', title: 'Task' };
  const notifier = createTurnNotifier({ notify: async value => sent.push(value), onError: error => errors.push(error), delayMs: 1, retryMs: 5 });
  t.after(() => notifier.stop());
  notifier.observe({ async call() { if (++reads === 1) throw Error('temporary failure'); return range([header('turn', 2)]); } }, scope, session, 1);
  await until(() => sent.length === 1); assert.equal(errors.length, 1);
  let rejectRead;
  notifier.observe({ call() { return new Promise((_resolve, reject) => { rejectRead = reject; }); } }, scope, session, 1);
  await until(() => Boolean(rejectRead));
  notifier.remove(scope, session.sessionId); rejectRead(Error('removed'));
  await delay(20); assert.equal(errors.length, 1);
});

test('Removing a session or stopping during delivery cancels the remaining notification batch', async () => {
  for (const action of ['remove', 'stop']) {
    let release; const sent = [];
    const scope = { workspacePath: '/w' }, session = { sessionId: 'root', title: 'Task' };
    const notifier = createTurnNotifier({ delayMs: 1, notify: async value => { sent.push(value); await new Promise(resolve => { release = resolve; }); } });
    try {
      notifier.observe({ async call() { return range([header('first', 2), header('second', 3)]); } }, scope, session, 1);
      await until(() => Boolean(release));
      if (action === 'remove') notifier.remove(scope, session.sessionId); else notifier.stop();
      release(); await delay(20);
      assert.equal(sent.length, 1);
    } finally { notifier.stop(); }
  }
});
