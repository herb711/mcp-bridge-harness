const token = window.__MCP_HARNESS_TOKEN__;
const desktopBridge = window.harnessApi;
const isDesktop = Boolean(desktopBridge?.invoke);
const state = {
  status: null,
  catalog: [],
  installed: [],
  clients: {},
  selectedMcpId: "minimax-bridge",
  selectedHarnessId: "opencode",
  update: null,
  updateChecking: false,
};

const titles = {
  dashboard: ["总览", "查看本地 Harness 状态和 MCP 配置。"],
  configure: ["配置 Harness", "选择要同步到目标工具的 MCP，并保存本地配置。"],
  market: ["MCP 市场", "发现、安装和配置可同步到 Harness 的 MCP。"],
  harnesses: ["Harness 目标", "管理 MCP 要同步到哪些编程工具。"],
};

const fallbackHarnessNames = {
  opencode: "OpenCode",
  hermes: "Hermes",
  codex: "Codex",
  "claude-code": "Claude Code (主 Harness)",
};

const remoteCcFieldKeys = new Set([
  "CC_MCP_REMOTE_NICKNAME",
  "CC_MCP_REMOTE_HOST",
  "CC_MCP_REMOTE_PORT",
  "CC_MCP_REMOTE_USER",
  "CC_MCP_REMOTE_PASSWORD",
  "CC_MCP_REMOTE_KEY_PATH",
  "CC_MCP_REMOTE_PUBLIC_KEY_PATH",
  "CC_MCP_REMOTE_INSTALL_DIR",
  "CC_MCP_REMOTE_HARNESS_HOME",
  "CC_MCP_REMOTE_WORKDIR",
  "CC_MCP_REMOTE_NODE_COMMAND",
  "CC_MCP_REMOTE_CLAUDE_COMMAND",
  "CC_MCP_REMOTE_INSTALL_CLAUDE",
]);

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
  const configure = page === "configure" ? configureLabels() : null;
  const [title, subtitle] = configure ? [configure.title, configure.subtitle] : (titles[page] || titles.dashboard);
  $("#pageTitle").textContent = title;
  $("#pageSubtitle").textContent = subtitle;
  if (configure) renderConfigureShell(configure);
  hideAlert();
}

function selectedInstalled() {
  return state.installed.find((item) => item.id === state.selectedMcpId);
}

function selectedCatalogEntry() {
  return state.catalog.find((item) => item.id === state.selectedMcpId);
}

function selectedHarness() {
  const id = state.selectedHarnessId;
  return state.status?.supportedHarnesses?.find((item) => item.id === id)
    || { id, name: fallbackHarnessNames[id] || id };
}

function selectedClientBinding(profileId = "default") {
  return state.clients?.[`${state.selectedHarnessId}:${state.selectedMcpId}:${profileId}`];
}

function isSelectedMcpConfigured() {
  return selectedClientBinding()?.enabled === true;
}

function updateConfigureActionState(runningText = "") {
  const button = $("#configureMcpBtn");
  const status = $("#selectedMcpBindingState");
  const harness = selectedHarness();
  const configured = isSelectedMcpConfigured();

  if (status) {
    status.textContent = configured ? `已写入 ${harness.name}` : `未写入 ${harness.name}`;
    status.classList.toggle("ok", configured);
    status.classList.toggle("warn", !configured);
  }

  if (!button) return;
  button.disabled = Boolean(runningText);
  button.textContent = runningText || `${configured ? "关闭" : "配置"} ${harness.name}`;
  button.dataset.action = configured ? "disable" : "configure";
  button.classList.toggle("primary", !configured);
  button.classList.toggle("secondary", configured);
  button.classList.toggle("danger-action", configured);
}

function configureLabels() {
  const harness = selectedHarness();
  updateConfigureActionState();
  $("#applyOpenCodeBtn")?.classList.add("legacy-action");
  $("#saveProfileBtn")?.classList.add("legacy-action");
  $("#testStartupBtn")?.classList.add("legacy-action");
  $("#testApiBtn")?.classList.add("legacy-action");
  const name = harness.name || fallbackHarnessNames[harness.id] || harness.id || "Harness";
  return {
    title: `配置 ${name}`,
    subtitle: `选择要同步到 ${name} 的 MCP，并保存本地配置。`,
    adapter: `${name} 适配器`,
    previewTitle: `${name} 预览`,
    previewDescription: `MCP Harness 会合并写入所选 MCP，不覆盖其他 MCP。修改前会自动备份。`,
  };
}

