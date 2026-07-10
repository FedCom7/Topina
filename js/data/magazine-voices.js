/**
 * Magazine Voices — la "voce" del Topina Weekly.
 * Banche di testo per il giornale: dichiarazioni al veleno dei coach,
 * scuse da tabloid per i flop, frasi per la prosa dei pezzi.
 * La scelta è sempre deterministica via seed (anno×37+week): la stessa
 * edizione stampa sempre le stesse parole.
 */

export const pickSeeded = (arr, seed) => arr[Math.abs(seed) % arr.length];

/* ───────────────────────────────────────────────────────────────
   TRASH TALK — 50 dichiarazioni del coach vincente.
   ctx: { winner, loser, topName, topPts, margin }
   ─────────────────────────────────────────────────────────────── */
export const TRASH_TALK = [
    // Sfottò diretto
    (c) => `${c.topName} è di un altro livello, e lo sapevamo solo noi. ${c.loser} lo ha scoperto a sue spese: che si rivedano pure i nostri highlights, i popcorn li offriamo noi.`,
    (c) => `Con tutto il rispetto per ${c.loser}... anzi no, il rispetto si guadagna sul campo. ${c.margin} punti di scarto parlano da soli, e parlano una lingua che loro evidentemente non studiano.`,
    (c) => `Ho letto che in casa ${c.loser} erano fiduciosi. Bello l'ottimismo, eh. Peccato che il fantasy si giochi con i giocatori veri e non con le sensazioni.`,
    (c) => `A un certo punto ho smesso di guardare il punteggio e ho iniziato a guardare le loro facce. Valeva più dei ${c.topPts} punti di ${c.topName}, e ne valevano tanti.`,
    (c) => `${c.loser}? Squadra simpatica. Davvero. Il problema è che la simpatia non fa punti, e infatti non li ha fatti.`,
    (c) => `Qualcuno mi ha chiesto se ero preoccupato prima della partita. Preoccupato di cosa, esattamente? Di ${c.loser}? Andiamo, siamo persone serie.`,
    (c) => `Dicono che il fantasy sia questione di fortuna. Curioso come la fortuna scelga sempre noi e mai ${c.loser}. Forse non è fortuna. Forse siamo semplicemente più bravi.`,
    (c) => `Ho sentito che a ${c.loser} avevano già preparato i caroselli dal giovedì. Li conservino pure: prima o poi una la vinceranno anche loro.`,
    (c) => `La cosa più difficile di questa settimana? Scegliere quale highlight di ${c.topName} mandare nel gruppo. Il resto è venuto da sé.`,
    (c) => `${c.loser} ha giocato la sua migliore partita. Lo dico senza ironia. Ecco, questo dovrebbe preoccuparli parecchio.`,
    // Falsa modestia
    (c) => `Non voglio infierire su ${c.loser}, non è nel mio stile. Dico solo che certi punteggi si commentano da soli, e il loro oggi urlava.`,
    (c) => `Siamo umili, teniamo i piedi per terra. È che quando hai ${c.topName} in squadra, la terra è parecchi metri sopra la testa di ${c.loser}.`,
    (c) => `Vincere non è mai facile. Contro ${c.loser}, però, diciamo che è meno difficile del solito.`,
    (c) => `Mi spiace per loro, sinceramente. Poi però guardo il tabellone, vedo ${c.margin} punti di margine, e il dispiacere passa in fretta.`,
    (c) => `Complimenti a ${c.loser} per l'impegno. L'impegno c'era, si vedeva. Mancava tutto il resto, ma l'impegno c'era.`,
    (c) => `Il mio staff mi dice di essere diplomatico. E io sono diplomaticissimo: ${c.loser} ha perso con dignità. Tanta dignità, pochissimi punti.`,
    (c) => `Non mi piace parlare degli avversari. Preferisco lasciar parlare i ${c.topPts} punti di ${c.topName}: sono molto più eloquenti di me.`,
    (c) => `Partita in equilibrio? Certo, per i primi dieci minuti di domenica. Poi è iniziato il football vero e ${c.loser} è rimasta al bar.`,
    // Sarcasmo statistico
    (c) => `Ho controllato tre volte le statistiche di ${c.loser}, pensavo fosse un errore del sito. Invece no: hanno fatto davvero quei punti lì. Tutti veri. Incredibile.`,
    (c) => `Mi hanno spiegato che ${c.loser} aveva studiato il nostro lineup tutta la settimana. Ottimo lavoro di analisi: peccato che poi bisogna anche giocarla, la partita.`,
    (c) => `${c.margin} punti di differenza non sono un dettaglio, sono una dichiarazione. E la firma in calce è quella di ${c.topName}.`,
    (c) => `A ${c.loser} è mancato solo un piccolo particolare questa settimana: i punti. Per il resto, prestazione impeccabile.`,
    (c) => `La loro difesa ha funzionato benissimo... a proteggere il nostro vantaggio. Da questo punto di vista, collaborativi come pochi.`,
    (c) => `C'è chi prepara le partite e chi prepara le scuse. Noi avevamo pronto ${c.topName}, loro avranno pronto un comunicato.`,
    (c) => `Statistica curiosa: quando giochiamo noi, ${c.loser} segna sempre meno del previsto. Sarà l'aria che tira dalle nostre parti.`,
    (c) => `Il loro miglior giocatore oggi? Il calendario, che prima o poi gli farà incontrare qualcun altro.`,
    // Mercato & draft
    (c) => `Al draft ridevano quando abbiamo chiamato certi nomi. Oggi ${c.topName} ha fatto ${c.topPts} punti. Non ridono più, ho controllato.`,
    (c) => `Consiglio di mercato gratuito per ${c.loser}: le waiver aprono martedì. Vi conviene farvi trovare puntuali, di roba da sistemare ne avete.`,
    (c) => `Qualcuno in questa lega colleziona giocatori, noi collezioniamo vittorie. Ognuno ha i suoi hobby, per carità.`,
    (c) => `Mi dicono che ${c.loser} sta già pensando alla prossima stagione. Comprensibile: questa mi pare archiviata da un pezzo.`,
    (c) => `Il nostro segreto? Guardiamo i giocatori, non i nomi. ${c.loser} invece al draft mi sembrava a un'asta di figurine.`,
    (c) => `${c.topName} l'avevano sottovalutato tutti, soprattutto ${c.loser}. Il bello è che continuano a sottovalutarci: per me possono continuare pure.`,
    // Rivalità & storia
    (c) => `Questa lega ha una gerarchia, e ogni tanto serve una domenica così per ricordarla a tutti. Soprattutto a ${c.loser}.`,
    (c) => `Le rivalità sono belle quando sono equilibrate. Con ${c.loser}, più che una rivalità, ultimamente è un servizio di consegna punti a domicilio.`,
    (c) => `Mi piace battere tutti, ma battere ${c.loser} ha sempre quel gusto in più. Tipo il caffè dopo pranzo: non è necessario, però com'è buono.`,
    (c) => `Dicono che ci temono. Fanno bene. Io al posto loro comincerei a temere anche il prossimo turno, e pure quello dopo.`,
    (c) => `${c.loser} è una squadra con una grande storia. Ecco, appunto: storia. Il presente, come si è visto, è roba nostra.`,
    (c) => `C'era una volta l'equilibrio tra noi e ${c.loser}. Bella favola. Come tutte le favole, è finita.`,
    // Minacce per il futuro
    (c) => `Il messaggio per le altre squadre è semplice: questa era la versione tranquilla. Quella cattiva la teniamo per i playoff.`,
    (c) => `Chi ci incontra la prossima settimana ha già visto cosa succede. Se vuole, può ancora chiedere il rinvio: noi capiamo.`,
    (c) => `Stiamo ancora carburando, e faccio ${c.margin} punti di margine a ${c.loser}. Quando saremo al massimo, servirà un'altra lega.`,
    (c) => `Segnatevi questa data: è il giorno in cui è finito il campionato degli altri. Il nostro inizia adesso.`,
    (c) => `${c.topName} mi ha chiesto scusa negli spogliatoi. "Coach, potevo fare di più". CAPITO? Potevo fare di più. Tremate.`,
    // Teatrali
    (c) => `Ci sono vittorie e poi ci sono dichiarazioni di intenti. Chiedete a ${c.loser} in quale categoria metterebbero questa.`,
    (c) => `Il football è poesia. Oggi ${c.topName} ha scritto un sonetto e ${c.loser} l'ha dovuto imparare a memoria.`,
    (c) => `Domenica alle 19 avevo già capito tutto. Alle 22 l'aveva capito anche ${c.loser}, ma ormai era tardi da un pezzo.`,
    (c) => `Ho promesso a mia nonna una vittoria senza soffrire. Nonna, questa era per te: non abbiamo sudato nemmeno una maglietta.`,
    (c) => `Il bello del fantasy è che ogni settimana può succedere di tutto. Il brutto, per ${c.loser}, è che con noi succede sempre la stessa cosa.`,
    (c) => `Mi hanno chiesto un commento elegante sulla partita. Eccolo: ${c.margin} punti. L'eleganza la lascio a chi perde.`,
    (c) => `Rigiocarla altre dieci volte? Vinciamo undici volte. La matematica non è un'opinione, chiedete pure al tabellone.`,
];

