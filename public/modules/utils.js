export function formatTime(timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

export function getSenderColor(participantId) {
    if (!participantId) return '#000000';
    const colors = [
        '#e53935', '#d81b60', '#8e24aa', '#5e35b1', '#3949ab',
        '#1e88e5', '#039be5', '#00acc1', '#00897b', '#43a047',
        '#7cb342', '#c0ca33', '#fdd835', '#ffb300', '#fb8c00',
        '#f4511e', '#6d4c41', '#757575', '#546e7a'
    ];
    let hash = 0;
    for (let i = 0; i < participantId.length; i++) {
        hash = participantId.charCodeAt(i) + ((hash << 5) - hash);
    }
    const index = Math.abs(hash) % colors.length;
    return colors[index];
}

export function getTickIcon(ack) {
    /*
        ack values:
        1: Sent (one grey tick)
        2: Delivered (two grey ticks)
        3: Read (two blue ticks)
    */
    if (!ack || ack === 0) return '<i class="fas fa-check" style="color: #8696a0; margin-left: 3px;"></i>'; // Pending/Sent
    if (ack === 1) return '<i class="fas fa-check" style="color: #8696a0; margin-left: 3px;"></i>';
    if (ack === 2) return '<i class="fas fa-check-double" style="color: #8696a0; margin-left: 3px;"></i>';
    if (ack === 3 || ack === 4) return '<i class="fas fa-check-double" style="color: #53bdeb; margin-left: 3px;"></i>';
    return '';
}

export function dataURItoBlob(dataURI, mimetype) {
    const byteString = atob(dataURI);
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
    }
    return new Blob([ab], { type: mimetype });
}

export function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
}
