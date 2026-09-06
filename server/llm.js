const fs = require('fs');
const path = require('path');
const { HttpError } = require('./guard');

/**
 * llm — powers "🤖 AI 讲解": lets a configured LLM read a SKILL.md and explain
 * it (what it is / how to use / a plain example).
 *
 * Provider resolution order: saved UI settings > environment > none.
 *  - settings: any OpenAI-compatible endpoint (bigmodel / z.ai / deepseek / ...)
 *  - env:      SKILLSHUB_LLM_* (openai shape) or ANTHROPIC_AUTH_TOKEN+BASE_URL (anthropic shape)
 * Explanations are cached per (skillId:dirHash) so content changes invalidate them.
 */

const DATA_DIR = path.join(__dirname, 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'llm-settings.json');
const EXPLAIN_FILE = path.join(DATA_DIR, 'explanations.json');

function readJson(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    const quarantine = `${file}.corrupt.${Date.now()}`;
    try {
      fs.renameSync(file, quarantine);
      console.error(path.basename(file), 'was unreadable; quarantined to', quarantine, err.message);
    } catch (e) { /* keep going */ }
    return null;
  }
}

function getSettings() {
  const s = readJson(SETTINGS_FILE);
  return (s && s.baseUrl && s.apiKey) ? s : null;
}

function saveLlmConfig({ baseUrl, apiKey, model }) {
  if (!baseUrl || !apiKey || !model) {
    throw new HttpError(400, 'baseUrl, apiKey and model are all required');
  }
  const entry = { baseUrl: String(baseUrl).trim(), apiKey: String(apiKey).trim(), model: String(model).trim(), savedAt: new Date().toISOString() };
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(entry, null, 2), 'utf8');
  return entry;
}

function clearLlmConfig() {
  if (fs.existsSync(SETTINGS_FILE)) fs.rmSync(SETTINGS_FILE, { force: true });
}

function getLlmConfig() {
  const settings = getSettings();
  if (settings) {
    return { provider: 'openai', baseUrl: settings.baseUrl, apiKey: settings.apiKey, model: settings.model, source: 'settings' };
  }
  if (process.env.SKILLSHUB_LLM_API_KEY && process.env.SKILLSHUB_LLM_BASE_URL) {
    return {
      provider: 'openai',
      baseUrl: process.env.SKILLSHUB_LLM_BASE_URL,
      apiKey: process.env.SKILLSHUB_LLM_API_KEY,
      model: process.env.SKILLSHUB_LLM_MODEL || 'glm-4-flash',
      source: 'env'
    };
  }
  if (process.env.ANTHROPIC_AUTH_TOKEN && process.env.ANTHROPIC_BASE_URL) {
    return {
      provider: 'anthropic',
      baseUrl: process.env.ANTHROPIC_BASE_URL,
      apiKey: process.env.ANTHROPIC_AUTH_TOKEN,
      model: process.env.ANTHROPIC_MODEL || 'glm-4.6',
      source: 'env'
    };
  }
  return { provider: null, source: 'none' };
}

async function chat(prompt, cfg, { timeoutMs = 60000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    let res, payload;
    if (cfg.provider === 'anthropic') {
      res = await fetch(cfg.baseUrl.replace(/\/$/, '') + '/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': 'Bearer ' + cfg.apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({ model: cfg.model, max_tokens: 1500, messages: [{ role: 'user', content: prompt }] }),
        signal: ctrl.signal
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new HttpError(502, `LLM 网关错误 (${res.status}): ${json.error && json.error.message || 'unknown'}`);
      }
      payload = (json.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
    } else {
      res = await fetch(cfg.baseUrl.replace(/\/$/, '') + '/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'authorization': 'Bearer ' + cfg.apiKey
        },
        body: JSON.stringify({ model: cfg.model, max_tokens: 1500, messages: [{ role: 'user', content: prompt }] }),
        signal: ctrl.signal
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new HttpError(502, `LLM 网关错误 (${res.status}): ${json.error && json.error.message || 'unknown'}`);
      }
      payload = json.choices && json.choices[0] && json.choices[0].message ? json.choices[0].message.content : '';
    }
    if (!payload) throw new HttpError(502, 'LLM 返回了空内容');
    return payload;
  } catch (err) {
    if (err.name === 'AbortError') throw new HttpError(504, 'LLM 请求超时');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** The instruction that turns a raw SKILL.md into a professional but plain explanation */
function buildExplainPrompt(skillMd, skillName) {
  return [
    '你是一位资深的 AI Agent 技能专家。请阅读下面的 SKILL.md 技能文件，用中文、以 Markdown 格式输出，严格包含以下三个小节：',
    '',
    '## 这是什么',
    '用 2-3 句话专业而简洁地说明这个技能解决什么问题、核心能力是什么。',
    '',
    '## 怎么用',
    '用编号步骤说明：什么场景下会触发、如何调用、使用时要注意什么。',
    '',
    '## 举个例子',
    '给一个通俗、具体、贴近日常的使用例子（一个小场景或一段对话即可），让新手一看就懂。',
    '',
    '要求：总长度不超过 400 字；语言简洁明了；专业但不堆砌术语。',
    '',
    `技能名称：${skillName}`,
    '--- SKILL.md 内容开始 ---',
    String(skillMd || ''),
    '--- SKILL.md 内容结束 ---'
  ].join('\n');
}

function loadExplanations() {
  return readJson(EXPLAIN_FILE) || {};
}

function forgetExplanation(skillId) {
  const cache = loadExplanations();
  const prefix = String(skillId).toLowerCase() + ':';
  let removed = false;
  for (const key of Object.keys(cache)) {
    if (key.startsWith(prefix)) {
      delete cache[key];
      removed = true;
    }
  }
  if (removed) fs.writeFileSync(EXPLAIN_FILE, JSON.stringify(cache, null, 2), 'utf8');
  return removed;
}

/**
 * Explain one skill. chatFn injectable for tests.
 * subject: { id, dirHash, content, name }
 */
async function explainSkill(subject, { chatFn, force = false } = {}) {
  const key = `${subject.id}:${subject.dirHash || 'nohash'}`;
  const cache = loadExplanations();

  if (!force && cache[key]) {
    return { ...cache[key], cached: true, key };
  }

  let text, model, source;
  if (chatFn) {
    // Test seam: injected chat bypasses provider configuration entirely
    text = await chatFn(buildExplainPrompt(subject.content, subject.name), {});
    model = 'injected';
    source = 'injected';
  } else {
    const cfg = getLlmConfig();
    if (!cfg.provider) {
      throw new HttpError(503, '尚未配置 AI 讲解所需的大模型服务，请在下方表单中填写');
    }
    text = await chat(buildExplainPrompt(subject.content, subject.name), cfg);
    model = cfg.model;
    source = cfg.source;
  }

  const entry = { text, model, provider: source, explainedAt: new Date().toISOString() };
  cache[key] = entry;
  fs.writeFileSync(EXPLAIN_FILE, JSON.stringify(cache, null, 2), 'utf8');
  return { ...entry, cached: false, key };
}

module.exports = {
  getLlmConfig,
  saveLlmConfig,
  clearLlmConfig,
  buildExplainPrompt,
  explainSkill,
  forgetExplanation,
  getSettings
};
