import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddHitlColumns1775800000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    // 新增 AWAITING_APPROVAL 枚举值
    await queryRunner.query(
      `ALTER TYPE "public"."task_runs_status_enum" ADD VALUE IF NOT EXISTS 'awaiting_approval'`,
    );

    await queryRunner.query(`
      ALTER TABLE "task_runs"
        ADD COLUMN IF NOT EXISTS "approval_mode"            varchar(20)  NOT NULL DEFAULT 'none',
        ADD COLUMN IF NOT EXISTS "pending_approval_step"    jsonb
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "task_runs"
        DROP COLUMN IF EXISTS "approval_mode",
        DROP COLUMN IF EXISTS "pending_approval_step"
    `);
    // PostgreSQL 不支持直接 DROP ENUM VALUE，down 不回滚 enum
  }
}
