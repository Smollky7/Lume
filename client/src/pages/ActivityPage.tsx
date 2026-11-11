import { useEffect, useMemo, useState } from 'react';
import { DiscordSDK } from '@discord/embedded-app-sdk';
import { createSocket } from '../lib/socket';

type Stream = { roomId: string; title: string };
const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID as string | undefined;

export default function ActivityPage() {
  const [instance, setInstance] = useState<string | null>(null);
  const [sdk, setSdk] = useState<DiscordSDK | null>(null);
  const [connected, setConnected] = useState(false);
  const [streams, setStreams] = useState<Stream[]>([]);
  const [error, setError] = useState('');
  const external = useMemo(() => (import.meta.env.VITE_PUBLIC_URL as string | undefined)?.replace(/\/$/, '') || location.origin, []);

  useEffect(() => {
    if (!clientId) return;
    const discord = new DiscordSDK(clientId);
    let cancelled = false;
    discord.ready().then(() => { if (!cancelled) { setSdk(discord); setInstance(discord.instanceId); } })
      .catch(() => { if (!cancelled) setError('Abra o Lume como Activity dentro de uma chamada Discord.'); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!instance) return;
    const s = createSocket();
    s.on('connect', () => {
      setConnected(true);
      s.emit('activity:join', instance, (r: { ok: boolean; streams?: Stream[] }) => {
        if (r.ok) setStreams(r.streams || []);
        else setError('Falha ao entrar na sessão.');
      });
    });
    s.on('disconnect', () => setConnected(false));
    s.on('activity:streams', setStreams);
    s.on('connect_error', () => setError('Não foi possível conectar ao Render. Verifique o WebSocket e os URL Mappings.'));
    return () => {
      s.disconnect();
    };
  }, [instance]);

  async function openExternal(url: string) {
    if (sdk) {
      try {
        await sdk.commands.openExternalLink({ url });
        return;
      } catch {
        setError('O Discord não conseguiu abrir o navegador. Use o Discord atualizado e tente novamente.');
      }
    }
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function launchBroadcaster() {
    if (!instance) return;
    void openExternal(`${external}/?activity_instance=${encodeURIComponent(instance)}`);
  }

  function watch(roomId: string) {
    void openExternal(`${external}/r/${encodeURIComponent(roomId)}?autojoin=1`);
  }

  return <main className="activity">
    <header><div><h1>LUME <span>ACTIVITY</span></h1><p>Transmissões disponíveis automaticamente nesta chamada.</p></div><button onClick={launchBroadcaster} disabled={!instance}>+ Transmitir tela</button></header>
    {(error || !clientId) && <p className="activity-error" role="alert">{error || 'VITE_DISCORD_CLIENT_ID não configurado na Vercel.'}</p>}
    {!instance && !error && clientId && <p>Conectando ao Discord...</p>}
    <section className="activity-grid">
      {streams.map(s => <article className="activity-tile" key={s.roomId}>
        <div className="activity-screen-icon" aria-hidden="true">▣</div>
        <strong>{s.title}</strong>
        <span>Ao vivo</span>
        <button onClick={() => watch(s.roomId)}>Assistir</button>
      </article>)}
      {streams.length === 0 && <div className="activity-empty">Ninguém está transmitindo. Clique em “Transmitir tela”, selecione a tela na janela do navegador e inicie a transmissão. Ela aparecerá aqui automaticamente.</div>}
    </section>
    <p className="activity-tip">Até quatro transmissões por chamada. Captura e reprodução abrem no navegador porque o proxy de Activities suporta WebSocket, mas não WebRTC.</p>
    {!connected && instance && <p className="activity-error">Aguardando conexão com servidor...</p>}
  </main>;
}
