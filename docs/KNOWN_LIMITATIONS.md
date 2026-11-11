# Limitações conhecidas

- O proxy Discord Activities permite sinalização WebSocket, mas não transporta a sessão WebRTC; captura e player usam o navegador externo.
- `getDisplayMedia` depende de navegador, contexto seguro e gesto do usuário. Navegadores móveis podem não oferecer captura de tela ou áudio do sistema.
- Captura de áudio do sistema varia por navegador, sistema operacional e escolha no seletor de tela. O app não pode garantir esse recurso.
- WebRTC P2P envia uma cópia por espectador; o upload e o custo de CPU do host crescem com cada peer.
- STUN não garante conectividade atrás de NAT/CGNAT. TURN é necessário em algumas redes e pode gerar custo de tráfego.
- O servidor valida e limita o cache das credenciais TURN geradas pela Cloudflare conforme o TTL solicitado. Para `ICE_API_URL`, o formato externo contém apenas `iceServers`; a validade e a duração das credenciais são responsabilidade do provedor. Uma configuração presente não garante que o relay seja alcançável.
- Credenciais fixas `TURN_USERNAME`/`TURN_CREDENTIAL` são enviadas ao navegador para negociar relay; se forem permanentes, qualquer cliente pode extraí-las. Use credenciais temporárias e restritas.
- Salas, lista Activity e rate limits ficam em memória e são perdidos ao reiniciar. Só há suporte operacional para uma instância.
- O `instanceId` da Activity é uma chave de agrupamento, não prova de participação nem identidade Discord. Qualquer cliente que conheça o ID pode consultar a lista; qualquer host de sala aberta pode anunciar sob esse ID. A lista não é privada nem isolada por chamada. A documentação oficial oferece uma API server-side de instâncias e assinaturas opcionais de proxy, mas o Lume ainda não autentica nem associa usuários a instâncias.
- IDs de sala e senhas opcionais não implementam conta, lista de permissões ou revogação por usuário. Compartilhe links somente com quem deve assistir.
- O SDK Discord possui advisory upstream para Zod empacotado sem correção compatível disponível na auditoria atual.
- Esta entrega não foi testada em clientes Discord reais, redes TURN reais ou deploys públicos.
- A CSP do Vercel estática permite o backend hospedado em `*.onrender.com`; um domínio de backend próprio exige substituir essa origem pelo hostname exato em `client/vercel.json`. A escolha do domínio de produção ainda não está definida.