/** Frase extra quando il vincitore domina la serie: il coach la rinfaccia */
export const STREAK_JABS = [
    (n, loser) => ` E comunque sono ${n} di fila contro ${loser}: a questo punto più che una rivalità è un abbonamento.`,
    (n, loser) => ` ${n} vittorie consecutive nello scontro diretto: quando ${loser} ci vede in calendario, mi dicono che spegne il telefono.`,
    (n, loser) => ` Per la cronaca: non ci battono da ${n} partite. Alla prossima porto io la torta per l'anniversario.`,
    (n, loser) => ` ${n} scontri diretti di fila dalla nostra parte. Non è più una statistica, è una tradizione di famiglia.`,
];

/* ───────────────────────────────────────────────────────────────
   GOSSIP — 50 scuse da tabloid per il flop di giornata.
   Frasi che completano: "…filtrano indiscrezioni su {scusa}"
   ─────────────────────────────────────────────────────────────── */
export const GOSSIP_EXCUSES = [
    `una serata karaoke chiusa alle 4 del mattino con una versione molto sentita di "My Heart Will Go On"`,
    `un all-you-can-eat di sushi sabato sera in cui avrebbe "ampiamente superato la soglia del buonsenso"`,
    `una maratona notturna di serie TV: pare abbia finito tre stagioni in una notte, "e non delle migliori"`,
    `una grigliata di compleanno del cugino protrattasi ben oltre l'orario da professionisti`,
    `una sessione di ranked ai videogiochi durata fino all'alba, chiusa peraltro con cinque sconfitte di fila`,
    `un trasloco "aiutato malvolentieri" che gli avrebbe lasciato dolori ovunque`,
    `un avvistamento al centro commerciale, venerdì pomeriggio, intento a comprare candele profumate per due ore`,
    `un corso di ceramica iniziato per scommessa e preso, a quanto pare, fin troppo sul serio`,
    `una lite furibonda con il navigatore che l'avrebbe portato a 80 chilometri dallo stadio`,
    `un tentativo di preparare la carbonara per dodici persone finito con l'intervento della padrona di casa`,
    `una peperonata delle 23:45 definita dai presenti "una decisione sbagliata sotto ogni punto di vista"`,
    `una serata trivia al pub in cui avrebbe insistito per giocare "ancora un round" per sei volte`,
    `un matrimonio di parenti alla lontana con balli di gruppo documentati fino a notte fonda`,
    `una partita di padel "amichevole" finita 3 ore dopo con due tempi supplementari e un litigio`,
    `un documentario sui polpi che l'avrebbe "toccato nel profondo" impedendogli di dormire`,
    `un mercatino dell'antiquariato domenicale in cui avrebbe trattato per ore il prezzo di una lampada`,
    `una nuova dieta a base di sole zuppe iniziata, per sua stessa ammissione, "nel giorno sbagliato"`,
    `un pomeriggio passato a montare una libreria svedese con tre viti avanzate e il morale a terra`,
    `una escape room aziendale in cui sarebbe rimasto chiuso più a lungo del previsto, e non per gioco`,
    `una serata di degustazione vini in cui i calici "erano piccoli ma tanti"`,
    `un rewatch integrale della sua peggior partita, consigliato dallo psicologo e sconsigliato da chiunque altro`,
    `un'asta online vinta alle 3 di notte per un tostapane vintage: la gioia gli avrebbe tolto il sonno`,
    `una gita fuori porta con sosta imprevista di quattro ore all'outlet`,
    `un torneo di braccio di ferro al bar del quartiere a cui "non poteva dire di no"`,
    `una playlist sbagliata in riscaldamento: solo ballad anni '80, concentrazione compromessa`,
    `un oroscopo particolarmente negativo letto poco prima del kickoff e preso malissimo`,
    `un barbecue "leggero" da sette portate organizzato dal vicino di casa proprio sabato`,
    `una nuova poltrona massaggiante da cui non sarebbe più riuscito ad alzarsi`,
    `un tutorial di magia con le carte provato per tutta la notte senza successo`,
    `un digiuno intermittente interpretato, secondo fonti vicine, "al contrario"`,
    `una discussione di tre ore nel gruppo della lega sul regolamento delle waiver, persa pure quella`,
    `un pomeriggio da paletta e secchiello: castello di sabbia crollato, umore idem`,
    `una fila di quattro ore per il lancio di uno smartphone che nemmeno gli serviva`,
    `una lezione di acquagym prenotata per sbaglio e frequentata "per non buttare i soldi"`,
    `una puntata di un reality di pasticceria che l'avrebbe convinto a tentare un millefoglie alle 2 di notte`,
    `un karaoke aziendale in cui avrebbe insistito per duettare da solo`,
    `una passeggiata "digestiva" di 18 chilometri suggerita dallo smartwatch e rimpianta al chilometro 3`,
    `una serata al planetario conclusa con domande esistenziali e zero ore di sonno`,
    `un cambio gomme fai-da-te che avrebbe richiesto l'intervento di due amici e un carro attrezzi`,
    `una challenge di piccante con il fratello: vinta la challenge, persa la domenica`,
    `un'ora e mezza passata al telefono con il servizio clienti per una friggitrice ad aria mai arrivata`,
    `una raccolta funghi all'alba finita con zero funghi e una storta`,
    `un pigiama party dei figli con quattro bambini "tecnicamente suoi ospiti, praticamente suoi capi"`,
    `una serata di giochi da tavolo degenerata su una regola contestata del Monopoly`,
    `una visita guidata di sei ore a un museo del prosciutto, "bellissima ma stancante"`,
    `un abbonamento in palestra riesumato con troppo entusiasmo: leg day il sabato, mai il sabato`,
    `una diretta notturna per seguire il mercato di un campionato estero di terza fascia`,
    `una cena etnica "fusion sperimentale" di cui il suo stomaco chiederebbe ancora spiegazioni`,
    `un pomeriggio intero a cercare il regalo perfetto per la suocera, senza trovarlo`,
    `una sessione di meditazione guidata in cui si sarebbe semplicemente addormentato fino a sera`,
];

