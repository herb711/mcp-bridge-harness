import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client, type ConnectConfig, type SFTPWrapper } from "ssh2";

export interface RemoteCcConfig {
  enabled: boolean;
  nickname: string;
  host: string;
  port: number;
  user: string;
  password?: string;
  keyPath?: string;
  publicKeyPath?: string;
  installDir: string;
  harnessHome: string;
  workdir: string;
  nodeCommand: string;
  claudeCommand: string;
  installClaude: boolean;
  skipPermissions: boolean;
  permissionMode: string;
  permissionRequestTimeoutMs: string;
  permissionApproveInput: string;
  permissionDenyInput: string;
}

export interface RemoteCcStep {
  id: string;
  label: string;
  status: "pending" | "running" | "ok" | "error" | "skipped";
  message?: string;
}

export interface RemoteCcSetupResult {
  ok: boolean;
  mode: "remote";
  nickname: string;
  host: string;
  port: number;
  user: string;
  steps: RemoteCcStep[];
  remoteCommand?: string[];
  resolvedEnv?: Record<string, string>;
  error?: string;
}

interface ExecResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

const DEFAULT_INSTALL_DIR = "~/.local/share/mcp-harness/cc-mcp-server";
const DEFAULT_HARNESS_HOME = "~/.local/share/mcp-harness";
const DEFAULT_KEY_NAME = "mcp_harness_remote_ed25519";

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function boolValue(value: unknown, fallback = false): boolean {
  const raw = stringValue(value);
  if (!raw) return fallback;
  return /^(1|true|yes|on)$/i.test(raw);
}

function portValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 22;
}

function remoteWorkdirValue(env: Record<string, string>): string {
  const remoteWorkdir = stringValue(env.CC_MCP_REMOTE_WORKDIR);
  if (remoteWorkdir) return remoteWorkdir;

  const legacyUnifiedWorkdir = stringValue(env.CC_CLAUDE_WORKDIR);
  if (legacyUnifiedWorkdir && !/^[a-zA-Z]:[\\/]/.test(legacyUnifiedWorkdir)) {
    return legacyUnifiedWorkdir;
  }

  return "~/";
}

export function remoteCcConfigFromEnv(env: Record<string, string>): RemoteCcConfig {
  return {
    enabled: stringValue(env.CC_MCP_SERVER_MODE).toLowerCase() === "remote" || boolValue(env.CC_MCP_REMOTE_ENABLED),
    nickname: stringValue(env.CC_MCP_REMOTE_NICKNAME) || stringValue(env.CC_MCP_REMOTE_HOST) || "remote-cc",
    host: stringValue(env.CC_MCP_REMOTE_HOST),
    port: portValue(env.CC_MCP_REMOTE_PORT),
    user: stringValue(env.CC_MCP_REMOTE_USER),
    password: stringValue(env.CC_MCP_REMOTE_PASSWORD) || undefined,
    keyPath: normalizeLocalPath(env.CC_MCP_REMOTE_KEY_PATH),
    publicKeyPath: normalizeLocalPath(env.CC_MCP_REMOTE_PUBLIC_KEY_PATH),
    installDir: stringValue(env.CC_MCP_REMOTE_INSTALL_DIR) || DEFAULT_INSTALL_DIR,
    harnessHome: stringValue(env.CC_MCP_REMOTE_HARNESS_HOME) || DEFAULT_HARNESS_HOME,
    workdir: remoteWorkdirValue(env),
    nodeCommand: stringValue(env.CC_MCP_REMOTE_NODE_COMMAND) || "node",
    claudeCommand: stringValue(env.CC_MCP_REMOTE_CLAUDE_COMMAND) || "claude",
    installClaude: boolValue(env.CC_MCP_REMOTE_INSTALL_CLAUDE, true),
    skipPermissions: boolValue(env.CC_CLAUDE_SKIP_PERMISSIONS, false),
    permissionMode: stringValue(env.CC_MCP_PERMISSION_MODE) || "main-harness",
    permissionRequestTimeoutMs: stringValue(env.CC_MCP_PERMISSION_REQUEST_TIMEOUT_MS) || "120000",
    permissionApproveInput: stringValue(env.CC_CLAUDE_PERMISSION_APPROVE_INPUT) || "y",
    permissionDenyInput: stringValue(env.CC_CLAUDE_PERMISSION_DENY_INPUT) || "n",
  };
}

