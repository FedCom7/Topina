/**
 * NFL Calendar Module
 * Fetches NFL calendar data and determines the current phase/week.
 */

const NFL_CALENDAR_URL = 'https://app.stanzacal.com/api/calendar/webcal/nfl-allgames/61661215437db10008aae4b3/66e197347c4d9fb301eaa25b.ics';

/**
 * Initialize the NFL Phase Indicator badge in the UI
 */
export async function initNFLPhaseIndicator() {
    const indicator = document.getElementById('nfl-phase-indicator');
    const labelElement = document.getElementById('phase-label');
    const emojiElement = indicator?.querySelector('.phase-emoji');

    if (!indicator || !labelElement) return;

    try {
        const phase = await getNFLPhaseFromCalendar();
        labelElement.textContent = phase.label;
        if (emojiElement) emojiElement.textContent = phase.emoji;

        indicator.classList.remove('preseason', 'regular-season', 'playoffs', 'super-bowl', 'offseason', 'draft');
        indicator.classList.add(phase.cssClass);
    } catch (error) {
        console.warn('Could not fetch NFL calendar, using fallback:', error);
        const fallback = getFallbackNFLPhase();
        labelElement.textContent = fallback.label;
        if (emojiElement) emojiElement.textContent = fallback.emoji;
        indicator.classList.add(fallback.cssClass);
    }
}

/**
 * Fetch and parse the NFL calendar to determine current phase
 */
