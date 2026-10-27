# Roadmap

## Antes de produção (bloqueios)

1. **Validar áudio real:** subir o Compose numa VPS, tocar faixas de cada fonte em um servidor de
   testes, confirmar a negociação DAVE, seek, filtros, pausa, reconexão após reiniciar o
   Lavalink (`docker compose restart lavalink`), troca de canal de voz e desconexão manual do bot.
2. **Validar os scripts** `install.sh`, `backup.sh`, `restore.sh`, `update.sh` num Compose real.
3. Teste de carga básico (10–30 sessões simultâneas) para medir RAM/CPU do Lavalink.

## Curto prazo

- Fonte padrão configurável por servidor (ex.: SoundCloud como padrão onde o YouTube for instável).
- Refazer a pesquisa por `uri` quando o `encoded` de uma faixa de playlist não for mais aceito.
- Suporte a canais de palco (Stage).
- `/playlist import` a partir da fila atual (`/playlist save`).
- Testes de componentes adicionais para comandos de playlist/configuração (cobertura atual de
  `src/discord` ~45%).
- Atualizar Vitest para 5.x e avaliar TypeScript 6/7 quando o typescript-eslint suportar.

## Médio prazo

- Sharding (`ShardingManager`) com Redis obrigatório; métricas por shard.
- Persistir e restaurar sessões após reinício (opcional por servidor) — revisar D-005.
- Painel web (OAuth2 do Discord) para configurações e playlists — revisar D-008.
- Alertmanager no Compose de monitoramento com receptor por webhook do Discord.
- Imagem menor (prune de dependências, possivelmente distroless).

## Condicionado a avaliação jurídica/contratual

- Letras (`/lyrics`) via provedor licenciado — D-007.
- Links do Spotify/Apple Music apenas como **metadados** para montar a pesquisa, com aviso claro
  de que o áudio vem de outra fonte — D-006.
