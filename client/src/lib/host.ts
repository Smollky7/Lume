import type { Socket } from 'socket.io-client';
import { AudioMixer, RES, codecMime, targetBitrate } from './media';
import { createSocket, emitAck } from './socket';
import type { CaptureSettings, IceServerCfg, PeerStats, QualityChoice, ToastKind, ViewerInfo } from './types';
import { isRelayPair, logWebRtcFailure, pairRttMs, tuneOpus } from './webrtc';

interface Peer {
  id: string;
  name: string;
  pc: RTCPeerConnection;
  dc?: RTCDataChannel;
  vSender?: RTCRtpSender;
  quality: QualityChoice;
  createdAt: number;
  queue: Promise<void>;
  pendingCandidates: RTCIceCandidateInit[];
  lastBytes: number;
  lastTs: number;
  stats?: PeerStats;
  restartTimer?: number;
}

export interface HostHandlers {
  onViewers(list: ViewerInfo[]): void;
  onNotify(kind: ToastKind, text: string): void;
  onStatus(status: 'live' | 'reconnecting' | 'ended'): void;
}

const HW_RE = /media ?foundation|videotoolbox|vaapi|nvenc|nvidia|quicksync|amf|externalencoder|hardware|mediacodec/i;

/**
 * Transmite a tela para cada espectador por uma conexão WebRTC própria (P2P).
 * Um único MediaStream (vídeo + áudio misturado) mantém A/V sincronizado.
 */
export class HostBroadcaster {
  private socket: Socket = createSocket();
  private peers = new Map<string, Peer>();
  private iceServers: IceServerCfg[] = [];
  private out: MediaStream;
  private video: MediaStreamTrack;
  private statsTimer?: number;
  private ended = false;
  private everConnected = false;
  private resuming = false;
  roomId = '';
  /** true se o servidor entregou ao menos um servidor TURN (relay) na lista ICE. */
  hasTurn = false;
  private hostToken = '';
  private password?: string;

  constructor(
    private display: MediaStream,
    private mixer: AudioMixer,
    private settings: CaptureSettings,
    private h: HostHandlers,
  ) {
    this.video = display.getVideoTracks()[0];
    this.out = new MediaStream([this.video, mixer.track]);
  }

  async start(password?: string): Promise<string> {
    this.password = password;
    try {
      await new Promise<void>((resolve, reject) => {
        const t = window.setTimeout(() => reject(new Error('Não foi possível conectar ao servidor de sinalização.')), 10000);
        this.socket.once('connect', () => {
          window.clearTimeout(t);
          resolve();
        });
        if (this.socket.connected) {
          window.clearTimeout(t);
          resolve();
        }
      });
      const res = await emitAck<{ ok: boolean; roomId?: string; hostToken?: string; iceServers?: IceServerCfg[]; turn?: boolean; error?: string }>(
        this.socket,
        'room:create',
        { password },
      );
      if (!res.ok || !res.roomId || !res.hostToken) {
        throw new Error(res.error === 'rate_limited' ? 'Muitas salas criadas. Aguarde um minuto.' : 'Falha ao criar a sala.');
      }
      this.roomId = res.roomId;
      this.hostToken = res.hostToken;
      this.iceServers = res.iceServers ?? [];
      this.hasTurn = !!res.turn;
      this.everConnected = true;
      this.bind();
      await this.publishToActivity();
      this.statsTimer = window.setInterval(() => void this.pollStats(), 2000);
      this.h.onStatus('live');
      return this.roomId;
    } catch (error) {
      this.socket.emit('room:end');
      this.socket.removeAllListeners();
      this.socket.disconnect();
      throw error;
    }
  }

  private bind() {
    const s = this.socket;
    s.on('viewer:joined', (v: { id: string; name: string }) => {
      this.h.onNotify('success', `${v.name} entrou na sala`);
      this.createPeer(v.id, v.name);
    });
    s.on('viewer:left', (v: { id: string; name: string }) => {
      this.h.onNotify('info', `${v.name} saiu`);
      this.closePeer(v.id);
      this.emitViewers();
    });
    s.on('signal', (msg: { from: string; data: any }) => {
      const peer = this.peers.get(msg.from);
      if (!peer) return;
      peer.queue = peer.queue.then(() => this.handleSignal(peer, msg.data)).catch((error: unknown) => {
        logWebRtcFailure('host.signal', error);
      });
    });
    s.on('disconnect', () => {
      if (this.ended) return;
      this.h.onStatus('reconnecting');
      this.h.onNotify('warn', 'Conexão com o servidor perdida. Reconectando…');
    });
    s.on('room:replaced', () => this.finish('A sala foi retomada por outra conexão.'));
    s.on('connect', () => {
      if (!this.everConnected || this.ended || !this.roomId) return;
      void this.resume();
    });
  }

