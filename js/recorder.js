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
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ac = new AC();
      const src = this.ac.createMediaStreamSource(this.stream);
      this.analyser = this.ac.createAnalyser();
      this.analyser.fftSize = 512;
      src.connect(this.analyser);
      const arr = new Uint8Array(this.analyser.fftSize);
      const loop = () => {
        if (!this.analyser) return;
        this.analyser.getByteTimeDomainData(arr);
        let sum = 0; for (let i = 0; i < arr.length; i++) { const v = (arr[i] - 128) / 128; sum += v * v; }
        this.onLevel && this.onLevel(Math.min(1, Math.sqrt(sum / arr.length) * 4));
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
