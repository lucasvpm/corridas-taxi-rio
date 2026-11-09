import { Transform } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { STATUS_ALTERAVEIS } from './corrida-status';
import type { CorridaStatus } from './corrida-status';

/** Remove espaços nas pontas de strings vindas do cliente. */
const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;

/** Corpo do POST /corridas. Identidade do passageiro vem do token, nunca do body. */
export class CreateCorridaDto {
  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  @Matches(/^[^<>]*$/, { message: 'origem não pode conter < ou >' })
  origem!: string;

  @Transform(trim)
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  @Matches(/^[^<>]*$/, { message: 'destino não pode conter < ou >' })
  destino!: string;
}

/** Corpo do PATCH /corridas/:id/status. */
export class UpdateStatusDto {
  @IsIn(STATUS_ALTERAVEIS)
  status!: CorridaStatus;
}
