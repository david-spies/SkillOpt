/**
 * SkillOpt — js/skill-loader.js
 * Unified skill file ingestion module.
 *
 * Handles all three real-world skill sources:
 *   1. Browser file picker  — drag-and-drop or open dialog (.md or .zip)
 *   2. Zip package          — Ai-Agent Builder .zip output, auto-extracts SKILL.md
 *   3. Paste / manual entry — copy-paste raw SKILL.md content
 *
 * CLI counterpart: scripts/ingest.py handles --package and --scan flags.
 *
 * Public API:
 *   SkillLoader.init()                       — wire up all UI events
 *   SkillLoader.loadFromFile(file)           — File object → parsed skill
 *   SkillLoader.loadFromZip(file)            — .zip File → extract + parse all SKILL.md files
 *   SkillLoader.loadFromText(text, filename) — raw string → parsed skill
 *   SkillLoader.parseSkill(text, filename)   — parse a SKILL.md string into a SkillRecord
 *   SkillLoader.getLoaded()                  — return array of all loaded SkillRecords
 *   SkillLoader.activate(id)                 — set a loaded skill as the active target
 *
 * SkillRecord shape:
 * {
 *   id:           string   — stable uuid
 *   filename:     string   — e.g. "rag-retrieval.md"
 *   source:       string   — "file" | "zip" | "paste" | "default"
 *   sourceLabel:  string   — human-readable origin description
 *   raw:          string   — full file content
 *   name:         string   — from `name:` header field
 *   description:  string   — from `description:` header field
 *   version:      string   — from `version:` header field
 *   instructions: string   — content of ## Instructions section
 *   lineCount:    number   — total line count
 *   valid:        boolean  — passed basic structural checks
 *   warnings:     string[] — non-fatal issues
 *   errors:       string[] — structural errors
 *   loadedAt:     string   — ISO timestamp
 * }
 */

'use strict';

/* ─────────────────────────────────────────────────────────
   ZIP READER
   Minimal client-side ZIP parser — no external library.
   Supports the deflate + stored compression used by
   standard zip tools and the Ai-Agent Builder exporter.
───────────────────────────────────────────────────────── */
const ZipReader = {
  /**
   * Read a File/Blob as an ArrayBuffer.
   */
  readAsBuffer(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = e => resolve(e.target.result);
      reader.onerror = () => reject(new Error('FileReader failed'));
      reader.readAsArrayBuffer(file);
    });
  },

  /**
   * Extract all files from a ZIP ArrayBuffer.
   * Returns: [{filename, content (Uint8Array)}]
   *
   * ZIP format reference: PKWARE APPNOTE.TXT
   * Local file header signature: 0x04034b50
   */
  extract(buffer) {
    const view  = new DataView(buffer);
    const bytes = new Uint8Array(buffer);
    const files = [];

    let offset = 0;
    while (offset < bytes.length - 4) {
      // Local file header signature
      if (view.getUint32(offset, true) !== 0x04034b50) {
        offset++;
        continue;
      }

      const compression    = view.getUint16(offset + 8,  true);
      const compressedSize = view.getUint32(offset + 18, true);
      const filenameLen    = view.getUint16(offset + 26, true);
      const extraLen       = view.getUint16(offset + 28, true);

      const filenameBytes = bytes.slice(offset + 30, offset + 30 + filenameLen);
      const filename      = new TextDecoder('utf-8').decode(filenameBytes);

      const dataOffset = offset + 30 + filenameLen + extraLen;
      const compressed = bytes.slice(dataOffset, dataOffset + compressedSize);

      let content;
      if (compression === 0) {
        // Stored — no compression
        content = compressed;
      } else if (compression === 8) {
        // Deflate — use DecompressionStream if available
        content = ZipReader._inflate(compressed);
      } else {
        // Unsupported compression — skip
        offset = dataOffset + compressedSize;
        continue;
      }

      if (content !== null) {
        files.push({ filename, content });
      }

      offset = dataOffset + compressedSize;
    }

    return files;
  },

  /**
   * Inflate (decompress) a raw deflate stream.
   * Uses DecompressionStream (available in Chrome 80+, Firefox 113+, Safari 16.4+).
   * Returns Uint8Array synchronously via a trick — actually returns a Promise.
   */
  async _inflateAsync(compressed) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('DecompressionStream not supported in this browser. Use Chrome 80+ or Firefox 113+.');
    }
    const ds     = new DecompressionStream('deflate-raw');
    const writer = ds.writable.getWriter();
    const reader = ds.readable.getReader();

    writer.write(compressed);
    writer.close();

    const chunks = [];
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }

    const totalLen = chunks.reduce((s, c) => s + c.length, 0);
    const result   = new Uint8Array(totalLen);
    let pos = 0;
    for (const chunk of chunks) {
      result.set(chunk, pos);
      pos += chunk.length;
    }
    return result;
  },

  // Sync wrapper that returns a Promise — callers must await
  _inflate(compressed) {
    return ZipReader._inflateAsync(compressed);
  },

  /**
   * Decode a Uint8Array to a UTF-8 string.
   */
  decode(bytes) {
    return new TextDecoder('utf-8').decode(bytes);
  },

  /**
   * High-level: given a File, return [{filename, text}] for all text files inside.
   */
  async extractTextFiles(file) {
    const buffer     = await ZipReader.readAsBuffer(file);
    const rawEntries = ZipReader.extract(buffer);
    const results    = [];

    for (const entry of rawEntries) {
      // Skip directories and Mac metadata
      if (entry.filename.endsWith('/')) continue;
      if (entry.filename.includes('__MACOSX')) continue;
      if (entry.filename.includes('.DS_Store')) continue;

      let bytes = entry.content;
      // content may be a Promise if it was deflated
      if (bytes && typeof bytes.then === 'function') {
        try { bytes = await bytes; } catch { continue; }
      }
      if (!bytes) continue;

      const text = ZipReader.decode(bytes);
      results.push({ filename: entry.filename, text });
    }

    return results;
  },
};


