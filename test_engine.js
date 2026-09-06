const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const config = require('./server/config');
const { scanAllSkills, parseSkillFile, calculateDirHash, getInventory, invalidateInventory, resolveSkill } = require('./server/scanner');
const { syncDirectory, syncSkill } = require('./server/sync');
const { scaffoldSkill, lintSkill, forkToCustom, checkUpstreamUpdate, getSkillDiff, openInEditor } = require('./server/lifecycle');
const { app, server } = require('./server/server');
const { setOverride, deleteOverride, getOverrides } = require('./server/overrides');
const { parseFrontmatter, sanitizeName, isNameCompliant } = require('./server/skill-md');
const { recordUsage, setFavorite, resetUsage } = require('./server/usage');
const { installSkillToTarget } = require('./server/deploy');
const { buildExplainPrompt, explainSkill, forgetExplanation, saveLlmConfig, clearLlmConfig, getSettings } = require('./server/llm');

console.log('================================================================');
console.log('        SKILLSHUB SELF-TEST & INTEGRATION VERIFICATION          ');
console.log('================================================================\n');

let failed = false;
function assert(condition, message) {
  if (!condition) {
    console.error(`  [FAIL] ${message}`);
    failed = true;
  } else {
    console.log(`  [PASS] ${message}`);
  }
}

