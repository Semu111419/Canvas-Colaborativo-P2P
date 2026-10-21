/**
 * object-manager.js
 * Gestión de objetos (imágenes) en el canvas:
 * Carga desde galería/portapapeles, optimización y compresión previa,
 * manipulación con Konva.Transformer (rotación, escala, arrastre),
 * selección, duplicación, orden de capas y resolución determinista de conflictos.
 */

/* global Konva */

export class ObjectManager {
  constructor(canvasManager) {
    this.canvasManager = canvasManager;
    this.stage = canvasManager.stage;
    this.objectLayer = canvasManager.objectLayer;
    this.uiLayer = canvasManager.uiLayer;

    // Almacén de objetos: id -> descriptor con metadatos y referencia konvaNode
    this.objects = new Map();
    // Almacén de assets binarios: assetId -> { blobUrl, blob, mimeType, width, height }
    this.assets = new Map();

    this.selectedId = null;
    this.myPeerId = 'local';

    // Callbacks hacia el motor de sincronización P2P
    this.onObjectAdded = null;      // (objectDescriptor, blob) => {}
    this.onObjectUpdated = null;    // (updatePayload) => {}
    this.onObjectDeleted = null;    // (id) => {}
    this.onSelectionChanged = null;  // (selectedObjectOrNull) => {}

    this.initTransformer();
    this.initStageEvents();
  }

  setPeerId(peerId) {
    this.myPeerId = peerId;
  }

  /**
   * Inicializa el componente Transformer de Konva para manipular objetos.
   */
  initTransformer() {
    this.transformer = new Konva.Transformer({
      nodes: [],
      rotateAnchorOffset: 30,
      enabledAnchors: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
      anchorSize: 18,
      anchorCornerRadius: 4,
      anchorStroke: '#3b82f6',
      anchorFill: '#ffffff',
      anchorStrokeWidth: 2,
      borderStroke: '#3b82f6',
      borderStrokeWidth: 2,
      borderDash: [6, 4],
      keepRatio: true, // Mantener proporción de aspecto de imágenes
      rotationSnaps: [0, 90, 180, 270] // Sujeción a ángulos clave
    });

    this.uiLayer.add(this.transformer);
    this.uiLayer.batchDraw();
  }

  /**
   * Listeners del escenario para deseleccionar al tocar fondo vacío.
   */
  initStageEvents() {
    this.canvasManager.onSelectionCleared = () => {
      this.deselect();
    };
  }

  /**
   * Optimiza una imagen antes de agregarla al canvas para proteger memoria y ancho de banda.
   * Redimensiona imágenes gigantes (ej. fotos de 12MP-48MP de celulares) a máx 1600px.
   * @param {Blob|File} fileBlob 
   * @returns {Promise<{ blob: Blob, width: number, height: number }>}
   */
  async optimizeImage(fileBlob) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const objectUrl = URL.createObjectURL(fileBlob);

      img.onload = () => {
        URL.revokeObjectURL(objectUrl);

        let { width, height } = img;
        const maxDim = 1600;

        // Si ya es más pequeña que el límite, la dejamos tal cual
        if (width <= maxDim && height <= maxDim && fileBlob.size < 1.5 * 1024 * 1024) {
          resolve({ blob: fileBlob, width, height });
          return;
        }

        if (width > maxDim || height > maxDim) {
          if (width > height) {
            height = Math.round((height * maxDim) / width);
            width = maxDim;
          } else {
            width = Math.round((width * maxDim) / height);
            height = maxDim;
          }
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        // Convertir a JPEG o WebP optimizado
        const mime = fileBlob.type === 'image/png' ? 'image/png' : 'image/jpeg';
        canvas.toBlob((optimizedBlob) => {
          if (!optimizedBlob) {
            resolve({ blob: fileBlob, width: img.width, height: img.height });
          } else {
            resolve({ blob: optimizedBlob, width, height });
          }
        }, mime, 0.85);
      };

      img.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        reject(new Error('No se pudo leer el archivo de imagen'));
      };

