# SkillsHub — CONTEXT

领域词汇表与架构决策记录。后续架构评审、`/grill-with-docs` 与新会话应从这里开始。

## 工作约定 (Standing Conventions)

- **每次修改都必须 `git commit`，随后 `git push origin main`**（用户明确要求，适用于所有后续改动；推送用 `gh auth setup-git` 配置的凭据）。

## 领域词汇 (Domain Glossary)

| 术语 | 含义 |
| :--- | :--- |
| **Skill (聚合技能)** | 跨环境聚合后的统一技能条目，以小写技能名为唯一 `id`。一个 Skill 可对应多个物理副本。 |
| **Instance (实例)** | Skill 在某个 Agent 目标目录中的物理副本（含 path、dirHash、displayPath）。"每端第一个实例"的序数语义只允许存在于 scanner 聚合与 sync 内部。 |
| **Target (目标目录)** | 一个已注册的 Agent 技能目录（`config.targets`），带 env / agentId / tier / recursive / lockfile 属性。扫描目标可作为参数注入（fixture 测试）。 |
| **Tier (类别)** | `builtin`（官方内置，只读可派生）/ `downloaded`（网上下载，绑定上游）/ `custom`（自己编写）。机器推断 + 人工覆盖，白名单见 `guard.VALID_TIERS`，文案见 `vocab.TIERS`。 |
| **Inventory (库存)** | 一次全量扫描的缓存结果。读路径必须走 `getInventory()`；一切变更路由完成后必须 `invalidateInventory()`。手动刷新走 `?force=1`。 |
| **Override (人工覆盖)** | 用户在 `server/data/user_overrides.json` 中持久化的人工指定（tier / upstream / tags / notes），优先级高于机器判定，可一键恢复自动判定。 |
| **Sync (跨端镜像)** | Windows ↔ WSL 实例间的哈希校验复制（`\\wsl.localhost` 9P 共享）。哈希不可信时如实报 `unknown`，绝不假报 `synced`。 |
| **Install (安装)** | 把一个 Skill 的实例部署到另一个已注册 Agent 目标目录（`deploy.js`，复用 sync 的备份+哈希校验；目标已有同名技能时报 409）。 |
| **Usage (使用记录)** | 每个技能的 view / copy_prompt / install 计数、最近使用时间与收藏标记，持久化于 `server/data/usage.json`。属用户元数据：不参与库存缓存失效。 |

## Module 地图

- `server/scanner.js` — 深模块：发现、聚合、覆盖应用、库存缓存、`resolveSkill` 访问器。目标可注入。
- `server/skill-md.js` — SKILL.md 语法的唯一来源：frontmatter 解析、name 清洗、合规判断。
- `server/sync.js` — 跨端镜像：原子备份、哈希校验、"每端取 [0]"语义收口于此。
- `server/lifecycle.js` — fork / scaffold / lint / diff / 上游嗅探 / 编辑器唤起。
- `server/overrides.js` — 人工覆盖的持久化（tier 白名单 + 损坏文件隔离）。
- `server/guard.js` — 信任边界：路径必须落在已注册目标目录内（`assertContainedSkillPath`）、`HttpError`、tier 白名单。
- `server/vocab.js` — 客户端词汇契约（tier / syncStatus 标签）唯一来源，经 `/api/skills` 的 `meta` 下发。
- `server/fs-utils.js` — 无依赖的异步存在性检查（避免 require 环）。
- `server/api.js` — Express 路由：只做编排，不持业务规则；错误经 `sendError` 映射 HttpError 状态码。

## 架构决策 (ADRs)

### ADR-0001 — 库存缓存用显式失效，不用 TTL
扫描代价高（158 个目录、大半在 9P 共享上）。读路径一律走缓存；所有变更路由在写盘后显式失效；前端手动刷新强制 `force=1`。不做时间戳过期——宁可显式，不可隐性脏读。

### ADR-0002 — 客户端只传 id，不传路径
`/sync`、`/diff`、`/check-update` 只接受 `skillId`；路径由服务端从库存解析。宿主路径永不跨越 HTTP seam（open-editor / save-skill / fork 的路径仍需过 containment 守卫）。

### ADR-0003 — 哈希如实失败
`calculateDirHash` 遇到不可读文件时抛错而不是吞掉：该技能 `dirHash=null`、双端状态为 `unknown`。宁可显示"无法校验"，不可产出假"双端一致"。

### ADR-0004 — 同步 I/O 禁止进入请求路径
扫描 / 复制 / git 嗅探全部异步化（fs.promises、execFile）。`execSync`/`cpSync` 不得在 Express 处理器中使用；git 调用必须 execFile 数组参数 + URL scheme 白名单。

### ADR-0005 — 「使用」指资产管理动作，不指调起 AI
SkillsHub 对技能的「使用」= 复制触发提示词（用户粘贴给任意 Agent）、安装到其他 Agent 目录、收藏与计数。直接调起 AI 执行技能是 Agent CLI 的职责，不在本工具边界内。

### ADR-0006 — AI 讲解采用 BYO-Key，讲解除缓存外不留存
「🤖 AI 讲解」的模型服务由用户提供：优先 UI 保存的 OpenAI 兼容配置（`llm-settings.json`），其次环境变量（`SKILLSHUB_LLM_*` / `ANTHROPIC_*`），都没有则 503 并弹设置表单。密钥永不回传给前端；讲解结果按 `skillId:dirHash` 缓存（内容变更自动失效），网关报错（502/504）如实透传给用户。
