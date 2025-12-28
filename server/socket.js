// Socket.IO handler for real-time updates
const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('./config/constants');

module.exports = (io) => {
    // Middleware for authentication
    io.use((socket, next) => {
        const token = socket.handshake.auth.token;
        if (!token) {
            return next(new Error('Authentication error'));
        }

        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            socket.userId = decoded.id;
            socket.userRole = decoded.role;
            next();
        } catch (error) {
            return next(new Error('Authentication error'));
        }
    });

    io.on('connection', (socket) => {
        console.log(`🔌 User connected: ${socket.userId}`);

        // Join user-specific room
        socket.join(`user_${socket.userId}`);

        // Faculty joins their session room
        socket.on('joinSession', (sessionId) => {
            socket.join(`session_${sessionId}`);
            console.log(`👨‍🏫 Faculty joined session: ${sessionId}`);
        });

        // Student joins session room for updates
        socket.on('joinStudentSession', (sessionId) => {
            socket.join(`session_${sessionId}`);
            console.log(`👨‍🎓 Student joined session: ${sessionId}`);
        });

        // Faculty starts WiFi hotspot - notify relevant students
        socket.on('hotspotStarted', (data) => {
            io.emit('newAttendanceSession', {
                sessionId: data.sessionId,
                wifiSSID: data.ssid,
                facultyName: data.facultyName,
                subjectName: data.subjectName,
                room: data.room
            });
        });

        // Student connects to WiFi
        socket.on('studentConnected', (data) => {
            io.to(`session_${data.sessionId}`).emit('studentJoinedWifi', {
                studentId: data.studentId,
                studentName: data.studentName,
                rollNumber: data.rollNumber,
                ipAddress: data.ipAddress,
                timestamp: new Date()
            });
        });

        // Student location verified
        socket.on('locationVerified', (data) => {
            io.to(`session_${data.sessionId}`).emit('studentLocationVerified', {
                studentId: data.studentId,
                studentName: data.studentName,
                distance: data.distance,
                timestamp: new Date()
            });
        });

        // Face verification started
        socket.on('faceVerificationStarted', (data) => {
            io.to(`session_${data.sessionId}`).emit('studentVerifyingFace', {
                studentId: data.studentId,
                studentName: data.studentName
            });
        });

        // Attendance marked
        socket.on('attendanceMarked', (data) => {
            io.to(`session_${data.sessionId}`).emit('attendanceUpdate', {
                studentId: data.studentId,
                studentName: data.studentName,
                rollNumber: data.rollNumber,
                status: data.status,
                markedAt: new Date()
            });

            // Notify the student
            io.to(`user_${data.studentId}`).emit('attendanceConfirmed', {
                status: data.status,
                subjectName: data.subjectName
            });
        });

        // ==================== REAL-TIME ATTENDANCE FLOW ====================
        
        // Faculty creates and starts attendance session
        socket.on('sessionStarted', (data) => {
            socket.join(`session_${data.sessionId}`);
            io.to(`session_${data.sessionId}`).emit('attendanceSessionActive', {
                sessionId: data.sessionId,
                facultyId: data.facultyId,
                facultyName: data.facultyName,
                subjectName: data.subjectName,
                room: data.room,
                wifiSSID: data.wifiSSID,
                location: data.location,
                startTime: new Date(),
                status: 'active'
            });
            console.log(`📱 Attendance session started: ${data.sessionId}`);
        });

        // Student detects and connects to faculty WiFi
        socket.on('wifiConnected', (data) => {
            io.to(`session_${data.sessionId}`).emit('studentWifiConnected', {
                studentId: data.studentId,
                studentName: data.studentName,
                rollNumber: data.rollNumber,
                ipAddress: data.ipAddress,
                deviceInfo: data.deviceInfo,
                connectedAt: new Date(),
                status: 'wifi_connected'
            });
            console.log(`📡 Student WiFi connected: ${data.studentId} - ${data.studentName}`);
        });

        // Student location verification in progress
        socket.on('locationVerifying', (data) => {
            io.to(`session_${data.sessionId}`).emit('studentLocationVerifying', {
                studentId: data.studentId,
                studentName: data.studentName,
                status: 'location_verifying'
            });
        });

        // Student location verified successfully
        socket.on('locationVerified', (data) => {
            io.to(`session_${data.sessionId}`).emit('studentLocationVerified', {
                studentId: data.studentId,
                studentName: data.studentName,
                distance: data.distance,
                latitude: data.latitude,
                longitude: data.longitude,
                verifiedAt: new Date(),
                status: 'location_verified'
            });
            console.log(`📍 Student location verified: ${data.studentId} - Distance: ${data.distance}m`);
        });

        // Location verification failed
        socket.on('locationVerificationFailed', (data) => {
            io.to(`user_${data.studentId}`).emit('locationVerificationFailed', {
                studentId: data.studentId,
                studentName: data.studentName,
                message: data.message,
                distance: data.distance,
                maxAllowedDistance: data.maxAllowedDistance,
                failedAt: new Date()
            });
            console.log(`❌ Location verification failed: ${data.studentId}`);
        });

        // Face verification in progress
        socket.on('faceVerificationStarted', (data) => {
            io.to(`session_${data.sessionId}`).emit('studentFaceVerifying', {
                studentId: data.studentId,
                studentName: data.studentName,
                status: 'face_verifying'
            });
            console.log(`👤 Face verification started: ${data.studentId}`);
        });

        // Face verification successful
        socket.on('faceVerificationSuccess', (data) => {
            io.to(`session_${data.sessionId}`).emit('studentFaceVerified', {
                studentId: data.studentId,
                studentName: data.studentName,
                confidence: data.confidence,
                verifiedAt: new Date(),
                status: 'face_verified'
            });
            console.log(`✅ Face verification successful: ${data.studentId}`);
        });

        // Face verification failed
        socket.on('faceVerificationFailed', (data) => {
            io.to(`user_${data.studentId}`).emit('faceVerificationFailed', {
                studentId: data.studentId,
                studentName: data.studentName,
                message: data.message,
                failedAt: new Date(),
                retryCount: data.retryCount
            });
            console.log(`❌ Face verification failed: ${data.studentId}`);
        });

        // Student submits attendance marking
        socket.on('attendanceSubmitting', (data) => {
            io.to(`session_${data.sessionId}`).emit('studentMarking', {
                studentId: data.studentId,
                studentName: data.studentName,
                status: 'marking'
            });
        });

        // Attendance successfully marked
        socket.on('attendanceMarked', (data) => {
            io.to(`session_${data.sessionId}`).emit('attendanceRecorded', {
                studentId: data.studentId,
                studentName: data.studentName,
                rollNumber: data.rollNumber,
                status: 'present',
                markedAt: new Date(),
                verifications: {
                    wifiConnected: data.wifiConnected,
                    locationVerified: data.locationVerified,
                    faceVerified: data.faceVerified,
                    ipValidated: data.ipValidated
                }
            });

            // Notify student of successful marking
            io.to(`user_${data.studentId}`).emit('attendanceMarkedSuccess', {
                status: 'present',
                subject: data.subjectName,
                markedAt: new Date(),
                message: 'Attendance marked successfully!'
            });
            console.log(`✅ Attendance marked: ${data.studentId} - ${data.studentName}`);
        });

        // Attendance marking failed
        socket.on('attendanceMarkingFailed', (data) => {
            io.to(`user_${data.studentId}`).emit('attendanceMarkingFailed', {
                studentId: data.studentId,
                studentName: data.studentName,
                message: data.message,
                reason: data.reason,
                failedAt: new Date()
            });
            console.log(`❌ Attendance marking failed: ${data.studentId} - ${data.reason}`);
        });

        // Faculty ends session
        socket.on('sessionEnded', (data) => {
            io.to(`session_${data.sessionId}`).emit('sessionClosed', {
                sessionId: data.sessionId,
                endTime: new Date(),
                message: 'Attendance session has ended',
                statistics: {
                    totalStudents: data.statistics?.totalStudents || 0,
                    presentCount: data.statistics?.presentCount || 0,
                    absentCount: data.statistics?.absentCount || 0,
                    totalVerified: data.statistics?.totalVerified || 0
                }
            });
            console.log(`🏁 Attendance session ended: ${data.sessionId}`);
        });

        // Manual override by faculty
        socket.on('manualOverride', (data) => {
            io.to(`user_${data.studentId}`).emit('attendanceOverridden', {
                newStatus: data.newStatus,
                reason: data.reason,
                subjectName: data.subjectName,
                overriddenAt: new Date()
            });
            io.to(`session_${data.sessionId}`).emit('attendanceManuallyUpdated', {
                studentId: data.studentId,
                newStatus: data.newStatus,
                reason: data.reason
            });
        });

        // New notice
        socket.on('noticePublished', (data) => {
            io.emit('newNotice', {
                id: data.noticeId,
                title: data.title,
                type: data.type,
                priority: data.priority
            });
        });

        // Handle disconnection
        socket.on('disconnect', () => {
            console.log(`❌ User disconnected: ${socket.userId}`);
        });

        // Error handling
        socket.on('error', (error) => {
            console.error('Socket error:', error);
        });
    });

    return io;
};
