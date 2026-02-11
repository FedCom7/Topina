/**
 * Confetti Module
 * Canvas-based confetti celebration effect.
 */

export function startConfetti() {
    const canvas = document.getElementById('confetti-canvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
    canvas.style.display = 'block';

    const particles = [];
    const colors = ['#ffd700', '#ff6b35', '#00b4d8', '#e63946', '#2a9d8f', '#f4a261'];

    for (let i = 0; i < 150; i++) {
        particles.push({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height - canvas.height,
            w: Math.random() * 10 + 5,
            h: Math.random() * 6 + 3,
            color: colors[Math.floor(Math.random() * colors.length)],
            speed: Math.random() * 3 + 2,
            angle: Math.random() * Math.PI * 2,
            spin: (Math.random() - 0.5) * 0.2,
            drift: (Math.random() - 0.5) * 2,
            opacity: 1
        });
    }

    let startTime = Date.now();
    const duration = 5000;

    function animate() {
        const elapsed = Date.now() - startTime;
        if (elapsed > duration) {
            canvas.style.display = 'none';
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            return;
        }

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const fadeStart = duration * 0.7;
        const globalAlpha = elapsed > fadeStart
            ? 1 - (elapsed - fadeStart) / (duration - fadeStart)
            : 1;

        particles.forEach(p => {
            p.y += p.speed;
            p.x += p.drift;
            p.angle += p.spin;

            ctx.save();
            ctx.translate(p.x, p.y);
            ctx.rotate(p.angle);
            ctx.globalAlpha = globalAlpha * p.opacity;
            ctx.fillStyle = p.color;
            ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
            ctx.restore();

            // Recycle particles that fall off-screen
            if (p.y > canvas.height) {
                p.y = -10;
                p.x = Math.random() * canvas.width;
            }
        });

        requestAnimationFrame(animate);
    }

    animate();
}
