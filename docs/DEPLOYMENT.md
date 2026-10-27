# Implantação

## 1. Criar a aplicação no Discord

1. Acesse https://discord.com/developers/applications → **New Application** → dê um nome.
2. **General Information:** copie o _Application ID_ → `DISCORD_CLIENT_ID`.
3. **Bot:**
   - _Reset Token_ → copie → `DISCORD_TOKEN` (aparece uma única vez; guarde só no `.env`).
   - **Privileged Gateway Intents: deixe todas desligadas.** O bot não precisa delas.
   - _Public Bot_: desligue se só você deve convidá-lo.
4. **Installation:** em _Install Link_ escolha _None_ (usaremos o link abaixo) ou configure
   _Guild Install_ com os escopos `bot` e `applications.commands`.

## 2. Convidar o bot

Substitua `SEU_CLIENT_ID`:

```
https://discord.com/oauth2/authorize?client_id=SEU_CLIENT_ID&scope=bot+applications.commands&permissions=3165184
```

`3165184` = Ver canais + Enviar mensagens + Inserir links + Conectar + Falar. Canais de palco
(Stage) não são suportados nesta versão.

## 3. Requisitos da VPS

| Item  | Mínimo                                     | Recomendado                                        |
| ----- | ------------------------------------------ | -------------------------------------------------- |
| CPU   | 1 vCPU                                     | 2 vCPU                                             |
| RAM   | 2 GB                                       | 4 GB (com monitoramento)                           |
| Disco | 20 GB SSD                                  | 40 GB                                              |
| SO    | Ubuntu 24.04 / Debian 12 (x86_64 ou arm64) | —                                                  |
| Rede  | IPv4 público, saída UDP liberada           | Provedor cujo IP não esteja bloqueado pelo YouTube |

Consumo estimado em repouso: bot ~150 MB, Lavalink ~350–600 MB (limitado por `-Xmx512m`),
Postgres ~60 MB, Redis <20 MB. **Estes números são estimativas, não medições em produção.**

## 4. Preparar o servidor

```bash
# Usuário sem root para operar o bot
sudo adduser --disabled-password aurora && sudo usermod -aG docker aurora

# Docker Engine + plugin compose (instruções oficiais: https://docs.docker.com/engine/install/)
curl -fsSL https://get.docker.com | sudo sh
```

> Pertencer ao grupo `docker` equivale a acesso root. Use um usuário dedicado e SSH só com chave.

### Firewall

```bash
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow OpenSSH
sudo ufw enable
```

Não é preciso abrir nenhuma porta para o bot: voz e gateway são conexões de saída.

## 5. Instalar

```bash
sudo -iu aurora
git clone <url-do-seu-repositório> aurora && cd aurora
scripts/install.sh            # 1ª execução: cria .env com senhas aleatórias e para
nano .env                     # preencha DISCORD_TOKEN e DISCORD_CLIENT_ID
scripts/install.sh            # constrói, migra, sobe e registra comandos globais
docker compose logs -f bot
```

