import { MigrationInterface, QueryRunner } from 'typeorm';

/** Cria a tabela `corridas` com as constraints de idempotência e o índice de listagem. */
export class CreateCorridas1731100000000 implements MigrationInterface {
  name = 'CreateCorridas1731100000000';

  /** Aplica a migration. */
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE corridas (
        id CHAR(36) NOT NULL,
        passageiro_id VARCHAR(64) NOT NULL,
        motorista_id VARCHAR(64) NULL,
        origem VARCHAR(200) NOT NULL,
        destino VARCHAR(200) NOT NULL,
        status ENUM('SOLICITADA','ACEITA','EM_ANDAMENTO','FINALIZADA') NOT NULL DEFAULT 'SOLICITADA',
        idempotency_key VARCHAR(128) NOT NULL,
        version INT UNSIGNED NOT NULL DEFAULT 1,
        created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
        updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
        PRIMARY KEY (id),
        UNIQUE KEY uq_corridas_passageiro_idem (passageiro_id, idempotency_key),
        KEY idx_corridas_passageiro_created (passageiro_id, created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
  }

  /** Desfaz a migration. */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE corridas');
  }
}
