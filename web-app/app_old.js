// ============================================================
// CASTA — Escuela Deportiva Web App
// Firebase JS SDK v9 (modular) — ES Module
// ============================================================

import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
    getAuth, GoogleAuthProvider, signInWithPopup,
    onAuthStateChanged, signOut as firebaseSignOut
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
    getFirestore,
    collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
    query, where, orderBy, limit, onSnapshot, writeBatch,
    serverTimestamp, Timestamp, runTransaction
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';

// ============================================================
// FIREBASE CONFIG
// ============================================================

import { firebaseConfig } from './config.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// ============================================================
// STATE
// ============================================================
let currentUser = null;
let currentRole = 'prof';
let students = [];       // cached
let activities = [];       // cached
let studentsUnsub = null;
let activitiesUnsub = null;
let attendanceUnsub = null;

// ============================================================
// UTILS
// ============================================================
const $ = id => document.getElementById(id);

function showToast(msg, type = '') {
    const t = $('toast');
    t.textContent = msg;
    t.className = `toast${type ? ' ' + type : ''}`;
    t.classList.remove('hidden');
    setTimeout(() => t.classList.add('hidden'), 3000);
}

function showLoading() { $('loading-overlay').classList.remove('hidden'); }
function hideLoading() { $('loading-overlay').classList.add('hidden'); }

function openModal(id) { $(id).classList.remove('hidden'); document.body.style.overflow = 'hidden'; }
function closeModal(id) { $(id).classList.add('hidden'); document.body.style.overflow = ''; }
window.closeModal = closeModal;
window.closeModalOnOverlay = (e, id) => { if (e.target.classList.contains('modal-overlay')) closeModal(id); };

function formatCurrency(n) {
    return new Intl.NumberFormat('es-AR', { style: 'currency', currency: 'ARS', maximumFractionDigits: 0 }).format(n);
}

function nowMonthKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// Generate YYYY-MM keys from startDate to endDate (inclusive)
function activityMonthKeys(activity) {
    const year = new Date().getFullYear();
    // Parse stored dates — can be 'YYYY-MM-DD' string or Firestore Timestamp
    const parseDate = (v, defaultDate) => {
        if (!v) return defaultDate;
        if (v.toDate) return v.toDate();
        const d = new Date(v);
        return isNaN(d) ? defaultDate : d;
    };
    const start = parseDate(activity.startDate, new Date(year, 2, 1));   // Mar 1
    const end = parseDate(activity.endDate, new Date(year, 11, 31)); // Dec 31

    const keys = [];
    let cur = new Date(start.getFullYear(), start.getMonth(), 1);
    const endMon = new Date(end.getFullYear(), end.getMonth(), 1);
    while (cur <= endMon) {
        keys.push(`${cur.getFullYear()}-${String(cur.getMonth() + 1).padStart(2, '0')}`);
        cur.setMonth(cur.getMonth() + 1);
    }
    return keys;
}

function recentMonthKeys(count = 6) {
    const months = [];
    const d = new Date();
    for (let i = 0; i < count; i++) {
        months.unshift(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
        d.setMonth(d.getMonth() - 1);
    }
    return months;
}

// Reads & atomically increments the receipt counter in Firestore.
// Returns a string like 'CASTA-000042'.
// Uses runTransaction \u2014 safe even if two users pay at the same time.
async function getNextReceiptNumber() {
    const counterRef = doc(db, 'counters', 'receiptCounter');
    let nextNumber = 1;
    await runTransaction(db, async (tx) => {
        const snap = await tx.get(counterRef);
        if (snap.exists()) {
            nextNumber = (snap.data().lastNumber || 0) + 1;
        }
        tx.set(counterRef, { lastNumber: nextNumber }, { merge: true });
    });
    return `CASTA-${String(nextNumber).padStart(6, '0')}`;
}


function monthKeyToLabel(key) {
    const [y, m] = key.split('-');
    const d = new Date(+y, +m - 1, 1);
    return d.toLocaleString('es-AR', { month: 'long', year: 'numeric' });
}

function escHtml(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const DAY_NAMES = { 1: 'Lun', 2: 'Mar', 3: 'Mié', 4: 'Jue', 5: 'Vie' };
const DAY_FULL = { 1: 'Lunes', 2: 'Martes', 3: 'Miércoles', 4: 'Jueves', 5: 'Viernes' };

function daysLabel(days) {
    return days.map(d => DAY_NAMES[d] || d).join(' · ');
}

function initials(first, last) {
    return ((first[0] || '') + (last[0] || '')).toUpperCase();
}

function todayWeekday() {
    // 1=Mon ... 5=Fri, 6=Sat, 7=Sun (JS: 0=Sun, 1=Mon...)
    const d = new Date().getDay();
    return d === 0 ? 7 : d;
}

function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function canEdit() { return currentRole === 'admin'; }

// ============================================================
// NAVIGATION
// ============================================================
let currentPage = 'dashboard';

function navigate(page) {
    // Hide all pages
    document.querySelectorAll('.page').forEach(p => {
        p.classList.remove('active');
        p.classList.add('hidden');
    });
    // Show target
    const target = $(`page-${page}`);
    if (target) {
        target.classList.remove('hidden');
        target.classList.add('active');
    }
    // Update nav items
    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.page === page);
    });
    // Update topbar title
    const titles = {
        dashboard: 'Dashboard', students: 'Alumnos', activities: 'Actividades',
        attendance: 'Asistencia', payments: 'Pagos', exports: 'Listados', users: 'Usuarios'
    };
    $('topbar-page-title').textContent = titles[page] || 'Escuela Deportiva CASTA';
    currentPage = page;
    closeSidebar();

    // Load data for page
    if (page === 'dashboard') renderDashboard();
    if (page === 'students') renderStudentsList();
    if (page === 'activities') renderActivitiesList();
    if (page === 'attendance') initAttendancePage();
    if (page === 'payments') initPaymentsPage();
    if (page === 'exports') setTimeout(() => initListados(), 50);
    if (page === 'users') renderUsersPage();
}
window.navigate = navigate;

// Navigate to attendance and pre-select a given activity + current month
function navigateToAttendance(actId) {
    navigate('attendance');
    // After initAttendancePage runs, override the select values and load the grid
    requestAnimationFrame(() => {
        const actSel = $('attendance-activity-select');
        const monSel = $('attendance-month-select');
        if (actSel) actSel.value = actId;
        if (monSel) monSel.value = nowMonthKey();
        loadAttendanceGrid();
    });
}
window.navigateToAttendance = navigateToAttendance;

function toggleSidebar() {
    $('sidebar').classList.toggle('open');
}
function closeSidebar() {
    $('sidebar').classList.remove('open');
}
function handleSidebarClick(e) {
    if (e.target.classList.contains('sidebar-overlay')) closeSidebar();
}
window.toggleSidebar = toggleSidebar;
window.closeSidebar = closeSidebar;
window.handleSidebarClick = handleSidebarClick;

// ============================================================
// AUTH
// ============================================================
async function signInWithGoogle() {
    const btn = $('btn-google-login');
    const err = $('login-error');
    btn.disabled = true;
    btn.textContent = 'Iniciando sesión...';
    err.classList.add('hidden');
    try {
        const provider = new GoogleAuthProvider();
        await signInWithPopup(auth, provider);
    } catch (e) {
        err.textContent = 'Error al iniciar sesión: ' + (e.message || 'Inténtalo de nuevo');
        err.classList.remove('hidden');
        btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>Iniciar sesión con Google`;
        btn.disabled = false;
    }
}
window.signInWithGoogle = signInWithGoogle;

async function signOut() {
    if (!confirm('¿Cerrar sesión?')) return;
    await firebaseSignOut(auth);
}
window.signOut = signOut;

function showLoginError(msg) {
    $('screen-login').classList.remove('hidden');
    $('screen-login').classList.add('active');
    $('screen-app').classList.add('hidden');
    $('screen-app').classList.remove('active');
    const errEl = $('login-error');
    errEl.textContent = msg;
    errEl.classList.remove('hidden');
    const btn = $('btn-google-login');
    btn.disabled = false;
    btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>Iniciar sesión con Google`;
}

onAuthStateChanged(auth, async (user) => {
    if (user) {
        currentUser = user;

        // Load or create user doc in Firestore
        try {
            const userRef = doc(db, 'users', user.uid);
            const uSnap = await getDoc(userRef);

            if (!uSnap.exists()) {
                // First-ever login: check if there's a pending invite for this email
                const grantedRole = window._checkAndAcceptInvite ? await window._checkAndAcceptInvite(user) : null;

                // Create user doc (role from invite or default prof+inactive)
                await setDoc(userRef, {
                    uid: user.uid,
                    email: user.email || '',
                    displayName: user.displayName || '',
                    photoURL: user.photoURL || '',
                    role: grantedRole || 'prof',
                    active: grantedRole ? true : false,
                    createdAt: serverTimestamp(),
                });

                if (!grantedRole) {
                    showLoginError('Tu cuenta fue creada pero NO está activa. Un administrador debe habilitarla.');
                    await firebaseSignOut(auth);
                    return;
                }
                // Invited admin: reload the fresh doc and continue
                const freshSnap = await getDoc(userRef);
                const freshData = freshSnap.data();
                currentRole = freshData.role || 'admin';
                if (syncUsersNavVisibility) syncUsersNavVisibility();
                // Fall through to show app
            } else {
                const data = uSnap.data();

                // Update display info on every login
                await setDoc(userRef, {
                    displayName: user.displayName || data.displayName || '',
                    photoURL: user.photoURL || data.photoURL || '',
                    lastLoginAt: serverTimestamp(),
                }, { merge: true });

                if (!data.active) {
                    showLoginError('Tu cuenta no está activa. Contactá al administrador.');
                    await firebaseSignOut(auth);
                    return;
                }

                currentRole = data.role || 'prof';
                syncUsersNavVisibility();
            } // end else (existing user)

        } catch (e) {
            console.warn('Could not load user doc:', e.message);
            // Proceed as prof if Firestore read fails (rules may be blocking)
            currentRole = 'prof';
        }

        // Update UI
        const av = $('user-avatar');
        if (user.photoURL) {
            av.innerHTML = `<img src="${user.photoURL}" alt="">`;
        } else {
            av.textContent = initials(user.displayName?.split(' ')[0] || 'U', user.displayName?.split(' ')[1] || '');
        }
        av.title = user.displayName || '';
        $('sidebar-user-info').textContent = user.email || '';

        // Show app
        $('screen-login').classList.add('hidden');
        $('screen-login').classList.remove('active');
        $('screen-app').classList.remove('hidden');
        $('screen-app').classList.add('active');

        // Load data into cache + auto-link professor if applicable
        await loadAllData();
        if (window.linkStaffOnLogin) await window.linkStaffOnLogin(user);
        // Annual ficha reset: runs silently on first login of each new year
        checkAndResetFichas().catch(err => console.warn('ficha reset:', err));
        navigate('dashboard');


    } else {
        currentUser = null;
        students = []; activities = [];
        if (studentsUnsub) { studentsUnsub(); studentsUnsub = null; }
        if (activitiesUnsub) { activitiesUnsub(); activitiesUnsub = null; }
        $('screen-app').classList.add('hidden');
        $('screen-app').classList.remove('active');
        $('screen-login').classList.remove('hidden');
        $('screen-login').classList.add('active');
        const btn = $('btn-google-login');
        btn.disabled = false;
        btn.innerHTML = `<svg width="20" height="20" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>Iniciar sesión con Google`;
    }
});

// ============================================================
// REALTIME DATA LOADING
// ============================================================
function loadAllData() {
    // loadStaff is defined later in the staff module and patched in below
    const staffLoader = typeof loadStaff === 'function' ? loadStaff() : Promise.resolve();
    return Promise.all([loadStudents(), loadActivities(), staffLoader]);
}

function loadStudents() {
    return new Promise((resolve) => {
        // No orderBy to avoid needing composite indexes — sort in JS instead
        studentsUnsub = onSnapshot(collection(db, 'students'), snap => {
            students = snap.docs
                .map(d => ({ id: d.id, ...d.data() }))
                .sort((a, b) => {
                    const last = (a.lastName || '').localeCompare(b.lastName || '', 'es');
                    return last !== 0 ? last : (a.firstName || '').localeCompare(b.firstName || '', 'es');
                });
            if (currentPage === 'students') renderStudentsList();
            if (currentPage === 'payments') populatePaymentsStudentSelect();
            resolve();
        }, err => { console.error('students snapshot error:', err); resolve(); });
    });
}

function loadActivities() {
    return new Promise((resolve) => {
        // No orderBy to avoid needing composite indexes — sort in JS instead
        activitiesUnsub = onSnapshot(collection(db, 'activities'), snap => {
            activities = snap.docs
                .map(d => ({ id: d.id, ...d.data() }))
                .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'es'));
            if (currentPage === 'activities') renderActivitiesList();
            if (currentPage === 'attendance') populateAttendanceActivitySelect();
            resolve();
        }, err => { console.error('activities snapshot error:', err); resolve(); });
    });
}

