/**
 * Pure Dota 2 draft model. No Node or browser APIs live here.
 *
 * The daily pipeline turns OpenDota hero-vs-hero results into:
 *  1. a Bradley–Terry strength rating per hero (gradient descent), and
 *  2. a residual "counter" matrix after removing those strengths.
 *
 * Members are deliberately position-agnostic: lanes are flexible, so a player
 * is scored by their hero pool, the current team structure and the opposing
 * lineup rather than by a fixed 1–5 assignment. A source selector changes the
 * win-rate sample used for the strength prior and display.
 */
import { POSITIONS, ROLE_CN } from "./aliases.js";
import {
  DATA_SOURCES,
  normalizeSource,
  sourceInfo,
  sourceWinrate,
} from "./sources.js";

const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const sigmoid = (value) => 1 / (1 + Math.exp(-clamp(value, -20, 20)));
const logit = (value) =>
  Math.log(clamp(value, 0.001, 0.999) / (1 - clamp(value, 0.001, 0.999)));
const finite = (value, fallback = 0) =>
  Number.isFinite(Number(value)) ? Number(value) : fallback;

export const ROLE_LABELS = ROLE_CN;
export { DATA_SOURCES };

const POSITION_ROLE_WEIGHTS = {
  1: {
    Carry: 0.38,
    Escape: 0.06,
    Nuker: 0.02,
    Durable: -0.04,
    Support: -0.32,
    Disabler: -0.12,
    Initiator: -0.14,
    Pusher: -0.02,
  },
  2: {
    Nuker: 0.3,
    Escape: 0.14,
    Carry: 0.1,
    Support: -0.24,
    Durable: -0.08,
    Initiator: -0.04,
    Disabler: 0.02,
  },
  3: {
    Initiator: 0.27,
    Durable: 0.27,
    Disabler: 0.1,
    Support: 0.02,
    Carry: -0.12,
    Escape: -0.04,
    Nuker: 0.02,
  },
  4: {
    Support: 0.3,
    Disabler: 0.2,
    Escape: 0.1,
    Initiator: 0.08,
    Durable: 0.04,
    Carry: -0.28,
  },
  5: {
    Support: 0.4,
    Disabler: 0.16,
    Durable: 0.06,
    Escape: -0.05,
    Carry: -0.3,
    Initiator: 0.02,
  },
};

/** Kept for legacy tooling; draft recommendations no longer force a lane. */
export function positionFit(hero, position) {
  const weights = POSITION_ROLE_WEIGHTS[position];
  if (!weights) return 0.5;
  let score = 0.35;
  for (const role of hero.roles || []) score += weights[role] || 0;
  return clamp(score, 0.03, 0.98);
}

function shrunkWinrate(wins, games, prior = 0.5, sample = 200) {
  if (!games) return prior;
  return (wins + prior * sample) / (games + sample);
}

function heroSource(hero, source) {
  const direct = sourceWinrate(hero, source);
  const minimum = source === "pro" ? 1 : 20;
  if (direct.games >= minimum && direct.winrate !== null) return direct;
  const all = sourceWinrate(hero, "all");
  if (all.games >= 20) return all;
  return {
    ...direct,
    winrate: direct.winrate ?? all.winrate ?? 0.5,
    games: direct.games || all.games,
  };
}

function heroPrior(hero, source) {
  const sample = heroSource(hero, source);
  const games = sample.games;
  const winrate = finite(sample.winrate, 0.5);
  return shrunkWinrate(winrate * games, games, 0.5, 160);
}

/**
 * Fit hero strengths from all aggregated pair results.
 * A match is treated as a weighted Bernoulli observation of sigmoid(s_i - s_j).
 */
