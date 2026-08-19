#!/usr/bin/env python3
# mock_agent.py — Claude Code TUI의 캡처-가시 출력을 흉내내는 결정적 모의 에이전트.
# test.cjs의 통합 테스트가 별도 tmux 세션(ana-selftest)에서 사용한다.
# 규칙: ❯ 에코, ⏺ 응답 블록, 하드랩(실제 개행), 완료 마커 "✻ Worked for Ns".
import sys
import termios

fd = sys.stdin.fileno()
attrs = termios.tcgetattr(fd)
attrs[3] &= ~termios.ECHO  # tty 에코 끔 (우리가 직접 ❯ 에코를 그린다)
termios.tcsetattr(fd, termios.TCSANOW, attrs)

# bracketed paste 모드 요청 — 실제 Claude Code처럼. tmux paste-buffer -p는
# 앱이 이 모드를 켰을 때만 \x1b[200~ … \x1b[201~ 마커를 붙인다.
sys.stdout.write('\x1b[?2004h')
sys.stdout.flush()

PS, PE = '\x1b[200~', '\x1b[201~'  # bracketed paste 마커
W = 80  # 테스트 tmux 팬 폭과 일치


def out(s=''):
    print(s, flush=True)


def respond(lines):
    out()
    for l in lines:
        out(l)
    out()
    out('✻ Worked for 1s')  # ✻ 완료 마커


def handle(msg):
    out('❯ ' + msg.replace('\n', ' / '))  # ❯ 에코 (멀티라인은 표시만 병합)
    parts = msg.split('\n')
    cmd = parts[0].split(' ')[0]
    if cmd == 'hello':
        respond(['⏺ Hello there!'])
    elif cmd == 'wrap':
        # 단어 경계 하드랩: 1행 표시폭 75 (W-8=72 이상, W-1=79 미만) → 공백 join 기대
        line1 = '⏺ ' + 'x' * 70 + ' yy'
        respond([line1, '  tail-continues.'])
    elif cmd == 'path':
        # 폭에 정확히 꽉 찬 ASCII 토큰 절단 → 무공백 join 기대
        base = '⏺ Saved /tmp/'
        line1 = base + 'a' * (W - len(base))
        respond([line1, '  bbb.txt'])
    elif cmd == 'korean':
        # 한글(전각) 하드랩: 표시폭 77 → 공백 join 기대
        line1 = '⏺ ' + '가' * 36 + ' 끝'   # ⏺ 가*36 끝
        respond([line1, '  이어짐'])          # 이어짐
    elif cmd == 'para':
        respond(['⏺ First paragraph.', '', '  Second paragraph.'])
    elif cmd == 'list':
        respond(['⏺ Items:', '  - one', '  - two'])
    elif cmd == 'multi':
        respond(['⏺ GOT:%d' % len(parts)])
    elif cmd == 'keytest':
        respond(['⏺ KEYOK'])
    elif cmd == 'draftbox':
        # 입력 박스를 렌더한 채로 멈춘다(완료 마커 없음) → extractDraft가 draft를 집어냄.
        # draft 가드(미제출 텍스트 있으면 /api/chat 409) 통합 검증용.
        text = msg[len('draftbox'):].strip() or 'unsent text'
        out()
        out('─' * W)
        out('❯ ' + text)
        out('─' * W)
        out('  status line')
    else:
        respond(['⏺ echo: ' + parts[0]])


buf = None
for raw in sys.stdin:
    line = raw.rstrip('\n')
    if PS in line and PE in line:
        m = line.replace(PS, '').replace(PE, '')
        if m.strip():
            handle(m)
        continue
    if PS in line:
        buf = [line.replace(PS, '')]
        continue
    if buf is not None:
        if PE in line:
            buf.append(line.replace(PE, ''))
            m = '\n'.join(buf)
            buf = None
            if m.strip():
                handle(m)
        else:
            buf.append(line)
        continue
    if line.strip():
        handle(line)
