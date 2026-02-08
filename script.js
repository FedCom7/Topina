/**
 * TOPINA LEAGUE - Fantasy NFL Stats
 * Dynamic Home based on NFL Season Period
 * With Confetti Celebration Effects
 */

document.addEventListener('DOMContentLoaded', () => {
    // Initialize splash screen first (if exists)
    initSplashScreen();

    // Initialize all modules
    initNavbar();
    initScrollAnimations();
    initCounterAnimations();
    initTableAnimations();
    initRoundSelector();
    initParallax();

    // Home page specific
    if (document.getElementById('home')) {
        initSeasonPeriod();
        updateStadiumBackground();
        initDebugSelector();
        // Initialize NFL Phase Indicator from calendar API
        initNFLPhaseIndicator();
    }
});

/**
 * Splash Screen Functionality
 * Handles swipe up and scroll to reveal the main site
 */
function initSplashScreen() {
    const splashScreen = document.getElementById('splash-screen');
    if (!splashScreen) return;

    // Lock body scrolling
    document.body.classList.add('splash-active');

    let touchStartY = 0;
    let touchEndY = 0;
    const swipeThreshold = 50; // Minimum distance for swipe

    // Touch events for mobile swipe
    splashScreen.addEventListener('touchstart', (e) => {
        touchStartY = e.touches[0].clientY;
    }, { passive: true });

    splashScreen.addEventListener('touchmove', (e) => {
        touchEndY = e.touches[0].clientY;
    }, { passive: true });

    splashScreen.addEventListener('touchend', () => {
        const swipeDistance = touchStartY - touchEndY;
        if (swipeDistance > swipeThreshold) {
            dismissSplash();
        }
    });

    // Mouse wheel for desktop
    splashScreen.addEventListener('wheel', (e) => {
        if (e.deltaY > 0) { // Scrolling down means swipe up gesture
            dismissSplash();
        }
    });

    // Click to dismiss as fallback
    splashScreen.addEventListener('click', () => {
        dismissSplash();
    });

    // Keyboard support
    document.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowUp' || e.key === ' ' || e.key === 'Enter') {
            if (!splashScreen.classList.contains('hidden')) {
                dismissSplash();
            }
        }
    });

    function dismissSplash() {
        splashScreen.classList.add('hidden');
        document.body.classList.remove('splash-active');
    }
}

/**
 * NFL Calendar API Configuration
 */
const NFL_CALENDAR_URL = 'https://app.stanzacal.com/api/calendar/webcal/nfl-allgames/61661215437db10008aae4b3/66e197347c4d9fb301eaa25b.ics';

/**
 * Initialize NFL Phase Indicator from calendar API
 */
async function initNFLPhaseIndicator() {
    const indicator = document.getElementById('nfl-phase-indicator');
    const labelElement = document.getElementById('phase-label');
    const emojiElement = indicator?.querySelector('.phase-emoji');

    if (!indicator || !labelElement) return;

    try {
        const phase = await getNFLPhaseFromCalendar();

        // Update label and emoji
        labelElement.textContent = phase.label;
        if (emojiElement) emojiElement.textContent = phase.emoji;

        // Add phase-specific class for styling
        indicator.classList.remove('preseason', 'regular-season', 'playoffs', 'super-bowl', 'offseason', 'draft');
        indicator.classList.add(phase.cssClass);

    } catch (error) {
        console.warn('Could not fetch NFL calendar, using fallback:', error);
        // Fallback to local season detection
        const fallbackPhase = getFallbackNFLPhase();
        labelElement.textContent = fallbackPhase.label;
        if (emojiElement) emojiElement.textContent = fallbackPhase.emoji;
        indicator.classList.add(fallbackPhase.cssClass);
    }
}

/**
 * Fetch and parse the NFL calendar to determine current phase
 */