function trainStrengths(heroes, pairs, source) {
  const n = heroes.length;
  const strength = new Float64Array(n);
  for (let i = 0; i < n; i += 1) {
    const prior = heroPrior(heroes[i], source);
    strength[i] = clamp(logit(prior) * 0.55, -0.9, 0.9);
  }

  const totalGames =
    pairs.reduce((sum, pair) => sum + Math.min(pair.games, 6000), 0) || 1;
  const learningRate = 4.2;
  const l2 = 0.0025;
  const iterations = 850;

  if (pairs.length) {
    for (let step = 0; step < iterations; step += 1) {
      const gradient = new Float64Array(n);
      for (const pair of pairs) {
        const diff = clamp(strength[pair.lo] - strength[pair.hi], -10, 10);
        const predicted = sigmoid(diff);
        const weight = Math.min(pair.games, 6000);
        const error = predicted - pair.winrate;
        gradient[pair.lo] += error * weight;
        gradient[pair.hi] -= error * weight;
      }
      for (let i = 0; i < n; i += 1) {
        strength[i] -=
          learningRate * (gradient[i] / totalGames + l2 * strength[i]);
      }
    }
  }

  const mean = strength.reduce((sum, value) => sum + value, 0) / Math.max(1, n);
  for (let i = 0; i < n; i += 1) strength[i] -= mean;
  return strength;
}

function logLossFor(strengths, pairs) {
  let total = 0;
  let correct = 0;
  let loss = 0;
  for (const pair of pairs) {
    if (pair.games < 50) continue;
    const predicted = sigmoid(strengths[pair.lo] - strengths[pair.hi]);
    const actual = pair.winrate;
    loss +=
      pair.games *
      -(
        actual * Math.log(Math.max(predicted, 1e-9)) +
        (1 - actual) * Math.log(Math.max(1 - predicted, 1e-9))
      );
    total += pair.games;
    if (predicted >= 0.5 === actual >= 0.5) correct += pair.games;
  }
  return {
    logLoss: total ? loss / total : null,
    accuracy: total ? correct / total : null,
    pairSamples: total,
  };
}

function preparePairs(runtimeMap) {
  const pairs = new Map();
  for (const [key, row] of runtimeMap.directed) {
    const [left, right] = key.split(":").map(Number);
    if (left === right || row.games < 40) continue;
    const lo = Math.min(left, right);
    const hi = Math.max(left, right);
    const pairKey = `${lo}:${hi}`;
    const entry = pairs.get(pairKey) || { lo, hi, games: 0, winsLo: 0 };
    entry.games += row.games;
    entry.winsLo += left === lo ? row.wins : row.games - row.wins;
    pairs.set(pairKey, entry);
  }
  const list = [];
  for (const entry of pairs.values()) {
    if (entry.games < 80) continue;
    list.push({ ...entry, winrate: entry.winsLo / entry.games });
  }
  return list;
}

function computeCounterMap(heroes, strengths, directed) {
  const counter = new Map();
  for (const [key, row] of directed) {
    if (row.games < 20) continue;
    const [left, right] = key.split(":").map(Number);
    const priorWinrate = shrunkWinrate(row.wins, row.games, 0.5, 30);
    const residual = logit(priorWinrate) - (strengths[left] - strengths[right]);
    const confidence = row.games / (row.games + 240);
    counter.set(key, { value: residual * confidence, games: row.games });
  }
  return counter;
}

function buildDirected(dataset, byIndex) {
  const directed = new Map();
  for (const row of dataset.matchups || []) {
    if (!Array.isArray(row) || row.length < 4) continue;
    const left = byIndex.get(Number(row[0]));
    const right = byIndex.get(Number(row[1]));
    if (left === undefined || right === undefined || left === right) continue;
    const games = Math.max(0, finite(row[2]));
    if (!games) continue;
    const wins = clamp(finite(row[3]), 0, games);
    directed.set(`${left}:${right}`, { games, wins });
  }
  return directed;
}

/**
 * Build the runtime model. A saved model is reused only for the exact same
 * dataset snapshot and the same data source; otherwise strengths retrain.
 */