async function getNFLPhaseFromCalendar() {
    let icsData;

    try {
        const response = await fetch(NFL_CALENDAR_URL);
        if (!response.ok) throw new Error('Direct fetch failed');
        icsData = await response.text();
    } catch {
        const proxyUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(NFL_CALENDAR_URL)}`;
        const proxyResponse = await fetch(proxyUrl);
        if (!proxyResponse.ok) throw new Error('Both direct and proxy fetch failed');
        icsData = await proxyResponse.text();
    }

    const events = parseICSCalendar(icsData);
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
        const eventData = block.substring(0, block.indexOf('END:VEVENT'));

        const dtStartMatch = eventData.match(/DTSTART:(\d{8}T\d{6}Z?)/);
        const summaryMatch = eventData.match(/SUMMARY:(.+)/);

        if (dtStartMatch && summaryMatch) {
            const d = dtStartMatch[1];
            events.push({
                date: new Date(Date.UTC(
                    parseInt(d.substring(0, 4)),
                    parseInt(d.substring(4, 6)) - 1,
                    parseInt(d.substring(6, 8)),
                    parseInt(d.substring(9, 11)),
                    parseInt(d.substring(11, 13))
                )),
                summary: summaryMatch[1].trim()
            });
        }
    }

    return events.sort((a, b) => a.date - b.date);
}

/**
 * Determine NFL phase based on parsed events and current date
 */
function determineNFLPhase(events) {
    const now = new Date();

    // Check Super Bowl
    const superBowlEvent = events.find(e =>
        e.summary.toLowerCase().includes('super bowl') ||
        (e.date.getMonth() === 1 && events.indexOf(e) === events.length - 1)
    );

    if (superBowlEvent) {
        const daysUntilSB = (superBowlEvent.date - now) / (1000 * 60 * 60 * 24);
        if (daysUntilSB >= 0 && daysUntilSB <= 7) {
            return { label: 'Super Bowl Week', emoji: '🏆', cssClass: 'super-bowl' };
        }
        if (daysUntilSB < 0 && daysUntilSB >= -14) {
            return { label: 'Super Bowl Complete', emoji: '🏆', cssClass: 'super-bowl' };
        }
    }

    // Check regular season
    const regularSeasonEvents = events.filter(e => {
        const month = e.date.getMonth();
        return (month >= 8 || month === 0);
    });

    if (regularSeasonEvents.length > 0) {
        const seasonStart = regularSeasonEvents[0].date;
        const seasonEnd = regularSeasonEvents[regularSeasonEvents.length - 1].date;

        if (now >= seasonStart && now <= seasonEnd) {
            const weekNumber = calculateNFLWeek(now, regularSeasonEvents);
            if (weekNumber > 18) {
                return { label: 'Playoffs', emoji: '🔥', cssClass: 'playoffs' };
            }
            return { label: `Week ${weekNumber}`, emoji: '🏈', cssClass: 'regular-season' };
        }

        if (now < seasonStart) {
            if (now.getMonth() === 7) return { label: 'Preseason', emoji: '💪', cssClass: 'preseason' };
            if (now.getMonth() === 3 && now.getDate() >= 20) return { label: 'Draft', emoji: '📋', cssClass: 'draft' };
            return { label: 'Offseason', emoji: '⏳', cssClass: 'offseason' };
        }

        if (now > seasonEnd && now.getMonth() === 0) {
            const day = now.getDate();
            if (day <= 7) return { label: 'Wild Card', emoji: '🔥', cssClass: 'playoffs' };
            if (day <= 14) return { label: 'Divisional Round', emoji: '🔥', cssClass: 'playoffs' };
            if (day <= 21) return { label: 'Conference Championship', emoji: '🔥', cssClass: 'playoffs' };
            return { label: 'Super Bowl Week', emoji: '🏆', cssClass: 'super-bowl' };
        }

        if (now > seasonEnd && now.getMonth() === 1) {
            if (now.getDate() <= 15) return { label: 'Super Bowl Week', emoji: '🏆', cssClass: 'super-bowl' };
            return { label: 'Offseason', emoji: '⏳', cssClass: 'offseason' };
        }
    }

    return getFallbackNFLPhase();
}

/**
 * Calculate the current NFL week number based on event groupings
 */
function calculateNFLWeek(currentDate, events) {
    const weeks = [];
    let currentWeekEvents = [];
    let lastEventDate = null;

    for (const event of events) {
        if (lastEventDate && (event.date - lastEventDate) / (1000 * 60 * 60 * 24) > 4) {
            if (currentWeekEvents.length > 0) weeks.push(currentWeekEvents);
            currentWeekEvents = [];
        }
        currentWeekEvents.push(event);
        lastEventDate = event.date;
    }
    if (currentWeekEvents.length > 0) weeks.push(currentWeekEvents);

    for (let i = 0; i < weeks.length; i++) {
        const start = new Date(weeks[i][0].date);
        start.setDate(start.getDate() - 3);
        const end = new Date(weeks[i][weeks[i].length - 1].date);
        end.setDate(end.getDate() + 3);

        if (currentDate >= start && currentDate <= end) return i + 1;
    }

    for (let i = 0; i < weeks.length; i++) {
        if (weeks[i][0].date > currentDate) return i + 1;
    }

    return weeks.length;
}

/**
 * Fallback phase detection using hardcoded date ranges
 */
function getFallbackNFLPhase() {
    const now = new Date();
    const month = now.getMonth();
    const day = now.getDate();

    if (month === 1) {
        return day <= 15
            ? { label: 'Super Bowl', emoji: '🏆', cssClass: 'super-bowl' }
            : { label: 'Offseason', emoji: '⏳', cssClass: 'offseason' };
    }
    if (month === 2) return { label: 'Offseason', emoji: '⏳', cssClass: 'offseason' };
    if (month === 3) {
        return (day >= 24 && day <= 27)
            ? { label: 'Draft', emoji: '📋', cssClass: 'draft' }
            : { label: 'Offseason', emoji: '⏳', cssClass: 'offseason' };
    }
    if (month >= 4 && month <= 6) return { label: 'Offseason', emoji: '⏳', cssClass: 'offseason' };
    if (month === 7) return { label: 'Preseason', emoji: '💪', cssClass: 'preseason' };
    if (month >= 8 && month <= 11) {
        const seasonStart = new Date(now.getFullYear(), 8, 5);
        const week = Math.min(Math.max(Math.floor((now - seasonStart) / (7 * 24 * 60 * 60 * 1000)) + 1, 1), 18);
        return { label: `Week ${week}`, emoji: '🏈', cssClass: 'regular-season' };
    }
    if (month === 0) {
        if (day <= 7) return { label: 'Wild Card', emoji: '🔥', cssClass: 'playoffs' };
        if (day <= 14) return { label: 'Divisional', emoji: '🔥', cssClass: 'playoffs' };
        if (day <= 21) return { label: 'Championship', emoji: '🔥', cssClass: 'playoffs' };
        return { label: 'Super Bowl Week', emoji: '🏆', cssClass: 'super-bowl' };
    }

    return { label: 'NFL', emoji: '🏈', cssClass: 'regular-season' };
}
