# Comandos

Todos os comandos são slash commands, funcionam só em servidores (não em DMs) e respondem em
português. Respostas de erro e de configuração são **efêmeras** (só quem usou vê).

## Níveis de permissão

| Nível       | Quem tem                                                                |
| ----------- | ----------------------------------------------------------------------- |
| **Usuário** | Qualquer membro                                                         |
| **DJ**      | Membros com o cargo definido em `/djrole set`                           |
| **Gerente** | Membros com o cargo de `/settings manager-role`                         |
| **Admin**   | Dono do servidor ou membros com _Administrador_ ou _Gerenciar Servidor_ |

Cada nível inclui os anteriores. Dois ajustes por servidor flexibilizam o controle musical:

- `/settings control modo:EVERYONE` — qualquer pessoa no canal de voz controla a música.
- `sozinho_e_dj` (padrão: ligado) — quem está sozinho com o bot no canal tem poderes de DJ.

Além do nível, comandos que afetam a reprodução exigem estar **no mesmo canal de voz** do bot.

## Matriz de permissões

✅ permitido · 🟡 permitido com restrição · ❌ negado

| Comando / ação                                                   |               Usuário                | DJ  | Gerente | Admin |
| ---------------------------------------------------------------- | :----------------------------------: | :-: | :-----: | :---: |
| `/play`, `/search`, `/join`                                      |                  ✅                  | ✅  |   ✅    |  ✅   |
| `/play proxima:true` (furar a fila)                              |                  ❌                  | ✅  |   ✅    |  ✅   |
| `/queue`, `/nowplaying`, `/help`, `/volume` (só ver)             |                  ✅                  | ✅  |   ✅    |  ✅   |
| `/skip`                                                          |       🟡 só a música que pediu       | ✅  |   ✅    |  ✅   |
| `/remove`                                                        |        🟡 só faixas que pediu        | ✅  |   ✅    |  ✅   |
| `/pause`, `/resume`, `/stop`, `/leave`, `/previous`              |                  ❌                  | ✅  |   ✅    |  ✅   |
| `/volume nivel`, `/shuffle`, `/loop`, `/move`, `/clear`, `/seek` |                  ❌                  | ✅  |   ✅    |  ✅   |
| `/autoplay`, `/filters`                                          |                  ❌                  | ✅  |   ✅    |  ✅   |
| Botões do painel                                                 | mesmas regras do comando equivalente |     |         |       |
| `/playlist` (as próprias)                                        |                  ✅                  | ✅  |   ✅    |  ✅   |
| `/playlist` (compartilhadas no servidor: ver/tocar)              |                  ✅                  | ✅  |   ✅    |  ✅   |
| `/privacy view`, `/privacy delete`                               |                  ✅                  | ✅  |   ✅    |  ✅   |
| `/stats`                                                         |                  ❌                  | ❌  |   ✅    |  ✅   |
| `/settings …` (exceto `manager-role`)                            |                  ❌                  | ❌  |   ✅    |  ✅   |
| `/settings manager-role`, `/djrole set/remove`                   |                  ❌                  | ❌  |   ❌    |  ✅   |

Com `modo:EVERYONE` (ou sozinho com o bot e `sozinho_e_dj` ligado), as linhas marcadas ❌ para
Usuário que são de **controle musical** passam a ✅. Configurações, `/stats` e cargos nunca são
liberados por esses modos.

> `/settings` e `/djrole` são registrados com a permissão padrão _Gerenciar Servidor_, então o
> Discord os esconde de quem não a tem. Para que o cargo de gerente veja `/settings`, um admin deve
> liberá-lo em **Configurações do servidor → Integrações → Aurora**. A verificação no bot continua
> valendo de qualquer forma.

## Música

