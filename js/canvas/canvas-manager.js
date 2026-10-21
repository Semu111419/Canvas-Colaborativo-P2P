/**
 * canvas-manager.js
 * Gestión del Canvas Infinito con Konva.js:
 * Desplazamiento (pan), zoom multitáctil (pinch-to-zoom), zoom con rueda,
 * cuadrícula infinita de fondo y sincronización bidireccional de cámara.
 */

/* global Konva */

export class CanvasManager {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    if (!this.container) {
      throw new Error(`Contenedor #${containerId} no encontrado`);
    }

    this.width = this.container.clientWidth || window.innerWidth;
    this.height = this.container.clientHeight || window.innerHeight;

    // Inicializar escenario de Konva
    this.stage = new Konva.Stage({
      container: containerId,
      width: this.width,
      height: this.height,
      draggable: false // Gestionamos el arrastre manualmente para diferenciar fondo de objetos
    });

    // Capa de fondo para eventos y cuadrícula
    this.gridLayer = new Konva.FastLayer();
    // Capa para objetos (imágenes)
    this.objectLayer = new Konva.Layer();
    // Capa superior para transformadores y controles de selección
    this.uiLayer = new Konva.Layer();

    this.stage.add(this.gridLayer);
    this.stage.add(this.objectLayer);
    this.stage.add(this.uiLayer);

    // Estado de la cámara
    this.minScale = 0.08;
    this.maxScale = 8.0;
    this.isApplyingRemoteCamera = false;
    this.isLocalGestureActive = false;
    this.lastTouchDist = 0;
    this.lastTouchCenter = null;
    this.isDraggingBackground = false;
    this.dragStartPos = { x: 0, y: 0 };
    this.stageStartPos = { x: 0, y: 0 };

    // Control y sincronización
    this.onCameraChanged = null; // Callback: ({ x, y, scale, active }) => {}
    this.onSelectionCleared = null;

    // Throttling para transmisión de cámara a 60fps máx
    this.lastCameraBroadcastTime = 0;
    this.broadcastThrottleMs = 30; // ~33fps ideal para fluidez en WebRTC sin saturar

