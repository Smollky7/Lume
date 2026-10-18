import { useEffect, useMemo, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { DiscordSDK } from '@discord/embedded-app-sdk';

type Stream = { roomId: string; title: string };
const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID as string | undefined;

export default function ActivityPage() {
  const [instance, setInstance] = useState<string | null>(null);
  const [sdk, setSdk] = useState<DiscordSDK | null>(null);
  const [connection, setConnection] = useState<Socket | null>(null);
  const [streams, setStreams] = useState<Stream[]>([]);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const external = useMemo(() => (import.meta.env.VITE_PUBLIC_URL as string | undefined)?.replace(/\/$/, '') || location.origin, []);

  useEffect(() => {
    if (!clientId) { setError('VITE_DISCORD_CLIENT_ID não configurado na Vercel.'); return; }
    const discord = new DiscordSDK(clientId);
    let cancelled = false;
    discord.ready().then(() => { if (!cancelled) { setSdk(discord); setInstance(discord.instanceId); } })
      .catch(() => { if (!cancelled) setError('Abra o Lume como Activity dentro de uma chamada Discord.'); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!instance) return;
    const s = io(import.meta.env.VITE_BACKEND_URL || undefined, { transports: ['websocket'], reconnection: true });
    setConnection(s);
    s.on('connect', () => s.emit('activity:join', instance, (r: { ok: boolean; streams?: Stream[] }) => {
      if (r.ok) setStreams(r.streams || []);
      else setError('Falha ao entrar na sessão.');
    }));
    s.on('activity:streams', setStreams);
    s.on('connect_error', () => setError('Não foi possível conectar ao Render. Verifique o WebSocket e os URL Mappings.'));
    return () => { s.disconnect(); setConnection(null); };
  }, [instance]);

  function launchBroadcaster() {
    if (!instance) return;
    const url = `${external}/?activity_instance=${encodeURIComponent(instance)}`;
    if (sdk) sdk.commands.openExternalLink({ url }).catch(() => setError('Abra no navegador externo: ' + url));
    else window.open(url, '_blank', 'noopener,noreferrer');
  }

  return <main className="activity">
    <header><div><h1>LUME <span>ACTIVITY</span></h1><p>Transmissões disponíveis automaticamente nesta chamada.</p></div><button onClick={launchBroadcaster} disabled={!instance}>+ Transmitir tela</button></header>
    {error && <p className="activity-error" role="alert">{error}</p>}
    {!instance && !error && <p>Conectando ao Discord...</p>}
    <section className={'activity-grid ' + (selected ? 'activity-focused' : '')}>
      {streams.filter(s => !selected || selected === s.roomId).map(s => <article className="activity-tile" key={s.roomId}>
        <div className="activity-tile-bar"><strong>{s.title}</strong><div><button onClick={() => setSelected(selected === s.roomId ? null : s.roomId)}>{selected === s.roomId ? 'Grade' : 'Ampliar'}</button></div></div>
        <iframe title={s.title} src={'/r/' + encodeURIComponent(s.roomId)} allow="autoplay; fullscreen" allowFullScreen />
      </article>)}
      {streams.length === 0 && <div className="activity-empty">Ninguém está transmitindo. Clique em “Transmitir tela”, selecione a tela na janela do navegador e inicie a transmissão. Ela aparecerá aqui automaticamente.</div>}
    </section>
    <p className="activity-tip">Até quatro transmissões por chamada. Cada tela tem seus próprios controles de qualidade. A captura abre no navegador externo por restrições do Discord.</p>
    {!connection && instance && <p className="activity-error">Aguardando conexão com servidor...</p>}
  </main>;
}