function renderConfigureShell(labels = configureLabels()) {
  const adapterLabel = $("#harnessAdapterLabel");
  const previewTitle = $("#harnessPreviewTitle");
  const previewDescription = $("#harnessPreviewDescription");
  if (adapterLabel) adapterLabel.textContent = labels.adapter;
  if (previewTitle) previewTitle.textContent = labels.previewTitle;
  if (previewDescription) previewDescription.textContent = labels.previewDescription;

  if (!$("#configure")?.classList.contains("hidden")) {
    $("#pageTitle").textContent = labels.title;
    $("#pageSubtitle").textContent = labels.subtitle;
  }
}

function configurableMcps() {
  const installedIds = new Set(state.installed.map((item) => item.id));
  const installed = state.installed
    .map((item) => state.catalog.find((entry) => entry.id === item.id))
    .filter((entry) => entry?.supportedHarnesses?.includes(state.selectedHarnessId));
  const readyNotInstalled = state.catalog.filter((entry) => {
    const ready = entry.status === "bundled" || entry.status === "available";
    return ready && entry.supportedHarnesses?.includes(state.selectedHarnessId) && !installedIds.has(entry.id);
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
    ["运行模式", isDesktop ? "桌面 App（Electron IPC，无本地 HTTP 服务）" : "传统本地 Web 服务"],
    ["数据目录", status.dataDir],
    ["Claude Code auto workdir", status.defaultClaudeCodeWorkdir],
    ["状态文件", status.statePath],
    ["秘钥文件", status.secretsPath],
    ["Hermes config", status.hermesConfigPath],
    ["Codex home", status.codexHomePath],
    ["Codex config", status.codexConfigPath],
    ["Codex executable", status.codexExecutablePath],
    ["Claude Code config", status.claudeCodeConfigPath],
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
  return state.update?.asset?.url || state.update?.releaseUrl || state.status?.latestReleaseUrl || state.status?.releasePageUrl || "";
}

function renderSidebar() {
  const versionEl = $("#sidebarVersion");
  if (versionEl) {
    const version = state.status?.version;
    versionEl.textContent = version ? `v${version}` : "v…";
  }
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
  const releaseUrl = state.update?.releaseUrl || state.status?.latestReleaseUrl || state.status?.releasePageUrl || "";

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
    if (asset) {
      downloadButton.textContent = isDesktop ? "立即更新" : "下载更新";
      downloadButton.dataset.url = "";
      downloadButton.dataset.mode = "install";
    } else {
      downloadButton.textContent = "查看更新";
      downloadButton.dataset.url = releaseUrl;
      downloadButton.dataset.mode = "open";
    }
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
        <p class="muted">${configured ? "配置已保存。" : `缺少：${escapeHtml(missing || "必要配置")}`}</p>
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
        <p class="muted">${escapeHtml(item.description || (ready ? "可以一键写入全局配置。" : "后续版本实现对应适配器。"))}</p>
        ${ready ? `
          <div class="actions">
            <button type="button" class="primary small-button" data-configure-harness="${escapeHtml(item.id)}">配置 ${escapeHtml(item.name)}</button>
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
  renderConfigureShell();
  $("#selectedMcpName").textContent = entry?.displayName || state.selectedMcpId;
  updateConfigureActionState();

  const harness = selectedHarness();
  $("#configTitle").textContent = `为 ${harness.name} 配置 ${entry?.displayName || state.selectedMcpId}`;
  $("#configDescription").textContent = entry
    ? `${entry.description}配置秘钥仅保存到本地 Harness，不写入 ${harness.name} 配置。`
    : "请选择要配置的 MCP。";
  $("#applyOpenCodeBtn").textContent = `保存并配置 ${harness.name}`;
  $("#testApiBtn").textContent = `测试 ${entry?.displayName || "MCP"} API`;
  $("#detectClaudeBtn").classList.toggle("hidden", state.selectedMcpId !== "cc-mcp");
  $("#setupRemoteCcBtn").classList.toggle("hidden", state.selectedMcpId !== "cc-mcp");

  if (!fields.length) {
    $("#mcpFields").innerHTML = `<p class="muted">这个 MCP 暂无可配置字段。</p>`;
    return;
  }

  const coreContainer = $("#mcpCoreFields");
  const advancedContainer = $("#mcpAdvancedFields");
  const advancedBlock = $("#mcpAdvancedBlock");
  if (!coreContainer || !advancedContainer || !advancedBlock) {
    $("#mcpFields").innerHTML = fields.map((field) => renderField(field, env[field.key])).join("");
    updateCcRemoteVisibility();
    return;
  }

  const core = [];
  const advanced = [];
  for (const field of fields) {
    if (field.advanced) advanced.push(field);
    else core.push(field);
  }
  coreContainer.innerHTML = core.length
    ? core.map((field) => renderField(field, env[field.key])).join("")
    : `<p class="muted">这个 MCP 暂无可配置字段。</p>`;
  advancedContainer.innerHTML = advanced.map((field) => renderField(field, env[field.key])).join("");
  advancedBlock.classList.toggle("hidden", advanced.length === 0);
  updateCcRemoteVisibility();
}

function renderCcWorkdirField(field, id, required, help, safeValue) {
  const autoPath = state.status?.defaultClaudeCodeWorkdir || "当前 Harness 项目路径";
  const isAuto = !String(safeValue || "").trim();
  return `
    <label class="workdir-field" for="${escapeHtml(id)}">
      <span>${escapeHtml(field.label)}${required}<em class="auto-pill">${isAuto ? "自动" : "自定义"}</em></span>
      <div class="input-action-row">
        <input id="${escapeHtml(id)}" name="${escapeHtml(field.key)}" type="text" autocomplete="off" placeholder="${escapeHtml(field.placeholder || "自动：当前 Harness 项目路径")}" value="${escapeHtml(safeValue)}" />
        <button type="button" class="ghost small-button" data-use-auto-workdir>使用自动</button>
      </div>
      <small>留空则使用：<code>${escapeHtml(autoPath)}</code></small>
      ${help}
    </label>
  `;
}

function renderField(field, value) {
  const id = `field_${field.key}`;
  const required = field.required ? " <b>*</b>" : "";
  const help = field.help ? `<small>${escapeHtml(field.help)}</small>` : "";
  const safeValue = isMaskedSecret(value) ? "" : String(value ?? field.default ?? "");
  const placeholder = isMaskedSecret(value) ? "已保存，留空则不修改" : (field.placeholder || "");
  const remoteClass = remoteCcFieldKeys.has(field.key) ? " remote-cc-field" : "";
  const fieldAttr = `data-field-key="${escapeHtml(field.key)}"`;

  if (field.key === "CC_CLAUDE_WORKDIR") {
    return renderCcWorkdirField(field, id, required, help, safeValue);
  }

  if (field.type === "boolean") {
    const checked = String(value ?? field.default ?? "").toLowerCase() === "true";
    return `
      <label class="check${remoteClass}" ${fieldAttr} for="${escapeHtml(id)}">
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
      <label class="${remoteClass.trim()}" ${fieldAttr} for="${escapeHtml(id)}">
        <span>${escapeHtml(field.label)}${required}</span>
        <select id="${escapeHtml(id)}" name="${escapeHtml(field.key)}">${options}</select>
        ${help}
      </label>
    `;
  }

  if (field.type === "textarea") {
    return `
      <label class="${remoteClass.trim()}" ${fieldAttr} for="${escapeHtml(id)}">
        <span>${escapeHtml(field.label)}${required}</span>
        <textarea id="${escapeHtml(id)}" name="${escapeHtml(field.key)}" rows="3" placeholder="${escapeHtml(placeholder)}">${escapeHtml(safeValue)}</textarea>
        ${help}
      </label>
    `;
  }

  return `
    <label class="${remoteClass.trim()}" ${fieldAttr} for="${escapeHtml(id)}">
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
  const preview = await api(`/api/harness/${encodeURIComponent(state.selectedHarnessId)}/preview?mcpId=${encodeURIComponent(mcpId)}&profileId=default`);
  $("#opencodePreview").textContent = formatHarnessPreview(preview);
}

function formatHarnessPreview(preview) {
  if (state.selectedHarnessId === "codex" && preview.preview?.mergedToml) {
    return [
      `path: ${preview.configPath}`,
      "",
      preview.preview.mergedToml,
    ].join("\n");
  }

  if (typeof preview.preview === "string") return preview.preview;
  return JSON.stringify(preview.preview || preview, null, 2);
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
  renderSidebar();
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
  if (!silent) showAlert(`已保存 ${selectedCatalogEntry()?.displayName || mcpId} 配置。${selectedHarness().name} 配置尚未修改。`, "ok");
}

function setFormFieldValue(key, value) {
  const input = document.getElementById(`field_${key}`);
  if (!input) return;
  if (input.type === "checkbox") input.checked = Boolean(value);
  else input.value = String(value ?? "");
}

function isCcRemoteSelected() {
  const mode = document.getElementById("field_CC_MCP_SERVER_MODE");
  return state.selectedMcpId === "cc-mcp" && String(mode?.value || "").toLowerCase() === "remote";
}

function updateCcRemoteVisibility() {
  const remote = isCcRemoteSelected();
  $all(".remote-cc-field").forEach((el) => el.classList.toggle("hidden", !remote));
  $("#setupRemoteCcBtn")?.classList.toggle("hidden", state.selectedMcpId !== "cc-mcp" || !remote);
  $("#detectClaudeBtn")?.classList.toggle("hidden", state.selectedMcpId !== "cc-mcp" || remote);
}

function applyClaudeDetection(detected) {
  setFormFieldValue("CC_CLAUDE_RUNTIME", detected.runtime);
  setFormFieldValue("CC_CLAUDE_COMMAND", detected.command);
  setFormFieldValue("CC_CLAUDE_COMMAND_ARGS", JSON.stringify(detected.commandArgs));
  setFormFieldValue("CC_CLAUDE_WSL", detected.wsl);
}

async function detectClaudeCodeFromUi() {
  if (state.selectedMcpId !== "cc-mcp") return;
  const button = $("#detectClaudeBtn");
  const originalText = button?.textContent;
  if (button) {
    button.disabled = true;
    button.textContent = "正在检测 Claude Code...";
  }
  $("#probeResult").textContent = "正在检测当前环境中的 Claude Code...";

  try {
    const { env } = collectForm();
    const result = await api("/api/cc/detect", {
      method: "POST",
      body: JSON.stringify({ env }),
    });
    $("#probeResult").textContent = JSON.stringify(result, null, 2);
    if (result.ok && result.detected) {
      applyClaudeDetection(result.detected);
      showAlert(`已通过 ${result.detected.label} 检测到 Claude Code，表单已更新；保存配置后生效。`, "ok");
    } else {
      showAlert("未检测到 Claude Code，请查看测试结果详情。", "error");
    }
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalText || "检测 Claude Code";
    }
  }
}

async function setupRemoteCcFromUi() {
  if (state.selectedMcpId !== "cc-mcp") return;
  const button = $("#setupRemoteCcBtn");
  const originalText = button?.textContent;
  if (button) {
    button.disabled = true;
    button.textContent = "正在配置远程服务器...";
  }
  $("#probeResult").textContent = "正在连接远程服务器、安装 SSH key、上传 cc-mcp server 并检测 Claude Code...";

  try {
    const { env, secrets } = collectForm();
    const result = await api("/api/cc/remote/setup", {
      method: "POST",
      body: JSON.stringify({ env, secrets }),
    });
    $("#probeResult").textContent = JSON.stringify(result, null, 2);
    await loadAll();
    if (result.ok) {
      const applies = Array.isArray(result.harnessApplies) ? result.harnessApplies : [];
      const applied = applies.filter((item) => item.ok).map((item) => item.harnessId);
      const failed = applies.filter((item) => !item.ok);
      if (applied.length) {
        const suffix = failed.length ? `；${failed.map((item) => `${item.harnessId}: ${item.error}`).join("；")}` : "";
        showAlert(`远程 cc-mcp 配置完成，已自动写入：${applied.join("、")}。请重启对应 Harness。${suffix}`, failed.length ? "error" : "ok");
      } else {
        showAlert("远程 cc-mcp 配置完成，请在配置页点击“保存并配置 Harness”写入目标 Harness。", "ok");
      }
    } else {
      showAlert(result.error || "远程 cc-mcp 配置失败。", "error");
    }
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalText || "配置远程服务器";
    }
  }
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
  const button = event?.submitter || $("#applyOpenCodeBtn");
  const originalText = button?.textContent;
  const harness = selectedHarness();
  if (button) {
    button.disabled = true;
    button.textContent = `正在写入 ${harness.name} 配置...`;
  }
  $("#probeResult").textContent = `正在保存配置并写入 ${harness.name} 配置...`;

  try {
    const { env, secrets } = collectForm();
    const mcpId = state.selectedMcpId;
    const result = await api(`/api/harness/${encodeURIComponent(state.selectedHarnessId)}/apply`, {
      method: "POST",
      body: JSON.stringify({ mcpId, profileId: "default", enabled: true, env, secrets }),
    });
    $("#probeResult").textContent = JSON.stringify({
      ok: true,
      action: `apply-${state.selectedHarnessId}`,
      mcpId,
      configPath: result.configPath,
      backupPath: result.backupPath || null,
      instructionPath: result.instructionPath,
      entry: result.entry,
    }, null, 2);
    await loadAll();
    showAlert(`已写入 ${harness.name} 配置：${result.configPath}${result.backupPath ? `；已备份：${result.backupPath}` : ""}。请重启 ${harness.name} 以使用 ${mcpId}。`, "ok");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    $("#probeResult").textContent = JSON.stringify({
      ok: false,
      action: `apply-${state.selectedHarnessId}`,
      error: message,
    }, null, 2);
    throw error;
  } finally {
    if (button) {
      button.disabled = false;
      button.textContent = originalText || `保存并配置 ${harness.name}`;
    }
  }
}

function setProbeSummary(lines) {
  $("#probeResult").textContent = lines.filter(Boolean).join("\n");
}

function stepOk(label, detail = "") {
  return `✓ ${label}${detail ? `：${detail}` : ""}`;
}

function stepRun(label) {
  return `… ${label}`;
}

function stepFail(label, detail = "") {
  return `✗ ${label}${detail ? `：${detail}` : ""}`;
}

function summarizeMcpProbe(result) {
  const tools = Array.isArray(result?.tools) ? `${result.tools.length} 个工具` : "工具列表已返回";
  const cc = result?.ccStatus?.available ? `Claude Code ${result.ccStatus.version || "可用"}` : "";
  return [tools, cc].filter(Boolean).join("，");
}

function summarizeRemoteSetup(result) {
  const statusStep = Array.isArray(result?.steps) ? result.steps.find((item) => item.id === "status") : undefined;
  const applied = Array.isArray(result?.harnessApplies)
    ? result.harnessApplies.filter((item) => item.ok).map((item) => item.harnessId).join("、")
    : "";
  return [statusStep?.message, applied ? `已写入 ${applied}` : ""].filter(Boolean).join("；");
}

async function configureMcp(event) {
  event?.preventDefault();
  const configureButton = $("#configureMcpBtn");
  const harness = selectedHarness();
  const mcpId = state.selectedMcpId;
  const lines = [];
  const setRunning = (running) => {
    configureButton.disabled = running;
    if (running) configureButton.textContent = "配置中...";
    else updateConfigureActionState();
  };
  const updateLine = (index, line) => {
    lines[index] = line;
    setProbeSummary(lines);
  };

  setRunning(true);
  try {
    const { env, secrets } = collectForm();
    const remoteCc = mcpId === "cc-mcp" && String(env.CC_MCP_SERVER_MODE || "").toLowerCase() === "remote";

    lines.push(stepRun(remoteCc ? "配置远程服务器" : "保存配置"));
    setProbeSummary(lines);
    if (remoteCc) {
      const result = await api("/api/cc/remote/setup", {
        method: "POST",
        body: JSON.stringify({ env, secrets, autoApply: false }),
      });
      if (!result.ok) throw new Error(result.error || "远程服务器配置失败");
      updateLine(0, stepOk("配置远程服务器", summarizeRemoteSetup(result)));
    } else {
      await api("/api/mcp/profile", {
        method: "POST",
        body: JSON.stringify({ mcpId, profileId: "default", env, secrets }),
      });
      updateLine(0, stepOk("保存配置"));
    }

    const testIndex = lines.push(stepRun("测试 MCP 启动")) - 1;
    const probe = await api("/api/mcp/test", {
      method: "POST",
      body: JSON.stringify({ mcpId, profileId: "default", mode: "startup" }),
    });
    if (probe.ok === false) throw new Error(probe.error || "MCP 启动测试失败");
    updateLine(testIndex, stepOk("测试 MCP 启动", summarizeMcpProbe(probe)));

    const applyIndex = lines.push(stepRun(`写入 ${harness.name} 配置`)) - 1;
    const applied = await api(`/api/harness/${encodeURIComponent(state.selectedHarnessId)}/apply`, {
      method: "POST",
      body: JSON.stringify({ mcpId, profileId: "default", enabled: true }),
    });
    updateLine(applyIndex, stepOk(`写入 ${harness.name} 配置`, applied.configPath));

    await loadAll();
    showAlert(`已配置 ${selectedCatalogEntry()?.displayName || mcpId} 到 ${harness.name}。请重启或刷新 ${harness.name} 以加载最新 MCP。`, "ok");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failedIndex = lines.findIndex((line) => line.startsWith("… "));
    if (failedIndex >= 0) updateLine(failedIndex, stepFail(lines[failedIndex].slice(2), message));
    else {
      lines.push(stepFail("配置失败", message));
      setProbeSummary(lines);
    }
    showAlert(message, "error");
  } finally {
    setRunning(false);
  }
}

async function disableMcpFromHarness() {
  const configureButton = $("#configureMcpBtn");
  const harness = selectedHarness();
  const mcpId = state.selectedMcpId;
  configureButton.disabled = true;
  configureButton.textContent = "关闭中...";
  const lines = [stepRun(`关闭 ${harness.name} 中的 ${selectedCatalogEntry()?.displayName || mcpId}`)];
  setProbeSummary(lines);
  try {
    const result = await api(`/api/harness/${encodeURIComponent(state.selectedHarnessId)}/apply`, {
      method: "POST",
      body: JSON.stringify({ mcpId, profileId: "default", enabled: false }),
    });
    lines[0] = stepOk(`关闭 ${harness.name}`, result.configPath);
    setProbeSummary(lines);
    await loadAll();
    showAlert(`已关闭 ${harness.name} 中的 ${mcpId}。OpenCode 会从配置中移除该 MCP；其他 Harness 会写入禁用状态。`, "ok");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    lines[0] = stepFail(`关闭 ${harness.name}`, message);
    setProbeSummary(lines);
    showAlert(message, "error");
  } finally {
    configureButton.disabled = false;
    updateConfigureActionState();
  }
}

async function toggleMcpConfiguration(event) {
  event?.preventDefault();
  if (isSelectedMcpConfigured()) {
    await disableMcpFromHarness();
  } else {
    await configureMcp(event);
  }
}

function openExternalUrl(url) {
  if (!url) return;
  window.open(url, "_blank", "noopener,noreferrer");
}

function updateWorkdirAutoPill(input) {
  const pill = input?.closest(".workdir-field")?.querySelector(".auto-pill");
  if (pill) pill.textContent = String(input.value || "").trim() ? "自定义" : "自动";
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
async function installUpdateFromUi() {
  const button = $("#downloadUpdateBtn");
  if (!button) return;
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = "正在下载安装包...";
  hideAlert();
  try {
    const result = await api("/api/update/install", { method: "POST", body: JSON.stringify({}) });
    if (!result.ok) throw new Error(result.error || "更新失败。");
    if (!isDesktop || !desktopBridge?.installUpdate) {
      openExternalUrl(updateTargetUrl());
      showAlert("已获取更新包，请在浏览器中下载并手动安装。", "ok");
      return;
    }
    button.textContent = "正在启动安装程序...";
    const launch = await desktopBridge.installUpdate({ filePath: result.filePath });
    if (!launch?.ok) throw new Error(launch?.error || "无法启动安装程序。");
    showAlert(`安装包已下载到 ${result.filePath}，安装程序已启动。请按提示完成升级。`, "ok");
    setTimeout(() => window.close(), 1500);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    showAlert(message, "error");
  } finally {
    button.disabled = false;
    button.textContent = originalText || "立即更新";
  }
}

$("#downloadUpdateBtn").addEventListener("click", async () => {
  const button = $("#downloadUpdateBtn");
  const mode = button.dataset.mode;
  if (mode === "install") {
    await installUpdateFromUi();
    return;
  }
  openExternalUrl(button.dataset.url || updateTargetUrl());
});
$("#openReleaseBtn").addEventListener("click", () => openExternalUrl(state.update?.releaseUrl || state.status?.latestReleaseUrl || state.status?.releasePageUrl));
$("#saveProfileBtn").addEventListener("click", () => saveProfile().catch((error) => showAlert(error.message, "error")));
$("#detectClaudeBtn").addEventListener("click", () => detectClaudeCodeFromUi().catch((error) => showAlert(error.message, "error")));
$("#setupRemoteCcBtn").addEventListener("click", () => setupRemoteCcFromUi().catch((error) => showAlert(error.message, "error")));
$("#testStartupBtn").addEventListener("click", () => runProbe("startup").catch((error) => showAlert(error.message, "error")));
$("#testApiBtn").addEventListener("click", () => runProbe("api").catch((error) => showAlert(error.message, "error")));
$("#mcpProfileForm").addEventListener("click", (event) => {
  const button = event.target.closest("[data-use-auto-workdir]");
  if (!button) return;
  const input = $("#field_CC_CLAUDE_WORKDIR");
  if (!input) return;
  input.value = "";
  updateWorkdirAutoPill(input);
  showAlert(`Claude Code Workdir 将自动使用：${state.status?.defaultClaudeCodeWorkdir || "当前 Harness 项目路径"}`, "ok");
});
$("#mcpProfileForm").addEventListener("input", (event) => {
  if (event.target?.id === "field_CC_CLAUDE_WORKDIR") updateWorkdirAutoPill(event.target);
  if (event.target?.id === "field_CC_MCP_SERVER_MODE") updateCcRemoteVisibility();
});
$("#mcpProfileForm").addEventListener("change", (event) => {
  if (event.target?.id === "field_CC_MCP_SERVER_MODE") updateCcRemoteVisibility();
});
$("#mcpProfileForm").addEventListener("submit", (event) => toggleMcpConfiguration(event).catch((error) => showAlert(error.message, "error")));
$("#marketGrid").addEventListener("click", async (event) => {
  const configureButton = event.target.closest("[data-configure-mcp]");
  if (configureButton?.dataset.configureMcp) {
    state.selectedMcpId = configureButton.dataset.configureMcp;
    const entry = state.catalog.find((item) => item.id === state.selectedMcpId);
    if (entry?.supportedHarnesses?.length && !entry.supportedHarnesses.includes(state.selectedHarnessId)) {
      state.selectedHarnessId = entry.supportedHarnesses[0];
    }
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
$("#harnessList").addEventListener("click", async (event) => {
  const button = event.target.closest("[data-configure-harness]");
  const card = event.target.closest("[data-harness-id]");
  const id = card?.dataset.harnessId || button?.dataset.configureHarness;
  const target = state.status?.supportedHarnesses?.find((item) => item.id === id);
  if (!target || target.status !== "ready") return;
  state.selectedHarnessId = id;
  ensureSelectedMcp();
  switchPage("configure");
  renderMcpSelector();
  renderProfileForm();
  await renderPreview();
});

loadAll()
  .then(() => checkUpdate({ silent: true }))
  .catch((error) => showAlert(error.message, "error"));
