import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { HERO_ALIASES, ROLE_CN } from "./aliases.js";
import {
  DATA_SOURCES,
  normalizeSource,
  sourceInfo,
  sourceWinrate,
} from "./sources.js";
import {
  lookupHeroInfo,
  modelSummary,
  prepareRuntime,
  recommendDraft,
} from "./recommender.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SEED_PATH = path.join(HERE, "seed.json");
const DEFAULT_DATA_DIR = path.join(os.homedir(), ".dota2bp");
const OPEN_DOTA_STATS = "https://api.opendota.com/api/heroStats";
const OPEN_DOTA_MATCHUPS = "https://api.opendota.com/api/heroes";
const VALVE_HEROES =
  "https://www.dota2.com/datafeed/herolist?language=schinese";
const USER_AGENT =
  "Dota2bp/1.0 (DeepSeek Harness plugin; daily draft data refresh)";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const finite = (value, fallback = 0) =>
  Number.isFinite(Number(value)) ? Number(value) : fallback;
const ratio = (wins, games) => (games > 0 ? wins / games : null);

function nowIso() {
  return new Date().toISOString();
}

function defaultTeam() {
  return {
    name: "我的队伍",
    members: [1, 2, 3, 4, 5].map((position) => ({
      id: `m${position}`,
      name: `队员 ${position}`,
      position,
      active: true,
      heroPool: [],
      heroPoolIds: [],
    })),
  };
}

function defaultDraft() {
  return { our: [], enemy: [], startedAt: nowIso(), phaseStartedAt: nowIso() };
}

