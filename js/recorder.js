// Aufnahme in Abschnitten (z. B. alle 5 Minuten eine eigene Datei).
// Vorteil: Bricht etwas ab, ist höchstens ein Abschnitt betroffen – und jeder Abschnitt
// kann einzeln analysiert werden, auch später, wenn das Tageslimit wieder frei ist.

function pickMime() {
  const cands = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
  if (!window.MediaRecorder) return null;
  for (const c of cands) { try { if (MediaRecorder.isTypeSupported(c)) return c; } catch {} }
  return '';
}

export function recordingSupported() {
  return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
}

export class LessonRecorder {
  constructor({ chunkMin = 5, onTick, onLevel, onChunk, onState }) {
    this.chunkMs = chunkMin * 60000;
    this.onTick = onTick; this.onLevel = onLevel; this.onChunk = onChunk; this.onState = onState;
    this.state = 'idle';
    this.elapsedBefore = 0; this.runningSince = 0;
    this.pending = Promise.resolve();
    this.gaps = [];
  }
  get elapsed() { return (this.elapsedBefore + (this.runningSince ? performance.now() - this.runningSince : 0)) / 1000; }

  async start() {
    this.mime = pickMime();
    // direkt im Tipp des Nutzers anlegen, damit iOS den Ton-Kontext erlaubt
    try { const AC = window.AudioContext || window.webkitAudioContext; this.ac = new AC(); this.ac.resume().catch(() => {}); } catch {}
    await this.#acquire();
    this.state = 'recording';
    this.runningSince = performance.now();
    this.#startChunk();
    this.#wake();
    this.tickTimer = setInterval(() => this.onTick && this.onTick(this.elapsed), 250);
    this.visHandler = () => this.#onVisibility();
    document.addEventListener('visibilitychange', this.visHandler);
    this.onState && this.onState(this.state);
  }

