# SkillsHub - AI Agent Skills 跨环境管理控制台

针对 **Windows + WSL2 双栖开发环境**量身打造的 AI Agent Skills 管理控制台。

解决多智能体（Claude Code、Cursor、Codex、Antigravity 等）技能跨文件系统隔离、以及**官方内置 (Built-in)、网上下载 (Downloaded)、自编技能 (Custom)** 三层生命周期管理痛点。

---

## 核心特性

1. **Windows + WSL2 无缝穿透与双栖管理**
   - 自动扫描 Windows 本地（`~/.agents`、`~/.claude`、`~/.cursor`）与 WSL 内部（`~/.cursor`、`~/.codex`、`~/.claude`）的所有技能。
   - 自动识别“仅 Windows 存在”、“仅 WSL 存在”、“双端已对齐”以及“两端内容存在差异”。
2. **安全镜像增量同步（Smart Hash Sync）**
   - 告别脆弱且易报错的跨盘软链接（Symlink）。
   - 基于 SHA-256 特征哈希，一键在 Windows 与 WSL 之间双向安全镜像同步，秒级完成并校验字节完整性。
3. **三层生命周期精细化控制**
   - **官方内置 (Built-in)**：只读沙箱保护，防止意外破坏系统文件；支持一键 **Fork 派生**到用户自定义目录进行个性化改造。
   - **网上下载 (Downloaded)**：自动关联 `.skill-lock.json` 与 Git Upstream 仓库；支持无损嗅探上游是否有更新；提供行级 **Diff 对比视图**，防止更新冲毁本地微调。
   - **自编技能 (Custom)**：内置标准向导脚手架，一键生成符合 `agentskills.io` 规范的 `SKILL.md`、`scripts/`、`references/` 目录；集成语法与质量 Linter 校验。
4. **即开即用**
   - 单服务极速架构，免除繁琐的前端打包编译，运行即享现代响应式暗黑控制台。

---

## 启动与运行

### 方式 1：双击批处理（推荐）
直接双击根目录下的 `start.bat`，脚本将自动拉起服务并在默认浏览器打开 `http://localhost:3721`。

### 方式 2：命令行启动
```bash
# 1. 启动服务
npm start

# 2. 运行自动化测试套件
npm test
```

控制台地址：[http://localhost:3721](http://localhost:3721)

---

## 工程目录结构

```text
h:\ProgramData\guodapro\
├── package.json          # 项目依赖配置
├── start.bat             # Windows 桌面一键启动脚本
├── test_engine.js        # 自动化集成测试套件
├── README.md             # 使用与架构文档
├── server/
│   ├── config.js         # 环境路径、WSL Distro 与扫描源配置
│   ├── scanner.js        # 双环境跨盘扫描与聚合引擎
│   ├── sync.js           # SHA-256 镜像同步引擎
│   ├── lifecycle.js      # 三层生命周期控制器 (Fork / Diff / Scaffold / Lint)
│   ├── api.js            # RESTful API 路由定义
│   └── server.js         # HTTP 服务入口
└── public/
    ├── index.html        # 现代控制台单页仪表盘
    ├── app.js            # 前端交互与 API 通信
    └── style.css         # 样式与微交互优化
```
