# 贡献指南

感谢你想让 Slang Lint 变得更好。这是一个个人维护的小项目，流程刻意保持简单。

## 开发环境

前置条件：

- Node.js 18 或更高版本
- VS Code 1.75 或更高版本
- [slang](https://github.com/MikePopoloski/slang) 可执行文件，并加入 `PATH`（用于实际调试检查效果）

```bash
npm install          # 安装依赖
npm run typecheck    # TypeScript 类型检查，不产出文件
npm run compile      # esbuild 打包 → dist/extension.js
npm run watch        # 监听模式，配合 F5 调试
npm run vsix         # 打包 .vsix
```

按 `F5` 启动「Extension Development Host」窗口进行调试。在调试窗口里打开一个含 `rtl/` 目录的工作区即可看到效果。

## 源码结构

| 文件 | 职责 |
|------|------|
| `src/extension.ts` | 入口：事件接线（保存/打开/删除/重命名）、防抖、命令注册 |
| `src/moduleIndex.ts` | 模块索引：扫描目录、模块名→文件路径映射、增量更新 |
| `src/dependencyResolver.ts` | 依赖解析：提取实例化模块名，查索引得直接子模块 |
| `src/slangRunner.ts` | slang 调用、参数组装、诊断解析与发布 |
| `src/util.ts` | 注释剥离状态机、路径规范化、源文件过滤规则 |

## 提交 Pull Request

1. Fork 本仓库并新建分支，分支名建议 `feat/xxx` 或 `fix/xxx`
2. 改动前先确认 `npm run typecheck` 与 `npm run compile` 都通过
3. 提交信息用中文或英文均可，一句话说清改了什么
4. 在 PR 描述里说明：**改了什么 / 为什么改 / 怎么验证的**。如果改的是诊断相关逻辑，附上一小段能复现的 Verilog 代码会非常有帮助
5. 更新 `CHANGELOG.md` 的对应条目

## 提 Issue

报告问题时请尽量包含：

- Slang Lint 版本、VS Code 版本、操作系统
- `slang --version` 的输出
- 能复现的最小 `.v` / `.sv` 片段
- 相关的 `slangLint.*` 配置（注意不要贴出公司工程绝对路径等敏感信息）
- 输出面板 `Slang Lint` 通道里的日志

## 设计取舍

改动前建议先了解这几个刻意做出的取舍，避免好心办坏事：

- **不做递归依赖分析**：只传直接子模块。端口连接检查只需要子模块的端口定义，递归拉入整棵树会让单次检查从 ~0.5s 退化到数十秒
- **实例化提取用正则而非完整语法树**：换来的是零依赖和极快速度，代价是个别复杂写法可能漏提取。漏提取只是少传文件，配合 `--ignore-unknown-modules` 不会误报
- **默认只显示当前文件的诊断**：子模块报错默认不展示，避免干扰

## 行为准则

好好说话，就事论事。 maintainer 有权关闭无建设性的讨论。
