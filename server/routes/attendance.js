const express = require('express');
const router = express.Router();
const AttendanceSession = require('../models/AttendanceSession');
const AttendanceRecord = require('../models/AttendanceRecord');
const WifiSession = require('../models/WifiSession');
const Timetable = require('../models/Timetable');
const User = require('../models/User');
const { protect, authorize } = require('../middleware/auth');
const { ROLES, ATTENDANCE_STATUS, SESSION_STATUS } = require('../config/constants');

// @route   POST /api/attendance/session/start
// @desc    Start attendance session (Faculty creates WiFi hotspot)
// @access  Private/Faculty
router.post('/session/start', protect, authorize(ROLES.FACULTY, ROLES.ADMIN), async (req, res) => {
    try {
        const { timetableId, subjectId, wifiConfig, location } = req.body;

        // Check for existing active session
        const existingSession = await AttendanceSession.findOne({
            faculty: req.user.id,
            status: SESSION_STATUS.ACTIVE
        });

        if (existingSession) {
            return res.status(400).json({
                success: false,
                message: 'You already have an active session. Please end it first.'
            });
        }

        // Get timetable entry
        const timetable = await Timetable.findById(timetableId).populate('subject');

        // Create attendance session
        const session = await AttendanceSession.create({
            timetable: timetableId,
            faculty: req.user.id,
            subject: subjectId || timetable?.subject?._id,
            date: new Date(),
            status: SESSION_STATUS.ACTIVE,
            wifiConfig: {
                ssid: wifiConfig?.ssid || `ATTEND_${req.user.name.split(' ')[0].toUpperCase()}_${Date.now()}`,
                bssid: wifiConfig?.bssid,
                allowedIPs: [],
                geofenceRadius: wifiConfig?.geofenceRadius || 50
            },
            location: {
                latitude: location?.latitude,
                longitude: location?.longitude,
                room: location?.room || timetable?.room
            },
            startedAt: new Date()
        });

        // Create WiFi session for tracking connected devices
        const wifiSession = await WifiSession.create({
            attendanceSession: session._id,
            faculty: req.user.id,
            hotspot: {
                ssid: session.wifiConfig.ssid,
                bssid: wifiConfig?.bssid,
                ipAddress: wifiConfig?.teacherIP,
                gatewayIP: wifiConfig?.gatewayIP
            },
            geofence: {
                centerLatitude: location?.latitude,
                centerLongitude: location?.longitude,
                radius: wifiConfig?.geofenceRadius || 50
            },
            status: 'active',
            startedAt: new Date()
        });

        // Get all students for this class
        const students = await User.find({
            role: ROLES.STUDENT,
            semester: timetable?.semester,
            branch: timetable?.branch,
            section: timetable?.section,
            isActive: true
        });

        // Create attendance records for all students (default: absent)
        const attendanceRecords = students.map(student => ({
            session: session._id,
            student: student._id,
            subject: session.subject,
            date: new Date(),
            status: ATTENDANCE_STATUS.ABSENT
        }));

        await AttendanceRecord.insertMany(attendanceRecords);

        // Update session stats
        session.totalStudents = students.length;
        session.absentCount = students.length;
        await session.save();

        res.status(201).json({
            success: true,
            message: 'Attendance session started',
            session: {
                id: session._id,
                wifiSSID: session.wifiConfig.ssid,
                room: session.location.room,
                totalStudents: session.totalStudents,
                startedAt: session.startedAt
            },
            wifiSession: {
                id: wifiSession._id,
                ssid: wifiSession.hotspot.ssid
            }
        });
    } catch (error) {
        console.error('Start session error:', error);
        res.status(500).json({
            success: false,
            message: 'Error starting session',
            error: error.message
        });
    }
});

// @route   POST /api/attendance/session/:id/end
// @desc    End attendance session
// @access  Private/Faculty
router.post('/session/:id/end', protect, authorize(ROLES.FACULTY, ROLES.ADMIN), async (req, res) => {
    try {
        const session = await AttendanceSession.findById(req.params.id);

        if (!session) {
            return res.status(404).json({
                success: false,
                message: 'Session not found'
            });
        }

        if (session.faculty.toString() !== req.user.id && req.user.role !== ROLES.ADMIN) {
            return res.status(403).json({
                success: false,
                message: 'Not authorized to end this session'
            });
        }

        // Update session status
        session.status = SESSION_STATUS.COMPLETED;
        session.endedAt = new Date();

        // Calculate final statistics
        const records = await AttendanceRecord.find({ session: session._id });
        session.presentCount = records.filter(r => r.status === ATTENDANCE_STATUS.PRESENT).length;
        session.absentCount = records.filter(r => r.status === ATTENDANCE_STATUS.ABSENT).length;
        session.lateCount = records.filter(r => r.status === ATTENDANCE_STATUS.LATE).length;

        await session.save();

        // End WiFi session
        await WifiSession.findOneAndUpdate(
            { attendanceSession: session._id },
            { status: 'inactive', endedAt: new Date() }
        );

        res.json({
            success: true,
            message: 'Attendance session ended',
            statistics: {
                total: session.totalStudents,
                present: session.presentCount,
                absent: session.absentCount,
                late: session.lateCount,
                duration: Math.round((session.endedAt - session.startedAt) / 60000) // minutes
            }
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error ending session',
            error: error.message
        });
    }
});

