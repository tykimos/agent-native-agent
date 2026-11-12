#!/usr/bin/env bash
# 웹툰 식자 환경: 스킬 폴더 안에 .venv(Pillow·numpy·scipy) + fonts/(OFL 한글 폰트). 다시 실행해도 안전하다.
set -euo pipefail
DIR="$(cd "$(dirname "$0")/.." && pwd)"
PY="${PYTHON:-python3}"

if [ ! -x "$DIR/.venv/bin/python" ]; then
  echo "▸ venv 생성: $DIR/.venv"
  "$PY" -m venv "$DIR/.venv"
fi
"$DIR/.venv/bin/python" -m pip install -q --upgrade pip
"$DIR/.venv/bin/python" -m pip install -q pillow numpy scipy
echo "▸ 파이썬 패키지: $("$DIR/.venv/bin/python" -c 'import PIL,numpy,scipy;print("Pillow",PIL.__version__,"· numpy",numpy.__version__,"· scipy",scipy.__version__)')"

mkdir -p "$DIR/fonts"
BASE="https://github.com/google/fonts/raw/main/ofl"
for f in nanumgothic/NanumGothic-Regular nanumgothic/NanumGothic-Bold \
         nanummyeongjo/NanumMyeongjo-Bold blackhansans/BlackHanSans-Regular \
         nanumpenscript/NanumPenScript-Regular; do
  out="$DIR/fonts/$(basename "$f").ttf"
  if [ ! -s "$out" ]; then
    echo "▸ 폰트 받기: $(basename "$out")"
    curl -fsSL -o "$out" "$BASE/$f.ttf" || { rm -f "$out"; echo "  ✗ 실패 — 시스템 폰트로 대체됩니다"; }
  fi
done
echo "▸ 폰트: $(ls "$DIR/fonts" | tr '\n' ' ')"
echo "✓ 준비 완료 — $DIR/.venv/bin/python $DIR/scripts/letter.py --help"
