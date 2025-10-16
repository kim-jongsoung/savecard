@echo off
echo ========================================
echo 공항픽업 마감날짜 테이블 생성 스크립트
echo ========================================
echo.
echo Railway 데이터베이스에 테이블을 생성합니다...
echo.

node create-pickup-closed-dates-railway.js

echo.
echo ========================================
echo 완료! 아무 키나 눌러 종료하세요.
echo ========================================
pause
