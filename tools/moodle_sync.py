"""Überträgt in der Lern-App beantwortete Prüfungsfragen in die Moodle-Tests A–F der food akademie.

Nur Fragen aus dem App-Code werden angekreuzt: "+" mit der richtigen, "-" mit einer falschen Antwort.
Alle anderen bleiben leer. Danach wird der Versuch abgegeben (Moodle wertet den besten Versuch).

Aufruf:
  MOODLE_USER=... MOODLE_PASSWORD=... python3 moodle_sync.py --code code.txt --decks <ordner mit pa-gesetz.json …>
  python3 moodle_sync.py --code code.txt --decks <ordner> --offline <ordner mit attempt-Seiten p0.html …> --letter A
"""
import argparse, html, json, os, re, subprocess, sys, tempfile

BASE = 'https://moodle.food-akademie.de'
TESTS = {  # Buchstabe -> (Stapel-Datei, Kursmodul-ID)
    'A': ('pa-gesetz', 97439), 'B': ('pb-verkaeuflichkeit', 97464), 'C': ('pc-darreichung', 97465),
    'D': ('pd-lagerung-abgabe', 97466), 'E': ('pe-gefahren-wirkungen', 97467), 'F': ('pf-werbung', 97468),
}


def clean(t):
    t = re.sub(r'<(script|style)[^>]*>.*?</\1>', '', t, flags=re.S)
    t = re.sub(r'<br\s*/?>', '\n', t)
    t = re.sub(r'</?(a|span|strong|em|b|i|u|sup|sub|font)\b[^>]*>', '', t)
    t = re.sub(r'<[^>]+>', ' ', t)
    t = html.unescape(t)
    t = re.sub(r'[ \t\xa0]+', ' ', t)
    return re.sub(r'\s*\n\s*', '\n', t).strip()


def norm(t):
    return re.sub(r'\s+', ' ', t).strip().lower()


def parse_code(text):
    """'A: 13+ 78- 92+' -> {'A': {'q013': True, 'q078': False, …}}"""
    out = {}
    for line in text.splitlines():
        m = re.match(r'\s*([A-F])\s*:\s*(.*)$', line)
        if not m:
            continue
        for tok in m.group(2).split():
            t = re.match(r'(\d+)([+-])$', tok)
            if t:
                out.setdefault(m.group(1), {})[f'q{int(t.group(1)):03d}'] = t.group(2) == '+'
    return out


def load_deck(folder, name):
    raw = json.load(open(os.path.join(folder, name + '.json'), encoding='utf-8'))
    body = raw.get('data', raw) if isinstance(raw, dict) and 'cards' not in raw else raw
    return {c['id']: c for c in body['cards']}


def parse_page(page_html):
    """Fragen einer Testseite: slot -> {prefix, text, options{value: text}, seq}, plus Formularfelder."""
    hidden = dict(re.findall(r'<input type="hidden" name="(attempt|thispage|nextpage|timeup|sesskey|slots)" value="([^"]*)"', page_html))
    questions = []
    for q in re.split(r'(?=<div id="question-\d+-\d+" class="que )', page_html)[1:]:
        m = re.search(r'<div class="qtext"[^>]*>(.*?)</div></div>', q, re.S)
        text = clean(m.group(1)) if m else ''
        text = re.sub(r'^[A-F]\s?\d+[a-z]?\s+', '', text)
        name = re.search(r'name="(q\d+:\d+_)answer"', q)
        seq = re.search(r'name="(q\d+:\d+_:sequencecheck)" value="(\d+)"', q)
        opts = {}
        for val, lab in re.findall(r'<input type="radio" name="q\d+:\d+_answer" value="(\d+)"[^>]*>.*?<div class="flex-fill ms-1">(.*?)</div></div>', q, re.S):
            opts[val] = clean(lab)
        if name and seq:
            questions.append({'prefix': name.group(1), 'text': text, 'options': opts, 'seq': seq.groups()})
    return hidden, questions


def find_card(question, deck_by_text):
    """Gleicher Wortlaut kommt mehrfach vor – deshalb zusätzlich über die Antwortmöglichkeiten zuordnen."""
    shown = {norm(t) for t in question['options'].values()}
    for card in deck_by_text.get(norm(question['text']), []):
        if {norm(o) for o in card.get('opts', [])} <= shown:
            return card
    return None


def choose(question, deck_by_text, answers):
    """Welche Option ankreuzen? None = leer lassen."""
    card = find_card(question, deck_by_text)
    if not card or card['id'] not in answers:
        return None, card
    right = answers[card['id']]
    for val, text in question['options'].items():
        if right and norm(text) == norm(card['b']):
            return val, card
        if not right and norm(text) != norm(card['b']) and norm(text) in {norm(o) for o in card.get('opts', [])}:
            return val, card
    return 'unmatched', card