| Comando              | Opções                                                                     | Descrição                                                                                                                                                             |
| -------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/play`              | `busca` (obrigatória), `fonte`, `proxima`                                  | Toca ou enfileira por nome ou link (faixa ou playlist). `fonte` vale para buscas por texto: YouTube (padrão), YouTube Music, SoundCloud, Bandcamp. `proxima` exige DJ |
| `/search`            | `busca`, `fonte`                                                           | Mostra até 10 resultados num menu para escolher                                                                                                                       |
| `/pause` · `/resume` | —                                                                          | Pausa / retoma                                                                                                                                                        |
| `/skip`              | —                                                                          | Pula a faixa atual                                                                                                                                                    |
| `/previous`          | —                                                                          | Volta para a faixa anterior (histórico da sessão)                                                                                                                     |
| `/stop`              | —                                                                          | Para e limpa a fila (o bot continua no canal até a inatividade)                                                                                                       |
| `/nowplaying`        | —                                                                          | Faixa atual com progresso aproximado                                                                                                                                  |
| `/volume`            | `nivel` 0–200                                                              | Sem opção mostra o volume; com opção ajusta (limitado pelo máximo do servidor)                                                                                        |
| `/shuffle`           | —                                                                          | Embaralha a fila                                                                                                                                                      |
| `/loop`              | `modo`: desligado, faixa atual, fila inteira                               | Modo de repetição                                                                                                                                                     |
| `/seek`              | `tempo` (ex.: `90`, `1:30`, `1:02:03`), `modo`: ir para / avançar / voltar | Posiciona a faixa (não vale para transmissões ao vivo)                                                                                                                |
| `/join`              | —                                                                          | Entra no seu canal de voz                                                                                                                                             |
| `/leave`             | —                                                                          | Sai e encerra a sessão                                                                                                                                                |
| `/autoplay`          | `ativo`                                                                    | Ao acabar a fila, toca músicas relacionadas (mix do YouTube ou mesmo artista)                                                                                         |
| `/filters`           | `efeito`                                                                   | Nenhum, Graves reforçados, Nightcore, Vaporwave, 8D, Karaokê, Suave                                                                                                   |

## Fila

| Comando   | Opções       | Descrição                                                               |
| --------- | ------------ | ----------------------------------------------------------------------- |
| `/queue`  | `pagina`     | Fila paginada (10 por página) com botões de navegação                   |
| `/remove` | `posicao`    | Remove a faixa na posição                                               |
| `/move`   | `de`, `para` | Move uma faixa                                                          |
| `/clear`  | —            | Limpa a fila mantendo a faixa atual; acima de 5 faixas pede confirmação |

## Playlists

Playlists pertencem a um usuário. `visibilidade: GUILD` deixa outras pessoas **deste servidor**
verem e tocarem; só o dono altera. Limites padrão: 25 playlists por usuário, 500 faixas cada.
O campo `nome` tem autocompletar com as suas playlists e as compartilhadas.

| Subcomando | Opções                         | Descrição                                                                  |
| ---------- | ------------------------------ | -------------------------------------------------------------------------- |
| `create`   | `nome`, `visibilidade`         | Cria (nome de 1 a 64 caracteres, único por usuário)                        |
| `list`     | —                              | Suas playlists e as compartilhadas neste servidor                          |
| `view`     | `nome`, `pagina`               | Faixas da playlist                                                         |
| `add`      | `nome`, `busca`                | Sem `busca`, adiciona a faixa que está tocando; com `busca`, pesquisa/link |
| `remove`   | `nome`, `posicao`              | Remove uma faixa                                                           |
| `play`     | `nome`, `embaralhar`           | Adiciona a playlist à fila                                                 |
| `rename`   | `nome`, `novo_nome`            | Renomeia                                                                   |
| `delete`   | `nome`                         | Apaga (com confirmação)                                                    |
| `share`    | `nome`, `modo` (GUILD/PRIVATE) | Compartilha no servidor ou torna privada                                   |

## Configurações (`/settings`)

| Subcomando      | Opções                                                   | Padrão               | Descrição                                                                                        |
| --------------- | -------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------ |
| `view`          | —                                                        | —                    | Mostra todas as configurações                                                                    |
| `panel-channel` | `canal`                                                  | canal do comando     | Canal fixo do painel; sem opção volta ao padrão                                                  |
| `volume`        | `padrao` 1–200, `maximo` 1–200                           | 80 / 150             | Volume inicial e teto                                                                            |
| `inactivity`    | `minutos` 1–1440                                         | 5                    | Tempo até sair quando a fila acaba ou o bot fica sozinho                                         |
| `autoplay`      | `ativo`                                                  | desligado            | Autoplay inicial de novas sessões                                                                |
| `control`       | `modo` DJ/EVERYONE, `sozinho_e_dj`                       | DJ, ligado           | Quem controla a música                                                                           |
| `queue`         | `limite` 10–5000, `duplicatas`, `duracao_max_min` 0–1440 | 500, sim, sem limite | Regras da fila (0 = sem limite de duração)                                                       |
| `http-streams`  | `ativo`                                                  | desligado            | Permite links HTTP fora das fontes conhecidas (rádios). Ver riscos em [SECURITY.md](SECURITY.md) |
| `history`       | `ativo`                                                  | ligado               | Guarda histórico (usado em `/stats` e autoplay)                                                  |
| `manager-role`  | `cargo`                                                  | nenhum               | Cargo de gerente (só admins)                                                                     |

O limite de fila do servidor nunca ultrapassa `MAX_QUEUE_SIZE` da instância. Toda alteração é
registrada no log de auditoria do banco.

## DJ (`/djrole`)

| Subcomando  | Descrição                                                                  |
| ----------- | -------------------------------------------------------------------------- |
| `set cargo` | Define o cargo de DJ                                                       |
| `remove`    | Remove; o controle fica com gerentes/admins (ou todos, se `modo:EVERYONE`) |

## Informações

| Comando           | Descrição                                                             |
| ----------------- | --------------------------------------------------------------------- |
| `/help`           | Lista de comandos agrupada por categoria                              |
| `/stats`          | Sessões, faixas tocadas, mais pedidas no servidor, uptime e latências |
| `/privacy view`   | O que o bot guarda sobre você                                         |
| `/privacy delete` | Apaga suas playlists, preferências e histórico (com confirmação)      |

## Painel

Ao iniciar uma sessão o bot publica um painel no canal configurado (ou no canal do comando):

| Botão                | Ação                                                                  | Permissão                  |
| -------------------- | --------------------------------------------------------------------- | -------------------------- |
| ⏮ Anterior           | Faixa anterior                                                        | DJ                         |
| ⏸ Pausar / ▶ Retomar | Pausa ou retoma                                                       | DJ                         |
| ⏭ Pular              | Pula **a faixa mostrada no painel** (cliques atrasados são ignorados) | DJ ou quem pediu a faixa   |
| ■ Parar              | Para e limpa a fila                                                   | DJ                         |
| 🔁 Repetir           | Alterna: não → fila → faixa                                           | DJ                         |
| 🔀 Embaralhar        | Embaralha a fila (ativo com 2+ faixas)                                | DJ                         |
| ☰ Fila              | Mostra a fila paginada (efêmero)                                      | Usuário                    |
| 🔊 Volume            | Abre controles efêmeros: −20, −10, +10, +20, 50%, 100%                | Ver: usuário · alterar: DJ |

O autoplay e os filtros são controlados pelos comandos `/autoplay` e `/filters`.

## Comando ausente: `/lyrics`

Não implementado. Não há provedor de letras com API oficial, estável e licenciada que possa ser
usado sem contrato; extrair letras de sites ou de APIs não oficiais violaria direitos autorais e
termos de uso. Ver decisão D-007 em [DECISIONS.md](DECISIONS.md).