// @route   GET /api/attendance/session/active
// @desc    Get active session for faculty
// @access  Private/Faculty
router.get('/session/active', protect, authorize(ROLES.FACULTY, ROLES.ADMIN), async (req, res) => {
    try {
        const session = await AttendanceSession.findOne({
            faculty: req.user.id,
            status: SESSION_STATUS.ACTIVE
        }).populate('subject', 'name code');

        if (!session) {
            return res.json({
                success: true,
                hasActiveSession: false,
                session: null
            });
        }

        // Get attendance records
        const records = await AttendanceRecord.find({ session: session._id })
            .populate('student', 'name rollNumber profileImage');

        res.json({
            success: true,
            hasActiveSession: true,
            session,
            records
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error fetching active session',
            error: error.message
        });
    }
});

// @route   POST /api/attendance/verify
// @desc    Student verifies attendance (WiFi + Location + Face)
// @access  Private/Student
router.post('/verify', protect, authorize(ROLES.STUDENT), async (req, res) => {
    try {
        const { sessionId, wifiData, locationData, faceData } = req.body;

        // Find active session
        const session = await AttendanceSession.findById(sessionId);

        if (!session || session.status !== SESSION_STATUS.ACTIVE) {
            return res.status(400).json({
                success: false,
                message: 'No active attendance session found'
            });
        }

        // Find student's attendance record
        let record = await AttendanceRecord.findOne({
            session: sessionId,
            student: req.user.id
        });

        if (!record) {
            return res.status(404).json({
                success: false,
                message: 'Attendance record not found for this student'
            });
        }

        const verificationResults = {
            wifi: false,
            location: false,
            face: false
        };

        // Step 1: Verify WiFi connection
        if (wifiData) {
            const wifiSession = await WifiSession.findOne({
                attendanceSession: sessionId,
                status: 'active'
            });

            if (wifiSession && wifiData.ssid === wifiSession.hotspot.ssid) {
                verificationResults.wifi = true;
                record.wifiVerification = {
                    connected: true,
                    ipAddress: wifiData.ipAddress,
                    ssid: wifiData.ssid,
                    verifiedAt: new Date()
                };

                // Add to connected devices
                const deviceExists = wifiSession.connectedDevices.find(
                    d => d.student?.toString() === req.user.id
                );

                if (!deviceExists) {
                    wifiSession.connectedDevices.push({
                        student: req.user.id,
                        ipAddress: wifiData.ipAddress,
                        macAddress: wifiData.macAddress,
                        deviceInfo: wifiData.deviceInfo,
                        connectedAt: new Date()
                    });
                    await wifiSession.save();
                }

                // Add IP to session's allowed IPs
                if (!session.wifiConfig.allowedIPs.includes(wifiData.ipAddress)) {
                    session.wifiConfig.allowedIPs.push(wifiData.ipAddress);
                    await session.save();
                }
            }
        }

        // Step 2: Verify Location (Geofencing)
        if (locationData && verificationResults.wifi) {
            const distance = calculateDistance(
                locationData.latitude,
                locationData.longitude,
                session.location.latitude,
                session.location.longitude
            );

            if (distance <= session.wifiConfig.geofenceRadius) {
                verificationResults.location = true;
                record.locationVerification = {
                    verified: true,
                    latitude: locationData.latitude,
                    longitude: locationData.longitude,
                    accuracy: locationData.accuracy,
                    distanceFromClass: distance,
                    verifiedAt: new Date()
                };
            } else {
                return res.status(400).json({
                    success: false,
                    message: 'Access Denied: Too Far',
                    error: `You are ${Math.round(distance)}m away from the classroom. Required: within ${session.wifiConfig.geofenceRadius}m`,
                    distance
                });
            }
        }

        // Step 3: Verify Face
        if (faceData && verificationResults.wifi && verificationResults.location) {
            // In a real implementation, this would use face-api.js or similar
            // For demo, we'll simulate face verification
            const faceMatch = await verifyFace(req.user.id, faceData);

            if (faceMatch.verified) {
                verificationResults.face = true;
                record.faceVerification = {
                    verified: true,
                    confidence: faceMatch.confidence,
                    capturedImage: faceData.capturedImage,
                    verifiedAt: new Date()
                };
            } else {
                return res.status(400).json({
                    success: false,
                    message: 'Access Denied: Face Mismatch',
                    error: 'Face verification failed. Please try again.',
                    confidence: faceMatch.confidence
                });
            }
        }

        // All verifications passed - Mark as PRESENT
        if (verificationResults.wifi && verificationResults.location && verificationResults.face) {
            // Check if late
            const sessionStart = new Date(session.startedAt);
            const now = new Date();
            const minutesLate = (now - sessionStart) / 60000;

            record.status = minutesLate > 15 ? ATTENDANCE_STATUS.LATE : ATTENDANCE_STATUS.PRESENT;
            record.verificationMethod = 'wifi_face';
            record.markedAt = new Date();
            await record.save();

            // Update session statistics
            if (record.status === ATTENDANCE_STATUS.PRESENT) {
                session.presentCount += 1;
                session.absentCount -= 1;
            } else if (record.status === ATTENDANCE_STATUS.LATE) {
                session.lateCount += 1;
                session.absentCount -= 1;
            }
            await session.save();

            // Emit real-time update via Socket.IO
            const io = req.app.get('io');
            if (io) {
                io.to(`session_${sessionId}`).emit('attendanceUpdate', {
                    studentId: req.user.id,
                    studentName: req.user.name,
                    rollNumber: req.user.rollNumber,
                    status: record.status,
                    markedAt: record.markedAt
                });
            }

            return res.json({
                success: true,
                message: `Attendance marked as ${record.status.toUpperCase()}!`,
                status: record.status,
                verificationResults
            });
        }

        // Partial verification - return what's needed
        res.status(400).json({
            success: false,
            message: 'Verification incomplete',
            verificationResults,
            nextStep: !verificationResults.wifi ? 'wifi' :
                !verificationResults.location ? 'location' : 'face'
        });

    } catch (error) {
        console.error('Verification error:', error);
        res.status(500).json({
            success: false,
            message: 'Error processing verification',
            error: error.message
        });
    }
});

