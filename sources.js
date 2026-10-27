/**
 * Dota 2 data-source definitions. A source selects the win-rate sample used for
 * hero strength and display; the hero-vs-hero matrix remains the public matchup
 * sample published by OpenDota for the selected patch window.
 */
export const DATA_SOURCES = [
  {
    id: "high",
    label: "高分段",
    detail: "Ancient + Divine（6 + 7 段）",
    short: "高分段",
  },
  {
    id: "all",
    label: "全分段",
    detail: "全部公开天梯对局",
    short: "全分段",
  },
  {
    id: "mid",
    label: "中分段",
    detail: "Archon + Legend（4 + 5 段）",
    short: "中分段",
  },
  {
    id: "low",
    label: "低分段",
    detail: "Herald + Guardian + Crusader（1–3 段）",
    short: "低分段",
  },
  { id: "b1", label: "先锋", detail: "Herald · 1 段", short: "先锋" },
  { id: "b2", label: "卫士", detail: "Guardian · 2 段", short: "卫士" },
  { id: "b3", label: "十字军", detail: "Crusader · 3 段", short: "十字军" },
  { id: "b4", label: "执政官", detail: "Archon · 4 段", short: "执政官" },
  { id: "b5", label: "一代传奇", detail: "Legend · 5 段", short: "传奇" },
  { id: "b6", label: "一代远古", detail: "Ancient · 6 段", short: "远古" },
  { id: "b7", label: "一代神圣", detail: "Divine · 7 段", short: "神圣" },
  {
    id: "pro",
    label: "职业比赛",
    detail: "OpenDota 职业对局样本",
    short: "职业比赛",
  },
];

const SOURCE_ALIASES = new Map([
  ["full", "all"],
  ["pub", "all"],
  ["public", "all"],
  ["ranked", "all"],
  ["all", "all"],
  ["high", "high"],
  ["immortal", "high"],
  ["divine", "high"],
  ["mid", "mid"],
  ["low", "low"],
  ["pro", "pro"],
  ["professional", "pro"],
  ["比赛", "pro"],
  ["职业", "pro"],
  ["职业比赛", "pro"],
  ["全分段", "all"],
  ["高分段", "high"],
  ["中分段", "mid"],
  ["低分段", "low"],
  ["先锋", "b1"],
  ["卫士", "b2"],
  ["十字军", "b3"],
  ["执政官", "b4"],
  ["传奇", "b5"],
  ["远古", "b6"],
  ["神圣", "b7"],
]);

export function normalizeSource(value) {
  if (!value) return "high";
  const raw = String(value).trim();
  const direct = DATA_SOURCES.find((source) => source.id === raw);
  if (direct) return direct.id;
  const normalized = raw.toLowerCase().replace(/^bracket[-_]?/, "b");
  if (/^[1-7]$/.test(normalized)) return `b${normalized}`;
  return SOURCE_ALIASES.get(normalized) || SOURCE_ALIASES.get(raw) || "high";
}

export function sourceInfo(value) {
  const id = normalizeSource(value);
  return DATA_SOURCES.find((source) => source.id === id) || DATA_SOURCES[0];
}

function ensureSample(sample) {
  if (!sample) return { games: 0, wins: 0 };
  return {
    games: Math.max(0, Number(sample.games) || 0),
    wins: Math.max(0, Number(sample.wins) || 0),
  };
}

function sumSamples(samples) {
  return samples.reduce(
    (total, sample) => ({
      games: total.games + Math.max(0, Number(sample?.games) || 0),
      wins: total.wins + Math.max(0, Number(sample?.wins) || 0),
    }),
    { games: 0, wins: 0 },
  );
}

/** Raw source sample for one hero. */
export function sourceSample(hero, sourceId) {
  const id = normalizeSource(sourceId);
  if (id === "all") {
    if (hero.all) return ensureSample(hero.all);
    return {
      games: Number(hero.pubPick || 0) || 0,
      wins: Math.round(
        (Number(hero.winrateAll) || 0) * (Number(hero.pubPick) || 0),
      ),
    };
  }
  if (id === "low") {
    if (hero.low) return ensureSample(hero.low);
    return sumSamples([1, 2, 3].map((bracket) => hero.brackets?.[bracket]));
  }
  if (id === "mid") {
    if (hero.mid) return ensureSample(hero.mid);
    return sumSamples([4, 5].map((bracket) => hero.brackets?.[bracket]));
  }
  if (id === "high") {
    if (hero.high) return ensureSample(hero.high);
    return sumSamples([6, 7].map((bracket) => hero.brackets?.[bracket]));
  }
  if (id === "pro") {
    if (hero.pro) return ensureSample(hero.pro);
    return {
      games: Number(hero.proPick) || 0,
      wins: Math.round(
        (Number(hero.proWinrate) || 0) * (Number(hero.proPick) || 0),
      ),
    };
  }
  const bracket = Number(id.replace(/^b/, ""));
  if (hero.brackets?.[bracket]) return ensureSample(hero.brackets[bracket]);
  return { games: 0, wins: 0 };
}

export function sourceWinrate(hero, sourceId) {
  const sample = sourceSample(hero, sourceId);
  return {
    ...sample,
    winrate: sample.games > 0 ? sample.wins / sample.games : null,
    source: normalizeSource(sourceId),
    label: sourceInfo(sourceId).label,
  };
}
