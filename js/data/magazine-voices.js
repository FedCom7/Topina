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