// ============================================================
// DASHBOARD
// ============================================================
async function renderDashboard() {
    // Stats
    const activeStudents = students.filter(s => s.active !== false).length;
    const activeActivities = activities.filter(a => a.status === 'active').length;
    $('stat-students').textContent = activeStudents;
    $('stat-activities').textContent = activeActivities;

    // Payments this month
    const monthKey = nowMonthKey();
    try {
        const pSnap = await getDocs(query(collection(db, 'payments'), where('monthKey', '==', monthKey)));
        const payments = pSnap.docs.map(d => d.data());
        const paid = payments.filter(p => p.status === 'paid').length;
        const pending = payments.filter(p => p.status === 'pending' || !p.status).length;
        $('stat-paid').textContent = paid;
        $('stat-pending').textContent = pending;
    } catch { $('stat-paid').textContent = '—'; $('stat-pending').textContent = '—'; }

    // Today's activities
    const dow = todayWeekday();
    const todayActivities = activities.filter(a => a.status === 'active' && (a.days || []).includes(dow));
    const todayLabel = new Date().toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' });
    $('today-label').textContent = todayLabel;

    const listEl = $('today-activities');
    if (todayActivities.length === 0) {
        listEl.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🎉</div>No hay actividades hoy</div>`;
    } else {
        listEl.innerHTML = todayActivities.map(a => `
      <div class="activity-list-item">
        <div style="width:36px;height:36px;border-radius:8px;background:var(--blue-bg);display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0">🏃</div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;font-size:14px">${escHtml(a.name)}</div>
          <div style="font-size:12px;color:var(--gray-500)">${a.startTime || ''}–${a.endTime || ''} · ${formatCurrency(a.currentFee || 0)}/mes</div>
        </div>
        <button class="btn-primary btn-sm" onclick="navigateToAttendance('${escHtml(a.id)}')">Asistencia</button>
      </div>`).join('');
    }

    // Remove pulse animation
    document.querySelectorAll('.stat-card').forEach(c => c.classList.remove('loading-pulse'));
}

// ============================================================
// STUDENTS
// ============================================================
function renderStudentsList() {
    const search = ($('student-search')?.value || '').toLowerCase().trim();
    const list = $('students-list');
    if (!list) return;

    // Only show active students (inactive are hidden from all users)
    const activeStudents = students.filter(s => s.active !== false);

    const filtered = activeStudents.filter(s => {
        if (!search) return true;
        return (s.firstName + ' ' + s.lastName).toLowerCase().includes(search);
    });

    if (activeStudents.length === 0) {
        list.innerHTML = `<div class="empty-state"><div class="empty-state-icon">👨‍🎓</div>No hay alumnos activos registrados</div>`;
        return;
    }
    if (filtered.length === 0) {
        list.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🔍</div>Sin resultados para "${escHtml(search)}"</div>`;
        return;
    }

    list.innerHTML = filtered.map(s => {
        const phone = s.guardianPhone || (s.guardian && s.guardian.phone) || '';
        return `
    <div class="student-card">
      <div class="student-avatar">${escHtml(initials(s.firstName, s.lastName))}</div>
      <div class="student-info">
        <div class="student-name">${escHtml(s.lastName)}, ${escHtml(s.firstName)}</div>
        <div class="student-meta">${phone ? '📞 ' + escHtml(phone) : ''}</div>
        <div class="student-meta" style="margin-top:2px;display:flex;gap:4px;flex-wrap:wrap">
            ${s.school ? `<span class="badge badge-blue" style="font-size:10px">🏫 ${escHtml(s.school)}</span>` : ''}
            ${s.grade ? `<span class="badge badge-gray" style="font-size:10px">${escHtml(s.grade)}</span>` : ''}
        </div>
      </div>
      <div class="student-actions">
        <button class="btn-icon" style="color:var(--blue)" title="Inscribir" onclick="openEnrollModal('${escHtml(s.id)}')">📋</button>
        <button class="btn-icon" style="color:var(--gray-600)" title="Editar" onclick="openStudentForm('${escHtml(s.id)}')">✏️</button>
      </div>
    </div>`;
    }).join('');
}
window.filterStudents = () => renderStudentsList();


function openStudentForm(id) {
    const student = id ? students.find(s => s.id === id) : null;
    $('modal-student-title').textContent = student ? 'Editar Alumno' : 'Nuevo Alumno';

    // Reset form
    $('form-student').reset();

    // Disable button: only visible to admins editing an existing student
    const disableBtn = $('btn-disable-student');
    if (disableBtn) {
        if (canEdit() && student) {
            disableBtn.classList.remove('hidden');
            const isActive = student.active !== false;
            disableBtn.textContent = isActive ? 'Deshabilitar alumno' : 'Habilitar alumno';
            disableBtn.style.background = isActive ? 'var(--red-bg)' : 'var(--green-bg)';
            disableBtn.style.color = isActive ? 'var(--red)' : 'var(--green)';
        } else {
            disableBtn.classList.add('hidden');
        }
    }

    if (student) {
        $('s-firstName').value = student.firstName || '';
        $('s-lastName').value = student.lastName || '';
        // Support old guardian.phone and new guardianPhone field
        $('s-guardianPhone').value = student.guardianPhone || (student.guardian && student.guardian.phone) || '';
        $('s-school').value = student.school || '';
        $('s-grade').value = student.grade || '';
    }
    $('form-student').dataset.editId = student ? student.id : '';
    openModal('modal-student');
}
window.openStudentForm = openStudentForm;


async function saveStudent(e) {
    e.preventDefault();
    const btn = $('btn-save-student');
    const editId = $('form-student').dataset.editId;
    const isEdit = !!editId;

    const firstName = $('s-firstName').value.trim();
    const lastName = $('s-lastName').value.trim();

    // Generate a stable ID from name if new, or reuse existing
    let docId = editId;
    if (!isEdit) {
        // Create a slug-like ID from name + timestamp suffix for uniqueness
        docId = `${lastName}_${firstName}_${Date.now()}`.toLowerCase()
            .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
            .replace(/[^a-z0-9_]/g, '_');
    }

    const studentData = {
        firstName,
        lastName,
        guardianPhone: $('s-guardianPhone').value.trim(),
        school: $('s-school').value.trim(),
        grade: $('s-grade').value.trim(),
        active: true,
        updatedAt: serverTimestamp(),
        updatedBy: currentUser.uid,
    };

    // Preserve active when editing
    if (isEdit) {
        const existing = students.find(s => s.id === editId);
        if (existing) studentData.active = existing.active !== false;
    }
    if (!isEdit) {
        studentData.createdAt = serverTimestamp();
        studentData.createdBy = currentUser.uid;
    }

    btn.disabled = true; btn.textContent = 'Guardando...';
    try {
        await setDoc(doc(db, 'students', docId), studentData, { merge: isEdit });
        showToast(isEdit ? 'Alumno actualizado ✓' : 'Alumno registrado ✓', 'success');
        closeModal('modal-student');
    } catch (err) {
        showToast('Error: ' + err.message, 'error');
    } finally {
        btn.disabled = false; btn.textContent = 'Guardar';
    }
}

// Toggle active/inactive for a student (admin only)
async function toggleStudentActive() {
    if (!canEdit()) { showToast('Solo administradores pueden deshabilitar alumnos', 'error'); return; }
    const editId = $('form-student').dataset.editId;
    if (!editId) return;
    const student = students.find(s => s.id === editId);
    if (!student) return;
    const nextActive = student.active === false; // toggle

    const confirmMsg = nextActive
        ? `\u00bfHabilitar al alumno ${student.firstName} ${student.lastName}?\n\nVolver\u00e1 a estar visible. Deber\u00e1s reinscribirlo en las actividades si corresponde.`
        : `\u00bfDeshabilitar al alumno ${student.firstName} ${student.lastName}?\n\n\u2022 Desaparecer\u00e1 del listado de alumnos\n\u2022 Se eliminar\u00e1n sus inscripciones en actividades\n\u2022 Sus pagos hist\u00f3ricos quedar\u00e1n guardados (no se borran)`;

    if (!confirm(confirmMsg)) return;
    try {
        const batch = writeBatch(db);

        // Update student active status
        const studentRef = doc(db, 'students', editId);
        batch.set(studentRef, {
            active: nextActive,
            updatedAt: serverTimestamp(),
            updatedBy: currentUser.uid,
        }, { merge: true });

        // When DISABLING: also delete all enrollments for this student
        if (!nextActive) {
            const enrollSnap = await getDocs(
                query(collection(db, 'enrollments'), where('studentId', '==', editId))
            );
            enrollSnap.docs.forEach(d => batch.delete(d.ref));
            await batch.commit();
            showToast(`Alumno deshabilitado y removido de ${enrollSnap.size} actividad(es) \u2713`, 'success');
        } else {
            await batch.commit();
            showToast('Alumno habilitado \u2713', 'success');
        }

        closeModal('modal-student');
    } catch (err) {
        showToast('Error: ' + err.message, 'error');
    }
}
window.toggleStudentActive = toggleStudentActive;

// ============================================================
// ANNUAL FICHA MÉDICA RESET
// ============================================================
// Runs on every login. Checks if fichas were reset this year.
// If not (new year), resets ALL students' fichamedica to false
// and records the reset year in settings/fichaReset.
async function checkAndResetFichas() {
    const yr = new Date().getFullYear();
    const settingsRef = doc(db, 'settings', 'fichaReset');
    const snap = await getDoc(settingsRef);

    const lastReset = snap.exists() ? (snap.data().lastResetYear || 0) : 0;
    if (lastReset >= yr) return; // Already reset this year — nothing to do

    console.log(`[fichaReset] Resetting all student fichas for year ${yr}...`);

    // Batch-update all students: fichamedica = false
    const studentsSnap = await getDocs(collection(db, 'students'));
    const batch = writeBatch(db);

    studentsSnap.docs.forEach(d => {
        if (d.data().fichamedica === true) {
            batch.update(d.ref, {
                fichamedica: false,
                fichamedicaYear: lastReset || yr - 1,
            });
        }
    });

    // Record the reset
    batch.set(settingsRef, {
        lastResetYear: yr,
        resetAt: serverTimestamp(),
        resetBy: currentUser?.uid || 'system',
    }, { merge: true });

    await batch.commit();
    console.log(`[fichaReset] Done — fichas reset for ${yr}`);
}

// ============================================================
// ACTIVITIES
// ============================================================
function renderActivitiesList() {
    const list = $('activities-list');
    if (!list) return;

    // Only admin can create activities
    const newBtn = $('btn-new-activity');
    if (newBtn) newBtn.style.display = canEdit() ? '' : 'none';

    if (activities.length === 0) {
        list.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🏃</div>No hay actividades aún</div>`;
        return;
    }

    list.innerHTML = activities.map(a => `
    <div class="activity-card">
      <div class="activity-card-header">
        <div>
          <div class="activity-name">${escHtml(a.name)}</div>
          <div class="activity-meta">${daysLabel(a.days || [])} · ${a.startTime || ''}–${a.endTime || ''}</div>
          ${a.professorName ? `<div class="activity-meta" style="margin-top:2px">👨‍🏫 ${escHtml(a.professorName)}</div>` : ''}
        </div>
        <div style="text-align:right">
          <div class="activity-fee">${formatCurrency(a.currentFee || 0)}</div>
          <span class="badge ${a.status === 'active' ? 'badge-green' : 'badge-gray'}">${a.status === 'active' ? 'Activa' : 'Inactiva'}</span>
        </div>
      </div>
      ${canEdit() ? `
      <div class="activity-actions">
        <button class="btn-secondary btn-sm" onclick="openActivityForm('${escHtml(a.id)}')">✏️ Editar</button>
      </div>` : ''}
    </div>`).join('');
}

function openActivityForm(id) {
    if (!canEdit()) { showToast('Solo administradores pueden editar actividades', 'error'); return; }
    const activity = id ? activities.find(a => a.id === id) : null;
    $('modal-activity-title').textContent = activity ? 'Editar Actividad' : 'Nueva Actividad';
    $('form-activity').reset();

    // Default dates: Mar 1 – Dec 31 of current year
    const yr = new Date().getFullYear();
    const defaultStart = `${yr}-03-01`;
    const defaultEnd = `${yr}-12-31`;

    const fmtDate = (v) => {
        if (!v) return null;
        if (v.toDate) return v.toDate().toISOString().slice(0, 10);
        return String(v).slice(0, 10);
    };

    // Reset days
    document.querySelectorAll('#a-days input[type=checkbox]').forEach(cb => { cb.checked = false; });

    if (activity) {
        $('a-name').value = activity.name || '';
        $('a-startTime').value = activity.startTime || '';
        $('a-endTime').value = activity.endTime || '';
        $('a-fee').value = activity.currentFee || '';
        $('a-status').value = activity.status || 'active';
        $('a-startDate').value = fmtDate(activity.startDate) || defaultStart;
        $('a-endDate').value = fmtDate(activity.endDate) || defaultEnd;
        (activity.days || []).forEach(d => {
            const cb = document.querySelector(`#a-days input[value="${d}"]`);
            if (cb) cb.checked = true;
        });
    } else {
        $('a-startDate').value = defaultStart;
        $('a-endDate').value = defaultEnd;
    }
    $('form-activity').dataset.editId = activity ? activity.id : '';

    // Delete button: only for admins editing existing activity
    const delBtn = $('btn-delete-activity');
    if (delBtn) delBtn.classList.toggle('hidden', !canEdit() || !activity);

    openModal('modal-activity');
}
window.openActivityForm = openActivityForm;

async function deleteActivity() {
    if (!canEdit()) return;
    const editId = $('form-activity').dataset.editId;
    if (!editId) return;
    const act = activities.find(a => a.id === editId);
    if (!confirm(`¿Eliminar la actividad "${act?.name || editId}"?\n\nEsta acción no se puede deshacer. Las inscripciones y pagos relacionados quedarán en el historial.`)) return;
    try {
        await deleteDoc(doc(db, 'activities', editId));
        showToast('Actividad eliminada ✓', 'success');
        closeModal('modal-activity');
    } catch (err) { showToast('Error: ' + err.message, 'error'); }
}
window.deleteActivity = deleteActivity;


