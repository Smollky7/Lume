import type { CaptureSettings, CodecPref, Fps, Resolution } from './types';
import { logWebRtcFailure } from './webrtc';

export const RES: Record<Resolution, { w: number; h: number; label: string }> = {
  '720p': { w: 1280, h: 720, label: '720p' },
  '1080p': { w: 1920, h: 1080, label: '1080p' },
  '1440p': { w: 2560, h: 1440, label: '1440p' },
  '2160p': { w: 3840, h: 2160, label: '4K' },
};

/** Teto de bitrate de vídeo (bps). O WebRTC adapta abaixo disso conforme a rede. */
export function targetBitrate(res: Resolution, fps: Fps): number {
  const table: Record<Resolution, [number, number]> = {
    '720p': [2_500_000, 4_000_000],
    '1080p': [5_000_000, 8_000_000],
    '1440p': [9_000_000, 14_000_000],
    '2160p': [16_000_000, 25_000_000],
  };
  return table[res][fps === 60 ? 1 : 0];
}

export const defaultSettings: CaptureSettings = {
  resolution: '1080p',
  fps: 30,
  codec: 'auto',
  content: 'motion',
  systemAudio: true,
  mic: false,
};

export function loadSettings(): CaptureSettings {
  try {
    const raw = localStorage.getItem('lume:settings');
    if (raw) return { ...defaultSettings, ...JSON.parse(raw) };
  } catch {
    /* ignore */
  }
  return defaultSettings;
}