export function prepareRuntime(dataset, savedModel, sourceId = "high") {
  const source = normalizeSource(sourceId);
  const heroes = dataset.heroes || [];
  const byIndex = new Map(
    heroes.map((hero, index) => [Number(hero.id), index]),
  );
  const directed = buildDirected(dataset, byIndex);
  const pairs = preparePairs({ directed });

  const canReuse = Boolean(
    savedModel &&
      savedModel.schema >= 2 &&
      savedModel.source === source &&
      savedModel.datasetFetchedAt === dataset.fetchedAt &&
      savedModel.strengths &&
      Object.keys(savedModel.strengths).length === heroes.length,
  );

  let strengths;
  let model;
  if (canReuse) {
    strengths = new Float64Array(heroes.length);
    for (let i = 0; i < heroes.length; i += 1)
      strengths[i] = finite(savedModel.strengths[heroes[i].id]);
    const metrics = logLossFor(strengths, pairs);
    model = {
      ...savedModel,
      ...metrics,
      source,
      sourceLabel: sourceInfo(source).label,
      strengths: Object.fromEntries(
        heroes.map((hero, index) => [
          hero.id,
          Number(strengths[index].toFixed(6)),
        ]),
      ),
    };
  } else {
    strengths = trainStrengths(heroes, pairs, source);
    const metrics = logLossFor(strengths, pairs);
    model = {
      schema: 2,
      version: "bt-v2",
      source,
      sourceLabel: sourceInfo(source).label,
      trainedAt: new Date().toISOString(),
      datasetFetchedAt: dataset.fetchedAt,
      iterations: 850,
      heroes: heroes.length,
      pairs: pairs.length,
      matches: metrics.pairSamples,
      logLoss: metrics.logLoss,
      accuracy: metrics.accuracy,
      strengths: Object.fromEntries(
        heroes.map((hero, index) => [
          hero.id,
          Number(strengths[index].toFixed(6)),
        ]),
      ),
    };
  }

  const counter = computeCounterMap(heroes, strengths, directed);
  const byId = new Map(
    heroes.map((hero, index) => [Number(hero.id), { hero, index }]),
  );

  return {
    heroes,
    byId,
    byIndex,
    strengths,
    counter,
    directed,
    model,
    source,
    sourceInfo: sourceInfo(source),
    savedModelReused: canReuse,
  };
}

function attrLabel(attr) {
  return { str: "力量", agi: "敏捷", int: "智力", all: "全才" }[attr] || "";
}

function observedCounter(runtime, leftId, rightId) {
  const left = runtime.byId.get(Number(leftId));
  const right = runtime.byId.get(Number(rightId));
  if (!left || !right) return null;
  return runtime.directed.get(`${left.index}:${right.index}`) || null;
}

function counterSummary(runtime, heroId, enemyIds) {
  const hero = runtime.byId.get(Number(heroId));
  if (!hero) return { score: 0.5, details: [] };
  const details = [];
  for (const enemyId of enemyIds) {
    const row = observedCounter(runtime, heroId, enemyId);
    const enemy = runtime.byId.get(Number(enemyId));
    if (!row || !enemy) continue;
    const counter = runtime.counter.get(`${hero.index}:${enemy.index}`);
    details.push({
      heroId: enemy.hero.id,
      name: enemy.hero.name,
      winrate: row.wins / row.games,
      games: row.games,
      value: counter?.value ?? 0,
    });
  }
  if (!details.length) return { score: 0.5, details };
  const mean =
    details.reduce((sum, item) => sum + item.value, 0) / details.length;
  return {
    score: clamp(0.5 + mean * 1.5, 0.02, 0.98),
    details: details.sort((a, b) => b.value - a.value),
  };
}

function metaScore(hero, strength, source) {
  const sample = heroSource(hero, source);
  const winrate = finite(sample.winrate, 0.5);
  const shrunk = shrunkWinrate(winrate * sample.games, sample.games, 0.5, 180);
  const winrateScore = clamp(0.5 + (shrunk - 0.5) * 6);
  const strengthScore = clamp(0.5 + finite(strength) * 0.75);
  let formScore = 0.5;
  if (Number.isFinite(hero.recentWinrate) && Number.isFinite(hero.winrateAll)) {
    formScore = clamp(0.5 + (hero.recentWinrate - hero.winrateAll) * 5);
  }
  return {
    score: clamp(winrateScore * 0.55 + strengthScore * 0.33 + formScore * 0.12),
    winrate,
    games: sample.games,
    label: heroSource(hero, source).label,
    shrunk,
    formScore,
  };
}

