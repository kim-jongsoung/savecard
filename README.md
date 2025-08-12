# 괌세이브카드 (Guam Save Card)

괌 여행객을 위한 QR 할인카드 시스템입니다. 여행사를 통해 배포되는 할인카드를 모바일로 제시하고, 제휴처에서 간편하게 할인을 처리할 수 있습니다.

## 🌟 주요 기능

### 고객용 기능
- **할인카드 발급**: 고객명과 여행사 코드로 간편 발급
- **QR 코드 생성**: 자동으로 QR 코드가 생성되어 제공
- **모바일 최적화**: 스마트폰에서 편리하게 사용 가능
- **사용 이력 확인**: 할인 사용 내역을 실시간으로 확인

### 제휴처용 기능
- **간편한 할인 처리**: 제휴처명만 입력하면 할인 완료
- **무제한 사용**: 하루에 여러 번 사용 가능
- **실시간 처리**: 즉시 할인 적용 및 이력 저장

### 관리자용 기능
- **여행사 관리**: 여행사 등록, 조회, 삭제
- **고객 관리**: 발급된 카드 목록 및 상세 정보
- **사용 이력 관리**: 모든 할인 사용 내역 추적
- **광고 배너 관리**: 수익화를 위한 광고 시스템
- **대시보드**: 실시간 통계 및 현황 확인

## 🚀 설치 및 실행

### 1. 필수 요구사항
- Node.js 14.0.0 이상
- MySQL 5.7 이상 또는 MariaDB 10.2 이상

### 2. 프로젝트 설치
```bash
# 의존성 패키지 설치
npm install

# 환경 설정 파일 생성
cp .env.example .env
```

### 3. 데이터베이스 설정
```bash
# MySQL에 로그인하여 데이터베이스 생성
mysql -u root -p

# database.sql 파일 실행
source database.sql
```

### 4. 환경 변수 설정
`.env` 파일을 편집하여 데이터베이스 정보를 입력하세요:
```env
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_password
DB_NAME=guam_savecard
```

### 5. 서버 실행
```bash
# 개발 모드 (nodemon 사용)
npm run dev

# 운영 모드
npm start
```

서버가 실행되면 http://localhost:3000 에서 확인할 수 있습니다.

## 📱 사용 방법

### 고객 (할인카드 발급)
1. `/register` 페이지에서 고객명과 여행사 선택
2. 발급 완료 후 QR 코드 저장 또는 링크 북마크
3. 제휴처에서 QR 코드 또는 링크로 카드 제시

### 제휴처 (할인 처리)
1. 고객이 제시한 카드 페이지에서 제휴처명 입력
2. "할인 사용 처리" 버튼 클릭
3. 할인 완료 메시지 확인

### 관리자
1. `/admin` 페이지에서 로그인 (기본: admin/admin123)
2. 각 메뉴에서 여행사, 고객, 광고 등 관리
3. 대시보드에서 전체 현황 확인

## 🗂️ 프로젝트 구조

```
괌세이브카드/
├── config/
│   └── database.js          # 데이터베이스 연결 설정
├── routes/
│   ├── index.js             # 메인 페이지 라우트
│   ├── register.js          # 카드 발급 라우트
│   ├── card.js              # 카드 사용 라우트
│   └── admin.js             # 관리자 라우트
├── views/
│   ├── index.ejs            # 메인 페이지
│   ├── register.ejs         # 카드 발급 페이지
│   ├── register-success.ejs # 발급 완료 페이지
│   ├── card.ejs             # 카드 페이지
│   ├── error.ejs            # 에러 페이지
│   └── admin/               # 관리자 페이지들
├── qrcodes/                 # QR 코드 이미지 저장소
├── server.js                # 메인 서버 파일
├── package.json             # 프로젝트 설정
├── database.sql             # 데이터베이스 스키마
└── README.md                # 이 파일
```

## 🗄️ 데이터베이스 스키마

### 주요 테이블
- `travel_agencies`: 여행사 정보
- `savecard_users`: 할인카드 사용자
- `card_usages`: 카드 사용 이력
- `banners`: 광고 배너
- `admins`: 관리자 계정

## 🎨 기술 스택

### Backend
- **Node.js**: 서버 런타임
- **Express.js**: 웹 프레임워크
- **MySQL2**: 데이터베이스 연결
- **EJS**: 템플릿 엔진

### Frontend
- **Bootstrap 5**: UI 프레임워크
- **Font Awesome**: 아이콘
- **Vanilla JavaScript**: 클라이언트 스크립트

### 기타
- **QRCode**: QR 코드 생성
- **UUID**: 고유 토큰 생성
- **bcryptjs**: 비밀번호 암호화

## 🔒 보안 고려사항

- 관리자 비밀번호는 bcrypt로 해시화
- 세션 기반 인증 시스템
- SQL 인젝션 방지를 위한 Prepared Statement 사용
- CORS 및 Helmet을 통한 보안 강화

## 📊 광고 수익화

카드 페이지에 광고 배너가 표시되어 수익을 창출할 수 있습니다:
- 관리자 페이지에서 광고 등록/관리
- 랜덤 또는 순차 방식으로 광고 노출
- 클릭 시 광고주 사이트로 이동

## 🚀 배포 가이드

### 운영 환경 설정
1. `NODE_ENV=production` 설정
2. 강력한 `SESSION_SECRET` 생성
3. HTTPS 설정 (SSL 인증서)
4. 데이터베이스 백업 설정

### 권장 호스팅
- **서버**: AWS EC2, Google Cloud, Heroku
- **데이터베이스**: AWS RDS, Google Cloud SQL
- **CDN**: CloudFlare (정적 파일 가속)

## 📞 지원

문의사항이나 버그 리포트는 개발팀에 연락해주세요.

## 📄 라이선스

MIT License - 자유롭게 사용, 수정, 배포 가능합니다.

---

**괌세이브카드**로 더 스마트한 괌 여행을 즐기세요! 🏝️✨
