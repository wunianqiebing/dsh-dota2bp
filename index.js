import { Dota2bpService } from "./service.js";
import { DATA_SOURCES } from "./sources.js";

const TOOL_NAME = "dota2_bp";

const TOOL_DESCRIPTION = [
  "Dota 2 天梯征召（无 Ban）选人助手。支持 2-2-1 同步选人：每轮双方各选 2/2/1 个英雄。",
  "每天自动从 OpenDota 与 Valve 中文英雄数据源更新胜率、克制关系和征召模型；可选全分段、高/中/低分段、单段位或职业比赛数据。",
  "成员分路灵活，可勾选本局参战成员；推荐综合英雄池、版本强度、对位克制和阵容结构，并在双方 5 人齐后给出预测胜率。",
  "典型用法：先 setup_team 录入成员与英雄池并设置 active，再用 set_draft 或 add_pick 同步已选英雄，最后 recommend。",
].join(" ");

const TOOL_PARAMETERS = {
  type: "object",
  properties: {
    action: {
      type: "string",
      enum: [
        "status",
        "setup_team",
        "set_draft",
        "add_pick",
        "recommend",
        "refresh",
        "set_source",
        "hero_info",
        "reset_draft",
      ],
      description: "要执行的操作。",
    },
    team_name: { type: "string", description: "队伍名称，可选。" },
    source: {
      type: "string",
      enum: DATA_SOURCES.map((item) => item.id),
      description:
        "set_source 的数据来源：all 全分段、high 高分段、mid 中分段、low 低分段、b1-b7 单段位、pro 职业比赛。",
    },
    members: {
      type: "array",
      description:
        "成员列表。position 仅作成员编号；active 表示本局是否参战；hero_pool 可包含多个分路的英雄。",
      items: {
        type: "object",
        properties: {
          name: { type: "string", description: "成员名。" },
          position: {
            type: "integer",
            minimum: 1,
            maximum: 5,
            description: "成员编号 1-5，仅用于区分，不再限制分路。",
          },
          active: {
            type: "boolean",
            description: "本局是否参战，默认 true；不参战成员不参与选人分配。",
          },
          hero_pool: {
            type: "array",
            items: { type: "string" },
            description:
              "该成员的英雄池（中文名，可用常见外号，可跨多个分路）。",
          },
        },
        required: ["position"],
      },
    },
    our_picks: {
      type: "array",
      items: {
        oneOf: [
          { type: "string" },
          {
            type: "object",
            properties: {
              hero: { type: "string", description: "英雄中文名。" },
              position: {
                type: "integer",
                minimum: 1,
                maximum: 5,
                description: "可选：指定由几号位成员使用。",
              },
              memberId: {
                type: "string",
                description: "可选：指定成员 id，如 m1。",
              },
            },
            required: ["hero"],
          },
        ],
      },
      description:
        "我方已选英雄（中文名）。可传字符串，或传 {hero, memberId} 指定由哪位参战成员使用；未指定时按英雄池自动分配，参战成员用完后记为补位。",
    },
    enemy_picks: {
      type: "array",
      items: { type: "string" },
      description: "敌方已选英雄（中文名）。",
    },
    side: {
      type: "string",
      enum: ["our", "enemy"],
      description: "add_pick 的阵营，默认 our。",
    },
    hero: {
      type: "string",
      description: "add_pick / hero_info 使用的英雄中文名。",
    },
    member: {
      type: "string",
      description: "add_pick 时可指定成员 id（如 m1）或位置号。",
    },
    limit: {
      type: "integer",
      minimum: 1,
      maximum: 8,
      description: "推荐数量，默认 5。",
    },
  },
  required: ["action"],
  additionalProperties: false,
};

function textResult(value) {
  const text =
    typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return [{ type: "text", text }];
}

/**
 * The HTTP state feeds the browser's 127-hero picker. Tool results stay small:
 * the agent only needs the draft, data status and model summary.
 */
