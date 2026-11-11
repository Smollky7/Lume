# Lume

Compartilhamento de tela pelo navegador, com transporte de mídia WebRTC peer-to-peer e sinalização Socket.IO. O Lume também oferece uma lista de transmissões para Discord Activities; a captura e o player abrem no navegador externo porque o proxy de Activities não transporta WebRTC.

## Funcionalidades

- Criação de salas com link e senha opcional.
- Transmissão de vídeo e áudio do sistema/microfone quando o navegador oferece suporte.
- Vários espectadores por transmissão, com limite configurável.
- Reconexão do host por token de uso restrito e encerramento automático após período de tolerância.
- Ajustes de resolução, FPS, codec, qualidade do espectador e tela cheia.
- Lista efêmera pública de até quatro transmissões por chave de Activity; o ID não comprova participação na chamada.

## Capturas de tela

Capturas reais da interface serão adicionadas após validação em navegador e Discord. Nenhuma imagem de demonstração está incluída neste repositório.

## Stack

- Cliente: React, TypeScript e Vite.
- Sinalização: Node.js, Express e Socket.IO.
- Mídia: WebRTC no navegador; o servidor não recebe nem armazena áudio ou vídeo.
- Integração: Discord Embedded App SDK e comando Primary Entry Point.

## Requisitos

- Node.js `20.19+` ou `22.12+`.
- Navegador com `getDisplayMedia` para transmitir; a captura exige HTTPS, exceto em `localhost`.
- Para publicar uma Discord Activity: aplicação configurada no Discord Developer Portal, frontend HTTPS e backend Socket.IO acessível.
- TURN é recomendado para redes com NAT/CGNAT restritivo.

## Desenvolvimento

```sh
npm ci
cp .env.example .env
npm run dev
```

O cliente abre em `http://localhost:5173` e o backend em `http://localhost:3000`. Os comandos de qualidade são:

```sh
npm run lint
npm run typecheck
npm test
npm run build
```

O build de produção fica em `client/dist` e `server/dist`; use `npm start` para iniciar o backend compilado. Configure opções de ICE/STUN/TURN no ambiente do servidor, nunca em variáveis `VITE_*`. Veja [.env.example](.env.example) e [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

Consulte [docs/TESTING.md](docs/TESTING.md) para os testes automatizados e o roteiro manual.

## Arquitetura e deploy

O servidor mantém salas e a lista da Activity em memória. Uma sala usa um host e até `MAX_VIEWERS` espectadores; cada espectador recebe uma conexão P2P independente. O backend apenas valida e retransmite sinalização. Escalar horizontalmente exige estado compartilhado e um adapter Socket.IO.

As instruções de produção ficam em [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md); o desenho dos fluxos está em [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Configure o frontend pela Vercel e o backend pelo Render ou use Docker Compose em uma máquina própria.

## Discord Activity

Configure URL Mappings no Developer Portal: `/backend` aponta ao host do backend e `/` ao frontend. O código chama o proxy usando `/.proxy/backend`; configure o mapping `backend` antes do mapping `/`. Configure `VITE_DISCORD_CLIENT_ID`, `VITE_PUBLIC_URL`, `VITE_BACKEND_URL` no build do frontend, e `FRONTEND_URL` no backend.

O `instanceId` organiza a lista da Activity, mas não autentica uma pessoa nem prova que ela participa daquela chamada. As salas anunciadas sem senha são acessíveis a quem obtiver o ID/link. Veja as implicações em [docs/SECURITY.md](docs/SECURITY.md).

## Segurança e limitações

Não versione `.env`, chaves TURN, tokens do Discord ou segredos. Variáveis `VITE_` são públicas no bundle. Limites e orientações de publicação estão em [docs/SECURITY.md](docs/SECURITY.md); restrições reais de navegador, Discord, NAT e escala estão em [docs/KNOWN_LIMITATIONS.md](docs/KNOWN_LIMITATIONS.md).

Este repositório não inclui uma demonstração pública permanente. Nenhum teste local equivale a uma validação real do Discord, de TURN ou de um deploy público.

O projeto está em desenvolvimento. A publicação do código, uma licença open source, contribuições externas e uso em produção são decisões distintas; este repositório não inclui uma licença.