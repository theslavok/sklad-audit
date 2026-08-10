const DRAFT_KEY = "sklad-audit-draft-v2";
const LOCAL_HISTORY_KEY = "sklad-audit-history-v2";
const LEGACY_KEY = "sklad-audit-v1";

/** @typedef {"yes"|"partial"|"no"|""} GateAnswer */
/** @typedef {"yes"|"partial"|"no"|"na"|""} Status */
/** @typedef {"core"|"required"|"elevated"|"na"|"pending"} Applicability */

const STATUS_LABEL = {
  yes: "Да",
  partial: "Частично",
  no: "Нет",
  na: "Н/п",
  "": "—",
};

const APP_LABEL = {
  core: "Базовый",
  required: "Обязателен",
  elevated: "Усилен",
  na: "Н/п",
  pending: "Ожидает пре-опрос",
};

let DATA = null;
let state = null;
let bound = false;
let lastShareInfo = null;

function uid() {
  return `wh_${Math.random().toString(36).slice(2, 9)}`;
}

function splitKeys(s) {
  if (!s) return [];
  return String(s)
    .split(";")
    .map((x) => x.trim())
    .filter(Boolean);
}

function emptyWarehouseState() {
  return { gates: {}, answers: {} };
}

function defaultState(data) {
  const warehouses = (data.warehouses || ["Склад 1", "Склад 2"]).map((name) => ({
    id: uid(),
    name,
  }));
  const byWarehouse = {};
  for (const w of warehouses) byWarehouse[w.id] = emptyWarehouseState();
  return {
    meta: { auditor: "", date: new Date().toISOString().slice(0, 10) },
    warehouses,
    activeId: warehouses[0]?.id || null,
    byWarehouse,
    history: [],
  };
}

function migrateLegacyOnce() {
  try {
    const legacyRaw = localStorage.getItem(LEGACY_KEY);
    if (!legacyRaw) return;
    if (localStorage.getItem(LOCAL_HISTORY_KEY) || sessionStorage.getItem(DRAFT_KEY) || localStorage.getItem(DRAFT_KEY)) {
      localStorage.removeItem(LEGACY_KEY);
      return;
    }
    const parsed = JSON.parse(legacyRaw);
    if (Array.isArray(parsed.history) && parsed.history.length) {
      localStorage.setItem(LOCAL_HISTORY_KEY, JSON.stringify(parsed.history));
    }
    const draft = {
      meta: parsed.meta || { auditor: "", date: new Date().toISOString().slice(0, 10) },
      warehouses: parsed.warehouses || [],
      activeId: parsed.activeId || null,
      byWarehouse: parsed.byWarehouse || {},
    };
    if (draft.warehouses.length) {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    }
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    /* ignore */
  }
}

