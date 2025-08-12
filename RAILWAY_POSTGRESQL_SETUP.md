# Railway PostgreSQL 데이터베이스 설정 가이드

## 🚀 Railway에서 PostgreSQL 데이터베이스 추가하기

### 1. Railway 대시보드 접속
- https://railway.app 로그인
- 프로젝트 선택 (savecard-production)

### 2. PostgreSQL 서비스 추가
1. **"+ New"** 버튼 클릭
2. **"Database"** 선택
3. **"Add PostgreSQL"** 클릭
4. 데이터베이스가 생성될 때까지 대기 (약 1-2분)

### 3. 환경변수 설정
PostgreSQL 데이터베이스가 생성되면 자동으로 `DATABASE_URL` 환경변수가 설정됩니다.

확인 방법:
1. PostgreSQL 서비스 클릭
2. **"Variables"** 탭 확인
3. `DATABASE_URL` 값이 있는지 확인

### 4. 웹 서비스에 환경변수 연결
1. 웹 서비스 (savecard-production) 클릭
2. **"Variables"** 탭 이동
3. **"Reference"** 버튼 클릭
4. PostgreSQL 서비스의 `DATABASE_URL` 선택하여 연결

### 5. 배포 및 테스트
- 코드 변경 후 자동 배포 대기
- 데이터베이스 연결 및 테이블 생성 확인

## 🔧 로컬 개발 환경 설정

`.env` 파일 생성:
```
DATABASE_URL=postgresql://username:password@localhost:5432/savecard_dev
SESSION_SECRET=your-secret-key-here
NODE_ENV=development
```

## 📊 데이터 마이그레이션

기존 JSON 데이터는 자동으로 PostgreSQL로 마이그레이션됩니다.
- 여행사 (agencies)
- 제휴업체 (stores)  
- 사용자 (users)
- 사용 기록 (usages)
- 배너 (banners)
- 신청서 (partner_applications)

## ✅ 완료 후 확인사항

1. **데이터 영속성**: 새 배포 후에도 데이터가 유지되는지 확인
2. **관리자 기능**: 데이터 추가/수정/삭제가 정상 작동하는지 확인
3. **QR코드 스캔**: 사용처리가 정상 작동하는지 확인

## 🚨 주의사항

- PostgreSQL 추가 후 첫 배포 시 기존 JSON 데이터가 자동 마이그레이션됩니다
- 마이그레이션은 한 번만 실행되며, 중복 데이터는 생성되지 않습니다
- 로컬 개발 시에는 별도의 PostgreSQL 설치가 필요할 수 있습니다
