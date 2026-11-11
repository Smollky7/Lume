# Testes

## Automação local

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run build
```

Os testes Node cobrem formato do comando Discord, IP encaminhado por quantidade de proxies, publicação/remoção da Activity, entrada com e sem senha, limite de uma sala por socket, validação do relay e retomada do host. Eles usam Socket.IO local e não simulam browsers nem os serviços externos.

## Roteiro manual

1. Criar sala sem senha, abrir o link em outro perfil/dispositivo e assistir.
2. Criar sala protegida; verificar senha errada e correta.
3. Testar vários espectadores até o limite e conferir rejeição adicional.
4. Confirmar compartilhamento de áudio do sistema em combinações suportadas pelo navegador e microfone, se habilitado.
5. Alterar qualidade, pausar/retomar, parar pelo navegador e encerrar pelo host.
6. Desconectar/reconectar o host antes e depois do período de tolerância; confirmar token rotacionado e remoção da sessão antiga.
7. Testar redes distintas com TURN, observando rota relay e áudio/vídeo.
8. Testar Activity desktop e mobile, abertura externa de host/player, anúncio e remoção da transmissão.
9. Testar origens permitidas e não permitidas no domínio de produção, bem como CSP e WebSocket.

## Limites da validação

Passar nos testes/build não prova suporte no Discord, browser móvel, TURN, deploy Vercel/Render ou NAT de operadoras. Registre ambiente, navegador, plataforma e resultado ao executar o roteiro manual.

## Plano reproduzível de publicação

Registre data, navegador/versão, sistemas, redes, região do provedor, configuração ICE e resultado. Não use dados ou salas reais sem consentimento.

| Cenário | Execução | Resultado esperado e evidência |
| --- | --- | --- |
| Activity real | Abrir a Activity em uma chamada Discord com duas contas; iniciar e encerrar uma transmissão em cada conta; acompanhar a lista e abrir o host/player externo. | SDK fica pronto, Socket.IO conecta e a lista atualiza. Registre se anúncios de outra conta aparecem; isso não comprova privacidade nem membership. |
| Dois usuários em redes diferentes | Abrir host e espectador em dispositivos/redes distintas, preferencialmente Wi-Fi e rede móvel; entrar na mesma sala e manter vídeo/áudio por 5 minutos. | Reprodução estável; anote navegador, provedor, perda, RTT e bitrate. |
| TURN | Configurar TURN no backend, repetir entre redes distintas e confirmar em `getStats()` que a rota é `relay`; repetir sem TURN como comparação. | Sessão funcional via relay e evidência da rota. Não compartilhe credenciais nos logs. |
| Múltiplos transmissores | Na mesma Activity real, iniciar até quatro hosts; tentar um quinto; encerrar cada um. | Até quatro anúncios ativos, quinto rejeitado e remoções refletidas. O limite é por chave `instanceId`, não uma fronteira de autorização. |
| Reconexão | Desconectar a rede do host por menos de 30 s, restaurar e observar retomada; repetir com mais de 30 s. | Dentro da tolerância, host retoma com token girado e socket antigo revogado; após o prazo, a sala termina. |
| Encerramento inesperado | Encerrar abruptamente o navegador do host, observar período de tolerância e depois repetir encerrando o processo/container backend. | Host encerrado fecha a sala após a tolerância; queda do backend desconecta todos e perde estado em memória. Registre recuperação e mensagens apresentadas. |
| Acesso às salas | Testar ID aleatório, sala protegida com senha errada/certa, limite de espectadores, socket espectador enviando `room:state`, `room:end`, `activity:publish` e `room:create`, e retomada com token antigo/novo. | Sem ID/senha/token válido, operações negadas; espectador não assume ações do host. Um host pode publicar sob qualquer `instanceId` válido, risco conhecido do lobby público. |
| Deploy Render/Vercel | Implantar em ambientes de teste; conferir `FRONTEND_URL`, proxy hops, CSP, WebSocket, saúde `/api/health`, configurações Discord e build de frontend. | Origem legítima conecta, origem não configurada falha; registre IDs de build e logs sem segredos. Não validar em produção sem autorização. |
| Deploy Docker Compose | Usar domínio de teste e segredos temporários; subir app/Caddy/coturn, testar HTTPS, health, WebSocket, rota relay e reinício do container. | Serviços iniciam, TURN funciona e sala em memória termina após reinício; remover segredos de teste ao concluir. |