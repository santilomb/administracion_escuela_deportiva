// =====================================================================
// MAIN ENTRY POINT (app.js) - Refactored ES6 Modules
// =====================================================================
import { auth } from './firebase/init.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';

import { initAuth } from './core/auth.js';
import { initRouter, navigate } from './core/router.js';

import { initStudents, loadStudents } from './modules/students.js';
import { initActivities, loadActivities } from './modules/activities.js';
import { initEnrollments } from './modules/enrollments.js';
import { initAttendance } from './modules/attendance.js';
import { initPayments } from './modules/payments.js';
import { initDashboard } from './modules/dashboard.js';
import { initReports } from './modules/reports.js';
import { initStaff, loadStaff } from './modules/staff.js';
import { initUsers } from './modules/users.js';

import { } from './utils/pdf-generator.js'; // Ensure jsPDF is ready

document.addEventListener('DOMContentLoaded', () => {
    // 1. Initialize Routes & Listeners
    initRouter();
    
    // 2. Initialize Core Features
    initAuth();

    // 3. Initialize Domain Modules
    initDashboard();
    initStudents();
    initActivities();
    initEnrollments();
    initAttendance();
    initPayments();
    initReports();
    initStaff();
    initUsers();

    // 4. Global Data Loader Export (Used by Auth upon successful sign-in)
    window.loadAllData = async () => {
        // Run loaders in parallel for maximum performance
        await Promise.all([
            loadStudents(),
            loadActivities(),
            loadStaff()
        ]);
    };

    // 5. Authentication workflow is started automatically inside initAuth() via onAuthStateChanged
    
    // Provide a global window function if needed temporarily for inline handlers still present (until phase 3 HTML cleanup)
    window.navigate = navigate;
});
