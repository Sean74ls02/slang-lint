# 更新日志

本项目的版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [0.1.6] - 2026-09-21

### 新增

- 扩展图标 `images/icon.png`（Marketplace 与扩展列表展示用）
- `publish` 脚本（`vsce publish --no-dependencies`），用于发布到 VS Code Marketplace

### 修复

- 修正 CHANGELOG 中 0.1.4 条目指向不存在 GitHub Release 的死链（0.1.4 为开源前的内部版本，无对应 Release）

## [0.1.5] - 2026-09-21

开源整理版本。插件行为与 0.1.4 完全一致，无功能变更。

### 新增

- 补齐构建配置 `tsconfig.json` 与 `esbuild.js`：此前 `npm run compile` 依赖这两个文件但仓库中缺失，clone 后无法构建
- `typecheck` 脚本（`tsc --noEmit`）
- GitHub Actions：push / PR 自动执行类型检查与编译校验；推送 `v*` 标签时自动打包 `.vsix` 并挂到 Release
- `CONTRIBUTING.md`、Issue 模板、`.vscode/launch.json` 与 `tasks.json`（F5 直接启动调试窗口）
- `.gitignore`、`.vscodeignore`、`.gitattributes`
- `package.json` 补充 `license`、`author`、`keywords`、`bugs`、`homepage` 元信息

### 修复

- 移除 `extension.ts` 中未使用的 `SlangDiag` 导入，以及 `moduleIndex.ts` 中只写不读的 `scanDirs` 字段：开启 `noUnusedLocals` 时 `tsc --noEmit` 会因此报错

### 变更

- `vsix` 脚本默认附加 `--no-dependencies`
- LICENSE 由 `LICENSE.txt` 更名为 `LICENSE`（vsce 打包时仍会自动输出为 `LICENSE.txt`）

## 0.1.4

初始版本（开源前的内部版本，无对应 GitHub Release）。

### 新增

- 基于 [slang](https://github.com/MikePopoloski/slang) 的单文件语法检查（`.v` / `.sv`）
- 模块索引：扫描配置目录，建立「模块名 → 文件路径」映射，不依赖文件名与模块名一致
- 依赖解析：剥离注释后正则提取实例化模块名，查出直接子模块文件
- 显式传参调用 slang（宏文件 → 前置文件 → 当前文件 → 直接子模块），替代 `-y` 库目录搜索以规避 slang 目录扫描带来的 ~90s 卡顿
- 诊断解析：路径规范化匹配，支持 `--ignore-unknown-modules` 跳过更深层未定义模块
- 命令：`Slang Lint: 检查当前文件`、`Slang Lint: 重建模块索引`
- 配置：`slangPath`、`scanDirs`、`macroFiles`、`preludeFiles`、`includeDirs`、`extraArgs`、`lintOnSave`、`lintOnOpen`、`debounceMs`、`showChildDiagnostics`
- 保存/打开/新建/删除/重命名时自动触发检查，带防抖与取消重跑
- 输出面板 `Slang Lint` 通道：子模块数、未解析模块数、slang 耗时

[0.1.6]: https://github.com/Sean74ls02/slang-lint/releases/tag/v0.1.6
[0.1.5]: https://github.com/Sean74ls02/slang-lint/releases/tag/v0.1.5