export function isRemoteCcConfigured(env: Record<string, string>): boolean {
  const config = remoteCcConfigFromEnv(env);
  return config.enabled && Boolean(config.host && config.user);
}

function normalizeLocalPath(value: unknown): string | undefined {
  const raw = stringValue(value);
  if (!raw) return undefined;
  if (raw.startsWith("~/") || raw === "~") return path.join(os.homedir(), raw.slice(2));
  return path.resolve(raw);
}

function shQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function shellPath(value: string): string {
  if (value === "~") return "$HOME";
  if (value.startsWith("~/")) return `$HOME/${shQuote(value.slice(2))}`;
  if (value.startsWith("$HOME/")) return `$HOME/${shQuote(value.slice("$HOME/".length))}`;
  return shQuote(value);
}

function sshTarget(config: RemoteCcConfig): string {
  return `${config.user}@${config.host}`;
}

function requireRemoteFields(config: RemoteCcConfig): void {
  if (!config.enabled) throw new Error("cc-mcp remote mode is not enabled.");
  if (!config.host) throw new Error("Remote host is required.");
  if (!config.user) throw new Error("Remote SSH user is required.");
}

export function buildRemoteCcMcpCommand(env: Record<string, string>, profileId = "default"): string[] | undefined {
  const config = remoteCcConfigFromEnv(env);
  if (!config.enabled) return undefined;
  requireRemoteFields(config);

  const remoteCommand = [
    `cd ${shellPath(config.installDir)}`,
    [
      `MCP_HARNESS_HOME=${shellPath(config.harnessHome)}`,
      `CC_MCP_REMOTE_NICKNAME=${shQuote(config.nickname)}`,
      `${shQuote(config.nodeCommand)} dist/index.js mcp cc-mcp --profile ${shQuote(profileId)}`,
    ].join(" "),
  ].join(" && ");

  const args = [
    "-T",
    "-o", "BatchMode=yes",
    "-o", "StrictHostKeyChecking=accept-new",
    "-p", String(config.port),
  ];
  if (config.keyPath) args.push("-i", config.keyPath);
  args.push(sshTarget(config), remoteCommand);
  return ["ssh", ...args];
}

function addStep(steps: RemoteCcStep[], id: string, label: string): RemoteCcStep {
  const step: RemoteCcStep = { id, label, status: "running" };
  steps.push(step);
  return step;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function runLocal(command: string, args: string[], timeoutMs = 30000): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${command} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    timer.unref();

    child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      resolve({ stdout, stderr, code });
    });
  });
}

async function ensureKeyPair(config: RemoteCcConfig): Promise<{ keyPath?: string; publicKey: string; publicKeyPath?: string }> {
  let keyPath = config.keyPath;
  let publicKeyPath = config.publicKeyPath;

  if (!keyPath && config.password) {
    const sshDir = path.join(os.homedir(), ".ssh");
    await fs.mkdir(sshDir, { recursive: true });
    keyPath = path.join(sshDir, DEFAULT_KEY_NAME);
    publicKeyPath = `${keyPath}.pub`;
    if (!(await fileExists(keyPath))) {
      const generated = await runLocal("ssh-keygen", ["-t", "ed25519", "-N", "", "-f", keyPath, "-C", "mcp-harness-remote"], 30000);
      if (generated.code !== 0) throw new Error(generated.stderr || generated.stdout || "ssh-keygen failed");
    }
  }

  if (!publicKeyPath && keyPath) publicKeyPath = `${keyPath}.pub`;
  if (publicKeyPath && await fileExists(publicKeyPath)) {
    return {
      keyPath,
      publicKeyPath,
      publicKey: (await fs.readFile(publicKeyPath, "utf8")).trim(),
    };
  }

  if (!keyPath) {
    return { publicKey: "" };
  }

  const derived = await runLocal("ssh-keygen", ["-y", "-f", keyPath], 30000);
  if (derived.code !== 0 || !derived.stdout.trim()) {
    throw new Error(derived.stderr || "Could not derive public key from private key.");
  }
  return { keyPath, publicKey: derived.stdout.trim() };
}

