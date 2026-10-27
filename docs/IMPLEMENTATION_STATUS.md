# Estado da implementação

Atualizado em **27/10/2026** — versão 0.1.0.

## Veredito

**Não está pronto para produção.** O código está completo e passa em todas as verificações
automatizadas, mas existe um bloqueio crítico: **nenhuma reprodução real no Discord foi feita**.
O ambiente de desenvolvimento não tinha acesso ao Discord nem conseguia baixar o Lavalink, então o
caminho "bot → Lavalink real → voz do Discord com DAVE" não foi exercitado. Os passos para
remover o bloqueio estão em [ROADMAP.md](ROADMAP.md#antes-de-produção-bloqueios).

## Verificações executadas (resultados reais)

| Verificação                                                              | Resultado                                                                                                             |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `pnpm format:check`                                                      | ✅ sem diferenças                                                                                                     |
| `pnpm lint` (ESLint com tipos)                                           | ✅ 0 erros, 0 avisos                                                                                                  |
| `pnpm typecheck`                                                         | ✅                                                                                                                    |
| `pnpm test` (unitários)                                                  | ✅ 149 testes em 11 arquivos                                                                                          |
| `pnpm test:integration` (Postgres 16 local + Redis 7)                    | ✅ 30 testes em 5 arquivos                                                                                            |
| Cobertura (unitários + integração, `src/` sem código gerado)             | 64% das linhas, 53% dos ramos (detalhe abaixo)                                                                        |
| `pnpm build` + `pnpm smoke`                                              | ✅ build carrega; 26 comandos gerados                                                                                 |
| `pnpm audit --prod`                                                      | ✅ nenhuma vulnerabilidade conhecida                                                                                  |
| `prisma db seed`                                                         | ✅                                                                                                                    |
| Build da imagem Docker                                                   | ✅ (com ajustes de rede só do ambiente de desenvolvimento)                                                            |
| `prisma migrate deploy` dentro do contêiner                              | ✅                                                                                                                    |
| Bot iniciando no contêiner (somente leitura, sem capabilities, uid 1000) | ✅ conecta ao banco, sobe `/healthz`; falha em seguida ao resolver `discord.com` (esperado: sem internet no ambiente) |
| `docker compose config` (produção, dev e monitoramento)                  | ✅ válido                                                                                                             |
| Arquivos YAML de Prometheus/alertas/Grafana                              | ✅ sintaxe válida (não executados num Prometheus real)                                                                |
| Flags de `pg_dump`/`pg_restore` dos scripts                              | ✅ testadas contra Postgres local                                                                                     |

Cobertura por área (linhas, só testes unitários): `providers` 95%, `config` 96%, `ui` 86%,
`music` 80%, `core` 61%, `discord` 48%, `audio` 9%, `data` 2%. As áreas `audio`, `data` e
`observability` são cobertas pelos testes de **integração** (Lavalink simulado, Postgres e Redis
reais); com eles a cobertura total sobe para 64% das linhas.

## Não verificado

| Item                                                                      | Por quê                                                 | Risco                       |
| ------------------------------------------------------------------------- | ------------------------------------------------------- | --------------------------- |
| Reprodução real (YouTube, SoundCloud, Bandcamp, Twitch, Vimeo, HTTP)      | Sem acesso ao Lavalink real/Discord                     | **Crítico** até ser testado |
| Negociação DAVE ponta a ponta                                             | Idem; verificado apenas que o `channelId` é enviado     | **Crítico**                 |
| Imagem do Lavalink 4.2.2 + download do youtube-plugin 1.18.2              | Blobs do GHCR e Maven bloqueados no ambiente            | Alto                        |
| Healthcheck do Lavalink (`wget` na imagem alpine)                         | Imagem não pôde ser baixada                             | Médio                       |
| Postgres/Redis/Lavalink com `cap_drop`/`user` do Compose                  | Imagens não puderam ser baixadas (limite do Docker Hub) | Médio                       |
| Scripts `install`/`backup`/`restore`/`update`/`diagnose` de ponta a ponta | Sem Compose real                                        | Médio                       |
| Comportamento sob carga                                                   | Sem teste de carga                                      | Médio                       |
| Prometheus/Grafana em execução                                            | Imagens não baixadas                                    | Baixo                       |

## Funcionalidades

| Funcionalidade                                                      | Estado                    | Observações                                                     |
| ------------------------------------------------------------------- | ------------------------- | --------------------------------------------------------------- |
| Sessões independentes por servidor                                  | ✅ Implementado e testado | Fila, volume, loop, filtros, painel                             |
| `/play`, `/search` (texto e links, playlists)                       | ✅                        | Fontes em [MUSIC_PROVIDERS.md](MUSIC_PROVIDERS.md)              |
| `/pause /resume /skip /stop /previous /seek /volume /shuffle /loop` | ✅                        |                                                                 |
| `/queue /remove /move /clear`                                       | ✅                        | Confirmação para limpar > 5 faixas                              |
| `/join /leave /nowplaying`                                          | ✅                        |                                                                 |
| `/autoplay`                                                         | ✅                        | Mix do YouTube, depois mesmo artista; evita repetições recentes |
| `/filters`                                                          | ✅                        | 7 predefinições                                                 |
| `/playlist` (9 subcomandos)                                         | ✅                        | Testado contra Postgres real, inclusive concorrência            |
| `/settings` (10 subcomandos), `/djrole`                             | ✅                        | Auditoria das alterações                                        |
| `/help /stats /privacy`                                             | ✅                        |                                                                 |
| `/lyrics`                                                           | ❌ Não implementado       | Sem provedor legal e confiável (D-007)                          |
| Painel com botões                                                   | ✅                        | Atualização limitada; recriação se apagado                      |
| Permissões (4 níveis, EVERYONE, sozinho é DJ)                       | ✅                        | Matriz em [COMMANDS.md](COMMANDS.md)                            |
| Reconexão de voz e recuperação de queda do Lavalink                 | ✅ (contra dublês)        | Validar com Lavalink real                                       |
| Restaurar sessões após reinício                                     | ❌ Decisão                | D-005                                                           |
| Rate limit e leases (memória/Redis)                                 | ✅                        | Redis testado com servidor real                                 |
| SSRF                                                                | ✅                        | Risco residual de DNS rebinding documentado                     |
| Métricas, health, alertas, painel Grafana                           | ✅                        | Painel/alertas não executados                                   |
| Sharding                                                            | ❌                        | Roadmap                                                         |
| Painel web                                                          | ❌ Decisão                | D-008                                                           |
| Spotify/Apple/Deezer/TIDAL                                          | ❌ Decisão                | D-006; links recusados com orientação                           |
| Canais de palco                                                     | ❌                        | Roadmap                                                         |

## Problemas encontrados e corrigidos durante o desenvolvimento

- Prisma gerava imports `.ts` no build Docker (o `generate` roda antes de existir `tsconfig.json`),
  quebrando o bot em produção — corrigido com `importFileExtension = "js"`; validado subindo o
  contêiner.
- Remoção de faixas de playlist violava `CHECK (position >= 1)` ao deslocar posições — corrigido
  com deslocamento em duas etapas.
- Histórico falhava com chave estrangeira quando o servidor ainda não tinha configurações no
  banco — corrigido com `connectOrCreate`.
- Falha do Redis ao criar sessão gerava erro genérico — agora mensagem amigável e teste.
- `aurora_dependency_up` só era atualizado quando alguém chamava `/readyz` — agora a cada coleta
  de métricas.

## Riscos conhecidos

1. **YouTube** pode parar de funcionar a qualquer momento (mudanças do Google, bloqueio do IP da
   VPS) e seu uso pode conflitar com os Termos de Serviço. Ver [MUSIC_PROVIDERS.md](MUSIC_PROVIDERS.md).
2. **DNS rebinding** em streams HTTP (desligados por padrão).
3. **Imagem do bot com ~820 MB** (dependências de build do Prisma); funcional, mas pode ser
   reduzida.
4. **Sem restauração de sessão**: reinícios interrompem a música.
5. Faixas salvas em playlists dependem do formato `encoded` do Lavalink; uma mudança de formato
   exigiria nova pesquisa (não automatizada).
