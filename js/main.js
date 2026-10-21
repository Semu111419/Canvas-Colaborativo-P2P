/**
 * main.js
 * Punto de entrada de la aplicación Canvas Colaborativo P2P.
 * Inicializa y conecta los módulos de interfaz, canvas interactivo y red WebRTC.
 */

import { CanvasManager } from './canvas/canvas-manager.js';
import { ObjectManager } from './canvas/object-manager.js';
import { P2PConnection } from './p2p/webrtc.js';
import { SyncEngine } from './p2p/sync-engine.js';
import { StatusBar } from './ui/status-bar.js';
import { ModalManager } from './ui/modal-manager.js';
import { Toolbar } from './ui/toolbar.js';

class App {
  constructor() {
    this.canvasManager = null;
    this.objectManager = null;
    this.p2p = null;
    this.syncEngine = null;
    this.statusBar = null;
    this.modalManager = null;
    this.toolbar = null;
  }

  init() {
    console.log('Iniciando Canvas Colaborativo P2P...');

    // 1. Barra de estado y notificaciones
    this.statusBar = new StatusBar();

    // 2. Motor de Canvas Infinito (Konva)
    this.canvasManager = new CanvasManager('canvasContainer');

    // 3. Gestor de objetos del Canvas (imágenes y transformaciones)
    this.objectManager = new ObjectManager(this.canvasManager);

    // 4. Conexión P2P WebRTC
    this.p2p = new P2PConnection();

    // 5. Motor de sincronización y resolución de conflictos
    this.syncEngine = new SyncEngine(this.p2p, this.canvasManager, this.objectManager);

    // Conectar eventos del motor de sincronización a la barra de estado
    this.syncEngine.onStatusNotification = (text, type) => {
      this.statusBar.showToast(text, type);
    };

    this.syncEngine.onPeerCameraActive = (isPeerActive) => {
      this.statusBar.updateCameraState(this.syncEngine.isCameraSyncEnabled, isPeerActive);
    };

    this.syncEngine.onTransferProgress = (assetId, percent, direction) => {
      this.statusBar.updateTransferProgress(percent, direction);
    };

    // Actualizar periódicamente la latencia en pantalla
    setInterval(() => {
      if (this.p2p.isConnected()) {
        this.statusBar.updateLatency(this.p2p.latency);
      } else {
        this.statusBar.updateLatency(0);
      }
    }, 1500);

    // 6. Gestor de modales y emparejamiento con QR
    this.modalManager = new ModalManager(this.p2p, this.syncEngine, this.statusBar);

    // 7. Barra de herramientas interactiva móvil
    this.toolbar = new Toolbar(
      this.canvasManager,
      this.objectManager,
      this.syncEngine,
      this.modalManager,
      this.statusBar
    );

    // Inicializar cámara compartida visual en estado activo
    this.statusBar.updateCameraState(true, false);

    // Centrar la vista inicial en el canvas
    this.canvasManager.resetView();

    console.log('Canvas Colaborativo P2P inicializado con éxito. PeerID:', this.p2p.peerId);
  }
}

// Inicializar cuando el DOM esté listo
window.addEventListener('DOMContentLoaded', () => {
  window.app = new App();
  window.app.init();
});
