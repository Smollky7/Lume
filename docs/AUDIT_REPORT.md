# Relatório de Auditoria Técnica

Data: 2026-11-11  
Escopo: cliente React/Vite, backend Node/Express/Socket.IO, WebRTC, Activity Discord, configurações de deploy, dependências, testes e histórico Git. Nenhum deploy, alteração de visibilidade, commit ou reescrita de histórico foi realizado.

## 1. Resumo executivo

As correções da primeira auditoria foram preservadas. Nesta segunda revisão, removi o override global incompatível de `minimatch`, acrescentei teste para impedir que um espectador execute ações de host, tornei explícito na UI que o lobby Activity não é privado e excluí `.git`, `node_modules`, builds e arquivos `.env` do contexto Docker.

**Parecer: APTO COM RESSALVAS para publicar o código-fonte no GitHub, não para declarar o lobby Activity privado nem para tratar o deploy de produção como aprovado.** O histórico não revelou segredo real; o advisory alto do SDK continua sem atualização compatível e há avisos moderados somente nas ferramentas de desenvolvimento. Veja a análise, condições e decisões pendentes em [docs/PUBLICATION_REVIEW.md](PUBLICATION_REVIEW.md).

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

- **Alta — Zod via `@discord/embedded-app-sdk`.** O lock resolve `@discord/embedded-app-sdk@2.5.0` e `zod@3.25.76`; `npm audit` registra o mesmo advisory `GHSA-mrhx-c7xc-m3w5` duas vezes (nó Zod e SDK), não duas vulnerabilidades distintas. O primeiro patch upstream é Zod `4.6.6`, incompatível com o intervalo `^3.9.8` declarado pelo SDK; a versão estável mais recente do SDK e a beta consultada continuam declarando Zod 3. O Lume chama `ready()` e `openExternalLink()`, não chama `authorize`, `authenticate` nem `getInstanceConnectedParticipants`, e não assina atualização de participantes. O SDK contém esquema de participantes com array sem limite e o parser aceita eventos do bridge Discord; assim, o caminho não é exercido pelas operações solicitadas pelo Lume, mas o risco de DoS permanece no código de produção distribuído. Não foi aplicado override de major.
- **Moderada — `minimatch` em ferramentas de desenvolvimento.** O lock usa `minimatch@10.2.6` em ESLint e TypeScript-ESLint; o advisory `GHSA-g3hv-75wg-m249` afeta versões `<11.0.1`. Os consumidores declaram faixas `^10.2.x`. O override anterior para `^11.0.8` violava essas faixas, apesar de a versão 11 ter engines compatíveis com o Node suportado e exports CommonJS/ESM. Foi removido; o audit continua mostrando avisos moderados de desenvolvimento. Não foi usado `npm audit fix --force`.
- **Alta para privacidade de conteúdo da Activity — sem prova server-side de membership.** `instanceId` é fornecido pelo cliente e é somente uma chave de roteamento. Qualquer cliente que conheça o ID pode consultar a lista; qualquer host de sala aberta pode anunciar sob um ID válido, sem provar que participa da instância. O servidor restringe `room:state`, `room:end`, sinalização e publicação à sessão host da própria sala; espectadores não conseguem assumir esses papéis. A integração OAuth/membership não foi inventada nem implementada porque o backend não tem credencial/prova validável neste desenho. O lobby continua público e sujeito a anúncios não solicitados.
- **Privacidade — metadados do histórico Git.** Há 3 refs locais e 8 commits; 6 commits usam um email de autor fora do padrão noreply, entre 2 endereços de autor únicos. Os valores não foram exibidos. URLs públicas antigas aparecem em `README.md`, `client/.env.example` e um guia de deploy removido. São endereços de serviços públicos, sem userinfo/credenciais; podem revelar metadados de implantação e devem ser confirmados pelo mantenedor. O histórico não foi reescrito.
- **Segredos — Gitleaks.** A varredura de todas as refs com Gitleaks 8.28.0 encontrou três correspondências de formato: dois IDs Discord e uma ocorrência rotulada como client secret em `client/.env.example`, cuja variável é `VITE_DISCORD_CLIENT_ID`. IDs de aplicação são públicos; não foi identificado token, client secret, chave privada ou credencial real. O scanner heurístico adicional também não encontrou padrões de segredo. Isso não equivale a provar ausência de qualquer segredo possível.
- **Média — licença não definida.** Não havia arquivo `LICENSE`; não foi escolhida uma licença em nome do responsável pelo projeto.
- **Baixa/residual — acessibilidade não passou por avaliação manual ou axe/screen reader.** O lint e a revisão estática não identificaram um bloqueador confirmado, mas não substituem teste assistivo em navegador.