// Test sandbox: fixtures live in the OS temp dir, never in production skill dirs
function makeSandbox(label) {
  const dir = path.join(os.tmpdir(), `skillshub-test-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function runTests() {
  try {
    // 1. Config Test
    console.log('[TEST 1] Configuration & Agent Target Mapping...');
    assert(config.PORT === 3721, 'Default port is 3721');
    assert(Array.isArray(config.targets) && config.targets.length >= 10, `Configured ${config.targets.length} agent scan targets`);
    
    const hermesTarget = config.targets.find(t => t.agentId === 'hermes' && t.env === 'wsl');
    const openclawTarget = config.targets.find(t => t.agentId === 'openclaw' && t.env === 'wsl');
    assert(!!hermesTarget, 'Hermes WSL target configured');
    assert(!!openclawTarget, 'OpenClaw WSL target configured');

    // 2. Scanner Test (with Hermes & OpenClaw)
    console.log('\n[TEST 2] Scanner & Multi-Agent Discovery...');
    const scanResult = await scanAllSkills();
    assert(scanResult && Array.isArray(scanResult.skills), 'Scanner returns skills array');
    assert(Array.isArray(scanResult.targets), 'Scanner returns targets list');
    assert(scanResult.skills.length >= 100, `Discovered ${scanResult.skills.length} skills (>= 100 expected with Hermes & OpenClaw)`);

    // Verify Hermes & OpenClaw targets have count > 0
    const wslHermes = scanResult.targets.find(t => t.id === 'wsl-hermes');
    const winHermes = scanResult.targets.find(t => t.id === 'win-hermes');
    const winOpenclaw = scanResult.targets.find(t => t.id === 'win-openclaw');
    const wslOpenclaw = scanResult.targets.find(t => t.id === 'wsl-openclaw-workspace');

    assert(wslHermes && wslHermes.count > 50, `WSL Hermes has ${wslHermes ? wslHermes.count : 0} skills (> 50 expected)`);
    assert(winHermes && winHermes.count > 0, `Windows Hermes has ${winHermes ? winHermes.count : 0} skills`);
    assert(winOpenclaw && winOpenclaw.count > 0, `Windows OpenClaw has ${winOpenclaw ? winOpenclaw.count : 0} skills`);
    assert(wslOpenclaw && wslOpenclaw.count > 0, `WSL OpenClaw Workspace has ${wslOpenclaw ? wslOpenclaw.count : 0} skills`);

    // 3. Editor Launching Test
    console.log('\n[TEST 3] Cursor / Editor Launching Function...');
    const firstSkill = scanResult.skills[0];
    const testSkillDir = firstSkill.managedBy[0].path;
    const editorRes = openInEditor(testSkillDir, 'cursor');
    assert(editorRes.success === true, 'openInEditor returned success');
    assert(editorRes.command.includes('cursor'), `Command invoked cursor: ${editorRes.command}`);
    assert(fs.existsSync(editorRes.path), `Target directory exists on disk: ${editorRes.path}`);

    // 4. Lifecycle Scaffolding & Linter Test (sandboxed)
    console.log('\n[TEST 4] Lifecycle Scaffolding & Specification Linter (sandbox)...');
    const sandboxDir = makeSandbox('scaffold');
    try {
      const tempName = `test-autogen-${Date.now()}`;
      const scaffolded = scaffoldSkill({
        name: tempName,
        description: 'Use this skill when verifying automated testing frameworks.',
        targetEnv: 'windows',
        baseDir: sandboxDir
      });
      assert(scaffolded.path.startsWith(sandboxDir), `Scaffolded inside the test sandbox, not production dirs`);
      assert(fs.existsSync(scaffolded.path), `Scaffolded directory created at ${scaffolded.path}`);
      assert(fs.existsSync(path.join(scaffolded.path, 'SKILL.md')), 'SKILL.md exists');
      assert(fs.existsSync(path.join(scaffolded.path, 'scripts')), 'scripts/ directory exists');
      assert(fs.existsSync(path.join(scaffolded.path, 'references')), 'references/ directory exists');

      const lintRes = lintSkill(scaffolded.path);
      assert(lintRes.valid === true, 'Scaffolded skill passes Linter specification validation');
      assert(lintRes.errors.length === 0, 'No errors in compliant skill');
      assert(lintRes.warnings.length === 0, 'Scaffolded skill (scripts/ present) has no advisories');

      // Smart scripts/ advisory: only warns when SKILL.md references scripts/
      const refSkillDir = path.join(sandboxDir, 'ref-no-dir');
      fs.mkdirSync(refSkillDir, { recursive: true });
      fs.writeFileSync(path.join(refSkillDir, 'SKILL.md'),
        '---\nname: ref-no-dir\ndescription: Use this skill when testing dangling script references in linting.\n---\n# Ref\nRun `bash scripts/deploy.sh` to deploy.\n', 'utf8');
      const lintRef = lintSkill(refSkillDir);
      assert(lintRef.valid === true, 'Dangling script reference is an advisory, not a spec violation');
      assert(lintRef.warnings.some(w => w.includes('scripts/deploy.sh')), 'Dangling scripts/ reference produces a precise advisory');

      const pureSkillDir = path.join(sandboxDir, 'pure-knowledge');
      fs.mkdirSync(pureSkillDir, { recursive: true });
      fs.writeFileSync(path.join(pureSkillDir, 'SKILL.md'),
        '---\nname: pure-knowledge\ndescription: Use this skill when testing that pure text skills stay advisory-free.\n---\n# Pure\nJust follow the workflow text, no bundled helpers needed.\n', 'utf8');
      const lintPure = lintSkill(pureSkillDir);
      assert(lintPure.valid === true && lintPure.warnings.length === 0, 'Pure knowledge skill without scripts/ gets no advisory');

      // 5. Fork Built-in Test (sandboxed)
      console.log('\n[TEST 5] Fork to Custom Test (sandbox)...');
      const forked = await forkToCustom(scaffolded.path, `forked-${tempName}`, 'windows', { baseDir: sandboxDir });
      assert(forked.path.startsWith(sandboxDir), 'Forked inside the test sandbox');
      assert(fs.existsSync(forked.path), `Forked skill created at ${forked.path}`);
      const forkedParsed = await parseSkillFile(forked.path);
      assert(forkedParsed.name === `forked-${tempName}`, `Forked frontmatter updated name to: ${forkedParsed.name}`);
    } finally {
      // Guaranteed cleanup even when assertions fail midway
      fs.rmSync(sandboxDir, { recursive: true, force: true });
      console.log('  [CLEANUP] Removed test sandbox (scaffold + fork with it)');
    }

    // 6. Cross-boundary Sync Test (Win -> WSL), fixtures sandboxed, cleanup guaranteed
    console.log('\n[TEST 6] Cross-Boundary Hash-Verified Sync (Windows -> WSL)...');
    const syncWinSandbox = makeSandbox('sync');
    const mockWinDir = path.join(syncWinSandbox, 'src-skill');
    const wslSandbox = path.join(config.WSL_HOME_UNC, '.skillshub-test');
    const mockWslDir = path.join(wslSandbox, '__mock_sync_test__');
    try {
      fs.mkdirSync(mockWinDir, { recursive: true });
      fs.writeFileSync(path.join(mockWinDir, 'SKILL.md'), `---\nname: mock-sync\ndescription: A test mock skill\n---\n# Mock Sync\n`, 'utf8');

      const syncRes = await syncDirectory(mockWinDir, mockWslDir);
      assert(syncRes.success === true, 'Sync to WSL returned success');
      assert(fs.existsSync(mockWslDir), 'Destination folder created in WSL ext4');
      assert(syncRes.srcHash === syncRes.dstHash, `Source hash matches destination hash (${syncRes.srcHash})`);
    } finally {
      fs.rmSync(syncWinSandbox, { recursive: true, force: true });
      fs.rmSync(mockWslDir, { recursive: true, force: true });
      console.log('  [CLEANUP] Cleaned up cross-boundary sync fixtures');
    }

    // 7. REST API Endpoints Test
    console.log('\n[TEST 7] HTTP Server & REST API Endpoints...');
    const checkEndpoint = (endpoint, method = 'GET', body = null) => {
      return new Promise((resolve, reject) => {
        const url = new URL(`http://localhost:${config.PORT}${endpoint}`);
        const options = {
          method,
          agent: false,
          headers: body ? { 'Content-Type': 'application/json' } : {}
        };
        const req = http.request(url, options, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('error', (e) => resolve({ statusCode: res.statusCode, raw: data, streamError: e.message }));
          res.on('end', () => {
            try {
              resolve({ statusCode: res.statusCode, json: JSON.parse(data) });
            } catch (e) {
              resolve({ statusCode: res.statusCode, raw: data });
            }
          });
        });
        req.on('error', reject);
        if (body) req.write(JSON.stringify(body));
        req.end();
      });
    };

    const skillsApiRes = await checkEndpoint('/api/skills');
    assert(skillsApiRes.statusCode === 200, 'GET /api/skills returned 200 OK');
    assert(skillsApiRes.json.success === true, 'skills API reported success');
    assert(skillsApiRes.json.skills.length >= 100, `skills API returned ${skillsApiRes.json.skills.length} items`);

    const testSkillId = skillsApiRes.json.skills[0].id;
    const detailRes = await checkEndpoint(`/api/skill-detail?id=${testSkillId}`);
    assert(detailRes.statusCode === 200, `GET /api/skill-detail?id=${testSkillId} returned 200 OK`);
    assert(detailRes.json.success === true, 'skill-detail succeeded');

    const openRes = await checkEndpoint('/api/open-editor', 'POST', { skillId: testSkillId, editor: 'cursor' });
    assert(openRes.statusCode === 200, 'POST /api/open-editor returned 200 OK');

    // 8. Client JS Syntax Check
    console.log('\n[TEST 8] Client JavaScript Syntax & View Modes...');
    const appJsContent = fs.readFileSync(path.join(__dirname, 'public/app.js'), 'utf8');
    const invalidEscapeRegex = /onclick\s*=\s*['"][^'"]*\\[^'"]*['"]/;
    assert(!invalidEscapeRegex.test(appJsContent), 'No raw unescaped backslashes in HTML onclick attributes');
    assert(appJsContent.includes('function setViewMode') && appJsContent.includes('function renderCompactList'), 'Compact view mode (grouped by agent) is implemented');
    assert(appJsContent.includes('function filterSkills') && (appJsContent.match(/filterSkills\(\)/g) || []).length >= 2, 'Both views share the filterSkills pipeline');

    const indexHtml = fs.readFileSync(path.join(__dirname, 'public/index.html'), 'utf8');
    assert(indexHtml.includes('view-cards-btn') && indexHtml.includes('view-compact-btn'), 'View mode toggle present in the toolbar');

    // 9. Manual User Overrides (Tier / Upstream Binding / Tags / Notes)
    console.log('\n[TEST 9] Manual Attribute Override (Tier / Upstream / Tags)...');
    const overrideTarget = skillsApiRes.json.skills.find(s => s.tier === 'custom') || skillsApiRes.json.skills[0];
    try {
      const overrideRes = setOverride(overrideTarget.id, {
        tier: 'downloaded',
        upstreamUrl: 'https://github.com/mattpocock/skills.git',
        tags: '图像处理, 代码审查, 工作流',
        notes: 'manual override self-test'
      });
      assert(overrideRes.tier === 'downloaded', 'setOverride stored tier=downloaded');
      assert(overrideRes.upstream && overrideRes.upstream.sourceUrl === 'https://github.com/mattpocock/skills.git', 'setOverride bound upstream sourceUrl');
      assert(overrideRes.upstream.source === 'mattpocock/skills', `Upstream source normalized to: ${overrideRes.upstream.source}`);
      assert(Array.isArray(overrideRes.tags) && overrideRes.tags.length === 3, `Tags normalized to 3 entries: [${overrideRes.tags.join(' / ')}]`);

      const rescan = await scanAllSkills();
      const overriddenSkill = rescan.skills.find(s => s.id === overrideTarget.id);
      assert(overriddenSkill && overriddenSkill.isOverridden === true, 'Scanner flags skill as isOverridden');
      assert(overriddenSkill.tier === 'downloaded', `Scanner applied manual tier: ${overriddenSkill.tier}`);
      assert(overriddenSkill.upstream && overriddenSkill.upstream.sourceUrl === 'https://github.com/mattpocock/skills.git', 'Scanner applied manual upstream binding');
      assert(Array.isArray(overriddenSkill.customTags) && overriddenSkill.customTags.includes('代码审查'), 'Scanner applied manual tags (customTags)');
      assert(overriddenSkill.customNotes === 'manual override self-test', 'Scanner applied manual notes');

      const setApiRes = await checkEndpoint('/api/set-override', 'POST', { skillId: '__api_probe_skill__', tier: 'builtin', notes: 'probe' });
      assert(setApiRes.statusCode === 200 && setApiRes.json.success === true, 'POST /api/set-override returned 200 OK');

      const invBefore = await getInventory();
      await checkEndpoint('/api/set-override', 'POST', { skillId: '__api_probe_skill__', tier: 'builtin', notes: 'probe2' });
      const invAfter = await getInventory();
      assert(invAfter !== invBefore, 'set-override route invalidates the inventory cache');

      const getApiRes = await checkEndpoint('/api/overrides');
      assert(getApiRes.statusCode === 200 && getApiRes.json.overrides['__api_probe_skill__'].tier === 'builtin', 'GET /api/overrides lists persisted override');

      const resetApiRes = await checkEndpoint('/api/reset-override', 'POST', { skillId: '__api_probe_skill__' });
      assert(resetApiRes.statusCode === 200 && resetApiRes.json.success === true, 'POST /api/reset-override returned success');
    } finally {
      // Always restore automatic detection, even when assertions fail midway
      deleteOverride(overrideTarget.id);
      deleteOverride('__api_probe_skill__');
      const restoredScan = await scanAllSkills();
      const restored = restoredScan.skills.find(s => s.id === overrideTarget.id);
      assert(restored && restored.isOverridden === false, 'Cleanup restored automatic detection (isOverridden=false)');
      console.log('  [CLEANUP] Removed temporary overrides from user_overrides.json');
    }

    // 10. Inventory Cache & Deep Skill Resolver
    console.log('\n[TEST 10] Inventory Cache & Skill Resolver...');
    invalidateInventory();
    const inv1 = await getInventory();
    const inv2 = await getInventory();
    assert(inv1 === inv2, 'Second getInventory() is a cache hit (same object)');

    const resolverProbe = inv1.skills[0];
    const { skill, instance } = resolveSkill(inv1, resolverProbe.id);
    assert(skill && skill.id === resolverProbe.id, `resolveSkill located: ${skill.id}`);
    assert(instance && instance.path && instance.targetId, 'Default instance resolved with path + targetId');

    const wantedTargetId = resolverProbe.managedBy[resolverProbe.managedBy.length - 1].targetId;
    const { instance: scoped } = resolveSkill(inv1, resolverProbe.id, wantedTargetId);
    assert(scoped.targetId === wantedTargetId, `targetId-scoped instance resolved: ${scoped.targetId}`);

    assert(resolveSkill(inv1, '__no_such_skill__').skill === null, 'Unknown id resolves to null skill');
    assert(resolveSkill(inv1, '').skill === null, 'Empty id resolves to null skill');

    invalidateInventory();
    const inv3 = await getInventory();
    assert(inv3 !== inv1, 'invalidateInventory() forces a fresh scan on next call');

    const inv4 = await getInventory({ force: true });
    assert(inv4 !== inv3, 'force:true bypasses the cache');

    // 11. Trust Boundary Guards
    console.log('\n[TEST 11] Trust Boundary Guards (path containment / tier whitelist / git URL)...');
    const evilPath = 'C:\\Windows\\Temp\\__skills_evil_probe__';

    const saveEvil = await checkEndpoint('/api/save-skill', 'POST', { skillPath: evilPath, content: 'x' });
    assert(saveEvil.statusCode === 403, `save-skill outside roots rejected (${saveEvil.statusCode})`);

    const detailEvil = await checkEndpoint(`/api/skill-detail?path=${encodeURIComponent(evilPath)}`);
    assert(detailEvil.statusCode === 403, `skill-detail outside roots rejected (${detailEvil.statusCode})`);

    const editorEvil = await checkEndpoint('/api/open-editor', 'POST', { path: evilPath });
    assert(editorEvil.statusCode === 403, `open-editor outside roots rejected (${editorEvil.statusCode})`);

    // /sync takes a skillId only — client-supplied paths are no longer part of the contract
    const syncMissing = await checkEndpoint('/api/sync', 'POST', { direction: 'to_wsl', skill: { instances: { windows: [{ path: evilPath }] } } });
    assert(syncMissing.statusCode === 400, `sync without skillId rejected (${syncMissing.statusCode})`);

    const badTier = await checkEndpoint('/api/set-override', 'POST', { skillId: '__tier_probe__', tier: 'hacker' });
    assert(badTier.statusCode === 400, `invalid tier rejected (${badTier.statusCode})`);
    assert(!getOverrides()['__tier_probe__'], 'invalid tier override was not persisted');

    const badUrl = await checkUpstreamUpdate({ sourceUrl: '--upload-pack=calc.exe https://github.com/x/y' });
    assert(badUrl.success === false, 'argv-like git URL payload rejected before reaching git');

    const badScheme = await checkUpstreamUpdate({ sourceUrl: 'file:///C:/Windows/System32/config' });
    assert(badScheme.success === false, 'file:// git URL scheme rejected');

    // 12. SKILL.md Grammar Single Source
    console.log('\n[TEST 12] SKILL.md Grammar Single Source (skill-md module)...');
    const tricky = '---\r\nname: "Tricky Skill"\r\ndescription: >-\r\n  Use this skill when the user asks\r\n  about multiline descriptions.\r\n---\r\n\r\n# Body here\r\n';
    const parsedTricky = parseFrontmatter(tricky, 'fallback-name');
    assert(parsedTricky.hasValidFrontmatter === true, 'CRLF frontmatter detected');
    assert(parsedTricky.name === 'Tricky Skill', `Quoted name unquoted: ${parsedTricky.name}`);
    assert(parsedTricky.description.includes('multiline descriptions'), 'Folded multiline description joined');
    assert(parsedTricky.body === '# Body here', 'Body separated from frontmatter');

    const noFm = parseFrontmatter('just text, no frontmatter', 'fallback-name');
    assert(noFm.hasValidFrontmatter === false && noFm.name === 'fallback-name', 'Missing frontmatter falls back to provided name');

    assert(sanitizeName('My Great Skill!') === 'my-great-skill-', `sanitizeName grammar: ${sanitizeName('My Great Skill!')}`);
    assert(isNameCompliant(sanitizeName('My Great Skill!')) === true, 'Sanitized name passes the compliant check');
    assert(isNameCompliant('Bad Name') === false, 'Non-compliant name detected');

    // 13. Vocabulary Contract & Id-Based Routes
    console.log('\n[TEST 13] Vocabulary Contract & Id-Based Routes...');
    const skillsPayload = skillsApiRes.json;
    assert(Array.isArray(skillsPayload.meta && skillsPayload.meta.tiers) && skillsPayload.meta.tiers.length === 3, 'meta.tiers vocabulary delivered');
    assert(skillsPayload.meta.tiers.every(t => ['builtin', 'downloaded', 'custom'].includes(t.id)), 'tier ids match the guard whitelist');
    assert(Array.isArray(skillsPayload.meta.syncStatuses) && skillsPayload.meta.syncStatuses.length >= 5, 'meta.syncStatuses vocabulary delivered');
    assert(typeof skillsPayload.meta.tierLabel === 'undefined', 'meta is pure JSON (no functions serialized)');

    const syncUnknown = await checkEndpoint('/api/sync', 'POST', { skillId: '__nope__', direction: 'to_wsl' });
    assert(syncUnknown.statusCode === 404, `sync unknown id -> ${syncUnknown.statusCode}`);

    const diffUnknown = await checkEndpoint('/api/diff', 'POST', { skillId: '__nope__' });
    assert(diffUnknown.statusCode === 404, `diff unknown id -> ${diffUnknown.statusCode}`);

    const updUnknown = await checkEndpoint('/api/check-update', 'POST', { skillId: '__nope__' });
    assert(updUnknown.statusCode === 404, `check-update unknown id -> ${updUnknown.statusCode}`);

    const noUpstreamSkill = skillsPayload.skills.find(s => !s.upstream);
    assert(!!noUpstreamSkill, 'found a skill without upstream for the 400 probe');
    const updNoUpstream = await checkEndpoint('/api/check-update', 'POST', { skillId: noUpstreamSkill.id });
    assert(updNoUpstream.statusCode === 400, `check-update without upstream -> ${updNoUpstream.statusCode}`);

    // 14. Injectable Target Registry
    console.log('\n[TEST 14] Injectable Target Registry (fixture scan)...');
    const fixtureRoot = makeSandbox('fixture');
    try {
      const flatSkill = path.join(fixtureRoot, 'fixture-alpha');
      const nestedSkill = path.join(fixtureRoot, 'category', 'fixture-beta');
      fs.mkdirSync(flatSkill, { recursive: true });
      fs.writeFileSync(path.join(flatSkill, 'SKILL.md'), '---\nname: fixture-alpha\ndescription: Fixture skill alpha for injected target scan testing.\n---\n# Alpha\n', 'utf8');
      fs.mkdirSync(nestedSkill, { recursive: true });
      fs.writeFileSync(path.join(nestedSkill, 'SKILL.md'), '---\nname: fixture-beta\ndescription: Fixture skill beta nested in a category folder for scan testing.\n---\n# Beta\n', 'utf8');

      const fixtureTargets = [{
        id: 'fixture-win',
        name: 'Fixture Target',
        env: 'windows',
        agentId: 'fixture-agent',
        agentName: 'Fixture Agent',
        tier: 'mixed',
        dir: fixtureRoot,
        displayBase: 'fixture',
        recursive: true
      }];
      const fixtureScan = await scanAllSkills(fixtureTargets);
      assert(fixtureScan.skills.length === 2, `Fixture scan found exactly 2 skills (${fixtureScan.skills.length})`);
      assert(fixtureScan.skills.every(s => s.agentIds.includes('fixture-agent')), 'Fixture skills attributed to the injected agent');
      assert(fixtureScan.targets[0].id === 'fixture-win' && fixtureScan.targets[0].count === 2, 'Target stats computed for the injected target');

      const defaultInventory = await getInventory();
      assert(!defaultInventory.skills.some(s => s.id.startsWith('fixture-')), 'Injected scan does not leak into the cached default inventory');
    } finally {
      fs.rmSync(fixtureRoot, { recursive: true, force: true });
      console.log('  [CLEANUP] Removed fixture sandbox');
    }

    // 15. Skill Guide & Use: usage tracking, favorite, cross-agent install
    console.log('\n[TEST 15] Skill Guide: Usage / Favorite / Cross-Agent Install...');
    const guideProbe = skillsPayload.skills[0].id;
    try {
      // Hermetic counter test on a test-owned id (usage.json may carry real user data)
      resetUsage('__usage_probe__');
      const use1 = await checkEndpoint('/api/use-skill', 'POST', { skillId: '__usage_probe__', action: 'view' });
      assert(use1.statusCode === 200 && use1.json.usage.uses === 1, 'use-skill records the first view');
      const use2 = await checkEndpoint('/api/use-skill', 'POST', { skillId: '__usage_probe__', action: 'copy_prompt' });
      assert(use2.statusCode === 200 && use2.json.usage.uses === 2, `usage counter increments (${use2.json.usage.uses})`);

      const fav = await checkEndpoint('/api/favorite', 'POST', { skillId: '__usage_probe__', favorite: true });
      assert(fav.statusCode === 200 && fav.json.usage.favorite === true, 'favorite flag set');

      // Merge check on a real skill, relative to its pre-existing count
      const beforeUses = ((skillsPayload.skills.find(s => s.id === guideProbe) || {}).usage || { uses: 0 }).uses;
      await checkEndpoint('/api/use-skill', 'POST', { skillId: guideProbe, action: 'view' });
      const merged = await checkEndpoint('/api/skills');
      const mergedSkill = merged.json.skills.find(s => s.id === guideProbe);
      assert(mergedSkill.usage && mergedSkill.usage.uses === beforeUses + 1, `usage metadata merged into /api/skills (${beforeUses} -> ${mergedSkill.usage ? mergedSkill.usage.uses : '?'})`);

      const instBadSkill = await checkEndpoint('/api/install-skill', 'POST', { skillId: '__nope__', targetId: 'win-claude' });
      assert(instBadSkill.statusCode === 404, `install unknown skill -> ${instBadSkill.statusCode}`);

      const instBadTarget = await checkEndpoint('/api/install-skill', 'POST', { skillId: guideProbe, targetId: '__nope__' });
      assert(instBadTarget.statusCode === 400, `install unknown target -> ${instBadTarget.statusCode}`);

      const ownedTargetId = mergedSkill.managedBy[0].targetId;
      const instOwned = await checkEndpoint('/api/install-skill', 'POST', { skillId: guideProbe, targetId: ownedTargetId });
      assert(instOwned.statusCode === 409, `install into already-owned target -> ${instOwned.statusCode}`);

      // Module-level install with fixture sandboxes (never touches production dirs)
      const installSrc = makeSandbox('install-src');
      fs.writeFileSync(path.join(installSrc, 'SKILL.md'), '---\nname: install-probe\ndescription: Probe skill for cross-agent install verification.\n---\n# Probe\n', 'utf8');
      fs.mkdirSync(path.join(installSrc, 'scripts'), { recursive: true });
      fs.writeFileSync(path.join(installSrc, 'scripts', 'run.sh'), 'echo hi\n', 'utf8');
      const installDst = makeSandbox('install-dst');
      const fakeTarget = { id: 'fixture-install', name: 'Fixture Install Target', dir: installDst };

      const inst = await installSkillToTarget(installSrc, fakeTarget);
      assert(inst.success === true && inst.srcHash === inst.dstHash, `Fixture install hash-verified (${inst.dstHash})`);
      assert(fs.existsSync(path.join(inst.destDir, 'SKILL.md')) && fs.existsSync(path.join(inst.destDir, 'scripts', 'run.sh')), 'Installed folder carries SKILL.md and scripts/');

      let threw409 = false;
      try { await installSkillToTarget(installSrc, fakeTarget); } catch (e) { threw409 = e.statusCode === 409; }
      assert(threw409, 'Duplicate install rejected with 409');
    } finally {
      resetUsage('__usage_probe__');
      resetUsage('__usage_probe__fav__');
      console.log('  [CLEANUP] Reset probe usage entries (real user data untouched)');
    }

    // 16. AI Guide: prompt builder, explanation cache, llm-config API
    console.log('\n[TEST 16] AI Guide (prompt / cache / config API)...');
    let settingsBackup = null;
    const settingsFile = path.join(__dirname, 'server', 'data', 'llm-settings.json');
    try {
      const prompt = buildExplainPrompt('---\nname: demo\n---\n# Demo body', 'demo');
      assert(prompt.includes('# Demo body'), 'Prompt carries the SKILL.md content');
      assert(prompt.includes('## 这是什么') && prompt.includes('## 怎么用') && prompt.includes('## 举个例子'), 'Prompt enforces the three required sections');

      // Snapshot user settings so the config roundtrip below cannot clobber them
      if (fs.existsSync(settingsFile)) settingsBackup = fs.readFileSync(settingsFile, 'utf8');

      let chatCalls = 0;
      const fakeChat = async () => { chatCalls += 1; return '## 这是什么\n测试讲解'; };
      const subject = { id: '__explain_probe__', dirHash: 'aaa', content: 'body', name: 'probe' };
      const first = await explainSkill(subject, { chatFn: fakeChat });
      assert(first.cached === false && first.text.includes('测试讲解'), 'explainSkill generates on first call');
      const second = await explainSkill(subject, { chatFn: fakeChat });
      assert(second.cached === true && chatCalls === 1, 'Second call served from cache (no extra LLM call)');
      const forced = await explainSkill(subject, { chatFn: fakeChat, force: true });
      assert(forced.cached === false && chatCalls === 2, 'force:true bypasses the cache');
      const other = await explainSkill({ ...subject, dirHash: 'bbb' }, { chatFn: fakeChat });
      assert(other.cached === false, 'Changed dirHash produces a fresh cache entry');

      const cfgRes = await checkEndpoint('/api/llm-config');
      assert(cfgRes.statusCode === 200 && typeof cfgRes.json.configured === 'boolean', 'GET /api/llm-config reports configured flag');
      assert(cfgRes.json.apiKey === undefined, 'llm-config never leaks the API key');

      await checkEndpoint('/api/llm-config', 'POST', { baseUrl: 'https://example.com/v4', apiKey: 'probe-key', model: 'probe-model' });
      const cfgAfter = await checkEndpoint('/api/llm-config');
      assert(cfgAfter.json.configured === true && cfgAfter.json.source === 'settings', 'Saved settings become the active provider');

      const explainUnknown = await checkEndpoint('/api/explain-skill', 'POST', { skillId: '__nope__' });
      assert(explainUnknown.statusCode === 404, `explain unknown skill -> ${explainUnknown.statusCode}`);
    } finally {
      clearLlmConfig();
      if (settingsBackup !== null) fs.writeFileSync(settingsFile, settingsBackup, 'utf8');
      forgetExplanation('__explain_probe__');
      console.log('  [CLEANUP] Restored llm settings snapshot and removed probe explanations');
    }

    console.log('\n================================================================');
    if (!failed) {
      console.log('        ALL 16 TEST SUITES PASSED FLAWLESSLY! READY FOR USE.     ');
    } else {
      console.log('              SOME TESTS FAILED! CHECK OUTPUT ABOVE.            ');
    }
    console.log('================================================================');
  } catch (err) {
    console.error('Test execution error:', err.stack || err);
    failed = true;
  } finally {
    server.close();
    process.exit(failed ? 1 : 0);
  }
}

runTests();
