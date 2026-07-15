// Frame Buffer Object
class FBO {
  gl;
  framebuffer;

  depthbuffer;
  depthTexture;

  constructor(gl) {
    const framebuffer = gl.createFramebuffer();

    this.gl = gl;
    this.framebuffer = framebuffer;
    this.width = gl.canvas.width;
    this.height = gl.canvas.height;
  }

  addDepthbuffer = (mode = "renderbuffer", options = {}) => {
    const { gl, framebuffer } = this;

    const width = options.width ?? gl.canvas.width;
    const height = options.height ?? gl.canvas.height;

    this.width = width;
    this.height = height;

    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);

    if (mode === "texture") {
      const depthTexture = new Texture(gl, null, {
        depthTexture: true,
        width,
        height,
      });

      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.DEPTH_ATTACHMENT,
        gl.TEXTURE_2D,
        depthTexture.texture,
        0,
      );

      this.depthTexture = depthTexture;
    }

    if (mode === "renderbuffer") {
      const depthbuffer = gl.createRenderbuffer();

      gl.bindRenderbuffer(gl.RENDERBUFFER, depthbuffer);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, width, height);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depthbuffer);
      gl.bindRenderbuffer(gl.RENDERBUFFER, null);

      this.depthbuffer = depthbuffer;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    return this;
  };

  isStatusChecked = false;

  draw(drawFunc) {
    const { gl, framebuffer } = this;

    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, framebuffer);

    // an incomplete framebuffer silently renders nothing,
    // so validate it once on first use
    if (!this.isStatusChecked) {
      const status = gl.checkFramebufferStatus(gl.DRAW_FRAMEBUFFER);

      if (status !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error(`Framebuffer is incomplete, status code ${status}.`);
      }

      this.isStatusChecked = true;
    }

    // match the viewport to this buffer, which may differ from the canvas
    // (the shadow map is a fixed resolution), then hand it back afterwards
    gl.viewport(0, 0, this.width, this.height);
    gl.clear(gl.DEPTH_BUFFER_BIT | gl.COLOR_BUFFER_BIT);

    drawFunc();

    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
  }

  dispose() {
    const { gl, framebuffer, depthbuffer, depthTexture } = this;

    if (depthTexture) depthTexture.dispose();
    if (depthbuffer) gl.deleteRenderbuffer(depthbuffer);

    gl.deleteFramebuffer(framebuffer);

    this.depthTexture = null;
    this.depthbuffer = null;
    this.framebuffer = null;
  }
}