      img.src = objectUrl;
    });
  }

  /**
   * Añade una imagen localmente desde un Blob o Archivo.
   * @param {Blob|File} rawBlob 
   * @param {{x: number, y: number}|null} [position] Posición opcional en canvas
   */
  async addImageBlob(rawBlob, position = null) {
    try {
      const { blob, width: naturalWidth, height: naturalHeight } = await this.optimizeImage(rawBlob);

      const objectId = 'obj_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
      const assetId = 'ast_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);

      const blobUrl = URL.createObjectURL(blob);
      this.assets.set(assetId, {
        blobUrl,
        blob,
        mimeType: blob.type,
        width: naturalWidth,
        height: naturalHeight
      });

      // Calcular dimensiones iniciales adaptadas a la pantalla
      let displayWidth = naturalWidth;
      let displayHeight = naturalHeight;
      const targetSize = Math.min(320, window.innerWidth * 0.7);

      if (displayWidth > targetSize || displayHeight > targetSize) {
        const ratio = displayWidth / displayHeight;
        if (displayWidth > displayHeight) {
          displayWidth = targetSize;
          displayHeight = targetSize / ratio;
        } else {
          displayHeight = targetSize;
          displayWidth = targetSize * ratio;
        }
      }

      // Posición en el centro visible del viewport
      const targetPos = position || this.canvasManager.getViewportCenterCanvas();
      const x = targetPos.x - displayWidth / 2;
      const y = targetPos.y - displayHeight / 2;

      const descriptor = {
        id: objectId,
        assetId,
        x: Math.round(x),
        y: Math.round(y),
        width: Math.round(displayWidth),
        height: Math.round(displayHeight),
        scaleX: 1,
        scaleY: 1,
        rotation: 0,
        zIndex: this.objects.size,
        lastModified: Date.now(),
        lastModifiedBy: this.myPeerId
      };

      await this.createKonvaNode(descriptor, blobUrl);

      // Seleccionar automáticamente la imagen recién añadida
      this.select(objectId);

      // Notificar al sincronizador
      if (this.onObjectAdded) {
        this.onObjectAdded(descriptor, blob);
      }

      return descriptor;
    } catch (err) {
      console.error('Error al añadir imagen:', err);
      throw err;
    }
  }

  /**
   * Crea el nodo gráfico de Konva para un objeto y lo registra.
   */
  async createKonvaNode(descriptor, imageUrlOrPlaceholder = null) {
    return new Promise((resolve) => {
      const img = new Image();

      const onImageLoaded = () => {
        const konvaImg = new Konva.Image({
          id: descriptor.id,
          x: descriptor.x,
          y: descriptor.y,
          width: descriptor.width,
          height: descriptor.height,
          scaleX: descriptor.scaleX || 1,
          scaleY: descriptor.scaleY || 1,
          rotation: descriptor.rotation || 0,
          image: img,
          draggable: true,
          shadowColor: 'black',
          shadowBlur: 10,
          shadowOpacity: 0.3,
          shadowOffset: { x: 2, y: 4 }
        });

        // Configuración de interacción y eventos
        this.bindKonvaEvents(konvaImg, descriptor.id);

        this.objectLayer.add(konvaImg);
        this.objectLayer.batchDraw();

        descriptor.konvaNode = konvaImg;
        this.objects.set(descriptor.id, descriptor);

        resolve(konvaImg);
      };

      img.onload = onImageLoaded;
      img.onerror = () => {
        // Fallback gráfico en caso de fallo de carga
        console.warn(`No se pudo cargar la imagen para ${descriptor.id}`);
        resolve(null);
      };

      if (imageUrlOrPlaceholder) {
        img.src = imageUrlOrPlaceholder;
      } else {
        // Marcador provisional (placeholder) mientras llegan los chunks binarios por WebRTC
        img.src = this.generatePlaceholderSvg(descriptor.width, descriptor.height);
      }
    });
  }

  /**
   * Genera un placeholder SVG para mostrar mientras se reciben los chunks por WebRTC.
   */
  generatePlaceholderSvg(w, h) {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${w || 200}" height="${h || 200}" viewBox="0 0 ${w || 200} ${h || 200}">
        <rect width="100%" height="100%" fill="#1f2937" rx="8" stroke="#374151" stroke-width="2"/>
        <text x="50%" y="45%" text-anchor="middle" fill="#9ca3af" font-family="sans-serif" font-size="14">Descargando...</text>
        <circle cx="50%" cy="65%" r="12" fill="none" stroke="#3b82f6" stroke-width="3" stroke-dasharray="30 20"/>
      </svg>
    `;
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
  }

  /**
   * Conecta eventos de arrastre, transformación y selección a un nodo Konva.
   */
  bindKonvaEvents(konvaNode, objectId) {
    // Selección por toque o clic
    konvaNode.on('tap click', (e) => {
      e.cancelBubble = true;
      this.select(objectId);
    });

    // Control de arrastre (drag)
    konvaNode.on('dragstart', () => {
      this.select(objectId);
    });

    konvaNode.on('dragmove', () => {
      this.emitTransformUpdate(objectId, false);
    });

    konvaNode.on('dragend', () => {
      this.emitTransformUpdate(objectId, true);
    });

    // Control de transformación (escala y rotación con el Transformer)
    konvaNode.on('transform', () => {
      this.emitTransformUpdate(objectId, false);
    });

    konvaNode.on('transformend', () => {
      this.emitTransformUpdate(objectId, true);
    });
  }

  /**
   * Emite la actualización de transformación de un objeto al sincronizador.
   */
  emitTransformUpdate(objectId, isFinal = false) {
    const item = this.objects.get(objectId);
    if (!item || !item.konvaNode) return;

    const node = item.konvaNode;
    const now = Date.now();

    item.x = Math.round(node.x());
    item.y = Math.round(node.y());
    item.scaleX = parseFloat(node.scaleX().toFixed(4));
    item.scaleY = parseFloat(node.scaleY().toFixed(4));
    item.rotation = Math.round(node.rotation());
    item.lastModified = now;
    item.lastModifiedBy = this.myPeerId;

    if (this.onObjectUpdated) {
      this.onObjectUpdated({
        id: objectId,
        x: item.x,
        y: item.y,
        scaleX: item.scaleX,
        scaleY: item.scaleY,
        rotation: item.rotation,
        zIndex: item.zIndex,
        timestamp: now,
        peerId: this.myPeerId,
        isFinal
      });
    }
  }

  /**
   * Selecciona un objeto en el canvas y adjunta el Transformer.
   */
  select(objectId) {
    const item = this.objects.get(objectId);
    if (!item || !item.konvaNode) {
      this.deselect();
      return;
    }

    this.selectedId = objectId;
    this.transformer.nodes([item.konvaNode]);
    this.uiLayer.batchDraw();

    if (this.onSelectionChanged) {
      this.onSelectionChanged(item);
    }
  }

  /**
   * Deselecciona cualquier objeto actualmente seleccionado.
   */
  deselect() {
    if (this.selectedId !== null) {
      this.selectedId = null;
      this.transformer.nodes([]);
      this.uiLayer.batchDraw();

      if (this.onSelectionChanged) {
        this.onSelectionChanged(null);
      }
    }
  }

  /**
   * Elimina el objeto seleccionado.
   */
  deleteSelected() {
    if (!this.selectedId) return;
    this.deleteObject(this.selectedId, false);
  }

  /**
   * Elimina un objeto del canvas.
   */
  deleteObject(objectId, isRemote = false) {
    const item = this.objects.get(objectId);
    if (!item) return;

    if (this.selectedId === objectId) {
      this.deselect();
    }

    if (item.konvaNode) {
      item.konvaNode.destroy();
    }
    this.objects.delete(objectId);
    this.objectLayer.batchDraw();

    if (!isRemote && this.onObjectDeleted) {
      this.onObjectDeleted(objectId);
    }
  }

  /**
   * Duplica el objeto seleccionado con un leve desplazamiento visual.
   */
  async duplicateSelected() {
    if (!this.selectedId) return;
    const item = this.objects.get(this.selectedId);
    if (!item) return;

    const asset = this.assets.get(item.assetId);
    if (!asset || !asset.blob) return;

    const newPos = {
      x: item.x + 35,
      y: item.y + 35
    };

    await this.addImageBlob(asset.blob, newPos);
  }

  /**
   * Mueve el objeto hacia adelante o hacia atrás en el orden de capas (z-index).
   */
  changeZIndex(direction) {
    if (!this.selectedId) return;
    const item = this.objects.get(this.selectedId);
    if (!item || !item.konvaNode) return;

    if (direction === 'up') {
      item.konvaNode.moveUp();
    } else if (direction === 'down') {
      item.konvaNode.moveDown();
    } else if (direction === 'top') {
      item.konvaNode.moveToTop();
    } else if (direction === 'bottom') {
      item.konvaNode.moveToBottom();
    }

    item.zIndex = item.konvaNode.getZIndex();
    this.objectLayer.batchDraw();
    this.emitTransformUpdate(this.selectedId, true);
  }

  /**
   * Aplica la adición de un objeto recibido remotamente desde el par WebRTC.
   */
  async applyRemoteAdd(descriptor) {
    // Si ya existe, resolver o ignorar
    if (this.objects.has(descriptor.id)) {
      return;
    }

    const asset = this.assets.get(descriptor.assetId);
    const imageSrc = asset ? asset.blobUrl : null;

    await this.createKonvaNode(descriptor, imageSrc);
  }

  /**
   * Aplica una actualización remota recibida desde el par WebRTC.
   * Utiliza Last-Write-Wins (LWW) determinista con desempate por peerId.
   */
  applyRemoteUpdate(update) {
    const item = this.objects.get(update.id);
    if (!item) return;

    // Regla de resolución de conflictos LWW
    const isRemoteNewer = (
      update.timestamp > (item.lastModified || 0) ||
      (update.timestamp === (item.lastModified || 0) && update.peerId > (item.lastModifiedBy || ''))
    );

    if (!isRemoteNewer) {
      return;
    }

    // Actualizar metadatos
    item.x = update.x;
    item.y = update.y;
    item.scaleX = update.scaleX;
    item.scaleY = update.scaleY;
    item.rotation = update.rotation;
    item.zIndex = update.zIndex;
    item.lastModified = update.timestamp;
    item.lastModifiedBy = update.peerId;

    // Actualizar nodo visual Konva
    if (item.konvaNode) {
      item.konvaNode.setAttrs({
        x: update.x,
        y: update.y,
        scaleX: update.scaleX,
        scaleY: update.scaleY,
        rotation: update.rotation
      });

      if (typeof update.zIndex === 'number') {
        item.konvaNode.setZIndex(update.zIndex);
      }

      this.objectLayer.batchDraw();

      // Si este objeto está actualmente seleccionado por el usuario local, actualizar el transformer
      if (this.selectedId === update.id) {
        this.transformer.forceUpdate();
        this.uiLayer.batchDraw();
      }
    }
  }

  /**
   * Notifica que una imagen binaria (assetId) terminó de descargarse por chunks.
   * Reemplaza el placeholder con la imagen real y redibuja.
   */
  attachCompletedAsset(assetId, blobUrl, mimeType, blob) {
    this.assets.set(assetId, { blobUrl, blob, mimeType });

    const img = new Image();
    img.onload = () => {
      for (const [, item] of this.objects) {
        if (item.assetId === assetId && item.konvaNode) {
          item.konvaNode.image(img);
        }
      }
      this.objectLayer.batchDraw();
      this.uiLayer.batchDraw();
    };
    img.src = blobUrl;
  }

  /**
   * Retorna una instantánea limpia de todos los objetos para la sincronización completa de estado.
   */
  exportState() {
    const list = [];
    for (const [, item] of this.objects) {
      list.push({
        id: item.id,
        assetId: item.assetId,
        x: item.x,
        y: item.y,
        width: item.width,
        height: item.height,
        scaleX: item.scaleX,
        scaleY: item.scaleY,
        rotation: item.rotation,
        zIndex: item.zIndex,
        lastModified: item.lastModified,
        lastModifiedBy: item.lastModifiedBy
      });
    }
    return list;
  }

  /**
   * Importa un estado completo tras una reconexión.
   */
  async importState(objectList) {
    // Mantener los assets existentes, actualizar objetos
    for (const desc of objectList) {
      if (this.objects.has(desc.id)) {
        this.applyRemoteUpdate({
          ...desc,
          timestamp: desc.lastModified,
          peerId: desc.lastModifiedBy
        });
      } else {
        await this.applyRemoteAdd(desc);
      }
    }
  }
}
