# 导入路径规范

## 目标
- 统一使用根路径别名导入，提升可读性，避免层级调整导致的大量改动。

## 规则
- 后端 `src` 目录内代码一律使用 `@/` 作为根路径前缀。
- 禁止使用 `./`、`../` 形式的相对路径导入。
- 允许第三方包名导入（例如 `@nestjs/common`、`rxjs`）。

## 示例
- 正确：`import { TaskService } from '@/task/task.service';`
- 错误：`import { TaskService } from '../task/task.service';`

