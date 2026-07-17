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

  // Grounding is baked offline: an override file carries corrected leg
  // IK-target heights that land the feet (the game's own data floats
  // them, see the dump repo's tools/ground.js).
  const [skeletonJson, animationBuffer, groundingBuffer] = await Promise.all([
    Utilities.fetch("motions/mik_skeleton.json", { responseType: "json" }),
    Utilities.fetch("motions/pv_743.bin", { responseType: "arraybuffer" }),
    Utilities.fetch("motions/pv_743_grounding.bin", { responseType: "arraybuffer" }),
  ]);

  const animation = new Animation("motions/pv_743.bin", animationBuffer);

  animation.override(new Animation("motions/pv_743_grounding.bin", groundingBuffer));

  const skeleton = new Skeleton(skeletonJson, animation, miku.skin, miku.nodes);

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

  const draw = () => {
    isDrawScheduled = false;

    // a hidden tab stops the loop, visibilitychange restarts it
    if (document.hidden) return;

    gl.clear(gl.DEPTH_BUFFER_BIT | gl.COLOR_BUFFER_BIT);

    cameraUbo.updateCameraData(camera);

    // the audio clock drives the dance, smoothed across the browser's coarse
    // currentTime updates (see AudioClock); a paused or ended track holds its
    // pose, a restarted track rewinds the sampling cursors automatically
    const frame = Math.min(clock.read() * animation.frameRate, animation.frameCount - 1);
    skeleton.pose(animation, frame);

    const seconds = (frame / animation.frameRate).toFixed(2);
    frameCounter.textContent = `frame ${Math.round(frame)}  t=${seconds}s`;
    miku.boneUbo.updateBoneData(skeleton.palette);

    gl.useProgram(program);

    shadowFbo.draw(() => {
      shadowUbo.updateShadowData({
        shadowMappingMode: 1,
        shadowMapTexelSize,
      });

      shadowFbo.depthTexture.removeFromTextureUnit();

      miku.draw({ includeOverlays: false, isShadowPass: true });
    });

    shadowFbo.depthTexture.addToTextureUnit();
    shadowUbo.updateShadowData({
      shadowMappingMode: 0,
      shadowMapTexelSize,
    });

    miku.draw({ includeOverlays: true });

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

  playButton.addEventListener("click", () => {
    cover.style.display = "none";
    playAudio();
    scheduleDraw();

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) return bgm.pause();

      // returning to the tab restarts the loop so the camera stays usable,
      // and resumes the track unless the user paused it or it has already
      // finished (a finished track only restarts by click)
      scheduleDraw();
      if (!isPaused && !bgm.ended) playAudio();
    });

    // a click pauses or resumes the track, a drag orbits the camera
    let isMoved = false;

    canvas.addEventListener("mousedown", () => (isMoved = false));
    canvas.addEventListener("mousemove", () => (isMoved = true));

    canvas.addEventListener("mouseup", () => {
      if (isMoved) return;

      if (bgm.ended) {
        bgm.currentTime = 0;
        isPaused = false;
        playAudio();
        return;
      }

      isPaused = !isPaused;

      if (isPaused) return bgm.pause();

      playAudio();
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
