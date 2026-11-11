# Relatório de Auditoria Técnica

Data: 2026-11-11  
Escopo: cliente React/Vite, backend Node/Express/Socket.IO, WebRTC, Activity Discord, configurações de deploy, dependências, testes e histórico Git. Nenhum deploy, alteração de visibilidade, commit ou reescrita de histórico foi realizado.

## 1. Resumo executivo

Foram confirmados problemas de confiança no proxy, autorização de host após retomada, corridas no ciclo de vida de salas, validação insuficiente de sinalização, crescimento sem limites, hashing síncrono de senhas e políticas de origem incompletas. As correções foram implementadas e cobertas por integração. O repositório recebeu lint, documentação de operação/segurança e configuração reproduzível de container.

**Recomendação: NÃO APTO para publicação pública neste estado.** Permanecem um advisory alto no SDK Discord, ausência de prova server-side de participação em uma instância Activity, emails de autor não mascarados no histórico e falta de decisão/licença. Os pontos não foram ocultados nem “corrigidos” com uma alegação de segurança que o código não sustenta.

## 2. Achados, severidade e evidências

### Corrigidos

- **Alta — IP de cliente falsificável atrás de proxy.** Antes da correção, `server/src/index.ts` preferia `cf-connecting-ip` ou o primeiro `x-forwarded-for` sempre que `TRUST_PROXY=true`; qualquer cliente que alcançasse o serviço podia influenciar as chaves de rate limit. Agora `TRUST_PROXY_HOPS` é numérico, o IP é selecionado da cadeia confiável e validado, e `CF-Connecting-IP` não é aceito sem validação do proxy. Cobertura em `server/test/integration.test.mjs`.
- **Alta — host anterior continuava autorizado depois de `room:resume`.** A retomada substituía `hostSocketId`, mas os eventos de sinalização/pausa/fim verificavam somente o papel local `host`. Agora esses eventos exigem o socket host atual; uma retomada desconecta a sessão substituída e rotaciona o token. O teste comprova que o token antigo não encerra a sala.
- **Média — joins/criações concorrentes podiam associar um socket a mais de uma sala ou deixar estado órfão.** A sala e o papel eram definidos depois de `await`, sem bloqueio por socket. Agora `roomPending` serializa operações antes de qualquer `await`, cada socket tem uma associação e desconexões durante operações assíncronas limpam a reserva. A integração disputa duas entradas simultâneas e confirma exatamente uma aceitação.
- **Média — relay Socket.IO aceitava objetos de sinalização sem esquema.** O limite de transporte era a única barreira para SDP/ICE arbitrários. Agora as direções permitidas, tipos, tamanho de SDP e candidato são validados e a origem do relay é confirmada contra a sala/host/espectador atual.
- **Média — recursos e mapas sem limites suficientes.** Salas, conexões, buckets de rate limit e sessões Activity podiam crescer sem um teto global confiável; valores de `MAX_VIEWERS` eram aceitos sem validação. Foram adicionados limites configuráveis e bounded, limite de conexões, sessões Activity e um máximo de espectadores entre 1 e 32.
- **Média — senha bloqueava o event loop.** `scryptSync` executava no caminho de criação/entrada. Foi substituído por `scrypt` assíncrono, mantendo salt aleatório e comparação timing-safe; senhas acima de 128 caracteres são rejeitadas, sem truncamento ambíguo.
- **Média — CORS permissivo por padrão e origem WebSocket não verificada.** Sem `FRONTEND_URL`, a origem era aceita; o handshake WebSocket também não tinha verificação própria. Em produção agora são aceitas origens configuradas e Discord, com origens localhost apenas fora de produção. `FRONTEND_URL` e `TRUST_PROXY_HOPS` foram documentados/configurados nos manifests.
- **Média — cliente Vercel sem headers de segurança.** Foram adicionados CSP, `Permissions-Policy`, `Referrer-Policy` e `X-Content-Type-Options` em `client/vercel.json`, além dos headers existentes no Express. A CSP Vercel permite o backend Render; provedores/domínios diferentes exigem ajuste explícito.
- **Média — IDs de sala com 72 bits e limites/configuração inconsistentes.** IDs novos usam 128 bits; valores de limites são validados; o Compose configura a origem própria e Docker usa `npm ci`.
- **Média — sem comando de lint e violações de pureza React.** Foi adicionado ESLint flat config e `npm run lint`; os efeitos/estado da Activity e o relógio no render foram ajustados. O sanitizer de caracteres de controle tem exceção de lint restrita ao arquivo.
- **Alta — `body-parser` vulnerável.** O audit inicial reportava `body-parser 1.20.8` e advisory de DoS. `npm audit fix` aplicou a atualização compatível para `1.20.9`.
- **Baixa — documentação continha endpoints de implantação específicos e validação antiga.** O README foi substituído por documentação genérica sem os hostnames da implantação anterior; os documentos solicitados foram criados.

