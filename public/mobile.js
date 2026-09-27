(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const small = matchMedia('(max-width: 767px)');
  let composing = false, escEnabled = false, sidebarOpen = false;
  let settingsReady = false, savingSettings = false, settingsRevision = -1;
  const header = document.createElement('header'); header.id = 'smart-header';
  header.innerHTML = `<button id="smart-menu" aria-label="セッション一覧を開く" aria-expanded="false"><img class="smart-logo" src="/_smart/icon.svg?v=3" width="32" height="32" alt="" aria-hidden="true"></button><div class="smart-brand">Smart <strong>ZCode</strong><span id="smart-connection">接続を確認中</span></div><button id="smart-settings" aria-label="Smart ZCode の設定"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M9 21h6"/></svg></button>`;
  document.body.append(header);
  const backdrop = document.createElement('button'); backdrop.id = 'smart-backdrop'; backdrop.setAttribute('aria-label', 'セッション一覧を閉じる'); document.body.append(backdrop);
  const panel = document.createElement('dialog'); panel.id = 'smart-dialog'; panel.setAttribute('aria-labelledby', 'smart-title');
  panel.innerHTML = `<div class="smart-dialog-heading"><div><span class="smart-eyebrow">MOBILE COMPANION</span><h2 id="smart-title">Smart ZCode</h2></div><button id="smart-close" aria-label="設定を閉じる">✕</button></div><p class="smart-muted">ZCode を、どこからでも。</p><section><h3>通知</h3><p>回答・承認の待ち受けとターン終了を、この端末に通知します。</p><button id="smart-push" class="smart-primary">この端末で通知を有効にする</button><button id="smart-test">テスト通知</button><p id="smart-message" role="status" aria-live="polite"></p><p class="smart-note">スマートフォンでは HTTPS が必要です。iPhone / iPad はホーム画面に追加してから開いてください。</p></section><section><label class="smart-setting-row"><span><strong>Esc で停止</strong><small>実行中のターンを停止します</small></span><input id="smart-esc" type="checkbox" role="switch"></label><p class="smart-note">IME 変換中、メニュー・ダイアログ表示中は停止しません。設定は接続中の端末で共有します。</p></section><section><h3>接続</h3><p id="smart-monitor">確認中…</p><button id="smart-reload">再接続</button></section>`;
  document.body.append(panel);
  const escToggle = $('#smart-esc');
  escToggle.checked = false; escToggle.disabled = true;
  const settingNote = escToggle.closest('section').querySelector('.smart-note');
  settingNote.textContent = 'IME 変換中、メニュー・ダイアログ表示中は停止しません。設定はサーバーに保存し、接続中の端末で共有します。';
  const settingMessage = document.createElement('p');
  settingMessage.id = 'smart-settings-message'; settingMessage.setAttribute('role', 'status');
  settingMessage.textContent = '共有設定を確認中…'; settingNote.after(settingMessage);
  function applySettings(value) {
    if (savingSettings || !value || typeof value.escStopEnabled !== 'boolean' || !Number.isSafeInteger(value.revision) || value.revision < settingsRevision) return;
    const changed = !settingsReady || value.revision > settingsRevision;
    escEnabled = value.escStopEnabled; settingsRevision = value.revision; settingsReady = true;
    escToggle.checked = escEnabled; escToggle.disabled = false;
    if (changed) settingMessage.textContent = '';
  }
  escToggle.addEventListener('change', async () => {
    if (!settingsReady || savingSettings) { escToggle.checked = escEnabled; return; }
    const previous = escEnabled;
    escEnabled = escToggle.checked; savingSettings = true; escToggle.disabled = true;
    settingMessage.textContent = '保存中…';
    try {
      const result = await api('settings', { escStopEnabled: escEnabled });
      savingSettings = false; applySettings(result.settings);
      settingMessage.textContent = '共有設定を保存しました。';
    } catch {
      escEnabled = previous; escToggle.checked = previous;
      settingMessage.textContent = '設定を保存できませんでした。変更前の設定に戻しました。';
    } finally { savingSettings = false; escToggle.disabled = !settingsReady; }
  });
  $('#smart-close').onclick = () => panel.close();
  $('#smart-reload').onclick = () => location.reload();
  panel.addEventListener('click', e => { if (e.target === panel) { const r = panel.getBoundingClientRect(); if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) panel.close(); } });

  function setSidebar(open) {
    sidebarOpen = open && small.matches;
    document.documentElement.classList.toggle('smart-sidebar-open', sidebarOpen);
    $('#smart-menu').setAttribute('aria-expanded', String(sidebarOpen));
    if (sidebarOpen) {
      const railButton = $('[data-workspace-sidebar-panel] button:has(img[alt="ZCode"])');
      railButton?.click();
      requestAnimationFrame(() => $('[data-testid="task-new-button"]')?.focus());
    }
    const conversation = $('[data-testid="conversation-column"]');
    if (conversation) conversation.inert = sidebarOpen;
  }
  $('#smart-menu').onclick = () => setSidebar(!sidebarOpen);
  backdrop.onclick = () => { setSidebar(false); $('#smart-menu').focus(); };
  document.addEventListener('click', event => {
    if (sidebarOpen && event.target.closest('[data-testid^="task-item-"], [data-testid="task-new-button"], [data-testid="conversation-new-task"], [data-testid="automations-open"], [data-testid="plugin-store-sidebar-open"], [data-testid="task-settings-button"]')) setSidebar(false);
  });
  small.addEventListener('change', () => { setSidebar(false); viewport(); });
  function viewport() {
    // Pin the shell to the visible viewport when the software keyboard opens.
    const view = window.visualViewport;
    if (view && view.scale !== 1) return;
    document.documentElement.style.setProperty('--smart-height', `${view?.height || innerHeight}px`);
    document.documentElement.style.setProperty('--smart-top', `${view?.offsetTop || 0}px`);
  }
  window.visualViewport?.addEventListener('resize', viewport);
  window.visualViewport?.addEventListener('scroll', viewport);
  window.addEventListener('resize', viewport); viewport();

  document.addEventListener('compositionstart', () => { composing = true; }, true);
  document.addEventListener('compositionend', () => { composing = false; }, true);
  // Capture ownership before a menu closes, then arbitrate in document bubble
  // before ZCode's window handler. Real keyboard dispatch may run microtasks
  // between listeners, so temporary listeners removed by a microtask are unsafe.
  const escapeDecisions = new WeakMap();
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const overlay = panel.open || [...document.querySelectorAll('[role="dialog"], [role="alertdialog"], [aria-modal="true"], [role="menu"], [role="listbox"], [data-slot="command-list"]')].some(e => e.getClientRects().length);
    const inputOwnsKey = composing || event.isComposing || event.keyCode === 229;
    const chord = event.repeat || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey;
    escapeDecisions.set(event, {
      guarded: event.defaultPrevented || !escEnabled || inputOwnsKey || chord || event.target.closest?.('input,textarea,select') || overlay || sidebarOpen,
      closePanel: panel.open && !inputOwnsKey && !chord,
      closeSidebar: sidebarOpen && !inputOwnsKey && !chord,
    });
  }, true);
  document.addEventListener('keydown', event => {
    const decision = escapeDecisions.get(event);
    if (!decision) return;
    escapeDecisions.delete(event);
    if (decision.guarded) {
      if (!event.defaultPrevented) {
        if (decision.closePanel) panel.close();
        if (decision.closeSidebar) setSidebar(false);
      }
      event.preventDefault();
      return;
    }
    if (event.defaultPrevented) return;
    const stop = [...document.querySelectorAll('[data-testid="v4-stop"]')].filter(e => e.getClientRects().length && !e.disabled);
    if (stop.length === 1) { event.preventDefault(); stop[0].click(); }
  });

  async function api(path, data) {
    const response = await fetch(`/_smart/api/${path}`, data === undefined ? { cache: 'no-store' } : { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Smart-ZCode': '1' }, body: JSON.stringify(data) });
    if (!response.ok) throw Error(response.status === 401 ? 'ログインし直してください。' : '通信に失敗しました。再試行してください。');
    return response.json();
  }
  let registration, status, subscription, pushOperation;
  let pushBusy = false, pushReady = false;
  const message = text => { $('#smart-message').textContent = text; };
  function renderPushState() {
    $('#smart-push').disabled = !pushReady || pushBusy || Boolean(pushOperation);
    $('#smart-push').textContent = subscription ? 'この端末の通知を無効にする' : 'この端末で通知を有効にする';
    $('#smart-test').disabled = !subscription || pushBusy || Boolean(pushOperation);
  }
  renderPushState();
  async function syncPushState() {
    if (!isSecureContext || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      $('#smart-push').disabled = true; $('#smart-test').disabled = true;
      message('この環境では Push 通知を利用できません。HTTPS と対応ブラウザをご利用ください。'); return;
    }
    registration ||= await navigator.serviceWorker.register('/_smart/sw.js', { scope: '/' });
    await navigator.serviceWorker.ready;
    subscription = await registration.pushManager.getSubscription();
    if (subscription && Notification.permission === 'granted') await api('subscribe', subscription.toJSON());
    pushReady = true;
  }
  function pushState() {
    if (pushBusy) return Promise.resolve();
    if (!pushOperation) {
      pushOperation = syncPushState().finally(() => { pushOperation = null; renderPushState(); });
      renderPushState();
    }
    return pushOperation;
  }
  async function refresh() {
    try {
      status = await api('status');
      applySettings(status.settings);
      $('#smart-connection').textContent = status.connected ? '接続済み' : '再接続中';
      $('#smart-connection').classList.toggle('online', status.connected);
      $('#smart-monitor').textContent = status.connected ? `バックグラウンド監視中 · ${status.taskCount} タスク · ${status.devices} 端末` : 'ZCode に接続できません。起動状態を確認してください。';
    } catch { $('#smart-connection').textContent = 'オフライン'; $('#smart-connection').classList.remove('online'); if (!settingsReady) settingMessage.textContent = '共有設定を取得できません。接続するまで Esc 停止は無効です。'; }
  }
  $('#smart-settings').onclick = () => { setSidebar(false); panel.showModal(); void refresh(); void pushState().catch(() => message('通知設定を読み込めませんでした。')); };
  $('#smart-push').onclick = async () => {
    if (!pushReady || pushBusy || pushOperation) return;
    pushBusy = true; renderPushState();
    try {
      if (subscription) {
        const previous = subscription;
        // Remove the browser subscription first. A failed local unsubscribe must
        // not report OFF and then silently re-register the same device on reload.
        await previous.unsubscribe();
        subscription = await registration.pushManager.getSubscription();
        if (subscription) throw Error('通知を解除できませんでした。もう一度お試しください。');
        await api('unsubscribe', { endpoint: previous.endpoint });
        message('この端末の通知を無効にしました。');
      }
      else {
        const permission = await Notification.requestPermission();
        if (permission !== 'granted') throw Error('通知が許可されていません。ブラウザのサイト設定を確認してください。');
        status ||= await api('status');
        const key = Uint8Array.from(atob(status.publicKey.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
        const created = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
        try { await api('subscribe', created.toJSON()); subscription = created; } catch (error) { await created.unsubscribe(); throw error; }
        message('通知を有効にしました。テスト通知で確認できます。');
      }
      await refresh();
    } catch (error) { message(error.message); } finally { pushBusy = false; renderPushState(); }
  };
  $('#smart-test').onclick = async () => { try { const result = await api('test', { endpoint: subscription.endpoint }); message(result.ok ? 'テスト通知を送信しました。' : '配信に失敗しました。通知を再設定してください。'); } catch (e) { message(e.message); } };
  // Restore an existing grant without prompting; permission is requested only
  // in the explicit enable-button handler above (required on mobile browsers).
  void pushState().catch(() => message('通知設定を読み込めませんでした。設定画面を開いて再試行してください。'));
  void refresh(); setInterval(() => { if (!document.hidden) void refresh(); }, 15000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) void refresh(); });
})();
