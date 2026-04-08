import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * 为 artifacts 表的 type 枚举添加 'code' 和 'diagram' 两个新值。
 *
 * PostgreSQL 支持 ADD VALUE IF NOT EXISTS（v9.3+），Supabase 运行 PG15，安全。
 * 注意：PostgreSQL 不支持直接 DROP VALUE，down() 需手动处理。
 */
export class AddArtifactTypeCodeDiagram1775645391000 implements MigrationInterface {
  name = 'AddArtifactTypeCodeDiagram1775645391000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "public"."artifacts_type_enum" ADD VALUE IF NOT EXISTS 'code'`,
    );
    await queryRunner.query(
      `ALTER TYPE "public"."artifacts_type_enum" ADD VALUE IF NOT EXISTS 'diagram'`,
    );
  }

  /**
   * PostgreSQL 不支持直接删除枚举值。
   * 如需完整回滚，需要手动将所有 type='code'|'diagram' 的行改为 'markdown'，
   * 然后重建枚举类型。生产环境请谨慎操作。
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  public async down(_queryRunner: QueryRunner): Promise<void> {
    // no-op: intentionally left empty for safety
  }
}