### Não resolvidos

- **Alta — Zod vulnerável via `@discord/embedded-app-sdk`.** `npm audit` identifica o advisory `GHSA-mrhx-c7xc-m3w5` (DoS por coleções restritas grandes), sem correção disponível para a dependência declarada pelo SDK. A cópia de Zod é empacotada no SDK; não foi aplicado override de major sem compatibilidade. Há **dois registros altos** no relatório npm associados a essa cadeia.
- **Alta para uso privado — identidade/membership da Discord Activity não é autenticada pelo servidor.** `instanceId` vem do cliente e serve apenas como chave de roteamento. O SDK possui comandos oficiais de autorização/autenticação e consulta de participantes, mas o backend não troca/valida OAuth2 nem recebe uma prova confiável de que o usuário pertence à instância indicada. Um ID conhecido permite consultar a lista; salas anunciadas sem senha são convites bearer. O código agora deixa explícito que `instanceId` não é autenticação, mas não inventa uma validação de membership que o servidor não consegue provar neste desenho.
- **Média — dados de autor no histórico Git.** A checagem encontrou seis entradas de email de commit fora do formato noreply. Os valores não foram exibidos nem alterados. Endpoints públicos antigos também aparecem em commits históricos (`README.md`, `DEPLOY_ACTIVITY_AUTOMATICA.md`, `client/.env.example`). O working tree atual não contém esses endpoints. Histórico não foi reescrito, conforme solicitado.
- **Média — licença não definida.** Não havia arquivo `LICENSE`; não foi escolhida uma licença em nome do responsável pelo projeto.
- **Baixa/residual — acessibilidade não passou por avaliação manual ou axe/screen reader.** O lint e a revisão estática não identificaram um bloqueador confirmado, mas não substituem teste assistivo em navegador.

Uma busca por formatos comuns de tokens/chaves não encontrou correspondências no histórico ou nos arquivos versionados atuais. Essa busca não substitui uma varredura dedicada de segredos, como Gitleaks, antes de tornar o repositório público.

## 3. Arquivos alterados

