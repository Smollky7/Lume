# Limitações conhecidas

- O proxy Discord Activities permite sinalização WebSocket, mas não transporta a sessão WebRTC; captura e player usam o navegador externo.
- `getDisplayMedia` depende de navegador, contexto seguro e gesto do usuário. Navegadores móveis podem não oferecer captura de tela ou áudio do sistema.
- Captura de áudio do sistema varia por navegador, sistema operacional e escolha no seletor de tela. O app não pode garantir esse recurso.
- WebRTC P2P envia uma cópia por espectador; o upload e o custo de CPU do host crescem com cada peer.
- STUN não garante conectividade atrás de NAT/CGNAT. TURN é necessário em algumas redes e pode gerar custo de tráfego.
- Salas, lista Activity e rate limits ficam em memória e são perdidos ao reiniciar. Só há suporte operacional para uma instância.
- O `instanceId` da Activity é uma chave de agrupamento, não prova de participação nem identidade Discord. A lista não é um canal privado.
- IDs de sala e senhas opcionais não implementam conta, lista de permissões ou revogação por usuário. Compartilhe links somente com quem deve assistir.
- O SDK Discord possui advisory upstream para Zod empacotado sem correção compatível disponível na auditoria atual.
- Esta entrega não foi testada em clientes Discord reais, redes TURN reais ou deploys públicos.