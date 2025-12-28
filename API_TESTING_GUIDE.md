# Real-Time Attendance System - API Testing Guide

## 🧪 Testing Endpoints with cURL

### Setup
Replace these variables in commands:
- `{token}` - JWT token from login
- `{sessionId}` - Session ID from start endpoint
- `{studentId}` - Student ID
- `http://localhost:3000` - Your server URL

---

## 1. Start Attendance Session (Faculty)

### Request
```bash
curl -X POST http://localhost:3000/api/attendance/session/start \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {token}" \
  -d '{
    "timetableId": "current",
    "subjectId": null,
    "wifiConfig": {
      "ssid": "ATTEND_SMITH_abc123",
      "geofenceRadius": 50
    },
    "location": {
      "latitude": 23.0225,
      "longitude": 72.5714,
      "room": "A-101"
    }
  }'
```

### Response (Success)
```json
{
  "success": true,
  "session": {
    "_id": "session_id_123",
    "status": "active",
    "wifiConfig": {
      "ssid": "ATTEND_SMITH_abc123",
      "geofenceRadius": 50,
      "allowedIPs": []
    },
    "location": {
      "latitude": 23.0225,
      "longitude": 72.5714,
      "room": "A-101"
    },
    "startedAt": "2024-12-28T10:00:00Z"
  }
}
```

---

## 2. Get Active Sessions (Student)

### Request
```bash
curl -X GET http://localhost:3000/api/attendance/active-session \
  -H "Authorization: Bearer {token}"
```

### Response (Success)
```json
{
  "success": true,
  "hasActiveSession": true,
  "sessions": [
    {
      "sessionId": "session_id_123",
      "subjectName": "Data Structures",
      "subjectCode": "CS201",
      "facultyName": "Dr. Smith",
      "location": {
        "latitude": 23.0225,
        "longitude": 72.5714,
        "room": "A-101"
      },
      "wifiSSID": "ATTEND_SMITH_abc123",
      "geofenceRadius": 50,
      "startedAt": "2024-12-28T10:00:00Z"
    }
  ]
}
```

---

## 3. Check WiFi Connection (Student)

### Request
```bash
curl -X POST http://localhost:3000/api/attendance/check-wifi \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {token}" \
  -d '{
    "sessionId": "session_id_123",
    "ssid": "ATTEND_SMITH_abc123",
    "ipAddress": "192.168.1.100",
    "deviceInfo": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
  }'
```

### Response (Success)
```json
{
  "success": true,
  "wifiConnected": true,
  "message": "Successfully connected to ATTEND_SMITH_abc123",
  "sessionId": "session_id_123",
  "ipAddress": "192.168.1.100",
  "deviceInfo": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"
}
```

### Response (Failure - Wrong SSID)
```json
{
  "success": true,
  "wifiConnected": false,
  "message": "Not connected to ATTEND_SMITH_abc123. Currently connected to: OtherWiFi",
  "expectedSSID": "ATTEND_SMITH_abc123",
  "currentSSID": "OtherWiFi"
}
```

---

## 4. Validate Location (Student)

### Request
```bash
curl -X POST http://localhost:3000/api/attendance/validate-location \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {token}" \
  -d '{
    "sessionId": "session_id_123",
    "latitude": 23.0230,
    "longitude": 72.5720,
    "accuracy": 10
  }'
```

### Response (Success - Within Geofence)
```json
{
  "success": true,
  "isWithinGeofence": true,
  "distance": 25.50,
  "maxAllowedDistance": 50,
  "studentLocation": {
    "latitude": 23.0230,
    "longitude": 72.5720
  },
  "facultyLocation": {
    "latitude": 23.0225,
    "longitude": 72.5714
  },
  "message": "You are within the geofence. Distance: 25m"
}
```

### Response (Failure - Too Far)
```json
{
  "success": true,
  "isWithinGeofence": false,
  "distance": 75.30,
  "maxAllowedDistance": 50,
  "studentLocation": {
    "latitude": 23.0260,
    "longitude": 72.5760
  },
  "facultyLocation": {
    "latitude": 23.0225,
    "longitude": 72.5714
  },
  "message": "You are outside the geofence. Distance: 75m (allowed: 50m)"
}
```

---

## 5. Mark Attendance Real-Time (Student)

### Request
```bash
curl -X POST http://localhost:3000/api/attendance/mark-real-time \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {token}" \
  -d '{
    "sessionId": "session_id_123",
    "wifiConnected": true,
    "locationVerified": true,
    "faceVerified": true,
    "ipAddress": "192.168.1.100",
    "latitude": 23.0230,
    "longitude": 72.5720,
    "faceConfidence": 0.85
  }'
```

