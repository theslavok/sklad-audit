(function (global) {
  function cfg() {
    return global.CLOUD_CONFIG || {};
  }

  function isCloudConfigured() {
    const c = cfg();
    return Boolean(c.supabaseUrl && c.supabaseAnonKey);
  }

  function headers(preferReturn) {
    const c = cfg();
    const h = {
      apikey: c.supabaseAnonKey,
      Authorization: "Bearer " + c.supabaseAnonKey,
      "Content-Type": "application/json",
    };
    if (preferReturn) h.Prefer = preferReturn;
    return h;
  }

  function baseUrl() {
    return String(cfg().supabaseUrl || "").replace(/\/$/, "") + "/rest/v1/audits";
  }

  function shareCode() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let out = "";
    for (let i = 0; i < 8; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
    return out;
  }

  function rowToEntry(row) {
    if (!row) return null;
    const payload = row.payload || {};
    return Object.assign({}, payload, {
      id: payload.id || row.id,
      cloudId: row.id,
      shareCode: row.share_code || payload.shareCode || "",
      savedAt: payload.savedAt || row.created_at,
      meta: payload.meta || { auditor: row.auditor || "", date: row.audit_date || "" },
    });
  }

  async function cloudSaveAudit(entry) {
    if (!isCloudConfigured()) throw new Error("cloud_not_configured");
    const code = String(entry.shareCode || shareCode()).toUpperCase();
    const body = {
      share_code: code,
      auditor: (entry.meta && entry.meta.auditor) || "",
      audit_date: (entry.meta && entry.meta.date) || "",
      payload: Object.assign({}, entry, { shareCode: code }),
    };
    const res = await fetch(baseUrl(), {
      method: "POST",
      headers: headers("return=representation"),
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error("cloud_save_failed: " + res.status + " " + text);
    }
    let row = null;
    try {
      const rows = await res.json();
      row = Array.isArray(rows) ? rows[0] : rows;
    } catch {
      row = null;
    }
    const mapped = rowToEntry(row);
    if (mapped) {
      mapped.shareCode = mapped.shareCode || code;
      return mapped;
    }
    return Object.assign({}, entry, { shareCode: code, cloudId: null });
  }

  async function cloudListAudits(limit) {
    if (!isCloudConfigured()) return [];
    const url =
      baseUrl() +
      "?select=*&order=created_at.desc&limit=" +
      encodeURIComponent(String(limit || 50));
    const res = await fetch(url, { headers: headers() });
    if (!res.ok) throw new Error("cloud_list_failed: " + res.status);
    const rows = await res.json();
    return (rows || []).map(rowToEntry).filter(Boolean);
  }

  async function cloudGetByCode(code) {
    if (!isCloudConfigured()) throw new Error("cloud_not_configured");
    const url =
      baseUrl() +
      "?share_code=eq." +
      encodeURIComponent(String(code).trim().toUpperCase()) +
      "&select=*&limit=1";
    const res = await fetch(url, { headers: headers() });
    if (!res.ok) throw new Error("cloud_get_failed: " + res.status);
    const rows = await res.json();
    if (!rows || !rows.length) return null;
    return rowToEntry(rows[0]);
  }

  async function cloudDelete(cloudId, password) {
    if (!isCloudConfigured() || !cloudId) return;
    const c = cfg();
    const url = String(c.supabaseUrl || "").replace(/\/$/, "") + "/rest/v1/rpc/delete_audit";
    const res = await fetch(url, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({
        p_id: cloudId,
        p_password: String(password || ""),
      }),
    });
    if (!res.ok) {
      const text = await res.text();
      if (/неверн|forbidden|password|парол/i.test(text) || res.status === 400 || res.status === 403) {
        throw new Error("bad_password");
      }
      throw new Error("cloud_delete_failed: " + res.status + " " + text);
    }
  }

  function shareUrl(code) {
    const u = new URL(location.href);
    u.searchParams.set("a", code);
    u.hash = "";
    return u.toString();
  }

  global.AuditCloud = {
    isCloudConfigured,
    cloudSaveAudit,
    cloudListAudits,
    cloudGetByCode,
    cloudDelete,
    shareCode,
    shareUrl,
  };
})(window);
