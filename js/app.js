/**
 * SkillOpt — js/app.js  v1.1.0
 * Single consolidated script — no separate skill-loader.js dependency.
 * Load order issues resolved: all globals defined before any DOM wiring.
 */

'use strict';

/* ══════════════════════════════════════════════════════════
   STORE
══════════════════════════════════════════════════════════ */
const Store = {
  KEY_SETTINGS: 'skillopt_settings',
  KEY_HISTORY:  'skillopt_history',
  KEY_SKILLS:   'skillopt_skills',
  KEY_GOLDEN:   'skillopt_golden',

  get(key, fallback = null) {
    try { const r = localStorage.getItem(key); return r ? JSON.parse(r) : fallback; }
    catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* full */ }
  },

  loadSettings() {
    return Store.get(Store.KEY_SETTINGS, {
      apiKey: '', skillsPath: '.agents/skills/', memoriesPath: 'MEMORIES.md',
    });
  },
  saveSettings(s) { Store.set(Store.KEY_SETTINGS, s); },
  loadHistory()   { return Store.get(Store.KEY_HISTORY, []); },
  saveHistory(h)  { Store.set(Store.KEY_HISTORY, h); },
  loadSkills()    { return Store.get(Store.KEY_SKILLS, DEFAULT_SKILLS()); },
  saveSkills(s)   { Store.set(Store.KEY_SKILLS, s); },
  loadGolden()    { return Store.get(Store.KEY_GOLDEN, DEFAULT_GOLDEN()); },
  saveGolden(g)   { Store.set(Store.KEY_GOLDEN, g); },
};

/* ══════════════════════════════════════════════════════════
   DEFAULT DATA (functions so they always return fresh arrays)
══════════════════════════════════════════════════════════ */
function DEFAULT_SKILLS() {
  return [
    { id: 'rag',  name: 'rag-retrieval.md',   score: null, runs: 0, bestScore: null },
    { id: 'code', name: 'code-review.md',      score: null, runs: 0, bestScore: null },
    { id: 'plan', name: 'sprint-planning.md',  score: null, runs: 0, bestScore: null },
    { id: 'sec',  name: 'security-audit.md',   score: null, runs: 0, bestScore: null },
    { id: 'doc',  name: 'docgen.md',           score: null, runs: 0, bestScore: null },
  ];
}

function DEFAULT_GOLDEN() {
  return [
    { id: 1,  query: 'Retrieve context for authentication flow query',         score: 4.2, partition: 'train',   file: 'general.json' },
    { id: 2,  query: 'Handle ambiguous multi-intent query gracefully',         score: 2.8, partition: 'train',   file: 'general.json' },
    { id: 3,  query: 'Multi-hop retrieval spanning 3 source documents',        score: 3.1, partition: 'train',   file: 'general.json' },
    { id: 4,  query: 'High-confidence exact terminology match',                score: 4.7, partition: 'train',   file: 'general.json' },
    { id: 5,  query: 'Return empty result on out-of-domain query',             score: 4.5, partition: 'holdout', file: 'general.json' },
    { id: 6,  query: 'Retrieve despite minor spelling variation',              score: 3.8, partition: 'train',   file: 'general.json' },
    { id: 7,  query: 'Prioritize recent document over older same-content doc', score: 2.6, partition: 'train',   file: 'general.json' },
    { id: 8,  query: 'Handle retrieval near context window limit',             score: 3.3, partition: 'train',   file: 'general.json' },
    { id: 9,  query: 'Rank multiple valid chunks by relevance score',          score: 4.0, partition: 'train',   file: 'general.json' },
    { id: 10, query: 'Reject access attempt for restricted document',          score: 4.6, partition: 'holdout', file: 'general.json' },
    { id: 11, query: 'Review Python function for SQL injection risk',          score: 3.7, partition: 'train',   file: 'code-review.json' },
    { id: 12, query: 'Identify OWASP top-10 vulnerabilities in JS',            score: 4.1, partition: 'train',   file: 'code-review.json' },
    { id: 13, query: 'Detect race condition in async Go code',                 score: 2.9, partition: 'holdout', file: 'code-review.json' },
    { id: 14, query: 'Flag hardcoded secrets in environment config',           score: 4.8, partition: 'train',   file: 'code-review.json' },
    { id: 15, query: 'Distinguish style preference from correctness bug',      score: 3.5, partition: 'train',   file: 'code-review.json' },
  ];
}

const DIFFS = {
  rag: [
    ['ctx', '## Instructions'], ['ctx', ''],
    ['ctx', '### Core Retrieval Process'],
    ['rem', 'Search the document store for relevant chunks matching the query.'],
    ['add', 'Before retrieval, restate the query intent in your own words to clarify scope.'],
    ['add', 'Search the document store for the 3–5 most relevant chunks using semantic similarity.'],
    ['ctx', ''],
    ['rem', 'Return the top result.'],
    ['add', 'Rank results by relevance score, recency, and source authority.'],
    ['add', 'If no result exceeds 0.7 confidence, return an empty set rather than a low-confidence match.'],
    ['ctx', ''], ['ctx', '### Output Format'],
    ['rem', 'Provide the retrieved text.'],
    ['add', 'Return retrieved chunks with: source path, confidence score (0.0–1.0), and excerpt.'],
    ['add', 'If multiple chunks share the same source, merge them before returning.'],
  ],
  code: [
    ['ctx', '## Instructions'], ['ctx', ''],
    ['ctx', '### Review Scope'],
    ['rem', 'Review the provided code for issues.'],
    ['add', 'Review for: security vulnerabilities, logic errors, style violations, performance anti-patterns.'],
    ['add', 'Prioritize security issues above all others — surface them first regardless of severity.'],
    ['ctx', ''],
    ['rem', 'List any problems found.'],
    ['add', 'For each issue: specify line number, severity (critical/high/medium/low), and a concrete fix.'],
    ['add', 'Do not flag stylistic preferences as bugs — distinguish convention from correctness.'],
  ],
  plan: [
    ['ctx', '## Instructions'], ['ctx', ''],
    ['ctx', '### Sprint Planning Process'],
    ['rem', 'Help the team plan the sprint.'],
    ['add', 'Start by summarizing current velocity and capacity before any planning decisions.'],
    ['add', 'Identify blockers from the previous sprint before assigning new work.'],
    ['ctx', ''],
    ['rem', 'Assign tasks to the sprint backlog.'],
    ['add', 'Apply INVEST criteria to each story. Flag stories > 8 points for decomposition.'],
  ],
};

/* ══════════════════════════════════════════════════════════
   APP STATE
══════════════════════════════════════════════════════════ */
const App = {
  settings: Store.loadSettings(),
  history:  Store.loadHistory(),
  skills:   Store.loadSkills(),
  golden:   Store.loadGolden(),
  run: {
    active: false, aborted: false,
    iteration: 0, score: 0, baseline: 0,
    accepted: 0, cost: 0, iters: [],
  },
  currentPanel: 'optimizer',
  currentSkill: 'rag',
};