### Response (Success - On Time)
```json
{
  "success": true,
  "message": "Attendance marked as PRESENT!",
  "status": "present",
  "markedAt": "2024-12-28T10:05:00Z",
  "details": {
    "distanceFromClass": 25,
    "minutesLate": 5,
    "faceConfidence": 0.85
  }
}
```

### Response (Success - Late)
```json
{
  "success": true,
  "message": "Attendance marked as LATE!",
  "status": "late",
  "markedAt": "2024-12-28T10:20:00Z",
  "details": {
    "distanceFromClass": 25,
    "minutesLate": 20,
    "faceConfidence": 0.85
  }
}
```

### Response (Failure - Missing Verification)
```json
{
  "success": false,
  "message": "All verifications required: WiFi, Location, and Face",
  "required": {
    "wifiConnected": false,
    "locationVerified": true,
    "faceVerified": true
  }
}
```

---

## 6. Get Students Status (Faculty Dashboard)

### Request
```bash
curl -X GET http://localhost:3000/api/attendance/session/session_id_123/students-status \
  -H "Authorization: Bearer {token}"
```

### Response
```json
{
  "success": true,
  "sessionId": "session_id_123",
  "studentCount": 45,
  "presentCount": 38,
  "lateCount": 3,
  "absentCount": 4,
  "students": [
    {
      "studentId": "student_id_1",
      "studentName": "John Doe",
      "rollNumber": "20001",
      "status": "present",
      "markedAt": "2024-12-28T10:05:00Z",
      "verifications": {
        "wifiConnected": true,
        "locationVerified": true,
        "faceVerified": true,
        "distance": 25
      }
    },
    {
      "studentId": "student_id_2",
      "studentName": "Jane Smith",
      "rollNumber": "20002",
      "status": "late",
      "markedAt": "2024-12-28T10:20:00Z",
      "verifications": {
        "wifiConnected": true,
        "locationVerified": true,
        "faceVerified": true,
        "distance": 30
      }
    },
    {
      "studentId": "student_id_3",
      "studentName": "Bob Johnson",
      "rollNumber": "20003",
      "status": "absent",
      "markedAt": null,
      "verifications": {
        "wifiConnected": false,
        "locationVerified": false,
        "faceVerified": false,
        "distance": null
      }
    }
  ]
}
```

---

## 7. End Attendance Session (Faculty)

### Request
```bash
curl -X POST http://localhost:3000/api/attendance/session/session_id_123/end \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer {token}" \
  -d '{
    "statistics": {
      "totalStudents": 45,
      "presentCount": 38,
      "absentCount": 7
    }
  }'
```

### Response
```json
{
  "success": true,
  "message": "Attendance session ended",
  "session": {
    "_id": "session_id_123",
    "status": "completed",
    "endedAt": "2024-12-28T10:50:00Z",
    "presentCount": 38,
    "absentCount": 7,
    "lateCount": 3
  }
}
```

---

## 🧪 Complete Test Flow Script

### Shell Script to Test Complete Flow
```bash
#!/bin/bash

# Configuration
BASE_URL="http://localhost:3000"
FACULTY_TOKEN="your_faculty_token_here"
STUDENT_TOKEN="your_student_token_here"

echo "=== REAL-TIME ATTENDANCE TEST FLOW ==="
echo ""

# Step 1: Faculty starts session
echo "1. Starting attendance session..."
SESSION_RESPONSE=$(curl -s -X POST $BASE_URL/api/attendance/session/start \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $FACULTY_TOKEN" \
  -d '{
    "timetableId": "current",
    "wifiConfig": {"ssid": "ATTEND_TEST_123", "geofenceRadius": 50},
    "location": {"latitude": 23.0225, "longitude": 72.5714, "room": "A-101"}
  }')

SESSION_ID=$(echo $SESSION_RESPONSE | jq -r '.session._id')
echo "Session ID: $SESSION_ID"
echo ""

# Step 2: Student checks for active session
echo "2. Checking for active session..."
curl -s -X GET $BASE_URL/api/attendance/active-session \
  -H "Authorization: Bearer $STUDENT_TOKEN" | jq '.'
echo ""

# Step 3: Student checks WiFi
echo "3. Checking WiFi connection..."
curl -s -X POST $BASE_URL/api/attendance/check-wifi \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $STUDENT_TOKEN" \
  -d "{\"sessionId\": \"$SESSION_ID\", \"ssid\": \"ATTEND_TEST_123\", \"ipAddress\": \"192.168.1.100\"}" | jq '.'
echo ""

# Step 4: Student validates location
echo "4. Validating location..."
curl -s -X POST $BASE_URL/api/attendance/validate-location \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $STUDENT_TOKEN" \
  -d "{\"sessionId\": \"$SESSION_ID\", \"latitude\": 23.0230, \"longitude\": 72.5720}" | jq '.'
echo ""

# Step 5: Student marks attendance
echo "5. Marking attendance..."
curl -s -X POST $BASE_URL/api/attendance/mark-real-time \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $STUDENT_TOKEN" \
  -d "{\"sessionId\": \"$SESSION_ID\", \"wifiConnected\": true, \"locationVerified\": true, \"faceVerified\": true, \"ipAddress\": \"192.168.1.100\", \"latitude\": 23.0230, \"longitude\": 72.5720, \"faceConfidence\": 0.85}" | jq '.'
echo ""

# Step 6: Faculty checks student status
echo "6. Checking student status..."
curl -s -X GET $BASE_URL/api/attendance/session/$SESSION_ID/students-status \
  -H "Authorization: Bearer $FACULTY_TOKEN" | jq '.'
echo ""

# Step 7: Faculty stops session
echo "7. Stopping session..."
curl -s -X POST $BASE_URL/api/attendance/session/$SESSION_ID/end \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $FACULTY_TOKEN" \
  -d '{"statistics": {"totalStudents": 1, "presentCount": 1, "absentCount": 0}}' | jq '.'
echo ""

echo "=== TEST COMPLETE ==="
```

