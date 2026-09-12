import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const recipeDirectory = join(repositoryRoot, "recipes");
const promptDirectory = join(repositoryRoot, "prompts");
const skillDirectory = join(repositoryRoot, "skills", "enhe-product-video");

const expectedRecipeFiles = [
  "before-after.v1.json",
  "cta.v1.json",
  "feature-focus.v1.json",
  "hero-hook.v1.json",
  "problem-solution.v1.json",
  "product-promo-45s.v1.json",
  "social-proof.v1.json",
  "ui-walkthrough.v1.json",
];

const requiredRecipeFields = [
  "id",
  "version",
  "purpose",
  "whenToUse",
  "whenNotToUse",
  "requiredInputs",
  "recommendedDuration",
  "layoutContract",
  "motionContract",
  "transitionOptions",
  "captionRules",
  "fallbacks",
  "qaRules",
];

const expectedPromptFiles = [
  "composition-builder.v1.md",
  "product-analysis.v1.md",
  "qa-repair.v1.md",
  "script-writer.v1.md",
  "storyboard-director.v1.md",
];

function read(relativePath: string): string {
  return readFileSync(join(repositoryRoot, relativePath), "utf8");
}

function hasContent(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return value !== null && typeof value === "object" && Object.keys(value).length > 0;
}

test("ships exactly the eight versioned v1 recipe contracts with useful required fields", () => {
  const files = readdirSync(recipeDirectory).filter((file) => file.endsWith(".json")).sort();
  assert.deepEqual(files, expectedRecipeFiles);

  for (const file of files) {
    const recipe = JSON.parse(readFileSync(join(recipeDirectory, file), "utf8")) as Record<string, unknown>;
    assert.equal(recipe.id, basename(file, ".json"), `${file} id must match its filename`);
    assert.equal(recipe.version, "1.0.0", `${file} must declare semantic version 1.0.0`);
    for (const field of requiredRecipeFields) {
      assert.ok(field in recipe, `${file} is missing ${field}`);
      assert.ok(hasContent(recipe[field]), `${file}.${field} must be useful, not empty`);
    }
  }
});

test("all recipe references resolve to a versioned recipe file", () => {
  const knownIds = new Set(expectedRecipeFiles.map((file) => basename(file, ".json")));
  const composite = JSON.parse(
    readFileSync(join(recipeDirectory, "product-promo-45s.v1.json"), "utf8"),
  ) as { sequence: Array<{ recipe: string; alternative?: string }> };

  assert.ok(Array.isArray(composite.sequence) && composite.sequence.length >= 6);
  for (const step of composite.sequence) {
    assert.ok(knownIds.has(step.recipe), `unresolved recipe reference: ${step.recipe}`);
    if (step.alternative) {
      assert.ok(knownIds.has(step.alternative), `unresolved alternative recipe: ${step.alternative}`);
    }
  }
});

test("the default 45-second composite sequence adds up to its declared target", () => {
  const composite = JSON.parse(
    readFileSync(join(recipeDirectory, "product-promo-45s.v1.json"), "utf8"),
  ) as {
    recommendedDuration: { targetSec: number };
    sequence: Array<{ targetDurationSec: number }>;
  };
  const total = composite.sequence.reduce((sum, step) => sum + step.targetDurationSec, 0);
  assert.equal(total, composite.recommendedDuration.targetSec);
});