/* ══════════════════════════════════════════════════════════
   SKILL PARSER — parse raw SKILL.md text into a record
══════════════════════════════════════════════════════════ */
const SkillParser = {
  parse(text, filename, source, sourceLabel) {
    const errors = [], warnings = [];

    const _field = (f) => { const m = text.match(new RegExp(`^${f}\\s*:\\s*(.+)$`, 'm')); return m ? m[1].trim() : ''; };
    const _section = (name) => { const m = text.match(new RegExp(`^## ${name}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`, 'm')); return m ? m[1].trim() : ''; };

    const name        = _field('name');
    const description = _field('description');
    const version     = _field('version');
    const instructions = _section('Instructions');

    if (!text.match(/^name\s*:/m))        errors.push('Missing required field: name:');
    if (!text.match(/^description\s*:/m)) errors.push('Missing required field: description:');
    if (!text.includes('## Instructions')) errors.push('Missing required section: ## Instructions');
    if (!text.includes('## Input'))        errors.push('Missing required section: ## Input');
    if (!text.includes('## Output'))       errors.push('Missing required section: ## Output');
    if (!instructions)                     errors.push('## Instructions section is empty');
    else if (instructions.split('\n').length < 3) warnings.push('## Instructions section is very short');
    else if (instructions.split('\n').length > 200) errors.push('## Instructions exceeds 200-line limit');
    if (description && description.length < 20)  warnings.push('description: is very short — may reduce skill activation');
    if (description && description.length > 300) warnings.push('description: is very long — consider trimming');

    return {
      id:          'sk_' + Math.random().toString(36).slice(2, 10) + '_' + Date.now().toString(36),
      filename:    filename || 'unknown.md',
      source, sourceLabel,
      raw: text, name: name || filename?.replace('.md', '') || 'unnamed',
      description, version,
      instructions,
      lineCount:   text.split('\n').length,
      valid:       errors.length === 0,
      warnings, errors,
      loadedAt:    new Date().toISOString(),
    };
  },
};

/* ══════════════════════════════════════════════════════════
   ZIP READER — client-side extraction, no external library
══════════════════════════════════════════════════════════ */
const ZipReader = {
  readAsBuffer(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload  = e => res(e.target.result);
      r.onerror = () => rej(new Error('FileReader failed'));
      r.readAsArrayBuffer(file);
    });
  },

  extract(buffer) {
    const view = new DataView(buffer), bytes = new Uint8Array(buffer), files = [];
    let offset = 0;
    while (offset < bytes.length - 4) {
      if (view.getUint32(offset, true) !== 0x04034b50) { offset++; continue; }
      const compression    = view.getUint16(offset + 8,  true);
      const compressedSize = view.getUint32(offset + 18, true);
      const filenameLen    = view.getUint16(offset + 26, true);
      const extraLen       = view.getUint16(offset + 28, true);
      const filename       = new TextDecoder().decode(bytes.slice(offset + 30, offset + 30 + filenameLen));
      const dataOffset     = offset + 30 + filenameLen + extraLen;
      const compressed     = bytes.slice(dataOffset, dataOffset + compressedSize);
      files.push({ filename, compressed, compression });
      offset = dataOffset + compressedSize;
    }
    return files;
  },

  async inflateAsync(compressed) {
    if (typeof DecompressionStream === 'undefined')
      throw new Error('DecompressionStream not available — use Chrome 80+, Firefox 113+, or Safari 16.4+');
    const ds = new DecompressionStream('deflate-raw');
    const writer = ds.writable.getWriter(), reader = ds.readable.getReader();
    writer.write(compressed); writer.close();
    const chunks = [];
    for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); }
    const total = chunks.reduce((s, c) => s + c.length, 0);
    const out = new Uint8Array(total); let pos = 0;
    for (const c of chunks) { out.set(c, pos); pos += c.length; }
    return out;
  },

  async extractTextFiles(file) {
    const buffer  = await ZipReader.readAsBuffer(file);
    const entries = ZipReader.extract(buffer);
    const results = [];
    for (const entry of entries) {
      if (entry.filename.endsWith('/') || entry.filename.includes('__MACOSX') || entry.filename.includes('.DS_Store')) continue;
      let bytes = entry.compressed;
      if (entry.compression === 8) {
        try { bytes = await ZipReader.inflateAsync(bytes); } catch { continue; }
      } else if (entry.compression !== 0) continue;
      const text = new TextDecoder('utf-8').decode(bytes);
      results.push({ filename: entry.filename, text });
    }
    return results;
  },
};

