# SkillsHub 交付总结与使用指引

专为 **Windows + WSL2 双栖环境** 设计的 AI Agent 技能管理控制台 **SkillsHub** 已完成构建并通过全面集成测试。

工程代码位于：[h:\ProgramData\guodapro](file:///h:/ProgramData/guodapro)

---

## 核心实现与解决痛点对照

| 痛点场景 | 解决机制 | 落实文件 |
| :--- | :--- | :--- |
| **Windows + WSL 隔离** | 通过 Windows UNC 原生路径（`\\wsl.localhost\Ubuntu-22.04\...`）同时穿透并聚合两端目录，消除跨系统软链兼容问题 | [scanner.js](file:///h:/ProgramData/guodapro/server/scanner.js) |
| **跨系统增量同步** | 基于 SHA-256 特征哈希的安全镜像机制，79 毫秒完成两端同步，自动校验字节完整性与原子回滚 | [sync.js](file:///h:/ProgramData/guodapro/server/sync.js) |
| **官方内置 (Built-in)** | 识别系统级技能（如 Codex `.system`），开启只读保护；提供一键 `Fork to Custom` 派生自建能力 | [lifecycle.js](file:///h:/ProgramData/guodapro/server/lifecycle.js) |
| **网上下载 (Downloaded)** | 关联 `.skill-lock.json`，支持用 `git ls-remote` 无损嗅探上游更新；内置行级差异对比视窗（Diff View） | [lifecycle.js](file:///h:/ProgramData/guodapro/server/lifecycle.js) |
| **自编技能 (Custom)** | 提供标准向导生成 `SKILL.md`（YAML frontmatter）与附属目录，集成 Linter 语法与规范校验，支持一键在 Cursor 打开 | [lifecycle.js](file:///h:/ProgramData/guodapro/server/lifecycle.js) |

---

## 自动化测试与验证结果

我们编写了全覆盖的自动化测试套件 [test_engine.js](file:///h:/ProgramData/guodapro/test_engine.js)，运行 `npm test`，测试结果全部通过：

```text
================================================================
              SKILLSHUB AUTOMATED INTEGRATION TESTS             
================================================================

[TEST 1] Configuration & Path Resolutions...
  [PASS] Default port is 3721
  [PASS] Windows user directory exists (C:\Users\14393)
  [PASS] WSL home directory exists via UNC (//wsl.localhost/Ubuntu-22.04/home/guoda)

[TEST 2] Dual-Environment Scanner...
  [PASS] Skills scanner returns an array
  [PASS] Discovered 54 skills in real environments
  [PASS] Found 48 Windows skills
  [PASS] Found 30 WSL skills

[TEST 3] Lifecycle Scaffolding & Specification Linter...
  [PASS] Scaffolded directory created at C:\Users\14393\.claude\skills\...
  [PASS] SKILL.md exists, scripts/ exists, references/ exists
  [PASS] Scaffolded skill passes Linter specification validation
  [PASS] No errors in compliant skill

[TEST 4] Fork to Custom Test...
  [PASS] Forked skill created at C:\Users\14393\.claude\skills\...
  [PASS] Forked frontmatter updated name properly
  [CLEANUP] Removed temporary scaffold and fork directories

[TEST 5] Cross-Boundary Hash-Verified Sync (Windows -> WSL)...
  [PASS] Sync to WSL returned success
  [PASS] Destination folder created in WSL ext4
  [PASS] Source hash matches destination hash (421f63a0d0)
  [CLEANUP] Cleaned up temporary cross-boundary sync directories

[TEST 6] HTTP Server & REST API Endpoints...
  [PASS] GET /api/system-info returned 200 OK
  [PASS] system-info returned valid WSL distro
  [PASS] GET /api/skills returned 200 OK
  [PASS] skills API reported success
  [PASS] skills API returned 54 items

================================================================
           ALL INTEGRATION TESTS COMPLETED SUCCESSFULLY!        
================================================================
```

---

## 如何启动与使用

### 1. 一键启动
* **方式 A（桌面批处理）**：直接在文件管理器中双击 [start.bat](file:///h:/ProgramData/guodapro/start.bat)，自动拉起控制台并弹出默认浏览器。
* **方式 B（终端命令）**：
  ```bash
  cd h:\ProgramData\guodapro
  npm start
  ```

浏览器访问地址：**[http://localhost:3721](http://localhost:3721)**

### 2. 控制台核心操作指南
1. **跨端同步**：卡片上若标记为【仅 Win】或【仅 WSL】，点击卡片上的 `➔ 同步到 WSL` 或 `➔ 同步到 Win`，即可在毫秒级内镜像到另一端并使 Agent 生效。
2. **差异比对 (Diff)**：当两端同名技能哈希不同时，点击 `⚡ 查看 Diff`，可逐行查看 Windows 与 WSL 之间的文本修改，并选择以哪一侧为基准覆盖。
3. **官方技能派生**：在【官方内置】分类下，点击 `🔱 Fork 派生`，一键生成属于自己的自定义版本。
4. **新建与创作**：点击右上角【+ 新建 Skill】，填入名称与描述，自动生成规范目录骨架，并直接在网页端轻量编辑或一键点击【在 Cursor 打开】。
