const STORAGE_KEY = "sklad-audit-v1";

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

function loadState(data) {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState(data);
    const parsed = JSON.parse(raw);
    if (!parsed?.warehouses?.length) return defaultState(data);
    if (!Array.isArray(parsed.history)) parsed.history = [];
    return parsed;
  } catch {
    return defaultState(data);
  }
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
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

function saveCurrentAuditToHistory() {
  if (!Array.isArray(state.history)) state.history = [];
  const entry = buildHistoryEntry();
  if (entry.answered === 0) {
    const ok = confirm(
      "По текущему аудиту почти нет заполненных оценок. Всё равно сохранить в историю?"
    );
    if (!ok) return;
  }
  state.history.unshift(entry);
  saveState();
  alert("Аудит сохранён в историю.");
  switchTab("history");
}

function deleteHistoryEntry(id) {
  if (!confirm("Удалить эту запись из истории?")) return;
  state.history = (state.history || []).filter((h) => h.id !== id);
  saveState();
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
  state.meta = JSON.parse(JSON.stringify(entry.snapshot.meta));
  state.warehouses = JSON.parse(JSON.stringify(entry.snapshot.warehouses));
  state.activeId = entry.snapshot.activeId;
  state.byWarehouse = JSON.parse(JSON.stringify(entry.snapshot.byWarehouse));
  saveState();
  renderWarehouses();
  updateWhLabels();
  switchTab("summary");
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

function renderHistory() {
  if (!Array.isArray(state.history)) state.history = [];
  const list = $("#history-list");
  if (!list) return;
  list.innerHTML = "";

  if (!state.history.length) {
    list.append(
      el("p", {
        className: "meta",
        text: "История пуста. Заполните обход и нажмите «Сохранить текущий аудит в историю» на вкладке «Сводка».",
      })
    );
    const detail = $("#history-detail");
    if (detail) {
      detail.hidden = true;
      detail.innerHTML = "";
    }
    return;
  }

  state.history.forEach((entry) => {
    const card = el("div", { className: "history-card" });
    const title = `${entry.meta.date || "Дата не указана"} · ${entry.meta.auditor || "Аудитор не указан"}`;
    const yesTotal = (entry.results || []).reduce((s, r) => s + (r.yes || 0), 0);
    const noTotal = (entry.results || []).reduce((s, r) => s + (r.no || 0), 0);
    const partialTotal = (entry.results || []).reduce((s, r) => s + (r.partial || 0), 0);
    card.append(
      el("h3", { text: title }),
      el("p", {
        className: "meta",
        text: `Сохранено: ${formatSavedAt(entry.savedAt)} · складов: ${entry.warehouseCount} · заполнено оценок: ${entry.answered} · Да: ${yesTotal} · Частично: ${partialTotal} · Нет: ${noTotal} · разрывов: ${(entry.gaps || []).length}`,
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
      if (!Array.isArray(next.history)) next.history = [];
      state = next;
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

function bind() {
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
    if (node) node.addEventListener("click", saveCurrentAuditToHistory);
  });
}

function boot() {
  DATA = window.CHECKLIST_DATA || null;
  if (!DATA || !DATA.items || !DATA.screening) {
    document.body.innerHTML =
      "<main style='padding:2rem;font-family:sans-serif'><h1>Не удалось загрузить данные чек-листа</h1><p>Проверьте, что файл data.js открывается вместе с сайтом.</p><p>Правильная ссылка: https://theslavok.github.io/sklad-audit/</p></main>";
    return;
  }
  try {
    state = loadState(DATA);
    if (!state.warehouses || !state.warehouses.length) {
      state = defaultState(DATA);
    }
    if (!Array.isArray(state.history)) state.history = [];
    if (!state.activeId && state.warehouses[0]) {
      state.activeId = state.warehouses[0].id;
    }
    bind();
    renderWarehouses();
    updateWhLabels();
    switchTab("setup");
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