Uma busca por formatos comuns de tokens/chaves não encontrou correspondências no histórico ou nos arquivos versionados atuais. Essa busca não substitui uma varredura dedicada de segredos, como Gitleaks, antes de tornar o repositório público.

## 3. Arquivos alterados

- `server/src/client-ip.ts` (novo), `server/src/config.ts`, `server/src/index.ts`, `server/src/rooms.ts`: IP/proxy, limites, autorização, concorrência, validação de sinalização, hashing assíncrono e erros.
- `server/test/integration.test.mjs`: regressões de proxy, origem/headers, concorrência, senha, múltiplas transmissões/espectadores, sinalização, Activity e retomada.
- `client/src/lib/host.ts`, `client/src/pages/ActivityPage.tsx`, `client/src/pages/HostPage.tsx`: token rotacionado, estado React e limite de senha no UI.
- `package.json`, `package-lock.json`, `eslint.config.js` (novo): lint e dependências. O override global de `minimatch` foi removido por incompatibilidade semver; o diff preexistente do lock foi preservado.
- `.dockerignore` (novo): exclui metadados Git, dependências locais, builds e arquivos `.env` do contexto Docker.
- `.env.example`, `render.yaml`, `deploy/docker-compose.yml`, `client/vercel.json`, `Dockerfile`: proxy, origens, headers e instalação reproduzível.
- `README.md` e `docs/ARCHITECTURE.md`, `docs/SECURITY.md`, `docs/DEPLOYMENT.md`, `docs/TESTING.md`, `docs/KNOWN_LIMITATIONS.md`: documentação substituída/criada.
- `docs/AUDIT_REPORT.md`: este relatório.

## 4. Explicação técnica das correções

O backend agora trata socket/host atual como autoridade para ações da sala, serializa operações async por socket, reserva capacidade antes de awaits e remove reservas se a conexão cair. SDP/ICE só é retransmitido nos sentidos esperados e dentro de limites. Rate limits usam IP validado de acordo com o número de proxies; o lobby Activity tem limites de taxa/capacidade, mas continua sendo roteamento público, não autenticação.

Senhas usam `scrypt` assíncrono. A retomada gira o token e desconecta o socket host anterior. Os limites de conexão, salas, espectadores e mapas têm defaults e faixas máximas. CORS/WebSocket falham fechados para origens web não configuradas em produção. A documentação agora descreve limites de uma única instância e requisitos de TURN.

## 5. Testes executados

- `npm ci`: passou; instalação reproduzida pelo lockfile. O npm reportou 10 moderadas e 2 altas.
- `npm run lint`: passou.
- `npm run typecheck`: passou para backend e frontend.
- `npm test`: passou, 3 testes de topo, 0 falhas. A integração inclui dois hosts, múltiplos espectadores, senha errada/correta, disputa concorrente de entrada, origem negada, headers, sinalização, publicação/remoção, retomada, replay negado do token antigo e tentativa de ações privilegiadas por espectador.
- `npm run build`: passou; Vite e TypeScript do backend.
- `docker build --tag lume-audit:publication-review .`: passou; o contexto foi reduzido de 164 MB para 17,3 kB após adicionar `.dockerignore`; imagem não publicada.
- `docker compose -f deploy/docker-compose.yml config --quiet`: passou com valores fictícios de validação.
- Parse de `client/vercel.json`: passou.
- `git diff --check`: passou; erros do editor: nenhum.
- `npm audit`: **não passa sem ressalvas**; 2 registros altos do mesmo advisory de Zod/SDK e 10 registros moderados transitivos de `minimatch` no toolchain.
- `npm audit --omit=dev`: mantém os 2 registros altos de Zod/SDK na dependência client-side de produção; não reporta os moderados de desenvolvimento.
- Gitleaks 8.28.0 em todas as refs: 3 correspondências classificadas como IDs Discord públicos/placeholder de client ID; nenhum segredo real confirmado. Nenhum valor sensível foi impresso.

