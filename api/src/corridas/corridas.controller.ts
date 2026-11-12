import {
  Body,
  Controller,
  Get,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import type { AuthUser } from '../auth/auth-user';
import { CurrentUser, IdempotencyKey, Roles } from '../auth/decorators';
import {
  CorridaMotoristaView,
  CorridaView,
  toCorridaMotoristaView,
} from './corrida.view';
import { CorridasService } from './corridas.service';
import { CreateCorridaDto, UpdateStatusDto } from './dto';

/** Endpoints HTTP de corridas. Controller fino: valida entrada, chama o service, ajusta headers. */
@Controller('corridas')
export class CorridasController {
  /** Recebe o service de corridas. */
  constructor(private readonly corridas: CorridasService) {}

  /** Cria corrida (passageiro). 201 na criação; 200 + Idempotent-Replayed quando é repetição. */
  @Post()
  @Roles('passageiro')
  async create(
    @CurrentUser() user: AuthUser,
    @IdempotencyKey() idempotencyKey: string,
    @Body() dto: CreateCorridaDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CorridaView> {
    const { corrida, replayed } = await this.corridas.create(
      user,
      dto,
      idempotencyKey,
    );
    if (replayed) {
      res.status(HttpStatus.OK);
      res.setHeader('Idempotent-Replayed', 'true');
    }
    return corrida;
  }

  /** Lista as corridas do próprio passageiro. */
  @Get()
  @Roles('passageiro')
  list(@CurrentUser() user: AuthUser): Promise<CorridaView[]> {
    return this.corridas.listByPassageiro(user);
  }

  /** Lê uma corrida do próprio passageiro usando cache (header X-Cache: HIT|MISS). */
  @Get(':id')
  @Roles('passageiro')
  async findOne(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<CorridaView> {
    const { corrida, cache } = await this.corridas.findForPassageiro(user, id);
    res.setHeader('X-Cache', cache);
    return corrida;
  }

  /** Aceita/inicia/finaliza uma corrida (motorista). Responde com a visão do motorista, sem dados do passageiro. */
  @Patch(':id/status')
  @Roles('motorista')
  async updateStatus(
    @CurrentUser() user: AuthUser,
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() dto: UpdateStatusDto,
  ): Promise<CorridaMotoristaView> {
    return toCorridaMotoristaView(
      await this.corridas.updateStatus(user, id, dto.status),
    );
  }
}
