# Lume Activity — transmissão automática (MVP)

1. GitHub: envie esta versão ao mesmo repositório utilizado por Vercel e Render.
2. Render: Build Command `npm ci --include=dev && npm run build`; Start Command `npm run start`. Configure `FRONTEND_URL=https://lume-jade-two.vercel.app` e `NODE_ENV=production`.
3. Vercel: Root Directory `client`, framework Vite. Environment: `VITE_DISCORD_CLIENT_ID` (seu Application ID), `VITE_PUBLIC_URL=https://lume-jade-two.vercel.app` e `VITE_BACKEND_URL=https://lume-api-059u.onrender.com`. Faça Redeploy.
4. Discord Developer Portal: Activity habilitada, URL mapping `/` para `lume-jade-two.vercel.app`, e `/backend` para `lume-api-059u.onrender.com` se necessário.
5. Entre na call, abra Lume Activity, clique Transmitir tela. Uma janela externa do navegador abre automaticamente vinculada à Activity. Selecione captura, clique iniciar; aparece automaticamente na Activity.

## Limites conhecidos
- MVP de descoberta automática, não integração nativa de captura dentro do Discord.
- A comunicação Socket.IO da Activity ainda pode ser bloqueada pelo proxy/CSP do Discord: nesse caso precisará de URL mapping e proxy Socket.IO específico, não apenas do domínio público. Inspecione Console para diagnosticar.
- Identificador de Activity passado à URL não é autenticação; não indicado para salas públicas ou não confiáveis. Necessária autenticação OAuth Discord no servidor para produção.
- Cada transmissão existe enquanto o anfitrião mantém sua janela aberta. Render Free pode hibernar; STUN sem TURN não garante conexão sob CGNAT.
- Iframes de espectadores podem ter limitações de WebRTC ou permissões dentro da Activity; validação real necessária.
