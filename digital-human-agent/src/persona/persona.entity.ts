import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

// ── persona 级 RAG 编排策略 ─────────────────────────────────────────────────────
export interface PersonaRagPolicy {
  schemaVersion: 1;
  /**
   * 低置信度判定阈值（0-1）。
   * `confidence.finalConfidence < minConfidence` 时视为低置信度，可触发 fallback。
   * 默认 0.45。
   */
  minConfidence: number;
  /**
   * Query Rewrite 策略：是否对用户问题做多轮改写。
   * 默认关闭，开启后会利用最近 historyTurns 轮对话上下文。
   */
  queryRewrite: {
    enabled: boolean;
    historyTurns: number;
  };
  /**
   * Multi-hop 策略：复杂问题拆解为多个子问题逐步检索。
   * 默认关闭。
   */
  multiHop: {
    enabled: boolean;
    maxSubQuestions: number;
    maxRetrievals: number;
  };
  /**
   * 联网 fallback 策略：本地低置信度时是否联网补充。
   * 默认 policy='never'，禁止联网。
   */
  webFallback: {
    enabled: boolean;
    policy: 'never' | 'low_confidence' | 'user_confirmed' | 'realtime_only';
    requireConfirmation: boolean;
  };
}

/** 创建新 persona 时使用的 ragPolicy 默认值 */
export const DEFAULT_RAG_POLICY: PersonaRagPolicy = {
  schemaVersion: 1,
  minConfidence: 0.45,
  queryRewrite: { enabled: false, historyTurns: 4 },
  multiHop: { enabled: false, maxSubQuestions: 4, maxRetrievals: 4 },
  webFallback: { enabled: false, policy: 'never', requireConfirmation: true },
};

@Entity('persona')
export class Persona {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column({ nullable: true })
  description: string;

  @Column({ name: 'speaking_style', nullable: true })
  speakingStyle: string;

  @Column({ type: 'jsonb', default: [] })
  expertise: string[];

  @Column({ name: 'voice_id', nullable: true })
  voiceId: string;

  @Column({ name: 'avatar_id', nullable: true })
  avatarId: string;

  @Column({ name: 'system_prompt_extra', nullable: true })
  systemPromptExtra: string;

  /**
   * Persona 级 RAG 编排策略。
   * - null 时降级使用 `DEFAULT_RAG_POLICY`（由业务层 fallback）。
   * - 数据库列：`rag_policy JSONB`（需执行迁移 `009_persona_rag_policy.sql`）。
   */
  @Column({ name: 'rag_policy', type: 'jsonb', nullable: true })
  ragPolicy: PersonaRagPolicy | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
