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

    const closeButton = this.querySelector('.upsell-content__close');
    if (closeButton) {
      closeButton.addEventListener('click', this.#handleClose);
    }

    this.querySelectorAll('.upsell-variant-selector').forEach((select) => {
      select.addEventListener('change', this.#handleVariantChange);
    });

    this.#updateSubtotal();
  }

  #handleClose = () => {
    const dialog = document.getElementById('upsell-modal-dialog');
    if (dialog instanceof UpsellModalDialog) {
      dialog.closeDialog();
    }
  };

  /** @param {Event} event */
  #handleCardClick = (event) => {
    const target = /** @type {HTMLElement} */ (event.target);

    if (target instanceof HTMLInputElement && target.type === 'checkbox') return;
    if (target instanceof HTMLSelectElement) return;

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

  /** @param {Event} event */
  #handleVariantChange = (event) => {
    const select = /** @type {HTMLSelectElement} */ (event.target);
    const card = /** @type {HTMLElement} */ (select.closest('.upsell-product-card'));
    if (!card) return;

    const variantScript = card.querySelector('script[type="application/json"]');
    if (!variantScript?.textContent) return;

    const variants = JSON.parse(variantScript.textContent);
    const selectors = card.querySelectorAll('.upsell-variant-selector');

    /** @type {string[]} */
    const selectedOptions = [];
    selectors.forEach((sel) => {
      if (sel instanceof HTMLSelectElement) {
        selectedOptions.push(sel.value);
      }
    });

    const matchedVariant = variants.find((/** @type {any} */ v) => {
      return (
        v.option1 === selectedOptions[0] &&
        (v.option2 === selectedOptions[1] || v.option2 === null) &&
        (v.option3 === selectedOptions[2] || v.option3 === null)
      );
    });

    if (!matchedVariant) return;

    card.dataset.variantId = matchedVariant.id;
    card.dataset.price = matchedVariant.price;

    const priceElement = card.querySelector('.upsell-product-card__price');
    if (priceElement) {
      priceElement.textContent = this.#formatMoney(matchedVariant.price);
    }

    const skuElement = card.querySelector('.upsell-product-card__sku');
    if (matchedVariant.sku) {
      if (skuElement) {
        skuElement.textContent = `SKU: ${matchedVariant.sku}`;
      }
    } else if (skuElement) {
      skuElement.textContent = '';
    }

    const imgElement = /** @type {HTMLImageElement} */ (card.querySelector('.upsell-product-card__img'));
    if (imgElement && matchedVariant.featured_image) {
      imgElement.src = matchedVariant.featured_image.src;
      card.dataset.productImage = matchedVariant.featured_image.src;
    }

    const isMainProduct = card.classList.contains('upsell-product-card--main');

    if (!isMainProduct) {
      const checkbox = card.querySelector('input[type="checkbox"]');
      const badge = /** @type {HTMLElement} */ (card.querySelector('.upsell-product-card__badge--soldout'));

      if (matchedVariant.available) {
        card.classList.remove('upsell-product-card--unavailable');
        if (checkbox instanceof HTMLInputElement) {
          checkbox.disabled = false;
          checkbox.checked = true;
          card.dataset.selected = 'true';
        }
        if (badge) badge.style.display = 'none';
      } else {
        card.classList.add('upsell-product-card--unavailable');
        if (checkbox instanceof HTMLInputElement) {
          checkbox.disabled = true;
          checkbox.checked = false;
          card.dataset.selected = 'false';
        }
        if (badge) badge.style.display = '';
      }
    }

    this.#updateSubtotal();
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
    const moneyFormatTemplate = this.querySelector('template[ref="moneyFormat"]');
    if (!(moneyFormatTemplate instanceof HTMLTemplateElement)) {
      return (cents / 100).toFixed(2);
    }

    const template = moneyFormatTemplate.content.textContent || '{{amount}}';

    return template.replace(/{{\s*(\w+)\s*}}/g, (_, placeholder) => {
      if (typeof placeholder !== 'string') return '';

      let thousandsSeparator = ',';
      let decimalSeparator = '.';
      let precision = 2;

      if (placeholder === 'amount_no_decimals') {
        precision = 0;
      } else if (placeholder === 'amount_with_comma_separator') {
        thousandsSeparator = '.';
        decimalSeparator = ',';
      } else if (placeholder === 'amount_no_decimals_with_comma_separator') {
        thousandsSeparator = '.';
        precision = 0;
      } else if (placeholder === 'amount_no_decimals_with_space_separator') {
        thousandsSeparator = ' ';
        precision = 0;
      } else if (placeholder === 'amount_with_space_separator') {
        thousandsSeparator = ' ';
        decimalSeparator = ',';
      } else if (placeholder === 'amount_with_period_and_space_separator') {
        thousandsSeparator = ' ';
        decimalSeparator = '.';
      } else if (placeholder === 'amount_with_apostrophe_separator') {
        thousandsSeparator = "'";
        decimalSeparator = '.';
      }

      const roundedNumber = (cents / 100).toFixed(precision);
      let [a, b] = roundedNumber.split('.');
      if (!a) a = '0';
      if (!b) b = '';

      a = a.replace(/\d(?=(\d\d\d)+(?!\d))/g, (digit) => digit + thousandsSeparator);

      return precision <= 0 ? a : a + decimalSeparator + b.padEnd(precision, '0');
    });
  };
}

if (!customElements.get('upsell-modal-content-component')) {
  customElements.define('upsell-modal-content-component', UpsellModalContentComponent);
}
