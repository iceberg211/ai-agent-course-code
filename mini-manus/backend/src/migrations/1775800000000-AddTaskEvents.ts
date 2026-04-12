import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddTaskEvents1775800000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "task_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "task_id" uuid,
        "run_id" uuid,
        "event_name" character varying(120) NOT NULL,
        "payload" jsonb NOT NULL DEFAULT '{}',
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_task_events_id" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_task_events_task_id_created_at"
        ON "task_events" ("task_id", "created_at")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_task_events_run_id_created_at"
        ON "task_events" ("run_id", "created_at")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_task_events_task_id"
        ON "task_events" ("task_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_task_events_run_id"
        ON "task_events" ("run_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_task_events_run_id"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_task_events_task_id"`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_task_events_run_id_created_at"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_task_events_task_id_created_at"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "task_events"`);
  }
}
