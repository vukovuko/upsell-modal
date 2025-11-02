import { Component } from '@theme/component';
import { DialogComponent, DialogCloseEvent } from '@theme/dialog';
import { ThemeEvents } from '@theme/events';
import { getIOSVersion } from '@theme/utilities';

export class UpsellModalComponent extends Component {
  /** @param {MouseEvent} event */
  handleClick = async (event) => {
    event.preventDefault();

    const productHandle = this.dataset.productHandle;
    if (!productHandle) {
      console.error('No product handle found');
      return;
    }

    await this.#fetchAndOpenModal(productHandle);
  };

  /** @param {UpsellModalDialog} dialogComponent */
  #stayVisibleUntilDialogCloses(dialogComponent) {
    this.toggleAttribute('stay-visible', true);

    dialogComponent.addEventListener(DialogCloseEvent.eventName, () => this.toggleAttribute('stay-visible', false), {
      once: true,
    });
  }

  /** @param {string} productHandle */
  #fetchAndOpenModal = async (productHandle) => {
    const dialogComponent = document.getElementById('upsell-modal-dialog');
    if (!(dialogComponent instanceof UpsellModalDialog)) return;

    const contentDiv = document.getElementById('upsell-modal-content');
    if (!contentDiv) return;

    try {
      const url = `/products/${productHandle}?section_id=upsell-modal-products`;
      const response = await fetch(url);
      const html = await response.text();

      contentDiv.innerHTML = html;
    } catch (error) {
      console.error('Error fetching upsell products:', error);
      const errorMessage = this.dataset.errorMessage || 'Unable to load products. Please try again.';
      contentDiv.innerHTML = `<p style="padding: 2rem; text-align: center;">${errorMessage}</p>`;
    }

    this.#stayVisibleUntilDialogCloses(dialogComponent);
    dialogComponent.showDialog();
  };
}

if (!customElements.get('upsell-modal-component')) {
  customElements.define('upsell-modal-component', UpsellModalComponent);
}

class UpsellModalDialog extends DialogComponent {
  #abortController = new AbortController();

  connectedCallback() {
    super.connectedCallback();

    this.addEventListener(ThemeEvents.cartUpdate, this.handleCartUpdate, { signal: this.#abortController.signal });
    this.addEventListener(DialogCloseEvent.eventName, this.#handleDialogClose);
  }

  disconnectedCallback() {
    super.disconnectedCallback();

    this.#abortController.abort();
    this.removeEventListener(DialogCloseEvent.eventName, this.#handleDialogClose);
  }

  /** @param {import('@theme/events').CartUpdateEvent} event */
  handleCartUpdate = (event) => {
    if (event.detail.data.didError) return;
    this.closeDialog();
  };

  /** iOS 16.0 fix: forces reflow to prevent UI freeze on dialog close */
  #handleDialogClose = () => {
    const iosVersion = getIOSVersion();
    if (!iosVersion || iosVersion.major >= 17 || (iosVersion.major === 16 && iosVersion.minor >= 4)) return;

    requestAnimationFrame(() => {
      const body = document.body;
      if (body) {
        const currentWidth = body.getBoundingClientRect().width;
        body.style.width = `${currentWidth - 1}px`;
        requestAnimationFrame(() => {
          body.style.width = '';
        });
      }
    });
  };
}

if (!customElements.get('upsell-modal-dialog')) {
  customElements.define('upsell-modal-dialog', UpsellModalDialog);
}

class UpsellModalContentComponent extends Component {
  connectedCallback() {
    super.connectedCallback();

    this.querySelectorAll('.upsell-product-card input[type="checkbox"]').forEach((checkbox) => {
      if (checkbox instanceof HTMLInputElement && !checkbox.disabled) {
        checkbox.addEventListener('change', this.#handleCheckboxChange);
      }
    });

    this.querySelectorAll('.upsell-product-card').forEach((card) => {
      const checkbox = card.querySelector('input[type="checkbox"]');
      if (checkbox instanceof HTMLInputElement && !checkbox.disabled) {
        card.addEventListener('click', this.#handleCardClick);
      }
    });

    const confirmButton = this.querySelector('.upsell-footer__confirm');
    if (confirmButton) {
      confirmButton.addEventListener('click', this.#handleConfirm);
    }

    this.#updateSubtotal();
  }

  /** @param {Event} event */
  #handleCardClick = (event) => {
    const card = /** @type {HTMLElement} */ (event.currentTarget);
    const checkbox = card.querySelector('input[type="checkbox"]');

    if (checkbox instanceof HTMLInputElement && !checkbox.disabled) {
      checkbox.checked = !checkbox.checked;
      card.dataset.selected = checkbox.checked ? 'true' : 'false';
      this.#updateSubtotal();
    }
  };

  /** @param {Event} event */
  #handleCheckboxChange = (event) => {
    const checkbox = /** @type {HTMLInputElement} */ (event.target);
    const card = checkbox.closest('.upsell-product-card');

    if (card instanceof HTMLElement) {
      card.dataset.selected = checkbox.checked ? 'true' : 'false';
      this.#updateSubtotal();
    }
  };

  #handleConfirm = async () => {
    const confirmButton = this.querySelector('.upsell-footer__confirm');
    const selectedCards = this.querySelectorAll('.upsell-product-card[data-selected="true"]');
    /** @type {Array<{id: string, quantity: number}>} */
    const items = [];

    selectedCards.forEach((card) => {
      if (card instanceof HTMLElement) {
        const variantId = card.dataset.variantId;
        if (variantId) {
          items.push({ id: variantId, quantity: 1 });
        }
      }
    });

    if (items.length === 0) return;

    try {
      const response = await fetch('/cart/add.js', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items }),
      });

      if (!response.ok) throw new Error('Failed to add to cart');

      // Add animation class
      if (confirmButton && !confirmButton.classList.contains('atc-added')) {
        confirmButton.classList.add('atc-added');
      }

      // Wait 2000ms for animation, then close modal
      setTimeout(() => {
        this.dispatchEvent(
          new CustomEvent(ThemeEvents.cartUpdate, {
            bubbles: true,
            detail: { data: { didError: false } },
          })
        );
      }, 2000);
    } catch (error) {
      console.error('Error adding to cart:', error);
    }
  };

  #updateSubtotal = () => {
    const selectedCards = this.querySelectorAll('.upsell-product-card[data-selected="true"]');
    let total = 0;

    selectedCards.forEach((card) => {
      if (card instanceof HTMLElement) {
        const price = parseInt(card.dataset.price || '0', 10);
        if (!isNaN(price)) {
          total += price;
        }
      }
    });

    const subtotalElement = this.querySelector('.upsell-footer__subtotal-amount');
    if (subtotalElement) {
      subtotalElement.textContent = this.#formatMoney(total);
    }
  };

  /** @param {number} cents */
  #formatMoney = (cents) => {
    return (cents / 100).toLocaleString('en-US', {
      style: 'currency',
      currency: 'USD',
    });
  };
}

if (!customElements.get('upsell-modal-content-component')) {
  customElements.define('upsell-modal-content-component', UpsellModalContentComponent);
}
