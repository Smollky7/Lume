# Segurança

## Modelo atual

- Uma sala é um convite bearer: quem tem o ID aleatório pode consultar/entrar; senha é opcional.
- O token de host tem 192 bits, fica na memória do cliente host e é exigido para retomada. A retomada revoga a sessão antiga e gira o token.
- IDs de sala têm 128 bits. Isso reduz enumeração, mas não substitui autenticação nem autorização por usuário.
- WebRTC cifra o transporte entre peers conforme o protocolo do navegador. O servidor de sinalização não recebe a mídia.

## Discord e Activity

`instanceId` não é autenticação. O cliente pode enviar qualquer valor que passe pela validação de formato, e qualquer cliente que conheça esse valor pode assinar a lista daquela chave. Um host de qualquer sala aberta também pode anunciar sua sala sob qualquer `instanceId` válido: o backend verifica a propriedade da sala, mas não a participação do host naquela Activity. Portanto, a lista não é isolada por chamada e pode receber anúncios não solicitados. Uma Activity transmite somente salas sem senha; possuir o ID da sala continua permitindo a entrada, conforme o modelo de convite.

As fontes oficiais documentam mecanismos server-side: `GET /api/applications/{application_id}/activity-instances/{instance_id}` exige o Bot token da aplicação e devolve, entre outros dados, os IDs dos usuários ativos; o proxy também pode assinar requests com `X-Signature-Ed25519`, `X-Signature-Timestamp` e `X-Discord-Proxy-Payload`. O SDK documenta `authorize()`/`authenticate()` e uma lista de participantes no cliente, mas autenticação de identidade, assinatura de request e associação da identidade ao `instanceId` são verificações distintas. Este backend não chama o endpoint de instâncias, não valida assinaturas do proxy e não implementa troca OAuth2 nem associação de um usuário autenticado à lista retornada pelo Discord. Não aceite uma lista de participantes fornecida pelo navegador como prova.

Até que essa integração server-side seja configurada e validada, mantenha o lobby explicitamente público. Para torná-lo privado, implemente a validação do request e do vínculo identidade/instância conforme os fluxos oficiais, mantenha credenciais somente no backend e teste tentativas externas e de outro usuário.

Fontes oficiais consultadas em 2026-11-11: [referência do Embedded App SDK](https://docs.discord.com/developers/developer-tools/embedded-app-sdk); [guia de construção de Activities](https://docs.discord.com/developers/activities/building-an-activity); [guia de multiplayer, validação de instância e proxy](https://docs.discord.com/developers/activities/development-guides/multiplayer-experience.md); [guia de URL Mappings e proxy](https://docs.discord.com/developers/activities/development-guides/local-development.md#url-mapping). Nenhum fluxo de autenticação/membership foi implementado ou testado neste projeto.

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
- `TURN_USERNAME`/`TURN_CREDENTIAL` são enviados ao navegador junto com as configurações ICE. Use somente credenciais de relay limitadas e temporárias; prefira credenciais temporárias por Cloudflare, coturn com segredo ou API de provedor. Nunca envie a chave de API/segredo do provedor ao frontend.
- Configure `FRONTEND_URL` com todas as origens reais. CORS e handshake Socket.IO validam essas origens. `client/vercel.json` é estático e libera `*.onrender.com`; para backend em domínio próprio, substitua esse padrão pelo hostname exato antes do build/publicação. Não acrescente curingas genéricos.
- A CSP emitida pelo backend limita WebSocket ao host da requisição e aos hosts de proxy `discordsays.com`; ela não é uma prova de conectividade. A CSP Vercel precisa permitir o backend real de forma explícita.
- `TRUST_PROXY_HOPS=1` só é correto quando há exatamente um proxy confiável. Não aumente sem conferir a topologia e como ela sobrescreve/acrescenta `X-Forwarded-For`.
- A auditoria encontrou advisory alto sem correção disponível para a cópia de Zod empacotada pelo `@discord/embedded-app-sdk`. Atualize o SDK quando houver versão corrigida; não force um override de major sem compatibilidade validada.
- A existência de URL TURN/credenciais configura uma tentativa de relay, não prova conectividade. Verifique a rota selecionada em `getStats()` e teste em redes reais.

## Antes de tornar público

1. Remova credenciais e dados pessoais de todo o histórico e de artefatos, não apenas da revisão atual.
2. Configure origens, proxy, TURN e limites no ambiente de deploy.
3. Atualize/audite dependências e revise cada advisory upstream.
4. Faça teste real no Discord e em redes com NAT, incluindo tentativa de acessar a lista Activity de fora da chamada.
5. Defina política de reporte de vulnerabilidades e contato de segurança.

Este documento descreve os controles observados, não representa certificação ou garantia contra ataques de disponibilidade.