async function connectSsh(config: RemoteCcConfig, auth: { password?: string; keyPath?: string }): Promise<Client> {
  const privateKey = auth.keyPath
    ? await fs.readFile(auth.keyPath).catch((error) => {
      throw new Error(`Unable to read private key ${auth.keyPath}: ${error instanceof Error ? error.message : String(error)}`);
    })
    : undefined;

  return new Promise((resolve, reject) => {
    const client = new Client();
    const connectConfig: ConnectConfig = {
      host: config.host,
      port: config.port,
      username: config.user,
      readyTimeout: 20000,
      keepaliveInterval: 10000,
    };
    if (auth.password) connectConfig.password = auth.password;
    if (privateKey) connectConfig.privateKey = privateKey;

    client.once("ready", () => resolve(client));
    client.once("error", reject);
    client.connect(connectConfig);
  });
}

function sshExec(client: Client, command: string, timeoutMs = 120000): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => reject(new Error(`Remote command timed out after ${timeoutMs}ms: ${command}`)), timeoutMs);
    timer.unref();

    client.exec(command, { pty: false }, (error, stream) => {
      if (error) {
        clearTimeout(timer);
        reject(error);
        return;
      }
      stream.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf8"); });
      stream.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf8"); });
      stream.once("close", (code: number | null) => {
        clearTimeout(timer);
        resolve({ stdout, stderr, code });
      });
    });
  });
}

function openSftp(client: Client): Promise<SFTPWrapper> {
  return new Promise((resolve, reject) => {
    client.sftp((error, sftp) => error ? reject(error) : resolve(sftp));
  });
}

function sftpMkdir(sftp: SFTPWrapper, remoteDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.mkdir(remoteDir, (error) => {
      if (!error || error.message.includes("Failure")) resolve();
      else reject(error);
    });
  });
}

async function sftpEnsureDir(sftp: SFTPWrapper, remoteDir: string): Promise<void> {
  const parts = remoteDir.split("/").filter(Boolean);
  let current = remoteDir.startsWith("/") ? "" : ".";
  for (const part of parts) {
    current = current === "" ? `/${part}` : `${current}/${part}`;
    await sftpMkdir(sftp, current);
  }
}

function sftpFastPut(sftp: SFTPWrapper, localPath: string, remotePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    sftp.fastPut(localPath, remotePath, (error) => error ? reject(error) : resolve());
  });
}

function sftpWriteFile(sftp: SFTPWrapper, remotePath: string, content: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const stream = sftp.createWriteStream(remotePath, { encoding: "utf8" });
    stream.once("error", reject);
    stream.once("close", () => resolve());
    stream.end(content);
  });
}

async function uploadRecursive(sftp: SFTPWrapper, localDir: string, remoteDir: string): Promise<void> {
  await sftpEnsureDir(sftp, remoteDir);
  const entries = await fs.readdir(localDir, { withFileTypes: true });
  for (const entry of entries) {
    const localPath = path.join(localDir, entry.name);
    const remotePath = `${remoteDir}/${entry.name}`;
    if (entry.isDirectory()) {
      await uploadRecursive(sftp, localPath, remotePath);
    } else if (entry.isFile()) {
      await sftpFastPut(sftp, localPath, remotePath);
    }
  }
}

function sourceRoot(): string {
  return fileURLToPath(new URL("../..", import.meta.url));
}

function expandRemotePath(value: string, homeDir: string): string {
  if (value === "~") return homeDir;
  if (value.startsWith("~/")) return `${homeDir}/${value.slice(2)}`;
  if (value.startsWith("$HOME/")) return `${homeDir}/${value.slice("$HOME/".length)}`;
  return value;
}

async function verifyNativeSsh(config: RemoteCcConfig, keyPath: string | undefined): Promise<ExecResult> {
  const args = [
    "-T",
    "-o", "BatchMode=yes",
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", "ConnectTimeout=15",
    "-p", String(config.port),
  ];
  if (keyPath) args.push("-i", keyPath);
  args.push(sshTarget(config), "printf mcp-harness-ok");
  return runLocal("ssh", args, 30000);
}

