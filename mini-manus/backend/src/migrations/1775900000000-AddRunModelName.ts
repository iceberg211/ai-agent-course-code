import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRunModelName1775900000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "task_runs"
        ADD COLUMN IF NOT EXISTS "model_name" varchar(120)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "task_runs"
        DROP COLUMN IF EXISTS "model_name"
    `);
  }
}
