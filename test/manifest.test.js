// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { DEFAULT_CONFIG, TEMPERATURE_UNITS, WIND_UNITS } from '../src/config.js';
import { SCENE_TRIGGERS } from '../src/devices/tempest.js';
import { SCENE_ACTIONS, FORECAST_DAYS } from '../src/scenes.js';
import { WIDGETS } from '../src/widgets.js';
import { TEMPEST_UDP_PORT } from '../src/tempest/local.js';
import { LANGUAGES } from '../src/i18n.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const indexSource = await readFile(new URL('../index.js', import.meta.url), 'utf8');
const engineSource = await readFile(new URL('../src/tempest/engine.js', import.meta.url), 'utf8');

const keysOf = (list) => (list ?? []).map((entry) => entry.key);

// Every list of form fields the manifest can declare (same field grammar).
const allFields = [
  ...manifest.config_schema,
  ...[
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
  ].flatMap((item) => item.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
];

// The store schema is the admission authority.
const FIELD_TYPES = [
  'string',
  'number',
  'boolean',
  'select',
  'multi_select',
  'secret',
  'oauth2',
  'section',
];

function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

function isAtLeast(version, required) {
  for (let i = 0; i < required.length; i += 1) {
    if (version[i] !== required[i]) {
      return version[i] > required[i];
    }
  }
  return true;
}

test('every manifest action is registered in index.js', () => {
  for (const action of manifest.actions ?? []) {
    assert.match(
      indexSource,
      new RegExp(`onAction\\('${action.key}'`),
      `manifest action "${action.key}" has no handler`,
    );
  }
});

test('every field uses a type the store accepts', () => {
  for (const field of allFields) {
    assert.ok(FIELD_TYPES.includes(field.type), `field "${field.key}": type ${field.type}`);
  }
});

test('the manifest declares both transports and the LAN capture of the hub', () => {
  // `local` + `cloud`: Gladys shows the "Prefer the local connection" toggle,
  // read as GLADYS_PREFER_LOCAL.
  assert.deepEqual(manifest.transports, ['local', 'cloud']);
  assert.deepEqual(manifest.network_discovery, [
    { type: 'udp-broadcast', ports: [TEMPEST_UDP_PORT] },
  ]);
});

test('scene triggers, scene actions, widgets and categories require Gladys >= 5.1.0', () => {
  for (const field of ['scene_triggers', 'scene_actions', 'widgets', 'categories']) {
    assert.ok(manifest[field] !== undefined, `${field} is declared`);
  }
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  assert.ok(isAtLeast(minGladysVersion(), [5, 1, 0]), manifest.gladys_version);
});

test('every scene_actions key has a handler, and vice versa', () => {
  const declared = keysOf(manifest.scene_actions);
  assert.deepEqual([...declared].sort(), Object.keys(SCENE_ACTIONS).sort());
});

test('every widgets key has a handler, and vice versa', () => {
  const declared = keysOf(manifest.widgets);
  assert.deepEqual([...declared].sort(), Object.keys(WIDGETS).sort());
  for (const key of declared) {
    assert.equal(typeof WIDGETS[key].get, 'function');
    assert.equal(typeof WIDGETS[key].action, 'function');
  }
});

test('every scene trigger is declared and fired, and vice versa', () => {
  const declared = keysOf(manifest.scene_triggers);
  assert.deepEqual([...declared].sort(), Object.values(SCENE_TRIGGERS).sort());
  for (const name of Object.keys(SCENE_TRIGGERS)) {
    assert.ok(
      engineSource.includes(`SCENE_TRIGGERS.${name}`),
      `trigger ${name} is never fired by the engine`,
    );
  }
});

test('the forecast day options are the ones the code knows', () => {
  const day = manifest.scene_actions
    .find((a) => a.key === 'get_forecast')
    .fields.find((f) => f.key === 'day');
  assert.deepEqual(
    day.options.map((o) => o.value),
    Object.keys(FORECAST_DAYS),
  );
  assert.ok(day.default in FORECAST_DAYS);
});

test('config_schema defaults and options stay consistent with the code', () => {
  for (const field of manifest.config_schema) {
    if (field.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[field.key], field.default, `DEFAULT_CONFIG.${field.key}`);
    }
  }
  const options = (key) =>
    manifest.config_schema.find((f) => f.key === key).options.map((o) => o.value);
  assert.deepEqual(options('temperature_unit'), TEMPERATURE_UNITS);
  assert.deepEqual(options('wind_unit'), WIND_UNITS);
  assert.equal(manifest.config_schema.find((f) => f.key === 'token').type, 'secret');
});