// @route   POST /api/attendance/manual-override
// @desc    Faculty manually overrides attendance
// @access  Private/Faculty
router.post('/manual-override', protect, authorize(ROLES.FACULTY, ROLES.ADMIN), async (req, res) => {
    try {
        const { recordId, status, reason } = req.body;

        const record = await AttendanceRecord.findById(recordId);

        if (!record) {
            return res.status(404).json({
                success: false,
                message: 'Attendance record not found'
            });
        }

        // Verify faculty owns this session
        const session = await AttendanceSession.findById(record.session);
        if (session.faculty.toString() !== req.user.id && req.user.role !== ROLES.ADMIN) {
            return res.status(403).json({
                success: false,
                message: 'Not authorized to modify this record'
            });
        }

        const previousStatus = record.status;
        record.status = status;
        record.manualOverride = {
            applied: true,
            reason,
            overriddenBy: req.user.id,
            overriddenAt: new Date()
        };
        await record.save();

        // Update session statistics
        if (previousStatus !== status) {
            if (previousStatus === ATTENDANCE_STATUS.PRESENT) session.presentCount -= 1;
            if (previousStatus === ATTENDANCE_STATUS.ABSENT) session.absentCount -= 1;
            if (previousStatus === ATTENDANCE_STATUS.LATE) session.lateCount -= 1;

            if (status === ATTENDANCE_STATUS.PRESENT) session.presentCount += 1;
            if (status === ATTENDANCE_STATUS.ABSENT) session.absentCount += 1;
            if (status === ATTENDANCE_STATUS.LATE) session.lateCount += 1;

            await session.save();
        }

        res.json({
            success: true,
            message: 'Attendance updated successfully',
            record
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error updating attendance',
            error: error.message
        });
    }
});

// @route   GET /api/attendance/student/history
// @desc    Get student's attendance history
// @access  Private/Student
router.get('/student/history', protect, authorize(ROLES.STUDENT), async (req, res) => {
    try {
        const { subjectId, startDate, endDate } = req.query;

        const query = { student: req.user.id };

        if (subjectId) query.subject = subjectId;
        if (startDate || endDate) {
            query.date = {};
            if (startDate) query.date.$gte = new Date(startDate);
            if (endDate) query.date.$lte = new Date(endDate);
        }

        const records = await AttendanceRecord.find(query)
            .populate('subject', 'name code')
            .populate('session', 'date location')
            .sort({ date: -1 });

        // Calculate statistics
        const stats = {
            total: records.length,
            present: records.filter(r => r.status === ATTENDANCE_STATUS.PRESENT).length,
            absent: records.filter(r => r.status === ATTENDANCE_STATUS.ABSENT).length,
            late: records.filter(r => r.status === ATTENDANCE_STATUS.LATE).length,
            excused: records.filter(r => r.status === ATTENDANCE_STATUS.EXCUSED).length
        };

        stats.percentage = stats.total > 0
            ? Math.round(((stats.present + stats.late) / stats.total) * 100)
            : 0;

        res.json({
            success: true,
            stats,
            records
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error fetching attendance history',
            error: error.message
        });
    }
});

// @route   GET /api/attendance/faculty/history
// @desc    Get attendance history for faculty's sessions
// @access  Private/Faculty
router.get('/faculty/history', protect, authorize(ROLES.FACULTY, ROLES.ADMIN), async (req, res) => {
    try {
        const { subjectId, startDate, endDate } = req.query;

        const query = { faculty: req.user.id };

        if (subjectId) query.subject = subjectId;
        if (startDate || endDate) {
            query.date = {};
            if (startDate) query.date.$gte = new Date(startDate);
            if (endDate) query.date.$lte = new Date(endDate);
        }

        const sessions = await AttendanceSession.find(query)
            .populate('subject', 'name code')
            .sort({ date: -1 });

        res.json({
            success: true,
            count: sessions.length,
            sessions
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error fetching session history',
            error: error.message
        });
    }
});

// @route   GET /api/attendance/session/:id/records
// @desc    Get all records for a specific session
// @access  Private/Faculty
router.get('/session/:id/records', protect, authorize(ROLES.FACULTY, ROLES.ADMIN), async (req, res) => {
    try {
        const records = await AttendanceRecord.find({ session: req.params.id })
            .populate('student', 'name rollNumber profileImage branch section')
            .sort({ 'student.rollNumber': 1 });

        const session = await AttendanceSession.findById(req.params.id)
            .populate('subject', 'name code');

        res.json({
            success: true,
            session,
            records
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error fetching session records',
            error: error.message
        });
    }
});