function normalizeLookup(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[\s\-_'’·.。()（）[\]]/g, "");
}

function attrLabel(attr) {
  return { str: "力量", agi: "敏捷", int: "智力", all: "全才" }[attr] || "";
}

function attackLabel(type) {
  return type === "Melee" ? "近战" : type === "Ranged" ? "远程" : type || "";
}

function phaseBucket(count) {
  if (count >= 4) return 4;
  if (count >= 2) return 2;
  return 0;
}

function publicPhase(ourCount) {
  const remaining = Math.max(0, 5 - ourCount);
  const round = ourCount >= 4 ? 3 : ourCount >= 2 ? 2 : 1;
  const need = Math.min(remaining, ourCount >= 4 ? 1 : 2);
  return { round, need, remaining, complete: ourCount >= 5 };
}

function publicHero(hero, strength = 0, source = "high") {
  const sample = sourceWinrate(hero, source);
  return {
    id: hero.id,
    key: hero.key,
    name: hero.name,
    nameEn: hero.nameEn,
    roles: hero.roles || [],
    rolesCn: (hero.roles || []).map((role) => ROLE_CN[role] || role),
    primaryAttr: hero.primaryAttr,
    attrCn: attrLabel(hero.primaryAttr),
    attackType: hero.attackType,
    attackTypeCn: attackLabel(hero.attackType),
    img: hero.img,
    icon: hero.icon,
    winrate: sample.winrate,
    winrateGames: sample.games,
    winrateSource: sample.source,
    winrateSourceLabel: sample.label,
    winrateHigh: hero.winrateHigh,
    winrateAll: hero.winrateAll,
    recentWinrate: hero.recentWinrate,
    pickrate: hero.pickrate,
    proWinrate: hero.proWinrate,
    highGames: hero.highGames,
    strength: Number(strength.toFixed(4)),
    searchText: hero.searchText || "",
  };
}

function publicPick(pick) {
  return {
    heroId: pick.heroId,
    name: pick.name,
    icon: pick.icon,
    memberId: pick.memberId || null,
    position: pick.position || null,
  };
}

export class Dota2bpService {
  constructor(options = {}) {
    this.options = options;
    this.dataDir = path.resolve(
      options.dataDir || process.env.DOTA2BP_DATA_DIR || DEFAULT_DATA_DIR,
    );
    this.datasetPath = path.join(this.dataDir, "dataset.json");
    this.modelPath = path.join(this.dataDir, "model.json");
    this.statePath = path.join(this.dataDir, "state.json");
    this.team = defaultTeam();
    this.draft = defaultDraft();
    this.dataset = null;
    this.runtime = null;
    this.heroIndex = new Map();
    this.searchIndex = new Map();
    this.refreshing = false;
    this.refreshPromise = null;
    this.progress = null;
    this.lastError = null;
    this.ignoredHeroes = [];
    this.queue = Promise.resolve();
    this.timer = null;
    this.initialTimer = null;
    this.stopped = false;
    this.dataSource = normalizeSource(
      options.dataSource || options.source || "high",
    );
    this.refreshAfterHours = finite(options.refreshAfterHours, 20);
    this.requestDelayMs = Math.max(300, finite(options.requestDelayMs, 1150));
    this.ready = this.initialize();
  }

  log(...args) {
    if (this.options.quiet) return;
    try {
      console.log("[dota2bp]", ...args);
    } catch {
      // Logging must never break the plugin.
    }
  }

  async initialize() {
    try {
      await fs.mkdir(this.dataDir, { recursive: true });
      // The team draft stores Chinese hero names, so the hero index must exist first.
      await this.loadDataset();
      await this.loadState();
      if (!this.draft.our.length && !this.draft.enemy.length) {
        const timestamp = nowIso();
        this.draft.startedAt = timestamp;
        this.draft.phaseStartedAt = timestamp;
        await this.persistState().catch(() => {});
      }
      this.log(
        `ready: ${this.dataset?.heroes?.length || 0} heroes, data dir ${this.dataDir}`,
      );
    } catch (error) {
      this.lastError = `初始化失败：${error.message}`;
      this.log(this.lastError);
    }
    if (!this.stopped) {
      this.initialTimer = setTimeout(() => {
        this.ensureFresh().catch((error) =>
          this.log("scheduled refresh failed", error.message),
        );
      }, 3500);
      this.initialTimer.unref?.();
      this.timer = setInterval(
        () => {
          this.ensureFresh().catch((error) =>
            this.log("scheduled refresh failed", error.message),
          );
        },
        30 * 60 * 1000,
      );
      this.timer.unref?.();
    }
  }

  async loadState() {
    const saved = await this.readJson(this.statePath);
    if (!saved) return;
    try {
      if (saved.dataSource) this.dataSource = normalizeSource(saved.dataSource);
      if (saved.team) this.team = this.normalizeTeam(saved.team);
      if (saved.draft)
        this.draft = this.normalizeDraft(saved.draft, { keepPhase: true });
    } catch (error) {
      this.log("state file ignored:", error.message);
    }
  }

  async loadDataset() {
    let dataset = await this.readJson(this.datasetPath);
    let fromSeed = false;
    if (!dataset) {
      dataset = await this.readJson(SEED_PATH);
      fromSeed = Boolean(dataset);
    }
    if (!dataset || !Array.isArray(dataset.heroes) || !dataset.heroes.length) {
      throw new Error("没有可用的英雄数据（seed.json 缺失）");
    }
    if (dataset.schema < 2 || !dataset.heroes[0]?.brackets) {
      const seed = await this.readJson(SEED_PATH);
      if (seed?.schema >= 2) {
        const seedById = new Map(
          seed.heroes.map((hero) => [Number(hero.id), hero]),
        );
        for (const hero of dataset.heroes) {
          const fresh = seedById.get(Number(hero.id));
          if (!fresh?.brackets) continue;
          hero.brackets = fresh.brackets;
          hero.low = fresh.low;
          hero.mid = fresh.mid;
          hero.high = fresh.high;
          hero.all = fresh.all;
          hero.pro = fresh.pro;
        }
        dataset.schema = 2;
        this.log("migrated bracket samples from seed data");
        await this.writeJson(this.datasetPath, dataset).catch(() => {});
      }
    }
    const savedState = await this.readJson(this.statePath);
    if (savedState?.dataSource) {
      this.dataSource = normalizeSource(savedState.dataSource);
    }
    this.dataset = dataset;
    this.datasetFromSeed = fromSeed;
    this.rebuildIndexes();
    const savedModel = await this.readJson(this.modelPath);
    this.runtime = prepareRuntime(this.dataset, savedModel, this.dataSource);
    if (!this.runtime.savedModelReused) {
      await this.writeJson(this.modelPath, this.runtime.model).catch((error) =>
        this.log("model save failed", error.message),
      );
    }
  }

  rebuildIndexes() {
    const reverseAliases = new Map();
    for (const [alias, key] of Object.entries(HERO_ALIASES)) {
      const list = reverseAliases.get(key) || [];
      list.push(alias);
      reverseAliases.set(key, list);
    }
    this.heroIndex = new Map();
    this.searchIndex = new Map();
    for (const hero of this.dataset.heroes) {
      hero.rolesCn = (hero.roles || []).map((role) => ROLE_CN[role] || role);
      hero.attrCn = attrLabel(hero.primaryAttr);
      hero.attackTypeCn = attackLabel(hero.attackType);
      const aliases = reverseAliases.get(hero.key) || [];
      hero.searchText = normalizeLookup(
        [hero.name, hero.nameEn, hero.key, ...aliases].join(" "),
      );
      const variants = [
        hero.name,
        hero.nameEn,
        hero.key,
        String(hero.id),
        ...aliases,
        hero.nameEn?.replace(/[\s-]/g, ""),
      ].filter(Boolean);
      for (const variant of variants) {
        const key = normalizeLookup(variant);
        if (key) this.heroIndex.set(key, hero);
      }
      for (const variant of [hero.name, hero.nameEn, ...aliases]) {
        const key = normalizeLookup(variant);
        if (key) this.searchIndex.set(key, hero);
      }
    }
  }

  resolveHero(value) {
    if (value && typeof value === "object") {
      if (value.heroId)
        return (
          this.runtime?.byId.get(Number(value.heroId))?.hero ||
          this.resolveHero(String(value.heroId))
        );
      value = value.hero || value.name || value.key || "";
    }
    if (value === null || value === undefined) return null;
    const raw = String(value).trim();
    if (!raw) return null;
    const direct = this.heroIndex.get(normalizeLookup(raw));
    if (direct) return direct;
    if (/^\d+$/.test(raw)) {
      const byId = this.dataset.heroes.find(
        (hero) => Number(hero.id) === Number(raw),
      );
      if (byId) return byId;
    }
    const compact = normalizeLookup(raw);
    if (compact.length >= 2) {
      const matches = [
        ...new Set(
          this.dataset.heroes.filter((hero) =>
            hero.searchText.includes(compact),
          ),
        ),
      ];
      if (matches.length === 1) return matches[0];
    }
    return null;
  }

  normalizeTeam(input) {
    const source = input?.members || (Array.isArray(input) ? input : []);
    if (!source.length) {
      const team = defaultTeam();
      team.name = String(input?.name || "我的队伍").trim() || "我的队伍";
      this.ignoredHeroes = [];
      return team;
    }
    const usedPositions = new Set();
    const usedIds = new Set();
    const ignored = [];
    const members = [];
    for (const item of source.slice(0, 5)) {
      let position = Number(item?.position);
      if (
        !Number.isInteger(position) ||
        position < 1 ||
        position > 5 ||
        usedPositions.has(position)
      ) {
        position = [1, 2, 3, 4, 5].find(
          (candidate) => !usedPositions.has(candidate),
        );
      }
      if (!position) continue;
      usedPositions.add(position);
      let id = String(item?.id || `m${position}`);
      if (usedIds.has(id)) id = `m${position}`;
      usedIds.add(id);

      const rawPool = item?.heroPool ?? item?.hero_pool ?? [];
      const poolValues = Array.isArray(rawPool)
        ? rawPool
        : String(rawPool)
            .split(/[,，、;；/\n]+/)
            .map((value) => value.trim())
            .filter(Boolean);
      const pool = [];
      const poolIds = [];
      for (const name of poolValues) {
        const hero = this.resolveHero(name);
        if (!hero) {
          ignored.push(String(name));
          continue;
        }
        if (!poolIds.includes(Number(hero.id))) {
          pool.push(hero.name);
          poolIds.push(Number(hero.id));
        }
      }
      members.push({
        id,
        name:
          String(item?.name || `队员 ${position}`).trim() || `队员 ${position}`,
        position,
        active: item?.active === undefined ? true : Boolean(item.active),
        heroPool: pool,
        heroPoolIds: poolIds,
      });
    }

    for (let position = 1; position <= 5; position += 1) {
      if (usedPositions.has(position)) continue;
      members.push({
        id: `m${position}`,
        name: `队员 ${position}`,
        position,
        active: false,
        heroPool: [],
        heroPoolIds: [],
      });
    }
    members.sort((a, b) => a.position - b.position);
    this.ignoredHeroes = [...new Set(ignored)];
    return {
      name: String(input?.name || "我的队伍").trim() || "我的队伍",
      members,
    };
  }

  normalizePick(raw, side, members, usedHeroIds, usedMembers) {
    const hero = this.resolveHero(raw);
    if (!hero)
      throw new Error(`无法识别英雄：${raw?.hero || raw?.name || raw}`);
    if (usedHeroIds.has(Number(hero.id)))
      throw new Error(`英雄 ${hero.name} 已经在征召中`);
    usedHeroIds.add(Number(hero.id));
    let memberId = null;
    let position = null;
    if (side === "our") {
      const active = members.filter((item) => item.active !== false);
      const requested = raw?.memberId || null;
      const requestedPosition = Number(raw?.position);
      let member = requested
        ? active.find((item) => item.id === requested)
        : null;
      if (!member && Number.isInteger(requestedPosition)) {
        member = active.find((item) => item.position === requestedPosition);
      }
      if (!member || usedMembers.has(member.id)) {
        const available = active.filter((item) => !usedMembers.has(item.id));
        member =
          available.find((item) =>
            (item.heroPoolIds || []).includes(Number(hero.id)),
          ) || available[0];
      }
      if (member) {
        usedMembers.add(member.id);
        memberId = member.id;
        position = member.position;
      }
    }
    return {
      heroId: Number(hero.id),
      name: hero.name,
      icon: hero.icon,
      memberId,
      position,
    };
  }

  normalizeDraft(input, options = {}) {
    const members = this.team.members;
    const ourInput = Array.isArray(input?.our) ? input.our : [];
    const enemyInput = Array.isArray(input?.enemy) ? input.enemy : [];
    if (ourInput.length > 5 || enemyInput.length > 5)
      throw new Error("每方最多选择 5 个英雄");
    const usedHeroIds = new Set();
    const usedMembers = new Set();
    const our = [];
    const enemy = [];
    for (const pick of ourInput)
      our.push(
        this.normalizePick(pick, "our", members, usedHeroIds, usedMembers),
      );
    for (const pick of enemyInput)
      enemy.push(
        this.normalizePick(pick, "enemy", members, usedHeroIds, usedMembers),
      );

    const previousBucket = phaseBucket(this.draft?.our?.length || 0);
    const previousEmpty =
      !this.draft?.our?.length && !this.draft?.enemy?.length;
    const nextBucket = phaseBucket(our.length);
    let phaseStartedAt = input?.phaseStartedAt;
    if (!phaseStartedAt || Number.isNaN(Date.parse(phaseStartedAt)))
      phaseStartedAt = this.draft?.phaseStartedAt || nowIso();
    if (
      !options.keepPhase &&
      (nextBucket !== previousBucket ||
        (previousEmpty && (our.length > 0 || enemy.length > 0)))
    )
      phaseStartedAt = nowIso();
    if (!our.length && !enemy.length) phaseStartedAt = nowIso();
    return {
      our,
      enemy,
      startedAt: this.draft?.startedAt || nowIso(),
      phaseStartedAt,
    };
  }

  enqueue(task) {
    const run = this.queue.then(task, task);
    this.queue = run.catch(() => {});
    return run;
  }

  async saveTeam(input, options = {}) {
    const team = this.normalizeTeam(input);
    this.team = team;
    if (!options.silent) await this.persistState();
    return team;
  }

  async saveDraft(input, options = {}) {
    const draft = this.normalizeDraft(input, options);
    this.draft = draft;
    if (!options.silent) await this.persistState();
    return draft;
  }

  async persistState() {
    await this.writeJson(this.statePath, {
      team: this.team,
      draft: this.draft,
      dataSource: this.dataSource,
      savedAt: nowIso(),
    });
  }

  async setDataSource(value) {
    await this.ready;
    const source = normalizeSource(value);
    if (source === this.dataSource) return this.status();
    this.dataSource = source;
    if (this.dataset) {
      this.runtime = prepareRuntime(this.dataset, null, source);
      await this.writeJson(this.modelPath, this.runtime.model).catch((error) =>
        this.log("model save failed", error.message),
      );
    }
    await this.persistState();
    return this.status();
  }

  async addPicks(picks) {
    return this.enqueue(async () => {
      const our = [...this.draft.our];
      const enemy = [...this.draft.enemy];
      for (const pick of picks) {
        const side = pick.side === "enemy" ? "enemy" : "our";
        if (side === "our")
          our.push({
            hero: pick.heroId || pick.hero || pick.name,
            memberId: pick.memberId,
            position: pick.position,
          });
        else enemy.push({ hero: pick.heroId || pick.hero || pick.name });
      }
      return this.saveDraft({
        our,
        enemy,
        phaseStartedAt: this.draft.phaseStartedAt,
      });
    });
  }

  async removePick(side, heroId) {
    return this.enqueue(async () => {
      const key = side === "enemy" ? "enemy" : "our";
      const next = this.draft[key].filter(
        (pick) => Number(pick.heroId) !== Number(heroId),
      );
      if (next.length === this.draft[key].length)
        throw new Error("该英雄不在当前征召中");
      const our = key === "our" ? next : this.draft.our;
      const enemy = key === "enemy" ? next : this.draft.enemy;
      return this.saveDraft({ our, enemy }, { keepPhase: false });
    });
  }

  async resetDraft() {
    return this.enqueue(async () => {
      this.draft = {
        our: [],
        enemy: [],
        startedAt: nowIso(),
        phaseStartedAt: nowIso(),
      };
      await this.persistState();
      return this.draft;
    });
  }

  async readJson(file) {
    try {
      const text = await fs.readFile(file, "utf8");
      return JSON.parse(text);
    } catch (error) {
      if (error.code === "ENOENT") return null;
      throw error;
    }
  }

  async writeJson(file, value) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(value), "utf8");
    try {
      await fs.rename(temporary, file);
    } catch (error) {
      await fs.rm(file, { force: true }).catch(() => {});
      await fs.rename(temporary, file);
    }
  }

  async fetchJson(url, attempt = 1) {
    const response = await fetch(url, {
      headers: { "user-agent": USER_AGENT, accept: "application/json" },
      signal: AbortSignal.timeout(45_000),
    });
    if (response.status === 429 || response.status >= 500) {
      if (attempt > 3) throw new Error(`HTTP ${response.status}（${url}）`);
      const wait = attempt * 8000;
      this.log(`HTTP ${response.status}; retrying in ${wait}ms`);
      await sleep(wait);
      return this.fetchJson(url, attempt + 1);
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}（${url}）`);
    return response.json();
  }

  async collectDataset() {
    this.progress = {
      phase: "heroes",
      current: 0,
      total: 0,
      message: "正在获取英雄胜率…",
    };
    const stats = await this.fetchJson(OPEN_DOTA_STATS);
    if (!Array.isArray(stats) || !stats.length)
      throw new Error("OpenDota 英雄胜率数据为空");

    let valve = [];
    try {
      const data = await this.fetchJson(VALVE_HEROES);
      valve = data?.result?.data?.heroes || [];
    } catch (error) {
      this.log("Valve schinese hero feed unavailable:", error.message);
    }
    const valveById = new Map(valve.map((hero) => [Number(hero.id), hero]));
    const previousById = new Map(
      (this.dataset?.heroes || []).map((hero) => [Number(hero.id), hero]),
    );
    const totalPicks = stats.reduce(
      (sum, hero) => sum + finite(hero.pub_pick),
      0,
    );
    const trendPicks = stats.reduce((sum, hero) => {
      const picks = Array.isArray(hero.pub_pick_trend)
        ? hero.pub_pick_trend
        : [];
      return sum + picks.reduce((inner, value) => inner + finite(value), 0);
    }, 0);

    const heroes = stats.map((hero) => {
      const id = Number(hero.id);
      const valveHero = valveById.get(id);
      const previous = previousById.get(id);
      const highGames = finite(hero["6_pick"]) + finite(hero["7_pick"]);
      const highWins = finite(hero["6_win"]) + finite(hero["7_win"]);
      const brackets = {};
      for (let bracket = 1; bracket <= 7; bracket += 1) {
        brackets[bracket] = {
          games: finite(hero[`${bracket}_pick`]),
          wins: finite(hero[`${bracket}_win`]),
        };
      }
      const sumBrackets = (list) => ({
        games: list.reduce((sum, bracket) => sum + brackets[bracket].games, 0),
        wins: list.reduce((sum, bracket) => sum + brackets[bracket].wins, 0),
      });
      const trendPick = (
        Array.isArray(hero.pub_pick_trend) ? hero.pub_pick_trend : []
      ).reduce((sum, value) => sum + finite(value), 0);
      const trendWin = (
        Array.isArray(hero.pub_win_trend) ? hero.pub_win_trend : []
      ).reduce((sum, value) => sum + finite(value), 0);
      return {
        id,
        key: String(hero.name).replace(/^npc_dota_hero_/, ""),
        name: valveHero?.name_loc || previous?.name || hero.localized_name,
        nameEn:
          valveHero?.name_english_loc ||
          previous?.nameEn ||
          hero.localized_name,
        roles: Array.isArray(hero.roles) ? hero.roles : [],
        primaryAttr: hero.primary_attr || null,
        attackType: hero.attack_type || null,
        img: `https://cdn.cloudflare.steamstatic.com${hero.img}`,
        icon: `https://cdn.cloudflare.steamstatic.com${hero.icon}`,
        winrateAll: ratio(finite(hero.pub_win), finite(hero.pub_pick)),
        pickrate: totalPicks ? finite(hero.pub_pick) / totalPicks : null,
        winrateHigh: ratio(highWins, highGames),
        highGames,
        brackets,
        low: sumBrackets([1, 2, 3]),
        mid: sumBrackets([4, 5]),
        high: { games: highGames, wins: highWins },
        all: { games: finite(hero.pub_pick), wins: finite(hero.pub_win) },
        pro: { games: finite(hero.pro_pick), wins: finite(hero.pro_win) },
        proWinrate: ratio(finite(hero.pro_win), finite(hero.pro_pick)),
        proPick: finite(hero.pro_pick),
        proBan: finite(hero.pro_ban),
        recentWinrate: ratio(trendWin, trendPick),
        recentPickrate: trendPicks ? trendPick / trendPicks : null,
      };
    });

    const matchups = [];
    const failedHeroes = [];
    this.progress = {
      phase: "matchups",
      current: 0,
      total: heroes.length,
      message: "正在采集英雄克制关系…",
    };
    for (let index = 0; index < heroes.length; index += 1) {
      const hero = heroes[index];
      try {
        const rows = await this.fetchJson(
          `${OPEN_DOTA_MATCHUPS}/${hero.id}/matchups`,
        );
        for (const row of rows || []) {
          const enemyId = Number(row.hero_id);
          const games = finite(row.games_played);
          if (!enemyId || enemyId === hero.id || !games) continue;
          matchups.push([hero.id, enemyId, games, finite(row.wins)]);
        }
      } catch (error) {
        failedHeroes.push({
          id: hero.id,
          name: hero.name,
          error: error.message,
        });
        this.log(`matchup ${hero.id} ${hero.name} failed: ${error.message}`);
      }
      this.progress = {
        phase: "matchups",
        current: index + 1,
        total: heroes.length,
        message: `正在采集英雄克制关系 ${index + 1}/${heroes.length}`,
      };
      if (index < heroes.length - 1) await sleep(this.requestDelayMs);
    }

    if (!matchups.length) throw new Error("未能采集到任何英雄克制数据");
    if (failedHeroes.length > heroes.length * 0.25) {
      throw new Error(
        `克制数据失败过多（${failedHeroes.length}/${heroes.length}），保留旧数据`,
      );
    }

    this.progress = {
      phase: "training",
      current: heroes.length,
      total: heroes.length,
      message: "正在训练征召模型…",
    };
    return {
      schema: 1,
      fetchedAt: nowIso(),
      source: "OpenDota 公共 API + Valve 中文英雄数据",
      heroes,
      matchups,
      failures: failedHeroes.length,
      failedHeroes,
    };
  }

  async runRefresh() {
    this.refreshing = true;
    this.lastError = null;
    this.progress = {
      phase: "start",
      current: 0,
      total: 0,
      message: "准备更新数据…",
    };
    try {
      const dataset = await this.collectDataset();
      this.dataset = dataset;
      this.datasetFromSeed = false;
      this.rebuildIndexes();
      this.runtime = prepareRuntime(dataset, null);
      await this.writeJson(this.datasetPath, dataset);
      await this.writeJson(this.modelPath, this.runtime.model);
      this.log(
        `refresh complete: ${dataset.heroes.length} heroes, ${dataset.matchups.length} matchup rows`,
      );
      this.progress = null;
      return this.status();
    } catch (error) {
      this.lastError = `数据更新失败：${error.message}`;
      this.progress = null;
      this.log(this.lastError);
      throw error;
    } finally {
      this.refreshing = false;
      this.refreshPromise = null;
    }
  }

  async refreshNow() {
    await this.ready;
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.runRefresh();
    return this.refreshPromise;
  }

  startRefresh() {
    this.refreshNow().catch((error) => {
      this.lastError = `数据更新失败：${error.message}`;
    });
    return this.status();
  }

  async ensureFresh() {
    await this.ready;
    if (!this.stopped && !this.refreshing) {
      const fetched = this.dataset?.fetchedAt
        ? Date.parse(this.dataset.fetchedAt)
        : 0;
      const ageHours = fetched ? (Date.now() - fetched) / 3_600_000 : Infinity;
      if (ageHours >= this.refreshAfterHours) this.startRefresh();
    }
  }

  async status() {
    await this.ready;
    const fetchedMs = this.dataset?.fetchedAt
      ? Date.parse(this.dataset.fetchedAt)
      : 0;
    const ageHours = fetchedMs ? (Date.now() - fetchedMs) / 3_600_000 : null;
    const strengths = new Map();
    if (this.runtime) {
      for (const [id, entry] of this.runtime.byId)
        strengths.set(Number(id), this.runtime.strengths[entry.index] || 0);
    }
    const heroes = (this.dataset?.heroes || []).map((hero) =>
      publicHero(hero, strengths.get(Number(hero.id)) || 0, this.dataSource),
    );
    return {
      ok: true,
      ready: Boolean(this.dataset && this.runtime),
      refreshing: this.refreshing,
      progress: this.progress,
      error: this.lastError,
      dataSource: this.dataSource,
      source: sourceInfo(this.dataSource),
      dataSources: DATA_SOURCES,
      data: this.dataset
        ? {
            source: this.dataset.source,
            fetchedAt: this.dataset.fetchedAt,
            ageHours: ageHours === null ? null : Number(ageHours.toFixed(2)),
            heroCount: this.dataset.heroes.length,
            matchupRows: this.dataset.matchups.length,
            failures: this.dataset.failures || 0,
            fromSeed: Boolean(this.datasetFromSeed),
          }
        : null,
      model: this.runtime ? modelSummary(this.runtime.model) : null,
      team: this.team,
      draft: {
        ...this.draft,
        our: this.draft.our.map(publicPick),
        enemy: this.draft.enemy.map(publicPick),
        phase: publicPhase(this.draft.our.length),
      },
      heroes,
      ignoredHeroes: this.ignoredHeroes,
      refreshAfterHours: this.refreshAfterHours,
    };
  }

  async recommend(options = {}) {
    await this.ready;
    if (!this.dataset || !this.runtime) throw new Error("英雄数据尚未就绪");
    if (options.members) await this.saveTeam({ members: options.members });
    if (options.our || options.enemy) {
      await this.saveDraft({
        our: options.our || this.draft.our,
        enemy: options.enemy || this.draft.enemy,
      });
    }
    const recommendation = recommendDraft(this.runtime, this.team, this.draft);
    recommendation.data = {
      fetchedAt: this.dataset.fetchedAt,
      ageHours: Number(
        ((Date.now() - Date.parse(this.dataset.fetchedAt)) / 3_600_000).toFixed(
          2,
        ),
      ),
      heroCount: this.dataset.heroes.length,
      model: modelSummary(this.runtime.model),
    };
    return recommendation;
  }

  async heroInfo(value) {
    await this.ready;
    if (!this.dataset || !this.runtime) throw new Error("英雄数据尚未就绪");
    const hero = this.resolveHero(value);
    if (!hero) throw new Error(`无法识别英雄：${value}`);
    return lookupHeroInfo(this.runtime, hero);
  }

  async runMutation(task) {
    const result = await this.enqueue(task);
    const state = await this.status();
    let recommendation = null;
    try {
      recommendation = await this.recommend();
    } catch (error) {
      this.lastError = this.lastError || error.message;
    }
    return { ...result, state, recommendation };
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    if (this.initialTimer) clearTimeout(this.initialTimer);
    this.timer = null;
    this.initialTimer = null;
  }
}
