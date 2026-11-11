# Revisão de Publicação

Data: 2026-11-11
Escopo: bloqueios para publicar o código-fonte Lume no GitHub; análise do lock atual e do único diff preexistente; dependências, Activity Discord, histórico Git, documentação, licença e testes disponíveis no ambiente. Nenhum commit, push, deploy, mudança de visibilidade ou reescrita de histórico foi realizado.

## Parecer

**APTO COM RESSALVAS para publicar o repositório como código-fonte visível no GitHub.** Não é aprovação para declarar o lobby Activity privado, anunciar o projeto como open source sem licença, nem afirmar que Discord real, TURN entre redes ou deploy foram validados. O mantenedor deve aceitar conscientemente o advisory alto ainda presente no SDK e revisar em privado os metadados pessoais/endpoints históricos.

## Matriz de Pendências

| Pendência original | Evidência encontrada | Correção realizada | Testes executados | Risco residual | Status |
| --- | --- | --- | --- | --- | --- |
| Dois alertas altos Discord/Zod | `npm audit` aponta `@discord/embedded-app-sdk@2.5.0` e `zod@3.25.76` para `GHSA-mrhx-c7xc-m3w5` (DoS por array de validação grande, severidade alta, `<4.6.6`). Os dois registros são a mesma vulnerabilidade na cadeia SDK → Zod. SDK é dependência de produção do client. | Nenhum override de Zod foi aplicado: o SDK declara `zod ^3.9.8`; a primeira versão corrigida é 4.6.6. A versão estável mais recente consultada é 2.5.0 e a beta 3.0.0-beta.3 também declara Zod 3. | `npm ci`; `npm audit`; `npm audit --omit=dev`; inspeção do SDK instalado e teste de integração. | Lume chama `ready()` e `openExternalLink()`, não chama `authorize`, `authenticate`, `getInstanceConnectedParticipants` nem assina eventos de participantes. A validação de participantes usa array sem limite e o SDK valida eventos recebidos do bridge; essa rota não é solicitada pelo fluxo Lume, mas o código vulnerável está distribuído e pode ser alcançado se o runtime Discord enviar esse evento. Audit de produção mantém 2 registros altos. | MITIGADO |
| Override global `minimatch@11.0.8` | ESLint e TypeScript-ESLint declaram `^10.2.x`, enquanto o override exigia major 11. O lock instala `10.2.6`. `minimatch@11.0.8` oferece CommonJS/ESM e engines `20 || >=22`, compatíveis com o Node do projeto, mas a versão não está nas faixas publicadas pelos consumidores. | Removido o override global; `npm ci` instala as versões dentro dos intervalos dos mantenedores. Não foi usado `npm audit fix --force`. | `npm ci`; `npm ls --all minimatch`; lint, typecheck e build. | Override incompatível resolvido. O advisory `GHSA-g3hv-75wg-m249` continua em `minimatch@10.2.6` do toolchain até atualização suportada; só aparece como dependência de desenvolvimento. | RESOLVIDO |
| Advisory moderado de `minimatch` | `npm audit` reporta 10 registros moderados transitivos em ESLint/TypeScript-ESLint; `npm audit --omit=dev` não os reporta. A correção sugerida pelo npm exigiria downgrade major do ESLint. | Nenhum override major ou downgrade forçado; dependências e API de lint foram preservadas. | `npm audit`; `npm audit --omit=dev`; `npm run lint`. | Aviso permanece no ambiente de desenvolvimento e em CI que instala devDependencies. Reavaliar quando os mantenedores publicarem cadeia compatível corrigida. | PENDENTE |
| Usuário não autorizado assumir papel privilegiado | `room:state`, `room:end`, relay e publicação exigem socket host atual; `room:resume` exige token aleatório e gira o token. O teste tenta `room:state`, `room:end`, `activity:publish` e `room:create` a partir de um espectador, confirma que a sala continua ativa e que um socket novo não retoma com o token anterior. | Acrescentadas regressões para autorização de espectador e replay de token obsoleto. Correções de host atual e rotação de token da auditoria anterior foram preservadas. | `npm test` (3 testes de topo, 0 falhas), incluindo tentativas de elevação de papel e replay. | O host pode administrar somente sua própria sala; o token atual continua sendo uma credencial bearer se roubado do navegador host. | RESOLVIDO |
| `instanceId`/membership da Activity não autenticados | `instanceId` é recebido do cliente e validado apenas por formato. Qualquer cliente que conheça o ID pode consultar a lista. A integração publica a sala por um socket host que não entrou na Activity, provando que o servidor não valida membership. OAuth de identidade, sem prova de participação na instância, não resolveria essa lacuna. | UI e documentação agora identificam o lobby como lista pública, sujeita a anúncios não solicitados. Não inventei endpoint, token ou fluxo. SDK oficial documenta `authorize` → troca do code no servidor → `authenticate`, mas nada disso está implementado. | `npm test`; revisão de `server/src/index.ts`, `ActivityPage.tsx` e README oficial do SDK. | Lista e publicação não são isoladas por chamada; não use para conteúdo privado. Implementar controle exige protocolo oficial verificável server-side e testes próprios, ou decisão de produto para desabilitar o lobby. | PENDENTE |
| Segredos e privacidade no histórico Git | Varredura de 3 refs/8 commits. Gitleaks 8.28.0 encontrou 3 padrões Discord: dois IDs de aplicação e um falso positivo `discord-client-secret` em `VITE_DISCORD_CLIENT_ID`. Scanner adicional não encontrou tokens, chaves privadas, JWTs ou URLs com credenciais. Um email de autor fora do padrão noreply aparece em 6 commits; valores não foram impressos. URLs de provedores públicos aparecem em `README.md`, `client/.env.example` e `DEPLOY_ACTIVITY_AUTOMATICA.md` histórico, sem credenciais embutidas. | Nenhuma credencial real confirmada; histórico mantido intacto conforme solicitado. URLs e email não foram reproduzidos neste relatório. | Gitleaks 8.28.0 com todas as refs e redação integral; scanner de padrões locais; inspeção mascarada de metadados. | IDs públicos e URLs públicas não são, por si, vulnerabilidades. Email pode ser dado pessoal; URLs podem revelar implantação/estado de serviços antigos. Mantenedor deve confirmar titularidade/retirada dos endpoints e aceitar ou não a exposição do email. | PENDENTE |
| README e documentos | README e docs descrevem captura por navegador, P2P, limite por espectador, lobby efêmero e limitações de browser/NAT; a UI agora não promete membership. | Corrigida a descrição visível do Activity e ampliado o plano manual em `docs/TESTING.md`. Nenhuma capacidade não implementada foi adicionada à documentação. | Revisão estática dos documentos; lint/typecheck/build/test. | O resultado real depende do browser, Discord e provedor; alegações externas ainda precisam dos testes manuais. | RESOLVIDO |
| Licença ausente | Não há arquivo `LICENSE`. | Nenhuma licença foi adicionada sem aprovação do titular. | Inspeção do repositório. | Repositório visível não concede permissão de uso. Não anunciar como open source até escolha e inclusão de licença. | PENDENTE |
| Contexto de build Docker inclui arquivos locais | Build inicial transferiu aproximadamente 164 MB e não havia `.dockerignore`; `Dockerfile` executa `COPY . .`. | Criado `.dockerignore` para `.git`, `node_modules`, builds, `.env` e logs. | Docker build passou; contexto caiu para aproximadamente 17,3 kB. Compose config passou. | O build de imagem local não é deploy nem valida operação real de TURN/Discord. | RESOLVIDO |
| Testes externos e deploy | Ambiente permite testes de integração local e Docker; não há sessão Discord real, dois dispositivos/redes distintas, credenciais TURN de teste nem deploy autorizado. | Preparado roteiro com pré-condições, ações e resultados esperados em `docs/TESTING.md`. | Testes locais, build e configuração Docker/Compose executados; cenários externos não executados. | Compatibilidade de Activity, NAT/TURN real, reconexão em browsers e deploy Render/Vercel permanecem desconhecidos. | PENDENTE |