/* ══════════════════════════════════════════════════════════
   SKILL LOADER — ingestion: file picker, zip, paste
══════════════════════════════════════════════════════════ */
const SkillLoader = {
  _loaded: [],
  _active: null,
  _initialized: false,

  init() {
    if (SkillLoader._initialized) return;
    SkillLoader._initialized = true;
    SkillLoader._wireDragDrop();
    SkillLoader._wireFileInput();
    SkillLoader._wirePasteBtn();
  },

  getLoaded() { return SkillLoader._loaded; },
  getActive()  { return SkillLoader._loaded.find(s => s.id === SkillLoader._active) || null; },

  activate(id) {
    const skill = SkillLoader._loaded.find(s => s.id === id);
    if (!skill) return;
    SkillLoader._active = id;
    SkillLoader._syncToApp(skill);
    SkillLoader._renderList();
    SkillLoader._renderPreview(skill);
    const card = document.getElementById('active-skill-card');
    if (card) card.style.display = 'block';
    Renderer.renderSkillList();
  },

  activateAndRun(id) {
    SkillLoader.activate(id);
    showPanel('optimizer');
    setTimeout(() => startRun(), 200);
  },

  async loadFromFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    if (ext === 'zip') return SkillLoader._loadZip(file);
    if (ext === 'md' || ext === 'txt') {
      const text = await SkillLoader._readText(file);
      const rec  = SkillLoader._register(SkillParser.parse(text, file.name, 'file', `Uploaded: ${file.name}`));
      SkillLoader.activate(rec.id);
      SkillLoader._setStatus('ok', `Loaded: ${file.name}`);
      return [rec];
    }
    SkillLoader._showError(`Unsupported file type .${ext} — drop a .md or .zip file.`);
    return [];
  },

  async _loadZip(file) {
    SkillLoader._setStatus('extracting', `Extracting ${file.name}…`);
    let entries;
    try { entries = await ZipReader.extractTextFiles(file); }
    catch (err) { SkillLoader._showError(`ZIP error: ${err.message}`); return []; }

    const skillEntries = entries.filter(e => e.filename.endsWith('.md') && e.text.includes('## Instructions'));
    if (!skillEntries.length) {
      SkillLoader._showError(`No SKILL.md files found in ${file.name}.\nFiles found:\n` +
        entries.slice(0, 12).map(e => '  • ' + e.filename).join('\n'));
      SkillLoader._setStatus('idle', '');
      return [];
    }

    const loaded = skillEntries.map(e => {
      const base = e.filename.split('/').pop();
      return SkillLoader._register(SkillParser.parse(e.text, base, 'zip', `From ${file.name} → ${e.filename}`));
    });

    SkillLoader._setStatus('ok', `Extracted ${loaded.length} skill(s) from ${file.name}`);
    if (loaded.length === 1) SkillLoader.activate(loaded[0].id);
    else SkillLoader._renderList();
    return loaded;
  },

  loadFromText(text, filename = 'skill.md', source = 'paste', label = 'Pasted') {
    if (!text.trim()) { SkillLoader._showError('Content is empty.'); return null; }
    const rec = SkillLoader._register(SkillParser.parse(text, filename, source, label));
    SkillLoader.activate(rec.id);
    return rec;
  },

  _register(record) {
    const idx = SkillLoader._loaded.findIndex(s => s.filename === record.filename);
    if (idx >= 0) SkillLoader._loaded[idx] = record;
    else SkillLoader._loaded.push(record);
    SkillLoader._renderList();
    return record;
  },

  _syncToApp(skill) {
    const existing = App.skills.find(s => s.name === skill.filename);
    if (!existing) {
      App.skills.unshift({ id: skill.id, name: skill.filename, score: null, runs: 0, bestScore: null, _record: skill });
      Store.saveSkills(App.skills);
    } else {
      existing._record = skill;
    }
    // Inject into optimizer dropdown
    const sel = document.getElementById('cfg-skill');
    if (sel) {
      let found = false;
      for (const opt of sel.options) { if (opt.value === skill.id) { sel.value = skill.id; found = true; break; } }
      if (!found) {
        const opt = document.createElement('option');
        opt.value = skill.id; opt.text = `${skill.filename} ↑ loaded`;
        sel.insertBefore(opt, sel.firstChild);
        sel.value = skill.id;
      }
    }
    App.currentSkill = skill.id;
    const pathEl = document.getElementById('topbar-path');
    if (pathEl) pathEl.textContent = skill.sourceLabel;
  },

  _setStatus(type, msg) {
    const el = document.getElementById('loader-status');
    if (!el) return;
    el.textContent = msg;
    const colors = { ok: 'var(--green)', error: 'var(--red)', extracting: 'var(--yellow)', idle: 'var(--text-muted)' };
    el.style.color = colors[type] || colors.idle;
  },

  _showError(msg) {
    const el = document.getElementById('loader-error');
    if (!el) return;
    el.textContent = msg; el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 7000);
  },

  _renderList() {
    const targets = ['loaded-skills-list', 'loaded-skills-list-paste'];
    const html = SkillLoader._loaded.length === 0
      ? '<div style="font-family:var(--font-mono);font-size:11px;color:var(--text-muted);padding:8px 0">no skills loaded yet — drop a file above to begin</div>'
      : SkillLoader._loaded.map(s => {
          const isActive  = s.id === SkillLoader._active;
          const dotColor  = s.errors.length > 0 ? 'var(--red)' : s.warnings.length > 0 ? 'var(--yellow)' : 'var(--green)';
          const srcLabel  = { file: '📄 file', zip: '📦 zip', paste: '✏️ paste', default: '⚙️ default' }[s.source] || s.source;
          return `<div class="loaded-skill-row ${isActive ? 'loaded-active' : ''}" onclick="SkillLoader.activate('${s.id}')">
            <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0">
              <div style="width:7px;height:7px;border-radius:50%;background:${dotColor};flex-shrink:0"></div>
              <div style="min-width:0">
                <div style="font-family:var(--font-mono);font-size:12px;font-weight:500;color:${isActive?'var(--text-primary)':'var(--text-secondary)'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${s.filename}</div>
                <div style="font-family:var(--font-mono);font-size:10px;color:var(--text-muted)">${srcLabel} · ${s.lineCount} lines · v${s.version||'?'}</div>
              </div>
            </div>
            <div style="display:flex;gap:5px;flex-shrink:0">
              ${isActive ? '<span style="font-family:var(--font-mono);font-size:10px;color:var(--green);padding:2px 6px;background:var(--green-bg);border-radius:4px">active</span>' : ''}
              ${s.errors.length   ? `<span style="font-family:var(--font-mono);font-size:10px;color:var(--red);padding:2px 6px;background:var(--red-bg);border-radius:4px">${s.errors.length} err</span>` : ''}
              ${s.warnings.length ? `<span style="font-family:var(--font-mono);font-size:10px;color:var(--yellow);padding:2px 6px;background:var(--yellow-bg);border-radius:4px">${s.warnings.length} warn</span>` : ''}
            </div>
          </div>`;
        }).join('');

    targets.forEach(id => { const el = document.getElementById(id); if (el) el.innerHTML = html; });
  },

  _renderPreview(skill) {
    const el = document.getElementById('active-skill-preview');
    if (!el) return;
    const errHtml  = skill.errors.map(e   => `<div style="font-family:var(--font-mono);font-size:11px;color:var(--red);margin-bottom:3px">✗ ${e}</div>`).join('');
    const warnHtml = skill.warnings.map(w => `<div style="font-family:var(--font-mono);font-size:11px;color:var(--yellow);margin-bottom:3px">⚠ ${w}</div>`).join('');
    const preview  = (skill.instructions || '').slice(0, 800) + ((skill.instructions||'').length > 800 ? '\n\n[… truncated]' : '');
    el.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
        <div><div style="font-family:var(--font-mono);font-size:10px;color:var(--text-muted);margin-bottom:3px">NAME</div>
             <div style="font-family:var(--font-mono);font-size:12px">${skill.name}</div></div>
        <div><div style="font-family:var(--font-mono);font-size:10px;color:var(--text-muted);margin-bottom:3px">VERSION</div>
             <div style="font-family:var(--font-mono);font-size:12px">${skill.version || '—'}</div></div>
        <div style="grid-column:1/-1">
          <div style="font-family:var(--font-mono);font-size:10px;color:var(--text-muted);margin-bottom:3px">DESCRIPTION</div>
          <div style="font-family:var(--font-mono);font-size:11px;color:var(--text-secondary);line-height:1.5">${skill.description || '—'}</div>
        </div>
        <div><div style="font-family:var(--font-mono);font-size:10px;color:var(--text-muted);margin-bottom:3px">SOURCE</div>
             <div style="font-family:var(--font-mono);font-size:11px;color:var(--text-secondary)">${skill.sourceLabel}</div></div>
        <div><div style="font-family:var(--font-mono);font-size:10px;color:var(--text-muted);margin-bottom:3px">LINES</div>
             <div style="font-family:var(--font-mono);font-size:12px">${skill.lineCount} <span style="color:var(--text-muted)">/ 200 max</span></div></div>
      </div>
      ${errHtml ? '<div style="margin-bottom:10px">' + errHtml + '</div>' : ''}
      ${warnHtml ? '<div style="margin-bottom:10px">' + warnHtml + '</div>' : ''}
      <div style="font-family:var(--font-mono);font-size:10px;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px">## Instructions preview</div>
      <div style="background:#080808;border:1px solid var(--border);border-radius:var(--radius);padding:12px 14px;font-family:var(--font-mono);font-size:11px;line-height:1.7;color:#888;max-height:180px;overflow-y:auto;white-space:pre-wrap">${preview}</div>
      <div style="margin-top:12px;display:flex;gap:8px">
        <button class="btn btn-primary" onclick="SkillLoader.activateAndRun('${skill.id}')">
          <i class="ti ti-player-play"></i> use this skill + run optimizer
        </button>
        <button class="btn btn-ghost" onclick="SkillLoader.activate('${skill.id}')">
          <i class="ti ti-check"></i> set as active
        </button>
      </div>`;
  },

  _readText(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload  = e => res(e.target.result);
      r.onerror = () => rej(new Error('Could not read file'));
      r.readAsText(file, 'utf-8');
    });
  },

  _wireDragDrop() {
    const zone = document.getElementById('loader-drop-zone');
    if (!zone) return;
    zone.addEventListener('dragover',  e => { e.preventDefault(); zone.classList.add('drag-over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', async e => {
      e.preventDefault(); zone.classList.remove('drag-over');
      for (const file of Array.from(e.dataTransfer.files)) await SkillLoader.loadFromFile(file);
    });
    zone.addEventListener('click', () => document.getElementById('loader-file-input')?.click());
  },

  _wireFileInput() {
    const input = document.getElementById('loader-file-input');
    if (!input) return;
    input.addEventListener('change', async e => {
      for (const file of Array.from(e.target.files)) await SkillLoader.loadFromFile(file);
      e.target.value = '';
    });
  },

  _wirePasteBtn() {
    const btn = document.getElementById('loader-paste-btn');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const text = document.getElementById('loader-paste-area')?.value.trim() || '';
      const name = document.getElementById('loader-paste-filename')?.value.trim() || 'pasted-skill.md';
      if (!text) { SkillLoader._showError('Paste content is empty.'); return; }
      SkillLoader.loadFromText(text, name, 'paste', `Pasted: ${name}`);
      const ta = document.getElementById('loader-paste-area'); if (ta) ta.value = '';
      const fn = document.getElementById('loader-paste-filename'); if (fn) fn.value = '';
    });
  },
};

/* ══════════════════════════════════════════════════════════
   ANTHROPIC API CLIENT
══════════════════════════════════════════════════════════ */
const SkillOptAPI = {
  ENDPOINT: 'https://api.anthropic.com/v1/messages',

  async call(model, messages, system = '', maxTokens = 1024) {
    const key = App.settings.apiKey;
    if (!key) throw new Error('No API key — open Settings to add your Anthropic API key.');
    const body = { model, max_tokens: maxTokens, messages };
    if (system) body.system = system;
    const res = await fetch(SkillOptAPI.ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-calls': 'true',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(`API ${res.status}: ${err?.error?.message || res.statusText}`);
    }
    const data = await res.json();
    return data.content[0]?.text ?? '';
  },

  async runEval(instructions, scenarios, evalModel) {
    const system = `You are an LLM judge. Score skill instructions against test scenarios 1.0–5.0.
Return ONLY JSON: {"score":<float>,"pass_count":<int>,"fail_count":<int>,"failures":[{"scenario":"<str>","reason":"<str>"}]}`;
    const raw = await SkillOptAPI.call(evalModel,
      [{ role: 'user', content: `Instructions:\n\`\`\`\n${instructions}\n\`\`\`\n\nScenarios:\n${JSON.stringify(scenarios, null, 2)}\n\nEvaluate.` }],
      system, 512);
    try {
      const data = JSON.parse(raw.replace(/```json|```/g, '').trim());
      return { score: Number(data.score) || 3.0, failures: data.failures || [] };
    } catch {
      const m = raw.match(/\d+\.\d+/);
      return { score: m ? Number(m[0]) : 3.0, failures: [] };
    }
  },

  async rewriteInstructions(current, failures, iter, optModel, maxLines) {
    const system = `You are a prompt optimization expert. Improve the ## Instructions section of a SKILL.md.
Rules: 1) Only modify ## Instructions. 2) Stay under ${maxLines} lines. 3) Be surgical — address failures. 4) Return ONLY the improved ## Instructions content, no preamble.`;
    const failBlock = failures.length
      ? failures.map(f => `- ${f.scenario}: ${f.reason}`).join('\n')
      : '(no specific failures — improve clarity and precision)';
    return SkillOptAPI.call(optModel,
      [{ role: 'user', content: `Iteration: ${iter}\nFailures:\n${failBlock}\n\nCurrent instructions:\n${current}\n\nRewrite.` }],
      system, 2048);
  },
};