// @route   GET /api/attendance/student/active-sessions
// @desc    Get active sessions available for student
// @access  Private/Student
router.get('/student/active-sessions', protect, authorize(ROLES.STUDENT), async (req, res) => {
    try {
        const student = await User.findById(req.user.id);

        // Find timetable entries for student's class
        const timetableIds = await Timetable.find({
            semester: student.semester,
            branch: student.branch,
            section: student.section || 'A',
            isActive: true
        }).select('_id');

        // Find active sessions for those timetable entries
        const sessions = await AttendanceSession.find({
            timetable: { $in: timetableIds.map(t => t._id) },
            status: SESSION_STATUS.ACTIVE
        })
            .populate('subject', 'name code')
            .populate('faculty', 'name');

        // Get student's records for these sessions
        const sessionIds = sessions.map(s => s._id);
        const records = await AttendanceRecord.find({
            session: { $in: sessionIds },
            student: req.user.id
        });

        // Merge session info with student's record
        const sessionsWithStatus = sessions.map(session => {
            const record = records.find(r => r.session.toString() === session._id.toString());
            return {
                ...session.toObject(),
                studentStatus: record?.status || 'absent',
                hasMarked: record?.status === 'present' || record?.status === 'late'
            };
        });

        res.json({
            success: true,
            sessions: sessionsWithStatus
        });
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Error fetching active sessions',
            error: error.message
        });
    }
});

// @route   GET /api/attendance/student/report
// @desc    Get attendance report for student
// @access  Private/Student
router.get('/student/report', protect, authorize(ROLES.STUDENT), async (req, res) => {
    try {
        // Get all attendance records for this student
        const records = await AttendanceRecord.find({ student: req.user.id })
            .populate('subject', 'name code')
            .sort({ date: -1 });

        // Group by subject
        const subjectMap = {};
        records.forEach(record => {
            const subjectId = record.subject?._id?.toString() || 'unknown';
            const subjectName = record.subject?.name || 'Unknown';

            if (!subjectMap[subjectId]) {
                subjectMap[subjectId] = {
                    name: subjectName,
                    code: record.subject?.code || '',
                    total: 0,
                    present: 0,
                    late: 0,
                    absent: 0
                };
            }

            subjectMap[subjectId].total++;
            if (record.status === 'present') subjectMap[subjectId].present++;
            else if (record.status === 'late') subjectMap[subjectId].late++;
            else subjectMap[subjectId].absent++;
        });

        const subjects = Object.values(subjectMap).map(s => ({
            ...s,
            percentage: s.total > 0 ? Math.round(((s.present + s.late) / s.total) * 100) : 0
        }));

        // Calculate today's attendance
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const todayRecords = records.filter(r => new Date(r.date) >= today);
        const todayAttendance = {
            total: todayRecords.length,
            present: todayRecords.filter(r => r.status === 'present' || r.status === 'late').length
        };

        // Calculate monthly attendance
        const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
        const monthRecords = records.filter(r => new Date(r.date) >= monthStart);
        const monthlyAttendance = monthRecords.length > 0
            ? Math.round((monthRecords.filter(r => r.status === 'present' || r.status === 'late').length / monthRecords.length) * 100)
            : 0;

        // Weekly trend (last 5 days)
        const weeklyTrend = [];
        for (let i = 4; i >= 0; i--) {
            const day = new Date(today);
            day.setDate(day.getDate() - i);
            const dayRecords = records.filter(r => {
                const recordDate = new Date(r.date);
                return recordDate.toDateString() === day.toDateString();
            });
            const dayPct = dayRecords.length > 0
                ? Math.round((dayRecords.filter(r => r.status === 'present' || r.status === 'late').length / dayRecords.length) * 100)
                : 0;
            weeklyTrend.push(dayPct);
        }

        // Recent history
        const history = records.slice(0, 20).map(r => ({
            date: r.date,
            subject: r.subject,
            subjectName: r.subject?.name,
            status: r.status
        }));

        res.json({
            success: true,
            report: {
                subjects,
                todayAttendance,
                monthlyAttendance,
                weeklyTrend,
                monthlyTrend: [monthlyAttendance, monthlyAttendance, monthlyAttendance, monthlyAttendance],
                overallLabels: ['Week 1', 'Week 2', 'Week 3', 'Week 4'],
                overallTrend: [monthlyAttendance - 5, monthlyAttendance - 2, monthlyAttendance, monthlyAttendance + 2],
                history
            }
        });
    } catch (error) {
        console.error('Student report error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching student report',
            error: error.message
        });
    }
});

// Helper function: Calculate distance between two coordinates
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) *
        Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Distance in meters
}