/* ───────────────────────────────────────────────────────────────
   PROSE — mattoni per il racconto prolisso.
   ─────────────────────────────────────────────────────────────── */

export const LEDE_OPENERS = [
    `Sotto i riflettori di una domenica che prometteva scintille, `,
    `C'era elettricità nell'aria fin dal giovedì sera, e il campo non ha tradito le attese: `,
    `Le settimane si somigliano tutte finché non arriva quella che lascia il segno: `,
    `Il copione sembrava scritto, ma il football americano ha l'abitudine di strappare le pagine: `,
    `Mettetevi comodi, perché questa è una di quelle partite che verranno raccontate a lungo: `,
    `Il weekend della Topina League si è acceso quando contava, `,
    `Ci sono domeniche in cui i numeri raccontano tutto, e questa è una di quelle: `,
    `Alla vigilia si parlava di equilibrio, di dettagli, di episodi. Poi si è giocato, e `,
    `La cronaca a volte è un romanzo compresso in tre giorni di partite: `,
    `Tra sfottò social e formazioni annunciate all'ultimo minuto, `,
];

export const MARGIN_THRILLER = [
    `Un'esecuzione al cardiopalma, decisa da appena {margin} punti: roba da controllare il punteggio col binocolo fino all'ultimo snap del lunedì notte.`,
    `Solo {margin} punti alla fine separano gioia e disperazione: una partita che ha consumato divani, unghie e amicizie.`,
    `{margin} punti di margine sono un soffio, e il soffio stavolta ha spettinato {loser} proprio sulla linea del traguardo.`,
];

export const MARGIN_BLOWOUT = [
    `Non c'è mai stata partita: {margin} punti di scarto sono una sentenza passata in giudicato, senza possibilità d'appello.`,
    `Una valanga da {margin} punti che ha travolto ogni velleità di {loser} già prima del piatto forte della domenica.`,
    `{margin} punti di differenza: più che un risultato, un manifesto programmatico affisso in ogni bacheca della lega.`,
];

export const MARGIN_NORMAL = [
    `Alla fine il tabellone dice {margin} punti di margine: partita vera per un tempo, poi la qualità ha presentato il conto.`,
    `{margin} punti di scarto maturati con la pazienza di chi sa aspettare il momento giusto per affondare.`,
    `Un successo da {margin} punti, costruito senza fretta e amministrato con la calma dei forti.`,
];

export const TOP_PLAYER_PHRASES = [
    `La copertina è tutta per {top}, monumentale: {stat} per un bottino da {pts} punti che vale il titolo a nove colonne.`,
    `A prendersi la scena è {top}: {stat}, {pts} punti e la sensazione che il campo fosse casa sua.`,
    `Il nome sulla bocca di tutti è {top}: {pts} punti pesantissimi ({stat}) e avversari ridotti a spettatori paganti.`,
    `Serviva un protagonista e si è presentato {top}: {stat}, per {pts} punti che hanno indirizzato tutta la contesa.`,
];

export const NOTE_LEADS = [
    `Applausi anche per`,
    `Nel taccuino dei promossi finisce`,
    `Mezzo voto in più per`,
    `Menzione d'onore per`,
    `Sotto traccia, ma decisivo:`,
    `Il pagellone sorride a`,
];

export const CLOSERS = [
    `La sensazione, netta, è che questa squadra abbia ancora marce da scoprire.`,
    `E in fondo alla classifica generale, qualcuno ha appena iniziato a fare i conti.`,
    `Il resto della lega è avvisato: qui nessuno ha intenzione di rallentare.`,
    `Una domenica che lascia strascichi, e non solo nel punteggio.`,
    `Gli almanacchi registrano, i rivali rosicano: avanti così.`,
];

/* ───────────────────────────────────────────────────────────────
   INTERVISTE AI GIOCATORI — riempiono gli spazi vuoti del giornale.
   ─────────────────────────────────────────────────────────────── */

/** Vincitori che gongolano. c: { name, pts, team, opp } */
export const PLAYER_QUOTES_WIN = [
    (c) => `«Sapevamo di poterli battere, l'avevo detto già in settimana. ${c.opp}? Squadra vera, per carità. Ma noi di più.»`,
    (c) => `«${c.pts} punti? Potevano essere di più, ho lasciato qualcosa là fuori. Il coach lo sa e infatti non mi ha ancora ringraziato abbastanza.»`,
    (c) => `«Non guardo mai il punteggio durante le partite. Poi però l'ho guardato, e mi sono messo comodo.»`,
    (c) => `«Dedico la prestazione a chi al draft ha storto il naso quando è uscito il mio nome. Tenetevi il naso storto, io mi tengo i punti.»`,
    (c) => `«La verità? ${c.opp} ci ha creduto per un quarto. Poi ha conosciuto la realtà, e la realtà eravamo noi.»`,
    (c) => `«Qui si lavora in silenzio. Poi la domenica parliamo, e mi pare che oggi il discorso sia stato piuttosto chiaro.»`,
    (c) => `«Il mio segreto? Dormire nove ore e non leggere i pronostici della redazione, che ci davano sotto pure stavolta.»`,
    (c) => `«${c.team} è una famiglia. Una famiglia che la domenica va a mangiare a casa degli altri, come oggi.»`,
    (c) => `«Mi hanno chiesto se sono in forma. Guardate il tabellino e rispondetevi da soli, io ho da festeggiare.»`,
    (c) => `«C'è chi parla tutta la settimana e chi si fa trovare pronto. Oggi si è visto benissimo chi fa cosa.»`,
    (c) => `«Rispetto per ${c.opp}, sempre. Ma quando entro in campo il rispetto lo lascio negli spogliatoi, insieme alle loro speranze.»`,
    (c) => `«Il piano partita era semplice: palla a me nei momenti che contano. Come vedete, i piani semplici sono i migliori.»`,
];

/** Sconfitti che masticano amaro. c: { name, pts, team, opp } */
export const PLAYER_QUOTES_LOSS = [
    (c) => `«Preferisco non commentare. Anzi no, un commento lo faccio: rivediamoci tra una settimana e poi ne riparliamo.»`,
    (c) => `«Bruciare così fa male, inutile negarlo. Ma il campionato è lungo e la memoria mia è lunghissima.»`,
    (c) => `«Complimenti a ${c.opp}, hanno meritato. Ecco, l'ho detto. Non chiedetemi di ripeterlo mai più.»`,
    (c) => `«I miei ${c.pts} punti non sono bastati e questo mi brucia il doppio. Da soli non si vince, serve che remino tutti.»`,
    (c) => `«Giornate così capitano. Il problema è quando capitano sempre contro la stessa squadra: qualcosa dovremo pur cambiarla.»`,
    (c) => `«Non cerco scuse, non è il mio stile. Però qualcuno in questo roster dovrebbe farsi un esame di coscienza, e non faccio nomi.»`,
    (c) => `«Il coach dice che dobbiamo restare uniti. Giusto. Uniti e possibilmente più svegli dal primo snap, aggiungo io.»`,
    (c) => `«Ho già cancellato questa partita dalla memoria. Peccato che il tabellone della lega non si cancelli.»`,
    (c) => `«${c.opp} più forte di noi? Oggi sì. In generale, ho i miei dubbi, e me li tengo stretti per il ritorno.»`,
    (c) => `«Il mercato di martedì? Non tocca a me deciderlo. Ma se fossi il coach, un pensierino ce lo farei eccome.»`,
    (c) => `«Chi mi conosce sa che odio perdere pure a carte. Stanotte non dormo, e da domani si torna a fare sul serio.»`,
    (c) => `«Dicono che il fantasy sia un gioco. Sì, come no. Ditelo alla mia faccia di adesso, che il gioco se lo gode qualcun altro.»`,
];

