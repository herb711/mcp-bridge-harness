const token = window.__MCP_HARNESS_TOKEN__;
const desktopBridge = window.harnessApi;
const isDesktop = Boolean(desktopBridge?.invoke);
const state = {
  status: null,
  catalog: [],
  installed: [],
  clients: {},
  selectedMcpId: "minimax-bridge",
  update: null,
  updateChecking: false,
};

const titles = {
  dashboard: ["总览", "查看本地 Harness 状态和 MCP 配置。"],
  configure: ["配置 OpenCode", "选择要同步到 OpenCode 的 MCP，并保存本地 profile。"],
  market: ["MCP 市场", "发现、安装和配置可同步到 Harness 的 MCP。"],
  harnesses: ["Harness 目标", "管理 MCP 要同步到哪些编程工具。"],
};

function $(selector) { return document.querySelector(selector); }
function $all(selector) { return Array.from(document.querySelectorAll(selector)); }

function parseBody(options) {
  if (!options || options.body == null) return undefined;
  if (typeof options.body !== "string") return options.body;
  try { return JSON.parse(options.body); }
  catch { return options.body; }
}

async function api(path, options = {}) {
  const method = (options.method || "GET").toUpperCase();
  if (isDesktop) {
    return desktopBridge.invoke({ path, method, body: parseBody(options) });
  }

  const response = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      "x-harness-token": token,
      ...(options.headers || {}),
    },
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
  return data;
}

function showAlert(message, type = "ok") {
  const el = $("#alert");
  el.textContent = message;
  el.classList.remove("hidden", "error");
  if (type === "error") el.classList.add("error");
}

function hideAlert() { $("#alert").classList.add("hidden"); }

function switchPage(page) {
  $all(".page").forEach((el) => el.classList.toggle("hidden", el.id !== page));
  const activeNavPage = page === "configure" ? "harnesses" : page;
  $all(".nav").forEach((el) => el.classList.toggle("active", el.dataset.page === activeNavPage));
  const [title, subtitle] = titles[page] || titles.dashboard;
  $("#pageTitle").textContent = title;
  $("#pageSubtitle").textContent = subtitle;
  hideAlert();
}

function selectedInstalled() {
  return state.installed.find((item) => item.id === state.selectedMcpId);
}

function selectedCatalogEntry() {
  return state.catalog.find((item) => item.id === state.selectedMcpId);
}

function configurableMcps() {
  const installedIds = new Set(state.installed.map((item) => item.id));
  const installed = state.installed
    .map((item) => state.catalog.find((entry) => entry.id === item.id))
    .filter(Boolean);
  const readyNotInstalled = state.catalog.filter((entry) => {
    const ready = entry.status === "bundled" || entry.status === "available";
    return ready && entry.supportedHarnesses?.includes("opencode") && !installedIds.has(entry.id);
  });
  return [...installed, ...readyNotInstalled];
}

function ensureSelectedMcp() {
  const options = configurableMcps();
  if (!options.length) return;
  if (!options.some((item) => item.id === state.selectedMcpId)) {
    state.selectedMcpId = options[0].id;
  }
}

function renderStatus() {
  const kv = $("#statusKv");
  const status = state.status || {};
  const rows = [
    ["应用版本", status.version],
    ["运行模式", isDesktop ? "桌面 App（Electron IPC，无本地 HTTP 服务）" : "Legacy localhost web server"],
    ["数据目录", status.dataDir],
    ["State", status.statePath],
    ["Secrets", status.secretsPath],
    ["OpenCode 配置", status.opencodeConfigPath],
    ["已配置 MCP", String(status.configuredMcpCount ?? status.installedCount ?? 0)],
  ];
  kv.innerHTML = rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${escapeHtml(v || "-")}</dd></div>`).join("");
}

function formatBytes(size) {
  if (!Number.isFinite(size) || size <= 0) return "";
  if (size > 1024 * 1024 * 1024) return `${(size / 1024 / 1024 / 1024).toFixed(1)} GB`;
  if (size > 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  if (size > 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${size} B`;
}

function updateTargetUrl() {
  return state.update?.asset?.url || state.update?.releaseUrl || state.status?.releasePageUrl || "";
}