/* ─────────────────────────────────────────────────────────
   SKILL PARSER
───────────────────────────────────────────────────────── */
const SkillParser = {
  REQUIRED_SECTIONS: ['## Instructions', '## Input', '## Output'],
  REQUIRED_FIELDS:   ['name:', 'description:'],

  /**
   * Parse a raw SKILL.md string into a structured SkillRecord.
   */
  parse(text, filename, source, sourceLabel) {
    const errors   = [];
    const warnings = [];

    // ── Header fields ──
    const name        = SkillParser._extractField(text, 'name')        || '';
    const description = SkillParser._extractField(text, 'description') || '';
    const version     = SkillParser._extractField(text, 'version')     || '';
    const author      = SkillParser._extractField(text, 'author')      || '';

    // ── Sections ──
    const instructions = SkillParser._extractSection(text, 'Instructions');

    // ── Validation ──
    for (const field of SkillParser.REQUIRED_FIELDS) {
      if (!text.match(new RegExp('^' + field.replace(':', '\\s*:'), 'm'))) {
        errors.push(`Missing required field: ${field}`);
      }
    }
    for (const section of SkillParser.REQUIRED_SECTIONS) {
      if (!text.includes(section)) {
        errors.push(`Missing required section: ${section}`);
      }
    }

    if (!instructions) {
      errors.push('## Instructions section is empty or missing');
    } else {
      const instLines = instructions.split('\n').length;
      if (instLines < 3) warnings.push('## Instructions section is very short (< 3 lines)');
      if (instLines > 200) errors.push(`## Instructions exceeds 200-line limit (${instLines} lines)`);
    }

    if (description && description.length < 20) {
      warnings.push('description: is very short — may reduce skill activation rate');
    }
    if (description && description.length > 300) {
      warnings.push('description: is very long — consider trimming for clarity');
    }

    const lineCount = text.split('\n').length;

    return {
      id:          SkillParser._uid(),
      filename:    filename || 'unknown.md',
      source,
      sourceLabel,
      raw:         text,
      name:        name || filename?.replace('.md', '') || 'unnamed',
      description,
      version,
      author,
      instructions,
      lineCount,
      valid:       errors.length === 0,
      warnings,
      errors,
      loadedAt:    new Date().toISOString(),
    };
  },

  _extractField(text, field) {
    const match = text.match(new RegExp(`^${field}\\s*:\\s*(.+)$`, 'm'));
    return match ? match[1].trim() : null;
  },

  _extractSection(text, sectionName) {
    const pattern = new RegExp(`^## ${sectionName}\\s*\\n([\\s\\S]*?)(?=\\n## |$)`, 'm');
    const match = text.match(pattern);
    return match ? match[1].trim() : null;
  },

  _uid() {
    return 'sk_' + Math.random().toString(36).slice(2, 10) + '_' + Date.now().toString(36);
  },
};


