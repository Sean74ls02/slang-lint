/**
 * util.ts —— 通用工具：注释剥离、路径规范化、源文件过滤
 */

/** 源文件扩展名 */
export const SRC_EXTS = [".v", ".sv"];

/** 跳过的目录名（常见仿真/模板副本目录，含重复模块定义） */
export const SKIP_DIR_NAMES = new Set([
	"testbench",
	"aldec",
	"modelsim",
	"ncsim",
	"synopsys",
]);

/** 跳过的文件名后缀（IP 生成器模板） */
export const SKIP_FILE_SUFFIXES = ["_tmpl.v", "_tmpl.sv", "_tmpl.vhd"];

/**
 * 判断文件名是否为需要扫描的源文件（应用跳过规则）
 */
export function isSourceFile(name: string): boolean {
	const lower = name.toLowerCase();
	if (!SRC_EXTS.some((ext) => lower.endsWith(ext))) {
		return false;
	}
	if (SKIP_FILE_SUFFIXES.some((suf) => lower.endsWith(suf))) {
		return false;
	}
	return true;
}

/**
 * 判断目录名是否应跳过
 */
export function isSkippedDir(name: string): boolean {
	return SKIP_DIR_NAMES.has(name.toLowerCase());
}

/**
 * 逐字符状态机剥离行注释与块注释（保留换行，维持行结构）。
 *
 * 不用正则跨行替换：个别文件注释内含不配对的块注释结束符字样，
 * 正则非贪婪匹配会误吞后续真实代码（与 gen_lint_filelist.py 同思路）。
 */
export function stripComments(text: string): string {
	const out: string[] = [];
	let i = 0;
	const n = text.length;
	while (i < n) {
		const c = text[i];
		if (c === "/" && i + 1 < n) {
			const c2 = text[i + 1];
			if (c2 === "/") {
				// 行注释：跳到行尾（保留换行符）
				const j = text.indexOf("\n", i);
				i = j === -1 ? n : j;
				continue;
			}
			if (c2 === "*") {
				// 块注释：跳到 */（未闭合则到文件尾），换行保留
				const j = text.indexOf("*/", i + 2);
				if (j === -1) {
					out.push("\n".repeat(countChar(text, i, "\n")));
					i = n;
				} else {
					out.push("\n".repeat(countChar(text, i, "\n", j + 2)));
					i = j + 2;
				}
				continue;
			}
		}
		out.push(c);
		i += 1;
	}
	return out.join("");
}

function countChar(text: string, from: number, ch: string, to?: number): number {
	const end = to === undefined ? text.length : to;
	let cnt = 0;
	for (let k = from; k < end; k++) {
		if (text[k] === ch) {
			cnt++;
		}
	}
	return cnt;
}

/**
 * 路径规范化：统一为正斜杠 + 小写盘符（如 x:/a/b）。
 * 用于诊断路径匹配比较，避免大小写/正反斜杠不一致导致丢诊断（旧插件 P5 问题）。
 */
export function normalizePath(p: string): string {
	let s = p.replace(/\\/g, "/");
	if (/^[A-Z]:/.test(s)) {
		s = s[0].toLowerCase() + s.slice(1);
	}
	return s;
}

/**
 * 判断两个路径是否指向同一文件（规范化后比较）
 */
export function samePath(a: string, b: string): boolean {
	return normalizePath(a) === normalizePath(b);
}
