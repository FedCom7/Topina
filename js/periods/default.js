/**
 * Default Period Layout
 * Restores all standard home page elements to their default visibility.
 */

export function activateDefaultLayout() {
    // Show standard home elements
    const showIds = ['parallax-header-normal', 'period-badge', 'period-message', 'period-content', 'home-stats'];
    showIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.style.display = '';
            el.classList.remove('hidden');
        }
    });

    // Hide Super Bowl matchup display
    const sbMatchup = document.getElementById('sb-main-matchup');
    if (sbMatchup) {
        sbMatchup.style.display = 'none';
        sbMatchup.classList.add('hidden');
    }
}
