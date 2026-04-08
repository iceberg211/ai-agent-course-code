export enum TaskStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export enum RunStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  CANCELLED = 'cancelled',
}

export enum StepStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  SKIPPED = 'skipped',
}

export enum ArtifactType {
  MARKDOWN = 'markdown',
  JSON = 'json',
  FILE = 'file',
  CODE = 'code', // 代码块，metadata.language 存语言名（如 "typescript"）
  DIAGRAM = 'diagram', // Mermaid 语法图表
}

export enum ExecutorType {
  TOOL = 'tool',
  SKILL = 'skill',
}
