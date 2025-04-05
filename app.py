from flask import Flask, render_template, request, redirect, url_for, jsonify, send_from_directory
import base64
import io
from PIL import Image
import numpy as np
import cv2
import os
import ssl
from datetime import datetime
from flask_sqlalchemy import SQLAlchemy
from werkzeug.middleware.proxy_fix import ProxyFix
import pickle

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///attendance.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

# Security configurations
app.config['SESSION_COOKIE_SECURE'] = True
app.config['REMEMBER_COOKIE_SECURE'] = True
app.config['SESSION_COOKIE_HTTPONLY'] = True

# Handle proper HTTPS detection behind proxies
app.wsgi_app = ProxyFix(app.wsgi_app, x_proto=1, x_host=1)

db = SQLAlchemy(app)

# Initialize face detector
face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')

# Database Models
class Student(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    registered_date = db.Column(db.DateTime, default=datetime.utcnow)
    face_features = db.Column(db.PickleType, nullable=True)  # Store face features

class Attendance(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    student_id = db.Column(db.Integer, db.ForeignKey('student.id'), nullable=False)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)
    
# Create the database tables
with app.app_context():
    db.create_all()

def process_base64_image(base64_image):
    """Convert base64 image to numpy array"""
    try:
        header, encoded = base64_image.split(",", 1)
        image_bytes = base64.b64decode(encoded)
        nparr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        return img
    except Exception as e:
        print(f"Error processing image: {e}")
        return None

def get_face_features(img):
    """Get face features using OpenCV"""
    try:
        print("Detecting faces...")
        # Convert to grayscale for face detection
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        
        # Enhance contrast using histogram equalization
        gray = cv2.equalizeHist(gray)
        
        # Detect faces with more lenient parameters
        faces = face_cascade.detectMultiScale(
            gray,
            scaleFactor=1.2,  # More gradual scaling
            minNeighbors=3,   # Require fewer neighboring detections
            minSize=(60, 60), # Minimum face size
            maxSize=(600, 600) # Maximum face size
        )
        
        if len(faces) == 0:
            print("No faces detected")
            return None
            
        print(f"Found {len(faces)} faces")
        
        # Get the largest face
        if len(faces) > 1:
            largest_face = max(faces, key=lambda rect: rect[2] * rect[3])
        else:
            largest_face = faces[0]
            
        x, y, w, h = largest_face
        
        # Add padding around the face (10%)
        padding_x = int(w * 0.1)
        padding_y = int(h * 0.1)
        x = max(0, x - padding_x)
        y = max(0, y - padding_y)
        w = min(gray.shape[1] - x, w + 2*padding_x)
        h = min(gray.shape[0] - y, h + 2*padding_y)
        
        # Extract face ROI and resize to standard size
        face_roi = gray[y:y+h, x:x+w]
        face_roi = cv2.resize(face_roi, (128, 128))
        
        # Apply additional preprocessing
        face_roi = cv2.GaussianBlur(face_roi, (3,3), 0)  # Reduce noise
        
        # Calculate features
        features = cv2.HOGDescriptor((128,128), (16,16), (8,8), (8,8), 9).compute(face_roi)
        print("Successfully extracted face features")
        
        return features
    except Exception as e:
        print(f"Error getting face features: {e}")
        return None

def compare_features(features1, features2, threshold=0.85):
    """Compare two face feature vectors"""
    if features1 is None or features2 is None:
        print("One or both feature sets are None")
        return False
    
    try:
        # Normalize and calculate cosine similarity
        norm1 = np.linalg.norm(features1)
        norm2 = np.linalg.norm(features2)
        if norm1 == 0 or norm2 == 0:
            return False
            
        similarity = np.dot(features1, features2) / (norm1 * norm2)
        print(f"Face similarity score: {similarity}")
        return similarity > threshold
    except Exception as e:
        print(f"Error comparing faces: {e}")
        return False

@app.before_request
def before_request():
    # Redirect to HTTPS in production
    if not request.is_secure and not app.debug:
        url = request.url.replace('http://', 'https://', 1)
        return redirect(url, code=301)

@app.route('/')
def index():
    # Get recent attendance records
    recent_attendance = (
        db.session.query(Attendance, Student)
        .join(Student)
        .order_by(Attendance.timestamp.desc())
        .limit(10)
        .all()
    )
    return render_template('index.html', attendance_records=recent_attendance)

@app.route('/register')
def register():
    return render_template('registration.html')

@app.route('/register_face', methods=['POST'])
def register_face():
    data = request.get_json()
    if not data or 'image_data' not in data or 'name' not in data:
        return jsonify({"status": "error", "message": "Missing required data"}), 400

    try:
        name = data['name'].strip()
        
        # Validate name
        if not name:
            return jsonify({"status": "error", "message": "Name is required"}), 400
        
        # Process the image
        img = process_base64_image(data['image_data'])
        if img is None:
            return jsonify({"status": "error", "message": "Failed to process image"}), 400
        
        # Get face features
        face_features = get_face_features(img)
        if face_features is None:
            return jsonify({"status": "error", "message": "No clear face detected in the image. Please try again with better lighting and a clear front view of the face."}), 400
            
        # Add student to database with face features
        student = Student.query.filter_by(name=name).first()
        if student:
            # Update existing student's face features
            student.face_features = face_features
        else:
            # Create new student
            student = Student(name=name, face_features=face_features)
            db.session.add(student)
        
        db.session.commit()
        
        # Save image file for reference
        filename = f"{name.lower().replace(' ', '_')}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.jpg"
        filepath = os.path.join('known_faces', filename)
        cv2.imwrite(filepath, img)
        
        return jsonify({
            "status": "success",
            "message": "Face registered successfully"
        })
        
    except Exception as e:
        print(f"Error during face registration: {e}")
        return jsonify({
            "status": "error",
            "message": f"Server error during registration: {str(e)}"
        }), 500

@app.route('/process_image', methods=['POST'])
def process_image():
    data = request.get_json()
    if not data or 'image_data' not in data:
        return jsonify({"status": "error", "message": "No image data received"}), 400

    try:
        # Process the image
        img = process_base64_image(data['image_data'])
        if img is None:
            return jsonify({"status": "error", "message": "Failed to process image"}), 400
        
        # Get face features
        face_features = get_face_features(img)
        if face_features is None:
            return jsonify({
                "status": "error",
                "message": "No clear face detected. Please ensure good lighting and face the camera directly.",
            })
        
        # Get all students with face features
        students = Student.query.filter(Student.face_features != None).all()
        
        if not students:
            return jsonify({
                "status": "error",
                "message": "No registered faces in database. Please register first.",
            })
        
        # Compare with known faces
        for student in students:
            if compare_features(student.face_features, face_features):
                # Check if attendance already marked in last hour
                last_attendance = Attendance.query.filter_by(student_id=student.id).order_by(Attendance.timestamp.desc()).first()
                if not last_attendance or (datetime.utcnow() - last_attendance.timestamp).total_seconds() > 3600:
                    attendance = Attendance(student_id=student.id)
                    db.session.add(attendance)
                    db.session.commit()
                    return jsonify({
                        "status": "success",
                        "message": f"Attendance marked for: {student.name}",
                        "student_name": student.name,
                        "timestamp": attendance.timestamp.strftime("%Y-%m-%d %H:%M:%S")
                    })
                else:
                    return jsonify({
                        "status": "info",
                        "message": f"Attendance already marked for {student.name} in the last hour",
                        "student_name": student.name,
                        "timestamp": last_attendance.timestamp.strftime("%Y-%m-%d %H:%M:%S")
                    })

        return jsonify({
            "status": "error",
            "message": "Face not recognized. Please register if you're a new student.",
        })

    except Exception as e:
        print(f"Error during face recognition: {e}")
        return jsonify({
            "status": "error",
            "message": f"Server error during recognition: {str(e)}",
            "student_name": "Error",
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        }), 500

@app.route('/detect_face', methods=['POST'])
def detect_face():
    data = request.get_json()
    if not data or 'image_data' not in data:
        return jsonify({"status": "error", "message": "No image data received"}), 400

    try:
        # Process the image
        img = process_base64_image(data['image_data'])
        if img is None:
            return jsonify({"status": "error", "message": "Failed to process image"}), 400
        
        # Get face features
        face_features = get_face_features(img)
        if face_features is None:
            return jsonify({
                "status": "success",
                "detected": False,
                "message": "No face detected"
            })
        
        # Get all students with face features
        students = Student.query.filter(Student.face_features != None).all()
        
        # Compare with known faces
        for student in students:
            if compare_features(student.face_features, face_features):
                return jsonify({
                    "status": "success",
                    "detected": True,
                    "name": student.name,
                    "message": f"Detected: {student.name}"
                })

        return jsonify({
            "status": "success",
            "detected": True,
            "name": "Unknown",
            "message": "Face detected but not recognized"
        })

    except Exception as e:
        print(f"Error during face detection: {e}")
        return jsonify({
            "status": "error",
            "message": f"Server error during detection: {str(e)}"
        }), 500

def create_self_signed_cert():
    """Create a self-signed certificate for development"""
    from cryptography import x509
    from cryptography.x509.oid import NameOID
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import rsa
    from cryptography.hazmat.primitives import serialization
    import datetime

    # Generate key
    private_key = rsa.generate_private_key(
        public_exponent=65537,
        key_size=2048
    )

    # Generate certificate
    subject = issuer = x509.Name([
        x509.NameAttribute(NameOID.COMMON_NAME, u"localhost")
    ])

    cert = x509.CertificateBuilder().subject_name(
        subject
    ).issuer_name(
        issuer
    ).public_key(
        private_key.public_key()
    ).serial_number(
        x509.random_serial_number()
    ).not_valid_before(
        datetime.datetime.utcnow()
    ).not_valid_after(
        datetime.datetime.utcnow() + datetime.timedelta(days=365)
    ).sign(private_key, hashes.SHA256())

    # Write the certificate and private key to disk
    with open("cert.pem", "wb") as f:
        f.write(cert.public_bytes(serialization.Encoding.PEM))

    with open("key.pem", "wb") as f:
        f.write(private_key.private_bytes(
            encoding=serialization.Encoding.PEM,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption()
        ))

if __name__ == '__main__':
    try:
        # Try to create and use SSL context
        if not os.path.exists('cert.pem') or not os.path.exists('key.pem'):
            create_self_signed_cert()
        
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain('cert.pem', 'key.pem')
        
        print("Starting server with HTTPS support...")
        app.run(
            host="0.0.0.0", 
            port=int(os.environ.get("PORT", 5000)),
            ssl_context=context,
            debug=True
        )
    except Exception as e:
        print(f"Failed to start with HTTPS, falling back to HTTP: {e}")
        # Fallback to HTTP
        app.run(
            host="0.0.0.0", 
            port=int(os.environ.get("PORT", 5000)),
            debug=True
        )
