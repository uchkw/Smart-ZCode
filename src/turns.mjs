const titles = { completedSuccess: 'ターンが終了しました', completedInterrupted: 'ターンが停止しました', failed: 'ターンがエラーで終了しました' };

// Index frames are conflated: completed -> running -> completed can arrive as a
// single completed summary. Durable turn headers preserve those missed turns.
export async function readEndedTurns(connection, scope, sessionId, since, isStopped = () => false) {
  let beforeRowId, epoch;
  const ended = new Map();
  for (let page = 0; page < 1000; page++) {
    if (isStopped()) throw Error('Turn scan cancelled');
    const result = await connection.call('zcode-agent', 'conversationRowsRangeV4', { ...scope, sessionId, limit: 200, ...(beforeRowId === undefined ? {} : { beforeRowId }) });
    if (!Array.isArray(result.rows) || typeof result.atLogEpoch !== 'string') throw Error('Invalid turn history');
    if (epoch !== undefined && epoch !== result.atLogEpoch) throw Error('Turn history epoch changed');
    epoch = result.atLogEpoch;
    let pastBaseline = false;
    for (const row of result.rows) {
      if (row.kind !== 'turnHeader' || !titles[row.state] || !Number.isFinite(row.endedAt)) continue;
      if (row.endedAt <= since) { pastBaseline = true; continue; }
      if (row.executionKind !== 'controlOnly') ended.set(row.productTurnId || row.turnId, row);
    }
    if (!result.hasMore || pastBaseline) return [...ended.values()].sort((a, b) => a.endedAt - b.endedAt || a.rowId - b.rowId);
    const cursor = Math.min(...result.rows.map(row => row.rowId));
    if (!Number.isFinite(cursor) || (beforeRowId !== undefined && cursor >= beforeRowId)) throw Error('Turn history cursor did not advance');
    beforeRowId = cursor;
  }
  throw Error('Turn history scan exceeded page limit');
}

export function createTurnNotifier({ notify, onError = () => {}, onSuccess = () => {}, delayMs = 500, retryMs = 5000 }) {
  const states = new Map();
  let stopped = false;
  const keyFor = (scope, session) => `${scope.workspaceIdentity || scope.workspacePath}:${session.sessionId}`;
  function stateFor(connection, scope, session, since) {
    const key = keyFor(scope, session);
    let state = states.get(key);
    if (!state) { state = { scope, session, since, sent: new Set(), connection, running: false, dirty: false, timer: null }; states.set(key, state); }
    state.connection = connection; state.session = session;
    return state;
  }
  function schedule(state, delay) {
    if (stopped || state.cancelled || state.running || state.timer) return;
    state.timer = setTimeout(() => { state.timer = null; void scan(state); }, delay);
  }
  async function scan(state) {
    if (stopped || state.cancelled) return;
    state.running = true; state.dirty = false;
    const connection = state.connection;
    try {
      const turns = await readEndedTurns(connection, state.scope, state.session.sessionId, state.since, () => stopped || state.cancelled || connection !== state.connection);
      if (stopped || state.cancelled || connection !== state.connection) return;
      for (const turn of turns) {
        if (stopped || state.cancelled || connection !== state.connection) return;
        const id = `${turn.productTurnId || turn.turnId}:${turn.endedAt}`;
        if (state.sent.has(id)) continue;
        await notify({ title: titles[turn.state], body: state.session.title, tag: `turn-${state.session.sessionId}-${id}`, taskId: state.session.sessionId, url: '/' });
        state.sent.add(id);
      }
      onSuccess();
    } catch (error) {
      if (!stopped && !state.cancelled) { onError(error); state.dirty = true; }
    } finally {
      state.running = false;
      if (state.dirty && !stopped) schedule(state, retryMs);
    }
  }
  return {
    baseline(connection, scope, session, since) { if (!session.parentSessionId) stateFor(connection, scope, session, since); },
    observe(connection, scope, session, since) {
      if (stopped || session.parentSessionId) return;
      const state = stateFor(connection, scope, session, since);
      state.dirty = true; schedule(state, delayMs);
    },
    remove(scope, sessionId) { const key = keyFor(scope, { sessionId }); const state = states.get(key); if (state) { clearTimeout(state.timer); state.cancelled = true; states.delete(key); } },
    stop() { stopped = true; for (const state of states.values()) clearTimeout(state.timer); states.clear(); },
  };
}
