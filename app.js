/*
 * 静态演示 Demo 前端逻辑（纯浏览器内运行，无后端、无在线模型调用）。
 * 分流顺序与 deploy/rag_qa.py 对齐：实体白名单 -> 意图关键词 -> 词覆盖检索阈值 -> 预置答案。
 * 多轮记忆与工具调用轨迹为前端预置演示：对应后端骨架见 deploy/rag_qa.py 与 deploy/tools.py，
 * 模型 tool_call 决策与多轮指代消解需在线兼容端点复跑验证。
 */
(function () {
  const DATA = window.DEMO_DATA;
  const SIM_THRESHOLD = 0.30; // 词覆盖度阈值（离线校准见 demo/_calibrate.py）

  const REASON_LABEL = {
    ok: "命中知识库",
    unknown_model: "未知车型拦截",
    intent_block: "越界意图拦截",
    low_sim: "相似度不足兜底"
  };

  // 前端内存会话状态（对应后端 session 记忆；纯演示，刷新页面即清空）
  let lastModel = "";
  let memoryTurns = 0;

  function tokenize(text) {
    const t = (text || "").toLowerCase().trim();
    const toks = new Set();
    for (const w of t.match(/[a-z0-9]+/g) || []) toks.add(w);
    for (const han of t.match(/[\u4e00-\u9fa5]+/g) || []) {
      if (han.length === 1) toks.add(han);
      for (let i = 0; i < han.length - 1; i++) toks.add(han.slice(i, i + 2));
    }
    return toks;
  }

  function entityCheck(question) {
    for (const brand of Object.keys(DATA.brands)) {
      const m = question.match(new RegExp(brand + "\\s*([A-Za-z]{1,2}\\d[A-Za-z]{0,2})"));
      if (m) {
        const model = m[1].toUpperCase();
        return DATA.brands[brand].includes(model) ? null : "unknown_model";
      }
    }
    return null;
  }

  function intentCheck(question) {
    const low = question.toLowerCase();
    return DATA.off_topic.some((k) => low.includes(k.toLowerCase())) ? "intent_block" : null;
  }

  function retrieve(question) {
    const qt = tokenize(question);
    let best = null;
    for (const item of DATA.qa) {
      const corpus = [item.question, item.keywords.join(" "), item.refs.join(" ")].join(" ");
      const dt = tokenize(corpus);
      const inter = [...qt].filter((x) => dt.has(x)).length;
      const cover = qt.size ? inter / qt.size : 0;
      const union = qt.size + dt.size - inter;
      const jacc = union ? inter / union : 0;
      if (!best || cover > best.score) best = { score: cover, jacc: jacc, item: item, inter: inter };
    }
    return best;
  }

  function answer(question) {
    const entity = entityCheck(question);
    if (entity) {
      return { reason: entity, answer: DATA.replies[entity], top_sim: 0, hits: 0, refs: [], tools: [] };
    }
    const intent = intentCheck(question);
    if (intent) {
      return { reason: intent, answer: DATA.replies[intent], top_sim: 0, hits: 0, refs: [], tools: [] };
    }
    // 多轮指代：当前问题未带型号时，沿用上一轮识别到的车型补充检索（前端简化演示）
    const hasModel = /[A-Za-z]{1,2}\d[A-Za-z]{0,2}/.test(question);
    const augmented = !hasModel && lastModel ? question + " " + lastModel : question;
    const hit = retrieve(augmented);
    const score = hit ? hit.score : 0;
    if (!hit || score < SIM_THRESHOLD) {
      return { reason: "low_sim", answer: DATA.replies.low_sim, top_sim: Number(score.toFixed(4)), hits: 0, refs: [], tools: [] };
    }
    if (hit.item.model) lastModel = hit.item.model;
    return {
      reason: "ok",
      answer: hit.item.answer,
      top_sim: Number(score.toFixed(4)),
      hits: 1,
      refs: hit.item.refs,
      keyword_hit: hit.item.keywords,
      tools: hit.item.tools || []
    };
  }

  // ===== 页面渲染 =====
  const chat = document.getElementById("chat");
  const input = document.getElementById("q");
  const btn = document.getElementById("send");
  const resetBtn = document.getElementById("reset");

  function addTools(bubble, tools) {
    if (!tools || !tools.length) return;
    const box = document.createElement("div");
    box.className = "tools";
    const head = document.createElement("div");
    head.className = "tools-head";
    head.textContent = "工具调用 · " + tools.length;
    box.appendChild(head);
    tools.forEach((t) => {
      const row = document.createElement("div");
      row.className = "tool-row";
      const name = document.createElement("span");
      name.className = "tool-name";
      name.textContent = "🔧 " + t.name;
      const args = document.createElement("span");
      args.className = "tool-args";
      args.textContent = "(" + JSON.stringify(t.args) + ")";
      const res = document.createElement("div");
      res.className = "tool-result";
      res.textContent = t.result;
      row.appendChild(name);
      row.appendChild(args);
      row.appendChild(res);
      box.appendChild(row);
    });
    bubble.appendChild(box);
  }

  function addMsg(role, text, tags, tools) {
    const wrap = document.createElement("div");
    wrap.className = "msg " + role;
    const bubble = document.createElement("div");
    bubble.className = "bubble";
    bubble.textContent = text;
    if (tags && tags.length) {
      const t = document.createElement("div");
      t.className = "tags";
      tags.forEach((x) => {
        const s = document.createElement("span");
        s.className = "tag " + (x.cls || "muted");
        s.textContent = x.text;
        t.appendChild(s);
      });
      bubble.appendChild(t);
    }
    addTools(bubble, tools);
    wrap.appendChild(bubble);
    chat.appendChild(wrap);
    window.scrollTo(0, document.body.scrollHeight);
  }

  function ask() {
    const question = input.value.trim();
    if (!question) return;
    input.value = "";
    btn.disabled = true;
    addMsg("user", question);
    const res = answer(question);
    const blocked = res.reason !== "ok";
    if (res.reason === "ok") memoryTurns += 1; // 仅成功作答轮次计入记忆（与后端口径一致）
    const tags = [
      { text: REASON_LABEL[res.reason] || res.reason, cls: blocked ? "block" : "ok" },
      { text: "相似度 " + (res.top_sim ?? "-"), cls: "muted" },
      { text: "命中参考 " + res.hits + " 条", cls: "muted" },
      { text: "记忆 " + memoryTurns + " 轮", cls: "muted" },
      { text: "前端演示原型", cls: "muted" }
    ];
    addMsg("bot", res.answer, tags, res.tools);
    if (res.refs && res.refs.length) {
      addMsg("bot", "参考资料：" + res.refs.join("；"), [{ text: "检索片段", cls: "muted" }]);
    }
    btn.disabled = false;
    input.focus();
  }

  function resetChat() {
    chat.innerHTML = "";
    lastModel = "";
    memoryTurns = 0;
    const welcome = document.createElement("div");
    welcome.className = "msg bot";
    const b = document.createElement("div");
    b.className = "bubble";
    b.textContent = "你好，我是新能源汽车知识问答助手。可以问我车型参数、充电补能、续航习惯、保养质保等问题；超出资料范围的问题我会如实说明。";
    welcome.appendChild(b);
    chat.appendChild(welcome);
    input.focus();
  }

  btn.addEventListener("click", ask);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") ask(); });
  if (resetBtn) resetBtn.addEventListener("click", resetChat);

  // 暴露给离线/调试用
  window.DEMO_APP = { answer, tokenize, retrieve, resetChat, state: () => ({ lastModel, memoryTurns }) };
})();