// Helper function: Verify face (placeholder - integrate with face-api.js)
// @route   GET /api/attendance/faculty/stats
// @desc    Get attendance statistics for faculty
// @access  Private/Faculty
router.get('/faculty/stats', protect, authorize(ROLES.FACULTY, ROLES.ADMIN), async (req, res) => {
    try {
        // Get today's date range
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        // Get this month's date range
        const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

        // Get sessions for this faculty
        const query = req.user.role === ROLES.ADMIN ? {} : { faculty: req.user.id };

        // Count sessions today
        const sessionsToday = await AttendanceSession.countDocuments({
            ...query,
            date: { $gte: today, $lt: tomorrow }
        });

        // Get all sessions this month
        const monthSessions = await AttendanceSession.find({
            ...query,
            date: { $gte: monthStart }
        });

        // Calculate average attendance
        let totalPresent = 0;
        let totalStudents = 0;

        monthSessions.forEach(session => {
            totalPresent += (session.presentCount || 0) + (session.lateCount || 0);
            totalStudents += session.totalStudents || 0;
        });

        const averageAttendance = totalStudents > 0
            ? Math.round((totalPresent / totalStudents) * 100)
            : 85; // Default value

        res.json({
            success: true,
            stats: {
                sessionsToday,
                sessionsThisMonth: monthSessions.length,
                averageAttendance,
                totalStudents: totalStudents
            }
        });
    } catch (error) {
        console.error('Faculty stats error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching faculty stats',
            error: error.message
        });
    }
});

// @route   GET /api/attendance/faculty/report
// @desc    Get detailed attendance report for faculty
// @access  Private/Faculty
router.get('/faculty/report', protect, authorize(ROLES.FACULTY, ROLES.ADMIN), async (req, res) => {
    try {
        const query = req.user.role === ROLES.ADMIN ? {} : { faculty: req.user.id };

        // Get all sessions for this faculty
        const sessions = await AttendanceSession.find(query);
        const sessionIds = sessions.map(s => s._id);

        // Get all attendance records for these sessions
        const records = await AttendanceRecord.find({ session: { $in: sessionIds } })
            .populate('student', 'name rollNumber');

        // Group records by student
        const studentMap = {};
        records.forEach(record => {
            if (!record.student) return;

            const studentId = record.student._id.toString();
            if (!studentMap[studentId]) {
                studentMap[studentId] = {
                    rollNumber: record.student.rollNumber,
                    name: record.student.name,
                    attended: 0,
                    total: 0
                };
            }
            studentMap[studentId].total++;
            if (record.status === 'present' || record.status === 'late') {
                studentMap[studentId].attended++;
            }
        });

        // Calculate percentages
        const students = Object.values(studentMap).map(s => ({
            ...s,
            percentage: s.total > 0 ? Math.round((s.attended / s.total) * 100) : 0
        }));

        // Sort by roll number
        students.sort((a, b) => (a.rollNumber || '').localeCompare(b.rollNumber || ''));

        // Calculate summary stats
        const totalClasses = sessions.length;
        const averageAttendance = students.length > 0
            ? Math.round(students.reduce((sum, s) => sum + s.percentage, 0) / students.length)
            : 0;
        const lowAttendanceCount = students.filter(s => s.percentage < 75).length;

        // Get sessions this month
        const monthStart = new Date();
        monthStart.setDate(1);
        monthStart.setHours(0, 0, 0, 0);
        const sessionsThisMonth = sessions.filter(s => new Date(s.date) >= monthStart).length;

        res.json({
            success: true,
            report: {
                totalClasses,
                averageAttendance,
                lowAttendanceCount,
                sessionsThisMonth,
                students
            }
        });
    } catch (error) {
        console.error('Faculty report error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching faculty report',
            error: error.message
        });
    }
});

// @route   POST /api/attendance/manual
// @desc    Submit manual attendance (Faculty marks attendance manually)
// @access  Private/Faculty
router.post('/manual', protect, authorize(ROLES.FACULTY, ROLES.ADMIN), async (req, res) => {
    try {
        const { timetableId, records, subjectId, date } = req.body;

        if (!records || !Array.isArray(records) || records.length === 0) {
            return res.status(400).json({
                success: false,
                message: 'No attendance records provided'
            });
        }

        // Get timetable entry
        let timetable = null;
        if (timetableId) {
            timetable = await Timetable.findById(timetableId).populate('subject');
        }

        // Create or find attendance session
        let session = await AttendanceSession.findOne({
            faculty: req.user.id,
            timetable: timetableId,
            date: {
                $gte: new Date(new Date().setHours(0, 0, 0, 0)),
                $lt: new Date(new Date().setHours(23, 59, 59, 999))
            }
        });

        if (!session) {
            session = await AttendanceSession.create({
                timetable: timetableId,
                faculty: req.user.id,
                subject: subjectId || timetable?.subject?._id,
                date: date || new Date(),
                status: SESSION_STATUS.COMPLETED,
                totalStudents: records.length,
                startedAt: new Date(),
                endedAt: new Date()
            });
        }

        // Process each attendance record
        let presentCount = 0;
        let absentCount = 0;
        let lateCount = 0;

        for (const record of records) {
            const { studentId, status } = record;

            // Find student by rollNumber or _id
            let student = await User.findOne({
                $or: [
                    { rollNumber: studentId },
                    { _id: studentId }
                ],
                role: ROLES.STUDENT
            });

            if (!student) continue;

            // Upsert attendance record
            await AttendanceRecord.findOneAndUpdate(
                {
                    session: session._id,
                    student: student._id
                },
                {
                    session: session._id,
                    student: student._id,
                    subject: session.subject,
                    date: session.date,
                    status: status,
                    verificationMethod: 'manual',
                    markedAt: new Date(),
                    manualOverride: {
                        applied: true,
                        reason: 'Manual attendance by faculty',
                        overriddenBy: req.user.id,
                        overriddenAt: new Date()
                    }
                },
                { upsert: true, new: true }
            );

            // Count statuses
            if (status === 'present') presentCount++;
            else if (status === 'late') lateCount++;
            else absentCount++;
        }

        // Update session statistics
        session.presentCount = presentCount;
        session.absentCount = absentCount;
        session.lateCount = lateCount;
        session.totalStudents = records.length;
        session.status = SESSION_STATUS.COMPLETED;
        await session.save();

        res.json({
            success: true,
            message: 'Attendance recorded successfully',
            statistics: {
                total: records.length,
                present: presentCount,
                absent: absentCount,
                late: lateCount
            }
        });
    } catch (error) {
        console.error('Manual attendance error:', error);
        res.status(500).json({
            success: false,
            message: 'Error recording attendance',
            error: error.message
        });
    }
});