async function saveActivity(e) {
    e.preventDefault();
    const btn = $('btn-save-activity');
    const editId = $('form-activity').dataset.editId;
    const isEdit = !!editId;

    const days = [...document.querySelectorAll('#a-days input:checked')].map(cb => +cb.value);
    if (days.length === 0) { showToast('Seleccioná al menos un día', 'error'); return; }

    const data = {
        name: $('a-name').value.trim(),
        days,
        startTime: $('a-startTime').value,
        endTime: $('a-endTime').value,
        currentFee: parseFloat($('a-fee').value),
        status: $('a-status').value,
        startDate: $('a-startDate').value || null,
        endDate: $('a-endDate').value || null,
        updatedAt: serverTimestamp(),
        updatedBy: currentUser.uid,
    };
    if (!isEdit) {
        data.createdAt = serverTimestamp();
        data.createdBy = currentUser.uid;
        data.feeHistory = [];
    }

    const ref = isEdit ? doc(db, 'activities', editId) : doc(collection(db, 'activities'));
    btn.disabled = true; btn.textContent = 'Guardando...';
    try {
        await setDoc(ref, data, { merge: isEdit });
        showToast(isEdit ? 'Actividad actualizada ✓' : 'Actividad creada ✓', 'success');
        closeModal('modal-activity');
    } catch (err) {
        showToast('Error: ' + err.message, 'error');
    } finally {
        btn.disabled = false; btn.textContent = 'Guardar';
    }
}
window.saveActivity = saveActivity;

// ============================================================
// ENROLL
// ============================================================
async function openEnrollModal(studentId) {
    const student = students.find(s => s.id === studentId);
    if (!student) return;

    $('enroll-student-name').textContent = `${student.lastName}, ${student.firstName} — DNI ${student.dni}`;
    $('enroll-activities-list').innerHTML = '<div class="loading-spinner">Cargando...</div>';
    openModal('modal-enroll');

    // Get current enrollments
    const enrollSnap = await getDocs(query(collection(db, 'enrollments'), where('studentId', '==', studentId)));
    const enrolledIds = new Set(enrollSnap.docs.map(d => d.data().activityId));

    const activeActivities = activities.filter(a => a.status === 'active');
    if (activeActivities.length === 0) {
        $('enroll-activities-list').innerHTML = '<div class="empty-state">No hay actividades activas</div>';
        return;
    }

    $('enroll-activities-list').innerHTML = activeActivities.map(a => `
    <div class="enroll-activity-item">
      <div>
        <div style="font-weight:600;font-size:14px">${escHtml(a.name)}</div>
        <div style="font-size:12px;color:var(--gray-500)">${daysLabel(a.days || [])} · ${a.startTime || ''}–${a.endTime || ''}</div>
      </div>
      ${enrolledIds.has(a.id)
            ? `<span class="badge badge-green">Inscripto ✓</span>`
            : `<button class="btn-primary btn-sm" onclick="enrollStudent('${escHtml(studentId)}','${escHtml(a.id)}',this)">Inscribir</button>`
        }
    </div>`).join('');
}
window.openEnrollModal = openEnrollModal;

async function enrollStudent(studentId, activityId, btn) {
    btn.disabled = true; btn.textContent = '...';
    const student = students.find(s => s.id === studentId);
    const activity = activities.find(a => a.id === activityId);
    try {
        const enrollId = `${studentId}_${activityId}`;
        await setDoc(doc(db, 'enrollments', enrollId), {
            id: enrollId,
            studentId,
            studentName: student ? `${student.firstName} ${student.lastName}` : studentId,
            activityId,
            activityName: activity ? activity.name : activityId,
            active: true,
            createdAt: serverTimestamp(),
            createdBy: currentUser.uid,
        });
        btn.replaceWith(Object.assign(document.createElement('span'), {
            className: 'badge badge-green', textContent: 'Inscripto ✓'
        }));
        showToast('Inscripción exitosa ✓', 'success');
    } catch (err) {
        showToast('Error: ' + err.message, 'error');
        btn.disabled = false; btn.textContent = 'Inscribir';
    }
}
window.enrollStudent = enrollStudent;

// ============================================================
// ATTENDANCE v2 — Monthly Grid (up to 12 sessions/month)
// ============================================================
const MONTH_NAMES_ES = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];

function initAttendancePage() {
    populateAttendanceActivitySelect();
    populateAttendanceMonthSelect();
}

function populateAttendanceActivitySelect() {
    const sel = $('attendance-activity-select');
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = '<option value="">— Seleccionar actividad —</option>' +
        activities.filter(a => a.status === 'active').map(a =>
            `<option value="${escHtml(a.id)}">${escHtml(a.name)} (${daysLabel(a.days || [])})</option>`
        ).join('');
    if (prev) sel.value = prev;
}

function populateAttendanceMonthSelect() {
    const sel = $('attendance-month-select');
    if (!sel) return;
    const now = new Date();
    const yr = now.getFullYear();
    const curMonth = now.getMonth() + 1; // 1-12
    sel.innerHTML = '';
    for (let m = 1; m <= 12; m++) {
        const key = `${yr}-${String(m).padStart(2, '0')}`;
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = MONTH_NAMES_ES[m - 1];
        if (m === curMonth) opt.selected = true;
        sel.appendChild(opt);
    }
}

async function loadAttendanceGrid() {
    const actId = $('attendance-activity-select').value;
    const monthKey = $('attendance-month-select').value;
    const cont = $('attendance-grid');
    if (!actId || !monthKey) { cont.innerHTML = ''; return; }

    cont.innerHTML = '<div class="loading-spinner">Cargando...</div>';
    try {
        // Load enrolled students
        const enrollSnap = await getDocs(query(collection(db, 'enrollments'), where('activityId', '==', actId)));
        const studentIds = enrollSnap.docs.map(d => d.data().studentId);
        const enrolledStudents = studentIds
            .map(id => students.find(s => s.id === id))
            .filter(Boolean)
            .filter(s => s.active !== false)
            .sort((a, b) => a.lastName.localeCompare(b.lastName, 'es'));

        if (enrolledStudents.length === 0) {
            cont.innerHTML = '<div class="empty-state"><div class="empty-state-icon">👥</div>Sin alumnos inscriptos en esta actividad</div>';
            return;
        }

        // Load attendance doc from attendance_v2
        const docId = `${actId}_${monthKey}`;
        const attSnap = await getDoc(doc(db, 'attendance_v2', docId));
        let sessions = attSnap.exists() ? (attSnap.data().sessions || []) : [];

        // Auto-detect: if today is within this month and has no session yet, add one
        const today = todayISO();
        const inThisMonth = today.startsWith(monthKey);
        const hasSessionToday = sessions.some(s => s.date === today);

        if (inThisMonth && !hasSessionToday && sessions.length < 12) {
            // Create new session with today's date (not saved yet — saves on first cell click)
            sessions = [...sessions, {
                sessionIndex: sessions.length + 1,
                date: today,
                records: {}
            }];
        }

        renderAttendanceGrid(enrolledStudents, sessions, actId, monthKey, docId);
    } catch (e) {
        $('attendance-grid').innerHTML = `<div class="empty-state">Error: ${escHtml(e.message)}</div>`;
    }
}
window.loadAttendanceGrid = loadAttendanceGrid;

function renderAttendanceGrid(enrolledStudents, sessions, actId, monthKey, docId) {
    const cont = $('attendance-grid');
    const today = todayISO();
    const expanded = !!window._attExpanded;

    // Partition sessions: past vs today
    const pastSessions = sessions.filter(s => s.date !== today);
    const todaySession = sessions.find(s => s.date === today) || null;

    const [yr, mo] = monthKey.split('-');
    const monthLabel = `${MONTH_NAMES_ES[+mo - 1]} ${yr}`;

    if (sessions.length === 0) {
        cont.innerHTML = `<div class="card" style="padding:24px;text-align:center">
            <div style="font-size:40px;margin-bottom:12px">📅</div>
            <div style="font-weight:600;font-size:15px;color:var(--gray-700)">Sin clases registradas en ${monthLabel}</div>
            <div style="font-size:13px;color:var(--gray-500);margin-top:6px">Abrí esta pantalla el día que tengas clase y se creará la primera sesión automáticamente.</div>
          </div>`;
        window._attState = { sessions, actId, monthKey, docId, enrolledStudents };
        return;
    }

    // ── Build header row ──────────────────────────────────────
    let headers = `<th class="att-student-header">ALUMNO / COLEGIO</th>`;

    if (pastSessions.length > 0) {
        if (expanded) {
            // All past sessions expanded
            headers += pastSessions.map(s => {
                const dl = s.date ? s.date.slice(5).replace('-', '/') : '';
                return `<th class="att-col-header att-past-col" title="${s.date}">
                    <div>C${s.sessionIndex}</div><div class="att-date-label">${dl}</div>
                </th>`;
            }).join('');
            // Collapse button on the right of past cols
            headers += `<th class="att-col-header att-past-col">
                <button class="att-toggle-btn" onclick="toggleAttHistory()" title="Colapsar historial">◀</button>
            </th>`;
        } else {
            // Collapsed: single "Ant." summary header
            const range = pastSessions.length === 1
                ? `C${pastSessions[0].sessionIndex}`
                : `C1–C${pastSessions[pastSessions.length - 1].sessionIndex}`;
            headers += `<th class="att-col-header att-past-col att-collapsed-header">
                <button class="att-toggle-btn" onclick="toggleAttHistory()" title="Ver historial completo">▶</button>
                <div class="att-date-label">${range}</div>
            </th>`;
        }
    }

    if (todaySession) {
        const dl = todaySession.date.slice(5).replace('-', '/');
        headers += `<th class="att-col-header att-today-col" title="${todaySession.date}">
            <div>C${todaySession.sessionIndex}</div><div class="att-date-label">${dl}</div>
        </th>`;
    }

    headers += `<th class="att-total-header">TOT</th>`;

    // ── Build student rows ────────────────────────────────────
    const rows = enrolledStudents.map(s => {
        let totalPres = 0;
        let pastPres = 0;
        let cells = '';

        // Past sessions columns
        if (pastSessions.length > 0) {
            if (expanded) {
                cells += pastSessions.map(session => {
                    const state = (session.records && session.records[s.id]) || '';
                    if (state === 'P') { pastPres++; totalPres++; }
                    const cls = state === 'P' ? 'att-cell att-present att-past'
                        : state === 'A' ? 'att-cell att-absent att-past'
                            : 'att-cell att-empty att-past';
                    return `<td><div class="${cls}"
                        onclick="cycleAttendanceCell('${escHtml(actId)}','${escHtml(monthKey)}','${escHtml(docId)}',${session.sessionIndex},'${escHtml(s.id)}')">${state || '·'}</div></td>`;
                }).join('');
                // Empty spacer cell under the collapse button column
                cells += `<td></td>`;
            } else {
                // Count presences across all past sessions
                pastSessions.forEach(session => {
                    if (session.records && session.records[s.id] === 'P') { pastPres++; totalPres++; }
                });
                cells += `<td><div class="att-past-summary">${pastPres > 0 ? `<span>${pastPres}</span>` : '—'}</div></td>`;
            }
        }

        // Today's session cell
        if (todaySession) {
            const state = (todaySession.records && todaySession.records[s.id]) || '';
            if (state === 'P') totalPres++;
            const cls = state === 'P' ? 'att-cell att-present att-today-cell'
                : state === 'A' ? 'att-cell att-absent att-today-cell'
                    : 'att-cell att-empty att-today-cell';
            cells += `<td><div class="${cls}"
                onclick="cycleAttendanceCell('${escHtml(actId)}','${escHtml(monthKey)}','${escHtml(docId)}',${todaySession.sessionIndex},'${escHtml(s.id)}')">${state || '·'}</div></td>`;
        }

        return `<tr>
            <td class="att-student-cell">
                <div class="att-student-name">${escHtml(s.lastName)}, ${escHtml(s.firstName)}</div>
                <div class="att-student-sub">${s.school ? escHtml(s.school) : ''}${s.grade ? ' · ' + escHtml(s.grade) : ''}</div>
            </td>
            ${cells}
            <td><div class="att-total">${totalPres > 0 ? totalPres : ''}</div></td>
        </tr>`;
    }).join('');

    // ── Render ────────────────────────────────────────────────
    cont.innerHTML = `<div class="card att-card">
        <div class="att-header">
            <span class="att-month-label">📅 ${monthLabel}</span>
            <span class="att-enrolled-count">${enrolledStudents.length} alumno(s) · ${sessions.length} clase(s)</span>
        </div>
        <div class="att-table-wrap">
            <table class="att-grid-table">
                <thead><tr>${headers}</tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
      </div>`;

    window._attState = { sessions, actId, monthKey, docId, enrolledStudents };
}

function toggleAttHistory() {
    window._attExpanded = !window._attExpanded;
    const s = window._attState;
    if (s) renderAttendanceGrid(s.enrolledStudents, s.sessions, s.actId, s.monthKey, s.docId);
}
window.toggleAttHistory = toggleAttHistory;

async function cycleAttendanceCell(actId, monthKey, docId, sessionIndex, studentId) {
    const state = window._attState;
    if (!state) return;

    const session = state.sessions.find(s => s.sessionIndex === sessionIndex);
    if (!session) return;
    if (!session.records) session.records = {};

    // Cycle: '' → 'P' → 'A' → ''
    const cur = session.records[studentId] || '';
    const next = cur === '' ? 'P' : cur === 'P' ? 'A' : '';
    if (next === '') {
        delete session.records[studentId];
    } else {
        session.records[studentId] = next;
    }

    // Re-render immediately (optimistic)
    renderAttendanceGrid(state.enrolledStudents, state.sessions, state.actId, state.monthKey, state.docId);

    // Debounced save to Firestore (800ms after last click)
    clearTimeout(window._attSaveTimer);
    window._attSaveTimer = setTimeout(
        () => saveAttendanceDoc(actId, monthKey, docId, state.sessions),
        800
    );
}
window.cycleAttendanceCell = cycleAttendanceCell;

async function saveAttendanceDoc(actId, monthKey, docId, sessions) {
    try {
        await setDoc(doc(db, 'attendance_v2', docId), {
            id: docId,
            activityId: actId,
            monthKey,
            sessions,
            updatedAt: serverTimestamp(),
            updatedBy: currentUser?.uid || '',
        });
    } catch (e) {
        showToast('Error al guardar asistencia: ' + e.message, 'error');
    }
}