/* ─────────────────────────────────────────────────────────
   SKILL LOADER — public API
───────────────────────────────────────────────────────── */
const SkillLoader = {
  _loaded: [],   // SkillRecord[]
  _active: null, // active SkillRecord id

  /** Initialize event listeners for the Load Skill panel. */
  init() {
    SkillLoader._wireDragDrop();
    SkillLoader._wireFileInput();
    SkillLoader._wirePasteInput();
  },

  /** Return all loaded SkillRecords. */
  getLoaded() {
    return SkillLoader._loaded;
  },

  /** Return the currently active SkillRecord, or null. */
  getActive() {
    return SkillLoader._loaded.find(s => s.id === SkillLoader._active) || null;
  },

  /** Set a loaded skill as the active optimization target. */
  activate(id) {
    const skill = SkillLoader._loaded.find(s => s.id === id);
    if (!skill) return;
    SkillLoader._active = id;
    SkillLoader._syncToAppState(skill);
    SkillLoader._renderLoadedList();
    SkillLoader._renderActivePreview(skill);
    Renderer.renderSkillList();
  },

  /** Load from a File object (handles both .md and .zip). */
  async loadFromFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();

    if (ext === 'zip') {
      return SkillLoader.loadFromZip(file);
    }
    if (ext === 'md' || ext === 'txt') {
      const text = await SkillLoader._readFileAsText(file);
      return [SkillLoader.loadFromText(text, file.name, 'file', `Uploaded: ${file.name}`)];
    }

    SkillLoader._showError(`Unsupported file type: .${ext}. Drop a .md or .zip file.`);
    return [];
  },

  /** Extract all SKILL.md files from an Ai-Agent Builder .zip package. */
  async loadFromZip(file) {
    SkillLoader._setStatus('extracting', `Extracting ${file.name}...`);

    let entries;
    try {
      entries = await ZipReader.extractTextFiles(file);
    } catch (err) {
      SkillLoader._showError(`ZIP extraction failed: ${err.message}`);
      return [];
    }

    // Find all .md files that contain ## Instructions
    const skillEntries = entries.filter(e =>
      e.filename.endsWith('.md') && e.text.includes('## Instructions')
    );

    // Also surface the package manifest (AGENTS.md, README.md) as read-only context
    const contextEntries = entries.filter(e =>
      e.filename.endsWith('.md') && !e.text.includes('## Instructions')
    );

    if (skillEntries.length === 0) {
      SkillLoader._setStatus('error', 'No SKILL.md files found in ZIP');
      SkillLoader._showError(
        `No SKILL.md files found in ${file.name}.\n\n` +
        `Found ${entries.length} total files:\n` +
        entries.slice(0, 10).map(e => '  • ' + e.filename).join('\n') +
        (entries.length > 10 ? `\n  ... and ${entries.length - 10} more` : '')
      );
      return [];
    }

    const loaded = [];
    for (const entry of skillEntries) {
      const baseName = entry.filename.split('/').pop();
      const record   = SkillLoader.loadFromText(
        entry.text,
        baseName,
        'zip',
        `From package: ${file.name} → ${entry.filename}`
      );
      loaded.push(record);
    }

    // Store context files for display
    SkillLoader._zipContext = contextEntries.map(e => ({
      filename: e.filename.split('/').pop(),
      path:     e.filename,
      preview:  e.text.slice(0, 400),
    }));

    const plural = loaded.length > 1 ? `${loaded.length} skills` : loaded[0].name;
    SkillLoader._setStatus('ok', `Loaded ${plural} from ${file.name}`);

    // Auto-activate if only one skill found
    if (loaded.length === 1) {
      SkillLoader.activate(loaded[0].id);
    } else {
      SkillLoader._renderLoadedList();
    }

    return loaded;
  },

  /** Load from raw text string — used for paste mode and programmatic loading. */
  loadFromText(text, filename = 'skill.md', source = 'paste', sourceLabel = 'Pasted content') {
    const record = SkillParser.parse(text, filename, source, sourceLabel);
    // Replace existing entry with same filename, or append
    const existingIdx = SkillLoader._loaded.findIndex(s => s.filename === record.filename);
    if (existingIdx >= 0) {
      SkillLoader._loaded[existingIdx] = record;
    } else {
      SkillLoader._loaded.push(record);
    }
    SkillLoader._renderLoadedList();
    return record;
  },

  /** Parse only — does not register with the loader state. */
  parseSkill(text, filename) {
    return SkillParser.parse(text, filename, 'parse', '');
  },

  // ─── Private ───

  _readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = e => resolve(e.target.result);
      reader.onerror = () => reject(new Error('Could not read file'));
      reader.readAsText(file, 'utf-8');
    });
  },

  _syncToAppState(skill) {
    // Register with App.skills if not already present
    const existing = App.skills.find(s => s.name === skill.filename);
    if (!existing) {
      App.skills.push({
        id:        skill.id,
        name:      skill.filename,
        score:     null,
        runs:      0,
        bestScore: null,
        _raw:      skill.raw,
        _record:   skill,
      });
      Store.saveSkills(App.skills);
    } else {
      // Update raw content
      existing._raw    = skill.raw;
      existing._record = skill;
      Store.saveSkills(App.skills);
    }

    // Set as selected skill in the optimizer config dropdown
    SkillLoader._injectSkillOption(skill);

    // Update topbar path display
    const pathEl = document.getElementById('topbar-path');
    if (pathEl) pathEl.textContent = skill.sourceLabel;
  },

  _injectSkillOption(skill) {
    const sel = document.getElementById('cfg-skill');
    if (!sel) return;

    // Check if option already exists
    for (const opt of sel.options) {
      if (opt.value === skill.id) {
        sel.value = skill.id;
        App.currentSkill = skill.id;
        return;
      }
    }

    // Insert new option at top, marked as loaded
    const opt   = document.createElement('option');
    opt.value   = skill.id;
    opt.text    = `${skill.filename} ↑ loaded`;
    opt.dataset.loaded = '1';
    sel.insertBefore(opt, sel.firstChild);
    sel.value = skill.id;
    App.currentSkill = skill.id;
  },

  _setStatus(type, msg) {
    const el = document.getElementById('loader-status');
    if (!el) return;
    const colors = { ok: 'var(--green)', error: 'var(--red)', extracting: 'var(--yellow)', idle: 'var(--text-muted)' };
    el.textContent = msg;
    el.style.color = colors[type] || colors.idle;
  },

  _showError(msg) {
    const el = document.getElementById('loader-error');
    if (!el) return;
    el.textContent = msg;
    el.style.display = 'block';
    setTimeout(() => { el.style.display = 'none'; }, 6000);
  },

  _renderLoadedList() {
    const el = document.getElementById('loaded-skills-list');
    if (!el) return;

    if (SkillLoader._loaded.length === 0) {
      el.innerHTML = '<div style="font-family:var(--font-mono);font-size:11px;color:var(--text-muted);padding:10px 0">no skills loaded yet</div>';
      return;
    }

    el.innerHTML = SkillLoader._loaded.map(s => {
      const isActive  = s.id === SkillLoader._active;
      const statusDot = s.errors.length > 0 ? 'var(--red)' : s.warnings.length > 0 ? 'var(--yellow)' : 'var(--green)';
      const sourceBadge = { file: '📄 file', zip: '📦 zip', paste: '✏️ paste', default: '⚙️ default' }[s.source] || s.source;

      return `<div class="loaded-skill-row ${isActive ? 'loaded-active' : ''}" onclick="SkillLoader.activate('${s.id}')">
        <div style="display:flex;align-items:center;gap:8px;flex:1;min-width:0">
          <div style="width:7px;height:7px;border-radius:50%;background:${statusDot};flex-shrink:0"></div>
          <div style="min-width:0">
            <div style="font-family:var(--font-mono);font-size:12px;font-weight:500;color:${isActive ? 'var(--text-primary)' : 'var(--text-secondary)'};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${s.filename}</div>
            <div style="font-family:var(--font-mono);font-size:10px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${sourceBadge} · ${s.lineCount} lines · v${s.version || '?'}</div>
          </div>
        </div>
        <div style="display:flex;gap:5px;flex-shrink:0">
          ${isActive ? '<span style="font-family:var(--font-mono);font-size:10px;color:var(--green);padding:2px 6px;background:var(--green-bg);border-radius:4px">active</span>' : ''}
          ${s.errors.length > 0 ? `<span style="font-family:var(--font-mono);font-size:10px;color:var(--red);padding:2px 6px;background:var(--red-bg);border-radius:4px">${s.errors.length} err</span>` : ''}
          ${s.warnings.length > 0 ? `<span style="font-family:var(--font-mono);font-size:10px;color:var(--yellow);padding:2px 6px;background:var(--yellow-bg);border-radius:4px">${s.warnings.length} warn</span>` : ''}
        </div>
      </div>`;
    }).join('');
  },

  _renderActivePreview(skill) {
    const el = document.getElementById('active-skill-preview');
    if (!el) return;

    const errHtml = skill.errors.length > 0
      ? `<div style="margin-bottom:10px">${skill.errors.map(e => `<div style="font-family:var(--font-mono);font-size:11px;color:var(--red);margin-bottom:3px">✗ ${e}</div>`).join('')}</div>`
      : '';
    const warnHtml = skill.warnings.length > 0
      ? `<div style="margin-bottom:10px">${skill.warnings.map(w => `<div style="font-family:var(--font-mono);font-size:11px;color:var(--yellow);margin-bottom:3px">⚠ ${w}</div>`).join('')}</div>`
      : '';

    el.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
        <div>
          <div style="font-family:var(--font-mono);font-size:10px;color:var(--text-muted);margin-bottom:3px">NAME</div>
          <div style="font-family:var(--font-mono);font-size:12px">${skill.name}</div>
        </div>
        <div>
          <div style="font-family:var(--font-mono);font-size:10px;color:var(--text-muted);margin-bottom:3px">VERSION</div>
          <div style="font-family:var(--font-mono);font-size:12px">${skill.version || '—'}</div>
        </div>
        <div style="grid-column:1/-1">
          <div style="font-family:var(--font-mono);font-size:10px;color:var(--text-muted);margin-bottom:3px">DESCRIPTION</div>
          <div style="font-family:var(--font-mono);font-size:11px;color:var(--text-secondary);line-height:1.5">${skill.description || '—'}</div>
        </div>
        <div>
          <div style="font-family:var(--font-mono);font-size:10px;color:var(--text-muted);margin-bottom:3px">SOURCE</div>
          <div style="font-family:var(--font-mono);font-size:11px;color:var(--text-secondary)">${skill.sourceLabel}</div>
        </div>
        <div>
          <div style="font-family:var(--font-mono);font-size:10px;color:var(--text-muted);margin-bottom:3px">LINES</div>
          <div style="font-family:var(--font-mono);font-size:12px">${skill.lineCount} <span style="color:var(--text-muted)">/ 200 max</span></div>
        </div>
      </div>
      ${errHtml}${warnHtml}
      <div style="font-family:var(--font-mono);font-size:10px;color:var(--text-muted);margin-bottom:6px;text-transform:uppercase;letter-spacing:0.5px">## Instructions preview</div>
      <div style="background:#080808;border:1px solid var(--border);border-radius:var(--radius);padding:12px 14px;font-family:var(--font-mono);font-size:11px;line-height:1.7;color:#888;max-height:180px;overflow-y:auto;white-space:pre-wrap">${(skill.instructions || '').slice(0, 800)}${(skill.instructions || '').length > 800 ? '\n\n[... truncated for preview]' : ''}</div>
      <div style="margin-top:12px;display:flex;gap:8px">
        <button class="btn btn-primary" onclick="SkillLoader.activateAndRun('${skill.id}')">
          <i class="ti ti-player-play"></i> use this skill + run optimizer
        </button>
        <button class="btn btn-ghost" onclick="SkillLoader.activate('${skill.id}')">
          <i class="ti ti-check"></i> set as active
        </button>
      </div>`;
  },

  activateAndRun(id) {
    SkillLoader.activate(id);
    showPanel('optimizer');
    // Small delay so panel renders before run starts
    setTimeout(() => startRun(), 150);
  },

  _wireDragDrop() {
    const zone = document.getElementById('loader-drop-zone');
    if (!zone) return;

    zone.addEventListener('dragover', e => {
      e.preventDefault();
      zone.classList.add('drag-over');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
    zone.addEventListener('drop', async e => {
      e.preventDefault();
      zone.classList.remove('drag-over');
      const files = Array.from(e.dataTransfer.files);
      for (const file of files) {
        await SkillLoader.loadFromFile(file);
      }
    });
    zone.addEventListener('click', () => {
      document.getElementById('loader-file-input').click();
    });
  },

  _wireFileInput() {
    const input = document.getElementById('loader-file-input');
    if (!input) return;
    input.addEventListener('change', async e => {
      for (const file of Array.from(e.target.files)) {
        await SkillLoader.loadFromFile(file);
      }
      e.target.value = '';
    });
  },

  _wirePasteInput() {
    const btn = document.getElementById('loader-paste-btn');
    const ta  = document.getElementById('loader-paste-area');
    const fn  = document.getElementById('loader-paste-filename');
    if (!btn || !ta) return;

    btn.addEventListener('click', () => {
      const text     = ta.value.trim();
      const filename = (fn?.value?.trim()) || 'pasted-skill.md';
      if (!text) { SkillLoader._showError('Paste content is empty.'); return; }
      const record = SkillLoader.loadFromText(text, filename, 'paste', `Pasted: ${filename}`);
      SkillLoader.activate(record.id);
      ta.value = '';
      if (fn) fn.value = '';
    });
  },
};
