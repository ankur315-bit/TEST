const mongoose = require('mongoose');
const Timetable = require('./server/models/Timetable');
const User = require('./server/models/User');
require('dotenv').config();

const timetableData = [
    // Sunday Schedule for CSE3 3A
    {
        day: 'sunday',
        startTime: '11:00',
        endTime: '12:00',
        subjectName: 'Data Structures & Algorithms',
        facultyName: 'Prof. K. P',
        department: 'CSE',
        batch: 'CSE3-3A',
        classSection: 'CSE3-3A',
        room: 'LH-101',
        type: 'lecture',
        semester: 3,
        branch: 'CSE',
        section: '3A'
    },
    {
        day: 'sunday',
        startTime: '12:00',
        endTime: '13:00',
        subjectName: 'Digital Logic & Circuits',
        facultyName: 'Dr. Amit Patel',
        department: 'Electronics',
        batch: 'CSE3-3A',
        classSection: 'CSE3-3A',
        room: 'LH-102',
        type: 'lecture',
        semester: 3,
        branch: 'CSE',
        section: '3A'
    },
    {
        day: 'sunday',
        startTime: '13:00',
        endTime: '14:00',
        subjectName: 'Lunch Break',
        facultyName: 'N/A',
        department: 'N/A',
        batch: 'CSE3-3A',
        classSection: 'CSE3-3A',
        room: 'Cafeteria',
        type: 'lecture',
        semester: 3,
        branch: 'CSE',
        section: '3A'
    },
    {
        day: 'sunday',
        startTime: '14:00',
        endTime: '15:00',
        subjectName: 'Database Management Systems',
        facultyName: 'Prof. Priya Sharma',
        department: 'Computer Science',
        batch: 'CSE3-3A',
        classSection: 'CSE3-3A',
        room: 'LH-103',
        type: 'lecture',
        semester: 3,
        branch: 'CSE',
        section: '3A'
    },
    {
        day: 'sunday',
        startTime: '15:00',
        endTime: '16:00',
        subjectName: 'Operating Systems',
        facultyName: 'Prof. Xyz',
        department: 'CSE',
        batch: 'CSE3-3A',
        classSection: 'CSE3-3A',
        room: 'LH-104',
        type: 'lecture',
        semester: 3,
        branch: 'CSE',
        section: '3A'
    },
    {
        day: 'sunday',
        startTime: '16:00',
        endTime: '17:00',
        subjectName: 'Lab / Practical Session',
        facultyName: 'Prof. K. P',
        department: 'CSE',
        batch: 'CSE3-3A',
        classSection: 'CSE3-3A',
        room: 'LAB-01',
        type: 'lab',
        semester: 3,
        branch: 'CSE',
        section: '3A'
    }
];

async function updateTimetable() {
    try {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/codex');
        console.log('Connected to MongoDB');

        // Clear existing Sunday timetable entries for CSE3-3A
        const deleteResult = await Timetable.deleteMany({ day: 'sunday', batch: 'CSE3-3A' });
        console.log(`Deleted ${deleteResult.deletedCount} existing Sunday entries for CSE3-3A`);

        // Insert new timetable entries
        const created = await Timetable.insertMany(timetableData);
        console.log(`Successfully created ${created.length} timetable entries`);

        // Display what was created
        console.log('\n--- Created Timetable Entries ---');
        created.forEach(entry => {
            console.log(`${entry.day.toUpperCase()} | ${entry.startTime}-${entry.endTime} | ${entry.subjectName} | ${entry.batch}`);
        });

        console.log('\nTimetable updated successfully for CSE3-3A!');
        process.exit(0);
    } catch (error) {
        console.error('Error updating timetable:', error);
        process.exit(1);
    }
}

updateTimetable();
