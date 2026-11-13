export interface FullscreenElements {
  overlayEl: HTMLElement;
  appEl: HTMLElement;
  canvasContainerEl: HTMLElement;
  stepperControlsEl: HTMLElement;
  tablePanelEl: HTMLElement;
  fullscreenBtn: HTMLElement;
  exitBtn: HTMLElement;
  tableToggleBtn: HTMLElement;
  tableCloseBtn?: HTMLElement | null;
  tableDrawerEl: HTMLElement;
  canvasSlot: HTMLElement;
  stepperSlot: HTMLElement;
  tableSlot: HTMLElement;
  regexDisplayEl?: HTMLElement | null;
}

export interface FullscreenCallbacks {
  getRegexText: () => string;
  isModeFit: () => boolean;
  recomputeFit: () => void;
}

export class FullscreenManager {
  private active = false;
  private tableDrawerOpen = false;
  private stepperPlaceholder: Node | null = null;
  private canvasPlaceholder: Node | null = null;
  private tablePlaceholder: Node | null = null;

  constructor(
    private readonly elements: FullscreenElements,
    private readonly callbacks: FullscreenCallbacks
  ) {
    this.elements.fullscreenBtn.addEventListener('click', () => this.enter());
    this.elements.exitBtn.addEventListener('click', () => this.exit());
    this.elements.tableToggleBtn.addEventListener('click', () => this.toggleTableDrawer());
    if (this.elements.tableCloseBtn) {
      this.elements.tableCloseBtn.addEventListener('click', () => this.closeTableDrawer());
    }
  }

  isActive(): boolean {
    return this.active;
  }

  isTableDrawerOpen(): boolean {
    return this.tableDrawerOpen;
  }

  enter(): void {
    if (this.active) return;
    this.active = true;

    // Save placeholders in original locations
    const doc = this.elements.overlayEl.ownerDocument || document;
    this.stepperPlaceholder = doc.createComment('stepper-ph');
    this.canvasPlaceholder = doc.createComment('canvas-ph');
    this.tablePlaceholder = doc.createComment('table-ph');

    const stepperParent = this.elements.stepperControlsEl.parentNode;
    const canvasParent = this.elements.canvasContainerEl.parentNode;
    const tableParent = this.elements.tablePanelEl.parentNode;

    if (stepperParent) stepperParent.insertBefore(this.stepperPlaceholder, this.elements.stepperControlsEl);
    if (canvasParent) canvasParent.insertBefore(this.canvasPlaceholder, this.elements.canvasContainerEl);
    if (tableParent) tableParent.insertBefore(this.tablePlaceholder, this.elements.tablePanelEl);

    // Reparent into slots
    this.elements.canvasSlot.appendChild(this.elements.canvasContainerEl);
    this.elements.stepperSlot.appendChild(this.elements.stepperControlsEl);
    this.elements.tableSlot.appendChild(this.elements.tablePanelEl);

    // Update regex display
    if (this.elements.regexDisplayEl) {
      this.elements.regexDisplayEl.textContent = this.callbacks.getRegexText();
    }

    // Drawer state (remembered across sessions)
    this.syncTableDrawer();

    // Background inert and scroll lock
    this.elements.appEl.setAttribute('inert', '');
    if ((this.elements.appEl as any).inert !== undefined) {
      (this.elements.appEl as any).inert = true;
    }
    const body = doc.body;
    if (body) {
      body.classList.add('fullscreen-mode');
    }

    // Show overlay
    this.elements.overlayEl.hidden = false;

    // Re-fit if mode is 'fit'
    if (this.callbacks.isModeFit()) {
      this.callbacks.recomputeFit();
    }

    // Focus exit button
    this.elements.exitBtn.focus();
  }

  exit(): void {
    if (!this.active) return;
    this.active = false;

    // Restore elements to placeholders
    if (this.stepperPlaceholder && this.stepperPlaceholder.parentNode) {
      this.stepperPlaceholder.parentNode.insertBefore(this.elements.stepperControlsEl, this.stepperPlaceholder);
      this.stepperPlaceholder.parentNode.removeChild(this.stepperPlaceholder);
      this.stepperPlaceholder = null;
    }

    if (this.canvasPlaceholder && this.canvasPlaceholder.parentNode) {
      this.canvasPlaceholder.parentNode.insertBefore(this.elements.canvasContainerEl, this.canvasPlaceholder);
      this.canvasPlaceholder.parentNode.removeChild(this.canvasPlaceholder);
      this.canvasPlaceholder = null;
    }

    if (this.tablePlaceholder && this.tablePlaceholder.parentNode) {
      this.tablePlaceholder.parentNode.insertBefore(this.elements.tablePanelEl, this.tablePlaceholder);
      this.tablePlaceholder.parentNode.removeChild(this.tablePlaceholder);
      this.tablePlaceholder = null;
    }

    // Hide overlay
    this.elements.overlayEl.hidden = true;

    // Remove inert and scroll lock
    this.elements.appEl.removeAttribute('inert');
    if ((this.elements.appEl as any).inert !== undefined) {
      (this.elements.appEl as any).inert = false;
    }
    const doc = this.elements.overlayEl.ownerDocument || document;
    if (doc.body) {
      doc.body.classList.remove('fullscreen-mode');
    }

    // Re-fit if mode is 'fit'
    if (this.callbacks.isModeFit()) {
      this.callbacks.recomputeFit();
    }

    // Restore focus to fullscreen button
    this.elements.fullscreenBtn.focus();
  }

  toggleTableDrawer(): boolean {
    this.tableDrawerOpen = !this.tableDrawerOpen;
    this.syncTableDrawer();
    return this.tableDrawerOpen;
  }

  openTableDrawer(): void {
    this.tableDrawerOpen = true;
    this.syncTableDrawer();
  }

  closeTableDrawer(): void {
    this.tableDrawerOpen = false;
    this.syncTableDrawer();
  }

  private syncTableDrawer(): void {
    if (this.tableDrawerOpen) {
      this.elements.tableDrawerEl.classList.remove('hidden');
      this.elements.tableToggleBtn.setAttribute('aria-expanded', 'true');
    } else {
      this.elements.tableDrawerEl.classList.add('hidden');
      this.elements.tableToggleBtn.setAttribute('aria-expanded', 'false');
    }
  }

  handleEscape(): boolean {
    if (!this.active) return false;
    this.exit();
    return true;
  }
}
