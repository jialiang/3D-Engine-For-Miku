class Texture {
  gl;
  texture;
  imageCount;

  constructor(gl, image, options = {}) {
    const {
      flipY = false,
      generateMipmaps = true,
      width = 1,
      height = 1,
      imageCount = 1,
      wrap = gl.CLAMP_TO_EDGE,
      depthTexture = false,
      isTextureArray = imageCount > 1,
    } = options;

    const bindingPoint = isTextureArray ? gl.TEXTURE_2D_ARRAY : gl.TEXTURE_2D;

    let format = gl.RGBA;
    let internalFormat = gl.RGBA;
    let type = gl.UNSIGNED_BYTE;

    let maxFilterType = gl.LINEAR;
    let minFilterType = gl.LINEAR;

    // trilinear (LINEAR between mip levels), not LINEAR_MIPMAP_NEAREST:
    // the latter snaps to one mip and bands where the level changes,
    // which showed badly on the fine skirt lace when minified
    if (generateMipmaps && image) minFilterType = gl.LINEAR_MIPMAP_LINEAR;
    if (depthTexture) {
      format = gl.DEPTH_COMPONENT16;
      internalFormat = gl.DEPTH_COMPONENT;
      type = gl.UNSIGNED_INT;

      // a plain depth texture, sampled and compared by hand in the shader,
      // must be NEAREST (WebGL cannot linear-filter a non-comparison depth texture)
      maxFilterType = gl.NEAREST;
      minFilterType = gl.NEAREST;
    }

    const texture = gl.createTexture();

    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flipY);
    gl.bindTexture(bindingPoint, texture);

    if (!isTextureArray) {
      if (image) gl.texImage2D(bindingPoint, 0, format, internalFormat, type, image);
      else gl.texImage2D(bindingPoint, 0, format, width, height, 0, internalFormat, type, null);
    } else {
      gl.texImage3D(
        bindingPoint,
        0,
        format,
        width,
        height,
        imageCount,
        0,
        internalFormat,
        type,
        image,
      );
    }

    gl.texParameteri(bindingPoint, gl.TEXTURE_MAG_FILTER, maxFilterType);
    gl.texParameteri(bindingPoint, gl.TEXTURE_MIN_FILTER, minFilterType);
    gl.texParameteri(bindingPoint, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(bindingPoint, gl.TEXTURE_WRAP_T, wrap);

    if (generateMipmaps && image) {
      gl.generateMipmap(bindingPoint);

      // anisotropic filtering keeps the mipmapped detail sharp where a surface is seen edge-on
      // (the skirt lace at the sides of its ring),
      // instead of the over-blurred smear isotropic minification gives there
      const anisotropy = gl.getExtension("EXT_texture_filter_anisotropic");

      if (anisotropy) {
        const max = gl.getParameter(anisotropy.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
        gl.texParameterf(bindingPoint, anisotropy.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, max));
      }
    }

    if (depthTexture) gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.NONE);

    this.gl = gl;
    this.texture = texture;
    this.imageCount = imageCount;
    this.bindingTarget = bindingPoint;
  }

  setTextureUnitIndex(index) {
    this.textureUnit = index;
  }

  addToTextureUnit() {
    const { gl, texture, textureUnit, bindingTarget } = this;

    gl.activeTexture(gl.TEXTURE0 + textureUnit);
    gl.bindTexture(bindingTarget, texture);
  }

  removeFromTextureUnit() {
    const { gl, textureUnit, bindingTarget } = this;

    gl.activeTexture(gl.TEXTURE0 + textureUnit);
    gl.bindTexture(bindingTarget, null);
  }

  bindTextureUnitToUniform(program, uniformName, options = {}) {
    const { gl, textureUnit } = this;
    const { programBound = false } = options;

    const location = GL.getUniformLocation(program, uniformName);

    if (!programBound) gl.useProgram(program);

    gl.uniform1i(location, textureUnit);

    if (!programBound) gl.useProgram(null);
  }

  dispose() {
    const { gl, texture } = this;

    gl.deleteTexture(texture);

    this.texture = null;
  }
}