## Dependências

O advisory de Zod é `GHSA-mrhx-c7xc-m3w5`, descrito como consumo de memória ao validar coleções grandes, com patch upstream a partir de `4.6.6`; o registry consultado retorna `zod@4.6.7` como atual. O `npm audit` retorna dois registros altos para a mesma cadeia, não dois advisories distintos. O pacote SDK usa `zod ^3.9.8`; Zod 4 não é uma atualização compatível declarada. A beta `@discord/embedded-app-sdk@3.0.0-beta.3` também mantém Zod 3, então não é alternativa segura para remover o alerta.

O código do Lume inicializa o SDK no Activity e usa `ready()`/`openExternalLink()`. A schema de `ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE` inclui array de participantes sem limite; não há chamada Lume a participantes nem inscrição no evento, mas o parser genérico do SDK trata eventos vindos do bridge Discord. Por isso, risco de produção é mitigado pela ausência da operação no fluxo atual, não eliminado. Não apliquei patch em `node_modules` ou override de Zod que não persistiria/reprovaria o contrato.

O advisory de `minimatch` é `GHSA-g3hv-75wg-m249`, faixa afetada `>=7.0.0 <11.0.1`. A versão 11 corrigida é major incompatível com as faixas que ESLint e TypeScript-ESLint declaram. O override anterior não tinha suporte semver dos consumidores; removê-lo é mais correto do que esconder avisos. As ocorrências são exclusivamente devDependencies.

