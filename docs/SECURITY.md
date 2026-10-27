# Segurança

## Modelo de ameaças (resumo)

| Ativo                     | Ameaça                                            | Controles                                                                                                                                  |
| ------------------------- | ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Token do bot              | Vazamento por código, log ou imagem               | Só por variável de ambiente; `.env` no `.gitignore`/`.dockerignore`; `redact` no logger; mensagens de erro de config nunca mostram valores |
| Rede interna da VPS       | SSRF via links enviados por usuários              | Allowlist de domínios conhecidos; streams HTTP desligados por padrão; checagem de IP público após DNS; rede `backend` sem internet         |
| Banco / Redis / Lavalink  | Acesso externo                                    | Nenhuma porta publicada; senhas fortes; rede interna                                                                                       |
| Configurações do servidor | Usuário comum alterando                           | Matriz de permissões negando por padrão; checagem no bot além da permissão do Discord                                                      |
| Disponibilidade           | Spam de comandos/botões                           | Rate limit por usuário e por servidor; timeouts; filas com limite                                                                          |
| Usuários                  | Menções em massa ou markdown malicioso em títulos | `allowedMentions` vazio; escape de markdown e de `@`/`<` em textos externos                                                                |
| Host                      | Fuga de contêiner                                 | Usuário não-root, `cap_drop: ALL`, `no-new-privileges`, sistema de arquivos somente leitura (bot)                                          |

## Segredos

- Todos os segredos vêm do ambiente: `DISCORD_TOKEN`, `POSTGRES_PASSWORD`, `REDIS_PASSWORD`,
  `LAVALINK_PASSWORD`, `METRICS_TOKEN`, `GRAFANA_ADMIN_PASSWORD`.
- `scripts/install.sh` gera senhas com `openssl rand -hex 24` e cria o `.env` com permissão `600`.
- O `lavalink/application.yml` versionado contém só um marcador; a senha real vem de
  `LAVALINK_SERVER_PASSWORD`, que tem precedência sobre o arquivo.
- O logger remove (`redact`) campos como `token`, `password`, `authorization`, `DATABASE_URL`, e
  `scrubSecrets` mascara URLs com credenciais em mensagens de erro.
- **Se o token vazar:** Portal do Discord → Bot → _Reset Token_, atualize o `.env`,
  `docker compose up -d bot`.

## Discord

- Intents mínimas: `Guilds` e `GuildVoiceStates`. **Nenhuma intent privilegiada** (sem
  `MessageContent`, `GuildMembers` ou `GuildPresences`).
- Permissões do convite: _View Channels_, _Send Messages_, _Embed Links_, _Connect_, _Speak_
  (ver [DEPLOYMENT.md](DEPLOYMENT.md#2-convidar-o-bot)). Nada de _Administrator_.
- Respostas usam `allowedMentions: { parse: [] }` — o bot não consegue pingar `@everyone`.
- `customId` de botões inclui o `guildId` e é validado contra o servidor da interação.
- Ações destrutivas (`/clear` grande, `/playlist delete`, `/privacy delete`) pedem confirmação
  por botão que expira e só vale para quem iniciou.

## SSRF

Implementação: `src/providers/urlSafety.ts` (testes em `tests/unit/urlSafety.test.ts`).

1. Links de domínios conhecidos (YouTube, SoundCloud…) vão direto ao Lavalink.
2. Outros links só são aceitos se o servidor ligou `/settings http-streams`, e então:
   protocolo `http(s)`, sem credenciais, sem nomes internos, e **todos** os IPs resolvidos
   precisam ser públicos (IPv4 e IPv6, incluindo IPv4 mapeado em IPv6 e NAT64).
3. A fonte `local` do Lavalink fica desligada (impede leitura de arquivos do servidor).

**Risco residual conhecido:** o Lavalink faz sua própria resolução DNS e pode seguir
redirecionamentos HTTP; um atacante com domínio próprio poderia usar DNS rebinding ou um
redirect para um IP interno. Mitigações: função desligada por padrão; Postgres e Redis exigem
senha; o Lavalink não tem acesso a nada além da rede do Compose. Se não precisar de rádios HTTP,
deixe desligado, ou desative `http` em `lavalink/application.yml`.

## Contêineres

| Serviço  | Usuário                                    | Capabilities    | Outros                                       |
| -------- | ------------------------------------------ | --------------- | -------------------------------------------- |
| bot      | `node` (uid 1000)                          | todas removidas | `read_only`, `/tmp` em tmpfs, `init`         |
| migrate  | `node`                                     | todas removidas | roda e sai                                   |
| redis    | `redis`                                    | todas removidas | sem persistência, `maxmemory 64mb`           |
| lavalink | `lavalink` (imagem oficial)                | todas removidas | —                                            |
| postgres | entrypoint oficial (troca para `postgres`) | padrão          | precisa de `chown`/`setuid` na inicialização |

Todos com `no-new-privileges`. Logs com rotação (10 MB × 5).

## Endpoints HTTP

- Escuta na porta 9464, publicada **só em `127.0.0.1`** do host.
- `/healthz` e `/readyz` não exibem segredos (apenas `ok`/latência por dependência).
- `/metrics` exige `Authorization: Bearer <METRICS_TOKEN>` (comparação em tempo constante); sem
  `METRICS_TOKEN` o endpoint fica desativado. As métricas não têm IDs de usuários.
- Apenas `GET`; timeouts de cabeçalho e de requisição de 10 s.

## Dados pessoais

Ver [DATABASE.md](DATABASE.md#o-que-é-guardado-e-o-que-não-é). Usuários consultam e apagam os
próprios dados com `/privacy`. O Lavalink tem o log de requisições desligado porque as URLs de
pesquisa contêm o que os usuários digitam.

## Dependências

- Versões fixadas no `package.json` e no `pnpm-lock.yaml`; imagens Docker com tag de versão.
- `pnpm audit --prod` roda na CI (na data desta versão: nenhuma vulnerabilidade conhecida).
- Scripts de instalação de pacotes só são permitidos para `prisma`, `@prisma/engines` e `esbuild`
  (`pnpm.onlyBuiltDependencies`).

## Firewall da VPS

Só a porta SSH precisa estar aberta para entrada. O tráfego de voz é **de saída** (UDP para os
servidores do Discord). Exemplo com `ufw` em [DEPLOYMENT.md](DEPLOYMENT.md#firewall).

> Atenção: o Docker publica portas contornando o `ufw`. Por isso nenhuma porta do Compose é
> publicada em `0.0.0.0` — mantenha assim.

## Reportar vulnerabilidades

Abra um aviso privado (GitHub Security Advisory) no repositório, sem detalhes em issues públicas.
