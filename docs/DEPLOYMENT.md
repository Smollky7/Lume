# Deploy

## Variáveis

Copie `.env.example` para `.env` no desenvolvimento. Em produção, use somente o cofre de variáveis do provedor.

Backend: `NODE_ENV=production`, `FRONTEND_URL`, `TRUST_PROXY_HOPS`, limites de recurso e uma opção TURN. Para TURN, use credenciais temporárias por API, Cloudflare Realtime ou coturn com segredo compartilhado; nunca exponha o segredo no frontend.

Frontend: `VITE_DISCORD_CLIENT_ID`, `VITE_PUBLIC_URL` e `VITE_BACKEND_URL`. Esses valores são públicos. O backend usa CORS e a CSP do Vercel depende do host Render configurado neste projeto; ajuste `client/vercel.json` para outro provedor/domínio.

## Render + Vercel

1. Crie um Web Service Render na raiz do repositório. Use Build Command `npm ci --include=dev && npm run build -w server`, Start Command `npm run start -w server` e health check `/api/health`.
2. Configure `FRONTEND_URL` e `TRUST_PROXY_HOPS=1` no Render. O manifesto `render.yaml` já traz esses valores, mas deixa origens e ICE API como configuração manual.
3. Crie o projeto Vercel com Root Directory `client`, Build Command `npm run build` e Output Directory `dist`.
4. Configure as variáveis públicas `VITE_DISCORD_CLIENT_ID`, `VITE_PUBLIC_URL` e `VITE_BACKEND_URL`, depois faça build/deploy no provedor.
5. No Developer Portal, habilite Activities e configure `/backend` antes de `/`: `/backend` aponta ao host do backend; `/` ao host do frontend. Não inclua protocolo nos Targets.
6. Configure TURN e teste uma conexão real em outra rede. STUN sozinho não atravessa todas as redes.

Use domínios públicos próprios do seu projeto. Este repositório não registra os endpoints de uma implantação específica.

## Docker Compose / servidor próprio

É necessário um domínio, Docker Compose, DNS e portas liberadas para HTTPS e relay TURN. O arquivo `deploy/docker-compose.yml` executa app, Caddy e coturn, define a origem frontend/backend no mesmo host e confia em um proxy. Crie um arquivo local `deploy/.env` com `DOMAIN`, `TURN_DOMAIN` e `TURN_SECRET`; esse arquivo não deve ser versionado.

```sh
docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
```

Revise os IPs privados bloqueados pelo coturn conforme a rede da sua infraestrutura. Não exponha painel/CLI do TURN. Fixe versões de imagens conforme a política operacional antes de produção.

## Operação

- Use uma única instância. Não habilite autoscaling horizontal sem adapter/estado compartilhado.
- Configure limites de CPU/memória e monitore conexões, salas, tráfego e erros Socket.IO.
- O health check não testa TURN, Discord, captura de tela ou conectividade WebRTC.
- Faça rotação de chaves TURN e tokens administrativos fora do Git.
- Deploy não foi executado como parte desta auditoria.