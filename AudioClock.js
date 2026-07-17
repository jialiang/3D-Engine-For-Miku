// A smooth playback clock over an HTMLMediaElement.
//
// Browsers update a media element's currentTime only at the audio callback
// rate (roughly 25-50Hz, sometimes with reduced precision), so a pose driven
// by reading it every rendered frame steps visibly below the render rate.
// This clock runs on performance.now() between those coarse updates: it
// anchors to the audio time once playback starts, advances in real time and
// gently slews toward the audio clock so the two never wander apart. A big
// disagreement (a seek, a stall, returning to a hidden tab) snaps the anchor
// to the audio clock instead. While playing the returned time never steps
// backward: a stall holds the pose at the last returned time and playback
// resumes once the audio catches up. Pauses and seeks reset that floor.
class AudioClock {
  // seconds of estimate-vs-audio disagreement beyond which the clock snaps
  static SNAP_THRESHOLD = 0.25;

  // fraction of the measured drift corrected per read: small enough that a
  // correction rarely outruns one frame's real-time advance, large enough
  // to converge within a second at 60 reads per second (where it does
  // outrun, e.g. reads at a high display refresh rate, the monotonic
  // floor in read() catches the backward step)
  static SLEW_GAIN = 0.05;

  media = null;
  isAnchored = false;
  anchorAudioTime = 0;
  anchorPerformanceTime = 0;
  monotonicFloor = 0;

  constructor(media) {
    this.media = media;
  }

  // the current playback position in seconds, smooth across frames
  read() {
    const audioTime = this.media.currentTime;

    // a paused (or ended) track holds its exact reported position and a
    // seek is a deliberate jump, backward included: both follow the raw
    // clock, reset the floor and re-anchor cleanly on the next playing read
    if (this.media.paused || this.media.seeking) {
      this.isAnchored = false;
      this.monotonicFloor = audioTime;
      return audioTime;
    }

    const performanceTime = performance.now() / 1000;

    if (!this.isAnchored) {
      this.anchor(audioTime, performanceTime);
      return this.floored(audioTime);
    }

    const elapsed = (performanceTime - this.anchorPerformanceTime) * this.media.playbackRate;
    const estimated = this.anchorAudioTime + elapsed;

    // positive drift means the estimate runs ahead of the audio, which it
    // slightly does by construction: currentTime reports the position as of
    // the last audio callback, so it lags real time by up to one callback
    // interval. The slew settles the estimate near the middle of that lag.
    const drift = estimated - audioTime;

    if (Math.abs(drift) > AudioClock.SNAP_THRESHOLD) {
      this.anchor(audioTime, performanceTime);
      return this.floored(audioTime);
    }

    this.anchorAudioTime -= drift * AudioClock.SLEW_GAIN;

    return this.floored(estimated);
  }

  // clamp a playing read to the last returned time: neither a stall's
  // snap-back (currentTime frozen while paused stays false) nor a slew
  // correction bigger than one frame's advance may step the playhead
  // backward — the pose holds until the audio catches up
  floored(time) {
    if (time > this.monotonicFloor) this.monotonicFloor = time;
    return this.monotonicFloor;
  }

  anchor(audioTime, performanceTime) {
    this.isAnchored = true;
    this.anchorAudioTime = audioTime;
    this.anchorPerformanceTime = performanceTime;
  }
}