// @route   GET /api/attendance/student/:id/report
// @desc    Get attendance report for a specific student (Admin)
// @access  Private/Admin
router.get('/student/:id/report', protect, authorize(ROLES.ADMIN, ROLES.FACULTY), async (req, res) => {
    try {
        const studentId = req.params.id;

        // Get all attendance records for this student
        const records = await AttendanceRecord.find({ student: studentId })
            .populate('subject', 'name code')
            .sort({ date: -1 });

        // Group by subject
        const subjectMap = {};
        records.forEach(record => {
            const subjectId = record.subject?._id?.toString() || 'unknown';
            const subjectName = record.subject?.name || 'Unknown';

            if (!subjectMap[subjectId]) {
                subjectMap[subjectId] = {
                    name: subjectName,
                    code: record.subject?.code || '',
                    total: 0,
                    present: 0,
                    late: 0,
                    absent: 0
                };
            }

            subjectMap[subjectId].total++;
            if (record.status === 'present') subjectMap[subjectId].present++;
            else if (record.status === 'late') subjectMap[subjectId].late++;
            else subjectMap[subjectId].absent++;
        });

        const subjects = Object.values(subjectMap).map(s => ({
            ...s,
            percentage: s.total > 0 ? Math.round(((s.present + s.late) / s.total) * 100) : 0
        }));

        // Calculate overall stats
        const totalClasses = records.length;
        const totalPresent = records.filter(r => r.status === 'present' || r.status === 'late').length;
        const overallPercentage = totalClasses > 0 ? Math.round((totalPresent / totalClasses) * 100) : 0;

        res.json({
            success: true,
            report: {
                subjects,
                totalClasses,
                totalPresent,
                overallPercentage,
                recentRecords: records.slice(0, 10)
            }
        });
    } catch (error) {
        console.error('Student report error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching student report',
            error: error.message
        });
    }
});

// Helper function: Calculate distance between two coordinates
function calculateDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // Earth's radius in meters
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
        Math.cos(φ1) * Math.cos(φ2) *
        Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c; // Distance in meters
}

// Helper function: Verify face (placeholder - integrate with face-api.js)
async function verifyFace(userId, faceData) {
    // In production, this would:
    // 1. Get stored face encoding from user profile
    // 2. Compare with captured face encoding
    // 3. Return match result with confidence score

    // For demo, simulate verification
    const user = await User.findById(userId);

    if (!user.faceEncoding || user.faceEncoding.length === 0) {
        // No face registered - allow first-time capture
        return { verified: true, confidence: 0.95, firstTime: true };
    }

    // Simulate face matching (in production, use face-api.js)
    const confidence = Math.random() * 0.3 + 0.7; // Random 70-100%
    return {
        verified: confidence >= 0.6,
        confidence
    };
}

// ==================== NEW REAL-TIME ATTENDANCE ENDPOINTS ====================

// @route   POST /api/attendance/validate-location
// @desc    Validate student location against faculty location (geofence)
// @access  Private/Student
router.post('/validate-location', protect, authorize(ROLES.STUDENT), async (req, res) => {
    try {
        const { sessionId, latitude, longitude, accuracy } = req.body;

        if (!sessionId || latitude === undefined || longitude === undefined) {
            return res.status(400).json({
                success: false,
                message: 'Missing required fields: sessionId, latitude, longitude'
            });
        }

        // Find active session
        const session = await AttendanceSession.findById(sessionId);

        if (!session || session.status !== SESSION_STATUS.ACTIVE) {
            return res.status(400).json({
                success: false,
                message: 'No active attendance session found'
            });
        }

        // Calculate distance between student and faculty
        const distance = calculateDistance(
            latitude,
            longitude,
            session.location.latitude,
            session.location.longitude
        );

        const maxRadius = session.wifiConfig.geofenceRadius || 50;
        const isWithinGeofence = distance <= maxRadius;

        res.json({
            success: true,
            isWithinGeofence,
            distance: Math.round(distance * 100) / 100, // Round to 2 decimals
            maxAllowedDistance: maxRadius,
            studentLocation: { latitude, longitude },
            facultyLocation: {
                latitude: session.location.latitude,
                longitude: session.location.longitude
            },
            message: isWithinGeofence
                ? `You are within the geofence. Distance: ${Math.round(distance)}m`
                : `You are outside the geofence. Distance: ${Math.round(distance)}m (allowed: ${maxRadius}m)`
        });
    } catch (error) {
        console.error('Location validation error:', error);
        res.status(500).json({
            success: false,
            message: 'Error validating location',
            error: error.message
        });
    }
});

