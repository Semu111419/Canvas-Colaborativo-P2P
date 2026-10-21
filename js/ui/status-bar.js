/**
 * status-bar.js
 * Indicadores visuales de estado de conexión, estado de la cámara compartida
 * y sistema de notificaciones flotantes (toasts) con barra de progreso.
 */

import { ConnectionState } from '../p2p/webrtc.js';

export class StatusBar {
  constructor() {
    this.badgeEl = document.getElementById('connectionBadge');
    this.statusTextEl = document.getElementById('connectionStatusText');
    this.latencyEl = document.getElementById('connectionLatency');
    this.cameraIndicatorEl = document.getElementById('cameraIndicator');
    this.toastContainerEl = document.getElementById('toastContainer');
    this.progressContainerEl = document.getElementById('transferProgressContainer');
    this.progressBarEl = document.getElementById('transferProgressBar');
    this.progressTextEl = document.getElementById('transferProgressText');

    this.activeToasts = [];
  }

  /**
   * Actualiza la insignia de estado de conexión P2P.
   * @param {string} state 
   * @param {string|null} [detail]
   */
  updateConnectionState(state, detail = null) {
    if (!this.badgeEl) return;

    this.badgeEl.className = 'status-badge';
    let text = 'Desconectado';

    switch (state) {
      case ConnectionState.GATHERING_OFFER:
        this.badgeEl.classList.add('status-warning');
        text = 'Creando sala...';
        break;
      case ConnectionState.WAITING_FOR_ANSWER:
        this.badgeEl.classList.add('status-warning');
        text = 'Esperando invitado...';
        break;
      case ConnectionState.GATHERING_ANSWER:
        this.badgeEl.classList.add('status-warning');
        text = 'Generando respuesta...';
        break;
      case ConnectionState.CONNECTING:
        this.badgeEl.classList.add('status-warning');
        text = 'Conectando P2P...';
        break;
      case ConnectionState.CONNECTED:
        this.badgeEl.classList.add('status-success');
        text = 'Conectado P2P';
        break;
      case ConnectionState.FAILED:
        this.badgeEl.classList.add('status-danger');
        text = 'Fallo de conexión';
        if (detail) this.showToast(detail, 'error', 6000);
        break;
      case ConnectionState.DISCONNECTED:
      case ConnectionState.CLOSED:
      default:
        this.badgeEl.classList.add('status-disconnected');
        text = 'Desconectado';
        if (detail) this.showToast(detail, 'warning', 4000);
        break;
    }

    if (this.statusTextEl) {
      this.statusTextEl.textContent = text;
    }
  }

  /**
   * Actualiza la latencia medida en ms.
   */
  updateLatency(ms) {
    if (this.latencyEl) {
      if (ms > 0) {
        this.latencyEl.textContent = `${ms} ms`;
        this.latencyEl.style.display = 'inline-block';
      } else {
        this.latencyEl.style.display = 'none';
      }
    }
  }

  /**
   * Actualiza el indicador visual de la cámara compartida.
   * @param {boolean} isSyncEnabled 
   * @param {boolean} isPeerActive 
   */
  updateCameraState(isSyncEnabled, isPeerActive = false) {
    if (!this.cameraIndicatorEl) return;

    if (!isSyncEnabled) {
      this.cameraIndicatorEl.textContent = 'Cámara: Libre';
      this.cameraIndicatorEl.className = 'camera-pill pill-free';
      return;
    }

    if (isPeerActive) {
      this.cameraIndicatorEl.textContent = 'Par moviendo cámara';
      this.cameraIndicatorEl.className = 'camera-pill pill-peer-active';
    } else {
      this.cameraIndicatorEl.textContent = 'Cámara compartida';
      this.cameraIndicatorEl.className = 'camera-pill pill-synced';
    }
  }

  /**
   * Muestra el progreso de una transferencia de imagen por chunks.
   */
  updateTransferProgress(percent, direction = 'upload') {
    if (!this.progressContainerEl || !this.progressBarEl) return;

    if (percent >= 100 || percent <= 0) {
      setTimeout(() => {
        this.progressContainerEl.classList.remove('visible');
      }, 800);
      return;
    }

    this.progressContainerEl.classList.add('visible');
    this.progressBarEl.style.width = `${percent}%`;

    if (this.progressTextEl) {
      const label = direction === 'upload' ? 'Enviando imagen' : 'Recibiendo imagen';
      this.progressTextEl.textContent = `${label} (${percent}%)`;
    }
  }

  /**
   * Muestra un mensaje flotante temporal (Toast).
   * @param {string} message 
   * @param {'info'|'success'|'warning'|'error'} [type='info'] 
   * @param {number} [duration=3500] 
   */
  showToast(message, type = 'info', duration = 3500) {
    if (!this.toastContainerEl) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = message;

    this.toastContainerEl.appendChild(toast);

    // Animación de entrada
    requestAnimationFrame(() => {
      toast.classList.add('show');
    });

    setTimeout(() => {
      toast.classList.remove('show');
      setTimeout(() => {
        if (toast.parentNode) {
          toast.parentNode.removeChild(toast);
        }
      }, 300);
    }, duration);
  }
}
