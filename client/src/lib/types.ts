export interface IceServerCfg {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export type Resolution = '720p' | '1080p' | '1440p' | '2160p';
export type Fps = 30 | 60;
export type CodecPref = 'auto' | 'h264' | 'vp9' | 'av1' | 'vp8';
export type ContentMode = 'motion' | 'detail';
/** Qualidade pedida pelo espectador (altura máxima em px, ou "source"). */
export type QualityChoice = 'source' | '720' | '480' | '360';

export interface CaptureSettings {
  resolution: Resolution;
  fps: Fps;
  codec: CodecPref;
  content: ContentMode;
  systemAudio: boolean;
  mic: boolean;
}

export interface PeerStats {
  rttMs: number | null;
  bitrateKbps: number;
  fps: number | null;
  resolution: string | null;
  codec: string | null;
  encoder: string | null;
  hardware: boolean;
  limited: string | null;
  lossPct: number | null;
  route: 'direct' | 'relay' | 'unknown';
}

export interface ViewerInfo {
  id: string;
  name: string;
  connection: RTCPeerConnectionState | 'new';
  /** Momento (ms) em que a negociação com este espectador começou. */
  since: number;
  quality: QualityChoice;
  stats?: PeerStats;
}

export type ToastKind = 'info' | 'success' | 'warn' | 'error';
