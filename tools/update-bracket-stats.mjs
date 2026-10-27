// Add per-bracket and pro win samples to the existing seed without refetching matchups.
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const seedPath = path.resolve(here, '..', 'seed.json')
const seed = JSON.parse(await fs.readFile(seedPath, 'utf8'))
const response = await fetch('https://api.opendota.com/api/heroStats', {
  headers: { 'user-agent': 'Dota2bp/1.1 seed updater', accept: 'application/json' },
  signal: AbortSignal.timeout(60_000),
})
if (!response.ok) throw new Error(`OpenDota HTTP ${response.status}`)
const stats = await response.json()
const byId = new Map(stats.map((hero) => [Number(hero.id), hero]))
let updated = 0
for (const hero of seed.heroes) {
  const raw = byId.get(Number(hero.id))
  if (!raw) continue
  hero.brackets = {}
  for (let bracket = 1; bracket <= 7; bracket += 1) {
    hero.brackets[bracket] = {
      games: Number(raw[`${bracket}_pick`]) || 0,
      wins: Number(raw[`${bracket}_win`]) || 0,
    }
  }
  hero.low = {
    games: [1, 2, 3].reduce((sum, b) => sum + (Number(raw[`${b}_pick`]) || 0), 0),
    wins: [1, 2, 3].reduce((sum, b) => sum + (Number(raw[`${b}_win`]) || 0), 0),
  }
  hero.mid = {
    games: [4, 5].reduce((sum, b) => sum + (Number(raw[`${b}_pick`]) || 0), 0),
    wins: [4, 5].reduce((sum, b) => sum + (Number(raw[`${b}_win`]) || 0), 0),
  }
  hero.high = {
    games: [6, 7].reduce((sum, b) => sum + (Number(raw[`${b}_pick`]) || 0), 0),
    wins: [6, 7].reduce((sum, b) => sum + (Number(raw[`${b}_win`]) || 0), 0),
  }
  hero.pro = { games: Number(raw.pro_pick) || 0, wins: Number(raw.pro_win) || 0 }
  hero.all = {
    games: Number(raw.pub_pick) || 0,
    wins: Number(raw.pub_win) || 0,
  }
  updated += 1
}
seed.schema = 2
seed.fetchedBracketsAt = new Date().toISOString()
await fs.writeFile(seedPath, JSON.stringify(seed), 'utf8')
console.log(`updated ${updated} heroes; seed bytes ${(await fs.stat(seedPath)).size}`)