/** Panchinari d'oro: tanti punti, zero minuti — e ce l'hanno col coach. c: { name, pts, team } */
export const BENCH_RAGE = [
    (c) => `«${c.pts} punti. Dalla PANCHINA. Qualcuno in società mi deve una spiegazione, possibilmente lunga e con le slide.»`,
    (c) => `«Il coach parla di scelta tecnica. Tecnica de che, con rispetto parlando? Io i punti li ho fatti pure in tuta.»`,
    (c) => `«Non sono arrabbiato, sono furioso, che è diverso. ${c.pts} punti a guardare gli altri: complimenti a chi fa le formazioni.»`,
    (c) => `«Ho letto la formazione dieci minuti prima del kickoff e ho dovuto rileggerla tre volte. Poi ho fatto ${c.pts} punti così, per ripicca.»`,
    (c) => `«Al mio procuratore ho già detto tutto. Se a ${c.team} non serve uno da ${c.pts} punti a settimana, il mercato è grande.»`,
    (c) => `«Il coach dice che mi "gestisce". Gestita bene, eh: ${c.pts} punti in panchina. Alla prossima gestione cambio sport.»`,
    (c) => `«Niente polemiche, davvero. Dico solo che il mio divano domenica ha visto più punti della nostra lineup. Poi fate voi.»`,
    (c) => `«Mi hanno spiegato che era una questione di matchup. Il matchup, capito. Intanto il matchup l'ho vinto io, da seduto.»`,
    (c) => `«${c.pts} punti fantasma, dicono. Fantasma sarà chi ha compilato la formazione: io ero lì, bello visibile, in panchina.»`,
    (c) => `«Sorrido perché sono un professionista. Dentro però tengo il conto: e il conto, al momento, dice ${c.pts} punti buttati.»`,
    (c) => `«Chiedo ufficialmente un incontro con la dirigenza. Ordine del giorno: come si legge una proiezione punti. Porto io i biscotti.»`,
    (c) => `«Non voglio creare un caso. Il caso si è creato da solo quando qualcuno ha deciso che ${c.pts} punti stavano meglio in panchina.»`,
];

/* ───────────────────────────────────────────────────────────────
   TOPINA HONORS — citazioni per il box della notte dei premi.
   c: { name, pts, team } dove pertinente.
   ─────────────────────────────────────────────────────────────── */

/** Il Super Bowl MVP (miglior giocatore della FINALE, non della stagione) */
export const SB_MVP_QUOTES = [
    `Sapevo che sarebbe stata la mia notte. Nelle finali o sei pronto o resti a guardare, e io ero pronto.`,
    `Il coach mi ha chiesto di essere presente nei momenti che contano. Ho risposto nel modo che preferisco: coi fatti.`,
    `L'ultima gara dell'anno è anche la più importante: potevo sbagliare tutto tranne questa, e infatti non ho sbagliato niente.`,
    `Ho sognato questa partita per settimane. La realtà, per una volta, è stata anche meglio del sogno.`,
    `Un Super Bowl si vince nei dettagli. Io ho pensato ai dettagli, gli altri hanno pensato alle interviste post-partita.`,
    `Quando sei lì, sotto i riflettori più grandi della stagione, capisci per cosa hai lavorato tutto l'anno.`,
    `Non gioco per il trofeo del MVP, gioco per vincere. Poi però se arriva anche il trofeo, mica lo rifiuto.`,
    `Il primo pensiero, appena finito il fischio, è andato ai compagni. Il secondo, sinceramente, a chi non credeva in noi.`,
    `Le finali si ricordano per una giocata, un nome, un momento. Stanotte quel nome era il mio, e ci ho messo la firma.`,
    `Mi hanno chiesto se me l'aspettavo. Onestamente sì: ci alleniamo per essere pronti proprio a notti come questa.`,
    `Quando il gioco si fa duro, qualcuno deve prendersi la responsabilità. Stasera quel qualcuno ero io, con piacere.`,
    `Un trofeo di squadra, una notte da protagonista. Va bene così: il merito è di tutti, la statistica un po' più mia.`,
];

/** Defensive Player of the Year, dichiarazione a fine stagione */
export const DPOY_HONORS_QUOTES = [
    `«Nessuno guarda mai la difesa finché non serve. Poi arriva la stagione dei premi e improvvisamente tutti se ne ricordano.»`,
    `«Ho sempre detto che le partite si vincono fermando l'attacco avversario. Quest'anno l'ho anche dimostrato con i numeri.»`,
    `«Il premio è bello, i sack e i turnover forzati sono più belli ancora: quelli restano scritti per sempre.»`,
    `«In pochi puntano sulla difesa al draft. Chi lo ha fatto quest'anno può ringraziarmi con calma, non c'è fretta.»`,
    `«Difendere non fa notizia come segnare. Ma alla fine della stagione, guarda un po', il trofeo lo alzo comunque io.»`,
    `«Ogni settimana mi dicevano che l'attacco avversario era troppo forte per noi. Ogni settimana rispondevamo sul campo.»`,
    `«Il mio lavoro è rovinare le domeniche degli altri. Quest'anno l'ho fatto meglio di chiunque altro nella lega.»`,
    `«Chi mi sottovaluta in vista del prossimo draft farebbe bene a rivedersi le statistiche di quest'anno, con calma.»`,
    `«Le difese vincono i campionati, lo dicono tutti. Io l'ho solo confermato con un trofeo personale.»`,
];

/** Coach of the Year, riflessione a fine stagione */
export const COACH_HONORS_QUOTES = [
    `«Gestire un roster è un lavoro di pazienza. Quest'anno la pazienza ha pagato più di ogni singola scelta di lineup.»`,
    `«Il segreto è semplice: schierare chi deve giocare, senza farsi ingannare dai nomi altisonanti in panchina degli altri.»`,
    `«Ho passato più ore a studiare le proiezioni che a dormire. Il premio, in fondo, è anche un premio all'insonnia.»`,
    `«Quando fai le scelte giuste ogni settimana, i punti lasciati in panchina si contano sulle dita di una mano.»`,
    `«Non sono il manager più fortunato della lega, sono solo quello che guarda i numeri con più attenzione degli altri.»`,
    `«Il mio lineup ottimale è quasi sempre quello vero in campo. Agli altri manager auguro di arrivarci, prima o poi.»`,
    `«Dietro ogni buona stagione c'è un roster gestito bene. Dietro questo premio, invece, ci sono ore e ore di tabelle.»`,
    `«C'è chi festeggia il draft e si addormenta sugli allori. Io le waiver le controllo ogni martedì, senza eccezioni.»`,
];

/* ───────────────────────────────────────────────────────────────
   RIVALITÀ / H2H — mainParagraphs P3 (Magazine).
   ─────────────────────────────────────────────────────────────── */

