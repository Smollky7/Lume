# Segurança

## Modelo atual

- Uma sala é um convite bearer: quem tem o ID aleatório pode consultar/entrar; senha é opcional.
- O token de host tem 192 bits, fica na memória do cliente host e é exigido para retomada. A retomada revoga a sessão antiga e gira o token.
- IDs de sala têm 128 bits. Isso reduz enumeração, mas não substitui autenticação nem autorização por usuário.
- WebRTC cifra o transporte entre peers conforme o protocolo do navegador. O servidor de sinalização não recebe a mídia.

## Discord e Activity

`instanceId` não é autenticação. O cliente pode enviar qualquer valor que passe pela validação de formato, e qualquer cliente que conheça esse valor pode assinar a lista daquela chave. Um host de qualquer sala aberta também pode anunciar sua sala sob qualquer `instanceId` válido: o backend verifica a propriedade da sala, mas não a participação do host naquela Activity. Portanto, a lista não é isolada por chamada e pode receber anúncios não solicitados. Uma Activity transmite somente salas sem senha; possuir o ID da sala continua permitindo a entrada, conforme o modelo de convite.

O Embedded App SDK oferece comandos de autorização/autenticação para obter identidade Discord e comandos de participantes da instância. Este backend não implementa troca OAuth2 nem valida membership Discord por uma prova verificável no servidor. Um access token que identifica uma conta, por si só, também não prova participação em uma instância específica. Antes de usar o lobby para conteúdo privado ou impor publicação somente a participantes, implemente uma autorização server-side baseada em credenciais verificáveis e valide o vínculo entre conta, instância e permissão; não aceite uma lista de participantes fornecida pelo navegador como prova. O fluxo oficial documentado pelo SDK retorna um authorization code para troca no servidor e depois autentica o cliente; esse fluxo não foi implementado nem testado neste projeto.

## Controles implementados

- CORS e handshake Socket.IO aceitam origens configuradas, origens Discord Activities e origens locais somente fora de produção.
- `TRUST_PROXY_HOPS` define uma quantidade numérica da cadeia confiável; o servidor não confia em `CF-Connecting-IP` fornecido diretamente pelo cliente.
- Rate limits por IP para criação, lookup, tentativas de senha e eventos Activity; tabelas e recursos têm limites máximos.
- Limite de conexões, salas, espectadores, instâncias Activity, senhas, payloads SDP e candidatos ICE.
- Socket host precisa corresponder ao host atual para sinalizar, pausar, publicar ou encerrar.
- Headers CSP, Permissions-Policy, Referrer-Policy e nosniff no servidor e no deploy Vercel.
- Hash de senha assíncrono com salt aleatório e comparação timing-safe.

Os rate limits e contadores são locais à instância e podem ser contornados por múltiplos processos. Não são proteção DDoS nem substituem limites no provedor de borda.

## Segredos e dependências

- Nunca versionar `.env`, tokens de bot, client secret, chave TURN ou credenciais de API TURN.
- `VITE_*` é conteúdo público incluído no bundle; nunca coloque segredos nessas variáveis.
- Configure `FRONTEND_URL` com todas as origens reais. Se o backend TURN for diferente de Render, ajuste também `connect-src` da CSP em `client/vercel.json`.
- `TRUST_PROXY_HOPS=1` só é correto quando há exatamente um proxy confiável. Não aumente sem conferir a topologia e como ela sobrescreve/acrescenta `X-Forwarded-For`.
- A auditoria encontrou advisory alto sem correção disponível para a cópia de Zod empacotada pelo `@discord/embedded-app-sdk`. Atualize o SDK quando houver versão corrigida; não force um override de major sem compatibilidade validada.

## Antes de tornar público

1. Remova credenciais e dados pessoais de todo o histórico e de artefatos, não apenas da revisão atual.
2. Configure origens, proxy, TURN e limites no ambiente de deploy.
3. Atualize/audite dependências e revise cada advisory upstream.
4. Faça teste real no Discord e em redes com NAT, incluindo tentativa de acessar a lista Activity de fora da chamada.
5. Defina política de reporte de vulnerabilidades e contato de segurança.

Este documento descreve os controles observados, não representa certificação ou garantia contra ataques de disponibilidade.