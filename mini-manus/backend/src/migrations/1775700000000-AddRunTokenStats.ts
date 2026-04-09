import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRunTokenStats1775700000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "task_runs"
        ADD COLUMN IF NOT EXISTS "input_tokens"       integer,
        ADD COLUMN IF NOT EXISTS "output_tokens"      integer,
        ADD COLUMN IF NOT EXISTS "total_tokens"       integer,
        ADD COLUMN IF NOT EXISTS "estimated_cost_usd" decimal(10,6)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "task_runs"
        DROP COLUMN IF EXISTS "input_tokens",
        DROP COLUMN IF EXISTS "output_tokens",
        DROP COLUMN IF EXISTS "total_tokens",
        DROP COLUMN IF EXISTS "estimated_cost_usd"
    `);
  }
}
