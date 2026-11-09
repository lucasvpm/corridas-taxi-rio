import { readFileSync } from 'node:fs';
import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { AuthUser, isRole, JwtPayload } from './auth-user';

/**
 * Valida o JWT com a CHAVE PÚBLICA (RS256). A API nunca tem a chave privada:
 * quem emite tokens é outro sistema (aqui, o script de tokens de teste).
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  /** Carrega a chave pública e fixa algoritmo, issuer e audience aceitos. */
  constructor(config: ConfigService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: readFileSync(
        config.getOrThrow<string>('JWT_PUBLIC_KEY_PATH'),
        'utf8',
      ),
      algorithms: ['RS256'],
      issuer: config.getOrThrow<string>('JWT_ISSUER'),
      audience: config.getOrThrow<string>('JWT_AUDIENCE'),
    });
  }

  /** Chamado após a assinatura ser válida: exige `sub` e um `role` conhecido (fail closed). */
  validate(payload: JwtPayload): AuthUser {
    if (
      typeof payload.sub !== 'string' ||
      payload.sub.length === 0 ||
      payload.sub.length > 64
    ) {
      throw new UnauthorizedException('Token sem sub válido');
    }
    if (!isRole(payload.role)) {
      throw new UnauthorizedException('Token com role inválido');
    }
    return { sub: payload.sub, role: payload.role };
  }
}