async function getNFLPhaseFromCalendar() {
    // Use a CORS proxy since the API might block direct browser requests
    // Try direct first, then fall back to proxy
    let icsData;

    try {
        // Try direct fetch first
        const response = await fetch(NFL_CALENDAR_URL);
        if (!response.ok) throw new Error('Direct fetch failed');
        icsData = await response.text();
    } catch (directError) {
        // Try with CORS proxy
        try {
            const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(NFL_CALENDAR_URL)}`;
            const proxyResponse = await fetch(proxyUrl);
            if (!proxyResponse.ok) throw new Error('Proxy fetch failed');
            icsData = await proxyResponse.text();
        } catch (proxyError) {
            throw new Error('Both direct and proxy fetch failed');
        }
    }

    // Parse the ICS data
    const events = parseICSCalendar(icsData);

    // Determine current phase from events
    return determineNFLPhase(events);
}

/**
 * Parse ICS calendar data into event objects
 */
function parseICSCalendar(icsData) {
    const events = [];
    const eventBlocks = icsData.split('BEGIN:VEVENT');

    for (let i = 1; i < eventBlocks.length; i++) {
        const block = eventBlocks[i];
        const endIndex = block.indexOf('END:VEVENT');
        const eventData = block.substring(0, endIndex);

        // Extract date
        const dtStartMatch = eventData.match(/DTSTART:(\d{8}T\d{6}Z?)/);
        const summaryMatch = eventData.match(/SUMMARY:(.+)/);

        if (dtStartMatch && summaryMatch) {
            const dateStr = dtStartMatch[1];
            const year = parseInt(dateStr.substring(0, 4));
            const month = parseInt(dateStr.substring(4, 6)) - 1;
            const day = parseInt(dateStr.substring(6, 8));
            const hour = parseInt(dateStr.substring(9, 11));
            const minute = parseInt(dateStr.substring(11, 13));

            events.push({
                date: new Date(Date.UTC(year, month, day, hour, minute)),
                summary: summaryMatch[1].trim()
            });
        }
    }

    // Sort by date
    events.sort((a, b) => a.date - b.date);

    return events;
}

/**
 * Determine NFL phase based on parsed events and current date
 */
function determineNFLPhase(events) {
    const now = new Date();

    // Filter out past events and get future events
    const futureEvents = events.filter(e => e.date > now);
    const pastEvents = events.filter(e => e.date <= now);

    // Find the current season (based on most recent/upcoming games)
    // NFL season typically runs September to February

    // Check for Super Bowl (usually the last game around early February)
    const superBowlEvent = events.find(e =>
        e.summary.toLowerCase().includes('super bowl') ||
        (e.date.getMonth() === 1 && events.indexOf(e) === events.length - 1)
    );

    // Check if we're near Super Bowl
    if (superBowlEvent) {
        const msUntilSB = superBowlEvent.date - now;
        const daysUntilSB = msUntilSB / (1000 * 60 * 60 * 24);

        if (daysUntilSB >= 0 && daysUntilSB <= 7) {
            return { label: 'Super Bowl Week', emoji: '🏆', cssClass: 'super-bowl' };
        }
        if (daysUntilSB < 0 && daysUntilSB >= -14) {
            return { label: 'Super Bowl Complete', emoji: '🏆', cssClass: 'super-bowl' };
        }
    }

    // Group events by week
    const regularSeasonEvents = events.filter(e => {
        // Regular season: September through early January
        const month = e.date.getMonth();
        return (month >= 8 || month === 0); // Sept (8) through Jan (0)
    });

    if (regularSeasonEvents.length > 0) {
        // Find regular season start/end
        const seasonStart = regularSeasonEvents[0].date;
        const seasonEnd = regularSeasonEvents[regularSeasonEvents.length - 1].date;

        // Check if we're in regular season
        if (now >= seasonStart && now <= seasonEnd) {
            // Calculate current week
            const weekNumber = calculateNFLWeek(now, regularSeasonEvents);

            // Check if playoffs (after week 18, usually)
            if (weekNumber > 18) {
                return { label: 'Playoffs', emoji: '🔥', cssClass: 'playoffs' };
            }

            return { label: `Week ${weekNumber}`, emoji: '🏈', cssClass: 'regular-season' };
        }

        // Before season starts
        if (now < seasonStart) {
            // Check if it's preseason (August)
            if (now.getMonth() === 7) {
                return { label: 'Preseason', emoji: '💪', cssClass: 'preseason' };
            }

            // Check draft period (late April)
            if (now.getMonth() === 3 && now.getDate() >= 20) {
                return { label: 'Draft', emoji: '📋', cssClass: 'draft' };
            }

            return { label: 'Offseason', emoji: '⏳', cssClass: 'offseason' };
        }

        // After regular season
        if (now > seasonEnd) {
            // Check playoffs (January)
            if (now.getMonth() === 0) {
                // Wild Card, Divisional, Conference Championship
                const dayOfMonth = now.getDate();
                if (dayOfMonth <= 7) {
                    return { label: 'Wild Card', emoji: '🔥', cssClass: 'playoffs' };
                } else if (dayOfMonth <= 14) {
                    return { label: 'Divisional Round', emoji: '🔥', cssClass: 'playoffs' };
                } else if (dayOfMonth <= 21) {
                    return { label: 'Conference Championship', emoji: '🔥', cssClass: 'playoffs' };
                } else {
                    return { label: 'Super Bowl Week', emoji: '🏆', cssClass: 'super-bowl' };
                }
            }

            // February (Super Bowl / Post Season)
            if (now.getMonth() === 1) {
                if (now.getDate() <= 15) {
                    return { label: 'Super Bowl Week', emoji: '🏆', cssClass: 'super-bowl' };
                }
                return { label: 'Offseason', emoji: '⏳', cssClass: 'offseason' };
            }
        }
    }

    // Fallback
    return getFallbackNFLPhase();
}

/**
 * Calculate the current NFL week based on events
 */
function calculateNFLWeek(currentDate, events) {
    // NFL weeks are Thursday to Wednesday
    // Find which "batch" of games we're in

    // Group events by week (games within 7 days of each other are same week)
    const weeks = [];
    let currentWeekEvents = [];
    let lastEventDate = null;

    for (const event of events) {
        if (lastEventDate) {
            const daysDiff = (event.date - lastEventDate) / (1000 * 60 * 60 * 24);

            // If more than 4 days since last event, it's a new week
            if (daysDiff > 4) {
                if (currentWeekEvents.length > 0) {
                    weeks.push(currentWeekEvents);
                }
                currentWeekEvents = [];
            }
        }

        currentWeekEvents.push(event);
        lastEventDate = event.date;
    }

    // Don't forget the last week
    if (currentWeekEvents.length > 0) {
        weeks.push(currentWeekEvents);
    }

    // Find which week we're in
    for (let i = 0; i < weeks.length; i++) {
        const weekEvents = weeks[i];
        const weekStart = new Date(weekEvents[0].date);
        weekStart.setDate(weekStart.getDate() - 3); // Start 3 days before first game

        const weekEnd = new Date(weekEvents[weekEvents.length - 1].date);
        weekEnd.setDate(weekEnd.getDate() + 3); // End 3 days after last game

        if (currentDate >= weekStart && currentDate <= weekEnd) {
            return i + 1;
        }
    }

    // If between weeks, return next upcoming week
    for (let i = 0; i < weeks.length; i++) {
        if (weeks[i][0].date > currentDate) {
            return i + 1;
        }
    }

    return weeks.length;
}

/**
 * Fallback phase detection using fixed dates
 */
function getFallbackNFLPhase() {
    const now = new Date();
    const month = now.getMonth();
    const day = now.getDate();

    // February: Super Bowl period or post-Super Bowl
    if (month === 1) {
        if (day <= 15) {
            return { label: 'Super Bowl', emoji: '🏆', cssClass: 'super-bowl' };
        }
        return { label: 'Offseason', emoji: '⏳', cssClass: 'offseason' };
    }

    // March - April: Offseason / Draft
    if (month === 2) {
        return { label: 'Offseason', emoji: '⏳', cssClass: 'offseason' };
    }

    if (month === 3) {
        if (day >= 24 && day <= 27) {
            return { label: 'Draft', emoji: '📋', cssClass: 'draft' };
        }
        return { label: 'Offseason', emoji: '⏳', cssClass: 'offseason' };
    }

    // May - July: Offseason
    if (month >= 4 && month <= 6) {
        return { label: 'Offseason', emoji: '⏳', cssClass: 'offseason' };
    }

    // August: Preseason
    if (month === 7) {
        return { label: 'Preseason', emoji: '💪', cssClass: 'preseason' };
    }

    // September - December: Regular Season
    if (month >= 8 && month <= 11) {
        // Rough week calculation
        const seasonStart = new Date(now.getFullYear(), 8, 5); // Sept 5
        const weeksSinceStart = Math.floor((now - seasonStart) / (7 * 24 * 60 * 60 * 1000));
        const week = Math.min(Math.max(weeksSinceStart + 1, 1), 18);
        return { label: `Week ${week}`, emoji: '🏈', cssClass: 'regular-season' };
    }

    // January: Playoffs
    if (month === 0) {
        if (day <= 7) {
            return { label: 'Wild Card', emoji: '🔥', cssClass: 'playoffs' };
        } else if (day <= 14) {
            return { label: 'Divisional', emoji: '🔥', cssClass: 'playoffs' };
        } else if (day <= 21) {
            return { label: 'Championship', emoji: '🔥', cssClass: 'playoffs' };
        } else {
            return { label: 'Super Bowl Week', emoji: '🏆', cssClass: 'super-bowl' };
        }
    }

    return { label: 'NFL', emoji: '🏈', cssClass: 'regular-season' };
}

/**
 * Parallax scroll effect
 */
function initParallax() {
    const layers = document.querySelectorAll('.parallax .layer');
    if (layers.length === 0) return;

    function parallax() {
        const y = window.scrollY;
        for (let i = 1; i < layers.length; i++) {
            layers[layers.length - i].style.transform = `translateY(${(i * 0.1) * y}px)`;
        }
    }

    window.addEventListener('scroll', parallax, false);
}

/**
 * NFL Season Periods Configuration
 * Adjust dates according to the actual NFL calendar
 */
const NFL_DATES = {
    // 2024-2025 Season (example dates - adjust as needed)
    draftStart: new Date('2025-04-24'),
    draftEnd: new Date('2025-04-26'),
    seasonStart: new Date('2024-09-05'),
    seasonEnd: new Date('2025-01-05'),
    playoffsStart: new Date('2025-01-11'),
    superBowl: new Date('2025-02-09'),
    // Post Super Bowl celebration period (2 weeks)
    celebrationEnd: new Date('2025-02-23'),
};

// Current champion data (update after each season)
const CURRENT_CHAMPION = {
    name: 'Thunder Hawks',
    logo: '🦅',
    record: '13-4',
    year: 2024
};

// Fantasy Super Bowl Finalists (update when playoffs begin)
// These team names will appear in the end zones
const SUPER_BOWL_FINALISTS = {
    // Update these with actual fantasy playoff finalists
    teamTop: 'Capi dei Pianeti',     // Team in top end zone
    teamBottom: 'Lasers',             // Team in bottom end zone
    // Set to true during playoffs/super bowl, false during off-season
    isActive: false
};

// Stadium background images for each matchup
const STADIUM_IMAGES = {
    'capi_lasers': 'images/sb_capi_lasers.png',
    'capi_oscurus': 'images/sb_capi_oscurus.png',
    'capi_sommo': 'images/sb_capi_sommo.png',
    'lasers_oscurus': 'images/sb_lasers_oscurus.png',
    'lasers_sommo': 'images/sb_lasers_sommo.png',
    'oscurus_sommo': 'images/sb_oscurus_sommo.png',
    'default': 'images/stadium_bg.png'
};

// Team name to key mapping
const TEAM_KEYS = {
    'Capi dei Pianeti': 'capi',
    'Lasers': 'lasers',
    'Oscurus': 'oscurus',
    'Sommo': 'sommo'
};

// Team logo paths
const TEAM_LOGOS = {
    'Capi dei Pianeti': 'Team Logo/IMG_1065.JPG',
    'Lasers': 'Team Logo/IMG_4979.JPG',
    'Oscurus': 'Team Logo/IMG_8063.JPG',
    'Sommo': 'Team Logo/IMG_8064.JPG'
};

/**
 * Get stadium image for a matchup
 */
function getStadiumImage(team1, team2) {
    const key1 = TEAM_KEYS[team1];
    const key2 = TEAM_KEYS[team2];

    if (!key1 || !key2) return STADIUM_IMAGES.default;

    // Sort keys alphabetically to match image naming
    const sortedKeys = [key1, key2].sort();
    const matchupKey = sortedKeys.join('_');

    return STADIUM_IMAGES[matchupKey] || STADIUM_IMAGES.default;
}

/**
 * Update stadium background based on finalists
 */
function updateStadiumBackground() {
    const homeSection = document.querySelector('.home-section');
    if (!homeSection) return;

    const period = getSeasonPeriod();

    // Show finalists during playoffs and Super Bowl periods
    if ((period === 'PLAYOFFS' || period === 'POST_SUPER_BOWL') || SUPER_BOWL_FINALISTS.isActive) {
        // Update stadium background to show correct matchup
        const stadiumImage = getStadiumImage(
            SUPER_BOWL_FINALISTS.teamTop,
            SUPER_BOWL_FINALISTS.teamBottom
        );
        homeSection.style.backgroundImage = `url('${stadiumImage}')`;
    } else {
        // Off-season: show default stadium
        homeSection.style.backgroundImage = `url('${STADIUM_IMAGES.default}')`;
    }
}

/**
 * Initialize debug matchup selector
 */
function initDebugSelector() {
    // Handle period selector
    const periodSelect = document.getElementById('period-select');
    if (periodSelect) {
        periodSelect.addEventListener('change', (e) => {
            const selectedPeriod = e.target.value;
            if (selectedPeriod === 'auto') {
                // Use actual period
                initSeasonPeriod();
            } else {
                // Override with selected period
                initSeasonPeriodWithOverride(selectedPeriod);
            }
        });

        // Initialize with selected value (defaults to Super Bowl Week)
        const initialPeriod = periodSelect.value;
        if (initialPeriod !== 'auto') {
            initSeasonPeriodWithOverride(initialPeriod);
        }
    }

    // Handle matchup photo selector (only active in Super Bowl section)
    const matchupSelect = document.getElementById('matchup-select');
    if (matchupSelect) {
        matchupSelect.addEventListener('change', (e) => {
            const homeSection = document.querySelector('.home-section');
            if (!homeSection) return;

            const matchup = e.target.value;
            if (matchup === 'default') {
                homeSection.style.backgroundImage = `url('${STADIUM_IMAGES.default}')`;
            } else {
                homeSection.style.backgroundImage = `url('${STADIUM_IMAGES[matchup]}')`;
            }
        });
    }
}

/**
 * Initialize season period with override (for debug)
 */
function initSeasonPeriodWithOverride(period) {
    console.log('initSeasonPeriodWithOverride called with:', period);

    const periodConfig = {
        POST_SUPER_BOWL: {
            icon: '🏆',
            text: 'Championship Celebration',
            message: 'Congratulations to our Champion!',
            section: 'postseason-section',
            showPhotoSelector: false,
            showHomeSection: false  // Hide stadium for Post-Season
        },
        PLAYOFFS: {
            icon: '🔥',
            text: 'Super Bowl Week',
            message: 'The championship game is here!',
            section: 'superbowl-section',
            showPhotoSelector: true,
            showHomeSection: true  // Show stadium for Super Bowl Week
        },
        REGULAR_SEASON: {
            icon: '🏈',
            text: 'Regular Season',
            message: 'Every game counts. Build your legacy.',
            section: 'gameweek-section',
            showPhotoSelector: false,
            showHomeSection: false  // Hide stadium for Game Week
        },
        PRE_DRAFT: {
            icon: '⏳',
            text: 'Pre-Draft',
            message: 'Prepare your strategy. The draft is coming.',
            section: 'predraft-section',
            showPhotoSelector: false,
            showHomeSection: false  // Hide stadium for Pre-Draft
        }
    };

    const config = periodConfig[period];
    if (!config) {
        console.log('No config found for period:', period);
        return;
    }

    console.log('Using config:', config);

    // Show/hide the home section (stadium) based on period
    const homeSection = document.getElementById('home');
    const homeContentSection = document.querySelector('.home-content-section');

    if (homeSection) {
        if (config.showHomeSection) {
            homeSection.classList.remove('hidden');
        } else {
            homeSection.classList.add('hidden');
        }
    }

    if (homeContentSection) {
        if (config.showHomeSection) {
            homeContentSection.classList.remove('hidden');
        } else {
            homeContentSection.classList.add('hidden');
        }
    }

    // Update period badge (only if visible)
    const badge = document.getElementById('period-badge');
    if (badge) {
        badge.querySelector('.period-icon').textContent = config.icon;
        badge.querySelector('.period-text').textContent = config.text;
    }

    // Update message (only if visible)
    const message = document.getElementById('period-message');
    if (message) {
        message.textContent = config.message;
    }

    // Hide all period sections first
    document.querySelectorAll('.period-section').forEach(section => {
        section.classList.add('hidden');
    });

    // Show the appropriate section
    const targetSection = document.getElementById(config.section);
    console.log('Target section:', config.section, 'Element:', targetSection);

    if (targetSection) {
        targetSection.classList.remove('hidden');
        console.log('Section shown, classList:', targetSection.classList);

        // Initialize section-specific content
        initSectionContent(period, config.section);
    }

    // Show/hide photo selector based on period
    const photoSelector = document.getElementById('debug-photo-selector');
    if (photoSelector) {
        if (config.showPhotoSelector) {
            photoSelector.style.display = 'flex';
        } else {
            photoSelector.style.display = 'none';
        }
    }

    // Toggle between normal header and Super Bowl matchup display
    const normalHeader = document.getElementById('parallax-header-normal');
    const matchupDisplay = document.getElementById('superbowl-matchup-display');

    if (period === 'PLAYOFFS') {
        // Super Bowl Week: hide Topina League header
        if (normalHeader) normalHeader.classList.add('hidden');

        // Hide period message ("The championship game is here")
        const periodMessage = document.getElementById('period-message');
        if (periodMessage) periodMessage.classList.add('hidden');

        // Hide stats (Teams, Seasons, Games)
        const homeStats = document.getElementById('home-stats');
        if (homeStats) homeStats.classList.add('hidden');

        // Show main matchup display
        const sbMainMatchup = document.getElementById('sb-main-matchup');
        if (sbMainMatchup) sbMainMatchup.classList.remove('hidden');

        // Update matchup with actual finalists
        const team1Logo = document.getElementById('sb-main-team1-logo');
        const team1Name = document.getElementById('sb-main-team1-name');
        const team2Logo = document.getElementById('sb-main-team2-logo');
        const team2Name = document.getElementById('sb-main-team2-name');

        // Use transparent logos
        const TEAM_LOGOS_TRANSPARENT = {
            'Capi dei Pianeti': 'images/team_capi_transparent.png',
            'Lasers': 'images/team_lasers_transparent.png',
            'Oscurus': 'images/team_oscurus_transparent.png',
            'Sommo': 'images/team_sommo_transparent.png'
        };

        if (team1Logo && TEAM_LOGOS_TRANSPARENT[SUPER_BOWL_FINALISTS.teamTop]) {
            team1Logo.src = TEAM_LOGOS_TRANSPARENT[SUPER_BOWL_FINALISTS.teamTop];
            team1Logo.alt = SUPER_BOWL_FINALISTS.teamTop;
        }
        if (team1Name) {
            team1Name.textContent = SUPER_BOWL_FINALISTS.teamTop;
        }
        if (team2Logo && TEAM_LOGOS_TRANSPARENT[SUPER_BOWL_FINALISTS.teamBottom]) {
            team2Logo.src = TEAM_LOGOS_TRANSPARENT[SUPER_BOWL_FINALISTS.teamBottom];
            team2Logo.alt = SUPER_BOWL_FINALISTS.teamBottom;
        }
        if (team2Name) {
            team2Name.textContent = SUPER_BOWL_FINALISTS.teamBottom;
        }
    } else {
        // Other periods: show Topina League, hide matchup display
        if (normalHeader) normalHeader.classList.remove('hidden');

        // Show period message
        const periodMessage = document.getElementById('period-message');
        if (periodMessage) periodMessage.classList.remove('hidden');

        // Show stats
        const homeStats = document.getElementById('home-stats');
        if (homeStats) homeStats.classList.remove('hidden');

        // Hide main matchup display
        const sbMainMatchup = document.getElementById('sb-main-matchup');
        if (sbMainMatchup) sbMainMatchup.classList.add('hidden');
    }
}

/**
 * Initialize Super Bowl Countdown Timer
 * Counts down to NFL Week 17 start (Fantasy Super Bowl)
 */
function initSuperBowlCountdown() {
    // NFL Week 17 2024-2025 season typically starts around late December
    // Adjust this date based on actual NFL schedule
    const week17Start = new Date('2024-12-28T13:00:00');

    function updateCountdown() {
        const now = new Date();
        const diff = week17Start - now;

        if (diff <= 0) {
            // Super Bowl is happening!
            document.getElementById('countdown-days').textContent = '00';
            document.getElementById('countdown-hours').textContent = '00';
            document.getElementById('countdown-minutes').textContent = '00';
            document.getElementById('countdown-seconds').textContent = '00';
            document.querySelector('.countdown-title').textContent = '🏆 SUPER BOWL TIME! 🏆';
            return;
        }

        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((diff % (1000 * 60)) / 1000);

        document.getElementById('countdown-days').textContent = String(days).padStart(2, '0');
        document.getElementById('countdown-hours').textContent = String(hours).padStart(2, '0');
        document.getElementById('countdown-minutes').textContent = String(minutes).padStart(2, '0');
        document.getElementById('countdown-seconds').textContent = String(seconds).padStart(2, '0');
    }

    // Update immediately and then every second
    updateCountdown();
    setInterval(updateCountdown, 1000);
}

/**
 * Initialize Super Bowl Parallax Scroll Effect
 * Reveals trophy and team logos when scrolling down
 */
function initSuperBowlParallax() {
    const parallaxReveal = document.getElementById('superbowl-parallax-reveal');
    if (!parallaxReveal) return;

    const homeSection = document.getElementById('home');
    if (!homeSection) return;

    function handleScroll() {
        const scrollY = window.scrollY;
        const homeSectionHeight = homeSection.offsetHeight;

        // Start revealing when scrolled past 100px, fully visible at 300px
        const scrollThreshold = 100;
        const scrollMaxEffect = 300;

        if (scrollY > scrollThreshold) {
            // Calculate progress (0 to 1)
            const progress = Math.min((scrollY - scrollThreshold) / (scrollMaxEffect - scrollThreshold), 1);

            // Add visible class to trigger CSS transitions
            parallaxReveal.classList.add('visible');

            // Additional parallax effect on trophy (moves up as you scroll)
            const trophy = parallaxReveal.querySelector('.parallax-trophy');
            if (trophy) {
                trophy.style.transform = `scale(${0.5 + progress * 0.5}) translateY(${50 - progress * 50}px)`;
                trophy.style.opacity = progress;
            }
        } else {
            parallaxReveal.classList.remove('visible');
        }

        // Hide parallax when scrolled past home section
        if (scrollY > homeSectionHeight) {
            parallaxReveal.style.opacity = '0';
        } else {
            parallaxReveal.style.opacity = '';
        }
    }

    window.addEventListener('scroll', handleScroll);
    // Run once on init
    handleScroll();
}

/**
 * Route to appropriate section content initializer
 */
function initSectionContent(period, sectionId) {
    console.log('initSectionContent:', period, sectionId);
    switch (sectionId) {
        case 'superbowl-section':
            initSuperBowlSection();
            break;
        case 'postseason-section':
            initPostSeasonSection();
            break;
        case 'predraft-section':
            initPreDraftSection();
            break;
        case 'gameweek-section':
            initGameWeekSection(period);
            break;
    }
}

/**
 * Initialize Super Bowl section content
 */
function initSuperBowlSection() {
    // Placeholder data - will be replaced with real data from backend
    const team1 = { name: 'Capi dei Pianeti', logo: '🟠', record: '10-4', pf: 1532, pa: 1298, streak: 'W4' };
    const team2 = { name: 'Lasers', logo: '🟡', record: '11-3', pf: 1645, pa: 1310, streak: 'W6' };

    // Team 1
    document.getElementById('sb-team1-name').textContent = team1.name;
    document.getElementById('sb-team1-logo').textContent = team1.logo;
    document.getElementById('sb-team1-record').textContent = team1.record;

    // Team 2
    document.getElementById('sb-team2-name').textContent = team2.name;
    document.getElementById('sb-team2-logo').textContent = team2.logo;
    document.getElementById('sb-team2-record').textContent = team2.record;

    // Stats comparison
    document.getElementById('sb-stat1-pf').textContent = team1.pf;
    document.getElementById('sb-stat2-pf').textContent = team2.pf;
    document.getElementById('sb-stat1-pa').textContent = team1.pa;
    document.getElementById('sb-stat2-pa').textContent = team2.pa;
    document.getElementById('sb-stat1-streak').textContent = team1.streak;
    document.getElementById('sb-stat2-streak').textContent = team2.streak;
}

/**
 * Initialize Post-Season section content
 */
function initPostSeasonSection() {
    // Placeholder section - elements may not exist
    console.log('Post-Season section loaded (placeholder)');
}

/**
 * Initialize Pre-Draft section content
 */
function initPreDraftSection() {
    // Placeholder section - elements may not exist
    console.log('Pre-Draft section loaded (placeholder)');
}

/**
 * Initialize Game Week section content
 */
function initGameWeekSection(period) {
    // Placeholder section - elements may not exist
    console.log('Game Week section loaded (placeholder)');
}

/**
 * Determine current season period
 */
function getSeasonPeriod() {
    const now = new Date();

    // Check each period
    if (now >= NFL_DATES.superBowl && now <= NFL_DATES.celebrationEnd) {
        return 'POST_SUPER_BOWL';
    } else if (now >= NFL_DATES.playoffsStart && now < NFL_DATES.superBowl) {
        return 'PLAYOFFS';
    } else if (now >= NFL_DATES.seasonStart && now < NFL_DATES.playoffsStart) {
        return 'REGULAR_SEASON';
    } else if (now >= NFL_DATES.draftStart && now <= NFL_DATES.draftEnd) {
        return 'DRAFT_WEEKEND';
    } else if (now < NFL_DATES.draftStart) {
        return 'PRE_DRAFT';
    } else if (now > NFL_DATES.draftEnd && now < NFL_DATES.seasonStart) {
        return 'PRE_SEASON';
    } else {
        return 'OFF_SEASON';
    }
}

/**
 * Initialize season period display
 */
function initSeasonPeriod() {
    const period = getSeasonPeriod();

    const periodConfig = {
        POST_SUPER_BOWL: {
            icon: '🏆',
            text: 'Championship Celebration',
            message: 'Congratulations to our Champion!',
            showChampion: true,
            showCountdown: false,
            confetti: true
        },
        PLAYOFFS: {
            icon: '🔥',
            text: 'Playoffs',
            message: 'The road to the championship is on!',
            showChampion: false,
            showCountdown: true,
            countdownTarget: NFL_DATES.superBowl,
            countdownTitle: 'Super Bowl Countdown',
            confetti: false
        },
        REGULAR_SEASON: {
            icon: '🏈',
            text: 'Regular Season',
            message: 'Every game counts. Build your legacy.',
            showChampion: false,
            showCountdown: false,
            confetti: false
        },
        DRAFT_WEEKEND: {
            icon: '📋',
            text: 'Draft Weekend',
            message: 'The future is being written. Choose wisely.',
            showChampion: false,
            showCountdown: false,
            confetti: true
        },
        PRE_DRAFT: {
            icon: '⏳',
            text: 'Pre-Draft',
            message: 'Prepare your strategy. The draft is coming.',
            showChampion: false,
            showCountdown: true,
            countdownTarget: NFL_DATES.draftStart,
            countdownTitle: 'Days Until Draft',
            confetti: false
        },
        PRE_SEASON: {
            icon: '💪',
            text: 'Pre-Season',
            message: 'Training camp is here. Season starts soon.',
            showChampion: false,
            showCountdown: true,
            countdownTarget: NFL_DATES.seasonStart,
            countdownTitle: 'Season Kickoff',
            confetti: false
        },
        OFF_SEASON: {
            icon: '😴',
            text: 'Off-Season',
            message: 'Rest up. The grind returns soon.',
            showChampion: false,
            showCountdown: true,
            countdownTarget: NFL_DATES.draftStart,
            countdownTitle: 'Days Until Draft',
            confetti: false
        }
    };

    const config = periodConfig[period];

    // Update period badge
    const badge = document.getElementById('period-badge');
    if (badge) {
        badge.querySelector('.period-icon').textContent = config.icon;
        badge.querySelector('.period-text').textContent = config.text;
    }

    // Update message
    const message = document.getElementById('period-message');
    if (message) {
        message.textContent = config.message;
    }

    // Show/hide champion section
    const championSection = document.getElementById('champion-section');
    if (championSection) {
        if (config.showChampion) {
            championSection.classList.remove('hidden');
            document.getElementById('champion-name').textContent = CURRENT_CHAMPION.name;
            document.getElementById('champion-logo').textContent = CURRENT_CHAMPION.logo;
        } else {
            championSection.classList.add('hidden');
        }
    }

    // Show/hide countdown section
    const countdownSection = document.getElementById('countdown-section');
    if (countdownSection) {
        if (config.showCountdown) {
            countdownSection.classList.remove('hidden');
            document.getElementById('countdown-title').textContent = config.countdownTitle;
            startCountdown(config.countdownTarget);
        } else {
            countdownSection.classList.add('hidden');
        }
    }

    // Start confetti if needed
    if (config.confetti) {
        setTimeout(() => {
            startConfetti();
        }, 1000);
    }
}

/**
 * Countdown timer
 */
function startCountdown(targetDate) {
    function updateCountdown() {
        const now = new Date();
        const diff = targetDate - now;

        if (diff <= 0) {
            document.getElementById('countdown-days').textContent = '00';
            document.getElementById('countdown-hours').textContent = '00';
            document.getElementById('countdown-minutes').textContent = '00';
            return;
        }

        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
        const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

        document.getElementById('countdown-days').textContent = String(days).padStart(2, '0');
        document.getElementById('countdown-hours').textContent = String(hours).padStart(2, '0');
        document.getElementById('countdown-minutes').textContent = String(minutes).padStart(2, '0');
    }

    updateCountdown();
    setInterval(updateCountdown, 60000); // Update every minute
}

/**
 * Confetti Effect
 */
function startConfetti() {
    const canvas = document.getElementById('confetti-canvas');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const confettiColors = ['#ffffff', '#fbbf24', '#22c55e', '#3b82f6', '#ef4444', '#a855f7'];
    const confettiCount = 150;
    const confetti = [];

    // Create confetti particles
    for (let i = 0; i < confettiCount; i++) {
        confetti.push({
            x: Math.random() * canvas.width,
            y: Math.random() * canvas.height - canvas.height,
            w: Math.random() * 10 + 5,
            h: Math.random() * 6 + 4,
            color: confettiColors[Math.floor(Math.random() * confettiColors.length)],
            speed: Math.random() * 3 + 2,
            angle: Math.random() * 360,
            spin: Math.random() * 10 - 5,
            opacity: Math.random() * 0.5 + 0.5
        });
    }

    let animationFrame;
    let startTime = Date.now();
    const duration = 8000; // 8 seconds

    function animate() {
        const elapsed = Date.now() - startTime;

        if (elapsed > duration) {
            // Fade out
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            cancelAnimationFrame(animationFrame);
            return;
        }

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        confetti.forEach(c => {
            ctx.save();
            ctx.translate(c.x + c.w / 2, c.y + c.h / 2);
            ctx.rotate((c.angle * Math.PI) / 180);
            ctx.globalAlpha = c.opacity;
            ctx.fillStyle = c.color;
            ctx.fillRect(-c.w / 2, -c.h / 2, c.w, c.h);
            ctx.restore();

            // Update position
            c.y += c.speed;
            c.angle += c.spin;
            c.x += Math.sin(c.angle * 0.1) * 0.5;

            // Reset if off screen
            if (c.y > canvas.height) {
                c.y = -20;
                c.x = Math.random() * canvas.width;
            }
        });

        animationFrame = requestAnimationFrame(animate);
    }

    animate();

    // Handle resize
    window.addEventListener('resize', () => {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    });
}

/**
 * Navbar scroll effect
 */
function initNavbar() {
    const navbar = document.querySelector('.navbar');
    if (!navbar) return;

    window.addEventListener('scroll', () => {
        if (window.scrollY > 50) {
            navbar.classList.add('scrolled');
        } else {
            navbar.classList.remove('scrolled');
        }
    });
}

/**
 * Scroll-triggered animations using Intersection Observer
 */
function initScrollAnimations() {
    const animatedElements = document.querySelectorAll('.animate-on-scroll');

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const delay = entry.target.dataset.delay || 0;
                setTimeout(() => {
                    entry.target.classList.add('visible');
                }, delay);
            }
        });
    }, {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    });

    animatedElements.forEach(el => observer.observe(el));
}

/**
 * Counter animation for statistics
 */
function initCounterAnimations() {
    const counters = document.querySelectorAll('[data-count]');

    const animateCounter = (counter) => {
        const target = parseInt(counter.dataset.count);
        const duration = 2000;
        const step = target / (duration / 16);
        let current = 0;

        const updateCounter = () => {
            current += step;
            if (current < target) {
                counter.textContent = formatNumber(Math.floor(current));
                requestAnimationFrame(updateCounter);
            } else {
                counter.textContent = formatNumber(target);
            }
        };

        updateCounter();
    };

    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting && !entry.target.classList.contains('counted')) {
                entry.target.classList.add('counted');
                animateCounter(entry.target);
            }
        });
    }, {
        threshold: 0.5
    });

    counters.forEach(counter => observer.observe(counter));
}

/**
 * Format number with commas
 */
function formatNumber(num) {
    return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Staggered table row animations
 */
function initTableAnimations() {
    const tableRows = document.querySelectorAll('.table-row');

    const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry, index) => {
            if (entry.isIntersecting) {
                const rank = entry.target.dataset.rank || index;
                setTimeout(() => {
                    entry.target.classList.add('visible');
                }, rank * 100);
            }
        });
    }, {
        threshold: 0.1
    });

    tableRows.forEach(row => observer.observe(row));
}

/**
 * Round selector for draft page
 */
function initRoundSelector() {
    const roundBtns = document.querySelectorAll('.round-btn');

    roundBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            // Remove active from all
            roundBtns.forEach(b => b.classList.remove('active'));
            // Add active to clicked
            btn.classList.add('active');

            // Here you would filter the draft cards based on round
            const round = btn.dataset.round;
            console.log('Selected round:', round);
            // Implement filtering logic as needed
        });
    });
}

/**
 * Manual trigger for confetti (for testing)
 */
function triggerConfetti() {
    startConfetti();
}

// Expose to global for testing
window.triggerConfetti = triggerConfetti;

// Console easter egg
console.log('%c🏈 TOPINA LEAGUE', 'font-size: 24px; font-weight: bold; color: #ffffff;');
console.log('%cWhere Champions Are Made', 'font-size: 14px; color: #888888;');

/**
 * ========================================
 * NFL FANTASY DATA LOADING
 * ========================================
 */

const LEAGUE_DATA_URL = 'data/league-data.json';

/**
 * Load league data from JSON file
 */
async function loadLeagueData() {
    try {
        const response = await fetch(LEAGUE_DATA_URL);
        if (!response.ok) {
            throw new Error(`Failed to load data: ${response.status}`);
        }
        return await response.json();
    } catch (error) {
        console.warn('Could not load league data:', error);
        return null;
    }
}

/**
 * Render standings table with data
 */
function renderStandings(standings) {
    const tbody = document.querySelector('.standings-table tbody');
    if (!tbody || !standings || standings.length === 0) return;

    // Clear existing rows
    tbody.innerHTML = '';

    standings.forEach((team, index) => {
        const rank = index + 1;
        const rankClass = rank === 1 ? 'gold' : rank === 2 ? 'silver' : rank === 3 ? 'bronze' : '';
        const streakClass = team.streak.startsWith('W') ? 'win' : 'loss';

        const row = document.createElement('tr');
        row.className = 'table-row';
        row.dataset.rank = rank;

        row.innerHTML = `
            <td><span class="rank ${rankClass}">${rank}</span></td>
            <td class="team-name">
                <span class="team-logo">🏈</span>
                <span>${team.teamName}</span>
            </td>
            <td>${team.wins}</td>
            <td>${team.losses}</td>
            <td>${formatNumber(team.pointsFor)}</td>
            <td>${formatNumber(team.pointsAgainst)}</td>
            <td><span class="streak ${streakClass}">${team.streak}</span></td>
        `;

        tbody.appendChild(row);
    });

    // Re-initialize table animations
    initTableAnimations();
}

/**
 * Render draft cards with data
 */
function renderDraft(draftPicks, round = 'all') {
    const grid = document.querySelector('.draft-grid');
    if (!grid || !draftPicks || draftPicks.length === 0) return;

    // Clear existing cards
    grid.innerHTML = '';

    const filteredPicks = round === 'all'
        ? draftPicks
        : draftPicks.filter(pick => pick.round === parseInt(round));

    filteredPicks.forEach((pick, index) => {
        const posClass = pick.position.toLowerCase();
        const delay = (index % 8) * 50;

        const card = document.createElement('div');
        card.className = 'draft-card animate-on-scroll';
        card.dataset.delay = delay;
        card.dataset.round = pick.round;

        card.innerHTML = `
            <div class="card-glow"></div>
            <div class="pick-number">#${pick.pick}</div>
            <div class="player-position ${posClass}">${pick.position}</div>
            <div class="player-info">
                <h3 class="player-name">${pick.playerName}</h3>
                <p class="player-team">${pick.nflTeam}</p>
                <p class="team-drafted">→ ${pick.fantasyTeam}</p>
            </div>
        `;

        grid.appendChild(card);
    });

    // Re-initialize scroll animations
    initScrollAnimations();
}

/**
 * Update page subtitle with current week info
 */
function updateWeekInfo(data) {
    const subtitle = document.querySelector('.page-subtitle');
    if (subtitle && data.lastUpdated) {
        const updateDate = new Date(data.lastUpdated);
        const formattedDate = updateDate.toLocaleDateString('it-IT', {
            day: 'numeric',
            month: 'short',
            year: 'numeric'
        });
        subtitle.textContent = `Aggiornato: ${formattedDate}`;
    }
}

/**
 * Initialize data loading on page load
 */
async function initDataLoading() {
    const data = await loadLeagueData();
    if (!data) return;

    // Update standings page
    if (document.querySelector('.standings-table')) {
        renderStandings(data.standings);
        updateWeekInfo(data);
    }

    // Update draft page
    if (document.querySelector('.draft-grid')) {
        renderDraft(data.draft);

        // Hook up round selector with real data
        const roundBtns = document.querySelectorAll('.round-btn');
        roundBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                roundBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                renderDraft(data.draft, btn.dataset.round);
            });
        });
    }

    console.log('📊 League data loaded:', {
        teams: data.standings?.length,
        draftPicks: data.draft?.length,
        lastUpdated: data.lastUpdated
    });
}

// Initialize data loading after DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    // Small delay to ensure other init functions run first
    setTimeout(initDataLoading, 100);
});
