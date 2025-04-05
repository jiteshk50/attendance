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

    // Track current camera
    let currentFacingMode = 'user';
    let currentStream = null;

    // Check for camera support
    async function checkCameraSupport() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error('Your browser does not support camera access. Please use a modern browser like Chrome, Firefox, or Edge.');
        }
        
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            const videoDevices = devices.filter(device => device.kind === 'videoinput');
            if (videoDevices.length === 0) {
                throw new Error('No camera detected. Please connect a camera and refresh the page.');
            }
        } catch (err) {
            throw new Error('Failed to detect camera devices: ' + err.message);
        }
    }

    // Access the webcam with improved setup
    async function startVideo(facingMode = 'user') {
        try {
            await checkCameraSupport();
            
            // Stop previous stream if it exists
            if (currentStream) {
                currentStream.getTracks().forEach(track => track.stop());
            }

            // Specify preferred camera settings
            const constraints = {
                video: {
                    width: { ideal: 640 },
                    height: { ideal: 480 },
                    facingMode: facingMode
                },
                audio: false
            };

            // Request camera access with specific constraints
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            video.srcObject = stream;
            currentStream = stream;
            currentFacingMode = facingMode;

            // Wait for video to be loaded
            await new Promise((resolve) => {
                video.onloadedmetadata = () => {
                    resolve();
                };
            });

            // Start playing the video
            await video.play();
            console.log("Camera access granted and stream set.");
            captureButton.disabled = false;
            showStatus("Camera ready", "success");
        } catch (err) {
            console.error('Error accessing webcam:', err);
            showStatus(err.message || 'Error accessing webcam. Please make sure your camera is connected and permissions are granted.', 'error');
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
            // Try to revert to the previous camera
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

    // Start video stream with error handling
    startVideo().catch(err => {
        console.error('Failed to start video:', err);
        showStatus('Failed to start camera. Please refresh the page and try again.', 'error');
    });

    // Enhanced capture photo handler
    captureButton.addEventListener('click', () => {
        try {
            const context = canvas.getContext('2d');
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            const imageData = canvas.toDataURL('image/jpeg');
            preview.src = imageData;
            previewContainer.style.display = 'block';
            registerButton.disabled = false;
            showStatus('Photo captured successfully. Please verify the image quality.', 'success');
        } catch (err) {
            console.error('Error capturing photo:', err);
            showStatus('Failed to capture photo. Please try again.', 'error');
        }
    });

    // Enhanced registration handler
    registerButton.addEventListener('click', async () => {
        const name = nameInput.value.trim();
        if (!name) {
            showStatus('Please enter a name', 'error');
            return;
        }

        try {
            registerButton.disabled = true;
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
                showStatus('Face registered successfully!', 'success');
                // Reset form after successful registration
                setTimeout(() => {
                    nameInput.value = '';
                    preview.src = '';
                    previewContainer.style.display = 'none';
                    registerButton.disabled = true;
                }, 2000);
            } else {
                showStatus(result.message || 'Registration failed', 'error');
                registerButton.disabled = false;
            }
        } catch (err) {
            console.error('Error registering face:', err);
            showStatus('Error registering face. Please try again.', 'error');
            registerButton.disabled = false;
        }
    });
});