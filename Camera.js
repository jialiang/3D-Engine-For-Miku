class Camera {
  projectionMatrix;
  transform;

  constructor(gl, options = {}) {
    // fov is in degrees
    const { fov = 58.3, near = 0.1, far = 100.0 } = options;

    const aspectRatio = gl.canvas.width / gl.canvas.height;

    this.projectionMatrix = mat4.create();
    this.transform = new CameraTransform();

    mat4.perspective(this.projectionMatrix, Transform.toRadian(fov), aspectRatio, near, far);
  }
}

class CameraController {
  canvas;
  camera;

  rotateRate = 300;
  effectiveRotateRate;

  offset;
  initialPosition;
  previousPosition;

  constructor(gl, camera) {
    this.canvas = gl.canvas;
    this.camera = camera;

    const boundingBox = this.canvas.getBoundingClientRect();

    this.offset = { x: boundingBox.left, y: boundingBox.top };
    this.initialPosition = { x: 0, y: 0 };
    this.previousPosition = { x: 0, y: 0 };

    this.effectiveRotateRate = {
      x: this.rotateRate / this.canvas.width,
      y: this.rotateRate / this.canvas.height,
    };

    this.canvas.onmousedown = (e) => this.handleMouseDown(e);
    this.canvas.onmouseup = () => this.handleMouseUp();
  }

  handleMouseDown(e) {
    e.preventDefault();

    const { pageX, pageY } = e;
    const { offset } = this;

    const position = {
      x: pageX - offset.x,
      y: pageY - offset.y,
    };

    this.initialPosition = position;
    this.previousPosition = position;

    this.canvas.onmousemove = (e) => this.handleMouseMove(e);
  }

  handleMouseUp() {
    this.canvas.onmousemove = null;
  }

  handleMouseMove(e) {
    const { pageX, pageY } = e;
    const { offset, previousPosition, camera, effectiveRotateRate } = this;

    const currentPosition = {
      x: pageX - offset.x,
      y: pageY - offset.y,
    };
    const delta = {
      x: currentPosition.x - previousPosition.x,
      y: currentPosition.y - previousPosition.y,
    };

    camera.transform.setTransformation({
      rotation: [0, -delta.x * effectiveRotateRate.x, 0],
    });

    this.previousPosition = currentPosition;
  }
}
