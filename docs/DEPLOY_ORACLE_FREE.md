# Hospedagem gratuita na Oracle Cloud (Always Free)

A opção gratuita que comporta o bot completo 24/7 (bot + Lavalink + Postgres + Redis) é uma VM
**Ampere A1 (ARM)** do plano _Always Free_ da Oracle Cloud. Todas as imagens usadas pelo
`docker-compose.yml` têm versão `arm64` (conferido em 27/10/2026 para o Lavalink 4.2.2).

## O que o plano gratuito oferece (conferido em 27/10/2026)

Fonte: [Always Free Resources](https://docs.oracle.com/en-us/iaas/Content/FreeTier/resourceref.htm).

| Recurso                | Limite gratuito                 | Uso estimado do Aurora               |
| ---------------------- | ------------------------------- | ------------------------------------ |
| VM Ampere A1           | 2 OCPUs e 12 GB de RAM no total | ~1–1,5 GB de RAM (estimativa)        |
| Disco (boot + volumes) | 200 GB                          | ~10 GB                               |
| Tráfego de saída       | 10 TB/mês                       | ~0,5 TB/mês com 10 sessões contínuas |

Em 2026 a Oracle reduziu o limite do A1 de 4 OCPUs/24 GB para 2 OCPUs/12 GB; os limites podem
mudar de novo. Confira a página oficial antes de criar a VM.

## Por que não outras opções "grátis"

- Planos gratuitos de PaaS (Render, Koyeb e similares) hibernam o serviço ou não comportam um
  processo Java de ~500 MB contínuo: o bot ficaria offline.
- As VMs AMD gratuitas da Oracle têm 1 GB de RAM: insuficiente para o Lavalink.
- Hospedar no próprio PC funciona, mas o bot cai quando o PC desliga.

## Riscos

- **Recuperação de VM ociosa:** a Oracle pode desligar instâncias _Always Free_ que, por 7 dias,
  ficarem abaixo de 20% de CPU (p95), rede e memória. Com o bot pouco usado isso pode acontecer.
  Se acontecer, ligue a VM de novo no painel (os dados no disco permanecem).
- **Cartão de crédito:** o cadastro exige cartão para verificação. Contas _Always Free_ não são
  cobradas; não converta para _Pay As You Go_ sem entender que uso acima do limite passa a ser
  cobrado.
- **Disponibilidade de A1:** em algumas regiões a criação falha com "Out of capacity". Tente outro
  domínio de disponibilidade ou mais tarde; a região é escolhida no cadastro e não muda depois
  (São Paulo e Vinhedo são as regiões brasileiras).
- **YouTube:** IPs de nuvem são bloqueados com frequência pelo YouTube. Se acontecer, use
  SoundCloud/Bandcamp (ver [MUSIC_PROVIDERS.md](MUSIC_PROVIDERS.md)).

## Passo a passo

### 1. Criar a conta e a VM

1. Cadastre-se em https://www.oracle.com/cloud/free/ e escolha a região de origem.
2. No console: **Compute → Instances → Create instance**.
3. **Image:** Canonical Ubuntu 24.04. **Shape:** _Ampere_ → `VM.Standard.A1.Flex`, 2 OCPUs,
   12 GB de memória.
4. **Networking:** mantenha a VCN padrão com IP público.
5. **SSH keys:** envie sua chave pública (ou baixe a chave gerada e guarde-a).
6. Crie e anote o IP público.

Nenhuma porta de entrada precisa ser aberta além da SSH (22), que já vem liberada.

### 2. Preparar o servidor

```bash
ssh ubuntu@IP_DA_VM
sudo apt-get update && sudo apt-get -y upgrade
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu && exit   # saia e entre de novo para valer o grupo
```

Swap ajuda a evitar falta de memória durante o build da imagem:

```bash
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile
sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

### 3. Instalar o bot

```bash
git clone https://github.com/ygoroliveira-fl/FLOWBOT-.git aurora && cd aurora
scripts/install.sh      # 1ª vez: cria o .env com senhas aleatórias e para
nano .env               # preencha DISCORD_TOKEN e DISCORD_CLIENT_ID
scripts/install.sh      # constrói, migra, sobe e registra os comandos
docker compose ps
```

O primeiro build no ARM leva alguns minutos. Os comandos globais podem levar alguns minutos para
aparecer no Discord.

### 4. Backups

A cópia de segurança fica na própria VM; agende-a e copie para fora periodicamente
([BACKUP_RESTORE.md](BACKUP_RESTORE.md)):

```bash
crontab -e
15 4 * * * cd /home/ubuntu/aurora && scripts/backup.sh >> backups/backup.log 2>&1
```

### 5. Atualizar

```bash
cd ~/aurora && scripts/update.sh
```

## Estado da verificação

Este guia **não foi executado** numa VM da Oracle: o ambiente de desenvolvimento não tem acesso à
nuvem. Foram conferidos os limites na documentação oficial e a disponibilidade de imagens `arm64`
do Lavalink 4.2.2. Node 22, PostgreSQL 17 e Redis 7 publicam imagens oficiais multi-arquitetura.
