# Solução de problemas

Comece sempre por `scripts/diagnose.sh` (não imprime segredos) e `docker compose logs bot`.

## Inicialização

| Sintoma                                          | Causa provável                                            | Solução                                                |
| ------------------------------------------------ | --------------------------------------------------------- | ------------------------------------------------------ |
| Bot sai com código 78 e "Configuração inválida"  | Variável ausente ou inválida                              | Leia a lista exibida; compare com `.env.example`       |
| `An invalid token was provided` / `TokenInvalid` | Token errado ou resetado                                  | Gere outro no portal e atualize `.env`                 |
| `Used disallowed intents`                        | Não deveria ocorrer (o bot não usa intents privilegiadas) | Confira se a imagem é desta versão                     |
| `migrate` termina com erro                       | Banco inacessível ou migração com conflito                | `docker compose logs migrate`; `prisma migrate status` |
| `Cannot find module …/generated/prisma/…`        | Cliente Prisma não gerado                                 | `pnpm prisma:generate` (local) ou reconstruir a imagem |
| Bot reinicia em loop                             | Veja o último log `level:60`                              | `docker compose logs --tail 50 bot`                    |

## Comandos

| Sintoma                                         | Causa                                                  | Solução                                                                                                                 |
| ----------------------------------------------- | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| Comandos não aparecem                           | Registro global leva minutos; ou não foram registrados | `docker compose run --rm --no-deps bot node dist/src/discord/deployCommands.js --global`; recarregue o Discord (Ctrl+R) |
| Comandos duplicados                             | Registrados no servidor de teste **e** globalmente     | `pnpm deploy-commands -- --clear-guild`                                                                                 |
| "O aplicativo não respondeu"                    | Bot fora do ar ou travado > 3 s antes do `defer`       | Logs; `/readyz`; latência do host                                                                                       |
| `/settings` não aparece para o cargo de gerente | Permissão padrão do comando é _Gerenciar Servidor_     | Configurações do servidor → Integrações → Aurora → liberar o comando para o cargo                                       |
| "Calma! Tente de novo em X s"                   | Rate limit                                             | Esperado; ajuste no código se necessário                                                                                |

## Voz e reprodução

| Sintoma                                                                              | Causa provável                                             | Solução                                                                                                                |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| "O servidor de áudio está indisponível"                                              | Lavalink fora/sem conexão                                  | `docker compose ps lavalink`; logs do Lavalink; senha igual em `.env`                                                  |
| Bot entra no canal mas não toca nada                                                 | Saída UDP bloqueada; incompatibilidade de voz (DAVE)       | Libere UDP de saída; confirme Lavalink **4.2.0+** (`/version`)                                                         |
| Desconexão imediata da voz com erro de criptografia (E2EE/DAVE)                      | Servidor de áudio sem suporte a DAVE                       | Lavalink 4.2.2 e lavalink-client 2.11.0 são necessários (já fixados)                                                   |
| Não entra no canal                                                                   | Falta _Conectar_/_Falar_, canal cheio ou é palco           | Ajuste permissões do cargo do bot; palcos não são suportados                                                           |
| "YouTube não está disponível neste servidor de áudio"                                | Plugin não carregou                                        | Logs do Lavalink na inicialização (download do plugin); rede de saída                                                  |
| YouTube: "Sign in to confirm you're not a bot" / "This video is unavailable" em tudo | IP da VPS bloqueado ou plugin desatualizado                | Atualize o youtube-plugin; use SoundCloud; o projeto não contorna bloqueios ([MUSIC_PROVIDERS.md](MUSIC_PROVIDERS.md)) |
| Faixas pulam sozinhas com "falha"                                                    | Faixa restrita/indisponível; 3 seguidas param a reprodução | Normal para conteúdo restrito; se for geral, veja a linha acima                                                        |
| Áudio picotando                                                                      | CPU do Lavalink alta, filtros pesados, rede                | `docker stats`; reduza filtros; mais CPU; aumente `bufferDurationMs`                                                   |
| Painel parou de atualizar                                                            | Bot perdeu permissão de editar no canal                    | Permissões do canal; `/settings panel-channel`                                                                         |
| Painel duplicado                                                                     | Mensagem antiga após reinício                              | Painéis antigos são marcados "encerrados"; apague manualmente se quiser                                                |
| Bot sai do canal sozinho                                                             | Inatividade (fila vazia ou sozinho)                        | `/settings inactivity`                                                                                                 |

## Banco e Redis

| Sintoma                                                          | Solução                                                                                      |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `/readyz` com `database.ok=false`                                | `docker compose ps postgres`; espaço em disco (`df -h`); logs do Postgres                    |
| `/readyz` com `redis.ok=false`                                   | `docker compose restart redis`; senha em `.env`                                              |
| "Não consegui iniciar a sessão agora (coordenação indisponível)" | Redis fora; sessões em andamento continuam; reinicie o Redis                                 |
| Disco cheio                                                      | `docker system prune` (imagens antigas), rotação de backups (`KEEP`), logs (já rotacionados) |

## Lavalink

```bash
docker compose logs --tail 100 lavalink
docker compose exec lavalink sh -c 'wget -qO- --header "Authorization: $LAVALINK_SERVER_PASSWORD" http://127.0.0.1:2333/v4/info'
```

- `OutOfMemoryError`: aumente `LAVALINK_JAVA_OPTS` (ex.: `-Xmx1g`) e a RAM da VPS.
- Plugin não baixa: a VPS precisa acessar `maven.lavalink.dev`.

## Coletando informações para um relato

Inclua: saída de `scripts/diagnose.sh`, o **código** da mensagem de erro, horário (UTC), comando
usado e se é reproduzível. Não envie o `.env`.