function setUpdateBadge(text, tone = "") {
  const badge = $("#updateBadge");
  badge.textContent = text;
  badge.className = `badge ${tone}`.trim();
}

function renderUpdatePanel() {
  const summary = $("#updateSummary");
  const details = $("#updateDetails");
  const downloadButton = $("#downloadUpdateBtn");
  const currentVersion = state.status?.version || state.update?.currentVersion || "-";
  const releaseUrl = state.update?.releaseUrl || state.status?.releasePageUrl || "";

  $("#openReleaseBtn").disabled = !releaseUrl;
  downloadButton.classList.add("hidden");
  downloadButton.dataset.url = "";

  if (state.updateChecking) {
    setUpdateBadge("检查中", "warn");
    summary.textContent = `当前版本 ${currentVersion}，正在连接 GitHub 检查更新...`;
    details.innerHTML = "";
    return;
  }

  const update = state.update;
  if (!update) {
    setUpdateBadge("未检查");
    summary.textContent = `当前版本 ${currentVersion}。`;
    details.innerHTML = "";
    return;
  }

  if (!update.ok) {
    setUpdateBadge("检查失败", "warn");
    summary.textContent = `当前版本 ${currentVersion}，暂时无法获取 GitHub 最新版本。`;
    details.innerHTML = update.error ? `<p class="muted">${escapeHtml(update.error)}</p>` : "";
    return;
  }

  const latest = update.latestVersion ? `v${update.latestVersion}` : "未知版本";
  const releaseDate = update.releaseDate ? new Date(update.releaseDate).toLocaleString() : "";
  const asset = update.asset;
  const assetSize = formatBytes(asset?.size);
  const assetText = asset ? `${asset.name}${assetSize ? ` · ${assetSize}` : ""}` : "未找到当前平台安装包，可打开发布页手动选择。";
  details.innerHTML = `
    <p class="muted">最新版本：${escapeHtml(latest)}${releaseDate ? ` · ${escapeHtml(releaseDate)}` : ""}</p>
    <p class="muted">更新包：${escapeHtml(assetText)}</p>
  `;

  if (update.updateAvailable) {
    setUpdateBadge("有新版本", "warn");
    summary.textContent = `发现新版本 ${latest}，当前版本 v${currentVersion}。`;
    downloadButton.textContent = asset ? "下载更新" : "查看更新";
    downloadButton.dataset.url = updateTargetUrl();
    downloadButton.classList.remove("hidden");
    return;
  }

  setUpdateBadge("已是最新", "ok");
  summary.textContent = `当前版本 v${currentVersion} 已是 GitHub 最新发布版。`;
}

function renderInstalled() {
  const list = $("#installedList");
  if (!state.installed.length) {
    list.innerHTML = `<p class="muted">还没有可配置的 MCP。</p>`;
    return;
  }
  list.innerHTML = state.installed.map((item) => {
    const configured = item.configured === true;
    const missing = (item.missingRequiredKeys || []).join(" / ");
    return `
      <article class="installed-card">
        <header>
          <div>
            <strong>${escapeHtml(item.displayName)}</strong>
            <p class="muted">${escapeHtml(item.id)} · ${escapeHtml(item.version)}</p>
          </div>
          <span class="badge ${configured ? "ok" : "warn"}">${configured ? "已配置" : "待配置"}</span>
        </header>
        <p class="muted">${configured ? "Profile 已保存必要配置。" : `缺少：${escapeHtml(missing || "必要配置")}`}</p>
        <p class="muted">命令：<code>${escapeHtml(item.command || "")}</code></p>
        <div class="tags">
          ${(item.targetHarnesses || []).map((x) => `<span class="tag">${escapeHtml(x)}</span>`).join("")}
        </div>
      </article>
    `;
  }).join("");
}

