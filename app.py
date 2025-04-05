from flask import Flask, render_template, request, redirect, url_for, jsonify
import base64
import io
from PIL import Image
import numpy as np
import cv2
import os
from datetime import datetime
from flask_sqlalchemy import SQLAlchemy

app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///attendance.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False
db = SQLAlchemy(app)

# Database Models
class Student(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(100), nullable=False)
    registered_date = db.Column(db.DateTime, default=datetime.utcnow)

class Attendance(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    student_id = db.Column(db.Integer, db.ForeignKey('student.id'), nullable=False)
    timestamp = db.Column(db.DateTime, default=datetime.utcnow)
    
# Create the database tables
with app.app_context():
    db.create_all()

# Initialize face detector
face_cascade = cv2.CascadeClassifier(cv2.data.haarcascades + 'haarcascade_frontalface_default.xml')
recognizer = cv2.face.LBPHFaceRecognizer_create()

# Global variables for known faces
known_faces = []
known_names = []

# Ensure known_faces directory exists
if not os.path.exists('known_faces'):
    os.makedirs('known_faces')

def train_recognizer():
    global known_faces, known_names
    faces = []
    labels = []
    label_dict = {}
    current_label = 0

    print("Loading known faces...")
    # Update to also store students in database
    for filename in os.listdir('known_faces'):
        if filename.lower().endswith(('.png', '.jpg', '.jpeg')):
            try:
                name = os.path.splitext(filename)[0].replace('_', ' ').title()
                # Check if student exists in database
                student = Student.query.filter_by(name=name).first()
                if not student:
                    student = Student(name=name)
                    db.session.add(student)
                    db.session.commit()
                
                image_path = os.path.join('known_faces', filename)
                print(f"Processing {image_path} for {name}")

                # Read image in grayscale
                img = cv2.imread(image_path)
                gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
                
                # Detect faces
                detected_faces = face_cascade.detectMultiScale(gray, 1.3, 5)
                
                for (x, y, w, h) in detected_faces:
                    faces.append(gray[y:y+h, x:x+w])
                    if name not in label_dict:
                        label_dict[name] = current_label
                        current_label += 1
                    labels.append(label_dict[name])
                    known_names.append(name)
                
                print(f"Loaded face for {name}")
            except Exception as e:
                print(f"Error processing {filename}: {e}")
    
    if faces:
        recognizer.train(faces, np.array(labels))
        print(f"Trained recognizer with {len(faces)} faces")
    else:
        print("No faces found in known_faces directory")

# Train the recognizer on startup
train_recognizer()

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
        # Process the base64 image
        image_data = data['image_data']
        name = data['name'].strip()
        
        # Validate name
        if not name:
            return jsonify({"status": "error", "message": "Name is required"}), 400
            
        # Add student to database
        student = Student.query.filter_by(name=name).first()
        if not student:
            student = Student(name=name)
            db.session.add(student)
            db.session.commit()
        
        # Convert base64 to image
        header, encoded = image_data.split(",", 1)
        image_bytes = base64.b64decode(encoded)
        
        # Convert to numpy array
        nparr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if img is None:
            return jsonify({"status": "error", "message": "Invalid image data"}), 400
            
        # Convert to grayscale
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        
        # Detect face in the image
        faces = face_cascade.detectMultiScale(gray, 1.3, 5)
        
        if len(faces) == 0:
            return jsonify({"status": "error", "message": "No face detected in the image"}), 400
        
        if len(faces) > 1:
            return jsonify({"status": "error", "message": "Multiple faces detected. Please use a photo with only one face"}), 400
        
        # Save the image
        filename = f"{name.lower().replace(' ', '_')}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.jpg"
        filepath = os.path.join('known_faces', filename)
        cv2.imwrite(filepath, img)
        
        # Retrain the recognizer
        train_recognizer()
        
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
        # Convert base64 image to OpenCV format
        image_data_url = data['image_data']
        header, encoded = image_data_url.split(",", 1)
        image_data_bytes = base64.b64decode(encoded)
        
        # Convert to numpy array
        nparr = np.frombuffer(image_data_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)

        # Detect faces
        faces = face_cascade.detectMultiScale(gray, 1.3, 5)
        
        if len(faces) == 0:
            return jsonify({
                "status": "success",
                "message": "No face detected in the image",
                "student_name": "Unknown",
                "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
            })

        # Process each detected face
        for (x, y, w, h) in faces:
            face_roi = gray[y:y+h, x:x+w]
            label, confidence = recognizer.predict(face_roi)
            
            # Lower confidence value means better match
            if confidence < 100:  # You can adjust this threshold
                student_name = known_names[label]
                # Record attendance in database
                student = Student.query.filter_by(name=student_name).first()
                if student:
                    # Check if attendance already marked in last hour
                    last_attendance = Attendance.query.filter_by(student_id=student.id).order_by(Attendance.timestamp.desc()).first()
                    if not last_attendance or (datetime.utcnow() - last_attendance.timestamp).total_seconds() > 3600:
                        attendance = Attendance(student_id=student.id)
                        db.session.add(attendance)
                        db.session.commit()
                        return jsonify({
                            "status": "success",
                            "message": f"Attendance marked for: {student_name}",
                            "student_name": student_name,
                            "timestamp": attendance.timestamp.strftime("%Y-%m-%d %H:%M:%S")
                        })
                    else:
                        return jsonify({
                            "status": "info",
                            "message": f"Attendance already marked for {student_name} in the last hour",
                            "student_name": student_name,
                            "timestamp": last_attendance.timestamp.strftime("%Y-%m-%d %H:%M:%S")
                        })

        return jsonify({
            "status": "success",
            "message": "Face detected but not recognized",
            "student_name": "Unknown",
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        })

    except Exception as e:
        print(f"Error during face recognition: {e}")
        return jsonify({
            "status": "error",
            "message": f"Server error during recognition: {str(e)}",
            "student_name": "Error",
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        })

if __name__ == '__main__':
    app.run(debug=True)