O que o `install.sh` faz: verifica Docker; cria `.env` (sem sobrescrever um existente) com
`POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `LAVALINK_PASSWORD` e `METRICS_TOKEN` aleatórios; cria
`monitoring/metrics_token`; `docker compose build`; `docker compose up -d` (o serviço `migrate`
aplica as migrações antes do bot subir); registra os comandos globalmente.

Comandos globais podem levar alguns minutos para aparecer. Para testes imediatos, defina
`DISCORD_DEV_GUILD_ID` e rode `docker compose run --rm --no-deps bot node dist/src/discord/deployCommands.js`.

### Verificação

```bash
docker compose ps                                  # todos "healthy"/"running"; migrate "exited (0)"
curl -s http://127.0.0.1:9464/readyz               # {"ok":true,...}
scripts/diagnose.sh
```

No Discord: `/help`, depois `/play busca:<música>` estando num canal de voz.

## 6. Variáveis de ambiente

| Variável                                                   |  Obrigatória  | Padrão             | Descrição                                                                 |
| ---------------------------------------------------------- | :-----------: | ------------------ | ------------------------------------------------------------------------- |
| `DISCORD_TOKEN`                                            |      ✅       | —                  | Token do bot                                                              |
| `DISCORD_CLIENT_ID`                                        |      ✅       | —                  | Application ID                                                            |
| `DISCORD_DEV_GUILD_ID`                                     |               | —                  | Servidor de testes para registrar comandos e para o seed                  |
| `BOT_NAME`                                                 |               | `Aurora`           | Nome exibido no painel (até 32)                                           |
| `BOT_ACCENT_COLOR`                                         |               | `#7C5CFF`          | Cor de destaque dos embeds                                                |
| `DATABASE_URL`                                             |      ✅*      | —                  | URL do Postgres (*o Compose define automaticamente)                       |
| `DATABASE_POOL_MAX`                                        |               | `10`               | Conexões no pool                                                          |
| `REDIS_URL`                                                |               | —                  | Sem ele, rate limit e leases ficam em memória (_o Compose define_)        |
| `LAVALINK_NODES`                                           |      ✅*      | —                  | `id\|host\|porta\|senha\|tls`, separados por vírgula (_o Compose define_) |
| `POSTGRES_PASSWORD`, `REDIS_PASSWORD`, `LAVALINK_PASSWORD` |  ✅ Compose   | —                  | Senhas dos serviços (use só `[a-z0-9]`)                                   |
| `LAVALINK_JAVA_OPTS`                                       |               | `-Xmx512m`         | Memória da JVM do Lavalink                                                |
| `HTTP_HOST` / `HTTP_PORT`                                  |               | `0.0.0.0` / `9464` | Servidor de health/métricas                                               |
| `METRICS_TOKEN`                                            |               | —                  | Ativa `/metrics` (mín. 24 caracteres)                                     |
| `LOG_LEVEL`                                                |               | `info`             | `fatal` … `trace`                                                         |
| `LOG_PRETTY`                                               |               | `false`            | Logs legíveis (só desenvolvimento)                                        |
| `MAX_QUEUE_SIZE`                                           |               | `1000`             | Teto absoluto da fila (servidores configuram abaixo disso)                |
| `MAX_PLAYLISTS_PER_USER` / `MAX_PLAYLIST_TRACKS`           |               | `25` / `500`       | Limites de playlists                                                      |
| `PANEL_UPDATE_INTERVAL_MS`                                 |               | `15000`            | Atualização da barra de progresso                                         |
| `HISTORY_RETENTION_DAYS` / `AUDIT_RETENTION_DAYS`          |               | `90` / `180`       | Retenção                                                                  |
| `GRAFANA_ADMIN_PASSWORD`                                   | Monitoramento | —                  | Senha do Grafana                                                          |

Variáveis inválidas impedem a inicialização com a lista de problemas (sem mostrar valores) e
código de saída 78.

## 7. Monitoramento (opcional)

```bash
echo "GRAFANA_ADMIN_PASSWORD=$(openssl rand -hex 16)" >> .env
docker compose -f docker-compose.yml -f docker-compose.monitoring.yml up -d
# Do seu computador:
ssh -L 3000:127.0.0.1:3000 -L 9090:127.0.0.1:9090 aurora@sua-vps
```

Abra http://localhost:3000 (usuário `admin`). O painel "Aurora — visão geral" e o datasource são
provisionados automaticamente. Alertas em `monitoring/alerts.yml` (ver
[OPERATIONS.md](OPERATIONS.md#alertas)).

## 8. Atualizar e reverter

```bash
scripts/update.sh            # backup → git pull → build → up → registra comandos
scripts/update.sh v0.1.0     # vai para uma tag/commit específico (rollback)
```

Migrações não são revertidas automaticamente. Se a versão nova aplicou uma migração
incompatível com a antiga, restaure o backup feito pelo próprio `update.sh`
([BACKUP_RESTORE.md](BACKUP_RESTORE.md)).

## Desenvolvimento local

```bash
cp .env.example .env     # preencha Discord e as senhas POSTGRES/LAVALINK
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres lavalink
# Ajuste DATABASE_URL e LAVALINK_NODES do .env com as mesmas senhas
pnpm install && pnpm db:migrate:deploy && pnpm db:seed
pnpm deploy-commands:dev && pnpm dev
```

O override `docker-compose.dev.yml` publica Postgres (5432) e Lavalink (2333) somente em
`127.0.0.1`. Não o use em produção.

## Docker sem Compose / outras plataformas

A imagem (`Dockerfile`) roda em qualquer orquestrador. Requisitos: Postgres 14+ acessível, um
Lavalink 4.2+ com o youtube-plugin (se quiser YouTube), as variáveis acima, e executar
`node_modules/.bin/prisma migrate deploy` antes de iniciar o bot. Plataformas que hibernam
contêineres ociosos (planos gratuitos) não servem: o bot precisa de conexão contínua.