function nativeSshArgs(config: RemoteCcConfig, keyPath: string | undefined, connectTimeout = 15): string[] {
  const args = [
    "-T",
    "-o", "BatchMode=yes",
    "-o", "StrictHostKeyChecking=accept-new",
    "-o", `ConnectTimeout=${connectTimeout}`,
    "-p", String(config.port),
  ];
  if (keyPath) args.push("-i", keyPath);
  return args;
}

function nativeScpArgs(config: RemoteCcConfig, keyPath: string | undefined): string[] {
  const args = [
    "-o", "BatchMode=yes",
    "-o", "StrictHostKeyChecking=accept-new",
    "-P", String(config.port),
  ];
  if (keyPath) args.push("-i", keyPath);
  return args;
}

async function nativeExec(config: RemoteCcConfig, keyPath: string | undefined, command: string, timeoutMs = 120000): Promise<ExecResult> {
  return runLocal("ssh", [...nativeSshArgs(config, keyPath), sshTarget(config), command], timeoutMs);
}

async function nativeScp(config: RemoteCcConfig, keyPath: string | undefined, sources: string[], remoteDest: string, timeoutMs = 120000): Promise<ExecResult> {
  return runLocal("scp", [...nativeScpArgs(config, keyPath), ...sources, `${sshTarget(config)}:${remoteDest}`], timeoutMs);
}