function renderMarket() {
  const grid = $("#marketGrid");
  grid.innerHTML = state.catalog.map((item) => {
    const ready = item.status === "bundled" || item.status === "available";
    const bundled = item.status === "bundled";
    return `
      <article class="market-card">
        <header>
          <div>
            <strong>${escapeHtml(item.displayName)}</strong>
            <p>${escapeHtml(item.category)} · ${escapeHtml(item.installMode)}</p>
          </div>
          <span class="badge ${ready ? "ok" : "warn"}">${ready ? "可用" : "预留"}</span>
        </header>
        <p>${escapeHtml(item.description)}</p>
        <div class="tags">${(item.tags || []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>
        <p class="small">支持：${(item.supportedHarnesses || []).map(escapeHtml).join(" / ")}</p>
        <div class="actions">
          <button class="secondary" ${bundled ? `data-configure-mcp="${escapeHtml(item.id)}"` : `data-install="${escapeHtml(item.id)}"`}>${bundled ? "进入配置" : ready ? "安装" : "查看预留"}</button>
        </div>
      </article>
    `;
  }).join("");
}

function renderHarnesses() {
  const list = $("#harnessList");
  const items = state.status?.supportedHarnesses || [];
  list.innerHTML = items.map((item) => {
    const ready = item.status === "ready";
    const configured = ready && item.configured === true;
    return `
      <article class="harness-card ${ready ? "clickable" : ""}" data-harness-id="${escapeHtml(item.id)}">
        <header>
          <div>
            <strong>${escapeHtml(item.name)}</strong>
            <p class="muted">${escapeHtml(item.id)}</p>
          </div>
          <span class="badge ${configured ? "ok" : "warn"}">${configured ? "已配置" : ready ? "可配置" : "已预留"}</span>
        </header>
        <p class="muted">${escapeHtml(item.description || (ready ? "可以一键写入全局配置。" : "后续版本实现对应 Adapter。"))}</p>
        ${ready && item.id === "opencode" ? `
          <div class="actions">
            <button type="button" class="primary small-button" data-configure-harness="opencode">进入配置 OpenCode</button>
          </div>
        ` : ""}
      </article>
    `;
  }).join("");
}

function renderMcpSelector() {
  const select = $("#mcpSelect");
  const options = configurableMcps();
  select.innerHTML = options.map((item) => `<option value="${escapeHtml(item.id)}">${escapeHtml(item.displayName)}</option>`).join("");
  select.value = state.selectedMcpId;
}

function renderProfileForm() {
  const entry = selectedCatalogEntry();
  const installed = selectedInstalled();
  const fields = entry?.fields || [];
  const env = installed?.effectiveEnv || {};
  $("#selectedMcpName").textContent = entry?.displayName || state.selectedMcpId;
  $("#configTitle").textContent = `配置 OpenCode 使用 ${entry?.displayName || state.selectedMcpId}`;
  $("#configDescription").textContent = entry
    ? `${entry.description} API Key 会保存到本机 Harness secrets 文件，不写入 OpenCode 配置。`
    : "请选择要配置的 MCP。";
  $("#testApiBtn").textContent = `测试 ${entry?.displayName || "MCP"} API`;

  if (!fields.length) {
    $("#mcpFields").innerHTML = `<p class="muted">这个 MCP 暂无可配置字段。</p>`;
    return;
  }

  $("#mcpFields").innerHTML = fields.map((field) => renderField(field, env[field.key])).join("");
}

function renderField(field, value) {
  const id = `field_${field.key}`;
  const required = field.required ? " <b>*</b>" : "";
  const help = field.help ? `<small>${escapeHtml(field.help)}</small>` : "";
  const safeValue = isMaskedSecret(value) ? "" : String(value ?? field.default ?? "");
  const placeholder = isMaskedSecret(value) ? "已保存，留空则不修改" : (field.placeholder || "");

  if (field.type === "boolean") {
    const checked = String(value ?? field.default ?? "").toLowerCase() === "true";
    return `
      <label class="check" for="${escapeHtml(id)}">
        <input id="${escapeHtml(id)}" name="${escapeHtml(field.key)}" type="checkbox" ${checked ? "checked" : ""} />
        <span>${escapeHtml(field.label)}${required}${help}</span>
      </label>
    `;
  }

  if (field.type === "select") {
    const options = (field.options || []).map((option) => {
      const selected = String(option.value) === String(value ?? field.default ?? "") ? "selected" : "";
      return `<option value="${escapeHtml(option.value)}" ${selected}>${escapeHtml(option.label)}</option>`;
    }).join("");
    return `
      <label for="${escapeHtml(id)}">
        <span>${escapeHtml(field.label)}${required}</span>
        <select id="${escapeHtml(id)}" name="${escapeHtml(field.key)}">${options}</select>
        ${help}
      </label>
    `;
  }

  if (field.type === "textarea") {
    return `
      <label for="${escapeHtml(id)}">
        <span>${escapeHtml(field.label)}${required}</span>
        <textarea id="${escapeHtml(id)}" name="${escapeHtml(field.key)}" rows="3" placeholder="${escapeHtml(placeholder)}">${escapeHtml(safeValue)}</textarea>
        ${help}
      </label>
    `;
  }

  return `
    <label for="${escapeHtml(id)}">
      <span>${escapeHtml(field.label)}${required}</span>
      <input id="${escapeHtml(id)}" name="${escapeHtml(field.key)}" type="${field.type === "password" ? "password" : "text"}" autocomplete="off" placeholder="${escapeHtml(placeholder)}" value="${escapeHtml(safeValue)}" />
      ${help}
    </label>
  `;
}

