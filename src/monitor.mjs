import { randomUUID } from 'node:crypto';
import { Rpc } from './rpc.mjs';
import { WireDecoder } from './wire.mjs';
import { readInteraction, interactionText } from './interaction.mjs';
import { createTurnNotifier } from './turns.mjs';

export function notificationFor(previous, task) {
  if (task.parentSessionId) return null;
  const pending = task.pendingInteraction;
  if (pending && pending.interactionId !== previous?.pendingInteraction?.interactionId) return { title: pending.kind === 'userInput' ? '回答が必要です' : '承認が必要です', body: task.title, tag: `question-${task.sessionId}-${pending.interactionId}` };
  return null;
}

export function startMonitor(upstream, token, push) {
  let stopped = false, rpc, timer, connected = false, lastError = null, taskCount = 0, workspaceCount = 0;
  const seen = new Set();
  const workspaceBaselines = new Map();
  const turns = createTurnNotifier({ notify: payload => push.notify(payload), onError: () => { lastError = 'ターン履歴の取得を再試行中'; }, onSuccess: () => { if (lastError === 'ターン履歴の取得を再試行中') lastError = null; } });
  async function connect() {
    if (stopped) return;
    let current;
    try {
      const response = await fetch(new URL('/api/server-info', upstream), { headers: { Cookie: `zcode_lite_token=${encodeURIComponent(token)}` }, signal: AbortSignal.timeout(10000) });
      if (!response.ok) throw Error(`Server info: ${response.status}`);
      const metadata = await response.json();
      if (stopped) return;
      const url = new URL('/ws', upstream); url.protocol = upstream.protocol === 'https:' ? 'wss:' : 'ws:';
      current = rpc = new Rpc(url, token); await current.ready;
      if (stopped) { current.close(); return; }
      const hello = await current.call('zcode-agent', 'helloConversationV4');
      if (hello.protocolVersion !== 3) throw Error('Unsupported ZCode protocol');
      await current.call('zcode-agent', 'initializeConversationV4', { kind: 'clientHello', protocolVersion: 3, clientId: `smart-zcode-${randomUUID()}`, clientKind: 'web', appVersion: '0.1.0' });
      const allTasks = new Map(); workspaceCount = 0;
      for (const workspace of metadata.workspaces || []) {
        const scope = { workspacePath: workspace.path, ...(workspace.workspaceIdentity ? { workspaceIdentity: workspace.workspaceIdentity } : {}) };
        const decoder = new WireDecoder(), sessions = new Map(), pending = [];
        const workspaceKey = scope.workspaceIdentity || scope.workspacePath;
        let subscriptionId, seq = -1, baseline = false;
        const accept = wire => {
          if (!subscriptionId) { if (pending.length >= 4096) throw Error('Initial frame limit'); pending.push(wire); return; }
          if (wire.subscriptionId !== subscriptionId) return;
          const frame = decoder.accept(wire); if (!frame) return;
          if (frame.toSeq <= seq) return;
          if (frame.payload.kind === 'deltas' && (!baseline || frame.fromSeq !== seq)) throw Error('Sessions index gap');
          const initial = !baseline || wire.deliveryKind !== 'online';
          const previouslyObserved = workspaceBaselines.has(workspaceKey);
          if (!workspaceBaselines.has(workspaceKey)) workspaceBaselines.set(workspaceKey, frame.sentAt ?? Date.now());
          const observedSince = workspaceBaselines.get(workspaceKey);
          const updates = frame.payload.kind === 'snapshot' ? frame.payload.snapshot.sessions : frame.payload.deltas.filter(d => d.op === 'session.upserted').map(d => d.session);
          for (const session of updates) {
            const previous = sessions.get(session.sessionId);
            sessions.set(session.sessionId, session); allTasks.set(`${scope.workspaceIdentity || scope.workspacePath}:${session.sessionId}`, session);
            if (initial) {
              turns.baseline(current, scope, session, observedSince);
              if (previouslyObserved) turns.observe(current, scope, session, observedSince);
            } else if (!previous || session.lastActivityAt !== previous.lastActivityAt || session.phase !== previous.phase) turns.observe(current, scope, session, observedSince);
            const notification = (!initial || previouslyObserved) && session.pendingInteraction && notificationFor(previous, session);
            if (notification && !seen.has(notification.tag)) {
              seen.add(notification.tag); if (seen.size > 2000) seen.delete(seen.values().next().value);
              void deliver(current, scope, session, notification).catch(() => { lastError = '通知の送信に失敗しました'; });
            }
          }
          if (frame.payload.kind === 'deltas') for (const delta of frame.payload.deltas) if (delta.op === 'session.removed') { sessions.delete(delta.sessionId); allTasks.delete(`${scope.workspaceIdentity || scope.workspacePath}:${delta.sessionId}`); turns.remove(scope, delta.sessionId); }
          seq = frame.toSeq; baseline = true; taskCount = allTasks.size;
        };
        await current.listen('zcode-agent', 'onDynamicSessionsIndexFrame', scope, wire => { try { accept(wire); } catch { current.close(); } });
        const result = await current.call('zcode-agent', 'subscribeSessionsIndexV4', { ...scope, runtimePolicy: 'existing-only', visibility: 'background' });
        subscriptionId = result.ack.subscriptionId; workspaceCount++;
        for (const wire of pending) accept(wire); pending.length = 0;
      }
      if (stopped) { current.close(); return; }
      if (current.ws.readyState !== 1) throw Error('ZCode disconnected during initialization');
      connected = true; lastError = null;
      current.onClose = () => { connected = false; clearTimeout(timer); if (!stopped) timer = setTimeout(connect, 5000); };
      const heartbeat = async () => {
        if (stopped || current !== rpc || !connected) return;
        try { await current.call('zcode-agent', 'helloConversationV4'); } catch { current.close(); return; }
        timer = setTimeout(heartbeat, 15000);
      };
      await current.listen('zcode-agent', 'onAgentRuntimeRestarted', undefined, () => current.close());
      timer = setTimeout(heartbeat, 15000);
    } catch (error) {
      connected = false; lastError = error.message;
      if (current) { current.onClose = undefined; current.close(); }
      if (!stopped) timer = setTimeout(connect, 5000);
    }
  }
  async function deliver(connection, scope, session, notification) {
    // Fetch question text through the same V4 read subscription as the Web UI.
    if (session.pendingInteraction) {
      try {
        const interaction = await readInteraction(connection, scope, session.sessionId, session.pendingInteraction.interactionId);
        if (!interaction) return; // Already answered while acquiring the snapshot.
        notification.body = interactionText(interaction, session.title);
      } catch { /* Keep the session title if the upstream snapshot is unavailable. */ }
    }
    await push.notify({ ...notification, body: String(notification.body || '').slice(0, 600), url: '/', taskId: session.sessionId });
  }
  void connect();
  return { status: () => ({ connected, taskCount, workspaceCount, error: lastError }), stop() { stopped = true; clearTimeout(timer); turns.stop(); rpc?.close(); } };
}
