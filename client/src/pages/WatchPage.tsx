import { useCallback, useEffect, useRef, useState } from 'react';
import { Icon, Logo } from '../components/Icons';
import { useToast } from '../components/Toasts';
import type { QualityChoice } from '../lib/types';
import { ViewerClient, type EndReason, type ViewerStats, type ViewerStatus } from '../lib/viewer';

const FATAL: Record<EndReason, string> = {
  host_ended: 'A transmissão foi encerrada pelo anfitrião.',
  host_gone: 'O anfitrião perdeu a conexão e a sala foi fechada.',
  not_found: 'Sala não encontrada. O link pode estar errado ou a transmissão já terminou.',
  bad_password: 'Senha incorreta.',
  room_full: 'A sala está cheia.',
  rate_limited: 'Muitas tentativas. Aguarde um minuto e tente de novo.',
  error: 'Não foi possível entrar na sala.',
};

const STATUS_TEXT: Record<ViewerStatus, string> = {
  connecting: 'Conectando ao servidor…',
  waiting: 'Estabelecendo a conexão de vídeo…',
  live: 'Ao vivo',
  paused: 'Transmissão pausada pelo anfitrião',
  reconnecting: 'Reconectando…',
  'host-offline': 'O anfitrião perdeu a conexão. Aguardando…',
  stalled:
    'Não consegui abrir o vídeo direto entre você e o anfitrião. Isso costuma ser NAT/CGNAT da operadora e exige um servidor TURN configurado no servidor do Lume (veja o README). Continuo tentando…',
  ended: 'Encerrado',
};

