/*
 * 静态演示 Demo 前端逻辑（纯浏览器内运行，无后端、无在线模型调用）。
 * 分流顺序与 deploy/rag_qa.py 对齐：实体白名单 -> 意图关键词 -> 词覆盖检索阈值 -> 预置答案。
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
      return { reason: entity, answer: DATA.replies[entity], top_sim: 0, hits: 0, refs: [] };
    }
    const intent = intentCheck(question);
    if (intent) {
      return { reason: intent, answer: DATA.replies[intent], top_sim: 0, hits: 0, refs: [] };
    }
    const hit = retrieve(question);
    const score = hit ? hit.score : 0;
    if (!hit || score < SIM_THRESHOLD) {
      return { reason: "low_sim", answer: DATA.replies.low_sim, top_sim: Number(score.toFixed(4)), hits: 0, refs: [] };
    }
    return {
      reason: "ok",
      answer: hit.item.answer,
      top_sim: Number(score.toFixed(4)),
      hits: 1,
      refs: hit.item.refs,
      keyword_hit: hit.item.keywords
    };
  }

  // ===== 页面渲染 =====
  const chat = document.getElementById("chat");
  const input = document.getElementById("q");
  const btn = document.getElementById("send");

  function addMsg(role, text, tags) {
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
    const tags = [
      { text: REASON_LABEL[res.reason] || res.reason, cls: blocked ? "block" : "ok" },
      { text: "相似度 " + (res.top_sim ?? "-"), cls: "muted" },
      { text: "命中参考 " + res.hits + " 条", cls: "muted" },
      { text: "前端演示原型", cls: "muted" }
    ];
    addMsg("bot", res.answer, tags);
    if (res.refs && res.refs.length) {
      addMsg("bot", "参考资料：" + res.refs.join("；"), [{ text: "检索片段", cls: "muted" }]);
    }
    btn.disabled = false;
    input.focus();
  }

  btn.addEventListener("click", ask);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") ask(); });

  // 暴露给离线/调试用
  window.DEMO_APP = { answer, tokenize, retrieve };
})();