Não foram executados: cliente Discord real, OAuth real, captura/reprodução em navegador, WebRTC P2P entre redes, TURN real, Vercel/Render ou qualquer deploy.

## 6. Problemas não resolvidos e motivos

Zod e `minimatch` dependem de correção upstream compatível. Membership Activity requer uma prova validável pelo backend; o SDK no browser e um `instanceId` não bastam. Emails/hostnames históricos não foram removidos porque não foi autorizada reescrita do histórico. A licença requer decisão do titular. Os limites de memória/rate limit são locais ao processo e não são distribuídos nem proteção DDoS.

## 7. Riscos de regressão

- Produção precisa de `FRONTEND_URL` exato e `TRUST_PROXY_HOPS` correto; configuração incorreta impede conexão ou volta a confiar em uma cadeia inadequada.
- A CSP Vercel autoriza `*.onrender.com`; backend em domínio/provedor próprio precisa de atualização correspondente.
- A rotação de token exige cliente atualizado para continuar retomando a sala. Um frontend antigo pode não guardar o token novo.
- Rate limits e estado são por processo; múltiplas réplicas continuam não suportadas.
- Clientes antigos em salas em memória podem perder estado durante um deploy/reinício; salas não são persistidas.

## 8. Plano de testes pendentes

O plano reproduzível está em [docs/TESTING.md](TESTING.md) e cobre Activity real, dois usuários em redes diferentes, TURN, múltiplos transmissores, reconexão, encerramento inesperado, segurança de salas e deploy Render/Vercel ou Docker. Nenhum teste externo foi declarado aprovado.

## 9. Checklist de segurança para publicação pública

- [ ] Aceitar formalmente o risco residual do SDK ou aguardar versão estável compatível com Zod corrigido.
- [ ] Tratar Activity como lobby público; antes de restringir publicação/consulta a membros, obter fluxo oficial server-side verificável e implementar testes.
- [ ] Revisar em privado o email de autoria e a titularidade/estado dos endpoints históricos; não reescrever histórico sem autorização explícita.
- [ ] Escolher licença antes de anunciar o projeto como open source; nenhuma licença foi adicionada.
- [ ] Rodar Gitleaks ou ferramenta equivalente no working tree e em todo o histórico.
- [ ] Configurar `FRONTEND_URL`, `TRUST_PROXY_HOPS`, limites, CSP e backend TURN no provedor real.
- [ ] Confirmar que nenhuma chave/bot token/TURN secret foi colocada em `VITE_*` ou commitada.
- [ ] Executar os testes manuais de Discord, browsers, redes e TURN descritos acima.
- [ ] Definir contato/processo de divulgação responsável de vulnerabilidades.
- [ ] Revisar o diff preexistente de `package-lock.json` e o diff completo antes do commit.

## 10. Recomendação

**APTO COM RESSALVAS para tornar o código-fonte visível no GitHub**, condicionado à aceitação do advisory de produção e à revisão de privacidade dos metadados históricos. Isso não é aprovação para anunciar o projeto como open source (licença ainda ausente), usar a Activity como espaço privado ou afirmar que Discord/TURN/deploy foram validados. O parecer detalhado e as decisões que dependem do mantenedor estão em [docs/PUBLICATION_REVIEW.md](PUBLICATION_REVIEW.md).