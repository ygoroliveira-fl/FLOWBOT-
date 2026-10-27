# Contribuindo

## Ambiente

- Node 22.12+ (`.nvmrc`), pnpm 10 (`corepack enable`), Docker.
- `pnpm install` gera o cliente Prisma automaticamente.
- Banco e Redis para testes de integração:

```bash
docker run -d --name aurora-pg -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=aurora_test -p 127.0.0.1:5432:5432 postgres:17.6-alpine
docker run -d --name aurora-redis -p 127.0.0.1:6379:6379 redis:7.4-alpine
export TEST_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/aurora_test
export TEST_REDIS_URL=redis://127.0.0.1:6379/1
```

Os testes de integração **apagam e recriam** o schema do banco de `TEST_DATABASE_URL` — nunca
aponte para um banco com dados reais.

## Antes de abrir um PR

```bash
pnpm format:check && pnpm lint && pnpm typecheck
pnpm test && pnpm test:integration
pnpm build && pnpm smoke
```

A CI (`.github/workflows/ci.yml`) roda os mesmos passos, mais `pnpm audit` e o build da imagem.

## Convenções

- TypeScript estrito, ESM, imports com extensão `.js`.
- Mensagens ao usuário e documentação em **português**; identificadores de código em inglês.
- Regras de negócio sem dependência direta de discord.js/Lavalink (use as interfaces existentes)
  e com testes unitários.
- Toda mudança de schema com migração (`pnpm db:migrate:dev --name descricao`) e atualização de
  [docs/DATABASE.md](docs/DATABASE.md). Migrações destrutivas exigem plano em duas etapas.
- Nunca registre segredos em logs; use `logger` (pino), não `console`.
- Commits no formato `tipo: descrição` (`feat`, `fix`, `docs`, `test`, `refactor`, `chore`).
- Atualize o [CHANGELOG.md](CHANGELOG.md) e, se aplicável, [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md).

## Estrutura dos testes

| Pasta               | O que cobre                                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/unit`        | Fila, sessão (concorrência, falhas, reconexão), permissões, SSRF, pesquisa, UI, painel, roteador de interações, configuração                            |
| `tests/integration` | Prisma/Postgres (playlists, concorrência, configurações), migrações, Redis (leases, rate limit), servidor HTTP, motor Lavalink contra servidor simulado |
| `tests/helpers`     | Dublês: motor de áudio, Discord, servidor Lavalink v4 simulado                                                                                          |