/** c: { record, w } — record = "14-9" o "14-9 (più 2 pareggi)" già formattato */
export const RIVALRY_OPENERS = [
    (c) => `E poi c'è il capitolo rivalità, che da queste parti non passa mai di moda: con il successo di oggi il bilancio all-time dello scontro diretto si aggiorna sul ${c.record} in favore di ${c.w}.`,
    (c) => `Capitolo a parte merita la rivalità storica tra le due squadre: il conto complessivo dei precedenti dice ora ${c.record} per ${c.w}, e la lavagna continua a pendere sempre dalla stessa parte.`,
    (c) => `C'è poi la lunga storia dei precedenti, che questa lega non si stanca mai di aggiornare: ${c.record} il bilancio all-time a favore di ${c.w}, numeri che iniziano a pesare.`,
    (c) => `Chi segue la lega da anni sa quanto conti questo incrocio: il computo storico sale a ${c.record} per ${c.w}, un margine che comincia a fare statistica.`,
    (c) => `Ogni volta che si incontrano scatta il capitolo rivalità, ed è puntualmente lo stesso ritornello: ${c.record} il bilancio all-time, ${c.w} sempre un passo avanti.`,
    (c) => `Nel grande libro dei precedenti si aggiunge un'altra pagina a favore di ${c.w}, che porta il conto complessivo sul ${c.record}.`,
    (c) => `La sfida ha anche un retrogusto di rivincite antiche: il bilancio all-time recita ora ${c.record}, e a comandare resta ${c.w}.`,
    (c) => `Guardando l'albo dei precedenti, la storia continua a sorridere a ${c.w}: ${c.record} il computo complessivo, aggiornato oggi stesso.`,
    (c) => `Aggiornato anche il capitolo statistico della rivalità: ${c.record} il bilancio storico, con ${c.w} sempre in controllo del discorso.`,
    (c) => `Val la pena ricordarlo per chi segue i precedenti: siamo a quota ${c.record} nello scontro diretto, e ${c.w} continua a comandare.`,
    (c) => `La rivalità tra le due franchigie ha una lunga memoria, e la memoria oggi dice ${c.record} in favore di ${c.w}.`,
    (c) => `Tra le due squadre non corre buon sangue da anni, e il tabellino storico lo conferma: ${c.record}, sempre a vantaggio di ${c.w}.`,
];

/** c: { record, w } — record stagionale tipo "2-1" */
export const SEASON_SERIES_LINES = [
    (c) => `In stagione la serie dice ora ${c.record} per ${c.w}.`,
    (c) => `Guardando solo quest'annata, il conto tra le due è ${c.record} a vantaggio di ${c.w}.`,
    (c) => `Limitandosi alla stagione in corso, la serie interna recita ${c.record} per ${c.w}.`,
    (c) => `Anche il capitolo stagionale premia ${c.w}, avanti ${c.record} nei precedenti dell'anno.`,
    (c) => `Nel mini-torneo tra le due squadre di quest'anno, ${c.w} comanda ${c.record}.`,
    (c) => `Il derby in versione 2024... ops, di quest'anno, dice ${c.record} per ${c.w}.`,
    (c) => `Restringendo il campo alla sola regular season in corso, ${c.w} è avanti ${c.record}.`,
    (c) => `Anche i conti dell'annata sorridono a ${c.w}, che sale a ${c.record} nella serie stagionale.`,
];

/** c: { len, w, l } — len = vittorie consecutive incluso questo risultato */
export const STREAK_ALIVE_LINES = [
    (c) => `Soprattutto, con questa fanno ${c.len} vittorie consecutive di ${c.w} nel confronto diretto: dalle parti di ${c.l} questo derby è diventato ufficialmente materia da psicologo sportivo.`,
    (c) => `E sono ${c.len} di fila per ${c.w} in questo incrocio: a ${c.l} serve una scintilla, perché al momento buio non se ne vede.`,
    (c) => `Il dato che pesa di più: ${c.len}ª vittoria consecutive di ${c.w} nello scontro diretto. A ${c.l} restano solo i ricordi delle volte in cui andava diversamente.`,
    (c) => `${c.w} allunga a ${c.len} la striscia di successi in questo derby: per ${c.l} è ormai un tabù conclamato.`,
    (c) => `Con questa sono ${c.len} vittorie di fila nel confronto diretto: ${c.l} inizia seriamente a chiedersi cosa cambiare.`,
    (c) => `${c.len} successi consecutivi per ${c.w} in questo incrocio: la striscia si allunga, e con essa la pazienza di ${c.l}.`,
    (c) => `Fa ${c.len} di fila per ${c.w} in questo confronto diretto. A questo punto meritano un abbonamento speciale contro ${c.l}.`,
    (c) => `${c.l} non riesce proprio a spezzare l'incantesimo: ${c.len}ª sconfitta consecutiva nello scontro diretto con ${c.w}.`,
    (c) => `La striscia personale di ${c.w} contro ${c.l} arriva a ${c.len}: numeri da vera e propria bestia nera.`,
];

/** c: { len, l } — len = successi consecutivi interrotti oggi */
export const STREAK_BROKEN_LINES = [
    (c) => `Vittoria che vale doppio anche per la storia recente: si interrompe la serie di ${c.len} successi consecutivi di ${c.l} nello scontro diretto. La maledizione, se mai è esistita, è archiviata.`,
    (c) => `C'è anche un tabù che cade: erano ${c.len} le vittorie di fila di ${c.l} in questo derby, e da oggi quella striscia è solo un ricordo.`,
    (c) => `Si ferma a ${c.len} la striscia di ${c.l} nel confronto diretto: una liberazione lunga attesa, arrivata proprio oggi.`,
    (c) => `${c.l} vedeva questo incrocio come un terreno amico da ${c.len} vittorie di fila. Non più, a partire da adesso.`,
    (c) => `Cade dopo ${c.len} vittorie consecutive il dominio di ${c.l} in questo derby: pagina voltata, statistica azzerata.`,
    (c) => `Una striscia da ${c.len} successi di fila per ${c.l} si interrompe proprio qui, nel momento meno atteso.`,
    (c) => `Finisce a ${c.len} il regno di ${c.l} in questo scontro diretto: un tabù che durava da tempo, e che oggi si è sciolto.`,
];

/** c: { name, wins } — squadra in testa alla classifica */
export const STANDINGS_LEADER_LINES = [
    (c) => `Alla voce classifica, comanda ${c.name} con ${c.wins} vittorie: tutte le altre sono avvisate.`,
    (c) => `In vetta resta saldamente ${c.name}, a quota ${c.wins} vittorie: il resto della lega insegue.`,
    (c) => `La classifica generale continua a sorridere a ${c.name}: ${c.wins} vittorie e passo del leader.`,
    (c) => `${c.name} guarda tutti dall'alto con ${c.wins} vittorie: per detronizzarla servirà ben altro.`,
    (c) => `Nessun cambiamento al vertice: ${c.name} comanda con ${c.wins} vittorie, e non sembra intenzionata a mollare.`,
    (c) => `${c.name} incassa e resta in testa a quota ${c.wins}: le inseguitrici prendano pure appunti.`,
    (c) => `Il trono della classifica resta occupato da ${c.name}, ${c.wins} vittorie e nessuna intenzione di cederlo.`,
];

/* ───────────────────────────────────────────────────────────────
   TACCUINO — classifica e mercato.
   ─────────────────────────────────────────────────────────────── */

