#!/usr/bin/env node
import {
  Logger,
  PlacesSearcher
} from "./chunk-PP32A7RR.js";

// src/cli.ts
import yargs from "yargs";
import { hideBin } from "yargs/helpers";

// src/utils/cliSettings.ts
import { closeSync, existsSync as existsSync2, fsyncSync, mkdirSync as mkdirSync2, openSync, readFileSync as readFileSync2, renameSync as renameSync2, statSync as statSync2, unlinkSync, writeFileSync as writeFileSync2 } from "fs";
import { join as join2, resolve as resolve2 } from "path";

// src/utils/cliTargets.ts
import {
  appendFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from "fs";
import { join, relative } from "path";
function homeRoot(home) {
  return home ?? (process.env.HOME ?? process.cwd());
}
var PI_TARGET = {
  id: "pi",
  configFormat: "json",
  mcpConfigPath: (home) => join(homeRoot(home), ".pi", "agent", "mcp.json"),
  skillsDir: (home) => join(homeRoot(home), ".pi", "agent", "skills")
};
var OPENCLAW_TARGET = {
  id: "openclaw",
  configFormat: "json",
  mcpConfigPath: (home) => join(homeRoot(home), ".openclaw", "openclaw.json"),
  skillsDir: (home) => join(homeRoot(home), ".openclaw", "workspace", "skills")
};
var CODEX_TARGET = {
  id: "codex",
  configFormat: "toml",
  mcpConfigPath: (home) => join(homeRoot(home), ".codex", "config.toml"),
  skillsDir: (home) => join(homeRoot(home), ".codex", "skills")
};
var ANTIGRAVITY_TARGET = {
  id: "antigravity",
  configFormat: "json",
  mcpConfigPath: (home) => join(homeRoot(home), ".gemini", "settings.json"),
  skillsDir: (home) => join(homeRoot(home), ".gemini", "config", "skills")
};
var CLAUDE_TARGET = {
  id: "claude",
  configFormat: "json",
  mcpConfigPath: (home) => join(homeRoot(home), ".claude.json"),
  skillsDir: (home) => join(homeRoot(home), ".claude", "skills")
};
var COPILOT_TARGET = {
  id: "copilot",
  configFormat: "json",
  mcpConfigPath: (home) => join(homeRoot(home), ".copilot", "mcp.json"),
  skillsDir: (home) => join(homeRoot(home), ".copilot", "skills")
};
var OPENCODE_TARGET = {
  id: "opencode",
  configFormat: "json",
  jsonMcpMapKey: "mcp",
  mcpConfigPath: (home) => join(homeRoot(home), ".config", "opencode", "opencode.json"),
  skillsDir: (home) => join(homeRoot(home), ".config", "opencode", "skills")
};
var CLI_TARGETS = {
  antigravity: ANTIGRAVITY_TARGET,
  claude: CLAUDE_TARGET,
  codex: CODEX_TARGET,
  copilot: COPILOT_TARGET,
  openclaw: OPENCLAW_TARGET,
  opencode: OPENCODE_TARGET,
  pi: PI_TARGET
};
function resolveCliTarget(name) {
  return CLI_TARGETS[name.trim().toLowerCase()];
}
function supportedCliNames() {
  return Object.keys(CLI_TARGETS).join(", ");
}
function readJsonConfig(configPath) {
  if (!existsSync(configPath)) return {};
  const parsed = JSON.parse(readFileSync(configPath, "utf-8"));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`configuration is not a JSON object: ${configPath}`);
  }
  return parsed;
}
function writeJsonConfig(configPath, value) {
  const temporary = `${configPath}.tmp`;
  mkdirSync(join(configPath, ".."), { recursive: true });
  writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n", "utf-8");
  renameSync(temporary, configPath);
}
function writeJsonMcpServerEntry(configPath, serverName, entry, mapKey = "mcpServers") {
  const config = readJsonConfig(configPath);
  const mcpServers = config[mapKey] ?? {};
  if (mcpServers === null || typeof mcpServers !== "object" || Array.isArray(mcpServers)) {
    throw new Error(`${mapKey} is not an object: ${configPath}`);
  }
  mcpServers[serverName] = entry;
  config[mapKey] = mcpServers;
  writeJsonConfig(configPath, config);
}
function removeJsonMcpServerEntry(configPath, serverName, mapKey = "mcpServers") {
  if (!existsSync(configPath)) return false;
  const config = readJsonConfig(configPath);
  const mcpServers = config[mapKey];
  if (mcpServers === void 0) return false;
  if (mcpServers === null || typeof mcpServers !== "object" || Array.isArray(mcpServers)) {
    throw new Error(`${mapKey} is not an object: ${configPath}`);
  }
  const map = mcpServers;
  if (!(serverName in map)) return false;
  delete map[serverName];
  config[mapKey] = map;
  writeJsonConfig(configPath, config);
  return true;
}
function readJsonMcpServerEntry(configPath, serverName, mapKey = "mcpServers") {
  try {
    const config = readJsonConfig(configPath);
    const mcpServers = config[mapKey];
    if (mcpServers === null || typeof mcpServers !== "object" || Array.isArray(mcpServers)) {
      return void 0;
    }
    return mcpServers[serverName];
  } catch {
    return void 0;
  }
}
function tomlString(value) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
function tomlSectionHeader(serverName) {
  return `[mcp_servers.${serverName}]`;
}
function removeTomlSection(content, serverName) {
  const lines = content.split("\n");
  const header = tomlSectionHeader(serverName);
  const kept = [];
  let skipping = false;
  for (const line of lines) {
    if (skipping) {
      if (line.trimStart().startsWith("[")) {
        skipping = false;
      } else {
        continue;
      }
    } else if (line.trim() === header) {
      skipping = true;
      while (kept.length > 0 && kept[kept.length - 1].trim() === "") {
        kept.pop();
      }
      continue;
    }
    kept.push(line);
  }
  while (kept.length > 0 && kept[kept.length - 1].trim() === "") {
    kept.pop();
  }
  return kept.length > 0 ? kept.join("\n") + "\n" : "";
}
function hasTomlSection(content, serverName) {
  return content.split("\n").some((line) => line.trim() === tomlSectionHeader(serverName));
}
function registrationToTomlLines(entry) {
  const lines = [`command = ${tomlString(entry.command)}`];
  if (entry.args !== void 0) {
    lines.push(`args = [${entry.args.map((arg) => tomlString(arg)).join(", ")}]`);
  }
  if (entry.env !== void 0) {
    const pairs = Object.entries(entry.env).map(([key, value]) => `${tomlString(key)} = ${tomlString(value)}`);
    if (pairs.length > 0) lines.push(`env = { ${pairs.join(", ")} }`);
  }
  return lines;
}
function writeTomlMcpServerSection(configPath, serverName, entry) {
  const previous = existsSync(configPath) ? readFileSync(configPath, "utf-8") : "";
  const base = removeTomlSection(previous, serverName);
  const table = [tomlSectionHeader(serverName), ...registrationToTomlLines(entry), ""].join("\n");
  const content = base.length > 0 ? base.replace(/\n*$/, "\n") + table : table;
  const temporary = `${configPath}.tmp`;
  mkdirSync(join(configPath, ".."), { recursive: true });
  writeFileSync(temporary, content, "utf-8");
  renameSync(temporary, configPath);
}
function removeTomlMcpServerSection(configPath, serverName) {
  if (!existsSync(configPath)) return false;
  const previous = readFileSync(configPath, "utf-8");
  if (!hasTomlSection(previous, serverName)) return false;
  const content = removeTomlSection(previous, serverName);
  const temporary = `${configPath}.tmp`;
  writeFileSync(temporary, content, "utf-8");
  renameSync(temporary, configPath);
  return true;
}
function hasTomlMcpServerSection(configPath, serverName) {
  if (!existsSync(configPath)) return false;
  return hasTomlSection(readFileSync(configPath, "utf-8"), serverName);
}
function listFilesRecursive(root) {
  if (!existsSync(root)) return [];
  const files = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else {
        files.push(relative(root, full).split("\\").join("/"));
      }
    }
  };
  walk(root);
  return files;
}
var SKILL_DOCUMENT_FILE = "SKILL.md";
function syncSkillTree(source, destination, layout = {}) {
  mkdirSync(destination, { recursive: true });
  cpSync(source, destination, {
    recursive: true,
    force: true,
    filter: (entry) => layout.debugPath === void 0 || relative(source, entry).split("\\").join("/") !== layout.debugPath
  });
  const expected = new Set(listFilesRecursive(source).filter((rel) => rel !== layout.debugPath));
  const existing = listFilesRecursive(destination);
  existing.sort((a, b) => b.length - a.length);
  for (const rel of existing) {
    if (expected.has(rel)) continue;
    rmSync(join(destination, rel), { recursive: true, force: true });
  }
  if (layout.includeDebug === true && layout.debugPath !== void 0) {
    appendFileSync(
      join(destination, ...SKILL_DOCUMENT_FILE.split("/")),
      readFileSync(join(source, ...layout.debugPath.split("/")))
    );
  }
}
function removeSkillDir(skillDir) {
  rmSync(skillDir, { recursive: true, force: true });
}
function compareSkillTree(source, destination, layout = {}) {
  const packaged = listFilesRecursive(source).filter((rel) => rel !== layout.debugPath);
  if (packaged.length === 0) return "MISSING";
  if (!existsSync(destination)) return "MISSING";
  for (const rel of packaged) {
    const target = join(destination, ...rel.split("/"));
    if (!existsSync(target)) return "MISSING";
    const packagedText = readFileSync(join(source, ...rel.split("/"))).toString("utf-8");
    const installedText = readFileSync(target).toString("utf-8");
    if (installedText === packagedText) continue;
    if (rel === SKILL_DOCUMENT_FILE && layout.debugPath !== void 0) {
      const overlayText = readFileSync(join(source, ...layout.debugPath.split("/"))).toString("utf-8");
      if (installedText === packagedText + overlayText) continue;
    }
    return "STALE";
  }
  return "OK";
}
function isServerRegistered(target, serverName, home) {
  const configPath = target.mcpConfigPath(home);
  if (target.configFormat === "toml") {
    return hasTomlMcpServerSection(configPath, serverName);
  }
  return readJsonMcpServerEntry(configPath, serverName, target.jsonMcpMapKey) !== void 0;
}
function applyServerRegistration(target, serverName, entry, home) {
  const configPath = target.mcpConfigPath(home);
  if (target.configFormat === "toml") {
    if (entry === void 0) {
      removeTomlMcpServerSection(configPath, serverName);
    } else {
      writeTomlMcpServerSection(configPath, serverName, entry);
    }
    return;
  }
  if (entry === void 0) {
    removeJsonMcpServerEntry(configPath, serverName, target.jsonMcpMapKey);
  } else {
    writeJsonMcpServerEntry(configPath, serverName, entry, target.jsonMcpMapKey);
  }
}

// src/utils/configSchema.ts
var CONFIG_ROOT_LABEL = "Application_Configuration";
var CONFIG_SECTION = {
  token: "Settings",
  description: "Persisted mcp-google-api configuration",
  parameters: [
    {
      token: "enabled",
      type: "StringArray",
      constraints: "CLI names",
      description: "CLI agents receiving MCP registration and packaged skills",
      example: ["pi"]
    },
    {
      token: "apiKey",
      type: "String",
      constraints: "any string",
      description: "Google Maps API key; empty when unset",
      example: "AIzaSyExampleKey0123456789"
    },
    {
      token: "autoUpdate",
      type: "Boolean",
      constraints: "true or false",
      description: "Automatic npm update check at server startup",
      example: false
    },
    {
      token: "enabledTools",
      type: "String",
      constraints: "'*' or comma-separated tool names",
      description: "Exposed MCP tool allowlist",
      example: "maps_geocode,maps_search_places"
    },
    {
      token: "host",
      type: "String",
      constraints: "non-empty hostname",
      description: "HTTP bind hostname",
      example: "0.0.0.0"
    },
    {
      token: "port",
      type: "Integer",
      constraints: "1-65535",
      description: "HTTP listen port",
      example: 3100
    }
  ]
};
var CONFIG_SECTIONS = [CONFIG_SECTION];
var CONFIG_DEFAULTS = {
  enabled: [],
  apiKey: "",
  autoUpdate: true,
  enabledTools: "*",
  host: "127.0.0.1",
  port: 3e3
};
function formatConfigPath(section, parameter) {
  return `${section.token}:${parameter.token}`;
}
function formatConfigDisplayValue(value) {
  const encoded = JSON.stringify(value);
  return encoded === void 0 ? String(value) : encoded;
}
function describeConfigType(parameter) {
  return `[${parameter.type}: ${parameter.constraints}]`;
}
function parseIndexToken(token, ownerPath) {
  if (!/^\d+$/.test(token)) {
    return `"${token}" is not a valid array index for ${ownerPath}; expected a non-negative decimal index (0..len-1), ":+" to append, or ":insert:<Idx>" to insert`;
  }
  const index = Number(token);
  if (!Number.isSafeInteger(index)) {
    return `array index "${token}" for ${ownerPath} is out of the supported integer range`;
  }
  return index;
}
function parseConfigPath(path) {
  const raw = (path ?? "").trim();
  if (raw.length === 0) {
    return {
      ok: false,
      error: `configuration path is empty; expected "${CONFIG_SECTION.token}" or "${CONFIG_SECTION.token}:<parameter>"`
    };
  }
  const tokens = raw.split(":");
  const section = CONFIG_SECTIONS.find((candidate) => candidate.token === tokens[0]);
  if (section === void 0) {
    return {
      ok: false,
      error: `unknown configuration section "${tokens[0]}"; valid sections: ${CONFIG_SECTIONS.map((item) => item.token).join(", ")}`
    };
  }
  if (tokens.length === 1) {
    return { ok: true, target: { section, operation: "value", canonicalPath: section.token } };
  }
  const parameter = section.parameters.find((candidate) => candidate.token === tokens[1]);
  if (parameter === void 0) {
    return {
      ok: false,
      error: `unknown configuration parameter "${tokens[1]}" in section "${section.token}"; valid parameters: ${section.parameters.map((item) => item.token).join(", ")}`
    };
  }
  const ownerPath = formatConfigPath(section, parameter);
  if (tokens.length === 2) {
    return { ok: true, target: { section, parameter, operation: "value", canonicalPath: ownerPath } };
  }
  if (parameter.type !== "StringArray") {
    return {
      ok: false,
      error: `${ownerPath} is a ${parameter.type} parameter and accepts no further path segments`
    };
  }
  const operation = tokens[2];
  if (operation === "+" || operation === "append") {
    if (tokens.length !== 3) {
      return { ok: false, error: `${ownerPath}:${operation} accepts no further path segments` };
    }
    return {
      ok: true,
      target: { section, parameter, operation: "append", canonicalPath: `${ownerPath}:${operation}` }
    };
  }
  if (operation === "insert") {
    if (tokens.length !== 4) {
      return { ok: false, error: `insert requires exactly one index: ${ownerPath}:insert:<Idx>` };
    }
    const index2 = parseIndexToken(tokens[3], ownerPath);
    if (typeof index2 === "string") {
      return { ok: false, error: index2 };
    }
    return {
      ok: true,
      target: { section, parameter, operation: "insert", index: index2, canonicalPath: `${ownerPath}:insert:${index2}` }
    };
  }
  if (tokens.length !== 3) {
    return { ok: false, error: `${ownerPath}:<Idx> accepts no further path segments` };
  }
  const index = parseIndexToken(operation, ownerPath);
  if (typeof index === "string") {
    return { ok: false, error: index };
  }
  return {
    ok: true,
    target: { section, parameter, operation: "index", index, canonicalPath: `${ownerPath}:${index}` }
  };
}
function describeIndexRangeError(ownerPath, index, length, allowEnd) {
  const upper = allowEnd ? length : length - 1;
  const range = length === 0 && !allowEnd ? "none (the list is empty)" : `0..${upper}`;
  return `${ownerPath}: index ${index} is out of range; valid indices: ${range}; append with --set ${ownerPath}:+ <value>`;
}
function validateConfigValue(parameter, value, context) {
  switch (parameter.token) {
    case "enabled": {
      if (!Array.isArray(value)) {
        return { ok: false, error: `must be a JSON array of CLI names, received ${formatConfigDisplayValue(value)}` };
      }
      const result = [];
      for (const item of value) {
        if (typeof item !== "string") {
          return { ok: false, error: `entry ${formatConfigDisplayValue(item)} is not a string` };
        }
        const target = resolveCliTarget(item);
        if (target === void 0 && !context.cliNames.includes(item.trim().toLowerCase())) {
          return {
            ok: false,
            error: `entry "${item}" is not a supported CLI name; supported names: ${context.cliNames.join(", ")}`
          };
        }
        const canonical = target?.id ?? item.trim().toLowerCase();
        if (result.includes(canonical)) {
          return { ok: false, error: `entry "${canonical}" is duplicated` };
        }
        result.push(canonical);
      }
      return { ok: true, value: result };
    }
    case "apiKey": {
      if (typeof value !== "string") {
        return { ok: false, error: `must be a string, received ${formatConfigDisplayValue(value)}` };
      }
      return { ok: true, value };
    }
    case "autoUpdate": {
      if (typeof value !== "boolean") {
        return { ok: false, error: `must be the JSON boolean true or false, received ${formatConfigDisplayValue(value)}` };
      }
      return { ok: true, value };
    }
    case "enabledTools": {
      if (typeof value !== "string") {
        return { ok: false, error: `must be a string, received ${formatConfigDisplayValue(value)}` };
      }
      const trimmed = value.trim();
      if (trimmed === "*") {
        return { ok: true, value: "*" };
      }
      const items = trimmed.split(",").map((item) => item.trim()).filter((item) => item.length > 0);
      if (items.length === 0) {
        return { ok: false, error: `must be "*" or a comma-separated tool list; accepted tools: ${context.toolNames.join(", ")}` };
      }
      const unknown = items.filter((item) => !context.toolNames.includes(item));
      if (unknown.length > 0) {
        return {
          ok: false,
          error: `unknown tool name(s): ${unknown.join(", ")}; accepted tools: ${context.toolNames.join(", ")} (or "*")`
        };
      }
      return { ok: true, value: items.join(",") };
    }
    case "host": {
      if (typeof value !== "string" || value.trim().length === 0) {
        return { ok: false, error: `must be a non-empty hostname, received ${formatConfigDisplayValue(value)}` };
      }
      return { ok: true, value: value.trim() };
    }
    case "port": {
      if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 65535) {
        return { ok: false, error: `must be an integer in 1..65535, received ${formatConfigDisplayValue(value)}` };
      }
      return { ok: true, value };
    }
    default: {
      return { ok: false, error: `unsupported configuration parameter "${String(parameter.token)}"` };
    }
  }
}
function parseConfigInput(parameter, raw, context) {
  if (parameter.type === "String") {
    return validateConfigValue(parameter, raw, context);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const expected = parameter.type === "Boolean" ? "the JSON boolean true or false" : parameter.type === "Integer" ? "a JSON integer" : "a JSON array of CLI names";
    return { ok: false, error: `${parameter.token} expects ${expected}, received malformed JSON ${formatConfigDisplayValue(raw)}` };
  }
  return validateConfigValue(parameter, parsed, context);
}
function parseConfigItem(parameter, raw, context) {
  const validated = validateConfigValue(parameter, [raw], context);
  if (!validated.ok) {
    return { ok: false, error: validated.error };
  }
  return { ok: true, value: validated.value[0] };
}
function validateConfigDocument(document, context) {
  if (document === null || typeof document !== "object" || Array.isArray(document)) {
    return { ok: false, error: "settings document must be a JSON object" };
  }
  const record = document;
  const settings = {
    enabled: [...CONFIG_DEFAULTS.enabled],
    apiKey: CONFIG_DEFAULTS.apiKey,
    autoUpdate: CONFIG_DEFAULTS.autoUpdate,
    enabledTools: CONFIG_DEFAULTS.enabledTools,
    host: CONFIG_DEFAULTS.host,
    port: CONFIG_DEFAULTS.port
  };
  for (const section of CONFIG_SECTIONS) {
    for (const parameter of section.parameters) {
      const candidate = record[parameter.token];
      const value = candidate === void 0 ? CONFIG_DEFAULTS[parameter.token] : candidate;
      const validated = validateConfigValue(parameter, value, context);
      if (!validated.ok) {
        return { ok: false, error: `${formatConfigPath(section, parameter)}: ${validated.error}` };
      }
      settings[parameter.token] = validated.value;
    }
  }
  return { ok: true, value: settings };
}
function copyConfigDocument(settings) {
  return {
    enabled: [...settings.enabled],
    apiKey: settings.apiKey,
    autoUpdate: settings.autoUpdate,
    enabledTools: settings.enabledTools,
    host: settings.host,
    port: settings.port
  };
}
function readConfigValue(settings, target) {
  if (target.parameter === void 0) {
    const projection = {};
    for (const parameter2 of target.section.parameters) {
      projection[parameter2.token] = settings[parameter2.token];
    }
    return { ok: true, value: projection };
  }
  const parameter = target.parameter;
  const ownerPath = formatConfigPath(target.section, parameter);
  const value = settings[parameter.token];
  if (target.operation === "value") {
    return { ok: true, value };
  }
  if (target.operation !== "index") {
    return {
      ok: false,
      error: `${ownerPath}:${target.canonicalPath.split(":").slice(2).join(":")} is a write-only array operation and cannot be read; read ${ownerPath} instead`
    };
  }
  const items = value;
  const index = target.index;
  if (index >= items.length) {
    return { ok: false, error: describeIndexRangeError(ownerPath, index, items.length, false) };
  }
  return { ok: true, value: items[index] };
}
function applyConfigSet(settings, target, rawValue, context) {
  if (target.parameter === void 0) {
    let parsed2;
    try {
      parsed2 = JSON.parse(rawValue);
    } catch {
      return { ok: false, error: `${target.section.token} expects a JSON object, received malformed JSON ${formatConfigDisplayValue(rawValue)}` };
    }
    const validated = validateConfigDocument(parsed2, context);
    if (!validated.ok) {
      return { ok: false, error: validated.error };
    }
    return { ok: true, settings: validated.value, description: `${target.section.token} replaced` };
  }
  const parameter = target.parameter;
  const ownerPath = formatConfigPath(target.section, parameter);
  const next = copyConfigDocument(settings);
  if (target.operation === "value") {
    const parsed2 = parseConfigInput(parameter, rawValue, context);
    if (!parsed2.ok) {
      return { ok: false, error: `${ownerPath}: ${parsed2.error}` };
    }
    next[parameter.token] = parsed2.value;
    return {
      ok: true,
      settings: next,
      description: `${ownerPath} = ${formatConfigDisplayValue(parsed2.value)}`
    };
  }
  const items = next[parameter.token];
  if (target.operation === "append") {
    const parsed2 = parseConfigItem(parameter, rawValue, context);
    if (!parsed2.ok) {
      return { ok: false, error: `${ownerPath}: ${parsed2.error}` };
    }
    items.push(parsed2.value);
    return {
      ok: true,
      settings: next,
      description: `${ownerPath}:${items.length - 1} = ${formatConfigDisplayValue(parsed2.value)}`
    };
  }
  if (target.operation === "insert") {
    const index2 = target.index;
    if (index2 > items.length) {
      return { ok: false, error: describeIndexRangeError(ownerPath, index2, items.length, true) };
    }
    const parsed2 = parseConfigItem(parameter, rawValue, context);
    if (!parsed2.ok) {
      return { ok: false, error: `${ownerPath}: ${parsed2.error}` };
    }
    items.splice(index2, 0, parsed2.value);
    return {
      ok: true,
      settings: next,
      description: `${ownerPath}:${index2} inserted ${formatConfigDisplayValue(parsed2.value)}`
    };
  }
  const index = target.index;
  if (index >= items.length) {
    return { ok: false, error: describeIndexRangeError(ownerPath, index, items.length, false) };
  }
  const parsed = parseConfigItem(parameter, rawValue, context);
  if (!parsed.ok) {
    return { ok: false, error: `${ownerPath}: ${parsed.error}` };
  }
  items[index] = parsed.value;
  return {
    ok: true,
    settings: next,
    description: `${ownerPath}:${index} = ${formatConfigDisplayValue(parsed.value)}`
  };
}
function applyConfigUnset(settings, target, context) {
  if (target.parameter === void 0) {
    const defaults = validateConfigDocument({ ...CONFIG_DEFAULTS }, context);
    if (!defaults.ok) {
      return { ok: false, error: defaults.error };
    }
    return { ok: true, settings: defaults.value, description: `${target.section.token} restored to schema defaults` };
  }
  const parameter = target.parameter;
  const ownerPath = formatConfigPath(target.section, parameter);
  const next = copyConfigDocument(settings);
  if (target.operation === "value") {
    next[parameter.token] = Array.isArray(CONFIG_DEFAULTS[parameter.token]) ? [...CONFIG_DEFAULTS[parameter.token]] : CONFIG_DEFAULTS[parameter.token];
    return {
      ok: true,
      settings: next,
      description: `${ownerPath} restored to default ${formatConfigDisplayValue(CONFIG_DEFAULTS[parameter.token])}`
    };
  }
  if (target.operation !== "index") {
    return {
      ok: false,
      error: `${target.canonicalPath} is a write-only array operation; --unset accepts ${ownerPath} or ${ownerPath}:<Idx>`
    };
  }
  const items = next[parameter.token];
  const index = target.index;
  if (index >= items.length) {
    return { ok: false, error: describeIndexRangeError(ownerPath, index, items.length, false) };
  }
  items.splice(index, 1);
  return { ok: true, settings: next, description: `${target.canonicalPath} removed` };
}