function comfortScore(hero, member) {
  const pool = Array.isArray(member?.heroPoolIds) ? member.heroPoolIds : [];
  if (!pool.length) return { score: 0.6, inPool: false, poolSize: 0 };
  if (pool.includes(Number(hero.id)))
    return { score: 1, inPool: true, poolSize: pool.length };
  return { score: 0.42, inPool: false, poolSize: pool.length };
}

function roleProfile(hero) {
  const roles = new Set(hero?.roles || []);
  return {
    support: roles.has("Support"),
    carry: roles.has("Carry"),
    nuker: roles.has("Nuker"),
    durable: roles.has("Durable"),
    initiator: roles.has("Initiator"),
    disabler: roles.has("Disabler"),
  };
}

function countRole(runtime, picks, role) {
  let count = 0;
  for (const pick of picks) {
    const entry = runtime.byId.get(Number(pick.heroId));
    if (entry?.hero.roles?.includes(role)) count += 1;
  }
  return count;
}

function synergyScore(runtime, hero, ourPicks) {
  if (!ourPicks.length) return { score: 0.5, notes: [] };
  const notes = [];
  const profile = roleProfile(hero);
  let score = 0.5;
  const supportCount = countRole(runtime, ourPicks, "Support");
  const durableCount = countRole(runtime, ourPicks, "Durable");
  const initiatorCount = countRole(runtime, ourPicks, "Initiator");
  const disablerCount = countRole(runtime, ourPicks, "Disabler");
  const carryCount = countRole(runtime, ourPicks, "Carry");

  if (profile.support && supportCount < 2) {
    score += 0.12;
    notes.push("补辅助位");
  }
  if (profile.support && carryCount >= 3) {
    score += 0.08;
    notes.push("补足辅助与功能");
  }
  if (profile.durable && durableCount === 0) {
    score += 0.06;
    notes.push("补前排承伤");
  }
  if (profile.initiator && initiatorCount === 0) {
    score += 0.06;
    notes.push("补先手开团");
  }
  if (profile.disabler && disablerCount === 0) {
    score += 0.04;
    notes.push("补控制链");
  }
  return { score: clamp(score), notes: [...new Set(notes)].slice(0, 2) };
}

function reasonList(hero, member, parts) {
  const reasons = [];
  if (parts.comfort.inPool) reasons.push("在成员英雄池中");
  if (parts.synergy.notes.length) reasons.push(parts.synergy.notes[0]);
  const strongCounters = parts.counter.details
    .filter((item) => item.winrate >= 0.515 && item.games >= 20)
    .slice(0, 2);
  if (strongCounters.length) {
    reasons.push(
      `对位克制 ${strongCounters.map((item) => item.name).join("、")}`,
    );
  }
  const badCounters = parts.counter.details
    .filter((item) => item.winrate <= 0.48 && item.games >= 20)
    .slice(-1);
  if (badCounters.length) reasons.push(`需注意 ${badCounters[0].name} 的对位`);
  if (parts.meta.winrate >= 0.52 && parts.meta.games >= 200) {
    reasons.push(
      `${parts.meta.label}胜率 ${(parts.meta.winrate * 100).toFixed(1)}%`,
    );
  }
  if (
    hero.recentWinrate &&
    hero.winrateAll &&
    hero.recentWinrate - hero.winrateAll >= 0.012
  ) {
    reasons.push("近 7 天热度上升");
  }
  if (member && !parts.comfort.inPool && parts.comfort.poolSize) {
    reasons.push("英雄池外备选");
  }
  return [...new Set(reasons)].slice(0, 4);
}

