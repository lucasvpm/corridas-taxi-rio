import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PassportModule } from '@nestjs/passport';
import { JwtAuthGuard, RolesGuard } from './guards';
import { JwtStrategy } from './jwt.strategy';

/**
 * Registra os guards como globais (APP_GUARD). A ordem importa:
 * primeiro autentica (401), depois autoriza por papel (403).
 */
@Module({
  imports: [PassportModule],
  providers: [
    JwtStrategy,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AuthModule {}
