# Slang Lint

[![CI](https://github.com/Sean74ls02/slang-lint/actions/workflows/ci.yml/badge.svg)](https://github.com/Sean74ls02/slang-lint/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![VS Code](https://img.shields.io/badge/VS%20Code-1.75%2B-blue.svg)](https://code.visualstudio.com/)

基于 [slang](https://github.com/MikePopoloski/slang) 的 SystemVerilog / Verilog 单文件语法检查插件。

- **通用**：一份配置适配工程内任意 `.v`/`.sv` 文件，无需按文件改配置
- **快速**：模块索引 + 显式传参，单次检查 ~0.5s
- **准确**：检查当前文件语法 + 直接子模块端口连接
- **稳定**：诊断路径规范化匹配，不丢诊断

> 面向的是"写 RTL 时想立刻知道这一行有没有写错"的场景，不做完整工程 elaborate，不做 lint 规则扩展。

## 目录

- [安装](#安装)
- [使用](#使用)
- [工作原理](#工作原理)
- [配置项](#配置项)
- [已知限制](#已知限制)
- [开发与打包](#开发与打包)
- [贡献](#贡献)
- [许可证](#许可证)

## 安装

前置条件：**本机已安装 [slang](https://github.com/MikePopoloski/slang) 并加入 `PATH`**。终端执行 `slang --version` 能输出版本号即可（slang 不在 `PATH` 里时，可通过 `slangLint.slangPath` 填绝对路径）。

安装插件二选一：

1. **从源码构建**（当前推荐，插件尚未上架 Marketplace）
   ```bash
   git clone https://github.com/Sean74ls02/slang-lint.git
   cd slang-lint
   npm install
   npm run vsix      # 生成 slang-lint-0.1.5.vsix
   ```
   然后 VS Code 命令面板 → `Extensions: Install from VSIX...` → 选择该 `.vsix` → 重载窗口
2. **直接下载**：从 [Releases](https://github.com/Sean74ls02/slang-lint/releases) 下载 `slang-lint.vsix`（打 tag 时由 CI 自动构建），再用上面的方式安装

## 使用

- **保存 `.v`/`.sv` 文件时自动检查**（默认开启），诊断显示在 Problems 面板，来源标记 `slang`
- 命令面板：
  - `Slang Lint: 检查当前文件` —— 手动触发检查
  - `Slang Lint: 重建模块索引` —— 批量新增/重命名文件后手动重建索引
- 输出面板 `Slang Lint` 通道：查看每次检查传入的子模块数、未解析模块数与 slang 耗时

## 工作原理

```
保存文件 → 剥离注释 → 正则提取实例化模块名
        → 查模块索引（模块名 → 文件路径）得到直接子模块文件
        → slang 显式传参：宏文件 + 前置文件 + 当前文件 + 子模块文件
        → 解析诊断（路径规范化匹配）→ 发布 Problems
```

- 不用 `-y` 库目录搜索（slang 需在几十个目录里按模块名逐个查找，是慢的根因），改为显式传参 → 快
- 只传**直接子模块**：端口连接检查只需子模块端口定义，配合
  `--ignore-unknown-modules` 跳过更深层未定义模块，不递归拉入整棵树
- 模块索引按"文件内实际定义的模块名"建立，不依赖文件名与模块名一致
- 激活时自动扫描构建索引；文件保存/删除/重命名时增量更新

## 配置项

路径类配置均相对工作区根目录，插件运行时自动拼接为绝对路径。

**配置分层建议**：
- 相对固定的行为类配置（触发时机、防抖等）使用默认值即可，需要调整时写在**用户配置**
- 因工程而异的路径类配置（扫描目录、宏文件等）写在**工作区配置**（`.code-workspace` / `.vscode/settings.json`），随工程走

| 配置项 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| `slangLint.slangPath` | string | `"slang"` | slang 可执行文件路径。默认从 PATH 查找；slang 装在非 PATH 位置时填绝对路径 |
| `slangLint.scanDirs` | string[] | `[]` | 模块索引扫描目录（相对工作区根目录，如 `rtl`、`ip`） |
| `slangLint.macroFiles` | string[] | `[]` | 全局宏定义文件，最先编译，保证后续文件可见全局宏 |
| `slangLint.preludeFiles` | string[] | `[]` | 前置编译文件（interface 定义等），在当前文件之前编译 |
| `slangLint.includeDirs` | string[] | `[]` | `include 搜索目录，以 `-I` 传给 slang，兜底相对路径 include |
| `slangLint.extraArgs` | string | `""` | 附加 slang 参数，原样追加到命令行末尾（如 `"--Wno-unusedsignal"`） |
| `slangLint.lintOnSave` | boolean | `true` | 保存文件时自动触发检查 |
| `slangLint.lintOnOpen` | boolean | `true` | 打开文件时自动触发检查 |
| `slangLint.debounceMs` | number | `1000` | 连续触发时的防抖间隔（毫秒） |
| `slangLint.showChildDiagnostics` | boolean | `false` | 是否显示子模块文件中的诊断。默认只显示当前文件的诊断，避免子模块报错干扰 |

**最小可用配置示例**（`.vscode/settings.json`）：

```json
{
  "slangLint.scanDirs": ["rtl"],
  "slangLint.macroFiles": ["rtl/include/global_defines.vh"],
  "slangLint.includeDirs": ["rtl/include"]
}
```

## 已知限制

- 实例化正则可能漏提取个别复杂写法：漏了只是少传文件，
  `--ignore-unknown-modules` 保证不误报，最坏是端口检查不全
- 深层子模块（二级以下）不做端口检查（设计取舍：端口连接检查只需直接子模块）
- 批量新增文件后建议执行一次 `Slang Lint: 重建模块索引`
- 主要在 Windows 上验证；Linux / macOS 理论上可用但缺少实测

## 开发与打包

```bash
npm install          # 首次
npm run typecheck    # 类型检查
npm run compile      # esbuild 打包 → dist/extension.js
npm run watch        # 监听模式（F5 调试）
npm run vsix         # 生成 .vsix
```

按 `F5` 可直接在调试窗口（Extension Development Host）里运行插件。

源码结构（`src/`）：

| 文件 | 职责 |
|------|------|
| `extension.ts` | 入口：事件接线（保存/打开/删除/重命名）、防抖、命令注册 |
| `moduleIndex.ts` | 模块索引：扫描目录、模块名→文件路径映射、增量更新 |
| `dependencyResolver.ts` | 依赖解析：提取实例化模块名，查索引得直接子模块 |
| `slangRunner.ts` | slang 调用、参数组装、诊断解析与发布 |
| `util.ts` | 注释剥离状态机、路径规范化、源文件过滤规则 |

## 贡献

欢迎 Issue 和 PR，详见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

## 许可证

[MIT](./LICENSE) © Sean74ls02

本插件只是 slang 的调用封装，slang 本身由 [MikePopoloski/slang](https://github.com/MikePopoloski/slang) 项目提供，遵循其自有许可证。
