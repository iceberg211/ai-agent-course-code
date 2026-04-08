import { MigrationInterface, QueryRunner } from "typeorm";

export class Init1775634103074 implements MigrationInterface {
    name = 'Init1775634103074'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`CREATE TYPE "public"."step_runs_status_enum" AS ENUM('pending', 'running', 'completed', 'failed', 'skipped')`);
        await queryRunner.query(`CREATE TYPE "public"."step_runs_executor_type_enum" AS ENUM('tool', 'skill')`);
        await queryRunner.query(`CREATE TABLE "step_runs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "run_id" uuid NOT NULL, "plan_step_id" uuid NOT NULL, "execution_order" integer NOT NULL, "status" "public"."step_runs_status_enum" NOT NULL DEFAULT 'pending', "executor_type" "public"."step_runs_executor_type_enum" NOT NULL DEFAULT 'tool', "skill_name" character varying, "tool_name" character varying, "tool_input" jsonb, "tool_output" text, "skill_trace" jsonb, "llm_reasoning" text, "result_summary" text, "error_message" text, "started_at" TIMESTAMP WITH TIME ZONE, "completed_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_d5056e8eb4318c67f42c86cdb06" UNIQUE ("run_id", "execution_order"), CONSTRAINT "PK_5786a3a2b02a77b446ce02c4c09" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_532f352173cb5ad89a8af8be00" ON "step_runs" ("plan_step_id") `);
        await queryRunner.query(`CREATE TABLE "plan_steps" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "plan_id" uuid NOT NULL, "step_index" integer NOT NULL, "description" text NOT NULL, "skill_name" character varying, "skill_input" jsonb, "tool_hint" character varying, "tool_input" jsonb, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_362b986b4e803674f0328196b8f" UNIQUE ("plan_id", "step_index"), CONSTRAINT "PK_04159b647c1b05a37f7fefc1ef7" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TABLE "task_plans" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "run_id" uuid NOT NULL, "version" integer NOT NULL DEFAULT '1', "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_7738c9b5605cd91c87810be5555" UNIQUE ("run_id", "version"), CONSTRAINT "PK_1cde2d71fb41a159e3ff7f10250" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."artifacts_type_enum" AS ENUM('markdown', 'json', 'file')`);
        await queryRunner.query(`CREATE TABLE "artifacts" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "run_id" uuid NOT NULL, "type" "public"."artifacts_type_enum" NOT NULL DEFAULT 'markdown', "title" character varying NOT NULL, "content" text NOT NULL, "metadata" jsonb, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_6516bbed3c129918e05c5012edb" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_3468f92022f7d5254bf3240954" ON "artifacts" ("run_id") `);
        await queryRunner.query(`CREATE TYPE "public"."task_runs_status_enum" AS ENUM('pending', 'running', 'completed', 'failed', 'cancelled')`);
        await queryRunner.query(`CREATE TABLE "task_runs" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "task_id" uuid NOT NULL, "revision_id" uuid NOT NULL, "status" "public"."task_runs_status_enum" NOT NULL DEFAULT 'pending', "run_number" integer NOT NULL DEFAULT '1', "cancel_requested" boolean NOT NULL DEFAULT false, "error_message" text, "started_at" TIMESTAMP WITH TIME ZONE, "completed_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_63c90d0a97699d3fcd7d054c6a7" UNIQUE ("revision_id", "run_number"), CONSTRAINT "PK_52c37d0e12c4de37ae7bbff7850" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_fd5a2edff80c74ec83c73a055b" ON "task_runs" ("status") `);
        await queryRunner.query(`CREATE TABLE "task_revisions" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "task_id" uuid NOT NULL, "version" integer NOT NULL, "input" text NOT NULL, "created_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "UQ_a45ab2d32bd805b99a1dcfbeb8e" UNIQUE ("task_id", "version"), CONSTRAINT "PK_0f89fb17cc1312ffe3ed4c81f1f" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE TYPE "public"."tasks_status_enum" AS ENUM('pending', 'running', 'completed', 'failed', 'cancelled')`);
        await queryRunner.query(`CREATE TABLE "tasks" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "title" character varying(500) NOT NULL, "status" "public"."tasks_status_enum" NOT NULL DEFAULT 'pending', "current_revision_id" uuid, "current_run_id" uuid, "created_at" TIMESTAMP NOT NULL DEFAULT now(), "updated_at" TIMESTAMP NOT NULL DEFAULT now(), CONSTRAINT "PK_8d12ff38fcc62aaba2cab748772" PRIMARY KEY ("id"))`);
        await queryRunner.query(`CREATE INDEX "IDX_4e5166eaeee652dc183151c505" ON "tasks" ("current_revision_id") `);
        await queryRunner.query(`CREATE INDEX "IDX_d3743b8de71d0b1c7a5e1d56b8" ON "tasks" ("current_run_id") `);
        await queryRunner.query(`ALTER TABLE "step_runs" ADD CONSTRAINT "FK_2d7688ae3e7bc87403191972cdf" FOREIGN KEY ("run_id") REFERENCES "task_runs"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "step_runs" ADD CONSTRAINT "FK_532f352173cb5ad89a8af8be00e" FOREIGN KEY ("plan_step_id") REFERENCES "plan_steps"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "plan_steps" ADD CONSTRAINT "FK_937967a265719b84b5f84b3448e" FOREIGN KEY ("plan_id") REFERENCES "task_plans"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "task_plans" ADD CONSTRAINT "FK_9a71680b2b840a71e8ae57af261" FOREIGN KEY ("run_id") REFERENCES "task_runs"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "artifacts" ADD CONSTRAINT "FK_3468f92022f7d5254bf3240954c" FOREIGN KEY ("run_id") REFERENCES "task_runs"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "task_runs" ADD CONSTRAINT "FK_33f9addf6e998af00182fe26336" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "task_runs" ADD CONSTRAINT "FK_7bf1824fd03a4dac58d1e7d6440" FOREIGN KEY ("revision_id") REFERENCES "task_revisions"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
        await queryRunner.query(`ALTER TABLE "task_revisions" ADD CONSTRAINT "FK_f7ba332a8be1e664b868830e656" FOREIGN KEY ("task_id") REFERENCES "tasks"("id") ON DELETE NO ACTION ON UPDATE NO ACTION`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "task_revisions" DROP CONSTRAINT "FK_f7ba332a8be1e664b868830e656"`);
        await queryRunner.query(`ALTER TABLE "task_runs" DROP CONSTRAINT "FK_7bf1824fd03a4dac58d1e7d6440"`);
        await queryRunner.query(`ALTER TABLE "task_runs" DROP CONSTRAINT "FK_33f9addf6e998af00182fe26336"`);
        await queryRunner.query(`ALTER TABLE "artifacts" DROP CONSTRAINT "FK_3468f92022f7d5254bf3240954c"`);
        await queryRunner.query(`ALTER TABLE "task_plans" DROP CONSTRAINT "FK_9a71680b2b840a71e8ae57af261"`);
        await queryRunner.query(`ALTER TABLE "plan_steps" DROP CONSTRAINT "FK_937967a265719b84b5f84b3448e"`);
        await queryRunner.query(`ALTER TABLE "step_runs" DROP CONSTRAINT "FK_532f352173cb5ad89a8af8be00e"`);
        await queryRunner.query(`ALTER TABLE "step_runs" DROP CONSTRAINT "FK_2d7688ae3e7bc87403191972cdf"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_d3743b8de71d0b1c7a5e1d56b8"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_4e5166eaeee652dc183151c505"`);
        await queryRunner.query(`DROP TABLE "tasks"`);
        await queryRunner.query(`DROP TYPE "public"."tasks_status_enum"`);
        await queryRunner.query(`DROP TABLE "task_revisions"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_fd5a2edff80c74ec83c73a055b"`);
        await queryRunner.query(`DROP TABLE "task_runs"`);
        await queryRunner.query(`DROP TYPE "public"."task_runs_status_enum"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_3468f92022f7d5254bf3240954"`);
        await queryRunner.query(`DROP TABLE "artifacts"`);
        await queryRunner.query(`DROP TYPE "public"."artifacts_type_enum"`);
        await queryRunner.query(`DROP TABLE "task_plans"`);
        await queryRunner.query(`DROP TABLE "plan_steps"`);
        await queryRunner.query(`DROP INDEX "public"."IDX_532f352173cb5ad89a8af8be00"`);
        await queryRunner.query(`DROP TABLE "step_runs"`);
        await queryRunner.query(`DROP TYPE "public"."step_runs_executor_type_enum"`);
        await queryRunner.query(`DROP TYPE "public"."step_runs_status_enum"`);
    }

}
