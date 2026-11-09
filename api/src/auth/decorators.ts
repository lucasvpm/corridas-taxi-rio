import {
  BadRequestException,
  createParamDecorator,
  ExecutionContext,
  SetMetadata,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthUser, Role } from './auth-user';

export const IS_PUBLIC_KEY = 'isPublic';
export const ROLES_KEY = 'roles';

/** Marca a rota como pública (sem JWT). Usado só em /health e /metrics. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Restringe a rota aos papéis informados; papel diferente recebe 403. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/** Injeta no handler o usuário autenticado pelo JwtAuthGuard. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const req = ctx.switchToHttp().getRequest<Request & { user: AuthUser }>();
    return req.user;
  },
);

const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

/**
 * Lê e valida o header `Idempotency-Key`. É obrigatório no POST /corridas:
 * sem ele não há como o cliente repetir a requisição com segurança.
 */
export const IdempotencyKey = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const req = ctx.switchToHttp().getRequest<Request>();
    const value = req.header('idempotency-key');
    if (!value || !IDEMPOTENCY_KEY_PATTERN.test(value)) {
      throw new BadRequestException(
        'Header Idempotency-Key obrigatório (1-128 caracteres: letras, números, . _ : -)',
      );
    }
    return value;
  },
);
