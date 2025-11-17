// Audio processing utilities
function float32ToPCM16(float32Array) {
    const pcm16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
        const sample = Math.max(-1, Math.min(1, float32Array[i]));
        pcm16Array[i] = sample < 0 ? sample * 0x8000 : sample * 0x7FFF;
    }
    return pcm16Array;
}

function pcm16ToBase64(pcm16Array) {
    const uint8Array = new Uint8Array(pcm16Array.length * 2);
    for (let i = 0; i < pcm16Array.length; i++) {
        const sample = pcm16Array[i];
        uint8Array[i * 2] = sample & 0xFF;
        uint8Array[i * 2 + 1] = (sample >> 8) & 0xFF;
    }
    let binary = '';
    for (let i = 0; i < uint8Array.length; i++) {
        binary += String.fromCharCode(uint8Array[i]);
    }
    return btoa(binary);
}

// Text processing utilities
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function simpleMarkdownParse(markdown) {
    return markdown
        .replace(/^# (.*$)/gm, '<h1 class="mb-4">$1</h1>')
        .replace(/^## (.*$)/gm, '<h2 class="mb-3">$1</h2>')
        .replace(/^### (.*$)/gm, '<h3 class="mb-2">$1</h3>')
        .replace(/^\* (.*$)/gm, '<li class="mb-2">$1</li>')
        .replace(/(<li>.*<\/li>)/gs, '<ul class="list-unstyled ps-3">$1</ul>')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.*?)\*/g, '<em>$1</em>')
        .replace(/\n\n/g, '</p><p class="mb-3">')
        .replace(/^(.*)$/gm, '<p class="mb-3">$1</p>')
        .replace(/<p class="mb-3"><h/g, '<h')
        .replace(/<\/h([1-6])><\/p>/g, '</h$1>')
        .replace(/<p class="mb-3"><ul>/g, '<ul>')
        .replace(/<\/ul><\/p>/g, '</ul>');
}

// UI utilities
function showError(message) {
    showNotification(message, 'error');
}

function showNotification(message, type = 'success') {
    const alertClass = type === 'error' ? 'danger' : (type === 'info' ? 'info' : 'success');
    const iconClass = type === 'error' ? 'exclamation-circle' : (type === 'info' ? 'info-circle' : 'check-circle');
    
    const notification = document.createElement('div');
    notification.className = `alert alert-${alertClass} position-fixed top-0 end-0 m-3`;
    notification.style.zIndex = '9999';
    notification.style.minWidth = '300px';
    notification.innerHTML = `
        <div class="d-flex align-items-center">
            <i class="fas fa-${iconClass} me-2"></i>
            <span>${message}</span>
            <button type="button" class="btn-close ms-auto" data-bs-dismiss="alert"></button>
        </div>
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        if (notification.parentNode) {
            notification.remove();
        }
    }, 5000);
}

function updateStatus(type, status, text, elements) {
    const element = elements[`${type}Status`];
    if (element) {
        let iconClass = 'text-muted';
        if (status === 'connected') iconClass = 'text-success';
        else if (status === 'error') iconClass = 'text-danger';
        
        const icon = element.querySelector('i');
        if (icon) {
            icon.className = icon.className.replace(/text-\w+/, iconClass);
        }
        element.innerHTML = element.innerHTML.replace(/:\s*.+/, `: ${text.split(': ')[1]}`);
    }
}

// Export utilities for ES6 modules or make them globally available
if (typeof module !== 'undefined' && module.exports) {
    // Node.js/CommonJS environment
    module.exports = {
        float32ToPCM16,
        pcm16ToBase64,
        escapeHtml,
        simpleMarkdownParse,
        showError,
        showNotification,
        updateStatus
    };
} else {
    // Browser environment - make functions globally available
    window.AudioUtils = {
        float32ToPCM16,
        pcm16ToBase64
    };
    
    window.TextUtils = {
        escapeHtml,
        simpleMarkdownParse
    };
    
    window.UIUtils = {
        showError,
        showNotification,
        updateStatus
    };
}