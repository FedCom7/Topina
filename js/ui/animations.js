/**
 * Animations Module
 * Scroll-triggered animations, counter effects, and table row staggering.
 */

/**
 * Format number with commas (e.g. 1234 → "1,234")
 */
export function formatNumber(num) {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Initialize scroll-triggered fade-in animations via IntersectionObserver
 */
export function initScrollAnimations() {
    const elements = document.querySelectorAll('.animate-on-scroll');

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const delay = entry.target.dataset.delay || 0;
                setTimeout(() => entry.target.classList.add('visible'), delay);
            }
        });
    }, { threshold: 0.1, rootMargin: '0px 0px -50px 0px' });

    elements.forEach(el => observer.observe(el));
}

/**
 * Animate counter elements when they scroll into view
 */
export function initCounterAnimations() {
    const counters = document.querySelectorAll('[data-count]');

    const animateCounter = (counter) => {
        const target = parseInt(counter.dataset.count);
        const duration = 2000;
        const step = target / (duration / 16);
        let current = 0;

        const update = () => {
            current += step;
            if (current < target) {
                counter.textContent = formatNumber(Math.floor(current));
                requestAnimationFrame(update);
            } else {
                counter.textContent = formatNumber(target);
            }
        };
        update();
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting && !entry.target.classList.contains('counted')) {
                entry.target.classList.add('counted');
                animateCounter(entry.target);
            }
        });
    }, { threshold: 0.5 });

    counters.forEach(counter => observer.observe(counter));
}

/**
 * Staggered table row animations
 */
export function initTableAnimations() {
    const rows = document.querySelectorAll('.table-row');

    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry, index) => {
            if (entry.isIntersecting) {
                const rank = entry.target.dataset.rank || index;
                setTimeout(() => entry.target.classList.add('visible'), rank * 100);
            }
        });
    }, { threshold: 0.1 });

    rows.forEach(row => observer.observe(row));
}
