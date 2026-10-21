/**
 * modal-manager.js
 * Gestión de diálogos modales para el emparejamiento P2P con códigos QR / texto,
 * entrada manual, ayuda interactiva e instrucciones paso a paso.
 */

import { SignalingHelper } from '../p2p/signaling.js';
import { QRScannerWrapper } from './qr-scanner.js';

export class ModalManager {
  constructor(p2p, syncEngine, statusBar) {
    this.p2p = p2p;
    this.syncEngine = syncEngine;
    this.statusBar = statusBar;

    // Modales en el DOM
    this.pairModal = document.getElementById('pairModal');
    this.scannerModal = document.getElementById('scannerModal');
    this.manualInputModal = document.getElementById('manualInputModal');
    this.helpModal = document.getElementById('helpModal');

    // Elementos de Emparejamiento
    this.tabHost = document.getElementById('tabHost');
    this.tabGuest = document.getElementById('tabGuest');
    this.viewHost = document.getElementById('viewHost');
    this.viewGuest = document.getElementById('viewGuest');

    // Vistas internas del Anfitrión
    this.hostStep1 = document.getElementById('hostStep1');
    this.hostStep2 = document.getElementById('hostStep2');
    this.hostQrContainer = document.getElementById('hostQrContainer');
    this.hostCodeInput = document.getElementById('hostCodeInput');
    this.btnCopyHostCode = document.getElementById('btnCopyHostCode');
    this.btnHostScanAnswer = document.getElementById('btnHostScanAnswer');
    this.btnHostPasteAnswer = document.getElementById('btnHostPasteAnswer');
    this.btnStartHost = document.getElementById('btnStartHost');

    // Vistas internas del Invitado
    this.guestStep1 = document.getElementById('guestStep1');
    this.guestStep2 = document.getElementById('guestStep2');
    this.btnGuestScanOffer = document.getElementById('btnGuestScanOffer');
    this.btnGuestPasteOffer = document.getElementById('btnGuestPasteOffer');
    this.guestQrContainer = document.getElementById('guestQrContainer');
    this.guestCodeInput = document.getElementById('guestCodeInput');
    this.btnCopyGuestCode = document.getElementById('btnCopyGuestCode');

    // Escáner
    this.scannerTarget = null; // 'guest-offer' | 'host-answer'
    this.qrScanner = new QRScannerWrapper(
      'qrReader',
      (decodedText) => this.handleScanSuccess(decodedText),
      (err) => { /* debug scanner errors */ }
    );

    this.initEvents();
  }

  initEvents() {
    // Cerrar modales con botones de cerrar
    document.querySelectorAll('.modal-close').forEach(btn => {
      btn.addEventListener('click', () => {
        this.closeAllModals();
      });
    });

    // Pestañas Anfitrión / Invitado
    this.tabHost.addEventListener('click', () => this.switchTab('host'));
    this.tabGuest.addEventListener('click', () => this.switchTab('guest'));

    // Botón Iniciar como Anfitrión
    this.btnStartHost.addEventListener('click', () => this.startHostFlow());

    // Botones de copia al portapapeles
    this.btnCopyHostCode.addEventListener('click', () => {
      this.copyToClipboard(this.hostCodeInput.value, this.btnCopyHostCode);
    });

    this.btnCopyGuestCode.addEventListener('click', () => {
      this.copyToClipboard(this.guestCodeInput.value, this.btnCopyGuestCode);
    });

    // Anfitrión escanea respuesta del invitado
    this.btnHostScanAnswer.addEventListener('click', () => {
      this.openScanner('host-answer');
    });

    // Anfitrión pega respuesta manualmente
    this.btnHostPasteAnswer.addEventListener('click', () => {
      this.openManualInput('host-answer');
    });

    // Invitado escanea oferta del anfitrión
    this.btnGuestScanOffer.addEventListener('click', () => {
      this.openScanner('guest-offer');
    });

    // Invitado pega oferta manualmente
    this.btnGuestPasteOffer.addEventListener('click', () => {
      this.openManualInput('guest-offer');
    });

    // Aceptar en modal de entrada manual
    document.getElementById('btnSubmitManualCode').addEventListener('click', () => {
      const code = document.getElementById('manualCodeTextarea').value.trim();
      if (!code) return;
      this.closeModal(this.manualInputModal);
      this.handleCodeReceived(this.scannerTarget, code);
    });

    // Cerrar cámara al pulsar cancelar en escáner
    document.getElementById('btnCloseScanner').addEventListener('click', () => {
      this.qrScanner.stop();
      this.closeModal(this.scannerModal);
      this.openModal(this.pairModal);
    });

    // Cuando se conecta con éxito, cerrar modales automáticamente
    this.p2p.onStateChange = (state) => {
      this.statusBar.updateConnectionState(state);
      if (state === 'CONNECTED') {
        this.closeAllModals();
        this.statusBar.showToast('¡Dispositivos vinculados correctamente!', 'success');
      }
    };
  }

