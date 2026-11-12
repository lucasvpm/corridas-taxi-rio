import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, QueryFailedError, Repository } from 'typeorm';
import { AuthUser } from '../auth/auth-user';
import { CorridaCacheService } from '../cache/corrida-cache.service';
import { EventPublisher } from '../messaging/event-publisher.service';
import { ROUTING_KEYS } from '../messaging/topology';
import { cacheReads } from '../observability/metrics';
import { Corrida } from './corrida.entity';
import {
  CorridaStatus,
  podeTransitar,
  STATUS_EM_CURSO,
} from './corrida-status';
import {
  CorridaView,
  PainelMotoristaView,
  toCorridaMotoristaView,
  toCorridaView,
} from './corrida.view';
import { CreateCorridaDto } from './dto';

export interface CreateResult {
  corrida: CorridaView;
  replayed: boolean;
}

export interface FindResult {
  corrida: CorridaView;
  cache: 'HIT' | 'MISS';
}

/** Detecta violação de UNIQUE no MySQL (ER_DUP_ENTRY = 1062). */
function isDuplicateKey(err: unknown): boolean {
  if (!(err instanceof QueryFailedError)) return false;
  const driverError = err.driverError as
    { code?: string; errno?: number } | undefined;
  return driverError?.code === 'ER_DUP_ENTRY' || driverError?.errno === 1062;
}

/** Regras de negócio das corridas: criação idempotente, transições de status e leitura com cache. */
@Injectable()
export class CorridasService {
  /** Recebe repositório, cache e publisher por injeção de dependência. */
  constructor(
    @InjectRepository(Corrida) private readonly repo: Repository<Corrida>,
    private readonly cache: CorridaCacheService,
    private readonly publisher: EventPublisher,
  ) {}

  /**
   * Cria uma corrida de forma idempotente por (passageiro, Idempotency-Key).
   * 1) Se já existe, devolve a existente (replay). 2) Senão insere. 3) Se duas requisições
   * iguais chegarem juntas, o UNIQUE do banco barra a segunda (ER_DUP_ENTRY) e ela vira replay.
   */
  async create(
    user: AuthUser,
    dto: CreateCorridaDto,
    idempotencyKey: string,
  ): Promise<CreateResult> {
    const existing = await this.repo.findOneBy({
      passageiroId: user.sub,
      idempotencyKey,
    });
    if (existing) return this.replay(existing, dto);

    const id = randomUUID();
    try {
      await this.repo.insert({
        id,
        passageiroId: user.sub,
        motoristaId: null,
        origem: dto.origem,
        destino: dto.destino,
        status: CorridaStatus.SOLICITADA,
        idempotencyKey,
        version: 1,
      });
    } catch (err) {
      if (!isDuplicateKey(err)) throw err;
      const winner = await this.repo.findOneByOrFail({
        passageiroId: user.sub,
        idempotencyKey,
      });
      return this.replay(winner, dto);
    }

    const corrida = toCorridaView(await this.repo.findOneByOrFail({ id }));
    await this.publisher.publish(ROUTING_KEYS.criada, corrida);
    return { corrida, replayed: false };
  }

  /** Resposta para uma Idempotency-Key repetida: mesmo payload devolve a corrida original; payload diferente é 422. */
  private replay(existing: Corrida, dto: CreateCorridaDto): CreateResult {
    if (existing.origem !== dto.origem || existing.destino !== dto.destino) {
      throw new UnprocessableEntityException(
        'Idempotency-Key já utilizada com outro payload',
      );
    }
    return { corrida: toCorridaView(existing), replayed: true };
  }

  /** Lista as corridas do passageiro (mais recentes primeiro). Lê do MySQL. */
  async listByPassageiro(user: AuthUser): Promise<CorridaView[]> {
    const corridas = await this.repo.find({
      where: { passageiroId: user.sub },
      order: { createdAt: 'DESC' },
      take: 50,
    });
    return corridas.map(toCorridaView);
  }

