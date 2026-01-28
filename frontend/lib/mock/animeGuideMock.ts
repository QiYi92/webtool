export type AnimeUpdateItem = {
  id: string;
  title: string;
  chineseTitle?: string;
  originalTitle?: string;
  coverUrl: string;
  weekday: 1 | 2 | 3 | 4 | 5 | 6 | 0;
  date: string;
  updateTime?: string;
  episode?: string;
  detailId?: string;
};

export type AnimeDetail = {
  id: string;
  title: string;
  coverUrl: string;
  chineseTitle: string;
  totalEpisodes: number;
  startDate: string;
  weekdayText: string;
  episodes: number[];
  synopsis: string;
  rating: number;
  formatTag?: string;
};

const WEEKDAY_LABELS: Record<AnimeUpdateItem["weekday"], string> = {
  1: "周一",
  2: "周二",
  3: "周三",
  4: "周四",
  5: "周五",
  6: "周六",
  0: "周日"
};

const TIME_SLOTS = ["07:30", "10:00", "12:15", "18:30", "20:00", "22:30", "23:45"];

const formatDate = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const addDays = (date: Date, days: number) => {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
};

const getNextWeekdayDate = (base: Date, weekday: AnimeUpdateItem["weekday"]) => {
  const baseWeekday = base.getDay();
  const delta = (weekday - baseWeekday + 7) % 7;
  return addDays(base, delta);
};

const DETAIL_IDS = [
  "isekai-safun-shachiku",
  "midnight-orchestra",
  "tokyo-mosaic",
  "planet-rain",
  "blue-atelier"
];

const generateMockData = () => {
  const today = new Date();
  const weekdays: AnimeUpdateItem["weekday"][] = [1, 2, 3, 4, 5, 6, 0];
  const items: AnimeUpdateItem[] = [];

  weekdays.forEach((weekday, weekdayIndex) => {
    const startDate = getNextWeekdayDate(today, weekday);
    const total = 60;
    for (let i = 0; i < total; i += 1) {
      const weekOffset = i % 8;
      const date = addDays(startDate, weekOffset * 7);
      const label = WEEKDAY_LABELS[weekday];
      const sequence = String(i + 1).padStart(2, "0");
      const title = `${label}档 · 番剧 ${sequence}`;
      const chineseTitle = title;
      const originalTitle = title;
      const detailId = DETAIL_IDS[(i + weekdayIndex) % DETAIL_IDS.length];

      items.push({
        id: `${detailId}-${weekday}-${i + 1}`,
        title,
        chineseTitle,
        originalTitle,
        coverUrl: `https://placehold.co/360x480?text=${encodeURIComponent(title)}`,
        weekday,
        date: formatDate(date),
        updateTime: TIME_SLOTS[(i + weekdayIndex) % TIME_SLOTS.length],
        episode: `第${(i % 12) + 1}集`,
        detailId
      });
    }
  });

  return items;
};

export const animeGuideMockData: AnimeUpdateItem[] = generateMockData();

export const animeDetailMockData: AnimeDetail[] = [
  {
    id: "isekai-safun-shachiku",
    title: "異世界の沙汰は社畜次第",
    coverUrl: "https://placehold.co/520x720?text=%E7%95%B0%E4%B8%96%E7%95%8C%E3%81%AE%E6%B2%99%E6%B1%9F%E3%81%AF%E7%A4%BE%E7%95%9C%E6%AC%A1%E7%AC%AC",
    chineseTitle: "异世界的沙汰全看社畜",
    totalEpisodes: 12,
    startDate: "2026年1月6日",
    weekdayText: "星期二",
    episodes: Array.from({ length: 12 }, (_, index) => index + 1),
    synopsis:
      "三十路目前的上班族近藤诚一郎，在某天被圣女召唤意外卷入异世界。\n\n习惯了高压工作的他，把异世界的任务也当成KPI来管理，为了能按时下班持续推进王宫财务改革。\n\n当药草副作用威胁生命时，他不得不向被称为『冰之贵公子』的骑士团长求助。",
    rating: 4.2,
    formatTag: "TV"
  },
  {
    id: "midnight-orchestra",
    title: "ミッドナイト・オーケストラ",
    coverUrl: "https://placehold.co/520x720?text=Midnight%20Orchestra",
    chineseTitle: "午夜交响曲",
    totalEpisodes: 24,
    startDate: "2026年1月10日",
    weekdayText: "星期六",
    episodes: Array.from({ length: 24 }, (_, index) => index + 1),
    synopsis:
      "午夜零点的旧音乐厅会响起不存在的旋律。\n\n女主角在一次加班路上误入其间，发现那是一群被遗忘的音乐家留下的记忆。\n\n为了找回自己的听觉天赋，她与守夜人展开了为期一年的演奏之旅。",
    rating: 3.8,
    formatTag: "TV"
  },
  {
    id: "tokyo-mosaic",
    title: "東京モザイク",
    coverUrl: "https://placehold.co/520x720?text=Tokyo%20Mosaic",
    chineseTitle: "东京马赛克",
    totalEpisodes: 10,
    startDate: "2026年1月8日",
    weekdayText: "星期四",
    episodes: Array.from({ length: 10 }, (_, index) => index + 1),
    synopsis:
      "摄影记者遥香在东京的街头记录匿名访谈，拼贴出十个不同的人生切面。\n\n当一张意外的旧照片出现时，她开始追溯父亲失踪的真相。\n\n每一集都是一块城市的马赛克，也是一段自我和解。",
    rating: 4.6,
    formatTag: "TV"
  },
  {
    id: "planet-rain",
    title: "Planet Rain",
    coverUrl: "https://placehold.co/520x720?text=Planet%20Rain",
    chineseTitle: "星雨计划",
    totalEpisodes: 13,
    startDate: "2026年1月12日",
    weekdayText: "星期一",
    episodes: Array.from({ length: 13 }, (_, index) => index + 1),
    synopsis:
      "在气候被人工调控的未来，天空再也不会下雨。\n\n年轻气象师组队寻找失落的雨云生成装置，却发现人类早已遗忘天空真实的颜色。\n\n他们决定启动“星雨计划”，让世界重新下雨。",
    rating: 4.0,
    formatTag: "TV"
  },
  {
    id: "blue-atelier",
    title: "蒼のアトリエ",
    coverUrl: "https://placehold.co/520x720?text=Blue%20Atelier",
    chineseTitle: "苍之画室",
    totalEpisodes: 12,
    startDate: "2026年1月9日",
    weekdayText: "星期五",
    episodes: Array.from({ length: 12 }, (_, index) => index + 1),
    synopsis:
      "美术系大学生在一间废弃画室发现前辈留下的色谱笔记。\n\n随着她复刻那些颜色，她也一步步理解自己对创作的执念。\n\n画室里隐藏的秘密，让她重新选择未来的方向。",
    rating: 3.5,
    formatTag: "TV"
  }
];

export const getAnimeDetailById = (id: string) => {
  return animeDetailMockData.find((detail) => detail.id === id) ?? null;
};

export const weekdayLabels = WEEKDAY_LABELS;

export const formatDateString = formatDate;