function compactState(state) {
  const { heroes, dataSources, ...rest } = state;
  return { ...rest, heroCount: Array.isArray(heroes) ? heroes.length : 0 };
}

function briefCandidate(candidate) {
  return {
    name: candidate.name,
    position: candidate.position,
    positionName: candidate.positionName,
    member: candidate.member?.name,
    score: candidate.score,
    inPool: candidate.inPool,
    winrate: Number.isFinite(candidate.winrate)
      ? Number((candidate.winrate * 100).toFixed(1))
      : null,
    winrateSource: candidate.winrateSourceLabel,
    reasons: (candidate.reasons || []).slice(0, 3),
  };
}

function compactRecommendation(recommendation) {
  if (!recommendation) return null;
  return {
    source: recommendation.source,
    phase: recommendation.phase,
    squads: (recommendation.squads || []).map((squad) => ({
      score: squad.score,
      heroes: squad.heroes.map(briefCandidate),
      reasons: (squad.reasons || []).slice(0, 4),
    })),
    topPicks: (recommendation.topPicks || []).map(briefCandidate),
    perMember: (recommendation.perMember || []).map((entry) => ({
      member: entry.member,
      picks: entry.picks.slice(0, 3).map(briefCandidate),
    })),
    avoid: recommendation.avoid || [],
    warnings: recommendation.warnings || [],
    prediction: recommendation.prediction,
    data: recommendation.data,
  };
}

function buildTool(service) {
  return {
    name: TOOL_NAME,
    description: TOOL_DESCRIPTION,
    parameters: TOOL_PARAMETERS,
    output: {
      schema: {
        type: "object",
        properties: {
          ok: { type: "boolean" },
          message: { type: "string" },
          state: { type: "object", additionalProperties: true },
          recommendation: { type: "object", additionalProperties: true },
          hero: { type: "object", additionalProperties: true },
        },
        additionalProperties: true,
      },
      render(_args, value) {
        return textResult(value);
      },
    },
    timeoutMs: 600_000,
    isConcurrencySafe() {
      return false;
    },
    async execute(args) {
      const action = String(args?.action || "status");
      if (action === "status") return compactState(await service.status());
      if (action === "setup_team") {
        const team = await service.saveTeam({
          name: args.team_name,
          members: args.members || [],
        });
        return {
          ok: true,
          message: `已保存 ${team.members.length} 名成员。`,
          team,
          ignoredHeroes: service.ignoredHeroes,
          state: compactState(await service.status()),
          recommendation: compactRecommendation(await service.recommend()),
        };
      }
      if (action === "set_draft") {
        const draft = await service.saveDraft({
          our: args.our_picks || [],
          enemy: args.enemy_picks || [],
        });
        return {
          ok: true,
          message: `已同步征召：我方 ${draft.our.length} 人，敌方 ${draft.enemy.length} 人。`,
          draft,
          state: compactState(await service.status()),
          recommendation: compactRecommendation(await service.recommend()),
        };
      }
      if (action === "add_pick") {
        if (!args.hero) throw new Error("add_pick 需要 hero 参数");
        await service.addPicks([
          {
            side: args.side === "enemy" ? "enemy" : "our",
            hero: args.hero,
            memberId: args.member,
            position: /^\d+$/.test(String(args.member || ""))
              ? Number(args.member)
              : undefined,
          },
        ]);
        return {
          ok: true,
          state: compactState(await service.status()),
          recommendation: compactRecommendation(await service.recommend()),
        };
      }
      if (action === "recommend") {
        const fullRecommendation = await service.recommend();
        const recommendation = compactRecommendation(fullRecommendation);
        return {
          ok: true,
          state: compactState(await service.status()),
          recommendation,
          message: recommendation.phase.label,
        };
      }
      if (action === "refresh") {
        await service.refreshNow();
        return {
          ok: true,
          message: "数据与模型已更新。",
          state: compactState(await service.status()),
        };
      }
      if (action === "set_source") {
        if (!args.source) throw new Error("set_source 需要 source 参数");
        await service.setDataSource(args.source);
        return {
          ok: true,
          message: `数据来源已切换为 ${service.runtime?.sourceInfo?.label || args.source}。`,
          state: compactState(await service.status()),
          recommendation: compactRecommendation(await service.recommend()),
        };
      }
      if (action === "hero_info") {
        if (!args.hero) throw new Error("hero_info 需要 hero 参数");
        return { ok: true, ...(await service.heroInfo(args.hero)) };
      }
      if (action === "reset_draft") {
        await service.resetDraft();
        return {
          ok: true,
          message: "已重置当前征召。",
          state: compactState(await service.status()),
          recommendation: compactRecommendation(await service.recommend()),
        };
      }
      throw new Error(`未知操作：${action}`);
    },
  };
}

