class GL {
  static PROGRAM_INDEX = 0;
  static UNIFORM_LOCATION_CACHE = {};

  static init(canvas) {
    const gl = canvas.getContext("webgl2");

    if (!gl) throw "Your browser doesn't support WebGL 2.0 not supported.";

    const computedStyle = getComputedStyle(canvas);
    const width = parseInt(computedStyle.getPropertyValue("width"), 10);
    const height = parseInt(computedStyle.getPropertyValue("height"), 10);

    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;

    const realWidth = width * devicePixelRatio;
    const realHeight = height * devicePixelRatio;

    canvas.width = realWidth;
    canvas.height = realHeight;
    gl.viewport(0, 0, realWidth, realHeight);

    // gl.cullFace(gl.BACK);
    // gl.frontFace(gl.CCW);
    // gl.enable(gl.CULL_FACE);

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

    if (vLog) throw `Vertex Shader Error:\n${vLog}`;
    if (fLog) throw `Fragment Shader Error:\n${fLog}`;

    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

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
