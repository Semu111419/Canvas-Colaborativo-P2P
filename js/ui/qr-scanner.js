/**
 * qr-scanner.js
 * Envoltorio para lectura de códigos QR mediante cámara móvil usando Html5Qrcode.
 * Configuración optimizada para cámara trasera ('environment') y gestión de permisos.
 */

/* global Html5Qrcode */

export class QRScannerWrapper {
  constructor(elementId, onScanSuccess, onScanError) {
    this.elementId = elementId;
    this.onScanSuccess = onScanSuccess;
    this.onScanError = onScanError;
    this.html5QrCode = null;
    this.isScanning = false;
    this.currentCameraId = null;
    this.cameras = [];
  }

  /**
   * Inicializa e inicia la cámara para escanear el QR.
   */
  async start() {
    if (this.isScanning) return;

    const container = document.getElementById(this.elementId);
    if (!container) {
      throw new Error(`Elemento #${this.elementId} no encontrado`);
    }

    try {
      this.html5QrCode = new Html5Qrcode(this.elementId);

      const config = {
        fps: 15,
        qrbox: (viewfinderWidth, viewfinderHeight) => {
          const minEdge = Math.min(viewfinderWidth, viewfinderHeight);
          const qrboxSize = Math.floor(minEdge * 0.72);
          return {
            width: qrboxSize,
            height: qrboxSize
          };
        },
        aspectRatio: 1.0
      };

      // Preferir cámara trasera ('environment') en celulares
      await this.html5QrCode.start(
        { facingMode: 'environment' },
        config,
        (decodedText) => {
          if (this.isScanning) {
            this.stop().catch(console.error);
            if (this.onScanSuccess) {
              this.onScanSuccess(decodedText);
            }
          }
        },
        (errorMessage) => {
          // Escaneo continuo en progreso (normal mientras enfoca)
          if (this.onScanError) {
            this.onScanError(errorMessage);
          }
        }
      );

      this.isScanning = true;
    } catch (err) {
      console.error('Error al iniciar la cámara del escáner:', err);
      let userFriendlyMessage = 'No se pudo acceder a la cámara.';

      if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
        userFriendlyMessage += ' Los navegadores móviles exigen HTTPS para habilitar la cámara. Por favor use la opción de copiar/pegar texto o aloje en GitHub Pages.';
      } else if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        userFriendlyMessage += ' El permiso de cámara fue denegado en el navegador.';
      } else if (err.name === 'NotFoundError') {
        userFriendlyMessage += ' No se detectó ninguna cámara en este dispositivo.';
      }

      throw new Error(userFriendlyMessage);
    }
  }

  /**
   * Detiene la cámara y limpia los recursos del stream de video.
   */
  async stop() {
    if (!this.isScanning || !this.html5QrCode) return;

    try {
      this.isScanning = false;
      await this.html5QrCode.stop();
      await this.html5QrCode.clear();
    } catch (err) {
      console.warn('Error al detener escáner QR:', err);
    }
  }
}
