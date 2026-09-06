/**
 * skill-md — the single source of truth for the SKILL.md grammar.
 * scanner (read), lifecycle/lint (validate) and lifecycle/fork+scaffold
 * (write) all speak THIS grammar; no regex duplication allowed elsewhere.
 */

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---([\s\S]*)$/;
const NAME_RE = /^name:[ \t]*(.*)$/m;
const NAME_COMPLIANT_RE = /^[a-z0-9_-]+$/;

function unquote(value) {
  return String(value || '').trim().replace(/^["']|["']$/g, '');
}

/**
 * Extract a description value, joining folded (>- / |) and wrapped lines.
 * A folded scalar's content is indented; the next column-0 `key:` ends it.
 */
function extractDescription(frontmatterRaw) {
  const lines = String(frontmatterRaw || '').split(/\r?\n/);
  const out = [];
  let inDescription = false;

  for (const line of lines) {
    if (!inDescription) {
      const m = line.match(/^description:[ \t]*(.*)$/);
      if (!m) continue;
      inDescription = true;
      const rest = m[1].trim();
      // Block scalar indicators (>-, |, >-, |+...) have no inline content
      if (rest && !/^[>|][+-]?\d*$/.test(rest)) out.push(rest);
    } else if (line.trim() === '' || /^[ \t]/.test(line)) {
      out.push(line.trim());
    } else {
      break; // next column-0 key: description block is over
    }
  }

  return out.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Parse SKILL.md raw content into its frontmatter and body parts.
 * Never throws — a missing/malformed frontmatter yields hasValidFrontmatter=false.
 */
function parseFrontmatter(rawContent, fallbackName = '') {
  const raw = String(rawContent || '');
  const match = raw.match(FRONTMATTER_RE);

  let name = fallbackName;
  let description = '';
  let frontmatterRaw = '';
  let body = raw;
  let hasValidFrontmatter = false;

  if (match) {
    hasValidFrontmatter = true;
    frontmatterRaw = match[1];
    body = match[2].trim();

    const nameMatch = frontmatterRaw.match(NAME_RE);
    if (nameMatch && unquote(nameMatch[1])) {
      name = unquote(nameMatch[1]);
    }
    description = extractDescription(frontmatterRaw);
  }

  return { name, description, hasValidFrontmatter, frontmatterRaw, body };
}

/** One name grammar for fork / scaffold / lint: lowercase, a-z 0-9 _ - */
function sanitizeName(raw, fallback = '') {
  const cleaned = String(raw || '').toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  return cleaned || fallback;
}

function isNameCompliant(name) {
  return NAME_COMPLIANT_RE.test(String(name || ''));
}

module.exports = {
  parseFrontmatter,
  sanitizeName,
  isNameCompliant
};