/** c: { name, wins, pf } — apertura del Taccuino, stato della classifica */
export const NOTEBOOK_LEADER_LINES = [
    (c) => `La classifica, dopo l'ultimo turno, parla chiaro: comanda ${c.name} con ${c.wins} vittorie e ${c.pf} punti totali all'attivo.`,
    (c) => `Aggiornata la graduatoria: in testa resta ${c.name}, forte di ${c.wins} vittorie e ${c.pf} punti fatti.`,
    (c) => `Il quadro dopo l'ultimo turno è netto: ${c.name} guida con ${c.wins} vittorie e ${c.pf} punti totalizzati.`,
    (c) => `Guardando la classifica aggiornata, il trono resta di ${c.name}: ${c.wins} vittorie, ${c.pf} punti fatti.`,
    (c) => `Poche sorprese in vetta: ${c.name} resta prima con ${c.wins} vittorie e ${c.pf} punti all'attivo.`,
    (c) => `Il bollettino di classifica dice ${c.name} in testa: ${c.wins} vittorie e ${c.pf} punti fatti finora.`,
    (c) => `A comandare, dopo questo turno, è sempre ${c.name}: ${c.wins} vittorie e ${c.pf} punti totali sul groppone delle rivali.`,
    (c) => `Nessun ribaltone in vetta: ${c.name} si conferma prima con ${c.wins} vittorie e ${c.pf} punti fatti.`,
];

/** c: { chaser } — seconda in classifica appaiata alla prima */
export const GAP_TIED_LINES = [
    (c) => `${c.chaser} è lì, appaiata in vetta: la volata è apertissima e ogni singolo punto fatto può diventare oro colato.`,
    (c) => `A braccetto in testa c'è anche ${c.chaser}: sarà una corsa punto a punto fino in fondo.`,
    (c) => `${c.chaser} tallona a pari vittorie: da qui alla fine deciderà chi sbaglia meno.`,
    (c) => `Occhio a ${c.chaser}, appaiata proprio in cima: il vantaggio, di fatto, oggi non esiste.`,
    (c) => `${c.chaser} viaggia sugli stessi ritmi e resta incollata in vetta: che spettacolo la volata che si prepara.`,
    (c) => `Nessun distacco: ${c.chaser} condivide la vetta e promette battaglia fino all'ultima giornata.`,
];

/** c: { chaser, gapTxt } — gapTxt già formattato tipo "3 lunghezze" */
export const GAP_AHEAD_LINES = [
    (c) => `${c.chaser} insegue a ${c.gapTxt}: margine vero, ma non ancora un'ipoteca.`,
    (c) => `Alle spalle scalpita ${c.chaser}, a ${c.gapTxt} di distanza: nulla è ancora scritto.`,
    (c) => `${c.chaser} resta a contatto, staccata di ${c.gapTxt}: la rincorsa è tutt'altro che impossibile.`,
    (c) => `A ${c.gapTxt} dalla vetta c'è ${c.chaser}, che aspetta solo un passo falso altrui per riaprire tutto.`,
    (c) => `${c.chaser} tiene il passo a ${c.gapTxt}: distanza che si accorcia o si allarga in fretta, in questa lega.`,
    (c) => `Il distacco da ${c.chaser} è di ${c.gapTxt}: comodo, ma tutt'altro che incolmabile da qui alla fine.`,
];

/* ───────────────────────────────────────────────────────────────
   FLOP / GOSSIP — wrapper attorno alla scusa pescata da GOSSIP_EXCUSES.
   ─────────────────────────────────────────────────────────────── */

/** c: { name, pts, avg, team, excuse } — storia principale */
export const FLOP_WRAP_MAIN = [
    (c) => `Dall'altra parte della moviola, la serata da incubo porta il nome di ${c.name}: appena ${c.pts} punti a referto contro una media stagionale di ${c.avg}, un buco nel lineup che ${c.team} ha pagato a prezzo pieno e senza sconti. E qui la cronaca sconfina nel gossip, perché dalla redazione filtrano indiscrezioni su ${c.excuse}. Il diretto interessato smentisce con fermezza, l'entourage minimizza, ma i punti — quelli — purtroppo restano a referto.`,
    (c) => `Sul fronte opposto va in scena il dramma di ${c.name}: solo ${c.pts} punti, lontanissimo dalla sua media di ${c.avg}, in un lineup di ${c.team} che oggi ha fatto acqua da quella casella. Voce di corridoio della redazione: dietro alla prestazione ci sarebbe ${c.excuse}. Comunicato di smentita in arrivo, i numeri però restano quelli.`,
    (c) => `Capitolo dolori per ${c.team}, con ${c.name} fermo a ${c.pts} punti contro i suoi consueti ${c.avg} di media: un tonfo che pesa. Il pettegolezzo della settimana racconta di ${c.excuse}: prendetelo con le pinze, ma il tabellino no, quello è definitivo.`,
    (c) => `Non tutte le storie di giornata sono liete, e quella di ${c.name} lo dimostra: ${c.pts} punti, ben sotto la sua media di ${c.avg}, per la disperazione di ${c.team}. Nei corridoi della redazione si parla di ${c.excuse}. Vero o no, il punteggio non cambia.`,
    (c) => `Da segnalare anche il naufragio di ${c.name}, ${c.pts} punti contro una media di ${c.avg}: una domenica da cancellare per ${c.team}. La versione non ufficiale, raccolta qua e là, parla di ${c.excuse}. Il campo, purtroppo per lui, non fa sconti.`,
    (c) => `Amarezza invece per ${c.team}, tradita dai ${c.pts} punti di ${c.name}: numeri lontanissimi dalla media di ${c.avg}. Il retroscena che circola in redazione chiama in causa ${c.excuse}. Chi vivrà, vedrà; chi ha letto il tabellino, ha già visto abbastanza.`,
    (c) => `Nel giorno sbagliato per eccellenza si è imbattuto ${c.name}: ${c.pts} punti, contro una media stagionale di ${c.avg}, in casa ${c.team}. E la solita fonte anonima sussurra di ${c.excuse}: prendetela per quel che vale, cioè poco più di un pettegolezzo.`,
];

/** c: { name, pts, avg, excuse } — storia secondaria */
export const FLOP_WRAP_SECONDARY = [
    (c) => `Serata storta invece per ${c.name}, fermo a ${c.pts} punti contro una media stagionale di ${c.avg}: dalla redazione filtrano indiscrezioni su ${c.excuse}. Smentite di rito dall'entourage, punti veri a referto.`,
    (c) => `Da segnalare anche il flop di ${c.name}, ${c.pts} punti ben sotto i suoi consueti ${c.avg}: pare ci sia di mezzo ${c.excuse}. Chiacchiericcio da spogliatoio, ma il tabellino è quello.`,
    (c) => `Non brilla ${c.name}, che si ferma a ${c.pts} punti (media ${c.avg}): tra i corridoi si racconta di ${c.excuse}. Voce non confermata, numero purtroppo sì.`,
    (c) => `Giornata da dimenticare per ${c.name}: ${c.pts} punti contro una media di ${c.avg}. Il gossip di redazione, stavolta, tira in ballo ${c.excuse}.`,
    (c) => `Anche qui c'è un naufrago di giornata: ${c.name}, fermo a ${c.pts} punti (media ${c.avg}). Si vocifera di ${c.excuse}, ma restiamo nel campo delle indiscrezioni.`,
    (c) => `${c.name} chiude a ${c.pts} punti, lontano dalla sua media di ${c.avg}: la solita fonte anonima parla di ${c.excuse}. Prendetela con le pinze.`,
];

