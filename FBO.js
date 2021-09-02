// Frame Buffer Object
class FBO {
  gl;
  framebuffer;

  colorTexture;

  depthbuffer;
  depthTexture;

  constructor(gl) {
    const framebuffer = gl.createFramebuffer();

    this.gl = gl;
    this.framebuffer = framebuffer;
  }

  addColorbuffer = () => {
    const { gl, framebuffer } = this;
    const canvas = gl.canvas;

    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);

    const colorTexture = new Texture(gl, null, {
      width: canvas.width,
      height: canvas.height,
    });

    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, colorTexture.texture, 0);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this.colorTexture = colorTexture;
  };

  addDepthbuffer = (mode = "renderbuffer") => {
    const { gl, framebuffer } = this;
    const canvas = gl.canvas;

    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);

    if (mode === "texture") {
      const depthTexture = new Texture(gl, null, {
        depthTexture: true,
        width: canvas.width,
        height: canvas.height,
      });

      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depthTexture.texture, 0);

      this.depthTexture = depthTexture;
    }

    if (mode === "renderbuffer") {
      const depthbuffer = gl.createRenderbuffer();

      gl.bindRenderbuffer(gl.RENDERBUFFER, depthbuffer);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, canvas.width, canvas.height);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthbuffer);
      gl.bindRenderbuffer(gl.RENDERBUFFER, null);

      this.depthbuffer = depthbuffer;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    return this;
  };

  draw(drawFunc) {
    const { gl, framebuffer } = this;

    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, framebuffer);
    gl.clear(gl.DEPTH_BUFFER_BIT | gl.COLOR_BUFFER_BIT);

    drawFunc();

    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
  }
}
