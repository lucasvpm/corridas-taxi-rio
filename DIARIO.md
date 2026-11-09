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
- O Docker não subia de jeito nenhum. Meu primeiro palpite foi a BIOS, mas o Windows dizia `VirtualizationFirmwareEnabled: True`. O `wsl --status` reclamava da falta da "Plataforma de Máquina Virtual", e o `wsl -d Ubuntu` falhava com `HCS_E_SERVICE_NOT_AVAILABLE`. O serviço `vmcompute` nem existia. A causa: eu tinha desligado esses recursos do Windows para rodar o BlueStacks, um emulador Android incompatível com Hyper-V. Lição: quando o Docker no Windows falhar, olhar primeiro `wsl --status` e o serviço `vmcompute`, não a BIOS.
- Ao reativar o recurso, o `dism /enable-feature` entrou em loop de download (`DownloadProgress 0/100 → 50/100 → 0`, visto no `CBS.log`). Havia um reboot pendente (`RebootPending`) e o serviço BITS estava parado. Precisou de reboot no meio.
- O `npm install` trouxe o TypeORM 1.1.2 (major recém-lançada). Fixei em 0.3.31: num desafio com prazo, prefiro a linha que conheço e que tem documentação madura.
- No lint, o `recommendedTypeChecked` do typescript-eslint acusou `no-unsafe-*` em todos os testes, por causa do `res.body` do supertest, que é `any`. Relaxei essas regras só em `test/**` e `*.spec.ts`; no código de produção elas continuam valendo.
- O template novo do Vite liga `erasableSyntaxOnly`, que não aceita parameter properties (`constructor(public readonly status)`). Troquei por campo explícito.
- O `npm audit` acusou DoS no `multer` 2.4.0 (high), dependência transitiva do `@nestjs/platform-express`. Subir o Nest para 11.2.8 não resolveu, porque ele ainda fixa o multer 2.4.0. Resolvi com `overrides` para 2.5.0. Não usamos upload, mas o CI falha em high por política.
- No KEDA, o `TriggerAuthentication` apontava para `corridas-secrets`, mas o `secretGenerator` gera o nome com hash (`corridas-secrets-g2c4h72kbh`), e o kustomize não conhece esse CRD. Descobri renderizando com `kubectl kustomize`. Resolvi com um `nameReference` em `kustomizeconfig.yaml`.
- O `kubectl` sumiu do PATH depois do reboot, porque ele vem do Docker Desktop. Usei o caminho completo em `C:\Program Files\Docker\Docker\resources\bin`.
