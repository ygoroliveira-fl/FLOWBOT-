# Pesquisa técnica

Levantamento feito em **27/10/2026** consultando registros de pacotes (npm, Maven do Lavalink,
GHCR, Docker Hub), documentação oficial e código-fonte das bibliotecas. Versões mudam rápido:
reavalie antes de atualizar.

## Exigência que define a stack: DAVE

Desde **01/03/2026** o Discord exige criptografia de ponta a ponta (protocolo **DAVE**) em
chamadas de voz de servidores e DMs. Clientes de voz sem DAVE são recusados. Consequências:

- Bibliotecas que tratam voz diretamente precisam de DAVE (no Node, `@discordjs/voice` com
  `@snazzah/davey`).
- No Lavalink, o suporte chegou na **4.2.0**; o servidor passa a exigir o `channelId` no
  `voice state` enviado pelo cliente. Clientes Lavalink antigos (que só enviam `token`,
  `endpoint`, `sessionId`) deixam de funcionar.
- `lavalink-client` 2.11.0 envia `channelId` — confirmado lendo o código-fonte do pacote e
  com um teste de integração contra um Lavalink simulado (`tests/integration/lavalinkEngine.test.ts`).

## Escolhas e alternativas

### Áudio: Lavalink 4.2.2 × `@discordjs/voice` no próprio processo

| Critério   | Lavalink                                                                                      | `@discordjs/voice` + ffmpeg/yt-dlp                                    |
| ---------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| DAVE       | ✅ 4.2+                                                                                       | ✅ com `@snazzah/davey`                                               |
| Fontes     | YouTube (plugin mantido pela organização Lavalink), SoundCloud, Bandcamp, Twitch, Vimeo, HTTP | Depende de `yt-dlp`/`play-dl` — extratores frágeis, binários externos |
| Filtros    | Nativos (equalizer, timescale, rotation…)                                                     | Via ffmpeg, custo de CPU no processo do bot                           |
| Isolamento | Processo separado: travar o áudio não derruba o bot                                           | Mesmo processo                                                        |
| Custo      | +350–600 MB de RAM (JVM)                                                                      | Menor                                                                 |

Escolha: **Lavalink**. Isolamento, filtros e fontes mantidas compensam a RAM extra.

### Cliente Lavalink: `lavalink-client` 2.11.0

Alternativas: `shoukaku` (sem confirmação clara de envio de `channelId` na versão estável
avaliada), `moonlink.js`, `poru`. `lavalink-client` declara suporte a DAVE, é mantido ativamente
e expõe eventos crus do nó (`raw`), o que permite manter a fila própria.

### Plugin do YouTube: `dev.lavalink.youtube:youtube-plugin` 1.18.2

A fonte de YouTube embutida no Lavalink está obsoleta; o plugin oficial a substitui
(`lavalink.server.sources.youtube: false`). Clientes configurados: `MUSIC` (pesquisa no YT Music),
`ANDROID_VR`, `WEB`, `WEBEMBEDDED`. Recursos de OAuth e _poToken_ do plugin **não** são usados
(ver [MUSIC_PROVIDERS.md](MUSIC_PROVIDERS.md)).

### LavaSrc 4.8.3 (Spotify, Apple Music, Deezer…) — não incluído

