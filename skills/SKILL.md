---
name: audio-cd-rip
description: 오디오 CD를 mp3로 리핑해 contents/music 앨범 폴더로 만든다. CD 케이스·표지 사진에서 곡명을 읽거나 MusicBrainz로 조회해 album.json 메타를 작성하고, 커버 이미지를 저장해 음악 탭(/music)에 바로 뜨게 한다. "CD 복사해줘", "CD를 mp3로", "앨범 넣어줘", "음악 CD 리핑" 요청 시 사용.
---

# 오디오 CD → mp3 (contents/music)

맥미니에 넣은 오디오 CD를 앨범 폴더 하나로 만든다. 결과물은 `/music` 탭이 `album.json`을 읽어
곡명·아티스트·커버까지 그대로 보여준다.

## 결과물 규격 (이걸 맞추는 게 목적)

```
contents/music/<앨범 폴더명>/
├── 01.mp3 … NN.mp3     ← 트랙 번호 2자리, 제로패딩. 파일명에 곡명을 넣지 않는다
├── album.json          ← 메타 정본
└── cover.jpg           ← 표지 이미지
```

`album.json`:

```json
{
  "album": "Suzuki Violin School, Volume 4, Revised",
  "artist": "William Preucil, Linda Perry",
  "cover": "cover.jpg",
  "source": "Audio CD (MusicBrainz)",
  "tracks": [
    { "num": 1, "file": "01.mp3", "title": "Lullaby, D 498 \"Schlafe, schlafe...\"" }
  ]
}
```

- `file`은 실제 파일명과 **정확히** 일치해야 한다. 서버가 이 값으로 곡명을 붙인다
  (`src/web_app.py` 음악 라이브러리 스캔 → `meta_by_file`).
- `album.json`이 없거나 `file`이 어긋나면 파일명에서 제목을 뽑는 레거시 경로로 떨어져
  화면에 `01`, `02`처럼만 뜬다.
- `cover`를 비워 두면 서버가 `cover.jpg` → `cover.png` → `folder.jpg` 순으로 찾는다.

### `source` 표기 (메타를 어디서 얻었는지 반드시 남긴다)

| 값 | 언제 |
|---|---|
| `Audio CD (CD-Text)` | **디스크에 CD-Text가 있어 곡명이 파일명에 들어 있을 때 — 가장 정확, 제일 먼저 확인** |
| `Audio CD (MusicBrainz)` | MusicBrainz에서 앨범을 특정했을 때 |
| `Audio CD (CD 케이스 곡목)` | CD 케이스·속지 사진을 읽어 곡명을 옮겼을 때 |
| `Audio CD` | 곡명을 못 찾아 `Track 01` 로 채웠을 때 |

커버를 따로 받았으면 뒤에 붙인다: `Audio CD (CD-Text) · 커버: Cover Art Archive`

곡명을 확정 못 했으면 앨범 폴더명과 `album` 값에 **`(미확인)`** 을 붙여 나중에 알아보게 한다.
예: `Karma (미확인)` / `"album": "Karma (제목 미확인)"`.

## 절차

### 1. CD 확인
```bash
ls /Volumes/                    # 오디오 CD는 "Audio CD" 로 마운트된다
drutil status                   # 광학 드라이브 유무
```
맥미니에는 **내장 광학 드라이브가 없다.** 외장 USB CD 드라이브가 꽂혀 있어야 하고,
`/Volumes/` 와 `system_profiler SPUSBDataType` 둘 다 비어 있으면 드라이브부터 연결해 달라고 한다.

macOS는 오디오 CD를 `.aiff` 트랙 파일로 보여준다 → **cdparanoia 같은 리퍼가 필요 없다.**

### 2. 곡명 확보 (변환보다 먼저)
순서대로 시도한다:
1. **CD-Text — 제일 먼저 `ls` 로 확인한다.** 요즘 CD는 대개 들어 있고, 그러면 트랙 파일명이
   `3 여수 밤바다.aiff` 처럼 **번호 + 곡명**으로 나온다. 볼륨 이름도 앨범명이 된다
   (`/Volumes/Audio CD` 가 아니라 `/Volumes/버스커 버스커 1집`). 이게 있으면 사진도 조회도 필요 없다.
   ```bash
   ls /Volumes/*/ | head            # 파일명에 곡명이 있으면 CD-Text
   ```
   파일명에서 앞의 번호를 떼면 그대로 곡명이다: `re.sub(r"^\d+\s+", "", name).removesuffix(".aiff")`