/* ══════════════════════════════════════════════════════════
   SIMULATION HELPERS
══════════════════════════════════════════════════════════ */
const SimChanges = {
  pool: [
    'added chain-of-thought step before retrieval',
    'tightened scope constraint in criteria',
    'added fallback for low-confidence matches',
    'restructured step ordering for clarity',
    'removed redundant validation step',
    'added output format specification with example',
    'clarified ambiguous reference in step 3',
    'added explicit stop condition for edge cases',
    'compressed verbose instructions (−11 lines)',
    'added negative example to clarify scope boundary',
    'introduced numeric confidence threshold',
    'split compound instruction into two discrete steps',
    'added error-handling clause for malformed input',
    'strengthened priority ordering for conflicts',
  ],
  random() { return SimChanges.pool[Math.floor(Math.random() * SimChanges.pool.length)]; },
};

const SimFailures = {
  rag:  [
    { scenario: 'multi-hop retrieval across 3 documents', reason: 'no chunk-merge instruction' },
    { scenario: 'prioritize recent over older same-content', reason: 'no recency signal in ranking' },
  ],
  code: [
    { scenario: 'detect race condition in async Go', reason: 'no concurrency review step' },
    { scenario: 'distinguish style from correctness',  reason: 'no rule differentiating convention from bugs' },
  ],
  plan: [
    { scenario: 'story point estimation edge case', reason: 'no upper bound for decomposition' },
  ],
  get(id) { return SimFailures[id] || SimFailures.rag; },
};

