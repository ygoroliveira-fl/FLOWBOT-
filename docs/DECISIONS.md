# Registro de decisões

Formato: contexto → decisão → consequências. Estado: ✅ aceita · 🔄 revisar no futuro.

## D-001 — Lavalink como motor de áudio ✅

**Contexto:** DAVE obrigatório desde 03/2026; extratores de áudio no próprio processo são frágeis.
**Decisão:** Lavalink 4.2.2 com youtube-plugin, cliente `lavalink-client` 2.11.0.
**Consequências:** +RAM (JVM); áudio isolado do bot; filtros nativos; dependência de um serviço
a mais no Compose.

## D-002 — Fila própria como fonte da verdade ✅

**Contexto:** a fila da biblioteca cliente mistura estado de UI, autoplay e reconexão, e é difícil
de testar sem Lavalink.
**Decisão:** `MusicQueue`/`GuildSession` próprios; `autoSkip: false`; eventos lidos do evento
`raw` do nó; o Lavalink só recebe "toque esta faixa".
**Consequências:** controle total de concorrência, regras (duplicatas, limites, "pular só a
própria") e recuperação; 100% testável com um motor falso; um pouco mais de código.

## D-003 — Redis opcional ✅

**Decisão:** Redis só para rate limit e leases. Sem `REDIS_URL`, implementações em memória.
**Consequências:** instalação mínima mais simples; o Compose inclui Redis para já estar pronto
para várias instâncias.

## D-004 — Sem sharding nesta versão 🔄

**Decisão:** um único processo. Leases e rate limit já são distribuíveis via Redis.
**Consequências:** suficiente até ~2.500 servidores (limite do Discord para exigir shards);
sharding no roadmap.

## D-005 — Sessões não são restauradas após reinício ✅

**Contexto:** restaurar exige persistir fila/posição continuamente e reconectar a vozes que podem
já ter mudado.
**Decisão:** ao reiniciar, painéis antigos são marcados como encerrados e usuários usam `/play`.
**Consequências:** reinícios interrompem a música; código bem mais simples. Reavaliar se
reinícios forem frequentes.

## D-006 — Spotify/Apple/Deezer/TIDAL recusados ✅

**Decisão:** links desses serviços são recusados com orientação. LavaSrc não incluído (mirroring
enganoso, termos de API, contorno de DRM no Deezer). Ver [MUSIC_PROVIDERS.md](MUSIC_PROVIDERS.md).

## D-007 — Sem `/lyrics` ✅

**Contexto:** o requisito pedia `/lyrics` apenas com provedor confiável e legal.
**Decisão:** não implementar. Provedores com licença (ex.: Musixmatch, LyricFind) exigem contrato
comercial; APIs gratuitas não oficiais e _scraping_ violam direitos autorais/termos.
**Consequências:** comando ausente e documentado; reavaliar se houver contrato.

## D-008 — Sem painel web na v1 ✅

**Decisão:** toda a configuração por slash commands.
**Consequências:** sem OAuth2 web, sem superfície HTTP pública, menos risco; um painel web pode
vir depois (roadmap) reutilizando os serviços de `src/data`.

## D-009 — Sem Sentry ✅

**Decisão:** erros vão para logs estruturados com código de correlação e para a métrica
`aurora_errors_total`. Sentry (ou similar) pode ser adicionado depois.
**Consequências:** nenhum dado enviado a terceiros; investigação via logs.

## D-010 — YouTube sem OAuth/poToken, sem proxies ✅

**Decisão:** usar apenas os clientes públicos do plugin; não implementar rotação de IP, proxies,
contas descartáveis ou geração de tokens.
**Consequências:** se o IP for bloqueado, o YouTube fica indisponível até a situação mudar; o bot
continua com as demais fontes e informa o usuário.

## D-011 — Streams HTTP desligados por padrão ✅

**Decisão:** liberar por servidor (`/settings http-streams`), com checagem de SSRF.
**Consequências:** rádios exigem ação do gerente; risco residual de DNS rebinding documentado.

## D-012 — Permissões negam por padrão ✅

**Decisão:** matriz explícita de ações × níveis; ação desconhecida ou membro não verificável é
negado. Controle musical flexibilizável (`EVERYONE`, "sozinho é DJ"); configurações nunca.

## D-013 — Painel único com atualização limitada ✅

**Decisão:** uma mensagem por servidor; edições agrupadas (≥ 2,5 s) e barra de progresso a cada
15 s, marcada como aproximada.
**Consequências:** respeita rate limits do Discord; a posição exibida pode divergir alguns
segundos.

## D-014 — Dados não são apagados ao remover o bot ✅

**Decisão:** remoção do bot de um servidor não apaga dados (evita perda acidental); retenção
limita histórico/auditoria; remoção manual documentada.

## D-015 — TypeScript 5.9 e Vitest 4.1 🔄

**Decisão:** ficar uma versão atrás onde a mais nova quebraria o lint com tipos
(typescript-eslint) ou ainda é muito recente (Vitest 5). Revisar a cada trimestre.

## D-016 — Imagem sem `apt` ✅

**Decisão:** imagem final sem pacotes extras do sistema; `tini` substituído por `init: true` do
Compose; healthcheck com `node -e fetch(...)`.
**Consequências:** menos superfície de ataque e build reprodutível sem acesso a espelhos apt.
