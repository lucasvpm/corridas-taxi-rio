import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { CorridaStatus } from './corrida-status';

/**
 * Corrida persistida no MySQL (fonte da verdade).
 * O índice único (passageiro_id, idempotency_key) é a garantia final de idempotência do POST.
 */
@Entity('corridas')
@Index('uq_corridas_passageiro_idem', ['passageiroId', 'idempotencyKey'], {
  unique: true,
})
@Index('idx_corridas_passageiro_created', ['passageiroId', 'createdAt'])
export class Corrida {
  @PrimaryColumn({ type: 'char', length: 36 })
  id!: string;

  @Column({ name: 'passageiro_id', type: 'varchar', length: 64 })
  passageiroId!: string;

  @Column({ name: 'motorista_id', type: 'varchar', length: 64, nullable: true })
  motoristaId!: string | null;

  @Column({ type: 'varchar', length: 200 })
  origem!: string;

  @Column({ type: 'varchar', length: 200 })
  destino!: string;

  @Column({
    type: 'enum',
    enum: CorridaStatus,
    default: CorridaStatus.SOLICITADA,
  })
  status!: CorridaStatus;

  @Column({ name: 'idempotency_key', type: 'varchar', length: 128 })
  idempotencyKey!: string;

  /** Incrementa a cada mudança de status; ordena eventos e protege contra update concorrente. */
  @Column({ type: 'int', unsigned: true, default: 1 })
  version!: number;

  @CreateDateColumn({ name: 'created_at', type: 'datetime', precision: 3 })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'datetime', precision: 3 })
  updatedAt!: Date;
}