  async #acquire() {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: true, channelCount: 1 },
    });
    try {
      // Safari/iOS: AudioContext muss laufen ("resume") und der Analyser muss bis zum Ausgang
      // verbunden sein – sonst liefert er nur Nullen und die Balken bleiben flach.
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!this.ac || this.ac.state === 'closed') this.ac = new AC();
      try { await this.ac.resume(); } catch {}
      const src = this.ac.createMediaStreamSource(this.stream);
      this.analyser = this.ac.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.smoothingTimeConstant = 0.6;
      const mute = this.ac.createGain(); mute.gain.value = 0;
      src.connect(this.analyser); this.analyser.connect(mute); mute.connect(this.ac.destination);
      const freq = new Uint8Array(this.analyser.frequencyBinCount);
      const time = new Uint8Array(this.analyser.fftSize);
      const hz = this.ac.sampleRate / this.analyser.fftSize;
      const lo = Math.max(1, Math.floor(90 / hz)), hi = Math.min(freq.length - 1, Math.ceil(4000 / hz));
      const N = 28;
      let peak = 0.05; const smooth = new Float32Array(N);
      const loop = () => {
        if (!this.analyser) return;
        if (this.ac.state === 'suspended') this.ac.resume().catch(() => {});
        this.analyser.getByteFrequencyData(freq);
        this.analyser.getByteTimeDomainData(time);
        let sum = 0; for (let i = 0; i < time.length; i++) { const v = (time[i] - 128) / 128; sum += v * v; }
        const rms = Math.sqrt(sum / time.length);
        peak = Math.max(rms, peak * 0.995, 0.02); // passt sich an leise Räume an
        const loud = Math.min(1, rms / peak);
        const bars = new Array(N);
        for (let b = 0; b < N; b++) {
          // Sprachbereich logarithmisch auf die Balken verteilen, Mitte = tiefe Frequenzen
          const k = Math.abs(b - (N - 1) / 2) / ((N - 1) / 2);
          const f0 = lo * Math.pow(hi / lo, k * 0.85), f1 = lo * Math.pow(hi / lo, Math.min(1, k * 0.85 + 0.08));
          let m = 0; for (let i = Math.floor(f0); i <= Math.ceil(f1); i++) m = Math.max(m, freq[i] || 0);
          const v = Math.min(1, (m / 255) * 1.25) * (0.35 + 0.65 * loud);
          smooth[b] = v > smooth[b] ? v : smooth[b] * 0.82 + v * 0.18;
          bars[b] = smooth[b];
        }
        this.onLevel && this.onLevel(loud, bars);
        this.raf = requestAnimationFrame(loop);
      };
      loop();
    } catch {}
  }

  #startChunk() {
    const opts = { audioBitsPerSecond: 48000 };
    if (this.mime) opts.mimeType = this.mime;
    let mr;
    try { mr = new MediaRecorder(this.stream, opts); } catch { mr = new MediaRecorder(this.stream); }
    const parts = [];
    const startSec = this.elapsed;
    mr.ondataavailable = (e) => { if (e.data && e.data.size) parts.push(e.data); };
    const done = new Promise((resolve) => {
      mr.onstop = async () => {
        const type = (mr.mimeType || this.mime || 'audio/webm').split(';')[0];
        const blob = new Blob(parts, { type });
        const durationSec = Math.max(0, this.elapsed - startSec);
        if (blob.size > 1000 && this.onChunk) {
          try { await this.onChunk({ blob, startSec, durationSec }); } catch (e) { console.error(e); }
        }
        resolve();
      };
    });
    this.pending = this.pending.then(() => done);
    mr.start(1000);
    this.mr = mr;
    clearTimeout(this.rotateTimer);
    this.rotateTimer = setTimeout(() => this.#rotate(), this.chunkMs);
  }

  #rotate() {
    if (this.state !== 'recording') return;
    const old = this.mr;
    this.#startChunk();
    try { old.stop(); } catch {}
  }

  pause() {
    if (this.state !== 'recording') return;
    try { this.mr.pause(); } catch {}
    this.elapsedBefore += performance.now() - this.runningSince; this.runningSince = 0;
    clearTimeout(this.rotateTimer);
    this.state = 'paused'; this.onState && this.onState(this.state);
  }
  resume() {
    if (this.state !== 'paused') return;
    this.runningSince = performance.now();
    try { this.mr.resume(); } catch {}
    this.rotateTimer = setTimeout(() => this.#rotate(), this.chunkMs);
    this.state = 'recording'; this.onState && this.onState(this.state);
  }

  async stop() {
    if (this.state === 'idle') return;
    if (this.runningSince) { this.elapsedBefore += performance.now() - this.runningSince; this.runningSince = 0; }
    this.state = 'stopping';
    clearTimeout(this.rotateTimer); clearInterval(this.tickTimer);
    try { if (this.mr && this.mr.state !== 'inactive') this.mr.stop(); } catch {}
    await this.pending;
    this.#cleanup();
    this.state = 'idle'; this.onState && this.onState(this.state);
  }

  #cleanup() {
    cancelAnimationFrame(this.raf); this.analyser = null;
    try { this.ac && this.ac.close(); } catch {}
    try { this.stream && this.stream.getTracks().forEach(t => t.stop()); } catch {}
    document.removeEventListener('visibilitychange', this.visHandler);
    try { this.wakeLock && this.wakeLock.release(); } catch {}
    this.wakeLock = null;
  }

  async #wake() {
    try { if ('wakeLock' in navigator) this.wakeLock = await navigator.wakeLock.request('screen'); } catch {}
  }

  async #onVisibility() {
    if (document.visibilityState !== 'visible' || this.state === 'idle' || this.state === 'stopping') return;
    this.#wake();
    // iOS beendet das Mikrofon manchmal im Hintergrund → neu starten, Lücke merken
    const track = this.stream && this.stream.getAudioTracks()[0];
    const dead = !track || track.readyState === 'ended' || (this.mr && this.mr.state === 'inactive');
    if (dead && this.state === 'recording') {
      this.gaps.push(this.elapsed);
      try { this.mr && this.mr.state !== 'inactive' && this.mr.stop(); } catch {}
      try { this.stream && this.stream.getTracks().forEach(t => t.stop()); } catch {}
      cancelAnimationFrame(this.raf);
      try { this.ac && this.ac.close(); } catch {}
      await this.#acquire();
      this.#startChunk();
      this.onState && this.onState('resumed-after-gap');
    }
  }
}
