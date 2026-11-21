#!/usr/bin/env node
/**
 * Translation coverage checker.
 *
 * Recursively compares the keys in messages/en.json (source) against
 * each target locale (default: es, pt-BR) and reports:
 *   - missing keys (present in EN, absent in target)
 *   - extra keys   (present in target, absent in EN)
 *
 * Exits non-zero when any target locale's coverage is below 100%.
 *
 * Usage: node scripts/check-translations.mjs [--source en] [--target es] [--target pt-BR]
 */

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MESSAGES_DIR = resolve(__dirname, "..", "messages");

const DEFAULT_TARGETS = ["es", "pt-BR"];

function parseArgs(argv) {
  const args = { source: "en", targets: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--source" && argv[i + 1]) {
      args.source = argv[++i];
    } else if (arg === "--target" && argv[i + 1]) {
      args.targets.push(argv[++i]);
    } else if (arg.startsWith("--source=")) {
      args.source = arg.slice("--source=".length);
    } else if (arg.startsWith("--target=")) {
      args.targets.push(arg.slice("--target=".length));
    }
  }
  if (args.targets.length === 0) {
    args.targets = [...DEFAULT_TARGETS];
  }
  return args;
}

function loadJson(filePath) {
  let raw;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (err) {
    console.error(`Failed to read ${filePath}: ${err.message}`);
    process.exit(2);
  }
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.error(`Failed to parse ${filePath}: ${err.message}`);
    process.exit(2);
  }
}

/**
 * Recursively collect all leaf key paths from an object.
 * Leaf = any non-plain-object value (string, number, boolean, array, null).
 * Arrays are treated as leaves so their contents are not diffed key-by-key.
 */
function collectKeys(obj, prefix = "", out = new Set()) {
  if (obj === null || typeof obj !== "object" || Array.isArray(obj)) {
    if (prefix) out.add(prefix);
    return out;
  }
  const entries = Object.entries(obj);
  if (entries.length === 0 && prefix) {
    // Empty object — treat as a leaf so it is still tracked.
    out.add(prefix);
    return out;
  }
  for (const [key, value] of entries) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (
      value !== null &&
      typeof value === "object" &&
      !Array.isArray(value)
    ) {
      collectKeys(value, path, out);
    } else {
      out.add(path);
    }
  }
  return out;
}

/**
 * Check a single target locale against the source keys.
 * Returns true when the target is fully in sync (no missing or extra keys).
 */
function checkTarget(source, sourceKeys, target) {
  const targetPath = resolve(MESSAGES_DIR, `${target}.json`);
  const targetJson = loadJson(targetPath);
  const targetKeys = collectKeys(targetJson);

  const missing = [...sourceKeys].filter((k) => !targetKeys.has(k)).sort();
  const extra = [...targetKeys].filter((k) => !sourceKeys.has(k)).sort();

  const total = sourceKeys.size;
  const covered = total - missing.length;
  const coverage = total === 0 ? 100 : (covered / total) * 100;

  console.log(`Translation coverage check: ${source} -> ${target}`);
  console.log(`  Source keys (${source}): ${total}`);
  console.log(`  Target keys (${target}): ${targetKeys.size}`);
  console.log(`  Covered: ${covered}/${total} (${coverage.toFixed(2)}%)`);

  if (missing.length > 0) {
    console.log(`\nMissing keys in ${target}.json (${missing.length}):`);
    for (const key of missing) {
      console.log(`  - ${key}`);
    }
  }

  if (extra.length > 0) {
    console.log(`\nExtra keys in ${target}.json not present in ${source}.json (${extra.length}):`);
    for (const key of extra) {
      console.log(`  + ${key}`);
    }
  }

  if (missing.length === 0 && extra.length === 0) {
    console.log(`\n✓ ${target}.json is fully in sync with ${source}.json.`);
    return true;
  }

  if (coverage < 100) {
    console.error(
      `\n✗ Translation coverage for "${target}" is ${coverage.toFixed(2)}%, below the required 100%.`
    );
    return false;
  }

  // Coverage is 100% but there are extra keys — warn but do not fail.
  console.warn(
    `\n⚠ ${target}.json has extra keys not present in ${source}.json. Coverage is 100%.`
  );
  return true;
}

function main() {
  const { source, targets } = parseArgs(process.argv.slice(2));

  const sourcePath = resolve(MESSAGES_DIR, `${source}.json`);
  const sourceJson = loadJson(sourcePath);
  const sourceKeys = collectKeys(sourceJson);

  let allOk = true;
  for (const target of targets) {
    console.log("");
    const ok = checkTarget(source, sourceKeys, target);
    if (!ok) allOk = false;
  }

  if (!allOk) {
    process.exit(1);
  }
  process.exit(0);
}

main();