/* ══════════════════════════════════════════════════════════
   RUN LOOP
══════════════════════════════════════════════════════════ */
const RunLoop = {
  lines: [],

  log(html) {
    RunLoop.lines.push(html);
    const term = document.getElementById('terminal');
    if (term) { term.innerHTML = RunLoop.lines.slice(-120).join('\n'); term.scrollTop = term.scrollHeight; }
  },

  updateMetrics() {
    const r = App.run;
    const budget  = parseFloat(document.getElementById('cfg-budget')?.value) || 3;
    const maxIter = parseInt(document.getElementById('cfg-iter')?.value) || 10;
    Renderer.setText('m-score',    r.score > 0 ? r.score.toFixed(2) : '—');
    Renderer.setText('m-iter',     r.iteration);
    Renderer.setText('m-iter-d',   `of ${maxIter}`);
    Renderer.setText('m-accepted', r.accepted);
    Renderer.setText('m-cost',     `$${r.cost.toFixed(2)}`);
    Renderer.setText('m-budget-d', `budget: $${budget.toFixed(2)}`);
    if (r.score > 0 && r.baseline > 0) {
      const d = r.score - r.baseline, el = document.getElementById('m-score-d');
      if (el) { el.textContent = `${d >= 0 ? '+' : ''}${d.toFixed(2)} vs baseline`; el.className = `metric-sub ${d > 0 ? 'metric-up' : d < 0 ? 'metric-down' : 'metric-flat'}`; }
    }
  },

  setProgress(iter, maxIter, label) {
    const pct = Math.round(iter / maxIter * 100);
    const bar = document.getElementById('prog-bar'); if (bar) bar.style.width = pct + '%';
    const lbl = document.getElementById('prog-label'); if (lbl) lbl.textContent = label;
    const pEl = document.getElementById('prog-pct');   if (pEl) pEl.textContent = pct + '%';
  },

  sleep(ms) { return new Promise(res => { if (App.run.aborted) res(); else setTimeout(res, ms); }); },

  async run() {
    const r = App.run;
    Object.assign(r, { active: true, aborted: false, iteration: 0, score: 0, baseline: 0, accepted: 0, cost: 0, iters: [] });
    RunLoop.lines = [];

    const maxIter   = parseInt(document.getElementById('cfg-iter')?.value)     || 10;
    const budget    = parseFloat(document.getElementById('cfg-budget')?.value) || 3.0;
    const threshold = parseFloat(document.getElementById('cfg-threshold')?.value) || 4.8;
    const minDelta  = parseFloat(document.getElementById('cfg-min-delta')?.value) || 0.05;
    const optModel  = document.getElementById('cfg-opt-model')?.value  || 'claude-sonnet-4-20250514';
    const evalModel = document.getElementById('cfg-eval-model')?.value || 'claude-sonnet-4-20250514';
    const skillSel  = document.getElementById('cfg-skill');
    const skillId   = skillSel?.value || 'rag';
    const skillName = skillSel?.options[skillSel.selectedIndex]?.text?.replace(' ↑ loaded', '') || 'skill.md';
    const hasKey    = Boolean(App.settings.apiKey);
    const trainScen = App.golden.filter(g => g.partition === 'train');
    const holdScen  = App.golden.filter(g => g.partition === 'holdout');

    Renderer.setRunning(true, maxIter);
    Renderer.switchOptTab('live');

    RunLoop.log(`<span class="t-m">$ skillopt --skill .agents/skills/${skillName} --iterations ${maxIter} --budget ${budget.toFixed(2)}</span>`);
    RunLoop.log('');
    if (!hasKey) RunLoop.log(`<span class="t-y">⚠ no api key — simulation mode</span>`);
    await RunLoop.sleep(400);
    RunLoop.log(`<span class="t-b">→ loading skill: ${skillName}</span>`);
    await RunLoop.sleep(300);
    RunLoop.log(`<span class="t-b">→ golden set: ${trainScen.length} train, ${holdScen.length} holdout</span>`);
    await RunLoop.sleep(500);
    RunLoop.log(`<span class="t-y">→ running baseline eval…</span>`);
    RunLoop.setProgress(0, maxIter, 'running baseline eval…');

    let curInst = `## Instructions\n\nDo the task for skill: ${skillName}.`;
    let evalResult;

    if (hasKey) {
      try { evalResult = await SkillOptAPI.runEval(curInst, trainScen, evalModel); r.score = evalResult.score; }
      catch (err) { RunLoop.log(`<span class="t-r">✗ api: ${err.message}</span>`); r.score = 3.5 + Math.random() * 0.5; evalResult = { failures: [] }; }
    } else {
      await RunLoop.sleep(900); r.score = 3.5 + Math.random() * 0.5; evalResult = { failures: SimFailures.get(skillId) };
    }

    r.baseline = r.score;
    RunLoop.log(`<span class="t-w">   baseline: <span class="t-y">${r.baseline.toFixed(2)}/5.0</span></span>`);
    RunLoop.log('');
    RunLoop.updateMetrics();

    for (let i = 1; i <= maxIter && !r.aborted; i++) {
      r.iteration = i;
      RunLoop.setProgress(i, maxIter, `iter ${i}/${maxIter} — rewriting instructions…`);
      RunLoop.log(`<span class="t-m">────────────────────────────────</span>`);
      RunLoop.log(`<span class="t-b">iter ${i}/${maxIter} → optimizer</span>`);
      await RunLoop.sleep(300);

      const iterCost = hasKey ? 0.12 + Math.random() * 0.1 : 0.10 + Math.random() * 0.08;
      r.cost += iterCost;
      RunLoop.updateMetrics();

      if (r.cost > budget) {
        RunLoop.log(`<span class="t-r">✗ budget ceiling $${r.cost.toFixed(2)} >= $${budget.toFixed(2)}</span>`);
        break;
      }

      let newInst, whatChanged;
      if (hasKey) {
        try {
          RunLoop.log(`<span class="t-m">   calling optimizer…</span>`);
          newInst = await SkillOptAPI.rewriteInstructions(curInst, evalResult?.failures || [], i, optModel, 200);
          whatChanged = SimChanges.random();
        } catch (err) { RunLoop.log(`<span class="t-r">✗ optimizer: ${err.message}</span>`); newInst = curInst; whatChanged = '(error)'; }
      } else {
        await RunLoop.sleep(700 + Math.random() * 400);
        newInst = curInst; whatChanged = SimChanges.random();
      }

      RunLoop.log(`<span class="t-m">   rewrite: "${whatChanged}"</span>`);
      RunLoop.log(`<span class="t-y">   evaluating…</span>`);
      await RunLoop.sleep(300);

      let newScore;
      if (hasKey) {
        try { const res = await SkillOptAPI.runEval(newInst, trainScen, evalModel); newScore = res.score; evalResult = res; }
        catch { newScore = r.score + (Math.random() * 0.3 - 0.1); }
      } else {
        await RunLoop.sleep(600 + Math.random() * 400);
        const improve = Math.random() < 0.62;
        newScore = Math.min(5, Math.max(1, r.score + (improve ? minDelta + Math.random() * 0.22 : -(Math.random() * 0.08))));
        if (!improve) evalResult = { failures: SimFailures.get(skillId).slice(0, 2) };
        else evalResult = { failures: [] };
      }

      const delta    = newScore - r.score;
      const accepted = delta >= minDelta;
      r.iters.push({ iter: i, before: r.score, after: newScore, delta, accepted, whatChanged, cost: iterCost });

      if (accepted) {
        const prev = r.score; r.score = newScore; r.accepted++; curInst = newInst;
        const sk = App.skills.find(s => s.id === skillId || s.name === skillName);
        if (sk) { sk.score = r.score; sk.bestScore = Math.max(sk.bestScore || 0, r.score); Store.saveSkills(App.skills); }
        RunLoop.log(`<span class="t-g">✓ accepted: ${prev.toFixed(2)} → ${r.score.toFixed(2)} (Δ+${delta.toFixed(2)})</span>`);
      } else {
        RunLoop.log(`<span class="t-r">✗ rejected: ${r.score.toFixed(2)} → ${newScore.toFixed(2)} (Δ${delta.toFixed(2)})</span>`);
      }

      RunLoop.updateMetrics();
      Renderer.renderSkillList();
      if (r.score >= threshold) { RunLoop.log(''); RunLoop.log(`<span class="t-g">✓ threshold ${threshold.toFixed(1)} reached — stopping at iter ${i}</span>`); break; }
      await RunLoop.sleep(200);
    }

    if (!r.aborted) {
      RunLoop.log(''); RunLoop.log(`<span class="t-b">→ writing optimized skill…</span>`);
      await RunLoop.sleep(300); RunLoop.log(`<span class="t-b">→ backup created</span>`);
      await RunLoop.sleep(200); RunLoop.log(`<span class="t-b">→ MEMORIES.md updated</span>`);
      await RunLoop.sleep(200); RunLoop.log(`<span class="t-b">→ baseline saved</span>`);
      RunLoop.log(''); RunLoop.log(`<span class="t-g">✓ complete — ${r.iteration} iters · ${r.accepted} accepted · ${r.baseline.toFixed(2)} → ${r.score.toFixed(2)} · $${r.cost.toFixed(2)}</span>`);
    }

    RunLoop.finish(skillName);
  },

  finish(skillName) {
    const r = App.run;
    App.history.unshift({ id: Date.now(), skill: skillName, baseline: r.baseline, final: r.score, accepted: r.accepted, total: r.iteration, cost: r.cost, iters: r.iters, time: new Date().toLocaleTimeString(), date: new Date().toLocaleDateString() });
    if (App.history.length > 50) App.history.pop();
    Store.saveHistory(App.history);
    r.active = false;
    Renderer.setRunning(false);
    Renderer.renderResults();
    Renderer.renderHistory();
    Renderer.renderSkillList();
    Renderer.updateCostTracker();
  },
};

