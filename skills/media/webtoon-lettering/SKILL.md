---
name: webtoon-lettering
description: 웹툰 식자 — 대사가 비어 있는 깨끗한 원고(말풍선만 그려진 PNG/JPG, 세로 스크롤 원고 포함)에 대본을 말풍선별로 얹어 완성 PNG/JPG를 만든다. 말풍선을 자동 검출해 번호를 붙이고, Claude가 원고를 보며 대본 줄을 말풍선에 매칭한 뒤, 폰트·자동 줄바꿈·크기 맞춤으로 렌더링한다. "식자해줘", "대사 넣어줘", "말풍선에 대본", "웹툰 식자", "AI 웹툰 대사 입력", "lettering", "typesetting" 요청 시 사용.
---

# 웹툰 식자 (대본 → 말풍선 → PNG/JPG)

입력은 **대사 없는 원고 이미지 + 대본**, 출력은 **식자된 PNG/JPG**. 번역·클리닝(원래 글자 지우기)은 이 스킬 범위 밖이다.

```
raw/ep01.png ──detect──► work/ep01.bubbles.json  (말풍선 id·박스·중심)
                         work/ep01.detect-NN.png  (번호 붙은 검토 조각) ── Claude가 보고 매칭
대본 ─────────────────►  work/ep01.layout.json    (말풍선 id ↔ 대사·스타일)
                 render► out/ep01.png|jpg  + work/ep01.review-NN.png + ⚠ 넘침/축소 경고
```

## 0. 준비 (한 번)

```bash
bash skills/media/webtoon-lettering/scripts/setup.sh
```
스킬 폴더에 `.venv`(Pillow·numpy·scipy)와 `fonts/`(OFL 한글 폰트: 나눔고딕·나눔명조·검은고딕·나눔손글씨펜)를
만든다. 둘 다 gitignore 대상. 폰트가 없으면 시스템 한글 폰트(Apple SD 산돌고딕 Neo)로 대체된다.

이하 `PY=skills/media/webtoon-lettering/.venv/bin/python`, `L=skills/media/webtoon-lettering/scripts/letter.py`.

## 작업 폴더 규격

사용자가 위치를 말하지 않으면 `~/webtoon/<작품>/<회차>/` 를 쓴다.

```
~/webtoon/<작품>/ep01/
├── raw/      원고 (사용자 제공, 손대지 않는다)
├── script.txt 대본 (사용자 제공 또는 붙여넣은 걸 저장)
├── work/     bubbles.json · layout.json · 검토 조각
└── out/      완성본
```

## 절차

### 1. 말풍선 검출
```bash
$PY $L detect ~/webtoon/<작품>/ep01/raw/01.png
```
- 흰(밝기 ≥232) 닫힌 영역 중 크기·채움 비율이 말풍선다운 것을 고른다. 좌우 끝에 닿는 흰 영역(여백)은 제외.
- 읽는 순서(위→아래, 같은 높이면 왼→오)로 id를 매긴다.
- `center`는 꼬리를 뺀 말풍선 몸통의 중심 — 글자는 여기를 기준으로 놓인다.

### 2. 검토 조각을 **반드시 직접 본다** (Read 로 `work/*.detect-NN.png` 전부)
- 빨간 박스 = 후보, 점 = 글자 중심. 말풍선이 아닌 흰 면(하늘·벽)이 잡혔으면 그 id는 안 쓰면 된다.
- 놓친 말풍선은 원본 픽셀 좌표로 `"box": [x, y, w, h]` 를 직접 준다 (검토 조각은 가로 800px로
  줄였으므로 원본 가로/800 을 곱해 환산).
- 테두리 없는 말풍선이 흰 배경에 붙어 있으면 검출이 안 된다 → `box` 수동 지정.
- 너무 많이/적게 잡히면 `--threshold 220`(회색 말풍선) 또는 `--min-fill 0.6` 으로 다시.

### 3. 대본 ↔ 말풍선 매칭 → `work/<stem>.layout.json` 작성
그림(인물·꼬리 방향·말풍선 모양)과 대본 순서를 보고 Claude가 매칭한다. 애매하면 추측하지 말고
번호 붙은 검토 이미지를 근거로 사용자에게 묻는다.