function scoreCandidate(runtime, hero, member, ourPicks, enemyIds) {
  const comfort = comfortScore(hero, member);
  const entry = runtime.byId.get(Number(hero.id));
  const meta = metaScore(
    hero,
    runtime.strengths[entry?.index] || 0,
    runtime.source,
  );
  const counter = counterSummary(runtime, hero.id, enemyIds);
  const synergy = synergyScore(runtime, hero, ourPicks);

  let score =
    0.42 * comfort.score +
    0.27 * meta.score +
    0.19 * counter.score +
    0.12 * synergy.score;
  if (!enemyIds.length) {
    score = 0.45 * comfort.score + 0.39 * meta.score + 0.16 * synergy.score;
  }
  score = clamp(score);

  const dataConfidence =
    meta.games >= 5000 ? "高" : meta.games >= 1200 ? "中" : "低";
  const displayScore = clamp(Math.round(54 + (score - 0.5) * 120), 1, 99);
  return {
    heroId: hero.id,
    key: hero.key,
    name: hero.name,
    nameEn: hero.nameEn,
    img: hero.img,
    icon: hero.icon,
    roles: hero.roles,
    rolesCn: (hero.roles || []).map((role) => ROLE_CN[role] || role),
    attr: attrLabel(hero.primaryAttr),
    winrate: meta.winrate,
    winrateGames: meta.games,
    winrateSource: runtime.source,
    winrateSourceLabel: runtime.sourceInfo.label,
    recentWinrate: hero.recentWinrate,
    pickrate: hero.pickrate,
    position: member?.position ?? null,
    positionName: member?.fill
      ? "补位"
      : member?.position
        ? `成员 ${member.position}`
        : "补位",
    member: {
      id: member.id,
      name: member.name,
      position: member.position ?? null,
      fill: Boolean(member.fill),
    },
    score: Number(displayScore.toFixed(1)),
    confidence: dataConfidence,
    inPool: comfort.inPool,
    reasons: reasonList(hero, member, { comfort, counter, synergy, meta }),
    counters: counter.details.slice(0, 3).map((item) => ({
      name: item.name,
      winrate: Number(item.winrate.toFixed(4)),
      games: item.games,
    })),
    parts: {
      comfort: Number(comfort.score.toFixed(3)),
      meta: Number(meta.score.toFixed(3)),
      counter: Number(counter.score.toFixed(3)),
      synergy: Number(synergy.score.toFixed(3)),
    },
  };
}

function activeMembers(team) {
  return (team.members || []).filter((member) => member.active !== false);
}

function openMembers(team, ourPicks) {
  const assigned = new Set(
    ourPicks.map((pick) => pick.memberId).filter(Boolean),
  );
  return activeMembers(team).filter((member) => !assigned.has(member.id));
}

function fillMembers(team, ourPicks) {
  const active = activeMembers(team);
  const fillPicks = ourPicks.filter((pick) => !pick.memberId).length;
  const count = Math.max(0, 5 - active.length - fillPicks);
  return Array.from({ length: count }, (_, index) => ({
    id: `fill-${index + 1}`,
    name: `补位 ${index + 1}`,
    position: null,
    heroPoolIds: [],
    heroPool: [],
    active: true,
    fill: true,
  }));
}

function phaseInfo(ourPicks) {
  const count = ourPicks.length;
  const remaining = Math.max(0, 5 - count);
  let round = 1;
  let need = 2;
  if (count >= 4) {
    round = 3;
    need = 1;
  } else if (count >= 2) {
    round = 2;
    need = 2;
  }
  return {
    round,
    need: Math.min(need, remaining),
    remaining,
    complete: count >= 5,
  };
}

function isComplementaryPair(left, right) {
  const a = roleProfile(left);
  const b = roleProfile(right);
  return (
    (a.support && b.carry) ||
    (b.support && a.carry) ||
    (a.support && b.nuker) ||
    (b.support && a.nuker)
  );
}