  private async resume() {
    if (this.resuming || this.ended) return;
    this.resuming = true;
    try {
      const res = await emitAck<{ ok: boolean; hostToken?: string; viewers?: { id: string; name: string }[]; iceServers?: IceServerCfg[] }>(
        this.socket,
        'room:resume',
        { roomId: this.roomId, hostToken: this.hostToken },
      );
      if (!res.ok) {
        this.finish('A sala não existe mais no servidor.');
        return;
      }
      if (res.hostToken) this.hostToken = res.hostToken;
      if (res.iceServers) this.iceServers = res.iceServers;
      await this.publishToActivity();
      this.h.onStatus('live');
      this.h.onNotify('success', 'Reconectado ao servidor');
      const alive = new Set((res.viewers ?? []).map((v) => v.id));
      for (const id of [...this.peers.keys()]) if (!alive.has(id)) this.closePeer(id);
      for (const v of res.viewers ?? []) {
        const p = this.peers.get(v.id);
        if (!p || p.pc.connectionState === 'failed' || p.pc.connectionState === 'closed') this.createPeer(v.id, v.name);
      }
      this.emitViewers();
    } catch (error) {
      logWebRtcFailure('host.resume', error);
      this.h.onNotify('error', 'Falha ao retomar a sala.');
    } finally {
      this.resuming = false;
    }
  }

  private async publishToActivity() {
    const instance = new URLSearchParams(location.search).get('activity_instance');
    if (!instance || this.password || !this.roomId) return;
    try {
      const res = await emitAck<{ ok: boolean; error?: string }>(
        this.socket,
        'activity:publish',
        { instanceId: instance, roomId: this.roomId },
      );
      if (!res.ok) {
        this.h.onNotify(
          'warn',
          res.error === 'activity_full'
            ? 'A chamada já tem quatro transmissões.'
            : 'A transmissão iniciou, mas não pôde ser anunciada na Activity.',
        );
      }
    } catch {
      this.h.onNotify('warn', 'A transmissão iniciou, mas o anúncio na Activity não recebeu resposta.');
    }
  }

  // --- Peers -----------------------------------------------------------------

  private createPeer(id: string, name: string) {
    this.closePeer(id);
    const pc = new RTCPeerConnection({ iceServers: this.iceServers, bundlePolicy: 'max-bundle' });
    const peer: Peer = {
      id,
      name,
      pc,
      quality: 'source',
      createdAt: Date.now(),
      queue: Promise.resolve(),
      pendingCandidates: [],
      lastBytes: 0,
      lastTs: 0,
    };
    this.peers.set(id, peer);

    pc.onicecandidate = (e) => {
      if (e.candidate && !this.ended && this.peers.get(id) === peer) {
        this.socket.emit('signal:to-viewer', { to: id, data: { type: 'candidate', candidate: e.candidate.toJSON() } });
      }
    };
    pc.onconnectionstatechange = () => this.onPeerState(peer);

    const dc = pc.createDataChannel('control');
    peer.dc = dc;
    dc.onmessage = (e) => this.onControl(peer, e.data);

    for (const track of this.out.getTracks()) {
      const sender = pc.addTrack(track, this.out);
      if (track.kind === 'video') peer.vSender = sender;
    }
    this.preferCodec(pc, peer.vSender);
    this.enqueueOffer(peer, false);
    this.emitViewers();
  }

  private preferCodec(pc: RTCPeerConnection, sender?: RTCRtpSender) {
    const mime = codecMime(this.settings.codec);
    if (!mime || !sender) return;
    const tr = pc.getTransceivers().find((t) => t.sender === sender);
    const codecs = RTCRtpSender.getCapabilities('video')?.codecs;
    if (!tr || !codecs || !('setCodecPreferences' in tr)) return;
    const first = codecs.filter((c) => c.mimeType.toLowerCase() === mime.toLowerCase());
    if (!first.length) return;
    const rest = codecs.filter((c) => c.mimeType.toLowerCase() !== mime.toLowerCase());
    try {
      tr.setCodecPreferences([...first, ...rest]);
    } catch {
      /* mantém padrão */
    }
  }

