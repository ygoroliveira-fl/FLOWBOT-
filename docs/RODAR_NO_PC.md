# Rodar no próprio computador (grátis, sem terminal)

O jeito mais simples de colocar o bot no ar: o Docker Desktop no seu PC e um arquivo com dois
cliques. Não precisa de cartão nem de servidor. **O bot só fica online enquanto o computador e o
Docker Desktop estiverem ligados.**

## Requisitos

- Windows 10/11, macOS ou Linux com pelo menos **8 GB de RAM** (o bot usa cerca de 1,5 GB).
- [Docker Desktop](https://www.docker.com/products/docker-desktop/) instalado e aberto.
  No Windows, o instalador pede para ativar o WSL 2; aceite e reinicie se ele pedir.

## 1. Criar o bot no Discord (uma vez)

1. Acesse https://discord.com/developers/applications → **New Application** → dê um nome.
2. Em **General Information**, copie o **Application ID**.
3. Em **Bot**, clique em **Reset Token** e copie o token. Não compartilhe com ninguém.
4. Convide o bot para o seu servidor, trocando `SEU_ID` pelo Application ID:
   `https://discord.com/oauth2/authorize?client_id=SEU_ID&scope=bot+applications.commands&permissions=3165184`

## 2. Baixar o projeto

No GitHub do projeto, clique em **Code → Download ZIP** e extraia a pasta (por exemplo, em
Documentos).

## 3. Ligar

| Sistema | O que fazer                                                                                                                                           |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows | Dois cliques em `INICIAR-WINDOWS.bat`. Se o Windows mostrar "O Windows protegeu o computador", clique em **Mais informações → Executar assim mesmo**. |
| macOS   | Clique com o botão direito em `INICIAR-MAC-LINUX.command` → **Abrir** → **Abrir**.                                                                    |
| Linux   | Execute `./INICIAR-MAC-LINUX.command` no terminal.                                                                                                    |

Na primeira vez, a janela pede o **Application ID** e o **token**, cria o arquivo `.env` com
senhas aleatórias e monta tudo. Isso leva alguns minutos; nas próximas vezes é bem mais rápido.
Os comandos (`/play`, `/help`...) podem levar alguns minutos para aparecer no Discord.

## 4. Desligar

Dois cliques em `PARAR-WINDOWS.bat` (ou `PARAR-MAC-LINUX.command`). Playlists e configurações
ficam guardadas para a próxima vez.

## Problemas comuns

| Mensagem                             | Solução                                                                          |
| ------------------------------------ | -------------------------------------------------------------------------------- |
| "Docker não encontrado"              | Instale o Docker Desktop e reinicie o computador                                 |
| "O Docker não está rodando"          | Abra o Docker Desktop e espere o ícone ficar verde                               |
| "Não consegui registrar os comandos" | Token ou Application ID errado: apague o arquivo `.env` e rode o iniciar de novo |
| Comandos não aparecem                | Espere alguns minutos e reinicie o Discord (Ctrl+R)                              |
| O bot entra no canal mas não toca    | Veja [TROUBLESHOOTING.md](TROUBLESHOOTING.md)                                    |

O arquivo `.env` contém o token: não envie para ninguém nem o publique no GitHub (ele já está no
`.gitignore`).

## Estado da verificação

O script de macOS/Linux foi executado com um Docker simulado (perguntas, geração do `.env` com
permissão 600 e ordem dos comandos). O arquivo `.bat` do Windows **não** foi executado: o ambiente
de desenvolvimento não tem Windows. Se algo falhar, envie a mensagem que aparecer na janela.