// src/utils/cliSettings.ts
var SETTINGS_PROGRAM_NAME = "mcp-google-api";
var CLI_SETTINGS_RELATIVE = [".config", SETTINGS_PROGRAM_NAME, "config.json"];
var MCP_SERVER_NAME = "mcp-google-api";
function resolveCliSettingsPath(home) {
  const root = home ?? (process.env.HOME ?? process.cwd());
  return resolve2(root, ...CLI_SETTINGS_RELATIVE);
}
function normalizeEnabledTools(value) {
  if (typeof value !== "string") {
    return CONFIG_DEFAULTS.enabledTools;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : CONFIG_DEFAULTS.enabledTools;
}
function normalizeHost(value) {
  if (typeof value !== "string") {
    return CONFIG_DEFAULTS.host;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : CONFIG_DEFAULTS.host;
}
function normalizePort(value) {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 65535) {
    return CONFIG_DEFAULTS.port;
  }
  return value;
}
function defaultSettings() {
  return {
    enabled: [...CONFIG_DEFAULTS.enabled],
    apiKey: CONFIG_DEFAULTS.apiKey,
    autoUpdate: CONFIG_DEFAULTS.autoUpdate,
    enabledTools: CONFIG_DEFAULTS.enabledTools,
    host: CONFIG_DEFAULTS.host,
    port: CONFIG_DEFAULTS.port
  };
}
function readCliSettingsDocument(home) {
  const path = resolveCliSettingsPath(home);
  if (!existsSync2(path)) {
    return { ok: true, document: {}, exists: false };
  }
  let text;
  try {
    text = readFileSync2(path, "utf-8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `settings file ${path} cannot be read: ${message}` };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { ok: false, error: `settings file ${path} is not valid JSON: ${message}` };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, error: `settings file ${path} must contain a JSON object` };
  }
  return { ok: true, document: parsed, exists: true };
}
function bootstrapCliSettings(home) {
  const path = resolveCliSettingsPath(home);
  if (existsSync2(path)) {
    return path;
  }
  return saveCliSettings(defaultSettings(), home);
}
function isUnsetApiKey(value) {
  return value === void 0 || value === null || value.trim().length === 0;
}
function uniqueStrings(value) {
  if (!Array.isArray(value)) return [];
  const result = [];
  for (const item of value) {
    if (typeof item === "string" && item.length > 0 && !result.includes(item)) {
      result.push(item);
    }
  }
  return result;
}
function loadCliSettings(home) {
  try {
    const raw = JSON.parse(readFileSync2(resolveCliSettingsPath(home), "utf-8"));
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      return defaultSettings();
    }
    const record = raw;
    return {
      enabled: uniqueStrings(record.enabled),
      apiKey: typeof record.apiKey === "string" ? record.apiKey : "",
      autoUpdate: typeof record.autoUpdate === "boolean" ? record.autoUpdate : true,
      enabledTools: normalizeEnabledTools(record.enabledTools),
      host: normalizeHost(record.host),
      port: normalizePort(record.port)
    };
  } catch {
    return defaultSettings();
  }
}
function loadConfiguredApiKey(home) {
  const apiKey = loadCliSettings(home).apiKey;
  return isUnsetApiKey(apiKey) ? void 0 : apiKey;
}
function saveCliSettings(settings, home) {
  const path = resolveCliSettingsPath(home);
  const temporary = `${path}.tmp`;
  const normalized = {
    enabled: uniqueStrings(settings.enabled),
    apiKey: typeof settings.apiKey === "string" ? settings.apiKey : "",
    autoUpdate: settings.autoUpdate === true,
    enabledTools: normalizeEnabledTools(settings.enabledTools),
    host: normalizeHost(settings.host),
    port: normalizePort(settings.port)
  };
  const payload = {};
  for (const parameter of CONFIG_SECTION.parameters) {
    payload[parameter.token] = normalized[parameter.token];
  }
  const serialized = JSON.stringify(payload, null, 2) + "\n";
  let mode = 384;
  try {
    mode = statSync2(path).mode & 511;
  } catch {
    mode = 384;
  }
  try {
    mkdirSync2(join2(path, ".."), { recursive: true });
    const handle = openSync(temporary, "w", mode);
    try {
      writeFileSync2(handle, serialized, "utf-8");
      fsyncSync(handle);
    } finally {
      closeSync(handle);
    }
    renameSync2(temporary, path);
    const directory = join2(path, "..");
    let directoryHandle;
    try {
      directoryHandle = openSync(directory, "r");
      fsyncSync(directoryHandle);
    } catch {
    } finally {
      if (directoryHandle !== void 0) {
        closeSync(directoryHandle);
      }
    }
  } catch (error) {
    try {
      unlinkSync(temporary);
    } catch {
    }
    throw new Error(`settings write failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  return path;
}

// src/utils/configResolver.ts
var NODE_ENGINE_FLOOR = 24;
function resolveRuntimeConfig(settings, overrides = {}) {
  const settingsPort = Number.isInteger(settings.port) && settings.port >= 1 && settings.port <= 65535 ? settings.port : void 0;
  let port;
  let portRaw;
  let portSource;
  if (overrides.port !== void 0) {
    port = overrides.port;
    portRaw = String(overrides.port);
    portSource = "flag";
  } else if (settingsPort !== void 0) {
    port = settingsPort;
    portRaw = String(settingsPort);
    portSource = "settings";
  } else {
    port = void 0;
    portRaw = String(settings.port);
    portSource = "settings";
  }
  const flagApiKey = overrides.apiKey !== void 0 ? overrides.apiKey.trim() : void 0;
  const settingsApiKey = isUnsetApiKey(settings.apiKey) ? void 0 : settings.apiKey;
  const apiKey = flagApiKey !== void 0 && flagApiKey.length > 0 ? flagApiKey : settingsApiKey;
  const apiKeySource = flagApiKey !== void 0 && flagApiKey.length > 0 ? "flag" : settingsApiKey !== void 0 ? "settings" : "none";
  return {
    apiKey,
    apiKeySource,
    host: overrides.host ?? settings.host,
    hostSource: overrides.host !== void 0 ? "flag" : "settings",
    port,
    portRaw,
    portSource,
    enabledToolsRaw: settings.enabledTools,
    enabledToolsSource: "settings",
    autoUpdateDisabled: settings.autoUpdate !== true
  };
}
function maskSecret(value) {
  if (!value) {
    return "unset";
  }
  if (value.length <= 8) {
    return "****";
  }
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}
function describeRuntimeConfig(config) {
  return {
    apiKey: { value: maskSecret(config.apiKey), source: config.apiKeySource },
    httpHost: { value: config.host, source: config.hostSource },
    httpPort: {
      value: config.port ?? null,
      raw: config.portRaw ?? null,
      source: config.portSource
    },
    enabledTools: { value: config.enabledToolsRaw, source: config.enabledToolsSource },
    autoUpdateCheck: { enabled: !config.autoUpdateDisabled }
  };
}
function formatConfigDiagnostics(diagnostics) {
  return [
    `host=${diagnostics.httpHost.value} (${diagnostics.httpHost.source})`,
    `port=${diagnostics.httpPort.value ?? "invalid"} (raw: ${diagnostics.httpPort.raw ?? "n/a"}, ${diagnostics.httpPort.source})`,
    `apiKey=${diagnostics.apiKey.value} (${diagnostics.apiKey.source})`,
    `enabledTools=${diagnostics.enabledTools.value} (${diagnostics.enabledTools.source})`,
    `updateCheck=${diagnostics.autoUpdateCheck.enabled ? "enabled" : "disabled"}`
  ].join("; ");
}
function resolveEnabledToolNames(allToolNames, raw) {
  const trimmed = raw?.trim();
  if (!trimmed || trimmed === "*") {
    return { names: [...allToolNames], matched: allToolNames.length, fallback: false, requested: [] };
  }
  const requested = trimmed.split(",").map((item) => item.trim()).filter(Boolean);
  const enabled = new Set(requested);
  const names = allToolNames.filter((name) => enabled.has(name));
  if (names.length === 0) {
    return { names: [...allToolNames], matched: 0, fallback: true, requested };
  }
  return { names, matched: names.length, fallback: false, requested };
}

// src/tools/maps/searchNearby.ts
import { z } from "zod";

// src/utils/requestContext.ts
import { AsyncLocalStorage } from "async_hooks";

// src/utils/apiKeyManager.ts
var ApiKeyManager = class _ApiKeyManager {
  constructor() {
    this.defaultApiKey = void 0;
  }
  /**
   * @brief Returns the process-wide singleton instance.
   * @details Lazily constructs the manager; the default key starts unset and
   * MUST be injected by the server-start path before serving requests.
   * Complexity O(1).
   * @return {ApiKeyManager} The singleton instance.
   */
  static getInstance() {
    if (!_ApiKeyManager.instance) {
      _ApiKeyManager.instance = new _ApiKeyManager();
    }
    return _ApiKeyManager.instance;
  }
  /**
   * @brief Injects the startup default API key.
   * @details Called by the server-start command with the key resolved from
   * the persisted settings (REQ-142); undefined clears the default so
   * requests without header/session keys resolve no key (REQ-018, DES-006).
   * Pure in-memory mutation; no environment writes.
   * @param key {string | undefined} Default key from the persisted settings; undefined clears it.
   * @return {void}
   * @satisfies DES-006, REQ-142
   */
  setDefaultApiKey(key) {
    this.defaultApiKey = key;
  }
  /**
   * @brief Resolves the effective API key for one request.
   * @details Priority: `X-Google-Maps-API-Key` header, then `Authorization:
   * Bearer` token, then the session key, then the injected default key
   * (DES-005, REQ-016, REQ-017, REQ-018). Complexity O(1).
   * @param req {Request | undefined} Incoming HTTP request; undefined skips header resolution.
   * @param sessionApiKey {string | undefined} Session-scoped key; consulted before the default.
   * @return {string | undefined} Effective key; undefined when nothing resolves.
   * @satisfies DES-005, REQ-016, REQ-017, REQ-018
   */
  getApiKey(req, sessionApiKey) {
    if (req) {
      const headerApiKey = req.headers["x-google-maps-api-key"];
      if (headerApiKey) {
        return headerApiKey;
      }
      const authHeader = req.headers["authorization"];
      if (authHeader && authHeader.startsWith("Bearer ")) {
        return authHeader.substring(7);
      }
    }
    if (sessionApiKey) {
      return sessionApiKey;
    }
    return this.defaultApiKey;
  }
  /**
   * @brief Reports whether any API key is resolvable for a request.
   * @details Delegates to `getApiKey` truthiness. Complexity O(1).
   * @param req {Request | undefined} Incoming HTTP request.
   * @param sessionApiKey {string | undefined} Session-scoped key.
   * @return {boolean} True when a key resolves.
   */
  hasApiKey(req, sessionApiKey) {
    return !!this.getApiKey(req, sessionApiKey);
  }
  /**
   * @brief Validates the API key format.
   * @details Accepts 20-50 characters of `[A-Za-z0-9_-]` (REQ-020). Pure;
   * complexity O(n) in key length.
   * @param key {string} Candidate key.
   * @return {boolean} True when the format is valid.
   * @satisfies REQ-020
   */
  isValidApiKeyFormat(key) {
    return /^[A-Za-z0-9_-]{20,50}$/.test(key);
  }
};

// src/utils/requestContext.ts
var requestContextStorage = new AsyncLocalStorage();
function getCurrentApiKey() {
  const context = requestContextStorage.getStore();
  return context?.apiKey || ApiKeyManager.getInstance().getApiKey();
}
function runWithContext(context, fn) {
  return requestContextStorage.run(context, fn);
}

// src/tools/maps/searchNearby.ts
var NAME = "maps_search_nearby";
var DESCRIPTION = "Find places near a specific location by type (e.g., restaurants, cafes, hotels). Use when the user wants to discover what's around a given address or coordinates, such as 'find coffee shops near Times Square' or 'what hotels are near the airport'. Supports filtering by place type, search radius, minimum rating, and whether currently open.";
var SCHEMA = {
  center: z.object({
    value: z.string().describe("Address, landmark name, or coordinates (coordinate format: lat,lng)"),
    isCoordinates: z.boolean().default(false).describe("Whether the value is coordinates")
  }).describe("Search center point (e.g. value: 49.3268778,-123.0585982, isCoordinates: true)"),
  keyword: z.string().optional().describe("Place type to search for (e.g., restaurant, cafe, hotel, gas_station, hospital)"),
  radius: z.number().default(1e3).describe("Search radius in meters"),
  openNow: z.boolean().default(false).describe("Only show places that are currently open"),
  minRating: z.number().min(0).max(5).optional().describe("Minimum rating requirement (0-5)")
};
async function ACTION(params) {
  try {
    const apiKey = getCurrentApiKey();
    const placesSearcher = new PlacesSearcher(apiKey);
    const result = await placesSearcher.searchNearby(params);
    if (!result.success) {
      return {
        content: [{ type: "text", text: result.error || "Search failed" }],
        isError: true
      };
    }
    return {
      content: [
        {
          type: "text",
          text: `location: ${JSON.stringify(result.location, null, 2)}
` + JSON.stringify(result.data, null, 2)
        }
      ],
      isError: false
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
    return {
      isError: true,
      content: [{ type: "text", text: `Error searching nearby places: ${errorMessage}` }]
    };
  }
}
var SearchNearby = {
  NAME,
  DESCRIPTION,
  SCHEMA,
  ACTION
};

// src/tools/maps/placeDetails.ts
import { z as z2 } from "zod";
var NAME2 = "maps_place_details";
var DESCRIPTION2 = "Get comprehensive details for a specific place using its Google Maps place_id. Use after search_nearby or maps_search_places to get reviews, phone, website, and hours. Includes priceRange (raw Money structure: startPrice/endPrice with currencyCode/units/nanos), businessStatus, types and both regular and current opening hours. Reviews, photos, and AI summaries include source/disclosure metadata that must accompany end-user display. Set maxPhotos (1-10) to include photo URLs; omit or set 0 for none. Set includeRaw to attach the original Places API payload (raw_place) for API-verified validation.";
var SCHEMA2 = {
  placeId: z2.string().describe("Google Maps place ID"),
  maxPhotos: z2.number().int().min(0).max(10).optional().describe("Number of photo URLs to include (0 = none, max 10). Omit to skip photos and save tokens."),
  includeRaw: z2.boolean().optional().describe(
    "Include the original Places API payload (raw_place) alongside the interpreted fields, for API-verified validation"
  )
};
async function ACTION2(params) {
  try {
    const apiKey = getCurrentApiKey();
    const placesSearcher = new PlacesSearcher(apiKey);
    const result = await placesSearcher.getPlaceDetails(params.placeId, params.maxPhotos || 0, params.includeRaw || false);
    if (!result.success) {
      return {
        content: [{ type: "text", text: result.error || "Failed to get place details" }],
        isError: true
      };
    }
    const payload = { ...result.data };
    if (result.fieldMask) payload.field_mask = result.fieldMask;
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(payload, null, 2)
        }
      ],
      isError: false
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
    return {
      isError: true,
      content: [{ type: "text", text: `Error getting place details: ${errorMessage}` }]
    };
  }
}
var PlaceDetails = {
  NAME: NAME2,
  DESCRIPTION: DESCRIPTION2,
  SCHEMA: SCHEMA2,
  ACTION: ACTION2
};

// src/tools/maps/geocode.ts
import { z as z3 } from "zod";
var NAME3 = "maps_geocode";
var DESCRIPTION3 = "Convert an address, city name, or landmark into GPS coordinates (latitude/longitude). Use when you need coordinates for a location described in text \u2014 for example, to provide a center point for search_nearby or a starting point for maps_directions.";
var SCHEMA3 = {
  address: z3.string().describe("Address or place name to convert to coordinates")
};
async function ACTION3(params) {
  try {
    const apiKey = getCurrentApiKey();
    const placesSearcher = new PlacesSearcher(apiKey);
    const result = await placesSearcher.geocode(params.address);
    if (!result.success) {
      return {
        content: [{ type: "text", text: result.error || "Failed to geocode address" }],
        isError: true
      };
    }
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result.data, null, 2)
        }
      ],
      isError: false
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
    return {
      isError: true,
      content: [{ type: "text", text: `Error geocoding address: ${errorMessage}` }]
    };
  }
}
var Geocode = {
  NAME: NAME3,
  DESCRIPTION: DESCRIPTION3,
  SCHEMA: SCHEMA3,
  ACTION: ACTION3
};

// src/tools/maps/reverseGeocode.ts
import { z as z4 } from "zod";
var NAME4 = "maps_reverse_geocode";
var DESCRIPTION4 = "Convert GPS coordinates (latitude/longitude) into a human-readable street address. Use when you have coordinates from another tool's output or a user's shared location and need the actual address.";
var SCHEMA4 = {
  latitude: z4.number().describe("Latitude coordinate"),
  longitude: z4.number().describe("Longitude coordinate")
};
async function ACTION4(params) {
  try {
    const apiKey = getCurrentApiKey();
    const placesSearcher = new PlacesSearcher(apiKey);
    const result = await placesSearcher.reverseGeocode(params.latitude, params.longitude);
    if (!result.success) {
      return {
        content: [{ type: "text", text: result.error || "Failed to reverse geocode coordinates" }],
        isError: true
      };
    }
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result.data, null, 2)
        }
      ],
      isError: false
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
    return {
      isError: true,
      content: [{ type: "text", text: `Error reverse geocoding: ${errorMessage}` }]
    };
  }
}
var ReverseGeocode = {
  NAME: NAME4,
  DESCRIPTION: DESCRIPTION4,
  SCHEMA: SCHEMA4,
  ACTION: ACTION4
};

// src/tools/maps/distanceMatrix.ts
import { z as z5 } from "zod";
var NAME5 = "maps_distance_matrix";
var DESCRIPTION5 = "Calculate travel distances and durations between multiple origins and destinations in a single request. Use for comparing travel options \u2014 e.g., 'which hotel is closest to the office?' or batch distance calculations. Supports driving, walking, bicycling, and transit modes.";
var SCHEMA5 = {
  origins: z5.array(z5.string()).describe("List of origin addresses or coordinates"),
  destinations: z5.array(z5.string()).describe("List of destination addresses or coordinates"),
  mode: z5.enum(["driving", "walking", "bicycling", "transit"]).default("driving").describe("Travel mode for calculation"),
  departure_time: z5.string().optional().describe(
    "Departure time in ISO 8601 format (e.g. 2026-03-21T09:00:00Z). Enables traffic-aware duration estimates."
  ),
  avoid_tolls: z5.boolean().optional().describe('Avoid toll roads where reasonable. Only supported with mode "driving".'),
  avoid_highways: z5.boolean().optional().describe('Avoid highways where reasonable. Only supported with mode "driving".')
};
async function ACTION5(params) {
  try {
    const apiKey = getCurrentApiKey();
    const placesSearcher = new PlacesSearcher(apiKey);
    const result = await placesSearcher.calculateDistanceMatrix(
      params.origins,
      params.destinations,
      params.mode,
      params.departure_time,
      params.avoid_tolls,
      params.avoid_highways
    );
    if (!result.success) {
      return {
        content: [{ type: "text", text: result.error || "Failed to calculate distance matrix" }],
        isError: true
      };
    }
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result.data, null, 2)
        }
      ],
      isError: false
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
    return {
      isError: true,
      content: [{ type: "text", text: `Error calculating distance matrix: ${errorMessage}` }]
    };
  }
}
var DistanceMatrix = {
  NAME: NAME5,
  DESCRIPTION: DESCRIPTION5,
  SCHEMA: SCHEMA5,
  ACTION: ACTION5
};

// src/tools/maps/directions.ts
import { z as z6 } from "zod";
var NAME6 = "maps_directions";
var DESCRIPTION6 = "Get step-by-step navigation directions between two points with route details. Use when the user asks 'how do I get from A to B?' and needs the route summary, total distance, estimated travel time, or turn-by-turn instructions. Supports departure/arrival times and multiple travel modes.";
var SCHEMA6 = {
  origin: z6.string().describe("Starting point address or coordinates"),
  destination: z6.string().describe("Destination address or coordinates"),
  mode: z6.enum(["driving", "walking", "bicycling", "transit"]).default("driving").describe("Travel mode for directions"),
  departure_time: z6.string().optional().describe("Departure time (ISO string format)"),
  arrival_time: z6.string().optional().describe("Arrival time (ISO string format)"),
  avoid_tolls: z6.boolean().optional().describe('Avoid toll roads where reasonable. Only supported with mode "driving".'),
  avoid_highways: z6.boolean().optional().describe('Avoid highways where reasonable. Only supported with mode "driving".')
};
async function ACTION6(params) {
  try {
    const apiKey = getCurrentApiKey();
    const placesSearcher = new PlacesSearcher(apiKey);
    const result = await placesSearcher.getDirections(
      params.origin,
      params.destination,
      params.mode,
      params.departure_time,
      params.arrival_time,
      params.avoid_tolls,
      params.avoid_highways
    );
    if (!result.success) {
      return {
        content: [{ type: "text", text: result.error || "Failed to get directions" }],
        isError: true
      };
    }
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result.data, null, 2)
        }
      ],
      isError: false
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
    return {
      isError: true,
      content: [{ type: "text", text: `Error getting directions: ${errorMessage}` }]
    };
  }
}
var Directions = {
  NAME: NAME6,
  DESCRIPTION: DESCRIPTION6,
  SCHEMA: SCHEMA6,
  ACTION: ACTION6
};

// src/tools/maps/elevation.ts
import { z as z7 } from "zod";
var NAME7 = "maps_elevation";
var DESCRIPTION7 = "Get elevation (meters above sea level) for geographic coordinates. Use when the user asks 'how high is this place', 'is this area flood-prone', or needs altitude for hiking/cycling route profiles. Also useful for real estate risk assessment \u2014 low elevation near water suggests flood risk.";
var SCHEMA7 = {
  locations: z7.array(
    z7.object({
      latitude: z7.number().describe("Latitude coordinate"),
      longitude: z7.number().describe("Longitude coordinate")
    })
  ).describe("List of locations to get elevation data for")
};
async function ACTION7(params) {
  try {
    const apiKey = getCurrentApiKey();
    const placesSearcher = new PlacesSearcher(apiKey);
    const result = await placesSearcher.getElevation(params.locations);
    if (!result.success) {
      return {
        content: [{ type: "text", text: result.error || "Failed to get elevation data" }],
        isError: true
      };
    }
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result.data, null, 2)
        }
      ],
      isError: false
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
    return {
      isError: true,
      content: [{ type: "text", text: `Error getting elevation data: ${errorMessage}` }]
    };
  }
}
var Elevation = {
  NAME: NAME7,
  DESCRIPTION: DESCRIPTION7,
  SCHEMA: SCHEMA7,
  ACTION: ACTION7
};

// src/tools/maps/searchPlaces.ts
import { z as z8 } from "zod";
var NAME8 = "maps_search_places";
var DESCRIPTION8 = "Search for places using a free-text query like 'sushi restaurants in Tokyo' or 'best coffee shops near Central Park'. More flexible than search_nearby \u2014 supports natural language queries, optional location bias, server-side rating and cumulative price-level filters (Places API Text Search priceLevels enum), strict type filtering, and open-now filtering. Returns place details including priceRange (raw Money structure), types, businessStatus, rating, userRatingCount and opening hours. Supports pageSize/pageToken pagination (up to 20 per page) and an optional includeRaw mode that attaches the original Places API payload for API-verified validation.";
var PRICE_LEVELS = [
  "PRICE_LEVEL_FREE",
  "PRICE_LEVEL_INEXPENSIVE",
  "PRICE_LEVEL_MODERATE",
  "PRICE_LEVEL_EXPENSIVE",
  "PRICE_LEVEL_VERY_EXPENSIVE"
];
var SCHEMA8 = {
  query: z8.string().describe("Text search query (e.g., 'Italian restaurants in Manhattan', 'hotels near Taipei 101')"),
  locationBias: z8.object({
    latitude: z8.number().describe("Latitude to bias results toward"),
    longitude: z8.number().describe("Longitude to bias results toward"),
    radius: z8.number().optional().describe("Bias radius in meters (default: 5000)")
  }).optional().describe("Optional location to bias results toward"),
  openNow: z8.boolean().optional().describe("Only return places that are currently open (server-side filter)"),
  minRating: z8.number().optional().describe("Minimum rating filter (1.0 - 5.0), applied server-side by the API"),
  includedType: z8.string().optional().describe(
    "Filter by a single place type (e.g., restaurant, cafe, bakery). Text Search supports exactly one includedType per call"
  ),
  strictTypeFiltering: z8.boolean().optional().describe(
    "Strict type filtering: if true, only results of the same type as includedType are returned (default: loose interpretation)"
  ),
  priceLevels: z8.array(z8.enum(PRICE_LEVELS)).optional().describe(
    'Server-side economic filter. Pass ALL allowed levels cumulatively up to the budget cap, e.g. budget 30 EUR -> ["PRICE_LEVEL_INEXPENSIVE", "PRICE_LEVEL_MODERATE"]. Do not include PRICE_LEVEL_FREE'
  ),
  pageSize: z8.number().int().min(1).max(20).optional().describe("Number of results per page (1-20). Use nextPageToken from the response to fetch further pages (up to 60 total)"),
  pageToken: z8.string().optional().describe("nextPageToken returned by a previous maps_search_places call, to retrieve the next page of results"),
  languageCode: z8.string().optional().describe("Language code for results (e.g., 'en', 'it', 'ja')"),
  includeRaw: z8.boolean().optional().describe(
    "Include the original Places API payload: each result gets a raw_place field and the full raw_response is returned (for API-verified validation)"
  )
};
async function ACTION8(params) {
  try {
    const apiKey = getCurrentApiKey();
    const placesSearcher = new PlacesSearcher(apiKey);
    const result = await placesSearcher.searchText({
      query: params.query,
      locationBias: params.locationBias,
      openNow: params.openNow,
      minRating: params.minRating,
      includedType: params.includedType,
      strictTypeFiltering: params.strictTypeFiltering,
      priceLevels: params.priceLevels,
      pageSize: params.pageSize,
      pageToken: params.pageToken,
      languageCode: params.languageCode,
      includeRaw: params.includeRaw
    });
    if (!result.success) {
      return {
        content: [{ type: "text", text: result.error || "Failed to search places" }],
        isError: true
      };
    }
    const payload = {
      results: result.data
    };
    if (result.nextPageToken) payload.nextPageToken = result.nextPageToken;
    if (result.fieldMask) payload.field_mask = result.fieldMask;
    if (params.includeRaw && result.raw_response) payload.raw_response = result.raw_response;
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(payload, null, 2)
        }
      ],
      isError: false
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
    return {
      isError: true,
      content: [{ type: "text", text: `Error searching places: ${errorMessage}` }]
    };
  }
}
var SearchPlaces = {
  NAME: NAME8,
  DESCRIPTION: DESCRIPTION8,
  SCHEMA: SCHEMA8,
  ACTION: ACTION8
};

// src/tools/maps/timezone.ts
import { z as z9 } from "zod";
var NAME9 = "maps_timezone";
var DESCRIPTION9 = "Get the timezone and current local time for a location. Use when the user asks 'what time is it in Tokyo', needs to coordinate a meeting across timezones, or is planning travel across timezone boundaries. Returns timezone ID, UTC/DST offsets, and computed local time.";
var SCHEMA9 = {
  latitude: z9.number().describe("Latitude coordinate"),
  longitude: z9.number().describe("Longitude coordinate"),
  timestamp: z9.number().optional().describe("Unix timestamp in ms to query timezone at a specific moment (defaults to now)")
};
async function ACTION9(params) {
  try {
    const apiKey = getCurrentApiKey();
    const placesSearcher = new PlacesSearcher(apiKey);
    const result = await placesSearcher.getTimezone(params.latitude, params.longitude, params.timestamp);
    if (!result.success) {
      return {
        content: [{ type: "text", text: result.error || "Failed to get timezone data" }],
        isError: true
      };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(result.data, null, 2) }],
      isError: false
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
    return {
      isError: true,
      content: [{ type: "text", text: `Error getting timezone: ${errorMessage}` }]
    };
  }
}
var Timezone = {
  NAME: NAME9,
  DESCRIPTION: DESCRIPTION9,
  SCHEMA: SCHEMA9,
  ACTION: ACTION9
};

// src/tools/maps/weather.ts
import { z as z10 } from "zod";
var NAME10 = "maps_weather";
var DESCRIPTION10 = "Get weather for a location \u2014 current conditions, daily forecast (10 days), or hourly forecast (240 hours). Use when the user asks 'what's the weather in Paris', is planning outdoor activities, or needs to pack for a trip. Coverage: most regions supported, but China, Japan, South Korea, Cuba, Iran, North Korea, Syria are unavailable.";
var SCHEMA10 = {
  latitude: z10.number().describe("Latitude coordinate"),
  longitude: z10.number().describe("Longitude coordinate"),
  type: z10.enum(["current", "forecast_daily", "forecast_hourly"]).optional().describe("current = right now, forecast_daily = multi-day outlook, forecast_hourly = hour-by-hour"),
  forecastDays: z10.number().optional().describe("Number of forecast days (1-10, only for forecast_daily, default: 5)"),
  forecastHours: z10.number().optional().describe("Number of forecast hours (1-240, only for forecast_hourly, default: 24)")
};
async function ACTION10(params) {
  try {
    const apiKey = getCurrentApiKey();
    const placesSearcher = new PlacesSearcher(apiKey);
    const result = await placesSearcher.getWeather(
      params.latitude,
      params.longitude,
      params.type || "current",
      params.forecastDays,
      params.forecastHours
    );
    if (!result.success) {
      return {
        content: [{ type: "text", text: result.error || "Failed to get weather data" }],
        isError: true
      };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(result.data, null, 2) }],
      isError: false
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
    return {
      isError: true,
      content: [{ type: "text", text: `Error getting weather: ${errorMessage}` }]
    };
  }
}
var Weather = {
  NAME: NAME10,
  DESCRIPTION: DESCRIPTION10,
  SCHEMA: SCHEMA10,
  ACTION: ACTION10
};

// src/tools/maps/exploreArea.ts
import { z as z11 } from "zod";
var NAME11 = "maps_explore_area";
var DESCRIPTION11 = "Explore what's around a location in one call \u2014 searches multiple place types, gets details for the top results, and returns a categorized summary. Use when the user asks 'what's around here', 'explore the area near my hotel', or needs a quick overview of a neighborhood. Replaces the manual chain of geocode \u2192 search-nearby \u2192 place-details. For trip planning: use search_places first to get geographically spread anchor points, then call this tool around each anchor (e.g. 'Gion, Kyoto') \u2014 never pass just the city name, as it clusters all results in one area. After results, call static_map to visualize.";
var SCHEMA11 = {
  location: z11.string().describe("Address or landmark to explore around"),
  types: z11.array(z11.string()).optional().describe(
    "Place types to search (default: restaurant, cafe, tourist_attraction). Must be Places API (New) type names. Examples: hotel, bar, park, museum"
  ),
  radius: z11.number().optional().describe("Search radius in meters (default: 1000)"),
  topN: z11.number().optional().describe("Number of top results per type to get details for (default: 3)")
};
async function ACTION11(params) {
  try {
    const apiKey = getCurrentApiKey();
    const searcher = new PlacesSearcher(apiKey);
    const result = await searcher.exploreArea(params);
    return {
      content: [{ type: "text", text: JSON.stringify(result.data, null, 2) }],
      isError: false
    };
  } catch (error) {
    return {
      isError: true,
      content: [{ type: "text", text: `Error exploring area: ${error.message}` }]
    };
  }
}
var ExploreArea = { NAME: NAME11, DESCRIPTION: DESCRIPTION11, SCHEMA: SCHEMA11, ACTION: ACTION11 };

// src/tools/maps/planRoute.ts
import { z as z12 } from "zod";
var NAME12 = "maps_plan_route";
var DESCRIPTION12 = "Plan an optimized multi-stop route in one call \u2014 geocodes all stops, uses Routes API waypoint optimization (2 to 25 intermediate stops) to find the most efficient visit order, and returns directions for each leg. Use when the user says 'visit these 5 places efficiently', 'plan a route through A, B, C', or needs a multi-stop itinerary. Replaces the manual chain of geocode \u2192 distance-matrix \u2192 directions. Waypoint optimization requires at least 4 stops (2 intermediates); with 2 or 3 stops the route is returned in the original order. For multi-day trips: create one plan_route call per day with stops that follow a geographic arc (e.g. east\u2192west) rather than mixing distant areas. After results, call static_map to visualize the route.";
var SCHEMA12 = {
  stops: z12.array(z12.string()).min(2).describe("List of addresses or landmarks to visit (minimum 2)"),
  mode: z12.enum(["driving", "walking", "bicycling", "transit"]).optional().describe("Travel mode (default: driving)"),
  optimize: z12.boolean().optional().describe(
    "Auto-optimize visit order via Routes API waypoint optimization (default: true). Requires at least 4 stops (2 intermediates) \u2014 ignored for 2-3 stops. Set false to keep original order. Not available for transit mode."
  ),
  departure_time: z12.string().optional().describe("Departure time in ISO 8601 format (e.g. 2026-03-21T09:00:00Z). Enables traffic-aware routing."),
  avoid_tolls: z12.boolean().optional().describe('Avoid toll roads where reasonable. Only supported with mode "driving".'),
  avoid_highways: z12.boolean().optional().describe('Avoid highways where reasonable. Only supported with mode "driving".')
};
async function ACTION12(params) {
  try {
    const apiKey = getCurrentApiKey();
    const searcher = new PlacesSearcher(apiKey);
    const result = await searcher.planRoute(params);
    return {
      content: [{ type: "text", text: JSON.stringify(result.data, null, 2) }],
      isError: false
    };
  } catch (error) {
    return {
      isError: true,
      content: [{ type: "text", text: `Error planning route: ${error.message}` }]
    };
  }
}
var PlanRoute = { NAME: NAME12, DESCRIPTION: DESCRIPTION12, SCHEMA: SCHEMA12, ACTION: ACTION12 };

// src/tools/maps/comparePlaces.ts
import { z as z13 } from "zod";
var NAME13 = "maps_compare_places";
var DESCRIPTION13 = "Compare multiple places side-by-side in one call \u2014 searches by query, gets details for each result, and optionally calculates distance from your location. Use when the user asks 'which restaurant should I pick', 'compare these hotels', or needs a decision table. Replaces the manual chain of search-places \u2192 place-details \u2192 distance-matrix.";
var SCHEMA13 = {
  query: z13.string().describe("Search query (e.g., 'ramen near Shibuya', 'hotels in Taipei')"),
  userLocation: z13.object({
    latitude: z13.number().describe("Your latitude"),
    longitude: z13.number().describe("Your longitude")
  }).optional().describe("Your current location \u2014 if provided, adds distance and drive time to each result"),
  limit: z13.number().optional().describe("Max places to compare (default: 5)")
};
async function ACTION13(params) {
  try {
    const apiKey = getCurrentApiKey();
    const searcher = new PlacesSearcher(apiKey);
    const result = await searcher.comparePlaces(params);
    return {
      content: [{ type: "text", text: JSON.stringify(result.data, null, 2) }],
      isError: false
    };
  } catch (error) {
    return {
      isError: true,
      content: [{ type: "text", text: `Error comparing places: ${error.message}` }]
    };
  }
}
var ComparePlaces = { NAME: NAME13, DESCRIPTION: DESCRIPTION13, SCHEMA: SCHEMA13, ACTION: ACTION13 };

// src/tools/maps/airQuality.ts
import { z as z14 } from "zod";
var NAME14 = "maps_air_quality";
var DESCRIPTION14 = "Get air quality for a location \u2014 AQI index, pollutant concentrations, and health recommendations by demographic group (elderly, children, athletes, pregnant women, etc.). Use when the user asks 'is the air safe', 'should I wear a mask', 'good for outdoor exercise', or is planning travel for someone with respiratory/heart conditions. Coverage: global including Japan (unlike weather). Returns both universal AQI and local index (EPA for US, AEROS for Japan, etc.).";
var SCHEMA14 = {
  latitude: z14.number().describe("Latitude coordinate"),
  longitude: z14.number().describe("Longitude coordinate"),
  includeHealthRecommendations: z14.boolean().optional().describe("Include health advice per demographic group (default: true)"),
  includePollutants: z14.boolean().optional().describe("Include individual pollutant concentrations \u2014 PM2.5, PM10, NO2, O3, CO, SO2 (default: false)")
};
async function ACTION14(params) {
  try {
    const apiKey = getCurrentApiKey();
    const placesSearcher = new PlacesSearcher(apiKey);
    const result = await placesSearcher.getAirQuality(
      params.latitude,
      params.longitude,
      params.includeHealthRecommendations,
      params.includePollutants
    );
    if (!result.success) {
      return {
        content: [{ type: "text", text: result.error || "Failed to get air quality data" }],
        isError: true
      };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(result.data, null, 2) }],
      isError: false
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
    return {
      isError: true,
      content: [{ type: "text", text: `Error getting air quality: ${errorMessage}` }]
    };
  }
}
var AirQuality = {
  NAME: NAME14,
  DESCRIPTION: DESCRIPTION14,
  SCHEMA: SCHEMA14,
  ACTION: ACTION14
};

// src/tools/maps/staticMap.ts
import { z as z15 } from "zod";
var NAME15 = "maps_static_map";
var DESCRIPTION15 = "Generate a map image with markers, paths, or routes \u2014 returned as an inline image the user can see directly in chat. PROACTIVELY call this tool after explore_area, plan_route, search_nearby, or directions to visualize results on a map \u2014 don't wait for the user to ask. Use markers from search results and path from route data. Supports roadmap, satellite, terrain, and hybrid views. Max 640x640 pixels.";
var SCHEMA15 = {
  center: z15.string().optional().describe('Map center \u2014 "lat,lng" or address. Optional if markers or path are provided.'),
  zoom: z15.number().optional().describe("Zoom level 0-21 (0 = world, 15 = streets, 21 = buildings). Default: auto-fit."),
  size: z15.string().optional().describe('Image size "WxH" in pixels. Default: "600x400". Max: "640x640".'),
  maptype: z15.enum(["roadmap", "satellite", "terrain", "hybrid"]).optional().describe("Map style. Default: roadmap."),
  markers: z15.array(z15.string()).optional().describe(
    'Marker descriptors. Each string: "color:red|label:A|lat,lng" or "color:blue|address". Multiple markers per string separated by |.'
  ),
  path: z15.array(z15.string()).optional().describe(
    'Path descriptors. Each string: "color:0x0000ff|weight:3|lat1,lng1|lat2,lng2|..." to draw lines/routes on the map.'
  )
};
async function ACTION15(params) {
  try {
    const apiKey = getCurrentApiKey();
    const placesSearcher = new PlacesSearcher(apiKey);
    const result = await placesSearcher.getStaticMap(params);
    if (!result.success) {
      return {
        content: [{ type: "text", text: result.error || "Failed to generate static map" }],
        isError: true
      };
    }
    return {
      content: [
        {
          type: "image",
          data: result.data.base64,
          mimeType: "image/png"
        },
        {
          type: "text",
          text: `Map generated (${result.data.size} bytes, ${result.data.dimensions})`
        }
      ],
      isError: false
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
    return {
      isError: true,
      content: [{ type: "text", text: `Error generating static map: ${errorMessage}` }]
    };
  }
}
var StaticMap = {
  NAME: NAME15,
  DESCRIPTION: DESCRIPTION15,
  SCHEMA: SCHEMA15,
  ACTION: ACTION15
};

// src/tools/maps/batchGeocode.ts
import { z as z16 } from "zod";
var NAME16 = "maps_batch_geocode";
var DESCRIPTION16 = "Geocode multiple addresses in one call \u2014 up to 50 addresses, returns coordinates for each. Use when the user provides a list of addresses and needs all their coordinates, e.g. 'geocode these 10 offices' or 'get coordinates for all these restaurants'. For more than 50, use the CLI batch-geocode command instead.";
var SCHEMA16 = {
  addresses: z16.array(z16.string()).min(1).max(50).describe("List of addresses or landmark names to geocode (max 50)")
};
async function ACTION16(params) {
  try {
    const apiKey = getCurrentApiKey();
    const searcher = new PlacesSearcher(apiKey);
    const addresses = params.addresses;
    const results = await Promise.all(
      addresses.map(async (address) => {
        try {
          const result = await searcher.geocode(address);
          return { address, ...result };
        } catch (error) {
          return { address, success: false, error: error.message };
        }
      })
    );
    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify({ total: addresses.length, succeeded, failed, results }, null, 2)
        }
      ],
      isError: false
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
    return {
      isError: true,
      content: [{ type: "text", text: `Error batch geocoding: ${errorMessage}` }]
    };
  }
}
var BatchGeocode = {
  NAME: NAME16,
  DESCRIPTION: DESCRIPTION16,
  SCHEMA: SCHEMA16,
  ACTION: ACTION16
};

// src/tools/maps/searchAlongRoute.ts
import { z as z17 } from "zod";
var NAME17 = "maps_search_along_route";
var DESCRIPTION17 = "Search for places along a route between two points \u2014 restaurants, cafes, gas stations, etc. ranked by minimal detour time. Use for trip planning to find meals, rest stops, or attractions between landmarks without backtracking. Internally computes the route, then searches along it. Essential for building itineraries where stops should feel 'on the way' rather than 'detour to'.";
var SCHEMA17 = {
  textQuery: z17.string().describe("What to search for along the route (e.g. 'restaurant', 'coffee shop', 'temple')"),
  origin: z17.string().describe("Route start point \u2014 address or landmark name"),
  destination: z17.string().describe("Route end point \u2014 address or landmark name"),
  mode: z17.enum(["driving", "walking", "bicycling", "transit"]).optional().describe("Travel mode for the route (default: walking)"),
  maxResults: z17.number().optional().describe("Max results to return (default: 5, max: 20)")
};
async function ACTION17(params) {
  try {
    const apiKey = getCurrentApiKey();
    const searcher = new PlacesSearcher(apiKey);
    const result = await searcher.searchAlongRoute(params);
    if (!result.success) {
      return {
        content: [{ type: "text", text: result.error || "Failed to search along route" }],
        isError: true
      };
    }
    return {
      content: [{ type: "text", text: JSON.stringify(result.data, null, 2) }],
      isError: false
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
    return {
      isError: true,
      content: [{ type: "text", text: `Error searching along route: ${errorMessage}` }]
    };
  }
}
var SearchAlongRoute = {
  NAME: NAME17,
  DESCRIPTION: DESCRIPTION17,
  SCHEMA: SCHEMA17,
  ACTION: ACTION17
};

// src/tools/maps/localRankTracker.ts
import { z as z18 } from "zod";
var NAME18 = "maps_local_rank_tracker";
var DESCRIPTION18 = "Track a business's local search ranking across a geographic grid (like LocalFalcon). Searches the same keyword(s) from multiple coordinates around a center point to see how rank varies by location. Supports up to 3 keywords for batch scanning. Returns rank at each grid point, top-3 competitors per point, and summary metrics (ARP, ATRP, SoLV). Useful for local SEO analysis.";
var SCHEMA18 = {
  keyword: z18.string().optional().describe("Single search keyword (e.g., 'dentist'). Use 'keywords' for multi-keyword scanning."),
  keywords: z18.array(z18.string()).min(1).max(3).optional().describe(
    "Array of 1-3 keywords to scan (e.g., ['dentist', 'dental clinic', 'teeth cleaning']). Overrides 'keyword'."
  ),
  placeId: z18.string().describe("Google Maps place_id of the target business to track"),
  center: z18.object({
    latitude: z18.number().describe("Center latitude of the grid"),
    longitude: z18.number().describe("Center longitude of the grid")
  }).describe("Center coordinate for the grid (typically the business location)"),
  gridSize: z18.number().int().min(3).max(7).optional().describe("Grid dimension (3 = 3\xD73 = 9 points, 5 = 5\xD75 = 25 points, 7 = 7\xD77 = 49 points). Default: 3"),
  gridSpacing: z18.number().min(100).max(1e4).optional().describe("Distance between grid points in meters (100-10000). Default: 1000")
};
async function ACTION18(params) {
  try {
    const resolvedKeywords = params.keywords || (params.keyword ? [params.keyword] : []);
    if (resolvedKeywords.length === 0) {
      return {
        content: [{ type: "text", text: "Either 'keyword' or 'keywords' must be provided." }],
        isError: true
      };
    }
    const apiKey = getCurrentApiKey();
    const placesSearcher = new PlacesSearcher(apiKey);
    const result = await placesSearcher.localRankTracker({ ...params, keywords: resolvedKeywords });
    if (!result.success) {
      return {
        content: [{ type: "text", text: result.error || "Failed to track local rank" }],
        isError: true
      };
    }
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(result.data, null, 2)
        }
      ],
      isError: false
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : JSON.stringify(error);
    return {
      isError: true,
      content: [{ type: "text", text: `Error tracking local rank: ${errorMessage}` }]
    };
  }
}
var LocalRankTracker = {
  NAME: NAME18,
  DESCRIPTION: DESCRIPTION18,
  SCHEMA: SCHEMA18,
  ACTION: ACTION18
};

// src/config.ts
var MAPS_TOOL_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true
};
var serverConfigs = [
  {
    name: "MCP-Server",
    tools: [
      {
        name: SearchNearby.NAME,
        description: SearchNearby.DESCRIPTION,
        schema: SearchNearby.SCHEMA,
        annotations: MAPS_TOOL_ANNOTATIONS,
        action: (params) => SearchNearby.ACTION(params)
      },
      {
        name: PlaceDetails.NAME,
        description: PlaceDetails.DESCRIPTION,
        schema: PlaceDetails.SCHEMA,
        annotations: MAPS_TOOL_ANNOTATIONS,
        action: (params) => PlaceDetails.ACTION(params)
      },
      {
        name: Geocode.NAME,
        description: Geocode.DESCRIPTION,
        schema: Geocode.SCHEMA,
        annotations: MAPS_TOOL_ANNOTATIONS,
        action: (params) => Geocode.ACTION(params)
      },
      {
        name: ReverseGeocode.NAME,
        description: ReverseGeocode.DESCRIPTION,
        schema: ReverseGeocode.SCHEMA,
        annotations: MAPS_TOOL_ANNOTATIONS,
        action: (params) => ReverseGeocode.ACTION(params)
      },
      {
        name: DistanceMatrix.NAME,
        description: DistanceMatrix.DESCRIPTION,
        schema: DistanceMatrix.SCHEMA,
        annotations: MAPS_TOOL_ANNOTATIONS,
        action: (params) => DistanceMatrix.ACTION(params)
      },
      {
        name: Directions.NAME,
        description: Directions.DESCRIPTION,
        schema: Directions.SCHEMA,
        annotations: MAPS_TOOL_ANNOTATIONS,
        action: (params) => Directions.ACTION(params)
      },
      {
        name: Elevation.NAME,
        description: Elevation.DESCRIPTION,
        schema: Elevation.SCHEMA,
        annotations: MAPS_TOOL_ANNOTATIONS,
        action: (params) => Elevation.ACTION(params)
      },
      {
        name: SearchPlaces.NAME,
        description: SearchPlaces.DESCRIPTION,
        schema: SearchPlaces.SCHEMA,
        annotations: MAPS_TOOL_ANNOTATIONS,
        action: (params) => SearchPlaces.ACTION(params)
      },
      {
        name: Timezone.NAME,
        description: Timezone.DESCRIPTION,
        schema: Timezone.SCHEMA,
        annotations: MAPS_TOOL_ANNOTATIONS,
        action: (params) => Timezone.ACTION(params)
      },
      {
        name: Weather.NAME,
        description: Weather.DESCRIPTION,
        schema: Weather.SCHEMA,
        annotations: MAPS_TOOL_ANNOTATIONS,
        action: (params) => Weather.ACTION(params)
      },
      {
        name: ExploreArea.NAME,
        description: ExploreArea.DESCRIPTION,
        schema: ExploreArea.SCHEMA,
        annotations: MAPS_TOOL_ANNOTATIONS,
        action: (params) => ExploreArea.ACTION(params)
      },
      {
        name: PlanRoute.NAME,
        description: PlanRoute.DESCRIPTION,
        schema: PlanRoute.SCHEMA,
        annotations: MAPS_TOOL_ANNOTATIONS,
        action: (params) => PlanRoute.ACTION(params)
      },
      {
        name: ComparePlaces.NAME,
        description: ComparePlaces.DESCRIPTION,
        schema: ComparePlaces.SCHEMA,
        annotations: MAPS_TOOL_ANNOTATIONS,
        action: (params) => ComparePlaces.ACTION(params)
      },
      {
        name: AirQuality.NAME,
        description: AirQuality.DESCRIPTION,
        schema: AirQuality.SCHEMA,
        annotations: MAPS_TOOL_ANNOTATIONS,
        action: (params) => AirQuality.ACTION(params)
      },
      {
        name: StaticMap.NAME,
        description: StaticMap.DESCRIPTION,
        schema: StaticMap.SCHEMA,
        annotations: MAPS_TOOL_ANNOTATIONS,
        action: (params) => StaticMap.ACTION(params)
      },
      {
        name: BatchGeocode.NAME,
        description: BatchGeocode.DESCRIPTION,
        schema: BatchGeocode.SCHEMA,
        annotations: MAPS_TOOL_ANNOTATIONS,
        action: (params) => BatchGeocode.ACTION(params)
      },
      {
        name: SearchAlongRoute.NAME,
        description: SearchAlongRoute.DESCRIPTION,
        schema: SearchAlongRoute.SCHEMA,
        annotations: MAPS_TOOL_ANNOTATIONS,
        action: (params) => SearchAlongRoute.ACTION(params)
      },
      {
        name: LocalRankTracker.NAME,
        description: LocalRankTracker.DESCRIPTION,
        schema: LocalRankTracker.SCHEMA,
        annotations: MAPS_TOOL_ANNOTATIONS,
        action: (params) => LocalRankTracker.ACTION(params)
      }
    ]
  }
];
function filterTools(tools, raw = loadCliSettings().enabledTools) {
  const resolution = resolveEnabledToolNames(
    tools.map((tool) => tool.name),
    raw
  );
  if (resolution.fallback) {
    Logger.error(`enabledTools matched 0 tools. Available: ${tools.map((t) => t.name).join(", ")}`);
    return tools;
  }
  if (resolution.matched !== tools.length) {
    Logger.log(`enabledTools: ${resolution.matched}/${tools.length} tools active`);
  }
  const enabled = new Set(resolution.names);
  return tools.filter((tool) => enabled.has(tool.name));
}
var config_default = serverConfigs;

// src/core/BaseMcpServer.ts
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import express from "express";
import { randomUUID } from "crypto";
import { z as z19 } from "zod";
var VERSION = "0.0.1";
var BaseMcpServer = class {
  constructor(name, tools) {
    this.sessions = {};
    this.httpServer = null;
    this.serverName = name;
    this.tools = tools;
    this.server = this.createMcpServer();
  }
  createMcpServer() {
    const server = new McpServer(
      { name: this.serverName, version: VERSION },
      { capabilities: { logging: {}, tools: {} } }
    );
    this.tools.forEach((tool) => {
      server.registerTool(
        tool.name,
        {
          description: tool.description,
          inputSchema: z19.object(tool.schema),
          annotations: tool.annotations
        },
        async (params) => tool.action(params)
      );
    });
    return server;
  }
  async connect(transport) {
    await this.server.connect(transport);
    const originalStdoutWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = (chunk, encoding, callback) => {
      if (typeof chunk === "string" && !chunk.startsWith("{")) {
        return true;
      }
      return originalStdoutWrite(chunk, encoding, callback);
    };
    Logger.log(`${this.serverName} connected and ready to process requests`);
  }
  /**
   * @brief Starts the Streamable HTTP listener and resolves once it is accepting connections.
   * @details Builds the Express app with the `/mcp` POST/GET/DELETE handlers,
   * then wraps `app.listen` in a Promise that resolves from the listen callback
   * and rejects on the server `error` event (e.g. EADDRINUSE), so callers get
   * a reliable startup outcome instead of an unhandled error. Default host is
   * loopback `127.0.0.1` (REQ-008); pass `0.0.0.0` to bind all interfaces.
   * @param port {number} TCP port to listen on (1-65535).
   * @param host {string} Bind address; defaults to `127.0.0.1`.
   * @return {Promise<void>} Resolves when listening; rejects with the listen error.
   * @throws {Error} Rejects when the HTTP listener emits an error (port in use, permission denied).
   * @satisfies REQ-008, REQ-095
   */
  async startHttpServer(port, host = "127.0.0.1") {
    const app = express();
    app.use(express.json());
    app.post("/mcp", async (req, res) => {
      const sessionId = req.headers["mcp-session-id"];
      let context;
      const apiKeyManager = ApiKeyManager.getInstance();
      const requestApiKey = apiKeyManager.getApiKey(req, sessionId ? this.sessions[sessionId]?.apiKey : void 0);
      Logger.log(`${this.serverName} API key received from request context`);
      if (sessionId && this.sessions[sessionId]) {
        context = this.sessions[sessionId];
        if (requestApiKey) {
          context.apiKey = requestApiKey;
        }
      } else if (!sessionId && isInitializeRequest(req.body)) {
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => randomUUID(),
          onsessioninitialized: (sessionId2) => {
            this.sessions[sessionId2] = context;
            Logger.log(`[${this.serverName}] New session initialized: ${sessionId2}`);
          }
          // DNS rebinding protection is disabled by default for backwards compatibility
          // For production use, enable this:
          // enableDnsRebindingProtection: true,
          // allowedHosts: ['127.0.0.1'],
        });
        context = {
          transport,
          apiKey: requestApiKey
        };
        transport.onclose = () => {
          if (transport.sessionId) {
            delete this.sessions[transport.sessionId];
            Logger.log(`[${this.serverName}] Session closed: ${transport.sessionId}`);
          }
        };
        const sessionServer = this.createMcpServer();
        await sessionServer.connect(transport);
      } else {
        res.status(400).json({
          jsonrpc: "2.0",
          error: {
            code: -32e3,
            message: "Bad Request: No valid session ID provided"
          },
          id: null
        });
        return;
      }
      await runWithContext({ apiKey: context.apiKey, sessionId }, async () => {
        await context.transport.handleRequest(req, res, req.body);
      });
    });
    const handleSessionRequest = async (req, res) => {
      const sessionId = req.headers["mcp-session-id"];
      if (!sessionId || !this.sessions[sessionId]) {
        res.status(400).send("Invalid or missing session ID");
        return;
      }
      const context = this.sessions[sessionId];
      const apiKeyManager = ApiKeyManager.getInstance();
      const requestApiKey = apiKeyManager.getApiKey(req, context.apiKey);
      if (requestApiKey) {
        context.apiKey = requestApiKey;
      }
      await runWithContext({ apiKey: context.apiKey, sessionId }, async () => {
        await context.transport.handleRequest(req, res);
      });
    };
    app.get("/mcp", handleSessionRequest);
    app.delete("/mcp", handleSessionRequest);
    const displayHost = host === "0.0.0.0" ? "localhost" : host;
    await new Promise((resolve6, reject) => {
      this.httpServer = app.listen(port, host, () => {
        Logger.log(`[${this.serverName}] HTTP server listening on ${host}:${port}`);
        Logger.log(`[${this.serverName}] MCP endpoint available at http://${displayHost}:${port}/mcp`);
        resolve6();
      });
      this.httpServer.on("error", (error) => reject(error));
    });
  }
  async startStdio() {
    const transport = new StdioServerTransport();
    await this.connect(transport);
  }
  /**
   * @brief Stops the HTTP listener and closes every session transport in order.
   * @details Idempotent: when no listener exists it logs and resolves. Otherwise
   * it detaches the server reference, clears the session map, awaits
   * `transport.close()` for every session (errors tolerated via allSettled),
   * calls `closeAllConnections` when available, and finally closes the socket.
   * Wired to SIGINT/SIGTERM through `installShutdownHandlers` (REQ-096).
   * @return {Promise<void>} Resolves after the socket closes; rejects when `server.close` errors.
   * @throws {Error} Rejects with the `server.close` error.
   * @satisfies REQ-096
   */
  async stopHttpServer() {
    const server = this.httpServer;
    if (!server) {
      Logger.error(`[${this.serverName}] HTTP server is not running or already stopped.`);
      return;
    }
    this.httpServer = null;
    const closingSessions = Object.values(this.sessions);
    this.sessions = {};
    await Promise.allSettled(closingSessions.map((context) => context.transport.close()));
    if (closingSessions.length > 0) {
      Logger.log(`[${this.serverName}] All transports closed.`);
    }
    return new Promise((resolve6, reject) => {
      server.closeAllConnections?.();
      server.close((err) => {
        if (err) {
          Logger.error(`[${this.serverName}] Error stopping HTTP server:`, err);
          reject(err);
          return;
        }
        Logger.log(`[${this.serverName}] HTTP server stopped.`);
        resolve6();
      });
    });
  }
};