export function saveSettings(s: CaptureSettings) {
  try {
    localStorage.setItem('lume:settings', JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

const MIME: Record<Exclude<CodecPref, 'auto'>, string> = {
  h264: 'video/H264',
  vp9: 'video/VP9',
  av1: 'video/AV1',
  vp8: 'video/VP8',
};

export function codecMime(c: CodecPref): string | null {
  return c === 'auto' ? null : MIME[c];
}

/** Codecs que este navegador consegue enviar. */
export function supportedCodecs(): CodecPref[] {
  const out: CodecPref[] = ['auto'];
  try {
    const caps = RTCRtpSender.getCapabilities('video')?.codecs ?? [];
    const mimes = new Set(caps.map((c) => c.mimeType.toLowerCase()));
    (Object.keys(MIME) as Exclude<CodecPref, 'auto'>[]).forEach((k) => {
      if (mimes.has(MIME[k].toLowerCase())) out.push(k);
    });
  } catch {
    /* ignore */
  }
  return out;
}

export function captureSupported(): boolean {
  return !!navigator.mediaDevices?.getDisplayMedia;
}

/** nível 0 = pedido completo; 1 = sem resolução/dicas extras; 2 = captura mínima (sem áudio). */
export interface CaptureResult {
  stream: MediaStream;
  level: 0 | 1 | 2;
}

const NO_RETRY = new Set(['NotAllowedError', 'NotFoundError', 'SecurityError']);

/**
 * Tenta a captura do pedido mais completo ao mais simples. Alguns drivers/navegadores
 * recusam combinações de restrições (resolução, áudio estéreo, dicas) com NotReadableError
 * ou Overconstrained; nesses casos o app cai para um pedido mais simples em vez de falhar.
 * Cancelamento pelo usuário (NotAllowedError) nunca é repetido.
 */
export async function captureScreen(s: CaptureSettings): Promise<CaptureResult> {
  if (!captureSupported()) throw new DOMException('unsupported', 'NotSupportedError');
  const { w, h } = RES[s.resolution];
  const attempts: DisplayMediaStreamOptions[] = [
    {
      video: { width: { ideal: w }, height: { ideal: h }, frameRate: { ideal: s.fps, max: s.fps } },
      audio: s.systemAudio
        ? { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 2 }
        : false,
      // Dicas do Chrome/Edge; navegadores que não conhecem simplesmente ignoram.
      systemAudio: 'include',
      surfaceSwitching: 'include',
      selfBrowserSurface: 'exclude',
      monitorTypeSurfaces: 'include',
    } as unknown as DisplayMediaStreamOptions,
    { video: { frameRate: { ideal: s.fps } }, audio: s.systemAudio } as DisplayMediaStreamOptions,
    { video: true, audio: false } as DisplayMediaStreamOptions,
  ];

  let lastError: unknown;
  for (let i = 0; i < attempts.length; i++) {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia(attempts[i]);
      const v = stream.getVideoTracks()[0];
      if (v) v.contentHint = s.content === 'detail' ? 'detail' : 'motion';
      return { stream, level: i as 0 | 1 | 2 };
    } catch (e) {
      lastError = e;
      if (NO_RETRY.has((e as DOMException)?.name)) throw e;
    }
  }
  throw lastError;
}

export function describeCaptureError(e: unknown): string {
  const name = (e as DOMException)?.name;
  const detail = name ? ` [${name}${(e as DOMException).message ? `: ${(e as DOMException).message}` : ''}]` : '';
  switch (name) {
    case 'NotAllowedError':
      return 'A captura foi cancelada ou a permissão foi negada. Clique em "Escolher tela" e autorize no seletor do navegador.';
    case 'NotFoundError':
      return 'Nenhuma tela ou janela disponível para capturar.';
    case 'NotReadableError':
      return (
        'O sistema não conseguiu ler a tela, mesmo com os pedidos simplificados. Causas comuns: outro programa já está capturando ' +
        '(Discord, OBS, Teams, Zoom, GeForce Experience) ou outra aba/janela do Lume ainda está transmitindo. Feche-os, reinicie o navegador ' +
        'e tente "Tela inteira". Se persistir, ative/desative a "aceleração de hardware" do navegador e atualize o driver de vídeo.' +
        detail
      );
    case 'NotSupportedError':
      return 'Este navegador/dispositivo não suporta compartilhamento de tela. Use Chrome, Edge ou Firefox no computador.';
    case 'AbortError':
      return `A captura foi interrompida pelo sistema.${detail}`;
    default:
      return `Não foi possível iniciar a captura.${detail}`;
  }
}

/**
 * Mistura áudio do sistema + microfone em UMA faixa Opus.
 * Assim o envio nunca precisa de renegociação ao ligar/desligar o microfone
 * e o áudio permanece sincronizado com o vídeo (mesmo MediaStream).
 */
export class AudioMixer {
  private ctx = new AudioContext({ latencyHint: 'interactive' });
  private dest = this.ctx.createMediaStreamDestination();
  private master = this.ctx.createGain();
  private sysGain = this.ctx.createGain();
  private micGain = this.ctx.createGain();
  private sysSource?: MediaStreamAudioSourceNode;
  private micSource?: MediaStreamAudioSourceNode;
  private micStream?: MediaStream;
  private closed = false;

  constructor() {
    this.sysGain.connect(this.master);
    this.micGain.connect(this.master);
    this.micGain.gain.value = 0;
    this.master.connect(this.dest);
  }

  get track(): MediaStreamTrack {
    return this.dest.stream.getAudioTracks()[0];
  }

  async resume() {
    if (this.ctx.state === 'suspended') await this.ctx.resume();
  }

  /** Conecta o áudio capturado da tela. Retorna false se o navegador não entregou áudio. */
  attachSystem(display: MediaStream): boolean {
    this.sysSource?.disconnect();
    this.sysSource = undefined;
    const tracks = display.getAudioTracks();
    if (!tracks.length) return false;
    this.sysSource = this.ctx.createMediaStreamSource(new MediaStream(tracks));
    this.sysSource.connect(this.sysGain);
    return true;
  }

  async setMic(on: boolean) {
    if (!on) {
      this.micGain.gain.value = 0;
      return;
    }
    if (!this.micStream) {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      try {
        const source = this.ctx.createMediaStreamSource(stream);
        source.connect(this.micGain);
        this.micStream = stream;
        this.micSource = source;
      } catch (error) {
        stream.getTracks().forEach((track) => track.stop());
        throw error;
      }
    }
    this.micGain.gain.value = 1;
  }

  setMuted(muted: boolean) {
    this.master.gain.value = muted ? 0 : 1;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.micStream?.getTracks().forEach((t) => t.stop());
    this.sysSource?.disconnect();
    this.micSource?.disconnect();
    this.dest.stream.getTracks().forEach((track) => track.stop());
    void this.ctx.close().catch((error: unknown) => logWebRtcFailure('audio.close', error));
  }
}

export function describeMicError(e: unknown): string {
  const name = (e as DOMException)?.name;
  if (name === 'NotAllowedError') return 'Permissão do microfone negada.';
  if (name === 'NotFoundError') return 'Nenhum microfone encontrado.';
  return 'Não foi possível acessar o microfone.';
}
