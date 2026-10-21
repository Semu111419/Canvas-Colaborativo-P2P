/**
 * toolbar.js
 * Barra de herramientas táctil y controles interactivos móviles:
 * - Subir imagen desde galería/cámara.
 * - Pegar desde portapapeles.
 * - Modificar capas (adelante/atrás), duplicar y eliminar.
 * - Alternar sincronización de cámara compartida.
 * - Controles flotantes de zoom e indicador de escala.
 */

export class Toolbar {
  constructor(canvasManager, objectManager, syncEngine, modalManager, statusBar) {
    this.canvasManager = canvasManager;
    this.objectManager = objectManager;
    this.syncEngine = syncEngine;
    this.modalManager = modalManager;
    this.statusBar = statusBar;

    // Elementos DOM
    this.fileInput = document.getElementById('imageFileInput');
    this.btnAddImage = document.getElementById('btnAddImage');
    this.btnPasteImage = document.getElementById('btnPasteImage');
    this.btnDeleteObject = document.getElementById('btnDeleteObject');
    this.btnDuplicateObject = document.getElementById('btnDuplicateObject');
    this.btnLayerUp = document.getElementById('btnLayerUp');
    this.btnLayerDown = document.getElementById('btnLayerDown');
    this.btnResetView = document.getElementById('btnResetView');
    this.btnToggleCamera = document.getElementById('btnToggleCamera');
    this.btnOpenPairModal = document.getElementById('btnOpenPairModal');
    this.btnOpenHelp = document.getElementById('btnOpenHelp');

    // Controles flotantes de zoom
    this.btnZoomIn = document.getElementById('btnZoomIn');
    this.btnZoomOut = document.getElementById('btnZoomOut');
    this.zoomLevelBadge = document.getElementById('zoomLevelBadge');

    this.isCameraSynced = true;

    this.initEvents();
  }

  initEvents() {
    // 1. Añadir imagen desde galería o captura fotográfica
    if (this.btnAddImage && this.fileInput) {
      this.btnAddImage.addEventListener('click', () => {
        this.fileInput.click();
      });

      this.fileInput.addEventListener('change', async (e) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;

        this.statusBar.showToast('Procesando imagen...', 'info');

        for (const file of files) {
          if (!file.type.startsWith('image/')) continue;
          try {
            await this.objectManager.addImageBlob(file);
            this.statusBar.showToast('Imagen añadida al lienzo', 'success');
          } catch (err) {
            this.statusBar.showToast('Error cargando imagen: ' + err.message, 'error');
          }
        }

        // Limpiar input para permitir seleccionar el mismo archivo de nuevo
        this.fileInput.value = '';
      });
    }

    // 2. Pegar desde el portapapeles
    if (this.btnPasteImage) {
      this.btnPasteImage.addEventListener('click', () => {
        this.handlePasteFromClipboard();
      });
    }