test("ships five versioned prompts with explicit inputs, outputs, and evidence boundaries", () => {
  const files = readdirSync(promptDirectory).filter((file) => file.endsWith(".md")).sort();
  assert.deepEqual(files, expectedPromptFiles);

  for (const file of files) {
    const prompt = readFileSync(join(promptDirectory, file), "utf8");
    const expectedVersion = file === "script-writer.v1.md" ? "1\\.2\\.0"
      : file === "storyboard-director.v1.md" ? "1\\.2\\.0" : file === "composition-builder.v1.md" ? "1\\.1\\.0" : "1\\.0\\.0";
    assert.match(prompt, new RegExp(`^---\\r?\\n[\\s\\S]*?^version: ${expectedVersion}\\r?$`, "m"), `${file} version`);
    assert.match(prompt, /^## Inputs$/m, `${file} inputs`);
    assert.match(prompt, /^## Output contract$/m, `${file} output contract`);
    assert.match(prompt, /evidence|证据|来源/i, `${file} evidence boundary`);
  }
});

test("repository skill links every required reference and documents all thirteen stages", () => {
  const skillPath = join(skillDirectory, "SKILL.md");
  assert.ok(existsSync(skillPath));
  const skill = readFileSync(skillPath, "utf8");
  const references = ["input-contract.md", "workflow.md", "qa-checklist.md", "recipes.md"];

  for (const reference of references) {
    assert.ok(existsSync(join(skillDirectory, "references", reference)), `missing ${reference}`);
    assert.match(skill, new RegExp(`references/${reference.replace(".", "\\.")}`));
  }

  const workflow = readFileSync(join(skillDirectory, "references", "workflow.md"), "utf8");
  const orderedStages = [
    "Read rules and input",
    "Preflight",
    "Capture & Understand",
    "DESIGN.md gate",
    "SCRIPT.md",
    "STORYBOARD.md + video-spec.json",
    "Voice, transcript, and timing",
    "Build HyperFrames compositions",
    "Lint, validate, and inspect",
    "Draft render",
    "QA repair",
    "Final render",
    "Media probe, scorecard, and report",
  ];
  let cursor = -1;
  for (const stage of orderedStages) {
    const next = workflow.indexOf(stage, cursor + 1);
    assert.ok(next > cursor, `workflow stage missing or out of order: ${stage}`);
    cursor = next;
  }
});

test("a new supplied-assets, narration-none input has documented coverage through the workflow", () => {
  const newInput = {
    product: {
      name: "Field Notes Atlas",
      url: "https://example.invalid/products/field-notes-atlas",
      oneLiner: "Turn research notes into a navigable evidence map.",
      targetAudience: ["independent researchers"],
      primaryProblem: "Sources and conclusions become disconnected.",
      features: [
        { name: "Evidence links", benefit: "Trace every claim", evidenceAssetIds: ["atlas-screen"] },
      ],
      cta: { label: "View the demo", url: "https://example.invalid/demo" },
    },
    brand: { logoAssetId: "atlas-logo", colors: ["#101828"], fontFamilies: ["Inter"] },
    assets: [
      { id: "atlas-logo", license: "owned", path: "input assets/atlas-logo.svg" },
      { id: "atlas-screen", license: "authorized", path: "input assets/atlas-screen.png" },
    ],
    output: { locale: "en-US" },
    audio: { narrationMode: "none" },
  };

  assert.equal(newInput.audio.narrationMode, "none");
  assert.ok(newInput.assets.every((asset) => asset.license !== "unknown"));

  const inputContract = read("skills/enhe-product-video/references/input-contract.md");
  const workflow = read("skills/enhe-product-video/references/workflow.md");
  const recipeGuide = read("skills/enhe-product-video/references/recipes.md");
  const qaChecklist = read("skills/enhe-product-video/references/qa-checklist.md");

  for (const term of ["product name", "one-line description", "target audience", "primary problem", "CTA", "output locale", "narration mode"]) {
    assert.match(inputContract, new RegExp(term, "i"));
  }
  assert.match(workflow, /supplied-assets/);
  assert.match(workflow, /narrationMode=none/);
  assert.match(workflow, /DESIGN\.md/);
  assert.match(workflow, /video-spec\.json/);
  assert.match(recipeGuide, /product-promo-45s\.v1/);
  assert.match(qaChecklist, /license=unknown/);
  assert.match(qaChecklist, /final/i);
});

test("usage documentation matches the implemented CLI command surface and resume semantics", () => {
  const readme = read("README.md");
  const inputGuide = read("docs/guides/INPUT-GUIDE.md");
  const workflow = read("skills/enhe-product-video/references/workflow.md");

  for (const expected of [
    "npm run video -- help",
    "--supplied-only",
    "--quality draft",
    "--quality high",
    ".tools/npm/bin/npm-cli.js",
  ]) {
    assert.match(readme, new RegExp(expected.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(inputGuide, /credential-free HTTP\(S\)/);
  assert.match(inputGuide, /product\.url.*may be empty/i);
  assert.match(inputGuide, /CTA.*required/i);
  assert.match(workflow, /HyperFrames `capture`/);
  assert.match(workflow, /automatic fallback to `supplied-assets`/);
  assert.match(workflow, /`verify-input`, `capture`, `qa`, `render`, and `run`.*`--resume`/);
  assert.match(workflow, /output.*missing.*bytes.*change/i);
  assert.match(inputGuide, /run-history\.json/);
  assert.match(workflow, /render-high-report\.json/);
  assert.doesNotMatch(workflow, /only `render` and `run` use `--resume`/);
});

test("current jobs use the normal voice route while direct synthesis remains historical", () => {
  const skill = read("skills/enhe-product-video/SKILL.md");
  const workflow = read("skills/enhe-product-video/references/workflow.md");
  const inputContract = read("skills/enhe-product-video/references/input-contract.md");
  const qaChecklist = read("skills/enhe-product-video/references/qa-checklist.md");
  const ttsGuide = read("docs/guides/CHINESE-TTS.md");

  assert.match(skill, /中文旁白[\s\S]*CHINESE-TTS\.md/);
  assert.match(workflow, /npm run video -- voice --project <id>/);
  assert.doesNotMatch(workflow, /synthesize-zh\.py/);
  assert.doesNotMatch(workflow, /editable portrait/i);
  assert.match(workflow, /author ending[^\n]*complete five-item editable contact text/i);
  assert.match(workflow, /Do not add a portrait/i);
  assert.doesNotMatch(qaChecklist, /editable portrait/i);
  assert.match(qaChecklist, /author ending[^\n]*complete five-item editable contact text/i);
  assert.match(qaChecklist, /Do not require or add a portrait/i);
  assert.match(inputContract, /`hyperframes`:[^\n]*(legacy|historical)[^\n]*(current|video voice)/i);
  assert.match(workflow, /phrase|句级/i);
  assert.match(workflow, /ASR[\s\S]*逐词/i);
  assert.match(workflow, /audio[\s\S]*字幕[\s\S]*(hash|SHA-256)/i);
  assert.match(qaChecklist, /audio stream/i);
  assert.match(qaChecklist, /midpoint|中点/i);
  assert.match(qaChecklist, /boundary|边界/i);
  assert.match(qaChecklist, /reverse.seek|反向跳转/i);
  assert.match(qaChecklist, /听审[\s\S]*NOT_RUN/i);

  const currentMarker = ttsGuide.indexOf("## 当前新任务入口");
  const historicalMarker = ttsGuide.indexOf("## 历史基准重放");
  assert.ok(currentMarker >= 0, "Chinese TTS guide must identify the current entry point");
  assert.ok(historicalMarker > currentMarker, "historical benchmark instructions must follow the current route");
  const currentSection = ttsGuide.slice(currentMarker, historicalMarker);
  const historicalSection = ttsGuide.slice(historicalMarker);
  assert.match(currentSection, /npm run video -- voice --project <id>/);
  assert.doesNotMatch(currentSection, /prepare-zh-variants\.mjs|synthesize-zh\.py|build-benchmark-compositions\.mjs/);
  assert.match(historicalSection, /prepare-zh-variants\.mjs/);
  assert.match(historicalSection, /synthesize-zh\.py/);
  assert.match(historicalSection, /run --project \$id --resume --supplied-only/);
  assert.match(workflow, /post-authoring deterministic chain/i);
});

test("Chinese narration guidance does not invent an ENHE Chinese brand name", () => {
  const authored = read("docs/creative/zh-narration-scripts.json");
  assert.doesNotMatch(authored, /恩禾/);
});