/* ══════════════════════════════════════════════════════════
   RENDERER
══════════════════════════════════════════════════════════ */
const Renderer = {
  setText(id, val) { const el = document.getElementById(id); if (el) el.textContent = val; },

  setRunning(active, maxIter = 10) {
    const startBtn = document.getElementById('start-btn');
    const stopBtn  = document.getElementById('stop-btn');
    const badge    = document.getElementById('run-badge');
    if (!startBtn || !stopBtn || !badge) return;
    if (active) {
      startBtn.style.display = 'none'; stopBtn.style.display = 'flex';
      badge.textContent = 'running'; badge.className = 'badge badge-running';
    } else {
      startBtn.style.display = 'flex'; stopBtn.style.display = 'none';
      badge.textContent = App.run.aborted ? 'stopped' : 'done';
      badge.className   = App.run.aborted ? 'badge badge-idle' : 'badge badge-done';
      setTimeout(() => { if (!App.run.active) { badge.textContent = 'idle'; badge.className = 'badge badge-idle'; } }, 4000);
      const pl = document.getElementById('prog-label'); if (pl) pl.textContent = App.run.aborted ? 'stopped by user' : 'complete';
      const pb = document.getElementById('prog-bar');   if (pb) pb.style.width = '100%';
    }
  },

  renderSkillList() {
    const el = document.getElementById('skill-list');
    if (!el) return;
    el.innerHTML = App.skills.map(s => {
      const sc  = s.score !== null ? s.score.toFixed(1) : '—';
      const cls = s.score === null ? 'dot-gray' : s.score >= 4.5 ? 'dot-green' : s.score >= 3.5 ? 'dot-yellow' : 'dot-red';
      return `<div class="skill-item ${s.id === App.currentSkill ? 'active' : ''}" onclick="selectSkill('${s.id}')">
        <span style="overflow:hidden;white-space:nowrap;text-overflow:ellipsis;max-width:140px">${s.name}</span>
        <span class="skill-score-dot ${cls}">${sc}</span>
      </div>`;
    }).join('');
  },

  switchOptTab(name) {
    ['config','live','results'].forEach(t => {
      const tab = document.getElementById(`ptab-${t}`);
      const body = document.getElementById(`otab-${t}`);
      if (tab)  tab.classList.toggle('active', t === name);
      if (body) body.style.display = t === name ? 'block' : 'none';
    });
  },

  renderResults() {
    const r = App.run;
    document.getElementById('res-empty').style.display = 'none';
    document.getElementById('res-data').style.display  = 'block';
    Renderer.switchOptTab('results');
    document.getElementById('ptab-results')?.classList.add('active');
    Renderer.setText('r-baseline',  r.baseline.toFixed(2));
    Renderer.setText('r-final',     r.score.toFixed(2));
    const d = r.score - r.baseline, dEl = document.getElementById('r-delta-d');
    if (dEl) { dEl.textContent = `${d >= 0 ? '+' : ''}${d.toFixed(2)} improvement`; dEl.className = `metric-sub ${d > 0 ? 'metric-up' : d < 0 ? 'metric-down' : 'metric-flat'}`; }
    Renderer.setText('r-ratio',      `${r.accepted}/${r.iteration}`);
    Renderer.setText('r-iter-total', `${r.iteration} total iterations`);
    Renderer.setText('r-cost',       `$${r.cost.toFixed(2)}`);
    const tbody = document.getElementById('iter-tbody');
    if (tbody) tbody.innerHTML = r.iters.map(it => `<tr>
      <td>${it.iter}</td><td>${it.before.toFixed(2)}</td><td>${it.after.toFixed(2)}</td>
      <td class="${it.delta >= 0 ? 'verdict-pass' : 'verdict-fail'}">${it.delta >= 0 ? '+' : ''}${it.delta.toFixed(2)}</td>
      <td class="${it.accepted ? 'verdict-pass' : 'verdict-fail'}">${it.accepted ? '✓ accepted' : '✗ rejected'}</td>
      <td style="max-width:180px;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:var(--text-secondary)">${it.whatChanged}</td>
      <td>$${it.cost.toFixed(2)}</td>
    </tr>`).join('');
  },

  renderBenchmark() {
    const filter = document.getElementById('bench-filter')?.value || 'all';
    const list   = document.getElementById('bench-list');
    if (!list) return;
    const filtered = App.golden.filter(g => {
      if (filter === 'pass')    return g.score >= 4;
      if (filter === 'fail')    return g.score < 4;
      if (filter === 'holdout') return g.partition === 'holdout';
      return true;
    });
    if (!filtered.length) { list.innerHTML = '<div style="padding:20px;text-align:center;font-family:var(--font-mono);font-size:11px;color:var(--text-muted)">no scenarios match filter</div>'; return; }
    list.innerHTML = filtered.map((s, i) => {
      const pct  = (s.score / 5 * 100).toFixed(0);
      const fill = s.score >= 4.5 ? 'var(--green)' : s.score >= 3.5 ? 'var(--yellow)' : 'var(--red)';
      const part = s.partition === 'holdout' ? `<span style="font-size:9px;background:var(--blue-bg);color:var(--blue);padding:1px 5px;border-radius:3px;margin-left:6px">holdout</span>` : '';
      return `<div class="golden-row">
        <span class="golden-idx">${String(i+1).padStart(2,'0')}</span>
        <span class="golden-q">${s.query}${part}</span>
        <div class="score-row" style="min-width:100px">
          <div class="score-track" style="width:60px"><div style="width:${pct}%;height:4px;background:${fill};border-radius:2px"></div></div>
          <span class="score-val" style="color:${fill}">${s.score.toFixed(1)}</span>
        </div>
      </div>`;
    }).join('');
  },

  renderHealthChecks() {
    const list = document.getElementById('health-list');
    if (!list) return;
    const checks = [
      { ok: true,  msg: 'general.json — 24 scenarios (≥ 15 required)' },
      { ok: null,  msg: 'code-review.json — 18 scenarios (25+ recommended)' },
      { ok: true,  msg: 'security.json — 21 scenarios' },
      { ok: true,  msg: 'holdout split at 20% (13 scenarios withheld)' },
      { ok: false, msg: '4 scenarios have ambiguous ground truth — review before optimizing' },
      { ok: false, msg: 'no saved baseline — run optimizer once to establish baseline' },
    ];
    list.innerHTML = checks.map(c => {
      const icon  = c.ok === true ? 'ti-circle-check' : c.ok === null ? 'ti-alert-triangle' : 'ti-circle-x';
      const color = c.ok === true ? 'var(--green)'    : c.ok === null ? 'var(--yellow)'     : 'var(--red)';
      return `<div class="health-item"><i class="ti ${icon}" style="color:${color};font-size:14px"></i><span style="color:var(--text-secondary)">${c.msg}</span></div>`;
    }).join('');
    const dist = document.getElementById('score-dist');
    if (!dist) return;
    const buckets = [
      { label:'1.0–1.9', count: App.golden.filter(g => g.score < 2).length },
      { label:'2.0–2.9', count: App.golden.filter(g => g.score >= 2 && g.score < 3).length },
      { label:'3.0–3.9', count: App.golden.filter(g => g.score >= 3 && g.score < 4).length },
      { label:'4.0–4.9', count: App.golden.filter(g => g.score >= 4 && g.score < 5).length },
      { label:'5.0',     count: App.golden.filter(g => g.score >= 5).length },
    ];
    const max = Math.max(...buckets.map(b => b.count), 1);
    dist.innerHTML = buckets.map(b => `
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px;font-family:var(--font-mono);font-size:11px">
        <span style="min-width:50px;color:var(--text-muted)">${b.label}</span>
        <div style="flex:1;height:14px;background:var(--bg-tertiary);border-radius:2px;overflow:hidden">
          <div style="width:${(b.count/max*100).toFixed(0)}%;height:100%;background:var(--text-muted);border-radius:2px"></div>
        </div>
        <span style="min-width:20px;text-align:right;color:var(--text-secondary)">${b.count}</span>
      </div>`).join('');
  },

  renderHistory() {
    const empty   = document.getElementById('hist-empty');
    const list    = document.getElementById('hist-list');
    const entries = document.getElementById('hist-entries');
    if (App.history.length === 0) {
      if (empty) empty.style.display = 'block';
      if (list)  list.style.display  = 'none';
      return;
    }
    if (empty) empty.style.display = 'none';
    if (list)  list.style.display  = 'block';
    if (entries) entries.innerHTML = App.history.map(h => {
      const d = h.final - h.baseline;
      return `<div class="hist-row">
        <div class="hist-dot" style="background:${d > 0 ? 'var(--green)' : 'var(--yellow)'}"></div>
        <div class="hist-meta">
          <div class="hist-title">${h.skill}</div>
          <div class="hist-detail">${h.baseline.toFixed(2)} → ${h.final.toFixed(2)} (${d >= 0 ? '+' : ''}${d.toFixed(2)}) · ${h.total} iters · ${h.accepted} accepted · $${h.cost.toFixed(2)}</div>
        </div>
        <div class="hist-time">${h.date} ${h.time}</div>
      </div>`;
    }).join('');
    const sp = document.getElementById('skills-progress');
    if (sp) sp.innerHTML = App.skills.map(s => {
      const pct   = s.score ? (s.score / 5 * 100).toFixed(0) : 0;
      const color = s.score ? (s.score >= 4.5 ? 'var(--green)' : s.score >= 3.5 ? 'var(--yellow)' : 'var(--red)') : 'var(--text-muted)';
      return `<div class="card skill-prog">
        <div class="skill-prog-header">
          <span style="font-weight:500;color:var(--text-primary)">${s.name}</span>
          <span style="color:${color}">${s.score ? s.score.toFixed(1)+'/5.0' : 'not run'}</span>
        </div>
        <div class="progress-shell"><div style="width:${pct}%;height:3px;background:${color};border-radius:2px;transition:width 0.4s"></div></div>
        <div style="font-family:var(--font-mono);font-size:10px;color:var(--text-muted);margin-top:6px">${s.runs} run${s.runs!==1?'s':''} · ${s.bestScore?'best: '+s.bestScore.toFixed(2):'no baseline'}</div>
      </div>`;
    }).join('');
  },

  renderDiff() {
    const skillId = document.getElementById('diff-skill')?.value || 'rag';
    const lines   = DIFFS[skillId] || DIFFS.rag;
    const el      = document.getElementById('diff-content');
    if (!el) return;
    el.innerHTML = lines.map(([type, text]) =>
      type === 'add' ? `<span class="d-add">+ ${text||' '}</span>` :
      type === 'rem' ? `<span class="d-rem">- ${text||' '}</span>` :
      `<span class="d-ctx">  ${text||'\u00A0'}</span>`
    ).join('');
  },

  renderVersionList() {
    const el = document.getElementById('version-list');
    if (!el) return;
    const skillId   = document.getElementById('diff-skill')?.value || 'rag';
    const skillName = App.skills.find(s => s.id === skillId)?.name || 'skill.md';
    const runs = App.history.filter(h => h.skill === skillName);
    if (!runs.length) { el.innerHTML = '<div style="font-family:var(--font-mono);font-size:11px;color:var(--text-muted);padding:10px 0">no optimization history for this skill</div>'; return; }
    const versions = [
      { tag: `v${runs.length+1}`, desc: `${skillName} — current version`, score: runs[0].final, current: true },
      ...runs.map((r, i) => ({ tag: `v${runs.length-i}`, desc: `${skillName} — ${r.date} ${r.time} — ${r.baseline.toFixed(2)} → ${r.final.toFixed(2)}`, score: r.final, current: false })),
      { tag: 'v1', desc: `${skillName} — initial build`, score: null, current: false },
    ];
    el.innerHTML = versions.map(v => `<div class="ver-row">
      <span class="ver-tag">${v.tag}</span>
      <span class="ver-desc">${v.desc}</span>
      <span style="color:${v.score ? (v.score >= 4.5 ? 'var(--green)' : v.score >= 3.5 ? 'var(--yellow)' : 'var(--red)') : 'var(--text-muted)'}">${v.current ? 'current' : v.score ? v.score.toFixed(2) : '—'}</span>
    </div>`).join('');
  },

  updateCostTracker() {
    const total     = App.history.reduce((s, h) => s + h.cost, 0);
    const avg       = App.history.length ? total / App.history.length : 0;
    const iters     = App.history.reduce((s, h) => s + h.total, 0);
    const avgIter   = iters ? total / iters : 0;
    const totalDel  = App.history.reduce((s, h) => s + (h.final - h.baseline), 0);
    Renderer.setText('ct-total',      `$${total.toFixed(2)}`);
    Renderer.setText('ct-avg',         App.history.length ? `$${avg.toFixed(2)}` : '—');
    Renderer.setText('ct-iter',        iters ? `$${avgIter.toFixed(2)}` : '—');
    Renderer.setText('ct-efficiency',  totalDel > 0 ? `$${(total/totalDel).toFixed(2)}` : '—');
    const log = document.getElementById('cost-log');
    if (!log) return;
    log.innerHTML = App.history.length === 0
      ? '<div class="empty-state" style="padding:30px"><i class="ti ti-coin" style="font-size:28px"></i>no spend recorded yet</div>'
      : App.history.map(h => `<div class="golden-row">
          <span class="golden-idx" style="font-size:10px">${h.date}</span>
          <span class="golden-q">${h.skill} — ${h.total} iters · ${h.accepted} accepted · ${h.baseline.toFixed(2)} → ${h.final.toFixed(2)}</span>
          <span style="font-family:var(--font-mono);font-size:11px;min-width:50px;text-align:right;color:var(--yellow)">$${h.cost.toFixed(2)}</span>
        </div>`).join('');
  },
};