function json(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "content-length": Buffer.byteLength(body),
  });
  res.end(body);
}

async function readBody(req, limit = 2 * 1024 * 1024) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("请求体过大");
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function mutation(service, task) {
  await task;
  const state = await service.status();
  let recommendation = null;
  try {
    recommendation = await service.recommend();
  } catch (error) {
    service.lastError = service.lastError || error.message;
  }
  return { ok: true, state, recommendation };
}

function registerRoute(ctx, service) {
  ctx.effect(() =>
    ctx.webServer.register({
      kind: "prefix",
      path: "/dota2bp/api",
      async handler(req, res) {
        try {
          const url = new URL(
            req.url || "/",
            `http://${req.headers.host || "127.0.0.1"}`,
          );
          if (req.method === "GET" && url.pathname === "/dota2bp/api/state") {
            json(res, 200, await service.status());
            return;
          }
          if (req.method === "GET" && url.pathname === "/dota2bp/api/hero") {
            const hero = await service.heroInfo(
              url.searchParams.get("name") || "",
            );
            json(res, 200, { ok: true, ...hero });
            return;
          }
          if (req.method !== "POST" || url.pathname !== "/dota2bp/api/action") {
            json(res, 404, { ok: false, error: "Not found" });
            return;
          }
          const body = await readBody(req);
          const action = String(body.action || "");
          if (action === "team") {
            json(
              res,
              200,
              await mutation(service, service.saveTeam(body.team)),
            );
            return;
          }
          if (action === "draft") {
            json(
              res,
              200,
              await mutation(service, service.saveDraft(body.draft)),
            );
            return;
          }
          if (action === "add_picks") {
            const picks = Array.isArray(body.picks) ? body.picks : [];
            if (!picks.length) throw new Error("没有要添加的英雄");
            json(res, 200, await mutation(service, service.addPicks(picks)));
            return;
          }
          if (action === "remove_pick") {
            json(
              res,
              200,
              await mutation(
                service,
                service.removePick(body.side, body.heroId),
              ),
            );
            return;
          }
          if (action === "reset") {
            json(res, 200, await mutation(service, service.resetDraft()));
            return;
          }
          if (action === "recommend") {
            json(res, 200, {
              ok: true,
              state: await service.status(),
              recommendation: await service.recommend(),
            });
            return;
          }
          if (action === "refresh") {
            service.startRefresh();
            json(res, 200, { ok: true, state: await service.status() });
            return;
          }
          if (action === "source") {
            if (!body.source) throw new Error("source 不能为空");
            json(
              res,
              200,
              await mutation(service, service.setDataSource(body.source)),
            );
            return;
          }
          if (action === "hero_info") {
            json(res, 200, {
              ok: true,
              ...(await service.heroInfo(body.hero)),
            });
            return;
          }
          throw new Error(`未知操作：${action}`);
        } catch (error) {
          json(res, 400, { ok: false, error: String(error?.message || error) });
        }
      },
    }),
  );
}

export const inject = ["tools"];

export function apply(ctx, config = {}) {
  const service = new Dota2bpService(config);
  ctx.effect(() => () => service.stop());
  ctx.effect(() => ctx.tools.register(buildTool(service)));
  ctx.inject(["webServer"], (webCtx) => {
    registerRoute(webCtx, service);
  });
}

export { Dota2bpService };
