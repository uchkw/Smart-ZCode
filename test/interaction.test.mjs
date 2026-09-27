import test from 'node:test';
import assert from 'node:assert/strict';
import { readInteraction, interactionText } from '../src/interaction.mjs';

test('Question snapshot timeout disposes listener and unsubscribes', async () => {
  const calls = []; let disposed = false;
  const connection = {
    async listen() { return () => { disposed = true; }; },
    async call(_channel, method, params) { calls.push({ method, params }); return { ack: { subscriptionId: 's' } }; },
  };
  await assert.rejects(readInteraction(connection, { workspacePath: '/w' }, 'root', 'q', 20), /timed out/);
  assert.equal(disposed, true);
  assert.equal(calls.at(-1).method, 'unsubscribeConversationV4');
  assert.equal(calls.at(-1).params.runtimePolicy, 'existing-only');
});

test('Subscription failure closes the connection to release unknown subscription', async () => {
  let disposed = false, closed = false;
  await assert.rejects(readInteraction({
    async listen() { return () => { disposed = true; }; },
    async call() { throw Error('RPC timeout'); },
    close() { closed = true; },
  }, {}, 'root', 'q'), /RPC timeout/);
  assert.ok(disposed && closed);
});

test('Question formatting includes multiple questions and hides sensitive prompts', () => {
  assert.equal(interactionText({ kind: 'permission', payload: { summary: 'Run the command?' } }, 'Task'), 'Run the command?');
  const question = { kind: 'userInput', payload: { prompt: 'Pick one', questions: [{ question: 'Which?', options: [{ label: 'A' }, { label: 'B' }] }, { question: 'Why?', options: [] }] } };
  assert.equal(interactionText(question, 'Task'), 'Which?\n選択肢: A / B\nWhy?');
  assert.ok(!interactionText({ ...question, payload: { sensitive: true, prompt: 'secret prompt' } }, 'Task').includes('secret prompt'));
});

test('Successive questions on one session cannot replace each other’s temporary subscriptions', async () => {
  let listener, active = 0, maximum = 0, next = 0;
  const connection = {
    async listen(_channel, _event, _scope, callback) { listener = callback; return () => { listener = null; }; },
    async call(_channel, method) {
      if (method === 'unsubscribeConversationV4') { active--; return; }
      active++; maximum = Math.max(maximum, active);
      const subscriptionId = `s-${next++}`, topic = 'conversation/root';
      listener({ wireVersion: 3, kind: 'complete', topic, subscriptionId, frame: { topic, subscriptionId, payload: { kind: 'snapshot', snapshot: {
        sessionId: 'root', pendingInteractions: [{ interactionId: 'q1' }, { interactionId: 'q2' }],
      } } } });
      return { ack: { subscriptionId } };
    },
  };
  const results = await Promise.all(['q1', 'q2'].map(id => readInteraction(connection, {}, 'root', id)));
  assert.deepEqual(results.map(result => result.interactionId), ['q1', 'q2']);
  assert.equal(maximum, 1); assert.equal(active, 0);
});