function pairSquads(runtime, team, draft, enemyIds, members, need) {
  if (need < 2 || members.length < 2) return [];
  const pools = members.map((member) => {
    const candidates = [];
    for (const hero of runtime.heroes) {
      if (draft.our.some((pick) => Number(pick.heroId) === Number(hero.id)))
        continue;
      if (enemyIds.includes(Number(hero.id))) continue;
      candidates.push(
        scoreCandidate(runtime, hero, member, draft.our, enemyIds),
      );
    }
    return candidates.sort((a, b) => b.score - a.score).slice(0, 10);
  });

  const combos = [];
  for (let a = 0; a < members.length; a += 1) {
    for (let b = a + 1; b < members.length; b += 1) {
      for (const left of pools[a]) {
        for (const right of pools[b]) {
          if (left.heroId === right.heroId) continue;
          let score = (left.score + right.score) / 2;
          const leftEntry = runtime.byId.get(Number(left.heroId));
          const rightEntry = runtime.byId.get(Number(right.heroId));
          const complementary = isComplementaryPair(
            leftEntry?.hero,
            rightEntry?.hero,
          );
          if (complementary) score += 2.2;
          score += 0.8;
          const reasons = [
            ...left.reasons.slice(0, 2),
            ...right.reasons.slice(0, 2),
          ];
          if (complementary) reasons.push("核心 + 辅助组合");
          combos.push({
            score: Number(clamp(score, 1, 99).toFixed(1)),
            heroes: [left, right],
            reasons: [...new Set(reasons)].slice(0, 4),
          });
        }
      }
    }
  }
  combos.sort((a, b) => b.score - a.score);
  const used = new Set();
  const unique = [];
  for (const combo of combos) {
    const signature = combo.heroes
      .map((item) => item.heroId)
      .sort((x, y) => x - y)
      .join("-");
    if (used.has(signature)) continue;
    used.add(signature);
    unique.push(combo);
    if (unique.length >= 3) break;
  }
  return unique;
}

function coverage(runtime, picks) {
  const roles = new Set();
  for (const pick of picks) {
    const entry = runtime.byId.get(Number(pick.heroId));
    for (const role of entry?.hero.roles || []) roles.add(role);
  }
  let score = 0;
  if (roles.has("Support")) score += 0.28;
  if (roles.has("Carry")) score += 0.14;
  if (roles.has("Initiator")) score += 0.2;
  if (roles.has("Durable")) score += 0.2;
  if (roles.has("Disabler")) score += 0.1;
  if (roles.has("Nuker")) score += 0.08;
  return clamp(score);
}

export function predictDraft(runtime, team, draft) {
  const our = draft.our || [];
  const enemy = draft.enemy || [];
  if (our.length < 5 || enemy.length < 5) return null;
  let weighted = 0;
  let weightSum = 0;
  let pairRows = 0;
  let sampleGames = 0;
  const edges = [];
  for (const ours of our) {
    const left = runtime.byId.get(Number(ours.heroId));
    if (!left) continue;
    for (const theirs of enemy) {
      const right = runtime.byId.get(Number(theirs.heroId));
      if (!right) continue;
      const row = runtime.directed.get(`${left.index}:${right.index}`);
      let p;
      let weight;
      if (row && row.games >= 20) {
        p = shrunkWinrate(row.wins, row.games, 0.5, 40);
        weight = Math.max(0.4, Math.min(5, Math.sqrt(row.games) / 4));
        pairRows += 1;
        sampleGames += row.games;
      } else {
        p = sigmoid(
          (runtime.strengths[left.index] || 0) -
            (runtime.strengths[right.index] || 0),
        );
        weight = 0.2;
      }
      weighted += logit(p) * weight;
      weightSum += weight;
      if (row && row.games >= 50) {
        edges.push({
          our: left.hero.name,
          enemy: right.hero.name,
          winrate: Number((row.wins / row.games).toFixed(4)),
          games: row.games,
        });
      }
    }
  }
  if (!weightSum) return null;
  const base = weighted / weightSum;
  const ourCoverage = coverage(runtime, our);
  const enemyCoverage = coverage(runtime, enemy);
  const structureDelta = (ourCoverage - enemyCoverage) * 0.22;
  let comfortBonus = 0;
  let comfortCount = 0;
  for (const pick of our) {
    if (!pick.memberId) continue;
    const member = (team.members || []).find(
      (item) => item.id === pick.memberId,
    );
    if (!member) continue;
    comfortCount += 1;
    if ((member.heroPoolIds || []).includes(Number(pick.heroId)))
      comfortBonus += 0.035;
  }
  if (comfortCount) comfortBonus /= comfortCount;
  const probability = clamp(
    sigmoid(base + structureDelta + comfortBonus),
    0.05,
    0.95,
  );
  edges.sort((a, b) => b.winrate - a.winrate);
  const confidence =
    pairRows >= 15 && sampleGames >= 700
      ? "高"
      : pairRows >= 8 && sampleGames >= 250
        ? "中"
        : "低";
  return {
    probability: Number(probability.toFixed(4)),
    percent: Number((probability * 100).toFixed(1)),
    confidence,
    pairRows,
    sampleGames,
    ourCoverage: Number((ourCoverage * 100).toFixed(0)),
    enemyCoverage: Number((enemyCoverage * 100).toFixed(0)),
    advantages: edges.slice(0, 3),
    risks: edges.slice(-3).reverse(),
    label: "预测胜率",
    note: "基于双方 25 组英雄对位与阵容结构的估算，不是博彩赔率。",
  };
}

