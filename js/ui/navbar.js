/**
 * Navbar Module
 * Handles scroll-based navbar styling + dropdown hover con timer.
 */

export function initNavbar() {
    const navbar = document.querySelector('.navbar');
    if (!navbar) return;

    window.addEventListener('scroll', () => {
        navbar.classList.toggle('scrolled', window.scrollY > 50);
    });

    initDropdowns(navbar);
}

function initDropdowns(navbar) {
    // Per ogni coppia nav-item.has-dropdown ↔ nav-dropdown-panel
    navbar.querySelectorAll('.nav-item.has-dropdown').forEach(item => {
        const panelName = item.dataset.dropdown;
        const panel = navbar.querySelector(`[data-panel="${panelName}"]`);
        if (!panel) return;

        let closeTimer = null;

        const open = () => {
            clearTimeout(closeTimer);
            navbar.classList.add('dropdown-active');
            panel.classList.add('panel-active');
        };

        const scheduleClose = () => {
            closeTimer = setTimeout(() => {
                navbar.classList.remove('dropdown-active');
                panel.classList.remove('panel-active');
            }, 150); // 150ms di grazia per spostarsi sul panel
        };

        item.addEventListener('mouseenter', open);
        item.addEventListener('mouseleave', scheduleClose);
        panel.addEventListener('mouseenter', open);
        panel.addEventListener('mouseleave', scheduleClose);
    });
}
