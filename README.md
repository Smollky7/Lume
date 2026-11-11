# Lume

**Real-time screen sharing, powered by WebRTC.**

Uma aplicação de compartilhamento de tela em tempo real, desenvolvida para permitir transmissões diretamente pelo navegador, com baixa latência, controle de qualidade e suporte a múltiplos espectadores.

O Lume utiliza **WebRTC para transportar áudio e vídeo entre navegadores** e **Socket.IO para gerenciar salas, participantes e sinalização**. Também conta com integração ao Discord Activities para descoberta de transmissões.

> **Status:** Em desenvolvimento. O projeto possui testes automatizados, mas a transmissão em diferentes redes, o funcionamento no Discord e o uso de TURN ainda dependem de validação prática.

## Funcionalidades

- **Compartilhamento de tela:** transmissão de vídeo e áudio do sistema ou microfone, conforme o suporte do navegador.
- **Salas compartilháveis:** criação de salas com links e proteção opcional por senha.
- **Múltiplos espectadores:** conexões WebRTC independentes, com limite configurável.
- **Qualidade ajustável:** configurações de resolução, FPS, codec e qualidade de reprodução.
- **Reconexão automática:** recuperação de sessões do host dentro de um período de tolerância.
- **Discord Activities:** descoberta de até quatro transmissões por instância, utilizando uma lista pública e temporária.
- **Controles de reprodução:** opções de visualização e tela cheia.

## Tecnologias

| Camada | Tecnologias |
|---|---|
| Frontend | React, TypeScript, Vite |
| Backend | Node.js, Express |
| Comunicação em tempo real | Socket.IO |
| Transmissão de mídia | WebRTC |
| Integração | Discord Embedded App SDK |
| Infraestrutura | Docker, Vercel, Render |

## Como funciona

O Lume separa a sinalização do transporte de mídia.

1. O host cria uma sala por meio do backend.
2. O servidor registra a sala e disponibiliza um identificador compartilhável.
3. Os espectadores entram utilizando o link e, quando necessário, a senha.
4. O Socket.IO coordena a troca de ofertas SDP e candidatos ICE.
5. O WebRTC estabelece as conexões para transmitir áudio e vídeo.
6. Quando necessário e configurado, um servidor TURN pode retransmitir o tráfego de mídia.

O backend **não recebe nem armazena o conteúdo de áudio ou vídeo**. A mídia utiliza conexões WebRTC entre os participantes, diretamente ou por um relay TURN.

Cada espectador possui sua própria conexão WebRTC com o host. Por isso, o consumo de upload do transmissor aumenta conforme o número de espectadores.

Mais detalhes em [Arquitetura](docs/ARCHITECTURE.md).

## Prévia da interface

Capturas reais da aplicação serão adicionadas futuramente.

## Executando localmente

### Pré-requisitos

- Node.js `20.19+` ou `22.12+`, conforme a faixa de versões suportada pelo projeto.
- npm.
- Navegador compatível com WebRTC e `getDisplayMedia`.

Clone o repositório:

```bash
git clone https://github.com/Smollky7/Lume.git
cd Lume
```

Instale as dependências:

```bash
npm ci
```

Crie o arquivo de configuração local:

```bash
cp .env.example .env
```

Configure as variáveis necessárias conforme o arquivo `.env.example`.

Inicie o ambiente de desenvolvimento:

```bash
npm run dev
```

Serviços locais:

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:3000`

A captura de tela exige um contexto seguro (HTTPS), com exceções para ambientes locais como `localhost`.

## Qualidade de código

O projeto possui verificações automatizadas de lint, tipos, testes e build.

```bash
npm run lint
npm run typecheck
npm test
npm run build
```

Os testes automatizados abrangem regras de salas, sinalização, autorização de operações, limites de recursos e tratamento de configurações ICE.

Consulte [Testes](docs/TESTING.md) para conhecer os cenários cobertos e os testes manuais ainda necessários.

## Integração com Discord

O Lume possui integração com Discord Activities, permitindo visualizar uma lista temporária de transmissões associadas a uma instância.

A Activity funciona como ponto de descoberta. A captura e a reprodução são abertas no navegador externo devido às limitações do ambiente de proxy do Discord para o fluxo WebRTC utilizado pelo projeto.

A lista de transmissões é pública para quem conhece o identificador da instância. O `instanceId` não constitui autenticação nem comprovação de participação em uma chamada.

A configuração requer uma aplicação no Discord Developer Portal e URL Mappings para frontend e backend.

Consulte [Deploy](docs/DEPLOYMENT.md) e [Segurança](docs/SECURITY.md).

## Infraestrutura e deploy

A arquitetura atual utiliza armazenamento em memória para gerenciar salas, sessões e limites de requisições.

O projeto contempla configurações para:

- **Vercel:** frontend.
- **Render:** backend.
- **Docker Compose:** execução em infraestrutura própria.

A implantação atual é voltada a uma única instância do backend. Escalabilidade horizontal exigiria estado compartilhado e adaptação da comunicação Socket.IO.

Instruções em [Deploy](docs/DEPLOYMENT.md).

## Segurança e limitações

O projeto incorpora validações de entrada, controles de acesso às operações de host, limites de requisições e gerenciamento de sessões.

Algumas limitações permanecem:

- A lista da Discord Activity não autentica os participantes.
- O funcionamento de áudio e captura varia conforme navegador e sistema operacional.
- A conectividade entre redes restritivas pode exigir TURN.
- O estado das salas é mantido em memória.
- Existem advisories conhecidos em dependências transitivas, documentados na revisão técnica.

Informações adicionais:

- [Segurança](docs/SECURITY.md)
- [Limitações conhecidas](docs/KNOWN_LIMITATIONS.md)
- [Revisão técnica](docs/FINAL_TECHNICAL_REVIEW.md)

## Roadmap

- [x] Compartilhamento de tela baseado em WebRTC
- [x] Gerenciamento de salas com Socket.IO
- [x] Proteção opcional por senha
- [x] Suporte a múltiplos espectadores
- [x] Configurações de qualidade
- [x] Integração de descoberta com Discord Activities
- [x] Testes automatizados de backend
- [ ] Validar transmissão entre diferentes redes e dispositivos
- [ ] Validar conectividade TURN em ambiente real
- [ ] Validar fluxos completos da Discord Activity
- [ ] Adicionar capturas de tela e demonstração pública
- [ ] Evoluir a observabilidade e a experiência de reconexão

## Autor

Desenvolvido por **Jardel Sousa**.

- [GitHub](https://github.com/Smollky7)
- [Portfólio](https://www.jardelsousadev.com.br)

---

**Lume** é um projeto em evolução, desenvolvido para explorar comunicação em tempo real, arquitetura WebRTC e experiências de compartilhamento de tela na web.

*O repositório ainda não possui uma licença open source definida.*
