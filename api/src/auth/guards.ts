import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import type { Request } from 'express';
import { AuthUser, Role } from './auth-user';
import { IS_PUBLIC_KEY, ROLES_KEY } from './decorators';

/**
 * Guard global de autenticação (deny by default): toda rota exige JWT válido,
 * a não ser que esteja marcada com @Public(). Sem token ou token inválido → 401.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  /** Recebe o Reflector para ler o metadata @Public(). */
  constructor(private readonly reflector: Reflector) {
    super();
  }

  /** Libera rotas públicas e delega o resto para a JwtStrategy. */
  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }
}

/**
 * Guard global de autorização por papel. Roda depois do JwtAuthGuard.
 * Papel fora da lista de @Roles() → 403.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  /** Recebe o Reflector para ler o metadata @Roles(). */
  constructor(private readonly reflector: Reflector) {}

  /** Compara o papel do token com os papéis exigidos pela rota. */
  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!roles || roles.length === 0) return true;
    const user = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthUser }>().user;
    if (!user || !roles.includes(user.role)) {
      throw new ForbiddenException(
        `Ação permitida apenas para: ${roles.join(', ')}`,
      );
    }
    return true;
  }
}
