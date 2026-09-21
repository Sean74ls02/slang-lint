/**
 * extension.ts —— 插件主入口
 *
 * 工作流程：
 *   1. 激活时按配置目录构建"模块名 → 文件路径"索引
 *   2. 保存/打开 .v/.sv 时：提取当前文件直接子模块 → 显式传参调用 slang
 *   3. 解析诊断，规范化路径匹配后发布到 Problems 面板
 *   4. 防抖 + 取消重跑，避免连续触发重复执行
 */

import * as vscode from "vscode";
import * as path from "path";
import { ModuleIndex, isInScanDirs } from "./moduleIndex";
import { resolveDirectChildren } from "./dependencyResolver";
import { runSlang, toVscodeDiagnostics, pathToUri } from "./slangRunner";
import { normalizePath } from "./util";

/** 诊断集合（本插件专用） */
let diagnosticCollection: vscode.DiagnosticCollection;
/** 模块索引 */
let moduleIndex = new ModuleIndex();
/** 每个文件的上一次运行取消令牌源（同一文件上次未跑完则取消重跑） */
const runningTokens = new Map<string, vscode.CancellationTokenSource>();
/** 防抖定时器 */
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

export function activate(context: vscode.ExtensionContext): void {
	diagnosticCollection = vscode.languages.createDiagnosticCollection("slang-lint");
	context.subscriptions.push(diagnosticCollection);

	// 命令：手动检查当前文件
	context.subscriptions.push(
		vscode.commands.registerCommand("slangLint.lintCurrentFile", () => {
			const editor = vscode.window.activeTextEditor;
			if (editor) {
				lintDocument(editor.document);
			} else {
				vscode.window.showWarningMessage("Slang Lint: 没有打开的文件");
			}
		})
	);

	// 命令：手动重建模块索引
	context.subscriptions.push(
		vscode.commands.registerCommand("slangLint.rebuildIndex", async () => {
			const root = getRoot();
			if (!root) {
				return;
			}
			await vscode.window.withProgress(
				{ location: vscode.ProgressLocation.Window, title: "Slang Lint: 重建模块索引" },
				() => rebuildIndex(root)
			);
			const size = moduleIndex.size;
			vscode.window.showInformationMessage(
				`Slang Lint: 索引重建完成（${size.modules} 个模块 / ${size.files} 个文件）`
			);
		})
	);

	// 事件：保存触发（防抖）
	context.subscriptions.push(
		vscode.workspace.onDidSaveTextDocument((doc) => {
			// 保存的文件在扫描目录内 → 增量更新索引
			const root = getRoot();
			if (root && isInScanDirs(doc.uri, root, getScanDirs())) {
				moduleIndex.updateFile(doc.uri.fsPath);
			}
			if (getConfig().get<boolean>("lintOnSave", true) && isLintable(doc)) {
				scheduleLint(doc);
			}
		})
	);

	// 事件：打开触发（可选）
	context.subscriptions.push(
		vscode.workspace.onDidOpenTextDocument((doc) => {
			if (getConfig().get<boolean>("lintOnOpen", false) && isLintable(doc)) {
				scheduleLint(doc);
			}
		})
	);

	// 事件：文件删除/重命名 → 从索引移除
	context.subscriptions.push(
		vscode.workspace.onDidDeleteFiles((e) => {
			for (const uri of e.files) {
				moduleIndex.removeFile(uri.fsPath);
			}
		})
	);
	context.subscriptions.push(
		vscode.workspace.onDidRenameFiles((e) => {
			for (const { oldUri, newUri } of e.files) {
				moduleIndex.removeFile(oldUri.fsPath);
				moduleIndex.updateFile(newUri.fsPath);
			}
		})
	);

	// 激活时后台构建索引（不阻塞）
	const root = getRoot();
	if (root) {
		void rebuildIndex(root).then(() => {
			const size = moduleIndex.size;
			console.log(`[slang-lint] 索引就绪: ${size.modules} 模块 / ${size.files} 文件`);
		});
	}
}

export function deactivate(): void {
	if (debounceTimer) {
		clearTimeout(debounceTimer);
	}
	for (const src of runningTokens.values()) {
		src.dispose();
	}
}

/** 获取工作区根目录（多根工作区取第一个） */
function getRoot(): string | undefined {
	const folders = vscode.workspace.workspaceFolders;
	return folders && folders.length > 0 ? folders[0].uri.fsPath : undefined;
}

function getConfig(): vscode.WorkspaceConfiguration {
	return vscode.workspace.getConfiguration("slangLint");
}

function getScanDirs(): string[] {
	return getConfig().get<string[]>("scanDirs", []);
}