async function setupRemoteCcServerWithNative(
  config: RemoteCcConfig,
  keyPath: string | undefined,
  steps: RemoteCcStep[],
  resultBase: Omit<RemoteCcSetupResult, "ok">,
): Promise<RemoteCcSetupResult> {
  let step = addStep(steps, "connect", "Open SSH session");
  const home = await nativeExec(config, keyPath, "printf %s \"$HOME\"", 30000);
  if (home.code !== 0 || !home.stdout.trim()) throw new Error(home.stderr || "Could not resolve remote $HOME.");
  step.status = "ok";
  step.message = "Connected with native ssh.";

  const homeDir = home.stdout.trim();
  const installDir = expandRemotePath(config.installDir, homeDir);
  const harnessHome = expandRemotePath(config.harnessHome, homeDir);
  const workdir = config.workdir ? expandRemotePath(config.workdir, homeDir) : installDir;

  step = addStep(steps, "paths", "Resolve remote paths");
  step.status = "ok";
  step.message = `installDir=${installDir}; harnessHome=${harnessHome}; workdir=${workdir}`;

  step = addStep(steps, "workdir", "Ensure remote workdir");
  const ensureWorkdir = await nativeExec(config, keyPath, `mkdir -p ${shQuote(workdir)}`, 30000);
  if (ensureWorkdir.code !== 0) throw new Error(ensureWorkdir.stderr || ensureWorkdir.stdout || "Could not create remote workdir.");
  step.status = "ok";
  step.message = workdir;

  step = addStep(steps, "runtime", "Check Node.js, npm, and Claude Code");
  const runtimeCheck = await nativeExec(config, keyPath, [
    `${shQuote(config.nodeCommand)} --version`,
    "npm --version",
    `${shQuote(config.claudeCommand)} --version`,
  ].join(" && "), 30000);
  if (runtimeCheck.code !== 0 && config.installClaude) {
    const installClaude = await nativeExec(config, keyPath, "npm install -g @anthropic-ai/claude-code && claude --version", 600000);
    if (installClaude.code !== 0) throw new Error(installClaude.stderr || runtimeCheck.stderr || "Claude Code install failed.");
    step.message = installClaude.stdout.trim();
  } else if (runtimeCheck.code !== 0) {
    throw new Error(runtimeCheck.stderr || runtimeCheck.stdout || "Missing Node.js, npm, or Claude Code.");
  } else {
    step.message = runtimeCheck.stdout.trim();
  }
  step.status = "ok";

  step = addStep(steps, "upload", "Upload cc-mcp server files");
  const root = sourceRoot();
  const distDir = path.join(root, "dist");
  if (!(await fileExists(path.join(distDir, "index.js")))) {
    throw new Error("Local dist/index.js is missing. Run npm run build before remote setup.");
  }
  const prepareUpload = await nativeExec(config, keyPath, `rm -rf ${shQuote(`${installDir}/dist`)} && mkdir -p ${shQuote(installDir)}`, 120000);
  if (prepareUpload.code !== 0) throw new Error(prepareUpload.stderr || prepareUpload.stdout || "Could not prepare remote install directory.");
  const uploadDist = await nativeScp(config, keyPath, ["-r", distDir], installDir, 600000);
  if (uploadDist.code !== 0) throw new Error(uploadDist.stderr || uploadDist.stdout || "Could not upload dist directory.");
  const uploadFiles = await nativeScp(config, keyPath, [path.join(root, "package.json"), path.join(root, "package-lock.json")], installDir, 120000);
  if (uploadFiles.code !== 0) throw new Error(uploadFiles.stderr || uploadFiles.stdout || "Could not upload package metadata.");
  step.status = "ok";
  step.message = `Uploaded dist and package metadata to ${installDir}.`;

  step = addStep(steps, "dependencies", "Install server dependencies");
  const npmInstall = await nativeExec(config, keyPath, `cd ${shQuote(installDir)} && npm ci --omit=dev`, 600000);
  if (npmInstall.code !== 0) throw new Error(npmInstall.stderr || npmInstall.stdout || "npm ci failed on remote server.");
  step.status = "ok";
  step.message = "Remote npm dependencies installed.";

  step = addStep(steps, "profile", "Write remote cc-mcp profile");
  const setupScriptPath = `${installDir}/setup-cc-profile.mjs`;
  const localSetupScript = path.join(os.tmpdir(), `mcp-harness-setup-${Date.now()}-${Math.random().toString(16).slice(2)}.mjs`);
  await fs.writeFile(localSetupScript, remoteProfileScript(remoteRuntimeEnv(config, { harnessHome, workdir })), "utf8");
  try {
    const uploadScript = await nativeScp(config, keyPath, [localSetupScript], setupScriptPath, 120000);
    if (uploadScript.code !== 0) throw new Error(uploadScript.stderr || uploadScript.stdout || "Could not upload profile setup script.");
    const profile = await nativeExec(config, keyPath, `cd ${shQuote(installDir)} && MCP_HARNESS_HOME=${shQuote(harnessHome)} ${shQuote(config.nodeCommand)} setup-cc-profile.mjs && rm -f setup-cc-profile.mjs`, 120000);
    if (profile.code !== 0) throw new Error(profile.stderr || profile.stdout || "Failed to write remote cc-mcp profile.");
  } finally {
    await fs.unlink(localSetupScript).catch(() => undefined);
  }
  step.status = "ok";
  step.message = "Remote profile saved.";

  step = addStep(steps, "status", "Check remote Claude Code status");
  const statusScript = [
    "import { applyProfileToProcessEnv } from './dist/harness/state.js';",
    "import { claudeCodeStatus } from './dist/ccBridge.js';",
    "await applyProfileToProcessEnv('cc-mcp', 'default');",
    "const status = await claudeCodeStatus();",
    "console.log(JSON.stringify(status));",
    "if (!status.ok) process.exit(1);",
  ].join("\n");
  const status = await nativeExec(
    config,
    keyPath,
    `cd ${shQuote(installDir)} && MCP_HARNESS_HOME=${shQuote(harnessHome)} ${shQuote(config.nodeCommand)} --input-type=module -e ${shQuote(statusScript)}`,
    30000,
  );
  if (status.code !== 0) throw new Error(status.stderr || status.stdout || "Remote Claude Code status check failed.");
  step.status = "ok";
  step.message = status.stdout.trim();

  const resolvedEnv = {
    CC_MCP_SERVER_MODE: "remote",
    CC_MCP_REMOTE_NICKNAME: config.nickname,
    CC_MCP_REMOTE_HOST: config.host,
    CC_MCP_REMOTE_PORT: String(config.port),
    CC_MCP_REMOTE_USER: config.user,
    CC_MCP_REMOTE_KEY_PATH: keyPath || "",
    CC_MCP_REMOTE_INSTALL_DIR: installDir,
    CC_MCP_REMOTE_HARNESS_HOME: harnessHome,
    CC_MCP_REMOTE_WORKDIR: workdir,
    CC_MCP_REMOTE_NODE_COMMAND: config.nodeCommand,
    CC_MCP_REMOTE_CLAUDE_COMMAND: config.claudeCommand,
    CC_MCP_REMOTE_INSTALL_CLAUDE: config.installClaude ? "true" : "false",
    CC_CLAUDE_SKIP_PERMISSIONS: config.skipPermissions ? "true" : "false",
    CC_MCP_PERMISSION_MODE: config.permissionMode,
    CC_MCP_PERMISSION_REQUEST_TIMEOUT_MS: config.permissionRequestTimeoutMs,
    CC_CLAUDE_PERMISSION_APPROVE_INPUT: config.permissionApproveInput,
    CC_CLAUDE_PERMISSION_DENY_INPUT: config.permissionDenyInput,
  };

  return {
    ok: true,
    ...resultBase,
    remoteCommand: buildRemoteCcMcpCommand(resolvedEnv, "default"),
    resolvedEnv,
  };
}

