export function logWebRtcFailure(operation: string, error: unknown): void {
  if (!import.meta.env.DEV) return;
  const name = error instanceof Error && error.name ? error.name : 'UnknownError';
  console.debug(`[webrtc] ${operation} failed (${name})`);
}

/** Ajusta o fmtp do Opus: estéreo, FEC e bitrate alto (música/jogos). */
export function tuneOpus(sdp: string): string {
  const rtpmap = sdp.match(/a=rtpmap:(\d+) opus\/48000\/2/i);
  if (!rtpmap) return sdp;
  const pt = rtpmap[1];
  const extra = 'stereo=1;sprop-stereo=1;maxaveragebitrate=192000;useinbandfec=1;usedtx=0';
  const re = new RegExp(`a=fmtp:${pt} ([^\\r\\n]*)`);
  const m = sdp.match(re);
  if (m) {
    const existing = m[1].split(';').filter((p) => p && !/^(stereo|sprop-stereo|maxaveragebitrate|useinbandfec|usedtx)=/.test(p));
    return sdp.replace(re, `a=fmtp:${pt} ${[...existing, extra].join(';')}`);
  }
  return sdp.replace(rtpmap[0], `${rtpmap[0]}\r\na=fmtp:${pt} ${extra}`);
}

export function isRelayPair(report: RTCStatsReport): 'direct' | 'relay' | 'unknown' {
  let pairId: string | undefined;
  report.forEach((r) => {
    if (r.type === 'transport' && r.selectedCandidatePairId) pairId = r.selectedCandidatePairId;
  });
  let pair: any = pairId ? report.get(pairId) : undefined;
  if (!pair) {
    report.forEach((r) => {
      if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded') pair = r;
    });
  }
  if (!pair) return 'unknown';
  const local: any = report.get(pair.localCandidateId);
  const remote: any = report.get(pair.remoteCandidateId);
  return local?.candidateType === 'relay' || remote?.candidateType === 'relay' ? 'relay' : 'direct';
}

export function pairRttMs(report: RTCStatsReport): number | null {
  let rtt: number | null = null;
  report.forEach((r: any) => {
    if (r.type === 'candidate-pair' && (r.nominated || r.state === 'succeeded') && typeof r.currentRoundTripTime === 'number') {
      rtt = r.currentRoundTripTime * 1000;
    }
  });
  return rtt;
}
