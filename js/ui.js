// Рендер и ввод. Рисует состояние с точки зрения mySeat.
// Своё всегда синим, соперник — красным.

import { FACE_HEX, FACE_LABEL_RU, BOARD_SIZE, CELLS, POINTS_BY_LENGTH } from './constants.js?v=6';

const other = (s) => (s === 0 ? 1 : 0);

let dispatch = () => {};
let mySeat = 0;
let selectedDieId = null; // локальный выбор кости для расстановки
let lastState = null;

let _dbgBound = false;
export function initUI(dispatchFn) {
  dispatch = dispatchFn;
  if (!_dbgBound) {
    _dbgBound = true;
    // Ctrl+Shift+D — снять слепок состояния (для отладки подсчёта очков).
    window.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.code === 'KeyD')) {
        e.preventDefault();
        dumpState();
      }
    });
  }
}

function dumpState() {
  if (!lastState) { toast('Нет состояния'); return; }
  const txt = JSON.stringify({ mySeat, state: lastState });
  console.log('DICE_STATE_DUMP', txt);
  const done = () => toast('Слепок состояния скопирован — вставьте его в чат');
  const fallback = () => {
    const ta = document.createElement('textarea');
    ta.value = txt; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (_) {}
    ta.remove(); toast('Слепок в консоли (F12 → Console)');
  };
  if (navigator.clipboard) navigator.clipboard.writeText(txt).then(done, fallback);
  else fallback();
}

export function setSeat(seat) { mySeat = seat; }

// ---------- построение элемента кости ----------

function dieEl(die, opts = {}) {
  const el = document.createElement('div');
  el.className = 'die';
  el.dataset.id = die.id;
  const face = die.face;
  if (face !== 'joker') el.style.background = FACE_HEX[face] || '#333'; // джокер — фон из CSS (звезда)

  if (face === 'joker') { el.classList.add('joker'); }
  else if (face === 'white') { el.classList.add('white'); }
  else if (face === 'hidden') { el.classList.add('hidden'); el.textContent = '?'; }

  if (die.kind === 'personal') {
    el.classList.add('personal');
    el.classList.add(die.seat === mySeat ? 'own' : 'opp');
  } else {
    el.classList.add('common');
  }

  if (opts.rerollSelected) el.classList.add('reroll-sel');
  if (opts.selected) el.classList.add('selected');
  if (opts.clickable) el.classList.add('clickable');
  if (opts.onClick) el.addEventListener('click', opts.onClick);
  return el;
}

// ---------- главный рендер ----------

export function render(state) {
  lastState = state;
  const root = document.getElementById('game-content');
  root.innerHTML = '';

  // валидируем выбранную кость
  if (selectedDieId && (!state.dice[selectedDieId] || state.dice[selectedDieId].cell !== null)) {
    selectedDieId = null;
  }

  const layout = document.createElement('div');
  layout.className = 'layout';

  const left = document.createElement('div');
  left.className = 'left';
  left.appendChild(boardEl(state));

  const right = document.createElement('div');
  right.className = 'right';
  right.appendChild(statusBar(state));
  right.appendChild(playerPanel(state, other(mySeat), true));
  right.appendChild(playerPanel(state, mySeat, false));
  if (state.phase === 'commonRoll' || state.phase === 'placeCommon') {
    right.appendChild(commonPool(state));
  }
  right.appendChild(controls(state));
  right.appendChild(instructions(state));

  layout.appendChild(left);
  layout.appendChild(right);
  root.appendChild(layout);
}

function statusBar(state) {
  const bar = document.createElement('div');
  bar.className = 'status-bar';
  const phaseNames = {
    personalRoll: 'Бросок личных костей',
    commonRoll: 'Переброс общих костей',
    placeCommon: 'Расстановка общих костей',
    placePersonal: 'Расстановка личных костей',
    scoring: 'Подсчёт очков',
    gameover: 'Игра окончена',
  };
  bar.innerHTML = `
    <span class="round">Раунд ${state.round} / ${state.totalRounds}</span>
    <span class="phase">${phaseNames[state.phase] || state.phase}</span>
    <span class="score">Вы <b class="mine">${state.totalScores[mySeat]}</b> : <b class="opp">${state.totalScores[other(mySeat)]}</b> Соперник</span>
  `;
  return bar;
}

