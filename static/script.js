document.addEventListener('DOMContentLoaded', async () => {
    const video = document.getElementById('video');
    const canvas = document.getElementById('canvas');
    const snapButton = document.getElementById('snap');
    const switchCameraButton = document.getElementById('switch-camera');
    const attendanceList = document.getElementById('attendance-list').querySelector('ul');
    const statusMessage = document.getElementById('status-message');
    const context = canvas.getContext('2d');
    let processingOverlay = document.querySelector('.processing-overlay');
    let faceBox = document.querySelector('.face-box');
    let cameraContainer = document.getElementById('camera-container');

    let currentStream;
    let detectionInterval;
    let cameras = [];
    let currentCameraIndex = 0;

    async function getCameras() {
        try {
            const devices = await navigator.mediaDevices.enumerateDevices();
            cameras = devices.filter(device => device.kind === 'videoinput');
            return cameras;
        } catch (err) {
            console.error('Error getting cameras:', err);
            return [];
        }
    }

    async function startCamera(deviceId = null) {
        try {
            const constraints = {
                video: deviceId ? { deviceId: { exact: deviceId } } : true,
                audio: false
            };

            if (currentStream) {
                currentStream.getTracks().forEach(track => track.stop());
            }

            currentStream = await navigator.mediaDevices.getUserMedia(constraints);
            video.srcObject = currentStream;

            video.onloadedmetadata = () => {
                video.play();
                startFaceDetection();
            };
        } catch (err) {
            console.error('Error starting camera:', err);
            statusMessage.textContent = 'Error accessing camera. Please make sure camera permissions are granted.';
            statusMessage.className = 'error';
        }
    }

    switchCameraButton.addEventListener('click', async () => {
        if (cameras.length < 2) {
            await getCameras();
        }
        currentCameraIndex = (currentCameraIndex + 1) % cameras.length;
        await startCamera(cameras[currentCameraIndex].deviceId);
    });

    function startFaceDetection() {
        if (detectionInterval) {
            clearInterval(detectionInterval);
        }

        detectionInterval = setInterval(async () => {
            try {
                canvas.width = video.videoWidth;
                canvas.height = video.videoHeight;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(video, 0, 0);

                const imageData = canvas.toDataURL('image/jpeg', 0.8);

                const response = await fetch('/detect_face', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        image_data: imageData
                    })
                });

                const result = await response.json();

                if (result.detected) {
                    const nameLabel = document.createElement('div');
                    nameLabel.className = 'name-label';
                    nameLabel.textContent = result.name;

                    faceBox.style.display = 'block';
                    faceBox.style.border = result.name !== 'Unknown' ? '2px solid #00ff00' : '2px solid #ff9900';
                    faceBox.innerHTML = '';
                    faceBox.appendChild(nameLabel);
                } else {
                    faceBox.style.display = 'none';
                }
            } catch (err) {
                console.error('Error during face detection:', err);
            }
        }, 500);
    }

    snapButton.addEventListener('click', async () => {
        try {
            processingOverlay.style.display = 'flex';
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(video, 0, 0);

            const imageData = canvas.toDataURL('image/jpeg', 0.8);

            const response = await fetch('/process_image', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    image_data: imageData
                })
            });

            const result = await response.json();
            statusMessage.textContent = result.message;
            statusMessage.className = result.status;

            if (result.status === 'success') {
                if (attendanceList) {
                    const li = document.createElement('li');
                    li.textContent = `${result.student_name} - ${result.timestamp}`;
                    attendanceList.insertBefore(li, attendanceList.firstChild);
                }
            }
        } catch (err) {
            console.error('Error processing image:', err);
            statusMessage.textContent = 'Error processing image. Please try again.';
            statusMessage.className = 'error';
        } finally {
            processingOverlay.style.display = 'none';
        }
    });

    await getCameras();
    await startCamera();
});
