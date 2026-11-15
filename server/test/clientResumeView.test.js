import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const clientRoot = fileURLToPath(new URL('../../client/', import.meta.url));
const require = createRequire(path.join(clientRoot, 'package.json'));
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { transformWithOxc } = await import(pathToFileURL(require.resolve('vite')).href);

// Transform JSX in memory only. This starts no server and reads no env files or app database.
const compiled = new Map();
async function componentUrl(filename) {
  if (compiled.has(filename)) return compiled.get(filename);
  const promise = (async () => {
    const result = await transformWithOxc(fs.readFileSync(filename, 'utf8'), filename, { jsx: { runtime: 'automatic', development: false } });
    const imports = [...result.code.matchAll(/\bfrom\s+(['"])([^'"]+)\1/g)];
    const urls = new Map();
    for (const [, , specifier] of imports) {
      if (urls.has(specifier)) continue;
      let target;
      if (specifier.startsWith('.')) {
        target = path.resolve(path.dirname(filename), specifier);
        if (!path.extname(target)) target += '.js';
        urls.set(specifier, target.endsWith('.jsx') ? await componentUrl(target) : pathToFileURL(target).href);
      } else urls.set(specifier, pathToFileURL(require.resolve(specifier)).href);
    }
    const code = result.code.replace(/\bfrom\s+(['"])([^'"]+)\1/g, (_match, quote, specifier) => `from ${quote}${urls.get(specifier)}${quote}`);
    return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
  })();
  compiled.set(filename, promise);
  return promise;
}
const { ResumeTailorView } = await import(await componentUrl(path.join(clientRoot, 'src/ResumeTailor.jsx')));
const ats = { hasResume: true, score: 47, missing: ['aws'], matched: ['sql'], requirements: [], checks: [{ label: 'Sections', ok: true }] };
let requests;
beforeEach((t) => {
  requests = 0;
  t.mock.method(globalThis, 'fetch', async () => { requests++; throw new Error('Rendering must not fetch experience or generate a resume'); });
});
const render = (props = {}) => renderToStaticMarkup(React.createElement(ResumeTailorView, { ats, ...props }));
const detailsTag = (html, label) => {
  const summary = html.indexOf(`<summary>${label}`);
  assert.notEqual(summary, -1, `The ${label} disclosure should exist`);
  const start = html.lastIndexOf('<details', summary);
  return html.slice(start, html.indexOf('>', start) + 1);
};

test('the initial screen offers Tailor without mounting the optional bank or any required form', () => {
  const html = render();
  const mainAction = html.match(/<button\b([^>]*)>Tailor my resume<\/button>/);
  assert.ok(mainAction);
  assert.doesNotMatch(mainAction[1], /disabled/);
  assert.doesNotMatch(html, /<form\b|<textarea\b|\srequired(?:=|\s|>)/);
  assert.doesNotMatch(html, /Add experience missing from your resume|Loading your saved experience/);
  assert.doesNotMatch(detailsTag(html, 'Additional details'), /\sopen(?:=|\s|>)/);
  assert.doesNotMatch(detailsTag(html, 'Analysis details'), /\sopen(?:=|\s|>)/);
  assert.equal(requests, 0);
});

test('a generated resume is immediately visible as a document with working export actions outside analysis', () => {
  const tailored = { ats_after: 88, text: 'The exact exported plain text', resume: {
    name: 'Morgan Example', headline: 'Software Engineer', contact: ['morgan@example.invalid'],
    summary: 'Built applications using Python and SQL.', skills: ['Python', 'SQL'],
    skillGroups: [{ name: 'Languages', items: ['Python', 'SQL'] }],
    sections: [{ title: 'Experience', items: [{ heading: 'Developer', subheading: 'Example company', dates: 'Dates supplied by user', bullets: ['Built an internal reporting tool.'] }] }],
  }, report: { after: { score: 88, missing: [], matched: ['sql'], checks: [] } } };
  const html = render({ tailored });
  assert.match(html, />Re-tailor resume<\/button>/);
  assert.match(html, />Download Word<\/button>/);
  assert.match(html, />Copy text<\/button>/);
  assert.match(html, /<article[^>]*aria-label="Tailored resume preview"/);
  for (const text of ['Morgan Example', 'morgan@example.invalid', 'Professional Summary', 'Languages:', 'Example company', 'Built an internal reporting tool.']) assert.ok(html.includes(text));
  assert.ok(html.indexOf('<article') < html.indexOf('<details'), 'the actual document must precede optional review disclosures');
  assert.doesNotMatch(html, /<pre\b/);
  assert.equal(requests, 0);
});

test('only active work disables tailoring; optional unchecked skills do not gate the main action', () => {
  const idle = render({ choices: { confirmed: [], learning: [] } });
  assert.doesNotMatch(idle.match(/<button\b([^>]*)>Tailor my resume<\/button>/)[1], /disabled/);
  const busy = render({ busy: true });
  assert.match(busy.match(/<button\b([^>]*)>Tailoring your resume…<\/button>/)[1], /disabled/);
  assert.match(busy, /role="status"/);
  assert.equal(requests, 0);
});
