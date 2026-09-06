const fs = require('fs');
const path = require('path');
const http = require('http');
const config = require('./server/config');
const { scanAllSkills, parseSkillFile, calculateDirHash } = require('./server/scanner');
const { syncDirectory, syncSkill } = require('./server/sync');
const { scaffoldSkill, lintSkill, forkToCustom, checkUpstreamUpdate, getSkillDiff, openInEditor } = require('./server/lifecycle');
const { app, server } = require('./server/server');
const { setOverride, deleteOverride } = require('./server/overrides');

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
    const scanResult = scanAllSkills();
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

    // 4. Lifecycle Scaffolding & Linter Test
    console.log('\n[TEST 4] Lifecycle Scaffolding & Specification Linter...');
    const tempName = `test-autogen-${Date.now()}`;
    const scaffolded = scaffoldSkill({
      name: tempName,
      description: 'Use this skill when verifying automated testing frameworks.',
      targetEnv: 'windows'
    });
    assert(fs.existsSync(scaffolded.path), `Scaffolded directory created at ${scaffolded.path}`);
    assert(fs.existsSync(path.join(scaffolded.path, 'SKILL.md')), 'SKILL.md exists');
    assert(fs.existsSync(path.join(scaffolded.path, 'scripts')), 'scripts/ directory exists');
    assert(fs.existsSync(path.join(scaffolded.path, 'references')), 'references/ directory exists');

    const lintRes = lintSkill(scaffolded.path);
    assert(lintRes.valid === true, 'Scaffolded skill passes Linter specification validation');
    assert(lintRes.errors.length === 0, 'No errors in compliant skill');

    // 5. Fork Built-in Test
    console.log('\n[TEST 5] Fork to Custom Test...');
    const forked = forkToCustom(scaffolded.path, `forked-${tempName}`, 'windows');
    assert(fs.existsSync(forked.path), `Forked skill created at ${forked.path}`);
    const forkedParsed = parseSkillFile(forked.path);
    assert(forkedParsed.name === `forked-${tempName}`, `Forked frontmatter updated name to: ${forkedParsed.name}`);

    // Clean up temporary local test directories
    fs.rmSync(scaffolded.path, { recursive: true, force: true });
    fs.rmSync(forked.path, { recursive: true, force: true });
    console.log('  [CLEANUP] Removed temporary scaffold and fork directories');

    // 6. Cross-boundary Sync Test (Win -> WSL -> Win)
    console.log('\n[TEST 6] Cross-Boundary Hash-Verified Sync (Windows -> WSL)...');
    const mockWinDir = path.join(config.defaultCustomDir.windows, `__mock_sync_test__`);
    if (!fs.existsSync(mockWinDir)) fs.mkdirSync(mockWinDir, { recursive: true });
    fs.writeFileSync(path.join(mockWinDir, 'SKILL.md'), `---\nname: mock-sync\ndescription: A test mock skill\n---\n# Mock Sync\n`, 'utf8');

    const mockWslDir = path.join(config.defaultCustomDir.wsl, `__mock_sync_test__`);
    const syncRes = syncDirectory(mockWinDir, mockWslDir);
    assert(syncRes.success === true, 'Sync to WSL returned success');
    assert(fs.existsSync(mockWslDir), 'Destination folder created in WSL ext4');
    assert(syncRes.srcHash === syncRes.dstHash, `Source hash matches destination hash (${syncRes.srcHash})`);

    // Clean up mock directories
    fs.rmSync(mockWinDir, { recursive: true, force: true });
    fs.rmSync(mockWslDir, { recursive: true, force: true });
    console.log('  [CLEANUP] Cleaned up temporary cross-boundary sync directories');

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
    console.log('\n[TEST 8] Client JavaScript Syntax Verification...');
    const appJsContent = fs.readFileSync(path.join(__dirname, 'public/app.js'), 'utf8');
    const invalidEscapeRegex = /onclick\s*=\s*['"][^'"]*\\[^'"]*['"]/;
    assert(!invalidEscapeRegex.test(appJsContent), 'No raw unescaped backslashes in HTML onclick attributes');

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

      const rescan = scanAllSkills();
      const overriddenSkill = rescan.skills.find(s => s.id === overrideTarget.id);
      assert(overriddenSkill && overriddenSkill.isOverridden === true, 'Scanner flags skill as isOverridden');
      assert(overriddenSkill.tier === 'downloaded', `Scanner applied manual tier: ${overriddenSkill.tier}`);
      assert(overriddenSkill.upstream && overriddenSkill.upstream.sourceUrl === 'https://github.com/mattpocock/skills.git', 'Scanner applied manual upstream binding');
      assert(Array.isArray(overriddenSkill.customTags) && overriddenSkill.customTags.includes('代码审查'), 'Scanner applied manual tags (customTags)');
      assert(overriddenSkill.customNotes === 'manual override self-test', 'Scanner applied manual notes');

      const setApiRes = await checkEndpoint('/api/set-override', 'POST', { skillId: '__api_probe_skill__', tier: 'builtin', notes: 'probe' });
      assert(setApiRes.statusCode === 200 && setApiRes.json.success === true, 'POST /api/set-override returned 200 OK');

      const getApiRes = await checkEndpoint('/api/overrides');
      assert(getApiRes.statusCode === 200 && getApiRes.json.overrides['__api_probe_skill__'].tier === 'builtin', 'GET /api/overrides lists persisted override');

      const resetApiRes = await checkEndpoint('/api/reset-override', 'POST', { skillId: '__api_probe_skill__' });
      assert(resetApiRes.statusCode === 200 && resetApiRes.json.success === true, 'POST /api/reset-override returned success');
    } finally {
      // Always restore automatic detection, even when assertions fail midway
      deleteOverride(overrideTarget.id);
      deleteOverride('__api_probe_skill__');
      const restoredScan = scanAllSkills();
      const restored = restoredScan.skills.find(s => s.id === overrideTarget.id);
      assert(restored && restored.isOverridden === false, 'Cleanup restored automatic detection (isOverridden=false)');
      console.log('  [CLEANUP] Removed temporary overrides from user_overrides.json');
    }

    console.log('\n================================================================');
    if (!failed) {
      console.log('         ALL 9 TEST SUITES PASSED FLAWLESSLY! READY FOR USE.     ');
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