function isMaskedSecret(value) {
  return String(value || "").includes("•••") || String(value || "").includes("鈥");
}

async function renderPreview() {
  const mcpId = state.selectedMcpId;
  const preview = await api(`/api/harness/opencode/preview?mcpId=${encodeURIComponent(mcpId)}&profileId=default`);
  $("#opencodePreview").textContent = JSON.stringify({
    path: preview.configPath,
    instructions: [preview.instructionRef],
    mcp: {
      [mcpId]: preview.entry,
    },
  }, null, 2);
}

async function loadAll() {
  const [status, catalog, installed] = await Promise.all([
    api("/api/status"),
    api("/api/catalog"),
    api("/api/installed"),
  ]);
  state.status = status;
  state.catalog = catalog.catalog;
  state.installed = installed.installed;
  state.clients = installed.clients;
  ensureSelectedMcp();
  renderStatus();
  renderInstalled();
  renderMarket();
  renderHarnesses();
  renderMcpSelector();
  renderProfileForm();
  renderUpdatePanel();
  await renderPreview();
}

async function checkUpdate({ force = false, silent = false } = {}) {
  state.updateChecking = true;
  renderUpdatePanel();
  try {
    state.update = await api(`/api/update/check${force ? "?force=1" : ""}`);
    if (!silent) {
      if (state.update.updateAvailable) {
        showAlert(`发现新版本 v${state.update.latestVersion}。可以点击“下载更新”获取安装包。`, "ok");
      } else if (state.update.ok) {
        showAlert("当前已经是最新版本。", "ok");
      } else {
        showAlert(state.update.error || "检查更新失败。", "error");
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    state.update = {
      ok: false,
      currentVersion: state.status?.version || "-",
      latestVersion: null,
      latestTag: null,
      updateAvailable: false,
      releaseUrl: state.status?.releasePageUrl || "",
      releaseName: null,
      releaseDate: null,
      releaseNotes: null,
      asset: null,
      checkedAt: new Date().toISOString(),
      source: null,
      error: message,
    };
    if (!silent) showAlert(message, "error");
  } finally {
    state.updateChecking = false;
    renderUpdatePanel();
  }
}

function collectForm() {
  const form = $("#mcpProfileForm");
  const entry = selectedCatalogEntry();
  const env = {};
  const secrets = {};
  for (const field of entry?.fields || []) {
    const input = form.elements[field.key];
    if (!input) continue;
    const value = input.type === "checkbox" ? (input.checked ? "true" : "false") : String(input.value || "").trim();
    if (field.secret) secrets[field.key] = value;
    else env[field.key] = value;
  }
  return { env, secrets };
}

async function saveProfile({ silent = false } = {}) {
  const { env, secrets } = collectForm();
  const mcpId = state.selectedMcpId;
  await api("/api/mcp/profile", {
    method: "POST",
    body: JSON.stringify({ mcpId, profileId: "default", env, secrets }),
  });
  await loadAll();
  if (!silent) showAlert(`已保存 ${selectedCatalogEntry()?.displayName || mcpId} profile。OpenCode 配置尚未修改。`, "ok");
}

async function runProbe(mode) {
  await saveProfile({ silent: true });
  const mcpName = selectedCatalogEntry()?.displayName || state.selectedMcpId;
  $("#probeResult").textContent = mode === "api" ? `正在测试 ${mcpName} API...` : "正在测试 MCP 启动和工具列表...";
  const result = await api("/api/mcp/test", {
    method: "POST",
    body: JSON.stringify({ mcpId: state.selectedMcpId, profileId: "default", mode }),
  });
  $("#probeResult").textContent = JSON.stringify(result, null, 2);
  const passed = result.ok !== false;
  showAlert(
    passed
      ? (mode === "api" ? `${mcpName} API 测试通过。` : "MCP 启动和工具探测通过。")
      : (mode === "api" ? `${mcpName} API 测试未通过，请检查 API Key。` : "MCP 启动或工具探测未通过。"),
    passed ? "ok" : "error",
  );
}

async function applyOpenCode(event) {
  event?.preventDefault();
  const { env, secrets } = collectForm();
  const mcpId = state.selectedMcpId;
  const result = await api("/api/harness/opencode/apply", {
    method: "POST",
    body: JSON.stringify({ mcpId, profileId: "default", enabled: true, env, secrets }),
  });
  await loadAll();
  showAlert(`已写入 OpenCode 配置：${result.configPath}${result.backupPath ? `；备份：${result.backupPath}` : ""}。重新打开 OpenCode 后即可使用 ${mcpId} MCP。`, "ok");
}

function openExternalUrl(url) {
  if (!url) return;
  window.open(url, "_blank", "noopener,noreferrer");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

$all(".nav").forEach((button) => button.addEventListener("click", () => switchPage(button.dataset.page)));
$("#backToHarnessesBtn").addEventListener("click", () => switchPage("harnesses"));
$("#mcpSelect").addEventListener("change", async (event) => {
  state.selectedMcpId = event.target.value;
  renderProfileForm();
  await renderPreview();
});
$("#refreshBtn").addEventListener("click", async () => {
  await loadAll();
  showAlert("已刷新。", "ok");
});
$("#checkUpdateBtn").addEventListener("click", () => checkUpdate({ force: true }).catch((error) => showAlert(error.message, "error")));
$("#downloadUpdateBtn").addEventListener("click", () => openExternalUrl($("#downloadUpdateBtn").dataset.url || updateTargetUrl()));
$("#openReleaseBtn").addEventListener("click", () => openExternalUrl(state.update?.releaseUrl || state.status?.releasePageUrl));
$("#saveProfileBtn").addEventListener("click", () => saveProfile().catch((error) => showAlert(error.message, "error")));
$("#testStartupBtn").addEventListener("click", () => runProbe("startup").catch((error) => showAlert(error.message, "error")));
$("#testApiBtn").addEventListener("click", () => runProbe("api").catch((error) => showAlert(error.message, "error")));
$("#mcpProfileForm").addEventListener("submit", (event) => applyOpenCode(event).catch((error) => showAlert(error.message, "error")));
$("#marketGrid").addEventListener("click", async (event) => {
  const configureButton = event.target.closest("[data-configure-mcp]");
  if (configureButton?.dataset.configureMcp) {
    state.selectedMcpId = configureButton.dataset.configureMcp;
    switchPage("configure");
    renderMcpSelector();
    renderProfileForm();
    await renderPreview();
    return;
  }
  const button = event.target.closest("[data-install]");
  if (!button) return;
  try {
    const result = await api("/api/catalog/install", {
      method: "POST",
      body: JSON.stringify({ mcpId: button.dataset.install }),
    });
    await loadAll();
    showAlert(result.installed ? "MCP 已添加到配置列表。" : result.reason, result.installed ? "ok" : "error");
  } catch (error) {
    showAlert(error.message, "error");
  }
});
$("#harnessList").addEventListener("click", (event) => {
  const button = event.target.closest("[data-configure-harness]");
  const card = event.target.closest("[data-harness-id]");
  const id = button?.dataset.configureHarness || card?.dataset.harnessId;
  if (id === "opencode") switchPage("configure");
});

loadAll()
  .then(() => checkUpdate({ silent: true }))
  .catch((error) => showAlert(error.message, "error"));