test('section fields are purely presentational', () => {
  const sections = manifest.config_schema.filter((f) => f.type === 'section');
  assert.ok(sections.length > 0);
  for (const section of sections) {
    assert.equal(section.required, undefined);
    assert.equal(section.default, undefined);
    assert.equal(section.placeholder, undefined);
    assert.ok(!(section.key in DEFAULT_CONFIG));
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//, 'section links must be https');
    }
  }
});

test('dynamic selects declare the devices source and no static options', () => {
  for (const field of allFields.filter((f) => f.source !== undefined)) {
    assert.equal(field.source, 'devices');
    assert.equal(field.options, undefined, `field "${field.key}"`);
  }
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version, 'manifest version must match package.json');
  assert.equal(manifest.docker_image, `ghcr.io/prohand/gladys-weatherflow:${manifest.version}`);
});

/** Every multi-language object of the manifest, with where it sits. */
function multiLanguageTexts(node, path = 'manifest') {
  if (Array.isArray(node)) {
    return node.flatMap((child, index) => multiLanguageTexts(child, `${path}[${index}]`));
  }
  if (node === null || typeof node !== 'object') {
    return [];
  }
  const keys = Object.keys(node);
  if (keys.includes('en') && keys.every((key) => /^[a-z]{2}$/.test(key))) {
    return [{ path, text: node }];
  }
  return keys.flatMap((key) => multiLanguageTexts(node[key], `${path}.${key}`));
}

test('every multi-language text of the manifest carries en, fr, de and es', () => {
  // Gladys shows the reader's language and falls back to English: a text
  // missing one of them shows up in English in the middle of a translated
  // screen. The store accepts any two-letter key, so nothing else catches it.
  const texts = multiLanguageTexts(manifest);
  assert.ok(texts.length > 50, `only ${texts.length} texts found`);
  for (const { path, text } of texts) {
    assert.deepEqual(Object.keys(text).sort(), [...LANGUAGES].sort(), `${path}: languages`);
    for (const language of LANGUAGES) {
      assert.equal(typeof text[language], 'string', `${path}.${language}`);
      assert.ok(text[language].trim().length > 0, `${path}.${language} is empty`);
    }
  }
});

test('labels, descriptions and placeholders are multi-language objects', () => {
  for (const field of allFields) {
    for (const key of ['label', 'description', 'placeholder']) {
      if (field[key] !== undefined) {
        assert.equal(typeof field[key], 'object', `field "${field.key}": ${key}`);
      }
    }
  }
});

test('the per-language length limits of the store hold in every language', () => {
  const within = (text, min, max, where) => {
    for (const language of LANGUAGES) {
      const { length } = text[language];
      assert.ok(length >= min && length <= max, `${where}.${language}: ${length} characters`);
    }
  };
  within(manifest.description, 10, 100, 'description');
  for (const widget of manifest.widgets) {
    within(widget.label, 3, 30, `widget ${widget.key} label`);
    within(widget.description, 1, 100, `widget ${widget.key} description`);
  }
  for (const section of manifest.config_schema.filter((f) => f.type === 'section')) {
    within(section.description, 1, 1000, `section ${section.key} description`);
  }
});

test('the documentation exists in every language', async () => {
  for (const language of LANGUAGES) {
    const doc = await readFile(new URL(`../docs/${language}.md`, import.meta.url), 'utf8');
    assert.ok(doc.length > 1000, `docs/${language}.md`);
  }
});