```json
{
  "image": "../raw/01.png",
  "bubbles": "01.bubbles.json",
  "output": "../out/01.png",
  "defaults": {"style": "dialogue"},
  "items": [
    {"bubble": 1, "text": "오늘따라 하늘이 유난히 맑네."},
    {"bubble": 2, "text": "(혹시... 그 녀석이?)", "style": "thought"},
    {"bubble": 3, "text": "그날 이후, 모든 것이 바뀌었다.", "style": "narration"},
    {"bubble": 4, "text": "뭐라고?!\n지금 장난해?!", "style": "shout"},
    {"box": [60, 1100, 440, 120], "text": "수동 지정 박스", "style": "narration"},
    {"at": [600, 2050], "text": "쾅!", "style": "sfx", "rotate": -12}
  ]
}
```
경로는 layout 파일 기준 상대경로. 항목 필드:

| 필드 | 뜻 |
|---|---|
| `bubble` / `box` / `at` | 검출된 말풍선 id / 원본 좌표 박스 / 효과음 중심점(줄바꿈·축소 없음) |
| `text` | 대사. 자동 줄바꿈(어절 단위, 줄 길이 균형). `\n` 은 강제 줄바꿈 |
| `style` | 아래 표 |
| `size` | 기본 크기 덮어쓰기 (가로 800px 기준 값 — 원고 폭에 비례해 자동 확대) |
| `color`, `stroke_color`, `rotate`, `offset: [dx,dy]`, `inner` (0~1, 글자 영역 비율), `shape` (`ellipse`/`rect`) | 미세 조정 |

문서 수준 옵션: `split` (출력 조각 높이 px, 0=통짜), `width` (출력 가로 리사이즈), `quality` (JPG),
`styles` (스타일 덮어쓰기/추가, 예: `{"dialogue": {"font": "MyFont.ttf", "size": 32}}` — `fonts/` 에 넣은 파일명 또는 절대경로).

| 스타일 | 폰트 | 기본 크기 | 용도 |
|---|---|---|---|
| `dialogue` | 나눔고딕 Bold | 30 | 일반 대사 |
| `whisper` | 나눔고딕 Regular | 24 | 속삭임·작은 말 |
| `thought` | 나눔명조 Bold | 28 | 속마음 |
| `shout` | 검은고딕 | 40 | 외침 |
| `narration` | 나눔명조 Bold | 27 | 나레이션 박스 |
| `hand` | 나눔손글씨 펜 | 36 | 손글씨·메모 |
| `sfx` | 검은고딕 (흰 글자 + 검은 외곽선) | 72 | 효과음 |

`$PY $L styles` 로 실제 쓰이는 폰트 파일을 확인한다.

### 4. 렌더링
```bash
$PY $L render ~/webtoon/<작품>/ep01/work/*.layout.json
```
- 대사는 기본 크기에서 시작해 말풍선에 안 들어가면 최소 60%까지 줄인다(키우지는 않는다 — 회차 전체 글자 크기 일관성).
- `⚠ 축소` = 줄여서 들어감, `⚠ 넘침` = 최소 크기로도 넘침 → 대사를 끊어 쓰거나(`\n`), `inner` 를 키우거나, 사용자에게 알린다.

### 5. 결과를 **반드시 직접 본다** (Read 로 `work/*.review-NN.png` 전부)
글자가 말풍선 테두리·꼬리에 닿는지, 중심이 쏠렸는지, 스타일이 장면에 맞는지 확인하고 layout 을
고쳐 다시 render 한다. 보고 확인한 뒤에만 완료라고 말한다.

## 한계
- 말풍선 검출은 "흰 닫힌 영역" 기준. 반투명·그라데이션·색 말풍선, 테두리 없는 말풍선은 `box` 로 수동 지정.
- 세로쓰기, 곡선 배치는 지원하지 않는다 (효과음은 `rotate` 로 기울이기만).
- 상업 연재용 폰트(산돌·윤고딕 등)는 라이선스가 있는 파일을 사용자가 `fonts/` 에 넣고 `styles` 로 지정해야 한다.
