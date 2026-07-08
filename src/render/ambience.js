// Gentle outdoor ambience (public-domain birdsong and breeze) for immersion.
// It starts on the first real user gesture, the Enter button, so it satisfies
// the browser autoplay policy, plays at a low volume, and can be muted with the
// M key. It is fully optional: any failure to load or play is swallowed so the
// audio can never block or break the game.

export class Ambience {
  constructor(url, { target = 0.16 } = {}) {
    this.target = target;
    this.muted = false;
    this.started = false;
    this.audio = null;
    this._fade = null;
    try {
      const a = document.createElement('audio');
      a.src = url;
      a.loop = true;
      a.preload = 'auto';
      a.volume = 0;
      this.audio = a;
    } catch {
      this.audio = null;
    }
  }

  // Begin playback and fade in. Safe to call more than once.
  start() {
    if (this.started || !this.audio) return;
    this.started = true;
    try {
      const p = this.audio.play();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    } catch {
      return;
    }
    this._fadeTo(this.muted ? 0 : this.target);
  }

  _fadeTo(v) {
    if (!this.audio) return;
    if (this._fade) clearInterval(this._fade);
    this._fade = setInterval(() => {
      if (!this.audio) return;
      const cur = this.audio.volume;
      const d = v - cur;
      if (Math.abs(d) < 0.006) {
        this.audio.volume = v;
        clearInterval(this._fade);
        this._fade = null;
        return;
      }
      this.audio.volume = Math.max(0, Math.min(1, cur + Math.sign(d) * 0.02));
    }, 60);
  }

  // Flip mute and fade to the new level. Returns the new muted state.
  toggleMute() {
    this.muted = !this.muted;
    this._fadeTo(this.muted ? 0 : this.target);
    return this.muted;
  }
}
