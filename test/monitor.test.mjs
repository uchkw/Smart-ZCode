import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocketServer } from 'ws';
import { startMonitor } from '../src/monitor.mjs';
import { frame, decodeMessage } from '../src/rpc.mjs';

async function until(condition) { for (let i = 0; i < 400; i++) { if (condition()) return; await delay(20); } assert.fail('Timed out'); }

test('Monitor receives questions and completion without a browser, ignores baseline, duplicates and child sessions', async t => {
  const server = http.createServer((req, res) => { assert.equal(req.headers.cookie, 'zcode_lite_token=secret'); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ workspaces: [{ path: '/workspace' }] })); });
  const wss = new WebSocketServer({ server });
  const sent = [], methods = [];
  let stream, latest, seq = 1;
  const root = { sessionId: 'root', title: 'Root', phase: 'running', lastActivityAt: 1 };
  let initialSession = root, interactionId = 'q1';
  function wire(session, initial = false) {
    return { wireVersion: 3, kind: 'complete', deliveryKind: initial ? 'initial' : 'online', topic: 'sessions-index//workspace', subscriptionId: 's1', logicalFrameId: String(seq), logicalFrameOrdinal: seq, frame: { topic: 'sessions-index//workspace', subscriptionId: 's1', fromSeq: initial ? 0 : seq - 1, toSeq: seq, sentAt: 0, payload: initial ? { kind: 'snapshot', snapshot: { sessions: [session] } } : { kind: 'deltas', deltas: [{ op: 'session.upserted', session }] } } };
  }
  wss.on('connection', ws => {
    ws.send(frame([200], undefined));
    let eventId, conversationEventId;
    ws.on('message', data => {
      const [[type, id, channel, method], args] = decodeMessage(data.subarray(13));
      methods.push(method);
      if (type === 102 && method === 'onDynamicSessionsIndexFrame') { eventId = id; stream = session => { latest = session; seq++; ws.send(frame([204, eventId], wire(session))); }; }
      if (type === 102 && method === 'onDynamicConversationFrame') conversationEventId = id;
      if (type !== 100) return;
      let result;
      if (method === 'helloConversationV4') result = { protocolVersion: 3 };
      else if (method === 'initializeConversationV4') result = {};
      else if (method === 'subscribeSessionsIndexV4') {
        assert.equal(args[0].runtimePolicy, 'existing-only');
        // Real ZCode sends the initial frame before the subscription ACK.
        ws.send(frame([204, eventId], wire(initialSession, true))); result = { ack: { subscriptionId: 's1' } };
      } else if (method === 'subscribeConversationV4') {
        assert.equal(args[0].sessionId, 'root');
        ws.send(frame([204, conversationEventId], {
          wireVersion: 3, kind: 'complete', topic: 'conversation/root', subscriptionId: 'question-read',
          frame: { topic: 'conversation/root', subscriptionId: 'question-read', payload: { kind: 'snapshot', snapshot: {
            sessionId: 'root', pendingInteractions: [{ interactionId, kind: 'userInput', payload: { kind: 'userInput', prompt: 'どちらにしますか？', options: [{ optionId: 'a', label: 'A' }, { optionId: 'b', label: 'B' }] } }],
          } } },
        }));
        result = { ack: { subscriptionId: 'question-read' } };
      } else if (method === 'unsubscribeConversationV4') { assert.equal(args[0].subscriptionId, 'question-read'); result = {}; }
      else if (method === 'conversationRowsRangeV4') result = { atLogEpoch: 'epoch', hasMore: false, rows: latest?.phase === 'completedInterrupted' ? [{ kind: 'turnHeader', rowId: 1, turnId: 'turn1', state: 'completedInterrupted', endedAt: 2 }] : [] };
      else assert.fail(`Unexpected RPC ${channel}/${method}`);
      ws.send(frame([201, id], result));
    });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const monitor = startMonitor(new URL(`http://127.0.0.1:${server.address().port}`), 'secret', { async notify(payload) { sent.push(payload); } });
  t.after(() => { monitor.stop(); for (const ws of wss.clients) ws.terminate(); wss.close(); server.close(); });
  await until(() => monitor.status().connected); assert.equal(sent.length, 0);
  const question = { ...root, pendingInteraction: { interactionId: 'q1', kind: 'userInput' } };
  stream(question); await until(() => sent.length === 1); assert.match(sent[0].body, /どちら/); assert.match(sent[0].body, /A \/ B/);
  stream(question); stream({ ...question, sessionId: 'child', parentSessionId: 'root' });
  stream({ ...root, phase: 'completedInterrupted', lastActivityAt: 2 }); await until(() => sent.length === 2);
  assert.match(sent[1].title, /停止/); await delay(50); assert.equal(sent.length, 2);
  assert.ok(methods.includes('onDynamicSessionsIndexFrame')); assert.ok(!methods.includes('sendPrompt'));
  assert.ok(methods.includes('unsubscribeConversationV4')); assert.ok(!methods.includes('readSessionEvents'));
  // A question arrives during a disconnect and exists only in the next snapshot.
  interactionId = 'q2';
  initialSession = { ...root, pendingInteraction: { interactionId, kind: 'userInput' } };
  for (const ws of wss.clients) ws.terminate();
  await until(() => sent.length === 3);
  assert.match(sent[2].tag, /q2$/);
  stream(initialSession);
  await delay(50); assert.equal(sent.length, 3);
});