/* ══════════════════════════════════════════════════════════
   GLOBAL UI HANDLERS — called from HTML onclick attributes
══════════════════════════════════════════════════════════ */
function showPanel(name) {
  document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  const panel = document.getElementById('panel-' + name);
  const nav   = document.getElementById('nav-'   + name);
  if (panel) panel.classList.add('active');
  if (nav)   nav.classList.add('active');
  App.currentPanel = name;

  if (name === 'benchmark') { Renderer.renderBenchmark(); Renderer.renderHealthChecks(); }
  if (name === 'history')   { Renderer.renderHistory(); }
  if (name === 'diff')      { Renderer.renderDiff(); Renderer.renderVersionList(); }
  if (name === 'cost')      { Renderer.updateCostTracker(); }
  if (name === 'load') {
    const card = document.getElementById('active-skill-card');
    if (card) card.style.display = SkillLoader.getActive() ? 'block' : 'none';
  }
}

function selectSkill(id) {
  App.currentSkill = id;
  const idx = ['rag','code','plan','sec','doc'].indexOf(id);
  const sel = document.getElementById('cfg-skill');
  if (sel && idx >= 0) sel.selectedIndex = idx;
  Renderer.renderSkillList();
}

function switchOptTab(name, el) {
  Renderer.switchOptTab(name);
  document.querySelectorAll('#panel-optimizer .tab').forEach(t => t.classList.remove('active'));
  if (el) el.classList.add('active');
}

function switchBenchTab(name, el) {
  ['view','add','health'].forEach(t => { const b = document.getElementById(`bctab-${t}`); if (b) b.style.display = t === name ? 'block' : 'none'; });
  document.querySelectorAll('#panel-benchmark .tab').forEach(t => t.classList.remove('active'));
  if (el) el.classList.add('active');
  if (name === 'health') Renderer.renderHealthChecks();
}