// ============================================================
// PAYMENTS v2 — Inline Grid (Activity + Month)
// ============================================================
function initPaymentsPage() {
    populatePaymentsActivitySelect();
    populatePaymentsMonthSelect();
}

function populatePaymentsActivitySelect() {
    const sel = $('pay-activity-select');
    if (!sel) return;
    const prev = sel.value;
    sel.innerHTML = '<option value="">— Seleccionar actividad —</option>' +
        activities.filter(a => a.status === 'active').map(a =>
            `<option value="${escHtml(a.id)}">${escHtml(a.name)} (${daysLabel(a.days || [])})</option>`
        ).join('');
    if (prev) sel.value = prev;
}

function populatePaymentsMonthSelect() {
    const sel = $('pay-month-select');
    if (!sel) return;
    const now = new Date();
    const yr = now.getFullYear();
    const curMonth = now.getMonth() + 1;
    sel.innerHTML = '';
    for (let m = 1; m <= 12; m++) {
        const key = `${yr}-${String(m).padStart(2, '0')}`;
        const opt = document.createElement('option');
        opt.value = key;
        opt.textContent = MONTH_NAMES_ES[m - 1];
        if (m === curMonth) opt.selected = true;
        sel.appendChild(opt);
    }
}

async function loadPaymentsGrid() {
    const actId = $('pay-activity-select').value;
    const monthKey = $('pay-month-select').value;
    const cont = $('payments-grid');
    if (!actId || !monthKey) { cont.innerHTML = ''; return; }

    cont.innerHTML = '<div class="loading-spinner">Cargando...</div>';
    try {
        const activity = activities.find(a => a.id === actId);

        // Enrolled students
        const enrollSnap = await getDocs(query(collection(db, 'enrollments'), where('activityId', '==', actId)));
        const studentIds = enrollSnap.docs.map(d => d.data().studentId);
        const enrolledStudents = studentIds
            .map(id => students.find(s => s.id === id))
            .filter(Boolean)
            .filter(s => s.active !== false)
            .sort((a, b) => a.lastName.localeCompare(b.lastName, 'es'));

        if (enrolledStudents.length === 0) {
            cont.innerHTML = '<div class="empty-state"><div class="empty-state-icon">👥</div>Sin alumnos inscriptos en esta actividad</div>';
            return;
        }

        // Existing payment docs for this activity+month
        const paySnap = await getDocs(query(collection(db, 'payments'),
            where('activityId', '==', actId), where('monthKey', '==', monthKey)));
        const paymentMap = {};
        paySnap.docs.forEach(d => { paymentMap[d.data().studentId] = { id: d.id, ...d.data() }; });

        renderPaymentsGrid(enrolledStudents, paymentMap, actId, activity, monthKey);
    } catch (e) {
        $('payments-grid').innerHTML = `<div class="empty-state">Error: ${escHtml(e.message)}</div>`;
    }
}
window.loadPaymentsGrid = loadPaymentsGrid;

function renderPaymentsGrid(enrolledStudents, paymentMap, actId, activity, monthKey) {
    const cont = $('payments-grid');
    const defaultFee = activity?.currentFee || 0;
    const [yr, mo] = monthKey.split('-');
    const monthLabel = `${MONTH_NAMES_ES[+mo - 1]} ${yr}`;

    const methodOptions = [
        ['cash', '💵 Efectivo'],
        ['transfer', '🏦 Transferencia'],
        ['mercadopago', '📱 MercadoPago'],
    ];

    const rows = enrolledStudents.map(s => {
        const pmt = paymentMap[s.id];
        const isPaid = pmt && pmt.status === 'paid';
        const isNotAttending = pmt && pmt.status === 'not_attending';
        const cuota = pmt ? (pmt.grossAmount ?? (isNotAttending ? 0 : defaultFee)) : defaultFee;
        const seguro = pmt ? (pmt.seguroAmount ?? 0) : 0;
        const method = pmt ? (pmt.paymentMethod || 'cash') : 'cash';
        const phone = s.guardianPhone || (s.guardian && s.guardian.phone) || '';

        const statusSelect = `<select class="pay-status-select ${isPaid ? 'pay-paid' : isNotAttending ? 'pay-not-attending' : 'pay-pending'}"
            onchange="setPaymentStatus('${escHtml(actId)}','${escHtml(monthKey)}','${escHtml(s.id)}',this.value)">
            <option value="pending" ${!isPaid && !isNotAttending ? 'selected' : ''}>PENDIENTE</option>
            <option value="paid" ${isPaid ? 'selected' : ''}>PAGADO</option>
            <option value="not_attending" ${isNotAttending ? 'selected' : ''}>NO CONCURRE</option>
        </select>`;

        const cuotaInput = `<input type="number" class="pay-amount-input" value="${cuota}" min="0" step="100"
            onblur="setPaymentField('${escHtml(actId)}','${escHtml(monthKey)}','${escHtml(s.id)}','grossAmount',+this.value)">`;

        const seguroInput = `<input type="number" class="pay-amount-input" value="${seguro}" min="0" step="100"
            onblur="setPaymentField('${escHtml(actId)}','${escHtml(monthKey)}','${escHtml(s.id)}','seguroAmount',+this.value)">`;

        const methodSelect = `<select class="pay-method-select"
            onchange="setPaymentField('${escHtml(actId)}','${escHtml(monthKey)}','${escHtml(s.id)}','paymentMethod',this.value)">
            ${methodOptions.map(([v, l]) => `<option value="${v}" ${method === v ? 'selected' : ''}>${l}</option>`).join('')}
        </select>`;

        const receiptBtn = isPaid
            ? `<button class="pay-receipt-btn" title="Descargar comprobante"
                onclick="generateReceiptPDF(${JSON.stringify({ id: pmt.id, studentId: s.id, studentName: `${s.lastName}, ${s.firstName}`, activityId: actId, activityName: activity?.name || actId, monthKey, grossAmount: pmt.grossAmount, seguroAmount: pmt.seguroAmount || 0, finalAmount: pmt.finalAmount, paymentMethod: pmt.paymentMethod, receiptNumber: pmt.receiptNumber || '—', paidAt: null, collectedBy: pmt.collectedBy || {} }).replace(/"/g, '&quot;')},null,null)">📄</button>` : '';

        const isWaSent = pmt?.waSent || false;
        const waColor = isWaSent ? '#25D366' : 'var(--gray-400)';
        const waIcon = `<svg width="18" height="18" viewBox="0 0 24 24" fill="${waColor}">` +
            `<path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372s-1.04 1.016-1.04 2.479 1.065 2.876 1.213 3.074c.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>` +
            `</svg>`;

        const waBtn = (isPaid && phone)
            ? `<button class="pay-wa-btn" title="${isWaSent ? 'Reenviar WhatsApp' : 'Enviar por WhatsApp'}"
                onclick="sendPaymentWhatsApp('${escHtml(pmt.id)}','${escHtml(s.id)}','${escHtml(phone)}','${escHtml(s.firstName + ' ' + s.lastName)}','${escHtml(activity?.name || '')}','${escHtml(monthKey)}',${pmt.finalAmount || 0})">${waIcon}</button>` : '';

        return `<tr>
            <td class="pay-student-cell">
                <div class="pay-student-name">${escHtml(s.lastName)}, ${escHtml(s.firstName)}</div>
                <div class="pay-student-sub">${s.school ? escHtml(s.school) : ''}${s.grade ? ' · ' + escHtml(s.grade) : ''}</div>
            </td>
            <td>${statusSelect}</td>
            <td>${cuotaInput}</td>
            <td>${seguroInput}</td>
            <td>${methodSelect}</td>
            <td class="pay-actions-cell">${receiptBtn}${waBtn}</td>
        </tr>`;
    }).join('');

    const paidCount = enrolledStudents.filter(s => paymentMap[s.id]?.status === 'paid').length;
    const notAttCount = enrolledStudents.filter(s => paymentMap[s.id]?.status === 'not_attending').length;
    const pendingCount = enrolledStudents.length - paidCount - notAttCount;

    cont.innerHTML = `<div class="card pay-card">
        <div class="pay-header">
            <span class="pay-month-label">💳 ${escHtml(activity?.name || actId)} — ${monthLabel}</span>
            <span class="pay-summary-badges">
                <span class="badge badge-green">${paidCount} pagados</span>
                <span class="badge badge-orange">${pendingCount} pendientes</span>
                ${notAttCount > 0 ? `<span class="badge badge-gray">${notAttCount} no asiste</span>` : ''}
                ${activity ? `<span class="badge badge-blue">Cuota: ${formatCurrency(defaultFee)}</span>` : ''}
            </span>
        </div>
        <div class="pay-table-wrap">
            <table class="pay-grid-table">
                <thead><tr>
                    <th class="pay-th-student">ALUMNO</th>
                    <th class="pay-th">ESTADO</th>
                    <th class="pay-th">CUOTA ($)</th>
                    <th class="pay-th">SEGURO ($)</th>
                    <th class="pay-th">MÉTODO</th>
                    <th class="pay-th">COMPROBANTE</th>
                </tr></thead>
                <tbody>${rows}</tbody>
            </table>
        </div>
    </div>`;

    window._payState = { enrolledStudents, paymentMap, actId, activity, monthKey };
}

async function setPaymentStatus(actId, monthKey, studentId, newStatus) {
    const state = window._payState;
    if (!state) return;

    const student = state.enrolledStudents.find(s => s.id === studentId);
    const existing = state.paymentMap[studentId];
    const cuota = existing ? (existing.grossAmount ?? state.activity?.currentFee ?? 0) : (state.activity?.currentFee ?? 0);
    const seguro = existing ? (existing.seguroAmount ?? 0) : 0;
    const method = existing ? (existing.paymentMethod || 'cash') : 'cash';

    if (newStatus === 'paid') {
        const receiptNum = existing?.receiptNumber || await getNextReceiptNumber();
        const docId = existing?.id || `${actId}_${monthKey}_${studentId}`;
        const payDoc = {
            id: docId,
            studentId,
            studentName: student ? `${student.lastName}, ${student.firstName}` : studentId,
            activityId: actId,
            activityName: state.activity?.name || actId,
            monthKey,
            status: 'paid',
            grossAmount: cuota,
            seguroAmount: seguro,
            finalAmount: cuota + seguro,
            paymentMethod: method,
            receiptNumber: receiptNum,
            paidAt: serverTimestamp(),
            collectedBy: { uid: currentUser.uid, displayName: currentUser.displayName || '', email: currentUser.email || '' },
            updatedAt: serverTimestamp(),
            updatedBy: currentUser.uid,
        };
        await savePaymentDoc(docId, payDoc);
        showToast(`✓ Pago registrado — ${receiptNum}`, 'success');
    } else if (newStatus === 'not_attending') {
        const docId = existing?.id || `${actId}_${monthKey}_${studentId}`;
        const payDoc = {
            id: docId,
            studentId,
            studentName: student ? `${student.lastName}, ${student.firstName}` : studentId,
            activityId: actId,
            activityName: state.activity?.name || actId,
            monthKey,
            status: 'not_attending',
            grossAmount: 0,
            seguroAmount: 0,
            finalAmount: 0,
            paymentMethod: method,
            receiptNumber: existing?.receiptNumber || null,
            paidAt: existing?.paidAt || null,
            collectedBy: { uid: currentUser.uid, displayName: currentUser.displayName || '', email: currentUser.email || '' },
            updatedAt: serverTimestamp(),
            updatedBy: currentUser.uid,
        };
        await savePaymentDoc(docId, payDoc);
        showToast('Alumno marcado como NO CONCURRE', '');
    } else {
        // Revert to pending
        const docId = existing?.id || `${actId}_${monthKey}_${studentId}`;
        await savePaymentDoc(docId, { ...existing, status: 'pending', updatedAt: serverTimestamp(), updatedBy: currentUser.uid });
        showToast('Pago marcado como pendiente', '');
    }
    loadPaymentsGrid();
}
window.setPaymentStatus = setPaymentStatus;

async function setPaymentField(actId, monthKey, studentId, field, value) {
    const state = window._payState;
    if (!state) return;
    const student = state.enrolledStudents.find(s => s.id === studentId);
    const existing = state.paymentMap[studentId];
    const docId = existing?.id || `${actId}_${monthKey}_${studentId}`;
    const cuota = field === 'grossAmount' ? value : (existing?.grossAmount ?? state.activity?.currentFee ?? 0);
    const seguro = field === 'seguroAmount' ? value : (existing?.seguroAmount ?? 0);

    const payDoc = {
        id: docId,
        studentId,
        studentName: student ? `${student.lastName}, ${student.firstName}` : studentId,
        activityId: actId,
        activityName: state.activity?.name || actId,
        monthKey,
        status: existing?.status || 'pending',
        grossAmount: cuota,
        seguroAmount: seguro,
        finalAmount: cuota + seguro,
        paymentMethod: field === 'paymentMethod' ? value : (existing?.paymentMethod || 'cash'),
        receiptNumber: existing?.receiptNumber || null,
        paidAt: existing?.paidAt || null,
        collectedBy: existing?.collectedBy || { uid: currentUser.uid, displayName: currentUser.displayName || '' },
        updatedAt: serverTimestamp(),
        updatedBy: currentUser.uid,
    };
    await savePaymentDoc(docId, payDoc);
    // Update local map to avoid full reload
    state.paymentMap[studentId] = { ...payDoc };
}
window.setPaymentField = setPaymentField;

async function savePaymentDoc(docId, data) {
    try {
        await setDoc(doc(db, 'payments', docId), data, { merge: true });
    } catch (e) {
        showToast('Error al guardar: ' + e.message, 'error');
    }
}

