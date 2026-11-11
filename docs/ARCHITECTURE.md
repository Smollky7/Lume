# Arquitetura

## Componentes

- `client/`: aplicação React/Vite com as telas de host, espectador e Activity.
- `server/`: Express para health/lookup de sala e Socket.IO para criação, entrada, reconexão e sinalização.
- `scripts/`: manutenção local do Primary Entry Point do Discord.
- `deploy/`: Docker Compose, Caddy e coturn para instalação própria.

## Transmissão

1. O host pede captura ao navegador por `getDisplayMedia`; vídeo e faixas de áudio disponíveis são misturados localmente.
2. `room:create` cria um ID aleatório de 128 bits, um token de host e, opcionalmente, um hash/salt de senha.
3. Cada espectador autorizado recebe configuração ICE e entra na sala. O host cria um `RTCPeerConnection` independente para cada espectador.
4. Ofertas, respostas e candidatos ICE passam pelo Socket.IO após validação. Cada peer serializa as operações SDP; candidatos recebidos antes da descrição remota ficam enfileirados até a negociação estar pronta.
5. Áudio/vídeo seguem diretamente entre navegadores ou por TURN. As credenciais dinâmicas são validadas e respeitam o período de validade conhecido antes de serem reutilizadas.
6. Ao encerrar, o servidor remove a sala e atualiza os clientes. Na perda do host, há 30 segundos para retomar usando o token.

O upload do host cresce com o número de espectadores. Não há SFU, gravação nem armazenamento de mídia.

## Salas e identidade

O estado é volátil: `rooms` e `activityStreams` são mapas em memória. Cada socket pode estar associado a uma única sala. O host atual é identificado pelo socket autorizado; `room:resume` substitui a sessão anterior e rotaciona o token. Senhas são derivadas por `scrypt` assíncrono e comparadas em tempo constante.

O servidor valida direção e forma de mensagens SDP/ICE antes do relay. IDs de Activity são apenas chaves de roteamento fornecidas pelo cliente, nunca prova de identidade Discord.

## Discord Activity

A tela Activity usa o Embedded App SDK para obter `instanceId`, lista transmissões sem senha e abre o host/player no navegador externo. A Activity não transporta mídia WebRTC. O anúncio vincula a sala ao socket host atual, mas não atesta no backend que quem consulta a chave participa da chamada. O modelo e as ressalvas estão em [SECURITY.md](SECURITY.md).

## Escala

Uma única instância de backend é suportada. Reinícios encerram as salas. Para múltiplas réplicas, será necessário adapter Socket.IO (por exemplo, Redis), estado compartilhado com expiração, afinidade/configuração de transporte, limites distribuídos e testes de concorrência. O deploy atual não habilita essa arquitetura.