# Lume

Transmissão de tela pelo navegador com WebRTC, descoberta automática das transmissões em uma Discord Activity e sinalização em tempo real com Socket.IO.

## Validação desta entrega — 18/10/2026

Base usada: commit `1519d475b1686edd2e529a6ea58f6874e96020a8` da branch `main`, com os metadados inválidos `:Zone.Identifier` removidos do pacote.

Executado com sucesso neste código:

- `npm ci --include=dev`;
- `npm run typecheck`;
- `npm run build` (frontend Vite 8.3.4 e backend TypeScript);
- `npm test` — 2 testes aprovados;
- instalação auditada pelo npm — 0 vulnerabilidades conhecidas.

Os testes automatizados cobrem criação de sala, publicação automática na Activity, entrada do espectador, retransmissão Socket.IO e remoção da tela ao encerrar. Não foi possível testar esta entrega já implantada na Vercel/Render nem executar o fluxo em clientes reais Discord desktop/mobile, pois isso exige as contas, configurações e credenciais do usuário. Portanto, o teste real descrito abaixo continua obrigatório.

## O que esta versão resolve

- frontend continua na Vercel e backend continua no Render;
- a Activity usa o URL Mapping `/backend` para Socket.IO/WebSocket;
- quem inicia uma transmissão pela Activity publica a sala automaticamente na chamada;
- os demais participantes veem todas as transmissões disponíveis, sem colar links;
- ao tocar em **Assistir**, o navegador abre o player e entra como `Convidado`, sem pedir nome;
- inclui um comando idempotente para criar ou reparar o `PRIMARY_ENTRY_POINT` necessário no Discord mobile;
- inclui `package-lock.json`, build separado do backend no Render e testes de integração.

### Limite oficial do Discord

O proxy de Discord Activities suporta WebSocket, mas não suporta WebRTC. Por isso a lista compartilhada funciona dentro da Activity, enquanto captura e reprodução abrem no navegador externo. Isso é intencional: tentar colocar o player WebRTC dentro do iframe da Activity não é uma configuração suportada pelo Discord.

Documentação oficial: <https://docs.discord.com/developers/activities/development-guides/networking>.

## Fluxo para o usuário

1. Abra o Lume pelo lançador de Apps/Activities da chamada.
2. Toque em **Transmitir tela**.
3. O Discord abre o frontend da Vercel no navegador.
4. Escolha a tela e inicie a transmissão sem senha.
5. A transmissão aparece automaticamente para todos na mesma instância da Activity.
6. Cada participante toca em **Assistir** e o player abre já conectado.

Salas protegidas por senha continuam disponíveis pelo link normal, mas não são publicadas automaticamente na Activity.

## Requisitos

- Node.js 20.19+ ou 22.12+ (Node 24 recomendado);
- aplicação criada no Discord Developer Portal com Activities habilitadas;
- projeto do frontend na Vercel;
- Web Service do backend no Render;
- TURN configurado no Render para redes com NAT/CGNAT.

## Instalação e validação local

Na raiz do projeto:

```powershell
npm ci
npm run typecheck
npm run build
npm test
```

Para executar tudo localmente:

```powershell
npm run start
```

O backend abre em `http://localhost:3000`. Para desenvolvimento com atualização automática, use `npm run dev` e abra `http://localhost:5173`.

## Deploy do backend no Render

Crie ou atualize um **Web Service** usando a raiz do repositório.

- Runtime: `Node`
- Build Command: `npm ci --include=dev && npm run build -w server`
- Start Command: `npm run start -w server`
- Health Check Path: `/api/health`

Variáveis mínimas:

```ini
NODE_ENV=production
TRUST_PROXY=true
FRONTEND_URL=https://lume-jade-two.vercel.app
```

Configure também uma opção TURN. Exemplo com API gerenciada:

```ini
ICE_API_URL=https://SEU_PROVEDOR/credentials?apiKey=SUA_CHAVE
```

Ou Cloudflare Realtime TURN:

```ini
CF_TURN_KEY_ID=...
CF_TURN_API_TOKEN=...
```

Nunca coloque essas credenciais em arquivos versionados. Use apenas o painel de Environment Variables do Render.

O arquivo `render.yaml` já contém os comandos corretos. Se o serviço atual é `https://lume-api-059u.onrender.com`, confirme depois do deploy:

```text
https://lume-api-059u.onrender.com/api/health
```

A resposta esperada é JSON com `"ok": true`.

## Deploy do frontend na Vercel

No projeto da Vercel:

- Root Directory: `client`
- Framework Preset: `Vite`
- Build Command: `npm run build`
- Output Directory: `dist`

Variáveis do frontend:

```ini
VITE_DISCORD_CLIENT_ID=SEU_APPLICATION_ID
VITE_PUBLIC_URL=https://lume-jade-two.vercel.app
VITE_BACKEND_URL=https://lume-api-059u.onrender.com
```

`VITE_` significa que o valor entra no JavaScript público. Portanto, use esse prefixo apenas para IDs e URLs públicas. Nunca use `VITE_DISCORD_BOT_TOKEN`, `VITE_DISCORD_CLIENT_SECRET` ou qualquer chave TURN.

