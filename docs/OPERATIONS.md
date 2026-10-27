# Operação

## Rotina

| Frequência               | Tarefa                                                         | Como                                                                        |
| ------------------------ | -------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Diária (automática)      | Backup do banco                                                | `cron` com `scripts/backup.sh` (ver [BACKUP_RESTORE.md](BACKUP_RESTORE.md)) |
| Diária (automática)      | Retenção de histórico/auditoria                                | O próprio bot                                                               |
| Semanal                  | Conferir alertas, uso de disco e logs de erro                  | `scripts/diagnose.sh`                                                       |
| Mensal                   | Atualizar imagens e dependências; testar restauração de backup | `scripts/update.sh`, restauração em ambiente de teste                       |
| Quando o YouTube quebrar | Atualizar o youtube-plugin                                     | [MUSIC_PROVIDERS.md](MUSIC_PROVIDERS.md#atualizando-o-plugin-do-youtube)    |

## Comandos úteis

```bash
docker compose ps                         # estado dos serviços
docker compose logs -f --tail 100 bot     # logs do bot (JSON)
docker compose logs bot | grep '"level":50'   # só erros
docker compose restart bot                # reinicia o bot (sessões ativas são encerradas)
docker compose restart lavalink           # bot marca sessões como "reconectando" e retoma
curl -s http://127.0.0.1:9464/readyz | jq # estado das dependências
```

Para ler os logs formatados: `docker compose logs --no-log-prefix bot | npx pino-pretty`.

### Encontrar um erro relatado por usuário

Mensagens de erro inesperado mostram um **código** (ex.: `Código: 7f3a9c2e41b05d68`). Procure-o:

```bash
docker compose logs bot | grep 7f3a9c2e41b05d68
```

## Encerramento e reinício

- `SIGTERM` (ex.: `docker compose stop`): o bot para de aceitar interações, encerra sessões
  (painéis marcados como encerrados), fecha Lavalink/Redis/Postgres e sai. Limite de 15 s, depois
  saída forçada (`stop_grace_period: 20s`).
- Após reiniciar, as sessões **não** voltam: os usuários usam `/play` novamente (decisão D-005).

## Métricas

Endpoint `GET /metrics` (porta 9464, `Authorization: Bearer $METRICS_TOKEN`).

| Métrica                                                        | Tipo      | Rótulos                                                        | Significado                                                                  |
| -------------------------------------------------------------- | --------- | -------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `aurora_commands_total`                                        | counter   | `command`, `outcome` (`ok`, `user_error`, `error`)             | Comandos e interações                                                        |
| `aurora_command_duration_seconds`                              | histogram | `command`                                                      | Tempo até a resposta final                                                   |
| `aurora_playback_events_total`                                 | counter   | `event` (`start`, `failed`)                                    | Reprodução                                                                   |
| `aurora_provider_requests_total`                               | counter   | `provider`, `outcome` (`success`, `empty`, `error`, `timeout`) | Pesquisas                                                                    |
| `aurora_provider_request_duration_seconds`                     | histogram | `provider`                                                     | Latência de pesquisa                                                         |
| `aurora_reconnects_total`                                      | counter   | `target`                                                       | Reconexões (`discord_gateway`, `lavalink_node`)                              |
| `aurora_dependency_up`                                         | gauge     | `dependency`                                                   | 1 se `discord`, `database`, `lavalink`, `redis` responderam na última coleta |
| `aurora_errors_total`                                          | counter   | `source`                                                       | Erros inesperados                                                            |
| `aurora_active_sessions`                                       | gauge     | —                                                              | Sessões de voz                                                               |
| `aurora_queued_tracks`                                         | gauge     | —                                                              | Faixas em todas as filas                                                     |
| `aurora_guilds`                                                | gauge     | —                                                              | Servidores                                                                   |
| `aurora_discord_ws_ping_ms`                                    | gauge     | —                                                              | Latência do gateway                                                          |
| `aurora_lavalink_node_up` / `_playing_players` / `_latency_ms` | gauge     | `node`                                                         | Estado dos nós                                                               |
| `aurora_process_*`, `aurora_nodejs_*`                          | —         | —                                                              | Métricas padrão do processo                                                  |

## Alertas

Definidos em `monitoring/alerts.yml` (avaliados pelo Prometheus):

| Alerta                  | Condição                                   | Severidade |
| ----------------------- | ------------------------------------------ | ---------- |
| BotForaDoAr             | coleta falhando por 2 min                  | crítico    |
| DependenciaIndisponivel | `aurora_dependency_up == 0` por 2 min      | crítico    |
| LavalinkDesconectado    | nó desconectado por 1 min                  | crítico    |
| FalhasDeReproducao      | >30% das faixas falhando em 10 min         | aviso      |
| PesquisasComErro        | >50% das pesquisas de um provedor falhando | aviso      |
| ErrosInesperados        | >20 erros em 10 min                        | aviso      |
| MemoriaAlta             | RSS > 450 MB por 15 min                    | aviso      |
| LatenciaGatewayAlta     | ping > 1 s por 10 min                      | aviso      |

O Compose de monitoramento não inclui Alertmanager: os alertas aparecem em
http://localhost:9090/alerts (via túnel SSH) e no Grafana. Para receber notificações, adicione um
Alertmanager com o receptor desejado (webhook do Discord, e-mail) — fica a critério do operador.

Sem Prometheus, um monitor externo simples é suficiente para o essencial: um `cron` que rode
`curl -fsS http://127.0.0.1:9464/readyz || <notificar>`.

## Apagar dados de um servidor

O bot não apaga dados automaticamente quando é removido de um servidor. Para apagar (irreversível;
faça backup antes):

```bash
scripts/backup.sh
docker compose exec postgres psql -U aurora -d aurora \
  -c "DELETE FROM \"GuildSettings\" WHERE \"guildId\" = '123456789012345678';"
```

Isso remove configurações, painel, histórico e auditoria do servidor; playlists compartilhadas
nele tornam-se privadas dos donos.

## Capacidade e escala

- Uma instância (1 processo + 1 Lavalink) é adequada para dezenas de sessões simultâneas. O
  limite prático é CPU/banda do Lavalink: cada player transmite ~96–128 kbps de Opus e filtros
  aumentam o uso de CPU.
- Sinais de saturação: `aurora_lavalink_latency_ms` alto, `TrackStuck` frequente, CPU do
  Lavalink > 80%.
- Próximos passos de escala: mais memória/CPU para o Lavalink; vários nós em `LAVALINK_NODES`;
  sharding (ver [ROADMAP.md](ROADMAP.md)). **Nenhum teste de carga foi feito nesta versão.**

## Custos estimados

Premissas explícitas (outubro de 2026, preços de lista aproximados, sem impostos, câmbio
US$ 1 ≈ R$ 5,50 — **confira os preços atuais antes de contratar**):

- Uma VPS rodando tudo (bot, Lavalink, Postgres, Redis).
- Tráfego: 10 sessões simultâneas em média × 128 kbps × 24 h ≈ 14 GB/dia ≈ **420 GB/mês** de
  saída, mais a entrada equivalente vinda dos provedores.
- Backups locais + cópia externa pequena (< 1 GB).

| Cenário                                | Exemplo de VPS                                                                            | Custo mensal aproximado |
| -------------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------- |
| Pequeno (até ~10 servidores ativos)    | 2 vCPU / 4 GB / 40 GB, 20 TB de tráfego incluído (ex.: Hetzner CX22/CPX21 ou equivalente) | US$ 5–10 (R$ 30–55)     |
| Médio (dezenas de sessões simultâneas) | 4 vCPU / 8 GB                                                                             | US$ 15–30 (R$ 80–165)   |
| Com monitoramento                      | +1–2 GB de RAM para Prometheus/Grafana                                                    | já coberto no médio     |
| Backup externo (object storage)        | 1–5 GB                                                                                    | < US$ 1                 |

O Discord não cobra pelo bot. Não há custos de API dos provedores (nenhuma API paga é usada).
Provedores com tráfego limitado (ex.: 1–2 TB/mês) também atendem o cenário pequeno; tráfego
cobrado por GB pode encarecer bastante — prefira planos com franquia alta.