    this.initBackgroundGrid();
    this.initEventListeners();
    this.handleResize();
  }

  /**
   * Dibuja la cuadrícula infinita en función de la posición y escala de la cámara.
   */
  initBackgroundGrid() {
    this.gridCanvas = document.createElement('canvas');
    this.gridCtx = this.gridCanvas.getContext('2d');

    // Creamos una forma personalizada de Konva para el fondo
    this.gridShape = new Konva.Shape({
      sceneFunc: (context) => {
        const ctx = context._context;
        const scale = this.stage.scaleX();
        const stagePos = this.stage.position();

        const width = this.stage.width();
        const height = this.stage.height();

        // Limpiar
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = '#12151b';
        ctx.fillRect(0, 0, width, height);

        // Cuadrícula punteada con espaciado adaptable
        const baseGridSize = 50;
        const effectiveGridSize = baseGridSize * scale;

        // Subdivisión de cuadrícula
        const offsetX = stagePos.x % effectiveGridSize;
        const offsetY = stagePos.y % effectiveGridSize;

        ctx.fillStyle = 'rgba(255, 255, 255, 0.12)';
        const dotRadius = Math.max(1, Math.min(2.5, scale * 1.5));

        for (let x = offsetX; x < width; x += effectiveGridSize) {
          for (let y = offsetY; y < height; y += effectiveGridSize) {
            ctx.beginPath();
            ctx.arc(x, y, dotRadius, 0, Math.PI * 2);
            ctx.fill();
          }
        }

        // Ejes centrales (origen 0,0)
        ctx.strokeStyle = 'rgba(79, 134, 247, 0.35)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        // Eje vertical (X=0)
        ctx.moveTo(stagePos.x, 0);
        ctx.lineTo(stagePos.x, height);
        // Eje horizontal (Y=0)
        ctx.moveTo(0, stagePos.y);
        ctx.lineTo(width, stagePos.y);
        ctx.stroke();

        ctx.restore();
      },
      listening: false
    });

    this.gridLayer.add(this.gridShape);
    this.gridLayer.batchDraw();
  }

  /**
   * Configura listeners de ratón y gestos táctiles (pan y pinch-to-zoom).
   */
  initEventListeners() {
    // Redimensionar al cambiar el tamaño de ventana / orientación del celular
    window.addEventListener('resize', () => this.handleResize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.handleResize(), 150));

    // Prevenir menú contextual en móvil para evitar interrupciones al tocar
    this.stage.content.addEventListener('contextmenu', (e) => e.preventDefault());

    // 1. Manejo con ratón (Desktop)
    this.stage.on('mousedown', (e) => {
      // Si el clic fue en el fondo (no en un objeto)
      if (e.target === this.stage) {
        this.isDraggingBackground = true;
        this.isLocalGestureActive = true;
        this.dragStartPos = this.stage.getPointerPosition();
        this.stageStartPos = { ...this.stage.position() };

        if (this.onSelectionCleared) {
          this.onSelectionCleared();
        }
      }
    });

    window.addEventListener('mousemove', (e) => {
      if (this.isDraggingBackground) {
        const pointerPos = this.stage.getPointerPosition();
        if (!pointerPos) return;

        const dx = pointerPos.x - this.dragStartPos.x;
        const dy = pointerPos.y - this.dragStartPos.y;

        this.setCameraPosition(this.stageStartPos.x + dx, this.stageStartPos.y + dy, true);
      }
    });

    window.addEventListener('mouseup', () => {
      if (this.isDraggingBackground) {
        this.isDraggingBackground = false;
        this.isLocalGestureActive = false;
        this.emitCameraChange(true); // Enviar estado final de cámara
      }
    });

    // Zoom con rueda de ratón (centrado en el puntero)
    this.stage.on('wheel', (e) => {
      e.evt.preventDefault();
      const oldScale = this.stage.scaleX();
      const pointer = this.stage.getPointerPosition();
      if (!pointer) return;

      const scaleBy = 1.12;
      const newScale = e.evt.deltaY < 0 ? oldScale * scaleBy : oldScale / scaleBy;
      this.zoomAtPoint(pointer, newScale, true);
    });

    // 2. Manejo táctil multitouch para móviles (Android / iOS)
    const content = this.stage.content;

    content.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        // Un solo dedo: si fue sobre el fondo, iniciar pan
        const touch = e.touches[0];
        const rect = content.getBoundingClientRect();
        const clientPos = { x: touch.clientX - rect.left, y: touch.clientY - rect.top };

        // Comprobar si tocó un objeto de imagen o el fondo
        const shape = this.stage.getIntersection(clientPos);
        if (!shape || shape === this.gridShape) {
          this.isDraggingBackground = true;
          this.isLocalGestureActive = true;
          this.dragStartPos = clientPos;
          this.stageStartPos = { ...this.stage.position() };

          if (this.onSelectionCleared) {
            this.onSelectionCleared();
          }
        }
      } else if (e.touches.length >= 2) {
        // Dos dedos: gesto de pellizco (pinch-to-zoom y pan a dos dedos)
        this.isDraggingBackground = false;
        this.isLocalGestureActive = true;

        const touch1 = e.touches[0];
        const touch2 = e.touches[1];
        const rect = content.getBoundingClientRect();

        const p1 = { x: touch1.clientX - rect.left, y: touch1.clientY - rect.top };
        const p2 = { x: touch2.clientX - rect.left, y: touch2.clientY - rect.top };

        this.lastTouchDist = this.getDistance(p1, p2);
        this.lastTouchCenter = this.getCenter(p1, p2);
        this.stageStartPos = { ...this.stage.position() };
      }
    }, { passive: false });

    content.addEventListener('touchmove', (e) => {
      // Prevenir el desplazamiento por defecto de la página web
      e.preventDefault();

      if (e.touches.length === 1 && this.isDraggingBackground) {
        const touch = e.touches[0];
        const rect = content.getBoundingClientRect();
        const currentPos = { x: touch.clientX - rect.left, y: touch.clientY - rect.top };

        const dx = currentPos.x - this.dragStartPos.x;
        const dy = currentPos.y - this.dragStartPos.y;

        this.setCameraPosition(this.stageStartPos.x + dx, this.stageStartPos.y + dy, true);
      } else if (e.touches.length >= 2 && this.lastTouchDist > 0) {
        const touch1 = e.touches[0];
        const touch2 = e.touches[1];
        const rect = content.getBoundingClientRect();

        const p1 = { x: touch1.clientX - rect.left, y: touch1.clientY - rect.top };
        const p2 = { x: touch2.clientX - rect.left, y: touch2.clientY - rect.top };

        const dist = this.getDistance(p1, p2);
        const center = this.getCenter(p1, p2);

        if (this.lastTouchDist > 5 && dist > 5) {
          const oldScale = this.stage.scaleX();
          const scaleChange = dist / this.lastTouchDist;
          const targetScale = oldScale * scaleChange;

          // Pan inducido por mover los dos dedos
          const dx = center.x - this.lastTouchCenter.x;
          const dy = center.y - this.lastTouchCenter.y;

          this.zoomAtPoint(center, targetScale, false);
          this.setCameraPosition(this.stage.x() + dx, this.stage.y() + dy, true);

          this.lastTouchDist = dist;
          this.lastTouchCenter = center;
        }
      }
    }, { passive: false });

    const endTouch = (e) => {
      if (e.touches.length === 0) {
        this.isDraggingBackground = false;
        this.isLocalGestureActive = false;
        this.lastTouchDist = 0;
        this.lastTouchCenter = null;
        this.emitCameraChange(true);
      } else if (e.touches.length === 1) {
        // Queda un solo dedo: resetear referencia de arrastre
        this.isDraggingBackground = true;
        const touch = e.touches[0];
        const rect = content.getBoundingClientRect();
        this.dragStartPos = { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
        this.stageStartPos = { ...this.stage.position() };
        this.lastTouchDist = 0;
      }
    };

    content.addEventListener('touchend', endTouch, { passive: false });
    content.addEventListener('touchcancel', endTouch, { passive: false });
  }

  getDistance(p1, p2) {
    return Math.sqrt(Math.pow(p2.x - p1.x, 2) + Math.pow(p2.y - p1.y, 2));
  }

  getCenter(p1, p2) {
    return {
      x: (p1.x + p2.x) / 2,
      y: (p1.y + p2.y) / 2
    };
  }

  /**
   * Aplica zoom centrado en una coordenada del visor (pantalla).
   */
  zoomAtPoint(pointer, targetScale, shouldEmit = true) {
    const clampedScale = Math.max(this.minScale, Math.min(this.maxScale, targetScale));
    const oldScale = this.stage.scaleX();

    // Punto en coordenadas del mundo virtual del canvas
    const mousePointTo = {
      x: (pointer.x - this.stage.x()) / oldScale,
      y: (pointer.y - this.stage.y()) / oldScale,
    };

    const newPos = {
      x: pointer.x - mousePointTo.x * clampedScale,
      y: pointer.y - mousePointTo.y * clampedScale,
    };

    this.stage.scale({ x: clampedScale, y: clampedScale });
    this.stage.position(newPos);
    this.redraw();

    if (shouldEmit) {
      this.emitCameraChange();
    }
  }

  /**
   * Actualiza la posición de la cámara directamente.
   */
  setCameraPosition(x, y, shouldEmit = false) {
    this.stage.position({ x, y });
    this.redraw();

    if (shouldEmit) {
      this.emitCameraChange();
    }
  }

  /**
   * Aplica la cámara remota recibida desde el par WebRTC.
   * Evita bucles de actualización marcando isApplyingRemoteCamera.
   */
  applyRemoteCamera(x, y, scale) {
    if (this.isLocalGestureActive) {
      // Si el usuario local está manipulando activamente la cámara en este instante,
      // la interacción local tiene prioridad temporal.
      return;
    }

    this.isApplyingRemoteCamera = true;

    const clampedScale = Math.max(this.minScale, Math.min(this.maxScale, scale));
    this.stage.position({ x, y });
    this.stage.scale({ x: clampedScale, y: clampedScale });
    this.redraw();

    this.isApplyingRemoteCamera = false;
  }

  /**
   * Emite el cambio de cámara al motor de sincronización con throttling.
   */
  emitCameraChange(forceImmediate = false) {
    if (this.isApplyingRemoteCamera || !this.onCameraChanged) return;

    const now = Date.now();
    if (!forceImmediate && (now - this.lastCameraBroadcastTime < this.broadcastThrottleMs)) {
      return;
    }

    this.lastCameraBroadcastTime = now;
    this.onCameraChanged({
      x: Math.round(this.stage.x()),
      y: Math.round(this.stage.y()),
      scale: parseFloat(this.stage.scaleX().toFixed(4)),
      active: this.isLocalGestureActive
    });
  }

  /**
   * Convierte coordenadas de pantalla (p. ej. toque o clic) a coordenadas del lienzo infinito.
   */
  screenToCanvas(screenX, screenY) {
    const scale = this.stage.scaleX();
    return {
      x: (screenX - this.stage.x()) / scale,
      y: (screenY - this.stage.y()) / scale
    };
  }

  /**
   * Obtiene el punto central actual visible en el canvas.
   */
  getViewportCenterCanvas() {
    return this.screenToCanvas(this.stage.width() / 2, this.stage.height() / 2);
  }

  /**
   * Restablece la vista al origen (0, 0) con zoom al 100% (1.0).
   */
  resetView() {
    this.stage.position({
      x: this.stage.width() / 2,
      y: this.stage.height() / 2
    });
    this.stage.scale({ x: 1.0, y: 1.0 });
    this.redraw();
    this.emitCameraChange(true);
  }

  /**
   * Redibuja las capas activas y la cuadrícula.
   */
  redraw() {
    this.gridLayer.batchDraw();
    this.objectLayer.batchDraw();
    this.uiLayer.batchDraw();
  }

  handleResize() {
    this.width = this.container.clientWidth || window.innerWidth;
    this.height = this.container.clientHeight || window.innerHeight;
    this.stage.width(this.width);
    this.stage.height(this.height);
    this.redraw();
  }

  getZoomPercent() {
    return Math.round(this.stage.scaleX() * 100);
  }

  zoomByFactor(factor) {
    const center = { x: this.stage.width() / 2, y: this.stage.height() / 2 };
    this.zoomAtPoint(center, this.stage.scaleX() * factor, true);
  }
}
