import { Controller, Get } from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser, Roles } from '../auth/decorators';
import { PainelMotoristaView } from './corrida.view';
import { CorridasService } from './corridas.service';

/**
 * Leitura do motorista: só a lista mínima para escolher e atender corridas.
 * Ele continua sem acesso ao GET /corridas/:id, que é do passageiro dono (403).
 */
@Controller('motorista/corridas')
@Roles('motorista')
export class MotoristaController {
  /** Recebe o service de corridas. */
  constructor(private readonly corridas: CorridasService) {}

  /** Corridas em curso do motorista e corridas disponíveis para aceitar. */
  @Get()
  painel(@CurrentUser() user: AuthUser): Promise<PainelMotoristaView> {
    return this.corridas.painelMotorista(user);
  }
}
