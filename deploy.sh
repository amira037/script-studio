#!/bin/bash
# Script Studio → GitHub 배포 스크립트

REPO_DIR="/tmp/script-studio"
REMOTE="https://github.com/amira037/script-studio.git"

# 레포가 없으면 클론
if [ ! -d "$REPO_DIR/.git" ]; then
  echo "📦 레포 클론 중..."
  git clone "$REMOTE" "$REPO_DIR"
fi

# 최신 상태로 pull
echo "⬇️  최신 코드 가져오는 중..."
cd "$REPO_DIR" && git pull

# index.html 복사
echo "📄 index.html 복사 중..."
cp /Users/ethan/Desktop/CODE/FLO/index.html "$REPO_DIR/public/index.html"

# 변경사항 확인
cd "$REPO_DIR"
if git diff --quiet public/index.html; then
  echo "✅ 변경사항 없음 — push 생략"
  exit 0
fi

# 커밋 메시지 입력 (기본값 제공)
echo ""
read -p "커밋 메시지 (엔터 = 'Update index.html'): " MSG
MSG="${MSG:-Update index.html}"

# 커밋 & push
git add public/index.html
git commit -m "$MSG"
git push

echo ""
echo "🚀 배포 완료!"
