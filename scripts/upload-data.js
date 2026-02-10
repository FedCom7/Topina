const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// Initialize Firebase Admin SDK
// Expects FIREBASE_SERVICE_ACCOUNT environment variable to contain the JSON key
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

async function uploadCollection(directory, collectionName) {
    const dirPath = path.join(__dirname, '..', directory);

    if (!fs.existsSync(dirPath)) {
        console.warn(`Directory ${dirPath} does not exist. Skipping.`);
        return;
    }

    const files = fs.readdirSync(dirPath).filter(file => file.endsWith('.json'));

    console.log(`Uploading ${files.length} files from ${directory} to collection ${collectionName}...`);

    for (const file of files) {
        const filePath = path.join(dirPath, file);
        const fileContent = fs.readFileSync(filePath, 'utf8');
        const data = JSON.parse(fileContent);

        // Use filename without extension as document ID (e.g., 'draft_data_2023')
        const docId = path.basename(file, '.json');

        try {
            await db.collection(collectionName).doc(docId).set(data);
            console.log(`Successfully uploaded ${docId}`);
        } catch (error) {
            console.error(`Error uploading ${docId}:`, error);
        }
    }
}



async function calculateAndUploadStats() {
    console.log('Calculating all-time stats...');
    const fantasyDir = path.join(__dirname, '..', 'data', 'fantasy');
    if (!fs.existsSync(fantasyDir)) return;

    const files = fs.readdirSync(fantasyDir).filter(file => file.endsWith('.json'));

    let stats = {
        seasons_count: 0,
        total_games: 0,
        total_points: 0,
        highest_score: { value: 0, team: '', week: '', season: '' },
        lowest_score: { value: 1000, team: '', week: '', season: '' },
        largest_margin: { value: 0, winner: '', loser: '', week: '', season: '' },
        most_points_season: { value: 0, team: '', season: '' }
    };

    stats.seasons_count = files.length;

    for (const file of files) {
        const season = file.match(/fantasy_data_(\d+)\.json/)[1];
        const content = JSON.parse(fs.readFileSync(path.join(fantasyDir, file), 'utf8'));

        let seasonPoints = {};

        if (content.weeks) {
            Object.entries(content.weeks).forEach(([weekNum, weekData]) => {
                if (weekData.matchups) {
                    weekData.matchups.forEach(matchup => {
                        stats.total_games++;

                        // Process Team 1
                        if (matchup.team1) {
                            const score1 = parseFloat(matchup.team1.score || 0);
                            stats.total_points += score1;

                            // High Score
                            if (score1 > stats.highest_score.value) {
                                stats.highest_score = { value: score1, team: matchup.team1.name, week: weekNum, season: season };
                            }
                            // Low Score (ignore 0 if valid scores exist, but keeping logical check)
                            if (score1 > 0 && score1 < stats.lowest_score.value) {
                                stats.lowest_score = { value: score1, team: matchup.team1.name, week: weekNum, season: season };
                            }

                            // Season Points Accumulator
                            const t1Name = matchup.team1.name;
                            if (!seasonPoints[t1Name]) seasonPoints[t1Name] = 0;
                            seasonPoints[t1Name] += score1;
                        }

                        // Process Team 2
                        if (matchup.team2) {
                            const score2 = parseFloat(matchup.team2.score || 0);
                            stats.total_points += score2;

                            // High Score
                            if (score2 > stats.highest_score.value) {
                                stats.highest_score = { value: score2, team: matchup.team2.name, week: weekNum, season: season };
                            }
                            // Low Score
                            if (score2 > 0 && score2 < stats.lowest_score.value) {
                                stats.lowest_score = { value: score2, team: matchup.team2.name, week: weekNum, season: season };
                            }

                            // Season Points Accumulator
                            const t2Name = matchup.team2.name;
                            if (!seasonPoints[t2Name]) seasonPoints[t2Name] = 0;
                            seasonPoints[t2Name] += score2;
                        }

                        // Margin
                        if (matchup.team1 && matchup.team2) {
                            const score1 = parseFloat(matchup.team1.score || 0);
                            const score2 = parseFloat(matchup.team2.score || 0);
                            const margin = Math.abs(score1 - score2);
                            if (margin > stats.largest_margin.value) {
                                stats.largest_margin = {
                                    value: parseFloat(margin.toFixed(2)),
                                    winner: score1 > score2 ? matchup.team1.name : matchup.team2.name,
                                    loser: score1 > score2 ? matchup.team2.name : matchup.team1.name,
                                    week: weekNum,
                                    season: season
                                };
                            }
                        }
                    });
                }
            });
        }

        // Check Most Points in a Season
        Object.entries(seasonPoints).forEach(([team, points]) => {
            if (points > stats.most_points_season.value) {
                stats.most_points_season = { value: parseFloat(points.toFixed(2)), team: team, season: season };
            }
        });
    }

    // Round total points
    stats.total_points = parseFloat(stats.total_points.toFixed(2));

    try {
        await db.collection('stats').doc('all_time').set(stats);
        console.log('Successfully uploaded all-time stats.');
    } catch (error) {
        console.error('Error uploading stats:', error);
    }
}

async function main() {
    try {
        await uploadCollection('data/draft', 'draft');
        await uploadCollection('data/fantasy', 'fantasy');
        await calculateAndUploadStats();
        console.log('Data upload complete.');
    } catch (error) {
        console.error('Data upload failed:', error);
        process.exit(1);
    }
}

main();