/**
 * Produce transparent pick suggestions for the current draft state.
 * Members with active !== false are considered in-game; the rest are skipped.
 */
export function recommendDraft(runtime, team, draft) {
  const ourPicks = draft.our || [];
  const enemyPicks = draft.enemy || [];
  const enemyIds = enemyPicks.map((pick) => Number(pick.heroId));
  const phase = phaseInfo(ourPicks);
  const active = activeMembers(team);
  const open = openMembers(team, ourPicks);
  const fill = fillMembers(team, ourPicks);
  const recommendationMembers = [...open, ...fill].slice(
    0,
    Math.max(phase.need, 1),
  );

  const rankedByMember = recommendationMembers.map((member) => {
    const candidates = [];
    for (const hero of runtime.heroes) {
      if (ourPicks.some((pick) => Number(pick.heroId) === Number(hero.id)))
        continue;
      if (enemyIds.includes(Number(hero.id))) continue;
      candidates.push(
        scoreCandidate(runtime, hero, member, ourPicks, enemyIds),
      );
    }
    return { member, candidates: candidates.sort((a, b) => b.score - a.score) };
  });

  const topPicks = [];
  const seen = new Set();
  for (const entry of rankedByMember) {
    for (const candidate of entry.candidates.slice(0, 3)) {
      if (seen.has(candidate.heroId)) continue;
      seen.add(candidate.heroId);
      topPicks.push(candidate);
      break;
    }
  }
  topPicks.sort((a, b) => b.score - a.score);

  const perMember = rankedByMember.map((entry) => ({
    member: {
      id: entry.member.id,
      name: entry.member.name,
      position: entry.member.position ?? null,
      fill: Boolean(entry.member.fill),
    },
    picks: entry.candidates.slice(0, 4),
  }));

  const squads = pairSquads(
    runtime,
    team,
    draft,
    enemyIds,
    recommendationMembers,
    phase.need,
  );
  const suggestedIds = new Set();
  for (const candidate of topPicks) suggestedIds.add(Number(candidate.heroId));
  for (const entry of perMember) {
    for (const candidate of entry.picks.slice(0, 3))
      suggestedIds.add(Number(candidate.heroId));
  }

  const avoid = [];
  if (enemyIds.length >= 2) {
    const all = [];
    for (const hero of runtime.heroes) {
      if (ourPicks.some((pick) => Number(pick.heroId) === Number(hero.id)))
        continue;
      if (enemyIds.includes(Number(hero.id))) continue;
      if (suggestedIds.has(Number(hero.id))) continue;
      const counter = counterSummary(runtime, hero.id, enemyIds);
      if (counter.score < 0.45) all.push({ hero, counter });
    }
    all.sort((a, b) => a.counter.score - b.counter.score);
    for (const item of all.slice(0, 4)) {
      const bad = item.counter.details
        .filter((detail) => detail.winrate < 0.49)
        .slice(0, 2);
      avoid.push({
        heroId: item.hero.id,
        name: item.hero.name,
        img: item.hero.icon,
        reason: bad.length
          ? `对位吃亏：${bad.map((detail) => detail.name).join("、")}`
          : "对敌方阵容对位偏弱",
      });
    }
  }

  const warnings = [];
  if (!active.length)
    warnings.push("还没有勾选本局参战成员，请至少勾选 1 人。");
  if (!team.members.some((member) => (member.heroPoolIds || []).length)) {
    warnings.push("尚未配置成员英雄池，当前推荐更偏向版本强势。");
  }
  if (active.length < 5) {
    warnings.push(
      `本局勾选 ${active.length} 名成员，其余 ${5 - active.length} 个位置由补位推荐覆盖。`,
    );
  }
  if (!enemyIds.length) warnings.push("尚未录入敌方英雄，克制权重暂未生效。");
  if (phase.complete) warnings.push("我方 5 人已选满，可开始下一局。");

  const prediction = predictDraft(runtime, team, draft);
  return {
    generatedAt: new Date().toISOString(),
    source: {
      id: runtime.source,
      label: runtime.sourceInfo.label,
      detail: runtime.sourceInfo.detail,
    },
    phase: {
      ...phase,
      activeMembers: active.map((member) => ({
        id: member.id,
        name: member.name,
        position: member.position ?? null,
      })),
      openMembers: open.map((member) => ({
        id: member.id,
        name: member.name,
        position: member.position ?? null,
      })),
      fillNeeded: fill.length,
      label: phase.complete
        ? "选人完成"
        : `第 ${phase.round} 轮 · 双方各选 ${phase.need} 个`,
    },
    topPicks: topPicks.slice(0, 5),
    squads,
    perMember,
    avoid,
    warnings,
    prediction,
  };
}

