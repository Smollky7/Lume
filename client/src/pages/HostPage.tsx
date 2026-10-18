import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Icon, Logo } from '../components/Icons';
import { useToast } from '../components/Toasts';
import { HostBroadcaster } from '../lib/host';
import {
  AudioMixer,
  RES,
  captureScreen,
  captureSupported,
  describeCaptureError,
  describeMicError,
  loadSettings,
  saveSettings,
  supportedCodecs,
  targetBitrate,
} from '../lib/media';
import type { CaptureSettings, CodecPref, Fps, Resolution, ViewerInfo } from '../lib/types';

type Phase = 'idle' | 'preview' | 'live';

const CODEC_LABEL: Record<CodecPref, string> = {
  auto: 'Automático',
  h264: 'H.264 (GPU na maioria dos PCs)',
  vp9: 'VP9',
  av1: 'AV1 (mais eficiente, mais pesado)',
  vp8: 'VP8',
};

const isLocalOrigin = () => /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[::1\])/.test(location.hostname);

export default function HostPage() {
  const toast = useToast();
  const [settings, setSettings] = useState<CaptureSettings>(loadSettings);
  const [phase, setPhase] = useState<Phase>('idle');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [hasSystemAudio, setHasSystemAudio] = useState(false);
  const [micOn, setMicOn] = useState(false);
  const [paused, setPaused] = useState(false);
  const [password, setPassword] = useState('');
  const [roomId, setRoomId] = useState('');
  const [viewers, setViewers] = useState<ViewerInfo[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [reconnecting, setReconnecting] = useState(false);
  const [hasTurn, setHasTurn] = useState(true);
  const [copied, setCopied] = useState(false);
  const [joinInput, setJoinInput] = useState('');
  const [publicBase, setPublicBase] = useState(() => localStorage.getItem('lume:publicBase') ?? '');

  const videoRef = useRef<HTMLVideoElement>(null);
  const mixerRef = useRef<AudioMixer | null>(null);
  const bcRef = useRef<HostBroadcaster | null>(null);
  const codecs = useMemo(() => supportedCodecs(), []);

  useEffect(() => {
    if (videoRef.current) videoRef.current.srcObject = stream;
  }, [stream, phase]);

  useEffect(() => saveSettings(settings), [settings]);

  // Fecha tudo se a aba do anfitrião for fechada.
  useEffect(() => {
    const onUnload = () => bcRef.current?.end();
    window.addEventListener('pagehide', onUnload);
    return () => window.removeEventListener('pagehide', onUnload);
  }, []);

  const releaseCapture = useCallback(() => {
    stream?.getTracks().forEach((t) => t.stop());
    mixerRef.current?.close();
    mixerRef.current = null;
    setStream(null);
  }, [stream]);

  const pickScreen = useCallback(async () => {
    setError('');
    setBusy(true);
    try {
      stream?.getTracks().forEach((t) => t.stop());
      mixerRef.current?.close();
      const { stream: display, level } = await captureScreen(settings);
      if (level > 0) {
        toast(
          'warn',
          level === 1
            ? 'O navegador recusou o pedido completo; a captura abriu em modo simplificado (resolução/FPS podem diferir do escolhido).'
            : 'A captura só abriu em modo mínimo, sem áudio do sistema.',
        );
      }
      const mixer = new AudioMixer();
      await mixer.resume();
      const gotAudio = mixer.attachSystem(display);
      mixerRef.current = mixer;
      setHasSystemAudio(gotAudio);
      if (settings.systemAudio && !gotAudio) {
        toast(
          'warn',
          'O navegador não entregou áudio do sistema. Marque "Compartilhar áudio" no seletor — no Windows isso funciona para Tela inteira e Abas (não para janelas).',
        );
      }
      if (settings.mic) {
        try {
          await mixer.setMic(true);
          setMicOn(true);
        } catch (e) {
          toast('error', describeMicError(e));
          setMicOn(false);
          setSettings((s) => ({ ...s, mic: false }));
        }
      } else setMicOn(false);
      display.getVideoTracks()[0].addEventListener('ended', () => {
        if (bcRef.current) bcRef.current.captureEnded();
        else {
          mixer.close();
          setStream(null);
          setPhase('idle');
          toast('info', 'Captura encerrada.');
        }
      });
      setStream(display);
      setPhase((p) => (p === 'live' ? p : 'preview'));
    } catch (e) {
      setError(describeCaptureError(e));
    } finally {
      setBusy(false);
    }
  }, [settings, stream, toast]);

  const startBroadcast = useCallback(async () => {
    if (!stream || !mixerRef.current) return;
    setBusy(true);
    setError('');
    try {
      const bc = new HostBroadcaster(stream, mixerRef.current, settings, {
        onViewers: setViewers,
        onNotify: toast,
        onStatus: (s) => {
          setReconnecting(s === 'reconnecting');
          if (s === 'ended') {
            bcRef.current = null;
            setPhase('idle');
            setStream(null);
            setRoomId('');
            setViewers([]);
            setPaused(false);
            mixerRef.current = null;
          }
        },
      });
      const id = await bc.start(password || undefined);
      bcRef.current = bc;
      setHasTurn(bc.hasTurn);
      setRoomId(id);
      setPhase('live');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao iniciar a transmissão.');
    } finally {
      setBusy(false);
    }
  }, [stream, settings, password, toast]);

  const endBroadcast = () => {
    bcRef.current?.end();
  };

  const togglePause = () => {
    const next = !paused;
    setPaused(next);
    bcRef.current?.setPaused(next);
  };

  const updateSettings = async (patch: Partial<CaptureSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    const track = stream?.getVideoTracks()[0];
    if (!track) return;
    if (bcRef.current) {
      await bcRef.current.updateSettings(next);
    } else if ('resolution' in patch || 'fps' in patch) {
      const { w, h } = RES[next.resolution];
      try {
        await track.applyConstraints({ width: { ideal: w }, height: { ideal: h }, frameRate: { ideal: next.fps, max: next.fps } });
      } catch {
        toast('warn', 'Para aplicar essa resolução, escolha a tela novamente.');
      }
    }
    if ('content' in patch) track.contentHint = next.content === 'detail' ? 'detail' : 'motion';
  };

  const toggleMic = async () => {
    const mixer = mixerRef.current;
    const next = !micOn;
    if (!mixer) {
      setSettings((s) => ({ ...s, mic: next }));
      setMicOn(next);
      return;
    }
    try {
      await mixer.setMic(next);
      setMicOn(next);
      setSettings((s) => ({ ...s, mic: next }));
    } catch (e) {
      toast('error', describeMicError(e));
    }
  };

  const base = (publicBase.trim() || location.origin).replace(/\/+$/, '');
  const link = roomId ? `${base}/r/${roomId}` : '';
  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      toast('warn', 'Não consegui copiar automaticamente — selecione o link e copie.');
    }
  };

  const openRoom = () => {
    const m = joinInput.trim().match(/(?:\/r\/)?([\w-]{6,})\/?$/);
    if (m) location.href = `/r/${m[1]}`;
  };

  const live = phase === 'live';
  const totalKbps = viewers.reduce((a, v) => a + (v.stats?.bitrateKbps ?? 0), 0);
  const settingsReady = captureSupported();
  const bitrateMbps = (targetBitrate(settings.resolution, settings.fps) / 1e6).toFixed(1);

  return (
    <div className="app">
      <header className="topbar">
        <Logo />
        <div className="topbar-right">
          <form
            className="joinbox"
            onSubmit={(e) => {
              e.preventDefault();
              openRoom();
            }}
          >
            <input value={joinInput} onChange={(e) => setJoinInput(e.target.value)} placeholder="Assistir: cole o link ou código" aria-label="Link ou código da sala" />
          </form>
          <span className={`pill ${live ? (reconnecting ? 'pill-warn' : 'pill-live') : ''}`}>
            <i className="dot" />
            {live ? (reconnecting ? 'Reconectando' : 'Ao vivo') : 'Offline'}
          </span>
        </div>
      </header>

      <main className="studio">
        <section className="stage" aria-label="Pré-visualização">
          {stream ? (
            <>
              <video ref={videoRef} autoPlay muted playsInline className={paused ? 'dim' : ''} />
              <div className="stage-badges">
                <span className="badge">{live ? 'Transmitindo' : 'Pré-visualização'}</span>
                {paused && <span className="badge badge-warn">Pausado</span>}
              </div>
            </>
          ) : (
            <div className="stage-empty">
              <div className="ring" />
              <h1>Transmita sua tela</h1>
              <p>Escolha uma tela, janela ou aba, confira a prévia e envie o link para quem vai assistir. Nada é capturado antes da sua autorização.</p>
              {!settingsReady && <p className="warnline">Este navegador não permite compartilhar tela. Use Chrome, Edge ou Firefox em um computador.</p>}
              {!window.isSecureContext && (
                <p className="warnline">A captura exige HTTPS ou localhost. Abra pelo endereço do túnel (https) ou por http://localhost:3000.</p>
              )}
              <button className="btn btn-primary btn-lg" onClick={pickScreen} disabled={busy || !settingsReady}>
                <Icon name="monitor" /> Escolher tela
              </button>
            </div>
          )}
        </section>

        <aside className="panel">
          {error && <div className="alert alert-error">{error}</div>}

          <div className="card">
            <h2>Qualidade</h2>
            <div className="field">
              <label>Resolução</label>
              <div className="seg">
                {(Object.keys(RES) as Resolution[]).map((r) => (
                  <button key={r} className={settings.resolution === r ? 'on' : ''} onClick={() => updateSettings({ resolution: r })}>
                    {RES[r].label}
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label>Quadros por segundo</label>
              <div className="seg">
                {([30, 60] as Fps[]).map((f) => (
                  <button key={f} className={settings.fps === f ? 'on' : ''} onClick={() => updateSettings({ fps: f })}>
                    {f} FPS
                  </button>
                ))}
              </div>
            </div>
            <div className="field">
              <label>Prioridade</label>
              <div className="seg">
                <button className={settings.content === 'motion' ? 'on' : ''} onClick={() => updateSettings({ content: 'motion' })}>
                  Fluidez (jogos/vídeo)
                </button>
                <button className={settings.content === 'detail' ? 'on' : ''} onClick={() => updateSettings({ content: 'detail' })}>
                  Nitidez (texto)
                </button>
              </div>
            </div>
            <div className="field">
              <label htmlFor="codec">Codec de vídeo</label>
              <select id="codec" value={settings.codec} disabled={live} onChange={(e) => updateSettings({ codec: e.target.value as CodecPref })}>
                {codecs.map((c) => (
                  <option key={c} value={c}>
                    {CODEC_LABEL[c]}
                  </option>
                ))}
              </select>
            </div>
            <p className="hint">
              Teto de {bitrateMbps} Mbps por espectador; o WebRTC reduz sozinho se a rede não aguentar. 1440p/4K dependem da sua tela e do
              upload.
            </p>
          </div>

          <div className="card">
            <h2>Áudio</h2>
            <label className="switch">
              <input
                type="checkbox"
                checked={settings.systemAudio}
                disabled={!!stream}
                onChange={(e) => setSettings({ ...settings, systemAudio: e.target.checked })}
              />
              <span>Áudio do sistema</span>
              <small>
                {stream
                  ? hasSystemAudio
                    ? 'capturando'
                    : 'não disponível nesta captura'
                  : 'pedido na hora de escolher a tela'}
              </small>
            </label>
            <label className="switch">
              <input type="checkbox" checked={micOn || (!stream && settings.mic)} onChange={toggleMic} />
              <span>
                <Icon name={micOn ? 'mic' : 'micOff'} size={15} /> Microfone
              </span>
              <small>{micOn ? 'ligado' : 'desligado'}</small>
            </label>
          </div>

          {!live && (
            <div className="card">
              <h2>Sala</h2>
              <div className="field">
                <label htmlFor="pw">
                  <Icon name="lock" size={14} /> Senha (opcional)
                </label>
                <input id="pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Sem senha" autoComplete="off" />
              </div>
              {isLocalOrigin() && (
                <div className="field">
                  <label htmlFor="pub">Endereço público para o convite</label>
                  <input
                    id="pub"
                    value={publicBase}
                    onChange={(e) => {
                      setPublicBase(e.target.value);
                      localStorage.setItem('lume:publicBase', e.target.value);
                    }}
                    placeholder="https://algo.trycloudflare.com"
                  />
                  <p className="hint">Você abriu pelo endereço local. Cole aqui a URL do túnel — ou abra o app direto por ela.</p>
                </div>
              )}
            </div>
          )}

          {live && (
            <div className="card card-live">
              <h2>Convite</h2>
              <div className="linkrow">
                <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Link da sala" />
                <button className="btn" onClick={copyLink}>
                  <Icon name="copy" size={16} /> {copied ? 'Copiado' : 'Copiar'}
                </button>
              </div>
              {isLocalOrigin() && !publicBase && <p className="hint warnline">Este link só funciona na sua rede. Use o endereço do túnel para convidar amigos de fora.</p>}
              <div className="stats-row">
                <div>
                  <b>{viewers.length}</b>
                  <span>
                    <Icon name="users" size={13} /> assistindo
                  </span>
                </div>
                <div>
                  <b>{(totalKbps / 1000).toFixed(1)}</b>
                  <span>Mbps enviados</span>
                </div>
              </div>
              {!hasTurn && (
                <p className="hint warnline">
                  Este servidor não tem TURN configurado. Se quem assiste estiver atrás de CGNAT/NAT restrito, o vídeo não conecta (veja o README).
                </p>
              )}
              <ul className="viewers">
                {viewers.length === 0 && <li className="muted">Ninguém conectado ainda.</li>}
                {viewers.map((v) => (
                  <li key={v.id}>
                    <div className="v-head">
                      <strong>{v.name}</strong>
                      <span className={`tag ${v.connection === 'connected' ? 'tag-ok' : 'tag-warn'}`}>
                        {v.connection === 'connected' ? 'conectado' : v.connection === 'new' ? 'iniciando' : v.connection === 'connecting' ? 'conectando' : 'instável'}
                      </span>
                    </div>
                    {v.connection !== 'connected' && Date.now() - v.since > 15000 && (
                      <div className="v-stats">
                        <span className="warnline">
                          Sem vídeo para {v.name} há mais de 15 s{hasTurn ? '.' : ': provável NAT/CGNAT — configure um servidor TURN.'}
                        </span>
                      </div>
                    )}
                    {v.stats && (
                      <div className="v-stats">
                        <span>{v.stats.route === 'relay' ? 'via TURN' : v.stats.route === 'direct' ? 'direto' : '—'}</span>
                        <span>{v.stats.rttMs !== null ? `${Math.round(v.stats.rttMs)} ms` : '— ms'}</span>
                        <span>{(v.stats.bitrateKbps / 1000).toFixed(1)} Mbps</span>
                        <span>{v.stats.fps ? `${Math.round(v.stats.fps)} fps` : '— fps'}</span>
                        <span>{v.stats.resolution ?? '—'}</span>
                        <span>{v.stats.codec ?? '—'}</span>
                        <span title={v.stats.encoder ?? ''}>{v.stats.hardware ? 'GPU' : 'CPU'}</span>
                        {v.stats.limited && <span className="warnline">limitado: {v.stats.limited}</span>}
                        {v.stats.lossPct !== null && v.stats.lossPct > 1 && <span className="warnline">perda {v.stats.lossPct.toFixed(1)}%</span>}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}

          <div className="actions">
            {phase === 'idle' && (
              <button className="btn btn-primary btn-block" onClick={pickScreen} disabled={busy || !settingsReady}>
                <Icon name="monitor" /> Escolher tela
              </button>
            )}
            {phase === 'preview' && (
              <>
                <button className="btn btn-primary btn-block" onClick={startBroadcast} disabled={busy}>
                  <Icon name="play" size={16} /> Iniciar transmissão
                </button>
                <button className="btn btn-block" onClick={pickScreen} disabled={busy}>
                  <Icon name="swap" size={16} /> Trocar tela
                </button>
                <button className="btn btn-ghost btn-block" onClick={() => { releaseCapture(); setPhase('idle'); }}>
                  Cancelar
                </button>
              </>
            )}
            {live && (
              <>
                <button className="btn btn-block" onClick={togglePause}>
                  <Icon name={paused ? 'play' : 'pause'} size={16} /> {paused ? 'Retomar' : 'Pausar'}
                </button>
                <button className="btn btn-danger btn-block" onClick={endBroadcast}>
                  <Icon name="stop" size={16} /> Encerrar transmissão
                </button>
              </>
            )}
          </div>
        </aside>
      </main>
    </div>
  );
}
