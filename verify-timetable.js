const mongoose = require('mongoose');
const Timetable = require('./server/models/Timetable');
require('dotenv').config();

async function verifyTimetable() {
    try {
        await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/codex');
        console.log('Connected to MongoDB\n');

        // Check all timetable entries
        const allEntries = await Timetable.find({}).sort({ day: 1, startTime: 1 });
        console.log('=== ALL TIMETABLE ENTRIES ===\n');
        
        const byDay = {};
        allEntries.forEach(e => {
            if (!byDay[e.day]) byDay[e.day] = [];
            byDay[e.day].push(e);
        });
        
        Object.keys(byDay).sort().forEach(day => {
            console.log(`\n📅 ${day.toUpperCase()}:`);
            byDay[day].forEach(e => {
                console.log(`   ${e.startTime}-${e.endTime} | ${e.subjectName} | Batch: ${e.batch} | Type: ${e.type}`);
            });
        });
        
        console.log(`\n✓ Total entries: ${allEntries.length}`);
        console.log('\n✓ Timetable is ready for display in:');
        console.log('  - Admin Panel: /pages/admin-dashboard.html');
        console.log('  - Faculty Panel: /pages/faculty-dashboard.html');
        console.log('  - Student Panel: /pages/student-dashboard.html');
        
        process.exit(0);
    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
}

verifyTimetable();