  private enqueueOffer(peer: Peer, iceRestart: boolean) {
    peer.queue = peer.queue
      .then(async () => {
        const { pc } = peer;
        if (this.ended || this.peers.get(peer.id) !== peer || pc.signalingState === 'closed') return;
        const offer = await pc.createOffer({ iceRestart });
        if (this.ended || this.peers.get(peer.id) !== peer) return;
        offer.sdp = tuneOpus(offer.sdp ?? '');
        await pc.setLocalDescription(offer);
        if (this.ended || this.peers.get(peer.id) !== peer) return;
        this.socket.emit('signal:to-viewer', { to: peer.id, data: { type: 'offer', sdp: pc.localDescription?.sdp } });
        await this.applySenderParams(peer);
      })
      .catch((error: unknown) => {
        logWebRtcFailure('host.createOffer', error);
      });
  }

  private async handleSignal(peer: Peer, data: any) {
    const { pc } = peer;
    if (!data || pc.signalingState === 'closed') return;
    if (data.type === 'answer') {
      await pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
      await this.flushCandidates(peer);
    } else if (data.type === 'candidate' && data.candidate) {
      if (!pc.remoteDescription) peer.pendingCandidates.push(data.candidate);
      else await this.addCandidate(peer, data.candidate);
    } else if (data.type === 'request-offer') {
      // O espectador perdeu a conexão e pede uma nova negociação do zero.
      this.createPeer(peer.id, peer.name);
    }
  }

  private async flushCandidates(peer: Peer) {
    for (const candidate of peer.pendingCandidates.splice(0)) await this.addCandidate(peer, candidate);
  }

  private async addCandidate(peer: Peer, candidate: RTCIceCandidateInit) {
    if (this.peers.get(peer.id) !== peer || peer.pc.signalingState === 'closed') return;
    try {
      await peer.pc.addIceCandidate(candidate);
    } catch (error) {
      logWebRtcFailure('host.addIceCandidate', error);
    }
  }

  private onPeerState(peer: Peer) {
    const st = peer.pc.connectionState;
    window.clearTimeout(peer.restartTimer);
    if (st === 'disconnected') {
      peer.restartTimer = window.setTimeout(() => {
        if (peer.pc.connectionState !== 'connected') this.enqueueOffer(peer, true);
      }, 4000);
    } else if (st === 'failed') {
      this.enqueueOffer(peer, true);
    }
    this.emitViewers();
  }