/** c: { l } — nessun flop identificato, storia principale */
export const NO_FLOP_LINES = [
    (c) => `In casa ${c.l} non ci sono veri colpevoli, e forse è questa la notizia peggiore: quando perdi senza che nessuno tradisca le attese, il problema è il soffitto, non il pavimento.`,
    (c) => `${c.l} non ha un vero indiziato per la sconfitta, il che è quasi peggio: significa che il limite è strutturale, non un incidente di percorso.`,
    (c) => `Nessuno, in casa ${c.l}, ha giocato davvero male: semplicemente, l'avversario era un gradino sopra. Difficile prendersela con qualcuno in particolare.`,
    (c) => `Non c'è un singolo colpevole nella sconfitta di ${c.l}: a volte si perde così, in modo corale, e fa persino più male.`,
    (c) => `${c.l} esce sconfitta senza un vero capro espiatorio: la prestazione, nel complesso, era nella norma. Solo che la norma, oggi, non bastava.`,
    (c) => `Difficile puntare il dito in casa ${c.l}: nessuno ha steccato davvero, semplicemente la giornata non era quella giusta.`,
];

/* ───────────────────────────────────────────────────────────────
   MERCATO — waiver, wrapper per squadra (add/drop/entrambi).
   ─────────────────────────────────────────────────────────────── */

/** c: { team, adds, drops } — entrambi i movimenti nella stessa squadra */
export const WAIVER_WRAP_BOTH = [
    (c) => `Colpo di scena in casa ${c.team}: dentro ${c.adds}. Fuori ${c.drops}: la pazienza, evidentemente, era finita.`,
    (c) => `Rivoluzione, si fa per dire, in casa ${c.team}: arriva ${c.adds}, saluta ${c.drops}. Il mercato non aspetta nessuno.`,
    (c) => `Non sta ferma ${c.team}, che pesca ${c.adds} e lascia partire ${c.drops}: mossa a costo zero, in attesa di scoprirne il valore.`,
    (c) => `Cambio della guardia in casa ${c.team}: dentro ${c.adds}, fuori ${c.drops}. Il campo dirà se è stata una mossa astuta o un azzardo.`,
    (c) => `${c.team} rimescola le carte: firma ${c.adds} e taglia ${c.drops}. Il taccuino registra, il tempo giudicherà.`,
    (c) => `Non passa inosservata la mossa di ${c.team}: dentro ${c.adds}, fuori ${c.drops}. La lega è avvisata.`,
    (c) => `${c.team} non si accontenta e cambia pezzi: arriva ${c.adds}, esce ${c.drops}. Scelta rischiosa o mossa vincente? Lo dirà il campo.`,
];

/** c: { team, adds } — solo entrate */
export const WAIVER_WRAP_ADD_ONLY = [
    (c) => `Colpo di scena in casa ${c.team}: firmato ${c.adds}. Il taccuino promuove il coraggio, il campo giudicherà.`,
    (c) => `${c.team} si rinforza dal mercato dei liberi: dentro ${c.adds}, in cerca di quel qualcosa in più.`,
    (c) => `Non sta con le mani in mano ${c.team}, che pesca ${c.adds}: mossa a costo zero che potrebbe rivelarsi preziosa.`,
    (c) => `Piccolo ritocco in casa ${c.team}, che aggiunge ${c.adds} al proprio roster: vedremo se pagherà.`,
    (c) => `${c.team} allunga la panchina con ${c.adds}: una scommessa che non costa nulla e può rendere parecchio.`,
    (c) => `Arriva rinforzo per ${c.team}: dentro ${c.adds}, con la speranza che serva nelle settimane decisive.`,
];

/** c: { team, drops } — solo uscite */
export const WAIVER_WRAP_DROP_ONLY = [
    (c) => `Colpo di scena in casa ${c.team}: via ${c.drops}. Roster più corto, idee — si spera — più chiare.`,
    (c) => `${c.team} fa pulizia e lascia partire ${c.drops}: a volte tagliare fa parte del piano quanto firmare.`,
    (c) => `Sfoltimento in casa ${c.team}, che si separa da ${c.drops}: si libera spazio per la prossima mossa.`,
    (c) => `${c.team} taglia ${c.drops} senza troppi rimpianti: il roster ha bisogno di respirare.`,
    (c) => `Se ne va ${c.drops} dai ranghi di ${c.team}: la pazienza, a quanto pare, ha un limite anche in questa lega.`,
    (c) => `${c.team} preferisce alleggerire la rosa e saluta ${c.drops}: spazio libero per nuove idee.`,
];

/** Nessuna mossa di mercato nella week */
export const WAIVER_NO_MOVES = [
    `Mercato immobile questa settimana: nessuna mossa in waiver, nessuno squillo. Segno che i roster convincono i rispettivi manager... oppure che qualcuno si è semplicemente dimenticato la scadenza. Ai posteri — e alla prossima week — l'ardua sentenza.`,
    `Settimana di silenzio sul fronte mercato: zero movimenti in waiver. O sono tutti soddisfatti dei propri roster, o hanno perso il segnavia delle scadenze: la redazione propende per la seconda.`,
    `Waiver deserte questa volta: nessuna squadra ha sentito il bisogno di muoversi. Calma piatta che, in questa lega, di solito precede la tempesta.`,
    `Nessun movimento di mercato da segnalare: tutti fermi ai propri roster. Vedremo se la prossima settimana porterà più coraggio.`,
    `Mercato a zero mosse: possibile che i roster siano davvero a posto, oppure che qualcuno abbia semplicemente scordato di controllare le waiver.`,
    `Settimana piatta sul fronte trattative: nessun'entrata, nessuna uscita. Il taccuino, per una volta, resta senza notizie di mercato.`,
];

/* ───────────────────────────────────────────────────────────────
   STORIA SECONDARIA — apertura e chiusura senza flop/rivalità.
   ─────────────────────────────────────────────────────────────── */

/** Prefisso breve prima del nome delle due squadre nella storia secondaria */
export const SECONDARY_LEDE_OPENERS = [
    `Nell'altra sfida di giornata`,
    `Sul campo parallelo,`,
    `Dall'altro incontro della settimana,`,
    `Nella sfida gemella del turno,`,
    `Spostandoci sull'altro match della giornata,`,
    `Nel secondo atto della settimana,`,
    `Guardando l'altra sfida in cartellone,`,
    `Nell'altro capitolo della giornata,`,
];

/** c: { l, rec } — rec può essere null */
export const SECONDARY_NO_FLOP_LINES = [
    (c) => c.rec
        ? `${c.l} scivola così a ${c.rec} in stagione: niente di irreparabile, ma il calendario non aspetta nessuno e il mercato di martedì potrebbe raccontare qualcosa sul suo umore.`
        : `${c.l} esce ridimensionata dal weekend: la classifica adesso fa meno sorridere e il mercato di martedì potrebbe dire qualcosa sul suo umore.`,
    (c) => c.rec
        ? `Per ${c.l} la classifica ora recita ${c.rec}: si può ancora recuperare, ma le prossime settimane pesano già di più.`
        : `${c.l} incassa un colpo che pesa più del solito: la classifica non sorride e martedì, con le waiver, si vedrà la reazione.`,
    (c) => c.rec
        ? `${c.l} cade a ${c.rec}: nulla di drammatico, ma il margine d'errore da qui in avanti si assottiglia.`
        : `Serata da archiviare in fretta per ${c.l}, che ora dovrà stringere i denti nelle prossime uscite.`,
    (c) => c.rec
        ? `Con questa sconfitta ${c.l} scende a ${c.rec}: la corsa resta aperta, ma comincia a farsi ripida.`
        : `${c.l} si lecca le ferite: il weekend ha lasciato più dubbi che certezze, e il mercato potrebbe risentirne.`,
];

