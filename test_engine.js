const fs = require('fs');
const path = require('path');
const http = require('http');
const config = require('./server/config');
const { scanAllSkills, parseSkillFile, calculateDirHash } = require('./server/scanner');
const { syncDirectory, syncSkill } = require('./server/sync');
const { scaffoldSkill, lintSkill, forkToCustom, checkUpstreamUpdate, getSkillDiff, openInEditor } = require('./server/lifecycle');
const { app, server } = require('./server/server');

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
    assert(Array.isArray(config.targets) && config.targets.length >= 5, `Configured ${config.targets.length} agent scan targets`);
    config.targets.forEach(t => {
      assert(!!t.agentId && !!t.agentName && !!t.displayBase, `Target [${t.id}] has agentId (${t.agentId}), agentName (${t.agentName}), and displayBase`);
    });

    // 2. Scanner Test (with Agent attribution)
    console.log('\n[TEST 2] Scanner & Agent Folder Attribution...');
    const scanResult = scanAllSkills();
    assert(scanResult && Array.isArray(scanResult.skills), 'Scanner returns skills array');
    assert(Array.isArray(scanResult.targets), 'Scanner returns targets list');
    assert(scanResult.skills.length > 0, `Discovered ${scanResult.skills.length} skills in real environments`);

    // Verify Agent attribution on skills
    const firstSkill = scanResult.skills[0];
    assert(Array.isArray(firstSkill.managedBy) && firstSkill.managedBy.length > 0, `Skill [${firstSkill.name}] has managedBy records`);
    assert(firstSkill.managedBy[0].agentId && firstSkill.managedBy[0].displayPath, `managedBy record contains agentId and displayPath (${firstSkill.managedBy[0].displayPath})`);
    assert(Array.isArray(firstSkill.agentIds) && firstSkill.agentIds.length > 0, `Skill contains agentIds array for filtering`);

    // Verify Target stats
    const claudeTarget = scanResult.targets.find(t => t.agentId === 'claude');
    const cursorTarget = scanResult.targets.find(t => t.agentId === 'cursor');
    assert(claudeTarget && claudeTarget.count > 0, `Claude Code target has skills (Count: ${claudeTarget ? claudeTarget.count : 0})`);
    assert(cursorTarget && cursorTarget.count > 0, `Cursor target has skills (Count: ${cursorTarget ? cursorTarget.count : 0})`);

    // 3. Editor Launching Test
    console.log('\n[TEST 3] Cursor / Editor Launching Function...');
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
          headers: body ? { 'Content-Type': 'application/json' } : {}
        };
        const req = http.request(url, options, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
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

    // Test GET /api/skills
    const skillsApiRes = await checkEndpoint('/api/skills');
    assert(skillsApiRes.statusCode === 200, 'GET /api/skills returned 200 OK');
    assert(skillsApiRes.json.success === true, 'skills API reported success');
    assert(skillsApiRes.json.skills.length > 0, `skills API returned ${skillsApiRes.json.skills.length} items`);
    assert(Array.isArray(skillsApiRes.json.targets), 'skills API returned targets metadata');

    // Test GET /api/skill-detail by id (safe slug)
    const testSkillId = skillsApiRes.json.skills[0].id;
    const detailRes = await checkEndpoint(`/api/skill-detail?id=${testSkillId}`);
    assert(detailRes.statusCode === 200, `GET /api/skill-detail?id=${testSkillId} returned 200 OK`);
    assert(detailRes.json.success === true, 'skill-detail succeeded');
    assert(detailRes.json.parsed && detailRes.json.parsed.rawContent, 'skill-detail returned raw SKILL.md content');

    // Test POST /api/open-editor by skillId
    const openRes = await checkEndpoint('/api/open-editor', 'POST', { skillId: testSkillId, editor: 'cursor' });
    assert(openRes.statusCode === 200, 'POST /api/open-editor returned 200 OK');
    assert(openRes.json.success === true, `open-editor by skillId succeeded`);

    // Test POST /api/save-skill
    const saveRes = await checkEndpoint('/api/save-skill', 'POST', {
      skillId: testSkillId,
      content: detailRes.json.parsed.rawContent
    });
    assert(saveRes.statusCode === 200, 'POST /api/save-skill returned 200 OK');
    assert(saveRes.json.success === true, 'save-skill succeeded');

    // 8. Client JS Syntax Check
    console.log('\n[TEST 8] Client JavaScript Syntax Verification...');
    const appJsContent = fs.readFileSync(path.join(__dirname, 'public/app.js'), 'utf8');
    // Ensure no raw Windows backslash paths are embedded in inline onclick attributes
    const invalidEscapeRegex = /onclick\s*=\s*['"][^'"]*\\[^'"]*['"]/;
    assert(!invalidEscapeRegex.test(appJsContent), 'No raw unescaped backslashes in HTML onclick attributes');

    console.log('\n================================================================');
    if (!failed) {
      console.log('         ALL 8 TEST SUITES PASSED FLAWLESSLY! READY FOR USE.     ');
    } else {
      console.log('              SOME TESTS FAILED! CHECK OUTPUT ABOVE.            ');
    }
    console.log('================================================================');
  } catch (err) {
    console.error('Test execution error:', err);
    failed = true;
  } finally {
    server.close();
    process.exit(failed ? 1 : 0);
  }
}

runTests();