- `server/src/client-ip.ts` (novo), `server/src/config.ts`, `server/src/index.ts`, `server/src/rooms.ts`: IP/proxy, limites, autorização, concorrência, validação de sinalização, hashing assíncrono e erros.
- `server/test/integration.test.mjs`: regressões de proxy, origem/headers, concorrência, senha, múltiplas transmissões/espectadores, sinalização, Activity e retomada.
- `client/src/lib/host.ts`, `client/src/pages/ActivityPage.tsx`, `client/src/pages/HostPage.tsx`: token rotacionado, estado React e limite de senha no UI.
- `package.json`, `package-lock.json`, `eslint.config.js` (novo): lint, dependências e override de `minimatch` para a versão corrigida. O `package-lock.json` já estava modificado antes desta auditoria; revisar esse diff separadamente antes de integrar.
- `.env.example`, `render.yaml`, `deploy/docker-compose.yml`, `client/vercel.json`, `Dockerfile`: proxy, origens, headers e instalação reproduzível.
- `README.md` e `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `docs/DEPLOYMENT.md`, `docs/TESTING.md`, `docs/KNOWN_LIMITATIONS.md`: documentação substituída/criada.
- `docs/AUDIT_REPORT.md`: este relatório.

## 4. Explicação técnica das correções

O backend agora trata socket/host atual como autoridade para ações da sala, serializa operações async por socket, reserva capacidade antes de awaits e remove reservas se a conexão cair. SDP/ICE só é retransmitido nos sentidos esperados e dentro de limites. Rate limits usam IP validado de acordo com o número de proxies; o lobby Activity tem limites de taxa/capacidade, mas continua sendo roteamento público, não autenticação.

Senhas usam `scrypt` assíncrono. A retomada gira o token e desconecta o socket host anterior. Os limites de conexão, salas, espectadores e mapas têm defaults e faixas máximas. CORS/WebSocket falham fechados para origens web não configuradas em produção. A documentação agora descreve limites de uma única instância e requisitos de TURN.

## 5. Testes executados

- `npm ci`: passou; instalação reproduzida pelo lockfile. O npm reportou duas vulnerabilidades altas do SDK/Zod.
- `npm run lint`: passou.
- `npm run typecheck`: passou para backend e frontend.
- `npm test`: passou, 3 testes de topo, 0 falhas. A integração inclui dois hosts, múltiplos espectadores, senha errada/correta, disputa concorrente de entrada, origem negada, headers, sinalização, publicação/remoção e retomada.
- `npm run build`: passou; Vite e TypeScript do backend.
- `docker build --tag lume-audit:review .`: passou localmente; não foi publicado.
- `docker compose -f deploy/docker-compose.yml config --quiet`: passou com valores fictícios de validação.
- Parse de `client/vercel.json`: passou.
- `git diff --check`: passou; erros do editor: nenhum.
- `npm audit`: **não passa sem ressalvas**; mantém advisory alto upstream de Zod/SDK, sem fix disponível.

Não foram executados: cliente Discord real, OAuth real, captura/reprodução em navegador, WebRTC P2P entre redes, TURN real, Vercel/Render ou qualquer deploy.

## 6. Problemas não resolvidos e motivos

Zod depende de atualização/mitigação upstream compatível. Autenticação/membership Activity exige decidir e implementar um protocolo server-side verificável; identidade OAuth isolada não prova participação naquela instância. Emails/hostnames históricos não foram removidos porque não foi autorizada reescrita do histórico. A licença requer decisão do titular. Os limites de memória/rate limit são locais ao processo e não são distribuídos nem proteção DDoS.

## 7. Riscos de regressão

- Produção precisa de `FRONTEND_URL` exato e `TRUST_PROXY_HOPS` correto; configuração incorreta impede conexão ou volta a confiar em uma cadeia inadequada.
- A CSP Vercel autoriza `*.onrender.com`; backend em domínio/provedor próprio precisa de atualização correspondente.
- A rotação de token exige cliente atualizado para continuar retomando a sala. Um frontend antigo pode não guardar o token novo.
- Rate limits e estado são por processo; múltiplas réplicas continuam não suportadas.
- Clientes antigos em salas em memória podem perder estado durante um deploy/reinício; salas não são persistidas.

## 8. Checklist de testes manuais

- [ ] Abrir Activity no Discord desktop e verificar carregamento da lista e Socket.IO.
- [ ] Iniciar duas transmissões sem senha na mesma Activity e confirmar títulos/remoção.
- [ ] Abrir host e player no navegador externo, incluindo Android/iOS disponíveis.
- [ ] Entrar em sala aberta e protegida; testar senha incorreta, correta e limite de espectadores.
- [ ] Testar vídeo, áudio do sistema/microfone e controles em navegadores/sistemas suportados.
- [ ] Testar pausa, encerramento pelo navegador, encerramento pelo host e reconexão dentro/fora de 30 segundos.
- [ ] Confirmar que host substituído não consegue sinalizar, pausar ou encerrar.
- [ ] Testar redes distintas com TURN e observar rota relay; repetir em rede móvel/CGNAT.
- [ ] Verificar origens legítimas/ilegítimas, CSP, headers e URL Mappings Discord em produção.
- [ ] Fazer avaliação de teclado, leitor de tela, foco, contraste e controles móveis.

## 9. Checklist de segurança para publicação pública

- [ ] Resolver/mitigar o advisory Zod do SDK e repetir `npm audit`.
- [ ] Definir modelo de autenticação Activity e verificar server-side qualquer acesso considerado privado.
- [ ] Revisar emails de autor e URLs históricas; decidir conscientemente se histórico exige limpeza autorizada.
- [ ] Escolher e adicionar licença apropriada antes de anunciar o projeto como open source.
- [ ] Rodar Gitleaks ou ferramenta equivalente no working tree e em todo o histórico.
- [ ] Configurar `FRONTEND_URL`, `TRUST_PROXY_HOPS`, limites, CSP e backend TURN no provedor real.
- [ ] Confirmar que nenhuma chave/bot token/TURN secret foi colocada em `VITE_*` ou commitada.
- [ ] Executar os testes manuais de Discord, browsers, redes e TURN descritos acima.
- [ ] Definir contato/processo de divulgação responsável de vulnerabilidades.
- [ ] Revisar o diff preexistente de `package-lock.json` e o diff completo antes do commit.

## 10. Recomendação

**NÃO APTO para publicação pública neste momento.** A recomendação muda após resolução ou aceitação formal do advisory alto, decisão explícita sobre a visibilidade/autorizações do lobby Activity, revisão de emails históricos, escolha de licença e execução dos testes reais de plataforma. Os checks locais e o build Docker são satisfatórios, mas não compensam esses riscos e não constituem validação de deploy.