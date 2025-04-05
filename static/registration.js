document.addEventListener('DOMContentLoaded', () => {
    const video = document.getElementById('video');
    const canvas = document.getElementById('canvas');
    const captureButton = document.getElementById('capture');
    const registerButton = document.getElementById('register');
    const switchCameraButton = document.getElementById('switch-camera');
    const preview = document.getElementById('preview');
    const previewContainer = document.getElementById('preview-container');
    const nameInput = document.getElementById('name');
    const statusMessage = document.getElementById('status-message');
    let processingOverlay = document.querySelector('.processing-overlay');
    let faceBox = document.querySelector('.face-box');
    let cameraContainer = document.getElementById('camera-container');

    // Track current camera
    let currentFacingMode = 'user';
    let currentStream = null;

    // Check for camera support
    async function checkCameraSupport() {
        const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
        
        if (!navigator.mediaDevices) {
            if (isMobile) {
                throw new Error('Please ensure camera permissions are granted in your mobile browser settings.');
            } else {
                throw new Error('Your browser does not support camera access. Please use a modern browser like Chrome, Firefox, or Edge.');
            }
        }

        try {
            if (isMobile) {
                await navigator.mediaDevices.getUserMedia({ video: true });
            }
            
            const devices = await navigator.mediaDevices.enumerateDevices();
            const videoDevices = devices.filter(device => device.kind === 'videoinput');
            if (videoDevices.length === 0) {
                throw new Error('No camera detected. Please ensure your camera is enabled and permissions are granted.');
            }
            return videoDevices;
        } catch (err) {
            if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                throw new Error('Camera access denied. Please grant camera permission and refresh the page.');
            }
            throw err;
        }
    }

    // Access the webcam with improved setup
    async function startVideo(facingMode = 'user') {
        try {
            await checkCameraSupport();
            
            if (currentStream) {
                currentStream.getTracks().forEach(track => track.stop());
            }

            const constraints = {
                video: {
                    facingMode: facingMode,
                    width: { ideal: 640, max: 1920 },
                    height: { ideal: 480, max: 1080 },
                    frameRate: { ideal: 30 }
                },
                audio: false
            };

            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            video.srcObject = stream;
            currentStream = stream;
            currentFacingMode = facingMode;

            await new Promise((resolve) => {
                video.onloadedmetadata = () => {
                    resolve();
                };
            });

            await video.play();
            console.log("Camera access granted and stream set.");
            captureButton.disabled = false;
            showStatus("Camera ready", "success");
        } catch (err) {
            console.error('Error accessing webcam:', err);
            let errorMessage = err.message;
            if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
                errorMessage = 'Camera access denied. Please grant camera permission and refresh the page.';
            } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
                errorMessage = 'Cannot access camera. Please ensure no other app is using the camera.';
            }
            showStatus(errorMessage, 'error');
            captureButton.disabled = true;
        }
    }

    // Handle camera switch
    switchCameraButton.addEventListener('click', async () => {
        const newFacingMode = currentFacingMode === 'user' ? 'environment' : 'user';
        try {
            switchCameraButton.disabled = true;
            await startVideo(newFacingMode);
            showStatus(`Switched to ${newFacingMode === 'user' ? 'front' : 'back'} camera`, "success");
        } catch (err) {
            showStatus(`Failed to switch camera: ${err.message}`, "error");
            await startVideo(currentFacingMode);
        } finally {
            switchCameraButton.disabled = false;
        }
    });

    // Enhanced status message handling
    function showStatus(message, type = 'info') {
        statusMessage.textContent = message;
        if (type === 'success') {
            statusMessage.style.color = 'green';
            statusMessage.className = 'status-message success';
        } else if (type === 'error') {
            statusMessage.style.color = 'red';
            statusMessage.className = 'status-message error';
        } else {
            statusMessage.style.color = 'black';
            statusMessage.className = 'status-message info';
        }
    }

    function showProcessing() {
        processingOverlay.style.display = 'flex';
    }

    function hideProcessing() {
        processingOverlay.style.display = 'none';
    }

    function startScanningAnimation() {
        cameraContainer.classList.add('scanning');
    }

    function stopScanningAnimation() {
        cameraContainer.classList.remove('scanning');
    }

    function showFaceBox(x, y, width, height) {
        faceBox.style.display = 'block';
        faceBox.style.left = x + 'px';
        faceBox.style.top = y + 'px';
        faceBox.style.width = width + 'px';
        faceBox.style.height = height + 'px';
    }

    function hideFaceBox() {
        faceBox.style.display = 'none';
    }

    function flashSuccess() {
        cameraContainer.classList.add('success-flash');
        setTimeout(() => cameraContainer.classList.remove('success-flash'), 500);
    }

    function flashError() {
        cameraContainer.classList.add('error-flash');
        setTimeout(() => cameraContainer.classList.remove('error-flash'), 500);
    }

    let faceDetectionInterval;
    function startFaceDetection() {
        faceDetectionInterval = setInterval(() => {
            const x = Math.random() * (video.offsetWidth - 200);
            const y = Math.random() * (video.offsetHeight - 200);
            showFaceBox(x, y, 200, 200);
            setTimeout(hideFaceBox, 1000);
        }, 2000);
    }

    function stopFaceDetection() {
        clearInterval(faceDetectionInterval);
        hideFaceBox();
    }

    video.addEventListener('play', () => {
        startFaceDetection();
    });

    video.addEventListener('pause', () => {
        stopFaceDetection();
    });

    startVideo().catch(err => {
        console.error('Failed to start video:', err);
        showStatus('Failed to start camera. Please refresh the page and try again.', 'error');
    });

    captureButton.addEventListener('click', () => {
        try {
            startScanningAnimation();
            showProcessing();
            
            const context = canvas.getContext('2d');
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            const imageData = canvas.toDataURL('image/jpeg');
            preview.src = imageData;
            previewContainer.style.display = 'block';
            registerButton.disabled = false;
            flashSuccess();
            showStatus('Photo captured successfully. Please verify the image quality.', 'success');
        } catch (err) {
            console.error('Error capturing photo:', err);
            flashError();
            showStatus('Failed to capture photo. Please try again.', 'error');
        } finally {
            hideProcessing();
            stopScanningAnimation();
        }
    });

    registerButton.addEventListener('click', async () => {
        const name = nameInput.value.trim();
        if (!name) {
            showStatus('Please enter a name', 'error');
            return;
        }

        try {
            registerButton.disabled = true;
            startScanningAnimation();
            showProcessing();
            
            const imageData = canvas.toDataURL('image/jpeg');
            
            const response = await fetch('/register_face', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    name: name,
                    image_data: imageData
                })
            });

            const result = await response.json();
            
            if (result.status === 'success') {
                flashSuccess();
                showStatus('Face registered successfully!', 'success');
                setTimeout(() => {
                    nameInput.value = '';
                    preview.src = '';
                    previewContainer.style.display = 'none';
                    registerButton.disabled = true;
                }, 2000);
            } else {
                flashError();
                showStatus(result.message || 'Registration failed', 'error');
                registerButton.disabled = false;
            }
        } catch (err) {
            console.error('Error registering face:', err);
            flashError();
            showStatus('Error registering face. Please try again.', 'error');
            registerButton.disabled = false;
        } finally {
            hideProcessing();
            stopScanningAnimation();
        }
    });
});