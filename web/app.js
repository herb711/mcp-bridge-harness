const token = window.__MCP_HARNESS_TOKEN__;
const desktopBridge = window.harnessApi;
const isDesktop = Boolean(desktopBridge?.invoke);
const state = {
  status: null,
  catalog: [],
  installed: [],
  clients: {},
};

const titles = {
  dashboard: ["总览", "查看本地 Harness 状态和已安装 MCP。"],
  configure: ["配置 OpenCode", "从 Harness 目标进入，配置 OpenCode 直接使用 MCP。"],
  market: ["MCP 市场", "预留 MCP 下载、安装、健康检查和多 Harness 分发入口。"],
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

function renderStatus() {
  const kv = $("#statusKv");
  const status = state.status || {};
  const rows = [
    ["运行模式", isDesktop ? "桌面 App（Electron IPC，无本地 HTTP 服务）" : "Legacy localhost web server"],
    ["数据目录", status.dataDir],
    ["State", status.statePath],
    ["Secrets", status.secretsPath],
    ["OpenCode 配置", status.opencodeConfigPath],
    ["已安装 MCP", String(status.installedCount ?? 0)],
  ];
  kv.innerHTML = rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${escapeHtml(v || "-")}</dd></div>`).join("");
}

function renderInstalled() {
  const list = $("#installedList");
  if (!state.installed.length) {
    list.innerHTML = `<p class="muted">还没有安装 MCP。</p>`;
    return;
  }
  list.innerHTML = state.installed.map((item) => `
    <article class="installed-card">
      <header>
        <div>
          <strong>${escapeHtml(item.displayName)}</strong>
          <p class="muted">${escapeHtml(item.id)} · ${escapeHtml(item.version)}</p>
        </div>
        <span class="badge ok">已安装</span>
      </header>
      <p class="muted">命令：<code>${escapeHtml(item.command || "")}</code></p>
      <div class="tags">
        ${(item.targetHarnesses || []).map((x) => `<span class="tag">${escapeHtml(x)}</span>`).join("")}
      </div>
    </article>
  `).join("");
}

function renderMarket() {
  const grid = $("#marketGrid");
  grid.innerHTML = state.catalog.map((item) => {
    const ready = item.status === "bundled" || item.status === "available";
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
        <div class="tags">${item.tags.map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("")}</div>
        <p class="small">支持：${item.supportedHarnesses.map(escapeHtml).join(" / ")}</p>
        <div class="actions">
          <button class="secondary" data-install="${escapeHtml(item.id)}">${ready ? "安装/确认安装" : "查看预留"}</button>
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
    return `
      <article class="harness-card ${ready ? "clickable" : ""}" data-harness-id="${escapeHtml(item.id)}">
        <header>
          <div>
            <strong>${escapeHtml(item.name)}</strong>
            <p class="muted">${escapeHtml(item.id)}</p>
          </div>
          <span class="badge ${ready ? "ok" : "warn"}">${ready ? "已实现" : "已预留"}</span>
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

function fillFormFromInstalled() {
  const item = state.installed.find((x) => x.id === "minimax-bridge");
  if (!item) return;
  const env = item.effectiveEnv || {};
  const form = $("#minimaxForm");
  for (const [key, value] of Object.entries(env)) {
    const input = form.elements[key];
    if (!input) continue;
    if (input.type === "checkbox") input.checked = value === "true";
    else if (!isMaskedSecret(value)) input.value = value;
  }
}

function isMaskedSecret(value) {
  return String(value || "").includes("•••") || String(value || "").includes("鈥");
}

async function renderPreview() {
  const preview = await api("/api/harness/opencode/preview?mcpId=minimax-bridge&profileId=default");
  $("#opencodePreview").textContent = JSON.stringify({
    path: preview.configPath,
    mcp: {
      "minimax-bridge": preview.entry,
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
  renderStatus();
  renderInstalled();
  renderMarket();
  renderHarnesses();
  fillFormFromInstalled();
  await renderPreview();
}

function collectForm() {
  const form = $("#minimaxForm");
  const data = new FormData(form);
  const env = {};
  const secrets = {};
  const secretKeys = new Set(["MINIMAX_API_KEY", "MINIMAX_PLAN_API_KEY"]);
  for (const [key, raw] of data.entries()) {
    const value = String(raw).trim();
    if (secretKeys.has(key)) secrets[key] = value;
    else env[key] = value;
  }
  env.MINIMAX_ENABLE_TOKEN_PLAN_PROXY = form.elements.MINIMAX_ENABLE_TOKEN_PLAN_PROXY.checked ? "true" : "false";
  return { env, secrets };
}

async function saveProfile({ silent = false } = {}) {
  const { env, secrets } = collectForm();
  await api("/api/mcp/profile", {
    method: "POST",
    body: JSON.stringify({ mcpId: "minimax-bridge", profileId: "default", env, secrets }),
  });
  await loadAll();
  if (!silent) showAlert("已保存 MiniMax MCP profile。OpenCode 配置尚未修改。再点击“保存并配置到 OpenCode”即可启用。", "ok");
}

async function runProbe(mode) {
  await saveProfile({ silent: true });
  $("#probeResult").textContent = mode === "api" ? "正在测试 MiniMax API..." : "正在测试 MCP 启动和工具列表...";
  const result = await api("/api/mcp/test", {
    method: "POST",
    body: JSON.stringify({ mode }),
  });
  $("#probeResult").textContent = JSON.stringify(result, null, 2);
  showAlert(mode === "api" ? "MiniMax API 测试通过。" : "MCP 启动和工具探测通过。", "ok");
}

async function applyOpenCode(event) {
  event?.preventDefault();
  const { env, secrets } = collectForm();
  const result = await api("/api/harness/opencode/apply", {
    method: "POST",
    body: JSON.stringify({ mcpId: "minimax-bridge", profileId: "default", enabled: true, env, secrets }),
  });
  await loadAll();
  showAlert(`已写入 OpenCode 配置：${result.configPath}${result.backupPath ? `；备份：${result.backupPath}` : ""}。重新打开 OpenCode 后即可使用 minimax-bridge MCP。`, "ok");
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
$("#refreshBtn").addEventListener("click", async () => {
  await loadAll();
  showAlert("已刷新。", "ok");
});
$("#saveProfileBtn").addEventListener("click", () => saveProfile().catch((error) => showAlert(error.message, "error")));
$("#testStartupBtn").addEventListener("click", () => runProbe("startup").catch((error) => showAlert(error.message, "error")));
$("#testApiBtn").addEventListener("click", () => runProbe("api").catch((error) => showAlert(error.message, "error")));
$("#minimaxForm").addEventListener("submit", (event) => applyOpenCode(event).catch((error) => showAlert(error.message, "error")));
$("#marketGrid").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-install]");
  if (!button) return;
  try {
    const result = await api("/api/catalog/install", {
      method: "POST",
      body: JSON.stringify({ mcpId: button.dataset.install }),
    });
    await loadAll();
    showAlert(result.installed ? "MCP 已安装或已确认安装。" : result.reason, result.installed ? "ok" : "error");
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

loadAll().catch((error) => showAlert(error.message, "error"));
