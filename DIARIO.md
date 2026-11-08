# Diário de Bordo

Registro cronológico e informal: o que tentei, o que quebrou, como investiguei e o que aprendi.

## 2026-11-07
- Li o enunciado e montei o plano de prioridades: Parte 1 sólida → Parte 2 (peso alto) → Parte 3 se der tempo.
- Ambiente: a porta 8080 já estava ocupada na minha máquina (outro processo), então a UI vai para a 5173.
- O Docker Desktop estava parado e o `docker info` falhou com `open //./pipe/dockerDesktopLinuxEngine`. Bastou subir o Desktop.

## 2026-11-08
- Divisão de trabalho: a implementação ficou com o agente (Claude Code) e eu fiquei com o levantamento e a escolha das ferramentas, a direção e a revisão. A Parte 3 foi delegada com harness pesado (skills de regras de código, segurança e TDD adaptadas de um projeto Laravel meu).
- Adaptei as skills de Laravel para NestJS/React. Um conflito apareceu logo: a skill de segurança manda "404, nunca 403" para acesso indevido, mas o enunciado pede para demonstrar o 403. Resolvi assim: papel errado → 403, corrida de outro passageiro → 404 (ver DECISIONS.md).
- Decidi não versionar o PDF do enunciado num repositório público.