function getLocalHistory() {
  try {
    const raw = localStorage.getItem(LOCAL_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveLocalHistory(list) {
  localStorage.setItem(LOCAL_HISTORY_KEY, JSON.stringify(list || []));
}

function readDraft() {
  try {
    let raw = sessionStorage.getItem(DRAFT_KEY);
    if (!raw) {
      raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        sessionStorage.setItem(DRAFT_KEY, raw);
        localStorage.removeItem(DRAFT_KEY);
      }
    }
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.warehouses?.length) return null;
    return parsed;
  } catch {
    return null;
  }
}

function hasUsableDraft() {
  const draft = readDraft();
  if (!draft) return false;
  const by = draft.byWarehouse || {};
  return Object.values(by).some((wh) => {
    const gates = Object.keys(wh.gates || {}).length;
    const answers = Object.keys(wh.answers || {}).length;
    return gates > 0 || answers > 0;
  });
}

function loadDraftState(data) {
  const draft = readDraft();
  if (!draft) return defaultState(data);
  return {
    meta: draft.meta || { auditor: "", date: new Date().toISOString().slice(0, 10) },
    warehouses: draft.warehouses,
    activeId: draft.activeId || draft.warehouses[0]?.id || null,
    byWarehouse: draft.byWarehouse || {},
    history: getLocalHistory(),
  };
}

function saveState() {
  if (!state) return;
  const draft = {
    meta: state.meta,
    warehouses: state.warehouses,
    activeId: state.activeId,
    byWarehouse: state.byWarehouse,
  };
  sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
}

function clearDraftStorage() {
  sessionStorage.removeItem(DRAFT_KEY);
  localStorage.removeItem(DRAFT_KEY);
}

function cloudReady() {
  return Boolean(window.AuditCloud && window.AuditCloud.isCloudConfigured());
}

function activeWh() {
  return state.warehouses.find((w) => w.id === state.activeId) || state.warehouses[0];
}

function whData(id = state.activeId) {
  if (!state.byWarehouse[id]) state.byWarehouse[id] = emptyWarehouseState();
  return state.byWarehouse[id];
}

function isActiveGate(v) {
  return v === "yes" || v === "partial";
}

function applicability(item, gates) {
  const ifAny = splitKeys(item.ifAny);
  const elevateIf = splitKeys(item.elevateIf);
  if (ifAny.length) {
    const values = ifAny.map((k) => gates[k] || "");
    if (values.some(isActiveGate)) {
      if (elevateIf.some((k) => isActiveGate(gates[k] || ""))) return "elevated";
      return "required";
    }
    if (values.every((v) => v === "no")) return "na";
    return "pending";
  }
  if (elevateIf.some((k) => isActiveGate(gates[k] || ""))) return "elevated";
  return "core";
}

function sections() {
  return [...new Set(DATA.items.map((i) => i.section))];
}

function $(sel) {
  return document.querySelector(sel);
}

function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "className") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k === "html") node.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== undefined && v !== null) node.setAttribute(k, v);
  }
  for (const child of [].concat(children)) {
    if (child == null) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

function switchTab(name) {
  document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
  document.querySelectorAll(".panel").forEach((p) => p.classList.toggle("active", p.id === `panel-${name}`));
  if (name === "screening") renderScreening();
  if (name === "audit") renderAudit();
  if (name === "summary") renderSummary();
  if (name === "history") renderHistory();
}

function renderWarehouses() {
  $("#meta-auditor").value = state.meta.auditor || "";
  $("#meta-date").value = state.meta.date || "";
  const list = $("#warehouse-list");
  list.innerHTML = "";
  state.warehouses.forEach((w) => {
    const row = el("div", { className: `wh-row${w.id === state.activeId ? " active" : ""}` });
    const input = el("input", {
      type: "text",
      value: w.name,
      onInput: (e) => {
        w.name = e.target.value;
        saveState();
        updateWhLabels();
      },
    });
    const activate = el("button", {
      type: "button",
      className: "btn ghost",
      text: w.id === state.activeId ? "Активный" : "Сделать активным",
      onClick: () => {
        state.activeId = w.id;
        saveState();
        renderWarehouses();
        updateWhLabels();
      },
    });
    const remove = el("button", {
      type: "button",
      className: "btn danger-ghost",
      text: "Удалить",
      onClick: () => {
        if (state.warehouses.length <= 1) return alert("Нужен хотя бы один склад");
        state.warehouses = state.warehouses.filter((x) => x.id !== w.id);
        delete state.byWarehouse[w.id];
        if (state.activeId === w.id) state.activeId = state.warehouses[0].id;
        saveState();
        renderWarehouses();
        updateWhLabels();
      },
    });
    row.append(input, activate, remove);
    list.append(row);
  });
}

function updateWhLabels() {
  const name = activeWh()?.name || "—";
  const a = $("#screen-wh-name");
  const b = $("#audit-wh-name");
  if (a) a.textContent = name;
  if (b) b.textContent = name;
}

function renderScreening() {
  updateWhLabels();
  const { gates } = whData();
  const list = $("#screening-list");
  list.innerHTML = "";
  let answered = 0;
  DATA.screening.forEach((q) => {
    if (gates[q.key]) answered += 1;
    const item = el("div", { className: "item" });
    item.append(
      el("h3", { text: q.text }),
      q.explain ? el("p", { className: "explain", text: q.explain }) : null,
      el("p", { className: "meta", text: `Влияет на состав обхода: ${q.affects}` })
    );
    const select = el("select");
    [
      ["", "Выберите…"],
      ["yes", "Да"],
      ["partial", "Частично"],
      ["no", "Нет"],
    ].forEach(([v, label]) => {
      const o = el("option", { value: v, text: label });
      if ((gates[q.key] || "") === v) o.selected = true;
      select.append(o);
    });
    select.addEventListener("change", () => {
      gates[q.key] = select.value;
      saveState();
      renderScreening();
    });
    item.append(select);
    list.append(item);
  });

  const apps = DATA.items.map((i) => applicability(i, gates));
  const active = apps.filter((a) => a === "core" || a === "required" || a === "elevated").length;
  const na = apps.filter((a) => a === "na").length;
  const pending = apps.filter((a) => a === "pending").length;
  const elevated = apps.filter((a) => a === "elevated").length;
  $("#screen-stats").innerHTML = "";
  [
    [`${answered}/${DATA.screening.length}`, "Ответов пре-опроса"],
    [String(active), "Пунктов к обходу"],
    [String(na), "Н/п"],
    [String(elevated), "Усилены"],
    [String(pending), "Ждут ответа"],
  ].forEach(([v, l]) => {
    $("#screen-stats").append(
      el("div", { className: "stat" }, [el("strong", { text: v }), el("span", { text: l })])
    );
  });
}

function fillSectionFilter() {
  const sel = $("#filter-section");
  const current = sel.value || "all";
  sel.innerHTML = "";
  sel.append(el("option", { value: "all", text: "Все блоки" }));
  sections().forEach((s) => sel.append(el("option", { value: s, text: s })));
  sel.value = [...sel.options].some((o) => o.value === current) ? current : "all";
}

function renderAudit() {
  updateWhLabels();
  fillSectionFilter();
  const { gates, answers } = whData();
  const section = $("#filter-section").value;
  const priority = $("#filter-priority").value;
  const scope = $("#filter-scope").value;

  const filtered = DATA.items.filter((item) => {
    const app = applicability(item, gates);
    if (scope === "walk" && (app === "na" || app === "pending")) return false;
    if (scope === "elevated" && app !== "elevated") return false;
    if (scope === "na" && app !== "na") return false;
    if (scope === "pending" && app !== "pending") return false;
    if (section !== "all" && item.section !== section) return false;
    if (priority !== "all") {
      const pri = String(item.priorities || "")
        .split(";")
        .map((x) => x.trim());
      if (!pri.includes(priority)) return false;
    }
    return true;
  });

  const walkItems = DATA.items.filter((i) => {
    const a = applicability(i, gates);
    return a === "core" || a === "required" || a === "elevated";
  });
  const filled = walkItems.filter((i) => answers[i.id]?.status && answers[i.id].status !== "na").length;
  const yes = walkItems.filter((i) => answers[i.id]?.status === "yes").length;
  const partial = walkItems.filter((i) => answers[i.id]?.status === "partial").length;
  const no = walkItems.filter((i) => answers[i.id]?.status === "no").length;

  $("#audit-stats").innerHTML = "";
  [
    [`${filled}/${walkItems.length}`, "Заполнено"],
    [String(yes), "Да"],
    [String(partial), "Частично"],
    [String(no), "Нет"],
  ].forEach(([v, l]) => {
    $("#audit-stats").append(
      el("div", { className: "stat" }, [el("strong", { text: v }), el("span", { text: l })])
    );
  });

  const list = $("#audit-list");
  list.innerHTML = "";
  let currentSection = null;
  filtered.forEach((item) => {
    if (item.section !== currentSection) {
      currentSection = item.section;
      list.append(el("h3", { className: "subhead", text: currentSection }));
    }
    const app = applicability(item, gates);
    const ans = answers[item.id] || { status: "", comment: "" };
    const card = el("div", {
      className: `item${app === "elevated" ? " elevated" : ""}${app === "na" ? " na" : ""}`,
    });
    const top = el("div", { className: "item-top" });
    top.append(
      el("span", {
        className: `pill${app === "elevated" ? " info" : app === "required" ? " accent" : ""}`,
        text: APP_LABEL[app],
      })
    );
    String(item.priorities || "")
      .split(";")
      .map((x) => x.trim())
      .filter(Boolean)
      .forEach((p) => top.append(el("span", { className: "pill", text: p })));
    card.append(top, el("h3", { text: item.text }));
    if (item.explain) card.append(el("p", { className: "explain", text: item.explain }));
    if (item.hint) card.append(el("p", { className: "meta", text: item.hint }));
    if (app === "na" && item.ifAny) {
      card.append(el("p", { className: "meta", text: `Не применимо по пре-опросу: ${item.ifAny}` }));
    }
    if (app === "pending" && item.ifAny) {
      card.append(el("p", { className: "meta", text: `Требуется ответ в пре-опросе: ${item.ifAny}` }));
    }

    const grid = el("div", { className: "item-grid" });
    const statusWrap = el("label", { text: "Оценка" });
    const statusSel = el("select");
    [
      ["", "Выберите…"],
      ["yes", "Да"],
      ["partial", "Частично"],
      ["no", "Нет"],
      ["na", "Н/п"],
    ].forEach(([v, label]) => {
      const o = el("option", { value: v, text: label });
      if ((ans.status || "") === v) o.selected = true;
      statusSel.append(o);
    });
    statusSel.addEventListener("change", () => {
      answers[item.id] = { status: statusSel.value, comment: answers[item.id]?.comment || "" };
      saveState();
      renderAudit();
    });
    statusWrap.append(statusSel);

    const commentWrap = el("label", { text: "Комментарий / доказательство" });
    const ta = el("textarea", { placeholder: "Факт, документ, адрес, что исправить" });
    ta.value = ans.comment || "";
    ta.addEventListener("input", () => {
      answers[item.id] = { status: answers[item.id]?.status || "", comment: ta.value };
      saveState();
    });
    commentWrap.append(ta);
    grid.append(statusWrap, commentWrap);
    card.append(grid);
    list.append(card);
  });
}

function warehouseStats(w) {
  const { gates, answers } = whData(w.id);
  const walk = DATA.items.filter((i) => {
    const a = applicability(i, gates);
    return a === "core" || a === "required" || a === "elevated";
  });
  const yes = walk.filter((i) => answers[i.id]?.status === "yes").length;
  const partial = walk.filter((i) => answers[i.id]?.status === "partial").length;
  const no = walk.filter((i) => answers[i.id]?.status === "no").length;
  const na = walk.filter((i) => answers[i.id]?.status === "na").length;
  const filled = walk.filter((i) => answers[i.id]?.status).length;
  const denom = yes + partial + no;
  const pct = denom ? Math.round((yes / denom) * 100) : null;
  const gaps = [];
  walk.forEach((item) => {
    const st = answers[item.id]?.status;
    if (st !== "no" && st !== "partial") return;
    gaps.push({
      warehouseName: w.name,
      section: item.section,
      status: st,
      text: item.text,
      comment: answers[item.id]?.comment || "",
    });
  });
  return {
    warehouseId: w.id,
    warehouseName: w.name,
    yes,
    partial,
    no,
    na,
    filled,
    total: walk.length,
    pct,
    gaps,
  };
}

function buildHistoryEntry() {
  const results = state.warehouses.map((w) => warehouseStats(w));
  const gaps = results.flatMap((r) => r.gaps);
  const answered = results.reduce((s, r) => s + r.filled, 0);
  return {
    id: uid(),
    savedAt: new Date().toISOString(),
    meta: {
      auditor: state.meta.auditor || "",
      date: state.meta.date || "",
    },
    warehouseCount: state.warehouses.length,
    answered,
    results: results.map((r) => ({
      warehouseName: r.warehouseName,
      yes: r.yes,
      partial: r.partial,
      no: r.no,
      na: r.na,
      filled: r.filled,
      total: r.total,
      pct: r.pct,
    })),
    gaps,
    snapshot: {
      meta: JSON.parse(JSON.stringify(state.meta)),
      warehouses: JSON.parse(JSON.stringify(state.warehouses)),
      activeId: state.activeId,
      byWarehouse: JSON.parse(JSON.stringify(state.byWarehouse)),
    },
  };
}

async function saveCurrentAuditToHistory() {
  if (!Array.isArray(state.history)) state.history = getLocalHistory();
  const entry = buildHistoryEntry();
  if (entry.answered === 0) {
    const ok = confirm(
      "По текущему аудиту почти нет заполненных оценок. Всё равно сохранить?"
    );
    if (!ok) return;
  }

  const plannedCode = cloudReady() ? window.AuditCloud.shareCode() : "";
  if (plannedCode) entry.shareCode = plannedCode;

  let saved = entry;
  let cloudOk = false;
  if (cloudReady()) {
    try {
      saved = await window.AuditCloud.cloudSaveAudit(entry);
      cloudOk = true;
    } catch (err) {
      console.error(err);
      const localOk = confirm(
        "Не удалось сохранить в облако. Сохранить только на этом устройстве?"
      );
      if (!localOk) return;
    }
  }

  const code = (saved && saved.shareCode) || plannedCode || "";
  if (code) saved.shareCode = code;

  const local = getLocalHistory().filter((h) => h.id !== saved.id && h.shareCode !== saved.shareCode);
  local.unshift(saved);
  saveLocalHistory(local);
  state.history = local;

  if (cloudOk && code) {
    lastShareInfo = { code: code, url: window.AuditCloud.shareUrl(code) };
  } else {
    lastShareInfo = null;
  }

  switchTab("summary");
  renderShareBoxes();
  if (lastShareInfo) {
    const box = $("#summary-share");
    if (box) box.scrollIntoView({ behavior: "smooth", block: "center" });
  }
}

function renderShareBoxes() {
  renderShareInto("#summary-share");
  renderShareInto("#history-share");
}

function renderShareInto(sel) {
  const host = $(sel);
  if (!host) return;
  host.innerHTML = "";
  if (!lastShareInfo) return;
  const box = el("div", { className: "share-box" });
  box.append(
    el("p", { text: "Аудит сохранён. Код для команды:" }),
    el("p", { className: "share-code", text: lastShareInfo.code }),
    el("p", { className: "meta", text: lastShareInfo.url }),
    el("div", { className: "actions" }, [
      el("button", {
        type: "button",
        className: "btn primary",
        text: "Копировать ссылку",
        onClick: async () => {
          try {
            await navigator.clipboard.writeText(lastShareInfo.url);
            alert("Ссылка скопирована");
          } catch {
            prompt("Скопируйте ссылку:", lastShareInfo.url);
          }
        },
      }),
      el("button", {
        type: "button",
        className: "btn ghost",
        text: "Копировать код",
        onClick: async () => {
          try {
            await navigator.clipboard.writeText(lastShareInfo.code);
            alert("Код скопирован");
          } catch {
            prompt("Скопируйте код:", lastShareInfo.code);
          }
        },
      }),
    ])
  );
  host.append(box);
}

async function deleteHistoryEntry(id) {
  if (!confirm("Удалить эту запись из истории?")) return;
  const entry = (state.history || []).find((h) => h.id === id);
  if (entry && entry.cloudId && cloudReady()) {
    try {
      await window.AuditCloud.cloudDelete(entry.cloudId);
    } catch (err) {
      console.error(err);
      alert("Не удалось удалить из облака.");
      return;
    }
  }
  const next = getLocalHistory().filter((h) => h.id !== id);
  saveLocalHistory(next);
  state.history = (state.history || []).filter((h) => h.id !== id);
  const detail = $("#history-detail");
  if (detail) {
    detail.hidden = true;
    detail.innerHTML = "";
  }
  renderHistory();
}

function restoreHistoryEntry(id) {
  const entry = (state.history || []).find((h) => h.id === id);
  if (!entry || !entry.snapshot) {
    alert("В этой записи нет полного снимка для восстановления.");
    return;
  }
  if (
    !confirm(
      "Загрузить этот аудит в рабочую область? Текущие незаписанные ответы будут заменены."
    )
  ) {
    return;
  }
  applySnapshot(entry.snapshot);
  switchTab("summary");
}

function applySnapshot(snapshot) {
  state.meta = JSON.parse(JSON.stringify(snapshot.meta));
  state.warehouses = JSON.parse(JSON.stringify(snapshot.warehouses));
  state.activeId = snapshot.activeId;
  state.byWarehouse = JSON.parse(JSON.stringify(snapshot.byWarehouse));
  saveState();
  renderWarehouses();
  updateWhLabels();
}

function formatSavedAt(iso) {
  try {
    const d = new Date(iso);
    return d.toLocaleString("ru-RU", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso || "—";
  }
}

function showHistoryDetail(id) {
  const entry = (state.history || []).find((h) => h.id === id);
  const host = $("#history-detail");
  if (!entry || !host) return;
  host.hidden = false;
  host.innerHTML = "";
  host.append(
    el("h3", {
      className: "subhead",
      text: `Детали: ${entry.meta.date || "без даты"} · ${entry.meta.auditor || "аудитор не указан"}`,
    }),
    el("p", {
      className: "meta",
      text: `Сохранено: ${formatSavedAt(entry.savedAt)} · складов: ${entry.warehouseCount} · ответов: ${entry.answered}`,
    })
  );

  if (entry.shareCode && cloudReady()) {
    const url = window.AuditCloud.shareUrl(entry.shareCode);
    const box = el("div", { className: "share-box" });
    box.append(
      el("p", { text: `Код для команды: ${entry.shareCode}` }),
      el("p", { className: "meta", text: url }),
      el("button", {
        type: "button",
        className: "btn ghost",
        text: "Копировать ссылку",
        onClick: async () => {
          try {
            await navigator.clipboard.writeText(url);
            alert("Ссылка скопирована");
          } catch {
            prompt("Скопируйте ссылку:", url);
          }
        },
      })
    );
    host.append(box);
  }

  const tableWrap = el("div", { className: "table-wrap" });
  const table = el("table", { className: "data-table" });
  const thead = el("thead");
  const headRow = el("tr");
  ["Склад", "Да", "Частично", "Нет", "Н/п", "Заполнено", "% Да"].forEach((h) =>
    headRow.append(el("th", { text: h }))
  );
  thead.append(headRow);
  const tbody = el("tbody");
  (entry.results || []).forEach((r) => {
    const tr = el("tr");
    [
      r.warehouseName,
      r.yes,
      r.partial,
      r.no,
      r.na,
      `${r.filled}/${r.total}`,
      r.pct == null ? "—" : `${r.pct}%`,
    ].forEach((v) => tr.append(el("td", { text: String(v) })));
    tbody.append(tr);
  });
  table.append(thead, tbody);
  tableWrap.append(table);
  host.append(tableWrap);

  host.append(el("h3", { className: "subhead", text: "Разрывы" }));
  const gaps = entry.gaps || [];
  if (!gaps.length) {
    host.append(el("p", { className: "meta", text: "Разрывов не зафиксировано." }));
  } else {
    const stack = el("div", { className: "stack" });
    gaps.forEach((g) => {
      const gap = el("div", { className: `gap${g.status === "partial" ? " partial" : ""}` });
      gap.append(
        el("div", {
          className: "where",
          text: `${g.warehouseName} · ${g.section} · ${STATUS_LABEL[g.status] || g.status}`,
        }),
        el("div", { text: g.text })
      );
      if (g.comment) gap.append(el("p", { className: "meta", text: g.comment }));
      stack.append(gap);
    });
    host.append(stack);
  }
}

async function renderHistory() {
  const list = $("#history-list");
  if (!list) return;
  list.innerHTML = "";
  list.append(el("p", { className: "meta", text: "Загрузка истории…" }));

  let entries = getLocalHistory();
  if (cloudReady()) {
    try {
      entries = await window.AuditCloud.cloudListAudits(50);
      saveLocalHistory(entries);
    } catch (err) {
      console.error(err);
      list.innerHTML = "";
      list.append(
        el("p", {
          className: "meta",
          text: "Облако временно недоступно — показана локальная копия истории.",
        })
      );
    }
  }

  state.history = entries;
  list.innerHTML = "";
  renderShareInto("#history-share");

  if (!entries.length) {
    list.append(
      el("p", {
        className: "meta",
        text: cloudReady()
          ? "Общая история пуста. Заполните обход и нажмите «Сохранить текущий аудит» на вкладке «Сводка»."
          : "История пуста. После настройки облака (SETUP-CLOUD.md) записи будут доступны всей команде по ссылке.",
      })
    );
    const detail = $("#history-detail");
    if (detail) {
      detail.hidden = true;
      detail.innerHTML = "";
    }
    return;
  }

  entries.forEach((entry) => {
    const card = el("div", { className: "history-card" });
    const title = `${entry.meta.date || "Дата не указана"} · ${entry.meta.auditor || "Аудитор не указан"}`;
    const yesTotal = (entry.results || []).reduce((s, r) => s + (r.yes || 0), 0);
    const noTotal = (entry.results || []).reduce((s, r) => s + (r.no || 0), 0);
    const partialTotal = (entry.results || []).reduce((s, r) => s + (r.partial || 0), 0);
    const shareBit = entry.shareCode ? ` · код: ${entry.shareCode}` : "";
    card.append(
      el("h3", { text: title }),
      el("p", {
        className: "meta",
        text: `Сохранено: ${formatSavedAt(entry.savedAt)} · складов: ${entry.warehouseCount} · заполнено оценок: ${entry.answered} · Да: ${yesTotal} · Частично: ${partialTotal} · Нет: ${noTotal} · разрывов: ${(entry.gaps || []).length}${shareBit}`,
      })
    );
    const actions = el("div", { className: "actions" });
    actions.append(
      el("button", {
        type: "button",
        className: "btn ghost",
        text: "Открыть",
        onClick: () => showHistoryDetail(entry.id),
      }),
      el("button", {
        type: "button",
        className: "btn ghost",
        text: "Загрузить в работу",
        onClick: () => restoreHistoryEntry(entry.id),
      }),
      el("button", {
        type: "button",
        className: "btn danger-ghost",
        text: "Удалить",
        onClick: () => deleteHistoryEntry(entry.id),
      })
    );
    card.append(actions);
    list.append(card);
  });
}

function renderSummaryShareHint() {
  renderShareBoxes();
}

function renderSummary() {
  const thead = $("#summary-table thead");
  const tbody = $("#summary-table tbody");
  thead.innerHTML = "";
  tbody.innerHTML = "";
  const headRow = el("tr");
  ["Склад", "Да", "Частично", "Нет", "Н/п", "Заполнено", "% Да"].forEach((h) =>
    headRow.append(el("th", { text: h }))
  );
  thead.append(headRow);

  const gapsHost = $("#gaps-list");
  gapsHost.innerHTML = "";

  state.warehouses.forEach((w) => {
    const stats = warehouseStats(w);
    const tr = el("tr");
    [
      stats.warehouseName,
      stats.yes,
      stats.partial,
      stats.no,
      stats.na,
      `${stats.filled}/${stats.total}`,
      stats.pct == null ? "—" : `${stats.pct}%`,
    ].forEach((v) => tr.append(el("td", { text: String(v) })));
    tbody.append(tr);

    stats.gaps.forEach((g) => {
      const gap = el("div", { className: `gap${g.status === "partial" ? " partial" : ""}` });
      gap.append(
        el("div", {
          className: "where",
          text: `${g.warehouseName} · ${g.section} · ${STATUS_LABEL[g.status]}`,
        }),
        el("div", { text: g.text })
      );
      if (g.comment) gap.append(el("p", { className: "meta", text: g.comment }));
      gapsHost.append(gap);
    });
  });

  if (!gapsHost.children.length) {
    gapsHost.append(
      el("p", {
        className: "meta",
        text: "Пока нет оценок «Нет» / «Частично» среди активных пунктов.",
      })
    );
  }
  renderSummaryShareHint();
}

function csvEscape(v) {
  const s = String(v ?? "");
  if (/[;"\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

function exportCsv() {
  const sep = ";";
  const lines = [];
  lines.push(["Аудитор", state.meta.auditor].map(csvEscape).join(sep));
  lines.push(["Дата", state.meta.date].map(csvEscape).join(sep));
  lines.push("");
  lines.push(["=== Пре-опрос ==="].join(sep));
  lines.push(["Ключ", "Вопрос", "Пояснение", ...state.warehouses.map((w) => w.name)].map(csvEscape).join(sep));
  DATA.screening.forEach((q) => {
    const row = [q.key, q.text, q.explain || ""];
    state.warehouses.forEach((w) => {
      const g = whData(w.id).gates[q.key] || "";
      row.push(STATUS_LABEL[g] || "");
    });
    lines.push(row.map(csvEscape).join(sep));
  });
  lines.push("");
  lines.push(["=== Чек-лист ==="].join(sep));
  const checkHeader = [
    "ID",
    "Блок",
    "Пункт",
    "Пояснение",
    "Приоритеты",
    "Если да",
    "Усилить если",
    ...state.warehouses.flatMap((w) => [`${w.name} — Оценка`, `${w.name} — Комментарий`]),
  ];
  lines.push(checkHeader.map(csvEscape).join(sep));
  DATA.items.forEach((item) => {
    const row = [
      item.id,
      item.section,
      item.text,
      item.explain || "",
      item.priorities,
      item.ifAny,
      item.elevateIf,
    ];
    state.warehouses.forEach((w) => {
      const a = whData(w.id).answers[item.id] || {};
      row.push(STATUS_LABEL[a.status || ""] || "", a.comment || "");
    });
    lines.push(row.map(csvEscape).join(sep));
  });

  const bom = "\uFEFF";
  const blob = new Blob([bom + lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `sklad-audit_${state.meta.date || "export"}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function exportBackup() {
  const blob = new Blob([JSON.stringify({ dataVersion: 1, state, exportedAt: new Date().toISOString() }, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `sklad-audit-backup_${state.meta.date || "export"}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function importBackup(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const parsed = JSON.parse(String(reader.result));
      const next = parsed.state || parsed;
      if (!next.warehouses || !next.byWarehouse) throw new Error("bad format");
      if (Array.isArray(next.history) && next.history.length) {
        saveLocalHistory(next.history);
      }
      state = {
        meta: next.meta || { auditor: "", date: new Date().toISOString().slice(0, 10) },
        warehouses: next.warehouses,
        activeId: next.activeId || next.warehouses[0]?.id || null,
        byWarehouse: next.byWarehouse,
        history: getLocalHistory(),
      };
      saveState();
      renderWarehouses();
      updateWhLabels();
      alert("Импорт выполнен");
      switchTab("summary");
    } catch {
      alert("Не удалось импортировать JSON");
    }
  };
  reader.readAsText(file, "utf-8");
}

function addWarehouse() {
  const w = { id: uid(), name: `Склад ${state.warehouses.length + 1}` };
  state.warehouses.push(w);
  state.byWarehouse[w.id] = emptyWarehouseState();
  state.activeId = w.id;
  saveState();
  renderWarehouses();
  updateWhLabels();
}

function showWelcome() {
  const welcome = $("#welcome");
  const shell = $("#app-shell");
  if (welcome) welcome.hidden = false;
  if (shell) shell.hidden = true;
  const draftBtn = $("#btn-continue-draft");
  if (draftBtn) draftBtn.hidden = !hasUsableDraft();
  const status = $("#welcome-cloud-status");
  if (status) {
    status.textContent = cloudReady()
      ? "Облако подключено: сохранённые аудиты доступны участникам по ссылке или коду."
      : "Облако ещё не настроено — общая ссылка недоступна. См. SETUP-CLOUD.md. Можно работать локально и продолжить черновик на этом устройстве.";
  }
}

function enterApp(tab) {
  const welcome = $("#welcome");
  const shell = $("#app-shell");
  if (welcome) welcome.hidden = true;
  if (shell) shell.hidden = false;
  if (!state.activeId && state.warehouses[0]) state.activeId = state.warehouses[0].id;
  renderWarehouses();
  updateWhLabels();
  switchTab(tab || "setup");
}

function startNewAudit() {
  lastShareInfo = null;
  state = defaultState(DATA);
  state.history = getLocalHistory();
  clearDraftStorage();
  saveState();
  enterApp("setup");
}

function openNewAuditWindow() {
  const u = new URL(location.href);
  u.search = "";
  u.searchParams.set("new", "1");
  u.hash = "";
  window.open(u.toString(), "_blank", "noopener,noreferrer");
}

function continueDraft() {
  lastShareInfo = null;
  state = loadDraftState(DATA);
  enterApp("setup");
}

async function openSharedAudit(code) {
  const clean = String(code || "")
    .trim()
    .toUpperCase();
  if (!clean) {
    alert("Введите код аудита");
    return;
  }
  if (!cloudReady()) {
    alert("Облако не настроено. Открыть чужой аудит по коду нельзя — см. SETUP-CLOUD.md");
    return;
  }
  try {
    const entry = await window.AuditCloud.cloudGetByCode(clean);
    if (!entry || !entry.snapshot) {
      alert("Аудит с таким кодом не найден");
      return;
    }
    state = defaultState(DATA);
    state.history = getLocalHistory();
    applySnapshot(entry.snapshot);
    lastShareInfo = { code: entry.shareCode || clean, url: window.AuditCloud.shareUrl(entry.shareCode || clean) };
    enterApp("summary");
    alert("Открыт общий аудит " + (entry.shareCode || clean));
  } catch (err) {
    console.error(err);
    alert("Не удалось загрузить аудит по коду");
  }
}

function bind() {
  if (bound) return;
  bound = true;

  document.querySelectorAll(".tab").forEach((tab) => {
    tab.addEventListener("click", () => switchTab(tab.dataset.tab));
  });
  $("#meta-auditor").addEventListener("input", (e) => {
    state.meta.auditor = e.target.value;
    saveState();
  });
  $("#meta-date").addEventListener("change", (e) => {
    state.meta.date = e.target.value;
    saveState();
  });

  window.__addWarehouse = addWarehouse;
  document.addEventListener("click", (e) => {
    const t = e.target;
    if (!t || !t.closest) return;
    const btn = t.closest("#btn-add-wh");
    if (!btn) return;
    e.preventDefault();
    addWarehouse();
  });

  ["filter-section", "filter-priority", "filter-scope"].forEach((id) => {
    const node = $(`#${id}`);
    if (node) node.addEventListener("change", renderAudit);
  });
  $("#btn-export").addEventListener("click", exportCsv);
  $("#btn-backup").addEventListener("click", exportBackup);
  $("#import-json").addEventListener("change", (e) => {
    const file = e.target.files?.[0];
    if (file) importBackup(file);
    e.target.value = "";
  });

  const saveBtns = ["#btn-save-history", "#btn-save-history-2"];
  saveBtns.forEach((sel) => {
    const node = $(sel);
    if (node) node.addEventListener("click", () => saveCurrentAuditToHistory());
  });

  const newWindowBtn = $("#btn-new-window");
  if (newWindowBtn) {
    newWindowBtn.addEventListener("click", openNewAuditWindow);
  }

  document.querySelectorAll("[data-scroll-top]").forEach((btn) => {
    btn.addEventListener("click", () => {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  });

  const btnNew = $("#btn-start-new");
  if (btnNew) btnNew.addEventListener("click", startNewAudit);
  const btnDraft = $("#btn-continue-draft");
  if (btnDraft) btnDraft.addEventListener("click", continueDraft);
  const btnCode = $("#btn-open-code");
  if (btnCode) {
    btnCode.addEventListener("click", () => openSharedAudit($("#welcome-code")?.value));
  }
  const codeInput = $("#welcome-code");
  if (codeInput) {
    codeInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") openSharedAudit(codeInput.value);
    });
  }
}

async function boot() {
  DATA = window.CHECKLIST_DATA || null;
  if (!DATA || !DATA.items || !DATA.screening) {
    document.body.innerHTML =
      "<main style='padding:2rem;font-family:sans-serif'><h1>Не удалось загрузить данные чек-листа</h1><p>Проверьте, что файл data.js открывается вместе с сайтом.</p><p>Правильная ссылка: https://theslavok.github.io/sklad-audit/</p></main>";
    return;
  }
  try {
    migrateLegacyOnce();
    bind();
    const params = new URLSearchParams(location.search);
    if (params.get("new") === "1") {
      try {
        const clean = new URL(location.href);
        clean.searchParams.delete("new");
        history.replaceState({}, "", clean.pathname + clean.search + clean.hash);
      } catch {
        /* ignore */
      }
      startNewAudit();
      return;
    }
    const code = params.get("a");
    if (code) {
      await openSharedAudit(code);
      if ($("#app-shell") && !$("#app-shell").hidden) return;
    }
    showWelcome();
  } catch (err) {
    console.error(err);
    document.body.innerHTML =
      "<main style='padding:2rem;font-family:sans-serif'><h1>Ошибка запуска</h1><p>" +
      String(err && err.message ? err.message : err) +
      "</p></main>";
  }
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}