async function appendAuthorizedKey(config: RemoteCcConfig, publicKey: string): Promise<void> {
  if (!config.password) return;
  const client = await connectSsh(config, { password: config.password });
  try {
    const command = [
      "umask 077",
      "mkdir -p ~/.ssh",
      `grep -qxF ${shQuote(publicKey)} ~/.ssh/authorized_keys 2>/dev/null || printf '%s\\n' ${shQuote(publicKey)} >> ~/.ssh/authorized_keys`,
      "chmod 700 ~/.ssh",
      "chmod 600 ~/.ssh/authorized_keys",
    ].join(" && ");
    const result = await sshExec(client, command, 30000);
    if (result.code !== 0) throw new Error(result.stderr || result.stdout || "Failed to install SSH public key.");
  } finally {
    client.end();
  }
}

function remoteProfileScript(env: Record<string, string>): string {
  return `import { ensureDefaultInstall, updateMcpProfile } from "./dist/harness/state.js";
await ensureDefaultInstall();
await updateMcpProfile({
  mcpId: "cc-mcp",
  profileId: "default",
  env: ${JSON.stringify(env, null, 2)}
});
`;
}

function remoteRuntimeEnv(config: RemoteCcConfig, resolved: { harnessHome: string; workdir: string }): Record<string, string> {
  return {
    CC_CLAUDE_RUNTIME: "local",
    CC_CLAUDE_COMMAND: config.claudeCommand,
    CC_CLAUDE_COMMAND_ARGS: "[]",
    CC_CLAUDE_MODEL: "",
    CC_CLAUDE_OUTPUT_FORMAT: "stream-json",
    CC_CLAUDE_INCLUDE_PARTIAL_MESSAGES: "true",
    CC_CLAUDE_MAX_TURNS: "20",
    CC_CLAUDE_TIMEOUT_MS: "1800000",
    CC_CLAUDE_WORKDIR: resolved.workdir,
    CC_CLAUDE_SKIP_PERMISSIONS: config.skipPermissions ? "true" : "false",
    CC_MCP_PERMISSION_MODE: config.permissionMode,
    CC_MCP_PERMISSION_REQUEST_TIMEOUT_MS: config.permissionRequestTimeoutMs,
    CC_CLAUDE_PERMISSION_APPROVE_INPUT: config.permissionApproveInput,
    CC_CLAUDE_PERMISSION_DENY_INPUT: config.permissionDenyInput,
    CC_CLAUDE_STRICT_MCP_CONFIG: "true",
    CC_CLAUDE_USE_CALLBACK_MCP: "false",
    CC_CLAUDE_WSL: "false",
    CC_MCP_REMOTE_NICKNAME: config.nickname,
  };
}