  switchTab(tab) {
    if (tab === 'host') {
      this.tabHost.classList.add('active');
      this.tabGuest.classList.remove('active');
      this.viewHost.classList.add('active');
      this.viewGuest.classList.remove('active');
    } else {
      this.tabGuest.classList.add('active');
      this.tabHost.classList.remove('active');
      this.viewGuest.classList.add('active');
      this.viewHost.classList.remove('active');
    }
  }

  openPairingModal() {
    this.openModal(this.pairModal);
  }

  openHelpModal() {
    this.openModal(this.helpModal);
  }

  openModal(modalEl) {
    if (modalEl) modalEl.classList.add('visible');
  }

  closeModal(modalEl) {
    if (modalEl) modalEl.classList.remove('visible');
  }

  closeAllModals() {
    this.qrScanner.stop();
    document.querySelectorAll('.modal-overlay').forEach(el => el.classList.remove('visible'));
  }

  /**
   * Inicia el flujo del Anfitrión (Host): crea oferta SDP, genera QR y muestra opciones.
   */
  async startHostFlow() {
    this.btnStartHost.disabled = true;
    this.btnStartHost.textContent = 'Generando sala...';

    try {
      const offerPayload = await this.p2p.initAsHost();

      this.hostCodeInput.value = offerPayload;
      SignalingHelper.renderQRCode(offerPayload, this.hostQrContainer, 5);

      this.hostStep1.style.display = 'none';
      this.hostStep2.style.display = 'block';
    } catch (err) {
      this.statusBar.showToast('Error al crear sala: ' + err.message, 'error');
      this.btnStartHost.disabled = false;
      this.btnStartHost.textContent = 'Crear nueva sala';
    }
  }

  /**
   * Abre la cámara para escanear el código QR.
   */
  async openScanner(target) {
    this.scannerTarget = target;
    this.closeModal(this.pairModal);
    this.openModal(this.scannerModal);

    const titleEl = document.getElementById('scannerTitle');
    if (titleEl) {
      titleEl.textContent = target === 'guest-offer' 
        ? 'Escanear QR del Anfitrión' 
        : 'Escanear Respuesta del Invitado';
    }

    try {
      await this.qrScanner.start();
    } catch (err) {
      this.statusBar.showToast(err.message, 'error', 6000);
      this.closeModal(this.scannerModal);
      this.openManualInput(target);
    }
  }

  /**
   * Abre el modal de entrada manual de texto si no se puede o no se desea usar la cámara.
   */
  openManualInput(target) {
    this.scannerTarget = target;
    this.closeModal(this.pairModal);
    this.closeModal(this.scannerModal);

    const titleEl = document.getElementById('manualInputTitle');
    const textarea = document.getElementById('manualCodeTextarea');
    textarea.value = '';

    if (titleEl) {
      titleEl.textContent = target === 'guest-offer'
        ? 'Pegar código de Oferta (del Anfitrión)'
        : 'Pegar código de Respuesta (del Invitado)';
    }

    this.openModal(this.manualInputModal);
    textarea.focus();
  }

  /**
   * Callback cuando el escáner QR detecta un código exitosamente.
   */
  handleScanSuccess(decodedText) {
    this.qrScanner.stop();
    this.closeModal(this.scannerModal);
    this.handleCodeReceived(this.scannerTarget, decodedText);
  }

  /**
   * Procesa los datos de señalización recibidos (por QR o por pegado manual).
   */
  async handleCodeReceived(target, rawCode) {
    try {
      if (target === 'guest-offer') {
        // El Invitado procesa la oferta del Anfitrión y genera la Respuesta
        this.openModal(this.pairModal);
        this.switchTab('guest');
        this.guestStep1.style.display = 'none';
        this.guestStep2.style.display = 'block';

        this.statusBar.showToast('Generando respuesta...', 'info');
        const answerPayload = await this.p2p.initAsGuest(rawCode);

        this.guestCodeInput.value = answerPayload;
        SignalingHelper.renderQRCode(answerPayload, this.guestQrContainer, 5);
        this.statusBar.showToast('¡Respuesta lista! Muéstrala al Anfitrión', 'success');

      } else if (target === 'host-answer') {
        // El Anfitrión procesa la respuesta del Invitado para establecer la conexión
        this.statusBar.showToast('Conectando directamente con el par...', 'info');
        await this.p2p.acceptAnswer(rawCode);
      }
    } catch (err) {
      console.error('Error procesando código de señalización:', err);
      this.statusBar.showToast('Código no válido o incompatible: ' + err.message, 'error', 5000);
      this.openModal(this.pairModal);
    }
  }

  /**
   * Copia texto al portapapeles y proporciona retroalimentación visual al usuario.
   */
  async copyToClipboard(text, buttonElement) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }

      const originalText = buttonElement.innerHTML;
      buttonElement.innerHTML = '<span>¡Copiado! ✓</span>';
      setTimeout(() => {
        buttonElement.innerHTML = originalText;
      }, 2000);
    } catch (err) {
      this.statusBar.showToast('No se pudo copiar automáticamente. Por favor seleccione y copie el texto.', 'warning');
    }
  }
}
