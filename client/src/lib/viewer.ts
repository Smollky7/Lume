import type { Socket } from 'socket.io-client';
import { createSocket, emitAck } from './socket';
import type { IceServerCfg, QualityChoice, ToastKind } from './types';
import { isRelayPair, pairRttMs, tuneOpus } from './webrtc';

export type ViewerStatus = 'connecting' | 'waiting' | 'live' | 'paused' | 'reconnecting' | 'host-offline' | 'stalled' | 'ended';
export type EndReason = 'host_ended' | 'host_gone' | 'not_found' | 'bad_password' | 'room_full' | 'rate_limited' | 'error';

export interface ViewerStats {
  rttMs: number | null;
  latencyMs: number | null;
  bitrateKbps: number;
  fps: number | null;
  resolution: string | null;
  lossPct: number | null;
  route: 'direct' | 'relay' | 'unknown';
}

export interface ViewerHandlers {
  onStatus(s: ViewerStatus): void;
  onStream(stream: MediaStream): void;
  onViewers(count: number): void;
  onStats(s: ViewerStats): void;
  onNotify(kind: ToastKind, text: string): void;
  onFatal(reason: EndReason): void;
}

export class ViewerClient {
  private socket: Socket = createSocket();
  private pc?: RTCPeerConnection;
  private dc?: RTCDataChannel;
  private iceServers: IceServerCfg[] = [];
  private queue: Promise<void> = Promise.resolve();
  private quality: QualityChoice = 'source';
  private pingTimer?: number;
  private statsTimer?: number;
  private recoverTimer?: number;
  private stallTimer?: number;
  private everConnected = false;
  private rtt: number | null = null;
  private lastBytes = 0;
  private lastTs = 0;
  private lastJbDelay = 0;
  private lastJbCount = 0;
  private jitterMs = 0;
  private closed = false;
  private paused = false;
  private hostOffline = false;

  constructor(
    private roomId: string,
    private name: string,
    private password: string | undefined,
    private h: ViewerHandlers,
  ) {}

  connect() {
    const s = this.socket;
    this.h.onStatus('connecting');
    s.on('connect', () => void this.join());
    s.on('disconnect', () => {
      if (this.closed) return;
      this.h.onStatus('reconnecting');
    });
    s.on('signal', (msg: { data: any }) => {
      this.queue = this.queue.then(() => this.handleSignal(msg.data)).catch(() => undefined);
    });
    s.on('room:viewers', (m: { count: number }) => this.h.onViewers(m.count));
    s.on('room:state', (m: { state: 'live' | 'paused' }) => {
      this.paused = m.state === 'paused';
      this.h.onStatus(this.paused ? 'paused' : 'live');
    });
    s.on('room:host-offline', () => {
      this.hostOffline = true;
      this.h.onStatus('host-offline');
      this.h.onNotify('warn', 'O anfitrião perdeu a conexão. Aguardando…');
    });
    s.on('room:host-online', () => {
      this.hostOffline = false;
      this.h.onNotify('success', 'Anfitrião reconectado');
    });
    s.on('room:ended', (m: { reason?: string }) => {
      this.shutdown();
      this.h.onFatal(m.reason === 'host_gone' ? 'host_gone' : 'host_ended');
    });
    s.on('peer:joined', (m: { name: string }) => this.h.onNotify('info', `${m.name} entrou`));
    s.on('peer:left', (m: { name: string }) => this.h.onNotify('info', `${m.name} saiu`));
    if (s.connected) void this.join();
  }

  private async join() {
    try {
      const res = await emitAck<{
        ok: boolean;
        error?: string;
        iceServers?: IceServerCfg[];
        state?: 'live' | 'paused';
        count?: number;
        hostOnline?: boolean;
      }>(this.socket, 'room:join', { roomId: this.roomId, password: this.password, name: this.name });
      if (!res.ok) {
        this.shutdown();
        this.h.onFatal((res.error as EndReason) ?? 'error');
        return;
      }
      this.iceServers = res.iceServers ?? [];
      this.paused = res.state === 'paused';
      this.hostOffline = !res.hostOnline;
      this.h.onViewers(res.count ?? 1);
      this.h.onStatus(this.hostOffline ? 'host-offline' : 'waiting');
    } catch {
      this.h.onNotify('error', 'Sem resposta do servidor. Tentando novamente…');
    }
  }

  private async handleSignal(data: any) {
    if (!data) return;
    if (data.type === 'offer') {
      this.resetPc();
      const pc = new RTCPeerConnection({ iceServers: this.iceServers, bundlePolicy: 'max-bundle' });
      this.pc = pc;
      pc.onicecandidate = (e) => {
        if (e.candidate) this.socket.emit('signal:to-host', { data: { type: 'candidate', candidate: e.candidate.toJSON() } });
      };
      pc.ontrack = (e) => {
        try {
          (e.receiver as any).playoutDelayHint = 0;
        } catch {
          /* não suportado */
        }
        if (e.streams[0]) this.h.onStream(e.streams[0]);
      };
      pc.ondatachannel = (e) => this.bindChannel(e.channel);
      pc.onconnectionstatechange = () => this.onState(pc);
      // Se o vídeo não conectar em 15 s (típico de NAT/CGNAT sem TURN), avisa com clareza.
      window.clearTimeout(this.stallTimer);
      if (!this.everConnected) {
        this.stallTimer = window.setTimeout(() => {
          if (this.pc === pc && pc.connectionState !== 'connected') this.h.onStatus('stalled');
        }, 15000);
      }
      await pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
      const answer = await pc.createAnswer();
      answer.sdp = tuneOpus(answer.sdp ?? '');
      await pc.setLocalDescription(answer);
      this.socket.emit('signal:to-host', { data: { type: 'answer', sdp: pc.localDescription?.sdp } });
    } else if (data.type === 'candidate' && data.candidate && this.pc) {
      try {
        await this.pc.addIceCandidate(data.candidate);
      } catch {
        /* ignore */
      }
    }
  }

