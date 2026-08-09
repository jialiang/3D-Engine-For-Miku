window.addEventListener("error", handleError);

window.addEventListener("load", async () => {
  try {
    await onload();
  } catch (e) {
    handleError(e);
  }
});

function handleError(e) {
  const error = document.querySelector(".error-content");
  const message = document.querySelector(".error-message");

  error.style.display = "block";
  message.innerHTML += `<div>${e.message || e.toString()}</div>`;
}

async function onload() {
  const [
    [vertexShaderSource, fragmentShaderSource], //
    [floorVertexShaderSource, floorFragmentShaderSource], //
    [uniformsShaderChunk, shadowShaderChunk],
  ] = await Promise.all([
    Promise.all([
      Utilities.fetch("shaders/skinned_vertex.glsl"), //
      Utilities.fetch("shaders/static_fragment.glsl"), //
    ]),
    Promise.all([
      Utilities.fetch("shaders/floor_vertex.glsl"), //
      Utilities.fetch("shaders/floor_fragment.glsl"), //
    ]),
    Promise.all([
      Utilities.fetch("shaders/uniforms.glsl"), //
      Utilities.fetch("shaders/shadow.glsl"),
    ]),
  ]);

  const includeShaderChunks = (shaderSource) =>
    shaderSource
      .replace("//#include uniforms", uniformsShaderChunk)
      .replace("//#include shadow", shadowShaderChunk);

  //

  const canvas = document.getElementsByTagName("canvas")[0];
  const gl = GL.init(canvas);

  const frameCounter = document.querySelector("#frame-counter");

  //

  const program = GL.createProgram(
    gl,
    includeShaderChunks(vertexShaderSource),
    includeShaderChunks(fragmentShaderSource),
  );
  const floorProgram = GL.createProgram(
    gl,
    includeShaderChunks(floorVertexShaderSource),
    includeShaderChunks(floorFragmentShaderSource),
  );

  //

  const miku = await Model.load(gl, program, "models/pierretta");

  // the stand-mic prop: the take is choreographed around it (she lifts the
  // mic off the stand and back). A flat neutral ramp stands in for the
  // game's BLINN item shading. The chrome envmap is not reproduced. Its one
  // base colour is still embedded in its glb, so it lists no base material.
  const mic = await Model.load(gl, program, "models/mic", {
    baseByMaterial: {},
    toonRampByMaterial: { lambert_IZ: "neutral" },
    specByMaterial: {},
  });

  // The feet are already grounded in the clip. The game's own data floats them, so
  // tools/ground.js solves corrected leg IK-target heights offline and writes them into
  // these windows, against the authored copy it keeps beside them. Nothing to apply here.
  const [
    skeletonJson,
    animation,
    faceAnimation,
    micSkeletonJson,
    micAnimation,
    osageSkeletonJson,
    osageAnimation,
  ] = await Promise.all([
    Utilities.fetch("motions/mik_skeleton.json", { responseType: "json" }),
    StreamedAnimation.load("motions/pv_743"),
    StreamedAnimation.load("motions/pv_743_face"),
    Utilities.fetch("motions/mic_skeleton.json", { responseType: "json" }),
    StreamedAnimation.load("motions/pv_743_mic"),
    Utilities.fetch("motions/osage_skeleton.json", { responseType: "json" }),
    StreamedAnimation.load("motions/pv_743_osage"),
  ]);

  const skeleton = new Skeleton(skeletonJson, animation, miku.skin, miku.nodes);

  // The facial performance is a second clip on the same rig: it drives only
  // face bones, which the body take leaves at rest, so the two clips never
  // touch the same channel.
  skeleton.addClip(faceAnimation);

  // The skirt panels and hair tails swing on their own small rig hanging off
  // the body's (see OsageRig). This clip is the game's own precomputed
  // performance for them.
  skeleton.addOsageRig(osageSkeletonJson, osageAnimation);

  // The hood ribbons' swing, simulated as CLOTH offline (tools/softbody.js) and compressed to
  // vertex modes (see RibbonBasis). It replaces the baked bone swing above for those two
  // chains: tools/rebind-ribbon.js bound their vertices to the head alone, so nothing else
  // moves them and the spring rig above is inert for them.
  miku.ribbonBasis = await RibbonBasis.load(
    gl,
    program,
    "models/pierretta/ribbon",
    miku.ribbonBindPositions,
  );

  const micRig = new PropRig(micSkeletonJson, micAnimation, mic.skin);

  //

  const floor = new Floor(60);
  const floorVao = new VAO(gl, floor.dataForAttributeBuffer, floor.verticesToDrawCount);
  const floorModelUbo = new ModelUbo(gl, [floorProgram], "Model");

  floorModelUbo.updateModelData(floor);

  //

  const camera = new Camera(gl);
  const cameraUbo = new CameraUbo(gl, [program, floorProgram], "Camera");

  // constructed for its side effect: registers the orbit mouse handlers
  new CameraController(gl, camera);

  camera.transform.setTransformation({ position: [0, 10, 25] });
  cameraUbo.updateCameraData(camera);

  // What the camera and the shadow both track, rewritten each frame. The Y stays at the
  // height the shot was framed for. Only X and Z follow. See the frame loop.
  const hipsBone = skeleton.bones.findIndex((bone) => bone.name === "kl_kosi_y");
  const followPivot = [0, 0, 0];

  if (hipsBone < 0) throw new Error("no kl_kosi_y bone to follow");

  //

  const light = new Light({
    position: [0, 10, 25],
    rotation: [-45, -15, 0],
    projectionSize: 30,
  });
  const lightUbo = new LightUbo(gl, [program, floorProgram], "Light");

  lightUbo.updateLightData(light);

  //

  // Square shadow map, sized to the render resolution so a hi-DPI or 4K
  // canvas gets a crisp shadow (canvas.width already includes the device
  // pixel ratio, see GL.init). Floored so low-DPI still resolves the fine
  // trim, capped for memory. Since the softness radius is in texels, a
  // larger map also gives a tighter edge.
  const shadowMapSize = Utilities.clamp(Math.max(canvas.width, canvas.height), 2048, 4096);

  const shadowFbo = new FBO(gl);
  shadowFbo.addDepthbuffer("texture", { width: shadowMapSize, height: shadowMapSize });

  shadowFbo.depthTexture.setTextureUnitIndex(9);
  shadowFbo.depthTexture.bindTextureUnitToUniform(program, "u_shadowTexture");
  shadowFbo.depthTexture.bindTextureUnitToUniform(floorProgram, "u_shadowTexture");

  const shadowUbo = new ShadowUbo(gl, [program, floorProgram], "Shadow");
  const shadowMapTexelSize = [1 / shadowMapSize, 1 / shadowMapSize];

  //

  floorModelUbo.bindUniformBlock();
  cameraUbo.bindUniformBlock();
  lightUbo.bindUniformBlock();
  shadowUbo.bindUniformBlock();

  //

  let isDrawScheduled = false;

  const scheduleDraw = () => {
    if (isDrawScheduled) return;

    isDrawScheduled = true;
    requestAnimationFrame(draw);
  };

  // NO CHECK FOR A HIDDEN TAB HERE, deliberately. The browser already stops calling us: a
  // hidden document gets no animation frames at all, measured at zero in three seconds while
  // timers kept ticking. So the check bought nothing and cost the one case where a hidden tab
  // IS asked to draw, which is a screenshot: capturing forces a burst of frames (nine per
  // capture, measured) and returning early meant the shot caught whatever stale buffer was
  // there. Worse, returning before scheduleDraw below killed the loop outright, so the tab
  // never drew again without a visibilitychange.
  const draw = () => {
    isDrawScheduled = false;

    gl.clear(gl.DEPTH_BUFFER_BIT | gl.COLOR_BUFFER_BIT);

    cameraUbo.updateCameraData(camera);

    // the audio clock drives the dance, smoothed across the browser's coarse
    // currentTime updates (see AudioClock). A paused or ended track holds its
    // pose, a restarted track rewinds the sampling cursors automatically
    const frame = Math.min(clock.read() * animation.frameRate, animation.frameCount - 1);

    // the motion streams in a window at a time (see StreamedAnimation): if the
    // window under the playhead has not arrived yet, hold the audio and the
    // pose (the model keeps its last palette) until it has, then resume
    const isMotionReady =
      animation.isReady(frame) &&
      faceAnimation.isReady(frame) &&
      micAnimation.isReady(frame) &&
      osageAnimation.isReady(frame) &&
      miku.ribbonBasis.isReady(frame);

    if (isMotionReady) {
      if (isBuffering) {
        isBuffering = false;
        if (!isPaused && !bgm.ended) playAudio();
      }

      skeleton.pose(animation, frame);

      // THE CAMERA AND THE SHADOW FOLLOW HER. She travels nearly 2 metres, which the 12.5x
      // model scale turns into about 24 scene units, so a camera orbiting the world origin
      // loses her sideways and a 30-unit shadow frustum fixed there stops covering her
      // altogether. Both now pivot on the same point.
      //
      // THE HIPS, not the rig's gblctr channel: that reads a constant 0,10,0 all take, so all
      // of the travel is inside the bone hierarchy. Through the model matrix rather than by
      // multiplying by 12.5, so this keeps working if the model is ever moved as well as scaled.
      //
      // X AND Z ONLY. The hips rise and fall with every step and a camera that follows that
      // bobs the whole frame. The height stays where the shot was framed.
      const hips = skeleton.worldMatrices[hipsBone];
      const subject = Utilities.multiplyVecByMat4(
        [hips[12], hips[13], hips[14], 1],
        miku.transform.modelMatrix,
      );

      followPivot[0] = subject[0];
      followPivot[2] = subject[2];

      camera.transform.setPivot(followPivot);
      cameraUbo.updateCameraData(camera);

      light.follow(followPivot);
      lightUbo.updateLightData(light);

      const seconds = (frame / animation.frameRate).toFixed(2);
      frameCounter.textContent = `frame ${Math.round(frame)}  t=${seconds}s`;
      miku.boneUbo.updateBoneData(skeleton.palette);

      // Once a frame, not once a part: the shadow pass and the lit pass want the same
      // weights and the uniform belongs to the program rather than to a draw.
      miku.ribbonBasis.update(frame);
      mic.boneUbo.updateBoneData(micRig.pose(micAnimation, frame));
    } else {
      if (!isPaused && !bgm.paused) bgm.pause();
      isBuffering = true;
      frameCounter.textContent = "buffering...";
    }

    gl.useProgram(program);

    shadowFbo.draw(() => {
      shadowUbo.updateShadowData({
        shadowMappingMode: 1,
        shadowMapTexelSize,
      });

      shadowFbo.depthTexture.removeFromTextureUnit();

      miku.bindUniformBlocks();
      miku.draw({ includeOverlays: false, isShadowPass: true });

      mic.bindUniformBlocks();
      mic.draw({ includeOverlays: false, isShadowPass: true });
    });

    shadowFbo.depthTexture.addToTextureUnit();
    shadowUbo.updateShadowData({
      shadowMappingMode: 0,
      shadowMapTexelSize,
    });

    miku.bindUniformBlocks();
    miku.draw({ includeOverlays: true });

    mic.bindUniformBlocks();
    mic.draw({ includeOverlays: true });

    gl.useProgram(floorProgram);

    gl.bindVertexArray(floorVao.vao);
    gl.drawArrays(gl.TRIANGLES, 0, floorVao.verticesToDrawCount);

    scheduleDraw();
  };

  //

  const bgm = document.querySelector("audio");
  const clock = new AudioClock(bgm);

  const cover = document.querySelector("#cover");

  const loading = document.querySelector(".loading-content");
  const ready = document.querySelector(".ready-content");

  const playButton = document.querySelector(".play");

  // autoplay permission can be revoked, in which case the model still
  // shows and only the sound is missing
  const playAudio = () => bgm.play().catch((error) => console.warn("Could not play audio:", error));

  let isPaused = false;
  let isBuffering = false;

  playButton.addEventListener("click", () => {
    cover.style.display = "none";
    playAudio();
    scheduleDraw();

    // LEAVING THE TAB DOES NOT PAUSE THE TRACK. It used to, which meant the song
    // stopped the moment anything else took focus and picked up mid-bar on the way
    // back. Whether audio keeps running in a background tab is the browser's call to
    // make (it has the power and autoplay policy to weigh, we do not), so nothing
    // here second-guesses it.
    //
    // THE POSE FOLLOWS THE MUSIC RATHER THAN THE OTHER WAY AROUND, which is what
    // makes that safe. A hidden tab gets no animation frames at all, so the dance
    // does not advance while it is away, but the clock reads the track's own
    // currentTime (see AudioClock) rather than counting frames. So whatever the
    // browser did with the audio meanwhile, the first frame back lands on the pose
    // the music is actually at instead of resuming where it left off.
    //
    // No timer is used to force draws while hidden. It would burn a GPU on something
    // nobody is looking at and the one case that wants a background frame, a
    // screenshot, already gets one: see the note above draw().
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) return;

      // Coming back restarts the loop so the camera stays usable and asks for the
      // track again in case the browser was the one that stopped it. Not if the user
      // paused it and not if it has already finished: a finished track only restarts
      // by click.
      scheduleDraw();
      if (!isPaused && !bgm.ended) playAudio();
    });

    // A tap or click pauses or resumes the track, a drag orbits the camera.
    //
    // POINTER EVENTS, to match CameraController. These were mouse events and the camera
    // calls preventDefault on pointerdown to claim the drag, which by specification also
    // suppresses the compatibility mouse events: mousedown and mouseup stopped arriving and
    // clicking stopped pausing. Two listeners on one gesture have to agree on the model.
    //
    // A DISTANCE THRESHOLD rather than "moved at all", because a finger never holds still.
    // The old boolean meant any single pixel of travel counted as a drag, which a mouse
    // mostly avoids and a touchscreen never does.
    const TAP_SLOP = 6;
    let pressedAt = null;
    let isMoved = false;

    canvas.addEventListener("pointerdown", (event) => {
      pressedAt = { x: event.clientX, y: event.clientY };
      isMoved = false;
    });

    canvas.addEventListener("pointermove", (event) => {
      if (!pressedAt) return;
      if (Math.hypot(event.clientX - pressedAt.x, event.clientY - pressedAt.y) > TAP_SLOP) {
        isMoved = true;
      }
    });

    canvas.addEventListener("pointercancel", () => (pressedAt = null));

    canvas.addEventListener("pointerup", () => {
      pressedAt = null;

      if (isMoved) return;

      if (bgm.ended) {
        bgm.currentTime = 0;
        isPaused = false;
        playAudio();
        return;
      }

      // A STALL IS NOT A PAUSE and a stopped track cannot tell them apart: the draw loop
      // stops the audio itself while a window arrives. So the toggle tracks the user's own
      // intent, or the next tap does the opposite of what it looks like.
      isPaused = !isPaused;

      if (isPaused) return bgm.pause();

      // Nothing to resume while buffering: the draw loop starts the track again by itself
      // once the window lands and calling play() into a stall only warns.
      if (!isBuffering) playAudio();
    });
  });

  const signalReady = () => {
    loading.style.display = "none";
    ready.style.display = "block";

    bgm.removeEventListener("canplay", signalReady);
  };

  // enough audio must be buffered before playback can start. When the
  // browser is not actively loading, signal ready and let play() cope
  const isStillBuffering =
    bgm.readyState < HTMLMediaElement.HAVE_FUTURE_DATA &&
    bgm.networkState === HTMLMediaElement.NETWORK_LOADING;

  if (isStillBuffering) bgm.addEventListener("canplay", signalReady);
  else signalReady();
}
