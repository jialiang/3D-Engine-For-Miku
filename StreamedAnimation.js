// Streams a chunked motion: the dump repo's convert.js splits a long clip
// into one MOT1 file per time window plus a manifest, so the take can load a
// window at a time instead of holding the whole clip up front. This presents
// the same interface Animation does (tracks, frameRate, frameCount, sample,
// override) by delegating each sample to the window's own chunk.
//
// Chunks stream in eagerly, in window order, so the windows playback reaches
// first are ready first. If the playhead reaches a window whose chunk has not
// arrived yet, isReady(frame) returns false and the caller holds until it has
// (index.js pauses the audio meanwhile, then resumes). A window that ran out of
// retries reads as ready instead: the take plays across the hole on the last
// pose before it, rather than waiting on a chunk that is never coming.
class StreamedAnimation {
  static async load(basePath) {
    const manifest = await Utilities.fetch(`${basePath}/manifest.json`, { responseType: "json" });
    const streamed = new StreamedAnimation(basePath, manifest);

    // window 0 must be ready before the rig binds to its track layout below
    await streamed.loadWindow(0);

    // Streaming runs on past this call, so its failures cannot be thrown at the caller.
    // Reported through the page's own error banner rather than the console, since a window
    // that never arrives is a hole in the performance the viewer will otherwise just watch
    // the playhead stall against.
    streamed.streamRemaining().catch(handleError);

    return streamed;
  }

  constructor(basePath, manifest) {
    this.basePath = basePath;
    this.frameRate = manifest.frameRate;
    this.frameCount = manifest.frameCount;
    this.windowSize = manifest.windowSize;
    this.chunkNames = manifest.chunks;
    this.chunks = new Array(manifest.chunks.length).fill(null);

    // windows that ran out of retries: a hole to play across rather than one to wait on
    this.abandonedWindows = new Set();
    this.overrideAnimation = null;
  }

  // Window 0 is loaded before the rig binds, so its tracks define the layout every later
  // chunk is checked against and every sample() returns values in. The rig resolves each
  // track to a slot once, by index, so a chunk that agreed on the count but not the order
  // would pose the right values onto the wrong bones.
  get tracks() {
    return this.chunks[0].tracks;
  }

  async loadWindow(windowIndex) {
    const url = `${this.basePath}/${this.chunkNames[windowIndex]}`;
    const chunk = new Animation(url, await Utilities.fetch(url, { responseType: "arraybuffer" }));

    const layout = this.chunks[0]?.tracks;

    // Compared track by track, not just by count: two windows can carry the same number of
    // tracks in a different order and that reads as a rig posing itself from its
    // neighbour's channels rather than as a load failure.
    if (layout) {
      const mismatch = layout.findIndex((track, index) => chunk.tracks[index]?.name !== track.name);

      if (chunk.tracks.length !== layout.length || mismatch >= 0) {
        throw new Error(`${url} does not carry the window-0 track layout`);
      }
    }

    if (this.overrideAnimation) chunk.override(this.overrideAnimation);

    this.chunks[windowIndex] = chunk;
  }

  // ONE BAD WINDOW MUST NOT END THE STREAM. Every window is fetched independently, so a
  // failure says nothing about the ones after it: letting the error escape this loop would
  // strand every later window too. One retry each, then report and skip.
  async streamRemaining() {
    const failed = [];

    for (let windowIndex = 1; windowIndex < this.chunks.length; windowIndex++) {
      if (this.chunks[windowIndex]) continue;

      try {
        await this.loadWindow(windowIndex);
      } catch {
        try {
          await this.loadWindow(windowIndex);
        } catch (retryError) {
          this.abandonedWindows.add(windowIndex);
          failed.push(this.chunkNames[windowIndex]);
          console.error(retryError);
        }
      }
    }

    if (failed.length) {
      throw new Error(`${this.basePath}: ${failed.length} window(s) never loaded: ${failed}`);
    }
  }

  windowFor(frame) {
    return Math.min(Math.floor(frame / this.windowSize), this.chunks.length - 1);
  }

  // The chunk to pose this frame from: its own window, or the nearest loaded one before it
  // when that window was abandoned. Window 0 is awaited before this object is handed out, so
  // the search always lands on something.
  chunkFor(frame) {
    for (let windowIndex = this.windowFor(frame); windowIndex >= 0; windowIndex--) {
      if (this.chunks[windowIndex]) return this.chunks[windowIndex];
    }

    throw new Error(`${this.basePath}: no chunk loaded for frame ${frame}`);
  }

  // AN ABANDONED WINDOW READS AS READY, so the playhead runs across it. Waiting on one that
  // is never coming stops the take dead instead: the draw loop pauses the audio whenever
  // this is false and nothing would ever set it true again.
  isReady(frame) {
    const windowIndex = this.windowFor(frame);

    return this.chunks[windowIndex] !== null || this.abandonedWindows.has(windowIndex);
  }

  sample(frame) {
    return this.chunkFor(frame).sample(frame);
  }

  // apply a whole-timeline override (e.g. the grounding tracks) to every
  // chunk, both the ones already loaded and the ones still streaming in
  override(other) {
    this.overrideAnimation = other;

    for (const chunk of this.chunks) {
      if (chunk) chunk.override(other);
    }
  }
}
