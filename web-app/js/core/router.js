import { $ } from '../utils/helpers.js';

export let currentPage = 'dashboard';

export function navigate(page) {
    document.querySelectorAll('.page').forEach(p => {
        p.classList.remove('active');
        p.classList.add('hidden');
    });
    
    const target = $(`page-${page}`);
    if (target) {
        target.classList.remove('hidden');
        target.classList.add('active');
    }
    
    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.page === page);
    });
    
    const titles = {
        dashboard: 'Dashboard', students: 'Alumnos', activities: 'Actividades',
        attendance: 'Asistencia', payments: 'Pagos', exports: 'Listados', users: 'Usuarios'
    };
    if ($('topbar-page-title')) {
        $('topbar-page-title').textContent = titles[page] || 'Escuela Deportiva CASTA';
    }
    currentPage = page;
    closeSidebar();

    // Throw event so that independent modules can listen and load themselves 
    window.dispatchEvent(new CustomEvent('page-navigate', { detail: { page } }));
}

export function toggleSidebar() {
    $('sidebar')?.classList.toggle('open');
}

export function closeSidebar() {
    $('sidebar')?.classList.remove('open');
}

export function initRouter() {
    document.querySelectorAll('.nav-item').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const page = btn.dataset.page;
            if (page) navigate(page);
        });
    });

    document.addEventListener('click', (e) => {
        if (e.target.classList.contains('sidebar-overlay') || e.target.closest('[data-action="closeSidebar"]')) {
            closeSidebar();
        }
        
        const overlayId = e.target.dataset.modalOverlay;
        if (overlayId) {
            document.getElementById(overlayId)?.classList.add('hidden');
            document.body.style.overflow = '';
        }

        const closeBtn = e.target.closest('[data-close-modal]');
        if (closeBtn) {
            const modalId = closeBtn.dataset.closeModal;
            document.getElementById(modalId)?.classList.add('hidden');
            document.body.style.overflow = '';
        }
    });

    const toggleBtn = document.getElementById('btn-toggle-sidebar');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', toggleSidebar);
    }
}