class Moodle:
    def __init__(self, user, password):
        self.jar = tempfile.NamedTemporaryFile(prefix='moodle-', suffix='.txt', delete=False).name
        self.user, self.password = user, password

    def req(self, url, data=None):
        cmd = ['curl', '-sS', '-L', '--max-time', '60', '-c', self.jar, '-b', self.jar, url]
        for k, v in (data or []):
            cmd += ['--data-urlencode', f'{k}={v}']
        r = subprocess.run(cmd, capture_output=True, text=True, errors='replace')
        if r.returncode:
            raise RuntimeError(f'Verbindung fehlgeschlagen: {r.stderr.strip()}')
        return r.stdout

    def login(self):
        page = self.req(f'{BASE}/login/index.php')
        token = re.search(r'name="logintoken" value="([^"]*)"', page).group(1)
        home = self.req(f'{BASE}/login/index.php', [('anchor', ''), ('logintoken', token), ('username', self.user), ('password', self.password)])
        m = re.search(r'"sesskey":"([^"]+)"', home)
        if not m:
            raise RuntimeError('Anmeldung bei Moodle fehlgeschlagen.')
        self.sesskey = m.group(1)

    def start_attempt(self, cmid):
        view = self.req(f'{BASE}/mod/quiz/view.php?id={cmid}')
        if 'Versuch fortsetzen' in view:
            return None  # offener Versuch des Nutzers – nicht anfassen
        page = self.req(f'{BASE}/mod/quiz/startattempt.php', [('cmid', cmid), ('sesskey', self.sesskey)])
        m = re.search(r'name="attempt" value="(\d+)"', page)
        return (m.group(1), page) if m else None


def sync_letter(moodle, letter, deck, answers, offline_pages=None):
    deck_by_text = {}
    for c in deck.values():
        deck_by_text.setdefault(norm(c['f']), []).append(c)
    report = {'right': 0, 'wrong': 0, 'unmatched': [], 'attempt': None}
    cmid = TESTS[letter][1]
    if offline_pages:
        pages = [open(p, encoding='utf-8', errors='replace').read() for p in offline_pages]
    else:
        started = moodle.start_attempt(cmid)
        if not started:
            report['skipped'] = 'Es gibt in diesem Test einen offenen Versuch – bitte erst in Moodle abgeben.'
            return report
        attempt, page = started
        report['attempt'] = attempt
        pages = None
    pno = 0
    while True:
        page = pages[pno] if pages else page
        hidden, questions = parse_page(page)
        fields = [(k, hidden[k]) for k in ('attempt', 'thispage', 'nextpage', 'timeup', 'sesskey', 'slots') if k in hidden]
        for q in questions:
            fields.append(q['seq'])
            val, card = choose(q, deck_by_text, answers)
            if val == 'unmatched':
                report['unmatched'].append(card['id'])
            elif val is not None:
                fields.append((q['prefix'] + 'answer', val))
                report['right' if answers[card['id']] else 'wrong'] += 1
        last = hidden.get('nextpage') == '-1'
        if pages:
            pno += 1
            if pno >= len(pages):
                break
            continue
        page = moodle.req(f'{BASE}/mod/quiz/processattempt.php?cmid={cmid}', fields)
        if last:
            break
        page = moodle.req(f'{BASE}/mod/quiz/attempt.php?attempt={report["attempt"]}&cmid={cmid}&page={int(hidden["thispage"]) + 1}')
    if not pages:
        moodle.req(f'{BASE}/mod/quiz/processattempt.php?cmid={cmid}', [('attempt', report['attempt']), ('finishattempt', '1'), ('timeup', '0'), ('slots', ''), ('cmid', cmid), ('sesskey', moodle.sesskey)])
        review = moodle.req(f'{BASE}/mod/quiz/review.php?attempt={report["attempt"]}&cmid={cmid}')
        g = re.search(r'Bewertung</th>\s*<td[^>]*>(.*?)</td>', review, re.S) or re.search(r'Punkte</th>\s*<td[^>]*>(.*?)</td>', review, re.S)
        report['grade'] = clean(g.group(1)) if g else '?'
    return report


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--code', required=True)
    ap.add_argument('--decks', required=True)
    ap.add_argument('--offline', help='Ordner mit gespeicherten Testseiten (nur prüfen, nichts senden)')
    ap.add_argument('--letter', help='nur diesen Prüfungsteil')
    a = ap.parse_args()
    code = parse_code(open(a.code, encoding='utf-8').read())
    if not code:
        sys.exit('Im Text wurden keine beantworteten Prüfungsfragen gefunden.')
    moodle = None
    if not a.offline:
        moodle = Moodle(os.environ['MOODLE_USER'], os.environ['MOODLE_PASSWORD'])
        moodle.login()
    for letter in sorted(code):
        if a.letter and letter != a.letter:
            continue
        deck = load_deck(a.decks, TESTS[letter][0])
        pages = None
        if a.offline:
            pages = sorted((os.path.join(a.offline, f) for f in os.listdir(a.offline) if re.match(r'p\d+\.html$', f)), key=lambda p: int(re.search(r'p(\d+)', os.path.basename(p)).group(1)))
        r = sync_letter(moodle, letter, deck, code[letter], pages)
        print(f"{letter}: {r.get('skipped') or ''}{r['right']} richtig, {r['wrong']} falsch übertragen"
              + (f", nicht zugeordnet: {r['unmatched']}" if r['unmatched'] else '')
              + (f" · Versuch {r['attempt']} · Bewertung: {r.get('grade')}" if r.get('attempt') else ''))


if __name__ == '__main__':
    main()
