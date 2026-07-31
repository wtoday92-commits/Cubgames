// Общие константы игры.

// Цвета, которые участвуют в комбинациях.
export const COLORS = ['yellow', 'green', 'blue', 'red', 'purple'];

// Грани личных костей: 5 цветов + джокер (любой цвет).
export const PERSONAL_FACES = [...COLORS, 'joker'];

// Грани общих костей: 5 цветов + белый (никогда не в комбинации).
export const COMMON_FACES = [...COLORS, 'white'];

export const BOARD_SIZE = 5;
export const CELLS = BOARD_SIZE * BOARD_SIZE; // 25

export const PERSONAL_PER_PLAYER = 4;
export const COMMON_COUNT = 15;
export const COMMON_REROLL_MAX = 7; // до половины общих костей (floor(15/2))

export const TOTAL_ROUNDS = 3;

// Очки за комбинацию по длине.
export const POINTS_BY_LENGTH = { 3: 1, 4: 2, 5: 4 };

// Отображаемые названия / hex цветов граней.
export const FACE_HEX = {
  yellow: '#f4c430',
  green: '#3fbf5f',
  blue: '#3f7bff',
  red: '#e3453b',
  purple: '#9b59d0',
  white: '#f2f2f2',
  joker: '#2b2b34', // фон грани джокера (рисунок рисуем поверх)
  hidden: '#1c1c22',
};

export const FACE_LABEL_RU = {
  yellow: 'жёлтый',
  green: 'зелёный',
  blue: 'синий',
  red: 'красный',
  purple: 'фиолетовый',
  white: 'белый',
  joker: 'джокер',
};