  /**
   * Lê uma corrida com cache-aside: tenta o Redis; em MISS lê o MySQL e popula o cache.
   * Corrida de outro passageiro → 404 (não confirma que o recurso existe; proteção contra IDOR).
   */
  async findForPassageiro(user: AuthUser, id: string): Promise<FindResult> {
    const cached = await this.cache.get(id);
    if (cached) {
      if (cached.passageiro_id !== user.sub)
        throw new NotFoundException('Corrida não encontrada');
      cacheReads.inc({ result: 'hit' });
      return { corrida: cached, cache: 'HIT' };
    }

    const corrida = await this.repo.findOneBy({ id });
    if (!corrida || corrida.passageiroId !== user.sub) {
      throw new NotFoundException('Corrida não encontrada');
    }
    const view = toCorridaView(corrida);
    await this.cache.setIfNewer(view);
    cacheReads.inc({ result: 'miss' });
    return { corrida: view, cache: 'MISS' };
  }

  /**
   * Muda o status de uma corrida (somente motorista).
   * - Iniciar/finalizar corrida já atribuída a OUTRO motorista → 403. Checado antes da
   *   máquina de estados para não revelar o status da corrida alheia na mensagem do 409.
   * - Transição fora da máquina de estados → 409.
   * - O UPDATE é condicional (status + version): se outra requisição mudou a corrida no meio
   *   do caminho (ex.: dois motoristas aceitando juntos), affected = 0 e devolvemos 409.
   * - Após o commit, a própria API atualiza o cache (CAS por versão) além de publicar o evento:
   *   se a publicação falhar, o GET não fica preso no status antigo até o TTL expirar.
   */
  async updateStatus(
    user: AuthUser,
    id: string,
    novo: CorridaStatus,
  ): Promise<CorridaView> {
    const atual = await this.repo.findOneBy({ id });
    if (!atual) throw new NotFoundException('Corrida não encontrada');

    const atribuidaAOutro =
      atual.motoristaId !== null && atual.motoristaId !== user.sub;
    if (novo !== CorridaStatus.ACEITA && atribuidaAOutro) {
      throw new ForbiddenException('Corrida atribuída a outro motorista');
    }
    if (!podeTransitar(atual.status, novo)) {
      throw new ConflictException(
        `Transição inválida: ${atual.status} -> ${novo}`,
      );
    }

    const motoristaId =
      novo === CorridaStatus.ACEITA ? user.sub : atual.motoristaId;
    const result = await this.repo
      .createQueryBuilder()
      .update(Corrida)
      .set({ status: novo, motoristaId, version: () => 'version + 1' })
      .where('id = :id AND status = :status AND version = :version', {
        id,
        status: atual.status,
        version: atual.version,
      })
      .execute();

    if (result.affected !== 1) {
      throw new ConflictException(
        'A corrida foi alterada por outra requisição; recarregue e tente de novo',
      );
    }

    const view = toCorridaView(await this.repo.findOneByOrFail({ id }));
    await this.cache.setIfNewer(view);
    await this.publisher.publish(
      ROUTING_KEYS.statusAlterado,
      view,
      atual.status,
    );
    return view;
  }

  /**
   * Painel do motorista: as corridas que ele está atendendo e as que esperam alguém aceitar.
   * Disponíveis vêm das mais recentes para as mais antigas: sem localização não existe critério
   * real de despacho, e assim um pedido novo sempre aparece (ver DECISIONS.md, entrada 8).
   * Lê do MySQL, como a lista do passageiro: o cache guarda corridas individuais, não listas.
   */
  async painelMotorista(user: AuthUser): Promise<PainelMotoristaView> {
    const [emCurso, disponiveis] = await Promise.all([
      this.repo.find({
        where: { motoristaId: user.sub, status: In([...STATUS_EM_CURSO]) },
        order: { createdAt: 'ASC' },
        take: 50,
      }),
      this.repo.find({
        where: { status: CorridaStatus.SOLICITADA },
        order: { createdAt: 'DESC' },
        take: 50,
      }),
    ]);
    const paraMotorista = (c: Corrida) =>
      toCorridaMotoristaView(toCorridaView(c));
    return {
      em_curso: emCurso.map(paraMotorista),
      disponiveis: disponiveis.map(paraMotorista),
    };
  }
}
