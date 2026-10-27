# Aurora — bot de música para Discord

Bot de música multi-servidor, com painel interativo em tons de azul profundo/violeta/ciano,
playlists persistentes, sistema de DJ e implantação em VPS com Docker Compose.

> **Estado:** versão 0.1.0 — código completo e testado de forma automatizada, **ainda não
> validado com áudio real no Discord** (o ambiente de desenvolvimento não tinha acesso ao
> Discord nem ao Lavalink real). Veja [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md)
> antes de colocar em produção.

## Destaques

- **Sessões independentes por servidor** — fila, volume, repetição, filtros e painel próprios.
- **Painel único por servidor** com botões (pausar, pular, voltar, parar, repetir, embaralhar,
  volume, fila, autoplay), atualizado com controle de frequência para respeitar os limites do Discord.
- **Fontes:** YouTube, YouTube Music, SoundCloud, Bandcamp, Twitch, Vimeo e (opcional por servidor)
  streams HTTP públicos. Links do Spotify/Apple Music/Deezer/TIDAL são recusados com orientação
  (ver [docs/MUSIC_PROVIDERS.md](docs/MUSIC_PROVIDERS.md)).
- **Playlists persistentes** (PostgreSQL), privadas ou compartilhadas no servidor.
- **Permissões** em quatro níveis (usuário, DJ, gerente, administrador), modo "todos controlam",
  e "quem está sozinho com o bot é DJ".
- **Resiliência:** reconexão de voz com backoff, recuperação quando o Lavalink cai, timeouts em
  todas as chamadas externas, rate limit por usuário e por servidor.
- **Segurança:** proteção contra SSRF, segredos só por variável de ambiente, contêineres sem
  privilégios, Postgres/Redis/Lavalink sem portas públicas, `/metrics` protegido por token.
- **Observabilidade:** logs JSON (pino), `/healthz`, `/readyz`, métricas Prometheus, painel
  Grafana e alertas prontos (opcionais).
- **Compatível com DAVE** (criptografia de voz ponta a ponta exigida pelo Discord desde
  01/03/2026) via Lavalink 4.2.2 + lavalink-client 2.11.0.

## Stack

| Componente                   | Versão                                       |
| ---------------------------- | -------------------------------------------- |
| Node.js                      | 22 LTS (imagem `node:22.22.0-bookworm-slim`) |
| TypeScript                   | 5.9.3                                        |
| discord.js                   | 14.27.0                                      |
| Lavalink (servidor de áudio) | 4.2.2 + youtube-plugin 1.18.2                |
| lavalink-client              | 2.11.0                                       |
| PostgreSQL / Prisma          | 17.6 / 7.10.1                                |
| Redis (opcional)             | 7.4                                          |
| Testes                       | Vitest 4.1.12                                |

Justificativas em [docs/TECHNICAL_RESEARCH.md](docs/TECHNICAL_RESEARCH.md) e
[docs/DECISIONS.md](docs/DECISIONS.md).

## Início rápido (desenvolvimento)

Pré-requisitos: Node 22.12+, pnpm 10 (`corepack enable`), Docker (para Postgres e Lavalink).

```bash
cp .env.example .env              # preencha DISCORD_TOKEN e DISCORD_CLIENT_ID
pnpm install                      # também gera o cliente Prisma
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres lavalink
pnpm db:migrate:deploy            # aplica as migrações
pnpm deploy-commands:dev          # registra os comandos no DISCORD_DEV_GUILD_ID
pnpm dev                          # inicia com recarga automática
```

O `docker-compose.dev.yml` publica Postgres e Lavalink apenas em `127.0.0.1` para o bot local
alcançá-los; ajuste `DATABASE_URL` e `LAVALINK_NODES` no `.env` com as mesmas senhas
(detalhes em [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md#desenvolvimento-local)).

## Produção (VPS)

```bash
git clone <seu-repositório> aurora && cd aurora
scripts/install.sh   # cria .env com senhas aleatórias, constrói, migra, sobe e registra comandos
```

Passo a passo completo — criação da aplicação no Discord, firewall, atualização, rollback —
em [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## Comandos do projeto

| Comando                                              | O que faz                                                               |
| ---------------------------------------------------- | ----------------------------------------------------------------------- |
| `pnpm dev`                                           | Executa com recarga (tsx)                                               |
| `pnpm build` / `pnpm start`                          | Compila para `dist/` / executa a versão compilada                       |
| `pnpm smoke`                                         | Verifica se a build carrega e lista os comandos                         |
| `pnpm lint` / `pnpm typecheck` / `pnpm format:check` | Qualidade de código                                                     |
| `pnpm test`                                          | Testes unitários                                                        |
| `pnpm test:integration`                              | Integração (exige `TEST_DATABASE_URL` e opcionalmente `TEST_REDIS_URL`) |
| `pnpm db:migrate:dev` / `pnpm db:migrate:deploy`     | Cria / aplica migrações                                                 |
| `pnpm db:seed`                                       | Seed de desenvolvimento (configurações do servidor de testes)           |
| `pnpm deploy-commands`                               | Registra comandos (servidor de testes, ou `-- --global`)                |

## Documentação

| Documento                                                   | Conteúdo                                         |
| ----------------------------------------------------------- | ------------------------------------------------ |
| [IMPLEMENTATION_STATUS](docs/IMPLEMENTATION_STATUS.md)      | O que está pronto, parcial e não validado        |
| [ARCHITECTURE](docs/ARCHITECTURE.md)                        | Componentes, fluxos e diagramas                  |
| [COMMANDS](docs/COMMANDS.md)                                | Todos os comandos e matriz de permissões         |
| [MUSIC_PROVIDERS](docs/MUSIC_PROVIDERS.md)                  | Fontes suportadas, limites e riscos              |
| [DATABASE](docs/DATABASE.md)                                | Modelo de dados e migrações                      |
| [SECURITY](docs/SECURITY.md)                                | Ameaças e controles                              |
| [DEPLOYMENT](docs/DEPLOYMENT.md)                            | Aplicação no Discord, VPS, variáveis de ambiente |
| [OPERATIONS](docs/OPERATIONS.md)                            | Rotina, monitoramento, atualização, custos       |
| [BACKUP_RESTORE](docs/BACKUP_RESTORE.md)                    | Backup e restauração                             |
| [TROUBLESHOOTING](docs/TROUBLESHOOTING.md)                  | Problemas comuns                                 |
| [TECHNICAL_RESEARCH](docs/TECHNICAL_RESEARCH.md)            | Pesquisa de versões e APIs                       |
| [DECISIONS](docs/DECISIONS.md)                              | Registro de decisões                             |
| [ROADMAP](docs/ROADMAP.md)                                  | Próximos passos                                  |
| [CONTRIBUTING](CONTRIBUTING.md) · [CHANGELOG](CHANGELOG.md) | Contribuição e histórico                         |

## Aviso legal

O bot apenas reproduz conteúdo que os provedores entregam publicamente através do Lavalink. Não
há contorno de DRM, paywall, autenticação ou bloqueios. O uso de algumas fontes (especialmente o
YouTube) pode conflitar com os termos de serviço do provedor; avalie isso antes de operar o bot
publicamente — ver [docs/MUSIC_PROVIDERS.md](docs/MUSIC_PROVIDERS.md).
