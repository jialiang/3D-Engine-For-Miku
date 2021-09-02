class Light {
  color;
  transform = new CameraTransform();

  constructor(gl, options = {}) {
    const { color = [1, 1, 1], position = [0, 0, 0], rotation = [0, 0, 0], projectionSize = 1 } = options;

    this.color = color;
    this.transform.setTransformation({ position, rotation });

    const aspectRatio = gl.canvas.width / gl.canvas.height;
    const width = projectionSize * aspectRatio;
    const height = projectionSize;

    const projectionMatrix = mat4.create();
    const transformationMatrix = mat4.create();

    mat4.ortho(projectionMatrix, -width / 2, width / 2, -height / 2, height / 2, 0.1, 100);

    mat4.identity(transformationMatrix);
    mat4.translate(transformationMatrix, transformationMatrix, [0.5, 0.5, 0.5]);
    mat4.scale(transformationMatrix, transformationMatrix, [0.5, 0.5, 0.5]);
    mat4.multiply(transformationMatrix, transformationMatrix, projectionMatrix);
    mat4.multiply(transformationMatrix, transformationMatrix, this.transform.viewMatrix);

    this.projectionMatrix = projectionMatrix;
    this.transformationMatrix = transformationMatrix;
  }
}
