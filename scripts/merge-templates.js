#!/usr/bin/env node

const fs = require("fs");
const path = require("path");

const OCR_VERSION = 7;
const DEFAULT_INPUT_DIR = "template-exports";
const DEFAULT_OUTPUT_FILE = "captcha-templates-master.json";
const DEFAULT_MAX_TEMPLATES = 600;

function main() {
  const inputDir = path.resolve(process.argv[2] || DEFAULT_INPUT_DIR);
  const outputFile = path.resolve(process.argv[3] || DEFAULT_OUTPUT_FILE);
  const maxTemplates = parsePositiveInt(process.argv[4], DEFAULT_MAX_TEMPLATES);

  if (!fs.existsSync(inputDir) || !fs.statSync(inputDir).isDirectory()) {
    fail(`Input folder not found: ${inputDir}`);
  }

  const files = listJsonFiles(inputDir);
  if (!files.length) {
    fail(`No .json files found in: ${inputDir}`);
  }

  const stats = {
    files: files.length,
    readTemplates: 0,
    validTemplates: 0,
    invalidTemplates: 0,
    duplicateTemplates: 0
  };

  const unique = new Map();
  for (const file of files) {
    const templates = readTemplates(file);
    stats.readTemplates += templates.length;

    for (const template of templates) {
      if (!isValidTemplate(template)) {
        stats.invalidTemplates++;
        continue;
      }

      stats.validTemplates++;
      const key = templateKey(template);
      const existing = unique.get(key);
      if (existing) {
        stats.duplicateTemplates++;
        if ((template.createdAt || 0) > (existing.createdAt || 0)) {
          unique.set(key, template);
        }
        continue;
      }

      unique.set(key, template);
    }
  }

  const balanced = balanceTemplates([...unique.values()], maxTemplates);
  const payload = {
    schema: "captcha-helper-templates",
    ocrVersion: OCR_VERSION,
    exportedAt: new Date().toISOString(),
    sourceFiles: files.map((file) => path.basename(file)).sort(),
    maxTemplates,
    stats: {
      ...stats,
      uniqueTemplates: unique.size,
      keptTemplates: balanced.length,
      digitCounts: countByDigit(balanced)
    },
    templates: balanced
  };

  fs.writeFileSync(outputFile, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

  console.log(`Merged ${stats.files} files`);
  console.log(`Read: ${stats.readTemplates}`);
  console.log(`Valid: ${stats.validTemplates}`);
  console.log(`Invalid/skipped: ${stats.invalidTemplates}`);
  console.log(`Duplicates removed: ${stats.duplicateTemplates}`);
  console.log(`Unique: ${unique.size}`);
  console.log(`Kept after balance: ${balanced.length}`);
  console.log(`Digit counts: ${JSON.stringify(payload.stats.digitCounts)}`);
  console.log(`Output: ${outputFile}`);
}

function listJsonFiles(dir) {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".json"))
    .map((entry) => path.join(dir, entry.name));
}

function readTemplates(file) {
  try {
    const raw = fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    if (Array.isArray(parsed.templates)) return parsed.templates;
    console.warn(`Skipped ${path.basename(file)}: missing templates array`);
    return [];
  } catch (error) {
    console.warn(`Skipped ${path.basename(file)}: ${error.message}`);
    return [];
  }
}

function isValidTemplate(template) {
  return Boolean(
    template &&
      template.version === OCR_VERSION &&
      /^\d$/.test(template.digit) &&
      typeof template.pattern === "string" &&
      template.pattern.length > 0 &&
      Array.isArray(template.vector) &&
      template.features
  );
}

function templateKey(template) {
  return [
    template.digit,
    template.pattern,
    Array.isArray(template.vector) ? template.vector.join("") : ""
  ].join("|");
}

function balanceTemplates(templates, maxTemplates) {
  const maxPerDigit = Math.max(1, Math.floor(maxTemplates / 10));
  const buckets = Object.fromEntries(Array.from({ length: 10 }, (_, digit) => [String(digit), []]));

  for (const template of templates) {
    buckets[template.digit].push(template);
  }

  return Object.values(buckets).flatMap((bucket) => {
    return bucket
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .slice(0, maxPerDigit)
      .reverse();
  });
}

function countByDigit(templates) {
  const counts = Object.fromEntries(Array.from({ length: 10 }, (_, digit) => [String(digit), 0]));
  for (const template of templates) {
    counts[template.digit]++;
  }
  return counts;
}

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

main();