async function sendPaymentWhatsApp(paymentId, studentId, phone, studentName, activityName, monthKey, totalAmount) {
    const [yr, mo] = monthKey.split('-');
    const mes = `${MONTH_NAMES_ES[+mo - 1]} ${yr}`;
    const text = `✅ *Pago registrado — Escuela Deportiva CASTA*\n\n` +
        `👤 Alumno: ${studentName}\n` +
        `🏃 Actividad: ${activityName}\n` +
        `📅 Mes: ${mes}\n` +
        `💰 Total abonado: ${formatCurrency(totalAmount)}\n\n` +
        `_Este mensaje es un resumen informativo y no constituye un comprobante con validez legal._`;
    const clean = phone.replace(/\D/g, '');
    window.open(`https://wa.me/549${clean}?text=${encodeURIComponent(text)}`, '_blank');

    if (paymentId) {
        try {
            await setDoc(doc(db, 'payments', paymentId), { waSent: true, waSentAt: serverTimestamp() }, { merge: true });
            
            const state = window._payState;
            if (state && state.paymentMap && state.paymentMap[studentId]) {
                state.paymentMap[studentId].waSent = true;
                renderPaymentsGrid(state.enrolledStudents, state.paymentMap, state.actId, state.activity, state.monthKey);
            }
        } catch(e) {
            console.error("Error updating waSent flag:", e);
        }
    }
}
window.sendPaymentWhatsApp = sendPaymentWhatsApp;

async function openPaymentModal(studentId, activityId, monthKey) {
    const student = students.find(s => s.id === studentId);
    const activity = activities.find(a => a.id === activityId);
    if (!student || !activity) return;

    const finalAmount = activity.currentFee || 0;
    let selectedMethod = 'cash';

    $('payment-modal-body').innerHTML = `
    <div style="text-align:center;margin-bottom:16px">
      <span class="badge badge-blue" style="font-size:14px;padding:6px 16px">${monthKeyToLabel(monthKey)}</span>
    </div>
    <div style="display:flex;align-items:center;gap:10px;padding:12px;background:var(--gray-100);border-radius:var(--radius-sm);margin-bottom:16px">
      <div class="student-avatar">${escHtml(initials(student.firstName, student.lastName))}</div>
      <div>
        <div style="font-weight:600">${escHtml(student.lastName)}, ${escHtml(student.firstName)}</div>
        <div style="font-size:12px;color:var(--gray-500)">${escHtml(activity.name)}</div>
      </div>
    </div>
    <div class="payment-summary-card">
      <div class="payment-row" style="margin-top:4px"><strong>TOTAL</strong><strong class="payment-total">${formatCurrency(finalAmount)}</strong></div>
    </div>
    <div style="font-weight:600;font-size:13px;margin-bottom:8px">Medio de pago</div>
    <div class="payment-method-list" id="payment-methods">
      ${[['cash', '💵 Efectivo'], ['transfer', '🏦 Transferencia'], ['mercadopago', '📱 MercadoPago']].map(([val, label]) => `
        <label class="payment-method-item ${val === 'cash' ? 'selected' : ''}" id="pm-${val}">
          <input type="radio" name="paymentMethod" value="${val}" ${val === 'cash' ? 'checked' : ''}
            onchange="selectPaymentMethod('${val}')"> ${label}
        </label>`).join('')}
    </div>
    <button class="btn-primary" style="width:100%;margin-top:16px" id="btn-confirm-payment"
      onclick="confirmPayment()">
      Confirmar pago
    </button>`;

    // Store pending payment data in a global to avoid JSON-in-onclick issues
    window._pendingPayment = { studentId, activityId, monthKey, grossAmount: finalAmount, finalAmount, discounts: [] };

    openModal('modal-payment');
}
window.openPaymentModal = openPaymentModal;

function selectPaymentMethod(method) {
    document.querySelectorAll('.payment-method-item').forEach(el => {
        el.classList.toggle('selected', el.id === `pm-${method}`);
    });
}
window.selectPaymentMethod = selectPaymentMethod;

async function calculateDiscount(student, activity) {
    const grossAmount = activity.currentFee || 0;
    // Discounts removed — always pay full amount
    return { discounts: [], finalAmount: grossAmount };
}

async function confirmPayment() {
    const p = window._pendingPayment;
    if (!p) { showToast('Error: no hay pago pendiente', 'error'); return; }
    const { studentId, activityId, monthKey, grossAmount, finalAmount, discounts } = p;

    const btn = $('btn-confirm-payment');
    const method = document.querySelector('input[name="paymentMethod"]:checked')?.value || 'cash';
    const student = students.find(s => s.id === studentId);
    const activity = activities.find(a => a.id === activityId);

    btn.disabled = true; btn.textContent = 'Procesando...';
    showLoading();

    try {
        const paymentRef = doc(collection(db, 'payments'));
        const now = new Date();
        // Get sequential receipt number from Firestore counter (atomic)
        const receiptNum = await getNextReceiptNumber();


        const paymentData = {
            id: paymentRef.id,
            studentId,
            studentName: student ? `${student.firstName} ${student.lastName}` : studentId,
            studentDni: student?.dni || '',
            activityId,
            activityName: activity ? activity.name : activityId,
            monthKey,
            status: 'paid',
            grossAmount,
            discountsApplied: discounts,
            finalAmount,
            totalDiscount: grossAmount - finalAmount,
            paymentMethod: method,
            receiptNumber: receiptNum,
            paidAt: serverTimestamp(),
            collectedBy: { uid: currentUser.uid, displayName: currentUser.displayName || '', email: currentUser.email || '' },
            createdAt: serverTimestamp(),
            createdBy: currentUser.uid,
        };

        await setDoc(paymentRef, paymentData);

        // Generate PDF receipt immediately (local, no CORS issues)
        generateReceiptPDF({ ...paymentData, paidAt: now, receiptNumber: receiptNum }, student, activity);

        showToast(`✓ Pago registrado · Comprobante: ${receiptNum}`, 'success');
        closeModal('modal-payment');
        // Refresh grid if it's visible, else reload student payments
        if (window._payState) loadPaymentsGrid();
        window._pendingPayment = null;

    } catch (err) {
        showToast('Error al registrar el pago: ' + err.message, 'error');
        btn.disabled = false; btn.textContent = 'Confirmar pago';
    } finally {
        hideLoading();
    }
}
window.confirmPayment = confirmPayment;

// ============================================================
// REVERT PAYMENT (admin only)
// ============================================================
async function revertPayment(paymentId, monthKey) {
    if (!canEdit()) { showToast('Solo administradores pueden revertir pagos', 'error'); return; }
    if (!paymentId) { showToast('Error: ID de pago no encontrado', 'error'); return; }

    const label = monthKeyToLabel(monthKey);
    const ok = confirm(`¿Revertir el pago de ${label} a PENDIENTE?\n\nEsta acción la verá el sistema. Solo continuar si fue un error.`);
    if (!ok) return;

    showLoading();
    try {
        await updateDoc(doc(db, 'payments', paymentId), {
            status: 'reverted',
            revertedAt: serverTimestamp(),
            revertedBy: { uid: currentUser.uid, displayName: currentUser.displayName || '', email: currentUser.email || '' },
        });
        showToast(`Pago de ${label} revertido a pendiente ✓`, 'success');
        loadStudentPayments(); // Refresh
    } catch (err) {
        showToast('Error al revertir: ' + err.message, 'error');
    } finally {
        hideLoading();
    }
}
window.revertPayment = revertPayment;

// ============================================================
// RECEIPT PDF GENERATION (client-side, no CORS issues)
// ============================================================
async function getLogoBase64() {
    if (window._logoBase64) return window._logoBase64;
    try {
        const res = await fetch('logo.png');
        const blob = await res.blob();
        return new Promise(resolve => {
            const reader = new FileReader();
            reader.onloadend = () => { window._logoBase64 = reader.result; resolve(reader.result); };
            reader.readAsDataURL(blob);
        });
    } catch (e) { return null; }
}

async function generateReceiptPDF(payment, student, activity) {
    try {
        const { jsPDF } = window.jspdf;
        if (!jsPDF) { console.warn('jsPDF not loaded'); return; }

        const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
        const W = 210;    // A4 width
        const blue = [30, 100, 200];
        const gray = [120, 120, 120];
        const dark = [30, 30, 30];

        // ── Header band ──
        pdf.setFillColor(...blue);
        pdf.rect(0, 0, W, 38, 'F');

        const logoB64 = await getLogoBase64();
        let titleX = 15;
        if (logoB64) {
            pdf.addImage(logoB64, 'PNG', 12, 4, 16, 16);
            titleX = 32;
        }

        pdf.setTextColor(255, 255, 255);
        pdf.setFontSize(22); pdf.setFont('helvetica', 'bold');
        pdf.text('Escuela Deportiva CASTA', titleX, 16);
        pdf.setFontSize(10); pdf.setFont('helvetica', 'normal');
        pdf.text('Comprobante de Pago', titleX, 23);

        // Receipt number + date (right aligned)
        pdf.setFontSize(9);
        const dateStr = (payment.paidAt instanceof Date ? payment.paidAt : new Date()).toLocaleString('es-AR');
        pdf.text(`N\u00b0 ${payment.receiptNumber}`, W - 15, 16, { align: 'right' });
        pdf.text(dateStr, W - 15, 23, { align: 'right' });

        let y = 50;

        // ── Student / Activity section ──
        const drawSection = (title, rows) => {
            pdf.setFillColor(240, 244, 255);
            pdf.rect(10, y - 5, W - 20, 8, 'F');
            pdf.setTextColor(...blue);
            pdf.setFontSize(10); pdf.setFont('helvetica', 'bold');
            pdf.text(title, 14, y);
            y += 7;
            pdf.setTextColor(...dark);
            pdf.setFont('helvetica', 'normal');
            pdf.setFontSize(10);
            rows.forEach(([label, value]) => {
                pdf.setTextColor(...gray);
                pdf.text(label, 14, y);
                pdf.setTextColor(...dark);
                pdf.text(String(value || '—'), 70, y);
                y += 7;
            });
            y += 4;
        };

        const methodLabels = { cash: 'Efectivo', transfer: 'Transferencia bancaria', mercadopago: 'MercadoPago' };

        drawSection('ALUMNO', [
            ['Nombre', student ? `${student.lastName}, ${student.firstName}` : payment.studentName],
        ]);

        drawSection('ACTIVIDAD', [
            ['Actividad', activity ? activity.name : payment.activityName],
            ['Mes', monthKeyToLabel(payment.monthKey)],
        ]);

        // ── Amounts table ──
        pdf.setFillColor(240, 244, 255);
        pdf.rect(10, y - 5, W - 20, 8, 'F');
        pdf.setTextColor(...blue);
        pdf.setFontSize(10); pdf.setFont('helvetica', 'bold');
        pdf.text('DETALLE DEL PAGO', 14, y);
        y += 9;

        const drawRow = (label, amount, bold = false, color = dark) => {
            pdf.setTextColor(...color);
            pdf.setFont('helvetica', bold ? 'bold' : 'normal');
            pdf.setFontSize(10);
            pdf.text(label, 14, y);
            pdf.text(formatCurrency(amount), W - 15, y, { align: 'right' });
            y += 7;
        };

        drawRow('Cuota mensual', payment.grossAmount);
        if (payment.seguroAmount > 0) drawRow('Seguro', payment.seguroAmount);

        // Divider
        pdf.setDrawColor(200, 200, 200);
        pdf.line(10, y, W - 10, y);
        y += 5;

        drawRow('TOTAL ABONADO', payment.finalAmount, true, blue);
        y += 2;
        drawRow('Medio de pago', 0, false, gray); // label only
        y -= 7; // rewrite same line right side
        pdf.setTextColor(...dark); pdf.setFont('helvetica', 'normal');
        pdf.text(methodLabels[payment.paymentMethod] || payment.paymentMethod, W - 15, y, { align: 'right' });
        y += 12;

        // ── Registered by ──
        pdf.setFontSize(8); pdf.setTextColor(...gray);
        pdf.text(`Registrado por: ${payment.collectedBy?.displayName || payment.collectedBy?.email || currentUser?.displayName || ''}`, 14, y);
        y += 5;

        // ── Footer ──
        pdf.setFillColor(...blue);
        pdf.rect(0, 287, W, 10, 'F');
        pdf.setTextColor(255, 255, 255);
        pdf.setFontSize(8); pdf.setFont('helvetica', 'normal');
        pdf.text('Escuela Deportiva CASTA — Comprobante generado digitalmente', W / 2, 291, { align: 'center' });
        pdf.setFontSize(7);
        pdf.text('Este documento no constituye un comprobante con validez legal. Es un resumen informativo de pago.', W / 2, 296, { align: 'center' });

        // Download
        pdf.save(`recibo-${payment.receiptNumber}.pdf`);
    } catch (err) {
        console.error('PDF generation error:', err);
        showToast('No se pudo generar el PDF. El pago SI fue registrado.', 'error');
    }
}
window.generateReceiptPDF = generateReceiptPDF;

function downloadCSV(rows, filename) {
    const csv = rows.map(row =>
        row.map(cell => {
            const s = String(cell ?? '');
            return s.includes(',') || s.includes('"') || s.includes('\n')
                ? `"${s.replace(/"/g, '""')}"` : s;
        }).join(',')
    ).join('\r\n');

    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement('a'), { href: url, download: filename });
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
}

// ============================================================
// LISTADOS MODULE (replaces old exports)
// ============================================================

// Cache for current listado data (for export)
let _listadoData = { actividad: [], pagos: [], deudores: [], recaudacion: [] };

