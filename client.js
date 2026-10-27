window.__ModuleLoader__.load({
  id: "dsh-dota2bp",
  factory(require) {
    const React = require("react");
    const h = React.createElement;
    const { useState, useEffect, useMemo, useRef } = React;

    const API = "/dota2bp/api";
    const POSITIONS = {
      1: { short: "1号位", name: "优势路核心", lane: "优势路" },
      2: { short: "2号位", name: "中单", lane: "中路" },
      3: { short: "3号位", name: "劣势路核心", lane: "劣势路" },
      4: { short: "4号位", name: "游走辅助", lane: "劣势路" },
      5: { short: "5号位", name: "保人辅助", lane: "优势路" },
    };

    async function requestState() {
      const response = await fetch(`${API}/state`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false)
        throw new Error(data.error || `请求失败 (${response.status})`);
      return data;
    }

    async function requestAction(action, payload) {
      const response = await fetch(`${API}/action`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ...(payload || {}) }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data.ok === false)
        throw new Error(data.error || `请求失败 (${response.status})`);
      return data;
    }

    function formatDate(value) {
      if (!value) return "尚未更新";
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return "时间未知";
      const parts = new Intl.DateTimeFormat("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).formatToParts(date);
      const pick = (type) =>
        parts.find((part) => part.type === type)?.value || "";
      return `${pick("month")}/${pick("day")} ${pick("hour")}:${pick("minute")}`;
    }

    function formatAge(hours) {
      if (hours === null || hours === undefined) return "未知";
      if (hours < 1) return "刚刚更新";
      if (hours < 24) return `${Math.floor(hours)} 小时前`;
      return `${Math.floor(hours / 24)} 天前`;
    }

    function pct(value) {
      return Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "—";
    }

    function splitPool(text) {
      return String(text || "")
        .split(/[,，、;；/\n]+/)
        .map((item) => item.trim())
        .filter(Boolean);
    }

    function normalized(text) {
      return String(text || "")
        .toLowerCase()
        .replace(/[\s\-_'’·.。()（）[\]]/g, "");
    }

    function teamToDraft(team) {
      if (!team) return null;
      return {
        name: team.name || "我的队伍",
        members: (team.members || []).map((member) => ({
          ...member,
          poolText: (member.heroPool || []).join("，"),
        })),
      };
    }

    function heroImage(hero, className = "") {
      return h("img", {
        className,
        src: hero.img || hero.icon,
        alt: hero.name || "",
        loading: "lazy",
        draggable: false,
        onError: (event) => {
          event.currentTarget.style.visibility = "hidden";
        },
      });
    }

    function Icon({ name, size = 16 }) {
      const common = {
        width: size,
        height: size,
        viewBox: "0 0 24 24",
        fill: "none",
        stroke: "currentColor",
        strokeWidth: 1.8,
        strokeLinecap: "round",
        strokeLinejoin: "round",
        "aria-hidden": true,
      };
      if (name === "refresh") {
        return h(
          "svg",
          common,
          h("path", { d: "M20 11a8 8 0 1 0-2.3 6.3" }),
          h("path", { d: "M20 4v7h-7" }),
        );
      }
      if (name === "search") {
        return h(
          "svg",
          common,
          h("circle", { cx: 11, cy: 11, r: 7 }),
          h("path", { d: "m20 20-3.5-3.5" }),
        );
      }
      if (name === "close") {
        return h("svg", common, h("path", { d: "m6 6 12 12M18 6 6 18" }));
      }
      if (name === "plus") {
        return h("svg", common, h("path", { d: "M12 5v14M5 12h14" }));
      }
      if (name === "clock") {
        return h(
          "svg",
          common,
          h("circle", { cx: 12, cy: 12, r: 8.5 }),
          h("path", { d: "M12 7v5l3 2" }),
        );
      }
      if (name === "shield") {
        return h(
          "svg",
          common,
          h("path", {
            d: "M12 3 5 6v5c0 4.2 2.8 7.5 7 10 4.2-2.5 7-5.8 7-10V6l-7-3Z",
          }),
        );
      }
      if (name === "chevron") {
        return h("svg", common, h("path", { d: "m8 10 4 4 4-4" }));
      }
      return h("svg", common, h("circle", { cx: 12, cy: 12, r: 8 }));
    }

    function Score({ value, small = false }) {
      const tone = value >= 82 ? "high" : value >= 68 ? "mid" : "low";
      return h(
        "span",
        {
          className: `d2bp-score d2bp-score-${tone}${small ? " d2bp-score-sm" : ""}`,
        },
        Math.round(value),
      );
    }

    function HeroThumb({ hero, size = "md" }) {
      return h(
        "div",
        { className: `d2bp-thumb d2bp-thumb-${size}` },
        heroImage(hero, "d2bp-thumb-img"),
        h(
          "span",
          { className: "d2bp-thumb-letter" },
          (hero.name || "?").slice(0, 1),
        ),
      );
    }

    function Dota2bpIcon({ size = 20, active = false, onClick }) {
      return h(
        "svg",
        {
          width: size,
          height: size,
          viewBox: "0 0 24 24",
          fill: "none",
          "aria-label": "Dota2bp",
          role: "img",
          onClick,
          style: {
            cursor: "pointer",
            display: "block",
            color: active ? "var(--dsw-alias-brand-primary)" : "currentColor",
          },
        },
        h("path", {
          d: "M12 2.5 4.5 5.6v5.2c0 4.7 3.1 8.4 7.5 10.7 4.4-2.3 7.5-6 7.5-10.7V5.6L12 2.5Z",
          stroke: "currentColor",
          strokeWidth: 1.6,
          strokeLinejoin: "round",
          fill: active
            ? "color-mix(in srgb, currentColor 16%, transparent)"
            : "none",
        }),
        h("path", {
          d: "m8.6 8.2 6.8 6.8M15.4 8.2l-6.8 6.8",
          stroke: "currentColor",
          strokeWidth: 1.7,
          strokeLinecap: "round",
        }),
        h("path", {
          d: "m8.5 8.2-1.8-.5.5 1.8M15.5 8.2l1.8-.5-.5 1.8",
          stroke: "currentColor",
          strokeWidth: 1.3,
          strokeLinecap: "round",
          strokeLinejoin: "round",
        }),
      );
    }

    function Dota2bpApp() {
      const [state, setState] = useState(null);
      const [teamDraft, setTeamDraft] = useState(null);
      const [recommendation, setRecommendation] = useState(null);
      const [loading, setLoading] = useState(true);
      const [busy, setBusy] = useState("");
      const [error, setError] = useState("");
      const [notice, setNotice] = useState("");
      const [picker, setPicker] = useState(null);
      const [query, setQuery] = useState("");
      const [now, setNow] = useState(Date.now());
      const [showSetup, setShowSetup] = useState(true);
      const [showAllMembers, setShowAllMembers] = useState(false);
      const teamDirty = useRef(false);
      const alive = useRef(true);
      const autoRecommend = useRef(false);

      useEffect(() => {
        const timer = setInterval(() => setNow(Date.now()), 1000);
        return () => {
          alive.current = false;
          clearInterval(timer);
        };
      }, []);

      useEffect(() => {
        let cancelled = false;
        (async () => {
          try {
            const data = await requestState();
            if (cancelled) return;
            setState(data);
            setTeamDraft(teamToDraft(data.team));
            setLoading(false);
            if (data.ready) {
              const result = await requestAction("recommend");
              if (cancelled) return;
              if (result.recommendation)
                setRecommendation(result.recommendation);
            }
          } catch (cause) {
            if (!cancelled) {
              setError(cause.message);
              setLoading(false);
            }
          }
        })();
        return () => {
          cancelled = true;
        };
      }, []);

      useEffect(() => {
        if (!state?.refreshing) return undefined;
        const timer = setInterval(async () => {
          try {
            const data = await requestState();
            if (!alive.current) return;
            setState(data);
            if (!data.refreshing && data.ready && !recommendation) {
              const result = await requestAction("recommend");
              if (result.recommendation)
                setRecommendation(result.recommendation);
            }
          } catch {
            // Keep the last usable data; the status line reports the next attempt.
          }
        }, 3200);
        return () => clearInterval(timer);
      }, [state?.refreshing, recommendation]);

      useEffect(() => {
        if (!state?.ready || recommendation || autoRecommend.current) return;
        autoRecommend.current = true;
        requestAction("recommend")
          .then((result) => {
            if (result.recommendation) setRecommendation(result.recommendation);
          })
          .catch((cause) => setError(cause.message));
      }, [state?.ready, recommendation]);

      useEffect(() => {
        if (!picker) return undefined;
        const onKey = (event) => {
          if (event.key === "Escape") setPicker(null);
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
      }, [picker]);

      const members = state?.team?.members || [];
      const ourPicks = state?.draft?.our || [];
      const enemyPicks = state?.draft?.enemy || [];
      const heroes = state?.heroes || [];
      const heroById = useMemo(
        () => new Map(heroes.map((hero) => [Number(hero.id), hero])),
        [heroes],
      );
      const activeMembers = useMemo(
        () => members.filter((member) => member.active !== false),
        [members],
      );
      const openMembers = useMemo(
        () =>
          activeMembers.filter(
            (member) => !ourPicks.some((pick) => pick.memberId === member.id),
          ),
        [activeMembers, ourPicks],
      );
      const unassignedPicks = useMemo(
        () => ourPicks.filter((pick) => !pick.memberId),
        [ourPicks],
      );
      const fillSlots = Math.max(
        0,
        5 - activeMembers.length - unassignedPicks.length,
      );
      const sourceInfo = state?.source || {
        id: state?.dataSource || "high",
        label: "高分段",
        detail: "",
      };
      const phase = state?.draft?.phase || {
        round: 1,
        need: 2,
        remaining: 5,
        complete: false,
      };
      const remaining =
        state?.draft?.phaseStartedAt && (ourPicks.length || enemyPicks.length)
          ? Math.max(
              0,
              20 -
                Math.floor(
                  (now - Date.parse(state.draft.phaseStartedAt)) / 1000,
                ),
            )
          : 20;
      const remainingRatio = Math.min(100, Math.max(0, (remaining / 20) * 100));
      const activeMember = picker?.memberId
        ? activeMembers.find((member) => member.id === picker.memberId)
        : null;

      function adopt(data, options = {}) {
        if (!data) return;
        if (data.state) {
          setState(data.state);
          if (options.team || !teamDirty.current)
            setTeamDraft(teamToDraft(data.state.team));
        }
        if (data.recommendation) setRecommendation(data.recommendation);
        if (data.state?.ignoredHeroes?.length) {
          setNotice(
            `已忽略无法识别的英雄池名称：${data.state.ignoredHeroes.join("、")}`,
          );
        }
      }

      async function run(label, task) {
        if (busy) return;
        setBusy(label);
        setError("");
        try {
          return await task();
        } catch (cause) {
          setError(cause.message);
        } finally {
          setBusy("");
        }
      }

      async function saveTeam() {
        if (!teamDraft) return;
        await run("save-team", async () => {
          teamDirty.current = false;
          const data = await requestAction("team", {
            team: {
              name: teamDraft.name,
              members: teamDraft.members.map((member) => ({
                id: member.id,
                name: member.name,
                position: Number(member.position),
                active: member.active !== false,
                hero_pool: splitPool(member.poolText),
              })),
            },
          });
          adopt(data);
          setNotice("阵容与英雄池已保存。");
        });
      }

      async function saveDraftPicks(picks) {
        return run("picks", async () => {
          const data = await requestAction("add_picks", { picks });
          adopt(data);
        });
      }

      async function removePick(side, heroId) {
        await run("remove", async () => {
          const data = await requestAction("remove_pick", { side, heroId });
          adopt(data);
        });
      }

      async function resetDraft() {
        await run("reset", async () => {
          const data = await requestAction("reset");
          adopt(data);
        });
      }

      async function refreshData() {
        await run("refresh", async () => {
          const data = await requestAction("refresh");
          adopt(data);
          setNotice("已开始更新，英雄克制关系采集约需 2-3 分钟。");
        });
      }

      async function changeSource(source) {
        if (!source || source === state?.dataSource) return;
        await run("source", async () => {
          const data = await requestAction("source", { source });
          adopt(data);
          const label =
            data.state?.source?.label ||
            data.state?.dataSources?.find((item) => item.id === source)
              ?.label ||
            source;
          setNotice(`数据口径已切换为「${label}」，模型已按该分段重训。`);
        });
      }

      async function refreshRecommendation() {
        await run("recommend", async () => {
          const data = await requestAction("recommend");
          if (data.recommendation) setRecommendation(data.recommendation);
          if (data.state) setState(data.state);
        });
      }

      async function addSquad(squad) {
        const picks = squad.heroes.map((item) => ({
          side: "our",
          hero: item.heroId,
          memberId: item.member?.id,
        }));
        await saveDraftPicks(picks);
      }

      async function addSingle(candidate) {
        await saveDraftPicks([
          {
            side: "our",
            hero: candidate.heroId,
            memberId: candidate.member?.id,
          },
        ]);
      }

      function openPicker(side, memberId = null) {
        const fallback =
          memberId || (side === "our" ? openMembers[0]?.id : null);
        setPicker({ side, memberId: fallback });
        setQuery("");
      }

      async function chooseHero(hero) {
        if (!picker) return;
        const side = picker.side;
        const picks = [
          {
            side,
            hero: hero.id,
            memberId: side === "our" ? picker.memberId : undefined,
          },
        ];
        setPicker(null);
        await saveDraftPicks(picks);
      }

      function updateMember(index, field, value) {
        teamDirty.current = true;
        setTeamDraft((current) => {
          if (!current) return current;
          const next = current.members.map((member, memberIndex) =>
            memberIndex === index ? { ...member, [field]: value } : member,
          );
          return { ...current, members: next };
        });
      }

      const pickedIds = useMemo(
        () =>
          new Set(
            [...ourPicks, ...enemyPicks].map((pick) => Number(pick.heroId)),
          ),
        [ourPicks, enemyPicks],
      );

      const pickerHeroes = useMemo(() => {
        const term = normalized(query);
        const filtered = heroes.filter(
          (hero) => !term || hero.searchText.includes(term),
        );
        const sorted = filtered.slice().sort((a, b) => {
          const aPool = activeMember?.heroPoolIds?.includes(Number(a.id))
            ? 1
            : 0;
          const bPool = activeMember?.heroPoolIds?.includes(Number(b.id))
            ? 1
            : 0;
          if (aPool !== bPool) return bPool - aPool;
          return (b.winrate || 0) - (a.winrate || 0);
        });
        return term ? sorted : sorted.slice(0, 80);
      }, [heroes, query, activeMember]);

      if (loading) {
        return h(
          "div",
          { className: "d2bp-root d2bp-center-state" },
          h("style", null, STYLE),
          h("div", { className: "d2bp-spinner" }),
          h("p", null, "正在加载 Dota2bp…"),
        );
      }

      if (!state) {
        return h(
          "div",
          { className: "d2bp-root d2bp-center-state" },
          h("style", null, STYLE),
          h(Icon, { name: "shield", size: 34 }),
          h("h2", null, "Dota2bp 暂时不可用"),
          h("p", null, error || "宿主端没有返回数据。"),
          h(
            "button",
            {
              className: "d2bp-btn d2bp-btn-primary",
              onClick: () => window.location.reload(),
            },
            "重新加载",
          ),
        );
      }

      const ready = Boolean(state.ready);
      const data = state.data;
      const model = state.model;
      const isRefreshing = Boolean(state.refreshing);
      const disabled = Boolean(busy);

      function renderSquad(squad, index) {
        return h(
          "div",
          { className: "d2bp-squad", key: index },
          h(
            "div",
            { className: "d2bp-squad-top" },
            h("span", { className: "d2bp-squad-index" }, `方案 ${index + 1}`),
            h(
              "span",
              { className: "d2bp-squad-score" },
              h(Score, { value: squad.score }),
              "综合分",
            ),
          ),
          h(
            "div",
            { className: "d2bp-squad-heroes" },
            squad.heroes.map((item) =>
              h(
                "div",
                { className: "d2bp-squad-hero", key: item.heroId },
                heroImage(item, "d2bp-squad-img"),
                h(
                  "div",
                  null,
                  h("strong", null, item.name),
                  h(
                    "span",
                    null,
                    `${item.member?.name || "补位"} · ${item.member?.fill ? "补位" : "参战"}`,
                  ),
                ),
              ),
            ),
          ),
          h(
            "div",
            { className: "d2bp-chips" },
            squad.reasons
              .slice(0, 3)
              .map((reason) =>
                h("span", { className: "d2bp-chip", key: reason }, reason),
              ),
          ),
          h(
            "button",
            {
              className: "d2bp-btn d2bp-btn-primary d2bp-btn-block",
              onClick: () => addSquad(squad),
              disabled:
                disabled ||
                squad.heroes.some((item) => pickedIds.has(Number(item.heroId))),
            },
            "采用这组",
          ),
        );
      }

      return h(
        "div",
        { className: "d2bp-root" },
        h("style", null, STYLE),
        h(
          "div",
          { className: "d2bp-shell" },
          h(
            "header",
            { className: "d2bp-header" },
            h(
              "div",
              { className: "d2bp-brand" },
              h(
                "div",
                { className: "d2bp-brand-mark" },
                h(Dota2bpIcon, { size: 30, active: true }),
              ),
              h(
                "div",
                null,
                h("div", { className: "d2bp-eyebrow" }, "DOTA 2 · 天梯征召"),
                h("h1", null, "Dota2bp"),
                h("p", null, "无 Ban · 2-2-1 同步选人 · 每日数据更新"),
              ),
            ),
            h(
              "div",
              { className: "d2bp-header-actions" },
              h(
                "button",
                {
                  className: "d2bp-btn d2bp-btn-primary",
                  disabled: disabled || isRefreshing,
                  onClick: refreshData,
                  title:
                    "立即从 OpenDota 重新采集胜率与克制关系，并重新训练模型",
                },
                h(Icon, { name: "refresh", size: 15 }),
                isRefreshing ? "更新中…" : "更新数据",
              ),
              h(
                "button",
                {
                  className: "d2bp-btn",
                  disabled: disabled,
                  onClick: resetDraft,
                  title: "清空当前征召并开始新一局",
                },
                "新一局",
              ),
            ),
          ),

          h(
            "div",
            { className: "d2bp-status" },
            h(
              "div",
              { className: "d2bp-status-item" },
              h("span", { className: "d2bp-status-label" }, "数据时间"),
              h("strong", null, formatDate(data?.fetchedAt)),
              h(
                "span",
                { className: "d2bp-status-sub" },
                formatAge(data?.ageHours),
              ),
            ),
            h(
              "div",
              { className: "d2bp-status-item" },
              h("span", { className: "d2bp-status-label" }, "英雄样本"),
              h("strong", null, data ? `${data.heroCount} 位` : "—"),
              h(
                "span",
                { className: "d2bp-status-sub" },
                data
                  ? `${data.matchupRows.toLocaleString("zh-CN")} 条对位`
                  : "等待采集",
              ),
            ),
            h(
              "div",
              { className: "d2bp-status-item" },
              h("span", { className: "d2bp-status-label" }, "模型"),
              h("strong", null, model?.version || "—"),
              h(
                "span",
                { className: "d2bp-status-sub" },
                model?.logLoss ? `LogLoss ${model.logLoss}` : "每日重训",
              ),
            ),
            h(
              "div",
              { className: "d2bp-status-item d2bp-status-grow" },
              h("span", { className: "d2bp-status-label" }, "数据源"),
              h("strong", null, data?.source || "OpenDota + Valve"),
              h(
                "span",
                { className: "d2bp-status-sub" },
                data?.fromSeed
                  ? "内置种子数据，已准备自动更新"
                  : "自动更新已启用",
              ),
            ),
            isRefreshing
              ? h(
                  "div",
                  { className: "d2bp-refresh-state" },
                  h(
                    "div",
                    { className: "d2bp-refresh-line" },
                    h(Icon, { name: "refresh", size: 14 }),
                    h("span", null, state.progress?.message || "正在更新…"),
                  ),
                  h(
                    "div",
                    { className: "d2bp-progress" },
                    h("div", {
                      className: "d2bp-progress-fill",
                      style: {
                        width: state.progress?.total
                          ? `${Math.round((state.progress.current / state.progress.total) * 100)}%`
                          : "12%",
                      },
                    }),
                  ),
                )
              : null,
          ),

          error
            ? h(
                "div",
                { className: "d2bp-alert d2bp-alert-error" },
                h("strong", null, "操作失败："),
                h("span", null, error),
                h(
                  "button",
                  {
                    className: "d2bp-icon-btn",
                    onClick: () => setError(""),
                    "aria-label": "关闭",
                  },
                  h(Icon, { name: "close", size: 14 }),
                ),
              )
            : null,
          notice
            ? h(
                "div",
                { className: "d2bp-alert" },
                h("span", null, notice),
                h(
                  "button",
                  {
                    className: "d2bp-icon-btn",
                    onClick: () => setNotice(""),
                    "aria-label": "关闭",
                  },
                  h(Icon, { name: "close", size: 14 }),
                ),
              )
            : null,

          h(
            "div",
            { className: "d2bp-layout" },
            h(
              "main",
              { className: "d2bp-main" },
              h(
                "section",
                { className: "d2bp-card d2bp-draft-card" },
                h(
                  "div",
                  { className: "d2bp-card-head" },
                  h(
                    "div",
                    null,
                    h("h2", null, "征召板"),
                    h(
                      "p",
                      null,
                      phase.complete
                        ? "本局选人已完成"
                        : `第 ${phase.round} 轮 · 双方各选 ${phase.need || 0} 个英雄`,
                    ),
                  ),
                  h(
                    "div",
                    { className: "d2bp-rounds" },
                    [1, 2, 3].map((round) =>
                      h(
                        "span",
                        {
                          key: round,
                          className: `d2bp-round${phase.round === round && !phase.complete ? " is-active" : ""}${phase.round > round || phase.complete ? " is-done" : ""}`,
                        },
                        round,
                      ),
                    ),
                  ),
                ),
                h(
                  "div",
                  { className: "d2bp-timer-row" },
                  h(
                    "div",
                    {
                      className: `d2bp-timer${remaining <= 5 ? " is-low" : ""}`,
                    },
                    h(Icon, { name: "clock", size: 15 }),
                    h("strong", null, `${remaining}s`),
                    h("span", null, "本轮倒计时"),
                  ),
                  h(
                    "div",
                    { className: "d2bp-timer-track" },
                    h("div", {
                      className: "d2bp-timer-fill",
                      style: { width: `${remainingRatio}%` },
                    }),
                  ),
                ),
                h(
                  "div",
                  { className: "d2bp-board" },
                  h(
                    "div",
                    { className: "d2bp-team" },
                    h(
                      "div",
                      { className: "d2bp-team-head" },
                      h(
                        "div",
                        null,
                        h(
                          "span",
                          { className: "d2bp-team-tag is-our" },
                          "我方",
                        ),
                        h("strong", null, `${ourPicks.length}/5`),
                      ),
                      ready && ourPicks.length < 5
                        ? h(
                            "button",
                            {
                              className: "d2bp-link-btn",
                              onClick: () => openPicker("our"),
                              disabled,
                            },
                            h(Icon, { name: "plus", size: 13 }),
                            "选人",
                          )
                        : null,
                    ),
                    h(
                      "div",
                      { className: "d2bp-slots" },
                      activeMembers.map((member) => {
                        const pick = ourPicks.find(
                          (item) => item.memberId === member.id,
                        );
                        return h(
                          "div",
                          {
                            className: `d2bp-slot${pick ? " has-pick" : ""}`,
                            key: member.id,
                          },
                          h(
                            "span",
                            { className: "d2bp-slot-pos" },
                            member.name || `队员 ${member.position}`,
                          ),
                          h("span", { className: "d2bp-slot-role" }, "参战"),
                          pick
                            ? h(
                                "div",
                                { className: "d2bp-slot-hero" },
                                heroImage(
                                  heroById.get(Number(pick.heroId)) || {
                                    name: pick.name,
                                    img: pick.icon,
                                  },
                                  "d2bp-slot-img",
                                ),
                                h("span", null, pick.name),
                                h(
                                  "button",
                                  {
                                    className: "d2bp-remove",
                                    onClick: () =>
                                      removePick("our", pick.heroId),
                                    disabled,
                                    title: "移除该英雄",
                                    "aria-label": `移除 ${pick.name}`,
                                  },
                                  h(Icon, { name: "close", size: 12 }),
                                ),
                              )
                            : h(
                                "button",
                                {
                                  className: "d2bp-slot-empty",
                                  onClick: () => openPicker("our", member.id),
                                  disabled,
                                },
                                h(Icon, { name: "plus", size: 13 }),
                                "选人",
                              ),
                        );
                      }),
                      [
                        ...unassignedPicks.map((pick, index) =>
                          h(
                            "div",
                            {
                              className: "d2bp-slot has-pick",
                              key: `fill-pick-${pick.heroId}-${index}`,
                            },
                            h("span", { className: "d2bp-slot-pos" }, "补位"),
                            h(
                              "span",
                              { className: "d2bp-slot-role" },
                              "路人/未录入",
                            ),
                            h(
                              "div",
                              { className: "d2bp-slot-hero" },
                              heroImage(
                                heroById.get(Number(pick.heroId)) || {
                                  name: pick.name,
                                  img: pick.icon,
                                },
                                "d2bp-slot-img",
                              ),
                              h("span", null, pick.name),
                              h(
                                "button",
                                {
                                  className: "d2bp-remove",
                                  onClick: () => removePick("our", pick.heroId),
                                  disabled,
                                  title: "移除该英雄",
                                  "aria-label": `移除 ${pick.name}`,
                                },
                                h(Icon, { name: "close", size: 12 }),
                              ),
                            ),
                          ),
                        ),
                        ...Array.from({ length: fillSlots }, (_, index) =>
                          h(
                            "div",
                            {
                              className: "d2bp-slot",
                              key: `fill-slot-${index}`,
                            },
                            h(
                              "span",
                              { className: "d2bp-slot-pos" },
                              `补位 ${unassignedPicks.length + index + 1}`,
                            ),
                            h(
                              "span",
                              { className: "d2bp-slot-role" },
                              "路人/未录入",
                            ),
                            h(
                              "button",
                              {
                                className: "d2bp-slot-empty",
                                onClick: () => openPicker("our"),
                                disabled,
                              },
                              h(Icon, { name: "plus", size: 13 }),
                              "选人",
                            ),
                          ),
                        ),
                      ],
                    ),
                    !activeMembers.length
                      ? h(
                          "div",
                          { className: "d2bp-board-warning" },
                          "还没有勾选本局参战成员。请先在右侧队伍配置中勾选。",
                        )
                      : null,
                    h("div", { className: "d2bp-vs" }, h("span", null, "VS")),
                    h(
                      "div",
                      { className: "d2bp-team" },
                      h(
                        "div",
                        { className: "d2bp-team-head" },
                        h(
                          "div",
                          null,
                          h(
                            "span",
                            { className: "d2bp-team-tag is-enemy" },
                            "敌方",
                          ),
                          h("strong", null, `${enemyPicks.length}/5`),
                        ),
                        ready && enemyPicks.length < 5
                          ? h(
                              "button",
                              {
                                className: "d2bp-link-btn",
                                onClick: () => openPicker("enemy"),
                                disabled,
                              },
                              h(Icon, { name: "plus", size: 13 }),
                              "录入",
                            )
                          : null,
                      ),
                      h(
                        "div",
                        { className: "d2bp-slots" },
                        [0, 1, 2, 3, 4].map((index) => {
                          const pick = enemyPicks[index];
                          return h(
                            "div",
                            {
                              className: `d2bp-slot${pick ? " has-pick" : ""}`,
                              key: index,
                            },
                            h(
                              "span",
                              { className: "d2bp-slot-pos" },
                              `敌方 ${index + 1}`,
                            ),
                            pick
                              ? h(
                                  "div",
                                  { className: "d2bp-slot-hero" },
                                  heroImage(
                                    heroById.get(Number(pick.heroId)) || {
                                      name: pick.name,
                                      img: pick.icon,
                                    },
                                    "d2bp-slot-img",
                                  ),
                                  h("span", null, pick.name),
                                  h(
                                    "button",
                                    {
                                      className: "d2bp-remove",
                                      onClick: () =>
                                        removePick("enemy", pick.heroId),
                                      disabled,
                                      title: "移除该英雄",
                                      "aria-label": `移除 ${pick.name}`,
                                    },
                                    h(Icon, { name: "close", size: 12 }),
                                  ),
                                )
                              : h(
                                  "span",
                                  { className: "d2bp-slot-wait" },
                                  "等待录入",
                                ),
                          );
                        }),
                      ),
                    ),
                  ),
                  h(
                    "div",
                    { className: "d2bp-board-foot" },
                    h(
                      "span",
                      null,
                      `我方还需 ${Math.max(0, 5 - ourPicks.length)} 个英雄`,
                    ),
                    phase.complete
                      ? h(
                          "span",
                          { className: "d2bp-foot-ok" },
                          "选人完成，进入对局",
                        )
                      : h("span", null, "每个环节约 20 秒，建议先锁定双人组合"),
                  ),
                ),

                h(
                  "section",
                  { className: "d2bp-card d2bp-rec-card" },
                  h(
                    "div",
                    { className: "d2bp-card-head" },
                    h(
                      "div",
                      null,
                      h("h2", null, "选人建议"),
                      h(
                        "p",
                        null,
                        recommendation?.phase?.label ||
                          "根据英雄池、对位与阵容结构生成",
                      ),
                    ),
                    h(
                      "button",
                      {
                        className: "d2bp-btn d2bp-btn-small",
                        onClick: refreshRecommendation,
                        disabled: disabled || !ready,
                      },
                      h(Icon, { name: "refresh", size: 13 }),
                      "刷新",
                    ),
                  ),
                  !ready
                    ? h(
                        "div",
                        { className: "d2bp-empty" },
                        h("strong", null, "数据尚未就绪"),
                        h(
                          "p",
                          null,
                          state.error || "请点击右上角“更新数据”采集英雄数据。",
                        ),
                      )
                    : !recommendation
                      ? h(
                          "div",
                          { className: "d2bp-empty" },
                          h("div", { className: "d2bp-spinner" }),
                          h("p", null, "正在生成推荐…"),
                        )
                      : h(
                          "div",
                          { className: "d2bp-rec-body" },
                          recommendation.prediction
                            ? h(
                                "div",
                                { className: "d2bp-prediction" },
                                h(
                                  "div",
                                  { className: "d2bp-prediction-head" },
                                  h(
                                    "div",
                                    null,
                                    h(
                                      "span",
                                      { className: "d2bp-prediction-eyebrow" },
                                      "BP 完成 · 预测胜率",
                                    ),
                                    h(
                                      "strong",
                                      { className: "d2bp-prediction-value" },
                                      `${recommendation.prediction.percent}%`,
                                    ),
                                  ),
                                  h(
                                    "span",
                                    { className: "d2bp-prediction-confidence" },
                                    `置信度 ${recommendation.prediction.confidence}`,
                                  ),
                                ),
                                h(
                                  "div",
                                  { className: "d2bp-prediction-track" },
                                  h("div", {
                                    className: "d2bp-prediction-fill",
                                    style: {
                                      width: `${recommendation.prediction.percent}%`,
                                    },
                                  }),
                                ),
                                h(
                                  "div",
                                  { className: "d2bp-prediction-meta" },
                                  h(
                                    "span",
                                    null,
                                    `对位样本 ${recommendation.prediction.pairRows} 组 / ${recommendation.prediction.sampleGames.toLocaleString("zh-CN")} 局`,
                                  ),
                                  h(
                                    "span",
                                    null,
                                    `阵容覆盖 ${recommendation.prediction.ourCoverage}% vs ${recommendation.prediction.enemyCoverage}%`,
                                  ),
                                ),
                                h(
                                  "p",
                                  { className: "d2bp-prediction-note" },
                                  recommendation.prediction.note,
                                ),
                              )
                            : phase.complete
                              ? h(
                                  "div",
                                  {
                                    className:
                                      "d2bp-prediction d2bp-prediction-pending",
                                  },
                                  h("strong", null, "BP 已完成"),
                                  h(
                                    "span",
                                    null,
                                    "录入敌方 5 名英雄后生成预测胜率。",
                                  ),
                                )
                              : null,
                          recommendation.squads?.length
                            ? h(
                                "div",
                                null,
                                h(
                                  "div",
                                  { className: "d2bp-subhead" },
                                  h("h3", null, "本轮双选组合"),
                                  h(
                                    "span",
                                    null,
                                    "一次锁定两名成员，降低配合失误",
                                  ),
                                ),
                                h(
                                  "div",
                                  { className: "d2bp-squads" },
                                  recommendation.squads.map(renderSquad),
                                ),
                              )
                            : null,

                          h(
                            "div",
                            { className: "d2bp-subhead d2bp-subhead-gap" },
                            h(
                              "h3",
                              null,
                              phase.complete
                                ? "本局推荐"
                                : `第 ${phase.round} 轮单点首选`,
                            ),
                            h(
                              "span",
                              null,
                              phase.need === 2
                                ? "可先在组合中选，再按英雄池微调"
                                : "最后一个位置，优先补强",
                            ),
                          ),
                          h(
                            "div",
                            { className: "d2bp-candidates" },
                            (recommendation.topPicks || [])
                              .slice(0, 6)
                              .map((candidate) =>
                                h(
                                  "div",
                                  {
                                    className: "d2bp-cand",
                                    key: `${candidate.member?.id}-${candidate.heroId}`,
                                  },
                                  h(HeroThumb, { hero: candidate }),
                                  h(
                                    "div",
                                    { className: "d2bp-cand-main" },
                                    h(
                                      "div",
                                      { className: "d2bp-cand-title" },
                                      h("strong", null, candidate.name),
                                      h(
                                        "span",
                                        { className: "d2bp-cand-pos" },
                                        candidate.member?.name ||
                                          candidate.positionName ||
                                          "补位",
                                      ),
                                      candidate.inPool
                                        ? h(
                                            "span",
                                            { className: "d2bp-badge" },
                                            "英雄池",
                                          )
                                        : null,
                                    ),
                                    h(
                                      "div",
                                      { className: "d2bp-cand-meta" },
                                      h(
                                        "span",
                                        null,
                                        `${candidate.winrateSourceLabel || sourceInfo.label} ${pct(candidate.winrate)}`,
                                      ),
                                      h(
                                        "span",
                                        null,
                                        candidate.winrateGames
                                          ? `样本 ${candidate.winrateGames.toLocaleString("zh-CN")} 局`
                                          : "样本较少",
                                      ),
                                    ),
                                    h(
                                      "div",
                                      { className: "d2bp-cand-reasons" },
                                      (candidate.reasons || [])
                                        .slice(0, 3)
                                        .map((reason) =>
                                          h("span", { key: reason }, reason),
                                        ),
                                    ),
                                  ),
                                  h(
                                    "div",
                                    { className: "d2bp-cand-side" },
                                    h(Score, { value: candidate.score }),
                                    h(
                                      "button",
                                      {
                                        className:
                                          "d2bp-btn d2bp-btn-small d2bp-btn-primary",
                                        onClick: () => addSingle(candidate),
                                        disabled:
                                          disabled ||
                                          pickedIds.has(
                                            Number(candidate.heroId),
                                          ),
                                      },
                                      "选",
                                    ),
                                  ),
                                ),
                              ),
                          ),

                          recommendation.perMember?.length
                            ? h(
                                "div",
                                { className: "d2bp-member-recs" },
                                h(
                                  "div",
                                  {
                                    className: "d2bp-subhead d2bp-subhead-gap",
                                  },
                                  h("h3", null, "分位置备选"),
                                  h(
                                    "button",
                                    {
                                      className: "d2bp-link-btn",
                                      onClick: () =>
                                        setShowAllMembers((value) => !value),
                                    },
                                    showAllMembers ? "收起" : "展开全部",
                                  ),
                                ),
                                (showAllMembers
                                  ? recommendation.perMember
                                  : recommendation.perMember.slice(0, 2)
                                ).map((entry) =>
                                  h(
                                    "div",
                                    {
                                      className: "d2bp-member-rec",
                                      key: entry.member.id,
                                    },
                                    h(
                                      "div",
                                      { className: "d2bp-member-head" },
                                      h("strong", null, entry.member.name),
                                      h(
                                        "span",
                                        null,
                                        `${entry.member.name} · ${entry.member.fill ? "补位" : "参战"}`,
                                      ),
                                    ),
                                    h(
                                      "div",
                                      { className: "d2bp-member-list" },
                                      entry.picks.map((candidate) =>
                                        h(
                                          "button",
                                          {
                                            className: "d2bp-mini-cand",
                                            key: candidate.heroId,
                                            onClick: () => addSingle(candidate),
                                            disabled:
                                              disabled ||
                                              pickedIds.has(
                                                Number(candidate.heroId),
                                              ),
                                            title: (
                                              candidate.reasons || []
                                            ).join(" · "),
                                          },
                                          heroImage(candidate, "d2bp-mini-img"),
                                          h(
                                            "span",
                                            { className: "d2bp-mini-name" },
                                            candidate.name,
                                          ),
                                          h(
                                            "span",
                                            { className: "d2bp-mini-score" },
                                            Math.round(candidate.score),
                                          ),
                                        ),
                                      ),
                                    ),
                                  ),
                                ),
                              )
                            : null,

                          recommendation.avoid?.length
                            ? h(
                                "div",
                                { className: "d2bp-avoid" },
                                h(
                                  "div",
                                  { className: "d2bp-subhead" },
                                  h("h3", null, "对位谨慎"),
                                ),
                                recommendation.avoid.map((item) =>
                                  h(
                                    "div",
                                    {
                                      className: "d2bp-avoid-item",
                                      key: item.heroId,
                                    },
                                    heroImage(item, "d2bp-mini-img"),
                                    h("strong", null, item.name),
                                    h("span", null, item.reason),
                                  ),
                                ),
                              )
                            : null,

                          recommendation.warnings?.length
                            ? h(
                                "div",
                                { className: "d2bp-warnings" },
                                recommendation.warnings.map((warning) =>
                                  h("p", { key: warning }, warning),
                                ),
                              )
                            : null,
                        ),
                ),
              ),

              h(
                "aside",
                { className: "d2bp-rail" },
                h(
                  "section",
                  { className: "d2bp-card" },
                  h(
                    "div",
                    { className: "d2bp-card-head" },
                    h(
                      "div",
                      null,
                      h("h2", null, "队伍配置"),
                      h(
                        "p",
                        null,
                        "勾选本局参战成员；分路不固定，英雄池可跨多个位置",
                      ),
                    ),
                    h(
                      "button",
                      {
                        className: "d2bp-link-btn",
                        onClick: () => setShowSetup((value) => !value),
                      },
                      showSetup ? "收起" : "编辑",
                    ),
                  ),
                  showSetup && teamDraft
                    ? h(
                        "div",
                        { className: "d2bp-team-editor" },
                        h(
                          "label",
                          { className: "d2bp-field" },
                          h("span", null, "队伍名称"),
                          h("input", {
                            className: "d2bp-input",
                            value: teamDraft.name,
                            onChange: (event) => {
                              teamDirty.current = true;
                              setTeamDraft({
                                ...teamDraft,
                                name: event.target.value,
                              });
                            },
                          }),
                        ),
                        teamDraft.members.map((member, index) =>
                          h(
                            "div",
                            {
                              className: "d2bp-member-edit",
                              key: member.id || index,
                            },
                            h(
                              "div",
                              { className: "d2bp-member-edit-top" },
                              h("input", {
                                className: "d2bp-input d2bp-input-name",
                                value: member.name,
                                placeholder: "成员名",
                                onChange: (event) =>
                                  updateMember(
                                    index,
                                    "name",
                                    event.target.value,
                                  ),
                              }),
                              h(
                                "label",
                                { className: "d2bp-check" },
                                h("input", {
                                  type: "checkbox",
                                  checked: member.active !== false,
                                  onChange: (event) =>
                                    updateMember(
                                      index,
                                      "active",
                                      event.target.checked,
                                    ),
                                }),
                                "本局参战",
                              ),
                            ),
                            h("textarea", {
                              className: "d2bp-textarea",
                              rows: 2,
                              value: member.poolText || "",
                              placeholder:
                                "英雄池：敌法师，火猫，潮汐，拉比克…",
                              onChange: (event) =>
                                updateMember(
                                  index,
                                  "poolText",
                                  event.target.value,
                                ),
                            }),
                          ),
                        ),
                        h(
                          "div",
                          { className: "d2bp-editor-foot" },
                          h("span", null, "支持中文名与常见外号"),
                          h(
                            "button",
                            {
                              className:
                                "d2bp-btn d2bp-btn-primary d2bp-btn-small",
                              onClick: saveTeam,
                              disabled,
                            },
                            busy === "save-team" ? "保存中…" : "保存阵容",
                          ),
                        ),
                      )
                    : h(
                        "div",
                        { className: "d2bp-roster-summary" },
                        members.map((member) =>
                          h(
                            "div",
                            { className: "d2bp-roster-row", key: member.id },
                            h("span", null, member.name),
                            h(
                              "span",
                              member.active === false ? "未参战" : "参战",
                            ),
                            h(
                              "span",
                              { className: "d2bp-roster-pool" },
                              member.heroPool?.length
                                ? `${member.heroPool.length} 个英雄`
                                : "未配置",
                            ),
                          ),
                        ),
                      ),
                ),

                h(
                  "section",
                  { className: "d2bp-card d2bp-data-card" },
                  h(
                    "div",
                    { className: "d2bp-card-head" },
                    h(
                      "div",
                      null,
                      h("h2", null, "数据与模型"),
                      h("p", null, "每天自动更新，模型随数据重训"),
                    ),
                    isRefreshing
                      ? h("span", { className: "d2bp-live-dot" }, "更新中")
                      : h(
                          "span",
                          { className: "d2bp-live-dot is-ok" },
                          "已就绪",
                        ),
                  ),
                  h(
                    "label",
                    { className: "d2bp-field d2bp-source-field" },
                    h("span", null, "数据口径"),
                    h(
                      "select",
                      {
                        className: "d2bp-select",
                        value: state.dataSource || "high",
                        onChange: (event) => changeSource(event.target.value),
                        disabled: disabled || isRefreshing,
                      },
                      (state.dataSources || []).map((item) =>
                        h(
                          "option",
                          { value: item.id, key: item.id },
                          `${item.label} · ${item.detail}`,
                        ),
                      ),
                    ),
                  ),
                  h(
                    "p",
                    { className: "d2bp-source-detail" },
                    `当前：${sourceInfo.label}（${sourceInfo.detail}）`,
                  ),
                  h(
                    "div",
                    { className: "d2bp-data-grid" },
                    h(
                      "div",
                      null,
                      h("span", null, "最近更新"),
                      h("strong", null, formatDate(data?.fetchedAt)),
                    ),
                    h(
                      "div",
                      null,
                      h("span", null, "训练样本"),
                      h(
                        "strong",
                        null,
                        model?.matches
                          ? `${model.matches.toLocaleString("zh-CN")} 局`
                          : "—",
                      ),
                    ),
                    h(
                      "div",
                      null,
                      h("span", null, "模型准确率"),
                      h(
                        "strong",
                        null,
                        model?.accuracy ? `${model.accuracy}%` : "—",
                      ),
                    ),
                    h(
                      "div",
                      null,
                      h("span", null, "英雄克制"),
                      h(
                        "strong",
                        null,
                        data
                          ? `${data.matchupRows.toLocaleString("zh-CN")} 条`
                          : "—",
                      ),
                    ),
                  ),
                  h(
                    "button",
                    {
                      className: "d2bp-btn d2bp-btn-block",
                      onClick: refreshData,
                      disabled: disabled || isRefreshing,
                    },
                    h(Icon, { name: "refresh", size: 14 }),
                    isRefreshing ? "采集并训练中…" : "立即更新数据",
                  ),
                  h(
                    "p",
                    { className: "d2bp-source-note" },
                    `来源：OpenDota 公共 API、Valve 中文英雄数据。当前胜率与模型口径为「${sourceInfo.label}」；约每 30 分钟检查一次，超过 20 小时自动更新。对位矩阵来自公开对局样本。`,
                  ),
                ),

                h(
                  "section",
                  { className: "d2bp-card d2bp-tips" },
                  h("h2", null, "天梯 2-2-1 提示"),
                  h(
                    "ul",
                    null,
                    h(
                      "li",
                      null,
                      "先锁定核心 + 辅助的双人组合，最后一手留 Counter。",
                    ),
                    h("li", null, "20 秒内优先选择英雄池内的熟练英雄。"),
                    h("li", null, "敌方英雄录入越完整，克制权重越准确。"),
                  ),
                ),
              ),
              h(
                "footer",
                { className: "d2bp-footer" },
                h("span", null, "Dota2bp · 数据仅作决策参考"),
                h(
                  "span",
                  null,
                  "Ban&Pick 天梯模式：无 Ban，Pick 2-2-1，每轮约 20 秒",
                ),
              ),
            ),
          ),
        ),

        picker
          ? h(
              "div",
              {
                className: "d2bp-modal-backdrop",
                onClick: () => setPicker(null),
              },
              h(
                "div",
                {
                  className: "d2bp-modal",
                  role: "dialog",
                  "aria-modal": "true",
                  "aria-label":
                    picker.side === "our" ? "选择我方英雄" : "录入敌方英雄",
                  onClick: (event) => event.stopPropagation(),
                },
                h(
                  "div",
                  { className: "d2bp-modal-head" },
                  h(
                    "div",
                    null,
                    h(
                      "span",
                      { className: "d2bp-eyebrow" },
                      picker.side === "our" ? "我方选人" : "敌方录入",
                    ),
                    h(
                      "h2",
                      null,
                      picker.side === "our" ? "选择英雄" : "添加敌方英雄",
                    ),
                  ),
                  h(
                    "button",
                    {
                      className: "d2bp-icon-btn",
                      onClick: () => setPicker(null),
                      "aria-label": "关闭",
                    },
                    h(Icon, { name: "close", size: 16 }),
                  ),
                ),
                picker.side === "our"
                  ? h(
                      "label",
                      { className: "d2bp-field d2bp-picker-member" },
                      h("span", null, "分配给"),
                      h(
                        "select",
                        {
                          className: "d2bp-select",
                          value: picker.memberId || "",
                          onChange: (event) =>
                            setPicker({
                              ...picker,
                              memberId: event.target.value,
                            }),
                        },
                        openMembers.map((member) =>
                          h(
                            "option",
                            { value: member.id, key: member.id },
                            `${member.name} · 参战`,
                          ),
                        ),
                        !openMembers.length
                          ? h(
                              "option",
                              { value: "", disabled: true },
                              "五个位置已选满",
                            )
                          : null,
                      ),
                    )
                  : null,
                h(
                  "div",
                  { className: "d2bp-search" },
                  h(Icon, { name: "search", size: 16 }),
                  h("input", {
                    className: "d2bp-search-input",
                    autoFocus: true,
                    value: query,
                    placeholder: "输入中文英雄名或外号，如：敌法、火猫、潮汐",
                    onChange: (event) => setQuery(event.target.value),
                  }),
                ),
                h(
                  "div",
                  { className: "d2bp-modal-meta" },
                  h(
                    "span",
                    null,
                    query
                      ? `搜索结果 ${pickerHeroes.length} 位`
                      : `按${sourceInfo.label}胜率排序，括号内为胜率`,
                  ),
                  activeMember?.heroPool?.length
                    ? h(
                        "span",
                        { className: "d2bp-badge" },
                        `${activeMember.name} 英雄池优先`,
                      )
                    : null,
                ),
                h(
                  "div",
                  { className: "d2bp-hero-grid" },
                  pickerHeroes.length
                    ? pickerHeroes.map((hero) => {
                        const picked = pickedIds.has(Number(hero.id));
                        const inPool = activeMember?.heroPoolIds?.includes(
                          Number(hero.id),
                        );
                        return h(
                          "button",
                          {
                            className: `d2bp-hero-option${picked ? " is-picked" : ""}${inPool ? " is-pool" : ""}`,
                            key: hero.id,
                            onClick: () => chooseHero(hero),
                            disabled: picked || disabled,
                            title: picked
                              ? "已在征召中"
                              : `${hero.name} · ${sourceInfo.label}胜率 ${pct(hero.winrate)}`,
                          },
                          heroImage(hero, "d2bp-hero-option-img"),
                          h(
                            "span",
                            { className: "d2bp-hero-option-main" },
                            h("strong", null, hero.name),
                            h(
                              "small",
                              null,
                              `${pct(hero.winrate)}${inPool ? " · 池" : ""}`,
                            ),
                          ),
                          picked
                            ? h(
                                "span",
                                { className: "d2bp-picked-mark" },
                                "已选",
                              )
                            : null,
                        );
                      })
                    : h(
                        "div",
                        { className: "d2bp-empty" },
                        h("p", null, "没有匹配的英雄，试试正式中文名。"),
                      ),
                ),
              ),
            )
          : null,
      );
    }

    const STYLE = `
.d2bp-root{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base);font:14px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;min-height:100%;width:100%;overflow:auto;box-sizing:border-box}
.d2bp-root *{box-sizing:border-box}
.d2bp-shell{max-width:1340px;margin:0 auto;padding:28px 30px 34px}
.d2bp-header{display:flex;align-items:flex-start;justify-content:space-between;gap:20px;margin-bottom:18px}
.d2bp-brand{display:flex;gap:14px;align-items:flex-start}
.d2bp-brand-mark{width:44px;height:44px;border-radius:12px;background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);display:flex;align-items:center;justify-content:center;color:var(--dsw-alias-brand-primary);flex:0 0 auto}
.d2bp-eyebrow{font-size:11px;letter-spacing:.16em;font-weight:700;color:var(--dsw-alias-label-secondary);text-transform:uppercase;margin-bottom:3px}
.d2bp-brand h1{font-size:30px;line-height:1.1;margin:0 0 5px;letter-spacing:-.03em}
.d2bp-brand p{margin:0;color:var(--dsw-alias-label-secondary);font-size:13px}
.d2bp-header-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:flex-end;padding-top:5px}
.d2bp-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:9px;padding:8px 12px;font:inherit;font-size:13px;font-weight:600;cursor:pointer;transition:border-color .15s,background .15s,opacity .15s;white-space:nowrap}
.d2bp-btn:hover:not(:disabled){border-color:var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2)}
.d2bp-btn:disabled{opacity:.48;cursor:not-allowed}
.d2bp-btn-primary{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:#fff}
.d2bp-btn-primary:hover:not(:disabled){filter:brightness(1.08);background:var(--dsw-alias-brand-primary)}
.d2bp-btn-small{padding:6px 9px;font-size:12px;border-radius:8px}
.d2bp-btn-block{width:100%;margin-top:10px}
.d2bp-link-btn{display:inline-flex;align-items:center;gap:3px;border:0;background:transparent;color:var(--dsw-alias-brand-primary);font:inherit;font-size:12px;font-weight:600;cursor:pointer;padding:2px 0}
.d2bp-link-btn:hover{text-decoration:underline}
.d2bp-icon-btn{display:inline-flex;align-items:center;justify-content:center;width:26px;height:26px;border:1px solid transparent;border-radius:7px;background:transparent;color:var(--dsw-alias-label-secondary);cursor:pointer}
.d2bp-icon-btn:hover{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.d2bp-status{display:flex;gap:0;align-items:stretch;border:1px solid var(--dsw-alias-border-l1);border-radius:12px;background:var(--dsw-alias-bg-layer-1);margin-bottom:16px;overflow:hidden;flex-wrap:wrap}
.d2bp-status-item{padding:10px 16px;border-right:1px solid var(--dsw-alias-border-l1);display:flex;flex-direction:column;gap:1px;min-width:150px}
.d2bp-status-item:last-of-type{border-right:0}
.d2bp-status-grow{flex:1;min-width:210px}
.d2bp-status-label{font-size:10px;font-weight:700;letter-spacing:.08em;color:var(--dsw-alias-label-secondary);text-transform:uppercase}
.d2bp-status-item strong{font-size:13px;font-weight:650;max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.d2bp-status-sub{font-size:11px;color:var(--dsw-alias-label-secondary)}
.d2bp-refresh-state{padding:10px 16px;min-width:230px;flex:1;border-left:1px solid var(--dsw-alias-border-l1)}
.d2bp-refresh-line{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--dsw-alias-label-secondary);margin-bottom:7px}
.d2bp-progress{height:4px;border-radius:999px;background:var(--dsw-alias-bg-layer-2);overflow:hidden}
.d2bp-progress-fill{height:100%;background:var(--dsw-alias-brand-primary);border-radius:999px;transition:width .35s}
.d2bp-alert{display:flex;align-items:center;gap:8px;padding:9px 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-layer-1);margin-bottom:12px;font-size:12px;color:var(--dsw-alias-label-secondary)}
.d2bp-alert strong{color:var(--dsw-alias-label-primary)}
.d2bp-alert span{flex:1}
.d2bp-alert-error{border-color:var(--dsw-alias-state-error-primary);color:var(--dsw-alias-state-error-primary)}
.d2bp-layout{display:grid;grid-template-columns:minmax(0,1fr) 340px;gap:16px;align-items:start}
.d2bp-main,.d2bp-rail{display:flex;flex-direction:column;gap:16px;min-width:0}
.d2bp-card{border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);border-radius:14px;padding:16px 16px 14px;min-width:0}
.d2bp-card-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:12px}
.d2bp-card h2{font-size:15px;line-height:1.3;margin:0 0 3px;letter-spacing:-.01em}
.d2bp-card-head p{font-size:12px;color:var(--dsw-alias-label-secondary);margin:0;line-height:1.35}
.d2bp-rounds{display:flex;gap:4px;flex:0 0 auto}
.d2bp-round{width:24px;height:24px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;border:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2)}
.d2bp-round.is-active{background:var(--dsw-alias-brand-primary);border-color:var(--dsw-alias-brand-primary);color:#fff}
.d2bp-round.is-done{border-color:var(--dsw-alias-state-success-primary);color:var(--dsw-alias-state-success-primary)}
.d2bp-timer-row{display:flex;align-items:center;gap:12px;margin-bottom:13px;padding:8px 10px;border-radius:9px;background:var(--dsw-alias-bg-layer-2)}
.d2bp-timer{display:flex;align-items:center;gap:6px;flex:0 0 auto;color:var(--dsw-alias-label-secondary);font-size:11px}
.d2bp-timer strong{font-size:16px;color:var(--dsw-alias-label-primary);font-variant-numeric:tabular-nums;min-width:32px}
.d2bp-timer.is-low{color:var(--dsw-alias-state-error-primary)}
.d2bp-timer.is-low strong{color:var(--dsw-alias-state-error-primary)}
.d2bp-timer-track{height:5px;border-radius:999px;background:var(--dsw-alias-border-l1);flex:1;overflow:hidden}
.d2bp-timer-fill{height:100%;background:var(--dsw-alias-brand-primary);border-radius:999px;transition:width 1s linear}
.d2bp-timer.is-low .d2bp-timer-fill{background:var(--dsw-alias-state-error-primary)}
.d2bp-board{display:grid;grid-template-columns:minmax(0,1fr) 38px minmax(0,1fr);gap:8px;align-items:start}
.d2bp-team{min-width:0}
.d2bp-team-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:7px}
.d2bp-team-head>div{display:flex;align-items:center;gap:6px}
.d2bp-team-head strong{font-size:11px;color:var(--dsw-alias-label-secondary);font-weight:600}
.d2bp-team-tag{font-size:10px;font-weight:800;letter-spacing:.08em;padding:3px 6px;border-radius:5px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
.d2bp-team-tag.is-our{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 16%,transparent);color:var(--dsw-alias-brand-primary)}
.d2bp-team-tag.is-enemy{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 12%,transparent);color:var(--dsw-alias-state-error-primary)}
.d2bp-slots{display:flex;flex-direction:column;gap:5px}
.d2bp-slot{display:flex;align-items:center;gap:7px;min-height:43px;padding:4px 6px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base);min-width:0}
.d2bp-slot.has-pick{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-border-l2)}
.d2bp-slot-pos{font-size:11px;font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:46px;max-width:90px}
.d2bp-slot-role{font-size:9px;color:var(--dsw-alias-label-secondary);white-space:nowrap;flex:0 0 auto}
.d2bp-slot-hero{display:flex;align-items:center;gap:6px;min-width:0;flex:1}
.d2bp-slot-img{width:42px;height:24px;border-radius:4px;object-fit:cover;background:var(--dsw-alias-bg-layer-2);flex:0 0 auto}
.d2bp-slot-hero>span{font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.d2bp-slot-empty{display:flex;align-items:center;justify-content:center;gap:4px;flex:1;height:31px;border:1px dashed var(--dsw-alias-border-l2);border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:11px;cursor:pointer}
.d2bp-slot-empty:hover{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}
.d2bp-slot-wait{font-size:11px;color:var(--dsw-alias-label-secondary);padding-left:2px}
.d2bp-remove{margin-left:auto;width:19px;height:19px;border:0;border-radius:5px;background:transparent;color:var(--dsw-alias-label-secondary);display:inline-flex;align-items:center;justify-content:center;cursor:pointer;flex:0 0 auto}
.d2bp-remove:hover{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 14%,transparent);color:var(--dsw-alias-state-error-primary)}
.d2bp-vs{display:flex;align-items:flex-start;justify-content:center;padding-top:64px;color:var(--dsw-alias-label-secondary);font-size:10px;font-weight:800;letter-spacing:.08em}
.d2bp-board-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:9px;padding-top:9px;border-top:1px solid var(--dsw-alias-border-l1);font-size:11px;color:var(--dsw-alias-label-secondary)}
.d2bp-foot-ok{color:var(--dsw-alias-state-success-primary);font-weight:650}
.d2bp-rec-body{padding-top:2px}
.d2bp-subhead{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px}
.d2bp-subhead h3{font-size:12px;margin:0;font-weight:700;letter-spacing:.01em}
.d2bp-subhead>span{font-size:10px;color:var(--dsw-alias-label-secondary);text-align:right}
.d2bp-subhead-gap{margin-top:15px;padding-top:13px;border-top:1px solid var(--dsw-alias-border-l1)}
.d2bp-squads{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.d2bp-squad{border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-bg-base);padding:9px;min-width:0;display:flex;flex-direction:column;gap:7px}
.d2bp-squad-top{display:flex;align-items:center;justify-content:space-between;gap:6px}
.d2bp-squad-index{font-size:10px;font-weight:800;letter-spacing:.04em;color:var(--dsw-alias-label-secondary)}
.d2bp-squad-score{display:flex;align-items:center;gap:4px;font-size:9px;color:var(--dsw-alias-label-secondary)}
.d2bp-score{display:inline-flex;align-items:center;justify-content:center;min-width:27px;height:21px;padding:0 4px;border-radius:6px;font-size:11px;font-weight:800;font-variant-numeric:tabular-nums}
.d2bp-score-sm{min-width:22px;height:18px;font-size:10px}
.d2bp-score-high{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 16%,transparent);color:var(--dsw-alias-state-success-primary)}
.d2bp-score-mid{background:color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent);color:var(--dsw-alias-brand-primary)}
.d2bp-score-low{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary)}
.d2bp-squad-heroes{display:flex;flex-direction:column;gap:5px}
.d2bp-squad-hero{display:flex;align-items:center;gap:6px;min-width:0}
.d2bp-squad-img{width:50px;height:28px;border-radius:4px;object-fit:cover;background:var(--dsw-alias-bg-layer-2);flex:0 0 auto}
.d2bp-squad-hero div{min-width:0;display:flex;flex-direction:column}
.d2bp-squad-hero strong{font-size:12px;line-height:1.25;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.d2bp-squad-hero span{font-size:9px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.d2bp-chips{display:flex;flex-wrap:wrap;gap:3px;min-height:18px}
.d2bp-chip{font-size:9px;line-height:1.4;padding:1px 5px;border-radius:4px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}
.d2bp-candidates{display:flex;flex-direction:column;gap:5px}
.d2bp-cand{display:flex;align-items:flex-start;gap:9px;padding:7px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-alias-bg-base)}
.d2bp-thumb{position:relative;flex:0 0 auto;overflow:hidden;border-radius:5px;background:var(--dsw-alias-bg-layer-2)}
.d2bp-thumb-md{width:58px;height:33px}
.d2bp-thumb-img{width:100%;height:100%;object-fit:cover;display:block}
.d2bp-thumb-letter{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:800;color:var(--dsw-alias-label-secondary);z-index:-1}
.d2bp-cand-main{flex:1;min-width:0}
.d2bp-cand-title{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.d2bp-cand-title strong{font-size:13px}
.d2bp-cand-pos{font-size:9px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);padding:1px 5px;border-radius:4px}
.d2bp-badge{font-size:9px;font-weight:700;color:var(--dsw-alias-brand-primary);border:1px solid color-mix(in srgb,var(--dsw-alias-brand-primary) 38%,transparent);padding:0 4px;border-radius:4px}
.d2bp-cand-meta{display:flex;gap:9px;flex-wrap:wrap;font-size:10px;color:var(--dsw-alias-label-secondary);margin-top:1px}
.d2bp-cand-reasons{display:flex;gap:3px;flex-wrap:wrap;margin-top:3px}
.d2bp-cand-reasons span{font-size:9px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);padding:1px 4px;border-radius:3px}
.d2bp-cand-side{display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex:0 0 auto}
.d2bp-member-recs{margin-top:2px}
.d2bp-member-rec{border-top:1px dashed var(--dsw-alias-border-l1);padding:8px 0 2px}
.d2bp-member-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:5px}
.d2bp-member-head strong{font-size:11px}
.d2bp-member-head span{font-size:9px;color:var(--dsw-alias-label-secondary)}
.d2bp-member-list{display:flex;gap:4px;flex-wrap:wrap}
.d2bp-mini-cand{display:flex;align-items:center;gap:4px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-bg-base);padding:2px 5px 2px 2px;cursor:pointer;color:var(--dsw-alias-label-primary);font:inherit;min-width:0}
.d2bp-mini-cand:hover:not(:disabled){border-color:var(--dsw-alias-brand-primary)}
.d2bp-mini-cand:disabled{opacity:.45;cursor:not-allowed}
.d2bp-mini-img{width:31px;height:18px;border-radius:3px;object-fit:cover;background:var(--dsw-alias-bg-layer-2);flex:0 0 auto}
.d2bp-mini-name{font-size:10px;font-weight:600;white-space:nowrap}
.d2bp-mini-score{font-size:9px;color:var(--dsw-alias-label-secondary);font-variant-numeric:tabular-nums}
.d2bp-avoid{margin-top:14px;padding-top:11px;border-top:1px solid var(--dsw-alias-border-l1)}
.d2bp-avoid-item{display:flex;align-items:center;gap:6px;padding:3px 0;min-width:0}
.d2bp-avoid-item strong{font-size:10px;flex:0 0 auto}
.d2bp-avoid-item span{font-size:9px;color:var(--dsw-alias-label-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.d2bp-warnings{margin-top:12px;padding:8px 10px;border-radius:8px;background:var(--dsw-alias-bg-layer-2)}
.d2bp-warnings p{margin:2px 0;font-size:10px;color:var(--dsw-alias-label-secondary)}
.d2bp-empty{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:5px;padding:26px 10px;text-align:center;color:var(--dsw-alias-label-secondary)}
.d2bp-empty strong{color:var(--dsw-alias-label-primary);font-size:13px}
.d2bp-empty p{margin:0;font-size:11px;max-width:440px}
.d2bp-spinner{width:18px;height:18px;border:2px solid var(--dsw-alias-border-l2);border-top-color:var(--dsw-alias-brand-primary);border-radius:50%;animation:d2bp-spin .8s linear infinite;flex:0 0 auto}
@keyframes d2bp-spin{to{transform:rotate(360deg)}}
.d2bp-team-editor{display:flex;flex-direction:column;gap:8px}
.d2bp-field{display:flex;flex-direction:column;gap:3px;font-size:10px;font-weight:650;color:var(--dsw-alias-label-secondary)}
.d2bp-input,.d2bp-select,.d2bp-textarea{width:100%;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);padding:6px 8px;font:inherit;font-size:12px;outline:none;min-width:0}
.d2bp-input:focus,.d2bp-select:focus,.d2bp-textarea:focus{border-color:var(--dsw-alias-brand-primary);box-shadow:0 0 0 2px color-mix(in srgb,var(--dsw-alias-brand-primary) 14%,transparent)}
.d2bp-textarea{resize:vertical;line-height:1.4;min-height:54px}
.d2bp-member-edit{display:flex;flex-direction:column;gap:4px;padding:7px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-base)}
.d2bp-member-edit-top{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:5px;align-items:center}
.d2bp-check{display:inline-flex;align-items:center;gap:4px;font-size:10px;color:var(--dsw-alias-label-secondary);white-space:nowrap;cursor:pointer;user-select:none}
.d2bp-check input{accent-color:var(--dsw-alias-brand-primary);width:14px;height:14px;margin:0;cursor:pointer}
.d2bp-source-field{margin-bottom:4px}
.d2bp-source-detail{font-size:10px;color:var(--dsw-alias-label-secondary);margin:0 0 9px}
.d2bp-board-warning{margin-top:6px;padding:6px 8px;border-radius:6px;background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent);color:var(--dsw-alias-state-warn-primary);font-size:10px}
.d2bp-prediction{border:1px solid var(--dsw-alias-border-l1);background:linear-gradient(135deg,color-mix(in srgb,var(--dsw-alias-brand-primary) 13%,transparent),var(--dsw-alias-bg-base));border-radius:11px;padding:12px;margin-bottom:14px}
.d2bp-prediction-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:8px}
.d2bp-prediction-head>div{display:flex;flex-direction:column;gap:1px}
.d2bp-prediction-eyebrow{font-size:10px;font-weight:700;letter-spacing:.08em;color:var(--dsw-alias-label-secondary);text-transform:uppercase}
.d2bp-prediction-value{font-size:31px;line-height:1.05;letter-spacing:-.04em;color:var(--dsw-alias-brand-primary);font-variant-numeric:tabular-nums}
.d2bp-prediction-confidence{font-size:10px;color:var(--dsw-alias-label-secondary);padding:2px 6px;border-radius:5px;background:var(--dsw-alias-bg-layer-2);white-space:nowrap}
.d2bp-prediction-track{height:7px;border-radius:999px;background:var(--dsw-alias-border-l1);overflow:hidden;margin-bottom:7px}
.d2bp-prediction-fill{height:100%;border-radius:999px;background:var(--dsw-alias-brand-primary);transition:width .4s}
.d2bp-prediction-meta{display:flex;justify-content:space-between;gap:8px;flex-wrap:wrap;font-size:9px;color:var(--dsw-alias-label-secondary)}
.d2bp-prediction-note{font-size:9px;color:var(--dsw-alias-label-secondary);margin:7px 0 0;line-height:1.45}
.d2bp-prediction-pending{display:flex;flex-direction:column;gap:2px}
.d2bp-prediction-pending strong{font-size:12px}
.d2bp-prediction-pending span{font-size:10px;color:var(--dsw-alias-label-secondary)}
.d2bp-input-name{font-weight:600}
.d2bp-select{appearance:auto}
.d2bp-editor-foot{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-top:1px}
.d2bp-editor-foot span{font-size:9px;color:var(--dsw-alias-label-secondary)}
.d2bp-roster-summary{display:flex;flex-direction:column;gap:4px}
.d2bp-roster-row{display:flex;align-items:center;gap:7px;font-size:11px;padding:4px 0;border-bottom:1px dashed var(--dsw-alias-border-l1)}
.d2bp-roster-row:last-child{border-bottom:0}
.d2bp-roster-row span:first-child{font-weight:600;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.d2bp-roster-row span:nth-child(2){font-size:9px;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);padding:1px 4px;border-radius:3px}
.d2bp-roster-pool{font-size:9px;color:var(--dsw-alias-label-secondary)}
.d2bp-live-dot{display:inline-flex;align-items:center;gap:4px;font-size:9px;color:var(--dsw-alias-label-secondary);white-space:nowrap}
.d2bp-live-dot::before{content:"";width:5px;height:5px;border-radius:50%;background:var(--dsw-alias-state-warn-primary)}
.d2bp-live-dot.is-ok::before{background:var(--dsw-alias-state-success-primary)}
.d2bp-data-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:4px}
.d2bp-data-grid>div{display:flex;flex-direction:column;gap:1px;padding:7px;border-radius:7px;background:var(--dsw-alias-bg-base);border:1px solid var(--dsw-alias-border-l1);min-width:0}
.d2bp-data-grid span{font-size:9px;color:var(--dsw-alias-label-secondary)}
.d2bp-data-grid strong{font-size:11px;font-weight:650;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.d2bp-source-note{font-size:9px;line-height:1.45;color:var(--dsw-alias-label-secondary);margin:8px 0 0}
.d2bp-tips ul{margin:0;padding-left:16px;color:var(--dsw-alias-label-secondary);font-size:10px;line-height:1.55}
.d2bp-tips h2{margin-bottom:5px}
.d2bp-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:18px;padding-top:12px;border-top:1px solid var(--dsw-alias-border-l1);color:var(--dsw-alias-label-secondary);font-size:10px;flex-wrap:wrap}
.d2bp-center-state{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;min-height:420px;color:var(--dsw-alias-label-secondary)}
.d2bp-center-state h2{color:var(--dsw-alias-label-primary);margin:0;font-size:20px}
.d2bp-center-state p{margin:0;max-width:420px;text-align:center}
.d2bp-modal-backdrop{position:fixed;inset:0;z-index:50;background:rgba(8,10,14,.52);display:flex;align-items:center;justify-content:center;padding:24px;backdrop-filter:blur(2px)}
.d2bp-modal{width:min(780px,100%);max-height:min(84vh,820px);display:flex;flex-direction:column;background:var(--dsw-alias-bg-overlay);border:1px solid var(--dsw-alias-border-l2);border-radius:15px;padding:17px;box-shadow:0 24px 70px rgba(0,0,0,.32);overflow:hidden}
.d2bp-modal-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:10px}
.d2bp-modal-head h2{font-size:19px;margin:0}
.d2bp-picker-member{max-width:310px;margin-bottom:9px}
.d2bp-search{display:flex;align-items:center;gap:7px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;padding:0 10px;background:var(--dsw-alias-bg-base);margin-bottom:8px;flex:0 0 auto}
.d2bp-search-input{flex:1;border:0;background:transparent;color:var(--dsw-alias-label-primary);padding:9px 0;font:inherit;font-size:13px;outline:none;min-width:0}
.d2bp-modal-meta{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:10px;color:var(--dsw-alias-label-secondary);margin-bottom:7px;flex:0 0 auto}
.d2bp-hero-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:5px;overflow:auto;padding-right:3px;align-content:start}
.d2bp-hero-option{display:flex;align-items:center;gap:6px;border:1px solid var(--dsw-alias-border-l1);border-radius:7px;background:var(--dsw-alias-bg-base);padding:4px;cursor:pointer;color:var(--dsw-alias-label-primary);font:inherit;text-align:left;min-width:0}
.d2bp-hero-option:hover:not(:disabled){border-color:var(--dsw-alias-brand-primary);background:var(--dsw-alias-bg-layer-2)}
.d2bp-hero-option.is-pool{border-color:color-mix(in srgb,var(--dsw-alias-brand-primary) 50%,var(--dsw-alias-border-l1))}
.d2bp-hero-option.is-picked{opacity:.42;cursor:not-allowed}
.d2bp-hero-option-img{width:53px;height:30px;border-radius:4px;object-fit:cover;background:var(--dsw-alias-bg-layer-2);flex:0 0 auto}
.d2bp-hero-option-main{display:flex;flex-direction:column;min-width:0;flex:1}
.d2bp-hero-option-main strong{font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.d2bp-hero-option-main small{font-size:9px;color:var(--dsw-alias-label-secondary)}
.d2bp-picked-mark{font-size:8px;color:var(--dsw-alias-state-error-primary);font-weight:700}
@media (max-width:1080px){.d2bp-layout{grid-template-columns:1fr}.d2bp-rail{display:grid;grid-template-columns:1fr 1fr;align-items:start}.d2bp-rail>.d2bp-card:first-child{grid-row:span 2}}
@media (max-width:760px){.d2bp-shell{padding:18px 14px 24px}.d2bp-header{flex-direction:column}.d2bp-header-actions{justify-content:flex-start}.d2bp-status-item{min-width:50%;border-bottom:1px solid var(--dsw-alias-border-l1)}.d2bp-squads{grid-template-columns:1fr}.d2bp-board{grid-template-columns:1fr}.d2bp-vs{padding:2px 0;justify-content:flex-start}.d2bp-rail{grid-template-columns:1fr}.d2bp-rail>.d2bp-card:first-child{grid-row:auto}.d2bp-footer{flex-direction:column;align-items:flex-start}.d2bp-modal-backdrop{padding:8px}.d2bp-modal{max-height:92vh;padding:12px}.d2bp-hero-grid{grid-template-columns:repeat(auto-fill,minmax(135px,1fr))}}
@media (max-width:520px){.d2bp-slot-role{display:none}.d2bp-data-grid{grid-template-columns:1fr}.d2bp-member-edit-top{grid-template-columns:1fr}.d2bp-timer-row{flex-wrap:wrap}.d2bp-timer-track{min-width:120px}}
`;

    return {
      inject: ["slots", "layout"],
      apply(ctx) {
        function PanelIcon(props) {
          return h(Dota2bpIcon, {
            size: props.size || 20,
            active: Boolean(props.active),
            onClick: (event) => {
              event.stopPropagation();
              ctx.layout.selectPanel("dota2bp");
            },
          });
        }
        ctx.slots.inject("sidebar.panellist", () =>
          ctx.slots.register(
            {
              name: "sidebar.panellist",
              id: "dota2bp",
              order: 25,
              label: () => "Dota2bp",
            },
            PanelIcon,
          ),
        );
        ctx.slots.inject("main", () =>
          ctx.slots.register(
            {
              name: "main",
              key: "dota2bp",
            },
            Dota2bpApp,
          ),
        );
      },
    };
  },
});