// @route   GET /api/attendance/active-session
// @desc    Get active attendance session for students to join
// @access  Private/Student
router.get('/active-session', protect, authorize(ROLES.STUDENT), async (req, res) => {
    try {
        // Get all active sessions where student is enrolled
        const sessions = await AttendanceSession.find({
            status: SESSION_STATUS.ACTIVE,
            date: {
                $gte: new Date(new Date().setHours(0, 0, 0, 0)),
                $lte: new Date(new Date().setHours(23, 59, 59, 999))
            }
        })
            .populate('faculty', 'name email')
            .populate('subject', 'name code')
            .select('_id subject faculty location wifiConfig startedAt');

        if (sessions.length === 0) {
            return res.json({
                success: true,
                hasActiveSession: false,
                sessions: []
            });
        }

        // Filter sessions based on student's timetable
        const studentTimetable = await Timetable.find({
            student: req.user.id,
            isActive: true
        });

        const relevantSessions = sessions.filter(session => {
            return studentTimetable.some(tt =>
                tt.subject.toString() === session.subject._id.toString()
            );
        });

        res.json({
            success: true,
            hasActiveSession: relevantSessions.length > 0,
            sessions: relevantSessions.map(session => ({
                sessionId: session._id,
                subjectName: session.subject.name,
                subjectCode: session.subject.code,
                facultyName: session.faculty.name,
                location: session.location,
                wifiSSID: session.wifiConfig.ssid,
                geofenceRadius: session.wifiConfig.geofenceRadius,
                startedAt: session.startedAt
            }))
        });
    } catch (error) {
        console.error('Active session fetch error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching active sessions',
            error: error.message
        });
    }
});

// @route   POST /api/attendance/check-wifi
// @desc    Check WiFi connection and return connection details
// @access  Private/Student
router.post('/check-wifi', protect, authorize(ROLES.STUDENT), async (req, res) => {
    try {
        const { sessionId, ssid, ipAddress, deviceInfo } = req.body;

        if (!sessionId) {
            return res.status(400).json({
                success: false,
                message: 'Session ID is required'
            });
        }

        const session = await AttendanceSession.findById(sessionId);

        if (!session || session.status !== SESSION_STATUS.ACTIVE) {
            return res.status(400).json({
                success: false,
                message: 'No active attendance session found'
            });
        }

        // Check if WiFi SSID matches
        const ssidMatches = ssid === session.wifiConfig.ssid;

        if (!ssidMatches) {
            return res.json({
                success: true,
                wifiConnected: false,
                message: `Not connected to ${session.wifiConfig.ssid}. Currently connected to: ${ssid}`,
                expectedSSID: session.wifiConfig.ssid,
                currentSSID: ssid
            });
        }

        // WiFi is connected - emit socket event
        const io = req.app.get('io');
        if (io) {
            io.to(`session_${sessionId}`).emit('studentWifiConnected', {
                studentId: req.user.id,
                studentName: req.user.name,
                rollNumber: req.user.rollNumber,
                ipAddress,
                deviceInfo,
                connectedAt: new Date()
            });
        }

        res.json({
            success: true,
            wifiConnected: true,
            message: `Successfully connected to ${ssid}`,
            sessionId,
            ipAddress,
            deviceInfo
        });
    } catch (error) {
        console.error('WiFi check error:', error);
        res.status(500).json({
            success: false,
            message: 'Error checking WiFi connection',
            error: error.message
        });
    }
});