## Discord e Autorização

As fontes oficiais consultadas são o [README do Embedded App SDK](https://github.com/discord/embedded-app-sdk#readme), que demonstra autorização com code, troca no servidor e autenticação no cliente, e a [documentação Discord do Embedded App SDK](https://docs.discord.com/developers/developer-tools/embedded-app-sdk). O fluxo não foi implementado. O client ID é público; nenhum client secret foi encontrado.

As salas continuam convites bearer: ID identifica sala, senha opcional protege a entrada e token de host protege a retomada. Espectador não consegue controlar a sala. Separadamente, o lobby Activity não prova que o socket host participa da instância e aceita anúncios sob qualquer ID válido; isso é uma limitação pública de roteamento, não uma autorização privada.

## Histórico e Privacidade

Foram inspecionadas as refs locais disponíveis com `git log --all` e os blobs alcançáveis. Há 3 refs e 8 commits. A varredura Gitleaks teve três alertas de formato, todos identificadores públicos de aplicação nos arquivos/commits verificados; não houve confirmação de token ou segredo. Endereços antigos são URLs de serviço público sem credencial, mas podem apontar para infraestrutura ainda ativa ou revelar nomes de projeto. O email não-noreply é metadado de autoria, não uma vulnerabilidade; cabe ao autor decidir se quer expô-lo.

Não removi URLs nem dados de autoria do histórico e não o reescrevi. Se o proprietário decidir que um endereço aponta para serviço que não deve continuar público, a ação adequada é verificar e desativar/rotacionar esse serviço primeiro; reescrita do Git exigiria autorização explícita e coordenação com eventuais clones.

## Documentação e Licença

README, arquitetura, segurança, deploy, limitações e testes foram revisados contra o código. A Activity agora avisa que a lista é pública e que seu ID não prova participação. Nenhum teste externo é apresentado como aprovado.

- **MIT:** licença permissiva curta, exige preservar copyright e aviso de licença; adequada a reutilização simples, sem concessão explícita de patente tão detalhada quanto Apache-2.0.
- **Apache-2.0:** permissiva, inclui concessão expressa de patente e termos de contribuições/notices; mais explícita para projetos que recebem contribuições ou desejam proteção patentária clara.
- **Sem licença:** direitos autorais permanecem reservados automaticamente; o código pode ser visualizado no GitHub, mas terceiros não recebem autorização padrão para copiar, modificar ou redistribuir. Não chamar de open source.

Recomendação: MIT para um projeto comunitário pequeno que priorize simplicidade; Apache-2.0 se a concessão explícita de patente/contribuições for importante. A decisão e a inclusão do arquivo ficam com o titular; nenhuma licença foi criada nesta revisão.

## Testes

Executados no ambiente atual: `npm ci`, `npm run lint`, `npm run typecheck`, `npm test` (3 testes, todos aprovados), `npm run build`, `npm audit`, `npm audit --omit=dev`, Gitleaks, Docker build, `docker compose ... config --quiet` e `git diff --check`.

`npm audit` retorna 2 altas e 10 moderadas; `npm audit --omit=dev` retorna 2 altas. Discord real, TURN entre redes, browsers/dispositivos distintos e deploy Render/Vercel não foram executados. O roteiro reproduzível completo está em `docs/TESTING.md`.

## Ações Manuais do Mantenedor

1. Decidir se aceita tornar públicos o email de autoria e os metadados de URLs históricas; verificar se os serviços ainda estão sob controle e desativar/rotacionar qualquer um que não deva permanecer acessível. Não é necessário reescrever histórico por padrão.
2. Aceitar formalmente o risco residual de Zod/SDK ou aguardar atualização estável compatível antes de expor a Activity a tráfego real.
3. Decidir se a Activity deve permanecer como lobby público. Se a lista precisar ser privada ou limitada a membros, fornecer uma decisão/protocolo de autorização server-side baseado em documentação oficial e credenciais mantidas no backend.
4. Escolher MIT, Apache-2.0 ou manter sem licença; adicionar uma licença somente após aprovação.
5. Antes do deploy, configurar domínios/origens, `TRUST_PROXY_HOPS`, CSP e TURN; executar o roteiro de Activity real, redes distintas, TURN, reconexão, encerramento e deploy em ambiente de teste.
6. Rodar uma nova auditoria quando ESLint/TypeScript-ESLint e o SDK publicarem versões corrigidas; não usar `npm audit fix --force` nem override incompatível.

Nenhuma ação externa, publicação, commit, push, deploy ou mudança de visibilidade foi realizada.