  private onControl(peer: Peer, raw: unknown) {
    let msg: any;
    try {
      msg = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (msg.t === 'ping') {
      if (peer.dc?.readyState === 'open') peer.dc.send(JSON.stringify({ t: 'pong', ts: msg.ts }));
    } else if (msg.t === 'quality' && ['source', '720', '480', '360'].includes(msg.value)) {
      peer.quality = msg.value;
      void this.applySenderParams(peer);
      this.emitViewers();
    }
  }

  private async applySenderParams(peer: Peer) {
    const sender = peer.vSender;
    if (!sender) return;
    try {
      const p = sender.getParameters();
      if (!p.encodings || !p.encodings.length) p.encodings = [{}];
      const full = targetBitrate(this.settings.resolution, this.settings.fps);
      const srcH = this.video.getSettings().height ?? RES[this.settings.resolution].h;
      let scale = 1;
      let bitrate = full;
      if (peer.quality !== 'source') {
        scale = Math.max(1, srcH / Number(peer.quality));
        bitrate = Math.max(250_000, Math.round(full / Math.pow(scale, 1.5)));
      }
      const enc = p.encodings[0];
      enc.maxBitrate = bitrate;
      enc.maxFramerate = this.settings.fps;
      enc.scaleResolutionDownBy = scale;
      enc.priority = 'high';
      enc.networkPriority = 'high';
      (p as any).degradationPreference = this.settings.content === 'detail' ? 'maintain-resolution' : 'maintain-framerate';
      await sender.setParameters(p);
    } catch (error) {
      logWebRtcFailure('host.setSenderParameters', error);
    }
  }

  /** Aplica novas configurações de resolução/FPS/conteúdo durante a transmissão. */
  async updateSettings(next: CaptureSettings) {
    const prev = this.settings;
    this.settings = next;
    if (prev.resolution !== next.resolution || prev.fps !== next.fps) {
      const { w, h } = RES[next.resolution];
      try {
        await this.video.applyConstraints({ width: { ideal: w }, height: { ideal: h }, frameRate: { ideal: next.fps, max: next.fps } });
      } catch {
        this.h.onNotify('warn', 'O navegador não aplicou a nova resolução/FPS sem reselecionar a tela.');
      }
    }
    this.video.contentHint = next.content === 'detail' ? 'detail' : 'motion';
    await Promise.all([...this.peers.values()].map((p) => this.applySenderParams(p)));
  }

  setPaused(paused: boolean) {
    this.video.enabled = !paused;
    this.mixer.setMuted(paused);
    this.socket.emit('room:state', { state: paused ? 'paused' : 'live' });
  }

  // --- Estatísticas ----------------------------------------------------------------

  private async pollStats() {
    for (const peer of this.peers.values()) {
      if (peer.pc.connectionState !== 'connected') continue;
      try {
        const report = await peer.pc.getStats();
        let out: any;
        let remote: any;
        report.forEach((r: any) => {
          if (r.type === 'outbound-rtp' && r.kind === 'video') out = r;
          else if (r.type === 'remote-inbound-rtp' && r.kind === 'video') remote = r;
        });
        const now = performance.now();
        const bytes = out?.bytesSent ?? 0;
        const kbps = peer.lastTs ? Math.max(0, Math.round(((bytes - peer.lastBytes) * 8) / (now - peer.lastTs))) : 0;
        peer.lastBytes = bytes;
        peer.lastTs = now;
        const codec: any = out?.codecId ? report.get(out.codecId) : undefined;
        const encoder: string | null = out?.encoderImplementation ?? null;
        peer.stats = {
          rttMs: pairRttMs(report),
          bitrateKbps: kbps,
          fps: out?.framesPerSecond ?? null,
          resolution: out?.frameWidth ? `${out.frameWidth}×${out.frameHeight}` : null,
          codec: codec?.mimeType?.replace('video/', '') ?? null,
          encoder,
          hardware: !!encoder && HW_RE.test(encoder),
          limited: out?.qualityLimitationReason && out.qualityLimitationReason !== 'none' ? out.qualityLimitationReason : null,
          lossPct: typeof remote?.fractionLost === 'number' ? remote.fractionLost * 100 : null,
          route: isRelayPair(report),
        };
      } catch (error) {
        logWebRtcFailure('host.getStats', error);
        /* peer fechando */
      }
    }
    this.emitViewers();
  }

  private emitViewers() {
    this.h.onViewers(
      [...this.peers.values()].map((p) => ({
        id: p.id,
        name: p.name,
        connection: p.pc.connectionState,
        since: p.createdAt,
        quality: p.quality,
        stats: p.stats,
      })),
    );
  }

  private closePeer(id: string) {
    const p = this.peers.get(id);
    if (!p) return;
    window.clearTimeout(p.restartTimer);
    p.pc.onconnectionstatechange = null;
    p.pc.onicecandidate = null;
    if (p.dc) {
      p.dc.onmessage = null;
      p.dc.onopen = null;
      p.dc.onclose = null;
    }
    try {
      p.dc?.close();
      p.pc.close();
    } catch {
      /* ignore */
    }
    this.peers.delete(id);
  }

  private finish(message?: string) {
    if (this.ended) return;
    this.ended = true;
    window.clearInterval(this.statsTimer);
    for (const id of [...this.peers.keys()]) this.closePeer(id);
    this.socket.removeAllListeners();
    this.socket.disconnect();
    this.display.getTracks().forEach((t) => t.stop());
    this.mixer.close();
    if (message) this.h.onNotify('warn', message);
    this.h.onStatus('ended');
    this.emitViewers();
  }

  /** Encerra a sala para todos e libera a captura. */
  end() {
    if (this.ended) return;
    this.socket.emit('room:end');
    this.finish();
  }

  /** Chamado quando o usuário clica em "Parar compartilhamento" na barra do navegador. */
  captureEnded() {
    if (this.ended) return;
    this.socket.emit('room:end');
    this.finish('A captura de tela foi encerrada pelo navegador. A sala foi fechada.');
  }

  get password_(): string | undefined {
    return this.password;
  }
}