Faz _mirroring_ de metadados para o YouTube e, no caso do Deezer "nativo", descriptografa o áudio.
Rejeitado: ver [MUSIC_PROVIDERS.md](MUSIC_PROVIDERS.md#por-que-spotify-apple-music-deezer-e-tidal-não-tocam).

### discord.js 14.27.0

Biblioteca mais usada no ecossistema Node, tipada, com cache configurável. Usamos apenas as
intents `Guilds` e `GuildVoiceStates` e limitamos caches de mensagens/membros/presenças.

### Prisma 7.10.1 + PostgreSQL 17

Prisma 7 mudou bastante em relação ao 6:

- Gerador `prisma-client` (ESM, código gerado dentro do projeto em `src/generated/prisma`).
- Conexão via _driver adapter_ (`@prisma/adapter-pg` sobre `pg`), sem motor Rust de consultas.
- Configuração em `prisma.config.ts`; o CLI não carrega `.env` sozinho (usamos `dotenv/config`).
- `importFileExtension = "js"` no gerador: necessário porque, no build Docker, o `generate` roda
  antes do `tsconfig.json` existir e o Prisma inferiria imports `.ts`, quebrando o Node em
  produção (problema encontrado e corrigido durante o desenvolvimento).

Alternativas: Drizzle (mais leve, mas migrações e tipos exigiriam mais código manual), Kysely.
Prisma foi escolhido pela maturidade de migrações e pelo pedido explícito do projeto.

### Redis 7.4 (opcional)

Usado **apenas** onde há estado compartilhado entre instâncias: rate limit (janela fixa via Lua) e
leases de sessão (`SET NX PX` + renovação/liberação atômicas + token de cerca). Com uma única
instância, ambos funcionam em memória e o Redis pode ser omitido. Sem persistência em disco.

### Métricas: `@prometheus-io/client` 0.16.1

O pacote `prom-client` foi marcado como obsoleto no npm em favor do cliente oficial da
organização Prometheus. A API é compatível (`Counter`, `Gauge`, `Histogram`, `Registry`).

### Logs: pino 10.4.0

JSON estruturado, rápido, com `redact` nativo.

### Validação: Zod 4.6.7

Validação de variáveis de ambiente e de entradas internas.

### TypeScript 5.9.3 (e não 7.x)

TypeScript 7 (compilador nativo) já existe, mas `typescript-eslint` 8.72.1 exige TS < 6.1.
Mantivemos 5.9.3 para ter lint com informação de tipos.

### Testes: Vitest 4.1.12 (e não 5.x)

Vitest 5 foi lançado recentemente; a 4.1 é estável, compatível com a configuração de projetos
(`unit`/`integration`) usada e com `@vitest/coverage-v8`. Atualização prevista no roadmap.

### Node.js 22 LTS

Suporte LTS até abril de 2027; `fetch`, `AbortSignal.timeout` e ESM estáveis. Node 24 seria
alternativa válida; 22 foi escolhido pela imagem `node:22.22.0-bookworm-slim` já validada no
build.

## Limites da plataforma Discord considerados

| Limite                                                 | Impacto no design                                                    |
| ------------------------------------------------------ | -------------------------------------------------------------------- |
| 3 s para a primeira resposta a uma interação           | `deferReply` antes de pesquisas e acessos ao banco                   |
| Token da interação vale 15 min                         | Menus de `/search` e confirmações expiram antes disso                |
| Rate limits de edição de mensagens                     | Painel com intervalo mínimo de 2,5 s e atualização periódica de 15 s |
| Até 25 opções em menus / 5 botões por linha / 5 linhas | Pesquisa mostra 10 resultados; painel com 2 linhas de 4–5 botões     |
| Comandos globais demoram a propagar                    | Registro por servidor de testes em desenvolvimento                   |

## Limitações do ambiente de desenvolvimento

O ambiente onde o projeto foi construído não tinha acesso ao Discord, à API do GitHub, ao Maven do
Lavalink nem aos blobs do GHCR. Por isso:

- O Lavalink real **não** foi executado; os testes usam um servidor que implementa o protocolo v4
  (WebSocket + REST) com base na documentação oficial.
- Nenhuma faixa real foi tocada e a negociação DAVE não foi testada ponta a ponta.

Ver [IMPLEMENTATION_STATUS.md](IMPLEMENTATION_STATUS.md).

## Fontes consultadas

- Documentação do Lavalink: https://lavalink.dev (configuração, API v4, plugins)
- Releases do Lavalink e do youtube-source: repositórios `lavalink-devs/Lavalink` e
  `lavalink-devs/youtube-source` (tags verificadas no GHCR e no Maven)
- Documentação do Discord: https://discord.com/developers/docs (interações, voz, permissões)
- npm: discord.js, lavalink-client, prisma, @prisma/adapter-pg, vitest, typescript-eslint,
  @prometheus-io/client, prom-client (aviso de obsolescência)
- Código-fonte publicado de `lavalink-client@2.11.0` (envio de `channelId` no voice update)
- Documentação do Prisma 7 (gerador `prisma-client`, `prisma.config.ts`, driver adapters)
