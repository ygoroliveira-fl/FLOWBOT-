# Backup e restauração

## O que precisa de backup

| Item                                                              | Onde                             | Backup?                                                 |
| ----------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------- |
| Banco PostgreSQL (configurações, playlists, histórico, auditoria) | volume `aurora_postgres-data`    | **Sim — é o único estado importante**                   |
| `.env` (segredos)                                                 | raiz do projeto                  | Sim, guardado à parte e cifrado (gerenciador de senhas) |
| Redis                                                             | memória                          | Não (só rate limit e leases, efêmeros)                  |
| Plugins do Lavalink                                               | volume `aurora_lavalink-plugins` | Não (baixados de novo na inicialização)                 |
| Dados do Prometheus/Grafana                                       | volumes                          | Opcional                                                |

## Backup

```bash
scripts/backup.sh                # grava em backups/aurora-<data UTC>.dump
scripts/backup.sh /mnt/backup    # outro diretório
KEEP=30 scripts/backup.sh        # mantém 30 arquivos (padrão 14)
```

O script usa `pg_dump --format=custom` (comprimido), grava primeiro em `.partial` e só renomeia
quando termina, valida o arquivo com `pg_restore --list`, aplica permissão `600` e remove apenas
backups antigos com o mesmo padrão de nome.

### Agendar

```bash
crontab -e
# Todo dia às 04:15 (UTC do servidor)
15 4 * * * cd /home/aurora/aurora && scripts/backup.sh >> backups/backup.log 2>&1
```

### Cópia fora da VPS

Backups só na mesma VPS não protegem contra perda do servidor. Copie para outro lugar, por
exemplo com `rclone` para um object storage, ou `scp` para outra máquina. Se o destino não for
confiável, cifre antes (`age` ou `gpg`). Exemplo:

```bash
rclone copy backups/ remoto:aurora-backups --max-age 48h
```

## Restauração

```bash
scripts/restore.sh backups/aurora-20261027T041500Z.dump
```

O script:

1. Valida o arquivo.
2. Pede que você digite `RESTAURAR` (nada é feito sem essa confirmação).
3. Faz um backup do estado atual em `backups/pre-restore/`.
4. Para o bot, restaura com `pg_restore --clean --if-exists --single-transaction` (ou tudo, ou
   nada), aplica migrações pendentes (caso o backup seja de uma versão anterior) e inicia o bot.

### Restaurar em uma VPS nova

```bash
git clone <repo> aurora && cd aurora
# copie o .env antigo (ou crie um novo e preencha)
docker compose up -d postgres
docker compose exec -T postgres pg_restore -U aurora -d aurora --no-owner < aurora-XXXX.dump
docker compose up -d
```

### Restaurar um backup de versão mais nova numa versão mais antiga

Não suportado: o schema do backup pode ter colunas que o código antigo não conhece. Atualize o
código primeiro (`scripts/update.sh`) e então restaure.

## Testar os backups

Um backup só é confiável se a restauração foi testada. Mensalmente:

```bash
docker run --rm -d --name pgtest -e POSTGRES_PASSWORD=t postgres:17.6-alpine
sleep 5
docker exec -i pgtest pg_restore -U postgres -d postgres --no-owner < backups/<último>.dump
docker exec pgtest psql -U postgres -c 'SELECT count(*) FROM "Playlist";'
docker rm -f pgtest
```

## Estado da verificação

Os comandos `pg_dump --format=custom`, `pg_restore --list` e
`pg_restore --clean --if-exists --no-owner --single-transaction` usados pelos scripts foram
executados contra um banco de teste (PostgreSQL 16) durante o desenvolvimento. Os scripts
completos via `docker compose exec` **não** foram executados num ambiente Compose real, porque o
ambiente de desenvolvimento não conseguiu baixar a imagem do Postgres. Teste-os na primeira
instalação.