    // Listener global de evento paste (ej. Ctrl+V o pegado en móvil)
    window.addEventListener('paste', async (e) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const blob = items[i].getAsFile();
          if (blob) {
            e.preventDefault();
            this.statusBar.showToast('Imagen pegada desde portapapeles', 'info');
            await this.objectManager.addImageBlob(blob);
          }
        }
      }
    });

    // 3. Eliminar objeto seleccionado
    if (this.btnDeleteObject) {
      this.btnDeleteObject.addEventListener('click', () => {
        this.objectManager.deleteSelected();
        this.updateSelectionState(null);
      });
    }

    // Tecla Supr o Backspace en teclado desktop
    window.addEventListener('keydown', (e) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && !this.isEditingInput(e)) {
        if (this.objectManager.selectedId) {
          e.preventDefault();
          this.objectManager.deleteSelected();
          this.updateSelectionState(null);
        }
      }
    });

    // 4. Duplicar objeto
    if (this.btnDuplicateObject) {
      this.btnDuplicateObject.addEventListener('click', async () => {
        await this.objectManager.duplicateSelected();
      });
    }

    // 5. Orden de capas
    if (this.btnLayerUp) {
      this.btnLayerUp.addEventListener('click', () => {
        this.objectManager.changeZIndex('up');
      });
    }

    if (this.btnLayerDown) {
      this.btnLayerDown.addEventListener('click', () => {
        this.objectManager.changeZIndex('down');
      });
    }

    // 6. Restablecer vista de cámara al origen
    if (this.btnResetView) {
      this.btnResetView.addEventListener('click', () => {
        this.canvasManager.resetView();
        this.updateZoomDisplay();
        this.statusBar.showToast('Vista centrada (100%)', 'info');
      });
    }

    // 7. Alternar sincronización de cámara
    if (this.btnToggleCamera) {
      this.btnToggleCamera.addEventListener('click', () => {
        this.isCameraSynced = !this.isCameraSynced;
        this.syncEngine.setCameraSyncEnabled(this.isCameraSynced);
        this.statusBar.updateCameraState(this.isCameraSynced, false);

        if (this.isCameraSynced) {
          this.btnToggleCamera.classList.add('active');
          this.statusBar.showToast('Cámara compartida activada', 'info');
        } else {
          this.btnToggleCamera.classList.remove('active');
          this.statusBar.showToast('Cámara independiente activada', 'info');
        }
      });
    }

    // 8. Botones modales
    if (this.btnOpenPairModal) {
      this.btnOpenPairModal.addEventListener('click', () => {
        this.modalManager.openPairingModal();
      });
    }

    if (this.btnOpenHelp) {
      this.btnOpenHelp.addEventListener('click', () => {
        this.modalManager.openHelpModal();
      });
    }

    // 9. Controles flotantes de Zoom
    if (this.btnZoomIn) {
      this.btnZoomIn.addEventListener('click', () => {
        this.canvasManager.zoomByFactor(1.25);
        this.updateZoomDisplay();
      });
    }

    if (this.btnZoomOut) {
      this.btnZoomOut.addEventListener('click', () => {
        this.canvasManager.zoomByFactor(0.8);
        this.updateZoomDisplay();
      });
    }

    // Actualizar indicador de zoom cuando cambia la escala del canvas
    this.canvasManager.stage.on('wheel touchmove dragmove', () => {
      this.updateZoomDisplay();
    });

    // Callback de cambio de selección de objeto para habilitar/deshabilitar botones
    this.objectManager.onSelectionChanged = (selectedItem) => {
      this.updateSelectionState(selectedItem);
    };

    this.updateZoomDisplay();
  }

  isEditingInput(e) {
    const tag = e.target.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea';
  }

  /**
   * Intenta leer una imagen desde el portapapeles del sistema.
   */
  async handlePasteFromClipboard() {
    try {
      if (navigator.clipboard && navigator.clipboard.read) {
        const clipboardItems = await navigator.clipboard.read();
        let foundImage = false;

        for (const item of clipboardItems) {
          for (const type of item.types) {
            if (type.startsWith('image/')) {
              const blob = await item.getType(type);
              await this.objectManager.addImageBlob(blob);
              this.statusBar.showToast('Imagen pegada desde el portapapeles', 'success');
              foundImage = true;
              break;
            }
          }
        }

        if (!foundImage) {
          this.statusBar.showToast('No se encontró ninguna imagen en el portapapeles.', 'warning');
        }
      } else {
        this.statusBar.showToast('Pegue con Ctrl+V (en móvil use el botón de Galería).', 'info');
      }
    } catch (err) {
      console.warn('Fallo acceso directo al portapapeles:', err);
      this.statusBar.showToast('Permiso de portapapeles no concedido o use Ctrl+V.', 'warning');
    }
  }

  /**
   * Actualiza el estado visual de los botones que dependen de un objeto seleccionado.
   */
  updateSelectionState(selectedItem) {
    const isSelected = Boolean(selectedItem);

    if (this.btnDeleteObject) {
      this.btnDeleteObject.disabled = !isSelected;
      this.btnDeleteObject.classList.toggle('disabled', !isSelected);
    }
    if (this.btnDuplicateObject) {
      this.btnDuplicateObject.disabled = !isSelected;
      this.btnDuplicateObject.classList.toggle('disabled', !isSelected);
    }
    if (this.btnLayerUp) {
      this.btnLayerUp.disabled = !isSelected;
      this.btnLayerUp.classList.toggle('disabled', !isSelected);
    }
    if (this.btnLayerDown) {
      this.btnLayerDown.disabled = !isSelected;
      this.btnLayerDown.classList.toggle('disabled', !isSelected);
    }
  }

  /**
   * Actualiza el indicador visual de porcentaje de zoom (ej. "100%").
   */
  updateZoomDisplay() {
    if (this.zoomLevelBadge) {
      const zoom = this.canvasManager.getZoomPercent();
      this.zoomLevelBadge.textContent = `${zoom}%`;
    }
  }
}
