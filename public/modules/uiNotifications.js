
// Module for handling UI notifications (Modals and Toasts)

export function showModal(title, message, onConfirm = null, onCancel = null, confirmText = 'OK', cancelText = 'Cancel') {
    const modalOverlay = document.getElementById('custom-modal-overlay');
    const modalTitle = document.getElementById('custom-modal-title');
    const modalMessage = document.getElementById('custom-modal-message');
    const confirmBtn = document.getElementById('custom-modal-confirm');
    const cancelBtn = document.getElementById('custom-modal-cancel');

    if (!modalOverlay) {
        console.error('Modal elements not found in DOM');
        return;
    }

    modalTitle.textContent = title;
    modalMessage.textContent = message;
    confirmBtn.textContent = confirmText;

    // Reset buttons
    confirmBtn.onclick = null;
    cancelBtn.onclick = null;

    if (onConfirm) {
        confirmBtn.onclick = () => {
            onConfirm();
            closeModal();
        };
        confirmBtn.style.display = 'inline-block';
    } else {
        // If no confirm action, it's just an alert-style modal
        confirmBtn.onclick = () => closeModal();
        confirmBtn.style.display = 'inline-block';
    }

    if (onCancel) {
        cancelBtn.textContent = cancelText;
        cancelBtn.style.display = 'inline-block';
        cancelBtn.onclick = () => {
            onCancel();
            closeModal();
        };
    } else {
        cancelBtn.style.display = 'none';
    }

    modalOverlay.style.display = 'flex';
}

export function closeModal() {
    const modalOverlay = document.getElementById('custom-modal-overlay');
    if (modalOverlay) {
        modalOverlay.style.display = 'none';
    }
}

export function showToast(message, duration = 3000) {
    let toastContainer = document.getElementById('toast-container');

    if (!toastContainer) {
        toastContainer = document.createElement('div');
        toastContainer.id = 'toast-container';
        document.body.appendChild(toastContainer);
    }

    const toast = document.createElement('div');
    toast.className = 'toast-notification';
    toast.innerHTML = `
        <div class="toast-content">
            <i class="fab fa-whatsapp"></i>
            <span>${message}</span>
        </div>
    `;

    toastContainer.appendChild(toast);

    // Trigger animation
    requestAnimationFrame(() => {
        toast.classList.add('show');
    });

    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => {
            toast.remove();
        }, 300); // Wait for transition to finish
    }, duration);
}

export function updatePageTitle(unreadCount) {
    if (unreadCount > 0) {
        document.title = `(${unreadCount}) WhatsApp`;
    } else {
        document.title = 'WhatsApp';
    }
}

