/**
 * sync-engine.js
 * Orquestador de sincronización en tiempo real:
 * - Árbitro de cámara compartida con control temporal por gesto más reciente.
 * - Prevención de bucles de actualización y mensajes redundantes.
 * - Protocolo de recuperación de estado completo tras reconexión (STATE_SYNC).
 * - Transferencia de imágenes por fragmentos binarios (chunking).
 * - Resolución determinista de conflictos en objetos.
 */

import { MessageType, ProtocolValidator, ImageChunkManager } from './protocol.js';

export class SyncEngine {
  constructor(p2p, canvasManager, objectManager) {
    this.p2p = p2p;
    this.canvasManager = canvasManager;
    this.objectManager = objectManager;

    this.chunkManager = new ImageChunkManager((msg) => this.p2p.send(msg));

    // Control de la cámara compartida
    this.lastLocalGestureTime = 0;
    this.lastRemoteCameraTime = 0;
    this.isCameraSyncEnabled = true; // Por defecto siempre activa
    this.lastSentCamera = { x: null, y: null, scale: null };

    // Notificaciones hacia la interfaz de usuario
    this.onStatusNotification = null; // (text, type) => {}
    this.onPeerCameraActive = null;   // (isActive) => {}
    this.onTransferProgress = null;   // (assetId, percent, direction) => {}

    this.bindP2PEvents();
    this.bindCanvasEvents();
    this.bindObjectEvents();
    this.bindChunkEvents();
  }

  /**
   * Conecta con los eventos del canal de datos WebRTC.
   */
  bindP2PEvents() {
    this.p2p.onChannelOpen = () => {
      this.objectManager.setPeerId(this.p2p.peerId);

      if (this.onStatusNotification) {
        this.onStatusNotification('¡Conectado exitosamente con el par!', 'success');
      }

      if (this.p2p.isHost) {
        // El anfitrión envía de inmediato el estado completo inicial
        this.sendFullStateSync();
      } else {
        // El invitado solicita la sincronización inicial
        this.p2p.send({
          type: MessageType.STATE_SYNC_REQUEST,
          peerId: this.p2p.peerId,
          timestamp: Date.now()
        });
      }
    };

    this.p2p.onMessage = (msg) => {
      if (!ProtocolValidator.isValidMessage(msg)) {
        console.warn('Mensaje recibido inválido o desconocido:', msg);
        return;
      }

      this.handleIncomingMessage(msg);
    };

    this.p2p.onChannelClose = () => {
      this.chunkManager.clear();
      if (this.onStatusNotification) {
        this.onStatusNotification('Conexión con el par cerrada.', 'warning');
      }
    };
  }

  /**
   * Conecta con los eventos de la cámara del Canvas infinito.
   */
  bindCanvasEvents() {
    this.canvasManager.onCameraChanged = (cameraState) => {
      if (!this.isCameraSyncEnabled || !this.p2p.isConnected()) return;

      this.lastLocalGestureTime = Date.now();

      // Evitar enviar mensajes redundantes si la posición no ha variado significativamente
      const { x, y, scale, active } = cameraState;
      if (
        this.lastSentCamera.x === x &&
        this.lastSentCamera.y === y &&
        Math.abs(this.lastSentCamera.scale - scale) < 0.001 &&
        !active
      ) {
        return;
      }

      this.lastSentCamera = { x, y, scale };

      this.p2p.send({
        type: MessageType.CAMERA_SYNC,
        x,
        y,
        scale,
        active,
        timestamp: this.lastLocalGestureTime,
        peerId: this.p2p.peerId
      });
    };
  }

  /**
   * Conecta con los eventos de manipulación de objetos del Canvas.
   */
  bindObjectEvents() {
    // 1. Objeto añadido localmente
    this.objectManager.onObjectAdded = async (descriptor, blob) => {
      if (!this.p2p.isConnected()) return;

      // Primero emitimos el descriptor del objeto en el canvas
      this.p2p.send({
        type: MessageType.OBJECT_ADD,
        object: descriptor,
        timestamp: descriptor.lastModified,
        peerId: this.p2p.peerId
      });

      // Transmitimos los bloques binarios de la imagen por el canal de datos
      try {
        await this.chunkManager.sendImageBlob(descriptor.assetId, blob, this.p2p.dataChannel);
      } catch (err) {
        console.error('Error enviando imagen por bloques:', err);
        if (this.onStatusNotification) {
          this.onStatusNotification('Error al enviar imagen: ' + err.message, 'error');
        }
      }
    };

    // 2. Transformación de objeto (arrastre, rotación, escala)
    this.objectManager.onObjectUpdated = (update) => {
      if (!this.p2p.isConnected()) return;

      this.p2p.send({
        type: MessageType.OBJECT_UPDATE,
        update,
        timestamp: update.timestamp,
        peerId: this.p2p.peerId
      });
    };

    // 3. Objeto eliminado localmente
    this.objectManager.onObjectDeleted = (objectId) => {
      if (!this.p2p.isConnected()) return;

      this.p2p.send({
        type: MessageType.OBJECT_DELETE,
        id: objectId,
        timestamp: Date.now(),
        peerId: this.p2p.peerId
      });
    };
  }

