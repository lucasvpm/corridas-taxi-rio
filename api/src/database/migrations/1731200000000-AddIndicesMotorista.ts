import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Índices da lista do motorista (GET /motorista/corridas):
 * corridas disponíveis por status (mais recentes primeiro) e as em curso de cada motorista.
 */
export class AddIndicesMotorista1731200000000 implements MigrationInterface {
  name = 'AddIndicesMotorista1731200000000';

  /** Aplica a migration. */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'CREATE INDEX idx_corridas_status_created ON corridas (status, created_at)',
    );
    await queryRunner.query(
      'CREATE INDEX idx_corridas_motorista_status ON corridas (motorista_id, status)',
    );
  }

  /** Desfaz a migration. */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX idx_corridas_motorista_status ON corridas',
    );
    await queryRunner.query(
      'DROP INDEX idx_corridas_status_created ON corridas',
    );
  }
}
