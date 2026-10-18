import { useEffect, useMemo, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import { DiscordSDK } from '@discord/embedded-app-sdk';

type Stream = { roomId: string; title: string };
const clientId = import.meta.env.VITE_DISCORD_CLIENT_ID as string | undefined;
const isDiscord = new URLSearchParams(location.search).has('frame_id');

export default function ActivityPage() {
  const [instance, setInstance] = useState<string | null>(null);
  const [sdk, setSdk] = useState<DiscordSDK | null>(null);
  const [connection, setConnection] = useState<Socket | null>(null);
  const [streams, setStreams] = useState<Stream[]>([]);
  const [room, setRoom] = useState('');
  const [title, setTitle] = useState('Minha tela');
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const external = useMemo(() => (import.meta.env.VITE_PUBLIC_URL as string | undefined)?.replace(/\/$/, '') || location.origin, []);

  useEffect(() => {
    if (!clientId) { setError('Configure VITE_DISCORD_CLIENT_ID antes de compilar.'); return; }
    const discord = new DiscordSDK(clientId);
    let cancelled = false;
    discord.ready().then(() => {
      if (cancelled) return;
      setSdk(discord);
      setInstance(discord.instanceId);
    }).catch(() => { if (!cancelled) setError('Abra esta página como Activity dentro do Discord.'); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!instance) return;
    const s = io({ transports: ['polling', 'websocket'] });
    setConnection(s);
    s.on('connect', () => s.emit('activity:join', instance, (r: { ok: boolean; streams?: Stream[] }) => {
      if (r.ok) setStreams(r.streams || []);
    }));
    s.on('activity:streams', setStreams);
    return () => { s.disconnect(); setConnection(null); };
  }, [instance]);

  function extractRoom(text: string): string {
    const m = text.match(/\/r\/([\w-]+)/);
    return (m ? m[1] : text).trim();
  }
  function add() {
    if (!connection) return;
    connection.emit('activity:add', { roomId: extractRoom(room), title }, (r: { ok: boolean; error?: string }) => {
      if (r.ok) { setRoom(''); setError(''); }
      else setError(r.error === 'activity_full' ? 'Máximo de quatro telas.' : 'Sala inválida, encerrada ou protegida por senha.');
    });
  }
  function launchBroadcaster() {
    const url = external + '/';
    if (sdk) sdk.commands.openExternalLink({ url }).catch(() => setError('Não foi possível abrir o navegador externo.'));
    else window.open(url, '_blank', 'noopener,noreferrer');
  }
  if (!isDiscord && !instance) return <main className="activity"><h1>Lume Activity</h1><p>Inicie esta Activity em uma chamada de voz do Discord. Para transmitir, abra o Lume em seu navegador normal.</p><p>{error}</p></main>;
  return <main className="activity">
    <header><div><h1>LUME <span>ACTIVITY</span></h1><p>Assista a até quatro telas na sua chamada do Discord.</p></div><button onClick={launchBroadcaster}>+ Transmitir no navegador</button></header>
    {error && <p className="activity-error" role="alert">{error}</p>}
    <section className="activity-add"><input aria-label="Link da sala" placeholder="Cole o link da sua transmissão" value={room} onChange={e => setRoom(e.target.value)} /><input aria-label="Nome da tela" placeholder="Nome da tela" value={title} maxLength={24} onChange={e => setTitle(e.target.value)} /><button onClick={add} disabled={!instance || !room.trim()}>Adicionar tela</button></section>
    <p className="activity-tip">Quem transmite: abra o Lume fora do Discord, inicie a captura, copie o link da sala e adicione acima. As salas precisam estar sem senha. Use fones para evitar áudio duplicado.</p>
    <section className={'activity-grid ' + (selected ? 'activity-focused' : '')}>
      {streams.map(s => (!selected || selected === s.roomId) && <article className="activity-tile" key={s.roomId}><div className="activity-tile-bar"><strong>{s.title}</strong><div><button onClick={() => setSelected(selected === s.roomId ? null : s.roomId)}>{selected === s.roomId ? 'Grade' : 'Ampliar'}</button><button onClick={() => connection?.emit('activity:remove', s.roomId)}>Remover</button></div></div><iframe title={s.title} src={'/r/' + encodeURIComponent(s.roomId)} allow="autoplay; fullscreen" allowFullScreen /></article>)}
      {streams.length === 0 && <div className="activity-empty">Nenhuma tela compartilhada. Inicie uma transmissão e adicione o link acima.</div>}
    </section>
    <p className="activity-tip">Cada tela tem controles próprios de qualidade, áudio e reprodução. Clique em “Assistir” dentro de cada tela.</p>
  </main>;
}