export function lookupHeroInfo(runtime, hero) {
  const entry = runtime.byId.get(Number(hero.id));
  if (!entry) return null;
  const counters = [];
  const weakAgainst = [];
  for (const other of runtime.heroes) {
    if (Number(other.id) === Number(hero.id)) continue;
    const row = runtime.directed.get(
      `${entry.index}:${runtime.byId.get(Number(other.id)).index}`,
    );
    if (!row || row.games < 20) continue;
    const counter = runtime.counter.get(
      `${entry.index}:${runtime.byId.get(Number(other.id)).index}`,
    );
    const item = {
      heroId: other.id,
      name: other.name,
      img: other.icon,
      winrate: Number((row.wins / row.games).toFixed(4)),
      games: row.games,
      value: counter?.value ?? 0,
    };
    counters.push(item);
    weakAgainst.push(item);
  }
  counters.sort((a, b) => b.value - a.value);
  weakAgainst.sort((a, b) => a.value - b.value);
  const source = heroSource(hero, runtime.source);
  return {
    hero: {
      id: hero.id,
      name: hero.name,
      nameEn: hero.nameEn,
      key: hero.key,
      img: hero.img,
      icon: hero.icon,
      roles: hero.roles,
      rolesCn: (hero.roles || []).map((role) => ROLE_CN[role] || role),
      attr: attrLabel(hero.primaryAttr),
      attackType:
        hero.attackType === "Melee"
          ? "近战"
          : hero.attackType === "Ranged"
            ? "远程"
            : hero.attackType,
      winrate: Number(finite(source.winrate, 0.5).toFixed(4)),
      winrateGames: source.games,
      winrateSource: runtime.source,
      winrateSourceLabel: runtime.sourceInfo.label,
      winrateHigh: hero.winrateHigh,
      winrateAll: hero.winrateAll,
      recentWinrate: hero.recentWinrate,
      pickrate: hero.pickrate,
      proWinrate: hero.proWinrate,
      proPick: hero.proPick,
      proBan: hero.proBan,
      strength: Number((runtime.strengths[entry.index] || 0).toFixed(4)),
    },
    source: runtime.sourceInfo,
    positionFit: [1, 2, 3, 4, 5].map((position) => ({
      position,
      label: POSITIONS[position].name,
      score: Number((positionFit(hero, position) * 100).toFixed(0)),
    })),
    counters: counters.slice(0, 5),
    weakAgainst: weakAgainst.slice(0, 5),
  };
}

export function modelSummary(model) {
  return {
    version: model.version,
    source: model.source,
    sourceLabel: model.sourceLabel || sourceInfo(model.source || "high").label,
    trainedAt: model.trainedAt,
    heroes: model.heroes,
    pairs: model.pairs,
    matches: model.matches,
    logLoss: model.logLoss === null ? null : Number(model.logLoss.toFixed(4)),
    accuracy:
      model.accuracy === null
        ? null
        : Number((model.accuracy * 100).toFixed(1)),
  };
}
