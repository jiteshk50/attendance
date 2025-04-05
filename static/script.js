document.addEventListener('DOMContentLoaded', () => {
    // Get references to HTML elements
    const video = document.getElementById('video');
    const canvas = document.getElementById('canvas');
    const snapButton = document.getElementById('snap');
    const attendanceList = document.getElementById('attendance-list').querySelector('ul');
    const statusMessage = document.getElementById('status-message');
    const context = canvas.getContext('2d');

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

    // Access the user's webcam with improved error handling
    async function setupCamera() {
        try {
            await checkCameraSupport();

            // Specify preferred camera settings
            const constraints = {
                video: {
                    width: { ideal: 640 },
                    height: { ideal: 480 },
                    facingMode: "user"
                },
                audio: false
            };

            // Request camera access with specific constraints
            const stream = await navigator.mediaDevices.getUserMedia(constraints);
            video.srcObject = stream;
            
            // Wait for video to be loaded
            await new Promise((resolve) => {
                video.onloadedmetadata = () => {
                    resolve();
                };
            });

            // Start playing the video
            await video.play();
            console.log("Camera access granted and stream set.");
            snapButton.disabled = false;
            showStatus("Camera ready", "success");
        } catch (err) {
            console.error("Error accessing camera:", err);
            showStatus(err.message || 'Could not access the camera. Please ensure your camera is connected and permissions are granted.', "error");
            snapButton.disabled = true;
        }
    }

    // Enhanced status message handling
    function showStatus(message, type = 'info') {
        statusMessage.textContent = message;
        statusMessage.className = `status-message ${type}`;
        if (type === 'success') {
            statusMessage.style.color = 'green';
        } else if (type === 'error') {
            statusMessage.style.color = 'red';
        } else {
            statusMessage.style.color = '#004085';
        }
    }

    // Enhanced capture photo handler
    snapButton.addEventListener('click', async () => {
        if (!video.srcObject) {
            showStatus('Camera not ready. Please wait or refresh the page.', 'error');
            return;
        }

        snapButton.disabled = true;
        try {
            console.log("Capturing image...");
            context.drawImage(video, 0, 0, canvas.width, canvas.height);
            const imageDataURL = canvas.toDataURL('image/jpeg');
            showStatus('Processing...', 'info');

            const response = await fetch('/process_image', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ image_data: imageDataURL }),
            });

            const data = await response.json();
            console.log("Server response:", data);

            // Handle different status types
            if (data.status === 'success' || data.status === 'info') {
                if (data.student_name !== 'Unknown') {
                    const listItem = document.createElement('li');
                    listItem.textContent = `${data.student_name} - ${data.timestamp}`;
                    if (attendanceList.firstChild) {
                        attendanceList.insertBefore(listItem, attendanceList.firstChild);
                    } else {
                        attendanceList.appendChild(listItem);
                    }
                }
                showStatus(data.message, data.status);
            } else {
                showStatus(data.message, 'error');
            }
        } catch (error) {
            console.error('Error processing attendance:', error);
            showStatus('Failed to process attendance. Please try again.', 'error');
        } finally {
            snapButton.disabled = false;
        }
    });

    // Initialize camera setup when the page loads
    setupCamera().catch(err => {
        console.error('Failed to setup camera:', err);
        showStatus('Failed to setup camera. Please refresh the page and try again.', 'error');
    });
});