### Running the Test Script
```bash
# Save as test-attendance.sh
chmod +x test-attendance.sh

# Run with your tokens
./test-attendance.sh
```

---

## 📊 Expected Success Rates

| Operation | Expected Success Rate | Time |
|-----------|----------------------|------|
| Start Session | 100% | < 500ms |
| Check Active Session | 100% | < 500ms |
| Check WiFi | 95%* | < 100ms |
| Validate Location | 90%* | < 1s |
| Mark Attendance | 85%* | < 500ms |
| Get Student Status | 100% | < 200ms |
| End Session | 100% | < 500ms |

*Varies based on GPS accuracy and face detection

---

## 🔍 Common Test Scenarios

### Scenario 1: Perfect Flow
```
Start Session → WiFi ✓ → Location ✓ → Mark ✓ → Stop
Status: All endpoints return success
```

### Scenario 2: Location Too Far
```
Start Session → WiFi ✓ → Location ✗ (75m away) → Blocked
Status: Mark endpoint returns error
```

### Scenario 3: Session Already Active
```
Start Session while already active
Status: Returns error "You already have an active session"
```

### Scenario 4: Session Ended
```
Student tries to mark attendance after session ended
Status: Returns error "Attendance session is no longer active"
```

### Scenario 5: Missing Verifications
```
Mark attendance with wifiConnected=false
Status: Returns error "All verifications required"
```

---

## 🔒 Authentication

### Get Token
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "student@example.com",
    "password": "password123"
  }'
```

### Token Format
```
Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

---

## 📈 Load Testing

### Test Multiple Students
```bash
#!/bin/bash
for i in {1..10}; do
  STUDENT_TOKEN="token_for_student_$i"
  curl -s -X POST http://localhost:3000/api/attendance/mark-real-time \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $STUDENT_TOKEN" \
    -d '{"sessionId":"session_id","wifiConnected":true,"locationVerified":true,"faceVerified":true,"ipAddress":"192.168.1.$i","latitude":23.0230,"longitude":72.5720,"faceConfidence":0.85}' &
done
wait
```

---

## ✅ Validation Checklist

- [ ] All endpoints return expected JSON
- [ ] Error messages are clear
- [ ] HTTP status codes correct (200, 400, 404, 500)
- [ ] Session ID returned from start endpoint
- [ ] Distance calculated correctly
- [ ] Status values correct (present, late, absent)
- [ ] Timestamps in ISO format
- [ ] Student data filters correctly in status endpoint

---

## 🐛 Debugging Tips

### Enable Verbose Output
```bash
curl -v -X POST ... # Shows headers and timing
```

### Pretty Print JSON
```bash
curl ... | jq '.'  # Format JSON response nicely
```

### Save Response
```bash
curl ... -o response.json  # Save full response
```

### Check Headers
```bash
curl -i ...  # Include response headers
```

---

## 📝 Notes

- All timestamps are in ISO 8601 format (UTC)
- Distances are in meters, rounded to 2 decimals
- Face confidence scores are 0-1 (0.85 = 85% match)
- Session IDs are MongoDB ObjectIds
- Student IDs are MongoDB ObjectIds

---

**Version**: 1.0
**Last Updated**: December 28, 2025
**Status**: Ready for Testing
