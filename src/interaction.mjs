import { WireDecoder } from './wire.mjs';

const readers = new WeakMap();

// Read the same pending-interaction payload as ZCode's conversation UI, then
// release the temporary subscription. Index summaries intentionally omit text.
export function readInteraction(connection, scope, sessionId, interactionId, timeoutMs = 15000) {
  let active = readers.get(connection);
  if (!active) { active = new Map(); readers.set(connection, active); }
  const key = `${scope.workspaceIdentity || scope.workspacePath}:${sessionId}`;
  // ZCode replaces a subscription to the same topic on the same connection.
  // Serialize rapid successive questions so their temporary reads cannot collide.
  const previous = active.get(key) || Promise.resolve();
  const result = previous.catch(() => {}).then(() => readSnapshot(connection, scope, sessionId, interactionId, timeoutMs));
  active.set(key, result);
  return result.finally(() => { if (active.get(key) === result) active.delete(key); });
}

async function readSnapshot(connection, scope, sessionId, interactionId, timeoutMs) {
  const topic = `conversation/${sessionId}`;
  const decoder = new WireDecoder(), pending = [];
  let subscriptionId, dispose, pendingBytes = 0, resolveSnapshot, rejectSnapshot, subscribeAttempted = false;
  const snapshot = new Promise((resolve, reject) => { resolveSnapshot = resolve; rejectSnapshot = reject; });
  snapshot.catch(() => {});
  const timeout = setTimeout(() => rejectSnapshot(Error('Question snapshot timed out')), timeoutMs);
  const accept = wire => {
    if (wire.topic !== topic) return;
    if (!subscriptionId) {
      pendingBytes += Buffer.byteLength(JSON.stringify(wire));
      if (pendingBytes > 32 * 1024 * 1024 || pending.length >= 4096) throw Error('Question frame queue limit');
      pending.push(wire); return;
    }
    if (wire.subscriptionId !== subscriptionId) return;
    const frame = decoder.accept(wire);
    if (frame?.payload.kind === 'snapshot') {
      const value = frame.payload.snapshot;
      if (value.sessionId !== sessionId || !Array.isArray(value.pendingInteractions)) throw Error('Invalid question snapshot');
      resolveSnapshot(value.pendingInteractions.find(item => item.interactionId === interactionId) || null);
    }
  };
  try {
    dispose = await connection.listen('zcode-agent', 'onDynamicConversationFrame', scope, wire => { try { accept(wire); } catch (error) { rejectSnapshot(error); } });
    subscribeAttempted = true;
    const result = await connection.call('zcode-agent', 'subscribeConversationV4', { ...scope, sessionId, visibility: 'background' });
    subscriptionId = result.ack.subscriptionId;
    for (const wire of pending) accept(wire);
    pending.length = 0;
    return await snapshot;
  } finally {
    clearTimeout(timeout); dispose?.();
    if (subscriptionId) {
      try { await connection.call('zcode-agent', 'unsubscribeConversationV4', { ...scope, subscriptionId, runtimePolicy: 'existing-only' }); }
      catch { connection.close(); } // Closing releases any unacknowledged subscription.
    } else if (subscribeAttempted) connection.close();
  }
}

export function interactionText(interaction, fallback) {
  const payload = interaction?.payload;
  if (!payload) return fallback;
  if (payload.sensitive) return '非公開の入力が必要です。ZCode を開いて回答してください。';
  if (interaction.kind === 'permission') return payload.summary || fallback;
  if (interaction.kind === 'userInput') {
    if (payload.questions?.length) return payload.questions.map(question => `${question.question}${question.options?.length ? `\n選択肢: ${question.options.map(option => option.label).join(' / ')}` : ''}`).join('\n');
    return `${payload.prompt || fallback}${payload.options?.length ? `\n選択肢: ${payload.options.map(option => option.label).join(' / ')}` : ''}`;
  }
  return fallback;
}
