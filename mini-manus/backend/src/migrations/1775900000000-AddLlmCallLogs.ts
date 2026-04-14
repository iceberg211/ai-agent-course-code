import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLlmCallLogs1775900000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "llm_call_logs" (
        "id"                uuid          NOT NULL DEFAULT uuid_generate_v4(),
        "run_id"            uuid          NOT NULL,
        "node_name"         varchar(64)   NOT NULL,
        "model_name"        varchar(128),
        "input_tokens"      integer       NOT NULL DEFAULT 0,
        "output_tokens"     integer       NOT NULL DEFAULT 0,
        "total_tokens"      integer       NOT NULL DEFAULT 0,
        "estimated_cost_usd" decimal(10,6),
        "duration_ms"       integer,
        "created_at"        timestamptz   NOT NULL DEFAULT now(),
        CONSTRAINT "PK_llm_call_logs" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_llm_call_logs_run_id" ON "llm_call_logs" ("run_id")`
    );
    await queryRunner.query(`
      DELETE FROM "llm_call_logs" logs
      WHERE NOT EXISTS (
        SELECT 1 FROM "task_runs" runs WHERE runs."id" = logs."run_id"
      )
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1
          FROM pg_constraint
          WHERE conname = 'FK_llm_call_logs_run_id'
        ) THEN
          ALTER TABLE "llm_call_logs"
          ADD CONSTRAINT "FK_llm_call_logs_run_id"
          FOREIGN KEY ("run_id")
          REFERENCES "task_runs"("id")
          ON DELETE CASCADE
          ON UPDATE NO ACTION;
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "llm_call_logs"`);
  }
}
