/**
 * Le etichette CORTE delle statistiche — "PaYd", "ReTD", "Sck".
 *
 * Nate dentro `sections/live.js`, dove servivano all'anello attorno alla foto
 * del giocatore. Stanno qui da quando le legge anche il Night Recap
 * (`sections/night-recap.js`): sono lo stesso vocabolario, e due copie
 * divergono — basta aggiungere una statistica da una parte e la stessa giocata
 * si legge con due nomi diversi in due punti del sito.
 *
 * Corte per un motivo preciso: sull'anello ogni carattere costa un pezzo di
 * circonferenza. Le versioni lunghe ("Receiving TD") vivono in `STAT_LABELS`
 * dentro live.js, che le usa negli scontrini dove lo spazio c'e'.
 */
export function shortStatLabel(k) {
    return ({
        pass_yds: 'PaYd', pass_td: 'PaTD', pass_int: 'INT',
        rush_yds: 'RuYd', rush_td: 'RuTD',
        rec: 'Rec', rec_yds: 'ReYd', rec_td: 'ReTD',
        pass_att: 'Att', pass_comp: 'Cmp', rush_att: 'Car', targets: 'Tgt',
        pat_made: 'XP', fg_made: 'FG', fg_att: 'FGA',
        fg_0_39: 'FG0-39', fg_40_49: 'FG40', fg_50_plus: 'FG50+',
        sack: 'Sck', def_int: 'INT', fum_rec: 'FR', def_td: 'TD',
        safety: 'SAF', pts_allowed: 'PA', yds_allowed: 'YdA',
        fum_lost: 'FUM', ret_td: 'RetTD', def_ret_td: 'RetTD', fum_td: 'FumTD',
    })[k] || k;
}