Depois de alterar uma variável, faça um novo deploy completo na Vercel.

## URL Mappings da Discord Activity

No Discord Developer Portal, abra **Activities → URL Mappings** e configure nesta ordem:

| Ordem | Prefix | Target |
|---|---|---|
| 1 | `/backend` | `lume-api-059u.onrender.com` |
| 2 | `/` | `lume-jade-two.vercel.app` |

Regras importantes:

- o Target não leva `https://`;
- `/backend` deve ficar antes de `/`, pois o Discord avalia os prefixos por ordem;
- o cliente usa `/.proxy/backend/socket.io`; o Discord encaminha esse tráfego ao Socket.IO do Render;
- em **Activities → Settings**, habilite Activities e marque Web, Desktop, iOS e Android em Supported Platforms;
- não use Application URL Override no teste de produção.

## Primary Entry Point para desktop e mobile

Ao habilitar Activities, o Discord normalmente cria um comando `Launch`. Se o mobile disser que não existe comando para iniciar a Activity, execute o reparo incluído neste projeto.

Abra um PowerShell local na raiz do projeto e defina os valores somente para essa sessão:

```powershell
$env:DISCORD_APPLICATION_ID="SEU_APPLICATION_ID"
$env:DISCORD_BOT_TOKEN="SEU_BOT_TOKEN"
npm run discord:register
Remove-Item Env:DISCORD_BOT_TOKEN
Remove-Item Env:DISCORD_APPLICATION_ID
```

O script consulta os comandos globais. Se já existir um `PRIMARY_ENTRY_POINT`, ele o atualiza; caso contrário, cria `iniciar` com:

- `type: 4` (`PRIMARY_ENTRY_POINT`);
- `handler: 2` (`DISCORD_LAUNCH_ACTIVITY`);
- instalação em servidor e conta de usuário;
- uso em servidor, DM e Group DM.

O token do bot é necessário apenas para essa chamada administrativa e não deve ser salvo no frontend, no ZIP ou no GitHub. A propagação do comando global pode não ser instantânea.

Documentação oficial: <https://docs.discord.com/developers/docs/interactions/slash-commands#entry-point-commands>.

## Teste real no Discord

O build e os testes automatizados não substituem o teste em clientes reais. Faça este roteiro após os dois deploys:

1. Desktop/web: abra a Activity na chamada e confirme que não aparece erro de WebSocket.
2. Clique em **Transmitir tela**, escolha a tela no navegador e inicie.
3. Em outra conta na mesma chamada, confirme que `Tela 1` aparece sem colar link.
4. Clique em **Assistir** e confirme que o player entra sem pedir apelido.
5. Repita no Android ou iOS pelo App Launcher.
6. Teste uma conta em 4G/5G; se ficar em “Sem rota de vídeo”, revise o TURN.
7. Encerre a transmissão e confirme que ela desaparece da Activity.

Só esse teste confirma o comportamento fim a fim do Discord, do navegador, do TURN e dos deploys públicos.

## Solução de problemas

### Activity conecta, mas não lista transmissões

- confirme que `/backend` está antes de `/` nos URL Mappings;
- confirme que o Target do backend não contém `https://`;
- confirme `FRONTEND_URL` no Render;
- abra `/api/health` do Render e verifique se o serviço não está hibernando;
- no Discord desktop, ative Developer Mode e examine o Console.

### Mobile diz que não há comando de entrada

- execute `npm run discord:register` com as variáveis temporárias;
- confirme que Activities e Android/iOS estão habilitados;
- feche e abra o Discord depois da propagação do comando.

### Render falha em `npm ci`

Use esta versão com o `package-lock.json` incluído e execute o Build Command exatamente como documentado. Não use `npm ci` em um pacote sem lockfile.

### Player fica em “Sem rota de vídeo”

Socket.IO está funcionando, mas o WebRTC não encontrou rota entre os participantes. Configure TURN no Render. Vercel e Render não são servidores TURN.

## Segurança e limites

- o backend não recebe nem grava o vídeo; ele sinaliza as conexões WebRTC;
- IDs de sala são aleatórios e somente o anfitrião possui o token de controle;
- a lista da Activity fica em memória e é perdida quando o Render reinicia;
- use uma única instância do backend; múltiplas instâncias exigem Redis/adapter do Socket.IO;
- Render Free pode hibernar e tornar a primeira conexão lenta;
- cada espectador consome upload adicional do anfitrião;
- até quatro transmissões podem ser anunciadas por instância da Activity;
- o `instanceId` organiza a sessão, mas não substitui OAuth2 para uma publicação pública em larga escala.

## Estrutura

```text
client/                 React + Vite + Discord Embedded App SDK
  src/lib/socket.ts     Socket.IO direto ou via /.proxy/backend
  src/pages/ActivityPage.tsx
  src/pages/HostPage.tsx
  src/pages/WatchPage.tsx
server/                 Express + Socket.IO + salas em memória
scripts/                registro do Entry Point e utilitários locais
render.yaml             configuração do backend no Render
```