function playerPanel(state, seat, isOpponent) {
  const panel = document.createElement('div');
  panel.className = 'player-panel ' + (isOpponent ? 'opp-panel' : 'self-panel');
  if (state.turn === seat && (state.phase === 'placeCommon' || state.phase === 'placePersonal')) {
    panel.classList.add('active-turn');
  }

  const header = document.createElement('div');
  header.className = 'panel-header';
  const isFirst = state.firstPlayer === seat;
  header.innerHTML = `
    <span class="pname ${isOpponent ? 'opp' : 'mine'}">${isOpponent ? 'Соперник' : 'Вы'}</span>
    ${isFirst ? '<span class="first-badge" title="Первый игрок">① первый</span>' : ''}
    ${readyMark(state, seat)}
  `;
  panel.appendChild(header);

  // лоток личных костей игрока
  const tray = document.createElement('div');
  tray.className = 'tray';
  for (const id of state.personal[seat]) {
    const die = state.dice[id];
    if (die.cell !== null) continue; // выложенные — на поле
    const canReroll = !isOpponent && state.phase === 'personalRoll'
      && !state.readyPersonal[mySeat] && !state.rerollUsedPersonal[mySeat];
    const canPlace = !isOpponent && state.phase === 'placePersonal'
      && state.turn === mySeat;
    const opts = {
      rerollSelected: state.rerollSel[seat] && state.rerollSel[seat].includes(id),
      selected: selectedDieId === id,
      clickable: canReroll || canPlace,
    };
    if (canReroll) opts.onClick = () => dispatch({ type: 'toggleRerollDie', dieId: id });
    else if (canPlace) opts.onClick = () => { selectDie(id); };
    tray.appendChild(dieEl(die, opts));
  }
  panel.appendChild(tray);
  return panel;
}

function readyMark(state, seat) {
  if (state.phase === 'personalRoll' && state.readyPersonal[seat]) return '<span class="ready-mark">готов ✓</span>';
  if (state.phase === 'commonRoll' && state.readyCommon[seat]) return '<span class="ready-mark">готов ✓</span>';
  return '';
}

function boardEl(state) {
  const wrap = document.createElement('div');
  wrap.className = 'board';

  // карта клетка -> владелец комбинации (для подсветки)
  const cellOwner = new Array(CELLS).fill(undefined);
  const cellCombo = new Array(CELLS).fill(false);
  for (const combo of state.combos || []) {
    for (const c of combo.cells) {
      cellCombo[c] = true;
      if (combo.owner !== null) cellOwner[c] = combo.owner;
    }
  }

  for (let cell = 0; cell < CELLS; cell++) {
    const dieId = state.board[cell];
    const cellEl = document.createElement('div');
    cellEl.className = 'cell';
    if (cellCombo[cell]) {
      cellEl.classList.add('in-combo');
      if (cellOwner[cell] === mySeat) cellEl.classList.add('combo-own');
      else if (cellOwner[cell] === other(mySeat)) cellEl.classList.add('combo-opp');
    }

    if (dieId === null) {
      const canPlace = (state.phase === 'placeCommon' || state.phase === 'placePersonal')
        && state.turn === mySeat && selectedDieId !== null;
      if (canPlace) {
        cellEl.classList.add('placeable');
        cellEl.addEventListener('click', () => {
          dispatch({ type: 'placeDie', dieId: selectedDieId, cell });
          selectedDieId = null;
        });
      }
    } else {
      const die = state.dice[dieId];
      cellEl.appendChild(dieEl(die));
    }
    wrap.appendChild(cellEl);
  }
  return wrap;
}

function commonPool(state) {
  const wrap = document.createElement('div');
  wrap.className = 'pool';
  const title = document.createElement('div');
  title.className = 'pool-title';
  title.textContent = 'Общие кости';
  wrap.appendChild(title);

  const row = document.createElement('div');
  row.className = 'pool-row';
  for (const id of state.common) {
    const die = state.dice[id];
    if (die.cell !== null) continue;
    let opts = { selected: selectedDieId === id };
    if (state.phase === 'commonRoll' && state.commonTurn === mySeat
        && !state.rerollUsedCommon[mySeat] && !state.readyCommon[mySeat]) {
      opts.rerollSelected = state.rerollSel[mySeat].includes(id);
      opts.clickable = true;
      opts.onClick = () => dispatch({ type: 'toggleRerollDie', dieId: id });
    } else if (state.phase === 'placeCommon' && state.turn === mySeat) {
      opts.clickable = true;
      opts.onClick = () => selectDie(id);
    }
    row.appendChild(dieEl(die, opts));
  }
  wrap.appendChild(row);
  return wrap;
}

function selectDie(id) {
  selectedDieId = (selectedDieId === id) ? null : id;
  if (lastState) render(lastState);
}