// src/cli.ts
import { fileURLToPath } from "url";
import { dirname as dirname3, resolve as resolve5 } from "path";
import { readFileSync as readFileSync6, writeFileSync as writeFileSync4, existsSync as existsSync4, realpathSync } from "fs";
import { createInterface } from "readline";

// src/utils/upgradeManager.ts
import { spawnSync } from "child_process";
import { mkdirSync as mkdirSync3, readFileSync as readFileSync3, writeFileSync as writeFileSync3 } from "fs";
import { homedir } from "os";
import { dirname, join as join3 } from "path";

// src/utils/autoUpdate.ts
var AUTO_UPDATE_DISABLED_ENV = "MCP_AUTO_UPDATE_DISABLED";
var DEFAULT_PACKAGE_NAME = "mcp-google-api";
var DEFAULT_REGISTRY_BASE_URL = "https://registry.npmjs.org";
var DEFAULT_UPDATE_CHECK_TIMEOUT_MS = 2e3;
var DEFAULT_PACKUMENT_ACCEPT_HEADER = "application/vnd.npm.install-v1+json";
async function probeLatestVersion(deps = {}) {
  const env = deps.env;
  if (env !== void 0 && isAutoUpdateDisabled(env)) {
    return { status: "disabled" };
  }
  const currentVersion = deps.currentVersion;
  if (!currentVersion) {
    return { status: "unknown-version" };
  }
  const packageName = deps.packageName ?? DEFAULT_PACKAGE_NAME;
  const registryBaseUrl = deps.registryBaseUrl ?? DEFAULT_REGISTRY_BASE_URL;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_UPDATE_CHECK_TIMEOUT_MS;
  const fetchImpl = deps.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(`${registryBaseUrl}/${packageName}/latest`, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) {
      return {
        status: "error",
        message: `registry responded with HTTP ${response.status}.`
      };
    }
    const payload = await response.json();
    if (typeof payload?.version !== "string") {
      return {
        status: "error",
        message: "registry response has no version field."
      };
    }
    if (!isNewerVersion(payload.version, currentVersion)) {
      return { status: "current", currentVersion };
    }
    return { status: "newer", currentVersion, latestVersion: payload.version };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: "error", message };
  }
}
async function probeLatestManifestVersion(deps = {}) {
  const env = deps.env;
  if (env !== void 0 && isAutoUpdateDisabled(env)) {
    return { status: "disabled" };
  }
  const currentVersion = deps.currentVersion;
  if (!currentVersion) {
    return { status: "unknown-version" };
  }
  const packageName = deps.packageName ?? DEFAULT_PACKAGE_NAME;
  const registryBaseUrl = deps.registryBaseUrl ?? DEFAULT_REGISTRY_BASE_URL;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_UPDATE_CHECK_TIMEOUT_MS;
  const fetchImpl = deps.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(`${registryBaseUrl}/${packageName}`, {
      headers: { accept: DEFAULT_PACKUMENT_ACCEPT_HEADER },
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) {
      return {
        status: "error",
        message: `registry manifest responded with HTTP ${response.status}.`
      };
    }
    const payload = await response.json();
    const distTags = payload?.["dist-tags"];
    const latest = distTags !== null && typeof distTags === "object" ? distTags.latest : void 0;
    if (typeof latest !== "string" || latest.trim() === "") {
      return {
        status: "error",
        message: "registry manifest has no dist-tags.latest field."
      };
    }
    if (!isNewerVersion(latest, currentVersion)) {
      return { status: "current", currentVersion };
    }
    return { status: "newer", currentVersion, latestVersion: latest };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: "error", message };
  }
}
function isAutoUpdateDisabled(env = process.env) {
  const raw = env[AUTO_UPDATE_DISABLED_ENV];
  return typeof raw === "string" && /^(1|true|yes)$/i.test(raw.trim());
}
function isNewerVersion(candidate, current) {
  const toSegments = (version) => version.trim().split(".").map((segment) => /^\d+$/.test(segment) ? Number(segment) : Number.NaN);
  const candidateSegments = toSegments(candidate);
  const currentSegments = toSegments(current);
  if (candidateSegments.some((segment) => !Number.isInteger(segment)) || currentSegments.some((segment) => !Number.isInteger(segment))) {
    return false;
  }
  const length = Math.max(candidateSegments.length, currentSegments.length);
  for (let index = 0; index < length; index += 1) {
    const candidatePart = candidateSegments[index] ?? 0;
    const currentPart = currentSegments[index] ?? 0;
    if (candidatePart !== currentPart) {
      return candidatePart > currentPart;
    }
  }
  return false;
}
var DEFAULT_GITHUB_RELEASES_API_URL = "https://api.github.com/repos/Ogekuri/mcp-google-api/releases/latest";
function stripReleaseTagPrefix(tag) {
  return tag.trim().replace(/^v/i, "");
}
async function readGitHubErrorDetail(response) {
  try {
    const payload = await response.json();
    const detail = typeof payload?.message === "string" ? payload.message.trim() : "";
    return detail.length > 0 ? detail : void 0;
  } catch {
    return void 0;
  }
}
async function probeLatestGitHubVersion(deps = {}) {
  const releasesUrl = deps.releasesUrl ?? DEFAULT_GITHUB_RELEASES_API_URL;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_UPDATE_CHECK_TIMEOUT_MS;
  const fetchImpl = deps.fetchImpl ?? fetch;
  try {
    const response = await fetchImpl(releasesUrl, {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": DEFAULT_PACKAGE_NAME
      },
      signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) {
      const detail = await readGitHubErrorDetail(response);
      const cause = detail ? `: ${detail.replace(/\.+$/, "")}` : "";
      return {
        status: "error",
        message: `GitHub releases API responded with HTTP ${response.status}${cause}.`
      };
    }
    const payload = await response.json();
    if (typeof payload?.tag_name !== "string") {
      return {
        status: "error",
        message: "GitHub releases response has no tag_name field."
      };
    }
    const version = stripReleaseTagPrefix(payload.tag_name);
    if (!version) {
      return { status: "error", message: "GitHub release tag carries no version." };
    }
    return { status: "ok", version, tag: payload.tag_name };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { status: "error", message };
  }
}

