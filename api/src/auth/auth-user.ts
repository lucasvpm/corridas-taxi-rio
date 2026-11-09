/** Papéis aceitos no claim `role` do JWT. */
export const ROLES = ['passageiro', 'motorista'] as const;
export type Role = (typeof ROLES)[number];

/** Usuário autenticado extraído do token (identidade vem só do token, nunca do body). */
export interface AuthUser {
  sub: string;
  role: Role;
}

/** Payload esperado do JWT após a verificação de assinatura. */
export interface JwtPayload {
  sub?: unknown;
  role?: unknown;
}

/** Type guard que valida o claim de papel. */
export function isRole(value: unknown): value is Role {
  return (
    typeof value === 'string' && (ROLES as readonly string[]).includes(value)
  );
}
