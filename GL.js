class GL {
  static PROGRAM_INDEX = 0;
  static UNIFORM_LOCATION_CACHE = {};

  static init(canvas) {
    const gl = canvas.getContext("webgl2", { powerPreference: "high-performance" });

    if (!gl) throw new Error("Your browser doesn't support WebGL 2.0.");

    const computedStyle = getComputedStyle(canvas);
    const width = parseInt(computedStyle.getPropertyValue("width"), 10);
    const height = parseInt(computedStyle.getPropertyValue("height"), 10);

    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    // UNCAPPED. This was clamped to 2, which throws away resolution on the displays most
    // likely to show up the fine costume trim: a 3x phone or a 2.5x laptop panel rendered
    // softer than the hardware could. The cost is real and quadratic, since the shadow map is
    // sized from these dimensions too (see index.js), so a 3x device asks for nine times the
    // fragments. Put the ceiling back here if that proves too much on a phone.
    const pixelRatio = devicePixelRatio;

    const realWidth = width * pixelRatio;
    const realHeight = height * pixelRatio;

    canvas.width = realWidth;
    canvas.height = realHeight;
    gl.viewport(0, 0, realWidth, realHeight);

    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);

    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.enable(gl.BLEND);

    gl.clearColor(0.0, 0.0, 0.0, 0.0);

    return gl;
  }

  static createProgram(gl, vertexShaderSource, fragmentShaderSource) {
    const vertexShader = gl.createShader(gl.VERTEX_SHADER);
    const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(vertexShader, vertexShaderSource);
    gl.shaderSource(fragmentShader, fragmentShaderSource);
    gl.compileShader(vertexShader);
    gl.compileShader(fragmentShader);

    const vLog = gl.getShaderInfoLog(vertexShader);
    const fLog = gl.getShaderInfoLog(fragmentShader);

    if (vLog) throw new Error(`Vertex Shader Error:\n${vLog}`);
    if (fLog) throw new Error(`Fragment Shader Error:\n${fLog}`);

    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(`Program Link Error:\n${gl.getProgramInfoLog(program)}`);
    }

    program.gl = gl;
    program.index = GL.PROGRAM_INDEX;
    GL.PROGRAM_INDEX += 1;

    return program;
  }

  static getUniformLocation(program, uniformName) {
    const gl = program.gl;
    let location = GL.UNIFORM_LOCATION_CACHE[`${program.index}_${uniformName}`];

    if (location == null) {
      location = gl.getUniformLocation(program, uniformName);
      GL.UNIFORM_LOCATION_CACHE[`${program.index}_${uniformName}`] = location;
    }

    return location;
  }
}
