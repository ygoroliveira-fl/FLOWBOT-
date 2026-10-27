# Changelog

Formato baseado em [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/); versões seguem
[SemVer](https://semver.org/lang/pt-BR/).

## [0.1.0] — 2026-10-27

Primeira versão. **Não validada com áudio real no Discord** (ver
[docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md)).

### Adicionado

- Sessões de música independentes por servidor com fila própria, repetição, autoplay, histórico
  da sessão, filtros e recuperação de falhas.
- 26 comandos slash: música, fila, playlists, configurações, cargo de DJ, ajuda, estatísticas e
  privacidade.
- Painel interativo com botões e atualização controlada.
- Fontes: YouTube, YouTube Music, SoundCloud, Bandcamp, Twitch, Vimeo e streams HTTP opcionais,
  com proteção contra SSRF.
- Playlists persistentes em PostgreSQL (privadas ou compartilhadas no servidor).
- Permissões em quatro níveis, modo "todos controlam" e "sozinho é DJ".
- Rate limit e leases em memória ou Redis.
- Health checks, métricas Prometheus, painel Grafana e alertas.
- Docker Compose para VPS com contêineres endurecidos; scripts de instalação, backup,
  restauração, diagnóstico e atualização; CI no GitHub Actions.
- Documentação completa em português.