// src/utils/upgradeManager.ts
var ANSI_GREEN = "\x1B[92m";
var ANSI_RED = "\x1B[91m";
var ANSI_RESET = "\x1B[0m";
var green = (text) => `${ANSI_GREEN}${text}${ANSI_RESET}`;
var red = (text) => `${ANSI_RED}${text}${ANSI_RESET}`;
var IDLE_CACHE_DIR_NAME = "mcp-google-api";
var IDLE_CACHE_FILE_NAME = "check_version_idle-time.json";
var IDLE_WINDOW_NEWER_MS = 60 * 60 * 1e3;
var IDLE_WINDOW_DEFAULT_MS = 24 * 60 * 60 * 1e3;
var PACKAGE_UPGRADE_COMMAND = [
  "npm",
  "install",
  "-g",
  `${DEFAULT_PACKAGE_NAME}@latest`
];
var UPGRADE_FORCE_OPTION = "--force";
var GITHUB_UPGRADE_REPOSITORY = "Ogekuri/mcp-google-api";
function buildDevelopUpgradeCommand(tag, force = false) {
  const command = ["npm", "install", "-g", `github:${GITHUB_UPGRADE_REPOSITORY}#${tag}`];
  return force ? [...command, UPGRADE_FORCE_OPTION] : command;
}
var PACKAGE_UNINSTALL_COMMAND = [
  "npm",
  "uninstall",
  "-g",
  DEFAULT_PACKAGE_NAME
];
var POST_UPGRADE_INSTALL_COMMAND = [
  DEFAULT_PACKAGE_NAME,
  "install"
];
function resolveIdleCachePath(home) {
  return join3(home ?? homedir(), ".cache", IDLE_CACHE_DIR_NAME, IDLE_CACHE_FILE_NAME);
}
function loadIdleCache(cachePath, fs = {}) {
  try {
    const readFile = fs.readFile ?? ((path) => readFileSync3(path, "utf-8"));
    const raw = readFile(cachePath);
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      return {};
    }
    const record = parsed;
    const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);
    return {
      last_success_epoch: isFiniteNumber(record.last_success_epoch) ? record.last_success_epoch : void 0,
      last_success_human: typeof record.last_success_human === "string" ? record.last_success_human : void 0,
      idle_time_epoch: isFiniteNumber(record.idle_time_epoch) ? record.idle_time_epoch : void 0,
      idle_time_human: typeof record.idle_time_human === "string" ? record.idle_time_human : void 0
    };
  } catch {
    return {};
  }
}
function persistIdleCache(cachePath, lastSuccess, idleUntil, fs = {}, logger = Logger) {
  const toIso = (epoch) => epoch === void 0 ? null : new Date(epoch).toISOString();
  const data = {
    last_success_epoch: lastSuccess ?? null,
    last_success_human: toIso(lastSuccess),
    idle_time_epoch: idleUntil,
    idle_time_human: toIso(idleUntil)
  };
  try {
    const mkdir = fs.mkdir ?? ((path) => mkdirSync3(path, { recursive: true }));
    const writeFile = fs.writeFile ?? ((path, data2) => writeFileSync3(path, data2));
    mkdir(dirname(cachePath));
    writeFile(cachePath, JSON.stringify(data, null, 2) + "\n");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(red(`Version cache error: ${message}`));
  }
}
async function checkVersionIdle(deps = {}) {
  const logger = deps.logger ?? Logger;
  const now = deps.now ?? (() => Date.now());
  const cachePath = deps.cachePath ?? resolveIdleCachePath();
  const cache = loadIdleCache(cachePath, deps.fs);
  if (deps.force !== true) {
    const idle = cache.idle_time_epoch;
    if (typeof idle === "number" && idle > now()) {
      return { checked: false, status: "idle" };
    }
  }
  const probe = await probeLatestVersion(deps);
  if (probe.status === "disabled") {
    return { checked: false, status: "disabled" };
  }
  let delayMs = IDLE_WINDOW_DEFAULT_MS;
  let lastSuccess = typeof cache.last_success_epoch === "number" ? cache.last_success_epoch : void 0;
  const result = { checked: true, status: probe.status };
  switch (probe.status) {
    case "unknown-version":
      logger.error(red("Version check error: running package version is unknown."));
      break;
    case "error":
      logger.error(red(`Version check error: ${probe.message}`));
      break;
    case "current":
      lastSuccess = now();
      result.currentVersion = probe.currentVersion;
      break;
    case "newer": {
      lastSuccess = now();
      delayMs = IDLE_WINDOW_NEWER_MS;
      result.currentVersion = probe.currentVersion;
      result.latestVersion = probe.latestVersion;
      logger.log(
        green(
          `Available Version: ${probe.latestVersion} | Installed Version: ${probe.currentVersion}`
        )
      );
      logger.log(
        green(
          `Upgrade with: npm install -g ${DEFAULT_PACKAGE_NAME}@latest (or run: ${DEFAULT_PACKAGE_NAME} --upgrade)`
        )
      );
      break;
    }
  }
  const finishedAt = now();
  const idleUntil = finishedAt + delayMs;
  persistIdleCache(cachePath, lastSuccess, idleUntil, deps.fs, logger);
  result.idleUntilEpoch = idleUntil;
  result.lastSuccessEpoch = lastSuccess;
  return result;
}
function parseManagementCommand(args) {
  const upgradeCount = args.filter((arg) => arg === "--upgrade").length;
  if (upgradeCount === 0) {
    if (args.length === 1) {
      const arg = args[0];
      if (arg === "--ver" || arg === "--version" || arg === "--uninstall") {
        return arg;
      }
    }
    return void 0;
  }
  if (upgradeCount !== 1) {
    return void 0;
  }
  const optionTokens = args.filter(
    (arg) => arg === "--develop" || arg === "--dev" || arg === UPGRADE_FORCE_OPTION
  );
  if (args.length !== optionTokens.length + 1) {
    return void 0;
  }
  const channelCount = optionTokens.filter(
    (arg) => arg === "--develop" || arg === "--dev"
  ).length;
  const forceCount = optionTokens.filter((arg) => arg === UPGRADE_FORCE_OPTION).length;
  if (channelCount > 1 || forceCount > 1) {
    return void 0;
  }
  return "--upgrade";
}
function parseUpgradeChannel(args) {
  return args.includes("--develop") || args.includes("--dev") ? "develop" : "npm";
}
function parseUpgradeForce(args) {
  return args.includes(UPGRADE_FORCE_OPTION);
}
function runPackageManagerCommand(command, deps = {}) {
  const logger = deps.logger ?? Logger;
  const spawnImpl = deps.spawn ?? spawnSync;
  const reportSpawnFailure = (message) => {
    logger.error(`Error executing ${command[0]}: ${message}`);
    logger.log(`Warning: run this command manually: ${command.join(" ")}`);
    return 1;
  };
  try {
    const result = spawnImpl(command[0], [...command.slice(1)], {
      cwd: homedir(),
      stdio: "inherit",
      shell: process.platform === "win32"
    });
    if (result.error) {
      return reportSpawnFailure(result.error.message);
    }
    return result.status ?? 1;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return reportSpawnFailure(message);
  }
}
var REIFY_ENOENT_SIGNATURE = /\bENOENT\b/;
function toStreamText(value) {
  return typeof value === "string" ? value : value?.toString("utf8") ?? "";
}
function runCapturedPackageManagerCommand(command, deps) {
  const logger = deps.logger ?? Logger;
  const spawnImpl = deps.spawn ?? spawnSync;
  const reportSpawnFailure = (message) => {
    logger.error(`Error executing ${command[0]}: ${message}`);
    logger.log(`Warning: run this command manually: ${command.join(" ")}`);
    return { code: 1, stderr: "" };
  };
  try {
    const result = spawnImpl(command[0], [...command.slice(1)], {
      cwd: homedir(),
      stdio: ["inherit", "pipe", "pipe"],
      shell: process.platform === "win32",
      maxBuffer: 16 * 1024 * 1024
    });
    if (result.error) {
      return reportSpawnFailure(result.error.message);
    }
    const stdoutText = toStreamText(result.stdout).replace(/\n+$/, "");
    const stderrText = toStreamText(result.stderr).replace(/\n+$/, "");
    if (stdoutText.length > 0) {
      logger.log(stdoutText);
    }
    if (stderrText.length > 0) {
      logger.error(stderrText);
    }
    return { code: result.status ?? 1, stderr: toStreamText(result.stderr) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return reportSpawnFailure(message);
  }
}
function runPackageUpdateCommand(command, deps) {
  const first = runCapturedPackageManagerCommand(command, deps);
  if (first.code === 0 || !REIFY_ENOENT_SIGNATURE.test(first.stderr)) {
    return first.code;
  }
  runPackageManagerCommand(PACKAGE_UNINSTALL_COMMAND, deps);
  return runCapturedPackageManagerCommand(command, deps).code;
}
function parsePostUpgradeCliOutcomes(raw) {
  if (raw === void 0 || !raw.includes("install report:")) {
    return void 0;
  }
  const lines = raw.split(/\r?\n/);
  const cliLine = /^\s{2,}([a-z][a-z0-9-]*):\s+/;
  const outcomes = [];
  for (const line of lines) {
    const match = cliLine.exec(line);
    if (match) {
      outcomes.push({ cli: match[1], ok: true });
    }
  }
  if (outcomes.length === 0) {
    return void 0;
  }
  const errorBlockIndex = lines.findIndex((line) => line.trim() === "Errors:");
  const errorTexts = errorBlockIndex >= 0 ? lines.slice(errorBlockIndex + 1).filter((line) => line.trim().length > 0) : [];
  for (const outcome of outcomes) {
    const lowered = outcome.cli.toLowerCase();
    if (errorTexts.some((text) => text.toLowerCase().includes(lowered))) {
      outcome.ok = false;
    }
  }
  return outcomes;
}
function runPostUpgradeSkillInstall(options, deps = {}) {
  const enabled = loadCliSettings(options.home).enabled;
  if (enabled.length === 0) {
    return { exitCode: 0, clis: [] };
  }
  const logger = deps.logger ?? Logger;
  const spawnImpl = deps.spawn ?? spawnSync;
  const reportSpawnFailure = (message) => {
    logger.error(`Error executing ${POST_UPGRADE_INSTALL_COMMAND[0]}: ${message}`);
    logger.log(`Warning: run this command manually: ${POST_UPGRADE_INSTALL_COMMAND.join(" ")}`);
    return { exitCode: 1, clis: enabled.map((cli) => ({ cli, ok: false })) };
  };
  try {
    const result = spawnImpl(
      POST_UPGRADE_INSTALL_COMMAND[0],
      [...POST_UPGRADE_INSTALL_COMMAND.slice(1)],
      {
        stdio: ["ignore", "pipe", "inherit"],
        shell: process.platform === "win32"
      }
    );
    if (result.error) {
      return reportSpawnFailure(result.error.message);
    }
    const exitCode = result.status ?? 1;
    const stdoutText = result.stdout === void 0 ? void 0 : String(result.stdout);
    const clis = parsePostUpgradeCliOutcomes(stdoutText) ?? enabled.map((cli) => ({ cli, ok: exitCode === 0 }));
    return { exitCode, clis };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return reportSpawnFailure(message);
  }
}
function renderUpgradeSummary(previousVersion, updatedVersion, outcome) {
  const lines = [
    `mcp-google-api upgrade completed: ${previousVersion} -> ${updatedVersion}`
  ];
  if (outcome.clis.length === 0) {
    lines.push(
      outcome.exitCode === 0 ? "Post-upgrade install: skipped (no CLI enabled)." : `Post-upgrade install: FAILED (exit code ${outcome.exitCode}).`
    );
    return `${lines.join("\n")}
`;
  }
  lines.push(
    outcome.exitCode === 0 ? "Post-upgrade install: completed successfully on the following CLI(s):" : `Post-upgrade install: FAILED (exit code ${outcome.exitCode}) for the following CLI(s):`
  );
  for (const entry of outcome.clis) {
    const counts = entry.server !== void 0 || entry.skills !== void 0 ? ` (server: ${entry.server ?? 0}, skills: ${entry.skills ?? 0})` : "";
    lines.push(`  - ${entry.cli}: ${entry.ok ? "OK" : "FAILED"}${counts}`);
  }
  return `${lines.join("\n")}
`;
}
function resolveProbeLatestVersion(probe) {
  if (probe.status === "newer") {
    return probe.latestVersion;
  }
  if (probe.status === "current") {
    return probe.currentVersion;
  }
  return "unknown";
}
var VERSION_REPORT_LABEL_WIDTH = 17;
function renderVersionReportLine(label, value) {
  return `${label.padEnd(VERSION_REPORT_LABEL_WIDTH, " ")} : ${value}`;
}
async function resolveUpdatedVersion(options, deps) {
  const probe = await probeLatestVersion({
    ...deps.idleCheck,
    currentVersion: options.currentVersion
  });
  return resolveProbeLatestVersion(probe);
}
async function runVersionCommand(options, deps = {}) {
  const [npmProbe, githubProbe] = await Promise.all([
    probeLatestManifestVersion({ ...deps.idleCheck, currentVersion: options.currentVersion }),
    probeLatestGitHubVersion(deps.githubCheck)
  ]);
  const installedVersion = options.currentVersion || "unknown";
  const npmLatest = resolveProbeLatestVersion(npmProbe);
  const githubLatest = githubProbe.status === "ok" ? githubProbe.version : `unknown (${githubProbe.message})`;
  const stdout = deps.stdout ?? process.stdout;
  stdout.write(
    [
      renderVersionReportLine("Current Installed", installedVersion),
      renderVersionReportLine("Latest @ NPMjs", npmLatest),
      renderVersionReportLine("Latest @ GitHub", githubLatest)
    ].join("\n") + "\n"
  );
  return 0;
}
async function runUpgradeCommand(options, deps = {}) {
  if ((options.channel ?? "npm") === "develop") {
    const githubProbe = await probeLatestGitHubVersion(deps.githubCheck);
    if (githubProbe.status !== "ok") {
      (deps.logger ?? Logger).error(`GitHub upgrade channel probe failed: ${githubProbe.message}`);
      return 1;
    }
    const upgraded2 = runPackageUpdateCommand(
      buildDevelopUpgradeCommand(githubProbe.tag, options.force === true),
      deps
    );
    if (upgraded2 !== 0) {
      return upgraded2;
    }
    const outcome2 = runPostUpgradeSkillInstall(options, deps);
    const stdout2 = deps.stdout ?? process.stdout;
    stdout2.write(renderUpgradeSummary(options.currentVersion, githubProbe.version, outcome2));
    return outcome2.exitCode;
  }
  const updateCommand = options.force === true ? [...PACKAGE_UPGRADE_COMMAND, UPGRADE_FORCE_OPTION] : PACKAGE_UPGRADE_COMMAND;
  const upgraded = runPackageUpdateCommand(updateCommand, deps);
  if (upgraded !== 0) {
    return upgraded;
  }
  const updatedVersion = await resolveUpdatedVersion(options, deps);
  const outcome = runPostUpgradeSkillInstall(options, deps);
  const stdout = deps.stdout ?? process.stdout;
  stdout.write(renderUpgradeSummary(options.currentVersion, updatedVersion, outcome));
  return outcome.exitCode;
}
function runUninstallCommand(deps = {}) {
  return runPackageManagerCommand(PACKAGE_UNINSTALL_COMMAND, deps);
}
async function runManagementCommand(command, options, deps = {}) {
  switch (command) {
    case "--ver":
    case "--version":
      return runVersionCommand(options, deps);
    case "--upgrade":
      return runUpgradeCommand(options, deps);
    case "--uninstall":
      return runUninstallCommand(deps);
  }
}

// src/utils/toolProfiles.ts
var TOOL_API_PROFILES = {
  maps_geocode: { tool: "maps_geocode", apis: ["geocoding"], dependsOnTools: [] },
  maps_reverse_geocode: { tool: "maps_reverse_geocode", apis: ["geocoding"], dependsOnTools: [] },
  maps_batch_geocode: { tool: "maps_batch_geocode", apis: ["geocoding"], dependsOnTools: ["maps_geocode"] },
  maps_search_nearby: {
    tool: "maps_search_nearby",
    apis: ["places-new", "geocoding"],
    dependsOnTools: ["maps_geocode"]
  },
  maps_search_places: { tool: "maps_search_places", apis: ["places-new"], dependsOnTools: [] },
  maps_place_details: { tool: "maps_place_details", apis: ["places-new"], dependsOnTools: [] },
  maps_directions: { tool: "maps_directions", apis: ["routes"], dependsOnTools: [] },
  maps_distance_matrix: { tool: "maps_distance_matrix", apis: ["routes"], dependsOnTools: [] },
  maps_elevation: { tool: "maps_elevation", apis: ["elevation"], dependsOnTools: [] },
  maps_timezone: { tool: "maps_timezone", apis: ["timezone"], dependsOnTools: [] },
  maps_weather: { tool: "maps_weather", apis: ["weather"], dependsOnTools: [] },
  maps_air_quality: { tool: "maps_air_quality", apis: ["air-quality"], dependsOnTools: [] },
  maps_static_map: { tool: "maps_static_map", apis: ["static-maps"], dependsOnTools: [] },
  maps_explore_area: {
    tool: "maps_explore_area",
    apis: ["places-new", "geocoding"],
    dependsOnTools: ["maps_geocode", "maps_search_nearby", "maps_place_details"]
  },
  maps_plan_route: {
    tool: "maps_plan_route",
    apis: ["routes", "geocoding", "places-new"],
    dependsOnTools: ["maps_geocode", "maps_search_places", "maps_directions"]
  },
  maps_compare_places: {
    tool: "maps_compare_places",
    apis: ["places-new", "routes"],
    dependsOnTools: ["maps_search_places", "maps_place_details", "maps_distance_matrix"]
  },
  maps_search_along_route: {
    tool: "maps_search_along_route",
    apis: ["routes", "places-new"],
    dependsOnTools: ["maps_directions", "maps_search_places"]
  },
  maps_local_rank_tracker: {
    tool: "maps_local_rank_tracker",
    apis: ["places-new"],
    dependsOnTools: ["maps_place_details", "maps_search_places"]
  }
};
function describeToolsProfile(toolNames) {
  const tools = [];
  const apiOrder = [];
  const seenApis = /* @__PURE__ */ new Set();
  const seenTools = /* @__PURE__ */ new Set();
  for (const name of toolNames) {
    if (seenTools.has(name)) {
      continue;
    }
    const profile = TOOL_API_PROFILES[name];
    if (!profile) {
      continue;
    }
    seenTools.add(name);
    tools.push({
      tool: profile.tool,
      apis: [...profile.apis],
      dependsOnTools: [...profile.dependsOnTools]
    });
    for (const api of profile.apis) {
      if (!seenApis.has(api)) {
        seenApis.add(api);
        apiOrder.push(api);
      }
    }
  }
  return { toolCount: tools.length, apis: apiOrder, tools };
}

// src/utils/clientSnippets.ts
var SNIPPET_DEFAULT_HOST = "127.0.0.1";
var SNIPPET_DEFAULT_PORT = 3e3;
var SNIPPET_CLIENT_TARGETS = {
  generic: "your MCP client configuration file",
  claude: "Claude Desktop: claude_desktop_config.json",
  cursor: "Cursor: .cursor/mcp.json",
  pi: "pi CLI: ~/.pi/agent/mcp.json (user) or .pi/mcp.json (project)"
};
function renderClientSnippet(options = {}) {
  const client = options.client ?? "generic";
  const transport = options.transport ?? "stdio";
  const serverName = options.serverName ?? "mcp-google-api";
  const notes = [`Paste this snippet into ${SNIPPET_CLIENT_TARGETS[client]}.`];
  notes.push("This command prints the snippet only; it never writes or edits configuration files.");
  let entry;
  if (transport === "http") {
    const host = options.host ?? SNIPPET_DEFAULT_HOST;
    const port = options.port ?? SNIPPET_DEFAULT_PORT;
    entry = { url: `http://${host}:${port}/mcp` };
    notes.push(`Start the server first: mcp-google-api start --host ${host} --port ${port}.`);
  } else {
    const launcher = options.launcher ?? "npx";
    if (launcher === "node" && !options.commandPath) {
      throw new Error("--launcher node requires --command <path> pointing at dist/cli.js");
    }
    const command = launcher === "npx" ? "npx" : launcher === "bin" ? "mcp-google-api" : "node";
    const args = launcher === "npx" ? ["-y", "mcp-google-api", "start", "--stdio"] : launcher === "bin" ? ["start", "--stdio"] : [options.commandPath, "start", "--stdio"];
    if (launcher === "npx") {
      notes.push("The npx launcher runs the published package; npm must be available on PATH.");
    }
    entry = { command, args };
    notes.push("The registration carries no API key: configure it once with 'mcp-google-api api-key <key>'.");
  }
  const json = JSON.stringify({ mcpServers: { [serverName]: entry } }, null, 2);
  return { json, notes };
}

// src/utils/cliInstaller.ts
import { existsSync as existsSync3, readFileSync as readFileSync4 } from "fs";
import { dirname as dirname2, join as join4, resolve as resolve3 } from "path";
function buildServerRegistration() {
  return { command: "npx", args: ["-y", MCP_SERVER_NAME, "start", "--stdio"] };
}
function resolveSkillsResourcesRoot(packageRoot) {
  const candidate = resolve3(packageRoot, "src", "resources", "skills");
  if (!existsSync3(candidate)) {
    throw new Error(`skills resources root not found: ${candidate}`);
  }
  return candidate;
}
function loadSkillsManifest(resourcesRoot) {
  const manifestPath = join4(resourcesRoot, "manifest.json");
  if (!existsSync3(manifestPath)) {
    throw new Error(`skills manifest not found: ${manifestPath}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync4(manifestPath, "utf-8"));
  } catch (error) {
    throw new Error(`skills manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const skills = parsed?.skills;
  if (!Array.isArray(skills)) {
    throw new Error(`skills manifest has no skills array: ${manifestPath}`);
  }
  return skills.map((entry) => {
    const skill = entry;
    if (typeof skill.id !== "string" || typeof skill.path !== "string") {
      throw new Error(`skills manifest entry is missing id or path: ${manifestPath}`);
    }
    const skillFile = join4(resourcesRoot, skill.path);
    if (!existsSync3(skillFile)) {
      throw new Error(`manifest skill file not found: ${skillFile}`);
    }
    if (skill.debug !== void 0 && (typeof skill.debug !== "string" || skill.debug.trim() === "")) {
      throw new Error(`manifest skill debug path is invalid: ${manifestPath}`);
    }
    const debugPath = typeof skill.debug === "string" ? skill.debug : void 0;
    if (debugPath !== void 0 && !existsSync3(join4(dirname2(resolve3(skillFile)), debugPath))) {
      throw new Error(`manifest skill debug file not found: ${join4(dirname2(resolve3(skillFile)), debugPath)}`);
    }
    return {
      id: skill.id,
      name: skill.name ?? skill.id,
      version: skill.version ?? "",
      path: skill.path,
      description: skill.description ?? "",
      ...debugPath === void 0 ? {} : { debugPath }
    };
  });
}
function resolveSkillContentLayout(skill, includeDebug) {
  return {
    ...skill.debugPath === void 0 ? {} : { debugPath: skill.debugPath },
    includeDebug: includeDebug && skill.debugPath !== void 0
  };
}
function installEnabledCliResources(options) {
  const manifest = loadSkillsManifest(options.resourcesRoot);
  const entry = buildServerRegistration();
  const result = { summaries: [], errors: [] };
  for (const cli of loadCliSettings(options.home).enabled) {
    const target = CLI_TARGETS[cli];
    if (target === void 0) {
      result.errors.push(`Unsupported CLI: ${cli}`);
      continue;
    }
    try {
      applyServerRegistration(target, MCP_SERVER_NAME, entry, options.home);
      let skills = 0;
      for (const skill of manifest) {
        syncSkillTree(
          join4(options.resourcesRoot, skill.id),
          join4(target.skillsDir(options.home), skill.id),
          resolveSkillContentLayout(skill, options.includeDebugSkills === true)
        );
        skills += 1;
      }
      result.summaries.push({ cli: target.id, server: 1, skills });
    } catch (error) {
      result.errors.push(`${target.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return result;
}
function uninstallEnabledCliResources(options) {
  const manifest = loadSkillsManifest(options.resourcesRoot);
  const result = { summaries: [], errors: [] };
  for (const cli of loadCliSettings(options.home).enabled) {
    const target = CLI_TARGETS[cli];
    if (target === void 0) {
      result.errors.push(`Unsupported CLI: ${cli}`);
      continue;
    }
    try {
      applyServerRegistration(target, MCP_SERVER_NAME, void 0, options.home);
      let skills = 0;
      for (const skill of manifest) {
        removeSkillDir(join4(target.skillsDir(options.home), skill.id));
        skills += 1;
      }
      result.summaries.push({ cli: target.id, server: 0, skills });
    } catch (error) {
      result.errors.push(`${target.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return result;
}

// src/utils/cliShow.ts
import { join as join5 } from "path";
import { relative as relative2, resolve as resolve4 } from "path";
var MAX_CELL_WIDTH = 48;
var STATUS_OK = "OK";
var STATUS_MISSING = "MISSING";
function wrapCell(text, width) {
  const normalized = String(text).split(/\s+/).filter((word) => word.length > 0);
  if (normalized.length === 0) return [""];
  const lines = [];
  let current = "";
  for (let word of normalized) {
    while (word.length > width) {
      if (current.length > 0) {
        lines.push(current);
        current = "";
      }
      lines.push(word.slice(0, width));
      word = word.slice(width);
    }
    if (current.length === 0) {
      current = word;
    } else if (current.length + 1 + word.length <= width) {
      current = `${current} ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current.length > 0) lines.push(current);
  return lines.length > 0 ? lines : [""];
}
function renderAsciiTable(headers, rows, maxWidth = MAX_CELL_WIDTH) {
  const widths = headers.map((header, index) => {
    const lengths = [header.length, ...rows.map((row) => (row[index] ?? "").length)];
    return Math.max(1, Math.min(Math.max(...lengths), Math.max(1, maxWidth)));
  });
  const borderLine = (left, middle, right) => left + widths.map((width) => "\u2500".repeat(width + 2)).join(middle) + right;
  const renderRow = (cells) => {
    const wrapped = cells.map((cell, index) => wrapCell(cell ?? "", widths[index]));
    const height = Math.max(...wrapped.map((part) => part.length));
    const lines = [];
    for (let line = 0; line < height; line += 1) {
      const parts = wrapped.map((part, index) => (part[line] ?? "").padEnd(widths[index]));
      lines.push("\u2502 " + parts.join(" \u2502 ") + " \u2502");
    }
    return lines;
  };
  const output = [borderLine("\u250C", "\u252C", "\u2510"), ...renderRow(headers), borderLine("\u251C", "\u253C", "\u2524")];
  for (const row of rows) {
    output.push(...renderRow(row));
  }
  output.push(borderLine("\u2514", "\u2534", "\u2518"));
  return output.join("\n");
}
function buildCliRows(home) {
  const root = home ?? (process.env.HOME ?? process.cwd());
  const enabled = new Set(loadCliSettings(home).enabled);
  return Object.keys(CLI_TARGETS).map((id) => {
    const target = CLI_TARGETS[id];
    return [
      target.id,
      enabled.has(id) ? "yes" : "no",
      relative2(resolve4(root), resolve4(target.mcpConfigPath(home))).split("\\").join("/"),
      relative2(resolve4(root), resolve4(target.skillsDir(home))).split("\\").join("/")
    ];
  });
}
function buildInstallRows(home, resourcesRoot) {
  const enabled = loadCliSettings(home).enabled;
  const manifest = loadSkillsManifest(resourcesRoot);
  const rows = [];
  for (const cli of enabled) {
    const target = CLI_TARGETS[cli];
    if (target === void 0) continue;
    rows.push([
      "Server",
      MCP_SERVER_NAME,
      target.id,
      "yes",
      isServerRegistered(target, MCP_SERVER_NAME, home) ? STATUS_OK : STATUS_MISSING
    ]);
    for (const skill of manifest) {
      rows.push([
        "Skill",
        skill.id,
        target.id,
        "yes",
        compareSkillTree(join5(resourcesRoot, skill.id), join5(target.skillsDir(home), skill.id), {
          ...skill.debugPath === void 0 ? {} : { debugPath: skill.debugPath }
        })
      ]);
    }
  }
  return rows;
}
function buildCliShowReport(options) {
  return [
    "CLI Configuration",
    renderAsciiTable(["CLI", "Enabled", "MCP Config Path", "Skills Config Path"], buildCliRows(options.home)),
    "",
    "Installation Status",
    renderAsciiTable(["Type", "Name", "CLI", "Enabled", "Installed"], buildInstallRows(options.home, options.resourcesRoot))
  ].join("\n");
}

// src/utils/configCli.ts
import { readFileSync as readFileSync5 } from "fs";

// src/utils/configRenderer.ts
var TREE_BRANCH = "\u251C\u2500\u2500 ";
var TREE_LAST = "\u2514\u2500\u2500 ";
var TREE_CONTINUE = "\u2502   ";
var TREE_INDENT = "    ";
var TABLE_PADDING = 1;
function codePointWidth(code) {
  if (code === 0) return 0;
  if (code < 32 || code >= 127 && code < 160) return 1;
  if (code >= 768 && code <= 879 || code >= 6832 && code <= 6911 || code >= 8400 && code <= 8447) {
    return 0;
  }
  if (code >= 4352 && code <= 4447 || code >= 11904 && code <= 12350 || code >= 12353 && code <= 13311 || code >= 13312 && code <= 19903 || code >= 19968 && code <= 40959 || code >= 40960 && code <= 42191 || code >= 44032 && code <= 55203 || code >= 63744 && code <= 64255 || code >= 65072 && code <= 65135 || code >= 65280 && code <= 65376 || code >= 65504 && code <= 65510 || code >= 127744 && code <= 129535 || code >= 131072 && code <= 262141) {
    return 2;
  }
  return 1;
}
function displayWidth(text) {
  let width = 0;
  for (const character of text) {
    width += codePointWidth(character.codePointAt(0) ?? 0);
  }
  return width;
}
function escapeDetailText(text) {
  let escaped = "";
  for (const character of text) {
    const code = character.codePointAt(0) ?? 0;
    if (character === "\n") {
      escaped += "\\n";
    } else if (character === "\r") {
      escaped += "\\r";
    } else if (character === "	") {
      escaped += "\\t";
    } else if (code < 32 || code >= 127 && code < 160) {
      escaped += `\\u${code.toString(16).padStart(4, "0")}`;
    } else {
      escaped += character;
    }
  }
  return escaped;
}
function padCell(text, width) {
  return text + " ".repeat(Math.max(0, width - displayWidth(text)));
}
function renderConfigTable(table) {
  const columnCount = table.headers.length;
  if (columnCount === 0 || table.rows.length === 0) {
    return [];
  }
  const headers = table.headers.map((header) => escapeDetailText(header));
  const rows = table.rows.map((row) => {
    const cells = [];
    for (let column = 0; column < columnCount; column += 1) {
      cells.push(escapeDetailText(row[column] ?? ""));
    }
    return cells;
  });
  const widths = headers.map((header, column) => {
    let width = displayWidth(header);
    for (const row of rows) {
      width = Math.max(width, displayWidth(row[column]));
    }
    return width;
  });
  const segment = (index) => "\u2500".repeat(widths[index] + TABLE_PADDING * 2);
  const border = (left, middle, right) => left + widths.map((_width, index) => segment(index)).join(middle) + right;
  const line = (cells) => "\u2502" + widths.map((width, index) => " ".repeat(TABLE_PADDING) + padCell(cells[index] ?? "", width) + " ".repeat(TABLE_PADDING)).join("\u2502") + "\u2502";
  const lines = [border("\u250C", "\u252C", "\u2510"), line(headers), border("\u251C", "\u253C", "\u2524")];
  for (const row of rows) {
    lines.push(line(row));
  }
  lines.push(border("\u2514", "\u2534", "\u2518"));
  return lines;
}
function emitConfigNode(node, ancestorHasNext, isLast, out) {
  const prefix = ancestorHasNext.map((hasNext) => hasNext ? TREE_CONTINUE : TREE_INDENT).join("");
  out.push(prefix + (isLast ? TREE_LAST : TREE_BRANCH) + node.heading);
  const detailPrefix = prefix + (isLast ? TREE_INDENT : TREE_CONTINUE);
  for (const detail of node.details) {
    for (const logicalLine of detail.lines) {
      out.push(detailPrefix + escapeDetailText(logicalLine));
    }
  }
  node.children.forEach((child, index) => {
    emitConfigNode(child, [...ancestorHasNext, !isLast], index === node.children.length - 1, out);
  });
}
function renderConfigTree(root) {
  const lines = [escapeDetailText(root.heading)];
  for (const detail of root.details) {
    for (const logicalLine of detail.lines) {
      lines.push(TREE_INDENT + escapeDetailText(logicalLine));
    }
  }
  root.children.forEach((child, index) => {
    emitConfigNode(child, [], index === root.children.length - 1, lines);
  });
  return lines;
}
function asConfigTableDetail(table) {
  const lines = renderConfigTable(table);
  return lines.length === 0 ? [] : [{ lines }];
}

// src/utils/configView.ts
var CLI_MEANINGS = {
  antigravity: "Antigravity agent",
  claude: "Claude Code CLI",
  codex: "Codex CLI",
  copilot: "GitHub Copilot CLI",
  openclaw: "OpenClaw agent",
  opencode: "OpenCode CLI",
  pi: "pi coding agent"
};
function quoteShellLiteral(value) {
  if (Array.isArray(value) || typeof value === "object" && value !== null) {
    return `'${JSON.stringify(value)}'`;
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "number") {
    return String(value);
  }
  return `"${String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
function sectionHeading(section) {
  return `${section.token} - [Path: ${section.token}] ${section.description}`;
}
function buildPrintSectionNode(settings, section, context) {
  return {
    heading: sectionHeading(section),
    details: [],
    children: section.parameters.map((parameter) => buildPrintParameterNode(settings, section, parameter, context))
  };
}
function buildPrintParameterNode(settings, section, parameter, context) {
  const ownerPath = formatConfigPath(section, parameter);
  const value = settings[parameter.token];
  const defaultValue = CONFIG_DEFAULTS[parameter.token];
  if (parameter.type === "StringArray") {
    const items = value;
    const exampleItem = parameter.example[0] ?? "pi";
    if (items.length === 0) {
      return {
        heading: `${parameter.token} = (empty list | add: --set ${ownerPath}:+ ${quoteShellLiteral(exampleItem)})`,
        details: [],
        children: []
      };
    }
    return {
      heading: `${parameter.token} = (${items.length} ${items.length === 1 ? "item" : "items"} | row target: ${ownerPath}:<Idx> | add: ${ownerPath}:+)`,
      details: asConfigTableDetail({
        headers: ["Idx", "Value"],
        rows: items.map((item, index) => [String(index), formatConfigDisplayValue(item)])
      }),
      children: []
    };
  }
  void context;
  const status = formatConfigDisplayValue(value) === formatConfigDisplayValue(defaultValue) ? "(default)" : `(custom | default: ${formatConfigDisplayValue(defaultValue)})`;
  return {
    heading: `${parameter.token} = ${formatConfigDisplayValue(value)} ${status}`,
    details: [],
    children: []
  };
}
function enabledAllowedValuesTable(section, parameter, context) {
  const ownerPath = formatConfigPath(section, parameter);
  return {
    headers: ["Value", "Default", "Meaning", "Set cmd"],
    rows: context.cliNames.map((name) => [
      name,
      CONFIG_DEFAULTS.enabled.includes(name) ? "yes" : "no",
      CLI_MEANINGS[name] ?? "CLI agent",
      `--set ${ownerPath}:+ ${quoteShellLiteral(name)}`
    ])
  };
}
function enabledToolsAllowedValuesTable(context) {
  return {
    headers: ["Value", "Meaning"],
    rows: [
      ["*", `all ${context.toolNames.length} registered tools`],
      ...context.toolNames.map((name) => [name, "registered MCP tool"])
    ]
  };
}
function buildInfoSectionNode(section, context) {
  return {
    heading: sectionHeading(section),
    details: [{ lines: [`Reset block : --unset ${section.token}`] }],
    children: section.parameters.map((parameter) => buildInfoParameterNode(section, parameter, context))
  };
}
function buildInfoParameterNode(section, parameter, context) {
  const ownerPath = formatConfigPath(section, parameter);
  const heading = `${parameter.token} - ${describeConfigType(parameter)} ${parameter.description}`;
  const details = [
    {
      lines: [
        `Default : ${formatConfigDisplayValue(CONFIG_DEFAULTS[parameter.token])} (restored via: --unset ${ownerPath})`
      ]
    }
  ];
  if (parameter.token === "enabled") {
    const exampleItem = quoteShellLiteral(parameter.example[0] ?? "pi");
    const exampleArray = quoteShellLiteral(parameter.example);
    details.push(
      { lines: [`Add item : --set ${ownerPath}:+ ${exampleItem}`] },
      { lines: [`Insert item : --set ${ownerPath}:insert:0 ${exampleItem}`] },
      { lines: [`Replace item : --set ${ownerPath}:0 ${exampleItem}`] },
      { lines: [`Delete item : --unset ${ownerPath}:0`] },
      { lines: [`Full overwrite : --set ${ownerPath} ${exampleArray}`] },
      { lines: [`Reset array : --unset ${ownerPath}`] },
      { lines: ["Allowed Values:"] }
    );
    const table = enabledAllowedValuesTable(section, parameter, context);
    details.push({ lines: renderConfigTable(table) });
    return { heading, details, children: [] };
  }
  details.push({ lines: [`Set cmd : --set ${ownerPath} ${quoteShellLiteral(parameter.example)}`] });
  if (parameter.token === "enabledTools") {
    details.push({ lines: ["Allowed Values:"] });
    details.push({ lines: renderConfigTable(enabledToolsAllowedValuesTable(context)) });
  }
  return { heading, details, children: [] };
}
function buildConfigPrintView(settings, context, path) {
  const raw = (path ?? "").trim();
  if (raw.length === 0) {
    return {
      ok: true,
      root: {
        heading: `${CONFIG_ROOT_LABEL} - Current configuration`,
        details: [],
        children: CONFIG_SECTIONS.map((section) => buildPrintSectionNode(settings, section, context))
      }
    };
  }
  const parsed = parseConfigPath(raw);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }
  const target = parsed.target;
  if (target.parameter === void 0) {
    return { ok: true, root: buildPrintSectionNode(settings, target.section, context) };
  }
  if (target.operation !== "value") {
    return {
      ok: false,
      error: `${target.canonicalPath} is a write-only array operation and has no printable value; print ${formatConfigPath(target.section, target.parameter)} instead`
    };
  }
  return { ok: true, root: buildPrintParameterNode(settings, target.section, target.parameter, context) };
}
function buildConfigInfoView(context, path) {
  const raw = (path ?? "").trim();
  if (raw.length === 0) {
    return {
      ok: true,
      root: {
        heading: `${CONFIG_ROOT_LABEL} - Configuration schema`,
        details: [],
        children: CONFIG_SECTIONS.map((section) => buildInfoSectionNode(section, context))
      }
    };
  }
  const parsed = parseConfigPath(raw);
  if (!parsed.ok) {
    return { ok: false, error: parsed.error };
  }
  const target = parsed.target;
  if (target.parameter === void 0) {
    return { ok: true, root: buildInfoSectionNode(target.section, context) };
  }
  if (target.operation !== "value") {
    return {
      ok: false,
      error: `${target.canonicalPath} is a write-only array operation and has no schema node of its own; document ${formatConfigPath(target.section, target.parameter)} instead`
    };
  }
  return { ok: true, root: buildInfoParameterNode(target.section, target.parameter, context) };
}

// src/utils/configCli.ts
var CONFIG_ACTIONS = ["--print", "--info", "--print-raw", "--get", "--set", "--unset"];
var CONFIG_CLI_USAGE = 'Configuration interface (canonical paths, section Settings):\n  --print [Path]        Print current configuration values as a tree\n  --info [Path]         Print the configuration schema documentation as a tree\n  --print-raw           Print the raw settings file bytes unchanged\n  --get Path            Print one value as JSON (pipeable, no decoration)\n  --set Path Value      Set a value (JSON literal for non-string parameters)\n  --unset Path          Restore a default, or delete one array element\nExamples:\n  mcp-google-api --print\n  mcp-google-api --print Settings\n  mcp-google-api --info Settings:enabled\n  mcp-google-api --get Settings:port\n  mcp-google-api --set Settings:port 3100\n  mcp-google-api --set Settings:enabled:+ "pi"\n  mcp-google-api --unset Settings:host';
function createConfigSchemaContext() {
  return {
    cliNames: supportedCliNames().split(",").map((name) => name.trim()).filter((name) => name.length > 0),
    toolNames: config_default[0].tools.map((tool) => tool.name)
  };
}
function parseConfigCommand(args) {
  const action = CONFIG_ACTIONS.find((candidate) => candidate === args[0]);
  if (action === void 0) {
    return { matched: false };
  }
  const rest = args.slice(1);
  const reject = (error) => ({ matched: true, ok: false, error });
  switch (action) {
    case "--print":
    case "--info": {
      if (rest.length > 1) {
        return reject(`${action} accepts at most one canonical path argument`);
      }
      return { matched: true, ok: true, invocation: rest.length === 0 ? { action } : { action, path: rest[0] } };
    }
    case "--print-raw": {
      if (rest.length !== 0) {
        return reject("--print-raw accepts no arguments");
      }
      return { matched: true, ok: true, invocation: { action } };
    }
    case "--get":
    case "--unset": {
      if (rest.length !== 1) {
        return reject(`${action} requires exactly one canonical path argument`);
      }
      return { matched: true, ok: true, invocation: { action, path: rest[0] } };
    }
    default: {
      if (rest.length !== 2) {
        return reject("--set requires a canonical path argument and exactly one value argument");
      }
      return { matched: true, ok: true, invocation: { action, path: rest[0], value: rest[1] } };
    }
  }
}
function resolveStreams(options) {
  return options.streams ?? { stdout: process.stdout, stderr: process.stderr };
}
function reportConfigFailure(streams, action, message) {
  streams.stderr.write(`${action}: ${message}
`);
  return 1;
}
function loadConfigurationForRead(home) {
  try {
    bootstrapCliSettings(home);
    return { ok: true, settings: loadCliSettings(home) };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
function loadConfigurationForWrite(home, context) {
  try {
    bootstrapCliSettings(home);
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
  const read = readCliSettingsDocument(home);
  if (!read.ok) {
    return { ok: false, error: read.error };
  }
  const validated = validateConfigDocument(read.document, context);
  if (!validated.ok) {
    return { ok: false, error: `settings file is invalid: ${validated.error}` };
  }
  return { ok: true, settings: validated.value };
}
function runConfigPrintCommand(options) {
  const streams = resolveStreams(options);
  const action = options.info ? "--info" : "--print";
  const context = createConfigSchemaContext();
  if (options.info) {
    const view2 = buildConfigInfoView(context, options.path);
    if (!view2.ok) {
      return reportConfigFailure(streams, action, view2.error);
    }
    streams.stdout.write(renderConfigTree(view2.root).join("\n") + "\n");
    return 0;
  }
  const loaded = loadConfigurationForRead(options.home);
  if (!loaded.ok) {
    return reportConfigFailure(streams, action, loaded.error);
  }
  const view = buildConfigPrintView(loaded.settings, context, options.path);
  if (!view.ok) {
    return reportConfigFailure(streams, action, view.error);
  }
  streams.stdout.write(renderConfigTree(view.root).join("\n") + "\n");
  return 0;
}
function runConfigPrintRawCommand(options = {}) {
  const streams = resolveStreams(options);
  let path;
  try {
    path = bootstrapCliSettings(options.home);
  } catch (error) {
    return reportConfigFailure(streams, "--print-raw", error instanceof Error ? error.message : String(error));
  }
  let bytes;
  try {
    bytes = readFileSync5(path);
  } catch (error) {
    return reportConfigFailure(streams, "--print-raw", error instanceof Error ? error.message : String(error));
  }
  streams.stdout.write(bytes);
  return 0;
}
function runConfigGetCommand(path, options = {}) {
  const streams = resolveStreams(options);
  const parsed = parseConfigPath(path);
  if (!parsed.ok) {
    return reportConfigFailure(streams, "--get", parsed.error);
  }
  const loaded = loadConfigurationForRead(options.home);
  if (!loaded.ok) {
    return reportConfigFailure(streams, "--get", loaded.error);
  }
  const value = readConfigValue(loaded.settings, parsed.target);
  if (!value.ok) {
    return reportConfigFailure(streams, "--get", value.error);
  }
  streams.stdout.write(JSON.stringify(value.value) + "\n");
  return 0;
}
function runConfigSetCommand(path, rawValue, options = {}) {
  const streams = resolveStreams(options);
  const parsed = parseConfigPath(path);
  if (!parsed.ok) {
    return reportConfigFailure(streams, "--set", parsed.error);
  }
  const context = createConfigSchemaContext();
  const loaded = loadConfigurationForWrite(options.home, context);
  if (!loaded.ok) {
    return reportConfigFailure(streams, "--set", loaded.error);
  }
  const applied = applyConfigSet(loaded.settings, parsed.target, rawValue, context);
  if (!applied.ok) {
    return reportConfigFailure(streams, "--set", applied.error);
  }
  try {
    saveCliSettings(applied.settings, options.home);
  } catch (error) {
    return reportConfigFailure(streams, "--set", error instanceof Error ? error.message : String(error));
  }
  streams.stdout.write(`${applied.description}.
`);
  return 0;
}
function runConfigUnsetCommand(path, options = {}) {
  const streams = resolveStreams(options);
  const parsed = parseConfigPath(path);
  if (!parsed.ok) {
    return reportConfigFailure(streams, "--unset", parsed.error);
  }
  const context = createConfigSchemaContext();
  const loaded = loadConfigurationForWrite(options.home, context);
  if (!loaded.ok) {
    return reportConfigFailure(streams, "--unset", loaded.error);
  }
  const applied = applyConfigUnset(loaded.settings, parsed.target, context);
  if (!applied.ok) {
    return reportConfigFailure(streams, "--unset", applied.error);
  }
  try {
    saveCliSettings(applied.settings, options.home);
  } catch (error) {
    return reportConfigFailure(streams, "--unset", error instanceof Error ? error.message : String(error));
  }
  streams.stdout.write(`${applied.description}.
`);
  return 0;
}
function runConfigCommandInvocation(invocation, options = {}) {
  switch (invocation.action) {
    case "--print":
      return runConfigPrintCommand({ ...options, info: false, path: invocation.path });
    case "--info":
      return runConfigPrintCommand({ ...options, info: true, path: invocation.path });
    case "--print-raw":
      return runConfigPrintRawCommand(options);
    case "--get":
      return runConfigGetCommand(invocation.path ?? "", options);
    case "--set":
      return runConfigSetCommand(invocation.path ?? "", invocation.value ?? "", options);
    default:
      return runConfigUnsetCommand(invocation.path ?? "", options);
  }
}
function runConfigCommandIfMatched(args, options = {}) {
  const parsed = parseConfigCommand(args);
  if (!parsed.matched) {
    return false;
  }
  const streams = resolveStreams(options);
  if (!parsed.ok) {
    streams.stderr.write(`${parsed.error}

${CONFIG_CLI_USAGE}
`);
    process.exitCode = 1;
    return true;
  }
  process.exitCode = runConfigCommandInvocation(parsed.invocation, options);
  return true;
}

// src/cli.ts
var __filename = fileURLToPath(import.meta.url);
var __dirname = dirname3(__filename);
async function startServer(port, apiKey, host = "127.0.0.1") {
  ApiKeyManager.getInstance().setDefaultApiKey(apiKey);
  Logger.log("\u{1F680} Starting MCP Google API server...");
  Logger.log(
    "\u2139\uFE0F  Reminder: enable Places API (New) in https://console.cloud.google.com before using the new Place features."
  );
  Logger.log("");
  const servers = [];
  let started = 0;
  let failed = 0;
  await Promise.all(
    config_default.map(async (config) => {
      const serverPort = port;
      if (!Number.isInteger(serverPort) || serverPort < 1 || serverPort > 65535) {
        Logger.error(
          `\u274C [${config.name}] Invalid port number "${serverPort}" (expected integer 1-65535).`
        );
        Logger.log("\u{1F4A1} Fix the persisted port with 'mcp-google-api port <number>' or pass --port.");
        failed++;
        return;
      }
      try {
        const activeTools = filterTools(config.tools);
        Logger.log(`\u{1F4CD} ${activeTools.length} tools registered (configure with 'mcp-google-api tools')`);
        const server = new BaseMcpServer(config.name, activeTools);
        const serverHost = host;
        Logger.log(`\u{1F527} [${config.name}] Initializing MCP Server in HTTP mode on ${serverHost}:${serverPort}...`);
        await server.startHttpServer(serverPort, serverHost);
        servers.push(server);
        started++;
        const displayHost = serverHost === "0.0.0.0" ? "localhost" : serverHost;
        Logger.log(`\u2705 [${config.name}] MCP Server started successfully!`);
        Logger.log(`   \u{1F310} Endpoint: http://${displayHost}:${serverPort}/mcp`);
        Logger.log(`   \u{1F4DA} Tools: ${activeTools.length} available`);
      } catch (error) {
        Logger.error(`\u274C [${config.name}] Failed to start MCP Server on port ${serverPort}:`, error);
        failed++;
      }
    })
  );
  if (started > 0) {
    installShutdownHandlers(servers);
  }
  Logger.log("");
  Logger.log(started > 0 ? "\u{1F389} Server initialization completed!" : "\u274C No MCP server instance started.");
  Logger.log("\u{1F4A1} Need help? Check the README.md for configuration details.");
  return { started, failed, servers };
}
function createShutdownHandler(servers, exitHook = (code) => process.exit(code)) {
  let invoked = false;
  return async (signal) => {
    if (invoked) {
      return;
    }
    invoked = true;
    Logger.log(`\u{1F4F6} Received ${signal}; shutting down MCP HTTP server...`);
    await Promise.allSettled(servers.map((server) => server.stopHttpServer()));
    exitHook(0);
  };
}
function installShutdownHandlers(servers) {
  const handler = createShutdownHandler(servers);
  process.on("SIGINT", () => void handler("SIGINT"));
  process.on("SIGTERM", () => void handler("SIGTERM"));
}
var EXEC_TOOLS = [
  "maps_geocode",
  "maps_reverse_geocode",
  "maps_search_nearby",
  "maps_search_places",
  "maps_place_details",
  "maps_directions",
  "maps_distance_matrix",
  "maps_elevation",
  "maps_timezone",
  "maps_weather",
  "maps_explore_area",
  "maps_plan_route",
  "maps_compare_places",
  "maps_air_quality",
  "maps_static_map",
  "maps_batch_geocode",
  "maps_search_along_route",
  "maps_local_rank_tracker"
];
function isExecFailureResponse(result) {
  return typeof result === "object" && result !== null && "success" in result && result.success === false;
}
function getExecFailureMessage(toolName, result) {
  if (typeof result.error === "string" && result.error.trim().length > 0) {
    return result.error;
  }
  if (result.error !== void 0 && result.error !== null) {
    return String(result.error);
  }
  return `Tool "${toolName}" returned a failure response`;
}
async function execTool(toolName, params, apiKey) {
  const searcher = new PlacesSearcher(apiKey);
  switch (toolName) {
    case "maps_geocode":
      return searcher.geocode(params.address);
    case "maps_reverse_geocode":
      return searcher.reverseGeocode(params.latitude, params.longitude);
    case "maps_search_nearby":
      return searcher.searchNearby(params);
    case "maps_search_places":
      return searcher.searchText({
        query: params.query,
        locationBias: params.locationBias,
        openNow: params.openNow,
        minRating: params.minRating,
        includedType: params.includedType,
        strictTypeFiltering: params.strictTypeFiltering,
        priceLevels: params.priceLevels,
        pageSize: params.pageSize,
        pageToken: params.pageToken,
        languageCode: params.languageCode,
        includeRaw: params.includeRaw
      });
    case "maps_place_details":
      return searcher.getPlaceDetails(params.placeId, params.maxPhotos || 0, params.includeRaw || false);
    case "maps_directions":
      return searcher.getDirections(
        params.origin,
        params.destination,
        params.mode,
        params.departure_time,
        params.arrival_time,
        params.avoid_tolls,
        params.avoid_highways
      );
    case "maps_distance_matrix":
      return searcher.calculateDistanceMatrix(
        params.origins,
        params.destinations,
        params.mode,
        params.departure_time,
        params.avoid_tolls,
        params.avoid_highways
      );
    case "maps_elevation":
      return searcher.getElevation(params.locations);
    case "maps_timezone":
      return searcher.getTimezone(params.latitude, params.longitude, params.timestamp);
    case "maps_weather":
      return searcher.getWeather(
        params.latitude,
        params.longitude,
        params.type,
        params.forecastDays,
        params.forecastHours
      );
    case "maps_explore_area":
      return searcher.exploreArea(params);
    case "maps_plan_route":
      return searcher.planRoute(params);
    case "maps_compare_places":
      return searcher.comparePlaces(params);
    case "maps_air_quality":
      return searcher.getAirQuality(
        params.latitude,
        params.longitude,
        params.includeHealthRecommendations,
        params.includePollutants
      );
    case "maps_static_map":
      return searcher.getStaticMap(params);
    case "maps_batch_geocode": {
      const results = await Promise.all(
        params.addresses.map(async (address) => {
          try {
            const result = await searcher.geocode(address);
            return { address, ...result };
          } catch (error) {
            return { address, success: false, error: error.message };
          }
        })
      );
      const succeeded = results.filter((r) => r.success).length;
      return {
        success: true,
        data: { total: params.addresses.length, succeeded, failed: params.addresses.length - succeeded, results }
      };
    }
    case "maps_search_along_route":
      return searcher.searchAlongRoute(params);
    case "maps_local_rank_tracker":
      return searcher.localRankTracker(params);
    default:
      throw new Error(`Unknown tool: ${toolName}. Available: ${EXEC_TOOLS.join(", ")}`);
  }
}
async function runExecCommand(toolName, params, apiKey, runner = execTool, streams = { stdout: process.stdout, stderr: process.stderr }) {
  try {
    const result = await runner(toolName, params, apiKey);
    if (isExecFailureResponse(result)) {
      streams.stderr.write(JSON.stringify({ error: getExecFailureMessage(toolName, result) }, null, 2) + "\n");
      return 1;
    }
    streams.stdout.write(JSON.stringify(result, null, 2) + "\n");
    return 0;
  } catch (error) {
    streams.stderr.write(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2) + "\n"
    );
    return 1;
  }
}
var DOCTOR_PROBES = [
  { id: "geocoding", name: "geocoding-api", tool: "maps_geocode", params: { address: "Tokyo Tower" } },
  { id: "places-new", name: "places-api-new", tool: "maps_search_places", params: { query: "Tokyo Tower" } },
  {
    id: "routes",
    name: "routes-api",
    tool: "maps_directions",
    params: { origin: "Tokyo Tower", destination: "Tokyo Station", mode: "walking" }
  }
];
var DOCTOR_PROBE_ALIASES = {
  geocoding: "geocoding",
  "geocoding-api": "geocoding",
  "places-new": "places-new",
  places: "places-new",
  "places-api-new": "places-new",
  routes: "routes",
  "routes-api": "routes"
};
function parseDoctorProbes(raw) {
  if (raw === void 0) {
    return { probes: void 0 };
  }
  const items = raw.split(",").map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (items.length === 0) {
    return { probes: void 0, error: "--probes received no probe names (expected: geocoding, places-new, routes)" };
  }
  const probes = [];
  for (const item of items) {
    const id = DOCTOR_PROBE_ALIASES[item];
    if (!id) {
      return { probes: [], error: `unknown probe "${item}" (expected: geocoding, places-new, routes)` };
    }
    if (!probes.includes(id)) {
      probes.push(id);
    }
  }
  return { probes };
}
async function runDoctor(packageVersion, apiKey, live = false, runner = execTool, options = {}) {
  const nodeVersion = options.nodeVersion ?? process.versions.node;
  const nodeMajor = Number.parseInt(nodeVersion.split(".")[0] ?? "0", 10);
  const config = options.config ?? resolveRuntimeConfig(loadCliSettings());
  const allToolNames = options.allToolNames ?? config_default[0].tools.map((tool) => tool.name);
  const toolsResolution = resolveEnabledToolNames(allToolNames, config.enabledToolsRaw);
  const diagnostics = describeRuntimeConfig(config);
  const toolsProfile = describeToolsProfile(toolsResolution.names);
  const checks = [
    {
      name: "node",
      status: nodeMajor >= NODE_ENGINE_FLOOR ? "pass" : "fail",
      detail: `Node.js ${nodeVersion} detected; version ${NODE_ENGINE_FLOOR} or newer is required (package.json engines).`
    },
    {
      name: "package",
      status: packageVersion !== "0.0.0" ? "pass" : "fail",
      detail: packageVersion !== "0.0.0" ? `mcp-google-api ${packageVersion} is available.` : "Could not read the installed package version."
    },
    {
      name: "api-key",
      status: apiKey ? "pass" : "fail",
      detail: apiKey ? "Google Maps API key is configured via 'mcp-google-api api-key' (value hidden)." : "Google Maps API key is not configured. Run 'mcp-google-api api-key <your-api-key>' to configure it."
    },
    {
      name: "config",
      status: toolsResolution.fallback ? "fail" : "pass",
      detail: toolsResolution.fallback ? `enabledTools matched 0 tools; the server falls back to all ${allToolNames.length} tools. Effective configuration: ${formatConfigDiagnostics(diagnostics)}` : `Effective configuration: ${formatConfigDiagnostics(diagnostics)}`
    },
    {
      name: "tools",
      status: "pass",
      detail: `${toolsProfile.toolCount} tool(s) enabled; Google APIs: ${toolsProfile.apis.join(", ") || "none"}; per-tool: ${toolsProfile.tools.map((tool) => `${tool.tool}[${tool.apis.join("+")}]`).join(", ")}`
    }
  ];
  if (!live) {
    checks.push({
      name: "live-api",
      status: "skip",
      detail: "Live API checks were not requested; no Google Maps API calls were made."
    });
  } else if (!apiKey) {
    checks.push({
      name: "live-api",
      status: "skip",
      detail: "Live API checks require a configured Google Maps API key."
    });
  } else {
    const selected = options.probes ? DOCTOR_PROBES.filter((probe) => options.probes.includes(probe.id)) : DOCTOR_PROBES;
    for (const check of selected) {
      try {
        const result = await runner(check.tool, check.params, apiKey);
        if (isExecFailureResponse(result)) {
          checks.push({
            name: check.name,
            status: "fail",
            detail: getExecFailureMessage(check.tool, result)
          });
        } else {
          checks.push({
            name: check.name,
            status: "pass",
            detail: `${check.name} request succeeded.`
          });
        }
      } catch (error) {
        checks.push({
          name: check.name,
          status: "fail",
          detail: error instanceof Error ? error.message : String(error)
        });
      }
    }
  }
  return {
    success: checks.every((check) => check.status !== "fail"),
    version: packageVersion,
    live,
    checks
  };
}
function runSnippetCommand(options, streams = { stdout: process.stdout, stderr: process.stderr }) {
  try {
    const snippet = renderClientSnippet(options);
    streams.stdout.write(snippet.json + "\n");
    for (const note of snippet.notes) {
      streams.stderr.write(`[snippet] ${note}
`);
    }
    return 0;
  } catch (error) {
    streams.stderr.write(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2) + "\n"
    );
    return 1;
  }
}
function runEnableDisableCliCommand(name, enable, options = {}) {
  const streams = options.streams ?? { stdout: process.stdout, stderr: process.stderr };
  const target = resolveCliTarget(name);
  if (target === void 0) {
    streams.stderr.write(
      JSON.stringify({ error: `Unsupported CLI: ${name}. Supported: ${supportedCliNames()}.` }, null, 2) + "\n"
    );
    return 2;
  }
  const settings = loadCliSettings(options.home);
  const already = settings.enabled.includes(target.id);
  if (enable === already) {
    streams.stdout.write(`${target.id} is already ${enable ? "enabled" : "disabled"}.
`);
    return 0;
  }
  settings.enabled = enable ? [...settings.enabled, target.id] : settings.enabled.filter((item) => item !== target.id);
  saveCliSettings(settings, options.home);
  streams.stdout.write(`${enable ? "Enabled" : "Disabled"} ${target.id}.
`);
  return 0;
}
function runApiKeyCommand(key, options) {
  const streams = options.streams ?? { stdout: process.stdout, stderr: process.stderr };
  const trimmed = (key ?? "").trim();
  if (!ApiKeyManager.getInstance().isValidApiKeyFormat(trimmed)) {
    streams.stderr.write(
      "api-key: invalid Google Maps API key. Expected 20-50 characters of letters, digits, hyphens, or underscores.\nUsage: mcp-google-api api-key <your-api-key>\n"
    );
    return 1;
  }
  try {
    const settings = loadCliSettings(options.home);
    settings.apiKey = trimmed;
    saveCliSettings(settings, options.home);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    streams.stderr.write(`api-key: failed to persist the API key: ${message}
`);
    return 1;
  }
  streams.stdout.write(`API key configured (${maskSecret(trimmed)}).
`);
  let install;
  try {
    install = installEnabledCliResources({ home: options.home, resourcesRoot: options.resourcesRoot });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    streams.stderr.write(`api-key: install failed: ${message}
`);
    return 1;
  }
  if (install.summaries.length === 0 && install.errors.length === 0) {
    streams.stdout.write("No CLI agent enabled. Run 'mcp-google-api enable <cli name>' first.\n");
    return 0;
  }
  for (const summary of install.summaries) {
    streams.stdout.write(
      `${summary.cli}: MCP connector installed (server entries: ${summary.server}, skills: ${summary.skills}).
`
    );
  }
  for (const error of install.errors) {
    streams.stdout.write(`${error}
`);
  }
  return install.errors.length > 0 ? 1 : 0;
}
function runAutoUpdateCommand(rawState, options = {}) {
  const streams = options.streams ?? { stdout: process.stdout, stderr: process.stderr };
  const normalized = (rawState ?? "").trim().toLowerCase();
  let enabled;
  if (normalized === "enable" || normalized === "1") {
    enabled = true;
  } else if (normalized === "disable" || normalized === "0") {
    enabled = false;
  } else {
    streams.stderr.write(
      `auto-update: invalid value "${rawState ?? ""}". Accepted values: enable, disable, 1, 0.
`
    );
    return 1;
  }
  try {
    const settings = loadCliSettings(options.home);
    settings.autoUpdate = enabled;
    saveCliSettings(settings, options.home);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    streams.stderr.write(`auto-update: failed to persist the setting: ${message}
`);
    return 1;
  }
  streams.stdout.write(enabled ? "Auto-update check enabled.\n" : "Auto-update check disabled.\n");
  return 0;
}
function runToolsCommand(raw, options = {}) {
  const streams = options.streams ?? { stdout: process.stdout, stderr: process.stderr };
  const allToolNames = config_default[0].tools.map((tool) => tool.name);
  const trimmed = (raw ?? "").trim();
  if (trimmed.length === 0) {
    streams.stderr.write(
      `tools: missing or empty tool list. Use '*' for all tools or a comma-separated subset of: ${allToolNames.join(", ")}.
`
    );
    return 1;
  }
  let value;
  if (trimmed === "*") {
    value = "*";
  } else {
    const requested = trimmed.split(",").map((item) => item.trim()).filter(Boolean);
    const unknown = requested.filter((item) => !allToolNames.includes(item));
    if (requested.length === 0 || unknown.length > 0) {
      streams.stderr.write(
        `tools: unknown tool name(s): ${unknown.join(", ") || "(none)"}. Accepted: ${allToolNames.join(", ")} (or '*').
`
      );
      return 1;
    }
    value = requested.join(",");
  }
  try {
    const settings = loadCliSettings(options.home);
    settings.enabledTools = value;
    saveCliSettings(settings, options.home);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    streams.stderr.write(`tools: failed to persist the setting: ${message}
`);
    return 1;
  }
  const count = value === "*" ? allToolNames.length : value.split(",").length;
  streams.stdout.write(`Enabled tools set to ${value === "*" ? `* (all ${count})` : value}.
`);
  return 0;
}
function runHostCommand(raw, options = {}) {
  const streams = options.streams ?? { stdout: process.stdout, stderr: process.stderr };
  const trimmed = (raw ?? "").trim();
  if (trimmed.length === 0) {
    streams.stderr.write("host: missing or empty hostname. Example: mcp-google-api host 127.0.0.1\n");
    return 1;
  }
  try {
    const settings = loadCliSettings(options.home);
    settings.host = trimmed;
    saveCliSettings(settings, options.home);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    streams.stderr.write(`host: failed to persist the setting: ${message}
`);
    return 1;
  }
  streams.stdout.write(`HTTP bind host set to ${trimmed}.
`);
  return 0;
}
function runPortCommand(raw, options = {}) {
  const streams = options.streams ?? { stdout: process.stdout, stderr: process.stderr };
  const trimmed = (raw ?? "").trim();
  const parsed = Number(trimmed);
  if (trimmed.length === 0 || !Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    streams.stderr.write(`port: invalid port "${trimmed || "(none)"}" (expected integer 1-65535).
`);
    return 1;
  }
  try {
    const settings = loadCliSettings(options.home);
    settings.port = parsed;
    saveCliSettings(settings, options.home);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    streams.stderr.write(`port: failed to persist the setting: ${message}
`);
    return 1;
  }
  streams.stdout.write(`HTTP port set to ${parsed}.
`);
  return 0;
}
function runInstallUninstallCommand(operation, options) {
  const streams = options.streams ?? { stdout: process.stdout, stderr: process.stderr };
  if (loadCliSettings(options.home).enabled.length === 0) {
    streams.stdout.write("No CLI agent enabled. Run 'mcp-google-api enable <cli name>' first.\n");
    return 0;
  }
  let result;
  try {
    result = operation === "install" ? installEnabledCliResources({
      home: options.home,
      resourcesRoot: options.resourcesRoot,
      includeDebugSkills: options.includeDebugSkills === true
    }) : uninstallEnabledCliResources({ home: options.home, resourcesRoot: options.resourcesRoot });
  } catch (error) {
    streams.stderr.write(
      `${operation} failed: ${error instanceof Error ? error.message : String(error)}
`
    );
    return 1;
  }
  streams.stdout.write(`mcp-google-api ${operation} report:
`);
  for (const summary of result.summaries) {
    streams.stdout.write(
      `  ${summary.cli}: MCP server ${operation === "install" ? "registered" : "removed"}, ${summary.skills} skill(s) ${operation === "install" ? "installed" : "removed"}
`
    );
  }
  if (result.errors.length > 0) {
    streams.stdout.write("Errors:\n");
    for (const error of result.errors) {
      streams.stdout.write(`  ${error}
`);
    }
  }
  return result.errors.length > 0 ? 1 : 0;
}
function runShowCommand(options) {
  const streams = options.streams ?? { stdout: process.stdout, stderr: process.stderr };
  try {
    streams.stdout.write(buildCliShowReport(options) + "\n");
    return 0;
  } catch (error) {
    streams.stderr.write(
      JSON.stringify({ error: error instanceof Error ? error.message : String(error) }, null, 2) + "\n"
    );
    return 1;
  }
}
function isEntryMainModule() {
  const entryPath = process.argv[1];
  if (entryPath === void 0 || entryPath === "") {
    return false;
  }
  try {
    return realpathSync(entryPath) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}
function describeUndispatchedServerStart(args) {
  const isServerStart = (args.includes("start") || args.includes("run")) && args.includes("--stdio");
  if (!isServerStart) {
    return void 0;
  }
  return "CLI dispatch was skipped for this server-start launch: the running artifact is not the mcp-google-api entrypoint (stale build after a distribution rename). Rebuild the local artifact with 'npm run build' (or 'npm run verify'), or refresh the global installation with 'npm install -g mcp-google-api@latest', then reconnect the MCP client.";
}
function handleUndispatchedEntry(args, streams = process) {
  const error = describeUndispatchedServerStart(args);
  if (error === void 0) {
    return 0;
  }
  streams.stderr.write(
    JSON.stringify(
      {
        error,
        requestedEntry: process.argv[1] ?? null,
        modulePath: fileURLToPath(import.meta.url),
        remediation: ["npm run build", "npm install -g mcp-google-api@latest"]
      },
      null,
      2
    ) + "\n"
  );
  return 1;
}
var isMainModule = isEntryMainModule();
if (isMainModule) {
  let packageVersion = "0.0.0";
  try {
    const packageJsonPath = resolve5(__dirname, "../package.json");
    const packageJson = JSON.parse(readFileSync6(packageJsonPath, "utf-8"));
    packageVersion = packageJson.version;
  } catch (e) {
    packageVersion = "0.0.0";
  }
  const managementCommand = parseManagementCommand(hideBin(process.argv));
  if (managementCommand !== void 0) {
    const upgradeChannel = parseUpgradeChannel(hideBin(process.argv));
    const upgradeForce = parseUpgradeForce(hideBin(process.argv));
    void runManagementCommand(managementCommand, { currentVersion: packageVersion, channel: upgradeChannel, force: upgradeForce }).then((code) => {
      process.exitCode = code;
    }).catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      process.stderr.write(JSON.stringify({ error: message }, null, 2) + "\n");
      process.exitCode = 1;
    });
  } else if (runConfigCommandIfMatched(hideBin(process.argv))) {
  } else {
    const buildServerCommandOptions = (yargs2) => {
      const settings = loadCliSettings();
      return yargs2.option("port", {
        alias: "p",
        type: "number",
        description: "Port to run the MCP server on (default: configured 'port' setting or 3000)",
        default: settings.port
      }).option("host", {
        type: "string",
        description: "Hostname to bind the server to (default: configured 'host' setting or 127.0.0.1; 0.0.0.0 for all interfaces)",
        default: settings.host
      }).option("stdio", {
        type: "boolean",
        description: "Use stdio transport instead of HTTP",
        default: false
      }).example([
        ["$0 start", "Start HTTP server with default settings"],
        ["$0 start --host 0.0.0.0 --port 3000", "Start HTTP accessible from all interfaces"],
        ["$0 start --stdio", "Start in stdio mode (for MCP clients)"],
        ["$0 run --stdio", "Alias: run the server in stdio mode"]
      ]);
    };
    const runServerCommand = async (argv) => {
      const effectiveApiKey = loadConfiguredApiKey();
      ApiKeyManager.getInstance().setDefaultApiKey(effectiveApiKey);
      if (loadCliSettings().autoUpdate) {
        void checkVersionIdle({ currentVersion: packageVersion }).catch(() => void 0);
      }
      const tools = filterTools(config_default[0].tools);
      if (argv.stdio) {
        if (effectiveApiKey === void 0) {
          process.stderr.write(
            JSON.stringify(
              {
                error: "Google Maps API key is not configured. Run 'mcp-google-api api-key <your-api-key>' to configure it."
              },
              null,
              2
            ) + "\n"
          );
          process.exitCode = 1;
          return;
        }
        const server = new BaseMcpServer(config_default[0].name, tools);
        await server.startStdio();
      } else {
        Logger.log("\u{1F5FA}\uFE0F  MCP Google API server");
        Logger.log("   Google APIs for AI agents over the Model Context Protocol");
        Logger.log("");
        if (effectiveApiKey === void 0) {
          Logger.log("\u26A0\uFE0F  Google Maps API Key not found!");
          Logger.log("   Run 'mcp-google-api api-key <your-api-key>' to configure it.");
          Logger.log("");
        }
        startServer(argv.port, effectiveApiKey, argv.host).then((outcome) => {
          if (outcome.started === 0) {
            process.exit(1);
          }
        }).catch((error) => {
          Logger.error("\u274C Failed to start server:", error);
          process.exit(1);
        });
      }
    };
    const cli = yargs(hideBin(process.argv)).scriptName("mcp-google-api").usage(
      `mcp-google-api v${packageVersion}

Usage: mcp-google-api <command> [options]
       mcp-google-api start|run [--stdio] [options]`
    ).command(
      "doctor",
      "Check standalone CLI readiness without starting an MCP server",
      (yargs2) => yargs2.option("live", {
        type: "boolean",
        default: false,
        description: "Make billable test requests to Geocoding, Places (New), and Routes APIs"
      }).option("probes", {
        type: "string",
        description: "Comma-separated subset of live probes: geocoding, places-new, routes (default: all three)"
      }).option("apikey", {
        alias: "k",
        type: "string",
        description: "Google Maps API key override for live probes (default: configured api-key setting)"
      }).example([
        ["$0 doctor", "Check local runtime and API key configuration without network calls"],
        ["$0 doctor --live", "Also verify three Google Maps APIs with billable requests"],
        ["$0 doctor --live --probes geocoding,routes", "Probe only the selected APIs"]
      ]),
      async (argv) => {
        const parsedProbes = parseDoctorProbes(argv.probes);
        if (parsedProbes.error) {
          process.stderr.write(JSON.stringify({ error: parsedProbes.error }, null, 2) + "\n");
          process.exitCode = 1;
          return;
        }
        const effectiveKey = (argv.apikey ?? "").trim() || loadConfiguredApiKey();
        const report = await runDoctor(packageVersion, effectiveKey, argv.live, void 0, {
          probes: parsedProbes.probes,
          config: resolveRuntimeConfig(loadCliSettings())
        });
        process.stdout.write(JSON.stringify(report, null, 2) + "\n");
        process.exitCode = report.success ? 0 : 1;
      }
    ).command(
      "snippet",
      "Print an MCP client registration snippet (JSON on stdout; never writes files)",
      (yargs2) => yargs2.option("client", {
        type: "string",
        choices: ["generic", "claude", "cursor", "pi"],
        default: "generic",
        description: "Target client (selects the documented target file)"
      }).option("transport", {
        type: "string",
        choices: ["stdio", "http"],
        default: "stdio",
        description: "MCP transport of the snippet"
      }).option("launcher", {
        type: "string",
        choices: ["npx", "node", "bin"],
        default: "npx",
        description: "stdio launcher command"
      }).option("command", {
        type: "string",
        description: "Absolute path to the CLI entry script (required for --launcher node)"
      }).option("host", {
        type: "string",
        default: "127.0.0.1",
        description: "Host used in the URL (transport http)"
      }).option("port", {
        type: "number",
        default: 3e3,
        description: "Port used in the URL (transport http)"
      }).option("name", {
        type: "string",
        default: "mcp-google-api",
        description: "Server name inside mcpServers"
      }).example([
        ["$0 snippet --client claude", "stdio snippet using the npx launcher"],
        ["$0 snippet --client pi --launcher node --command /abs/path/dist/cli.js", "stdio snippet with an explicit artifact"],
        ["$0 snippet --transport http --port 3100", "HTTP URL snippet"]
      ]),
      (argv) => {
        process.exitCode = runSnippetCommand({
          client: argv.client,
          transport: argv.transport,
          launcher: argv.launcher,
          commandPath: argv.command,
          host: argv.host,
          port: argv.port,
          serverName: argv.name
        });
      }
    ).command(
      "enable <cli>",
      "Enable MCP-server and skill installation for a supported CLI",
      (yargs2) => yargs2.positional("cli", {
        type: "string",
        describe: `CLI name: ${supportedCliNames()}`
      }).option("home", {
        type: "string",
        description: "Home-directory override (default: user home)"
      }).example([["$0 enable pi", "Enable pi for install/uninstall/show"]]),
      (argv) => {
        process.exitCode = runEnableDisableCliCommand(argv.cli, true, {
          home: argv.home
        });
      }
    ).command(
      "disable <cli>",
      "Disable MCP-server and skill installation for a supported CLI",
      (yargs2) => yargs2.positional("cli", {
        type: "string",
        describe: `CLI name: ${supportedCliNames()}`
      }).option("home", {
        type: "string",
        description: "Home-directory override (default: user home)"
      }).example([["$0 disable claude", "Disable claude for install/uninstall/show"]]),
      (argv) => {
        process.exitCode = runEnableDisableCliCommand(argv.cli, false, {
          home: argv.home
        });
      }
    ).command(
      "auto-update <state>",
      "Enable or disable the automatic update check at startup",
      (yargs2) => yargs2.positional("state", {
        type: "string",
        describe: "New state: enable or disable (1 and 0 accepted)"
      }).option("home", {
        type: "string",
        description: "Home-directory override (default: user home)"
      }).example([[
        "$0 auto-update disable",
        "Disable the automatic update check"
      ]]),
      (argv) => {
        process.exitCode = runAutoUpdateCommand(argv.state, {
          home: argv.home
        });
      }
    ).command(
      "tools <tools>",
      "Set the enabled tools ('*' = all 18 tools)",
      (yargs2) => yargs2.positional("tools", {
        type: "string",
        describe: "Comma-separated tool names (e.g. maps_geocode,maps_search_places) or '*' for all"
      }).option("home", {
        type: "string",
        description: "Home-directory override (default: user home)"
      }).example([
        ["$0 tools '*'", "Expose every registered tool (default)"],
        ["$0 tools maps_geocode,maps_search_places", "Expose only the named tools"]
      ]),
      (argv) => {
        process.exitCode = runToolsCommand(argv.tools, {
          home: argv.home
        });
      }
    ).command(
      "host <host>",
      "Set the HTTP bind host (default 127.0.0.1)",
      (yargs2) => yargs2.positional("host", {
        type: "string",
        describe: "Bind hostname (e.g. 127.0.0.1 loopback; 0.0.0.0 for all interfaces)"
      }).option("home", {
        type: "string",
        description: "Home-directory override (default: user home)"
      }).example([["$0 host 0.0.0.0", "Bind the HTTP server on all interfaces"]]),
      (argv) => {
        process.exitCode = runHostCommand(argv.host, {
          home: argv.home
        });
      }
    ).command(
      "port <port>",
      "Set the HTTP listen port (default 3000)",
      (yargs2) => yargs2.positional("port", {
        type: "number",
        describe: "Listen port (integer 1-65535)"
      }).option("home", {
        type: "string",
        description: "Home-directory override (default: user home)"
      }).example([["$0 port 3100", "Serve Streamable HTTP on port 3100"]]),
      (argv) => {
        process.exitCode = runPortCommand(argv.port === void 0 ? void 0 : String(argv.port), {
          home: argv.home
        });
      }
    ).command(
      "api-key <key>",
      "Save the Google Maps API key and refresh every enabled CLI registration",
      (yargs2) => yargs2.positional("key", {
        type: "string",
        describe: "Google Maps API key (20-50 characters: letters, digits, hyphens, underscores)"
      }).option("home", {
        type: "string",
        description: "Home-directory override (default: user home)"
      }).example([["$0 api-key AIzaSy...", "Save the key and reinstall every enabled CLI"]]),
      (argv) => {
        process.exitCode = runApiKeyCommand(argv.key, {
          home: argv.home,
          resourcesRoot: resolveSkillsResourcesRoot(resolve5(__dirname, ".."))
        });
      }
    ).command(
      "install",
      "Register the mcp-google-api stdio server and install packaged skills for every enabled CLI",
      (yargs2) => yargs2.option("home", {
        type: "string",
        description: "Home-directory override (default: user home)"
      }).option("debug-skills", {
        type: "boolean",
        description: "Append each skill's packaged debug overlay to the installed SKILL.md",
        default: false
      }).example([
        ["$0 install", "Register the server and skills in every enabled CLI"],
        ["$0 install --debug-skills", "Also append the packaged debug overlay to every installed skill"]
      ]),
      (argv) => {
        process.exitCode = runInstallUninstallCommand("install", {
          home: argv.home,
          resourcesRoot: resolveSkillsResourcesRoot(resolve5(__dirname, "..")),
          includeDebugSkills: argv.debugSkills === true
        });
      }
    ).command(
      "uninstall",
      "Remove the mcp-google-api server entry and managed skills from every enabled CLI",
      (yargs2) => yargs2.option("home", {
        type: "string",
        description: "Home-directory override (default: user home)"
      }).example([["$0 uninstall", "Reciprocal removal of install for every enabled CLI"]]),
      (argv) => {
        process.exitCode = runInstallUninstallCommand("uninstall", {
          home: argv.home,
          resourcesRoot: resolveSkillsResourcesRoot(resolve5(__dirname, ".."))
        });
      }
    ).command(
      "show",
      "Show CLI configuration and installation status tables (human-readable)",
      (yargs2) => yargs2.option("home", {
        type: "string",
        description: "Home-directory override (default: user home)"
      }).example([["$0 show", "Print CLI Configuration and Installation Status tables"]]),
      (argv) => {
        process.exitCode = runShowCommand({
          home: argv.home,
          resourcesRoot: resolveSkillsResourcesRoot(resolve5(__dirname, ".."))
        });
      }
    ).command(
      "exec <tool> [params]",
      "Execute a tool directly and output JSON",
      (yargs2) => {
        return yargs2.positional("tool", {
          type: "string",
          describe: `Tool name: ${EXEC_TOOLS.join(", ")}`
        }).positional("params", {
          type: "string",
          describe: "JSON parameters string"
        }).example([
          [`$0 exec maps_geocode '{"address":"Tokyo Tower"}'`, "Geocode an address"],
          [
            `$0 exec maps_search_nearby '{"center":{"value":"35.68,139.74","isCoordinates":true},"keyword":"restaurant"}'`,
            "Search nearby"
          ],
          [`$0 exec maps_search_places '{"query":"ramen in Tokyo"}'`, "Text search"]
        ]);
      },
      async (argv) => {
        const apiKey = loadConfiguredApiKey();
        if (!apiKey) {
          process.stderr.write(
            JSON.stringify(
              {
                error: "Google Maps API key is not configured. Run 'mcp-google-api api-key <your-api-key>' to configure it."
              },
              null,
              2
            ) + "\n"
          );
          process.exitCode = 1;
          return;
        }
        try {
          const params = argv.params ? JSON.parse(argv.params) : {};
          process.exitCode = await runExecCommand(argv.tool, params, apiKey);
        } catch (error) {
          process.stderr.write(JSON.stringify({ error: error.message }, null, 2) + "\n");
          process.exitCode = 1;
        }
      }
    ).command(
      "batch-geocode",
      "Geocode multiple addresses from a file (one address per line)",
      (yargs2) => {
        return yargs2.option("input", {
          alias: "i",
          type: "string",
          describe: "Input file path (one address per line). Use - for stdin.",
          demandOption: true
        }).option("output", {
          alias: "o",
          type: "string",
          describe: "Output file path (JSON). Defaults to stdout."
        }).option("concurrency", {
          alias: "c",
          type: "number",
          describe: "Max parallel requests",
          default: 20
        }).example([
          ["$0 batch-geocode -i addresses.txt", "Geocode to stdout"],
          ["$0 batch-geocode -i addresses.txt -o results.json", "Geocode to file"],
          ["cat addresses.txt | $0 batch-geocode -i -", "Geocode from stdin"]
        ]);
      },
      async (argv) => {
        const apiKey = loadConfiguredApiKey();
        if (!apiKey) {
          console.error("Error: Google Maps API key is not configured. Run 'mcp-google-api api-key <your-api-key>'.");
          process.exit(1);
        }
        let lines;
        if (argv.input === "-") {
          const rl = createInterface({ input: process.stdin });
          lines = [];
          for await (const line of rl) {
            const trimmed = line.trim();
            if (trimmed) lines.push(trimmed);
          }
        } else {
          if (!existsSync4(argv.input)) {
            console.error(`Error: File not found: ${argv.input}`);
            process.exit(1);
          }
          lines = readFileSync6(argv.input, "utf-8").split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
        }
        if (lines.length === 0) {
          console.error("Error: No addresses found in input.");
          process.exit(1);
        }
        const searcher = new PlacesSearcher(apiKey);
        const concurrency = Math.min(Math.max(argv.concurrency, 1), 50);
        const results = [];
        let completed = 0;
        const semaphore = async (tasks2, limit) => {
          const executing = [];
          for (const task of tasks2) {
            const p = task().then(() => {
              executing.splice(executing.indexOf(p), 1);
            });
            executing.push(p);
            if (executing.length >= limit) {
              await Promise.race(executing);
            }
          }
          await Promise.all(executing);
        };
        const tasks = lines.map((address, index) => async () => {
          try {
            const result = await searcher.geocode(address);
            results[index] = { address, ...result };
          } catch (error) {
            results[index] = { address, success: false, error: error.message };
          }
          completed++;
          if (!argv.output) return;
          process.stderr.write(`\r  ${completed}/${lines.length} geocoded`);
        });
        await semaphore(tasks, concurrency);
        if (argv.output) {
          process.stderr.write("\n");
        }
        const succeeded = results.filter((r) => r.success).length;
        const failed = results.filter((r) => !r.success).length;
        const summary = { total: lines.length, succeeded, failed, results };
        const json = JSON.stringify(summary, null, 2);
        if (argv.output) {
          writeFileSync4(argv.output, json, "utf-8");
          console.error(`Done: ${succeeded}/${lines.length} succeeded. Output: ${argv.output}`);
        } else {
          console.log(json);
        }
        process.exit(failed > 0 ? 1 : 0);
      }
    ).command(
      "start",
      "Start the MCP server (HTTP by default, --stdio for stdio mode)",
      buildServerCommandOptions,
      runServerCommand
    ).command(
      "run",
      "Alias of start: run the MCP server (HTTP by default, --stdio for stdio mode)",
      buildServerCommandOptions,
      runServerCommand
    ).command(
      "$0",
      "Print the help text (use start or run to launch the MCP server)",
      (yargs2) => yargs2,
      () => {
        cli.showHelp("log");
      }
    ).version(packageVersion).alias("version", "v").epilog(
      `Management commands (single flags):
  --ver         Print the installed, npmjs-latest, and GitHub-latest versions
  --version     Alias of --ver
  --upgrade     Upgrade the global package to the latest version and refresh installed skills
                --develop | --dev: install the latest tagged GitHub release (any branch)
                --force: force package re-download and complete reinstallation (npm install --force)
  --uninstall   Remove the globally installed mcp-google-api package

` + CONFIG_CLI_USAGE
    ).help();
    cli.parse();
  }
} else {
  process.exitCode = handleUndispatchedEntry(process.argv.slice(2));
}
export {
  DOCTOR_PROBES,
  EXEC_TOOLS,
  createShutdownHandler,
  describeUndispatchedServerStart,
  execTool,
  handleUndispatchedEntry,
  installShutdownHandlers,
  parseDoctorProbes,
  runApiKeyCommand,
  runAutoUpdateCommand,
  runDoctor,
  runEnableDisableCliCommand,
  runExecCommand,
  runHostCommand,
  runInstallUninstallCommand,
  runPortCommand,
  runShowCommand,
  runSnippetCommand,
  runToolsCommand,
  startServer
};
