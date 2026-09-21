/**
 * moduleIndex.ts —— 模块索引
 *
 * 扫描配置的源码目录，剥离注释后按"文件内实际定义的模块名"
 * 建立 模块名 → 文件路径 映射（不依赖文件名与模块名一致）。
 * 支持全量重建与单文件增量更新。
 */

import * as fs from "fs";
import * as path from "path";
import * as vscode from "vscode";
import { isSkippedDir, isSourceFile, normalizePath, stripComments } from "./util";

/** 模块定义正则：行首 module + 标识符（兼容 module name #( / name( / name;） */
const MODULE_RE = /^\s*module\s+([A-Za-z_][A-Za-z0-9_$]*)/;

/** 从剥离注释后的文本中提取全部模块定义名 */
export function extractModuleNames(strippedText: string): string[] {
	const names: string[] = [];
	for (const line of strippedText.split("\n")) {
		const m = MODULE_RE.exec(line);
		if (m) {
			names.push(m[1]);
		}
	}
	return names;
}

/**
 * 模块索引：模块名 → 定义该模块的文件路径列表（规范化路径）。
 * 同名模块多处定义时保留全部，取第一个（配合 --allow-lib-module-redef）。
 */
export class ModuleIndex {
	/** 模块名 → 文件路径[] */
	private map = new Map<string, string[]>();
	/** 已索引的文件集合（规范化路径） */
	private indexedFiles = new Set<string>();

	/** 全量重建索引（异步，不阻塞 UI） */
	public async rebuild(root: string, scanDirs: string[]): Promise<void> {
		this.map.clear();
		this.indexedFiles.clear();
		const files = await this.collectFiles(root, scanDirs);
		for (const file of files) {
			this.indexFile(file);
		}
	}

	/** 单文件增量更新（保存/新建/删除时调用） */
	public updateFile(file: string): void {
		const norm = normalizePath(file);
		this.removeFile(norm);
		if (fs.existsSync(norm) && isSourceFile(path.basename(norm))) {
			this.indexFile(norm);
		}
	}

	/** 从索引中移除某文件的全部模块定义 */
	public removeFile(file: string): void {
		const norm = normalizePath(file);
		if (!this.indexedFiles.has(norm)) {
			return;
		}
		this.indexedFiles.delete(norm);
		for (const [name, paths] of this.map) {
			const filtered = paths.filter((p) => p !== norm);
			if (filtered.length === 0) {
				this.map.delete(name);
			} else if (filtered.length !== paths.length) {
				this.map.set(name, filtered);
			}
		}
	}

	/** 查询模块名对应的文件路径（未命中返回 undefined） */
	public lookup(moduleName: string): string | undefined {
		const paths = this.map.get(moduleName);
		return paths && paths.length > 0 ? paths[0] : undefined;
	}

	/** 索引规模（模块数 / 文件数） */
	public get size(): { modules: number; files: number } {
		return { modules: this.map.size, files: this.indexedFiles.size };
	}

	/** 索引单个文件：读取 → 剥注释 → 提取模块名 → 建映射 */
	private indexFile(file: string): void {
		const norm = normalizePath(file);
		let text: string;
		try {
			text = fs.readFileSync(norm, "utf-8");
		} catch {
			return;
		}
		this.indexedFiles.add(norm);
		for (const name of extractModuleNames(stripComments(text))) {
			const paths = this.map.get(name);
			if (paths) {
				if (!paths.includes(norm)) {
					paths.push(norm);
				}
			} else {
				this.map.set(name, [norm]);
			}
		}
	}

	/** 递归收集扫描目录下全部源文件（应用跳过规则），返回规范化路径 */
	private async collectFiles(root: string, scanDirs: string[]): Promise<string[]> {
		const result: string[] = [];
		for (const dir of scanDirs) {
			const absDir = path.isAbsolute(dir) ? dir : path.join(root, dir);
			if (!fs.existsSync(absDir)) {
				continue;
			}
			await this.walk(absDir, result);
		}
		return result;
	}

	/** 递归遍历目录（跳过 SKIP_DIR_NAMES 指定的子目录） */
	private async walk(dir: string, result: string[]): Promise<void> {
		let entries: fs.Dirent[];
		try {
			entries = await fs.promises.readdir(dir, { withFileTypes: true });
		} catch {
			return;
		}
		for (const entry of entries) {
			const full = path.join(dir, entry.name);
			if (entry.isDirectory()) {
				if (!isSkippedDir(entry.name)) {
					await this.walk(full, result);
				}
			} else if (entry.isFile() && isSourceFile(entry.name)) {
				result.push(normalizePath(full));
			}
		}
	}
}

/** 判断 URI 是否位于任一扫描目录内（用于决定是否增量更新索引） */
export function isInScanDirs(uri: vscode.Uri, root: string, scanDirs: string[]): boolean {
	const norm = normalizePath(uri.fsPath);
	return scanDirs.some((dir) => {
		const absDir = normalizePath(path.isAbsolute(dir) ? dir : path.join(root, dir));
		return norm.startsWith(absDir + "/");
	});
}
