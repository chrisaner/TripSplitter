export const SUPPORTED_CURRENCIES = ['TWD', 'JPY', 'KRW', 'USD', 'EUR', 'CNY'];

export const DEFAULT_STATE = {
  poolBalances: {
    TWD: 0,
    JPY: 0,
    KRW: 0,
    USD: 0,
    EUR: 0,
    CNY: 0
  },
  members: [
    { id: 'm1', name: '小明', emoji: '😎' },
    { id: 'm2', name: '小美', emoji: '✨' }
  ],
  expenses: [],
  categories: {
    food: { icon: '🍱', label: '餐飲', subs: ['早餐', '午餐', '晚餐', '飲品', '宵夜'] },
    trans: { icon: '🚕', label: '交通', subs: ['捷運', '公車', '火車', 'Taxi', '機票', '租車', '加油', '停車'] },
    housing: { icon: '🏨', label: '住', subs: ['飯店', '民宿', '住宿稅', '清潔費', '寄物', '備品'] },
    play: { icon: '🎡', label: '景點', subs: ['門票', '按摩', '體驗'] },
    other: { icon: '🛒', label: '購物', subs: ['伴手禮', '衣服', '藥妝'] }
  },
  currentCat: 'food',
  currentSub: '午餐',
  editingId: null,
  selectedPayer: 'pool',
  selectedSplit: [],
  filterMemberId: 'all',
  filterDate: 'all',
  tempReceipt: null,
  tempEmoji: '👤',
  editingMemberId: null,
  ocr: {
    status: 'idle',
    jobId: null,
    draftId: null,
    result: null,
    error: null
  }
};

export const emojiList = ['😎', '✨', '🐱', '🦊', '🐼', '🐨', '🦁', '🐮', '🐸', '🐙'];

export function mergeState(remote) {
  const merged = {
    ...structuredClone(DEFAULT_STATE),
    ...remote,
    categories: DEFAULT_STATE.categories
  };

  merged.poolBalances = {
    ...DEFAULT_STATE.poolBalances,
    ...(remote?.poolBalances || {})
  };

  if (
    typeof remote?.pool === 'number' &&
    (!remote?.poolBalances || Object.keys(remote.poolBalances).length === 0)
  ) {
    merged.poolBalances.TWD = remote.pool;
  }

  return merged;
}

export function loadLocalState() {
  try {
    const raw = localStorage.getItem('tripSplitterLocalState');
    if (!raw) return structuredClone(DEFAULT_STATE);
    const parsed = JSON.parse(raw);
    return mergeState(parsed);
  } catch {
    return structuredClone(DEFAULT_STATE);
  }
}

export let state = loadLocalState();

export function setState(newState) {
  state = newState;
}

export function saveLocalState() {
  localStorage.setItem('tripSplitterLocalState', JSON.stringify(state));
}