export async function setupRemoteCcServer(env: Record<string, string>): Promise<RemoteCcSetupResult> {
  const config = remoteCcConfigFromEnv(env);
  requireRemoteFields(config);
  const steps: RemoteCcStep[] = [];
  const resultBase = {
    mode: "remote" as const,
    nickname: config.nickname,
    host: config.host,
    port: config.port,
    user: config.user,
    steps,
  };

  try {
    let step = addStep(steps, "key", "Prepare SSH key access");
    const key = await ensureKeyPair(config);
    if (config.password) {
      await appendAuthorizedKey(config, key.publicKey);
      step.message = `Installed public key for ${config.user}@${config.host}.`;
    } else {
      step.message = key.keyPath ? `Using key ${key.keyPath}.` : "Using existing SSH configuration.";
    }
    step.status = "ok";

    step = addStep(steps, "verify-ssh", "Verify key-based SSH");
    const native = await verifyNativeSsh(config, key.keyPath);
    if (native.code !== 0) throw new Error(native.stderr || native.stdout || "Native ssh key verification failed.");
    step.status = "ok";
    step.message = native.stdout.trim() || "SSH key authentication works.";

    const keyReadable = key.keyPath ? await fs.readFile(key.keyPath).then(() => true).catch(() => false) : false;
    if (!keyReadable) {
      return await setupRemoteCcServerWithNative(config, key.keyPath, steps, resultBase);
    }

    step = addStep(steps, "connect", "Open SSH session");
    const client = await connectSsh(config, { keyPath: key.keyPath });
    step.status = "ok";
    step.message = "Connected.";

    try {
      step = addStep(steps, "paths", "Resolve remote paths");
      const home = await sshExec(client, "printf %s \"$HOME\"", 10000);
      if (home.code !== 0 || !home.stdout.trim()) throw new Error(home.stderr || "Could not resolve remote $HOME.");
      const homeDir = home.stdout.trim();
      const installDir = expandRemotePath(config.installDir, homeDir);
      const harnessHome = expandRemotePath(config.harnessHome, homeDir);
      const workdir = config.workdir ? expandRemotePath(config.workdir, homeDir) : installDir;
      step.status = "ok";
      step.message = `installDir=${installDir}; harnessHome=${harnessHome}; workdir=${workdir}`;

      step = addStep(steps, "workdir", "Ensure remote workdir");
      const ensureWorkdir = await sshExec(client, `mkdir -p ${shQuote(workdir)}`, 30000);
      if (ensureWorkdir.code !== 0) throw new Error(ensureWorkdir.stderr || ensureWorkdir.stdout || "Could not create remote workdir.");
      step.status = "ok";
      step.message = workdir;

      step = addStep(steps, "runtime", "Check Node.js, npm, and Claude Code");
      const runtimeCheck = await sshExec(client, [
        `${shQuote(config.nodeCommand)} --version`,
        "npm --version",
        `${shQuote(config.claudeCommand)} --version`,
      ].join(" && "), 30000);
      if (runtimeCheck.code !== 0 && config.installClaude) {
        const installClaude = await sshExec(client, "npm install -g @anthropic-ai/claude-code && claude --version", 600000);
        if (installClaude.code !== 0) throw new Error(installClaude.stderr || runtimeCheck.stderr || "Claude Code install failed.");
        step.message = installClaude.stdout.trim();
      } else if (runtimeCheck.code !== 0) {
        throw new Error(runtimeCheck.stderr || runtimeCheck.stdout || "Missing Node.js, npm, or Claude Code.");
      } else {
        step.message = runtimeCheck.stdout.trim();
      }
      step.status = "ok";

      step = addStep(steps, "upload", "Upload cc-mcp server files");
      const root = sourceRoot();
      const distDir = path.join(root, "dist");
      if (!(await fileExists(path.join(distDir, "index.js")))) {
        throw new Error("Local dist/index.js is missing. Run npm run build before remote setup.");
      }
      const sftp = await openSftp(client);
      await sftpEnsureDir(sftp, installDir);
      await uploadRecursive(sftp, distDir, `${installDir}/dist`);
      await sftpFastPut(sftp, path.join(root, "package.json"), `${installDir}/package.json`);
      await sftpFastPut(sftp, path.join(root, "package-lock.json"), `${installDir}/package-lock.json`);
      step.status = "ok";
      step.message = `Uploaded dist and package metadata to ${installDir}.`;

      step = addStep(steps, "dependencies", "Install server dependencies");
      const npmInstall = await sshExec(client, `cd ${shQuote(installDir)} && npm ci --omit=dev`, 600000);
      if (npmInstall.code !== 0) throw new Error(npmInstall.stderr || npmInstall.stdout || "npm ci failed on remote server.");
      step.status = "ok";
      step.message = "Remote npm dependencies installed.";

      step = addStep(steps, "profile", "Write remote cc-mcp profile");
      const setupScriptPath = `${installDir}/setup-cc-profile.mjs`;
      await sftpWriteFile(sftp, setupScriptPath, remoteProfileScript(remoteRuntimeEnv(config, { harnessHome, workdir })));
      const profile = await sshExec(client, `cd ${shQuote(installDir)} && MCP_HARNESS_HOME=${shQuote(harnessHome)} ${shQuote(config.nodeCommand)} setup-cc-profile.mjs && rm -f setup-cc-profile.mjs`, 120000);
      if (profile.code !== 0) throw new Error(profile.stderr || profile.stdout || "Failed to write remote cc-mcp profile.");
      step.status = "ok";
      step.message = "Remote profile saved.";

      step = addStep(steps, "status", "Check remote Claude Code status");
      const statusScript = [
        "import { applyProfileToProcessEnv } from './dist/harness/state.js';",
        "import { claudeCodeStatus } from './dist/ccBridge.js';",
        "await applyProfileToProcessEnv('cc-mcp', 'default');",
        "const status = await claudeCodeStatus();",
        "console.log(JSON.stringify(status));",
        "if (!status.ok) process.exit(1);",
      ].join("\n");
      const status = await sshExec(
        client,
        `cd ${shQuote(installDir)} && MCP_HARNESS_HOME=${shQuote(harnessHome)} ${shQuote(config.nodeCommand)} --input-type=module -e ${shQuote(statusScript)}`,
        30000,
      );
      if (status.code !== 0) throw new Error(status.stderr || status.stdout || "Remote Claude Code status check failed.");
      step.status = "ok";
      step.message = status.stdout.trim();

      const resolvedEnv = {
        CC_MCP_SERVER_MODE: "remote",
        CC_MCP_REMOTE_NICKNAME: config.nickname,
        CC_MCP_REMOTE_HOST: config.host,
        CC_MCP_REMOTE_PORT: String(config.port),
        CC_MCP_REMOTE_USER: config.user,
        CC_MCP_REMOTE_KEY_PATH: key.keyPath || "",
        CC_MCP_REMOTE_PUBLIC_KEY_PATH: key.publicKeyPath || "",
        CC_MCP_REMOTE_INSTALL_DIR: installDir,
        CC_MCP_REMOTE_HARNESS_HOME: harnessHome,
        CC_MCP_REMOTE_WORKDIR: workdir,
        CC_MCP_REMOTE_NODE_COMMAND: config.nodeCommand,
        CC_MCP_REMOTE_CLAUDE_COMMAND: config.claudeCommand,
        CC_MCP_REMOTE_INSTALL_CLAUDE: config.installClaude ? "true" : "false",
        CC_CLAUDE_SKIP_PERMISSIONS: config.skipPermissions ? "true" : "false",
        CC_MCP_PERMISSION_MODE: config.permissionMode,
        CC_MCP_PERMISSION_REQUEST_TIMEOUT_MS: config.permissionRequestTimeoutMs,
        CC_CLAUDE_PERMISSION_APPROVE_INPUT: config.permissionApproveInput,
        CC_CLAUDE_PERMISSION_DENY_INPUT: config.permissionDenyInput,
      };

      return {
        ok: true,
        ...resultBase,
        remoteCommand: buildRemoteCcMcpCommand(resolvedEnv, "default"),
        resolvedEnv,
      };
    } finally {
      client.end();
    }
  } catch (error) {
    const active = steps.find((item) => item.status === "running");
    if (active) {
      active.status = "error";
      active.message = error instanceof Error ? error.message : String(error);
    }
    return {
      ok: false,
      ...resultBase,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
