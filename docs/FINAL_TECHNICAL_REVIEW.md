# Revisão técnica final

## 1. Resumo executivo

O Lume mantém sua arquitetura atual: frontend React/Vite, backend Node/Socket.IO e mídia WebRTC peer-to-peer. Foram aplicadas correções pontuais de validação ICE, cache de credenciais, negociação e limpeza WebRTC, autorização de operações do host, rate limiting, CSP e divulgação de metadados. O lobby da Discord Activity permanece público e está documentado como tal; `instanceId` não é tratado como prova de participação.

Lint, typecheck, build e testes automatizados passaram nesta revisão. A auditoria de dependências ainda reporta advisories sem atualização compatível identificada. Os testes não validam navegador real, Discord, TURN, redes externas nem deploy. Portanto, o projeto pode ser demonstrado como trabalho em desenvolvimento, mas ainda não está validado para produção.

## 2. Problemas encontrados

| Gravidade | Arquivo/área | Problema e evidência | Estado |
|---|---|---|---|
| Alta | Dependências: `@discord/embedded-app-sdk` e sua cópia empacotada de Zod | `npm audit` e `npm audit --omit=dev` reportam advisories altos na cadeia SDK/Zod. As versões estáveis verificadas ainda usam a faixa afetada e não foi identificada correção compatível. | Aberto; não foi aplicado override incompatível. |
| Moderada | `minimatch` no toolchain | `npm audit` reporta advisories moderados transitivos no toolchain. A versão corrigida identificada não é compatível com as faixas atuais. | Aberto; sem `--force` ou override major. |
| Moderada | Discord Activity / `instanceId` | O identificador é fornecido pelo cliente e não prova participação ou identidade. Clientes que conhecem o ID podem observar a lista; um host válido pode anunciar uma sala aberta sob um ID válido. O backend não autentica membership. | Mantido público e documentado; não prometer isolamento. |
| Moderada | Deploy e CSP Vercel | A CSP do Vercel é estática e cobre `*.onrender.com`; domínio próprio de backend ainda não foi definido. Um backend em domínio próprio requer alterar a origem exata antes de publicar. | Decisão de domínio pendente; nenhum domínio foi presumido. |
| Baixa | Recursos em memória | Salas, limites e rate limits são locais ao processo; reinício perde estado e múltiplas instâncias não compartilham controles. | Limitação arquitetural documentada; implantação suportada em uma instância. |
| Baixa | TURN e testes externos | Configuração ou URL TURN não comprova conectividade. Só uma sessão real com rota `relay` observada em `getStats()` demonstra uso de relay. | Validação manual pendente; sem teste em serviço externo. |

Nenhuma vulnerabilidade crítica foi confirmada nesta revisão. A severidade acima descreve riscos e advisories observados, não uma certificação de segurança.

## 3. Correções implementadas

- ICE: validação estrutural das respostas, rejeição de credenciais inconsistentes, identificação de TURN somente quando URLs e credenciais são utilizáveis, fetch externo HTTPS com timeout, cache single-flight e expiração limitada. Consultas a provedores são paralelas para evitar atrasar a retomada do host.
- WebRTC: enfileiramento de ICE candidates até a descrição remota, tratamento/diagnóstico de falhas assíncronas sem expor SDP, ICE candidates ou credenciais, serialização de retomadas e limpeza mais previsível de conexões, listeners, timers e candidatos pendentes.
- Mídia: liberação de capturas parciais e recursos do AudioMixer quando a inicialização falha ou o mixer é encerrado.
- Backend: limites por IP para entrada e retomada, remoção da contagem de salas da resposta de health e CSP de WebSocket restrita ao host da requisição e aos hosts de proxy Discord.
- Activity: preservada a autorização de operações privilegiadas pelo host atual e o máximo de quatro transmissões por instância; a documentação agora esclarece que isso não autentica membership e que a lista é pública.
- Testes: ampliada a cobertura automatizada para validação/cache ICE, limite de transmissões e rate limits.
- Documentação: atualizadas instruções de instalação, arquitetura, deploy, segurança, limitações, publicação e checklist manual.

## 4. Arquivos modificados

- `.env.example` — comentários de configuração e cuidados com segredos e TURN.
- `README.md` — apresentação, funcionamento, stack e instruções.
- `client/src/lib/host.ts` — negociação, retomada, candidatos ICE, erros e limpeza.
- `client/src/lib/media.ts` — liberação e diagnóstico de recursos de áudio.
- `client/src/lib/viewer.ts` — negociação, fila ICE, erros e encerramento.
- `client/src/lib/webrtc.ts` — diagnóstico seguro e helpers de WebRTC.
- `client/src/pages/HostPage.tsx` — limpeza de captura/mixer diante de falhas parciais e mensagens sobre TURN.
- `server/src/config.ts` — validação ICE, timeout, cache, expiração e detecção de TURN.
- `server/src/index.ts` — CSP, rate limits e health sem metadados de contagem.
- `server/test/integration.test.mjs` — cenários de validação, limites e rate limiting.
- `docs/ARCHITECTURE.md` — descrição atualizada de componentes e limites.
- `docs/AUDIT_REPORT.md` — correção dos achados e do modelo da Activity.
- `docs/DEPLOYMENT.md` — coerência das configurações de produção e CSP.
- `docs/KNOWN_LIMITATIONS.md` — limitações de Activity, TURN, memória e validação.
- `docs/PUBLICATION_REVIEW.md` — revisão de publicação atualizada.
- `docs/SECURITY.md` — modelo de segurança, lobby público e dependências.
- `docs/TESTING.md` — comandos e roteiro manual.
- `docs/FINAL_TECHNICAL_REVIEW.md` — este relatório final.