  private bindChannel(dc: RTCDataChannel) {
    this.dc = dc;
    dc.onopen = () => {
      if (this.quality !== 'source') dc.send(JSON.stringify({ t: 'quality', value: this.quality }));
      window.clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => {
        if (dc.readyState === 'open') dc.send(JSON.stringify({ t: 'ping', ts: performance.now() }));
      }, 2000);
    };
    dc.onmessage = (e) => {
      try {
        const m = JSON.parse(String(e.data));
        if (m.t === 'pong') this.rtt = performance.now() - m.ts;
      } catch {
        /* ignore */
      }
    };
  }

  private onState(pc: RTCPeerConnection) {
    if (pc !== this.pc) return;
    window.clearTimeout(this.recoverTimer);
    const st = pc.connectionState;
    if (st === 'connected') {
      this.everConnected = true;
      window.clearTimeout(this.stallTimer);
      this.h.onStatus(this.paused ? 'paused' : 'live');
      window.clearInterval(this.statsTimer);
      this.statsTimer = window.setInterval(() => void this.pollStats(pc), 1000);
    } else if (st === 'disconnected' || st === 'failed') {
      this.h.onStatus(st === 'failed' && !this.everConnected ? 'stalled' : 'reconnecting');
      // Se o ICE não se recuperar sozinho, pede uma nova oferta ao anfitrião.
      this.recoverTimer = window.setTimeout(
        () => {
          if (this.pc === pc && pc.connectionState !== 'connected') {
            this.socket.emit('signal:to-host', { data: { type: 'request-offer' } });
          }
        },
        st === 'failed' ? 1500 : 8000,
      );
    }
  }

  private async pollStats(pc: RTCPeerConnection) {
    try {
      const report = await pc.getStats();
      let v: any;
      report.forEach((r: any) => {
        if (r.type === 'inbound-rtp' && r.kind === 'video') v = r;
      });
      if (!v) return;
      const now = performance.now();
      const kbps = this.lastTs ? Math.max(0, Math.round(((v.bytesReceived - this.lastBytes) * 8) / (now - this.lastTs))) : 0;
      this.lastBytes = v.bytesReceived;
      this.lastTs = now;
      // Atraso médio do jitter buffer no último intervalo (aproximação da latência de reprodução)
      let bufMs = 0;
      if (typeof v.jitterBufferDelay === 'number' && v.jitterBufferEmittedCount > this.lastJbCount) {
        bufMs = ((v.jitterBufferDelay - this.lastJbDelay) / (v.jitterBufferEmittedCount - this.lastJbCount)) * 1000;
        this.lastJbDelay = v.jitterBufferDelay;
        this.lastJbCount = v.jitterBufferEmittedCount;
        this.jitterMs = bufMs;
      }
      const total = (v.packetsReceived ?? 0) + (v.packetsLost ?? 0);
      const rtt = this.rtt ?? pairRttMs(report);
      this.h.onStats({
        rttMs: rtt,
        latencyMs: rtt !== null ? Math.round(rtt / 2 + this.jitterMs) : null,
        bitrateKbps: kbps,
        fps: v.framesPerSecond ?? null,
        resolution: v.frameWidth ? `${v.frameWidth}×${v.frameHeight}` : null,
        lossPct: total > 0 ? ((v.packetsLost ?? 0) / total) * 100 : null,
        route: isRelayPair(report),
      });
    } catch {
      /* ignore */
    }
  }

  setQuality(q: QualityChoice) {
    this.quality = q;
    if (this.dc?.readyState === 'open') this.dc.send(JSON.stringify({ t: 'quality', value: q }));
  }

  private resetPc() {
    window.clearInterval(this.pingTimer);
    window.clearInterval(this.statsTimer);
    window.clearTimeout(this.recoverTimer);
    window.clearTimeout(this.stallTimer);
    this.lastBytes = 0;
    this.lastTs = 0;
    this.lastJbCount = 0;
    this.lastJbDelay = 0;
    if (this.pc) {
      this.pc.onconnectionstatechange = null;
      try {
        this.dc?.close();
        this.pc.close();
      } catch {
        /* ignore */
      }
    }
    this.pc = undefined;
    this.dc = undefined;
  }

  private shutdown() {
    this.closed = true;
    this.resetPc();
    this.socket.removeAllListeners();
    this.socket.disconnect();
    this.h.onStatus('ended');
  }

  leave() {
    if (this.closed) return;
    this.shutdown();
  }
}
