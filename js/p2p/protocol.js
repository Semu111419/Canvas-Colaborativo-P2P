/**
 * protocol.js
 * Definición de mensajes, validación de esquemas, fragmentación (chunking)
 * y reensamblado de imágenes binarias para WebRTC DataChannel.
 */

export const MessageType = {
  OBJECT_ADD: 'OBJECT_ADD',
  OBJECT_UPDATE: 'OBJECT_UPDATE',
  OBJECT_DELETE: 'OBJECT_DELETE',
  CAMERA_SYNC: 'CAMERA_SYNC',
  STATE_SYNC_REQUEST: 'STATE_SYNC_REQUEST',
  STATE_SYNC: 'STATE_SYNC',
  IMAGE_REQUEST: 'IMAGE_REQUEST',
  IMAGE_CHUNK: 'IMAGE_CHUNK',
  IMAGE_ACK: 'IMAGE_ACK',
  PING: 'PING',
  PONG: 'PONG'
};

export const PROTOCOL_CONFIG = {
  CHUNK_SIZE: 16 * 1024, // 16 KB por bloque para no saturar el buffer SCTP
  MAX_IMAGE_SIZE: 15 * 1024 * 1024, // 15 MB máximo permitido
  BUFFERED_AMOUNT_LIMIT: 256 * 1024 // 256 KB umbral de contrapresión
};

export class ProtocolValidator {
  /**
   * Valida la estructura básica de un mensaje recibido.
   * @param {any} msg 
   * @returns {boolean}
   */
  static isValidMessage(msg) {
    if (!msg || typeof msg !== 'object') return false;
    if (!msg.type || typeof msg.type !== 'string') return false;
    return Object.values(MessageType).includes(msg.type);
  }

  /**
   * Valida la estructura de un objeto del canvas.
   * @param {any} obj 
   * @returns {boolean}
   */
  static isValidCanvasObject(obj) {
    if (!obj || typeof obj !== 'object') return false;
    return (
      typeof obj.id === 'string' &&
      typeof obj.assetId === 'string' &&
      typeof obj.x === 'number' &&
      typeof obj.y === 'number' &&
      typeof obj.width === 'number' &&
      typeof obj.height === 'number'
    );
  }
}

/**
 * Gestor de transmisión y recepción de imágenes fragmentadas en bloques binarios.
 */
export class ImageChunkManager {
  constructor(sendFunction) {
    this.send = sendFunction;
    // Map para almacenar transferencias entrantes: assetId -> { chunks, receivedCount, totalChunks, totalBytes, mimeType }
    this.incomingTransfers = new Map();
    // Callback cuando una imagen completa su recepción: (assetId, blobUrl, mimeType) => {}
    this.onImageComplete = null;
    // Callback de progreso de transferencia: (assetId, percent, direction) => {}
    this.onProgress = null;
  }

  /**
   * Divide un Blob de imagen en bloques y los transmite con control de flujo.
   * @param {string} assetId 
   * @param {Blob} blob 
   * @param {RTCDataChannel} dataChannel 
   */
  async sendImageBlob(assetId, blob, dataChannel) {
    if (blob.size > PROTOCOL_CONFIG.MAX_IMAGE_SIZE) {
      throw new Error(`La imagen supera el límite permitido de ${PROTOCOL_CONFIG.MAX_IMAGE_SIZE / (1024 * 1024)} MB`);
    }

    const arrayBuffer = await blob.arrayBuffer();
    const totalBytes = arrayBuffer.byteLength;
    const chunkSize = PROTOCOL_CONFIG.CHUNK_SIZE;
    const totalChunks = Math.ceil(totalBytes / chunkSize);
    const mimeType = blob.type || 'image/jpeg';

    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
      const start = chunkIndex * chunkSize;
      const end = Math.min(start + chunkSize, totalBytes);
      const slice = arrayBuffer.slice(start, end);

      // Convertimos el fragmento a Base64
      const chunkBytes = new Uint8Array(slice);
      let binaryStr = '';
      for (let i = 0; i < chunkBytes.length; i++) {
        binaryStr += String.fromCharCode(chunkBytes[i]);
      }
      const chunkData = btoa(binaryStr);

      const msg = {
        type: MessageType.IMAGE_CHUNK,
        assetId,
        mimeType,
        chunkIndex,
        totalChunks,
        totalBytes,
        chunkData
      };

      // Control de contrapresión (backpressure) de WebRTC
      while (dataChannel.bufferedAmount > PROTOCOL_CONFIG.BUFFERED_AMOUNT_LIMIT) {
        await new Promise(resolve => setTimeout(resolve, 30));
      }

      this.send(msg);

      if (this.onProgress) {
        const percent = Math.round(((chunkIndex + 1) / totalChunks) * 100);
        this.onProgress(assetId, percent, 'upload');
      }
    }
  }

  /**
   * Procesa un fragmento de imagen recibido.
   * @param {object} chunkMsg 
   */
  handleIncomingChunk(chunkMsg) {
    const { assetId, mimeType, chunkIndex, totalChunks, totalBytes, chunkData } = chunkMsg;

    if (!this.incomingTransfers.has(assetId)) {
      if (totalBytes > PROTOCOL_CONFIG.MAX_IMAGE_SIZE) {
        console.error(`Rechazando imagen ${assetId}: excede el tamaño máximo`);
        return;
      }
      this.incomingTransfers.set(assetId, {
        chunks: new Array(totalChunks),
        receivedCount: 0,
        totalChunks,
        totalBytes,
        mimeType: mimeType || 'image/jpeg'
      });
    }

    const transfer = this.incomingTransfers.get(assetId);
    
    // Evitar procesar fragmentos duplicados
    if (!transfer.chunks[chunkIndex]) {
      // Decodificamos el bloque base64 a Uint8Array
      const binary = atob(chunkData);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      transfer.chunks[chunkIndex] = bytes;
      transfer.receivedCount++;

      if (this.onProgress) {
        const percent = Math.round((transfer.receivedCount / transfer.totalChunks) * 100);
        this.onProgress(assetId, percent, 'download');
      }

      // Si se recibieron todos los bloques, ensamblamos el Blob final
      if (transfer.receivedCount === transfer.totalChunks) {
        const blob = new Blob(transfer.chunks, { type: transfer.mimeType });
        const blobUrl = URL.createObjectURL(blob);
        this.incomingTransfers.delete(assetId);

        if (this.onImageComplete) {
          this.onImageComplete(assetId, blobUrl, transfer.mimeType, blob);
        }
      }
    }
  }

  /**
   * Cancela o limpia transferencias en caso de desconexión.
   */
  clear() {
    this.incomingTransfers.clear();
  }
}