## 5. Validação automatizada

| Comando | Resultado |
|---|---|
| `npm run lint` | Passou. |
| `npm run typecheck` | Passou para servidor e cliente. |
| `npm test` | Passou: 5 testes, 0 falhas. |
| `npm run build` | Passou para cliente e servidor. |
| `git diff --check` | Passou. |
| `npm audit` | Falhou: 12 registros (2 altos e 10 moderados), descritos acima. |
| `npm audit --omit=dev` | Falhou: 2 registros altos na cadeia SDK/Zod. |
| `npm ci` | Não executado: manifests não foram alterados e as dependências já estavam disponíveis. |

Os avisos de falha do provedor de credenciais TURN emitidos durante testes são esperados pelos cenários que verificam tratamento de falha; não representam validação de conectividade TURN.

## 6. Riscos restantes

- O lobby Activity não autentica participação nem associa usuário Discord a uma instância; `instanceId` é uma chave pública de agrupamento.
- Os advisories transitivos de Zod e `minimatch` permanecem. Não foram ocultados com overrides nem resolvidos por atualização incompatível.
- Estado e rate limits em memória não funcionam como controles compartilhados entre processos e são perdidos no reinício.
- Credenciais fixas de TURN, se usadas, são entregues ao navegador; devem ser temporárias/restritas. A disponibilidade de TURN precisa ser comprovada em rede real.
- A CSP Vercel precisa ser ajustada ao hostname exato caso o backend não use Render.
- Captura de tela/áudio e suporte móvel dependem do navegador e sistema operacional.
- Nenhum teste real de navegador, Activity, TURN, rede externa ou deploy foi executado.

## 7. Testes manuais pendentes

Não marcar nenhum cenário abaixo como aprovado até executá-lo e registrar ambiente, evidência e resultado.

1. **Navegadores e permissões:** criar host e viewer; testar cancelar captura, negar permissão, dispositivo sem áudio e combinações de áudio suportadas. Esperado: erro compreensível e nenhuma captura/faixa parcial permanece ativa.
2. **Sala e autorização:** testar sala aberta e protegida, senha incorreta/correta, limite de espectadores e eventos privilegiados enviados por viewer. Esperado: apenas host atual controla estado, encerra ou publica; limites são aplicados.
3. **Reconexão do host:** interromper a rede por menos e mais de 30 segundos. Esperado: retomada dentro da tolerância com token girado e socket antigo revogado; após o prazo, sala encerrada.
4. **Discord Activity:** testar desktop e mobile, URL Mapping `/backend` via `/.proxy/backend`, anúncio/remoção e até quatro hosts; tentar um quinto. Esperado: máximo de quatro anúncios, remoção refletida. Confirmar que a lista não é privada nem prova de membership.
5. **Redes distintas e TURN:** host e viewer em redes diferentes; testar sem TURN e com TURN. Consultar `getStats()`. Esperado: quando relay for necessário e estiver funcional, rota `relay` observável; URL configurada isoladamente não conta como sucesso.
6. **CSP e deploy:** em ambientes de teste, conferir origem permitida e negada, HTTPS/WSS, `FRONTEND_URL`, proxy hops e `/api/health`. Para domínio próprio, permitir somente hostname escolhido. Não testar em produção sem autorização.
7. **Docker e reinício:** iniciar a configuração de teste, validar health/WebSocket/TURN e reiniciar o backend. Esperado: recursos de rede configurados conforme o ambiente e salas em memória perdidas no reinício, conforme documentado.

## 8. Preparação para publicação

| Objetivo | Avaliação |
|---|---|
| Ser exibido no GitHub | Condicionalmente adequado como projeto em desenvolvimento, após o proprietário verificar histórico/artefatos em busca de segredos e decidir a configuração pública do domínio. |
| Integrar um portfólio profissional | Adequado com ressalvas, desde que os advisories, o lobby público e a ausência de validação real sejam apresentados com transparência. |
| Receber contribuições open source | Ainda não. Definir/aprovar uma licença e estabelecer instruções de contribuição e reporte de vulnerabilidades antes de convidar contribuições. |
| Ser utilizado em produção | Ainda não recomendado. Faltam testes reais de browser/Discord/TURN, definição do domínio/CSP e encaminhamento dos advisories transitivos. |

Essas avaliações são distintas; passar lint/build/test não demonstra prontidão operacional ou de segurança em produção.

## 9. Decisões pendentes

- Definir o hostname de produção do backend, necessário para a CSP estática da Vercel caso não seja Render.
- Decidir se o lobby Activity deve continuar público ou se o produto exige autenticação server-side de instância/membership, o que requer integração oficial e credenciais mantidas no backend.
- Aprovar ou não uma licença antes de aceitar contribuições open source.
