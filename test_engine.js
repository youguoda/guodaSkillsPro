const fs = require('fs');
const path = require('path');
const http = require('http');
const config = require('./server/config');
const { scanAllSkills, parseSkillFile, calculateDirHash } = require('./server/scanner');
const { syncDirectory, syncSkill } = require('./server/sync');
const { scaffoldSkill, lintSkill, forkToCustom, checkUpstreamUpdate, getSkillDiff } = require('./server/lifecycle');
const { app, server } = require('./server/server');

console.log('================================================================');
console.log('              SKILLSHUB AUTOMATED INTEGRATION TESTS             ');
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
    console.log('[TEST 1] Configuration & Path Resolutions...');
    assert(config.PORT === 3721, 'Default port is 3721');
    assert(fs.existsSync(config.WIN_USER_HOME), `Windows user directory exists (${config.WIN_USER_HOME})`);
    assert(fs.existsSync(config.WSL_HOME_UNC), `WSL home directory exists via UNC (${config.WSL_HOME_UNC})`);

    // 2. Scanner Test
    console.log('\n[TEST 2] Dual-Environment Scanner...');
    const skills = scanAllSkills();
    assert(Array.isArray(skills), 'Skills scanner returns an array');
    assert(skills.length > 0, `Discovered ${skills.length} skills in real environments`);
    
    const winSkills = skills.filter(s => s.hasWin);
    const wslSkills = skills.filter(s => s.hasWsl);
    assert(winSkills.length > 0, `Found ${winSkills.length} Windows skills`);
    assert(wslSkills.length > 0, `Found ${wslSkills.length} WSL skills`);

    // 3. Lifecycle Scaffolding & Linter Test
    console.log('\n[TEST 3] Lifecycle Scaffolding & Specification Linter...');
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

    // 4. Fork Built-in Test
    console.log('\n[TEST 4] Fork to Custom Test...');
    const forked = forkToCustom(scaffolded.path, `forked-${tempName}`, 'windows');
    assert(fs.existsSync(forked.path), `Forked skill created at ${forked.path}`);
    const forkedParsed = parseSkillFile(forked.path);
    assert(forkedParsed.name === `forked-${tempName}`, `Forked frontmatter updated name to: ${forkedParsed.name}`);

    // Clean up temporary local test directories
    fs.rmSync(scaffolded.path, { recursive: true, force: true });
    fs.rmSync(forked.path, { recursive: true, force: true });
    console.log('  [CLEANUP] Removed temporary scaffold and fork directories');

    // 5. Cross-boundary Sync Test (Win -> WSL -> Win)
    console.log('\n[TEST 5] Cross-Boundary Hash-Verified Sync (Windows -> WSL)...');
    // Create a mock skill in Windows
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

    // 6. REST API Server Test
    console.log('\n[TEST 6] HTTP Server & REST API Endpoints...');
    const checkEndpoint = (endpoint) => {
      return new Promise((resolve, reject) => {
        http.get(`http://localhost:${config.PORT}${endpoint}`, (res) => {
          let data = '';
          res.on('data', chunk => data += chunk);
          res.on('end', () => {
            try {
              resolve({ statusCode: res.statusCode, json: JSON.parse(data) });
            } catch (e) {
              resolve({ statusCode: res.statusCode, raw: data });
            }
          });
        }).on('error', reject);
      });
    };

    const sysInfoRes = await checkEndpoint('/api/system-info');
    assert(sysInfoRes.statusCode === 200, 'GET /api/system-info returned 200 OK');
    assert(sysInfoRes.json.wslDistro === config.WSL_DISTRO, 'system-info returned valid WSL distro');

    const skillsApiRes = await checkEndpoint('/api/skills');
    assert(skillsApiRes.statusCode === 200, 'GET /api/skills returned 200 OK');
    assert(skillsApiRes.json.success === true, 'skills API reported success');
    assert(skillsApiRes.json.skills.length > 0, `skills API returned ${skillsApiRes.json.skills.length} items`);

    console.log('\n================================================================');
    if (!failed) {
      console.log('           ALL INTEGRATION TESTS COMPLETED SUCCESSFULLY!        ');
    } else {
      console.log('               SOME TESTS FAILED! CHECK OUTPUT ABOVE.           ');
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
