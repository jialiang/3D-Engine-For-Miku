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

  // Which finger or cursor is driving, so a second touch does not fight the first.
  activePointer = null;

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

    // PAN-Y, not none. Without a touch-action the browser claims the whole gesture for
    // scrolling and no move event ever arrives, so the view cannot be turned by hand.
    // Refusing every gesture instead would trap the reader on the canvas, which fills the
    // viewport with an article below it. This camera only turns around Y from a HORIZONTAL
    // drag, so handing vertical panning back to the browser costs nothing and keeps the
    // page scrollable.
    this.canvas.style.touchAction = "pan-y";

    this.canvas.onpointerdown = (e) => this.handlePointerDown(e);
    this.canvas.onpointerup = (e) => this.handlePointerUp(e);
    this.canvas.onpointercancel = (e) => this.handlePointerUp(e);
  }

  handlePointerDown(e) {
    if (this.activePointer !== null) return;

    e.preventDefault();
    this.activePointer = e.pointerId;

    // So a drag that wanders off the canvas keeps turning the view instead of stopping
    // dead, which is easy to do on a small screen.
    this.canvas.setPointerCapture(e.pointerId);

    const { pageX, pageY } = e;
    const { offset } = this;

    const position = {
      x: pageX - offset.x,
      y: pageY - offset.y,
    };

    this.initialPosition = position;
    this.previousPosition = position;

    this.canvas.onpointermove = (e) => this.handlePointerMove(e);
  }

  handlePointerUp(e) {
    if (e.pointerId !== this.activePointer) return;

    if (this.canvas.hasPointerCapture(e.pointerId)) {
      this.canvas.releasePointerCapture(e.pointerId);
    }

    this.activePointer = null;
    this.canvas.onpointermove = null;
  }

  handlePointerMove(e) {
    if (e.pointerId !== this.activePointer) return;

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
