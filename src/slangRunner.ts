/**
 * slangRunner.ts —— slang 调用与诊断解析
 *
 * 参数组装：宏文件 + 前置文件(interface) + 当前文件 + 直接子模块文件，
 * 显式传参，不用 -y 库目录搜索（避免 slang 目录扫描导致的 ~90s 慢）。
 * 诊断路径规范化后匹配，只发布当前文件的诊断（可选显示子模块诊断）。
 */

import { spawn } from "child_process";
import { readFileSync } from "fs";
import * as vscode from "vscode";
import * as path from "path";
import { normalizePath } from "./util";

/** slang 诊断行正则：file:line:col: severity: message [code] */
const DIAG_RE = /^(.+?):(\d+):(\d+):\s*(note|warning|error|fatal):\s*(.*)$/;

export interface SlangDiag {
	file: string;
	line: number;
	col: number;
	severity: "note" | "warning" | "error" | "fatal";
	message: string;
}

/**
 * 解析 slang stdout/stderr 中的全部诊断行。
 * @param cwd slang 进程工作目录：slang 输出的文件路径是相对该目录的，
 *            需解析为绝对路径，否则与当前文件绝对路径匹配失败（丢诊断）
 */
export function parseDiagnostics(output: string, cwd?: string): SlangDiag[] {
	const diags: SlangDiag[] = [];
	for (const rawLine of output.split(/\r?\n/)) {
		const line = rawLine.trimEnd();
		const m = DIAG_RE.exec(line);
		if (!m) {
			continue;
		}
		let file = m[1];
		if (cwd && !path.isAbsolute(file)) {
			file = path.resolve(cwd, file);
		}
		diags.push({
			file,
			line: parseInt(m[2], 10),
			col: parseInt(m[3], 10),
			severity: m[4] as SlangDiag["severity"],
			message: m[5].trim(),
		});
	}
	return diags;
}

export interface SlangRunOptions {
	/** slang 可执行文件 */
	slangPath: string;
	/** 工作区根目录（绝对路径） */
	root: string;
	/** 当前被检查文件（绝对路径） */
	currentFile: string;
	/** 宏定义文件（绝对路径，最先编译） */
	macroFiles: string[];
	/** 前置文件（interface 等，绝对路径） */
	preludeFiles: string[];
	/** 直接子模块文件（绝对路径） */
	childFiles: string[];
	/** `include 搜索目录（绝对路径） */
	includeDirs: string[];
	/** 附加参数（原样追加） */
	extraArgs: string[];
	/** 取消令牌 */
	token?: vscode.CancellationToken;
}

export interface SlangRunResult {
	/** slang 进程退出码（null = 被取消/启动失败） */
	code: number | null;
	/** 合并后的 stdout+stderr */
	output: string;
	/** 解析出的诊断 */
	diagnostics: SlangDiag[];
	/** 耗时（毫秒） */
	elapsedMs: number;
}

/** 组装 slang 命令行参数（不含可执行文件本身） */
export function buildArgs(opts: SlangRunOptions): string[] {
	const args: string[] = [
		"--single-unit",
		"--error-limit=0",
		"--libraries-inherit-macros",
		"--allow-lib-module-redef",
		"--timescale", "1ns/1ps",
		"--allow-toplevel-iface-ports",
		"--ignore-unknown-modules",
		// 未声明的隐式 wire（如 assign 左值未声明信号）报 warning
		"-Wunknown-warning-option",
		"-Wunused-implicit-net",
	];
	for (const dir of opts.includeDirs) {
		args.push("-I", dir);
	}
	// 编译顺序：宏文件 → 前置文件 → 当前文件 → 直接子模块
	for (const f of opts.macroFiles) {
		args.push(f);
	}
	for (const f of opts.preludeFiles) {
		args.push(f);
	}
	args.push(opts.currentFile);
	for (const f of opts.childFiles) {
		args.push(f);
	}
	args.push(...opts.extraArgs);
	return args;
}

/**
 * 调用 slang 执行单文件 lint。
 * slang 有诊断时退出码非 0，属正常情况，不视为失败。
 */
