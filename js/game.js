// Чистая логика игры: состояние, применение действий, подсчёт очков.
// Никакого DOM и сети. Хост запускает это авторитетно, гость только рисует.

import {
  COLORS, PERSONAL_FACES, COMMON_FACES, BOARD_SIZE, CELLS,
  PERSONAL_PER_PLAYER, COMMON_COUNT, COMMON_REROLL_MAX,
  TOTAL_ROUNDS, POINTS_BY_LENGTH,
} from './constants.js?v=6';

const other = (seat) => (seat === 0 ? 1 : 0);

function randOf(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ---------- Создание / сброс ----------

export function createGame() {
  const state = {
    phase: 'personalRoll',
    round: 1,
    totalRounds: TOTAL_ROUNDS,
    firstPlayer: Math.random() < 0.5 ? 0 : 1, // первый игрок 1-го раунда — случайно
    roundJustStarted: true,

    board: new Array(CELLS).fill(null), // dieId | null
    dice: {},                           // id -> die
    personal: { 0: [], 1: [] },         // id[]
    common: [],                         // id[]

    // фаза личных костей
    rerollUsedPersonal: { 0: false, 1: false },
    rerollSel: { 0: [], 1: [] },
    readyPersonal: { 0: false, 1: false },

    // фаза общих костей
    commonTurn: 0,                      // чей ход перебрасывать общие
    rerollUsedCommon: { 0: false, 1: false },
    readyCommon: { 0: false, 1: false },

    // расстановка
    turn: 0,
    placeSeq: 0,
    placedOrder: {},                    // dieId -> порядковый номер (только личные)

    // очки
    roundScores: [],                    // [{0,1}, ...]
    totalScores: { 0: 0, 1: 0 },
    combos: [],                         // результат последнего подсчёта (для подсветки)

    banner: '',                         // короткое сообщение для UI
  };
  setupRound(state);
  return state;
}

let dieCounter = 0;
function newDie(kind, seat, face) {
  return { id: `d${dieCounter++}`, kind, seat, face, cell: null };
}

function setupRound(state) {
  dieCounter = 0;
  state.board = new Array(CELLS).fill(null);
  state.dice = {};
  state.personal = { 0: [], 1: [] };
  state.common = [];
  state.rerollUsedPersonal = { 0: false, 1: false };
  state.rerollSel = { 0: [], 1: [] };
  state.readyPersonal = { 0: false, 1: false };
  state.rerollUsedCommon = { 0: false, 1: false };
  state.readyCommon = { 0: false, 1: false };
  state.placeSeq = 0;
  state.placedOrder = {};
  state.combos = [];
  state.phase = 'personalRoll';
  state.roundJustStarted = true;

  // Личные кости обоих игроков: сразу кидаем.
  for (const seat of [0, 1]) {
    for (let i = 0; i < PERSONAL_PER_PLAYER; i++) {
      const die = newDie('personal', seat, randOf(PERSONAL_FACES));
      state.dice[die.id] = die;
      state.personal[seat].push(die.id);
    }
  }
  // Общие кости создаём, но кинем их при переходе к commonRoll.
  for (let i = 0; i < COMMON_COUNT; i++) {
    const die = newDie('common', null, 'white');
    state.dice[die.id] = die;
    state.common.push(die.id);
  }
}

// ---------- Применение действий ----------
// apply(state, action, seat) -> мутирует state. Возвращает { ok, error }.

export function apply(state, action, seat) {
  const h = handlers[action.type];
  if (!h) return { ok: false, error: 'unknown action' };
  return h(state, action, seat) || { ok: true };
}

const handlers = {
  toggleRerollDie(state, { dieId }, seat) {
    const die = state.dice[dieId];
    if (!die) return err('нет кости');
    if (state.phase === 'personalRoll') {
      if (state.readyPersonal[seat] || state.rerollUsedPersonal[seat]) return err('переброс недоступен');
      if (die.kind !== 'personal' || die.seat !== seat) return err('не ваша кость');
      toggle(state.rerollSel[seat], dieId);
    } else if (state.phase === 'commonRoll') {
      if (state.commonTurn !== seat) return err('не ваш ход');
      if (state.rerollUsedCommon[seat] || state.readyCommon[seat]) return err('переброс недоступен');
      if (die.kind !== 'common') return err('не общая кость');
      const sel = state.rerollSel[seat];
      if (sel.includes(dieId)) toggle(sel, dieId);
      else if (sel.length < COMMON_REROLL_MAX) sel.push(dieId);
      else return err(`максимум ${COMMON_REROLL_MAX} костей`);
    } else return err('не та фаза');
  },

  reroll(state, _a, seat) {
    if (state.phase === 'personalRoll') {
      if (state.rerollUsedPersonal[seat] || state.readyPersonal[seat]) return err('нельзя');
      for (const id of state.rerollSel[seat]) state.dice[id].face = randOf(PERSONAL_FACES);
      state.rerollUsedPersonal[seat] = true;
      state.rerollSel[seat] = [];
    } else if (state.phase === 'commonRoll') {
      if (state.commonTurn !== seat) return err('не ваш ход');
      if (state.rerollUsedCommon[seat] || state.readyCommon[seat]) return err('нельзя');
      for (const id of state.rerollSel[seat]) state.dice[id].face = randOf(COMMON_FACES);
      state.rerollUsedCommon[seat] = true;
      state.rerollSel[seat] = [];
    } else return err('не та фаза');
  },

  ready(state, _a, seat) {
    if (state.phase === 'personalRoll') {
      state.readyPersonal[seat] = true;
      state.rerollSel[seat] = [];
      if (state.readyPersonal[0] && state.readyPersonal[1]) startCommonRoll(state);
    } else if (state.phase === 'commonRoll') {
      if (state.commonTurn !== seat) return err('не ваш ход');
      state.readyCommon[seat] = true;
      state.rerollSel[seat] = [];
      if (!state.readyCommon[other(seat)]) {
        // передаём переброс второму игроку
        state.commonTurn = other(seat);
      } else {
        startPlaceCommon(state);
      }
    } else return err('не та фаза');
  },

  placeDie(state, { dieId, cell }, seat) {
    if (state.phase !== 'placeCommon' && state.phase !== 'placePersonal') return err('не та фаза');
    if (state.turn !== seat) return err('не ваш ход');
    if (cell < 0 || cell >= CELLS || state.board[cell] !== null) return err('клетка занята');
    const die = state.dice[dieId];
    if (!die || die.cell !== null) return err('нет кости');

    if (state.phase === 'placeCommon') {
      if (die.kind !== 'common') return err('нужна общая кость');
    } else {
      if (die.kind !== 'personal' || die.seat !== seat) return err('нужна ваша личная кость');
      state.placedOrder[dieId] = ++state.placeSeq;
    }

    die.cell = cell;
    state.board[cell] = dieId;

    if (state.phase === 'placePersonal') state.combos = computeCombos(state);

    if (allPlaced(state, state.phase === 'placeCommon' ? 'common' : 'personal')) {
      if (state.phase === 'placeCommon') startPlacePersonal(state);
      else doScoring(state);
    } else {
      state.turn = other(seat);
    }
  },

  nextRound(state) {
    if (state.phase !== 'scoring') return err('не та фаза');
    if (state.round >= state.totalRounds) {
      state.phase = 'gameover';
      return;
    }
    state.round += 1;
    state.firstPlayer = other(state.firstPlayer); // меняются местами
    setupRound(state);
  },

  newGame(state) {
    if (state.phase !== 'gameover') return err('не та фаза');
    const fresh = createGame();
    Object.assign(state, fresh);
  },
};

function err(msg) { return { ok: false, error: msg }; }
function toggle(arr, v) {
  const i = arr.indexOf(v);
  if (i >= 0) arr.splice(i, 1); else arr.push(v);
}

// ---------- Переходы фаз ----------

function startCommonRoll(state) {
  for (const id of state.common) state.dice[id].face = randOf(COMMON_FACES);
  state.phase = 'commonRoll';
  state.commonTurn = state.firstPlayer;
  state.banner = 'firstPlayer'; // UI покажет, кто первый
}

function startPlaceCommon(state) {
  state.phase = 'placeCommon';
  // Второй игрок ходит первым (первый уже перебрасывал общие первым).
  state.turn = other(state.firstPlayer);
}

function startPlacePersonal(state) {
  state.phase = 'placePersonal';
  state.turn = state.firstPlayer; // личные — первый игрок начинает
  state.combos = computeCombos(state);
}

function doScoring(state) {
  state.combos = computeCombos(state);
  const rs = { 0: 0, 1: 0 };
  for (const c of state.combos) {
    if (c.owner === null) continue;
    rs[c.owner] += POINTS_BY_LENGTH[Math.min(c.length, 5)] || 0;
  }
  state.roundScores.push(rs);
  state.totalScores[0] += rs[0];
  state.totalScores[1] += rs[1];
  state.phase = 'scoring';
}

function allPlaced(state, kind) {
  const ids = kind === 'common'
    ? state.common
    : [...state.personal[0], ...state.personal[1]];
  return ids.every((id) => state.dice[id].cell !== null);
}

// ---------- Подсчёт комбинаций ----------
// Комбинация = смежный отрезок из 3+ клеток одного цвета (джокер — любой,
// белый/пусто разрывают). Владелец = игрок, чья ЛИЧНАЯ кость последней
// (по placedOrder) попала в отрезок, с учётом "захвата" через две комбинации.

function lineCells(idx, isRow) {
  const cells = [];
  for (let k = 0; k < BOARD_SIZE; k++) {
    cells.push(isRow ? idx * BOARD_SIZE + k : k * BOARD_SIZE + idx);
  }
  return cells;
}

function faceInfo(state, cell) {
  const dieId = state.board[cell];
  if (dieId === null) return { empty: true };
  const die = state.dice[dieId];
  return {
    empty: false,
    dieId,
    kind: die.kind,
    seat: die.seat,
    white: die.face === 'white',
    joker: die.face === 'joker',
    color: die.face,
  };
}

function findRunsInLine(state, cells) {
  const runs = [];
  let i = 0;
  while (i < cells.length) {
    const info = faceInfo(state, cells[i]);
    if (info.empty || info.white) { i++; continue; }
    // старт отрезка
    let color = info.joker ? null : info.color;
    let j = i;
    while (j < cells.length) {
      const f = faceInfo(state, cells[j]);
      if (f.empty || f.white) break;
      if (f.joker) { j++; continue; }
      if (color === null) { color = f.color; j++; continue; }
      if (f.color === color) { j++; continue; }
      break;
    }
    const len = j - i;
    if (len >= 3) {
      const runCells = cells.slice(i, j);
      const personalDice = runCells
        .map((c) => state.board[c])
        .filter((id) => id !== null && state.dice[id].kind === 'personal');
      runs.push({ cells: runCells, color, length: len, personalDice });
    }
    i = j > i ? j : i + 1;
  }
  return runs;
}

export function computeCombos(state) {
  const runs = [];
  for (let r = 0; r < BOARD_SIZE; r++) runs.push(...findRunsInLine(state, lineCells(r, true)));
  for (let c = 0; c < BOARD_SIZE; c++) runs.push(...findRunsInLine(state, lineCells(c, false)));

  const seatOf = (id) => state.dice[id].seat;
  const orderOf = (id) => state.placedOrder[id] ?? -1;

  // Фиксированная точка: владелец отрезка = владелец последней АКТИВНОЙ личной
  // кости в нём; кость "захвачена" (неактивна), если входит в отрезок,
  // принадлежащий сопернику её владельца.
  const active = {};
  for (const run of runs) for (const id of run.personalDice) active[id] = true;

  for (let iter = 0; iter < 40; iter++) {
    // владельцы отрезков
    for (const run of runs) {
      let best = null;
      for (const id of run.personalDice) {
        if (!active[id]) continue;
        if (best === null || orderOf(id) > orderOf(best)) best = id;
      }
      run.owner = best === null ? null : seatOf(best);
    }
    // захваты
    let changed = false;
    for (const id in active) {
      const mySeat = seatOf(id);
      let captured = false;
      for (const run of runs) {
        if (run.owner !== null && run.owner !== mySeat && run.personalDice.includes(id)) {
          captured = true; break;
        }
      }
      const nowActive = !captured;
      if (nowActive !== active[id]) { active[id] = nowActive; changed = true; }
    }
    if (!changed) break;
  }
  return runs;
}

// ---------- Вид для конкретного места (скрываем чужие невыложенные личные) ----------

export function viewFor(state, seat) {
  const opp = other(seat);
  const v = JSON.parse(JSON.stringify(state));
  for (const id of v.personal[opp]) {
    const die = v.dice[id];
    if (die.cell === null) die.face = 'hidden';
  }
  // не раскрываем выбор переброса соперника
  v.rerollSel[opp] = [];
  return v;
}

export { other };