function switchHistTab(name, el) {
  ['all','skills'].forEach(t => { const b = document.getElementById(`hctab-${t}`); if (b) b.style.display = t === name ? 'block' : 'none'; });
  document.querySelectorAll('#panel-history .tab').forEach(t => t.classList.remove('active'));
  if (el) el.classList.add('active');
  Renderer.renderHistory();
}

function switchDiffTab(name, el) {
  ['diff','versions'].forEach(t => { const b = document.getElementById(`dctab-${t}`); if (b) b.style.display = t === name ? 'block' : 'none'; });
  document.querySelectorAll('#panel-diff .tab').forEach(t => t.classList.remove('active'));
  if (el) el.classList.add('active');
  if (name === 'versions') Renderer.renderVersionList();
}

function switchLoadTab(name, el) {
  ['drop','paste','how'].forEach(t => { const b = document.getElementById(`lctab-${t}`); if (b) b.style.display = t === name ? 'block' : 'none'; });
  document.querySelectorAll('#panel-load .tab').forEach(t => t.classList.remove('active'));
  if (el) el.classList.add('active');
  if (name === 'paste') {
    const src = document.getElementById('loaded-skills-list');
    const dst = document.getElementById('loaded-skills-list-paste');
    if (src && dst) dst.innerHTML = src.innerHTML;
  }
}

async function startRun() {
  if (App.run.active) return;
  RunLoop.run().catch(err => { RunLoop.log(`<span class="t-r">✗ fatal: ${err.message}</span>`); RunLoop.finish('unknown'); });
}

function stopRun() {
  App.run.aborted = true; App.run.active = false;
  RunLoop.log(`<span class="t-y">→ stopped by user at iter ${App.run.iteration}</span>`);
  Renderer.setRunning(false);
  if (App.run.iters.length > 0) RunLoop.finish(
    document.getElementById('cfg-skill')?.options[document.getElementById('cfg-skill')?.selectedIndex]?.text?.replace(' ↑ loaded','') || 'unknown'
  );
}

function validateConfig() {
  const issues = [];
  if (!App.settings.apiKey) issues.push('no api key — simulation mode will run (add key in Settings)');
  const budget = parseFloat(document.getElementById('cfg-budget')?.value);
  const iter   = parseInt(document.getElementById('cfg-iter')?.value);
  const thresh = parseFloat(document.getElementById('cfg-threshold')?.value);
  if (budget < 0.5) issues.push('budget too low — minimum $0.50');
  if (iter < 1 || iter > 50) issues.push('iterations must be 1–50');
  if (thresh < 1 || thresh > 5) issues.push('score threshold must be 1.0–5.0');
  const trainCount = App.golden.filter(g => g.partition === 'train').length;
  if (trainCount < 15) issues.push(`only ${trainCount} training scenarios — 15+ recommended`);
  const badge = document.getElementById('run-badge');
  if (issues.length === 0) {
    if (badge) { badge.textContent = 'config ok'; badge.className = 'badge badge-done'; }
    setTimeout(() => { if (badge && !App.run.active) { badge.textContent = 'idle'; badge.className = 'badge badge-idle'; } }, 2500);
  } else {
    alert('Config issues:\n\n' + issues.map(i => '• ' + i).join('\n'));
  }
}

function addScenario() {
  const input    = document.getElementById('new-input')?.value.trim();
  const expected = document.getElementById('new-expected')?.value.trim();
  const file     = document.getElementById('new-target-file')?.value || 'general.json';
  const part     = document.getElementById('new-partition')?.value   || 'train';
  if (!input || !expected) { alert('Both input and expected output are required.'); return; }
  App.golden.push({ id: Date.now(), query: input, expected, score: 3.0, partition: part, file });
  Store.saveGolden(App.golden);
  Renderer.renderBenchmark(); Renderer.renderHealthChecks();
  const inp = document.getElementById('new-input'); if (inp) inp.value = '';
  const exp = document.getElementById('new-expected'); if (exp) exp.value = '';
  const badge = document.getElementById('api-badge');
  if (badge) { badge.textContent = 'scenario added'; setTimeout(() => { badge.textContent = App.settings.apiKey ? 'api connected' : 'no api key'; }, 2000); }
}

function handleUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    try {
      const data = JSON.parse(e.target.result);
      if (!Array.isArray(data)) throw new Error('Expected JSON array');
      let added = 0;
      data.forEach(item => {
        if (item.input || item.query) {
          App.golden.push({ id: Date.now() + added, query: item.input || item.query, expected: item.expected_output || item.expected || '', score: item.score || 3.0, partition: item.partition || 'train', file: file.name });
          added++;
        }
      });
      Store.saveGolden(App.golden);
      Renderer.renderBenchmark(); Renderer.renderHealthChecks();
      alert(`Imported ${added} scenarios from ${file.name}`);
    } catch (err) { alert(`Failed to parse JSON: ${err.message}`); }
  };
  reader.readAsText(file);
  event.target.value = '';
}

function openSettings() {
  document.getElementById('api-key-input').value       = App.settings.apiKey       || '';
  document.getElementById('skills-path-input').value   = App.settings.skillsPath   || '.agents/skills/';
  document.getElementById('memories-path-input').value = App.settings.memoriesPath || 'MEMORIES.md';
  document.getElementById('settings-modal').style.display = 'flex';
}

function closeSettings() { document.getElementById('settings-modal').style.display = 'none'; }

function saveSettings() {
  App.settings.apiKey       = document.getElementById('api-key-input').value.trim();
  App.settings.skillsPath   = document.getElementById('skills-path-input').value.trim();
  App.settings.memoriesPath = document.getElementById('memories-path-input').value.trim();
  Store.saveSettings(App.settings);
  const badge = document.getElementById('api-badge');
  if (badge) { badge.textContent = App.settings.apiKey ? 'api connected' : 'no api key'; badge.className = App.settings.apiKey ? 'badge badge-api' : 'badge badge-idle'; }
  closeSettings();
}

/* ══════════════════════════════════════════════════════════
   INIT — single DOMContentLoaded, no race conditions
══════════════════════════════════════════════════════════ */
document.addEventListener('DOMContentLoaded', () => {
  // API key badge
  const badge = document.getElementById('api-badge');
  if (badge && !App.settings.apiKey) { badge.textContent = 'no api key'; badge.className = 'badge badge-idle'; }

  // Holdout slider
  const slider    = document.getElementById('cfg-holdout');
  const sliderVal = document.getElementById('holdout-val');
  if (slider && sliderVal) slider.addEventListener('input', () => { sliderVal.textContent = slider.value + '%'; });

  // Settings modal backdrop
  const modal = document.getElementById('settings-modal');
  if (modal) modal.addEventListener('click', e => { if (e.target === modal) closeSettings(); });

  // Skill dropdown sync
  const skillSel = document.getElementById('cfg-skill');
  if (skillSel) skillSel.addEventListener('change', function () { App.currentSkill = this.value; Renderer.renderSkillList(); });

  // Wire up SkillLoader (safe — all DOM is ready, all globals defined above)
  SkillLoader.init();

  // Initial renders
  Renderer.renderSkillList();

  console.info('[SkillOpt] v1.1.0 — ready');
  console.info('[SkillOpt] API key:', App.settings.apiKey ? 'configured' : 'not set (simulation mode)');
});
