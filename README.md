# Lume — transmissão de tela pelo navegador

Compartilhe sua tela (com áudio) com amigos por um link, usando WebRTC. Sem Discord, sem instalar nada para quem assiste.

> **Status:** o código foi escrito de ponta a ponta, mas **ainda não foi compilado nem testado com dois computadores**. Rode `npm run typecheck` e siga o roteiro de teste abaixo; se algo falhar, me mande a mensagem de erro que eu corrijo.

## Arquitetura (e por quê)

- **Mídia:** WebRTC *peer-to-peer*, do anfitrião para cada espectador. Vídeo + áudio vão no mesmo `MediaStream`, o que mantém tudo sincronizado. Latência típica de 100–300 ms, sem servidor de mídia no meio.
- **Sinalização:** Node + Socket.IO (WebSocket). Só troca SDP/ICE, cria salas, valida senha e conta espectadores.
- **Áudio:** sistema + microfone são misturados no navegador (Web Audio) em uma única faixa Opus estéreo. Ligar/desligar o microfone não renegocia a conexão.
- **Adaptação de bitrate:** o controle de congestionamento do WebRTC reduz qualidade sozinho quando há perda; o app define apenas o teto de bitrate/FPS e a prioridade (fluidez × nitidez). O espectador pode pedir 720p/480p/360p; o anfitrião reduz só aquele fluxo.
- **Reconexão:** socket reconecta sozinho; falha de ICE → reinício de ICE; se não recuperar, o espectador pede nova oferta. O anfitrião tem 30 s de tolerância se cair.
- **Por que P2P e não SFU agora:** com poucos amigos (até ~4–6) é o caminho mais simples, de menor latência e sem compilar módulos nativos no Windows (mediasoup exige toolchain C++). **Limite real:** o seu *upload* é multiplicado pelo número de espectadores (1080p60 ≈ 8 Mbps × N). Para salas maiores, o próximo passo é um SFU (LiveKit) — a sinalização e a UI se reaproveitam.

## Rodar no Windows 11

Pré-requisito: nenhum — `setup.bat` instala o Node.js LTS via `winget` se faltar.

1. Duplo clique em **`setup.bat`** (instala dependências e compila).
2. Duplo clique em **`start.bat`** → abra <http://localhost:3000>.
3. Para amigos de fora da sua rede, em outra janela: **`tunnel.bat`** (Cloudflare Tunnel, HTTPS grátis, sem abrir portas). Ele imprime `https://algo.trycloudflare.com`. **Abra esse endereço no seu próprio navegador** para transmitir; os convites já saem com ele.

Desenvolvimento: `npm run dev` (frontend em :5173 com proxy para o servidor em :3000).

## Testar com dois computadores em redes diferentes

1. PC A: `start.bat` + `tunnel.bat`. Abra a URL `https://…trycloudflare.com` no PC A.
2. Clique em **Escolher tela**, selecione **Tela inteira** (ou uma aba) e marque **Compartilhar áudio**. Confira a prévia.
3. Clique em **Iniciar transmissão** e copie o link.
4. PC B (outra rede, ex.: 4G do celular) abre o link, escolhe um apelido e clica **Entrar e assistir**.
5. Confira no painel do anfitrião, para cada espectador: **direto** ou **via TURN**, ping, Mbps, fps, codec e **GPU/CPU** (indica se a codificação é por hardware). No player do espectador, o indicador mostra latência estimada, perda e bitrate.
6. Teste: pausar/retomar, trocar qualidade no espectador, desligar o Wi‑Fi do espectador por alguns segundos (deve reconectar), encerrar a sala (espectador vê aviso).

## NAT, TURN e hospedagem — o que é verdade

