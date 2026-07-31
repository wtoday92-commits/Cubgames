// Точка входа: лобби, соединение, связка сети и игры.
// Хост авторитетен (seat 0), гость (seat 1) только рисует и шлёт действия.

import { createGame, apply, viewFor } from './game.js?v=8';
import { Net } from './net.js?v=8';
import * as ui from './ui.js?v=8';
import * as audio from './audio.js?v=8';

const net = new Net();
let role = null;       // 'host' | 'guest'
let game = null;       // только у хоста
let lastPhase = null;

const $ = (id) => document.getElementById(id);

// ---------- экраны ----------
let helpShownOnce = false;
function showLobby() { $('lobby').classList.remove('hidden'); $('game').classList.add('hidden'); }
function showGame() {
  $('lobby').classList.add('hidden');
  $('game').classList.remove('hidden');
  if (!helpShownOnce) { helpShownOnce = true; $('help-modal').classList.remove('hidden'); }
}

// ---------- баннер первого игрока при входе в раунд общих костей ----------
function handleBanner(state) {
  if (state.phase !== lastPhase) {
    if (state.phase === 'commonRoll') ui.showFirstPlayerBanner(state);
    if (state.phase === 'scoring') ui.toast('Раунд подсчитан');
    lastPhase = state.phase;
  }
}

// ---------- хост ----------
function afterHostChange() {
  const guestView = viewFor(game, 1);
  net.send({ t: 'state', state: guestView });
  const hostView = viewFor(game, 0);
  ui.render(hostView);
  handleBanner(hostView);
}

function startAsHost() {
  role = 'host';
  ui.setSeat(0);
  ui.initUI((action) => { apply(game, action, 0); afterHostChange(); });

  net.on('open', (code) => {
    $('host-status').innerHTML =
      `Код комнаты: <span class="code">${code}</span> ` +
      `<button id="copy-code" class="btn tiny">копировать</button><br>` +
      `<span class="muted">Ждём второго игрока…</span>`;
    const cp = $('copy-code');
    if (cp) cp.addEventListener('click', () => {
      navigator.clipboard?.writeText(code);
      ui.toast('Код скопирован');
    });
  });
  net.on('connected', () => {
    game = createGame();
    showGame();
    lastPhase = null;
    afterHostChange();
    ui.toast('Игрок присоединился');
  });
  net.on('data', (msg) => {
    if (msg.t === 'action') { apply(game, msg.action, 1); afterHostChange(); }
  });
  net.on('status', (s) => {
    const el = $('host-status').querySelector('.muted');
    if (el) el.textContent = s;
  });
  net.on('closed', () => ui.toast('Соперник отключился'));
  net.on('error', (e) => ui.toast('Ошибка сети: ' + (e?.message || e?.type || e)));
  net.host();
}

// ---------- гость ----------
function startAsGuest(code) {
  role = 'guest';
  ui.setSeat(1);
  ui.initUI((action) => net.send({ t: 'action', action }));

  net.on('status', (s) => { $('join-status').textContent = s; });
  net.on('connected', () => { showGame(); ui.toast('Подключено'); });
  net.on('data', (msg) => {
    if (msg.t === 'state') {
      showGame();
      ui.render(msg.state);
      handleBanner(msg.state);
    }
  });
  net.on('closed', () => ui.toast('Хост отключился'));
  net.on('error', (e) => {
    const m = e?.message || e?.type || e;
    $('join-status').innerHTML = `<span style="color:#f55">${m}</span><br>` +
      `<span class="muted">Обновите страницу и попробуйте снова.</span>`;
    ui.toast('' + m);
  });
  net.join(code);
}

// ---------- привязка кнопок лобби ----------
window.addEventListener('DOMContentLoaded', () => {
  $('btn-create').addEventListener('click', () => {
    $('host-status').textContent = 'Создаём комнату…';
    $('create-panel').classList.remove('hidden');
    $('join-panel').classList.add('hidden');
    startAsHost();
  });
  $('btn-join').addEventListener('click', () => {
    $('join-panel').classList.remove('hidden');
    $('create-panel').classList.add('hidden');
  });
  $('btn-join-go').addEventListener('click', () => {
    const code = $('join-code').value.trim();
    if (code.length < 3) { ui.toast('Введите код комнаты'); return; }
    $('join-status').textContent = 'Подключаемся…';
    startAsGuest(code);
  });
  $('join-code').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('btn-join-go').click();
  });

  // звук леса
  const soundBtn = $('btn-sound');
  soundBtn.addEventListener('click', () => {
    const on = audio.toggle();
    soundBtn.textContent = on ? '🔊' : '🔈';
    soundBtn.title = on ? 'Выключить звук леса' : 'Включить звук леса';
  });

  // справка
  const helpModal = $('help-modal');
  const openHelp = () => helpModal.classList.remove('hidden');
  const closeHelp = () => helpModal.classList.add('hidden');
  $('btn-help').addEventListener('click', openHelp);
  $('btn-help-close').addEventListener('click', closeHelp);
  helpModal.addEventListener('click', (e) => { if (e.target === helpModal) closeHelp(); });
  window.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeHelp(); });
});
