/**
 * 提示词注入防护工具
 *
 * 职责：
 *  1. detectInjection  — 扫描用户输入，检测常见注入模式
 *  2. sanitizeInput    — 截断超长输入，防止 token 爆炸
 *
 * 防护范围：只扫描"用户直接提供的输入"（task input / revision input）。
 * 工具返回的外部内容（网页、PDF、文件）通过 prompt 层的 <untrusted_content>
 * 标记隔离，不在此处扫描。
 */

const INJECTION_PATTERNS: RegExp[] = [
  // English patterns
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /disregard\s+(your|all|the\s+above)/i,
  /you\s+are\s+now\s+(a|an)\s+/i,
  /<\s*system\s*>/i,
  /reveal\s+(your\s+)?(system\s+)?prompt/i,
  /forget\s+(all|everything|previous|your)/i,
  /new\s+instructions?:/i,
  /act\s+as\s+(if\s+you\s+are|a|an)\s+/i,
  // Chinese patterns
  /忽略.{0,10}(上面|之前|以上|前面).{0,10}指令/,
  /你现在是.{0,20}[助手模型]/,
  /泄露.{0,10}(系统|提示词|prompt)/,
  /输出.{0,10}系统提示/,
  /忘记.{0,10}(你的|之前|以上|所有)/,
];

/** 用户输入最大长度（超出部分截断） */
const MAX_INPUT_LENGTH = 2000;

/**
 * 检测用户输入是否包含注入模式。
 * @returns true 表示疑似注入，应拒绝请求
 */
export function detectInjection(input: string): boolean {
  return INJECTION_PATTERNS.some((pattern) => pattern.test(input));
}

/**
 * 清理用户输入：截断超长内容，去除首尾空白。
 */
export function sanitizeInput(input: string): string {
  return input.slice(0, MAX_INPUT_LENGTH).trim();
}