function controls(state) {
  const bar = document.createElement('div');
  bar.className = 'controls';
  const btn = (label, action, cls = '') => {
    const b = document.createElement('button');
    b.textContent = label;
    b.className = 'btn ' + cls;
    b.addEventListener('click', () => dispatch(action));
    return b;
  };

  if (state.phase === 'personalRoll') {
    if (!state.readyPersonal[mySeat]) {
      if (!state.rerollUsedPersonal[mySeat]) {
        const n = state.rerollSel[mySeat].length;
        const r = btn(`Перебросить выбранные${n ? ` (${n})` : ''}`, { type: 'reroll' }, 'secondary');
        if (n === 0) r.disabled = true;
        bar.appendChild(r);
      }
      bar.appendChild(btn('Готов', { type: 'ready' }, 'primary'));
    } else {
      bar.appendChild(waiting('Ждём соперника…'));
    }
  } else if (state.phase === 'commonRoll') {
    if (state.commonTurn === mySeat && !state.readyCommon[mySeat]) {
      if (!state.rerollUsedCommon[mySeat]) {
        const n = state.rerollSel[mySeat].length;
        const r = btn(`Перебросить выбранные${n ? ` (${n})` : ''}`, { type: 'reroll' }, 'secondary');
        if (n === 0) r.disabled = true;
        bar.appendChild(r);
      }
      bar.appendChild(btn('Готов', { type: 'ready' }, 'primary'));
    } else {
      bar.appendChild(waiting(state.commonTurn === mySeat ? '…' : 'Ход соперника…'));
    }
  } else if (state.phase === 'scoring') {
    bar.appendChild(scoreSummary(state));
    if (state.round < state.totalRounds) bar.appendChild(btn('Следующий раунд →', { type: 'nextRound' }, 'primary'));
    else bar.appendChild(btn('Показать итог →', { type: 'nextRound' }, 'primary'));
  } else if (state.phase === 'gameover') {
    bar.appendChild(gameOver(state));
    bar.appendChild(btn('Новая игра', { type: 'newGame' }, 'primary'));
  }
  return bar;
}

function waiting(text) {
  const s = document.createElement('span');
  s.className = 'waiting';
  s.textContent = text;
  return s;
}

function scoreSummary(state) {
  const rs = state.roundScores[state.roundScores.length - 1] || { 0: 0, 1: 0 };
  const d = document.createElement('div');
  d.className = 'score-summary';
  d.innerHTML = `За раунд: Вы <b class="mine">+${rs[mySeat]}</b>, Соперник <b class="opp">+${rs[other(mySeat)]}</b>`;
  return d;
}

function gameOver(state) {
  const my = state.totalScores[mySeat];
  const op = state.totalScores[other(mySeat)];
  const d = document.createElement('div');
  d.className = 'game-over';
  let verdict = my > op ? '🏆 Вы победили!' : (my < op ? 'Вы проиграли' : 'Ничья');
  d.innerHTML = `<div class="verdict">${verdict}</div><div>Итог: <b class="mine">${my}</b> : <b class="opp">${op}</b></div>`;
  return d;
}

function instructions(state) {
  const d = document.createElement('div');
  d.className = 'instructions';
  const myTurn = state.turn === mySeat;
  const map = {
    personalRoll: 'Бросьте личные кости. Можно выбрать любые и перебросить один раз, затем «Готов». Соперник ходит одновременно.',
    commonRoll: state.commonTurn === mySeat
      ? 'Ваш переброс общих: выберите до 7 костей и перебросьте один раз, либо «Готов».'
      : 'Соперник перебрасывает общие кости…',
    placeCommon: myTurn
      ? 'Ваш ход: выберите общую кость и поставьте её в пустую клетку.'
      : 'Соперник ставит общую кость…',
    placePersonal: myTurn
      ? 'Ваш ход: выберите свою личную кость и поставьте её. 3+ одного цвета подряд в ряду/столбце = ваша комбинация (синяя).'
      : 'Соперник ставит личную кость…',
    scoring: 'Комбинации подсвечены: синие — ваши, красные — соперника. 3 = 1 очко, 4 = 2, 5 = 4.',
    gameover: '',
  };
  d.textContent = map[state.phase] || '';
  return d;
}

// баннер «первый игрок» показываем поверх
export function showFirstPlayerBanner(state) {
  const first = state.firstPlayer === mySeat ? 'Вы' : 'Соперник';
  toast(`Первый игрок: ${first}`);
}

let toastTimer = null;
export function toast(text, ms = 2600) {
  let t = document.getElementById('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}