/* ───────────────────────────────────────────────────────────────
   POSTA IN PALIO — playoff/SB, usate raramente (poche volte a stagione).
   ─────────────────────────────────────────────────────────────── */

/** c: { year } */
export const STAKES_SB_LINES = [
    (c) => ` E stavolta non era una domenica qualsiasi: in palio c'era il titolo della Topina League ${c.year}.`,
    (c) => ` Posta in palio più alta non ce n'è: il titolo della Topina League ${c.year}, e con esso un posto nell'albo d'oro.`,
    (c) => ` Non una gara come le altre: la corona della Topina League ${c.year} aspettava solo di essere consegnata.`,
    (c) => ` In ballo c'era tutto: il trofeo della stagione ${c.year} e il diritto di sfottere il resto della lega fino a settembre.`,
];

export const STAKES_PLAYOFF_LINES = [
    ` Con un posto nel Super Bowl in palio, il peso specifico di ogni snap valeva doppio.`,
    ` Semifinale vera, di quelle in cui un episodio vale una stagione intera: il Super Bowl aspettava dietro l'angolo.`,
    ` In palio un biglietto per la finale: niente margine per distrazioni o scelte di lineup avventate.`,
    ` Posta altissima: chi vinceva si giocava il titolo, chi perdeva chiudeva qui la propria annata.`,
];

/** c: { titles } */
export const SB_TITLE_COUNT_LINES = [
    (c) => `Per il franchise è il titolo numero ${c.titles}: l'albo d'oro si aggiorna e il resto della lega può iniziare il conto alla rovescia verso il prossimo draft, con una missione sola.`,
    (c) => `Sale a quota ${c.titles} il computo dei titoli per questo franchise: la bacheca si allarga, gli avversari prendono nota.`,
    (c) => `È il trofeo numero ${c.titles} della storia del club: l'albo d'oro si riscrive, e la caccia al prossimo capitolo parte già da domani.`,
    (c) => `Titolo numero ${c.titles} in bacheca: la dinastia si allunga, e le rivali sanno già cosa le aspetta la prossima stagione.`,
];

/* ───────────────────────────────────────────────────────────────
   PAGINA ANALISI PARTITA — recapArticle() in matchup-analysis.js.
   Banche dedicate: la stessa partita non deve leggersi identica se
   aperta sia nell'Analisi sia nel Magazine.
   ─────────────────────────────────────────────────────────────── */

/** c: { nW, nL } — playoff */
export const AN_STAKES_PLAYOFF = [
    (c) => `In palio c'era un posto nel Super Bowl: ${c.nW} stacca il biglietto per la finale, per ${c.nL} la stagione si chiude qui.`,
    (c) => `Semifinale secca, senza domani: ${c.nW} vola in finale, ${c.nL} deve fare le valigie.`,
    (c) => `Chi vinceva andava al Super Bowl, chi perdeva chiudeva l'annata: ${c.nW} ha scelto la porta giusta, ${c.nL} quella sbagliata.`,
    (c) => `Una sola squadra poteva continuare a sognare il titolo: è ${c.nW}, mentre per ${c.nL} è già tempo di bilanci.`,
];

/** c: { nW, year } — super bowl */
export const AN_STAKES_SB = [
    (c) => `Una notte che vale tutto: con questo successo ${c.nW} si prende il titolo della Topina League ${c.year}.`,
    (c) => `Non capita tutte le settimane di giocarsi un titolo: ${c.nW} lo fa, e lo porta a casa.`,
    (c) => `Il trofeo della Topina League ${c.year} ha un nuovo proprietario: ${c.nW}, che si prende la notte più importante dell'anno.`,
    (c) => `Serata da incorniciare per ${c.nW}, che aggiunge il titolo ${c.year} alla propria bacheca.`,
];

/** c: { nW, w, l } — precedenti stagionali (w/l = record aggiornato) */
export const AN_SERIES_LINES = [
    (c) => `Contando i precedenti stagionali, il bilancio tra le due squadre ora dice ${c.w}-${c.l} in favore di ${c.nW}.`,
    (c) => `Sommando anche questa, il conto stagionale tra le due sale a ${c.w}-${c.l} per ${c.nW}.`,
    (c) => `Il computo dei precedenti in stagione recita ora ${c.w}-${c.l}, sempre a vantaggio di ${c.nW}.`,
    (c) => `Guardando i soli precedenti di quest'anno, ${c.nW} allunga a ${c.w}-${c.l}.`,
];

/** c: { name, pts, avg, extra } — extra = clausola yard, già formattata o stringa vuota */
export const AN_FLOP_WRAP = [
    (c) => `In casa ${c.loser} pesa la giornata no di ${c.name}: ${c.pts} punti contro una media stagionale di ${c.avg}${c.extra}`,
    (c) => `Nota stonata per ${c.loser}: ${c.name} si ferma a ${c.pts} punti, lontano dalla sua media di ${c.avg}${c.extra}`,
    (c) => `Non aiuta ${c.loser} la prestazione opaca di ${c.name}, fermo a ${c.pts} punti contro i consueti ${c.avg} di media${c.extra}`,
    (c) => `Da rivedere la prova di ${c.name} in casa ${c.loser}: appena ${c.pts} punti, ben sotto la media stagionale di ${c.avg}${c.extra}`,
];

/** c: { names, verb, nW } — verb = "hanno"/"ha" già concordato */
export const AN_HOT_STREAK_LINES = [
    (c) => `Tra i vincitori c'è chi viaggia a pieni giri: ${c.names} ${c.verb} dato profondità al punteggio di ${c.nW}.`,
    (c) => `Non solo il protagonista annunciato: anche ${c.names} ${c.verb} spinto forte in casa ${c.nW}.`,
    (c) => `${c.nW} può contare pure su un buon momento di forma di ${c.names}, in doppia cifra sulle attese.`,
    (c) => `A completare il quadro vincente, ${c.names} ${c.verb} confermato un ottimo momento di forma.`,
];

/** Compagni di squadra che elogiano il protagonista. c: { name } */
export const TEAMMATE_PRAISE = [
    (c) => `Giocare accanto a ${c.name} rende tutto più facile: tu fai il tuo, lui fa il doppio.`,
    (c) => `Ve lo dico da compagno: quello che ha fatto ${c.name} stanotte in allenamento lo vediamo ogni settimana. Non siamo più nemmeno sorpresi.`,
    (c) => `${c.name} è il primo ad arrivare e l'ultimo ad andarsene. Serate così non sono fortuna, sono la norma.`,
    (c) => `Quando ${c.name} entra in ritmo noi lo capiamo subito: cambia la faccia. Stanotte aveva QUELLA faccia già dal riscaldamento.`,
    (c) => `La copertina è sua e se l'è presa trascinandoci tutti: con uno così in squadra, il lavoro degli altri vale il doppio.`,
    (c) => `Io l'avevo detto a inizio anno che ${c.name} avrebbe fatto una stagione mostruosa. Nessuno mi ascolta mai.`,
    (c) => `La cosa più impressionante di ${c.name}? Che dopo una partita del genere era già negli spogliatoi a parlare della prossima.`,
    (c) => `Certe serate ti ricordano perché giochi a questo sport. Vedere ${c.name} così da vicino è un privilegio, punto.`,
    (c) => `Con ${c.name} in questa forma possiamo battere chiunque, e gli avversari fanno bene a preoccuparsi.`,
    (c) => `${c.name} in settimana era di un tranquillo sospetto. Ora sappiamo perché: aveva già deciso come sarebbe andata a finire.`,
];