/** 判断文档是否可 lint：.v/.sv 且在工作区内 */
function isLintable(doc: vscode.TextDocument): boolean {
	const lower = doc.uri.path.toLowerCase();
	if (!lower.endsWith(".v") && !lower.endsWith(".sv")) {
		return false;
	}
	return doc.uri.scheme === "file" && vscode.workspace.getWorkspaceFolder(doc.uri) !== undefined;
}

/** 防抖调度 lint */
function scheduleLint(doc: vscode.TextDocument): void {
	const debounceMs = getConfig().get<number>("debounceMs", 1000);
	if (debounceTimer) {
		clearTimeout(debounceTimer);
	}
	debounceTimer = setTimeout(() => {
		debounceTimer = null;
		lintDocument(doc);
	}, Math.max(0, debounceMs));
}

/** 对单个文档执行 lint 全流程 */
async function lintDocument(doc: vscode.TextDocument): Promise<void> {
	const root = getRoot();
	if (!root) {
		return;
	}
	const cfg = getConfig();
	const currentFile = doc.uri.fsPath;
	const currentNorm = normalizePath(currentFile);

	// 索引未就绪时先等待构建
	if (moduleIndex.size.files === 0) {
		await rebuildIndex(root);
	}

	// 1. 解析直接子模块
	const { files: childFiles, unresolved } = resolveDirectChildren(
		doc.getText(),
		moduleIndex,
		currentNorm
	);

	// 2. 组装配置路径（相对 → 绝对）
	const toAbs = (p: string) => (path.isAbsolute(p) ? p : path.join(root, p));
	const macroFiles = (cfg.get<string[]>("macroFiles", []) ?? [])
		.map(toAbs)
		.filter((p) => p !== currentNorm);
	const preludeFiles = (cfg.get<string[]>("preludeFiles", []) ?? [])
		.map(toAbs)
		.filter((p) => p !== currentNorm);
	const includeDirs = (cfg.get<string[]>("includeDirs", []) ?? []).map(toAbs);
	const extraArgs = (cfg.get<string>("extraArgs", "") ?? "")
		.split(/\s+/)
		.filter((s) => s.length > 0);

	// 3. 取消同一文件上次未完成的运行
	const prevToken = runningTokens.get(currentNorm);
	if (prevToken) {
		prevToken.cancel();
		prevToken.dispose();
	}
	const tokenSrc = new vscode.CancellationTokenSource();
	runningTokens.set(currentNorm, tokenSrc);

	// 4. 调用 slang
	const result = await runSlang({
		slangPath: cfg.get<string>("slangPath", "slang") ?? "slang",
		root,
		currentFile,
		macroFiles,
		preludeFiles,
		childFiles,
		includeDirs,
		extraArgs,
		token: tokenSrc.token,
	});
	runningTokens.delete(currentNorm);
	tokenSrc.dispose();

	// 5. 发布诊断（若期间文件又被调度，本次结果作废）
	if (tokenSrc.token.isCancellationRequested) {
		return;
	}
	const showChild = cfg.get<boolean>("showChildDiagnostics", false);
	const byFile = toVscodeDiagnostics(result.diagnostics, currentFile, showChild);

	// 先清掉本插件对该文件的旧诊断，再发布新诊断。
	// key 为 slang 输出的原始绝对路径（与 doc.uri.fsPath 同源），
	// 不能用规范化路径（小写盘符）构造 URI，否则与编辑器打开的 URI 不一致，诊断不显示。
	diagnosticCollection.delete(doc.uri);
	for (const [file, diags] of byFile) {
		diagnosticCollection.set(pathToUri(file), diags);
	}

	// 6. 输出通道记录（调试用）
	const chan = getOutputChannel();
	chan.appendLine(
		`[lint] ${path.basename(currentFile)} 子模块 ${childFiles.length} 个` +
			(unresolved.length > 0 ? `，未解析 ${unresolved.length} 个（已忽略）` : "") +
			`，slang 耗时 ${result.elapsedMs} ms`
	);
	if (result.code === null && !tokenSrc.token.isCancellationRequested) {
		chan.appendLine(`[error] ${result.output}`);
		vscode.window.showErrorMessage("Slang Lint: 无法启动 slang，请检查 slangLint.slangPath 配置");
	}
}

/** 重建模块索引 */
async function rebuildIndex(root: string): Promise<void> {
	await moduleIndex.rebuild(root, getScanDirs());
}

/** 懒创建输出通道 */
let outputChannel: vscode.OutputChannel | undefined;
function getOutputChannel(): vscode.OutputChannel {
	if (!outputChannel) {
		outputChannel = vscode.window.createOutputChannel("Slang Lint");
	}
	return outputChannel;
}
