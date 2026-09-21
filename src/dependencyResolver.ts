/**
 * dependencyResolver.ts —— 依赖解析
 *
 * 对当前文件剥离注释后，用正则提取实例化的模块名（兼容参数化 #(...) 跨行、
 * 数组实例、generate 内实例化），查模块索引得到直接子模块文件列表。
 *
 * 漏提取的后果只是少传文件，配合 --ignore-unknown-modules 不会误报，
 * 最坏情况是端口检查不全，可接受（见方案文档 3.4 风险分析）。
 */

import { stripComments } from "./util";
import { ModuleIndex } from "./moduleIndex";

/**
 * 实例化正则（全局，多行模式）：
 *   modName [#(...)] instName [range] ( ... );
 * - modName：标识符
 * - 可选参数化 #(...)（点号匹配换行，支持跨行参数传递）
 * - instName：标识符（数组实例允许 [ ] 范围）
 * - 以 "(" 结尾的端口连接
 * 排除关键字（module/if/else/case 等出现在行首定义处的情况由前缀锚定避免）。
 */
const INST_RE =
	/(?:^|[\s;])((?:[A-Za-z_][A-Za-z0-9_$]*))\s*(?:#\s*\([\s\S]*?\))?\s*([A-Za-z_][A-Za-z0-9_$]*)\s*(?:\[[^\]]*\]\s*)?\(\s*[\s\S]*?\)\s*;/g;

/** SV 关键字集合：这些"模块名位置"的词不是实例化 */
const KEYWORDS = new Set([
	"module", "macromodule", "endmodule", "if", "else", "case", "casex", "casez",
	"endcase", "for", "while", "repeat", "forever", "function", "endfunction",
	"task", "endtask", "begin", "end", "assign", "always", "always_ff",
	"always_comb", "always_latch", "initial", "final", "generate", "endgenerate",
	"genvar", "localparam", "parameter", "defparam", "input", "output", "inout",
	"wire", "reg", "logic", "integer", "real", "time", "typedef", "struct",
	"interface", "endinterface", "package", "endpackage", "import", "export",
	"posedge", "negedge", "or", "and", "not", "buf", "return", "void", "string",
	"bit", "byte", "int", "longint", "shortint", "enum", "union", "class",
	"endclass", "virtual", "extends", "new", "this", "unique", "priority",
	"wait", "fork", "join", "join_any", "join_none", "disable", "assert",
	"assume", "cover", "property", "endproperty", "sequence", "endsequence",
	"clocking", "endclocking", "modport", "program", "endprogram", "primitive",
	"endprimitive", "table", "endtable", "specify", "endspecify", "config",
	"cell", "library", "use", "instance", "design",
]);

/** SV 系统任务/函数前缀等，出现在实例名位置时跳过 */
const INST_KEYWORDS = new Set([
	"force", "release", "deassign", "assign", "event", "realtime",
]);

/**
 * 从剥离注释后的文本中提取实例化的模块名（去重）。
 */
export function extractInstantiatedModules(strippedText: string): string[] {
	const found = new Set<string>();
	let m: RegExpExecArray | null;
	INST_RE.lastIndex = 0;
	while ((m = INST_RE.exec(strippedText)) !== null) {
		const modName = m[1];
		const instName = m[2];
		if (KEYWORDS.has(modName) || KEYWORDS.has(instName) || INST_KEYWORDS.has(instName)) {
			continue;
		}
		// 实例名位置若为关键字（如 always @(posedge clk) begin）也排除
		found.add(modName);
	}
	return [...found];
}

/**
 * 解析当前文件的直接子模块文件列表。
 * @param text 当前文件内容（原始，含注释）
 * @param index 模块索引
 * @param currentFile 当前文件路径（排除自身）
 * @returns 直接子模块文件路径列表（去重、不含当前文件）
 */
export function resolveDirectChildren(
	text: string,
	index: ModuleIndex,
	currentFile: string
): { files: string[]; unresolved: string[] } {
	const stripped = stripComments(text);
	const modules = extractInstantiatedModules(stripped);
	const files: string[] = [];
	const seen = new Set<string>();
	const unresolved: string[] = [];
	for (const name of modules) {
		const file = index.lookup(name);
		if (file === undefined) {
			unresolved.push(name);
			continue;
		}
		if (file !== currentFile && !seen.has(file)) {
			seen.add(file);
			files.push(file);
		}
	}
	return { files, unresolved };
}
