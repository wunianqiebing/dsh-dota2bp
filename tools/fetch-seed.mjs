// One-off seed collector. The installed plugin refreshes through the same public APIs.
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.resolve(here, "..", "seed.json");
const UA = "Dota2bp/1.0 (DeepSeek Harness plugin; data refresh)";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getJson(url, attempt = 1) {
  const response = await fetch(url, {
    headers: { "user-agent": UA, accept: "application/json" },
    signal: AbortSignal.timeout(45_000),
  });
  if (response.status === 429) {
    if (attempt > 4) throw new Error(`429 rate limited: ${url}`);
    console.log(`rate limited, waiting 15s (attempt ${attempt})`);
    await sleep(15_000);
    return getJson(url, attempt + 1);
  }
  if (!response.ok) throw new Error(`HTTP ${response.status} ${url}`);
  return response.json();
}

function ratio(wins, games) {
  return games > 0 ? wins / games : null;
}

function highMmr(hero) {
  const games = (hero["6_pick"] || 0) + (hero["7_pick"] || 0);
  const wins = (hero["6_win"] || 0) + (hero["7_win"] || 0);
  return { games, wins };
}

function trend(hero) {
  const picks = Array.isArray(hero.pub_pick_trend) ? hero.pub_pick_trend : [];
  const wins = Array.isArray(hero.pub_win_trend) ? hero.pub_win_trend : [];
  let p = 0;
  let w = 0;
  for (let i = 0; i < Math.min(picks.length, wins.length); i += 1) {
    p += Number(picks[i]) || 0;
    w += Number(wins[i]) || 0;
  }
  return { games: p, wins: w };
}

console.log("fetching hero stats...");
const stats = await getJson("https://api.opendota.com/api/heroStats");
console.log("fetching Valve Chinese hero names...");
let valve = [];
try {
  const data = await getJson(
    "https://www.dota2.com/datafeed/herolist?language=schinese",
  );
  valve = data?.result?.data?.heroes || [];
} catch (error) {
  console.warn("Valve hero list unavailable:", error.message);
}
const cnById = new Map(valve.map((hero) => [Number(hero.id), hero]));
const totalPicks = stats.reduce((sum, hero) => sum + (hero.pub_pick || 0), 0);
const totalTrendPicks = stats.reduce((sum, hero) => sum + trend(hero).games, 0);

const heroes = stats.map((hero) => {
  const high = highMmr(hero);
  const recent = trend(hero);
  const valveHero = cnById.get(Number(hero.id));
  return {
    id: Number(hero.id),
    key: String(hero.name).replace(/^npc_dota_hero_/, ""),
    name: valveHero?.name_loc || hero.localized_name,
    nameEn: valveHero?.name_english_loc || hero.localized_name,
    roles: Array.isArray(hero.roles) ? hero.roles : [],
    primaryAttr: hero.primary_attr || null,
    attackType: hero.attack_type || null,
    img: `https://cdn.cloudflare.steamstatic.com${hero.img}`,
    icon: `https://cdn.cloudflare.steamstatic.com${hero.icon}`,
    winrateAll: ratio(hero.pub_win, hero.pub_pick),
    pickrate: totalPicks > 0 ? (hero.pub_pick || 0) / totalPicks : null,
    winrateHigh: ratio(high.wins, high.games),
    highGames: high.games,
    proWinrate: ratio(hero.pro_win, hero.pro_pick),
    proPick: hero.pro_pick || 0,
    proBan: hero.pro_ban || 0,
    recentWinrate: ratio(recent.wins, recent.games),
    recentPickrate: totalTrendPicks > 0 ? recent.games / totalTrendPicks : null,
  };
});

console.log(`heroes: ${heroes.length}; fetching matchups (paced)...`);
const matchups = [];
let done = 0;
let failures = 0;
for (const hero of heroes) {
  try {
    const rows = await getJson(
      `https://api.opendota.com/api/heroes/${hero.id}/matchups`,
    );
    for (const row of rows) {
      const enemyId = Number(row.hero_id);
      if (!enemyId || enemyId === hero.id) continue;
      matchups.push([
        hero.id,
        enemyId,
        Number(row.games_played) || 0,
        Number(row.wins) || 0,
      ]);
    }
  } catch (error) {
    failures += 1;
    console.warn(`matchup ${hero.id} ${hero.name} failed: ${error.message}`);
  }
  done += 1;
  if (done % 10 === 0 || done === heroes.length) {
    console.log(
      `matchups ${done}/${heroes.length}, failures=${failures}, rows=${matchups.length}`,
    );
  }
  await sleep(1_150);
}

const seed = {
  schema: 1,
  fetchedAt: new Date().toISOString(),
  source: "OpenDota public API + Valve Dota 2 hero feed (schinese)",
  heroes,
  matchups,
  failures,
};
await fs.writeFile(out, JSON.stringify(seed), "utf8");
console.log(
  `wrote ${out} (${(Buffer.byteLength(JSON.stringify(seed)) / 1024 / 1024).toFixed(2)} MiB)`,
);