  /**
   * Conecta con el gestor de fragmentos de imagen (ImageChunkManager).
   */
  bindChunkEvents() {
    this.chunkManager.onImageComplete = (assetId, blobUrl, mimeType, blob) => {
      this.objectManager.attachCompletedAsset(assetId, blobUrl, mimeType, blob);

      // Confirmar recepción al par
      this.p2p.send({
        type: MessageType.IMAGE_ACK,
        assetId,
        peerId: this.p2p.peerId
      });

      if (this.onStatusNotification) {
        this.onStatusNotification('Imagen recibida y sincronizada', 'info');
      }
    };

    this.chunkManager.onProgress = (assetId, percent, direction) => {
      if (this.onTransferProgress) {
        this.onTransferProgress(assetId, percent, direction);
      }
    };
  }

  /**
   * Procesa mensajes entrantes desde el canal WebRTC.
   */
  async handleIncomingMessage(msg) {
    switch (msg.type) {
      // Sincronización continua de cámara con árbitro temporal
      case MessageType.CAMERA_SYNC: {
        if (!this.isCameraSyncEnabled) return;

        const now = Date.now();
        const isLocalBusy = this.canvasManager.isLocalGestureActive && (now - this.lastLocalGestureTime < 300);

        // Si el usuario local está realizando un gesto en este preciso instante, ignoramos la cámara remota.
        // Si el gesto remoto es más reciente, le otorgamos el control al usuario remoto.
        if (!isLocalBusy || msg.timestamp > this.lastLocalGestureTime) {
          this.lastRemoteCameraTime = msg.timestamp;
          this.canvasManager.applyRemoteCamera(msg.x, msg.y, msg.scale);

          if (this.onPeerCameraActive) {
            this.onPeerCameraActive(Boolean(msg.active));
          }
        }
        break;
      }

      // Adición remota de objeto
      case MessageType.OBJECT_ADD: {
        if (!ProtocolValidator.isValidCanvasObject(msg.object)) return;

        await this.objectManager.applyRemoteAdd(msg.object);

        // Si no tenemos el asset binario aún, lo solicitamos si no está ya en tránsito
        if (!this.objectManager.assets.has(msg.object.assetId)) {
          this.p2p.send({
            type: MessageType.IMAGE_REQUEST,
            assetId: msg.object.assetId,
            peerId: this.p2p.peerId
          });
        }
        break;
      }

      // Actualización remota de objeto (posición, escala, rotación)
      case MessageType.OBJECT_UPDATE: {
        if (msg.update && msg.update.id) {
          this.objectManager.applyRemoteUpdate(msg.update);
        }
        break;
      }

      // Eliminación remota de objeto
      case MessageType.OBJECT_DELETE: {
        if (msg.id) {
          this.objectManager.deleteObject(msg.id, true);
        }
        break;
      }

      // Solicitud de estado completo (enviado por el invitado al unirse)
      case MessageType.STATE_SYNC_REQUEST: {
        this.sendFullStateSync();
        break;
      }

      // Recepción de estado completo (recibido por el invitado)
      case MessageType.STATE_SYNC: {
        if (Array.isArray(msg.objects)) {
          await this.objectManager.importState(msg.objects);

          // Verificar qué imágenes faltan y solicitarlas
          for (const obj of msg.objects) {
            if (!this.objectManager.assets.has(obj.assetId)) {
              this.p2p.send({
                type: MessageType.IMAGE_REQUEST,
                assetId: obj.assetId,
                peerId: this.p2p.peerId
              });
            }
          }
        }

        // Sincronizar cámara inicial si se incluye
        if (msg.camera && this.isCameraSyncEnabled) {
          this.canvasManager.applyRemoteCamera(msg.camera.x, msg.camera.y, msg.camera.scale);
        }

        if (this.onStatusNotification) {
          this.onStatusNotification('Lienzo sincronizado con el anfitrión', 'info');
        }
        break;
      }

      // Solicitud de envío binario de una imagen
      case MessageType.IMAGE_REQUEST: {
        const asset = this.objectManager.assets.get(msg.assetId);
        if (asset && asset.blob && this.p2p.dataChannel) {
          try {
            await this.chunkManager.sendImageBlob(msg.assetId, asset.blob, this.p2p.dataChannel);
          } catch (err) {
            console.error(`Error enviando imagen solicitada ${msg.assetId}:`, err);
          }
        }
        break;
      }

      // Fragmento de imagen binaria entrante
      case MessageType.IMAGE_CHUNK: {
        this.chunkManager.handleIncomingChunk(msg);
        break;
      }

      case MessageType.IMAGE_ACK: {
        console.log(`Par confirmó recepción de imagen ${msg.assetId}`);
        break;
      }

      default:
        break;
    }
  }

  /**
   * Envía la instantánea completa de objetos y cámara actual.
   */
  sendFullStateSync() {
    if (!this.p2p.isConnected()) return;

    const objects = this.objectManager.exportState();
    const camera = {
      x: Math.round(this.canvasManager.stage.x()),
      y: Math.round(this.canvasManager.stage.y()),
      scale: parseFloat(this.canvasManager.stage.scaleX().toFixed(4))
    };

    this.p2p.send({
      type: MessageType.STATE_SYNC,
      objects,
      camera,
      timestamp: Date.now(),
      peerId: this.p2p.peerId
    });
  }

  setCameraSyncEnabled(enabled) {
    this.isCameraSyncEnabled = enabled;
  }
}