export function runSlang(opts: SlangRunOptions): Promise<SlangRunResult> {
	return new Promise((resolve) => {
		const start = Date.now();
		const args = buildArgs(opts);
		const p = spawn(opts.slangPath, args, {
			cwd: opts.root,
			windowsHide: true,
		});

		let output = "";
		const append = (chunk: Buffer | string) => {
			output += chunk.toString();
		};
		p.stdout.on("data", append);
		p.stderr.on("data", append);

		let cancelled = false;
		if (opts.token) {
			opts.token.onCancellationRequested(() => {
				cancelled = true;
				p.kill();
			});
		}

		p.on("error", (err) => {
			resolve({
				code: null,
				output: `无法启动 slang (${opts.slangPath}): ${err.message}`,
				diagnostics: [],
				elapsedMs: Date.now() - start,
			});
		});

		p.on("close", (code) => {
			resolve({
				code: cancelled ? null : code,
				output,
				diagnostics: parseDiagnostics(output, opts.root),
				elapsedMs: Date.now() - start,
			});
		});
	});
}

/** slang 严重级别 → VSCode DiagnosticSeverity */
function toSeverity(sev: SlangDiag["severity"]): vscode.DiagnosticSeverity {
	switch (sev) {
		case "error":
		case "fatal":
			return vscode.DiagnosticSeverity.Error;
		case "warning":
			return vscode.DiagnosticSeverity.Warning;
		default:
			return vscode.DiagnosticSeverity.Information;
	}
}

/**
 * 把 slang 诊断转换为 VSCode 诊断集合。
 * 路径规范化后匹配：默认只保留当前文件的诊断（showChildDiagnostics=false），
 * 彻底避免旧插件 endsWith 匹配导致的丢诊断问题。
 *
 * 注意：Map key 用 slang 输出的原始绝对路径（与 doc.uri.fsPath 同源），
 * 规范化路径仅用于比较 —— 若用规范化路径（小写盘符）构造 URI，
 * 会与 VSCode 打开文件的 URI 大小写不一致，导致诊断不显示。
 */
export function toVscodeDiagnostics(
	diags: SlangDiag[],
	currentFile: string,
	showChildDiagnostics: boolean
): Map<string, vscode.Diagnostic[]> {
	const byFile = new Map<string, vscode.Diagnostic[]>();
	const currentNorm = normalizePath(currentFile);
	// 文件行缓存：同一文件多条诊断只读一次磁盘
	const lineCache = new Map<string, string[]>();
	for (const d of diags) {
		if (!showChildDiagnostics && normalizePath(d.file) !== currentNorm) {
			continue;
		}
		const list = byFile.get(d.file) ?? [];
		const line = Math.max(0, d.line - 1);
		const col = Math.max(0, d.col - 1);
		const len = tokenLengthAt(d.file, line, col, lineCache);
		const diag = new vscode.Diagnostic(
			new vscode.Range(line, col, line, col + len),
			d.message,
			toSeverity(d.severity)
		);
		diag.source = "slang";
		list.push(diag);
		byFile.set(d.file, list);
	}
	return byFile;
}

/**
 * 计算诊断起始位置处 token 的长度，用于波浪线覆盖整个标识符
 * （slang 只输出起始列，不输出长度）。
 * 从起始列向后匹配标识符字符序列；匹配不到（如标点/越界）回退 1 字符。
 */
function tokenLengthAt(
	file: string,
	line0: number,
	col0: number,
	lineCache: Map<string, string[]>
): number {
	let lines = lineCache.get(file);
	if (lines === undefined) {
		try {
			lines = readFileSync(file, "utf8").split(/\r?\n/);
		} catch {
			lines = [];
		}
		lineCache.set(file, lines);
	}
	const text = lines[line0] ?? "";
	// 含反引号：宏引用（如 `MACRO）整体划线；含前导点：层次引用成员（如 .u_xxx）整体划线
	const m = /^`?\.?[A-Za-z0-9_$]+/.exec(text.slice(col0));
	return m ? m[0].length : 1;
}

/** 规范化路径 → vscode.Uri（Windows 下保持盘符大写亦可，Uri 自动处理） */
export function pathToUri(normPath: string): vscode.Uri {
	return vscode.Uri.file(path.resolve(normPath));
}