export default function WatchPage({ roomId }: { roomId: string }) {
  const toast = useToast();
  const [info, setInfo] = useState<{ exists: boolean; protected?: boolean } | null>(null);
  const [name, setName] = useState(() => localStorage.getItem('lume:name') ?? '');
  const [password, setPassword] = useState('');
  const [joined, setJoined] = useState(false);
  const [status, setStatus] = useState<ViewerStatus>('connecting');
  const [fatal, setFatal] = useState<EndReason | null>(null);
  const [count, setCount] = useState(1);
  const [stats, setStats] = useState<ViewerStats | null>(null);
  const [hasStream, setHasStream] = useState(false);
  const [needsTap, setNeedsTap] = useState(false);
  const [volume, setVolume] = useState(1);
  const [muted, setMuted] = useState(false);
  const [quality, setQuality] = useState<QualityChoice>('source');
  const [fs, setFs] = useState(false);
  const [showUi, setShowUi] = useState(true);

  const clientRef = useRef<ViewerClient | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<number>();

  useEffect(() => {
    let alive = true;
    fetch(`/api/rooms/${encodeURIComponent(roomId)}`)
      .then((r) => r.json())
      .then((j) => alive && setInfo(j))
      .catch(() => alive && setInfo({ exists: true }));
    return () => {
      alive = false;
    };
  }, [roomId]);

  useEffect(() => () => clientRef.current?.leave(), []);

  useEffect(() => {
    const onFs = () => setFs(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);

  const join = useCallback(() => {
    localStorage.setItem('lume:name', name);
    setFatal(null);
    const client = new ViewerClient(roomId, name.trim() || 'Convidado', password || undefined, {
      onStatus: setStatus,
      onStream: (s) => {
        const v = videoRef.current;
        if (!v) return;
        v.srcObject = s;
        setHasStream(true);
        v.play().catch(() => setNeedsTap(true));
      },
      onViewers: setCount,
      onStats: setStats,
      onNotify: toast,
      onFatal: (r) => {
        setFatal(r);
        if (r === 'bad_password') setJoined(false);
      },
    });
    clientRef.current?.leave();
    clientRef.current = client;
    setJoined(true);
    client.connect();
  }, [name, password, roomId, toast]);

  const bump = () => {
    setShowUi(true);
    window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setShowUi(false), 2800);
  };

  const toggleFs = async () => {
    const box = boxRef.current;
    const v = videoRef.current as (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else if (box?.requestFullscreen) await box.requestFullscreen();
      else v?.webkitEnterFullscreen?.(); // iOS Safari
    } catch {
      /* ignore */
    }
  };

  const changeVolume = (val: number) => {
    setVolume(val);
    setMuted(val === 0);
    if (videoRef.current) {
      videoRef.current.volume = val;
      videoRef.current.muted = val === 0;
    }
  };
  const toggleMute = () => {
    const next = !muted;
    setMuted(next);
    if (videoRef.current) videoRef.current.muted = next;
  };
  const changeQuality = (q: QualityChoice) => {
    setQuality(q);
    clientRef.current?.setQuality(q);
  };

  const latency = stats?.latencyMs ?? null;
  const health: 'good' | 'ok' | 'bad' =
    status !== 'live' ? 'bad' : (stats?.lossPct ?? 0) > 5 || (latency ?? 0) > 600 ? 'bad' : (stats?.lossPct ?? 0) > 1.5 || (latency ?? 0) > 300 ? 'ok' : 'good';

  const showGate = !joined || fatal === 'bad_password';
  const dead = fatal && fatal !== 'bad_password';

  if (info && !info.exists && !joined) {
    return (
      <div className="app center">
        <Logo />
        <div className="gate">
          <h1>Sala não encontrada</h1>
          <p>O link está incorreto ou a transmissão já terminou.</p>
          <a className="btn" href="/">
            Voltar ao início
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="app watch">
      <header className="topbar">
        <a href="/" className="brandlink">
          <Logo />
        </a>
        {joined && !dead && (
          <div className="topbar-right">
            <span className="pill">
              <Icon name="users" size={14} /> {count}
            </span>
            <span className={`pill ${status === 'live' ? 'pill-live' : 'pill-warn'}`}>
              <i className="dot" /> {status === 'live' ? 'Ao vivo' : status === 'stalled' ? 'Sem rota de vídeo' : STATUS_TEXT[status]}
            </span>
          </div>
        )}
      </header>

      {showGate && !dead && (
        <div className="gate">
          <h1>Entrar na transmissão</h1>
          <p>Você vai assistir a tela compartilhada pelo anfitrião.</p>
          {fatal === 'bad_password' && <div className="alert alert-error">{FATAL.bad_password}</div>}
          <div className="field">
            <label htmlFor="nick">Seu apelido</label>
            <input id="nick" value={name} maxLength={24} onChange={(e) => setName(e.target.value)} placeholder="Convidado" />
          </div>
          {(info?.protected || fatal === 'bad_password') && (
            <div className="field">
              <label htmlFor="pw">
                <Icon name="lock" size={14} /> Senha da sala
              </label>
              <input id="pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" />
            </div>
          )}
          <button className="btn btn-primary btn-block btn-lg" onClick={join}>
            <Icon name="play" size={16} /> Entrar e assistir
          </button>
        </div>
      )}

      {dead && (
        <div className="gate">
          <h1>{fatal === 'host_ended' ? 'Transmissão encerrada' : 'Não foi possível assistir'}</h1>
          <p>{FATAL[fatal]}</p>
          <a className="btn" href="/">
            Voltar ao início
          </a>
        </div>
      )}

      {joined && !dead && (
        <div ref={boxRef} className={`player ${showUi || !hasStream ? 'ui' : ''}`} onMouseMove={bump} onTouchStart={bump} onDoubleClick={toggleFs}>
          <video ref={videoRef} autoPlay playsInline className={status === 'paused' ? 'dim' : ''} onClick={bump} />

          {(!hasStream || status !== 'live') && (
            <div className="overlay">
              {status !== 'paused' && status !== 'live' && <div className="spinner" />}
              {status === 'stalled' && <strong>Sem rota de vídeo</strong>}
              <p>{status === 'live' && !hasStream ? 'Aguardando vídeo…' : STATUS_TEXT[status]}</p>
            </div>
          )}

          {needsTap && (
            <button
              className="overlay tapplay"
              onClick={() => {
                void videoRef.current?.play();
                setNeedsTap(false);
              }}
            >
              <Icon name="play" size={34} />
              <span>Toque para reproduzir</span>
            </button>
          )}

          <div className="controls">
            <div className="ctl-left">
              <button className="icon-btn" onClick={toggleMute} aria-label={muted ? 'Ativar som' : 'Silenciar'}>
                <Icon name={muted || volume === 0 ? 'mute' : 'volume'} />
              </button>
              <input
                className="vol"
                type="range"
                min={0}
                max={1}
                step={0.02}
                value={muted ? 0 : volume}
                onChange={(e) => changeVolume(Number(e.target.value))}
                aria-label="Volume"
              />
            </div>
            <div className="ctl-right">
              <span className={`health health-${health}`} title={stats ? `Ping ${stats.rttMs !== null ? Math.round(stats.rttMs) : '—'} ms · perda ${stats?.lossPct?.toFixed(1) ?? '—'}% · ${stats.route === 'relay' ? 'via TURN' : 'direto'}` : ''}>
                <Icon name="signal" size={15} />
                {latency !== null ? `${latency} ms` : '—'}
                {stats && <em>{(stats.bitrateKbps / 1000).toFixed(1)} Mbps · {stats.fps ? Math.round(stats.fps) : '—'} fps · {stats.resolution ?? '—'}</em>}
              </span>
              <select value={quality} onChange={(e) => changeQuality(e.target.value as QualityChoice)} aria-label="Qualidade">
                <option value="source">Original</option>
                <option value="720">720p</option>
                <option value="480">480p</option>
                <option value="360">360p</option>
              </select>
              <button className="icon-btn" onClick={toggleFs} aria-label="Tela cheia">
                <Icon name={fs ? 'exitFullscreen' : 'fullscreen'} />
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
