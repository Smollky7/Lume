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