2. **CD 케이스·속지 사진** — 사용자가 사진을 주면 읽어서 트랙 순서대로 옮긴다. 오타·번호 어긋남에 주의.
3. **MusicBrainz** — 앨범명/아티스트로 조회해 트랙 목록을 맞춘다. 트랙 수가 CD와 같은지 반드시 대조.
4. 다 안 되면 `Track NN` + `(미확인)` 으로 두고 넘어간다. **곡명을 지어내지 않는다.**

**한글 곡명 대조 시 유니코드 정규화 필수.** macOS 파일명은 NFD(자모 분리), MusicBrainz는 NFC라
눈으로 같아 보여도 문자열 비교가 전부 어긋난다. 반드시 `unicodedata.normalize('NFC', s)` 후 비교할 것.

### 3. 변환 (ffmpeg)
```bash
ALBUM="contents/music/<앨범 폴더명>"
mkdir -p "$ALBUM"
i=1
for f in /Volumes/Audio\ CD/*.aiff; do
  printf -v n "%02d" $i
  ffmpeg -nostdin -loglevel error -i "$f" -codec:a libmp3lame -q:a 2 "$ALBUM/$n.mp3"
  i=$((i+1))
done
```
- `-q:a 2` = VBR 약 190kbps. 원본 CD 음질 대비 충분하고 용량이 적당하다.
- 트랙이 많으면 오래 걸린다 → `run_in_background: true` 로 돌리고 진행상황을 보고한다.
- **정렬 주의**: 트랙이 10개를 넘으면 셸 글롭이 `1, 10, 11, 2…` 순으로 잡히는 CD도 있다.
  변환 전에 `ls /Volumes/Audio\ CD/` 로 실제 순서를 눈으로 확인하고, 필요하면 `sort -V` 를 쓴다.

### 4. 커버
**오디오 CD에는 표지 이미지가 없다.** 디스크는 CD_DA 오디오 트랙뿐이라(`diskutil list /dev/diskN` 로
확인 가능) 아무리 뒤져도 이미지가 안 나온다. CD-Text는 글자만 담는다. 그러니 밖에서 구해야 한다.

**① Cover Art Archive (자동, 먼저 시도)** — MusicBrainz로 릴리스를 특정한 뒤:
```bash
UA="home-control/1.0 (personal music library)"
# 아티스트로 검색 → 트랙 수·발매일이 맞는 릴리스의 MBID를 고른다
curl -s -H "User-Agent: $UA" "https://musicbrainz.org/ws/2/release/?query=artist:<아티스트>&fmt=json&limit=10"
# 곡목이 우리 CD와 일치하는지 대조(NFC 정규화 후!) → 맞으면 표지 내려받기
curl -sL -o /tmp/cover_front.jpg "https://coverartarchive.org/release/<MBID>/front"
ffmpeg -nostdin -loglevel error -y -i /tmp/cover_front.jpg -vf scale=600:-1 "$ALBUM/cover.jpg"
```
릴리스를 고를 땐 **트랙 수가 CD와 같은지** 먼저 보고, 곡목까지 대조해 확정한다. 같은 앨범이라도
재발매·합본(예: `1집+1집 마무리` 16트랙)이 섞여 있어 트랙 수만 봐도 상당수 걸러진다.
받은 이미지는 눈으로 한 번 확인한다(엉뚱한 앨범 표지가 올 수 있다).

**② 사용자 사진** — ①이 없으면 케이스를 찍어 달라고 한다.
```bash
ffmpeg -nostdin -loglevel error -i <원본> -vf scale=600:-1 "$ALBUM/cover.jpg"
```
커버가 없어도 재생은 정상 동작한다 — 화면에 표지만 비어 보인다.

### 5. album.json 작성 후 검증
```bash
python3 - <<'EOF'
import json, pathlib
d = pathlib.Path("contents/music/<앨범 폴더명>")
m = json.loads((d/"album.json").read_text(encoding="utf-8"))
mp3 = sorted(p.name for p in d.glob("*.mp3"))
files = [t["file"] for t in m["tracks"]]
print("mp3:", len(mp3), "메타:", len(files))
print("불일치:", set(mp3) ^ set(files) or "없음")
EOF
curl -s http://127.0.0.1:8000/api/music/library | head -c 400   # 화면에 뜨는지
```
**트랙 수와 파일명이 1:1로 맞지 않으면 끝난 게 아니다.**

## 하지 말 것

- 파일명에 곡명을 넣지 않는다 — 번호만 쓰고 곡명은 `album.json`이 갖는다
  (한글·특수문자 파일명이 서빙 경로에서 문제를 일으킨 적이 있다).
- 곡명을 추측해서 채우지 않는다. 모르면 `(미확인)`.
- 기존 앨범 폴더를 덮어쓰지 않는다. 같은 이름이면 사용자에게 먼저 묻는다.