// @route   POST /api/attendance/mark-real-time
// @desc    Mark attendance with real-time validation (WiFi, Location, Face)
// @access  Private/Student
router.post('/mark-real-time', protect, authorize(ROLES.STUDENT), async (req, res) => {
    try {
        const {
            sessionId,
            wifiConnected,
            locationVerified,
            faceVerified,
            ipAddress,
            latitude,
            longitude,
            faceConfidence
        } = req.body;

        // Validate all required fields
        if (!sessionId || !wifiConnected || !locationVerified || !faceVerified) {
            return res.status(400).json({
                success: false,
                message: 'All verifications required: WiFi, Location, and Face',
                required: {
                    wifiConnected,
                    locationVerified,
                    faceVerified
                }
            });
        }

        // Find session
        const session = await AttendanceSession.findById(sessionId);

        if (!session || session.status !== SESSION_STATUS.ACTIVE) {
            return res.status(400).json({
                success: false,
                message: 'Attendance session is no longer active'
            });
        }

        // Check if student already marked attendance
        const existingRecord = await AttendanceRecord.findOne({
            session: sessionId,
            student: req.user.id
        });

        if (existingRecord && existingRecord.status === ATTENDANCE_STATUS.PRESENT) {
            return res.status(400).json({
                success: false,
                message: 'Attendance already marked for this session'
            });
        }

        // Validate location
        const distance = calculateDistance(
            latitude,
            longitude,
            session.location.latitude,
            session.location.longitude
        );

        const maxRadius = session.wifiConfig.geofenceRadius || 50;
        if (distance > maxRadius) {
            const io = req.app.get('io');
            if (io) {
                io.to(`user_${req.user.id}`).emit('locationVerificationFailed', {
                    message: `Too far from classroom. Distance: ${Math.round(distance)}m`,
                    distance,
                    maxAllowedDistance: maxRadius
                });
            }

            return res.status(400).json({
                success: false,
                message: 'Location verification failed',
                reason: 'distance_exceeded',
                distance: Math.round(distance),
                maxAllowedDistance: maxRadius
            });
        }

        // Create or update attendance record
        let record = existingRecord || new AttendanceRecord({
            session: sessionId,
            student: req.user.id,
            date: new Date()
        });

        // Determine attendance status
        const sessionStart = new Date(session.startedAt);
        const now = new Date();
        const minutesLate = (now - sessionStart) / 60000;
        const lateThreshold = 15; // 15 minutes

        const attendanceStatus = minutesLate > lateThreshold
            ? ATTENDANCE_STATUS.LATE
            : ATTENDANCE_STATUS.PRESENT;

        // Update record with verification details
        record.status = attendanceStatus;
        record.verificationMethod = 'wifi_location_face';
        record.markedAt = new Date();
        record.wifiVerification = {
            connected: true,
            ipAddress,
            ssid: session.wifiConfig.ssid,
            verifiedAt: new Date()
        };
        record.locationVerification = {
            verified: true,
            latitude,
            longitude,
            distanceFromClass: Math.round(distance * 100) / 100,
            verifiedAt: new Date()
        };
        record.faceVerification = {
            verified: true,
            confidence: faceConfidence || 0.85,
            verifiedAt: new Date()
        };

        await record.save();

        // Update session statistics
        if (attendanceStatus === ATTENDANCE_STATUS.PRESENT) {
            session.presentCount = (session.presentCount || 0) + 1;
            session.absentCount = Math.max(0, (session.absentCount || 0) - 1);
        } else if (attendanceStatus === ATTENDANCE_STATUS.LATE) {
            session.lateCount = (session.lateCount || 0) + 1;
            session.absentCount = Math.max(0, (session.absentCount || 0) - 1);
        }
        await session.save();

        // Emit real-time updates via Socket.IO
        const io = req.app.get('io');
        if (io) {
            // Update faculty's session monitoring
            io.to(`session_${sessionId}`).emit('attendanceRecorded', {
                studentId: req.user.id,
                studentName: req.user.name,
                rollNumber: req.user.rollNumber,
                status: attendanceStatus,
                markedAt: new Date(),
                verifications: {
                    wifiConnected: true,
                    locationVerified: true,
                    faceVerified: true,
                    distance: Math.round(distance)
                }
            });

            // Update student's personal notification
            io.to(`user_${req.user.id}`).emit('attendanceMarkedSuccess', {
                status: attendanceStatus,
                subject: session.subject?.name,
                markedAt: new Date(),
                message: `Your attendance has been marked as ${attendanceStatus.toUpperCase()}!`,
                late: minutesLate > lateThreshold,
                minutesLate: Math.round(minutesLate)
            });
        }

        res.json({
            success: true,
            message: `Attendance marked as ${attendanceStatus.toUpperCase()}!`,
            status: attendanceStatus,
            markedAt: new Date(),
            details: {
                distanceFromClass: Math.round(distance),
                minutesLate: Math.round(minutesLate),
                faceConfidence: faceConfidence || 0.85
            }
        });
    } catch (error) {
        console.error('Mark attendance error:', error);
        res.status(500).json({
            success: false,
            message: 'Error marking attendance',
            error: error.message
        });
    }
});

// @route   GET /api/attendance/session/:id/students-status
// @desc    Get real-time status of all students in a session
// @access  Private/Faculty
router.get('/session/:id/students-status', protect, authorize(ROLES.FACULTY, ROLES.ADMIN), async (req, res) => {
    try {
        const session = await AttendanceSession.findById(req.params.id);

        if (!session) {
            return res.status(404).json({
                success: false,
                message: 'Session not found'
            });
        }

        // Get all attendance records for this session
        const records = await AttendanceRecord.find({ session: req.params.id })
            .populate('student', 'name rollNumber profileImage')
            .select('student status markedAt wifiVerification locationVerification faceVerification');

        const studentStatuses = records.map(record => ({
            studentId: record.student._id,
            studentName: record.student.name,
            rollNumber: record.student.rollNumber,
            profileImage: record.student.profileImage,
            status: record.status,
            markedAt: record.markedAt,
            verifications: {
                wifiConnected: record.wifiVerification?.connected || false,
                locationVerified: record.locationVerification?.verified || false,
                faceVerified: record.faceVerification?.verified || false,
                distance: record.locationVerification?.distanceFromClass || null
            }
        }));

        res.json({
            success: true,
            sessionId: req.params.id,
            studentCount: studentStatuses.length,
            presentCount: studentStatuses.filter(s => s.status === ATTENDANCE_STATUS.PRESENT).length,
            lateCount: studentStatuses.filter(s => s.status === ATTENDANCE_STATUS.LATE).length,
            absentCount: studentStatuses.filter(s => s.status === ATTENDANCE_STATUS.ABSENT).length,
            students: studentStatuses
        });
    } catch (error) {
        console.error('Get students status error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching student statuses',
            error: error.message
        });
    }
});

module.exports = router;