- **HTTPS + sinalização:** o Cloudflare Tunnel resolve (HTTPS e WebSocket). Mas ele **não transporta a mídia WebRTC (UDP)**.
- **Mídia:** conecta direto via STUN quando os NATs permitem. **Muitas operadoras brasileiras usam CGNAT**, e nesses casos a conexão direta costuma falhar — aí é **obrigatório um servidor TURN**, e o vídeo passa pelo relay (consome a banda do TURN).
- **Sintoma de falta de TURN:** a página abre, a sala é criada, mas o espectador fica em "Estabelecendo a conexão de vídeo…" e depois vê "Sem rota de vídeo". O painel do anfitrião também avisa.
- **TURN gratuito (valores consultados em out/2026 — confira se mudaram):**
  - **Cloudflare Realtime TURN:** 1.000 GB/mês grátis (compartilhado com o SFU), depois US$ 0,05/GB. Crie uma *TURN key* no painel da Cloudflare e coloque no `.env`:
    ```
    CF_TURN_KEY_ID=...
    CF_TURN_API_TOKEN=...
    ```
  - **Metered:** plano grátis de 20 GB/mês, com cadastro. No `.env`: `ICE_API_URL=https://SEUAPP.metered.live/api/v1/turn/credentials?apiKey=SUA_CHAVE`
  - **Credenciais fixas de qualquer provedor:**
    ```
    TURN_URLS=turn:HOST:3478?transport=udp,turns:HOST:5349?transport=tcp
    TURN_USERNAME=...
    TURN_CREDENTIAL=...
    ```
  Depois de editar o `.env`, pare o servidor (`Ctrl+C`) e rode `npm start` de novo. Ele imprime no início se o TURN foi detectado.
- **TURN próprio:** coturn não roda nativamente no Windows; use um VPS Linux (ver abaixo) com `TURN_SECRET` (credenciais temporárias).
- **Hospedagens gratuitas (Render, Vercel, etc.):** servem a sinalização, mas não oferecem UDP/TURN. Não resolvem a mídia sozinhas.

## Implantação em servidor próprio

`deploy/docker-compose.yml` sobe app + Caddy (HTTPS automático) + coturn. Instruções no cabeçalho do arquivo. Portas: 80, 443, 3478 (udp/tcp) e 49152–49252/udp.

## Limitações reais dos navegadores

- **Áudio do sistema:** Chrome/Edge no Windows capturam áudio de **Tela inteira** e **Abas**, não de janelas individuais. Firefox e Safari geralmente não entregam áudio do sistema. O app avisa quando o áudio não vem.
- **DRM (Netflix, Prime, etc.):** conteúdo protegido aparece **preto** na captura. Isso é uma proteção do navegador/sistema e **o Lume não tenta contorná-la**.
- **1440p/4K:** dependem da resolução da sua tela, da CPU/GPU e do upload. O navegador pode entregar menos do que o pedido; os números reais aparecem no painel.
- **Celular como anfitrião:** a maioria dos navegadores móveis não permite compartilhar tela. Como espectador, funciona.
- **Latência < 500 ms:** esperado com conexão direta; via TURN distante ou rede ruim pode passar disso.

## Segurança e privacidade

- A captura só começa após o seletor nativo do navegador; a transmissão só inicia ao clicar em **Iniciar transmissão**.
- IDs de sala têm 72 bits aleatórios; senha opcional com `scrypt`; limite de tentativas por IP; só o anfitrião (com token secreto) pode sinalizar ofertas, pausar ou encerrar.
- Nenhuma gravação é feita — o servidor nunca recebe áudio/vídeo.
- Cabeçalhos de segurança (CSP, `X-Frame-Options`, etc.) ativos. Atrás de proxy, mantenha `TRUST_PROXY=true`.
- Qualquer pessoa com o link (e a senha, se houver) assiste — compartilhe com cuidado e feche janelas sensíveis antes de transmitir.

## Estrutura

```
lume/
├─ server/src/      index.ts (HTTP + Socket.IO), rooms.ts, config.ts (ICE/TURN, .env)
├─ client/src/
│  ├─ lib/          host.ts (envio), viewer.ts (recepção), media.ts (captura/áudio), webrtc.ts, socket.ts
│  ├─ pages/        HostPage.tsx (estúdio), WatchPage.tsx (player)
│  └─ components/   Icons.tsx, Toasts.tsx
├─ scripts/ + *.bat setup / start / tunnel para Windows
├─ deploy/          docker-compose, Caddyfile
└─ Dockerfile
```
