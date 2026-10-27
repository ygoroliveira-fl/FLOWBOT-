# Fontes de música

O bot nunca acessa os provedores diretamente: ele envia um identificador (`ytsearch:…`, uma URL)
ao Lavalink, que resolve e transmite o áudio. O catálogo de fontes fica em
`src/providers/providers.ts`; a configuração do Lavalink em `lavalink/application.yml`.

## Situação por fonte

| Fonte                   | Pesquisa por texto |              Links               |           Reprodução            | Como                  | Estabilidade                          |
| ----------------------- | :----------------: | :------------------------------: | :-----------------------------: | --------------------- | ------------------------------------- |
| YouTube                 |   ✅ `ytsearch:`   | ✅ vídeos, playlists, `youtu.be` |               ✅                | youtube-plugin 1.18.2 | ⚠️ Instável por natureza (ver abaixo) |
| YouTube Music           |  ✅ `ytmsearch:`   |      ✅ `music.youtube.com`      |               ✅                | youtube-plugin        | ⚠️ Idem                               |
| SoundCloud              |   ✅ `scsearch:`   |         ✅ faixas, sets          | ✅ (faixas públicas, sem "Go+") | Lavalink nativo       | Boa                                   |
| Bandcamp                |   ✅ `bcsearch:`   |       ✅ `*.bandcamp.com`        |  ✅ (prévias/faixas públicas)   | Lavalink nativo       | Boa                                   |
| Twitch                  |         ❌         |        ✅ canais ao vivo         |           ✅ ao vivo            | Lavalink nativo       | Boa                                   |
| Vimeo                   |         ❌         |        ✅ vídeos públicos        |               ✅                | Lavalink nativo       | Média                                 |
| HTTP (rádios, arquivos) |         ❌         |     ✅ se o servidor liberar     |               ✅                | Lavalink nativo       | Depende do servidor remoto            |
| Spotify                 |         ❌         |    ❌ recusado com orientação    |               ❌                | —                     | —                                     |
| Apple Music             |         ❌         |    ❌ recusado com orientação    |               ❌                | —                     | —                                     |
| Deezer                  |         ❌         |    ❌ recusado com orientação    |               ❌                | —                     | —                                     |
| TIDAL                   |         ❌         |    ❌ recusado com orientação    |               ❌                | —                     | —                                     |

Antes de pesquisar, o bot consulta `GET /v4/info` do Lavalink: se uma fonte não estiver
carregada (ex.: plugin do YouTube falhou), o usuário recebe "indisponível no momento" e a
sugestão de usar SoundCloud, em vez de um erro genérico.

## YouTube: riscos e limites

- O YouTube não oferece API pública para reprodução de áudio. O youtube-plugin imita clientes
  oficiais (`MUSIC`, `ANDROID_VR`, `WEB`, `WEBEMBEDDED`). O Google muda esses clientes com
  frequência; **quebras periódicas são esperadas** e a correção costuma ser atualizar o plugin.
- **Termos de serviço:** os Termos do YouTube proíbem acessar conteúdo por meios diferentes dos
  oferecidos pelo serviço. Bots públicos de música baseados no YouTube já foram alvo de
  notificações (Groovy e Rythm encerraram em 2021). Operar o bot com YouTube é uma decisão do
  operador, que assume esse risco. Para reduzi-lo, defina `fonte` padrão SoundCloud (roadmap) ou
  desative o plugin.
- **Bloqueio de IP de datacenter:** IPs de VPS são frequentemente bloqueados ("Sign in to confirm
  you're not a bot"). Este projeto **não** implementa rotação de IP, proxies, OAuth com contas
  descartáveis nem geração de _poToken_ — seriam formas de contornar controles do provedor. Se o IP
  for bloqueado, as opções legítimas são: usar outras fontes, trocar de provedor de VPS, ou
  aguardar.
- Conteúdo com restrição de idade, privado, de membros ou pago não é reproduzido.

## Por que Spotify, Apple Music, Deezer e TIDAL não tocam

Esses serviços não oferecem áudio para terceiros: suas APIs entregam apenas metadados (e, no
caso do Spotify, prévias de 30 s foram descontinuadas para novos apps em 2024). Plugins como o
**LavaSrc** fazem _mirroring_: leem o título no Spotify e procuram o "mesmo" áudio no YouTube.
Isso foi avaliado e **não incluído** nesta versão porque:

1. O áudio tocado não vem do serviço do link, e às vezes é a música errada (cover, ao vivo, remix).
2. Exige credenciais de API do Spotify/Apple, cujos termos proíbem esse uso.
3. O modo "nativo" do Deezer no LavaSrc descriptografa o áudio com uma chave extraída do app —
   **contorno de DRM**, vedado neste projeto.

O usuário que envia um desses links recebe a orientação de pesquisar pelo nome da música.
A integração por metadados (só para montar a busca, com aviso explícito) está no
[ROADMAP.md](ROADMAP.md) como item opcional, condicionado a avaliação jurídica.

## Streams HTTP genéricos

Desligados por padrão em cada servidor; um gerente liga com `/settings http-streams ativo:true`.
Quando ligados, a URL passa por:

1. Somente `http`/`https`, sem usuário/senha embutidos, até 2048 caracteres.
2. Bloqueio de `localhost`, `*.local`, `*.internal`, nomes sem ponto (serviços do Compose).
3. Resolução DNS: **todos** os IPs precisam ser públicos (bloqueia RFC 1918, loopback, link-local
   incluindo `169.254.169.254`, CGNAT, ULA IPv6, NAT64, multicast etc.).

Risco residual: _DNS rebinding_ e redirecionamentos (o Lavalink resolve o nome de novo e pode
seguir redirects). Por isso a função fica desligada por padrão e o Lavalink roda em rede sem
acesso a Postgres/Redis expostos. Detalhes em [SECURITY.md](SECURITY.md).

## Atualizando o plugin do YouTube

1. Veja a versão mais recente em https://github.com/lavalink-devs/youtube-source/releases.
2. Altere `dev.lavalink.youtube:youtube-plugin:<versão>` em `lavalink/application.yml`.
3. `docker compose restart lavalink` (o Lavalink baixa o plugin na inicialização; o volume
   `lavalink-plugins` guarda o jar).
4. Confira: `scripts/diagnose.sh` (seção Lavalink) e um `/play` de teste.

## Adicionando uma fonte

1. Habilite-a no Lavalink (fonte nativa ou plugin) — somente se for legal e não contornar
   proteções.
2. Adicione um `MusicProvider` em `src/providers/providers.ts` (hosts, prefixo de busca,
   `sourceManager`).
3. Se pesquisável, inclua em `sourceChoices` de `/play` e `/search`.
4. Teste em `tests/unit/searchService.test.ts` e documente aqui.