// ─── Tab switching ────────────────────────────────────────────
function switchListadoTab(tab) {
    document.querySelectorAll('.listados-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    document.querySelectorAll('.listado-panel').forEach(p => p.classList.toggle('hidden', p.id !== `listado-${tab}`));
    if (tab === 'actividad') initListadoActividad();
    if (tab === 'pagos') initListadoPagos();
    if (tab === 'deudores') runListadoDeudores();
    if (tab === 'recaudacion') initListadoRecaudacion();
}
window.switchListadoTab = switchListadoTab;

// Called when user navigates to the page
function initListados() {
    initListadoActividad();
    initListadoPagos();
    runListadoDeudores();
    initListadoRecaudacion();
}

// ─── TAB: POR ACTIVIDAD ───────────────────────────────────────
function initListadoActividad() {
    const sel = document.getElementById('lact-activity');
    if (!sel) return;
    const cur = sel.value;
    sel.innerHTML = `<option value="">— Seleccionar actividad —</option>` +
        activities.filter(a => a.status === 'active').map(a =>
            `<option value="${escHtml(a.id)}" ${a.id === cur ? 'selected' : ''}>${escHtml(a.name)}</option>`).join('');
    if (cur) runListadoActividad();
}

async function runListadoActividad() {
    const actId = document.getElementById('lact-activity').value;
    const infoDiv = document.getElementById('lact-info');
    const emptyDiv = document.getElementById('lact-empty');
    if (!actId) {
        infoDiv.style.display = 'none';
        emptyDiv.style.display = 'flex';
        return;
    }
    emptyDiv.style.display = 'none';
    infoDiv.style.display = 'block';
    showLoading();
    try {
        const act = activities.find(a => a.id === actId);
        const profesor = act?.professorId ? staff.find(p => p.id === act.professorId) : null;

        // Activity info card
        document.getElementById('lact-activity-info').innerHTML = `
            <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px">
                <div>
                    <div style="font-size:18px;font-weight:700">${escHtml(act?.name || '')}</div>
                    <div style="font-size:13px;color:var(--gray-500);margin-top:2px">${daysLabel(act?.days || [])} · ${act?.startTime || ''}–${act?.endTime || ''}</div>
                    ${profesor ? `<div style="font-size:13px;color:var(--gray-600);margin-top:4px">👨‍🏫 ${escHtml(profesor.firstName)} ${escHtml(profesor.lastName)} · ${escHtml(profesor.email || '')}</div>` : '<div style="font-size:12px;color:var(--gray-400);margin-top:4px">Sin profesor asignado</div>'}
                </div>
                <div style="text-align:right">
                    <div style="font-size:20px;font-weight:800;color:var(--blue)">${formatCurrency(act?.currentFee || 0)}<span style="font-size:12px;font-weight:400">/mes</span></div>
                    <span class="badge ${act?.status === 'active' ? 'badge-green' : 'badge-gray'}">${act?.status === 'active' ? 'Activa' : 'Inactiva'}</span>
                </div>
            </div>`;

        // Students
        const enrollSnap = await getDocs(query(collection(db, 'enrollments'), where('activityId', '==', actId)));
        const enrolled = enrollSnap.docs
            .map(d => students.find(s => s.id === d.data().studentId))
            .filter(Boolean)
            .filter(s => s.active !== false)
            .sort((a, b) => a.lastName.localeCompare(b.lastName, 'es'));

        document.getElementById('lact-count').textContent = enrolled.length;
        _listadoData.actividad = enrolled.map(s => ({
            nombre: `${s.lastName}, ${s.firstName}`,
            telefono: s.guardianPhone || (s.guardian && s.guardian.phone) || '',
            colegio: s.school || '',
            curso: s.grade || '',
            actividad: act?.name || ''
        }));

        document.getElementById('lact-students').innerHTML = enrolled.length === 0
            ? `<div class="empty-state">Sin alumnos inscriptos</div>`
            : enrolled.map((s, i) => {
                const phone = s.guardianPhone || (s.guardian && s.guardian.phone) || '';
                return `<div class="listado-row">
                    <div style="width:24px;text-align:center;font-size:13px;color:var(--gray-400);font-weight:600">${i + 1}</div>
                    <div class="listado-row-main">
                        <div class="listado-row-title">${escHtml(s.lastName)}, ${escHtml(s.firstName)}</div>
                        <div class="listado-row-sub">${phone ? '📞 ' + escHtml(phone) : ''}${s.school ? ' · 🏫 ' + escHtml(s.school) : ''}${s.grade ? ' · ' + escHtml(s.grade) : ''}</div>
                    </div>
                </div>`;
            }).join('');
    } catch (e) { showToast('Error: ' + e.message, 'error'); }
    finally { hideLoading(); }
}
window.runListadoActividad = runListadoActividad;

// ─── TAB: PAGOS POR MES ───────────────────────────────────────
function initListadoPagos() {
    // Set default month to current month
    const monthInput = document.getElementById('lpag-month');
    if (monthInput && !monthInput.value) {
        const now = new Date();
        monthInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }
    const sel = document.getElementById('lpag-activity');
    if (sel) {
        sel.innerHTML = `<option value="">Todas</option>` +
            activities.filter(a => a.status === 'active').map(a =>
                `<option value="${escHtml(a.id)}">${escHtml(a.name)}</option>`).join('');
    }
    runListadoPagos();
}

async function runListadoPagos() {
    const monthKey = (document.getElementById('lpag-month')?.value || '').replace('-', '-');
    const actFilter = document.getElementById('lpag-activity')?.value || '';
    const statusFilter = document.querySelector('input[name="lpag-filter"]:checked')?.value || 'all';
    const listEl = document.getElementById('lpag-list');
    const sumEl = document.getElementById('lpag-summary');
    if (!monthKey || !listEl) return;

    showLoading();
    try {
        let q = query(collection(db, 'payments'), where('monthKey', '==', monthKey));
        const snap = await getDocs(q);
        let pmts = snap.docs.map(d => ({ id: d.id, ...d.data() }));

        // Filter out payments from inactive students
        pmts = pmts.filter(p => {
            const s = students.find(st => st.id === p.studentId);
            return s && s.active !== false;
        });

        if (actFilter) pmts = pmts.filter(p => p.activityId === actFilter);
        if (statusFilter === 'paid') pmts = pmts.filter(p => p.status === 'paid');
        if (statusFilter === 'pending') pmts = pmts.filter(p => p.status !== 'paid');

        // For "pending" we also need to add enrollments with no payment
        let rows = [...pmts];
        if (statusFilter !== 'paid') {
            // Add missing payments (enrolled but no payment doc)
            const enrollSnap = await getDocs(collection(db, 'enrollments'));
            for (const ed of enrollSnap.docs) {
                const enr = ed.data();
                if (actFilter && enr.activityId !== actFilter) continue;
                const existing = pmts.find(p => p.studentId === enr.studentId && p.activityId === enr.activityId);
                if (!existing) {
                    const s = students.find(st => st.id === enr.studentId);
                    const a = activities.find(ac => ac.id === enr.activityId);
                    if (s && s.active !== false) {
                        rows.push({
                            studentId: enr.studentId,
                            studentName: `${s.lastName}, ${s.firstName}`,
                            activityId: enr.activityId,
                            activityName: a?.name || enr.activityId,
                            monthKey, status: 'pending',
                            finalAmount: 0, grossAmount: a?.currentFee || 0,
                        });
                    }
                }
            }
        }
        rows.sort((a, b) => (a.studentName || '').localeCompare(b.studentName || '', 'es'));

        const totalPaid = rows.filter(p => p.status === 'paid').reduce((s, p) => s + (p.finalAmount || 0), 0);
        const cntPaid = rows.filter(p => p.status === 'paid').length;
        const cntPend = rows.filter(p => p.status !== 'paid').length;
        sumEl.textContent = `${rows.length} registros · ${cntPaid} pagados (${formatCurrency(totalPaid)}) · ${cntPend} pendientes`;

        _listadoData.pagos = rows.map(p => ({
            mes: monthKeyToLabel(monthKey),
            alumno: p.studentName || p.studentId,
            actividad: p.activityName || p.activityId,
            estado: p.status === 'paid' ? 'Pagado' : 'Pendiente',
            monto: p.finalAmount || p.grossAmount || 0,
            comprobante: p.receiptNumber || '',
            metodoPago: p.paymentMethod || '',
        }));

        if (rows.length === 0) {
            listEl.innerHTML = `<div class="empty-state"><div class="empty-state-icon">💳</div>Sin registros para este filtro</div>`;
            return;
        }
        const methodLabel = m => ({ cash: 'Efectivo', transfer: 'Transferencia', mercadopago: 'MercadoPago' }[m] || m || '—');
        listEl.innerHTML = rows.map(p => {
            const paid = p.status === 'paid';
            return `<div class="listado-row">
                <div class="listado-row-main">
                    <div class="listado-row-title">${escHtml(p.studentName || p.studentId)}</div>
                    <div class="listado-row-sub">${escHtml(p.activityName || '')} · ${paid ? methodLabel(p.paymentMethod) : 'Sin pagar'}</div>
                </div>
                <div style="text-align:right">
                    <div style="font-weight:700;font-size:14px;color:${paid ? 'var(--green)' : 'var(--red)'}">${paid ? formatCurrency(p.finalAmount || 0) : '—'}</div>
                    <span class="badge ${paid ? 'badge-green' : 'badge-red'}" style="font-size:10px">${paid ? 'Pagado' : 'Pendiente'}</span>
                </div>
            </div>`;
        }).join('');
    } catch (e) { showToast('Error: ' + e.message, 'error'); }
    finally { hideLoading(); }
}
window.runListadoPagos = runListadoPagos;

// ─── TAB: DEUDORES ────────────────────────────────────────────
async function runListadoDeudores() {
    const search = (document.getElementById('ldeu-search')?.value || '').toLowerCase().trim();
    const listEl = document.getElementById('ldeu-list');
    const sumEl = document.getElementById('ldeu-summary');
    if (!listEl) return;

    listEl.innerHTML = `<div class="loading-spinner">Cargando...</div>`;
    showLoading();
    try {
        const yr = new Date().getFullYear();
        const months = activityMonthKeys({ startDate: `${yr}-03-01`, endDate: `${yr}-12-31` });

        // Get all payments and enrollments
        const [pSnap, eSnap] = await Promise.all([
            getDocs(collection(db, 'payments')),
            getDocs(collection(db, 'enrollments')),
        ]);
        const paymentsMap = new Map();
        pSnap.docs.forEach(d => {
            const p = d.data();
            if (p.status === 'paid') paymentsMap.set(`${p.studentId}_${p.activityId}_${p.monthKey}`, true);
        });

        // Build deudores map
        const deudoresMap = new Map();
        for (const ed of eSnap.docs) {
            const enr = ed.data();
            const s = students.find(st => st.id === enr.studentId);
            if (!s || s.active === false) continue;
            const a = activities.find(ac => ac.id === enr.activityId);
            const actMonths = a ? activityMonthKeys(a) : months;
            let must = actMonths.filter(m => m <= nowMonthKey()); // only months up to today
            let pending = must.filter(m => !paymentsMap.get(`${enr.studentId}_${enr.activityId}_${m}`));
            if (pending.length === 0) continue;

            if (!deudoresMap.has(enr.studentId)) {
                deudoresMap.set(enr.studentId, {
                    student: s, totalPending: 0, deudas: []
                });
            }
            const entry = deudoresMap.get(enr.studentId);
            entry.totalPending += pending.length;
            entry.deudas.push({ activity: a?.name || enr.activityId, months: pending.length });
        }

        let deudores = [...deudoresMap.values()].sort((a, b) => b.totalPending - a.totalPending);

        if (search) {
            deudores = deudores.filter(d =>
                `${d.student.firstName} ${d.student.lastName}`.toLowerCase().includes(search) ||
                String(d.student.dni).includes(search));
        }

        sumEl.textContent = `${deudores.length} alumnos con pagos pendientes`;
        _listadoData.deudores = deudores.map(d => ({
            alumno: `${d.student.lastName}, ${d.student.firstName}`,
            telefono: d.student.guardianPhone || (d.student.guardian && d.student.guardian.phone) || '',
            cuotasPendientes: d.totalPending,
            detalle: d.deudas.map(x => `${x.activity}: ${x.months} cuota(s)`).join(' | '),
        }));

        if (deudores.length === 0) {
            listEl.innerHTML = `<div class="empty-state"><div class="empty-state-icon">🎉</div>No hay deudores</div>`;
            return;
        }
        listEl.innerHTML = deudores.map((d, i) => `
            <div class="listado-row">
                <div style="width:28px;height:28px;border-radius:50%;background:${i < 3 ? 'var(--red-bg)' : 'var(--gray-100)'};color:${i < 3 ? 'var(--red)' : 'var(--gray-600)'};display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0">${i + 1}</div>
                <div class="listado-row-main">
                    <div class="listado-row-title">${escHtml(d.student.lastName)}, ${escHtml(d.student.firstName)}</div>
                    <div class="listado-row-sub">DNI ${d.student.dni} · ${d.deudas.map(x => `${x.activity}: ${x.months} cuota(s)`).join(' · ')}</div>
                </div>
                <span class="badge badge-red" style="font-size:13px;font-weight:800">${d.totalPending}</span>
            </div>`).join('');
    } catch (e) { showToast('Error: ' + e.message, 'error'); }
    finally { hideLoading(); }
}
window.runListadoDeudores = runListadoDeudores;

// ─── TAB: RECAUDACIÓN ─────────────────────────────────────────
function initListadoRecaudacion() {
    const monthInput = document.getElementById('lrec-month');
    if (monthInput && !monthInput.value) {
        const now = new Date();
        monthInput.value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    }
    runListadoRecaudacion();
}

async function runListadoRecaudacion() {
    const monthKeyRaw = document.getElementById('lrec-month')?.value; // YYYY-MM
    if (!monthKeyRaw) return;

    // We want to fetch all 'paid' payments and filter by the 'paidAt' date, not 'monthKey'
    const [targetYear, targetMonth] = monthKeyRaw.split('-');
    
    // We can query all paid payments and filter in memory, or query within a date range
    // Since we don't have indexes explicitly for paidAt and status combo, we query all paid and filter internally
    showLoading();
    try {
        const snap = await getDocs(query(collection(db, 'payments'), where('status', '==', 'paid')));
        const pmts = snap.docs.map(d => ({ id: d.id, ...d.data() }));

        const inMonthPmts = pmts.filter(p => {
            if (!p.paidAt) return false;
            // Parse timestamp/date
            const d = p.paidAt.toDate ? p.paidAt.toDate() : new Date(p.paidAt);
            if (isNaN(d)) return false;
            return String(d.getFullYear()) === targetYear && String(d.getMonth() + 1).padStart(2, '0') === targetMonth;
        });

        const totalsByAct = {};
        
        inMonthPmts.forEach(p => {
            const actName = p.activityName || 'Sin actividad';
            if (!totalsByAct[actName]) {
                totalsByAct[actName] = { cuota: 0, seguro: 0, total: 0 };
            }
            const totalPagado = (p.finalAmount || 0);
            const pagadoSeguro = (p.seguroAmount || 0);
            const pagadoCuota = totalPagado - pagadoSeguro; // Account for any discounts in finalAmount

            totalsByAct[actName].cuota += pagadoCuota;
            totalsByAct[actName].seguro += pagadoSeguro;
            totalsByAct[actName].total += totalPagado;
        });

        // Convert to array and sort by activity name
        const results = Object.keys(totalsByAct).sort().map(actName => ({
            actividad: actName,
            recaudacionCuota: totalsByAct[actName].cuota,
            recaudacionSeguro: totalsByAct[actName].seguro,
            total: totalsByAct[actName].total
        }));

        let grandSumTotal = 0;
        let grandSumCuota = 0;
        let grandSumSeguro = 0;
        results.forEach(r => {
            grandSumTotal += r.total;
            grandSumCuota += r.recaudacionCuota;
            grandSumSeguro += r.recaudacionSeguro;
        });

        // Store data for export
        _listadoData.recaudacion = results.map(r => ({
            actividad: r.actividad,
            cuota: formatCurrency(r.recaudacionCuota),
            seguro: formatCurrency(r.recaudacionSeguro),
            total: formatCurrency(r.total)
        }));
        
        // Add grand total as last row for export
        if (results.length > 0) {
             _listadoData.recaudacion.push({
                 actividad: 'TOTALES',
                 cuota: formatCurrency(grandSumCuota),
                 seguro: formatCurrency(grandSumSeguro),
                 total: formatCurrency(grandSumTotal)
             });
        }

        const listEl = document.getElementById('lrec-list');
        const sumEl = document.getElementById('lrec-summary');
        
        sumEl.textContent = `Total recaudado: ${formatCurrency(grandSumTotal)}`;

        if (results.length === 0) {
            listEl.innerHTML = `<div class="empty-state"><div class="empty-state-icon">💰</div>No hay cobros registrados en este mes.</div>`;
        } else {
             const rows = results.map(r => `
                <div class="listado-row">
                    <div class="listado-row-main" style="flex:2">
                        <div class="listado-row-title">${escHtml(r.actividad)}</div>
                        <div class="listado-row-sub">Cuota: ${formatCurrency(r.recaudacionCuota)} · Seguro: ${formatCurrency(r.recaudacionSeguro)}</div>
                    </div>
                    <div style="font-weight:700; color:var(--blue)">
                        ${formatCurrency(r.total)}
                    </div>
                </div>
            `).join('');
            
            listEl.innerHTML = rows + `
                 <div class="listado-row" style="background:var(--blue-50); border-top:2px solid var(--blue-200);">
                    <div class="listado-row-main" style="flex:2">
                        <div class="listado-row-title" style="color:var(--blue-900)">TOTAL GENERAL</div>
                        <div class="listado-row-sub">Cuota: ${formatCurrency(grandSumCuota)} · Seguro: ${formatCurrency(grandSumSeguro)}</div>
                    </div>
                    <div style="font-weight:800; font-size:16px; color:var(--blue-700)">
                        ${formatCurrency(grandSumTotal)}
                    </div>
                </div>
            `;
        }

    } catch (err) {
        showToast('Error: ' + err.message, 'error');
    } finally {
        hideLoading();
    }
}
window.runListadoRecaudacion = runListadoRecaudacion;

// ─── Exports ──────────────────────────────────────────────────
function listadoExportCSV(tab) {
    const data = _listadoData[tab] || [];
    if (data.length === 0) { showToast('No hay datos para exportar', 'error'); return; }
    const headers = Object.keys(data[0]).map(k => k.charAt(0).toUpperCase() + k.slice(1));
    const rows = [headers, ...data.map(r => Object.values(r))];
    downloadCSV(rows, `listado_${tab}_${new Date().toISOString().slice(0, 10)}.csv`);
    showToast('CSV descargado ✓', 'success');
}
window.listadoExportCSV = listadoExportCSV;

async function listadoExportPDF(tab) {
    const data = _listadoData[tab] || [];
    if (data.length === 0) { showToast('No hay datos para exportar', 'error'); return; }
    try {
        const { jsPDF } = window.jspdf;
        const pdf = new jsPDF({ unit: 'mm', format: 'a4' });
        const W = 210;
        const titles = { actividad: 'Por Actividad', pagos: 'Pagos por Mes', deudores: 'Deudores', recaudacion: 'Recaudación' };

        // Header
        pdf.setFillColor(21, 101, 192);
        pdf.rect(0, 0, W, 20, 'F');

        const logoB64 = await getLogoBase64();
        let titleX = 14;
        if (logoB64) {
            pdf.addImage(logoB64, 'PNG', 12, 4, 12, 12);
            titleX = 28;
        }

        pdf.setTextColor(255, 255, 255);
        pdf.setFontSize(14); pdf.setFont(undefined, 'bold');
        pdf.text('Escuela Deportiva CASTA', titleX, 9);
        pdf.setFontSize(10); pdf.setFont(undefined, 'normal');
        pdf.text(`Listado: ${titles[tab]} · ${new Date().toLocaleDateString('es-AR')}`, titleX, 16);

        pdf.setTextColor(0, 0, 0);
        const headers = Object.keys(data[0]);
        const colW = (W - 28) / headers.length;
        let y = 28;

        // Table header
        pdf.setFillColor(227, 242, 253);
        pdf.rect(14, y - 5, W - 28, 8, 'F');
        pdf.setFontSize(8); pdf.setFont(undefined, 'bold');
        headers.forEach((h, i) => pdf.text(h.charAt(0).toUpperCase() + h.slice(1), 14 + i * colW, y, { maxWidth: colW - 1 }));
        y += 6;
        pdf.setFont(undefined, 'normal');

        for (const row of data) {
            if (y > 275) { pdf.addPage(); y = 20; }
            const vals = Object.values(row);
            vals.forEach((v, i) => {
                const txt = String(v ?? '');
                pdf.text(txt, 14 + i * colW, y, { maxWidth: colW - 1 });
            });
            pdf.setDrawColor(220, 220, 220);
            pdf.line(14, y + 2, W - 14, y + 2);
            y += 7;
        }

        pdf.setFontSize(8); pdf.setTextColor(150);
        pdf.text(`Total: ${data.length} registros`, 14, 285);
        pdf.save(`listado_${tab}_${new Date().toISOString().slice(0, 10)}.pdf`);
        showToast('PDF descargado ✓', 'success');
    } catch (e) { showToast('Error PDF: ' + e.message, 'error'); }
}
window.listadoExportPDF = listadoExportPDF;

// Kept for backward compatibility (dashboard uses navigate to 'exports')
function initListadosOnNavigate() {
    // Populate activity selects and run default tab
    setTimeout(() => initListados(), 50);
}



// ============================================================
// EXPOSE form submit handlers
// ============================================================
window.saveStudent = saveStudent;

// ============================================================
// STAFF / PROFESSORS MODULE
// ============================================================
let staff = [];
let staffUnsub = null;

function loadStaff() {
    return new Promise((resolve) => {
        staffUnsub = onSnapshot(collection(db, 'staff'), snap => {
            staff = snap.docs
                .map(d => ({ id: d.id, ...d.data() }))
                .sort((a, b) => (a.lastName || '').localeCompare(b.lastName || '', 'es'));
            if (currentPage === 'staff') renderStaffList();
            populateProfessorSelect();
            resolve();
        }, err => { console.error('staff error:', err); resolve(); });
    });
}

function renderStaffList() {
    const list = document.getElementById('staff-list');
    if (!list) return;
    if (staff.length === 0) {
        list.innerHTML = `<div class="empty-state"><div class="empty-state-icon">👨‍🏫</div>No hay profesores registrados aún</div>`;
        return;
    }
    list.innerHTML = staff.map(p => `
        <div class="student-card">
            <div class="student-avatar" style="background:#ede9fe;color:#7c3aed">${escHtml(initials(p.firstName, p.lastName))}</div>
            <div class="student-info">
                <div class="student-name">${escHtml(p.lastName)}, ${escHtml(p.firstName)}</div>
                <div class="student-meta">${escHtml(p.email || '')}${p.phone ? ' · ' + escHtml(p.phone) : ''}</div>
                <div class="student-meta" style="margin-top:4px;gap:4px;display:flex;flex-wrap:wrap">
                    ${p.specialty ? `<span class="badge badge-blue" style="font-size:11px">${escHtml(p.specialty)}</span>` : ''}
                    <span class="badge ${p.active !== false ? 'badge-green' : 'badge-gray'}" style="font-size:11px">${p.active !== false ? 'Activo' : 'Inactivo'}</span>
                    <span class="badge ${p.linkedUid ? 'badge-green' : 'badge-gray'}" style="font-size:11px">${p.linkedUid ? '✓ Vinculado' : 'Sin vincular'}</span>
                </div>
            </div>
            <div class="student-actions">
                <button class="btn-icon" style="color:var(--gray-600)" onclick="openStaffForm('${escHtml(p.id)}')">✏️</button>
            </div>
        </div>`).join('');
}

function openStaffForm(id) {
    const professor = id ? staff.find(p => p.id === id) : null;
    document.getElementById('modal-staff-title').textContent = professor ? 'Editar Profesor' : 'Nuevo Profesor';
    document.getElementById('form-staff').reset();
    if (professor) {
        document.getElementById('p-firstName').value = professor.firstName || '';
        document.getElementById('p-lastName').value = professor.lastName || '';
        document.getElementById('p-email').value = professor.email || '';
        document.getElementById('p-phone').value = professor.phone || '';
        document.getElementById('p-specialty').value = professor.specialty || '';
        document.getElementById('p-active').value = String(professor.active !== false);
    }
    document.getElementById('form-staff').dataset.editId = professor ? professor.id : '';

    // Delete button: only for admins editing existing professor
    const delBtn = document.getElementById('btn-delete-staff');
    if (delBtn) delBtn.classList.toggle('hidden', !canEdit() || !professor);

    openModal('modal-staff');
}
window.openStaffForm = openStaffForm;

async function deleteStaff() {
    if (!canEdit()) return;
    const editId = document.getElementById('form-staff').dataset.editId;
    if (!editId) return;
    const prof = staff.find(p => p.id === editId);
    if (!confirm(`¿Eliminar al profesor "${prof ? prof.firstName + ' ' + prof.lastName : editId}"?\n\nEsta acción no se puede deshacer.`)) return;
    try {
        await deleteDoc(doc(db, 'staff', editId));
        // Unlink from user if linked
        if (prof?.linkedUid) {
            await setDoc(doc(db, 'users', prof.linkedUid), { staffId: null }, { merge: true });
        }
        showToast('Profesor eliminado ✓', 'success');
        closeModal('modal-staff');
    } catch (err) { showToast('Error: ' + err.message, 'error'); }
}
window.deleteStaff = deleteStaff;


async function saveStaff(e) {
    e.preventDefault();
    const btn = document.getElementById('btn-save-staff');
    const editId = document.getElementById('form-staff').dataset.editId;
    const isEdit = !!editId;
    const email = document.getElementById('p-email').value.trim().toLowerCase();

    const data = {
        firstName: document.getElementById('p-firstName').value.trim(),
        lastName: document.getElementById('p-lastName').value.trim(),
        email,
        phone: document.getElementById('p-phone').value.trim(),
        specialty: document.getElementById('p-specialty').value.trim(),
        active: document.getElementById('p-active').value === 'true',
        updatedAt: serverTimestamp(),
        updatedBy: currentUser.uid,
    };
    if (!isEdit) { data.createdAt = serverTimestamp(); data.createdBy = currentUser.uid; data.linkedUid = null; }

    const ref = isEdit ? doc(db, 'staff', editId) : doc(collection(db, 'staff'));
    btn.disabled = true; btn.textContent = 'Guardando...';
    try {
        await setDoc(ref, data, { merge: isEdit });
        // Try to link an existing user with this email
        await tryLinkStaffByEmail(email, ref.id);
        showToast(isEdit ? 'Profesor actualizado ✓' : 'Profesor registrado ✓', 'success');
        closeModal('modal-staff');
    } catch (err) {
        showToast('Error: ' + err.message, 'error');
    } finally {
        btn.disabled = false; btn.textContent = 'Guardar';
    }
}
window.saveStaff = saveStaff;

async function tryLinkStaffByEmail(email, staffId) {
    if (!email) return;
    try {
        const usersSnap = await getDocs(query(collection(db, 'users'), where('email', '==', email)));
        if (!usersSnap.empty) {
            const userDoc = usersSnap.docs[0];
            await setDoc(doc(db, 'staff', staffId), { linkedUid: userDoc.id }, { merge: true });
            await setDoc(doc(db, 'users', userDoc.id), { role: 'prof', active: true, staffId }, { merge: true });
            showToast('Profesor vinculado a su cuenta Google ✓', 'success');
        }
    } catch (err) { console.warn('tryLinkStaffByEmail:', err.message); }
}

async function linkStaffOnLogin(user) {
    if (!user?.email) return;
    const email = user.email.toLowerCase();
    try {
        const staffSnap = await getDocs(query(collection(db, 'staff'), where('email', '==', email)));
        if (!staffSnap.empty) {
            const staffDoc = staffSnap.docs[0];
            const isActive = staffDoc.data().active !== false;
            await setDoc(doc(db, 'staff', staffDoc.id), { linkedUid: user.uid }, { merge: true });
            await setDoc(doc(db, 'users', user.uid), {
                role: 'prof', active: isActive, staffId: staffDoc.id
            }, { merge: true });
        }
    } catch (err) { console.warn('linkStaffOnLogin:', err.message); }
}

function populateProfessorSelect(currentProfId) {
    const sel = document.getElementById('a-professor');
    if (!sel) return;
    const prev = currentProfId !== undefined ? currentProfId : sel.value;
    sel.innerHTML = '<option value="">— Sin asignar —</option>' +
        staff.filter(p => p.active !== false).map(p =>
            `<option value="${escHtml(p.id)}">${escHtml(p.lastName)}, ${escHtml(p.firstName)}</option>`
        ).join('');
    if (prev) sel.value = prev;
}

// ─── Extend navigate to handle staff page ────────────────────
const _nav0 = navigate;
window.navigate = function (page) {
    _nav0(page);
    if (page === 'staff') renderStaffList();
};

// loadAllData already calls loadStaff() via the patch in the original function above.

// ─── Override openActivityForm to populate professor list ────
const _openActForm0 = openActivityForm;
window.openActivityForm = function (id) {
    _openActForm0(id);
    const activity = id ? activities.find(a => a.id === id) : null;
    populateProfessorSelect(activity ? (activity.professorId || '') : '');
};

// ─── Override saveActivity to include professor field ────────
window.saveActivity = async function (e) {
    e.preventDefault();
    const btn = document.getElementById('btn-save-activity');
    const editId = document.getElementById('form-activity').dataset.editId;
    const isEdit = !!editId;

    const days = [...document.querySelectorAll('#a-days input:checked')].map(cb => +cb.value);
    if (days.length === 0) { showToast('Seleccioná al menos un día', 'error'); return; }

    const professorId = document.getElementById('a-professor').value || null;
    const professorObj = staff.find(p => p.id === professorId);

    const data = {
        name: document.getElementById('a-name').value.trim(),
        days,
        startTime: document.getElementById('a-startTime').value,
        endTime: document.getElementById('a-endTime').value,
        currentFee: parseFloat(document.getElementById('a-fee').value),
        status: document.getElementById('a-status').value,
        professorId: professorId,
        professorName: professorObj ? `${professorObj.firstName} ${professorObj.lastName}` : null,
        updatedAt: serverTimestamp(),
        updatedBy: currentUser.uid,
    };
    if (!isEdit) { data.createdAt = serverTimestamp(); data.createdBy = currentUser.uid; data.feeHistory = []; }

    const ref = isEdit ? doc(db, 'activities', editId) : doc(collection(db, 'activities'));
    btn.disabled = true; btn.textContent = 'Guardando...';
    try {
        await setDoc(ref, data, { merge: isEdit });
        showToast(isEdit ? 'Actividad actualizada ✓' : 'Actividad creada ✓', 'success');
        closeModal('modal-activity');
    } catch (err) {
        showToast('Error: ' + err.message, 'error');
    } finally {
        btn.disabled = false; btn.textContent = 'Guardar';
    }
};

// ─── Hook linkStaffOnLogin into the auth flow ────────────────
// Called after a successful login session to auto-link the prof
window.onAfterLogin = linkStaffOnLogin;

// ============================================================
// USERS MANAGEMENT MODULE (admin only)
// ============================================================

// ── Show/hide nav item based on role ─────────────────────────
function syncUsersNavVisibility() {
    const li = document.getElementById('nav-users');
    if (li) li.classList.toggle('hidden', !canEdit());
}

// ── Inject the page template into main on first visit ────────
function ensureUsersPageInDom() {
    if (document.getElementById('page-users')) return;
    const tpl = document.getElementById('tpl-page-users');
    if (!tpl) return;
    const clone = tpl.content.cloneNode(true);
    document.querySelector('.main-content').appendChild(clone);
}

// ── Navigate override: handle 'users' page ───────────────────
const _nav1 = window.navigate;
window.navigate = function (page) {
    if (page === 'users' && !canEdit()) {
        showToast('Solo administradores pueden acceder a Usuarios', 'error');
        return;
    }
    _nav1(page);
    if (page === 'users') {
        ensureUsersPageInDom();
        // Small delay to let DOM settle after class toggling
        setTimeout(() => renderUsersPage(), 50);
    }
};

// ── Render the full users page ────────────────────────────────
async function renderUsersPage() {
    showLoading();
    try {
        // Load all users
        const usersSnap = await getDocs(collection(db, 'users'));
        const allUsers = usersSnap.docs.map(d => ({ id: d.id, ...d.data() }))
            .sort((a, b) => (a.displayName || a.email || '').localeCompare(b.displayName || b.email || '', 'es'));

        // Load pending invites
        const invSnap = await getDocs(query(collection(db, 'invites'), where('accepted', '==', false)));
        const invites = invSnap.docs.map(d => ({ id: d.id, ...d.data() }));

        // Update invite count badge
        const countBadge = document.getElementById('inv-count');
        if (countBadge) countBadge.textContent = invites.length;

        // Render pending invites
        const invList = document.getElementById('pending-invites-list');
        if (invList) {
            if (invites.length === 0) {
                invList.innerHTML = `<div class="empty-state" style="padding:12px">Sin invitaciones pendientes</div>`;
            } else {
                invList.innerHTML = invites.map(inv => `
                    <div class="student-card" style="padding:12px 16px">
                        <div class="student-info">
                            <div class="student-name">${escHtml(inv.name || inv.email)}</div>
                            <div class="student-meta">${escHtml(inv.email)} · Invitado por ${escHtml(inv.invitedByName || '')}</div>
                        </div>
                        <div class="student-actions">
                            <button class="btn-icon" style="color:var(--red,#ef4444)" title="Cancelar invitación"
                                onclick="cancelInvite('${escHtml(inv.id)}')">🗑️</button>
                        </div>
                    </div>`).join('');
            }
        }

        // Render registered users
        const roleLabel = { admin: '🔑 Admin', prof: '👨‍🏫 Profesor' };
        const usersList = document.getElementById('users-list');
        if (usersList) {
            if (allUsers.length === 0) {
                usersList.innerHTML = `<div class="empty-state"><div class="empty-state-icon">👥</div>Sin usuarios registrados aún</div>`;
            } else {
                usersList.innerHTML = allUsers.map(u => {
                    const isMe = u.id === currentUser?.uid;
                    return `
                    <div class="student-card">
                        <div class="student-avatar" style="background:${u.role === 'admin' ? '#fef3c7' : '#ede9fe'};color:${u.role === 'admin' ? '#92400e' : '#7c3aed'}">
                            ${u.photoURL ? `<img src="${escHtml(u.photoURL)}" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover">` : escHtml(initials(u.displayName?.split(' ')[0] || 'U', u.displayName?.split(' ')[1] || ''))}
                        </div>
                        <div class="student-info">
                            <div class="student-name">${escHtml(u.displayName || u.email)}${isMe ? ' <span style="font-size:11px;color:var(--gray-400)">(vos)</span>' : ''}</div>
                            <div class="student-meta">${escHtml(u.email || '')}</div>
                            <div class="student-meta" style="margin-top:4px;gap:4px;display:flex;flex-wrap:wrap">
                                <span class="badge ${u.role === 'admin' ? 'badge-blue' : 'badge-gray'}" style="font-size:11px">${roleLabel[u.role] || u.role}</span>
                                <span class="badge ${u.active ? 'badge-green' : 'badge-gray'}" style="font-size:11px">${u.active ? 'Activo' : 'Inactivo'}</span>
                            </div>
                        </div>
                        ${!isMe ? `
                        <div class="student-actions">
                            <button class="btn-icon" style="color:var(--gray-600)" title="Editar usuario"
                                onclick="openChangeRoleModal('${escHtml(u.id)}','${escHtml(u.displayName || u.email)}','${escHtml(u.role)}','${u.active}')">✏️</button>
                        </div>` : ''}
                    </div>`;
                }).join('');
            }
        }
    } catch (err) {
        showToast('Error cargando usuarios: ' + err.message, 'error');
    } finally {
        hideLoading();
    }
}

// ── Invite modal ──────────────────────────────────────────────
function openInviteModal() {
    document.getElementById('form-invite').reset();
    openModal('modal-invite');
}
window.openInviteModal = openInviteModal;

async function saveInvite(e) {
    e.preventDefault();
    if (!canEdit()) return;
    const btn = document.getElementById('btn-save-invite');
    const email = document.getElementById('inv-email').value.trim().toLowerCase();
    const name = document.getElementById('inv-name').value.trim();

    btn.disabled = true; btn.textContent = 'Guardando...';
    try {
        // Check if user already exists
        const existing = await getDocs(query(collection(db, 'users'), where('email', '==', email)));
        if (!existing.empty) {
            const u = existing.docs[0].data();
            showToast(`Ya existe una cuenta con ese email (${u.role})`, 'error');
            return;
        }
        // Check for duplicate invite
        const dupInv = await getDocs(query(collection(db, 'invites'), where('email', '==', email), where('accepted', '==', false)));
        if (!dupInv.empty) {
            showToast('Ya hay una invitación pendiente para ese email', 'error');
            return;
        }

        await setDoc(doc(collection(db, 'invites')), {
            email,
            name,
            role: 'admin',
            accepted: false,
            invitedByUid: currentUser.uid,
            invitedByName: currentUser.displayName || currentUser.email || '',
            createdAt: serverTimestamp(),
        });

        showToast(`Invitación guardada ✓ — ${email} quedará como admin al iniciar sesión`, 'success');
        closeModal('modal-invite');
        renderUsersPage();
    } catch (err) {
        showToast('Error: ' + err.message, 'error');
    } finally {
        btn.disabled = false; btn.textContent = 'Enviar invitación';
    }
}
window.saveInvite = saveInvite;

async function cancelInvite(inviteId) {
    if (!canEdit()) return;
    if (!confirm('¿Cancelar esta invitación?')) return;
    try {
        await deleteDoc(doc(db, 'invites', inviteId));
        showToast('Invitación cancelada ✓', 'success');
        renderUsersPage();
    } catch (err) {
        showToast('Error: ' + err.message, 'error');
    }
}
window.cancelInvite = cancelInvite;

// ── Change role modal ─────────────────────────────────────────
function openChangeRoleModal(uid, name, role, active) {
    document.getElementById('role-user-name').textContent = name;
    document.getElementById('role-select').value = role;
    document.getElementById('role-active').value = String(active) === 'true' ? 'true' : 'false';
    document.getElementById('form-change-role').dataset.uid = uid;
    openModal('modal-change-role');
}
window.openChangeRoleModal = openChangeRoleModal;

async function saveUserRole(e) {
    e.preventDefault();
    if (!canEdit()) return;
    const uid = document.getElementById('form-change-role').dataset.uid;
    const role = document.getElementById('role-select').value;
    const active = document.getElementById('role-active').value === 'true';

    try {
        await setDoc(doc(db, 'users', uid), {
            role,
            active,
            updatedAt: serverTimestamp(),
            updatedBy: currentUser.uid,
        }, { merge: true });
        showToast('Usuario actualizado ✓', 'success');
        closeModal('modal-change-role');
        renderUsersPage();
    } catch (err) {
        showToast('Error: ' + err.message, 'error');
    }
}
window.saveUserRole = saveUserRole;

async function deleteUser() {
    if (!canEdit()) { showToast('Solo administradores pueden eliminar usuarios', 'error'); return; }
    const uid = document.getElementById('form-change-role').dataset.uid;
    if (!uid) return;
    if (uid === currentUser?.uid) { showToast('No pod\u00e9s eliminar tu propia cuenta', 'error'); return; }

    const name = document.getElementById('role-user-name').textContent;
    if (!confirm(`\u00bfEliminar al usuario "${name}"?\n\nEsta acci\u00f3n elimina su registro del sistema. Si vuelve a iniciar sesi\u00f3n quedar\u00e1 nuevamente inactivo.`)) return;
    try {
        await deleteDoc(doc(db, 'users', uid));
        showToast('Usuario eliminado \u2713', 'success');
        closeModal('modal-change-role');
        renderUsersPage();
    } catch (err) { showToast('Error: ' + err.message, 'error'); }
}
window.deleteUser = deleteUser;

// ── Auto-accept invite on login ───────────────────────────────
async function checkAndAcceptInvite(user) {
    if (!user?.email) return null;
    const email = user.email.toLowerCase();
    try {
        const invSnap = await getDocs(query(
            collection(db, 'invites'),
            where('email', '==', email),
            where('accepted', '==', false)
        ));
        if (invSnap.empty) return null;

        const invDoc = invSnap.docs[0];
        const invData = invDoc.data();

        // Mark invite as accepted
        await setDoc(doc(db, 'invites', invDoc.id), {
            accepted: true,
            acceptedAt: serverTimestamp(),
            acceptedUid: user.uid,
        }, { merge: true });

        // Update/upgrade the user doc to admin + active
        await setDoc(doc(db, 'users', user.uid), {
            role: invData.role || 'admin',
            active: true,
        }, { merge: true });

        console.log(`Invite accepted: ${email} is now ${invData.role}`);
        return invData.role;
    } catch (err) {
        console.warn('checkAndAcceptInvite error:', err.message);
        return null;
    }
}

// ── Hook into onAuthStateChanged (called after user doc is confirmed) ──
// Patch the first-login flow to check invites before deciding role
window._checkAndAcceptInvite = checkAndAcceptInvite;
