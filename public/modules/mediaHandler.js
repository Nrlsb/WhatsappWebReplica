import { dataURItoBlob, preventDefaults } from './utils.js';

export function setupMediaHandlers(sendMessageCallback) {
    const fileInput = document.getElementById('file-input');
    const micBtn = document.getElementById('mic-btn');
    const stopBtn = document.getElementById('stop-btn');
    const mainChat = document.getElementById('main-chat');
    let mediaRecorder;
    let audioChunks = [];

    // File Attachment
    if (fileInput) {
        fileInput.addEventListener('change', (e) => {
            console.log('File input changed');
            const file = e.target.files[0];
            if (file) {
                console.log('File selected:', file.name);
                const reader = new FileReader();
                reader.onload = function (evt) {
                    const base64Data = evt.target.result.split(',')[1];
                    const media = {
                        data: base64Data,
                        mimetype: file.type,
                        filename: file.name
                    };
                    console.log('Sending media message...');
                    sendMessageCallback(null, media);
                };
                reader.readAsDataURL(file);
            }
        });
    }

    // Audio Recording
    if (micBtn) {
        micBtn.addEventListener('click', async () => {
            console.log('Mic button clicked');
            if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
                try {
                    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
                    console.log('Microphone access granted');
                    mediaRecorder = new MediaRecorder(stream);
                    audioChunks = [];

                    mediaRecorder.ondataavailable = (e) => {
                        audioChunks.push(e.data);
                    };

                    mediaRecorder.onstop = () => {
                        console.log('Recording stopped');
                        const audioBlob = new Blob(audioChunks, { type: 'audio/ogg; codecs=opus' });
                        const reader = new FileReader();
                        reader.readAsDataURL(audioBlob);
                        reader.onloadend = () => {
                            const base64Data = reader.result.split(',')[1];
                            const media = {
                                data: base64Data,
                                mimetype: 'audio/ogg; codecs=opus',
                                filename: 'voice_note.ogg'
                            };
                            sendMessageCallback(null, media);
                        };
                    };

                    mediaRecorder.start();
                    micBtn.style.display = 'none';
                    stopBtn.style.display = 'block';
                } catch (err) {
                    console.error('Error accessing microphone:', err);
                    alert('Could not access microphone: ' + err.message);
                }
            } else {
                console.error('navigator.mediaDevices not supported');
                alert('Audio recording not supported in this browser context (requires HTTPS or localhost)');
            }
        });
    }

    if (stopBtn) {
        stopBtn.addEventListener('click', () => {
            if (mediaRecorder && mediaRecorder.state !== 'inactive') {
                mediaRecorder.stop();
                micBtn.style.display = 'block';
                stopBtn.style.display = 'none';
            }
        });
    }

    // Drag and Drop
    if (mainChat) {
        ['dragenter', 'dragover'].forEach(eventName => {
            mainChat.addEventListener(eventName, highlight, false);
        });

        ['dragleave', 'drop'].forEach(eventName => {
            mainChat.addEventListener(eventName, unhighlight, false);
        });

        mainChat.addEventListener('drop', (e) => handleDrop(e, sendMessageCallback), false);
    }
}

function highlight(e) {
    preventDefaults(e);
    document.getElementById('main-chat').classList.add('drag-over');
}

function unhighlight(e) {
    preventDefaults(e);
    document.getElementById('main-chat').classList.remove('drag-over');
}

function handleDrop(e, sendMessageCallback) {
    preventDefaults(e);
    unhighlight(e);
    const dt = e.dataTransfer;
    const files = dt.files;
    handleFiles(files, sendMessageCallback);
}

function handleFiles(files, sendMessageCallback) {
    const file = files[0];
    if (file) {
        console.log('File dropped:', file.name);
        const reader = new FileReader();
        reader.onload = function (evt) {
            const base64Data = evt.target.result.split(',')[1];
            const media = {
                data: base64Data,
                mimetype: file.type,
                filename: file.name
            };
            sendMessageCallback(null, media);
        };
        reader.readAsDataURL(file);
    }
}

// Lightbox functions exposed to window
window.openLightbox = function (url, type) {
    const lightbox = document.getElementById('media-lightbox');
    const img = document.getElementById('lightbox-img');
    const video = document.getElementById('lightbox-video');

    if (lightbox) {
        lightbox.style.display = 'flex';
        if (type === 'image') {
            img.src = url;
            img.style.display = 'block';
            video.style.display = 'none';
        } else if (type === 'video') {
            video.src = url;
            video.style.display = 'block';
            img.style.display = 'none';
        }
    }
};

window.closeLightbox = function () {
    const lightbox = document.getElementById('media-lightbox');
    const video = document.getElementById('lightbox-video');
    if (lightbox) {
        lightbox.style.display = 'none';
        if (video) {
            video.pause();
            video.src = '';
        }
    }
};
