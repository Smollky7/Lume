# Lume Activity — instalação e configuração (Windows / PowerShell)

## O que foi implementado

- Página `/activity` preparada para o Discord Embedded App SDK.
- Cada instância da Activity mantém uma lista compartilhada de até quatro transmissões simultâneas.
- Cada transmissão continua sendo uma sala WebRTC independente do Lume original, com um único anfitrião por sala.
- O anfitrião **captura a tela no navegador externo**. A Activity reúne até quatro salas e cada participante clica em **Assistir** na tela desejada.
- A qualidade é controlada pelo seletor que já existia no visualizador do Lume.

**Não é ainda uma solução pronta para publicação pública**: a sincronização da lista usa o `instanceId` e não verifica identidade Discord no servidor. Use apenas com um grupo confiável. Uma próxima versão deve implementar login OAuth2 verificado no backend e autorização de anexação/remoção de telas.

## 1. Preparar o projeto

Abra um PowerShell na pasta que contém o `package.json` da raiz e execute:

```powershell
npm install
```

No site https://discord.com/developers/applications clique em **New Application** e crie `Lume`. Copie **Application ID** na seção General Information (não é o Bot Token).

Crie o arquivo de configuração do frontend:

```powershell
Copy-Item client/.env.example client/.env
notepad client/.env
```

Preencha `VITE_DISCORD_CLIENT_ID` com o Application ID e `VITE_PUBLIC_URL` com o endereço público HTTPS que hospeda o Lume, por exemplo:

```ini
VITE_DISCORD_CLIENT_ID=123456789012345678
VITE_PUBLIC_URL=https://seu-endereco.trycloudflare.com
```

No `.env` **da raiz** mantenha suas configurações TURN da Metered. **Não envie a senha ou `.env` para outras pessoas.**

Compile e execute:

```powershell
npm run typecheck
npm run build
npm run start
```

## 2. Configurar HTTPS para testes

Abra outro PowerShell e use seu túnel existente:

```powershell
.\tunnel.bat
```

Copie o hostname gerado sem `https://` (ex.: `abc-def.trycloudflare.com`). Se o hostname mudar, atualize `VITE_PUBLIC_URL` em `client/.env`, execute `npm run build` e reinicie o servidor.

## 3. Ativar a Activity no Discord Developer Portal

1. Abra https://discord.com/developers/applications e selecione o Lume.
2. Em **Activities > URL Mappings**, crie o mapeamento **Prefix:** `/` — **Target:** o hostname HTTPS do túnel **sem** `https://` e **sem** uma rota final.
3. Em **Activities > Settings**, ative **Enable Activities**. A raiz `/` já detecta automaticamente os parâmetros de inicialização do Discord e abre a Activity. A rota `/activity` também existe para testes.
4. Habilite as plataformas necessárias em **Supported Platforms**.
5. No Discord, ative **Developer Mode** em User Settings > Advanced. Entre em um canal de voz e abra o lançador de Activities (ícone de foguete/aplicativos). Selecione o app de desenvolvimento Lume.
6. Quando alguém entrar na **mesma instância** da Activity, verá a mesma lista de transmissões.

O caminho `/` detecta os parâmetros do Discord e entra na Activity automaticamente.

## 4. Transmitir quatro telas

1. Cada pessoa que quiser transmitir abre `https://SEU_HOST/` em um navegador fora do Discord, inicia uma **sala sem senha** e autoriza a captura de tela.
2. Copia o link `https://SEU_HOST/r/CODIGO` exibido pelo Lume.
3. Na Activity, cola o link no campo **Link da sala**, informa o nome da tela e clica em **Adicionar tela**.
4. Faça isso com até quatro anfitriões diferentes. Cada pessoa na Activity poderá clicar **Assistir** no respectivo quadro e escolher a própria qualidade.
5. Clique em **Ampliar** para focar uma transmissão.

**Observações:** navegador/Discord pode pedir interação para reproduzir áudio. Evite abrir vários áudios altos ao mesmo tempo. As telas via iframe ainda usam a interface convencional do Lume. A Metered pode consumir franquia TURN por espectador e transmissão. Atividades em clientes diferentes (ou múltiplas instâncias) não compartilham automaticamente a lista.

## 5. Problemas conhecidos e próximos passos

- O menu do Discord muda entre versões. Consulte a documentação atual https://discord.com/developers/docs/activities/overview.
- O SDK precisa estar em execução **dentro** do Discord. Abrir `/activity` diretamente no navegador é apenas uma tela informativa.
- Para produção, use domínio HTTPS estável e backend persistente. O túnel temporário `trycloudflare.com` muda de hostname.
- Discord pode bloquear captura da tela na própria Activity; por isso o transmissor é externo.
- **Segurança:** não exponha esta versão a comunidades públicas sem implementar autenticação OAuth2 Discord e permissões de alteração da lista.
- A Activity sincroniza a lista de salas em memória; reiniciar o servidor zera essa lista.
- Não foi possível executar `npm install` nem validar o build neste ambiente de edição. Faça `npm run typecheck` e `npm run build` no Windows e informe eventuais erros.
