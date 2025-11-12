const express = require('express');
const path = require('path');
const session = require('express-session');
const { Pool } = require('pg');
const { connectDB } = require('./database');
const QRCode = require('qrcode');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const cors = require('cors');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const cron = require('node-cron');
const axios = require('axios');
const XLSX = require('xlsx');

// 비즈고 서비스 초기화 (싱글톤 인스턴스)
let bizonService = null;
try {
    bizonService = require('./services/bizonService');
    console.log('✅ 비즈고 알림톡 서비스 로드 성공');
    console.log('📋 비즈고 설정:', {
        baseURL: bizonService.baseURL,
        apiKey: bizonService.apiKey ? `${bizonService.apiKey.substring(0, 20)}...` : '❌ 없음',
        senderKey: bizonService.senderKey ? `${bizonService.senderKey.substring(0, 20)}...` : '❌ 없음',
        senderPhone: bizonService.senderPhone || '❌ 없음'
    });
} catch (error) {
    console.error('❌ 비즈고 서비스 초기화 실패:', error.message);
    bizonService = null;
}

// nodemailer 명시적 로드 (Railway 배포용 - v6.9.15)
const nodemailer = require('nodemailer');
console.log('📧 nodemailer v6.9.15 로드:', typeof nodemailer, typeof nodemailer.createTransport);
if (!nodemailer.createTransport) {
    console.error('❌❌❌ nodemailer.createTransport가 없습니다! nodemailer 객체:', Object.keys(nodemailer));
} else {
    console.log('✅ nodemailer.createTransport 함수 정상 로드');
}

// 간단하고 확실한 환경변수 처리
// 로컬에서는 railsql.env 파일 사용, 배포환경에서는 기본 .env 사용
const fs = require('fs');
if (fs.existsSync('./railsql.env')) {
    console.log('🔧 railsql.env 파일을 사용합니다 (로컬 Railway 연동)');
    require('dotenv').config({ path: './railsql.env' });
} else {
    console.log('🔧 기본 .env 파일을 사용합니다');
    require('dotenv').config();
}

// PostgreSQL 또는 JSON 데이터베이스 선택
const { pool, dbMode, testConnection, createTables, ensureAllColumns, migrateFromJSON } = require('./database');
const { normalizeReservationData } = require('./utils/normalize');
const { parseBooking } = require('./utils/aiParser');
const { createHotelTables } = require('./create-hotel-erp-tables');
let jsonDB;

try {
    if (dbMode === 'json') {
        console.log('📋 JSON 모드로 실행');
        jsonDB = require('./utils/jsonDB');
    }
} catch (error) {
    console.warn('⚠️ 데이터베이스 모듈 로드 실패:', error.message);
}

const app = express();
// Railway에서는 동적 포트 사용, 로컬에서는 3000 사용
const PORT = process.env.NODE_ENV === 'production' ? process.env.PORT : 3000;
console.log('🚀 최종 PORT 설정:', PORT, '(NODE_ENV:', process.env.NODE_ENV, ')');

// 이메일 기능 완전 제거됨

// 미들웨어 설정 - CORS 설정 (북마클릿 지원)
app.use(cors({
    origin: true, // 모든 origin 허용 (북마클릿이 다양한 플랫폼에서 실행됨)
    credentials: true, // 쿠키/세션 포함 허용
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));
app.use('/pa', express.static('pa'));
app.use('/uploads', express.static('uploads')); // 업로드된 파일 정적 서빙
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// 세션 설정 (북마클릿 cross-origin 요청 지원)
const sessionConfig = {
    secret: process.env.SESSION_SECRET || 'guam-savecard-secret-key-2025',
    resave: false,
    saveUninitialized: false,
    cookie: { 
        secure: process.env.NODE_ENV === 'production', // HTTPS only in production
        httpOnly: true, // XSS 방지
        sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax', // 북마클릿 cross-site 지원
        maxAge: 24 * 60 * 60 * 1000 // 24시간
    }
};

// 프로덕션 환경에서 MemoryStore 경고 억제
if (process.env.NODE_ENV === 'production') {
    sessionConfig.name = 'sessionId';
    sessionConfig.proxy = true;
    // MemoryStore 경고 메시지 억제를 위한 설정
    const originalConsoleWarn = console.warn;
    console.warn = function(...args) {
        const message = args.join(' ');
        if (message.includes('MemoryStore') || message.includes('connect.session()')) {
            return; // MemoryStore 관련 경고 무시
        }
        originalConsoleWarn.apply(console, args);
    };
}

app.use(session(sessionConfig));

// 관리자 인증 미들웨어 (API와 페이지 요청 모두 지원)
function requireAuth(req, res, next) {
    if (req.session.adminId) {
        next();
    } else {
        // API 요청인 경우 JSON 응답
        if (req.path.startsWith('/api/') || req.xhr || req.headers.accept?.includes('application/json')) {
            return res.status(401).json({
                ok: false,
                success: false,
                message: '인증이 필요합니다. 관리자 로그인을 해주세요.'
            });
        }
        // 페이지 요청인 경우 리다이렉트
        res.redirect('/admin/login');
    }
}

// 관리자 로그인 페이지 (GET)
app.get('/admin/login', (req, res) => {
    if (req.session.adminId) {
        return res.redirect('/admin/dashboard');
    }
    res.render('admin/login', {
        title: '관리자 로그인',
        error: null
    });
});

// 관리자 로그인 처리 (POST)
app.post('/admin/login', async (req, res) => {
    try {
        const { username, password } = req.body;
        
        if (!username || !password) {
            return res.status(400).json({
                success: false,
                message: '아이디와 비밀번호를 입력해주세요.'
            });
        }
        
        // admin_users 테이블에서 사용자 조회
        const result = await pool.query(
            'SELECT * FROM admin_users WHERE username = $1 AND is_active = true',
            [username]
        );
        
        if (result.rows.length === 0) {
            return res.status(401).json({
                success: false,
                message: '아이디 또는 비밀번호가 올바르지 않습니다.'
            });
        }
        
        const user = result.rows[0];
        
        // 비밀번호 확인
        const bcrypt = require('bcryptjs');
        const isPasswordValid = await bcrypt.compare(password, user.password_hash);
        
        if (!isPasswordValid) {
            return res.status(401).json({
                success: false,
                message: '아이디 또는 비밀번호가 올바르지 않습니다.'
            });
        }
        
        // 로그인 성공 - 세션 설정
        req.session.adminId = user.id;
        req.session.adminUsername = user.username;
        req.session.adminName = user.full_name;
        req.session.adminEmail = user.email;
        req.session.adminRole = user.role;
        
        // 마지막 로그인 시간 업데이트
        await pool.query(
            'UPDATE admin_users SET last_login = NOW() WHERE id = $1',
            [user.id]
        );
        
        console.log(`✅ 관리자 로그인 성공: ${user.username} (${user.full_name})`);
        
        res.json({
            success: true,
            message: '로그인되었습니다.',
            redirect: '/admin/dashboard'
        });
        
    } catch (error) {
        console.error('❌ 관리자 로그인 오류:', error);
        res.status(500).json({
            success: false,
            message: '로그인 처리 중 오류가 발생했습니다.'
        });
    }
});

// 관리자 로그아웃
app.get('/admin/logout', (req, res) => {
    req.session.destroy((err) => {
        if (err) {
            console.error('로그아웃 오류:', err);
        }
        res.redirect('/admin/login');
    });
});

// 예약 테이블 스키마 마이그레이션
async function migrateReservationsSchema() {
  try {
    console.log('🔧 예약 테이블 스키마 마이그레이션 시작...');
    console.log('🔧 현재 시간:', new Date().toISOString());
    
    // 현재 테이블 구조 확인
    const tableInfo = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'reservations'
    `);
    
    const existingColumns = tableInfo.rows.map(row => row.column_name);
    console.log('기존 컬럼들:', existingColumns);
    
    // 누락된 컬럼들 추가
    const columnsToAdd = [
      { name: 'platform_name', type: 'VARCHAR(50)', default: "'NOL'" },
      { name: 'channel', type: 'VARCHAR(50)', default: "'웹'" },
      { name: 'english_first_name', type: 'VARCHAR(100)', default: 'NULL' },
      { name: 'english_last_name', type: 'VARCHAR(100)', default: 'NULL' },
      { name: 'people_adult', type: 'INTEGER', default: '1' },
      { name: 'people_child', type: 'INTEGER', default: '0' },
      { name: 'people_infant', type: 'INTEGER', default: '0' },
      { name: 'total_amount', type: 'DECIMAL(12,2)', default: 'NULL' },
      { name: 'adult_unit_price', type: 'DECIMAL(10,2)', default: '0' },
      { name: 'child_unit_price', type: 'DECIMAL(10,2)', default: '0' },
      { name: 'payment_status', type: 'VARCHAR(20)', default: "'대기'" },
      { name: 'assigned_to', type: 'VARCHAR(100)', default: 'NULL' }
    ];
    
    for (const column of columnsToAdd) {
      if (!existingColumns.includes(column.name)) {
        try {
          await pool.query(`
            ALTER TABLE reservations 
            ADD COLUMN ${column.name} ${column.type} DEFAULT ${column.default}
          `);
          console.log(`✅ ${column.name} 컬럼 추가 완료`);
        } catch (error) {
          console.log(`⚠️ ${column.name} 컬럼 추가 실패:`, error.message);
        }
      }
    }
    
    // 모든 컬럼의 NOT NULL 제약조건 제거 (부분 데이터 허용)
    const columnsToMakeNullable = ['korean_name', 'email', 'phone', 'product_name'];
    for (const columnName of columnsToMakeNullable) {
      if (existingColumns.includes(columnName)) {
        try {
          await pool.query(`ALTER TABLE reservations ALTER COLUMN ${columnName} DROP NOT NULL`);
          console.log(`✅ ${columnName} NOT NULL 제약조건 제거 완료`);
        } catch (error) {
          console.log(`⚠️ ${columnName} NOT NULL 제약조건 제거 건너뜀:`, error.message);
        }
      }
    }
    
    // 기존 데이터 마이그레이션
    if (existingColumns.includes('company')) {
      await pool.query(`
        UPDATE reservations 
        SET platform_name = COALESCE(company, 'NOL') 
        WHERE platform_name IS NULL OR platform_name = ''
      `);
      console.log('✅ company -> platform_name 데이터 이동 완료');
    }
    
    if (existingColumns.includes('amount')) {
      await pool.query(`
        UPDATE reservations 
        SET total_amount = amount 
        WHERE total_amount IS NULL AND amount IS NOT NULL
      `);
      console.log('✅ amount -> total_amount 데이터 이동 완료');
    }
    
    console.log('✅ 예약 테이블 스키마 마이그레이션 완료');
    
  } catch (error) {
    console.error('❌ 스키마 마이그레이션 실패:', error);
  }
}

// 서버 시작 시 데이터베이스 초기화
async function initializeDatabase() {
  try {
    if (dbMode === 'postgresql') {
      console.log('🚀 PostgreSQL 데이터베이스 초기화 중...');
      console.log('🚀 초기화 시작 시간:', new Date().toISOString());
      await createTables();
      
      // reservations 테이블 강제 생성 (누락된 경우 대비)
      try {
        await pool.query(`
          CREATE TABLE IF NOT EXISTS reservations (
            id SERIAL PRIMARY KEY,
            reservation_number VARCHAR(100) UNIQUE NOT NULL,
            channel VARCHAR(50) DEFAULT '웹',
            platform_name VARCHAR(50) DEFAULT 'NOL',
            product_name VARCHAR(200),
            
            -- 예약자 정보
            korean_name VARCHAR(100),
            english_first_name VARCHAR(100),
            english_last_name VARCHAR(100),
            phone VARCHAR(50),
            email VARCHAR(200),
            kakao_id VARCHAR(100),
            
            -- 이용 정보
            usage_date DATE,
            usage_time TIME,
            guest_count INTEGER DEFAULT 1,
            people_adult INTEGER DEFAULT 1,
            people_child INTEGER DEFAULT 0,
            people_infant INTEGER DEFAULT 0,
            package_type VARCHAR(50),
            
            -- 결제 정보
            total_amount DECIMAL(10,2),
            adult_unit_price DECIMAL(10,2) DEFAULT 0,
            child_unit_price DECIMAL(10,2) DEFAULT 0,
            payment_status VARCHAR(50) DEFAULT '대기',
            
            -- 코드 발급 정보
            code_issued BOOLEAN DEFAULT FALSE,
            code_issued_at TIMESTAMP,
            
            -- 기타
            memo TEXT,
            assigned_to VARCHAR(100),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
          )
        `);
        console.log('✅ reservations 테이블 강제 생성 완료');
        
        // 수배서 열람 추적 테이블 생성
        try {
          await pool.query(`
            CREATE TABLE IF NOT EXISTS assignment_views (
              id SERIAL PRIMARY KEY,
              assignment_token VARCHAR(255) NOT NULL,
              reservation_id INTEGER,
              viewed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
              ip_address VARCHAR(50),
              country VARCHAR(100),
              city VARCHAR(100),
              user_agent TEXT,
              device_type VARCHAR(50),
              browser VARCHAR(50),
              os VARCHAR(50),
              screen_size VARCHAR(20),
              referrer TEXT,
              view_duration INTEGER,
              FOREIGN KEY (reservation_id) REFERENCES reservations(id) ON DELETE CASCADE
            )
          `);
          console.log('✅ assignment_views 테이블 생성 완료');
          
          // 인덱스 추가
          await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_assignment_views_token 
            ON assignment_views(assignment_token)
          `);
          await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_assignment_views_reservation 
            ON assignment_views(reservation_id)
          `);
          console.log('✅ assignment_views 인덱스 생성 완료');
        } catch (error) {
          console.log('⚠️ assignment_views 테이블 생성 실패:', error.message);
        }
        
        // ✅ assignments 테이블에 viewed_at 컬럼 추가 (핵심!)
        try {
          console.log('🔧 assignments 테이블에 viewed_at 컬럼 확인 중...');
          
          const columnCheck = await pool.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'assignments' 
            AND column_name = 'viewed_at'
          `);
          
          if (columnCheck.rows.length === 0) {
            console.log('⚠️ assignments.viewed_at 컬럼이 없습니다. 추가 중...');
            await pool.query(`
              ALTER TABLE assignments 
              ADD COLUMN viewed_at TIMESTAMP
            `);
            console.log('✅ assignments.viewed_at 컬럼 추가 완료!');
          } else {
            console.log('✅ assignments.viewed_at 컬럼이 이미 존재합니다');
          }
        } catch (error) {
          console.log('⚠️ assignments.viewed_at 컬럼 추가 실패:', error.message);
        }
        
        // 수배업체 관련 테이블 생성
        try {
          console.log('🏢 수배업체 테이블 생성 시작...');
          
          // 1. vendors 테이블 (수배업체 기본 정보)
          await pool.query(`
            CREATE TABLE IF NOT EXISTS vendors (
              id SERIAL PRIMARY KEY,
              vendor_name VARCHAR(100) NOT NULL UNIQUE,
              vendor_id VARCHAR(50) NOT NULL UNIQUE,
              password_hash VARCHAR(255) NOT NULL,
              email VARCHAR(100) NOT NULL,
              phone VARCHAR(20),
              contact_person VARCHAR(50),
              business_type VARCHAR(50),
              description TEXT,
              notification_email VARCHAR(100),
              is_active BOOLEAN DEFAULT true,
              created_at TIMESTAMP DEFAULT NOW(),
              updated_at TIMESTAMP DEFAULT NOW()
            )
          `);
          console.log('✅ vendors 테이블 생성 완료');
          
          // 2. product_guides 테이블 (RAG 상품 가이드)
          await pool.query(`
            CREATE TABLE IF NOT EXISTS product_guides (
              id SERIAL PRIMARY KEY,
              product_name VARCHAR(200) NOT NULL,
              category VARCHAR(50) DEFAULT '미분류',
              content TEXT NOT NULL,
              created_by VARCHAR(100),
              created_at TIMESTAMP DEFAULT NOW(),
              updated_at TIMESTAMP DEFAULT NOW()
            )
          `);
          console.log('✅ product_guides 테이블 생성 완료');
          
          // 인덱스 생성
          await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_product_guides_name 
            ON product_guides(product_name)
          `);
          console.log('✅ product_guides 인덱스 생성 완료');
          
          // 4. platforms 테이블 (예약업체/플랫폼 정보 - 정산 관리용)
          await pool.query(`
            CREATE TABLE IF NOT EXISTS platforms (
              id SERIAL PRIMARY KEY,
              platform_name VARCHAR(100) NOT NULL UNIQUE,
              platform_code VARCHAR(50) NOT NULL UNIQUE,
              contact_person VARCHAR(50),
              email VARCHAR(100),
              phone VARCHAR(20),
              commission_rate DECIMAL(5,2) DEFAULT 0,
              settlement_cycle VARCHAR(20) DEFAULT 'monthly',
              payment_terms VARCHAR(50),
              memo TEXT,
              is_active BOOLEAN DEFAULT true,
              created_at TIMESTAMP DEFAULT NOW(),
              updated_at TIMESTAMP DEFAULT NOW()
            )
          `);
          console.log('✅ platforms 테이블 생성 완료');
          
          // 2. vendor_products 테이블 (업체별 담당 상품 - 자동 매칭용)
          await pool.query(`
            CREATE TABLE IF NOT EXISTS vendor_products (
              id SERIAL PRIMARY KEY,
              vendor_id INTEGER REFERENCES vendors(id) ON DELETE CASCADE,
              product_keyword VARCHAR(200) NOT NULL,
              priority INTEGER DEFAULT 1,
              is_active BOOLEAN DEFAULT true,
              created_at TIMESTAMP DEFAULT NOW(),
              updated_at TIMESTAMP DEFAULT NOW(),
              UNIQUE(vendor_id, product_keyword)
            )
          `);
          
          // updated_at 컬럼 추가 (기존 테이블용)
          await pool.query(`
            ALTER TABLE vendor_products 
            ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()
          `);
          
          console.log('✅ vendor_products 테이블 생성 완료');
          
          // 3. assignments 테이블 (수배 배정 내역)
          await pool.query(`
            CREATE TABLE IF NOT EXISTS assignments (
              id SERIAL PRIMARY KEY,
              reservation_id INTEGER,
              vendor_id INTEGER REFERENCES vendors(id),
              vendor_name VARCHAR(100),
              vendor_contact VARCHAR(50),
              assignment_token VARCHAR(100) UNIQUE,
              assigned_by VARCHAR(100),
              assigned_at TIMESTAMP DEFAULT NOW(),
              status VARCHAR(20) DEFAULT 'pending',
              notes TEXT,
              sent_at TIMESTAMP,
              viewed_at TIMESTAMP,
              response_at TIMESTAMP,
              confirmation_number VARCHAR(100),
              voucher_token VARCHAR(100),
              rejection_reason TEXT,
              cost_amount DECIMAL(10,2),
              cost_currency VARCHAR(3) DEFAULT 'USD',
              voucher_number VARCHAR(100),
              voucher_url TEXT,
              voucher_issued_at TIMESTAMP,
              completed_at TIMESTAMP,
              created_at TIMESTAMP DEFAULT NOW(),
              updated_at TIMESTAMP DEFAULT NOW()
            )
          `);
          console.log('✅ assignments 테이블 생성 완료');
          
          console.log('🎉 수배업체 테이블 생성 완료!');
          
        } catch (vendorError) {
          console.log('⚠️ 수배업체 테이블 생성 중 오류:', vendorError.message);
        }
        
        // reservation_logs 테이블 생성 및 마이그레이션 (업무 히스토리)
        try {
          console.log('📜 업무 히스토리 테이블 생성/마이그레이션 시작...');
          
          await pool.query(`
            CREATE TABLE IF NOT EXISTS reservation_logs (
              id SERIAL PRIMARY KEY,
              reservation_id INTEGER REFERENCES reservations(id) ON DELETE CASCADE,
              action VARCHAR(100) NOT NULL,
              type VARCHAR(20) DEFAULT 'info',
              changed_by VARCHAR(100),
              changes JSONB,
              details TEXT,
              created_at TIMESTAMP DEFAULT NOW()
            )
          `);
          console.log('✅ reservation_logs 테이블 생성 완료');
          
          // 새로운 스키마 컬럼 추가
          await pool.query(`
            ALTER TABLE reservation_logs 
            ADD COLUMN IF NOT EXISTS category VARCHAR(50),
            ADD COLUMN IF NOT EXISTS description TEXT,
            ADD COLUMN IF NOT EXISTS metadata JSONB
          `);
          console.log('✅ reservation_logs 새 컬럼 추가 완료 (category, description, metadata)');
          
          // 기존 데이터 마이그레이션: details -> description
          await pool.query(`
            UPDATE reservation_logs 
            SET description = details 
            WHERE description IS NULL AND details IS NOT NULL
          `);
          
          // 기존 데이터에 기본 category 설정
          await pool.query(`
            UPDATE reservation_logs 
            SET category = CASE 
              WHEN action LIKE '%바우처%' OR action LIKE '%voucher%' THEN '바우처'
              WHEN action LIKE '%수배%' OR action LIKE '%assignment%' THEN '수배'
              WHEN action LIKE '%정산%' OR action LIKE '%settlement%' THEN '정산'
              WHEN action LIKE '%예약%' OR action LIKE '%reservation%' THEN '예약'
              ELSE '시스템'
            END
            WHERE category IS NULL
          `);
          console.log('✅ 기존 히스토리 데이터 마이그레이션 완료');
          
          // 인덱스 생성
          await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_reservation_logs_reservation_id 
            ON reservation_logs(reservation_id)
          `);
          await pool.query(`
            CREATE INDEX IF NOT EXISTS idx_reservation_logs_category 
            ON reservation_logs(category)
          `);
          console.log('✅ reservation_logs 인덱스 생성 완료');
          
        } catch (logError) {
          console.log('⚠️ reservation_logs 테이블 생성/마이그레이션 중 오류:', logError.message);
        }
        
        // admin_users 테이블 생성 (직원 계정 관리)
        try {
          console.log('👥 관리자 계정 테이블 생성 시작...');
          
          await pool.query(`
            CREATE TABLE IF NOT EXISTS admin_users (
              id SERIAL PRIMARY KEY,
              username VARCHAR(50) NOT NULL UNIQUE,
              password_hash VARCHAR(255) NOT NULL,
              full_name VARCHAR(100) NOT NULL,
              email VARCHAR(100),
              phone VARCHAR(20),
              role VARCHAR(20) DEFAULT 'staff',
              is_active BOOLEAN DEFAULT true,
              last_login TIMESTAMP,
              created_at TIMESTAMP DEFAULT NOW(),
              updated_at TIMESTAMP DEFAULT NOW()
            )
          `);
          console.log('✅ admin_users 테이블 생성 완료');
          
          // 기본 관리자 계정 생성 (없는 경우)
          const checkAdmin = await pool.query(
            'SELECT * FROM admin_users WHERE username = $1',
            ['admin']
          );
          
          if (checkAdmin.rows.length === 0) {
            const bcrypt = require('bcryptjs');
            const defaultPassword = await bcrypt.hash('admin1234', 10);
            await pool.query(`
              INSERT INTO admin_users (username, password_hash, full_name, role)
              VALUES ($1, $2, $3, $4)
            `, ['admin', defaultPassword, '기본 관리자', 'admin']);
            console.log('✅ 기본 관리자 계정 생성 완료 (admin / admin1234)');
          }
          
        } catch (adminError) {
          console.log('⚠️ admin_users 테이블 생성 중 오류:', adminError.message);
        }
        
        // 기존 테이블에 누락된 컬럼 추가
        await migrateReservationsSchema();
        
      } catch (tableError) {
        console.log('⚠️ reservations 테이블 생성 시도 중 오류:', tableError.message);
      }
      
      // 픽업 관련 테이블 생성
      try {
        console.log('✈️ 픽업 관리 테이블 생성 시작...');
        
        // pickup_flights 테이블 생성
        await pool.query(`
          CREATE TABLE IF NOT EXISTS pickup_flights (
            id SERIAL PRIMARY KEY,
            flight_number VARCHAR(20) UNIQUE NOT NULL,
            airline VARCHAR(3),
            departure_time TIME NOT NULL,
            arrival_time TIME NOT NULL,
            flight_hours DECIMAL(3,1) NOT NULL,
            departure_airport VARCHAR(3),
            arrival_airport VARCHAR(3),
            days_of_week VARCHAR(20),
            is_active BOOLEAN DEFAULT true,
            notes TEXT,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
          )
        `);
        console.log('✅ pickup_flights 테이블 생성 완료');
        
        // 인덱스 생성
        await pool.query(`
          CREATE INDEX IF NOT EXISTS idx_flight_number ON pickup_flights(flight_number);
          CREATE INDEX IF NOT EXISTS idx_is_active ON pickup_flights(is_active);
        `);
        
        // 기본 항공편 데이터는 자동 생성하지 않음 (항공편 관리 페이지에서 직접 추가)
        console.log('✅ pickup_flights 테이블 준비 완료');
        
        // pickup_agencies 테이블 생성
        await pool.query(`
          CREATE TABLE IF NOT EXISTS pickup_agencies (
            id SERIAL PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            contact_person VARCHAR(100),
            phone VARCHAR(50),
            email VARCHAR(100),
            vehicle_types TEXT,
            base_price DECIMAL(10,2),
            notes TEXT,
            is_active BOOLEAN DEFAULT true,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
          )
        `);
        console.log('✅ pickup_agencies 테이블 생성 완료');
        
        // pickup_reservations 테이블 생성
        await pool.query(`
          CREATE TABLE IF NOT EXISTS pickup_reservations (
            id SERIAL PRIMARY KEY,
            flight_date DATE NOT NULL,
            flight_number VARCHAR(20),
            passenger_name_kr VARCHAR(100),
            passenger_name_en VARCHAR(100),
            passenger_count INTEGER DEFAULT 1,
            phone VARCHAR(50),
            memo TEXT,
            hotel_name VARCHAR(200),
            hotel_pickup_time TIME,
            agency_id INTEGER,
            agency_name VARCHAR(100),
            cost DECIMAL(10,2),
            status VARCHAR(20) DEFAULT '대기중',
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW(),
            FOREIGN KEY (agency_id) REFERENCES pickup_agencies(id) ON DELETE SET NULL
          )
        `);
        console.log('✅ pickup_reservations 테이블 생성 완료');
        
        console.log('✈️ 픽업 관리 시스템 초기화 완료!');
      } catch (pickupError) {
        console.log('⚠️ 픽업 테이블 생성 중 오류:', pickupError.message);
      }
      
      await migrateFromJSON();
    }
  } catch (error) {
    console.error('데이터베이스 초기화 오류:', error);
  }
}

// 데이터베이스 연결 확인 미들웨어
async function checkDatabase(req, res, next) {
    try {
        if (dbMode === 'postgresql') {
            await pool.query('SELECT 1');
        }
        // JSON 모드는 항상 사용 가능하므로 체크 생략
        next();
    } catch (err) {
        console.error('데이터베이스 연결 오류:', err);
        // PostgreSQL 실패 시 JSON 모드로 fallback
        if (dbMode === 'postgresql') {
            console.warn('⚠️ PostgreSQL 연결 실패, JSON 데이터베이스로 전환합니다.');
            dbMode = 'json';
            if (!jsonDB) {
                jsonDB = require('./utils/jsonDB');
            }
        }
        next();
    }
}

// 모든 라우트에 데이터베이스 체크 적용
app.use(checkDatabase);

// ============================================
// 📜 업무 히스토리 헬퍼 함수
// ============================================
/**
 * 업무 히스토리 기록 함수
 * @param {number} reservationId - 예약 ID
 * @param {string} category - 카테고리 (예약/수배/바우처/정산/시스템)
 * @param {string} action - 액션 (create/update/send/confirm 등)
 * @param {string} changedBy - 작업자
 * @param {string} description - 서술형 설명
 * @param {object} changes - 변경사항 객체
 * @param {object} metadata - 추가 메타데이터
 */
async function logHistory(reservationId, category, action, changedBy, description, changes = null, metadata = null) {
    try {
        await pool.query(`
            INSERT INTO reservation_logs (
                reservation_id, category, action, changed_by, description, changes, metadata
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [
            reservationId,
            category,
            action,
            changedBy,
            description,
            changes ? JSON.stringify(changes) : null,
            metadata ? JSON.stringify(metadata) : null
        ]);
        
        console.log(`✅ 히스토리 기록: [${category}] ${description}`);
    } catch (error) {
        console.error('❌ 히스토리 기록 실패:', error);
    }
}

// 관리자 라우트 연결 (로그인/로그아웃만)
const adminRoutes = require('./routes/admin');
app.use('/admin', adminRoutes);

// app.locals에 pool 설정 (API 라우트에서 사용)
app.locals.pool = pool;

// 수배업체 API 라우트 연결
try {
    const vendorsRouter = require('./routes/vendors');
    app.use('/api/vendors', vendorsRouter);
    console.log('✅ 수배업체 API 라우트 연결 완료');
} catch (error) {
    console.error('⚠️ 수배업체 라우트 연결 실패:', error.message);
}

// 요금 RAG API 라우트 연결
try {
    const pricingRouter = require('./routes/pricing')(pool);
    app.use('/api/pricing', pricingRouter);
    console.log('✅ 요금 RAG API 라우트 연결 완료');
} catch (error) {
    console.error('⚠️ 요금 RAG 라우트 연결 실패:', error.message);
}

// 공항 픽업 라우트 연결 ⭐
try {
    const pickupRouter = require('./routes/pickup');
    app.use('/pickup', pickupRouter);
    console.log('✅ 공항 픽업 API 라우트 연결 완료');
} catch (error) {
    console.error('⚠️ 공항 픽업 라우트 연결 실패:', error.message);
}

// 공항 픽업 페이지 라우트 ⭐
app.get('/pickup', requireAuth, (req, res) => {
    res.render('pickup/admin', {
        title: '공항 픽업 관리',
        adminUsername: req.session.adminUsername,
        currentPage: 'pickup'
    });
});

app.get('/pickup/agencies', requireAuth, (req, res) => {
    res.render('pickup/agencies', {
        title: '업체 관리',
        adminUsername: req.session.adminUsername
    });
});

app.get('/pickup/flights', requireAuth, (req, res) => {
    res.render('pickup/flights', {
        title: '항공편 관리',
        adminUsername: req.session.adminUsername
    });
});

app.get('/pickup/driver', (req, res) => {
    res.render('pickup/driver', {
        title: '기사 화면'
    });
});

// 임시 테스트 API (구체적인 라우트를 먼저 배치)
app.get('/api/test', (req, res) => {
    res.json({ 
        message: 'API 연결 성공!', 
        timestamp: new Date(),
        database: dbMode 
    });
});

// 예약관리 페이지 전용 API - 대기중 상태만 표시
app.get('/api/reservations', async (req, res) => {
    try {
        console.log('🔍 예약관리 API 호출 - 수배서 미생성 예약 조회');
        
        // ✅ 예약관리 페이지: assignment_token이 없는 예약만 표시 (수배서 미생성)
        // 즉, 수배업체 자동 매칭 안 된 예약들
        // 날짜 형식을 YYYY-MM-DD로 명시적으로 변환
        const query = `
            SELECT 
                r.*,
                TO_CHAR(r.usage_date, 'YYYY-MM-DD') as usage_date,
                TO_CHAR(r.reservation_datetime, 'YYYY-MM-DD"T"HH24:MI') as reservation_datetime
            FROM reservations r
            LEFT JOIN assignments a ON r.id = a.reservation_id
            WHERE a.assignment_token IS NULL
            ORDER BY 
                CASE WHEN r.payment_status = 'pending' THEN 0 ELSE 1 END,
                r.created_at DESC 
            LIMIT 100
        `;
        
        const result = await pool.query(query);
        
        console.log(`📋 예약관리 조회 결과: ${result.rows.length}건 (수배서 미생성)`);
        
        res.json({
            success: true,
            count: result.rows.length,
            reservations: result.rows,
            filter: 'no_assignment_token',
            message: '수배서가 생성되지 않은 예약만 표시됩니다 (수배업체 미지정)'
        });
    } catch (error) {
        console.error('예약 목록 조회 오류:', error);
        res.status(500).json({
            success: false,
            message: '예약 목록 조회 실패',
            error: error.message
        });
    }
});

// 간단한 통계 API
app.get('/api/stats', async (req, res) => {
    try {
        const totalQuery = 'SELECT COUNT(*) as total FROM reservations';
        const totalResult = await pool.query(totalQuery);
        
        res.json({
            success: true,
            stats: {
                total_reservations: totalResult.rows[0].total,
                timestamp: new Date()
            }
        });
    } catch (error) {
        console.error('통계 조회 오류:', error);
        res.status(500).json({
            success: false,
            message: '통계 조회 실패',
            error: error.message
        });
    }
});

// 새로운 API 라우트들을 위한 데이터베이스 연결 설정
app.locals.pool = pool; // 중요: 새로운 라우트들이 사용할 수 있도록 pool 설정

// 새로운 예약 관리 API 라우트들 (임시 비활성화)
try {
    // const bookingsListRouter = require('./routes/bookings.list');
    // const bookingsPatchRouter = require('./routes/bookings.patch');
    // const bookingsCreateRouter = require('./routes/bookings.create');
    // const bookingsDeleteRouter = require('./routes/bookings.delete');
    // const bookingsBulkRouter = require('./routes/bookings.bulk');
    // const fieldDefsRouter = require('./routes/fieldDefs'); // 임시 비활성화
    // const auditsRouter = require('./routes/audits'); // 임시 비활성화
    // const bookingsDetailRouter = require('./routes/bookings.detail'); // 마지막에 배치

    // API 라우트 연결 (구체적인 것부터 먼저) - 임시 비활성화
    // app.use('/api', fieldDefsRouter); // 임시 비활성화
    // app.use('/api', auditsRouter); // 임시 비활성화
    // app.use('/api', bookingsListRouter);
    // app.use('/api', bookingsPatchRouter);
    // app.use('/api', bookingsCreateRouter);
    // app.use('/api', bookingsDeleteRouter);
    // app.use('/api', bookingsBulkRouter);
    // app.use('/api', bookingsDetailRouter); // /:id 라우트는 맨 마지막
    
    console.log('⚠️ 기존 API 라우트들 임시 비활성화 - 새로운 라우트 사용');
} catch (error) {
    console.error('❌ API 라우트 연결 오류:', error.message);
    console.log('⚠️ 일부 API 라우트를 사용할 수 없습니다. 기본 기능은 정상 작동합니다.');
}

// 서버 시작 시 PostgreSQL 스키마 보정: 테이블 생성 → 컬럼 보정
(async () => {
    if (dbMode !== 'postgresql') return;
    try {
        const ok = await testConnection();
        if (!ok) return;
        await createTables();
        if (typeof ensureAllColumns === 'function') {
            await ensureAllColumns();
        }
        
        // 요금 RAG 매칭을 위한 컬럼 추가 마이그레이션
        console.log('🔧 요금 RAG 컬럼 마이그레이션 시작...');
        await pool.query(`
            DO $$ 
            BEGIN
                -- infant_unit_price 추가
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'reservations' AND column_name = 'infant_unit_price'
                ) THEN
                    ALTER TABLE reservations ADD COLUMN infant_unit_price DECIMAL(10,2);
                    RAISE NOTICE 'infant_unit_price 컬럼 추가 완료';
                END IF;
                
                -- adult_cost 추가
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'reservations' AND column_name = 'adult_cost'
                ) THEN
                    ALTER TABLE reservations ADD COLUMN adult_cost DECIMAL(10,2);
                    RAISE NOTICE 'adult_cost 컬럼 추가 완료';
                END IF;
                
                -- child_cost 추가
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'reservations' AND column_name = 'child_cost'
                ) THEN
                    ALTER TABLE reservations ADD COLUMN child_cost DECIMAL(10,2);
                    RAISE NOTICE 'child_cost 컬럼 추가 완료';
                END IF;
                
                -- infant_cost 추가
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'reservations' AND column_name = 'infant_cost'
                ) THEN
                    ALTER TABLE reservations ADD COLUMN infant_cost DECIMAL(10,2);
                    RAISE NOTICE 'infant_cost 컬럼 추가 완료';
                END IF;
                
                -- adult_currency 추가
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'reservations' AND column_name = 'adult_currency'
                ) THEN
                    ALTER TABLE reservations ADD COLUMN adult_currency VARCHAR(10) DEFAULT 'USD';
                    RAISE NOTICE 'adult_currency 컬럼 추가 완료';
                END IF;
                
                -- child_currency 추가
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'reservations' AND column_name = 'child_currency'
                ) THEN
                    ALTER TABLE reservations ADD COLUMN child_currency VARCHAR(10) DEFAULT 'USD';
                    RAISE NOTICE 'child_currency 컬럼 추가 완료';
                END IF;
                
                -- infant_currency 추가
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'reservations' AND column_name = 'infant_currency'
                ) THEN
                    ALTER TABLE reservations ADD COLUMN infant_currency VARCHAR(10) DEFAULT 'USD';
                    RAISE NOTICE 'infant_currency 컬럼 추가 완료';
                END IF;
                
                -- adult_cost_currency 추가
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'reservations' AND column_name = 'adult_cost_currency'
                ) THEN
                    ALTER TABLE reservations ADD COLUMN adult_cost_currency VARCHAR(10) DEFAULT 'USD';
                    RAISE NOTICE 'adult_cost_currency 컬럼 추가 완료';
                END IF;
                
                -- child_cost_currency 추가
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'reservations' AND column_name = 'child_cost_currency'
                ) THEN
                    ALTER TABLE reservations ADD COLUMN child_cost_currency VARCHAR(10) DEFAULT 'USD';
                    RAISE NOTICE 'child_cost_currency 컬럼 추가 완료';
                END IF;
                
                -- infant_cost_currency 추가
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'reservations' AND column_name = 'infant_cost_currency'
                ) THEN
                    ALTER TABLE reservations ADD COLUMN infant_cost_currency VARCHAR(10) DEFAULT 'USD';
                    RAISE NOTICE 'infant_cost_currency 컬럼 추가 완료';
                END IF;
                
                -- commission_rate 추가
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'reservations' AND column_name = 'commission_rate'
                ) THEN
                    ALTER TABLE reservations ADD COLUMN commission_rate DECIMAL(5,2) DEFAULT 10;
                    RAISE NOTICE 'commission_rate 컬럼 추가 완료';
                END IF;
                
                -- exchange_rate 추가 (인박스에서 계산한 환율 저장)
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'reservations' AND column_name = 'exchange_rate'
                ) THEN
                    ALTER TABLE reservations ADD COLUMN exchange_rate DECIMAL(10,2) DEFAULT 1300;
                    RAISE NOTICE 'exchange_rate 컬럼 추가 완료';
                END IF;
            END $$;
        `);
        console.log('✅ 요금 RAG 컬럼 마이그레이션 완료');
        
        console.log('🗄️ DB 초기화/보정 완료');
    } catch (e) {
        console.warn('DB 초기화/보정 중 경고:', e.message);
    }
})();

// 관리자: 수동 컬럼 보정 실행 엔드포인트 (로그인 필요)
app.post('/admin/db/ensure-columns', requireAuth, async (req, res) => {
    if (dbMode !== 'postgresql') {
        return res.json({ success: false, message: 'PostgreSQL 모드가 아닙니다.' });
    }
    try {
        await createTables();
        if (typeof ensureAllColumns === 'function') {
            await ensureAllColumns();
        }
        return res.json({ success: true, message: '모든 테이블 컬럼 보정 완료' });
    } catch (e) {
        console.error('ensure-columns 실행 오류:', e);
        const expose = String(process.env.EXPOSE_ERROR || '').toLowerCase() === 'true';
        return res.json({ success: false, message: '컬럼 보정 중 오류가 발생했습니다.', ...(expose ? { detail: e.message } : {}) });
    }
});

// 데이터베이스 헬퍼 함수들 (PostgreSQL/JSON 호환)
const dbHelpers = {
    // 사용자 관련
    async getUsers() {
        if (dbMode === 'postgresql') {
            const result = await pool.query(`
                SELECT u.*, a.name as agency_name, 
                       COALESCE(usage_stats.usage_count, 0) as usage_count
                FROM users u 
                LEFT JOIN agencies a ON u.agency_id = a.id 
                LEFT JOIN (
                    SELECT token, COUNT(*) as usage_count 
                    FROM usages 
                    GROUP BY token
                ) usage_stats ON u.token = usage_stats.token
                ORDER BY u.created_at DESC
            `);
            return result.rows;
        } else {
            return await jsonDB.findAll('users');
        }
    },
    
    async getUserByToken(token) {
        if (dbMode === 'postgresql') {
            const result = await pool.query('SELECT * FROM users WHERE token = $1', [token]);
            return result.rows[0] || null;
        } else {
            return await jsonDB.findOne('users', { token });
        }
    },
    
    async createUser(userData) {
        if (dbMode === 'postgresql') {
            const { name, phone, email, agency_id, token, qr_code, expiration_start, expiration_end, pin } = userData;
            const result = await pool.query(
                'INSERT INTO users (name, phone, email, agency_id, token, qr_code, expiration_start, expiration_end, pin, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW()) RETURNING *',
                [name, phone, email, agency_id, token, qr_code, expiration_start, expiration_end, pin]
            );
            // 호환성: 과거 스키마의 customer_name 컬럼이 존재한다면 동기화 저장
            try {
                const col = await pool.query("SELECT 1 FROM information_schema.columns WHERE table_name='users' AND column_name='customer_name'");
                if (col && col.rowCount > 0) {
                    await pool.query('UPDATE users SET customer_name = $1, updated_at = NOW() WHERE id = $2', [name, result.rows[0].id]);
                }
            } catch (compatErr) {
                console.warn('customer_name 호환 저장 중 경고:', compatErr.message);
            }
            return result.rows[0];
        } else {
            return await jsonDB.insert('users', userData);
        }
    },
    
    // 여행사 관련
    async getAgencies() {
        if (dbMode === 'postgresql') {
            const result = await pool.query(`
                SELECT a.*, 
                       COALESCE(user_counts.card_count, 0) as card_count
                FROM agencies a 
                LEFT JOIN (
                    SELECT agency_id, COUNT(*) as card_count 
                    FROM users 
                    GROUP BY agency_id
                ) user_counts ON a.id = user_counts.agency_id
                ORDER BY a.sort_order, a.name
            `);
            return result.rows;
        } else {
            return await jsonDB.findAll('agencies');
        }
    },
    
    async getAgencyById(id) {
        if (dbMode === 'postgresql') {
            const result = await pool.query('SELECT * FROM agencies WHERE id = $1', [id]);
            return result.rows[0] || null;
        } else {
            return await jsonDB.findById('agencies', id);
        }
    },
    
    async getAgencyByCode(code) {
        if (dbMode === 'postgresql') {
            const result = await pool.query('SELECT * FROM agencies WHERE code = $1', [code]);
            return result.rows[0] || null;
        } else {
            return await jsonDB.findOne('agencies', { code });
        }
    },
    
    async createAgency(agencyData) {
        if (dbMode === 'postgresql') {
            const { name, code, discount_info, show_banners_on_landing = true } = agencyData;
            
            // 새로운 여행사의 sort_order를 가장 마지막으로 설정
            const maxOrderResult = await pool.query('SELECT COALESCE(MAX(sort_order), 0) + 1 as next_order FROM agencies');
            const nextOrder = maxOrderResult.rows[0].next_order;
            
            const result = await pool.query(
                'INSERT INTO agencies (name, code, discount_info, show_banners_on_landing, sort_order, created_at) VALUES ($1, $2, $3, $4, $5, NOW()) RETURNING *',
                [name, code, discount_info, show_banners_on_landing, nextOrder]
            );
            return result.rows[0];
        } else {
            return await jsonDB.insert('agencies', agencyData);
        }
    },
    
    async updateAgency(id, agencyData) {
        if (dbMode === 'postgresql') {
            const { name, code, discount_info, show_banners_on_landing, contact_email, contact_phone, logo_url } = agencyData;
            console.log('updateAgency 호출:', { id, name, code, discount_info, show_banners_on_landing, contact_email, contact_phone, logo_url });
            
            const result = await pool.query(
                'UPDATE agencies SET name = $1, code = $2, discount_info = $3, show_banners_on_landing = $4, contact_email = $5, contact_phone = $6, logo_url = $7, updated_at = NOW() WHERE id = $8 RETURNING *',
                [name, code, discount_info, show_banners_on_landing, contact_email, contact_phone, logo_url, id]
            );
            
            console.log('SQL 업데이트 결과:', result.rows[0]);
            console.log('영향받은 행 수:', result.rowCount);
            
            return result.rows[0];
        } else {
            return await jsonDB.update('agencies', id, agencyData);
        }
    },

    async deleteAgency(id) {
        if (dbMode === 'postgresql') {
            // 연결된 사용자 확인
            const userCheck = await pool.query('SELECT COUNT(*) as count FROM users WHERE agency_id = $1', [id]);
            const userCount = parseInt(userCheck.rows[0].count);
            
            if (userCount > 0) {
                return { hasUsers: true, userCount, message: `이 여행사에 연결된 ${userCount}명의 고객이 있습니다.` };
            }
            
            // 사용자가 없으면 바로 삭제
            const result = await pool.query('DELETE FROM agencies WHERE id = $1 RETURNING *', [id]);
            return { success: true, deleted: result.rows[0] };
        } else {
            return await jsonDB.delete('agencies', id);
        }
    },

    async forceDeleteAgency(id) {
        if (dbMode === 'postgresql') {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                
                // 연결된 사용자들의 사용 이력 삭제
                await client.query('DELETE FROM usages WHERE token IN (SELECT token FROM users WHERE agency_id = $1)', [id]);
                
                // 연결된 사용자들 삭제
                await client.query('DELETE FROM users WHERE agency_id = $1', [id]);
                
                // 여행사 삭제
                const result = await client.query('DELETE FROM agencies WHERE id = $1 RETURNING *', [id]);
                
                await client.query('COMMIT');
                return { success: true, deleted: result.rows[0] };
            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            } finally {
                client.release();
            }
        } else {
            return await jsonDB.delete('agencies', id);
        }
    },
    
    // 제휴업체 관련
    async getStores() {
        if (dbMode === 'postgresql') {
            const result = await pool.query('SELECT * FROM stores ORDER BY usage_count DESC, name ASC');
            return result.rows;
        } else {
            return await jsonDB.findAll('stores');
        }
    },
    
    async getStoreById(id) {
        if (dbMode === 'postgresql') {
            const result = await pool.query('SELECT * FROM stores WHERE id = $1', [id]);
            return result.rows[0] || null;
        } else {
            return await jsonDB.findById('stores', id);
        }
    },
    
    async createStore(storeData) {
        if (dbMode === 'postgresql') {
            const {
                name,
                category = null,
                discount = null,
                discount_info = null,
                address = null,
                phone = null,
                website = null,
                description = null,
                image_url = null
            } = storeData;
            const result = await pool.query(
                `INSERT INTO stores (name, category, discount, discount_info, address, phone, website, description, image_url)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
                [name, category, discount, discount_info, address, phone, website, description, image_url]
            );
            return result.rows[0];
        } else {
            return await jsonDB.insert('stores', storeData);
        }
    },

    async updateStore(id, storeData) {
        if (dbMode === 'postgresql') {
            const {
                name,
                category = null,
                discount = null,
                discount_info = null,
                address = null,
                phone = null,
                website = null,
                description = null,
                image_url = null,
                usage_count = 0
            } = storeData;
            const result = await pool.query(
                `UPDATE stores SET name = $1, category = $2, discount = $3, discount_info = $4, 
                 address = $5, phone = $6, website = $7, description = $8, image_url = $9, usage_count = $10, updated_at = NOW() 
                 WHERE id = $11 RETURNING *`,
                [name, category, discount, discount_info, address, phone, website, description, image_url, usage_count, id]
            );
            return result.rows[0];
        } else {
            return await jsonDB.update('stores', id, storeData);
        }
    },

    async deleteStore(id) {
        if (dbMode === 'postgresql') {
            const result = await pool.query('UPDATE stores SET is_active = false, updated_at = NOW() WHERE id = $1 RETURNING *', [id]);
            return result.rows[0];
        } else {
            return await jsonDB.update('stores', id, { is_active: false });
        }
    },
    
    // 배너 관련
    async getBanners() {
        if (dbMode === 'postgresql') {
            const result = await pool.query('SELECT * FROM banners WHERE is_active = true ORDER BY display_order');
            return result.rows;
        } else {
            const banners = await jsonDB.findAll('banners');
            return banners.filter(banner => banner.is_active !== false);
        }
    },
    
    async createBanner(bannerData) {
        if (dbMode === 'postgresql') {
            const {
                advertiser_name,
                image_url,
                link_url = null,
                description = null,
                is_active = true,
                display_order = 0,
                display_locations = [1]
            } = bannerData;
            const result = await pool.query(
                `INSERT INTO banners (advertiser_name, image_url, link_url, description, is_active, display_order, display_locations)
                 VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
                [advertiser_name, image_url, link_url, description, is_active, display_order, display_locations]
            );
            return result.rows[0];
        } else {
            return await jsonDB.insert('banners', bannerData);
        }
    },

    async updateBanner(id, bannerData) {
        if (dbMode === 'postgresql') {
            const {
                advertiser_name,
                image_url,
                link_url = null,
                description = null,
                is_active = true,
                display_order = 0,
                display_locations = [1]
            } = bannerData;
            const result = await pool.query(
                `UPDATE banners SET advertiser_name = $1, image_url = $2, link_url = $3, description = $4,
                 is_active = $5, display_order = $6, display_locations = $7, updated_at = NOW() 
                 WHERE id = $8 RETURNING *`,
                [advertiser_name, image_url, link_url, description, is_active, display_order, display_locations, id]
            );
            return result.rows[0];
        } else {
            return await jsonDB.update('banners', id, bannerData);
        }
    },

    async deleteBanner(id) {
        if (dbMode === 'postgresql') {
            // 실제 삭제로 변경 (소프트 삭제에서 하드 삭제로)
            const result = await pool.query('DELETE FROM banners WHERE id = $1 RETURNING *', [id]);
            return result.rows[0];
        } else {
            return await jsonDB.delete('banners', id);
        }
    },

    async incrementBannerClick(id) {
        if (dbMode === 'postgresql') {
            const result = await pool.query('UPDATE banners SET click_count = click_count + 1, updated_at = NOW() WHERE id = $1 RETURNING *', [id]);
            return result.rows[0];
        } else {
            const banner = await jsonDB.findById('banners', id);
            if (banner) {
                banner.click_count = (banner.click_count || 0) + 1;
                return await jsonDB.update('banners', id, banner);
            }
            return null;
        }
    },
    
    // 사용 기록 관련
    async getUsages(token = null) {
        if (dbMode === 'postgresql') {
            if (token) {
                const result = await pool.query(`
                    SELECT u.*, 
                           users.name as customer_name,
                           agencies.name as agency_name
                    FROM usages u
                    LEFT JOIN users ON u.token = users.token
                    LEFT JOIN agencies ON users.agency_id = agencies.id
                    WHERE u.token = $1 
                    ORDER BY u.used_at DESC
                `, [token]);
                return result.rows;
            } else {
                const result = await pool.query(`
                    SELECT u.*, 
                           users.name as customer_name,
                           agencies.name as agency_name
                    FROM usages u
                    LEFT JOIN users ON u.token = users.token
                    LEFT JOIN agencies ON users.agency_id = agencies.id
                    ORDER BY u.used_at DESC
                `);
                return result.rows;
            }
        } else {
            if (token) {
                return await jsonDB.findAll('usages', { token });
            } else {
                return await jsonDB.findAll('usages');
            }
        }
    },
    
    async createUsage(usageData) {
        if (dbMode === 'postgresql') {
            const { token, store_name, used_at = new Date() } = usageData;
            const result = await pool.query(
                'INSERT INTO usages (token, store_name, used_at) VALUES ($1, $2, $3) RETURNING *',
                [token, store_name, used_at]
            );
            return result.rows[0];
        } else {
            return await jsonDB.insert('usages', { ...usageData, used_at: usageData.used_at || new Date() });
        }
    }
};

// 발급 코드 검증 함수
async function validateIssueCode(code) {
    try {
        if (dbMode === 'postgresql') {
            // issue_codes 테이블에서 코드 조회
            const result = await pool.query(
                'SELECT * FROM issue_codes WHERE code = $1',
                [code]
            );
            
            if (result.rows.length === 0) {
                return { 
                    valid: false, 
                    message: '유효하지 않은 발급 코드입니다. 코드를 확인해주세요.' 
                };
            }
            
            const issueCode = result.rows[0];
            
            // 이미 사용된 코드인지 확인
            if (issueCode.is_used) {
                return { 
                    valid: false, 
                    message: '이미 사용된 발급 코드입니다.' 
                };
            }
            
            // 유효한 코드
            return { 
                valid: true, 
                codeId: issueCode.id 
            };
        } else {
            // JSON 모드에서는 항상 유효한 것으로 처리
            return { valid: true, codeId: null };
        }
    } catch (error) {
        console.error('❌ 발급 코드 검증 오류:', error);
        return { 
            valid: false, 
            message: '발급 코드 검증 중 오류가 발생했습니다.' 
        };
    }
}

// 날짜 포맷 함수
function formatDate(date) {
    const d = new Date(date);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[d.getMonth()];
    const day = String(d.getDate()).padStart(2, '0');
    const year = String(d.getFullYear()).slice(-2);
    return `${month}/${day}/${year}`;
}

// 2개월 지난 사용자 이메일 마스킹 함수
async function maskExpiredEmails() {
    try {
        if (dbMode !== 'postgresql') {
            console.log('⏭️  JSON 모드에서는 이메일 마스킹을 지원하지 않습니다.');
            return { success: false, message: 'JSON 모드 미지원' };
        }

        // 2개월 = 60일
        const twoMonthsAgo = new Date();
        twoMonthsAgo.setDate(twoMonthsAgo.getDate() - 60);

        const result = await pool.query(`
            UPDATE users 
            SET email = 'oo@oo.ooo', updated_at = NOW()
            WHERE created_at < $1 
            AND email IS NOT NULL 
            AND email != '' 
            AND email != 'oo@oo.ooo'
            RETURNING id, name, email
        `, [twoMonthsAgo]);

        const maskedCount = result.rowCount;
        
        if (maskedCount > 0) {
            console.log(`📧 이메일 마스킹 완료: ${maskedCount}명의 이메일을 'oo@oo.ooo'로 변경`);
            result.rows.forEach(user => {
                console.log(`  - ${user.name} (ID: ${user.id})`);
            });
        } else {
            console.log('📧 마스킹 대상 없음: 2개월 이상 지난 사용자가 없습니다.');
        }

        return { 
            success: true, 
            maskedCount,
            message: `${maskedCount}명의 이메일이 마스킹되었습니다.` 
        };

    } catch (error) {
        console.error('❌ 이메일 마스킹 오류:', error);
        return { 
            success: false, 
            message: '이메일 마스킹 중 오류가 발생했습니다.',
            error: error.message 
        };
    }
}

// 발급 코드 전달 상태 업데이트 API
app.put('/admin/issue-codes/:id/delivery', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { is_delivered } = req.body;
        
        if (dbMode === 'postgresql') {
            const delivered_at = is_delivered ? new Date() : null;
            
            const result = await pool.query(
                'UPDATE issue_codes SET is_delivered = $1, delivered_at = $2 WHERE id = $3 RETURNING *',
                [is_delivered, delivered_at, id]
            );
            
            if (result.rows.length === 0) {
                return res.json({ success: false, message: '코드를 찾을 수 없습니다.' });
            }
            
            res.json({ 
                success: true, 
                message: is_delivered ? '전달 완료로 표시되었습니다.' : '미전달로 표시되었습니다.',
                code: result.rows[0]
            });
        } else {
            res.json({ success: false, message: 'PostgreSQL 모드에서만 사용 가능합니다.' });
        }
    } catch (error) {
        console.error('전달 상태 업데이트 오류:', error);
        res.json({ success: false, message: '전달 상태 업데이트 중 오류가 발생했습니다.' });
    }
});

// ==================== 메인 라우트 ====================

// 헬스체크 라우트 (디버깅용)
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        timestamp: new Date().toISOString(),
        message: 'PostgreSQL 서버가 정상 작동 중입니다.'
    });
});

// 데이터베이스 테스트 엔드포인트
app.get('/db-test', async (req, res) => {
    try {
        if (dbMode === 'postgresql') {
            const result = await pool.query('SELECT NOW()');
            res.json({ 
                status: 'PostgreSQL Connected', 
                time: result.rows[0].now,
                mode: dbMode 
            });
        } else {
            res.json({ 
                status: 'JSON Mode', 
                mode: dbMode 
            });
        }
    } catch (error) {
        res.status(500).json({ 
            status: 'Database Error', 
            error: error.message,
            mode: dbMode 
        });
    }
});

// 예약 테이블 생성 및 확인 엔드포인트
app.get('/create-reservations-table', async (req, res) => {
    try {
        if (dbMode !== 'postgresql') {
            return res.json({ status: 'JSON Mode - 테이블 생성 불필요' });
        }

        // 예약 테이블 생성
        await pool.query(`
            CREATE TABLE IF NOT EXISTS reservations (
                id SERIAL PRIMARY KEY,
                company VARCHAR(50) DEFAULT 'NOL',
                reservation_number VARCHAR(50),
                confirmation_number VARCHAR(50),
                booking_channel VARCHAR(100),
                product_name VARCHAR(200),
                amount DECIMAL(10,2),
                package_type VARCHAR(100),
                usage_date DATE,
                usage_time TIME,
                korean_name VARCHAR(100),
                english_name VARCHAR(100),
                email VARCHAR(150),
                phone VARCHAR(20),
                kakao_id VARCHAR(100),
                guest_count INTEGER,
                memo TEXT,
                issue_code_id INTEGER REFERENCES issue_codes(id),
                code_issued BOOLEAN DEFAULT FALSE,
                code_issued_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // 테이블 존재 확인
        const tableCheck = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name = 'reservations'
        `);

        // 컬럼 정보 확인
        const columns = await pool.query(`
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns 
            WHERE table_name = 'reservations'
            ORDER BY ordinal_position
        `);

        res.json({
            status: 'success',
            message: 'reservations 테이블 생성 완료',
            tableExists: tableCheck.rows.length > 0,
            columns: columns.rows
        });

    } catch (error) {
        console.error('테이블 생성 오류:', error);
        res.status(500).json({
            status: 'error',
            message: error.message
        });
    }
});

// 사용자용 로그아웃 (프론트 my-card.ejs 등에서 사용)
app.post('/logout', (req, res) => {
    try {
        req.session.destroy(() => {
            res.redirect('/');
        });
    } catch (e) {
        res.redirect('/');
    }
});

// 제휴업체 생성 (관리자)
app.post('/admin/stores', requireAuth, async (req, res) => {
    try {
        const wantsJson = req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'));
        const name = (req.body.name || '').trim();
        const category = (req.body.category || '').trim();
        const description = (req.body.description || '').trim();
        const discount = (req.body.discount || '').trim();
        const address = (req.body.address || '').trim();
        const phone = (req.body.phone || '').trim();
        const website = (req.body.website || '').trim();
        const image_url = (req.body.image_url || '').trim();

        if (!name || !category || !description || !discount) {
            if (wantsJson) {
                return res.json({ success: false, message: '필수 항목(업체명/카테고리/설명/할인 정보)을 입력하세요.' });
            } else {
                return res.redirect('/admin/stores?error=missing_fields');
            }
        }

        const store = await dbHelpers.createStore({
            name,
            category,
            description,
            discount,
            address: address || null,
            phone: phone || null,
            website: website || null,
            image_url: image_url || null
        });

        if (wantsJson) {
            return res.json({ success: true, message: '제휴업체가 추가되었습니다.', store });
        } else {
            return res.redirect('/admin/stores?success=1');
        }
    } catch (error) {
        console.error('제휴업체 생성 오류:', error);
        const wantsJson = req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'));
        if (wantsJson) {
            return res.json({ success: false, message: '제휴업체 추가 중 오류가 발생했습니다.' });
        } else {
            return res.redirect('/admin/stores?error=server');
        }
    }
});

// 제휴업체 개별 조회 라우트 (수정 모달용) - PUT보다 먼저 정의
app.get('/admin/stores/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const store = await dbHelpers.getStoreById(id);
        
        if (!store) {
            return res.json({
                success: false,
                message: '제휴업체를 찾을 수 없습니다.'
            });
        }
        
        res.json({
            success: true,
            store: store
        });
        
    } catch (error) {
        console.error('제휴업체 조회 오류:', error);
        res.json({
            success: false,
            message: '제휴업체 조회 중 오류가 발생했습니다.'
        });
    }
});

// 제휴업체 수정 라우트
app.put('/admin/stores/:id', requireAuth, async (req, res) => {
    try {
        const wantsJson = req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'));
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) {
            if (wantsJson) return res.json({ success: false, message: '유효하지 않은 ID' });
            return res.redirect('/admin/stores?error=invalid_id');
        }

        console.log('수정 요청 받은 데이터:', req.body);
        
        const {
            name,
            category,
            discount,
            discount_info,
            address,
            phone,
            website,
            description,
            image_url,
            usage_count
        } = req.body;

        if (!name || !category || !description || !discount) {
            if (wantsJson) {
                return res.json({ success: false, message: '필수 항목(업체명/카테고리/설명/할인 정보)을 입력하세요.' });
            } else {
                return res.redirect('/admin/stores?error=missing_fields');
            }
        }

        const updateData = {
            name: name.trim(),
            category: category.trim(),
            discount: discount.trim(),
            discount_info: discount_info ? discount_info.trim() : null,
            address: address ? address.trim() : null,
            phone: phone ? phone.trim() : null,
            website: website ? website.trim() : null,
            description: description.trim(),
            image_url: image_url ? image_url.trim() : null,
            usage_count: usage_count ? Number(usage_count) : 0
        };
        
        console.log('updateStore 호출 전 데이터:', updateData);
        const store = await dbHelpers.updateStore(id, updateData);
        console.log('updateStore 결과:', store);

        if (!store) {
            if (wantsJson) {
                return res.json({ success: false, message: '제휴업체를 찾을 수 없습니다.' });
            } else {
                return res.redirect('/admin/stores?error=not_found');
            }
        }

        if (wantsJson) {
            return res.json({ success: true, message: '제휴업체가 수정되었습니다.', store });
        } else {
            return res.redirect('/admin/stores?success=updated');
        }
    } catch (error) {
        console.error('제휴업체 수정 오류:', error);
        const wantsJson = req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'));
        if (wantsJson) {
            return res.json({ success: false, message: '제휴업체 수정 중 오류가 발생했습니다.' });
        } else {
            return res.redirect('/admin/stores?error=server');
        }
    }
});

// 제휴업체 삭제 라우트 (소프트 삭제)
app.delete('/admin/stores/:id', requireAuth, async (req, res) => {
    try {
        const wantsJson = req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'));
        const id = Number(req.params.id);
        if (!Number.isFinite(id)) {
            if (wantsJson) return res.json({ success: false, message: '유효하지 않은 ID' });
            return res.redirect('/admin/stores?error=invalid_id');
        }

        const store = await dbHelpers.deleteStore(id);
        
        if (!store) {
            if (wantsJson) {
                return res.json({ success: false, message: '제휴업체를 찾을 수 없습니다.' });
            } else {
                return res.redirect('/admin/stores?error=not_found');
            }
        }

        if (wantsJson) {
            return res.json({ success: true, message: '제휴업체가 비활성화되었습니다.' });
        } else {
            return res.redirect('/admin/stores?success=deleted');
        }
    } catch (error) {
        console.error('제휴업체 삭제 오류:', error);
        const wantsJson = req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'));
        if (wantsJson) {
            return res.json({ success: false, message: '제휴업체 삭제 중 오류가 발생했습니다.' });
        } else {
            return res.redirect('/admin/stores?error=server');
        }
    }
});

// 제휴업체 활성/비활성 토글
app.post('/admin/stores/:id/toggle', requireAuth, async (req, res) => {
    try {
        console.log('제휴업체 토글 요청:', req.params.id);
        const wantsJson = req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'));
        const id = Number(req.params.id);
        
        if (!Number.isFinite(id)) {
            console.log('유효하지 않은 ID:', req.params.id);
            if (wantsJson) return res.json({ success: false, message: '유효하지 않은 ID' });
            return res.redirect('/admin/stores?error=invalid_id');
        }

        let nextVal;
        if (dbMode === 'postgresql') {
            console.log('PostgreSQL에서 현재 상태 조회 중...');
            const current = await pool.query('SELECT is_active FROM stores WHERE id = $1', [id]);
            
            if (current.rowCount === 0) {
                console.log('업체를 찾을 수 없음:', id);
                return res.json({ success: false, message: '업체를 찾을 수 없습니다.' });
            }
            
            const currentStatus = current.rows[0].is_active;
            nextVal = !Boolean(currentStatus);
            console.log(`업체 ${id} 상태 변경: ${currentStatus} -> ${nextVal}`);
            
            await pool.query('UPDATE stores SET is_active = $1, updated_at = NOW() WHERE id = $2', [nextVal, id]);
            console.log('상태 업데이트 완료');
        } else {
            const store = await jsonDB.findById('stores', id);
            if (!store) return res.json({ success: false, message: '업체를 찾을 수 없습니다.' });
            nextVal = store.is_active === false ? true : false;
            await jsonDB.update('stores', id, { is_active: nextVal });
        }

        if (wantsJson) {
            console.log('JSON 응답 반환:', { success: true, is_active: nextVal });
            return res.json({ success: true, is_active: nextVal, message: `제휴업체가 ${nextVal ? '활성화' : '비활성화'}되었습니다.` });
        } else {
            return res.redirect('/admin/stores?toggle=1');
        }
    } catch (error) {
        console.error('제휴업체 토글 오류:', error);
        const wantsJson = req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'));
        if (wantsJson) {
            return res.json({ success: false, message: '상태 변경 중 오류가 발생했습니다.' });
        } else {
            return res.redirect('/admin/stores?error=server');
        }
    }
});

// ==================== 관리자 페이지 라우트 ====================

// 관리자 메인 페이지 (ERP 대시보드로 리다이렉트)
app.get('/admin', requireAuth, (req, res) => {
    res.redirect('/admin/dashboard');
});

// SaveCard 대시보드 (별도)
app.get('/admin/savecard-dashboard', requireAuth, async (req, res) => {
    try {
        // 통계 데이터 수집
        const [users, agencies, stores, usages] = await Promise.all([
            dbHelpers.getUsers().catch(() => []),
            dbHelpers.getAgencies().catch(() => []),
            dbHelpers.getStores().catch(() => []),
            dbHelpers.getUsages().catch(() => [])
        ]);

        // 최근 사용 이력 (최근 10개)
        const recentUsages = usages
            .sort((a, b) => new Date(b.used_at) - new Date(a.used_at))
            .slice(0, 10);

        res.render('admin/savecard-dashboard', {
            title: 'SaveCard 대시보드',
            adminUsername: req.session.adminUsername || 'admin',
            stats: {
                total_agencies: agencies.length,
                total_users: users.length,
                total_usages: usages.length,
                total_stores: stores.length,
                active_banners: 0
            },
            recentUsages
        });
    } catch (error) {
        console.error('SaveCard 대시보드 오류:', error);
        res.render('admin/savecard-dashboard', {
            title: 'SaveCard 대시보드',
            adminUsername: req.session.adminUsername || 'admin',
            stats: { 
                total_agencies: 0, 
                total_users: 0, 
                total_usages: 0, 
                total_stores: 0,
                active_banners: 0 
            },
            recentUsages: []
        });
    }
});

// 관리자 여행사 관리 페이지
app.get('/admin/agencies', requireAuth, async (req, res) => {
    try {
        const agencies = await dbHelpers.getAgencies();
        res.render('admin/agencies', {
            title: '여행사 관리',
            adminUsername: req.session.adminUsername || 'admin',
            agencies: agencies,
            baseUrl: `${req.protocol}://${req.get('host')}`,
            success: req.query.success,
            error: req.query.error
        });
    } catch (error) {
        console.error('여행사 관리 페이지 오류:', error);
        res.render('admin/agencies', {
            title: '여행사 관리',
            adminUsername: req.session.adminUsername || 'admin',
            agencies: [],
            baseUrl: `${req.protocol}://${req.get('host')}`,
            success: null,
            error: 'load_error'
        });
    }
});


// 관리자 고객 관리 페이지
app.get('/admin/customers', requireAuth, async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = 20;
        const offset = (page - 1) * limit;

        const users = await dbHelpers.getUsers();
        const totalUsers = users.length;
        const paginatedUsers = users.slice(offset, offset + limit);
        
        const totalPages = Math.ceil(totalUsers / limit);

        res.render('admin/customers', {
            title: '고객 관리',
            users: paginatedUsers,
            pagination: {
                currentPage: page,
                totalPages,
                hasNext: page < totalPages,
                hasPrev: page > 1
            },
            success: req.query.success,
            error: req.query.error
        });
    } catch (error) {
        console.error('고객 관리 페이지 오류:', error);
        res.render('admin/customers', {
            title: '고객 관리',
            users: [],
            pagination: { currentPage: 1, totalPages: 0, hasNext: false, hasPrev: false },
            error: 'load_error'
        });
    }
});

// 관리자 사용 이력 페이지
app.get('/admin/usage-history', requireAuth, async (req, res) => {
    try {
        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = 50;
        const offset = (page - 1) * limit;

        const allUsages = await dbHelpers.getUsages();
        const totalUsages = allUsages.length;
        const paginatedUsages = allUsages
            .sort((a, b) => new Date(b.used_at) - new Date(a.used_at))
            .slice(offset, offset + limit);
        
        const totalPages = Math.ceil(totalUsages / limit);

        res.render('admin/usage-history', {
            title: '사용 이력',
            usages: paginatedUsages,
            pagination: {
                currentPage: page,
                totalPages,
                hasNext: page < totalPages,
                hasPrev: page > 1
            },
            success: req.query.success,
            error: req.query.error
        });
    } catch (error) {
        console.error('사용 이력 페이지 오류:', error);
        res.render('admin/usage-history', {
            title: '사용 이력',
            usages: [],
            pagination: { currentPage: 1, totalPages: 0, hasNext: false, hasPrev: false },
            error: 'load_error'
        });
    }
});

// 관리자 수배관리 페이지
app.get('/admin/assignments', requireAuth, async (req, res) => {
    try {
        res.render('admin/assignments', {
            title: '수배관리',
            adminUsername: req.session.adminUsername || 'admin'
        });
    } catch (error) {
        console.error('수배관리 페이지 오류:', error);
        res.render('admin/assignments', {
            title: '수배관리',
            adminUsername: req.session.adminUsername || 'admin'
        });
    }
});

// 관리자 광고 배너 관리 페이지
app.get('/admin/banners', requireAuth, async (req, res) => {
    try {
        let banners = [];
        if (dbMode === 'postgresql') {
            const result = await pool.query('SELECT * FROM banners ORDER BY display_order, created_at DESC');
            banners = result.rows;
        } else {
            banners = await jsonDB.findAll('banners');
        }

        res.render('admin/banners', {
            title: '광고 배너 관리',
            adminUsername: req.session.adminUsername || 'admin',
            banners,
            success: req.query.success,
            error: req.query.error
        });
    } catch (error) {
        console.error('광고 배너 관리 페이지 오류:', error);
        res.render('admin/banners', {
            title: '광고 배너 관리',
            adminUsername: req.session.adminUsername || 'admin',
            banners: [],
            success: null,
            error: 'load_error'
        });
    }
});

// 배너 생성 (관리자)
app.post('/admin/banners', requireAuth, async (req, res) => {
    try {
        const wantsJson = req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'));
        let { advertiser_name, title, image_url, link_url, description, display_order } = req.body;
        let display_locations = req.body.display_locations;

        advertiser_name = String(advertiser_name || '').trim();
        title = String(title || '').trim();
        image_url = String(image_url || '').trim();
        link_url = (link_url && String(link_url).trim()) || null;
        description = (description && String(description).trim()) || null;
        const orderNum = Number(display_order);
        display_order = Number.isFinite(orderNum) ? orderNum : 0;

        // 체크박스 다중 값 처리
        if (!Array.isArray(display_locations)) {
            display_locations = typeof display_locations === 'undefined' ? [] : [display_locations];
        }
        const locationsInt = display_locations
            .map(v => Number(v))
            .filter(n => Number.isFinite(n) && n > 0);
        const finalLocations = locationsInt.length ? locationsInt : [1];

        if (!advertiser_name && !title) {
            if (wantsJson) return res.json({ success: false, message: '광고주명 또는 제목 중 하나는 필수입니다.' });
            return res.redirect('/admin/banners?error=missing_title');
        }
        if (!image_url) {
            if (wantsJson) return res.json({ success: false, message: '배너 이미지 URL은 필수입니다.' });
            return res.redirect('/admin/banners?error=missing_image');
        }

        // 배너 생성 (description 필드 포함)
        const banner = await dbHelpers.createBanner({
            advertiser_name: title || advertiser_name,
            image_url,
            link_url,
            description,
            is_active: true,
            display_order,
            display_locations: finalLocations
        });

        if (wantsJson) {
            return res.json({ success: true, message: '배너가 추가되었습니다.', banner });
        } else {
            return res.redirect('/admin/banners?success=1');
        }
    } catch (error) {
        console.error('배너 생성 오류:', error);
        const wantsJson = req.xhr || (req.headers.accept && req.headers.accept.includes('application/json'));
        if (wantsJson) {
            return res.json({ success: false, message: '배너 추가 중 오류가 발생했습니다.' });
        } else {
            return res.redirect('/admin/banners?error=server');
        }
    }
});

// 메인 페이지
app.get('/', async (req, res) => {
    // 데이터 조회 (오류 발생 시 빈 배열로 대체하여 페이지는 항상 렌더)
    let agencies = [];
    let banners = [];
    try {
        agencies = await dbHelpers.getAgencies();
    } catch (err) {
        console.warn('여행사 데이터 조회 실패:', err.message);
    }
    try {
        banners = await dbHelpers.getBanners();
    } catch (err) {
        console.warn('배너 데이터 조회 실패:', err.message);
    }

    try {
        res.render('index', {
            title: '괌세이브카드',
            currentPage: 'home',
            agencies,
            banners,
            partnerAgency: null
        });
    } catch (renderErr) {
        console.error('메인 페이지 렌더링 오류:', renderErr);
        res.status(500).render('error', {
            title: '서버 오류',
            message: '페이지 렌더링 중 오류가 발생했습니다.',
            error: { status: 500, message: renderErr.message }
        });
    }
});

// 여행사 전용 랜딩 페이지
app.get('/partner/:code', async (req, res) => {
    try {
        const { code } = req.params;
        
        // 여행사 코드로 여행사 정보 조회
        const partnerAgency = await dbHelpers.getAgencyByCode(code);
        if (!partnerAgency) {
            return res.render('error', {
                title: '여행사를 찾을 수 없습니다',
                message: '유효하지 않은 여행사 코드입니다.',
                error: { status: 404 }
            });
        }

        // 데이터 조회
        let agencies = [];
        let banners = [];
        try {
            agencies = await dbHelpers.getAgencies();
        } catch (err) {
            console.warn('여행사 데이터 조회 실패:', err.message);
        }
        try {
            banners = await dbHelpers.getBanners();
        } catch (err) {
            console.warn('배너 데이터 조회 실패:', err.message);
        }

        res.render('index', {
            title: `괌세이브카드 - ${partnerAgency.name}`,
            currentPage: 'home',
            agencies,
            banners,
            partnerAgency: partnerAgency
        });
        
    } catch (error) {
        console.error('파트너 랜딩 페이지 오류:', error);
        res.render('error', {
            title: '오류가 발생했습니다',
            message: '페이지를 불러오는 중 오류가 발생했습니다.',
            error: { status: 500, message: error.message }
        });
    }
});

// 여행사별 랜딩 페이지
app.get('/partner/:agencyCode', async (req, res) => {
    try {
        const { agencyCode } = req.params;
        const agency = await dbHelpers.getAgencyByCode(agencyCode);
        
        if (!agency) {
            return res.render('error', {
                title: '페이지를 찾을 수 없습니다',
                message: '유효하지 않은 여행사 코드입니다.',
                error: { status: 404 }
            });
        }
        
        // 배너 표시 여부 확인
        let banners = [];
        if (agency.show_banners_on_landing) {
            banners = await dbHelpers.getBanners();
        }
        
        res.render('index', {
            title: `${agency.name} - 괌세이브카드`,
            currentPage: 'home',
            agency: agency,
            banners: banners,
            partnerMode: true,
            selectedAgency: agency
        });
    } catch (error) {
        console.error('파트너 페이지 오류:', error);
        res.render('error', {
            title: '오류가 발생했습니다',
            message: '페이지를 불러오는 중 오류가 발생했습니다.',
            error: { status: 500 }
        });
    }
});

// 배너 클릭 추적 API
app.post('/banner/click/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await dbHelpers.incrementBannerClick(id);
        res.json({ success: true });
    } catch (error) {
        console.error('배너 클릭 추적 오류:', error);
        res.json({ success: false });
    }
});

// 발급 완료 페이지
app.get('/register/success', async (req, res) => {
    try {
        const { token } = req.query;
        if (!token) {
            return res.redirect('/issue');
        }

        const user = await dbHelpers.getUserByToken(token);
        if (!user) {
            return res.redirect('/issue');
        }

        const agency = user.agency_id ? await dbHelpers.getAgencyById(user.agency_id) : null;
        const banners = await dbHelpers.getBanners();

        // 만료 텍스트 구성 (있으면 표시)
        let expiration_text = null;
        if (user.expiration_start && user.expiration_end) {
            const start = new Date(user.expiration_start);
            const end = new Date(user.expiration_end);
            const fmt = (d) => `${d.getFullYear()}.${String(d.getMonth()+1).padStart(2,'0')}.${String(d.getDate()).padStart(2,'0')}`;
            expiration_text = `Save Card Expiration Date ${fmt(start)}~${fmt(end)}`;
        }

        const userForView = {
            customer_name: user.name || user.customer_name || '고객',
            agency_name: agency ? agency.name : 'Unknown',
            expiration_text,
            token: token
        };

        const cardUrl = `/card?token=${encodeURIComponent(token)}`;
        const qrImageUrl = user.qr_code; // DataURL

        return res.render('register-success', {
            title: '괌세이브카드 발급 완료',
            user: userForView,
            cardUrl,
            qrImageUrl,
            banners
        });
    } catch (error) {
        console.error('발급 성공 페이지 오류:', error);
        return res.redirect('/issue');
    }
});

// 제휴업체 목록 페이지
app.get('/stores', async (req, res) => {
    try {
        let partnerAgency = null;
        if (req.query.agency) {
            partnerAgency = await dbHelpers.getAgencyByCode(req.query.agency);
        }
        
        const stores = await dbHelpers.getStores();
        const banners = await dbHelpers.getBanners();
        
        // 카테고리 생성 (stores에서 카테고리 추출)
        const categories = {};
        if (stores && stores.length > 0) {
            stores.forEach(store => {
                if (store.category) {
                    categories[store.category] = true;
                }
            });
        }
        
        res.render('stores', {
            title: '제휴업체',
            currentPage: 'stores',
            stores: stores,
            banners: banners,
            categories: categories,
            partnerAgency: partnerAgency
        });
    } catch (error) {
        console.error('제휴업체 목록 오류:', error);
        res.render('stores', {
            title: '제휴업체',
            currentPage: 'stores',
            stores: [],
            banners: [],
            categories: {},
            partnerAgency: null
        });
    }
});

app.get('/partner-apply', (req, res) => {
    try {
        res.render('partner-apply', {
            title: '제휴업체 신청'
        });
    } catch (error) {
        console.error('제휴 신청 페이지 오류:', error);
        res.status(500).render('error', { 
            title: '서버 오류',
            message: '페이지를 불러오는 중 오류가 발생했습니다.',
            error: { status: 500 }
        });
    }
});

// 사용자 로그인 페이지
app.get('/login', async (req, res) => {
    try {
        let partnerAgency = null;
        if (req.query.agency) {
            partnerAgency = await dbHelpers.getAgencyByCode(req.query.agency);
        }
        
        res.render('login', {
            title: '로그인',
            currentPage: 'my-card',
            error: null,
            success: null,
            partnerAgency: partnerAgency
        });
    } catch (error) {
        console.error('로그인 페이지 오류:', error);
        res.render('login', {
            title: '로그인',
            currentPage: 'my-card',
            error: null,
            success: null,
            partnerAgency: null
        });
    }
});

// 사용자 로그인 처리
app.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        
        if (!email || !password) {
            return res.render('login', {
                title: '로그인',
                currentPage: 'my-card',
                error: '이메일과 비밀번호를 입력해주세요.',
                success: null
            });
        }
        
        if (!/^[0-9]{4}$/.test(password)) {
            return res.render('login', {
                title: '로그인',
                currentPage: 'my-card',
                error: '비밀번호는 4자리 숫자여야 합니다.',
                success: null
            });
        }
        
        // 이메일로 사용자 찾기
        let user = null;
        if (dbMode === 'postgresql') {
            const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
            user = result.rows[0];
        } else {
            const users = jsonDB.getUsers();
            user = users.find(u => u.email === email);
        }
        
        if (!user) {
            return res.render('login', {
                title: '로그인',
                currentPage: 'my-card',
                error: '등록되지 않은 이메일입니다.',
                success: null
            });
        }
        
        if (!user.pin) {
            return res.render('login', {
                title: '로그인',
                currentPage: 'my-card',
                error: '비밀번호가 설정되지 않았습니다. 관리자에게 문의해주세요.',
                success: null
            });
        }
        
        // 비밀번호 확인
        const isPasswordValid = await bcrypt.compare(password, user.pin);
        if (!isPasswordValid) {
            return res.render('login', {
                title: '로그인',
                currentPage: 'my-card',
                error: '비밀번호가 일치하지 않습니다.',
                success: null
            });
        }
        
        // 로그인 성공 - 카드 페이지로 리다이렉트
        res.redirect(`/card?token=${encodeURIComponent(user.token)}&success=1`);
        
    } catch (error) {
        console.error('사용자 로그인 오류:', error);
        res.render('login', {
            title: '로그인',
            currentPage: 'my-card',
            error: '로그인 처리 중 오류가 발생했습니다.',
            success: null
        });
    }
});

// 카드 발급 페이지
app.get('/register', async (req, res) => {
    try {
        const agencies = await dbHelpers.getAgencies();
        const { agency } = req.query;
        
        let selectedAgency = null;
        if (agency) {
            selectedAgency = await dbHelpers.getAgencyByCode(agency);
        }
        
        res.render('register', {
            title: '카드 발급',
            currentPage: 'register',
            agencies: agencies,
            error: null,
            success: null,
            selectedAgency: selectedAgency,
            partnerAgency: selectedAgency
        });
    } catch (error) {
        console.error('카드 발급 페이지 오류:', error);
        res.render('register', {
            title: '카드 발급',
            currentPage: 'register',
            agencies: [],
            error: null,
            success: null,
            selectedAgency: null,
            partnerAgency: null
        });
    }
});

// 사용자 로그인 페이지
app.get('/login', (req, res) => {
    res.render('login', {
        title: '로그인',
        error: null
    });
});

// 내 카드 페이지
app.get('/my-card', (req, res) => {
    res.render('my-card', {
        title: '내 카드',
        currentPage: 'my-card',
        user: null,
        usages: []
    });
});

// 카드 발급 페이지
app.get('/issue', async (req, res) => {
    try {
        const agencies = await dbHelpers.getAgencies();
        res.render('issue', {
            title: '카드 발급',
            agencies: agencies
        });
    } catch (error) {
        console.error('카드 발급 페이지 오류:', error);
        res.render('issue', {
            title: '카드 발급',
            agencies: []
        });
    }
});

// 이메일 중복 체크 API
app.get('/api/check-email', async (req, res) => {
    try {
        const { email } = req.query;
        
        if (!email || !email.trim()) {
            return res.json({ available: false, message: '이메일을 입력해주세요.' });
        }
        
        const normalizedEmail = email.trim().toLowerCase();
        
        if (dbMode === 'postgresql') {
            const result = await pool.query(
                'SELECT id FROM users WHERE LOWER(email) = $1',
                [normalizedEmail]
            );
            
            if (result.rows.length > 0) {
                return res.json({ 
                    available: false, 
                    message: '이미 사용 중인 이메일입니다.' 
                });
            }
        }
        
        return res.json({ 
            available: true, 
            message: '사용 가능한 이메일입니다.' 
        });
        
    } catch (error) {
        console.error('이메일 중복 체크 오류:', error);
        return res.json({ 
            available: false, 
            message: '이메일 확인 중 오류가 발생했습니다.' 
        });
    }
});

// 카드 발급 처리
app.post('/issue', async (req, res) => {
    try {
        const { name, email, issue_code } = req.body;
        let { agency_id, agency_code } = req.body;
        const pin = (req.body.pin || '').toString().trim();
        const phone = (req.body.phone || '').toString().trim() || null; // 선택 입력

        // 발급 코드 검증 (필수)
        if (!issue_code || !issue_code.trim()) {
            return res.render('issue-error', {
                errorMessage: '발급 코드를 입력해주세요.',
                errorDetails: '괌세이브카드를 발급받으려면 유효한 발급 코드가 필요합니다.'
            });
        }

        const codeValidation = await validateIssueCode(issue_code.trim().toLowerCase());
        if (!codeValidation.valid) {
            return res.render('issue-error', {
                errorMessage: codeValidation.message,
                errorDetails: '발급 코드가 올바른지 확인하거나, 고객센터에 문의해주세요.'
            });
        }

        // 이메일 중복 체크
        if (email && email.trim()) {
            const normalizedEmail = email.trim().toLowerCase();
            if (dbMode === 'postgresql') {
                const emailCheck = await pool.query(
                    'SELECT id, name FROM users WHERE LOWER(email) = $1',
                    [normalizedEmail]
                );
                
                if (emailCheck.rows.length > 0) {
                    return res.render('issue-error', {
                        errorMessage: '이미 사용 중인 이메일입니다.',
                        errorDetails: '해당 이메일로 이미 카드가 발급되어 있습니다. 다른 이메일을 사용하거나 기존 계정으로 로그인해주세요.'
                    });
                }
            }
        }

        // agency_id 우선, 없으면 agency_code로 조회
        let agency = null;
        if (agency_id) {
            const idNum = Number(agency_id);
            if (!Number.isFinite(idNum)) {
                return res.render('issue-error', {
                    errorMessage: '유효하지 않은 여행사 정보입니다.',
                    errorDetails: '여행사 정보를 다시 선택해주세요.'
                });
            }
            agency = await dbHelpers.getAgencyById(idNum);
        } else if (agency_code) {
            agency_code = String(agency_code).trim();
            agency = await dbHelpers.getAgencyByCode(agency_code);
            if (agency) {
                agency_id = agency.id;
            }
        }

        // 필수값: name, agency, pin(4자리)
        if (!name || !agency_id || !agency) {
            return res.render('issue-error', {
                errorMessage: '필수 정보를 모두 입력해주세요.',
                errorDetails: '이름과 여행사 정보를 확인해주세요.'
            });
        }
        if (!/^[0-9]{4}$/.test(pin)) {
            return res.render('issue-error', {
                errorMessage: '로그인 비밀번호 형식이 올바르지 않습니다.',
                errorDetails: '비밀번호는 4자리 숫자여야 합니다.'
            });
        }
        
        // 토큰 생성
        const token = uuidv4();
        
        // 유효기간 설정 (발급일로부터 1년)
        const expirationStart = new Date();
        const expirationEnd = new Date();
        expirationEnd.setFullYear(expirationEnd.getFullYear() + 1);
        
        const expirationText = `Save Card Expiration Date ${formatDate(expirationStart)}~${formatDate(expirationEnd)}`;
        
        // QR 코드 생성 (Base64 인라인 방식)
        const qrUrl = `${req.protocol}://${req.get('host')}/card?token=${token}&staff=true`;
        const qrCodeDataURL = await QRCode.toDataURL(qrUrl, {
            width: 200,
            margin: 2,
            color: {
                dark: '#000000',
                light: '#FFFFFF'
            }
        });
        
        // PIN 해시 처리
        const saltRounds = Number(process.env.PIN_SALT_ROUNDS || 10);
        const hashedPin = await bcrypt.hash(pin, saltRounds);

        // (운영 안전장치) users 테이블 필수 컬럼 보정
        if (dbMode === 'postgresql') {
            try {
                await pool.query(`
                  ALTER TABLE users
                  ADD COLUMN IF NOT EXISTS name VARCHAR(255),
                  ADD COLUMN IF NOT EXISTS qr_code TEXT,
                  ADD COLUMN IF NOT EXISTS expiration_start TIMESTAMP,
                  ADD COLUMN IF NOT EXISTS expiration_end TIMESTAMP,
                  ADD COLUMN IF NOT EXISTS pin VARCHAR(100)
                `);
                // 과거 스키마 호환: customer_name만 있고 name이 비어있는 경우 동기화
                await pool.query(`
                  DO $$
                  BEGIN
                    IF EXISTS (
                      SELECT 1 FROM information_schema.columns
                      WHERE table_name='users' AND column_name='customer_name'
                    ) THEN
                      UPDATE users SET name = customer_name WHERE name IS NULL OR name = '';
                    END IF;
                  END$$;
                `);
                // 기존 pin 컬럼 길이가 100 미만이면 확장
                await pool.query(`
                  DO $$
                  BEGIN
                    IF EXISTS (
                      SELECT 1 FROM information_schema.columns
                      WHERE table_name='users' AND column_name='pin' AND character_maximum_length IS NOT NULL AND character_maximum_length < 100
                    ) THEN
                      ALTER TABLE users ALTER COLUMN pin TYPE VARCHAR(100);
                    END IF;
                  END$$;
                `);
            } catch (ensureErr) {
                console.warn('users 테이블 컬럼 보정 중 경고:', ensureErr.message);
            }
        }

        // 사용자 생성 (운영 DB에 pin 컬럼이 없는 경우 자동 보정 후 재시도)
        let user;
        try {
            user = await dbHelpers.createUser({
                name,
                phone,
                email,
                agency_id,
                token,
                qr_code: qrCodeDataURL,
                expiration_start: expirationStart,
                expiration_end: expirationEnd,
                pin: hashedPin
            });
        } catch (e) {
            // PostgreSQL: undefined_column = 42703
            const missingPinColumn = e && (e.code === '42703' || /column\s+"?pin"?\s+of\s+relation\s+"?users"?/i.test(e.message || ''));
            if (dbMode === 'postgresql' && missingPinColumn) {
                console.warn('users.pin 컬럼이 없어 자동으로 추가합니다.');
                try {
                    await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS pin VARCHAR(100)');
                    await pool.query(`
                      DO $$
                      BEGIN
                        IF EXISTS (
                          SELECT 1 FROM information_schema.columns
                          WHERE table_name='users' AND column_name='pin' AND character_maximum_length IS NOT NULL AND character_maximum_length < 100
                        ) THEN
                          ALTER TABLE users ALTER COLUMN pin TYPE VARCHAR(100);
                        END IF;
                      END$$;
                    `);
                    // 재시도
                    user = await dbHelpers.createUser({
                        name,
                        phone,
                        email,
                        agency_id,
                        token,
                        qr_code: qrCodeDataURL,
                        expiration_start: expirationStart,
                        expiration_end: expirationEnd,
                        pin: hashedPin
                    });
                } catch (e2) {
                    console.error('핀 컬럼 추가 또는 재시도 중 오류:', e2);
                    throw e2;
                }
            } else {
                throw e;
            }
        }
        
        // 발급 코드를 사용됨으로 표시
        if (dbMode === 'postgresql' && codeValidation.codeId) {
            try {
                await pool.query(
                    'UPDATE issue_codes SET is_used = true, used_by_user_id = $1, used_at = NOW() WHERE id = $2',
                    [user.id, codeValidation.codeId]
                );
            } catch (codeUpdateError) {
                console.error('발급 코드 업데이트 오류:', codeUpdateError);
                // 코드 업데이트 실패해도 카드 발급은 성공으로 처리
            }
        }
        
        // 제출 방식에 따른 응답 분기: AJAX이면 JSON, 일반 HTML 폼이면 발급 완료 페이지로 리다이렉트
        const isAjax = req.xhr || (req.get('X-Requested-With') === 'XMLHttpRequest');
        const acceptsHtml = (req.accepts(['html','json']) === 'html');
        if (!isAjax && acceptsHtml) {
            return res.redirect(`/register/success?token=${encodeURIComponent(token)}`);
        }
        return res.json({
            success: true,
            message: '카드가 성공적으로 발급되었습니다.',
            token: token,
            success_url: `/register/success?token=${encodeURIComponent(token)}`
        });
        
    } catch (error) {
        console.error('카드 발급 오류:', error);
        const expose = String(process.env.EXPOSE_ERROR || '').toLowerCase() === 'true';
        return res.render('issue-error', {
            errorMessage: '카드 발급 중 오류가 발생했습니다.',
            errorDetails: expose ? `오류 상세: ${error.message}` : '잠시 후 다시 시도해주시거나, 고객센터에 문의해주세요.'
        });
    }
});

// 제휴 신청 접수 API
app.post('/api/partner-apply', async (req, res) => {
    try {
        // 폼 → DB 컬럼 매핑
        const business_name = (req.body.business_name || '').toString().trim();
        const contact_name = (req.body.contact_name || '').toString().trim();
        const phone = (req.body.phone || '').toString().trim();
        const email = (req.body.email || '').toString().trim() || null;
        const business_type = (req.body.business_type || '').toString().trim() || null;
        const location = (req.body.business_address || req.body.location || '').toString().trim() || null;
        const discount_offer = (req.body.proposed_discount || req.body.discount_offer || '').toString().trim() || null;
        // 설명/추가정보를 하나로 합쳐 저장 (둘 중 하나만 있을 수도 있음)
        const desc = (req.body.business_description || '').toString().trim();
        const notes = (req.body.additional_notes || req.body.additional_info || '').toString().trim();
        const additional_info = [desc, notes].filter(Boolean).join('\n\n');
        
        if (!business_name || !contact_name || !phone) {
            return res.status(400).json({ success: false, message: '필수 항목을 입력해주세요.' });
        }
        
        if (dbMode === 'postgresql') {
            // 중복 체크
            const existingApp = await pool.query(
                'SELECT id FROM partner_applications WHERE business_name = $1 AND contact_name = $2 AND phone = $3',
                [business_name, contact_name, phone]
            );
            
            if (existingApp.rows.length > 0) {
                return res.json({
                    success: false,
                    message: '이미 동일한 정보로 신청된 내역이 있습니다.'
                });
            }
            
            await pool.query(
                `INSERT INTO partner_applications (business_name, contact_name, phone, email, business_type, location, discount_offer, additional_info)
                 VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
                [business_name, contact_name, phone, email, business_type, location, discount_offer, additional_info || null]
            );
        } else {
            await jsonDB.create('partner_applications', {
                id: Date.now(),
                business_name, contact_name, phone, email,
                business_type, location, discount_offer,
                additional_info: additional_info || null,
                status: 'pending',
                created_at: new Date().toISOString()
            });
        }
        
        res.json({ success: true });
    } catch (error) {
        console.error('제휴 신청 접수 오류:', error);
        res.status(500).json({ success: false, message: '서버 오류가 발생했습니다.' });
    }
});

// 내 카드 페이지
app.get('/my-card', async (req, res) => {
    try {
        const { token } = req.query;

        if (!token) {
            return res.render('error', {
                title: '잘못된 접근',
                message: '유효하지 않은 카드입니다.',
                error: { status: 400 }
            });
        }
        
        const user = await dbHelpers.getUserByToken(token);
        if (!user) {
            return res.render('error', {
                title: '카드를 찾을 수 없습니다',
                message: '유효하지 않은 카드입니다.',
                error: { status: 404 }
            });
        }
        
        const agency = await dbHelpers.getAgencyById(user.agency_id);
        const usages = await dbHelpers.getUsages(token);
        
        res.render('my-card', {
            title: '내 카드',
            currentPage: 'my-card',
            user: { ...user, agency_name: agency ? agency.name : 'Unknown' },
            usages: usages.slice(0, 5)
        });
        
    } catch (error) {
        console.error('내 카드 페이지 오류:', error);
        res.render('error', {
            title: '오류가 발생했습니다',
            message: '페이지를 불러오는 중 오류가 발생했습니다.',
            error: { status: 500 }
        });
    }
});

// 카드 보기 페이지 (경로 파라미터 방식) - /card로 리다이렉트
app.get('/view-card/:token', (req, res) => {
    const { token } = req.params;
    if (!token) {
        return res.redirect('/issue');
    }
    res.redirect(`/card?token=${token}`);
});

// 관리자 전용 - 고객 카드 정보 API (모달용)
app.get('/admin/card-info/:token', requireAuth, async (req, res) => {
    const { token } = req.params;

    try {
        const user = await dbHelpers.getUserByToken(token);
        if (!user) {
            return res.json({ success: false, message: '카드를 찾을 수 없습니다.' });
        }

        const agency = await dbHelpers.getAgencyById(user.agency_id);
        
        // 사용 이력 조회 (최근 10개)
        const usages = await dbHelpers.getUsages(token);
        const recentUsages = usages
            .sort((a, b) => new Date(b.used_at) - new Date(a.used_at))
            .slice(0, 10);

        res.json({
            success: true,
            user: {
                ...user,
                agency_name: agency ? agency.name : 'Unknown'
            },
            usages: recentUsages
        });
    } catch (error) {
        console.error('관리자 카드 정보 조회 오류:', error);
        res.json({ success: false, message: '카드 정보를 불러오는 중 오류가 발생했습니다.' });
    }
});

// 카드 사용 페이지 (QR 스캔)
app.get('/card', async (req, res) => {
    try {
        const { token, staff, success: successFlag } = req.query;
        
        if (!token) {
            return res.render('error', {
                title: '잘못된 접근',
                message: '유효하지 않은 카드입니다.',
                error: { status: 400 }
            });
        }
        
        const user = await dbHelpers.getUserByToken(token);
        if (!user) {
            return res.render('error', {
                title: '카드를 찾을 수 없습니다',
                message: '유효하지 않은 카드입니다.',
                error: { status: 404 }
            });
        }
        
        const agency = await dbHelpers.getAgencyById(user.agency_id);
        const banners = await dbHelpers.getBanners();
        const banner = banners.length > 0 ? banners[Math.floor(Math.random() * banners.length)] : null;
        const usages = await dbHelpers.getUsages(token);
        const stores = await dbHelpers.getStores();
        const isStaffMode = staff === 'true';
        
        const successMessage = (successFlag === '1' || successFlag === 'true')
            ? '카드 발급이 완료되었어요! 아래 QR을 매장 직원에게 보여주세요.'
            : null;

        res.render('card', {
            title: '괄세이브카드',
            currentPage: 'card',
            user: { 
                ...user, 
                agency_name: agency ? agency.name : 'Unknown',
                customer_name: user.customer_name || user.name || '고객',
                qr_code: user.qr_code || `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(`https://savecard-production.up.railway.app/card?token=${token}&staff=true`)}`
            },
            banner: banner,
            usages: usages.slice(0, 5),
            stores: stores,
            isStaffMode: isStaffMode,
            success: successMessage,
            error: null
        });
        
    } catch (error) {
        console.error('카드 페이지 오류:', error);
        res.render('error', {
            title: '오류가 발생했습니다',
            message: '페이지를 불러오는 중 오류가 발생했습니다.',
            error: { status: 500 }
        });
    }
});

// 카드 비밀번호 검증
app.post('/verify-password', async (req, res) => {
    try {
        const token = (req.body.token || '').toString().trim();
        const password = (req.body.password || '').toString().trim();

        if (!token || !password) {
            return res.json({ success: false, message: '필수 정보가 누락되었습니다.' });
        }
        if (!/^[0-9]{4}$/.test(password)) {
            return res.json({ success: false, message: '비밀번호는 4자리 숫자여야 합니다.' });
        }

        const user = await dbHelpers.getUserByToken(token);
        if (!user) {
            return res.json({ success: false, message: '유효하지 않은 카드입니다.' });
        }
        if (!user.pin) {
            return res.json({ success: false, message: '비밀번호가 설정되지 않았습니다. 관리자에게 문의해주세요.' });
        }

        const ok = await bcrypt.compare(password, user.pin);
        if (!ok) {
            return res.json({ success: false, message: '비밀번호가 일치하지 않습니다.' });
        }
        return res.json({ success: true });
    } catch (error) {
        console.error('비밀번호 검증 오류:', error);
        const expose = String(process.env.EXPOSE_ERROR || '').toLowerCase() === 'true';
        return res.json({ success: false, message: '인증 중 오류가 발생했습니다.', ...(expose ? { detail: error.message } : {}) });
    }
});

// 카드 사용 처리
app.post('/card/use', async (req, res) => {
    try {
        const { token, store_code } = req.body;
        
        if (!token || !store_code) {
            return res.json({
                success: false,
                message: '필수 정보가 누락되었습니다.'
            });
        }
        
        const user = await dbHelpers.getUserByToken(token);
        if (!user) {
            return res.json({
                success: false,
                message: '유효하지 않은 카드입니다.'
            });
        }
        
        // 사용 기록 생성
        await dbHelpers.createUsage({
            token: token,
            store_name: store_code
        });
        
        res.json({
            success: true,
            message: '할인이 성공적으로 적용되었습니다.'
        });
        
    } catch (error) {
        console.error('카드 사용 처리 오류:', error);
        res.json({
            success: false,
            message: '카드 사용 처리 중 오류가 발생했습니다.'
        });
    }
});

// 관리자 대시보드 (ERP 중심 - 개인화)
app.get('/admin/dashboard', requireAuth, async (req, res) => {
    try {
        const today = new Date().toISOString().split('T')[0];
        const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
        const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
        
        // 현재 로그인한 사용자
        const currentUser = req.session.adminName || req.session.adminUsername || 'admin';
        console.log('👤 대시보드 접근:', currentUser);
        
        // Phase 1 데이터 조회 (내 담당만)
        // 1. 오늘 해야 할 일 (긴급 액션)
        const urgentTodayDeparture = await pool.query(`
            SELECT COUNT(*) as count FROM reservations 
            WHERE assigned_to = $1
            AND usage_date = $2 AND (
                payment_status = 'in_progress' OR 
                payment_status = 'pending'
            )
        `, [currentUser, today]);
        
        const pendingOver24h = await pool.query(`
            SELECT COUNT(*) as count FROM reservations 
            WHERE assigned_to = $1
            AND payment_status = 'pending' 
            AND created_at < NOW() - INTERVAL '24 hours'
        `, [currentUser]);
        
        const tomorrowDepartures = await pool.query(`
            SELECT COUNT(*) as count FROM reservations 
            WHERE assigned_to = $1
            AND usage_date = $2 AND payment_status != 'cancelled'
        `, [currentUser, tomorrow]);
        
        // 2. 워크플로우 현황 (내 담당만)
        const workflowStats = await pool.query(`
            SELECT 
                payment_status,
                COUNT(*) as count
            FROM reservations
            WHERE assigned_to = $1
            AND payment_status != 'cancelled'
            GROUP BY payment_status
        `, [currentUser]);
        
        // 3. 오늘의 숫자 (내 담당만)
        const todayNew = await pool.query(`
            SELECT COUNT(*) as count FROM reservations 
            WHERE assigned_to = $1
            AND DATE(created_at) = $2
        `, [currentUser, today]);
        
        const todayCompleted = await pool.query(`
            SELECT COUNT(*) as count FROM reservations 
            WHERE assigned_to = $1
            AND DATE(updated_at) = $2 AND payment_status = 'confirmed'
        `, [currentUser, today]);
        
        const todayRevenue = await pool.query(`
            SELECT SUM(
                (COALESCE(adult_price, 0) * COALESCE(people_adult, 0)) +
                (COALESCE(child_price, 0) * COALESCE(people_child, 0)) +
                (COALESCE(infant_price, 0) * COALESCE(people_infant, 0))
            ) as total
            FROM reservations 
            WHERE assigned_to = $1
            AND DATE(created_at) = $2
        `, [currentUser, today]);
        
        // Phase 2 데이터 조회 (내 담당만)
        // 4. 알림 센터 (데이터 검증 이슈)
        const dataIssues = await pool.query(`
            SELECT 
                reservation_number,
                product_name,
                korean_name,
                CASE 
                    WHEN email IS NULL OR email = '' THEN '이메일 누락'
                    WHEN kakao_id IS NULL OR kakao_id = '' THEN '카카오ID 누락'
                    WHEN english_last_name IS NULL OR english_first_name IS NULL THEN '영문명 누락'
                END as issue_type
            FROM reservations
            WHERE assigned_to = $1
            AND payment_status != 'cancelled'
            AND (
                email IS NULL OR email = '' OR
                kakao_id IS NULL OR kakao_id = '' OR
                english_last_name IS NULL OR english_first_name IS NULL
            )
            ORDER BY created_at DESC
            LIMIT 10
        `, [currentUser]);
        
        // 5. 캘린더 뷰 (이번주 날짜별 예약 수, 내 담당만)
        const weeklyCalendar = await pool.query(`
            SELECT 
                usage_date,
                COUNT(*) as count
            FROM reservations
            WHERE assigned_to = $1
            AND usage_date >= $2 
            AND usage_date <= $2 + INTERVAL '6 days'
            AND payment_status != 'cancelled'
            GROUP BY usage_date
            ORDER BY usage_date
        `, [currentUser, today]);
        
        // 6. 정산 요약 (내 담당만)
        const unpaidSettlements = await pool.query(`
            SELECT 
                COUNT(*) as count,
                SUM(
                    (COALESCE(adult_price, 0) * COALESCE(people_adult, 0)) +
                    (COALESCE(child_price, 0) * COALESCE(people_child, 0)) +
                    (COALESCE(infant_price, 0) * COALESCE(people_infant, 0))
                ) as total_amount
            FROM reservations
            WHERE assigned_to = $1
            AND payment_status = 'confirmed'
        `, [currentUser]);
        
        const workflow = {};
        workflowStats.rows.forEach(row => {
            workflow[row.payment_status] = parseInt(row.count);
        });
        
        res.render('admin/dashboard', {
            title: 'Save ERP 대시보드',
            adminUsername: req.session.adminUsername || 'admin',
            // Phase 1
            urgentActions: {
                todayDeparture: parseInt(urgentTodayDeparture.rows[0].count),
                pendingOver24h: parseInt(pendingOver24h.rows[0].count),
                tomorrowDepartures: parseInt(tomorrowDepartures.rows[0].count)
            },
            workflow: {
                pending: workflow.pending || 0,
                in_progress: workflow.in_progress || 0,
                confirmed: workflow.confirmed || 0
            },
            todayStats: {
                newReservations: parseInt(todayNew.rows[0].count),
                completed: parseInt(todayCompleted.rows[0].count),
                revenue: parseFloat(todayRevenue.rows[0].total || 0)
            },
            // Phase 2
            dataIssues: dataIssues.rows,
            weeklyCalendar: weeklyCalendar.rows,
            settlements: {
                unpaidCount: parseInt(unpaidSettlements.rows[0].count || 0),
                unpaidAmount: parseFloat(unpaidSettlements.rows[0].total_amount || 0)
            }
        });
    } catch (error) {
        console.error('❌ 대시보드 데이터 조회 오류:', error);
        res.render('admin/dashboard', {
            title: 'Save ERP 대시보드',
            adminUsername: req.session.adminUsername || 'admin',
            urgentActions: { todayDeparture: 0, pendingOver24h: 0, tomorrowDepartures: 0 },
            workflow: { pending: 0, in_progress: 0, confirmed: 0 },
            todayStats: { newReservations: 0, completed: 0, revenue: 0 },
            dataIssues: [],
            weeklyCalendar: [],
            settlements: { unpaidCount: 0, unpaidAmount: 0 }
        });
    }
});

// ==================== RAG 가이드 관리 라우트 ====================

// RAG 관리 페이지
app.get('/admin/rag-manager', requireAuth, (req, res) => {
    res.render('admin/rag-manager', {
        title: 'RAG 상품 가이드 관리',
        adminUsername: req.session.adminUsername || 'admin'
    });
});

// RAG 가이드 목록 조회
app.get('/api/rag/guides', requireAuth, async (req, res) => {
    try {
        // 데이터베이스에서 조회
        const result = await pool.query(`
            SELECT id, product_name, category, content, created_at, updated_at
            FROM product_guides
            ORDER BY created_at DESC
        `);
        
        const guides = result.rows.map(row => ({
            id: row.id,
            name: row.product_name,
            category: row.category || '미분류',
            content: row.content,
            created_at: row.created_at,
            updated_at: row.updated_at
        }));
        
        res.json({
            success: true,
            guides: guides
        });
    } catch (error) {
        console.error('❌ RAG 가이드 목록 조회 오류:', error);
        res.status(500).json({
            success: false,
            message: '가이드 목록 조회 중 오류가 발생했습니다: ' + error.message
        });
    }
});

// RAG 가이드 상세 조회
app.get('/api/rag/guides/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        
        const result = await pool.query(`
            SELECT id, product_name, category, content, created_at, updated_at
            FROM product_guides
            WHERE id = $1
        `, [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '가이드를 찾을 수 없습니다.'
            });
        }
        
        res.json({
            success: true,
            content: result.rows[0].content,
            guide: result.rows[0]
        });
    } catch (error) {
        console.error('❌ RAG 가이드 상세 조회 오류:', error);
        res.status(500).json({
            success: false,
            message: '가이드 조회 중 오류가 발생했습니다: ' + error.message
        });
    }
});

// RAG 가이드 생성
app.post('/api/rag/guides', requireAuth, async (req, res) => {
    try {
        const { productName, content } = req.body;
        
        if (!productName || !content) {
            return res.status(400).json({
                success: false,
                message: '상품명과 내용을 입력해주세요.'
            });
        }
        
        // 카테고리 추출
        const categoryMatch = content.match(/카테고리:\s*(.+)/);
        const category = categoryMatch ? categoryMatch[1].trim() : '미분류';
        
        // 데이터베이스에 저장
        const result = await pool.query(`
            INSERT INTO product_guides (product_name, category, content, created_by)
            VALUES ($1, $2, $3, $4)
            RETURNING id, product_name
        `, [productName, category, content, req.session.adminUsername || 'admin']);
        
        console.log(`✅ RAG 가이드 DB 저장 완료: ${productName}`);
        
        res.json({
            success: true,
            message: '가이드가 등록되었습니다.',
            guide: result.rows[0]
        });
    } catch (error) {
        console.error('❌ RAG 가이드 생성 오류:', error);
        res.status(500).json({
            success: false,
            message: '가이드 생성 중 오류가 발생했습니다: ' + error.message
        });
    }
});

// RAG 가이드 수정
app.put('/api/rag/guides', requireAuth, async (req, res) => {
    try {
        const { id, productName, content } = req.body;
        
        if (!id || !productName || !content) {
            return res.status(400).json({
                success: false,
                message: '필수 정보가 누락되었습니다.'
            });
        }
        
        // 카테고리 추출
        const categoryMatch = content.match(/카테고리:\s*(.+)/);
        const category = categoryMatch ? categoryMatch[1].trim() : '미분류';
        
        // 데이터베이스 업데이트
        await pool.query(`
            UPDATE product_guides
            SET product_name = $1, category = $2, content = $3, updated_at = NOW()
            WHERE id = $4
        `, [productName, category, content, id]);
        
        console.log(`✅ RAG 가이드 DB 업데이트 완료: ${productName}`);
        
        res.json({
            success: true,
            message: '가이드가 수정되었습니다.'
        });
    } catch (error) {
        console.error('❌ RAG 가이드 수정 오류:', error);
        res.status(500).json({
            success: false,
            message: '가이드 수정 중 오류가 발생했습니다: ' + error.message
        });
    }
});

// RAG 가이드 삭제
app.delete('/api/rag/guides/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        
        await pool.query(`
            DELETE FROM product_guides WHERE id = $1
        `, [id]);
        
        console.log(`✅ RAG 가이드 DB 삭제 완료: ID ${id}`);
        
        res.json({
            success: true,
            message: '가이드가 삭제되었습니다.'
        });
    } catch (error) {
        console.error('❌ RAG 가이드 삭제 오류:', error);
        res.status(500).json({
            success: false,
            message: '가이드 삭제 중 오류가 발생했습니다: ' + error.message
        });
    }
});

// 여행사 생성
app.post('/admin/agencies', requireAuth, async (req, res) => {
    try {
        // 프로덕션 진단 로그 (임시): 실제로 어떤 본문이 오는지 확인
        try {
            console.log('[POST /admin/agencies] content-type =', req.headers['content-type']);
            console.log('[POST /admin/agencies] raw body keys =', Object.keys(req.body || {}));
            console.log('[POST /admin/agencies] body preview =', {
                name: req.body?.name,
                code: req.body?.code,
                agency_code: req.body?.agency_code,
                show_banners_on_landing: req.body?.show_banners_on_landing
            });
        } catch (e) {
            console.warn('[POST /admin/agencies] log error:', e?.message);
        }

        const name = (req.body.name || '').trim();
        const code = (req.body.code || req.body.agency_code || '').trim();
        const discount_info = req.body.discount_info || '';
        const show_banners_on_landing = req.body.show_banners_on_landing;
        
        if (!name || !code) {
            return res.json({
                success: false,
                message: '여행사명과 코드는 필수입니다.'
            });
        }
        
        const agency = await dbHelpers.createAgency({
            name,
            code,
            discount_info,
            show_banners_on_landing: String(show_banners_on_landing) === 'true'
        });
        
        res.json({
            success: true,
            message: '파싱 완료',
            parsed_data: agency,
            parsing_method: 'createAgency'
        });
        
    } catch (error) {
        console.error('여행사 생성 오류:', error);
        // PostgreSQL unique 제약 위반 처리 (code 중복 등)
        if (error && (error.code === '23505' || /unique/i.test(String(error.message)))) {
            return res.json({ success: false, message: '이미 존재하는 코드입니다. 다른 코드를 사용하세요.' });
        }
        res.json({
            success: false,
            message: '여행사 추가 중 오류가 발생했습니다.'
        });
    }
});

// 여행사 수정
app.put('/admin/agencies/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const name = (req.body.name || '').trim();
        const code = (req.body.code || req.body.agency_code || '').trim();
        const discount_info = req.body.discount_info || '';
        const show_banners_on_landing = req.body.show_banners_on_landing;
        const contact_email = (req.body.contact_email || '').trim();
        const contact_phone = (req.body.contact_phone || '').trim();
        const logo_url = (req.body.logo_url || '').trim();
        
        console.log('여행사 수정 요청:', {
            id,
            name,
            code,
            discount_info,
            show_banners_on_landing,
            contact_email,
            contact_phone,
            logo_url,
            body: req.body
        });
        
        const agency = await dbHelpers.updateAgency(id, {
            name,
            code,
            discount_info,
            show_banners_on_landing: String(show_banners_on_landing) === 'true',
            contact_email,
            contact_phone,
            logo_url
        });
        
        console.log('수정 결과:', agency);
        
        if (!agency) {
            return res.json({
                success: false,
                message: '여행사를 찾을 수 없습니다.'
            });
        }
        
        res.json({
            success: true,
            message: '여행사 정보가 성공적으로 수정되었습니다.',
            agency: agency
        });
        
    } catch (error) {
        console.error('여행사 수정 오류:', error);
        console.error('오류 상세:', error.message);
        console.error('오류 스택:', error.stack);
        res.json({
            success: false,
            message: `여행사 수정 중 오류가 발생했습니다: ${error.message}`
        });
    }
});

// 여행사 순위 조정
app.post('/admin/agencies/:id/move', requireAuth, async (req, res) => {
    try {
        const agencyId = Number(req.params.id);
        const { direction } = req.body; // 'up' 또는 'down'
        
        if (!Number.isFinite(agencyId) || !['up', 'down'].includes(direction)) {
            return res.status(400).json({ success: false, message: '잘못된 요청입니다.' });
        }

        if (dbMode === 'postgresql') {
            // 현재 여행사의 sort_order 조회
            const currentResult = await pool.query('SELECT sort_order FROM agencies WHERE id = $1', [agencyId]);
            if (currentResult.rows.length === 0) {
                return res.status(404).json({ success: false, message: '여행사를 찾을 수 없습니다.' });
            }
            
            const currentOrder = currentResult.rows[0].sort_order || 999;
            let targetOrder;
            
            if (direction === 'up') {
                // 위로 이동: 현재보다 작은 sort_order 중 가장 큰 값 찾기
                const targetResult = await pool.query(
                    'SELECT id, sort_order FROM agencies WHERE sort_order < $1 ORDER BY sort_order DESC LIMIT 1',
                    [currentOrder]
                );
                if (targetResult.rows.length === 0) {
                    return res.json({ success: false, message: '이미 최상위입니다.' });
                }
                targetOrder = targetResult.rows[0].sort_order;
                const targetId = targetResult.rows[0].id;
                
                // 순서 교체
                await pool.query('UPDATE agencies SET sort_order = $1 WHERE id = $2', [targetOrder, agencyId]);
                await pool.query('UPDATE agencies SET sort_order = $1 WHERE id = $2', [currentOrder, targetId]);
                
            } else { // down
                // 아래로 이동: 현재보다 큰 sort_order 중 가장 작은 값 찾기
                const targetResult = await pool.query(
                    'SELECT id, sort_order FROM agencies WHERE sort_order > $1 ORDER BY sort_order ASC LIMIT 1',
                    [currentOrder]
                );
                if (targetResult.rows.length === 0) {
                    return res.json({ success: false, message: '이미 최하위입니다.' });
                }
                targetOrder = targetResult.rows[0].sort_order;
                const targetId = targetResult.rows[0].id;
                
                // 순서 교체
                await pool.query('UPDATE agencies SET sort_order = $1 WHERE id = $2', [targetOrder, agencyId]);
                await pool.query('UPDATE agencies SET sort_order = $1 WHERE id = $2', [currentOrder, targetId]);
            }
            
        } else {
            // JSON 모드 처리
            const agencies = await jsonDB.read('agencies') || [];
            const agencyIndex = agencies.findIndex(a => a.id === agencyId);
            
            if (agencyIndex === -1) {
                return res.status(404).json({ success: false, message: '여행사를 찾을 수 없습니다.' });
            }
            
            if (direction === 'up' && agencyIndex > 0) {
                // 위로 이동
                [agencies[agencyIndex], agencies[agencyIndex - 1]] = [agencies[agencyIndex - 1], agencies[agencyIndex]];
                await jsonDB.write('agencies', agencies);
            } else if (direction === 'down' && agencyIndex < agencies.length - 1) {
                // 아래로 이동
                [agencies[agencyIndex], agencies[agencyIndex + 1]] = [agencies[agencyIndex + 1], agencies[agencyIndex]];
                await jsonDB.write('agencies', agencies);
            } else {
                return res.json({ success: false, message: direction === 'up' ? '이미 최상위입니다.' : '이미 최하위입니다.' });
            }
        }
        
        res.json({ success: true, message: '순위가 변경되었습니다.' });
        
    } catch (error) {
        console.error('여행사 순위 조정 오류:', error);
        res.status(500).json({ success: false, message: '순위 조정 중 오류가 발생했습니다.' });
    }
});

// 사용자 관리 페이지
app.get('/admin/users', requireAuth, async (req, res) => {
    try {
        const users = await dbHelpers.getUsers();
        const currentPage = Number(req.query.page) || 1;
        const totalPages = 1; // 서버 페이징 미구현 상태의 기본값
        const search = req.query.search || '';
        const buildPageUrl = (p) => `/admin/users?page=${p}&search=${encodeURIComponent(search)}`;
        res.render('admin/users', {
            title: '사용자 관리',
            adminUsername: req.session.adminUsername || 'admin',
            search,
            totalUsers: Array.isArray(users) ? users.length : 0,
            currentPage,
            totalPages,
            buildPageUrl,
            users,
            success: null,
            error: null
        });
    } catch (error) {
        console.error('사용자 관리 페이지 오류:', error);
        const currentPage = Number(req.query.page) || 1;
        const totalPages = 1;
        const search = req.query.search || '';
        const buildPageUrl = (p) => `/admin/users?page=${p}&search=${encodeURIComponent(search)}`;
        res.render('admin/users', {
            title: '사용자 관리',
            adminUsername: req.session.adminUsername || 'admin',
            search,
            totalUsers: 0,
            currentPage,
            totalPages,
            buildPageUrl,
            users: [],
            success: null,
            error: '사용자 목록을 불러오지 못했습니다.'
        });
    }
});

// 이메일 마스킹 수동 실행 API (관리자용)
app.post('/admin/mask-emails', requireAuth, async (req, res) => {
    try {
        console.log('👤 관리자가 이메일 마스킹을 수동 실행:', req.session.adminUsername);
        const result = await maskExpiredEmails();
        
        return res.json({
            success: result.success,
            message: result.message,
            maskedCount: result.maskedCount || 0
        });
    } catch (error) {
        console.error('이메일 마스킹 API 오류:', error);
        return res.status(500).json({
            success: false,
            message: '이메일 마스킹 실행 중 오류가 발생했습니다.'
        });
    }
});

// 사용자(카드) 삭제 API
app.delete('/admin/users/:id', requireAuth, async (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        
        if (!userId || isNaN(userId)) {
            return res.status(400).json({ 
                success: false, 
                message: '유효하지 않은 사용자 ID입니다.' 
            });
        }
        
        if (dbMode === 'postgresql') {
            const client = await pool.connect();
            try {
                await client.query('BEGIN');
                
                // 사용자 정보 조회 (로깅용)
                const userResult = await client.query(
                    'SELECT id, name, email, token FROM users WHERE id = $1',
                    [userId]
                );
                
                if (userResult.rows.length === 0) {
                    await client.query('ROLLBACK');
                    return res.status(404).json({ 
                        success: false, 
                        message: '사용자를 찾을 수 없습니다.' 
                    });
                }
                
                const user = userResult.rows[0];
                const userName = user.name || '이름없음';
                console.log(`🗑️ 사용자 삭제 시도: ${userName} (${user.email}) [ID: ${user.id}]`);
                
                // 1. 발급 코드 참조 해제 (used_by_user_id를 NULL로)
                const issueCodesResult = await client.query(
                    'UPDATE issue_codes SET used_by_user_id = NULL WHERE used_by_user_id = $1',
                    [userId]
                );
                console.log(`  - 발급 코드 참조 해제: ${issueCodesResult.rowCount}개`);
                
                // 2. 사용 이력 삭제
                const usagesResult = await client.query(
                    'DELETE FROM usages WHERE token = $1',
                    [user.token]
                );
                console.log(`  - 사용 이력 삭제: ${usagesResult.rowCount}개`);
                
                // 3. 사용자 삭제
                const deleteResult = await client.query(
                    'DELETE FROM users WHERE id = $1',
                    [userId]
                );
                
                await client.query('COMMIT');
                console.log(`✅ 사용자 삭제 완료: ${userName} [ID: ${user.id}]`);
                
                return res.json({ 
                    success: true, 
                    message: '카드가 성공적으로 삭제되었습니다.',
                    deletedUsages: usagesResult.rowCount
                });
                
            } catch (error) {
                await client.query('ROLLBACK');
                throw error;
            } finally {
                client.release();
            }
        } else {
            // JSON 모드 (필요시 구현)
            return res.status(501).json({ 
                success: false, 
                message: 'JSON 모드에서는 삭제가 지원되지 않습니다.' 
            });
        }
        
    } catch (error) {
        console.error('❌ 사용자 삭제 오류:', error);
        console.error('오류 상세:', {
            message: error.message,
            code: error.code,
            detail: error.detail,
            constraint: error.constraint
        });
        
        let errorMessage = '카드 삭제 중 오류가 발생했습니다.';
        
        // 외래키 제약조건 오류 처리
        if (error.code === '23503') {
            errorMessage = '다른 데이터에서 참조 중이어서 삭제할 수 없습니다.';
        }
        
        return res.status(500).json({ 
            success: false, 
            message: errorMessage,
            detail: error.message,
            code: error.code
        });
    }
});

// 사용 이력 페이지
app.get('/admin/usages', requireAuth, async (req, res) => {
    try {
        const usages = await dbHelpers.getUsages();
        const storesData = await dbHelpers.getStores();
        const stores = Array.isArray(storesData)
            ? storesData.map(s => s.code || s.store_code || s.name).filter(Boolean)
            : [];
        const currentPage = Number(req.query.page) || 1;
        const totalPages = 1; // 서버 페이징 미구현 기본값
        const store_filter = req.query.store_filter || '';
        const date_from = req.query.date_from || '';
        const date_to = req.query.date_to || '';
        const sort_order = req.query.sort_order || 'desc';
        res.render('admin/usages', {
            title: '사용 이력',
            adminUsername: req.session.adminUsername || 'admin',
            usages,
            totalUsages: Array.isArray(usages) ? usages.length : 0,
            currentPage,
            totalPages,
            stores,
            store_filter,
            date_from,
            date_to,
            sort_order,
            formatDate,
            success: null,
            error: null
        });
    } catch (error) {
        console.error('사용 이력 페이지 오류:', error);
        const currentPage = Number(req.query.page) || 1;
        const totalPages = 1;
        const store_filter = req.query.store_filter || '';
        const date_from = req.query.date_from || '';
        const date_to = req.query.date_to || '';
        const sort_order = req.query.sort_order || 'desc';
        res.render('admin/usages', {
            title: '사용 이력',
            adminUsername: req.session.adminUsername || 'admin',
            usages: [],
            totalUsages: 0,
            currentPage,
            totalPages,
            stores: [],
            store_filter,
            date_from,
            date_to,
            sort_order,
            formatDate,
            success: null,
            error: '사용 이력을 불러오지 못했습니다.'
        });
    }
});

// 제휴업체(스토어) 관리 페이지
app.get('/admin/stores', requireAuth, async (req, res) => {
    try {
        const stores = await dbHelpers.getStores();
        console.log('🔍 관리자 제휴업체 조회 결과:', stores.length, '개');
        console.log('📋 제휴업체 샘플 데이터:', stores.slice(0, 2));
        res.render('admin/stores', {
            title: '제휴업체 관리',
            adminUsername: req.session.adminUsername || 'admin',
            currentPage: 'stores',
            stores,
            success: null,
            error: null
        });
    } catch (error) {
        console.error('제휴업체 관리 페이지 오류:', error);
        res.render('admin/stores', {
            title: '제휴업체 관리',
            adminUsername: req.session.adminUsername || 'admin',
            currentPage: 'stores',
            stores: [],
            success: null,
            error: '제휴업체 목록을 불러오지 못했습니다.'
        });
    }
});


// 제휴 신청서 관리 페이지
app.get('/admin/partner-applications', requireAuth, async (req, res) => {
    try {
        let applications = [];
        if (dbMode === 'postgresql') {
            const result = await pool.query('SELECT * FROM partner_applications ORDER BY created_at DESC');
            applications = result.rows;
        } else {
            applications = await jsonDB.findAll('partner_applications');
        }
        res.render('admin/partner-applications', {
            title: '제휴 신청서',
            adminUsername: req.session.adminUsername || 'admin',
            applications,
            success: null,
            error: null
        });
    } catch (error) {
        console.error('제휴 신청서 페이지 오류:', error);
        res.render('admin/partner-applications', {
            title: '제휴 신청서',
            adminUsername: req.session.adminUsername || 'admin',
            applications: [],
            success: null,
            error: '신청서 목록을 불러오지 못했습니다.'
        });
    }
});

// 제휴 신청서 개별 삭제 라우트
app.delete('/admin/partner-applications/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        
        if (dbMode === 'postgresql') {
            const result = await pool.query('DELETE FROM partner_applications WHERE id = $1 RETURNING *', [id]);
            if (result.rows.length === 0) {
                return res.json({
                    success: false,
                    message: '신청서를 찾을 수 없습니다.'
                });
            }
        } else {
            const deleted = await jsonDB.delete('partner_applications', id);
            if (!deleted) {
                return res.json({
                    success: false,
                    message: '신청서를 찾을 수 없습니다.'
                });
            }
        }
        
        res.json({
            success: true,
            message: '제휴 신청서가 삭제되었습니다.'
        });
    } catch (error) {
        console.error('제휴 신청서 삭제 오류:', error);
        res.json({
            success: false,
            message: '제휴 신청서 삭제 중 오류가 발생했습니다.'
        });
    }
});

// 제휴 신청서 전체 삭제 라우트
app.delete('/admin/partner-applications/clear-all', requireAuth, async (req, res) => {
    try {
        if (dbMode === 'postgresql') {
            await pool.query('DELETE FROM partner_applications');
        } else {
            await jsonDB.deleteAll('partner_applications');
        }
        
        res.json({
            success: true,
            message: '모든 제휴 신청서가 삭제되었습니다.'
        });
    } catch (error) {
        console.error('제휴 신청서 전체 삭제 오류:', error);
        res.json({
            success: false,
            message: '제휴 신청서 삭제 중 오류가 발생했습니다.'
        });
    }
});

// 여행사 개별 조회 라우트 추가 (수정 모달용)
app.get('/admin/agencies/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const agency = await dbHelpers.getAgencyById(id);
        
        if (!agency) {
            return res.json({
                success: false,
                message: '여행사를 찾을 수 없습니다.'
            });
        }
        
        res.json({
            success: true,
            agency: agency
        });
        
    } catch (error) {
        console.error('여행사 조회 오류:', error);
        res.json({
            success: false,
            message: '여행사 조회 중 오류가 발생했습니다.'
        });
    }
});

// 여행사 삭제 라우트 추가
app.delete('/admin/agencies/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        console.log(`여행사 삭제 요청: ID ${id}`);
        
        const result = await dbHelpers.deleteAgency(id);
        
        if (result.hasUsers) {
            return res.json({
                success: false,
                hasUsers: true,
                message: result.message
            });
        }
        
        if (result.success) {
            res.json({
                success: true,
                message: '여행사가 성공적으로 삭제되었습니다.'
            });
        } else {
            res.json({
                success: false,
                message: '여행사 삭제에 실패했습니다.'
            });
        }
        
    } catch (error) {
        console.error('여행사 삭제 오류:', error);
        res.json({
            success: false,
            message: '여행사 삭제 중 오류가 발생했습니다.'
        });
    }
});

// 여행사 강제 삭제 라우트 추가
app.delete('/admin/agencies/:id/force', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        console.log(`여행사 강제 삭제 요청: ID ${id}`);
        
        const result = await dbHelpers.forceDeleteAgency(id);
        
        if (result.success) {
            res.json({
                success: true,
                message: '여행사와 관련된 모든 데이터가 삭제되었습니다.'
            });
        } else {
            res.json({
                success: false,
                message: '여행사 강제 삭제에 실패했습니다.'
            });
        }
        
    } catch (error) {
        console.error('여행사 강제 삭제 오류:', error);
        res.json({
            success: false,
            message: '여행사 강제 삭제 중 오류가 발생했습니다.'
        });
    }
});




// 광고배너 개별 조회 라우트 추가 (수정 모달용)
app.get('/admin/banners/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        
        if (dbMode === 'postgresql') {
            const result = await pool.query('SELECT * FROM banners WHERE id = $1', [id]);
            const banner = result.rows[0];
            
            if (!banner) {
                return res.json({
                    success: false,
                    message: '광고배너를 찾을 수 없습니다.'
                });
            }
            
            res.json({
                success: true,
                banner: banner
            });
        } else {
            const banner = await jsonDB.findById('banners', id);
            if (!banner) {
                return res.json({
                    success: false,
                    message: '광고배너를 찾을 수 없습니다.'
                });
            }
            
            res.json({
                success: true,
                banner: banner
            });
        }
        
    } catch (error) {
        console.error('광고배너 조회 오류:', error);
        res.json({
            success: false,
            message: '광고배너 조회 중 오류가 발생했습니다.'
        });
    }
});

// 광고배너 수정 라우트 추가
app.put('/admin/banners/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const bannerData = req.body;
        
        const banner = await dbHelpers.updateBanner(id, bannerData);
        
        if (!banner) {
            return res.json({
                success: false,
                message: '광고배너를 찾을 수 없습니다.'
            });
        }
        
        res.json({
            success: true,
            message: '광고배너가 성공적으로 수정되었습니다.',
            banner: banner
        });
        
    } catch (error) {
        console.error('광고배너 수정 오류:', error);
        res.json({
            success: false,
            message: '광고배너 수정 중 오류가 발생했습니다.'
        });
    }
});

// 광고배너 삭제 라우트 추가
app.delete('/admin/banners/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        
        const banner = await dbHelpers.deleteBanner(id);
        
        if (!banner) {
            return res.json({
                success: false,
                message: '광고배너를 찾을 수 없습니다.'
            });
        }
        
        res.json({
            success: true,
            message: '광고배너가 성공적으로 삭제되었습니다.'
        });
        
    } catch (error) {
        console.error('광고배너 삭제 오류:', error);
        res.json({
            success: false,
            message: '광고배너 삭제 중 오류가 발생했습니다.'
        });
    }
});

// 중복된 initializeDatabase 함수 제거됨 - 위의 올바른 마이그레이션 로직이 있는 함수 사용

// ==================== 예약 데이터 파싱 함수 ====================


// OpenAI API를 사용한 지능형 파싱 함수
async function parseReservationToJSON(text) {
    // OpenAI 파싱 사용
    const { parseBooking } = require('./utils/aiParser');
    
    try {
        console.log('🤖 OpenAI 파싱 시작...');
        const result = await parseBooking(text);
        console.log('✅ OpenAI 파싱 완료');
        return result;
    } catch (error) {
        console.error('❌ OpenAI 파싱 실패, 로컬 파싱으로 폴백:', error.message);
        return parseReservationToJSONLocal(text);
    }
}

// 기존 로컬 파싱 함수 (폴백용)
function parseReservationToJSONLocal(text) {
    console.log('🤖 AI 수준 파싱 시작...');
    
    // 더 지능적인 파싱을 위한 정규식 및 패턴 매칭
    const lines = text.split('\n').map(line => line.trim()).filter(line => line);
    const fullText = text.toLowerCase();
    
    // 기본 데이터 구조 (단일 테이블 구조에 맞게)
    const data = {
        reservation_number: null,
        channel: '웹',
        platform_name: 'NOL',
        product_name: null,
        korean_name: null,
        english_first_name: null,
        english_last_name: null,
        phone: null,
        email: null,
        kakao_id: null,
        usage_date: null,
        usage_time: null,
        guest_count: 1,
        people_adult: 1,
        people_child: 0,
        people_infant: 0,
        package_type: null,
        total_amount: null,
        adult_unit_price: null,
        child_unit_price: null,
        payment_status: '대기',
        code_issued: false,
        memo: null
    };
    
    // 플랫폼 자동 감지 (확장된 패턴)
    if (fullText.includes('nol') || fullText.includes('인터파크') || fullText.includes('interpark')) {
        data.platform_name = 'NOL';
    } else if (fullText.includes('klook') || fullText.includes('클룩')) {
        data.platform_name = 'KLOOK';
    } else if (fullText.includes('viator') || fullText.includes('비에이터')) {
        data.platform_name = 'VIATOR';
    } else if (fullText.includes('getyourguide') || fullText.includes('겟유어가이드')) {
        data.platform_name = 'GETYOURGUIDE';
    } else if (fullText.includes('expedia') || fullText.includes('익스피디아')) {
        data.platform_name = 'EXPEDIA';
    } else if (fullText.includes('agoda') || fullText.includes('아고다')) {
        data.platform_name = 'AGODA';
    } else if (fullText.includes('booking.com') || fullText.includes('부킹닷컴')) {
        data.platform_name = 'BOOKING';
    } else if (fullText.includes('트립어드바이저') || fullText.includes('tripadvisor')) {
        data.platform_name = 'TRIPADVISOR';
    }

    console.log(`🔍 감지된 플랫폼: ${data.platform_name}`);

    // NOL 인터파크 특화 패턴 매칭
    if (data.platform_name === 'NOL') {
        console.log('🎯 NOL 인터파크 특화 파싱 모드 활성화');

        // NOL 특화 예약번호 패턴 (강화)
        const nolReservationPatterns = [
            /예약번호[\s:：]*([A-Z0-9\-]{8,})/i,
            /주문번호[\s:：]*([A-Z0-9\-]{8,})/i,
            /확인번호[\s:：]*([A-Z0-9\-]{8,})/i,
            /바우처번호[\s:：]*([A-Z0-9\-]{8,})/i,
            /티켓번호[\s:：]*([A-Z0-9\-]{8,})/i,
            /NOL[\s\-]?(\d{8,})/i,
            /([A-Z]{2}\d{8,})/,
            /IP[\-]?(\d{8,})/i,
            /(\d{10,})/
        ];

        for (const pattern of nolReservationPatterns) {
            const match = text.match(pattern);
            if (match && !data.reservation_number) {
                data.reservation_number = match[1];
                console.log(`✅ NOL 예약번호 발견: ${data.reservation_number}`);
                break;
            }
        }

        // NOL 특화 상품명 패턴 (강화)
        const nolProductPatterns = [
            /상품명[\s:：]*(.+?)(?:\n|$)/i,
            /투어명[\s:：]*(.+?)(?:\n|$)/i,
            /액티비티명[\s:：]*(.+?)(?:\n|$)/i,
            /체험명[\s:：]*(.+?)(?:\n|$)/i,
            /\[NOL\]\s*(.+?)(?:\n|$)/i,
            /\[인터파크\]\s*(.+?)(?:\n|$)/i,
            /괌\s*(.+?(?:투어|tour|체험|액티비티))/i,
            /사이판\s*(.+?(?:투어|tour|체험|액티비티))/i,
            /(.+?(?:투어|tour|티켓|ticket|입장권|체험|액티비티|패키지).+)/i
        ];

        for (const pattern of nolProductPatterns) {
            const match = text.match(pattern);
            if (match && !data.product_name) {
                data.product_name = match[1].trim();
                console.log(`✅ NOL 상품명 발견: ${data.product_name}`);
                break;
            }
        }

        // NOL 특화 시간 패턴 추가
        const nolTimePatterns = [
            /시간[\s:：]*(\d{1,2})[:\：](\d{2})/i,
            /출발시간[\s:：]*(\d{1,2})[:\：](\d{2})/i,
            /픽업시간[\s:：]*(\d{1,2})[:\：](\d{2})/i,
            /체크인시간[\s:：]*(\d{1,2})[:\：](\d{2})/i,
            /만날시간[\s:：]*(\d{1,2})[:\：](\d{2})/i,
            /(\d{1,2})[:\：](\d{2})\s*(?:AM|PM|am|pm)/i,
            /(\d{1,2})시\s*(\d{1,2})?분?/i
        ];

        for (const pattern of nolTimePatterns) {
            const match = text.match(pattern);
            if (match && !data.usage_time) {
                let hour = parseInt(match[1]);
                const minute = match[2] || '00';
                
                // AM/PM 처리
                if (match[0].toLowerCase().includes('pm') && hour !== 12) {
                    hour += 12;
                } else if (match[0].toLowerCase().includes('am') && hour === 12) {
                    hour = 0;
                }
                
                data.usage_time = `${hour.toString().padStart(2, '0')}:${minute.padStart(2, '0')}`;
                console.log(`✅ NOL 이용시간 발견: ${data.usage_time}`);
                break;
            }
        }

        // NOL 특화 카카오톡 ID 패턴
        const nolKakaoPatterns = [
            /카카오[\s:：]*([a-zA-Z0-9_-]+)/i,
            /카톡[\s:：]*([a-zA-Z0-9_-]+)/i,
            /kakao[\s:：]*([a-zA-Z0-9_-]+)/i,
            /카카오톡ID[\s:：]*([a-zA-Z0-9_-]+)/i
        ];

        for (const pattern of nolKakaoPatterns) {
            const match = text.match(pattern);
            if (match && !data.kakao_id) {
                data.kakao_id = match[1];
                console.log(`✅ NOL 카카오톡 ID 발견: ${data.kakao_id}`);
                break;
            }
        }

        // NOL 특화 날짜 패턴 (한국 형식)
        const nolDatePatterns = [
            /이용일[\s:：]*(\d{4})년?\s*(\d{1,2})월\s*(\d{1,2})일/i,
            /방문일[\s:：]*(\d{4})년?\s*(\d{1,2})월\s*(\d{1,2})일/i,
            /체크인[\s:：]*(\d{4})년?\s*(\d{1,2})월\s*(\d{1,2})일/i,
            /(\d{4})\-(\d{1,2})\-(\d{1,2})/,
            /(\d{1,2})\/(\d{1,2})\/(\d{4})/
        ];

        for (const pattern of nolDatePatterns) {
            const match = text.match(pattern);
            if (match && !data.usage_date) {
                let year, month, day;
                if (pattern.toString().includes('년')) {
                    [, year, month, day] = match;
                } else if (pattern.toString().includes('\\d{4}')) {
                    [, year, month, day] = match;
                } else {
                    [, month, day, year] = match;
                }

                if (year && month && day) {
                    data.usage_date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
                    console.log(`✅ NOL 이용일 발견: ${data.usage_date}`);
                }
                break;
            }
        }

        // NOL 특화 금액 패턴 (원화 → 달러 환산)
        const nolPricePatterns = [
            /총\s*금액[\s:：]*(\d{1,3}(?:,\d{3})*)\s*원/i,
            /결제\s*금액[\s:：]*(\d{1,3}(?:,\d{3})*)\s*원/i,
            /(\d{1,3}(?:,\d{3})*)\s*원/,
            /\$\s*(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/,
            /(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s*달러/
        ];

        for (const pattern of nolPricePatterns) {
            const match = text.match(pattern);
            if (match && !data.total_amount) {
                let price = parseFloat(match[1].replace(/,/g, ''));
                // 원화인 경우 달러로 환산 (1300원 = 1달러 기준)
                if (match[0].includes('원')) {
                    price = Math.round(price / 1300 * 100) / 100;
                    console.log(`💱 원화 → 달러 환산: ${match[1]}원 → $${price}`);
                }
                data.total_amount = price;
                break;
            }
        }

        // NOL 특화 인원수 패턴 (개선된 로직)
        const nolPeoplePatterns = [
            { pattern: /성인\s*(\d+)\s*명/gi, type: 'adult' },
            { pattern: /어른\s*(\d+)\s*명/gi, type: 'adult' },
            { pattern: /대인\s*(\d+)\s*명/gi, type: 'adult' },
            { pattern: /소아\s*(\d+)\s*명/gi, type: 'child' },
            { pattern: /어린이\s*(\d+)\s*명/gi, type: 'child' },
            { pattern: /유아\s*(\d+)\s*명/gi, type: 'infant' },
            { pattern: /총\s*(\d+)\s*명/gi, type: 'total' }
        ];
        
        for (const { pattern, type } of nolPeoplePatterns) {
            const matches = [...text.matchAll(pattern)];
            for (const match of matches) {
                const count = parseInt(match[1]);
                if (type === 'adult') {
                    data.people_adult = count;
                    console.log(`👥 NOL 성인 인원수 발견: ${count}명`);
                } else if (type === 'child') {
                    data.people_child = count;
                    console.log(`👥 NOL 소아 인원수 발견: ${count}명`);
                } else if (type === 'infant') {
                    data.people_infant = count;
                    console.log(`👥 NOL 유아 인원수 발견: ${count}명`);
                } else if (type === 'total' && data.people_adult === 1 && data.people_child === 0) {
                    data.people_adult = count;
                    console.log(`👥 NOL 총 인원수 발견: ${count}명 (성인으로 설정)`);
                }
            }
        }
    }

    // 라인별 파싱 (일반 패턴)
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const lowerLine = line.toLowerCase();
        const nextLine = i + 1 < lines.length ? lines[i + 1] : null;

        console.log(`📝 파싱 중: ${line}`);

        // 예약번호 (일반 패턴)
        if (!data.reservation_number) {
            const reservationPatterns = [
                /(?:예약번호|reservation|booking|order)[\s:：#]*([A-Z0-9\-]{6,})/i,
                /([A-Z]{2,}\d{6,})/,
                /(\d{10,})/,
                /([A-Z0-9]{8,})/
            ];

            for (const pattern of reservationPatterns) {
                const match = line.match(pattern);
                if (match) {
                    data.reservation_number = match[1];
                    break;
                }
            }
        }

        // 상품명 (일반 패턴)
        if (!data.product_name && (lowerLine.includes('상품') || lowerLine.includes('투어') || 
            lowerLine.includes('tour') || lowerLine.includes('activity') || lowerLine.includes('티켓'))) {
            const productPatterns = [
                /(?:상품명|투어명|상품|tour|activity)[\s:：]*(.+)/i,
                /(.+(?:투어|tour|티켓|ticket|입장권).+)/i
            ];

            for (const pattern of productPatterns) {
                const match = line.match(pattern);
                if (match) {
                    data.product_name = match[1].trim();
                    break;
                }
            }
        }

        // 한글 이름 (개선된 패턴)
        if (!data.korean_name) {
            // 명시적 한글명 패턴 - 콜론 뒤의 이름 추출
            if (lowerLine.includes('한글') || lowerLine.includes('이름') || lowerLine.includes('성명')) {
                const namePatterns = [
                    /(?:한글명|이름|성명)[\s:：]+([가-힣]{2,})/,
                    /한글[\s:：]+([가-힣]{2,})/
                ];
                
                for (const pattern of namePatterns) {
                    const match = line.match(pattern);
                    if (match && match[1] !== '한글명' && match[1] !== '이름' && match[1] !== '성명') {
                        data.korean_name = match[1];
                        console.log(`✅ 한글 이름 발견: ${data.korean_name}`);
                        break;
                    }
                }
            }
            // 단독 한글 이름 패턴 (라인에 한글 이름만 있는 경우)
            else {
                const koreanNameMatch = line.match(/^([가-힣]{2,4})$/);
                if (koreanNameMatch) {
                    data.korean_name = koreanNameMatch[1];
                    console.log(`✅ 단독 한글 이름 발견: ${data.korean_name}`);
                }
            }
        }

        // 영문 이름
        if ((!data.english_first_name || !data.english_last_name) && 
            (lowerLine.includes('영문') || lowerLine.includes('english'))) {
            const parts = line.split(/[:：]/);
            if (parts.length > 1) {
                const englishName = parts[1].trim();
                const nameParts = englishName.split(/\s+/);
                if (nameParts.length >= 2) {
                    data.english_first_name = nameParts[0];
                    data.english_last_name = nameParts.slice(1).join(' ');
                }
            }
        }

        // 이메일
        if (!data.email) {
            const emailMatch = line.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
            if (emailMatch) {
                data.email = emailMatch[1];
            }
        }

        // 전화번호 (개선된 패턴)
        if (!data.phone) {
            // 명시적 전화번호 패턴
            if (lowerLine.includes('전화') || lowerLine.includes('phone') || lowerLine.includes('mobile')) {
                const phonePatterns = [
                    /(\+\d{1,3}[-\s]?\d{1,4}[-\s]?\d{1,4}[-\s]?\d{1,9})/,
                    /(010[-\s]?\d{4}[-\s]?\d{4})/,
                    /(\d{2,3}[-\s]?\d{3,4}[-\s]?\d{4})/
                ];
                
                for (const pattern of phonePatterns) {
                    const match = line.match(pattern);
                    if (match) {
                        data.phone = match[1].replace(/\s/g, '');
                        break;
                    }
                }
            }
            // 단독 전화번호 패턴 (라인에 전화번호만 있는 경우)
            else {
                const phonePatterns = [
                    /^(\+\d{1,3}[-\s]?\d{1,4}[-\s]?\d{1,4}[-\s]?\d{1,9})$/,
                    /^(010[-\s]?\d{4}[-\s]?\d{4})$/,
                    /^(\d{2,3}[-\s]?\d{3,4}[-\s]?\d{4})$/
                ];
                
                for (const pattern of phonePatterns) {
                    const match = line.match(pattern);
                    if (match) {
                        data.phone = match[1].replace(/\s/g, '');
                        console.log(`✅ 단독 전화번호 발견: ${data.phone}`);
                        break;
                    }
                }
            }
        }

        // 카카오톡 아이디 (개선된 패턴)
        if (!data.kakao_id && lowerLine.includes('카카오톡 아이디')) {
            const parts = line.split(/[:：]/);
            if (parts.length > 1 && parts[1].trim().length > 0) {
                data.kakao_id = parts[1].trim();
            } else if (nextLine && nextLine.trim().length > 0 && !nextLine.includes(':')) {
                data.kakao_id = nextLine.trim();
            }
        }
    }
    
    // 데이터 후처리 및 검증
    console.log('🔍 파싱된 데이터 검증 중...');
    
    // 필수 데이터 검증 및 기본값 설정
    if (!data.reservation_number) {
        console.log('⚠️ 예약번호가 없습니다. 임시 번호를 생성합니다.');
        data.reservation_number = 'TEMP_' + Date.now();
    }
    
    if (!data.korean_name) {
        console.log('⚠️ 한글 이름이 없습니다.');
    }
    
    if (!data.english_first_name || !data.english_last_name) {
        console.log('⚠️ 영문 이름이 불완전합니다.');
    }
    
    if (!data.product_name) {
        console.log('⚠️ 상품명이 없습니다.');
        data.product_name = '상품명 미확인';
    }
    
    if (!data.usage_date) {
        console.log('⚠️ 이용일이 없습니다.');
    }
    
    if (!data.total_amount) {
        console.log('⚠️ 총 금액이 없습니다.');
    }
    
    // 전화번호 정리
    if (data.phone) {
        data.phone = data.phone.replace(/[^\d\+\-]/g, '');
    }
    
    // 총 인원수 계산
    data.guest_count = data.people_adult + data.people_child + data.people_infant;
    
    // 단가 계산 (총 금액을 성인 수로 나눔)
    if (data.total_amount && data.people_adult > 0) {
        data.adult_unit_price = Math.round(data.total_amount / data.people_adult);
    }
    
    // 파싱 품질 점수 계산
    let qualityScore = 0;
    const scoreWeights = {
        reservation_number: 25,
        korean_name: 20,
        product_name: 15,
        usage_date: 15,
        phone: 10,
        email: 10,
        total_amount: 5
    };
    
    for (const [field, weight] of Object.entries(scoreWeights)) {
        if (data[field]) qualityScore += weight;
    }
    
    data.parsing_quality = qualityScore;
    data.parsing_confidence = qualityScore >= 70 ? 'high' : qualityScore >= 40 ? 'medium' : 'low';
    
    console.log('🎯 파싱 완료:', {
        reservation_number: data.reservation_number,
        platform_name: data.platform_name,
        product_name: data.product_name,
        korean_name: data.korean_name,
        english_name: `${data.english_first_name || ''} ${data.english_last_name || ''}`.trim(),
        guest_count: data.guest_count,
        usage_date: data.usage_date,
        usage_time: data.usage_time,
        total_amount: data.total_amount,
        parsing_quality: `${qualityScore}% (${data.parsing_confidence})`,
        kakao_id: data.kakao_id
    });
    
    return data;
}

// ==================== 6개 테이블 CRUD 함수 ====================

// 6개 테이블에 예약 데이터 저장
async function saveReservationToSixTables(parsedData) {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // 1. reservations 테이블에 기본 정보 저장
        const reservationResult = await client.query(`
            INSERT INTO reservations (
                reservation_code, reservation_channel, platform_name, 
                reservation_status, product_name, total_quantity, total_price
            ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            RETURNING reservation_id
        `, [
            parsedData.reservation_code,
            parsedData.reservation_channel || '웹',
            parsedData.platform_name || 'OTHER',
            '접수',
            parsedData.product_name,
            parsedData.total_quantity || 1,
            parsedData.total_price
        ]);
        
        const reservationId = reservationResult.rows[0].reservation_id;
        
        // 일정 정보는 이미 reservations 테이블에 저장됨 (usage_date, usage_time, package_type)
        
        // 3. reservation_customers 테이블에 고객 정보 저장
        await client.query(`
            INSERT INTO reservation_customers (
                reservation_id, name_kr, name_en_first, name_en_last, 
                phone, email, kakao_id, people_adult, people_child, people_infant, memo
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        `, [
            reservationId,
            parsedData.name_kr,
            parsedData.name_en_first,
            parsedData.name_en_last,
            parsedData.phone,
            parsedData.email,
            parsedData.kakao_id,
            parsedData.people_adult || 0,
            parsedData.people_child || 0,
            parsedData.people_infant || 0,
            parsedData.memo
        ]);
        
        // 4. reservation_payments 테이블에 결제 정보 저장
        await client.query(`
            INSERT INTO reservation_payments (
                reservation_id, adult_unit_price, child_unit_price, infant_unit_price,
                adult_count, child_count, infant_count, platform_sale_amount, 
                platform_settlement_amount, payment_status
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `, [
            reservationId,
            parsedData.adult_unit_price || 0,
            parsedData.child_unit_price || 0,
            parsedData.infant_unit_price || 0,
            parsedData.people_adult || 0,
            parsedData.people_child || 0,
            parsedData.people_infant || 0,
            parsedData.platform_sale_amount || parsedData.total_price,
            parsedData.platform_settlement_amount || parsedData.total_price,
            '대기'
        ]);
        
        // 5. cancellation_policies 테이블에 취소 정책 저장
        if (parsedData.policy_text) {
            await client.query(`
                INSERT INTO cancellation_policies (reservation_id, policy_text)
                VALUES ($1, $2)
            `, [reservationId, parsedData.policy_text]);
        }
        
        // 6. reservation_logs 테이블에 생성 로그 저장
        await client.query(`
            INSERT INTO reservation_logs (
                reservation_id, action, changed_by, old_data, new_data
            ) VALUES ($1, $2, $3, $4, $5)
        `, [
            reservationId,
            'CREATE',
            'AI_PARSING',
            null,
            JSON.stringify(parsedData)
        ]);
        
        await client.query('COMMIT');
        
        return {
            success: true,
            reservation_id: reservationId,
            message: '예약이 성공적으로 저장되었습니다.'
        };
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('6개 테이블 저장 오류:', error);
        throw error;
    } finally {
        client.release();
    }
}

// 예약 상세 조회 (단일 reservations 테이블)
async function getReservationById(reservationId) {
    try {
        const result = await pool.query(`
            SELECT * FROM reservations WHERE id = $1
        `, [reservationId]);
        
        return result.rows[0] || null;
    } catch (error) {
        console.error('예약 조회 오류:', error);
        throw error;
    }
}

// 예약 수정 (6개 테이블 업데이트)
async function updateReservationInSixTables(reservationId, updateData) {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // 기존 데이터 조회 (로그용)
        const oldData = await getReservationById(reservationId);
        
        // 1. reservations 테이블 업데이트
        await client.query(`
            UPDATE reservations SET
                reservation_code = $2,
                platform_name = $3,
                product_name = $4,
                total_price = $5,
                updated_at = CURRENT_TIMESTAMP
            WHERE reservation_id = $1
        `, [
            reservationId,
            updateData.reservation_code,
            updateData.platform_name,
            updateData.product_name,
            updateData.total_price
        ]);
        
        // 일정 정보는 이미 reservations 테이블에서 업데이트됨
        
        // 3. reservation_customers 테이블 업데이트
        await client.query(`
            UPDATE reservation_customers SET
                name_kr = $2,
                name_en_first = $3,
                name_en_last = $4,
                phone = $5,
                email = $6,
                people_adult = $7,
                people_child = $8,
                people_infant = $9,
                memo = $10
            WHERE reservation_id = $1
        `, [
            reservationId,
            updateData.name_kr,
            updateData.name_en_first,
            updateData.name_en_last,
            updateData.phone,
            updateData.email,
            updateData.people_adult || 0,
            updateData.people_child || 0,
            updateData.people_infant || 0,
            updateData.memo
        ]);
        
        // 4. reservation_payments 테이블 업데이트
        await client.query(`
            UPDATE reservation_payments SET
                platform_sale_amount = $2,
                platform_settlement_amount = $3
            WHERE reservation_id = $1
        `, [
            reservationId,
            updateData.total_price,
            updateData.total_price
        ]);
        
        // 5. reservation_logs 테이블에 수정 로그 저장
        await client.query(`
            INSERT INTO reservation_logs (
                reservation_id, action, changed_by, old_data, new_data
            ) VALUES ($1, $2, $3, $4, $5)
        `, [
            reservationId,
            'UPDATE',
            'ADMIN',
            JSON.stringify(oldData),
            JSON.stringify(updateData)
        ]);
        
        await client.query('COMMIT');
        
        return {
            success: true,
            message: '예약이 성공적으로 수정되었습니다.'
        };
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('예약 수정 오류:', error);
        throw error;
    } finally {
        client.release();
    }
}

// 예약 삭제 (6개 테이블에서 삭제)
async function deleteReservationFromSixTables(reservationId) {
    const client = await pool.connect();
    
    try {
        await client.query('BEGIN');
        
        // 기존 데이터 조회 (로그용)
        const oldData = await getReservationById(reservationId);
        
        // reservation_logs에 삭제 로그 저장
        await client.query(`
            INSERT INTO reservation_logs (
                reservation_id, action, changed_by, old_data, new_data
            ) VALUES ($1, $2, $3, $4, $5)
        `, [
            reservationId,
            'DELETE',
            'ADMIN',
            JSON.stringify(oldData),
            null
        ]);
        
        // CASCADE 옵션으로 인해 reservations 테이블만 삭제하면 연관 테이블도 자동 삭제됨
        const result = await client.query(`
            DELETE FROM reservations WHERE reservation_id = $1
        `, [reservationId]);
        
        await client.query('COMMIT');
        
        return {
            success: true,
            message: '예약이 성공적으로 삭제되었습니다.',
            deleted_count: result.rowCount
        };
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('예약 삭제 오류:', error);
        throw error;
    } finally {
        client.release();
    }
}

// 기존 파싱 함수 (백업용)
function parseReservationTextAdvanced(text) {
    const parsedData = parseReservationText(text);
    
    // 영문명을 first_name과 last_name으로 분리
    const englishNameParts = (parsedData.english_name || '').split(' ');
    const englishFirstName = englishNameParts[0] || '';
    const englishLastName = englishNameParts.slice(1).join(' ') || '';
    
    // JSON 스키마 형태로 변환 (새로운 6개 테이블 구조)
    const jsonSchema = {
        action: "INSERT", // INSERT, UPDATE, DELETE
        
        // 1. reservations (예약 기본)
        reservation: {
            reservation_code: parsedData.reservation_number || null,
            reservation_channel: parsedData.booking_channel || "웹",
            platform_name: parsedData.company || "기타",
            reservation_status: "접수",
            reservation_datetime: parsedData.reservation_datetime || null,
            product_name: parsedData.product_name || null,
            total_quantity: parsedData.guest_count || 1,
            total_price: parsedData.amount || null
        },
        
        // 2. reservation_schedules (이용 일정)
        schedule: {
            usage_date: parsedData.usage_date || null,
            usage_time: parsedData.usage_time || null,
            package_type: parsedData.package_type || "기본",
            package_count: parsedData.guest_count || 1
        },
        
        // 3. reservation_customers (예약자 및 고객 정보)
        customer: {
            name_kr: parsedData.korean_name || null,
            name_en_first: englishFirstName || null,
            name_en_last: englishLastName || null,
            phone: parsedData.phone || null,
            email: parsedData.email || null,
            kakao_id: parsedData.kakao_id || null,
            people_adult: parsedData.adult_count || parsedData.guest_count || 1,
            people_child: parsedData.child_count || 0,
            people_infant: parsedData.infant_count || 0,
            memo: parsedData.memo || null
        },
        
        // 4. reservation_payments (결제 내역)
        payment: {
            adult_unit_price: parsedData.adult_unit_price || null,
            child_unit_price: parsedData.child_unit_price || null,
            infant_unit_price: parsedData.infant_unit_price || null,
            adult_count: parsedData.adult_count || parsedData.guest_count || 1,
            child_count: parsedData.child_count || 0,
            infant_count: parsedData.infant_count || 0,
            platform_sale_amount: parsedData.amount || null,
            platform_settlement_amount: parsedData.settlement_amount || parsedData.amount || null,
            payment_status: "대기",
            payment_date: null
        },
        
        // 5. cancellation_policies (취소/환불 규정)
        cancellation_policy: {
            policy_text: parsedData.cancellation_policy || null
        },
        
        // 6. reservation_logs (예약 변경 이력)
        log: {
            action: "등록",
            changed_by: "관리자",
            old_data: null,
            new_data: parsedData
        },
        
        // 메타 정보
        metadata: {
            created_at: new Date().toISOString(),
            parsed_fields: Object.keys(parsedData).filter(key => parsedData[key] !== null && parsedData[key] !== undefined),
            total_parsed_fields: Object.keys(parsedData).filter(key => parsedData[key] !== null && parsedData[key] !== undefined).length
        }
    };
    
    return jsonSchema;
}

// AI 수준의 지능형 예약 데이터 파싱 함수 (기존 함수 유지)

function parseReservationText(text) {
    const data = {};
    
    // 텍스트 정규화 및 전처리
    const normalizedText = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = normalizedText.split('\n').map(line => line.trim()).filter(line => line);
    const fullText = lines.join(' ');
    
    console.log('파싱 시작 - 입력 텍스트:', text.substring(0, 200) + '...');
    
    // 업체 구분 자동 감지 (더 정확한 패턴)
    const upperText = text.toUpperCase();
    if (upperText.includes('NOL') || upperText.includes('엔오엘') || upperText.includes('N.O.L')) {
        data.company = 'NOL';
    } else if (upperText.includes('KLOOK') || upperText.includes('클룩')) {
        data.company = 'KLOOK';
    } else if (upperText.includes('VIATOR') || upperText.includes('비아토르')) {
        data.company = 'VIATOR';
    } else if (upperText.includes('GETYOURGUIDE') || upperText.includes('겟유어가이드')) {
        data.company = 'GETYOURGUIDE';
    } else if (upperText.includes('EXPEDIA') || upperText.includes('익스피디아')) {
        data.company = 'EXPEDIA';
    } else {
        data.company = 'NOL'; // 기본값
    }
    
    // AI 수준의 지능형 파싱
    
    // 1. 예약번호 - 다양한 패턴 지원
    const reservationPatterns = [
        /(?:예약번호|reservation|booking|ref|reference)[\s:：]*([A-Z0-9]{4,20})/i,
        /([A-Z]{2,4}\d{4,10})/g,
        /(\d{8,12})/g,
        /([A-Z0-9]{6,15})/g
    ];
    
    for (const pattern of reservationPatterns) {
        const matches = fullText.match(pattern);
        if (matches) {
            if (pattern.source.includes('예약번호|reservation')) {
                data.reservation_number = matches[1];
                break;
            } else {
                // 가장 긴 매치를 선택
                const candidates = [...fullText.matchAll(pattern)];
                if (candidates.length > 0) {
                    data.reservation_number = candidates.sort((a, b) => b[0].length - a[0].length)[0][0];
                    break;
                }
            }
        }
    }
    
    // 2. 확인번호
    const confirmationPatterns = [
        /(?:확인번호|confirmation|confirm)[\s:：]*([A-Z0-9]{4,20})/i,
        /(?:conf|cnf)[\s:：]*([A-Z0-9]{4,20})/i
    ];
    
    for (const pattern of confirmationPatterns) {
        const match = fullText.match(pattern);
        if (match) {
            data.confirmation_number = match[1];
            break;
        }
    }
    
    // 3. 이메일 - 더 정확한 패턴
    const emailPattern = /([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g;
    const emailMatches = [...fullText.matchAll(emailPattern)];
    if (emailMatches.length > 0) {
        data.email = emailMatches[0][1];
    }
    
    // 4. 한글명 - 다양한 패턴 지원
    const koreanNamePatterns = [
        /(?:예약자|이름|성명|name)[\s:：]*([가-힣]{2,10})/i,
        /(?:한글|korean)[\s:：]*([가-힣]{2,10})/i,
        /([가-힣]{2,4})\s*님/,
        /고객명[\s:：]*([가-힣]{2,10})/i
    ];
    
    for (const pattern of koreanNamePatterns) {
        const match = fullText.match(pattern);
        if (match) {
            data.korean_name = match[1];
            break;
        }
    }
    
    // 5. 영문명
    const englishNamePatterns = [
        /(?:영문|english)[\s:：]*([A-Za-z\s]{2,30})/i,
        /(?:first|last|full)\s*name[\s:：]*([A-Za-z\s]{2,30})/i,
        /([A-Z][a-z]+\s+[A-Z][a-z]+)/g
    ];
    
    for (const pattern of englishNamePatterns) {
        const match = fullText.match(pattern);
        if (match) {
            data.english_name = match[1].trim();
            break;
        }
    }
    
    // 6. 전화번호 - 국제번호 포함
    const phonePatterns = [
        /(?:전화|phone|tel|mobile)[\s:：]*([+]?[\d\s\-\(\)]{8,20})/i,
        /([+]?82[\s\-]?1[0-9][\s\-]?\d{3,4}[\s\-]?\d{4})/,
        /([+]?1[\s\-]?\d{3}[\s\-]?\d{3}[\s\-]?\d{4})/,
        /(01[0-9][\s\-]?\d{3,4}[\s\-]?\d{4})/
    ];
    
    for (const pattern of phonePatterns) {
        const match = fullText.match(pattern);
        if (match) {
            data.phone = match[1].replace(/\s+/g, '').replace(/\-+/g, '-');
            break;
        }
    }
    
    // 7. 상품명 - 더 유연한 패턴
    const productPatterns = [
        /(?:상품명|product|tour|activity)[\s:：]*([^\n\r]{5,100})/i,
        /(?:투어|tour|액티비티|activity)[\s:：]*([^\n\r]{5,100})/i
    ];
    
    for (const pattern of productPatterns) {
        const match = fullText.match(pattern);
        if (match) {
            data.product_name = match[1].trim();
            break;
        }
    }
    
    // 8. 날짜 - 다양한 형식 지원
    const datePatterns = [
        /(?:날짜|date|이용일)[\s:：]*(\d{4}[-\/년]\d{1,2}[-\/월]\d{1,2}일?)/i,
        /(\d{4}[-\/]\d{1,2}[-\/]\d{1,2})/g,
        /(\d{1,2}\/\d{1,2}\/\d{4})/g,
        /(\d{4}\.\d{1,2}\.\d{1,2})/g
    ];
    
    for (const pattern of datePatterns) {
        const match = fullText.match(pattern);
        if (match) {
            let dateStr = match[1];
            // 한글 날짜 형식 정규화
            dateStr = dateStr.replace(/년/g, '-').replace(/월/g, '-').replace(/일/g, '');
            data.usage_date = dateStr;
            break;
        }
    }
    
    // 9. 시간
    const timePatterns = [
        /(?:시간|time)[\s:：]*(\d{1,2}:\d{2})/i,
        /(\d{1,2}:\d{2}(?:\s*[AP]M)?)/gi
    ];
    
    for (const pattern of timePatterns) {
        const match = fullText.match(pattern);
        if (match) {
            data.usage_time = match[1];
            break;
        }
    }
    
    // 10. 금액 - 다양한 통화 지원
    const amountPatterns = [
        /(?:금액|amount|price|cost|total)[\s:：]*[$₩]?([\d,]+\.?\d*)/i,
        /[$₩]([\d,]+\.?\d*)/g,
        /([\d,]+)\s*원/g,
        /([\d,]+)\s*달러/g
    ];
    
    for (const pattern of amountPatterns) {
        const match = fullText.match(pattern);
        if (match) {
            const amount = match[1].replace(/,/g, '');
            data.amount = parseFloat(amount);
            break;
        }
    }
    
    // 11. 인원수
    const guestPatterns = [
        /(?:인원|guest|pax|person)[\s:：]*(\d+)/i,
        /(\d+)\s*명/g,
        /(\d+)\s*인/g
    ];
    
    for (const pattern of guestPatterns) {
        const match = fullText.match(pattern);
        if (match) {
            data.guest_count = parseInt(match[1]);
            break;
        }
    }
    
    // 12. 카카오톡 ID
    const kakaoPatterns = [
        /(?:카카오|kakao|카톡)[\s:：]*([a-zA-Z0-9_-]{2,20})/i,
        /(?:id|아이디)[\s:：]*([a-zA-Z0-9_-]{2,20})/i
    ];
    
    for (const pattern of kakaoPatterns) {
        const match = fullText.match(pattern);
        if (match && !match[1].includes('@')) { // 이메일이 아닌 경우만
            data.kakao_id = match[1];
            break;
        }
    }
    
    // 13. 예약 채널
    const channelPatterns = [
        /(?:채널|channel|platform)[\s:：]*([^\n\r]{2,50})/i,
        /(?:through|via)[\s:：]*([^\n\r]{2,50})/i
    ];
    
    for (const pattern of channelPatterns) {
        const match = fullText.match(pattern);
        if (match) {
            data.booking_channel = match[1].trim();
            break;
        }
    }
    
    // 14. 패키지 타입
    const packagePatterns = [
        /(?:패키지|package|type)[\s:：]*([^\n\r]{2,50})/i,
        /(?:옵션|option)[\s:：]*([^\n\r]{2,50})/i
    ];
    
    for (const pattern of packagePatterns) {
        const match = fullText.match(pattern);
        if (match) {
            data.package_type = match[1].trim();
            break;
        }
    }
    
    // 15. 메모/특이사항
    const memoPatterns = [
        /(?:메모|note|remark|특이사항)[\s:：]*([^\n\r]{2,200})/i,
        /(?:요청사항|request)[\s:：]*([^\n\r]{2,200})/i
    ];
    
    for (const pattern of memoPatterns) {
        const match = fullText.match(pattern);
        if (match) {
            data.memo = match[1].trim();
            break;
        }
    }
    
    // 데이터 후처리 및 검증
    if (data.korean_name) {
        data.korean_name = data.korean_name.replace(/님$/, '').trim();
    }
    
    if (data.english_name) {
        data.english_name = data.english_name.replace(/\s+/g, ' ').trim();
    }
    
    if (data.phone) {
        data.phone = data.phone.replace(/[^\d\+\-]/g, '');
    }
    
    console.log('파싱 결과:', data);
    
    return data;
}

// ==================== 예약 관리 API ====================

// 임시 디버깅 엔드포인트 - 발급코드 데이터 직접 확인
app.get('/admin/debug-codes', requireAuth, async (req, res) => {
    try {
        if (dbMode === 'postgresql') {
            const result = await pool.query('SELECT * FROM issue_codes ORDER BY created_at DESC LIMIT 20');
            res.json({
                success: true,
                count: result.rows.length,
                codes: result.rows
            });
        } else {
            res.json({ success: false, message: 'PostgreSQL 모드가 아님' });
        }
    } catch (error) {
        res.json({ success: false, error: error.message, stack: error.stack });
    }
});

// 발급 코드 관리 페이지
app.get('/admin/issue-codes', requireAuth, async (req, res) => {
    try {
        console.log('🎫 발급 코드 관리 페이지 접근 시도');
        
        if (dbMode === 'postgresql') {
            // issue_codes 테이블 존재 확인
            const tableCheck = await pool.query(`
                SELECT table_name 
                FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'issue_codes'
            `);
            
            if (tableCheck.rows.length === 0) {
                console.log('⚠️ issue_codes 테이블이 존재하지 않음');
                return res.render('admin/issue-codes', {
                    title: '발급 코드 관리',
                    adminUsername: req.session.adminUsername || 'admin',
                    stats: { total_codes: 0, delivered: 0, pending: 0 },
                    codes: []
                });
            }
            
            // 통계 쿼리
            let stats = { total_codes: 0, delivered: 0, pending: 0 };
            try {
                const statsQuery = await pool.query(`
                    SELECT 
                        COUNT(*) as total_codes,
                        COUNT(CASE WHEN is_delivered = true THEN 1 END) as delivered,
                        COUNT(CASE WHEN is_delivered = false OR is_delivered IS NULL THEN 1 END) as pending
                    FROM issue_codes
                `);
                stats = statsQuery.rows[0];
                console.log('📊 발급 코드 통계:', stats);
            } catch (statsError) {
                console.error('⚠️ 발급 코드 통계 쿼리 오류:', statsError.message);
            }
            
            // 발급 코드 목록 쿼리
            let codes = [];
            try {
                const codesQuery = await pool.query(`
                    SELECT 
                        id,
                        code,
                        COALESCE(is_delivered, false) as is_delivered,
                        delivered_at,
                        COALESCE(is_used, false) as is_used,
                        used_at,
                        notes,
                        created_at
                    FROM issue_codes 
                    ORDER BY created_at DESC 
                    LIMIT 100
                `);
                codes = codesQuery.rows;
                console.log('🎫 발급 코드 목록 쿼리 성공, 개수:', codes.length);
                console.log('🔍 첫 번째 코드 데이터:', codes[0]);
            } catch (listError) {
                console.error('⚠️ 발급 코드 목록 쿼리 오류:', listError.message);
            }
            
            console.log('📊 템플릿으로 전달되는 데이터:');
            console.log('- stats:', stats);
            console.log('- codes 개수:', codes.length);
            console.log('- adminUsername:', req.session.adminUsername || 'admin');
            
            res.render('admin/issue-codes', {
                title: '발급 코드 관리',
                adminUsername: req.session.adminUsername || 'admin',
                stats: stats,
                codes: codes
            });
        } else {
            console.log('📁 JSON 모드로 실행 중');
            res.render('admin/issue-codes', {
                title: '발급 코드 관리',
                adminUsername: req.session.adminUsername || 'admin',
                stats: { total_codes: 0, delivered: 0, pending: 0 },
                codes: []
            });
        }
    } catch (error) {
        console.error('❌ 발급 코드 관리 페이지 로드 오류:', error);
        res.status(500).json({ 
            error: true,
            message: '발급 코드 관리 페이지를 불러올 수 없습니다: ' + error.message,
            stack: error.stack
        });
    }
});

// 발급 코드 생성 API
app.post('/admin/issue-codes/generate', requireAuth, async (req, res) => {
    try {
        const { count = 1, notes = '' } = req.body;
        
        if (count < 1 || count > 100) {
            return res.status(400).json({
                success: false,
                message: '코드 개수는 1개에서 100개 사이여야 합니다.'
            });
        }
        
        if (dbMode === 'postgresql') {
            // issue_codes 테이블 존재 확인 및 생성
            const tableCheck = await pool.query(`
                SELECT table_name 
                FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'issue_codes'
            `);
            
            if (tableCheck.rows.length === 0) {
                // issue_codes 테이블 생성
                await pool.query(`
                    CREATE TABLE issue_codes (
                        id SERIAL PRIMARY KEY,
                        code VARCHAR(20) UNIQUE NOT NULL,
                        user_name VARCHAR(100),
                        user_phone VARCHAR(20),
                        user_email VARCHAR(100),
                        qr_code_url TEXT,
                        is_used BOOLEAN DEFAULT FALSE,
                        used_at TIMESTAMP,
                        is_delivered BOOLEAN DEFAULT FALSE,
                        delivered_at TIMESTAMP,
                        notes TEXT,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                `);
                console.log('✅ issue_codes 테이블 생성 완료');
            }
            
            const generatedCodes = [];
            
            for (let i = 0; i < count; i++) {
                // 고유한 코드 생성 (a1234b 형태)
                let code;
                let isUnique = false;
                let attempts = 0;
                
                while (!isUnique && attempts < 10) {
                    const letters = 'abcdefghijklmnopqrstuvwxyz';
                    const numbers = '0123456789';
                    
                    const firstLetter = letters[Math.floor(Math.random() * letters.length)];
                    const lastLetter = letters[Math.floor(Math.random() * letters.length)];
                    const middleNumbers = Array.from({length: 4}, () => 
                        numbers[Math.floor(Math.random() * numbers.length)]
                    ).join('');
                    
                    code = firstLetter + middleNumbers + lastLetter;
                    
                    // 중복 확인
                    const duplicateCheck = await pool.query(
                        'SELECT id FROM issue_codes WHERE code = $1',
                        [code]
                    );
                    
                    if (duplicateCheck.rows.length === 0) {
                        isUnique = true;
                    }
                    attempts++;
                }
                
                if (!isUnique) {
                    return res.status(500).json({
                        success: false,
                        message: '고유한 코드 생성에 실패했습니다. 다시 시도해주세요.'
                    });
                }
                
                // 코드 저장
                const result = await pool.query(
                    'INSERT INTO issue_codes (code, notes) VALUES ($1, $2) RETURNING *',
                    [code, notes]
                );
                
                generatedCodes.push(result.rows[0].code);
            }
            
            console.log(`✅ ${count}개의 발급 코드 생성 완료:`, generatedCodes);
            
            res.json({
                success: true,
                message: `${count}개의 코드가 생성되었습니다.`,
                codes: generatedCodes
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'PostgreSQL 모드에서만 사용 가능합니다.'
            });
        }
    } catch (error) {
        console.error('❌ 발급 코드 생성 오류:', error);
        res.status(500).json({
            success: false,
            message: '코드 생성 중 오류가 발생했습니다: ' + error.message
        });
    }
});

// 발급 코드 수정 API
app.put('/admin/issue-codes/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { notes } = req.body;
        
        if (dbMode === 'postgresql') {
            const result = await pool.query(
                'UPDATE issue_codes SET notes = $1 WHERE id = $2 RETURNING *',
                [notes, id]
            );
            
            if (result.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: '코드를 찾을 수 없습니다.'
                });
            }
            
            res.json({
                success: true,
                message: '코드가 수정되었습니다.',
                code: result.rows[0]
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'PostgreSQL 모드에서만 사용 가능합니다.'
            });
        }
    } catch (error) {
        console.error('❌ 발급 코드 수정 오류:', error);
        res.status(500).json({
            success: false,
            message: '코드 수정 중 오류가 발생했습니다: ' + error.message
        });
    }
});

// 발급 코드 삭제 API
app.delete('/admin/issue-codes/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        
        if (dbMode === 'postgresql') {
            const result = await pool.query(
                'DELETE FROM issue_codes WHERE id = $1 RETURNING *',
                [id]
            );
            
            if (result.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: '코드를 찾을 수 없습니다.'
                });
            }
            
            res.json({
                success: true,
                message: '코드가 삭제되었습니다.'
            });
        } else {
            res.status(500).json({
                success: false,
                message: 'PostgreSQL 모드에서만 사용 가능합니다.'
            });
        }
    } catch (error) {
        console.error('❌ 발급 코드 삭제 오류:', error);
        res.status(500).json({
            success: false,
            message: '코드 삭제 중 오류가 발생했습니다: ' + error.message
        });
    }
});

// 알림톡 전송 API
app.post('/admin/issue-codes/send-alimtalk', requireAuth, async (req, res) => {
    try {
        const { code, name, phone } = req.body;
        
        if (!code || !name || !phone) {
            return res.status(400).json({
                success: false,
                message: '코드, 이름, 전화번호는 필수입니다.'
            });
        }
        
        if (dbMode === 'postgresql') {
            // 코드 존재 확인
            const codeCheck = await pool.query(
                'SELECT * FROM issue_codes WHERE code = $1',
                [code]
            );
            
            if (codeCheck.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: '코드를 찾을 수 없습니다.'
                });
            }
            
            // 유효기간 계산 (30일 후)
            const expireDate = new Date();
            expireDate.setDate(expireDate.getDate() + 30);
            const expireDateStr = expireDate.toLocaleDateString('ko-KR');
            
            // 알림톡 전송 (SDK 사용 가능한 경우에만)
            if (bizonService) {
                const result = await bizonService.sendIssueCodeAlimtalk({
                    to: phone,
                    name: name,
                    code: code,
                    expireDate: expireDateStr
                });
                
                if (result.success) {
                    // 전달 완료 표시 업데이트 + 메모에 이름/연락처 저장
                    const memoText = `알림톡 전송: ${name} / ${phone}`;
                    await pool.query(
                        'UPDATE issue_codes SET is_delivered = TRUE, delivered_at = NOW(), notes = COALESCE(notes, \'\') || $1 WHERE code = $2',
                        [`\n${memoText}`, code]
                    );
                    
                    console.log(`✅ 알림톡 전송 성공: ${name} (${phone}) - 코드: ${code}`);
                    console.log(`📋 API 응답:`, JSON.stringify(result.result, null, 2));
                    
                    res.json({
                        success: true,
                        message: '알림톡이 전송되었습니다.'
                    });
                } else {
                    console.error(`❌ 알림톡 전송 실패:`, result);
                    res.status(500).json({
                        success: false,
                        message: result.message || '알림톡 전송에 실패했습니다.'
                    });
                }
            } else {
                // SDK가 없는 경우 - 개발 모드로 처리
                console.log(`⚠️  알림톡 SDK 미설치 - 코드 정보만 저장: ${name} (${phone}) - 코드: ${code}`);
                
                // 코드 정보 + 메모 업데이트
                const memoText = `코드 전달 예정: ${name} / ${phone}`;
                await pool.query(
                    'UPDATE issue_codes SET user_name = $1, user_phone = $2, notes = $3 WHERE code = $4',
                    [name, phone, memoText, code]
                );
                
                res.json({
                    success: true,
                    message: '코드 정보가 저장되었습니다. (알림톡 기능은 비활성화 상태)'
                });
            }
        } else {
            res.status(500).json({
                success: false,
                message: 'PostgreSQL 모드에서만 사용 가능합니다.'
            });
        }
    } catch (error) {
        console.error('❌ 알림톡 전송 오류:', error);
        res.status(500).json({
            success: false,
            message: '알림톡 전송 중 오류가 발생했습니다: ' + error.message
        });
    }
});

// 템플릿 조회 API (디버깅용)
app.get('/admin/alimtalk/template/:templateCode', requireAuth, async (req, res) => {
    try {
        const { templateCode } = req.params;
        
        console.log(`🔍 템플릿 조회 요청: ${templateCode}`);
        
        const result = await bizonService.getTemplate(templateCode);
        
        if (result.success) {
            res.json({
                success: true,
                data: result.data
            });
        } else {
            res.status(500).json({
                success: false,
                message: '템플릿 조회 실패',
                error: result.error
            });
        }
    } catch (error) {
        console.error('❌ 템플릿 조회 오류:', error);
        res.status(500).json({
            success: false,
            message: '템플릿 조회 중 오류가 발생했습니다: ' + error.message
        });
    }
});

// 인박스 페이지 (파싱·검수·등록 통합)
app.get('/admin/inbox', requireAuth, async (req, res) => {
    try {
        console.log('📥 인박스 페이지 접근');
        
        // 여행사 목록 조회
        const agencies = await dbHelpers.getAgencies().catch(() => []);
        
        res.render('admin/inbox', {
            title: '인박스',
            adminUsername: req.session.adminUsername || 'admin',
            agencies: agencies
        });
        
    } catch (error) {
        console.error('❌ 인박스 페이지 오류:', error);
        res.status(500).render('admin/inbox', {
            title: '인박스',
            adminUsername: req.session.adminUsername || 'admin',
            agencies: [],
            error: '페이지 로드 중 오류가 발생했습니다.'
        });
    }
});

// 예약 관리 페이지 (수배서 미생성 예약만 표시)
app.get('/admin/reservations', requireAuth, async (req, res) => {
    try {
        console.log('📋 예약 관리 페이지 접근 (수배서 미생성 예약 표시)');
        
        // 페이징 파라미터
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;
        const search = req.query.search || '';
        const status = req.query.status || '';
        
        if (dbMode === 'postgresql') {
            // 테이블 존재 확인 (reservations와 reservation_drafts 모두)
            const tableCheck = await pool.query(`
                SELECT table_name 
                FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name IN ('reservations', 'reservation_drafts')
            `);
            
            const existingTables = tableCheck.rows.map(row => row.table_name);
            console.log('📊 존재하는 테이블:', existingTables);
            
            if (existingTables.length === 0) {
                console.log('⚠️ 예약 관련 테이블이 존재하지 않음');
                return res.render('admin/reservations', {
                    title: '예약 관리',
                    adminUsername: req.session.adminUsername || 'admin',
                    stats: { total_reservations: 0, code_issued: 0, pending_codes: 0, companies: 0, drafts_pending: 0, drafts_ready: 0 },
                    reservations: [],
                    drafts: [],
                    pagination: { page: 1, totalPages: 1, hasNext: false, hasPrev: false }
                });
            }
            
            // 통계 쿼리 (reservations + drafts)
            let stats = { total_reservations: 0, code_issued: 0, pending_codes: 0, companies: 0, drafts_pending: 0, drafts_ready: 0 };
            try {
                // 예약 통계
                if (existingTables.includes('reservations')) {
                    const reservationStats = await pool.query(`
                        SELECT 
                            COUNT(*) as total_reservations,
                            COUNT(CASE WHEN code_issued = true THEN 1 END) as code_issued,
                            COUNT(CASE WHEN code_issued = false OR code_issued IS NULL THEN 1 END) as pending_codes,
                            COUNT(DISTINCT COALESCE(platform_name, 'NOL')) as companies
                        FROM reservations
                        WHERE payment_status != 'cancelled'
                    `);
                    stats = { ...stats, ...reservationStats.rows[0] };
                }
                
                // 드래프트 통계
                if (existingTables.includes('reservation_drafts')) {
                    const draftStats = await pool.query(`
                        SELECT 
                            COUNT(CASE WHEN status = 'pending' THEN 1 END) as drafts_pending,
                            COUNT(CASE WHEN status = 'ready' THEN 1 END) as drafts_ready
                        FROM reservation_drafts
                        WHERE status IN ('pending', 'ready')
                    `);
                    stats = { ...stats, ...draftStats.rows[0] };
                }
                
                console.log('📊 통계 쿼리 성공:', stats);
            } catch (statsError) {
                console.error('⚠️ 통계 쿼리 오류:', statsError.message);
            }
            
            // 예약 목록 쿼리 (검색 및 필터링 포함)
            let reservations = [];
            let totalCount = 0;
            try {
                if (existingTables.includes('reservations')) {
                    let whereClause = "WHERE 1=1";
                    let queryParams = [];
                    let paramIndex = 1;
                    
                    // 검색 조건
                    if (search) {
                        whereClause += ` AND (
                            reservation_number ILIKE $${paramIndex} OR 
                            korean_name ILIKE $${paramIndex} OR 
                            product_name ILIKE $${paramIndex} OR
                            email ILIKE $${paramIndex}
                        )`;
                        queryParams.push(`%${search}%`);
                        paramIndex++;
                    }
                    
                    // 상태 필터
                    if (status === 'issued') {
                        whereClause += ` AND code_issued = true`;
                    } else if (status === 'pending') {
                        whereClause += ` AND (code_issued = false OR code_issued IS NULL)`;
                    }
                    
                    // 총 개수 조회
                    const countQuery = `SELECT COUNT(*) as total FROM reservations ${whereClause}`;
                    const countResult = await pool.query(countQuery, queryParams);
                    totalCount = parseInt(countResult.rows[0].total);
                    
                    // 예약 목록 조회 (실제 테이블 구조에 맞춤)
                    const reservationsQuery = await pool.query(`
                        SELECT 
                            id,
                            reservation_number,
                            platform_name,
                            product_name,
                            korean_name,
                            usage_date,
                            total_amount as total_price,
                            code_issued,
                            email,
                            created_at,
                            updated_at
                        FROM reservations 
                        ${whereClause}
                        ORDER BY created_at DESC 
                        LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
                    `, [...queryParams, limit, offset]);
                    
                    reservations = reservationsQuery.rows;
                    console.log('📋 예약 목록 쿼리 성공, 개수:', reservations.length);
                }
            } catch (listError) {
                console.error('⚠️ 예약 목록 쿼리 오류:', listError.message);
            }
            
            // 드래프트 목록 조회 (탭별 처리)
            let drafts = [];
            let draft_pagination = null;
            const activeTab = req.query.tab || 'reservations';
            
            if (activeTab === 'drafts') {
                // 드래프트 탭이 활성화된 경우 전체 드래프트 목록 조회
                const draft_page = parseInt(req.query.page) || 1;
                const draft_search = req.query.draft_search || '';
                const draft_status = req.query.draft_status || '';
                
                try {
                    if (existingTables.includes('reservation_drafts')) {
                        let draftWhereClause = 'WHERE 1=1';
                        let draftQueryParams = [];
                        let draftParamIndex = 1;
                        
                        // 드래프트 상태 필터
                        if (draft_status) {
                            draftWhereClause += ` AND status = $${draftParamIndex}`;
                            draftQueryParams.push(draft_status);
                            draftParamIndex++;
                        }
                        
                        // 드래프트 검색 조건
                        if (draft_search) {
                            draftWhereClause += ` AND (
                                raw_text ILIKE $${draftParamIndex} OR 
                                extracted_notes ILIKE $${draftParamIndex} OR
                                (normalized_json->>'reservation_number') ILIKE $${draftParamIndex} OR
                                (normalized_json->>'korean_name') ILIKE $${draftParamIndex}
                            )`;
                            draftQueryParams.push(`%${draft_search}%`);
                            draftParamIndex++;
                        }
                        
                        // 드래프트 총 개수 조회
                        const draftCountQuery = `SELECT COUNT(*) as total FROM reservation_drafts ${draftWhereClause}`;
                        const draftCountResult = await pool.query(draftCountQuery, draftQueryParams);
                        const draftTotalCount = parseInt(draftCountResult.rows[0].total);
                        
                        // 드래프트 목록 조회
                        const draftsQuery = await pool.query(`
                            SELECT 
                                draft_id as id,
                                raw_text,
                                parsed_json,
                                normalized_json,
                                manual_json,
                                confidence,
                                extracted_notes,
                                status,
                                created_at,
                                updated_at,
                                reviewed_by,
                                reviewed_at,
                                committed_reservation_id
                            FROM reservation_drafts 
                            ${draftWhereClause}
                            ORDER BY created_at DESC 
                            LIMIT $${draftParamIndex} OFFSET $${draftParamIndex + 1}
                        `, [...draftQueryParams, limit, (draft_page - 1) * limit]);
                        
                        drafts = draftsQuery.rows.map(draft => {
                            try {
                                // JSON 필드 파싱
                                if (draft.parsed_json && typeof draft.parsed_json === 'string') {
                                    draft.parsed_json = JSON.parse(draft.parsed_json);
                                }
                                if (draft.normalized_json && typeof draft.normalized_json === 'string') {
                                    draft.normalized_json = JSON.parse(draft.normalized_json);
                                }
                                if (draft.manual_json && typeof draft.manual_json === 'string') {
                                    draft.manual_json = JSON.parse(draft.manual_json);
                                }
                                
                                // 최종 데이터 (manual_json > normalized_json > parsed_json 순서)
                                const finalData = draft.manual_json || draft.normalized_json || draft.parsed_json || {};
                                
                                // UI에서 사용할 수 있도록 필드명 매핑
                                draft.reservation_code = finalData.reservation_number || finalData.reservation_code;
                                draft.platform_name = finalData.platform;
                                draft.product_name = finalData.product_name;
                                draft.total_price = finalData.total_price;
                                draft.name_kr = finalData.korean_name;
                                draft.name_en_first = finalData.english_first_name;
                                draft.name_en_last = finalData.english_last_name;
                                draft.email = finalData.email;
                                draft.phone = finalData.phone;
                                
                            } catch (parseError) {
                                console.warn('드래프트 JSON 파싱 오류:', parseError);
                            }
                            return draft;
                        });
                        
                        // 드래프트 페이징 정보
                        const draftTotalPages = Math.ceil(draftTotalCount / limit);
                        draft_pagination = {
                            page: draft_page,
                            totalPages: draftTotalPages,
                            hasNext: draft_page < draftTotalPages,
                            hasPrev: draft_page > 1,
                            totalCount: draftTotalCount
                        };
                        
                        console.log('📋 드래프트 목록 쿼리 성공, 개수:', drafts.length);
                    }
                } catch (draftError) {
                    console.error('⚠️ 드래프트 목록 쿼리 오류:', draftError.message);
                }
            } else {
                // 예약 탭이 활성화된 경우 최근 드래프트 몇 개만 표시
                try {
                    if (existingTables.includes('reservation_drafts')) {
                        const recentDraftsQuery = await pool.query(`
                            SELECT 
                                draft_id as id,
                                status,
                                confidence,
                                created_at,
                                CASE 
                                    WHEN manual_json IS NOT NULL THEN manual_json
                                    WHEN normalized_json IS NOT NULL THEN normalized_json
                                    ELSE parsed_json
                                END as display_data
                            FROM reservation_drafts 
                            WHERE status IN ('pending', 'ready')
                            ORDER BY created_at DESC 
                            LIMIT 5
                        `);
                        drafts = recentDraftsQuery.rows.map(draft => {
                            try {
                                draft.display_data = typeof draft.display_data === 'string' ? 
                                    JSON.parse(draft.display_data) : draft.display_data;
                            } catch (e) {
                                draft.display_data = {};
                            }
                            return draft;
                        });
                    }
                } catch (draftError) {
                    console.error('⚠️ 최근 드래프트 쿼리 오류:', draftError.message);
                }
            }
            
            // 페이징 정보
            const totalPages = Math.ceil(totalCount / limit);
            const pagination = {
                page,
                totalPages,
                hasNext: page < totalPages,
                hasPrev: page > 1,
                totalCount
            };
            
            // 여행사 목록 조회
            const agencies = await dbHelpers.getAgencies().catch(() => []);
            
            res.render('admin/reservations', {
                title: '예약 관리',
                adminUsername: req.session.adminUsername || 'admin',
                stats: stats,
                reservations: reservations,
                drafts: drafts,
                pagination: pagination,
                draft_pagination: draft_pagination,
                search: search,
                status: status,
                draft_search: req.query.draft_search || '',
                draft_status: req.query.draft_status || '',
                activeTab: activeTab,
                agencies: agencies
            });
        } else {
            console.log('📁 JSON 모드로 실행 중');
            // 여행사 목록 조회
            const agencies = await dbHelpers.getAgencies().catch(() => []);
            
            res.render('admin/reservations', {
                title: '예약 관리',
                adminUsername: req.session.adminUsername || 'admin',
                stats: { total_reservations: 0, code_issued: 0, pending_codes: 0, companies: 0, drafts_pending: 0, drafts_ready: 0 },
                reservations: [],
                drafts: [],
                pagination: { page: 1, totalPages: 1, hasNext: false, hasPrev: false },
                agencies: agencies
            });
        }
    } catch (error) {
        console.error('❌ 예약 관리 페이지 로드 오류:', error);
        console.error('❌ 오류 스택:', error.stack);
        res.status(500).json({ 
            error: true,
            message: '예약 관리 페이지를 불러올 수 없습니다: ' + error.message,
            stack: error.stack
        });
    }
});

// 새로운 JSON 스키마 기반 예약 데이터 변환 API
app.post('/admin/reservations/convert-json', requireAuth, async (req, res) => {
    try {
        const { reservationText } = req.body;
        
        if (!reservationText || !reservationText.trim()) {
            return res.json({ 
                success: false, 
                message: '예약 데이터를 입력해주세요.' 
            });
        }
        
        // JSON 스키마로 변환
        const jsonData = await parseReservationToJSON(reservationText);
        
        // JSON만 반환 (요청사항에 따라)
        res.json(jsonData);
        
    } catch (error) {
        console.error('JSON 변환 오류:', error);
        res.status(500).json({
            success: false,
            message: 'JSON 변환 중 오류가 발생했습니다.'
        });
    }
});

// 공개 예약 등록 API (텍스트 파싱)
app.post('/api/register-reservation', async (req, res) => {
    try {
        const { reservationText } = req.body;
        
        if (!reservationText || reservationText.trim().length === 0) {
            return res.status(400).json({
                success: false,
                message: '예약 텍스트가 필요합니다.'
            });
        }
        
        console.log('🎯 공개 API 예약 파싱 요청 받음');
        console.log('입력 텍스트 길이:', reservationText.length);
        console.log('현재 시간:', new Date().toISOString());
        
        // AI 수준 파싱 실행
        const parsedData = parseReservationToJSON(reservationText);
        console.log('📊 파싱 완료:', parsedData);
        console.log('🔍 한글 이름 확인:', parsedData.korean_name);
        console.log('🔍 영문 이름 확인:', parsedData.english_first_name, parsedData.english_last_name);
        
        // 데이터베이스에 저장
        if (dbMode === 'postgresql') {
            // 로그인한 담당자 정보 가져오기
            const assignedBy = req.session.adminName || req.session.adminUsername || '시스템 (인박스)';
            const assignedByEmail = req.session.adminEmail || 'support@guamsavecard.com';
            console.log('👤 담당자 정보:', {
                adminName: req.session.adminName,
                adminEmail: req.session.adminEmail,
                adminUsername: req.session.adminUsername,
                adminId: req.session.adminId,
                assignedBy: assignedBy
            });
            
            const insertQuery = `
                INSERT INTO reservations (
                    reservation_number, channel, platform_name, product_name,
                    korean_name, english_first_name, english_last_name,
                    phone, email, kakao_id,
                    usage_date, usage_time, guest_count,
                    people_adult, people_child, people_infant,
                    package_type, total_amount, adult_unit_price, child_unit_price,
                    payment_status, code_issued, memo, assigned_to,
                    created_by, created_by_email
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
                    $11, $12, $13, $14, $15, $16, $17, $18, $19, $20,
                    $21, $22, $23, $24, $25, $26
                ) RETURNING *
            `;
            
            let values = [
                parsedData.reservation_number,
                parsedData.channel || '웹',
                parsedData.platform_name || 'NOL',
                parsedData.product_name,
                parsedData.korean_name,
                parsedData.english_first_name,
                parsedData.english_last_name,
                parsedData.phone,
                parsedData.email,
                parsedData.kakao_id,
                parsedData.usage_date,
                parsedData.usage_time,
                parsedData.guest_count || 1,
                parsedData.people_adult || 1,
                parsedData.people_child || 0,
                parsedData.people_infant || 0,
                parsedData.package_type,
                parsedData.total_amount,
                parsedData.adult_unit_price,
                parsedData.child_unit_price,
                parsedData.payment_status || '대기',
                parsedData.code_issued || false,
                parsedData.memo,
                assignedBy,
                assignedBy,
                assignedByEmail
            ];
            
            try {
                const result = await pool.query(insertQuery, values);
                const reservationId = result.rows[0].id;
                
                // 자동 수배서 생성 시도
                console.log('🔄 자동 수배서 생성 시도:', {
                    reservationId,
                    productName: parsedData.product_name
                });
                
                const autoAssignment = await createAutoAssignment(reservationId, parsedData.product_name);
                
                // 예약 생성 히스토리 저장
                await logHistory(
                    reservationId,
                    '예약',
                    '생성',
                    assignedBy,
                    `새로운 예약이 등록되었습니다. 고객명: ${parsedData.korean_name || '-'}, 상품: ${parsedData.product_name || '-'}, 이용일: ${parsedData.usage_date || '-'}`,
                    null,
                    {
                        channel: parsedData.channel || '웹',
                        platform: parsedData.platform_name || 'NOL',
                        reservation_number: parsedData.reservation_number,
                        assigned_to: assignedBy,
                        auto_assignment: autoAssignment ? true : false,
                        vendor_name: autoAssignment?.vendor_name
                    }
                );
                
                res.json({
                    success: true,
                    message: '예약이 성공적으로 등록되었습니다.',
                    reservation_id: reservationId,
                    parsed_data: parsedData,
                    auto_assignment: autoAssignment ? {
                        created: true,
                        vendor: autoAssignment.vendor_name,
                        assignment_id: autoAssignment.assignment_id
                    } : {
                        created: false,
                        reason: '매칭되는 수배업체가 없습니다'
                    }
                });
            } catch (dbError) {
                if (dbError.code === '23505' && dbError.constraint === 'reservations_reservation_number_key') {
                    // 예약번호 중복 시 새로운 번호로 재시도
                    console.log('⚠️ 예약번호 중복 감지, 새 번호로 재시도...');
                    parsedData.reservation_number = `RETRY_${Date.now()}_${Math.random().toString(36).substr(2, 4).toUpperCase()}`;
                    values[0] = parsedData.reservation_number;
                    
                    const retryResult = await pool.query(insertQuery, values);
                    const reservationId = retryResult.rows[0].id;
                    
                    // 자동 수배서 생성 시도 (재시도 케이스)
                    console.log('🔄 자동 수배서 생성 시도 (재시도):', {
                        reservationId,
                        productName: parsedData.product_name
                    });
                    
                    const autoAssignment = await createAutoAssignment(reservationId, parsedData.product_name);
                    
                    res.json({
                        success: true,
                        message: '예약이 성공적으로 등록되었습니다. (예약번호 자동 변경)',
                        reservation_id: reservationId,
                        parsed_data: parsedData,
                        auto_assignment: autoAssignment ? {
                            created: true,
                            vendor: autoAssignment.vendor_name,
                            assignment_id: autoAssignment.assignment_id
                        } : {
                            created: false,
                            reason: '매칭되는 수배업체가 없습니다'
                        }
                    });
                } else {
                    throw dbError;
                }
            }
        }
        
    } catch (error) {
        console.error('❌ 공개 API 예약 등록 오류:', error);
        res.status(500).json({
            success: false,
            message: '예약 등록 중 오류가 발생했습니다: ' + error.message,
            error: error.stack
        });
    }
});

// ==================== 헬퍼 함수 ====================

// 별칭으로 표준 업체명 조회 (서버 내부 함수)
async function resolvePlatformAlias(alias) {
    try {
        if (!alias || !alias.trim()) {
            return null;
        }
        
        const cleanAlias = alias.trim();
        
        // 모든 활성 업체의 별칭 조회
        const query = `
            SELECT platform_name, platform_code, aliases 
            FROM platforms 
            WHERE is_active = true
        `;
        
        const result = await pool.query(query);
        
        // 1. 업체명 정확히 일치
        for (const platform of result.rows) {
            if (platform.platform_name.toLowerCase() === cleanAlias.toLowerCase()) {
                console.log(`✅ 업체명 변환: "${cleanAlias}" → "${platform.platform_name}" (exact_name)`);
                return platform.platform_name;
            }
        }
        
        // 2. 업체 코드 정확히 일치
        for (const platform of result.rows) {
            if (platform.platform_code.toLowerCase() === cleanAlias.toLowerCase()) {
                console.log(`✅ 업체명 변환: "${cleanAlias}" → "${platform.platform_name}" (code)`);
                return platform.platform_name;
            }
        }
        
        // 3. 별칭 조회 (대소문자 무시, 부분 일치)
        for (const platform of result.rows) {
            const aliases = platform.aliases || [];
            for (const platformAlias of aliases) {
                if (platformAlias.toLowerCase() === cleanAlias.toLowerCase() ||
                    cleanAlias.toLowerCase().includes(platformAlias.toLowerCase()) ||
                    platformAlias.toLowerCase().includes(cleanAlias.toLowerCase())) {
                    console.log(`✅ 업체명 변환: "${cleanAlias}" → "${platform.platform_name}" (alias: ${platformAlias})`);
                    return platform.platform_name;
                }
            }
        }
        
        // 매칭 실패 - 원본 반환
        console.log(`ℹ️ 업체명 "${cleanAlias}" - 별칭 미등록 (원본 유지)`);
        return cleanAlias;
        
    } catch (error) {
        console.error('❌ 별칭 조회 실패:', error);
        return alias; // 실패 시 원본 반환
    }
}

// 요금 RAG에서 가격 정보 조회 및 자동 계산
async function matchPricingFromRAG(platform_name, product_name, package_type) {
    try {
        console.log('💰 요금 RAG 매칭 시작:', { platform_name, product_name, package_type });
        
        if (!platform_name || !product_name) {
            console.log('⚠️ 업체명 또는 상품명 누락 - 요금 매칭 건너뜀');
            return null;
        }
        
        // 요금 RAG에서 조회
        const pricingResult = await pool.query(`
            SELECT id, platform_name, product_name, commission_rate, package_options
            FROM product_pricing
            WHERE platform_name = $1 
            AND product_name = $2 
            AND is_active = true
            LIMIT 1
        `, [platform_name, product_name]);
        
        if (pricingResult.rows.length === 0) {
            console.log('⚠️ 요금 RAG에 매칭되는 상품 없음');
            return null;
        }
        
        const pricing = pricingResult.rows[0];
        const options = pricing.package_options || [];
        
        console.log('✅ 요금 RAG 매칭 성공:', pricing.id);
        console.log('📦 옵션 개수:', options.length);
        
        // package_type과 매칭되는 옵션 찾기
        let matchedOption = null;
        
        if (package_type) {
            // 정확히 일치하는 옵션 찾기
            matchedOption = options.find(opt => 
                opt.option_name && opt.option_name.trim() === package_type.trim()
            );
            
            // 부분 일치 시도
            if (!matchedOption) {
                matchedOption = options.find(opt => 
                    opt.option_name && 
                    (opt.option_name.includes(package_type) || package_type.includes(opt.option_name))
                );
            }
        }
        
        // 매칭된 옵션이 없으면 첫 번째 옵션 사용
        if (!matchedOption && options.length > 0) {
            matchedOption = options[0];
            console.log('ℹ️ 첫 번째 옵션 자동 선택');
        }
        
        if (!matchedOption) {
            console.log('⚠️ 사용 가능한 옵션 없음');
            return null;
        }
        
        console.log('✅ 옵션 매칭:', matchedOption.option_name);
        
        return {
            pricing_id: pricing.id,
            commission_rate: pricing.commission_rate,
            matched_option: matchedOption,
            adult_price: matchedOption.adult_price || null,
            adult_currency: matchedOption.adult_currency || 'USD',
            adult_cost: matchedOption.adult_cost || null,
            adult_cost_currency: matchedOption.adult_cost_currency || matchedOption.adult_currency || 'USD',
            child_price: matchedOption.child_price || null,
            child_currency: matchedOption.child_currency || 'USD',
            child_cost: matchedOption.child_cost || null,
            child_cost_currency: matchedOption.child_cost_currency || matchedOption.child_currency || 'USD',
            infant_price: matchedOption.infant_price || null,
            infant_currency: matchedOption.infant_currency || 'USD',
            infant_cost: matchedOption.infant_cost || null,
            infant_cost_currency: matchedOption.infant_cost_currency || matchedOption.infant_currency || 'USD'
        };
        
    } catch (error) {
        console.error('❌ 요금 RAG 매칭 오류:', error);
        return null;
    }
}

// ==================== API 라우트 ====================

// 예약 등록 (텍스트 파싱) - 관리자용
app.post('/admin/reservations/parse', requireAuth, async (req, res) => {
    try {
        const { reservationText, customPrompt } = req.body;
        
        if (!reservationText || !reservationText.trim()) {
            return res.json({ success: false, message: '예약 데이터를 입력해주세요.' });
        }
        
        console.log('📝 파싱 요청 받음 (여행사 선택 없음)');
        if (customPrompt) {
            console.log('🔧 커스텀 프롬프트 적용:', customPrompt.substring(0, 100) + '...');
        }
        
        // OpenAI 지능형 텍스트 파싱 (검수형 워크플로우)
        console.log('🤖 OpenAI 파싱 시작...');
        let parsedData;
        let parsingMethod = 'OpenAI';
        let confidence = 0.8;
        let extractedNotes = '';
        
        try {
            const aiResult = await parseBooking(reservationText, customPrompt);
            parsedData = aiResult;
            confidence = aiResult.confidence || 0.8;
            extractedNotes = aiResult.extracted_notes || '';
            console.log('✅ OpenAI 파싱 성공');
        } catch (error) {
            console.error('❌ OpenAI 파싱 실패:', error.message);
            // OpenAI 실패 시 로컬 파싱으로 폴백
            console.log('🔄 로컬 파싱으로 폴백...');
            parsedData = parseReservationToJSONLocal(reservationText);
            parsingMethod = '로컬';
            confidence = 0.5;
            extractedNotes = '로컬 파싱으로 처리됨 - 수동 검수 필요';
        }
        
        // 정규화 처리
        const normalizedData = normalizeReservationData(parsedData);
        
        console.log('✅ 파싱 완료 (여행사 정보는 파싱 결과에서 추출)');
        
        // 요금 RAG 매칭 시도
        let pricingMatched = false;
        let pricingInfo = null;
        
        try {
            pricingInfo = await matchPricingFromRAG(
                normalizedData.platform_name,
                normalizedData.product_name,
                normalizedData.package_type
            );
            
            if (pricingInfo) {
                console.log('💰 요금 자동 설정 완료');
                
                // 판매가 정보 자동 설정
                normalizedData.adult_unit_price = pricingInfo.adult_price;
                normalizedData.adult_currency = pricingInfo.adult_currency;
                normalizedData.child_unit_price = pricingInfo.child_price;
                normalizedData.child_currency = pricingInfo.child_currency;
                normalizedData.infant_unit_price = pricingInfo.infant_price;
                normalizedData.infant_currency = pricingInfo.infant_currency;
                
                // 원가 정보 자동 설정
                normalizedData.adult_cost = pricingInfo.adult_cost;
                normalizedData.adult_cost_currency = pricingInfo.adult_cost_currency;
                normalizedData.child_cost = pricingInfo.child_cost;
                normalizedData.child_cost_currency = pricingInfo.child_cost_currency;
                normalizedData.infant_cost = pricingInfo.infant_cost;
                normalizedData.infant_cost_currency = pricingInfo.infant_cost_currency;
                
                normalizedData.pricing_id = pricingInfo.pricing_id;
                normalizedData.commission_rate = pricingInfo.commission_rate;
                
                // 총 금액 자동 계산 (인원 정보가 있는 경우)
                if (normalizedData.people_adult || normalizedData.people_child || normalizedData.people_infant) {
                    const adultCount = normalizedData.people_adult || 0;
                    const childCount = normalizedData.people_child || 0;
                    const infantCount = normalizedData.people_infant || 0;
                    
                    const adultTotal = (pricingInfo.adult_price || 0) * adultCount;
                    const childTotal = (pricingInfo.child_price || 0) * childCount;
                    const infantTotal = (pricingInfo.infant_price || 0) * infantCount;
                    
                    normalizedData.total_amount = adultTotal + childTotal + infantTotal;
                    
                    console.log(`💵 총 금액 계산: 성인${adultCount}×${pricingInfo.adult_price} + 소아${childCount}×${pricingInfo.child_price} + 유아${infantCount}×${pricingInfo.infant_price} = ${normalizedData.total_amount}`);
                }
                
                pricingMatched = true;
            }
        } catch (pricingError) {
            console.error('⚠️ 요금 매칭 중 오류 (계속 진행):', pricingError.message);
        }
        
        // 파싱 결과만 반환 (저장은 별도 단계)
        res.json({
            success: true,
            message: pricingMatched ? '파싱 및 요금 매칭이 완료되었습니다.' : '파싱이 완료되었습니다.',
            parsed_data: normalizedData,
            parsing_method: parsingMethod,
            confidence: confidence,
            extracted_notes: extractedNotes,
            pricing_matched: pricingMatched,
            pricing_info: pricingInfo,
            workflow: 'parsing_only'
        });
        
    } catch (error) {
        console.error('예약 파싱 및 저장 오류:', error);
        res.json({ 
            success: false, 
            message: '예약 처리 중 오류가 발생했습니다: ' + error.message 
        });
    }
});

// ==================== 북마클릿 HTML Ingest API ====================

// Multer 설정 (메모리 저장)
const htmlUpload = multer({ 
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 5 * 1024 * 1024 // 5MB 제한
    },
    fileFilter: (req, file, cb) => {
        // HTML 파일만 허용
        if (file.mimetype === 'text/html' || file.originalname.endsWith('.html')) {
            cb(null, true);
        } else {
            cb(new Error('HTML 파일만 업로드 가능합니다.'));
        }
    }
});

// 북마클릿: HTML 수신 및 파싱 API
app.post('/api/ingest/html', requireAuth, htmlUpload.single('html'), async (req, res) => {
    try {
        console.log('📥 북마클릿: HTML 수신 시작');
        
        // HTML 파일 확인
        if (!req.file) {
            return res.status(400).json({
                ok: false,
                message: 'HTML 파일이 전송되지 않았습니다.'
            });
        }
        
        // HTML 내용 추출
        const htmlContent = req.file.buffer.toString('utf-8');
        const pageUrl = req.body.page_url || 'Unknown';
        
        console.log('📄 HTML 파일 정보:', {
            size: req.file.size,
            filename: req.file.originalname,
            pageUrl: pageUrl
        });
        
        // HTML에서 텍스트 추출 (간단한 태그 제거)
        let textContent = htmlContent
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '') // 스크립트 제거
            .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '') // 스타일 제거
            .replace(/<[^>]+>/g, ' ') // HTML 태그 제거
            .replace(/\s+/g, ' ') // 연속 공백 제거
            .trim();
        
        console.log('📝 추출된 텍스트 길이:', textContent.length);
        
        // OpenAI로 파싱
        let parsedData;
        let parsingMethod = 'OpenAI';
        let confidence = 0.8;
        let extractedNotes = `북마클릿으로 수집됨 - 출처: ${pageUrl}`;
        
        try {
            const aiResult = await parseBooking(textContent);
            parsedData = aiResult;
            confidence = aiResult.confidence || 0.8;
            extractedNotes = `${extractedNotes}\n${aiResult.extracted_notes || ''}`;
            console.log('✅ OpenAI 파싱 성공');
        } catch (error) {
            console.error('❌ OpenAI 파싱 실패:', error.message);
            return res.status(500).json({
                ok: false,
                message: 'AI 파싱에 실패했습니다: ' + error.message
            });
        }
        
        // 정규화 처리
        const normalizedData = normalizeReservationData(parsedData);
        
        // 🔍 별칭 조회 → 표준 업체명으로 변환
        if (normalizedData.platform_name) {
            console.log('🔍 북마클릿: 업체명 변환 시도:', normalizedData.platform_name);
            const standardName = await resolvePlatformAlias(normalizedData.platform_name);
            if (standardName) {
                normalizedData.platform_name = standardName;
                normalizedData.channel = standardName; // channel도 동기화
            }
        }
        
        // 메모에 북마클릿 정보 추가
        normalizedData.memo = normalizedData.memo 
            ? `${normalizedData.memo}\n\n[북마클릿 수집: ${pageUrl}]`
            : `[북마클릿 수집: ${pageUrl}]`;
        
        // 예약번호 중복 체크
        if (normalizedData.reservation_number) {
            const checkQuery = 'SELECT id FROM reservations WHERE reservation_number = $1';
            const existingReservation = await pool.query(checkQuery, [normalizedData.reservation_number]);
            
            if (existingReservation.rows.length > 0) {
                const timestamp = Date.now();
                const random = Math.random().toString(36).substr(2, 4).toUpperCase();
                normalizedData.reservation_number = `${normalizedData.reservation_number}_${random}`;
                console.log('🔄 중복 예약번호 감지, 새 번호 생성:', normalizedData.reservation_number);
            }
        } else {
            // 예약번호가 없으면 자동 생성
            const timestamp = Date.now();
            const random = Math.random().toString(36).substr(2, 6).toUpperCase();
            normalizedData.reservation_number = `BM_${timestamp}_${random}`;
            console.log('🎫 예약번호 자동 생성:', normalizedData.reservation_number);
        }
        
        // 담당자 정보
        const assignedBy = req.session.adminName || req.session.adminUsername || '시스템';
        
        // 예약 테이블에 저장 (상태: pending = 대기중)
        const insertQuery = `
            INSERT INTO reservations (
                reservation_number, confirmation_number, channel, platform_name,
                product_name, package_type, total_amount, quantity, guest_count,
                korean_name, english_first_name, english_last_name, email, phone, kakao_id,
                people_adult, people_child, people_infant, adult_unit_price, child_unit_price,
                usage_date, usage_time, reservation_datetime, payment_status,
                memo, assigned_to, created_at, updated_at
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
                $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, NOW(), NOW()
            ) RETURNING id
        `;
        
        const values = [
            normalizedData.reservation_number || null,
            normalizedData.confirmation_number || null,
            normalizedData.channel || '북마클릿',
            normalizedData.platform_name || 'BOOKMARKLET',
            normalizedData.product_name || null,
            normalizedData.package_type || null,
            normalizedData.total_amount || null,
            normalizedData.quantity || 1,
            normalizedData.guest_count || null,
            normalizedData.korean_name || null,
            normalizedData.english_first_name || null,
            normalizedData.english_last_name || null,
            normalizedData.email || null,
            normalizedData.phone || null,
            normalizedData.kakao_id || null,
            normalizedData.people_adult || null,
            normalizedData.people_child || null,
            normalizedData.people_infant || null,
            normalizedData.adult_unit_price || null,
            normalizedData.child_unit_price || null,
            normalizedData.usage_date || null,
            normalizedData.usage_time || null,
            normalizedData.reservation_datetime || null,
            'pending', // ✅ 상태를 pending(대기중)으로 설정
            normalizedData.memo || null,
            assignedBy
        ];
        
        const result = await pool.query(insertQuery, values);
        const reservationId = result.rows[0].id;
        
        console.log('✅ 북마클릿: 예약 저장 완료, ID:', reservationId);
        
        // 🏢 상품명으로 수배업체 자동 매칭 (인박스와 동일한 로직)
        let autoAssignmentResult = null;
        const productName = normalizedData.product_name;
        
        if (productName) {
            try {
                console.log('🔍 상품명 자동 매칭 시도:', productName);
                autoAssignmentResult = await createAutoAssignment(reservationId, productName);
                
                if (autoAssignmentResult) {
                    console.log('✅ 수배서 자동 생성 성공:', autoAssignmentResult.vendor.vendor_name);
                } else {
                    console.log('⚠️ 매칭되는 수배업체 없음 - 예약관리로 이동');
                }
            } catch (error) {
                console.error('❌ 자동 수배 생성 오류:', error);
            }
        }
        
        // 성공 응답
        res.json({
            ok: true,
            message: autoAssignmentResult 
                ? '예약이 등록되고 수배서가 자동 생성되었습니다.' 
                : '예약이 등록되었습니다. (수배업체 미지정)',
            reservation_id: reservationId,
            reservation_number: normalizedData.reservation_number,
            confidence: confidence,
            parsing_method: parsingMethod,
            auto_assignment: autoAssignmentResult ? {
                created: true,
                vendor: autoAssignmentResult.vendor.vendor_name,
                assignment_id: autoAssignmentResult.assignment.id
            } : {
                created: false,
                reason: '매칭되는 수배업체가 없습니다'
            }
        });
        
    } catch (error) {
        console.error('❌ 북마클릿 처리 오류:', error);
        res.status(500).json({
            ok: false,
            message: '예약 등록 중 오류가 발생했습니다: ' + error.message,
            error: error.stack
        });
    }
});

// 예약 직접 저장 API
app.post('/admin/reservations/save', requireAuth, async (req, res) => {
    try {
        const { parsedData } = req.body;
        
        if (!parsedData) {
            return res.json({ success: false, message: '예약 데이터가 없습니다.' });
        }
        
        // 정규화 처리
        const normalizedData = normalizeReservationData(parsedData);
        
        // 🔍 별칭 조회 → 표준 업체명으로 변환
        if (normalizedData.platform_name) {
            const standardName = await resolvePlatformAlias(normalizedData.platform_name);
            if (standardName) {
                normalizedData.platform_name = standardName;
                normalizedData.channel = standardName; // channel도 동기화
            }
        }
        
        // 예약번호 중복 체크 및 자동 생성
        if (normalizedData.reservation_number) {
            const checkQuery = 'SELECT id FROM reservations WHERE reservation_number = $1';
            const existingReservation = await pool.query(checkQuery, [normalizedData.reservation_number]);
            
            if (existingReservation.rows.length > 0) {
                // 중복된 예약번호가 있으면 새로운 번호 생성
                const timestamp = Date.now();
                const random = Math.random().toString(36).substr(2, 4).toUpperCase();
                normalizedData.reservation_number = `${normalizedData.reservation_number}_${random}`;
                console.log('🔄 중복 예약번호 감지, 새 번호 생성:', normalizedData.reservation_number);
            }
        }
        
        // 예약 테이블에 직접 저장
        if (dbMode === 'postgresql') {
            try {
                const insertQuery = `
                    INSERT INTO reservations (
                        reservation_number, confirmation_number, channel, platform_name,
                        product_name, package_type, total_amount, quantity, guest_count,
                        korean_name, english_first_name, english_last_name, email, phone, kakao_id,
                        people_adult, people_child, people_infant, adult_unit_price, child_unit_price,
                        usage_date, usage_time, reservation_datetime, payment_status,
                        memo, created_at, updated_at
                    ) VALUES (
                        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
                        $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, NOW(), NOW()
                    ) RETURNING id
                `;
                
                const values = [
                    normalizedData.reservation_number || null,
                    normalizedData.confirmation_number || null,
                    normalizedData.channel || '웹',
                    normalizedData.platform_name || 'NOL',
                    normalizedData.product_name || null,
                    normalizedData.package_type || null,
                    normalizedData.total_amount || null,
                    normalizedData.quantity || null,
                    normalizedData.guest_count || null,
                    normalizedData.korean_name || null,
                    normalizedData.english_first_name || null,
                    normalizedData.english_last_name || null,
                    normalizedData.email || null,
                    normalizedData.phone || null,
                    normalizedData.kakao_id || null,
                    normalizedData.people_adult || null,
                    normalizedData.people_child || null,
                    normalizedData.people_infant || null,
                    normalizedData.adult_unit_price || null,
                    normalizedData.child_unit_price || null,
                    normalizedData.usage_date || null,
                    normalizedData.usage_time || null,
                    normalizedData.reservation_datetime || null,
                    normalizedData.payment_status || 'pending', // 기본값을 대기중으로 변경
                    normalizedData.memo || null
                ];
                
                const result = await pool.query(insertQuery, values);
                const reservationId = result.rows[0].id;
                
                console.log(`✅ 예약 저장 성공 (ID: ${reservationId})`);
                
                // 자동 수배서 생성 시도 (관리자 저장)
                console.log('🔄 자동 수배서 생성 시도 (관리자):', {
                    reservationId,
                    productName: normalizedData.product_name
                });
                
                const autoAssignment = await createAutoAssignment(reservationId, normalizedData.product_name);
                
                // 수배가 생성되었으면 히스토리만 저장 (상태는 pending 유지)
                if (autoAssignment) {
                    console.log('✅ 수배업체 자동 매칭 완료:', autoAssignment.vendor.vendor_name);
                    
                    // 히스토리 저장
                    try {
                        await pool.query(`
                            INSERT INTO reservation_logs (reservation_id, action, type, changed_by, changes, details)
                            VALUES ($1, $2, $3, $4, $5, $6)
                        `, [
                            reservationId,
                            '수배업체 자동 매칭',
                            'success',
                            'system',
                            JSON.stringify({ 
                                vendor_name: autoAssignment.vendor.vendor_name
                            }),
                            `수배업체 자동 매칭: ${autoAssignment.vendor.vendor_name}`
                        ]);
                    } catch (logError) {
                        console.error('⚠️ 히스토리 저장 실패:', logError);
                    }
                }
                
                res.json({
                    success: true,
                    message: '예약이 성공적으로 저장되었습니다.',
                    reservation_id: reservationId,
                    auto_assignment: autoAssignment ? {
                        created: true,
                        vendor: autoAssignment.vendor.vendor_name,
                        assignment_id: autoAssignment.assignment.id
                    } : {
                        created: false,
                        reason: '매칭되는 수배업체가 없습니다'
                    },
                    workflow: 'reservation_saved',
                    redirect: '/admin/assignments' // 수배관리로 바로 이동
                });
                
            } catch (dbError) {
                console.error('예약 저장 오류:', dbError);
                res.json({
                    success: false,
                    message: '예약 저장 중 오류가 발생했습니다: ' + dbError.message
                });
            }
        } else {
            res.json({
                success: false,
                message: 'PostgreSQL 모드가 아닙니다.'
            });
        }
        
    } catch (error) {
        console.error('예약 저장 오류:', error);
        res.json({ 
            success: false, 
            message: '예약 처리 중 오류가 발생했습니다: ' + error.message 
        });
    }
});

// 예약 생성 API (인박스에서 사용)
app.post('/api/reservations', requireAuth, async (req, res) => {
    try {
        const reservationData = req.body;
        
        if (dbMode === 'postgresql') {
            // 예약번호 중복 체크 및 자동 생성
            if (reservationData.reservation_number) {
                const checkQuery = 'SELECT id FROM reservations WHERE reservation_number = $1';
                const existingReservation = await pool.query(checkQuery, [reservationData.reservation_number]);
                
                if (existingReservation.rows.length > 0) {
                    // 중복된 예약번호가 있으면 새로운 번호 생성
                    const timestamp = Date.now();
                    const random = Math.random().toString(36).substr(2, 4).toUpperCase();
                    reservationData.reservation_number = `${reservationData.reservation_number}_${random}`;
                    console.log('🔄 중복 예약번호 감지, 새 번호 생성:', reservationData.reservation_number);
                }
            } else {
                // 예약번호가 없으면 자동 생성
                const timestamp = Date.now();
                const random = Math.random().toString(36).substr(2, 4).toUpperCase();
                reservationData.reservation_number = `AUTO_${timestamp}_${random}`;
            }

            // 로그인한 담당자 정보 가져오기
            const assignedBy = req.session.adminName || req.session.adminUsername || '시스템';
            const createdByEmail = req.session.adminEmail || 'support@guamsavecard.com';
            console.log('👤 인박스 담당자 정보:', {
                adminName: req.session.adminName,
                adminUsername: req.session.adminUsername,
                adminEmail: req.session.adminEmail,
                assignedBy: assignedBy,
                createdByEmail: createdByEmail
            });

            const insertQuery = `
                INSERT INTO reservations (
                    reservation_number, confirmation_number, channel, platform_name,
                    product_name, package_type, total_amount, quantity, guest_count,
                    korean_name, english_first_name, english_last_name, email, phone, kakao_id,
                    people_adult, people_child, people_infant, 
                    adult_unit_price, child_unit_price, infant_unit_price,
                    adult_cost, child_cost, infant_cost,
                    adult_currency, child_currency, infant_currency,
                    adult_cost_currency, child_cost_currency, infant_cost_currency,
                    commission_rate, exchange_rate,
                    usage_date, usage_time, reservation_datetime, payment_status,
                    memo, assigned_to, created_by, created_by_email, created_at, updated_at
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
                    $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, 
                    $30, $31, $32, $33, $34, $35, $36, $37, $38, $39, $40, NOW(), NOW()
                ) RETURNING id, reservation_number
            `;
            
            const values = [
                reservationData.reservation_number,
                reservationData.confirmation_number || null,
                reservationData.channel || 'inbox',
                reservationData.platform_name || null,
                reservationData.product_name || null,
                reservationData.package_type || null,
                reservationData.total_amount || null,
                reservationData.quantity || null,
                reservationData.guest_count || null,
                reservationData.korean_name || null,
                reservationData.english_first_name || null,
                reservationData.english_last_name || null,
                reservationData.email || null,
                reservationData.phone || null,
                reservationData.kakao_id || null,
                reservationData.people_adult || null,
                reservationData.people_child || null,
                reservationData.people_infant || null,
                reservationData.adult_price || reservationData.adult_unit_price || null,
                reservationData.child_price || reservationData.child_unit_price || null,
                reservationData.infant_price || reservationData.infant_unit_price || null,
                reservationData.adult_cost || null,
                reservationData.child_cost || null,
                reservationData.infant_cost || null,
                reservationData.adult_currency || 'USD',
                reservationData.child_currency || 'USD',
                reservationData.infant_currency || 'USD',
                reservationData.adult_cost_currency || reservationData.adult_currency || 'USD',
                reservationData.child_cost_currency || reservationData.child_currency || 'USD',
                reservationData.infant_cost_currency || reservationData.infant_currency || 'USD',
                reservationData.commission_rate || 10,
                reservationData.exchange_rate || 1300,
                reservationData.usage_date || null,
                reservationData.usage_time || null,
                reservationData.reservation_datetime || null,
                reservationData.payment_status || 'pending', // 인박스에서 설정한 상태 유지, 기본값은 대기중
                reservationData.memo || null,
                assignedBy,
                assignedBy,  // created_by
                createdByEmail  // created_by_email
            ];

            const result = await pool.query(insertQuery, values);
            const newReservation = result.rows[0];
            const reservationId = newReservation.id;
            
            console.log(`✅ 예약 저장 성공 (ID: ${reservationId})`);
            
            // ✅ 수배서 생성 로직 (파싱 미리보기에서 이미 매칭됨)
            let autoAssignmentResult = null;
            
            // vendor_id가 있으면 수배서 생성 (파싱 미리보기에서 선택된 경우)
            if (reservationData.vendor_id && reservationData.vendor_id !== '' && reservationData.vendor_id !== null) {
                console.log('🏢 파싱에서 지정된 수배업체:', reservationData.vendor_id);
                
                try {
                    // 수배업체 정보 조회
                    const vendorQuery = 'SELECT * FROM vendors WHERE id = $1';
                    const vendorResult = await pool.query(vendorQuery, [reservationData.vendor_id]);
                    
                    if (vendorResult.rows.length > 0) {
                        const vendor = vendorResult.rows[0];
                        
                        // 수배서 생성
                        const crypto = require('crypto');
                        const assignment_token = crypto.randomBytes(16).toString('hex');
                        
                        const assignmentInsert = `
                            INSERT INTO assignments (
                                reservation_id, vendor_id, vendor_name, vendor_contact,
                                assignment_token, status, notes, assigned_by, assigned_at
                            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
                            RETURNING *
                        `;
                        
                        const vendor_contact = {
                            email: vendor.email,
                            phone: vendor.phone,
                            contact_person: vendor.contact_person
                        };
                        
                        const assignmentResult = await pool.query(assignmentInsert, [
                            reservationId,
                            vendor.id,
                            vendor.vendor_name,
                            JSON.stringify(vendor_contact),
                            assignment_token,
                            'pending',
                            '파싱 미리보기에서 매칭된 수배서',
                            req.session?.username || 'admin'
                        ]);
                        
                        autoAssignmentResult = {
                            vendor: vendor,
                            assignment_link: `/assignment/${assignment_token}`
                        };
                        
                        console.log(`✅ 수배서 생성 완료: ${vendor.vendor_name} (토큰: ${assignment_token})`);
                        
                        // 히스토리 저장
                        try {
                            await pool.query(`
                                INSERT INTO reservation_logs (reservation_id, action, type, changed_by, changes, details)
                                VALUES ($1, $2, $3, $4, $5, $6)
                            `, [
                                reservationId,
                                '수배업체 지정',
                                'success',
                                req.session?.username || 'admin',
                                JSON.stringify({ vendor_name: vendor.vendor_name }),
                                `파싱 미리보기에서 자동 매칭: ${vendor.vendor_name}`
                            ]);
                        } catch (logError) {
                            console.error('⚠️ 히스토리 저장 실패:', logError);
                        }
                    }
                } catch (vendorError) {
                    console.error('❌ 수배서 생성 실패:', vendorError);
                }
            } else {
                // vendor_id 없음 → 예약관리 페이지로 (수배서 미생성)
                console.log('⚠️ 수배업체 미지정 → 예약관리 페이지로 이동');
            }
            
            // 3. 바로 확정 상품인 경우 (추가 로직)
            if (reservationData.product_name && isAutoConfirmProduct(reservationData.product_name)) {
                console.log('🎯 바로 확정 상품 감지:', reservationData.product_name);
                
                // 예약 상태를 확정으로 업데이트
                await pool.query(
                    'UPDATE reservations SET payment_status = $1 WHERE id = $2',
                    ['confirmed', reservationId]
                );
            }
            
            const response = {
                success: true,
                message: '예약이 성공적으로 저장되었습니다.',
                reservation: {
                    id: newReservation.id,
                    reservation_number: newReservation.reservation_number
                }
            };
            
            // 자동 수배 결과 추가
            if (autoAssignmentResult) {
                response.auto_assignment = {
                    created: true,
                    vendor: autoAssignmentResult.vendor.vendor_name,
                    assignment_link: autoAssignmentResult.assignment_link,
                    message: `자동으로 ${autoAssignmentResult.vendor.vendor_name}에 수배서가 생성되었습니다.`
                };
                console.log('✅ 자동 수배 완료:', autoAssignmentResult.vendor.vendor_name);
            }
            
            res.json(response);
        } else {
            res.json({ success: false, message: 'PostgreSQL 모드가 아닙니다.' });
        }
        
    } catch (error) {
        console.error('예약 저장 오류:', error);
        res.status(500).json({ 
            success: false, 
            message: '예약 저장 중 오류가 발생했습니다: ' + error.message 
        });
    }
});

// 직접 예약 데이터 입력 API
app.post('/api/reservations/direct', requireAuth, async (req, res) => {
    try {
        const reservationData = req.body;
        
        // 필수 필드 검증
        const requiredFields = ['reservation_code', 'product_name', 'name_kr'];
        const missingFields = requiredFields.filter(field => !reservationData[field]);
        
        if (missingFields.length > 0) {
            return res.json({
                success: false,
                message: `필수 필드가 누락되었습니다: ${missingFields.join(', ')}`
            });
        }
        
        // 6개 테이블에 데이터 저장
        const result = await saveReservationToSixTables(reservationData);
        
        res.json({
            success: true,
            message: result.message,
            reservation_id: result.reservation_id
        });
        
    } catch (error) {
        console.error('직접 예약 입력 오류:', error);
        res.json({ 
            success: false, 
            message: '예약 저장 중 오류가 발생했습니다: ' + error.message 
        });
    }
});

// 드래프트 목록 조회 API
app.get('/api/drafts', requireAuth, async (req, res) => {
    try {
        if (dbMode !== 'postgresql') {
            return res.json({ success: false, message: 'PostgreSQL 모드가 아닙니다.' });
        }

        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;
        const status = req.query.status || '';
        const search = req.query.search || '';

        let whereClause = 'WHERE 1=1';
        let queryParams = [];
        let paramIndex = 1;

        // 상태 필터
        if (status) {
            whereClause += ` AND status = $${paramIndex}`;
            queryParams.push(status);
            paramIndex++;
        }

        // 검색 조건
        if (search) {
            whereClause += ` AND (
                raw_text ILIKE $${paramIndex} OR 
                extracted_notes ILIKE $${paramIndex} OR
                (normalized_json->>'reservation_number') ILIKE $${paramIndex} OR
                (normalized_json->>'korean_name') ILIKE $${paramIndex}
            )`;
            queryParams.push(`%${search}%`);
            paramIndex++;
        }

        // 총 개수 조회
        const countQuery = `SELECT COUNT(*) as total FROM reservation_drafts ${whereClause}`;
        const countResult = await pool.query(countQuery, queryParams);
        const totalCount = parseInt(countResult.rows[0].total);

        // 드래프트 목록 조회
        const draftsQuery = await pool.query(`
            SELECT 
                draft_id,
                raw_text,
                parsed_json,
                normalized_json,
                manual_json,
                confidence,
                extracted_notes,
                status,
                created_at,
                updated_at,
                reviewed_by,
                reviewed_at,
                committed_reservation_id
            FROM reservation_drafts 
            ${whereClause}
            ORDER BY created_at DESC 
            LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
        `, [...queryParams, limit, offset]);

        const drafts = draftsQuery.rows.map(draft => {
            // JSON 필드 파싱
            try {
                if (draft.parsed_json && typeof draft.parsed_json === 'string') {
                    draft.parsed_json = JSON.parse(draft.parsed_json);
                }
                if (draft.normalized_json && typeof draft.normalized_json === 'string') {
                    draft.normalized_json = JSON.parse(draft.normalized_json);
                }
                if (draft.manual_json && typeof draft.manual_json === 'string') {
                    draft.manual_json = JSON.parse(draft.manual_json);
                }
            } catch (parseError) {
                console.warn('JSON 파싱 오류:', parseError);
            }
            return draft;
        });

        const totalPages = Math.ceil(totalCount / limit);

        res.json({
            success: true,
            drafts: drafts,
            pagination: {
                page: page,
                totalPages: totalPages,
                totalCount: totalCount,
                hasNext: page < totalPages,
                hasPrev: page > 1
            }
        });

    } catch (error) {
        console.error('드래프트 목록 조회 오류:', error);
        res.json({
            success: false,
            message: '드래프트 목록 조회 중 오류가 발생했습니다: ' + error.message
        });
    }
});

// 드래프트 상세 조회 API
app.get('/api/drafts/:id', requireAuth, async (req, res) => {
    try {
        if (dbMode !== 'postgresql') {
            return res.json({ success: false, message: 'PostgreSQL 모드가 아닙니다.' });
        }

        const draftId = req.params.id;
        
        const query = `
            SELECT 
                draft_id as id,
                raw_text,
                parsed_json,
                normalized_json,
                manual_json,
                confidence,
                extracted_notes,
                status,
                created_at,
                updated_at,
                reviewed_by,
                reviewed_at,
                committed_reservation_id
            FROM reservation_drafts 
            WHERE draft_id = $1
        `;
        
        const result = await pool.query(query, [draftId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '드래프트를 찾을 수 없습니다.'
            });
        }
        
        const draft = result.rows[0];
        
        // JSON 필드 파싱 및 정규화된 데이터 추출
        try {
            if (draft.parsed_json && typeof draft.parsed_json === 'string') {
                draft.parsed_json = JSON.parse(draft.parsed_json);
            }
            if (draft.normalized_json && typeof draft.normalized_json === 'string') {
                draft.normalized_json = JSON.parse(draft.normalized_json);
            }
            if (draft.manual_json && typeof draft.manual_json === 'string') {
                draft.manual_json = JSON.parse(draft.manual_json);
            }
            
            // 최종 데이터 (manual_json > normalized_json > parsed_json 순서)
            const finalData = draft.manual_json || draft.normalized_json || draft.parsed_json || {};
            
            // UI에서 사용할 수 있도록 필드명 매핑
            draft.reservation_code = finalData.reservation_number || finalData.reservation_code;
            draft.platform_name = finalData.platform;
            draft.product_name = finalData.product_name;
            draft.total_price = finalData.total_price;
            draft.name_kr = finalData.korean_name;
            draft.name_en_first = finalData.english_first_name;
            draft.name_en_last = finalData.english_last_name;
            draft.email = finalData.email;
            draft.phone = finalData.phone;
            draft.usage_date = finalData.usage_date;
            draft.usage_time = finalData.usage_time;
            draft.people_adult = finalData.adult_count;
            draft.people_child = finalData.child_count;
            draft.people_infant = finalData.infant_count;
            
        } catch (parseError) {
            console.warn('JSON 파싱 오류:', parseError);
        }
        
        res.json({
            success: true,
            draft: draft
        });
        
    } catch (error) {
        console.error('드래프트 상세 조회 오류:', error);
        res.status(500).json({
            success: false,
            message: '드래프트 정보를 불러오는 중 오류가 발생했습니다.'
        });
    }
});

// 드래프트 승인 API (최종 예약으로 등록)
app.post('/api/drafts/:id/approve', requireAuth, async (req, res) => {
    const client = await pool.connect();
    
    try {
        if (dbMode !== 'postgresql') {
            return res.json({ success: false, message: 'PostgreSQL 모드가 아닙니다.' });
        }

        await client.query('BEGIN');
        
        const draftId = req.params.id;
        
        // 드래프트 조회
        const draftQuery = `
            SELECT 
                draft_id,
                raw_text,
                parsed_json,
                normalized_json,
                manual_json,
                confidence,
                extracted_notes,
                status
            FROM reservation_drafts 
            WHERE draft_id = $1 AND status = 'pending'
        `;
        const draftResult = await client.query(draftQuery, [draftId]);
        
        if (draftResult.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({
                success: false,
                message: '승인 가능한 드래프트를 찾을 수 없습니다.'
            });
        }
        
        const draft = draftResult.rows[0];
        
        // JSON 데이터 파싱
        let finalData = {};
        try {
            const parsedJson = typeof draft.parsed_json === 'string' ? JSON.parse(draft.parsed_json) : draft.parsed_json;
            const normalizedJson = typeof draft.normalized_json === 'string' ? JSON.parse(draft.normalized_json) : draft.normalized_json;
            const manualJson = typeof draft.manual_json === 'string' ? JSON.parse(draft.manual_json) : draft.manual_json;
            
            finalData = manualJson || normalizedJson || parsedJson || {};
        } catch (parseError) {
            console.warn('JSON 파싱 오류:', parseError);
            await client.query('ROLLBACK');
            return res.status(400).json({
                success: false,
                message: '드래프트 데이터 파싱 중 오류가 발생했습니다.'
            });
        }
        
        // 예약번호 중복 확인
        const reservationCode = finalData.reservation_number || finalData.reservation_code;
        if (reservationCode) {
            const duplicateQuery = 'SELECT id FROM reservations WHERE reservation_code = $1';
            const duplicateResult = await client.query(duplicateQuery, [reservationCode]);
            
            if (duplicateResult.rows.length > 0) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    success: false,
                    message: '이미 존재하는 예약번호입니다. 드래프트를 수정해주세요.'
                });
            }
        }
        
        // 최종 예약으로 등록
        const insertQuery = `
            INSERT INTO reservations (
                reservation_code, platform_name, product_name, total_price,
                name_kr, name_en_first, name_en_last, email, phone,
                usage_date, usage_time, people_adult, people_child, people_infant,
                memo, payment_status, card_status, created_at, updated_at
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 
                COALESCE($16, 'pending'), 'pending', NOW(), NOW()
            ) RETURNING id
        `;
        
        const insertResult = await client.query(insertQuery, [
            reservationCode,
            finalData.platform,
            finalData.product_name,
            finalData.total_price,
            finalData.korean_name,
            finalData.english_first_name,
            finalData.english_last_name,
            finalData.email,
            finalData.phone,
            finalData.usage_date,
            finalData.usage_time,
            finalData.adult_count,
            finalData.child_count,
            finalData.infant_count,
            finalData.memo,
            finalData.payment_status
        ]);
        
        // 드래프트 상태를 'reviewed'로 업데이트
        const updateQuery = `
            UPDATE reservation_drafts 
            SET status = 'reviewed', 
                reviewed_at = NOW(),
                reviewed_by = 'admin',
                committed_reservation_id = $1
            WHERE draft_id = $2
        `;
        await client.query(updateQuery, [insertResult.rows[0].id, draftId]);
        
        await client.query('COMMIT');
        
        res.json({
            success: true,
            message: '드래프트가 승인되어 예약으로 등록되었습니다.',
            reservation_id: insertResult.rows[0].id
        });
        
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('드래프트 승인 오류:', error);
        res.status(500).json({
            success: false,
            message: '드래프트 승인 중 오류가 발생했습니다.'
        });
    } finally {
        client.release();
    }
});

// 드래프트 반려 API
app.post('/api/drafts/:id/reject', requireAuth, async (req, res) => {
    try {
        if (dbMode !== 'postgresql') {
            return res.json({ success: false, message: 'PostgreSQL 모드가 아닙니다.' });
        }

        const draftId = req.params.id;
        const { reason } = req.body;
        
        if (!reason || reason.trim() === '') {
            return res.status(400).json({
                success: false,
                message: '반려 사유를 입력해주세요.'
            });
        }
        
        // 드래프트 상태를 'rejected'로 업데이트
        const updateQuery = `
            UPDATE reservation_drafts 
            SET status = 'rejected', 
                extracted_notes = COALESCE(extracted_notes, '') || E'\n[반려 사유] ' || $1,
                reviewed_at = NOW(),
                reviewed_by = 'admin'
            WHERE draft_id = $2 AND status = 'pending'
            RETURNING draft_id
        `;
        
        const result = await pool.query(updateQuery, [reason, draftId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '반려 가능한 드래프트를 찾을 수 없습니다.'
            });
        }
        
        res.json({
            success: true,
            message: '드래프트가 반려되었습니다.'
        });
        
    } catch (error) {
        console.error('드래프트 반려 오류:', error);
        res.status(500).json({
            success: false,
            message: '드래프트 반려 중 오류가 발생했습니다.'
        });
    }
});

// 예약 히스토리 조회 API
// 구버전 히스토리 API (사용 안함 - 새로운 API로 대체됨)
/*
app.get('/api/reservations/:id/history', requireAuth, async (req, res) => {
    // 이 API는 더 이상 사용되지 않습니다.
    // 새로운 API는 8674번째 줄에 구현되어 있습니다.
});
*/

// 예약 삭제 API
app.delete('/api/reservations/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        
        const result = await pool.query(
            'DELETE FROM reservations WHERE id = $1 RETURNING *',
            [id]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '예약을 찾을 수 없습니다.'
            });
        }
        
        res.json({
            success: true,
            message: '예약이 삭제되었습니다.'
        });
    } catch (error) {
        console.error('❌ 예약 삭제 오류:', error);
        res.status(500).json({
            success: false,
            message: '예약 삭제 중 오류가 발생했습니다.'
        });
    }
});

// 예약 코드 생성 API
app.post('/api/reservations/:id/generate-code', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        
        // 예약 정보 조회
        const reservationResult = await pool.query(
            'SELECT * FROM reservations WHERE id = $1',
            [id]
        );
        
        if (reservationResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '예약을 찾을 수 없습니다.'
            });
        }
        
        const reservation = reservationResult.rows[0];
        
        // 이미 코드가 발급된 경우
        if (reservation.code_issued) {
            return res.status(400).json({
                success: false,
                message: '이미 코드가 발급된 예약입니다.'
            });
        }
        
        // 세이브카드 코드 생성 (간단한 형태로 구현)
        const saveCardCode = `SC${Date.now()}${Math.random().toString(36).substr(2, 4).toUpperCase()}`;
        
        // 예약 상태 업데이트
        const updateResult = await pool.query(
            'UPDATE reservations SET code_issued = true, code_issued_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = $1 RETURNING *',
            [id]
        );
        
        res.json({
            success: true,
            message: '세이브카드 코드가 생성되었습니다.',
            data: {
                saveCardCode: saveCardCode
            }
        });
    } catch (error) {
        console.error('❌ 코드 생성 오류:', error);
        res.status(500).json({
            success: false,
            message: '코드 생성 중 오류가 발생했습니다.'
        });
    }
});

// 예약 상세 조회 API
app.get('/api/reservations/:id', requireAuth, async (req, res) => {
    try {
        const reservationId = req.params.id;
        const reservation = await getReservationById(reservationId);
        
        if (!reservation) {
            return res.json({
                success: false,
                message: '예약을 찾을 수 없습니다.'
            });
        }
        
        res.json({
            success: true,
            data: reservation
        });
        
    } catch (error) {
        console.error('예약 조회 오류:', error);
        res.json({ 
            success: false, 
            message: '예약 조회 중 오류가 발생했습니다: ' + error.message 
        });
    }
});

// 예약 수정 API (구버전 - 6개 테이블 사용, 사용 안함)
/*
app.put('/api/reservations/:id', requireAuth, async (req, res) => {
    try {
        const reservationId = req.params.id;
        const updateData = req.body;
        
        // 예약 존재 확인
        const existingReservation = await getReservationById(reservationId);
        if (!existingReservation) {
            return res.json({
                success: false,
                message: '예약을 찾을 수 없습니다.'
            });
        }
        
        // 6개 테이블 업데이트
        const result = await updateReservationInSixTables(reservationId, updateData);
        
        res.json({
            success: true,
            message: result.message
        });
        
    } catch (error) {
        console.error('예약 수정 오류:', error);
        res.json({ 
            success: false, 
            message: '예약 수정 중 오류가 발생했습니다: ' + error.message 
        });
    }
});
*/

// 예약 수정 API (예약관리 페이지용)
app.patch('/api/reservations/:id', requireAuth, async (req, res) => {
    try {
        const reservationId = req.params.id;
        const updateData = req.body;
        
        console.log('📝 예약 수정 요청:', {
            id: reservationId,
            data: updateData
        });
        
        // 예약 존재 확인
        const checkQuery = 'SELECT * FROM reservations WHERE id = $1';
        const checkResult = await pool.query(checkQuery, [reservationId]);
        
        if (checkResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '예약을 찾을 수 없습니다.'
            });
        }
        
        // 업데이트할 필드 동적 생성
        const fields = [];
        const values = [];
        let paramIndex = 1;
        
        // 코어 필드 매핑 (DB에 실제 존재하는 컬럼만)
        const fieldMapping = {
            reservation_number: 'reservation_number',
            platform_name: 'platform_name',
            payment_status: 'payment_status',
            product_name: 'product_name',
            package_type: 'package_type',
            usage_date: 'usage_date',
            usage_time: 'usage_time',
            reservation_datetime: 'reservation_datetime',
            korean_name: 'korean_name',
            english_first_name: 'english_first_name',
            english_last_name: 'english_last_name',
            phone: 'phone',
            email: 'email',
            kakao_id: 'kakao_id',
            people_adult: 'people_adult',
            people_child: 'people_child',
            people_infant: 'people_infant',
            adult_unit_price: 'adult_unit_price',
            child_unit_price: 'child_unit_price',
            // infant_unit_price는 DB 컬럼이 없으므로 제외
            memo: 'memo',
            total_amount: 'total_amount'
        };
        
        // 제공된 필드만 업데이트
        for (const [key, dbColumn] of Object.entries(fieldMapping)) {
            if (updateData.hasOwnProperty(key)) {
                fields.push(`${dbColumn} = $${paramIndex}`);
                values.push(updateData[key]);
                paramIndex++;
            }
        }
        
        // 업데이트할 필드가 없으면 에러
        if (fields.length === 0) {
            return res.status(400).json({
                success: false,
                message: '업데이트할 데이터가 없습니다.'
            });
        }
        
        // updated_at 자동 추가
        fields.push(`updated_at = NOW()`);
        
        // 예약 ID 추가
        values.push(reservationId);
        
        // UPDATE 쿼리 실행
        const updateQuery = `
            UPDATE reservations 
            SET ${fields.join(', ')} 
            WHERE id = $${paramIndex}
            RETURNING *
        `;
        
        console.log('🔄 UPDATE 쿼리:', updateQuery);
        console.log('📊 VALUES:', values);
        
        const result = await pool.query(updateQuery, values);
        
        if (result.rows.length === 0) {
            return res.status(500).json({
                success: false,
                message: '예약 수정에 실패했습니다.'
            });
        }
        
        console.log('✅ 예약 수정 완료:', result.rows[0]);
        
        res.json({
            success: true,
            message: '예약이 성공적으로 수정되었습니다.',
            reservation: result.rows[0]
        });
        
    } catch (error) {
        console.error('❌ 예약 수정 오류:', error);
        res.status(500).json({ 
            success: false, 
            message: '예약 수정 중 오류가 발생했습니다: ' + error.message,
            error: error.stack
        });
    }
});

// 예약 삭제 API
app.delete('/api/reservations/:id', requireAuth, async (req, res) => {
    try {
        const reservationId = req.params.id;
        
        // 예약 존재 확인
        const existingReservation = await getReservationById(reservationId);
        if (!existingReservation) {
            return res.json({
                success: false,
                message: '예약을 찾을 수 없습니다.'
            });
        }
        
        // 6개 테이블에서 삭제
        const result = await deleteReservationFromSixTables(reservationId);
        
        res.json({
            success: true,
            message: result.message
        });
        
    } catch (error) {
        console.error('예약 삭제 오류:', error);
        res.json({ 
            success: false, 
            message: '예약 삭제 중 오류가 발생했습니다: ' + error.message 
        });
    }
});

// 코드 생성 API
app.post('/api/reservations/:id/generate-code', requireAuth, async (req, res) => {
    try {
        const reservationId = req.params.id;
        
        // 예약 존재 확인
        const reservation = await getReservationById(reservationId);
        if (!reservation) {
            return res.json({
                success: false,
                message: '예약을 찾을 수 없습니다.'
            });
        }
        
        // 결제 상태를 '완료'로 업데이트
        await pool.query(`
            UPDATE reservation_payments 
            SET payment_status = '완료', payment_date = CURRENT_TIMESTAMP
            WHERE reservation_id = $1
        `, [reservationId]);
        
        res.json({
            success: true,
            message: '코드가 성공적으로 발급되었습니다.'
        });
        
    } catch (error) {
        console.error('코드 생성 오류:', error);
        res.json({ 
            success: false, 
            message: '코드 생성 중 오류가 발생했습니다: ' + error.message 
        });
    }
});

// ==================== ERP API 라우트 ====================

// API 상태 확인 엔드포인트 (공개)
app.get('/api/status', async (req, res) => {
    try {
        // 데이터베이스 연결 테스트
        const dbTest = await pool.query('SELECT NOW() as current_time');
        
        // 테이블 존재 확인
        const tables = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name IN ('reservations', 'field_defs', 'reservation_audits', 'assignments', 'settlements')
            ORDER BY table_name
        `);
        
        // 마이그레이션 상태 확인
        const migrationStatus = await pool.query(`
            SELECT version, description, executed_at 
            FROM migration_log 
            ORDER BY executed_at DESC 
            LIMIT 5
        `).catch(() => ({ rows: [] }));
        
        res.json({
            success: true,
            timestamp: dbTest.rows[0].current_time,
            tables: tables.rows.map(r => r.table_name),
            migrations: migrationStatus.rows,
            message: 'API 서버가 정상 작동 중입니다.'
        });
        
    } catch (error) {
        console.error('API 상태 확인 오류:', error);
        res.status(500).json({
            success: false,
            message: 'API 서버 오류: ' + error.message
        });
    }
});

// 예약 목록 API (새로운 /bookings용)
app.get('/api/bookings', requireAuth, async (req, res) => {
    try {
        console.log('📋 /api/bookings 요청 받음:', req.query);
        
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;
        const search = req.query.search || '';
        const status = req.query.status || '';
        
        // 테이블 존재 확인
        const tableCheck = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_name = 'reservations'
        `);
        
        if (tableCheck.rows.length === 0) {
            return res.status(500).json({
                success: false,
                message: 'reservations 테이블이 존재하지 않습니다.'
            });
        }
        
        // extras 컬럼 존재 확인
        const columnCheck = await pool.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'reservations' AND column_name = 'extras'
        `);
        
        const hasExtras = columnCheck.rows.length > 0;
        console.log('📊 extras 컬럼 존재:', hasExtras);
        
        let whereClause = 'WHERE 1=1';
        const params = [];
        let paramCount = 0;
        
        if (search) {
            paramCount++;
            whereClause += ` AND (customer_name ILIKE $${paramCount} OR customer_email ILIKE $${paramCount} OR customer_phone ILIKE $${paramCount})`;
            params.push(`%${search}%`);
        }
        
        if (status) {
            paramCount++;
            whereClause += ` AND status = $${paramCount}`;
            params.push(status);
        }
        
        const extrasSelect = hasExtras ? "COALESCE(r.extras, '{}') as extras," : "'{}' as extras,";
        
        const query = `
            SELECT r.*, 
                   ${extrasSelect}
                   COUNT(*) OVER() as total_count
            FROM reservations r 
            ${whereClause}
            ORDER BY r.created_at DESC 
            LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
        `;
        
        params.push(limit, offset);
        
        console.log('🔍 실행할 쿼리:', query);
        console.log('📝 파라미터:', params);
        
        const result = await pool.query(query, params);
        const totalCount = result.rows.length > 0 ? parseInt(result.rows[0].total_count) : 0;
        
        console.log('✅ 조회 결과:', result.rows.length, '개');
        
        res.json({
            success: true,
            data: result.rows,
            pagination: {
                page,
                limit,
                total: totalCount,
                totalPages: Math.ceil(totalCount / limit)
            }
        });
        
    } catch (error) {
        console.error('❌ 예약 목록 조회 오류:', error);
        res.status(500).json({
            success: false,
            message: '예약 목록을 불러오는 중 오류가 발생했습니다: ' + error.message
        });
    }
});

// 예약 상세 조회 API
app.get('/api/bookings/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        
        // 예약 기본 정보
        const reservationQuery = `
            SELECT r.*, 
                   COALESCE(r.extras, '{}') as extras
            FROM reservations r 
            WHERE r.id = $1
        `;
        
        const reservationResult = await pool.query(reservationQuery, [id]);
        
        if (reservationResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '예약을 찾을 수 없습니다.'
            });
        }
        
        const reservation = reservationResult.rows[0];
        
        // 감사 로그 조회
        const auditQuery = `
            SELECT * FROM reservation_audits 
            WHERE reservation_id = $1 
            ORDER BY changed_at DESC 
            LIMIT 50
        `;
        
        const auditResult = await pool.query(auditQuery, [id]).catch(() => ({ rows: [] }));
        
        // 수배 정보 조회
        const assignmentQuery = `
            SELECT * FROM assignments 
            WHERE reservation_id = $1 
            ORDER BY created_at DESC
        `;
        
        const assignmentResult = await pool.query(assignmentQuery, [id]).catch(() => ({ rows: [] }));
        
        res.json({
            success: true,
            data: {
                reservation,
                audits: auditResult.rows,
                assignments: assignmentResult.rows
            }
        });
        
    } catch (error) {
        console.error('예약 상세 조회 오류:', error);
        res.status(500).json({
            success: false,
            message: '예약 정보를 불러오는 중 오류가 발생했습니다.'
        });
    }
});

// 예약 수정 API (코어 + extras 동시 수정)
app.patch('/api/bookings/:id', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { coreData, extrasData } = req.body;
        
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');
            
            // 기존 데이터 조회 (감사 로그용)
            const oldDataResult = await client.query(
                'SELECT *, COALESCE(extras, \'{}\') as extras FROM reservations WHERE id = $1',
                [id]
            );
            
            if (oldDataResult.rows.length === 0) {
                throw new Error('예약을 찾을 수 없습니다.');
            }
            
            const oldData = oldDataResult.rows[0];
            
            // 코어 데이터 업데이트
            if (coreData) {
                const setClauses = [];
                const values = [];
                let paramCount = 0;
                
                Object.entries(coreData).forEach(([key, value]) => {
                    if (key !== 'id' && key !== 'created_at') {
                        paramCount++;
                        setClauses.push(`${key} = $${paramCount}`);
                        values.push(value);
                    }
                });
                
                if (setClauses.length > 0) {
                    paramCount++;
                    setClauses.push(`updated_at = NOW()`);
                    values.push(id);
                    
                    const updateQuery = `
                        UPDATE reservations 
                        SET ${setClauses.join(', ')} 
                        WHERE id = $${paramCount}
                    `;
                    
                    await client.query(updateQuery, values);
                }
            }
            
            // extras 데이터 업데이트 (deep merge)
            if (extrasData) {
                const updateExtrasQuery = `
                    UPDATE reservations 
                    SET extras = COALESCE(extras, '{}') || $1::jsonb,
                        updated_at = NOW()
                    WHERE id = $2
                `;
                
                await client.query(updateExtrasQuery, [JSON.stringify(extrasData), id]);
            }
            
            // 업데이트된 데이터 조회
            const newDataResult = await client.query(
                'SELECT *, COALESCE(extras, \'{}\') as extras FROM reservations WHERE id = $1',
                [id]
            );
            
            const newData = newDataResult.rows[0];
            
            // 감사 로그 기록
            const auditQuery = `
                INSERT INTO reservation_audits (
                    reservation_id, action, changed_by, old_values, new_values, 
                    ip_address, user_agent
                ) VALUES ($1, $2, $3, $4, $5, $6, $7)
            `;
            
            await client.query(auditQuery, [
                id,
                'update',
                req.session.adminUsername || 'admin',
                JSON.stringify(oldData),
                JSON.stringify(newData),
                req.ip,
                req.get('User-Agent')
            ]).catch(err => console.log('감사 로그 기록 실패:', err));
            
            await client.query('COMMIT');
            
            res.json({
                success: true,
                message: '예약이 수정되었습니다.',
                data: newData
            });
            
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
        
    } catch (error) {
        console.error('예약 수정 오류:', error);
        res.status(500).json({
            success: false,
            message: '예약 수정 중 오류가 발생했습니다: ' + error.message
        });
    }
});

// field_defs 조회 API
app.get('/api/field-defs', requireAuth, async (req, res) => {
    try {
        console.log('📋 /api/field-defs 요청 받음');
        
        // 테이블 존재 확인
        const tableCheck = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_name = 'field_defs'
        `);
        
        if (tableCheck.rows.length === 0) {
            console.log('❌ field_defs 테이블이 존재하지 않음');
            return res.json({
                success: false,
                message: 'field_defs 테이블이 존재하지 않습니다.',
                data: []
            });
        }
        
        // 컬럼 구조 확인
        const columnCheck = await pool.query(`
            SELECT column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name = 'field_defs'
            ORDER BY ordinal_position
        `);
        
        console.log('📊 field_defs 테이블 컬럼:', columnCheck.rows);
        
        // 데이터 조회 (컬럼명 확인 후)
        const hasIsActive = columnCheck.rows.some(col => col.column_name === 'is_active');
        const hasFieldGroup = columnCheck.rows.some(col => col.column_name === 'field_group');
        const hasSortOrder = columnCheck.rows.some(col => col.column_name === 'sort_order');
        const hasFieldName = columnCheck.rows.some(col => col.column_name === 'field_name');
        
        let query = 'SELECT * FROM field_defs';
        let whereClause = '';
        let orderClause = ' ORDER BY id';
        
        if (hasIsActive) {
            whereClause = ' WHERE is_active = true';
        }
        
        if (hasFieldGroup && hasSortOrder && hasFieldName) {
            orderClause = ' ORDER BY field_group, sort_order, field_name';
        } else if (hasFieldName) {
            orderClause = ' ORDER BY field_name';
        }
        
        const finalQuery = query + whereClause + orderClause;
        console.log('🔍 실행할 쿼리:', finalQuery);
        
        const result = await pool.query(finalQuery);
        
        console.log('✅ field_defs 조회 결과:', result.rows.length, '개');
        
        res.json({
            success: true,
            data: result.rows,
            meta: {
                count: result.rows.length,
                columns: columnCheck.rows.map(col => col.column_name)
            }
        });
        
    } catch (error) {
        console.error('❌ field_defs 조회 오류:', error);
        res.json({
            success: false,
            message: 'field_defs를 불러올 수 없습니다: ' + error.message,
            data: [],
            error: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

// 수배서 생성 API
app.post('/api/assignments', requireAuth, async (req, res) => {
    try {
        const { reservation_id, vendor_id, notes, status } = req.body;
        console.log('🔧 수배서 생성 요청:', { reservation_id, vendor_id, notes, status });

        // 예약 정보 조회 (vendor_id 컬럼이 없으므로 reservations 테이블만 조회)
        const reservationQuery = `
            SELECT r.*
            FROM reservations r
            WHERE r.id = $1
        `;
        const reservationResult = await pool.query(reservationQuery, [reservation_id]);
        
        if (reservationResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: '예약을 찾을 수 없습니다.' });
        }

        const reservation = reservationResult.rows[0];

        // 수배업체 정보 조회 (vendor_id가 제공된 경우)
        let vendor_info = null;
        if (vendor_id) {
            const vendorQuery = `SELECT * FROM vendors WHERE id = $1`;
            const vendorResult = await pool.query(vendorQuery, [vendor_id]);
            if (vendorResult.rows.length > 0) {
                vendor_info = vendorResult.rows[0];
            }
        }

        // 고유 토큰 생성
        const crypto = require('crypto');
        const assignment_token = crypto.randomBytes(16).toString('hex');

        // 수배서 생성
        const assignmentStatus = status || 'sent';
        const sentAt = assignmentStatus === 'draft' ? null : 'NOW()';  // draft는 전송 안됨
        
        const insertQuery = `
            INSERT INTO assignments (
                reservation_id, vendor_id, vendor_name, vendor_contact,
                assignment_token, status, notes, assigned_by, assigned_at, sent_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), ${sentAt})
            RETURNING *
        `;

        const vendor_contact = vendor_info ? {
            email: vendor_info.email,
            phone: vendor_info.phone,
            contact_person: vendor_info.contact_person
        } : {};

        console.log('📋 수배서 생성:', { status: assignmentStatus, sent_at: sentAt });

        const assignmentResult = await pool.query(insertQuery, [
            reservation_id,
            vendor_id || null,
            vendor_info ? vendor_info.vendor_name : '미지정',
            JSON.stringify(vendor_contact),
            assignment_token,
            assignmentStatus,
            notes || `수배서 생성 (${reservation.product_name})`,
            req.session.adminUsername || 'admin'
        ]);

        // 예약 상태 변경 (draft는 pending 유지, sent는 in_progress로 변경)
        if (assignmentStatus !== 'draft') {
            await pool.query(`
                UPDATE reservations 
                SET payment_status = 'in_progress', updated_at = NOW()
                WHERE id = $1
            `, [reservation_id]);
            console.log('✅ 예약 상태 변경: in_progress (수배중)');
        } else {
            console.log('✅ 예약 상태 유지: pending (신규예약)');
        }

        const assignment = assignmentResult.rows[0];
        const assignment_link = `/assignment/${assignment_token}`;

        console.log('✅ 수배서 생성 완료:', assignment_link);

        res.json({
            success: true,
            message: '수배서가 생성되었습니다.',
            data: {
                assignment: assignment,
                assignment_link: assignment_link,
                assignment_token: assignment_token
            }
        });

    } catch (error) {
        console.error('❌ 수배서 생성 오류:', error);
        res.status(500).json({ success: false, message: '수배서 생성 중 오류가 발생했습니다: ' + error.message });
    }
});


// 수배서 페이지 라우트
app.get('/assignment/:token', async (req, res) => {
    try {
        const { token } = req.params;
        const isPreview = req.query.preview === 'true' || req.query.preview === '1';
        
        console.log('🔍 수배서 페이지 요청:', token);
        console.log('🔍 미리보기 모드:', isPreview);
        console.log('🔍 요청 시간:', new Date().toISOString());
        console.log('🔍 DB 연결 상태:', pool ? 'OK' : 'NULL');

        // 토큰 유효성 검사
        if (!token || token.length < 10) {
            console.error('❌ 유효하지 않은 토큰:', token);
            return res.status(400).send(`
                <html>
                    <head><title>잘못된 수배서 링크</title></head>
                    <body>
                        <h1>잘못된 수배서 링크</h1>
                        <p>수배서 토큰이 유효하지 않습니다.</p>
                        <p>토큰: ${token}</p>
                        <button onclick="window.close()">닫기</button>
                    </body>
                </html>
            `);
        }

        // 수배서 정보 조회 (기본 컬럼만 사용)
        console.log('🔍 DB 쿼리 시작');
        const query = `
            SELECT 
                a.id as assignment_id,
                a.assignment_token,
                a.reservation_id,
                a.vendor_id,
                a.status as assignment_status,
                a.assigned_at,
                a.sent_at,
                a.viewed_at,
                a.notes,
                r.id as reservation_id,
                r.reservation_number,
                r.korean_name as customer_name,
                r.english_first_name,
                r.english_last_name,
                r.platform_name,
                r.product_name,
                r.usage_date as departure_date,
                r.usage_date,
                r.usage_time,
                r.people_adult as adult_count,
                r.people_child as child_count,
                r.people_infant,
                r.total_amount,
                r.phone as phone_number,
                r.email,
                r.package_type,
                r.memo as special_requests,
                r.created_by,
                r.created_by_email
            FROM assignments a
            JOIN reservations r ON a.reservation_id = r.id
            WHERE a.assignment_token = $1
        `;

        console.log('🔍 실행할 쿼리:', query);
        console.log('🔍 토큰 파라미터:', token);

        const result = await pool.query(query, [token]);
        console.log('🔍 쿼리 결과 개수:', result.rows.length);

        if (result.rows.length === 0) {
            console.log('❌ 수배서를 찾을 수 없음:', token);
            
            // 토큰이 존재하는지 별도 확인
            const tokenCheck = await pool.query('SELECT assignment_token FROM assignments WHERE assignment_token = $1', [token]);
            console.log('🔍 토큰 존재 확인:', tokenCheck.rows.length > 0 ? '존재함' : '존재하지 않음');
            
            return res.status(404).send(`
                <html>
                    <head><title>수배서를 찾을 수 없습니다</title></head>
                    <body>
                        <h1>수배서를 찾을 수 없습니다</h1>
                        <p>요청하신 수배서를 찾을 수 없습니다.</p>
                        <p><strong>토큰:</strong> ${token}</p>
                        <p><strong>토큰 길이:</strong> ${token.length}</p>
                        <p><strong>토큰 존재 여부:</strong> ${tokenCheck.rows.length > 0 ? '존재함' : '존재하지 않음'}</p>
                        <hr>
                        <p><small>이 정보를 개발자에게 전달해주세요.</small></p>
                        <button onclick="window.close()">닫기</button>
                    </body>
                </html>
            `);
        }

        const assignment = result.rows[0];
        console.log('✅ 수배서 조회 성공:', assignment.reservation_number);
        console.log('🔍 assignment 데이터 키들:', Object.keys(assignment));

        // 수배업체 정보 추가 조회
        if (assignment.vendor_id) {
            const vendorQuery = `SELECT vendor_name, email, phone, contact_person, notification_email FROM vendors WHERE id = $1`;
            const vendorResult = await pool.query(vendorQuery, [assignment.vendor_id]);
            if (vendorResult.rows.length > 0) {
                const vendor = vendorResult.rows[0];
                assignment.assignment_vendor = vendor.vendor_name;
                assignment.vendor_email = vendor.email;
                assignment.vendor_phone = vendor.phone;
                assignment.vendor_contact_person = vendor.contact_person;
                assignment.vendor_notification_email = vendor.notification_email;
            }
        }

        // 수배업체 정보가 없으면 '미지정'으로 표시
        if (!assignment.assignment_vendor) {
            assignment.assignment_vendor = '미지정';
        }

        // 필수 필드들 null 체크 및 기본값 설정
        const safeAssignment = {
            ...assignment,
            reservation_number: assignment.reservation_number || 'N/A',
            customer_name: assignment.customer_name || '미지정',
            product_name: assignment.product_name || '미지정',
            platform_name: assignment.platform_name || '미지정',
            assignment_vendor: assignment.assignment_vendor || '미지정',
            adult_count: assignment.adult_count || 0,
            child_count: assignment.child_count || 0,
            people_infant: assignment.people_infant || 0,
            phone_number: assignment.phone_number || '-',
            email: assignment.email || '-',
            package_type: assignment.package_type || '-',
            special_requests: assignment.special_requests || '-',
            usage_time: assignment.usage_time || '-'
        };

        console.log('🔍 안전한 assignment 객체 생성 완료');
        console.log('🔍 주요 필드 확인:');
        console.log('  - reservation_number:', safeAssignment.reservation_number);
        console.log('  - customer_name:', safeAssignment.customer_name);
        console.log('  - product_name:', safeAssignment.product_name);

        // ✅ 첫 열람 기록 (GET 요청 자체에서 처리 - JavaScript 없이도 작동!)
        // 미리보기가 아니고 아직 열람되지 않은 경우에만 기록
        if (!isPreview && !assignment.viewed_at) {
            console.log('🆕 첫 열람 감지! 서버 사이드에서 viewed_at 업데이트...');
            
            try {
                // IP 주소 추출
                const ip_address = req.headers['x-forwarded-for']?.split(',')[0].trim() 
                    || req.headers['x-real-ip'] 
                    || req.connection.remoteAddress 
                    || req.socket.remoteAddress 
                    || 'Unknown';
                
                const user_agent = req.headers['user-agent'] || 'Unknown';
                
                console.log('📍 IP:', ip_address);
                console.log('📱 User-Agent:', user_agent);
                
                // 1. assignments.viewed_at 업데이트 및 상태 변경
                const updateResult = await pool.query(`
                    UPDATE assignments 
                    SET viewed_at = NOW(), 
                        updated_at = NOW(),
                        status = CASE 
                            WHEN status = 'draft' THEN 'sent'
                            ELSE status 
                        END
                    WHERE assignment_token = $1 AND viewed_at IS NULL
                    RETURNING id, viewed_at, status
                `, [token]);
                
                if (updateResult.rows.length > 0) {
                    console.log('✅ 수배서 viewed_at 업데이트 성공:', updateResult.rows[0]);
                    
                    // 2. assignment_views 테이블에 기본 열람 이력 저장
                    try {
                        await pool.query(`
                            INSERT INTO assignment_views (
                                assignment_token, reservation_id, viewed_at,
                                ip_address, user_agent, referrer
                            ) VALUES ($1, $2, NOW(), $3, $4, $5)
                        `, [
                            token,
                            assignment.reservation_id,
                            ip_address,
                            user_agent,
                            req.headers.referer || 'Direct'
                        ]);
                        console.log('✅ 기본 열람 이력 저장 완료 (서버 사이드)');
                    } catch (viewError) {
                        console.log('⚠️ 열람 이력 저장 실패 (서버 사이드):', viewError.message);
                        // 테이블 없으면 자동 생성 (이미 POST /view에 로직 있음)
                    }
                    
                    // 3. 예약 상태를 '수배중(현지수배)'으로 변경
                    try {
                        await pool.query(`
                            UPDATE reservations 
                            SET payment_status = 'in_progress',
                                updated_at = NOW()
                            WHERE id = $1 AND payment_status = 'pending'
                        `, [assignment.reservation_id]);
                        console.log('✅ 예약 상태 변경: 대기중 → 수배중 (열람)');
                    } catch (statusError) {
                        console.log('⚠️ 예약 상태 업데이트 실패:', statusError.message);
                    }
                } else {
                    console.log('ℹ️ 이미 열람된 수배서이거나 업데이트 실패');
                }
            } catch (error) {
                console.error('❌ 첫 열람 기록 처리 실패:', error.message);
                // 에러가 나도 페이지는 표시되어야 함
            }
        } else {
            if (isPreview) {
                console.log('ℹ️ 미리보기 모드 - 열람 기록 안 함');
            } else {
                console.log('ℹ️ 이미 열람된 수배서 (viewed_at:', assignment.viewed_at, ')');
            }
        }
        
        // ℹ️ JavaScript는 부가 정보(디바이스, 브라우저, OS 등)만 수집
        console.log('ℹ️ JavaScript는 디바이스/브라우저 상세 정보만 수집합니다');

        console.log('🔍 템플릿 렌더링 시작');

        // 템플릿 렌더링
        res.render('assignment', {
            assignment: safeAssignment,
            title: `수배서 - ${safeAssignment.reservation_number}`,
            isPreview: isPreview,
            formatDate: (date) => {
                try {
                    if (!date) return '-';
                    const dateObj = new Date(date);
                    if (isNaN(dateObj.getTime())) return '-';
                    return dateObj.toLocaleDateString('ko-KR');
                } catch (e) {
                    console.error('날짜 포맷 오류:', e);
                    return '-';
                }
            },
            formatDateTime: (datetime) => {
                try {
                    if (!datetime) return '-';
                    const dateObj = new Date(datetime);
                    if (isNaN(dateObj.getTime())) return '-';
                    return dateObj.toLocaleString('ko-KR');
                } catch (e) {
                    console.error('날짜시간 포맷 오류:', e);
                    return '-';
                }
            },
            formatCurrency: (amount) => {
                try {
                    if (!amount || isNaN(amount)) return '-';
                    return new Intl.NumberFormat('ko-KR').format(amount) + '원';
                } catch (e) {
                    console.error('통화 포맷 오류:', e);
                    return '-';
                }
            }
        });
        
        console.log('✅ 템플릿 렌더링 완료');

    } catch (error) {
        console.error('❌❌❌ 수배서 페이지 치명적 오류 ❌❌❌');
        console.error('❌ 오류 메시지:', error.message);
        console.error('❌ 오류 이름:', error.name);
        console.error('❌ 오류 코드:', error.code);
        console.error('❌ 요청 토큰:', req.params.token);
        console.error('❌ 요청 URL:', req.url);
        console.error('❌ 요청 시간:', new Date().toISOString());
        console.error('❌ 오류 스택 트레이스:');
        console.error(error.stack);
        console.error('❌❌❌ 오류 정보 끝 ❌❌❌');
        
        // DB 연결 상태 확인
        let dbStatus = 'Unknown';
        try {
            await pool.query('SELECT 1');
            dbStatus = 'Connected';
        } catch (dbError) {
            dbStatus = `Error: ${dbError.message}`;
            console.error('❌ DB 연결 오류:', dbError.message);
        }
        
        // 상세한 HTML 오류 페이지 반환
        res.status(500).send(`
            <!DOCTYPE html>
            <html lang="ko">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>수배서 페이지 오류</title>
                <style>
                    body { font-family: Arial, sans-serif; margin: 40px; background: #f5f5f5; }
                    .error-container { background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
                    .error-title { color: #d32f2f; margin-bottom: 20px; }
                    .error-details { background: #f8f8f8; padding: 15px; border-radius: 4px; margin: 10px 0; }
                    .error-code { font-family: monospace; background: #333; color: #fff; padding: 10px; border-radius: 4px; }
                    .buttons { margin-top: 20px; }
                    .btn { padding: 10px 20px; margin: 5px; border: none; border-radius: 4px; cursor: pointer; }
                    .btn-primary { background: #1976d2; color: white; }
                    .btn-secondary { background: #757575; color: white; }
                </style>
            </head>
            <body>
                <div class="error-container">
                    <h1 class="error-title">🚨 수배서 페이지 오류</h1>
                    
                    <div class="error-details">
                        <h3>오류 정보</h3>
                        <p><strong>오류 메시지:</strong> ${error.message || '알 수 없는 오류'}</p>
                        <p><strong>오류 타입:</strong> ${error.name || 'Unknown'}</p>
                        <p><strong>오류 코드:</strong> ${error.code || 'N/A'}</p>
                        <p><strong>요청 토큰:</strong> ${req.params.token || 'N/A'}</p>
                        <p><strong>토큰 길이:</strong> ${req.params.token ? req.params.token.length : 'N/A'}</p>
                        <p><strong>DB 연결 상태:</strong> ${dbStatus}</p>
                        <p><strong>발생 시간:</strong> ${new Date().toLocaleString('ko-KR')}</p>
                    </div>
                    
                    <div class="error-details">
                        <h3>디버깅 정보</h3>
                        <div class="error-code">
                            <strong>Stack Trace:</strong><br>
                            ${error.stack ? error.stack.replace(/\n/g, '<br>') : 'No stack trace available'}
                        </div>
                    </div>
                    
                    <div class="error-details">
                        <h3>해결 방법</h3>
                        <ul>
                            <li>수배서 링크가 올바른지 확인해주세요</li>
                            <li>잠시 후 다시 시도해주세요</li>
                            <li>문제가 계속되면 관리자에게 문의해주세요</li>
                        </ul>
                    </div>
                    
                    <div class="buttons">
                        <button class="btn btn-primary" onclick="window.location.reload()">🔄 새로고침</button>
                        <button class="btn btn-secondary" onclick="window.close()">❌ 닫기</button>
                        <button class="btn btn-secondary" onclick="history.back()">⬅️ 뒤로가기</button>
                    </div>
                </div>
            </body>
            </html>
        `);
    }
});

// 간단한 수배서 테스트 라우트 (인증 불필요)
app.get('/test-assignment/:token', async (req, res) => {
    try {
        const { token } = req.params;
        console.log('🧪 간단한 수배서 테스트:', token);
        
        // 1. 토큰 존재 확인
        const tokenCheck = await pool.query('SELECT * FROM assignments WHERE assignment_token = $1', [token]);
        
        if (tokenCheck.rows.length === 0) {
            return res.send(`
                <h1>토큰 테스트 결과</h1>
                <p><strong>토큰:</strong> ${token}</p>
                <p><strong>결과:</strong> ❌ 토큰이 존재하지 않습니다</p>
                <p><strong>시간:</strong> ${new Date().toLocaleString('ko-KR')}</p>
            `);
        }
        
        const assignment = tokenCheck.rows[0];
        
        // 2. 예약 정보 조회
        const reservationCheck = await pool.query('SELECT * FROM reservations WHERE id = $1', [assignment.reservation_id]);
        
        if (reservationCheck.rows.length === 0) {
            return res.send(`
                <h1>토큰 테스트 결과</h1>
                <p><strong>토큰:</strong> ${token}</p>
                <p><strong>결과:</strong> ⚠️ 토큰은 존재하지만 연결된 예약이 없습니다</p>
                <p><strong>Assignment ID:</strong> ${assignment.id}</p>
                <p><strong>Reservation ID:</strong> ${assignment.reservation_id}</p>
                <p><strong>시간:</strong> ${new Date().toLocaleString('ko-KR')}</p>
            `);
        }
        
        const reservation = reservationCheck.rows[0];
        
        // 3. 성공 결과
        res.send(`
            <h1>토큰 테스트 결과</h1>
            <p><strong>토큰:</strong> ${token}</p>
            <p><strong>결과:</strong> ✅ 정상</p>
            <p><strong>예약번호:</strong> ${reservation.reservation_number}</p>
            <p><strong>고객명:</strong> ${reservation.korean_name}</p>
            <p><strong>상품명:</strong> ${reservation.product_name}</p>
            <p><strong>수배 상태:</strong> ${assignment.status}</p>
            <p><strong>시간:</strong> ${new Date().toLocaleString('ko-KR')}</p>
            <hr>
            <p><a href="/assignment/${token}">실제 수배서 페이지로 이동</a></p>
        `);
        
    } catch (error) {
        console.error('테스트 라우트 오류:', error);
        res.send(`
            <h1>토큰 테스트 오류</h1>
            <p><strong>토큰:</strong> ${req.params.token}</p>
            <p><strong>오류:</strong> ${error.message}</p>
            <p><strong>시간:</strong> ${new Date().toLocaleString('ko-KR')}</p>
        `);
    }
});

// 테이블 구조 확인 라우트
app.get('/debug/table-structure', requireAuth, async (req, res) => {
    try {
        const tables = ['assignments', 'reservations', 'vendors'];
        const structure = {};
        
        for (const table of tables) {
            try {
                const result = await pool.query(`
                    SELECT column_name, data_type, is_nullable, column_default
                    FROM information_schema.columns 
                    WHERE table_name = $1 
                    ORDER BY ordinal_position
                `, [table]);
                structure[table] = result.rows;
            } catch (e) {
                structure[table] = { error: e.message };
            }
        }
        
        res.json({
            timestamp: new Date().toISOString(),
            database_structure: structure
        });
        
    } catch (error) {
        res.status(500).json({
            error: error.message,
            stack: error.stack
        });
    }
});

// 특정 토큰 디버깅 라우트
app.get('/debug/assignment/:token', requireAuth, async (req, res) => {
    try {
        const { token } = req.params;
        console.log('🔍 디버깅 라우트 시작:', token);
        
        const debugInfo = {
            token: token,
            tokenLength: token.length,
            timestamp: new Date().toISOString(),
            checks: []
        };
        
        // 1. 토큰 존재 확인
        try {
            const tokenCheck = await pool.query('SELECT * FROM assignments WHERE assignment_token = $1', [token]);
            debugInfo.checks.push({
                step: 'token_exists',
                success: tokenCheck.rows.length > 0,
                result: tokenCheck.rows.length > 0 ? tokenCheck.rows[0] : null,
                count: tokenCheck.rows.length
            });
        } catch (e) {
            debugInfo.checks.push({
                step: 'token_exists',
                success: false,
                error: e.message
            });
        }
        
        // 2. 조인 쿼리 테스트
        try {
            const joinQuery = `
                SELECT a.*, r.reservation_number, r.korean_name, r.product_name
                FROM assignments a
                JOIN reservations r ON a.reservation_id = r.id
                WHERE a.assignment_token = $1
            `;
            const joinResult = await pool.query(joinQuery, [token]);
            debugInfo.checks.push({
                step: 'join_query',
                success: joinResult.rows.length > 0,
                result: joinResult.rows.length > 0 ? joinResult.rows[0] : null,
                count: joinResult.rows.length
            });
        } catch (e) {
            debugInfo.checks.push({
                step: 'join_query',
                success: false,
                error: e.message
            });
        }
        
        // 3. 예약 정보 확인
        const tokenExists = debugInfo.checks.find(c => c.step === 'token_exists');
        if (tokenExists && tokenExists.success && tokenExists.result) {
            try {
                const reservationQuery = 'SELECT * FROM reservations WHERE id = $1';
                const reservationResult = await pool.query(reservationQuery, [tokenExists.result.reservation_id]);
                debugInfo.checks.push({
                    step: 'reservation_exists',
                    success: reservationResult.rows.length > 0,
                    result: reservationResult.rows.length > 0 ? reservationResult.rows[0] : null,
                    count: reservationResult.rows.length
                });
            } catch (e) {
                debugInfo.checks.push({
                    step: 'reservation_exists',
                    success: false,
                    error: e.message
                });
            }
        }
        
        res.json(debugInfo);
        
    } catch (error) {
        console.error('디버깅 라우트 오류:', error);
        res.status(500).json({
            error: error.message,
            stack: error.stack
        });
    }
});

// 수배서 시스템 테스트 라우트
app.get('/test/assignments', requireAuth, async (req, res) => {
    try {
        console.log('🔍 테스트 라우트 시작');
        
        // 단계별로 테스트
        let result = { step: 1, message: 'DB 연결 테스트' };
        
        // 1단계: 기본 쿼리 테스트
        await pool.query('SELECT 1');
        result.step = 2;
        result.message = 'assignments 테이블 확인';
        
        // 2단계: 테이블 존재 확인
        const tableCheck = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' AND table_name = 'assignments'
        `);
        result.step = 3;
        result.assignments_table_exists = tableCheck.rows.length > 0;
        result.message = 'reservations 테이블 확인';
        
        // 3단계: 예약 테이블 확인
        const reservationCheck = await pool.query(`SELECT COUNT(*) as count FROM reservations`);
        result.step = 4;
        result.reservations_count = reservationCheck.rows[0].count;
        result.message = 'assignments 개수 확인';
        
        // 4단계: assignments 개수 확인
        if (tableCheck.rows.length > 0) {
            const assignmentCheck = await pool.query(`SELECT COUNT(*) as count FROM assignments`);
            result.assignments_count = assignmentCheck.rows[0].count;
            result.step = 5;
            result.message = '완료';
        } else {
            result.assignments_count = 0;
            result.step = 5;
            result.message = 'assignments 테이블 없음';
        }

        console.log('✅ 테스트 완료:', result);
        res.json(result);
        
    } catch (error) {
        console.error('❌ 테스트 오류:', error);
        console.error('❌ 오류 스택:', error.stack);
        res.status(500).json({ 
            error: error.message,
            stack: error.stack,
            step: 'error'
        });
    }
});

// 간단한 디버그 라우트
app.get('/debug/simple', (req, res) => {
    res.json({ 
        message: '서버 정상 작동',
        timestamp: new Date().toISOString(),
        pool_status: pool ? 'pool 존재' : 'pool 없음'
    });
});

// 실제 수배서 토큰 조회
app.get('/debug/tokens', requireAuth, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT 
                a.id,
                a.assignment_token,
                a.status,
                a.created_at,
                r.id as reservation_id,
                r.reservation_number,
                r.korean_name,
                r.product_name
            FROM assignments a
            LEFT JOIN reservations r ON a.reservation_id = r.id
            ORDER BY a.created_at DESC
            LIMIT 10
        `);
        
        res.json({
            message: '수배서 토큰 목록',
            count: result.rows.length,
            assignments: result.rows
        });
        
    } catch (error) {
        console.error('토큰 조회 오류:', error);
        res.status(500).json({ error: error.message });
    }
});

// 토큰만 간단히 조회
app.get('/debug/simple-tokens', async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT assignment_token, id, status 
            FROM assignments 
            ORDER BY created_at DESC 
            LIMIT 5
        `);
        
        const tokens = result.rows.map(row => ({
            token: row.assignment_token,
            id: row.id,
            status: row.status,
            url: `/assignment/${row.assignment_token}`
        }));
        
        res.json({
            message: '수배서 토큰 목록 (최근 5개)',
            tokens: tokens
        });
        
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


// 수배서 테스트 라우트 (간단한 HTML 반환)
app.get('/assignment-test/:token', async (req, res) => {
    try {
        const { token } = req.params;
        console.log('🧪 수배서 테스트 요청:', token);
        
        const result = await pool.query(`
            SELECT 
                a.id, a.assignment_token, a.status,
                r.reservation_number, r.korean_name, r.product_name
            FROM assignments a
            LEFT JOIN reservations r ON a.reservation_id = r.id
            WHERE a.assignment_token = $1
        `, [token]);
        
        if (result.rows.length === 0) {
            return res.send(`<h1>수배서 없음</h1><p>토큰: ${token}</p>`);
        }
        
        const data = result.rows[0];
        res.send(`
            <html>
                <head><title>수배서 테스트</title></head>
                <body>
                    <h1>수배서 테스트 성공</h1>
                    <p><strong>토큰:</strong> ${token}</p>
                    <p><strong>예약번호:</strong> ${data.reservation_number}</p>
                    <p><strong>예약자:</strong> ${data.korean_name}</p>
                    <p><strong>상품:</strong> ${data.product_name}</p>
                    <p><strong>상태:</strong> ${data.status}</p>
                    <hr>
                    <a href="/assignment/${token}">실제 수배서 페이지로 이동</a>
                </body>
            </html>
        `);
        
    } catch (error) {
        console.error('🧪 테스트 오류:', error);
        res.status(500).send(`<h1>테스트 오류</h1><p>${error.message}</p>`);
    }
});

// 안전한 수배서 페이지 (템플릿 오류 디버깅용)
app.get('/assignment-safe/:token', async (req, res) => {
    try {
        const { token } = req.params;
        console.log('🛡️ 안전한 수배서 페이지 요청:', token);
        
        const query = `
            SELECT 
                a.*,
                r.reservation_number,
                r.korean_name as customer_name,
                r.english_first_name,
                r.english_last_name,
                r.platform_name as vendor_name,
                r.product_name,
                r.usage_date as departure_date,
                r.usage_date,
                r.usage_time,
                r.people_adult as adult_count,
                r.people_child as child_count,
                r.people_infant,
                r.total_amount as total_amount,
                r.phone as phone_number,
                r.email,
                r.package_type,
                r.memo as special_requests
            FROM assignments a
            JOIN reservations r ON a.reservation_id = r.id
            WHERE a.assignment_token = $1
        `;

        const result = await pool.query(query, [token]);
        
        if (result.rows.length === 0) {
            return res.status(404).send('<h1>수배서를 찾을 수 없습니다</h1>');
        }

        const assignment = result.rows[0];
        
        // 수배업체 정보 추가 조회
        if (assignment.vendor_id) {
            const vendorQuery = `SELECT vendor_name, email, phone FROM vendors WHERE id = $1`;
            const vendorResult = await pool.query(vendorQuery, [assignment.vendor_id]);
            if (vendorResult.rows.length > 0) {
                const vendor = vendorResult.rows[0];
                assignment.assignment_vendor = vendor.vendor_name;
                assignment.vendor_email = vendor.email;
                assignment.vendor_phone = vendor.phone;
            }
        }

        // 수배업체 정보가 없으면 기본값 설정
        if (!assignment.assignment_vendor) {
            assignment.assignment_vendor = assignment.vendor_name || '미지정';
        }

        console.log('🛡️ 안전한 템플릿으로 렌더링');
        res.render('assignment-safe', {
            assignment: assignment,
            title: `수배서 (안전모드) - ${assignment.reservation_number}`
        });
        
    } catch (error) {
        console.error('🛡️ 안전한 수배서 오류:', error);
        res.status(500).render('error', {
            title: '수배서 오류',
            message: '수배서를 불러오는 중 오류가 발생했습니다.',
            backUrl: '/'
        });
    }
});

// 수배 로그 조회 API
app.get('/api/assignments/logs/:reservationId', requireAuth, async (req, res) => {
    try {
        const { reservationId } = req.params;
        console.log('🔍 수배 로그 조회:', reservationId);
        
        const result = await pool.query(`
            SELECT 
                'assignment_created' as action,
                '수배서 생성' as details,
                'success' as type,
                created_at
            FROM assignments 
            WHERE reservation_id = $1
            UNION ALL
            SELECT 
                'assignment_sent' as action,
                '수배서 전송' as details,
                'success' as type,
                sent_at as created_at
            FROM assignments 
            WHERE reservation_id = $1 AND sent_at IS NOT NULL
            UNION ALL
            SELECT 
                'assignment_viewed' as action,
                '수배서 열람' as details,
                'info' as type,
                viewed_at as created_at
            FROM assignments 
            WHERE reservation_id = $1 AND viewed_at IS NOT NULL
            UNION ALL
            SELECT 
                'assignment_confirmed' as action,
                '수배 확정' as details,
                'success' as type,
                response_at as created_at
            FROM assignments 
            WHERE reservation_id = $1 AND response_at IS NOT NULL
            ORDER BY created_at DESC
        `, [reservationId]);
        
        res.json({
            success: true,
            logs: result.rows
        });
        
    } catch (error) {
        console.error('❌ 수배 로그 조회 오류:', error);
        res.status(500).json({ 
            success: false, 
            message: '로그 조회 중 오류가 발생했습니다: ' + error.message 
        });
    }
});

// 수배서 저장 API
app.post('/api/assignments/:reservationId/save', requireAuth, async (req, res) => {
    try {
        const { reservationId } = req.params;
        console.log('💾 수배서 저장 요청:', reservationId);
        
        // 기존 수배서가 있는지 확인
        let assignment = await pool.query(`
            SELECT * FROM assignments WHERE reservation_id = $1
        `, [reservationId]);
        
        if (assignment.rows.length === 0) {
            // 수배서가 없으면 자동 생성
            const autoAssignment = await createAutoAssignment(reservationId, null);
            if (!autoAssignment) {
                return res.status(400).json({
                    success: false,
                    message: '수배서 생성에 실패했습니다'
                });
            }
        }
        
        res.json({
            success: true,
            message: '수배서가 저장되었습니다'
        });
        
    } catch (error) {
        console.error('❌ 수배서 저장 오류:', error);
        res.status(500).json({ 
            success: false, 
            message: '수배서 저장 중 오류가 발생했습니다: ' + error.message 
        });
    }
});

// 수배서 전송 API (이메일 발송 포함)
app.post('/api/assignments/:reservationId/send', requireAuth, async (req, res) => {
    try {
        const { reservationId } = req.params;
        const { sendEmail } = req.body; // 이메일 발송 여부
        
        console.log('📤 수배서 전송 요청:', reservationId, '이메일 발송:', sendEmail);
        
        // 수배서와 예약 정보 함께 조회
        const query = `
            SELECT 
                a.*,
                r.reservation_number,
                r.product_name,
                r.korean_name as customer_name,
                r.usage_date,
                r.people_adult as adult_count,
                r.people_child as child_count,
                r.created_by,
                r.created_by_email,
                v.email as vendor_email,
                v.vendor_name
            FROM assignments a
            JOIN reservations r ON a.reservation_id = r.id
            LEFT JOIN vendors v ON a.vendor_id = v.id
            WHERE a.reservation_id = $1
        `;
        
        const result = await pool.query(query, [reservationId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '수배서를 찾을 수 없습니다'
            });
        }
        
        const assignmentData = result.rows[0];
        
        // 이메일 발송 (선택적)
        let emailResult = null;
        if (sendEmail && assignmentData.vendor_email) {
            const { sendAssignmentEmail } = require('./utils/emailSender');
            
            emailResult = await sendAssignmentEmail(
                {
                    assignment_token: assignmentData.assignment_token,
                    reservation_number: assignmentData.reservation_number,
                    product_name: assignmentData.product_name,
                    customer_name: assignmentData.customer_name,
                    usage_date: assignmentData.usage_date,
                    adult_count: assignmentData.adult_count,
                    child_count: assignmentData.child_count,
                    created_by: assignmentData.created_by,
                    created_by_email: assignmentData.created_by_email
                },
                assignmentData.vendor_email
            );
            
            if (emailResult.success) {
                console.log('✅ 이메일 발송 완료:', assignmentData.vendor_email);
            } else {
                console.error('❌ 이메일 발송 실패:', emailResult.error);
            }
        }
        
        // 전송 시간 업데이트 및 예약 상태 변경
        await pool.query(`
            UPDATE assignments 
            SET sent_at = NOW(), status = 'sent'
            WHERE reservation_id = $1
        `, [reservationId]);
        
        // ✅ 예약 상태를 '수배중(현지수배)'으로 변경
        await pool.query(`
            UPDATE reservations 
            SET payment_status = 'in_progress', updated_at = NOW()
            WHERE id = $1 AND payment_status = 'pending'
        `, [reservationId]);
        console.log('✅ 예약 상태 변경: 대기중 → 수배중 (이메일 전송)');
        
        // 히스토리 기록
        const adminName = req.session.adminName || req.session.adminUsername || '시스템';
        await logHistory(
            reservationId,
            '수배',
            '전송',
            adminName,
            `수배서가 ${assignmentData.vendor_name || '수배업체'}에게 전송되었습니다.${emailResult && emailResult.success ? ' (이메일 발송 완료)' : ''}`,
            null,
            {
                vendor_email: assignmentData.vendor_email,
                email_sent: emailResult ? emailResult.success : false,
                assignment_link: emailResult ? emailResult.assignmentLink : null
            }
        );
        
        res.json({
            success: true,
            message: emailResult && emailResult.success 
                ? '수배서가 전송되었으며 이메일이 발송되었습니다' 
                : '수배서가 전송되었습니다',
            emailSent: emailResult ? emailResult.success : false,
            recipientEmail: assignmentData.vendor_email
        });
        
    } catch (error) {
        console.error('❌ 수배서 전송 오류:', error);
        res.status(500).json({ 
            success: false, 
            message: '수배서 전송 중 오류가 발생했습니다: ' + error.message 
        });
    }
});

// 수배서 재전송 API
app.post('/api/assignments/:reservationId/resend', requireAuth, async (req, res) => {
    try {
        const { reservationId } = req.params;
        console.log('🔄 수배서 재전송 요청:', reservationId);
        
        // 재전송 시간 업데이트
        await pool.query(`
            UPDATE assignments 
            SET sent_at = NOW()
            WHERE reservation_id = $1
        `, [reservationId]);
        
        res.json({
            success: true,
            message: '수배서가 재전송되었습니다'
        });
        
    } catch (error) {
        console.error('❌ 수배서 재전송 오류:', error);
        res.status(500).json({ 
            success: false, 
            message: '수배서 재전송 중 오류가 발생했습니다: ' + error.message 
        });
    }
});

// 수배서 링크 생성 API (토큰이 없으면 생성)
app.post('/api/assignments/:reservationId/generate-link', requireAuth, async (req, res) => {
    try {
        const { reservationId } = req.params;
        console.log('🔗 수배서 링크 생성 요청:', reservationId);
        
        // 기존 수배서 토큰 조회
        let assignment = await pool.query(`
            SELECT assignment_token FROM assignments WHERE reservation_id = $1
        `, [reservationId]);
        
        let token;
        
        if (assignment.rows.length === 0) {
            // 수배서가 없으면 새로 생성
            token = crypto.randomBytes(32).toString('hex');
            
            // 예약 정보 조회
            const reservation = await pool.query(`
                SELECT * FROM reservations WHERE id = $1
            `, [reservationId]);
            
            if (reservation.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: '예약 정보를 찾을 수 없습니다'
                });
            }
            
            const reservationData = reservation.rows[0];
            
            // 새 수배서 생성
            await pool.query(`
                INSERT INTO assignments (
                    reservation_id, assignment_token, status, 
                    created_at, updated_at
                ) VALUES ($1, $2, 'draft', NOW(), NOW())
            `, [reservationId, token]);
            
            console.log('✅ 새 수배서 생성:', token);
            
        } else if (!assignment.rows[0].assignment_token) {
            // 토큰이 없으면 새로 생성
            token = crypto.randomBytes(32).toString('hex');
            
            await pool.query(`
                UPDATE assignments 
                SET assignment_token = $1, updated_at = NOW()
                WHERE reservation_id = $2
            `, [token, reservationId]);
            
            console.log('✅ 수배서 토큰 생성:', token);
            
        } else {
            // 기존 토큰 사용
            token = assignment.rows[0].assignment_token;
            console.log('✅ 기존 토큰 사용:', token);
        }
        
        const assignmentUrl = `${req.protocol}://${req.get('host')}/assignment/${token}`;
        
        // 로그 기록 (선택적)
        try {
            await pool.query(`
                INSERT INTO assignment_logs (reservation_id, action, details, created_at)
                VALUES ($1, 'link_generated', $2, NOW())
            `, [reservationId, JSON.stringify({ url: assignmentUrl })]);
        } catch (logError) {
            console.log('⚠️ 로그 기록 실패 (테이블 없음):', logError.message);
        }
        
        console.log('📎 수배서 링크 생성 완료:', assignmentUrl);
        
        res.json({
            success: true,
            message: '수배서 링크가 생성되었습니다',
            link: assignmentUrl,
            assignment_token: token,  // 프론트엔드 호환성
            token: token
        });
        
    } catch (error) {
        console.error('❌ 수배서 링크 생성 오류:', error);
        res.status(500).json({ 
            success: false, 
            message: '링크 생성 중 오류가 발생했습니다: ' + error.message 
        });
    }
});

// 수배서 링크 전송 API (기존 유지)
app.post('/api/assignments/:reservationId/send-link', requireAuth, async (req, res) => {
    try {
        const { reservationId } = req.params;
        console.log('🔗 수배서 링크 전송 요청:', reservationId);
        
        // 수배서 토큰 조회
        const assignment = await pool.query(`
            SELECT assignment_token FROM assignments WHERE reservation_id = $1
        `, [reservationId]);
        
        if (assignment.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '수배서를 찾을 수 없습니다'
            });
        }
        
        const token = assignment.rows[0].assignment_token;
        const assignmentUrl = `https://www.guamsavecard.com/assignment/${token}`;
        
        console.log('📎 수배서 링크:', assignmentUrl);
        
        res.json({
            success: true,
            message: '수배서 링크가 전송되었습니다',
            url: assignmentUrl
        });
        
    } catch (error) {
        console.error('❌ 수배서 링크 전송 오류:', error);
        res.status(500).json({ 
            success: false, 
            message: '링크 전송 중 오류가 발생했습니다: ' + error.message 
        });
    }
});

// 수배서 파일 다운로드 API
app.get('/api/assignments/:reservationId/download', requireAuth, async (req, res) => {
    try {
        const { reservationId } = req.params;
        console.log('📥 수배서 다운로드 요청:', reservationId);
        
        // 임시로 텍스트 파일 생성 (실제로는 PDF 생성 라이브러리 사용)
        const content = `수배서 - 예약 ID: ${reservationId}\n생성일: ${new Date().toLocaleString('ko-KR')}`;
        
        res.setHeader('Content-Type', 'text/plain; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="assignment_${reservationId}.txt"`);
        res.send(content);
        
    } catch (error) {
        console.error('❌ 수배서 다운로드 오류:', error);
        res.status(500).json({ 
            success: false, 
            message: '다운로드 중 오류가 발생했습니다: ' + error.message 
        });
    }
});

// 수배서 미리보기 (관리자용)
app.get('/assignment/preview/:reservationId', requireAuth, async (req, res) => {
    try {
        const { reservationId } = req.params;
        console.log('🔍 수배서 미리보기 요청:', reservationId);

        // 해당 예약의 수배서 조회
        const query = `
            SELECT 
                a.*,
                r.reservation_number,
                r.korean_name as customer_name,
                r.english_first_name,
                r.english_last_name,
                r.platform_name as vendor_name,
                r.product_name,
                r.usage_date as departure_date,
                r.usage_date,
                r.usage_time,
                r.people_adult as adult_count,
                r.people_child as child_count,
                r.people_infant,
                r.total_amount as total_amount,
                r.phone as phone_number,
                r.email,
                r.package_type,
                r.memo as special_requests,
                r.created_by,
                r.created_by_email
            FROM assignments a
            JOIN reservations r ON a.reservation_id = r.id
            WHERE r.id = $1
            ORDER BY a.created_at DESC
            LIMIT 1
        `;

        const result = await pool.query(query, [reservationId]);

        if (result.rows.length === 0) {
            // 수배서가 없는 경우, 예약 정보만으로 임시 수배서 생성
            const reservationQuery = `SELECT * FROM reservations WHERE id = $1`;
            const reservationResult = await pool.query(reservationQuery, [reservationId]);
            
            if (reservationResult.rows.length === 0) {
                return res.status(404).render('error', { 
                    message: '예약을 찾을 수 없습니다.',
                    error: { status: 404 }
                });
            }
            
            const reservation = reservationResult.rows[0];
            
            // 임시 수배서 데이터 생성
            const tempAssignment = {
                id: 'TEMP',
                assignment_token: 'preview',
                reservation_id: reservation.id,
                vendor_id: null,
                vendor_name: '미지정',
                status: 'draft',
                created_at: new Date(),
                sent_at: null,
                viewed_at: null,
                response_at: null,
                confirmation_number: null,
                rejection_reason: null,
                notes: '임시 수배서 (아직 생성되지 않음)',
                
                // 예약 정보 매핑
                reservation_number: reservation.reservation_number,
                customer_name: reservation.korean_name,
                english_first_name: reservation.english_first_name,
                english_last_name: reservation.english_last_name,
                vendor_name: reservation.platform_name,
                product_name: reservation.product_name,
                departure_date: reservation.usage_date,
                usage_date: reservation.usage_date,
                usage_time: reservation.usage_time,
                adult_count: reservation.people_adult,
                child_count: reservation.people_child,
                people_infant: reservation.people_infant,
                total_amount: reservation.total_amount,
                phone_number: reservation.phone,
                email: reservation.email,
                package_type: reservation.package_type,
                special_requests: reservation.memo,
                assignment_vendor: '미지정',
                vendor_email: null,
                vendor_phone: null,
                created_by: reservation.created_by,
                created_by_email: reservation.created_by_email
            };
            
            return res.render('assignment', {
                assignment: tempAssignment,
                title: `수배서 미리보기 - ${tempAssignment.reservation_number} (임시)`,
                isPreview: true,
                formatDate: (date) => {
                    if (!date) return '-';
                    return new Date(date).toLocaleDateString('ko-KR');
                },
                formatCurrency: (amount) => {
                    if (!amount) return '-';
                    return new Intl.NumberFormat('ko-KR').format(amount) + '원';
                }
            });
        }

        const assignment = result.rows[0];

        // 수배업체 정보 추가 조회
        if (assignment.vendor_id) {
            const vendorQuery = `SELECT vendor_name, email, phone FROM vendors WHERE id = $1`;
            const vendorResult = await pool.query(vendorQuery, [assignment.vendor_id]);
            if (vendorResult.rows.length > 0) {
                const vendor = vendorResult.rows[0];
                assignment.assignment_vendor = vendor.vendor_name;
                assignment.vendor_email = vendor.email;
                assignment.vendor_phone = vendor.phone;
            }
        }

        // 수배업체 정보가 없으면 기본값 설정
        if (!assignment.assignment_vendor) {
            assignment.assignment_vendor = assignment.vendor_name || '미지정';
        }

        res.render('assignment', {
            assignment: assignment,
            title: `수배서 미리보기 - ${assignment.reservation_number}`,
            isPreview: true,
            formatDate: (date) => {
                if (!date) return '-';
                return new Date(date).toLocaleDateString('ko-KR');
            },
            formatCurrency: (amount) => {
                if (!amount) return '-';
                return new Intl.NumberFormat('ko-KR').format(amount) + '원';
            }
        });

    } catch (error) {
        console.error('❌ 수배서 미리보기 오류:', error);
        console.error('❌ 오류 스택:', error.stack);
        console.error('❌ 요청 파라미터:', req.params);
        
        // 간단한 HTML 오류 페이지 반환 (error.ejs가 없을 수도 있음)
        res.status(500).send(`
            <html>
                <head><title>수배서 오류</title></head>
                <body>
                    <h1>수배서 미리보기 오류</h1>
                    <p>오류 메시지: ${error.message}</p>
                    <p>예약 ID: ${req.params.reservationId}</p>
                    <button onclick="window.close()">닫기</button>
                </body>
            </html>
        `);
    }
});

// 수배서 확정 처리 API
app.post('/assignment/:token/confirm', async (req, res) => {
    try {
        const { token } = req.params;
        const { confirmation_number, notes } = req.body;
        
        console.log('✅ 수배서 확정 요청:', { token, confirmation_number });

        if (!confirmation_number) {
            return res.status(400).json({ success: false, message: '확정번호를 입력해주세요.' });
        }

        // 수배서 정보 조회
        const assignmentQuery = `
            SELECT a.*, r.reservation_number 
            FROM assignments a
            JOIN reservations r ON a.reservation_id = r.id
            WHERE a.assignment_token = $1
        `;
        const assignmentResult = await pool.query(assignmentQuery, [token]);

        if (assignmentResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: '수배서를 찾을 수 없습니다.' });
        }

        const assignment = assignmentResult.rows[0];

        // 수배서 확정 처리
        await pool.query(`
            UPDATE assignments 
            SET 
                status = 'confirmed',
                confirmation_number = $1,
                response_at = NOW(),
                notes = COALESCE(notes, '') || $2
            WHERE assignment_token = $3
        `, [confirmation_number, notes ? '\n확정 메모: ' + notes : '', token]);

        // 예약 상태를 확정으로 변경
        await pool.query(`
            UPDATE reservations 
            SET payment_status = 'confirmed', updated_at = NOW()
            WHERE id = $1
        `, [assignment.reservation_id]);

        console.log('✅ 수배서 확정 완료:', assignment.reservation_number, confirmation_number);

        res.json({
            success: true,
            message: '수배서가 확정되었습니다.',
            data: {
                confirmation_number: confirmation_number,
                reservation_number: assignment.reservation_number
            }
        });

    } catch (error) {
        console.error('❌ 수배서 확정 오류:', error);
        res.status(500).json({ success: false, message: '수배서 확정 중 오류가 발생했습니다: ' + error.message });
    }
});

// 수배서 열람 추적 API (JavaScript에서 부가 정보 전송용)
app.post('/assignment/:token/view', async (req, res) => {
    try {
        const { token } = req.params;
        const { viewed_at, user_agent, screen_size, referrer, device_type, browser, os } = req.body;
        
        console.log('='.repeat(60));
        console.log('📱 수배서 열람 추적 API 호출 (JavaScript - 부가 정보)');
        console.log('토큰:', token);
        console.log('디바이스:', device_type, '/', browser, '/', os);
        console.log('화면:', screen_size);
        console.log('='.repeat(60));
        
        // IP 주소 추출
        const ip_address = req.headers['x-forwarded-for']?.split(',')[0].trim() || 
                          req.headers['x-real-ip'] || 
                          req.connection.remoteAddress || 
                          req.socket.remoteAddress;
        
        console.log('🌐 IP 주소:', ip_address);
        
        // 수배서 조회
        const assignmentQuery = 'SELECT id, reservation_id, viewed_at, status FROM assignments WHERE assignment_token = $1';
        const assignmentResult = await pool.query(assignmentQuery, [token]);
        
        console.log('🔍 수배서 조회 결과:', assignmentResult.rows.length > 0 ? assignmentResult.rows[0] : '없음');
        
        if (assignmentResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: '수배서를 찾을 수 없습니다.' });
        }
        
        const assignment = assignmentResult.rows[0];
        
        // IP 기반 위치 정보 조회 (ipapi.co 사용 - 무료, 빠름)
        let country = null;
        let city = null;
        
        try {
            // 로컬 IP는 스킵
            if (ip_address && !ip_address.startsWith('::') && !ip_address.startsWith('127.') && !ip_address.startsWith('192.168.')) {
                const axios = require('axios');
                const geoResponse = await axios.get(`https://ipapi.co/${ip_address}/json/`, {
                    timeout: 3000
                });
                
                if (geoResponse.data) {
                    country = geoResponse.data.country_name || null;
                    city = geoResponse.data.city || null;
                    console.log('📍 위치 정보:', country, city);
                }
            } else {
                console.log('⚠️ 로컬 IP 주소 - 위치 정보 조회 스킵');
                country = '로컬';
                city = '테스트';
            }
        } catch (geoError) {
            console.error('⚠️ 위치 정보 조회 실패:', geoError.message);
        }
        
        // 열람 이력 저장 (JavaScript에서 보낸 상세 디바이스 정보 포함)
        try {
            await pool.query(`
                INSERT INTO assignment_views (
                    assignment_token, reservation_id, viewed_at,
                    ip_address, country, city, user_agent,
                    device_type, browser, os, screen_size, referrer
                ) VALUES ($1, $2, NOW(), $3, $4, $5, $6, $7, $8, $9, $10, $11)
            `, [
                token, 
                assignment.reservation_id, 
                ip_address, 
                country, 
                city, 
                user_agent,
                device_type || 'Unknown',
                browser || 'Unknown',
                os || 'Unknown',
                screen_size || 'Unknown',
                referrer || 'Direct'
            ]);
            console.log('✅ JavaScript 상세 열람 이력 저장 완료 (디바이스/브라우저 정보 포함)');
        } catch (viewError) {
            console.error('❌ 열람 이력 저장 실패:', viewError.message);
            
            // 테이블이 없는 경우 자동 생성
            if (viewError.code === '42P01') { // undefined_table
                console.log('⚠️ assignment_views 테이블이 없습니다. 자동 생성 시도...');
                try {
                    await pool.query(`
                        CREATE TABLE IF NOT EXISTS assignment_views (
                            id SERIAL PRIMARY KEY,
                            assignment_token VARCHAR(255) NOT NULL,
                            reservation_id INTEGER,
                            viewed_at TIMESTAMP DEFAULT NOW(),
                            ip_address VARCHAR(100),
                            country VARCHAR(100),
                            city VARCHAR(100),
                            user_agent TEXT,
                            device_type VARCHAR(50),
                            browser VARCHAR(50),
                            os VARCHAR(50),
                            screen_size VARCHAR(50),
                            referrer TEXT,
                            created_at TIMESTAMP DEFAULT NOW()
                        );
                        CREATE INDEX IF NOT EXISTS idx_assignment_views_token ON assignment_views(assignment_token);
                        CREATE INDEX IF NOT EXISTS idx_assignment_views_reservation ON assignment_views(reservation_id);
                    `);
                    console.log('✅ assignment_views 테이블 생성 완료! 다시 저장 시도...');
                    
                    // 다시 저장 시도
                    await pool.query(`
                        INSERT INTO assignment_views (
                            assignment_token, reservation_id, viewed_at,
                            ip_address, country, city, user_agent,
                            device_type, browser, os, screen_size, referrer
                        ) VALUES ($1, $2, NOW(), $3, $4, $5, $6, $7, $8, $9, $10, $11)
                    `, [
                        token, 
                        assignment.reservation_id, 
                        ip_address, 
                        country, 
                        city, 
                        user_agent,
                        device_type || 'Unknown',
                        browser || 'Unknown',
                        os || 'Unknown',
                        screen_size || 'Unknown',
                        referrer || 'Direct'
                    ]);
                    console.log('✅ 열람 이력 저장 재시도 성공!');
                } catch (createError) {
                    console.error('❌ 테이블 생성 실패:', createError.message);
                }
            }
        }
        
        // 첫 열람인 경우에만 viewed_at 업데이트 및 상태 변경
        // (GET 요청보다 JavaScript가 먼저 실행된 경우에만 해당)
        if (!assignment.viewed_at) {
            console.log('🆕 첫 열람! JavaScript가 GET보다 먼저 도착 - 업데이트 시작...');
            
            // 1. 수배서 viewed_at 업데이트 및 상태를 'sent'로 변경 (아직 draft인 경우)
            try {
                const updateResult = await pool.query(`
                    UPDATE assignments 
                    SET viewed_at = NOW(), 
                        updated_at = NOW(),
                        status = CASE 
                            WHEN status = 'draft' THEN 'sent'
                            ELSE status 
                        END
                    WHERE assignment_token = $1 AND viewed_at IS NULL
                    RETURNING id, viewed_at, status
                `, [token]);
                
                if (updateResult.rows.length > 0) {
                    console.log('✅ 수배서 viewed_at 업데이트 완료 (JavaScript가 먼저 도착):', updateResult.rows[0]);
                } else {
                    console.log('ℹ️ GET 요청에서 이미 viewed_at 업데이트됨');
                }
            } catch (updateError) {
                console.error('❌ 수배서 업데이트 실패:', updateError.message);
                
                // viewed_at 컬럼이 없는 경우 자동 추가
                if (updateError.code === '42703') { // undefined_column
                    console.log('⚠️ assignments.viewed_at 컬럼이 없습니다. 자동 추가 시도...');
                    try {
                        await pool.query(`
                            ALTER TABLE assignments 
                            ADD COLUMN IF NOT EXISTS viewed_at TIMESTAMP;
                        `);
                        console.log('✅ viewed_at 컬럼 추가 완료! 다시 업데이트 시도...');
                        
                        // 다시 업데이트 시도
                        const retryResult = await pool.query(`
                            UPDATE assignments 
                            SET viewed_at = NOW(), 
                                updated_at = NOW(),
                                status = CASE 
                                    WHEN status = 'draft' THEN 'sent'
                                    ELSE status 
                                END
                            WHERE assignment_token = $1
                            RETURNING id, viewed_at, status
                        `, [token]);
                        console.log('✅ 수배서 업데이트 재시도 성공:', retryResult.rows[0]);
                    } catch (alterError) {
                        console.error('❌ 컬럼 추가 실패:', alterError.message);
                    }
                }
            }
            
            // 2. 예약 현재 상태 확인
            const currentReservation = await pool.query(`
                SELECT id, payment_status FROM reservations WHERE id = $1
            `, [assignment.reservation_id]);
            console.log('🔍 현재 예약 상태:', currentReservation.rows[0]);
            
            // 3. 예약 상태를 '대기중 → 수배중'으로 변경
            const reservationUpdateResult = await pool.query(`
                UPDATE reservations 
                SET payment_status = 'in_progress',
                    updated_at = NOW()
                WHERE id = $1 AND payment_status = 'pending'
                RETURNING id, payment_status
            `, [assignment.reservation_id]);
            
            if (reservationUpdateResult.rows.length > 0) {
                console.log('✅ 예약 상태 변경: 대기중 → 수배중 (JavaScript 열람)');
            } else {
                console.log('ℹ️ 예약 상태 변경 안 함 (이미 수배중 또는 확정 상태)');
            }
            
            // 4. 업무 히스토리에 열람 기록
            await logHistory(
                assignment.reservation_id,
                '수배',
                '열람',
                '수배업체',
                `수배업체가 수배서를 처음 열람했습니다. 예약 상태가 자동으로 "수배중"으로 변경되었습니다. 수배업체의 확정 응답을 대기하고 있습니다.`,
                { payment_status: { from: 'pending', to: 'in_progress' } },
                {
                    assignment_token: token,
                    user_agent: user_agent || 'Unknown',
                    screen_size: screen_size || 'Unknown',
                    ip_address: ip_address || 'Unknown',
                    country: country || 'Unknown',
                    city: city || 'Unknown',
                    device_type: device_type || 'Unknown',
                    browser: browser || 'Unknown',
                    os: os || 'Unknown',
                    first_view: true
                }
            );
            
            console.log('='.repeat(60));
            console.log('✅ 모든 처리 완료! 응답 전송');
            console.log('='.repeat(60));
            
            res.json({ 
                success: true, 
                message: '열람 기록이 저장되었습니다. 상태가 수배중으로 변경되었습니다.',
                first_view: true,
                status_changed: true,
                viewed_at: updateResult.rows[0].viewed_at
            });
        } else {
            console.log('ℹ️ GET 요청에서 이미 viewed_at 처리됨 (viewed_at:', assignment.viewed_at, ')');
            console.log('ℹ️ JavaScript는 디바이스/브라우저 상세 정보만 추가로 저장했습니다');
            console.log('='.repeat(60));
            res.json({ 
                success: true, 
                message: '열람 기록이 저장되었습니다. (부가 정보)',
                first_view: false,
                device_info_added: true,
                viewed_at: assignment.viewed_at
            });
        }
        
    } catch (error) {
        console.error('❌ 수배서 열람 기록 오류:', error);
        res.status(500).json({ success: false, message: '열람 기록 중 오류가 발생했습니다: ' + error.message });
    }
});

// 수배서 열람 통계 조회 API
app.get('/api/assignment/:token/views', requireAuth, async (req, res) => {
    try {
        const { token } = req.params;
        
        console.log('📊 열람 통계 조회 요청:', token);
        
        // 전체 열람 통계
        const statsQuery = `
            SELECT 
                COUNT(*) as total_views,
                COUNT(DISTINCT ip_address) as unique_visitors,
                MIN(viewed_at) as first_viewed,
                MAX(viewed_at) as last_viewed,
                COUNT(DISTINCT country) as countries_count
            FROM assignment_views
            WHERE assignment_token = $1
        `;
        
        // 상세 열람 이력
        const detailsQuery = `
            SELECT 
                id, viewed_at, ip_address, country, city,
                user_agent, device_type, browser, os, screen_size, referrer
            FROM assignment_views
            WHERE assignment_token = $1
            ORDER BY viewed_at DESC
        `;
        
        // 국가별 집계
        const countryQuery = `
            SELECT 
                country, 
                COUNT(*) as view_count,
                MAX(viewed_at) as last_viewed
            FROM assignment_views
            WHERE assignment_token = $1 AND country IS NOT NULL
            GROUP BY country
            ORDER BY view_count DESC
        `;
        
        const [statsResult, detailsResult, countryResult] = await Promise.all([
            pool.query(statsQuery, [token]),
            pool.query(detailsQuery, [token]),
            pool.query(countryQuery, [token])
        ]);
        
        const responseData = {
            success: true,
            stats: statsResult.rows[0],
            details: detailsResult.rows,
            by_country: countryResult.rows
        };
        
        console.log('✅ 열람 통계 조회 결과:', {
            total_views: statsResult.rows[0]?.total_views,
            unique_visitors: statsResult.rows[0]?.unique_visitors,
            first_viewed: statsResult.rows[0]?.first_viewed,
            details_count: detailsResult.rows.length,
            countries: countryResult.rows.length
        });
        
        res.json(responseData);
        
    } catch (error) {
        console.error('❌ 열람 통계 조회 오류:', error);
        res.status(500).json({ 
            success: false, 
            message: '열람 통계 조회 중 오류가 발생했습니다: ' + error.message 
        });
    }
});

// 예약별 수배서 열람 통계 조회 API
app.get('/api/reservations/:id/assignment-views', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        
        // 해당 예약의 수배서 토큰 조회
        const tokenQuery = `
            SELECT assignment_token 
            FROM assignments 
            WHERE reservation_id = $1
            ORDER BY assigned_at DESC
            LIMIT 1
        `;
        const tokenResult = await pool.query(tokenQuery, [id]);
        
        if (tokenResult.rows.length === 0) {
            return res.json({
                success: true,
                has_assignment: false,
                stats: null
            });
        }
        
        const token = tokenResult.rows[0].assignment_token;
        
        // 열람 통계 조회
        const statsQuery = `
            SELECT 
                COUNT(*) as total_views,
                COUNT(DISTINCT ip_address) as unique_visitors,
                MIN(viewed_at) as first_viewed,
                MAX(viewed_at) as last_viewed,
                STRING_AGG(DISTINCT country, ', ') as countries
            FROM assignment_views
            WHERE assignment_token = $1
        `;
        
        const statsResult = await pool.query(statsQuery, [token]);
        
        res.json({
            success: true,
            has_assignment: true,
            assignment_token: token,
            stats: statsResult.rows[0]
        });
        
    } catch (error) {
        console.error('❌ 예약 열람 통계 조회 오류:', error);
        res.status(500).json({ 
            success: false, 
            message: '열람 통계 조회 중 오류가 발생했습니다: ' + error.message 
        });
    }
});

// 수배서 거절 처리 API
app.post('/assignment/:token/reject', async (req, res) => {
    try {
        const { token } = req.params;
        const { rejection_reason } = req.body;
        
        console.log('❌ 수배서 거절 요청:', { token, rejection_reason });

        if (!rejection_reason) {
            return res.status(400).json({ success: false, message: '거절 사유를 입력해주세요.' });
        }

        // 수배서 정보 조회
        const assignmentQuery = `
            SELECT a.*, r.reservation_number 
            FROM assignments a
            JOIN reservations r ON a.reservation_id = r.id
            WHERE a.assignment_token = $1
        `;
        const assignmentResult = await pool.query(assignmentQuery, [token]);

        if (assignmentResult.rows.length === 0) {
            return res.status(404).json({ success: false, message: '수배서를 찾을 수 없습니다.' });
        }

        const assignment = assignmentResult.rows[0];

        // 수배서 거절 처리
        await pool.query(`
            UPDATE assignments 
            SET 
                status = 'rejected',
                rejection_reason = $1,
                response_at = NOW()
            WHERE assignment_token = $2
        `, [rejection_reason, token]);

        // 예약 상태를 대기중으로 되돌림 (다른 업체에 재수배 가능)
        await pool.query(`
            UPDATE reservations 
            SET payment_status = 'pending', updated_at = NOW()
            WHERE id = $1
        `, [assignment.reservation_id]);

        console.log('❌ 수배서 거절 완료:', assignment.reservation_number);

        res.json({
            success: true,
            message: '수배서가 거절되었습니다.',
            data: {
                rejection_reason: rejection_reason,
                reservation_number: assignment.reservation_number
            }
        });

    } catch (error) {
        console.error('❌ 수배서 거절 오류:', error);
        res.status(500).json({ success: false, message: '수배서 거절 중 오류가 발생했습니다: ' + error.message });
    }
});

// 예약 ID로 수배서 정보 조회 API
app.get('/api/assignments/by-reservation/:reservationId', requireAuth, async (req, res) => {
    try {
        const { reservationId } = req.params;
        
        console.log('🔍 수배서 조회 by-reservation:', reservationId);
        
        // 수배서 정보 조회
        const query = `
            SELECT 
                a.*,
                v.vendor_name,
                v.email as vendor_email,
                v.phone as vendor_phone
            FROM assignments a
            LEFT JOIN vendors v ON a.vendor_id = v.id
            WHERE a.reservation_id = $1
            ORDER BY a.created_at DESC
            LIMIT 1
        `;
        
        const result = await pool.query(query, [reservationId]);
        
        if (result.rows.length === 0) {
            console.log('⚠️ 수배서 없음 - reservation_id:', reservationId);
            return res.json({ success: true, assignment: null, assignment_token: null });
        }
        
        const assignment = result.rows[0];
        console.log('✅ 수배서 조회 성공:', {
            id: assignment.id,
            assignment_token: assignment.assignment_token,
            viewed_at: assignment.viewed_at,
            sent_at: assignment.sent_at,
            status: assignment.status
        });
        
        res.json({ 
            success: true, 
            assignment: assignment,
            assignment_token: assignment.assignment_token
        });
        
    } catch (error) {
        console.error('❌ 수배서 조회 오류:', error);
        res.status(500).json({ 
            success: false, 
            message: '수배서 정보를 불러오는데 실패했습니다: ' + error.message 
        });
    }
});

// 구버전 수배 관리 API (사용 안함 - 새로운 API로 대체됨)
/*
app.get('/api/assignments', requireAuth, async (req, res) => {
    try {
        const status = req.query.status || '';
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;
        
        let whereClause = 'WHERE 1=1';
        const params = [];
        
        if (status) {
            whereClause += ' AND a.status = $1';
            params.push(status);
        }
        
        const query = `
            SELECT a.*, r.customer_name, r.tour_date, r.platform_name,
                   COUNT(*) OVER() as total_count
            FROM assignments a
            LEFT JOIN reservations r ON a.reservation_id = r.id
            ${whereClause}
            ORDER BY a.created_at DESC
            LIMIT $${params.length + 1} OFFSET $${params.length + 2}
        `;
        
        params.push(limit, offset);
        
        const result = await pool.query(query, params);
        const totalCount = result.rows.length > 0 ? parseInt(result.rows[0].total_count) : 0;
        
        res.json({
            success: true,
            data: {
                assignments: result.rows,
                pagination: {
                    currentPage: page,
                    totalPages: Math.ceil(totalCount / limit),
                    total: totalCount,
                    limit
                }
            }
        });
        
    } catch (error) {
        console.error('수배 목록 조회 오류:', error);
        res.status(500).json({
            success: false,
            message: '수배 목록을 불러오는 중 오류가 발생했습니다.'
        });
    }
});
*/

// ============================================
// 파싱 설정 관리 API (로컬스토리지 → DB 전환)
// ============================================

// 파싱 설정 조회 (모든 관리자 공유)
app.get('/api/parsing-settings', requireAuth, async (req, res) => {
    try {
        // 모든 관리자가 'shared' 설정 사용
        const sharedUsername = 'shared';
        
        const result = await pool.query(
            'SELECT * FROM parsing_settings WHERE admin_username = $1',
            [sharedUsername]
        );
        
        if (result.rows.length === 0) {
            // 설정이 없으면 기본값 생성
            const insertResult = await pool.query(
                `INSERT INTO parsing_settings (admin_username, preprocessing_rules, custom_parsing_rules)
                 VALUES ($1, '[]'::jsonb, '[]'::jsonb)
                 RETURNING *`,
                [sharedUsername]
            );
            
            console.log('✅ 공유 파싱 설정 생성 완료 (shared)');
            
            return res.json({
                success: true,
                settings: insertResult.rows[0]
            });
        }
        
        res.json({
            success: true,
            settings: result.rows[0]
        });
    } catch (error) {
        console.error('❌ 파싱 설정 조회 오류:', error);
        res.status(500).json({
            success: false,
            message: '파싱 설정 조회 실패: ' + error.message
        });
    }
});

// 파싱 설정 저장 (모든 관리자 공유)
app.post('/api/parsing-settings', requireAuth, async (req, res) => {
    try {
        // 모든 관리자가 'shared' 설정 사용
        const sharedUsername = 'shared';
        const { preprocessing_rules, custom_prompt, custom_parsing_rules } = req.body;
        
        console.log('💾 파싱 설정 저장 요청 (공유):', {
            preprocessing_rules: preprocessing_rules?.length || 0,
            custom_prompt: custom_prompt ? '있음' : '없음',
            custom_parsing_rules: custom_parsing_rules?.length || 0
        });
        
        // UPSERT (있으면 업데이트, 없으면 추가)
        const result = await pool.query(
            `INSERT INTO parsing_settings 
             (admin_username, preprocessing_rules, custom_prompt, custom_parsing_rules)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (admin_username) 
             DO UPDATE SET 
                preprocessing_rules = $2,
                custom_prompt = $3,
                custom_parsing_rules = $4,
                updated_at = CURRENT_TIMESTAMP
             RETURNING *`,
            [
                sharedUsername,
                JSON.stringify(preprocessing_rules || []),
                custom_prompt || '',
                JSON.stringify(custom_parsing_rules || [])
            ]
        );
        
        console.log('✅ 공유 파싱 설정 저장 완료');
        
        res.json({
            success: true,
            message: '파싱 설정이 저장되었습니다. (모든 관리자 공유)',
            settings: result.rows[0]
        });
    } catch (error) {
        console.error('❌ 파싱 설정 저장 오류:', error);
        res.status(500).json({
            success: false,
            message: '파싱 설정 저장 실패: ' + error.message
        });
    }
});

// ============================================
// 수배업체 관리 API
// ============================================

// 수배업체 목록 조회
app.get('/api/vendors', requireAuth, async (req, res) => {
    try {
        const query = `
            SELECT 
                v.*,
                COUNT(DISTINCT vp.id) as product_count,
                COUNT(DISTINCT a.id) as assignment_count
            FROM vendors v
            LEFT JOIN vendor_products vp ON v.id = vp.vendor_id
            LEFT JOIN assignments a ON v.id = a.vendor_id
            GROUP BY v.id
            ORDER BY v.created_at DESC
        `;
        
        const result = await pool.query(query);
        
        res.json({
            success: true,
            vendors: result.rows
        });
    } catch (error) {
        console.error('❌ 수배업체 목록 조회 오류:', error);
        res.status(500).json({
            success: false,
            message: '수배업체 목록 조회 실패: ' + error.message
        });
    }
});

// 수배업체 단일 조회 (상품 포함)
app.get('/api/vendors/:vendorId', requireAuth, async (req, res) => {
    try {
        const { vendorId } = req.params;
        
        // 수배업체 정보
        const vendorQuery = 'SELECT * FROM vendors WHERE id = $1';
        const vendorResult = await pool.query(vendorQuery, [vendorId]);
        
        if (vendorResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '수배업체를 찾을 수 없습니다'
            });
        }
        
        // 담당 상품 목록
        const productsQuery = `
            SELECT * FROM vendor_products 
            WHERE vendor_id = $1 
            ORDER BY priority ASC, created_at ASC
        `;
        const productsResult = await pool.query(productsQuery, [vendorId]);
        
        res.json({
            success: true,
            vendor: vendorResult.rows[0],
            products: productsResult.rows
        });
    } catch (error) {
        console.error('❌ 수배업체 조회 오류:', error);
        res.status(500).json({
            success: false,
            message: '수배업체 조회 실패: ' + error.message
        });
    }
});

// 수배업체 등록
app.post('/api/vendors', requireAuth, async (req, res) => {
    try {
        const { vendor_name, vendor_id, password, email, phone, contact_person, 
                business_type, description, notification_email, products } = req.body;
        
        if (!vendor_name || !vendor_id || !password || !email) {
            return res.status(400).json({
                success: false,
                message: '필수 항목을 입력해주세요'
            });
        }
        
        // 비밀번호 해싱
        const bcrypt = require('bcryptjs');
        const password_hash = await bcrypt.hash(password, 10);
        
        // 수배업체 등록
        const vendorQuery = `
            INSERT INTO vendors (
                vendor_name, vendor_id, password_hash, email, phone, 
                contact_person, business_type, description, notification_email,
                is_active, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, NOW(), NOW())
            RETURNING *
        `;
        
        const vendorResult = await pool.query(vendorQuery, [
            vendor_name, vendor_id, password_hash, email, phone || null,
            contact_person || null, business_type || null, description || null,
            notification_email || email
        ]);
        
        const newVendor = vendorResult.rows[0];
        
        // 담당 상품 등록
        if (products && products.length > 0) {
            for (const product of products) {
                await pool.query(`
                    INSERT INTO vendor_products (vendor_id, product_keyword, priority, is_active)
                    VALUES ($1, $2, $3, true)
                `, [newVendor.id, product.keyword, product.priority || 1]);
            }
        }
        
        console.log('✅ 수배업체 등록 완료:', vendor_name);
        
        res.json({
            success: true,
            message: '수배업체가 등록되었습니다',
            vendor: newVendor
        });
    } catch (error) {
        console.error('❌ 수배업체 등록 오류:', error);
        
        // 중복 오류 처리
        if (error.code === '23505') {
            return res.status(400).json({
                success: false,
                message: '이미 등록된 업체명 또는 아이디입니다'
            });
        }
        
        res.status(500).json({
            success: false,
            message: '수배업체 등록 실패: ' + error.message
        });
    }
});

// 수배업체 수정
app.put('/api/vendors/:vendorId', requireAuth, async (req, res) => {
    try {
        const { vendorId } = req.params;
        const { vendor_name, vendor_id, password, email, phone, contact_person,
                business_type, description, notification_email, products } = req.body;
        
        if (!vendor_name || !vendor_id || !email) {
            return res.status(400).json({
                success: false,
                message: '필수 항목을 입력해주세요'
            });
        }
        
        let updateQuery;
        let updateParams;
        
        // 비밀번호 변경 여부 확인
        if (password && password.trim() !== '') {
            const bcrypt = require('bcryptjs');
            const password_hash = await bcrypt.hash(password, 10);
            
            updateQuery = `
                UPDATE vendors SET
                    vendor_name = $1, vendor_id = $2, password_hash = $3, email = $4,
                    phone = $5, contact_person = $6, business_type = $7, description = $8,
                    notification_email = $9, updated_at = NOW()
                WHERE id = $10
                RETURNING *
            `;
            updateParams = [
                vendor_name, vendor_id, password_hash, email, phone || null,
                contact_person || null, business_type || null, description || null,
                notification_email || email, vendorId
            ];
        } else {
            updateQuery = `
                UPDATE vendors SET
                    vendor_name = $1, vendor_id = $2, email = $3, phone = $4,
                    contact_person = $5, business_type = $6, description = $7,
                    notification_email = $8, updated_at = NOW()
                WHERE id = $9
                RETURNING *
            `;
            updateParams = [
                vendor_name, vendor_id, email, phone || null, contact_person || null,
                business_type || null, description || null, notification_email || email,
                vendorId
            ];
        }
        
        const result = await pool.query(updateQuery, updateParams);
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '수배업체를 찾을 수 없습니다'
            });
        }
        
        // 담당 상품 업데이트 (기존 삭제 후 재등록)
        await pool.query('DELETE FROM vendor_products WHERE vendor_id = $1', [vendorId]);
        
        if (products && products.length > 0) {
            for (const product of products) {
                await pool.query(`
                    INSERT INTO vendor_products (vendor_id, product_keyword, priority, is_active)
                    VALUES ($1, $2, $3, true)
                `, [vendorId, product.keyword, product.priority || 1]);
            }
        }
        
        console.log('✅ 수배업체 수정 완료:', vendor_name);
        
        res.json({
            success: true,
            message: '수배업체 정보가 수정되었습니다',
            vendor: result.rows[0]
        });
    } catch (error) {
        console.error('❌ 수배업체 수정 오류:', error);
        
        if (error.code === '23505') {
            return res.status(400).json({
                success: false,
                message: '이미 사용 중인 업체명 또는 아이디입니다'
            });
        }
        
        res.status(500).json({
            success: false,
            message: '수배업체 수정 실패: ' + error.message
        });
    }
});

// 수배업체 삭제
app.delete('/api/vendors/:vendorId', requireAuth, async (req, res) => {
    try {
        const { vendorId } = req.params;
        
        // 진행 중인 수배가 있는지 확인
        const assignmentCheck = await pool.query(`
            SELECT COUNT(*) as count 
            FROM assignments 
            WHERE vendor_id = $1 AND status IN ('pending', 'sent', 'confirmed')
        `, [vendorId]);
        
        if (parseInt(assignmentCheck.rows[0].count) > 0) {
            return res.status(400).json({
                success: false,
                message: '진행 중인 수배가 있어 삭제할 수 없습니다'
            });
        }
        
        // 수배업체 삭제 (ON DELETE CASCADE로 관련 데이터 자동 삭제)
        const result = await pool.query('DELETE FROM vendors WHERE id = $1 RETURNING *', [vendorId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '수배업체를 찾을 수 없습니다'
            });
        }
        
        console.log('✅ 수배업체 삭제 완료:', result.rows[0].vendor_name);
        
        res.json({
            success: true,
            message: '수배업체가 삭제되었습니다'
        });
    } catch (error) {
        console.error('❌ 수배업체 삭제 오류:', error);
        res.status(500).json({
            success: false,
            message: '수배업체 삭제 실패: ' + error.message
        });
    }
});

// ============================================
// 수배업체 상품명 관리 API
// ============================================

// 수배업체별 상품명 목록 조회
app.get('/api/vendors/:vendorId/products', requireAuth, async (req, res) => {
    try {
        const { vendorId } = req.params;
        
        const query = `
            SELECT * FROM vendor_products 
            WHERE vendor_id = $1 
            ORDER BY priority ASC, created_at ASC
        `;
        
        const result = await pool.query(query, [vendorId]);
        
        res.json({
            success: true,
            products: result.rows
        });
    } catch (error) {
        console.error('❌ 수배업체 상품명 조회 오류:', error);
        res.status(500).json({
            success: false,
            message: '상품명 목록 조회 실패: ' + error.message
        });
    }
});

// 수배업체 상품명 추가
app.post('/api/vendors/:vendorId/products', requireAuth, async (req, res) => {
    try {
        const { vendorId } = req.params;
        const { product_keyword, priority } = req.body;
        
        if (!product_keyword) {
            return res.status(400).json({
                success: false,
                message: '상품명 키워드를 입력해주세요'
            });
        }
        
        const query = `
            INSERT INTO vendor_products (vendor_id, product_keyword, priority, is_active)
            VALUES ($1, $2, $3, true)
            RETURNING *
        `;
        
        const result = await pool.query(query, [vendorId, product_keyword, priority || 1]);
        
        console.log('✅ 상품명 추가:', product_keyword);
        
        res.json({
            success: true,
            product: result.rows[0]
        });
    } catch (error) {
        console.error('❌ 상품명 추가 오류:', error);
        res.status(500).json({
            success: false,
            message: '상품명 추가 실패: ' + error.message
        });
    }
});

// 수배업체 상품명 삭제
app.delete('/api/vendors/:vendorId/products/:productId', requireAuth, async (req, res) => {
    try {
        const { vendorId, productId } = req.params;
        
        const query = 'DELETE FROM vendor_products WHERE id = $1 AND vendor_id = $2';
        const result = await pool.query(query, [productId, vendorId]);
        
        if (result.rowCount === 0) {
            return res.status(404).json({
                success: false,
                message: '삭제할 상품명을 찾을 수 없습니다'
            });
        }
        
        console.log('✅ 상품명 삭제 완료');
        
        res.json({
            success: true,
            message: '상품명이 삭제되었습니다'
        });
    } catch (error) {
        console.error('❌ 상품명 삭제 오류:', error);
        res.status(500).json({
            success: false,
            message: '상품명 삭제 실패: ' + error.message
        });
    }
});

// ============================================
// 예약업체(플랫폼) 관리 API
// ============================================

// 예약업체 목록 조회
app.get('/api/platforms', requireAuth, async (req, res) => {
    try {
        const query = `
            SELECT 
                p.*,
                COUNT(DISTINCT r.id) as reservation_count,
                COALESCE(SUM(r.total_amount), 0) as total_amount
            FROM platforms p
            LEFT JOIN reservations r ON p.platform_name = r.platform_name
            GROUP BY p.id
            ORDER BY p.created_at DESC
        `;
        
        const result = await pool.query(query);
        
        res.json({
            success: true,
            platforms: result.rows
        });
    } catch (error) {
        console.error('❌ 예약업체 목록 조회 오류:', error);
        res.status(500).json({
            success: false,
            message: '예약업체 목록 조회 실패: ' + error.message
        });
    }
});

// 예약업체 단일 조회
app.get('/api/platforms/:platformId', requireAuth, async (req, res) => {
    try {
        const { platformId } = req.params;
        
        const query = 'SELECT * FROM platforms WHERE id = $1';
        const result = await pool.query(query, [platformId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '예약업체를 찾을 수 없습니다'
            });
        }
        
        res.json({
            success: true,
            platform: result.rows[0]
        });
    } catch (error) {
        console.error('❌ 예약업체 조회 오류:', error);
        res.status(500).json({
            success: false,
            message: '예약업체 조회 실패: ' + error.message
        });
    }
});

// 예약업체 등록
app.post('/api/platforms', requireAuth, async (req, res) => {
    try {
        const { platform_name, platform_code, contact_person, email, phone,
                aliases, memo } = req.body;
        
        if (!platform_name || !platform_code) {
            return res.status(400).json({
                success: false,
                message: '업체명과 업체 코드는 필수 항목입니다'
            });
        }
        
        // 별칭 배열을 JSON으로 변환
        const aliasesJson = JSON.stringify(aliases || []);
        
        const query = `
            INSERT INTO platforms (
                platform_name, platform_code, contact_person, email, phone,
                aliases, memo, is_active, created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, true, NOW(), NOW())
            RETURNING *
        `;
        
        const result = await pool.query(query, [
            platform_name, platform_code, contact_person || null, email || null, phone || null,
            aliasesJson, memo || null
        ]);
        
        console.log('✅ 예약업체 등록 완료:', platform_name, '/ 별칭:', aliases);
        
        res.json({
            success: true,
            message: '예약업체가 등록되었습니다',
            platform: result.rows[0]
        });
    } catch (error) {
        console.error('❌ 예약업체 등록 오류:', error);
        
        if (error.code === '23505') {
            return res.status(400).json({
                success: false,
                message: '이미 등록된 업체명 또는 코드입니다'
            });
        }
        
        res.status(500).json({
            success: false,
            message: '예약업체 등록 실패: ' + error.message
        });
    }
});

// 예약업체 수정
app.put('/api/platforms/:platformId', requireAuth, async (req, res) => {
    try {
        const { platformId } = req.params;
        const { platform_name, platform_code, contact_person, email, phone,
                aliases, memo, is_active } = req.body;
        
        if (!platform_name || !platform_code) {
            return res.status(400).json({
                success: false,
                message: '업체명과 업체 코드는 필수 항목입니다'
            });
        }
        
        // 별칭 배열을 JSON으로 변환
        const aliasesJson = JSON.stringify(aliases || []);
        
        const query = `
            UPDATE platforms 
            SET platform_name = $1, platform_code = $2, contact_person = $3,
                email = $4, phone = $5, aliases = $6, memo = $7,
                is_active = $8, updated_at = NOW()
            WHERE id = $9
            RETURNING *
        `;
        
        const result = await pool.query(query, [
            platform_name, platform_code, contact_person || null, email || null, phone || null,
            aliasesJson, memo || null, is_active !== undefined ? is_active : true, platformId
        ]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '예약업체를 찾을 수 없습니다'
            });
        }
        
        console.log('✅ 예약업체 수정 완료:', platform_name, '/ 별칭:', aliases);
        
        res.json({
            success: true,
            message: '예약업체가 수정되었습니다',
            platform: result.rows[0]
        });
    } catch (error) {
        console.error('❌ 예약업체 수정 오류:', error);
        
        if (error.code === '23505') {
            return res.status(400).json({
                success: false,
                message: '이미 등록된 업체명 또는 코드입니다'
            });
        }
        
        res.status(500).json({
            success: false,
            message: '예약업체 수정 실패: ' + error.message
        });
    }
});

// 예약업체 삭제
app.delete('/api/platforms/:platformId', requireAuth, async (req, res) => {
    try {
        const { platformId } = req.params;
        
        const query = 'DELETE FROM platforms WHERE id = $1 RETURNING *';
        const result = await pool.query(query, [platformId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '예약업체를 찾을 수 없습니다'
            });
        }
        
        console.log('✅ 예약업체 삭제 완료:', result.rows[0].platform_name);
        
        res.json({
            success: true,
            message: '예약업체가 삭제되었습니다'
        });
    } catch (error) {
        console.error('❌ 예약업체 삭제 오류:', error);
        res.status(500).json({
            success: false,
            message: '예약업체 삭제 실패: ' + error.message
        });
    }
});

// 별칭으로 표준 업체명 조회 (인박스용)
app.post('/api/platforms/resolve-alias', async (req, res) => {
    try {
        const { alias } = req.body;
        
        if (!alias || !alias.trim()) {
            return res.json({
                success: true,
                standardName: null,
                matched: false
            });
        }
        
        const cleanAlias = alias.trim();
        
        // 모든 활성 업체의 별칭 조회
        const query = `
            SELECT platform_name, platform_code, aliases 
            FROM platforms 
            WHERE is_active = true
        `;
        
        const result = await pool.query(query);
        
        // 1. 업체명 정확히 일치
        for (const platform of result.rows) {
            if (platform.platform_name.toLowerCase() === cleanAlias.toLowerCase()) {
                return res.json({
                    success: true,
                    standardName: platform.platform_name,
                    platformCode: platform.platform_code,
                    matched: true,
                    matchType: 'exact_name'
                });
            }
        }
        
        // 2. 업체 코드 정확히 일치
        for (const platform of result.rows) {
            if (platform.platform_code.toLowerCase() === cleanAlias.toLowerCase()) {
                return res.json({
                    success: true,
                    standardName: platform.platform_name,
                    platformCode: platform.platform_code,
                    matched: true,
                    matchType: 'code'
                });
            }
        }
        
        // 3. 별칭 조회 (대소문자 무시, 부분 일치)
        for (const platform of result.rows) {
            const aliases = platform.aliases || [];
            for (const platformAlias of aliases) {
                if (platformAlias.toLowerCase() === cleanAlias.toLowerCase() ||
                    cleanAlias.toLowerCase().includes(platformAlias.toLowerCase()) ||
                    platformAlias.toLowerCase().includes(cleanAlias.toLowerCase())) {
                    return res.json({
                        success: true,
                        standardName: platform.platform_name,
                        platformCode: platform.platform_code,
                        matched: true,
                        matchType: 'alias',
                        matchedAlias: platformAlias
                    });
                }
            }
        }
        
        // 매칭 실패
        res.json({
            success: true,
            standardName: null,
            matched: false
        });
        
    } catch (error) {
        console.error('❌ 별칭 조회 오류:', error);
        res.status(500).json({
            success: false,
            message: '별칭 조회 실패: ' + error.message
        });
    }
});

// 자동 수배 생성 함수
async function createAutoAssignment(reservationId, productName) {
    try {
        // 상품명으로 수배업체 자동 매칭
        const matchQuery = `
            SELECT v.*, vp.product_keyword, vp.priority
            FROM vendors v
            JOIN vendor_products vp ON v.id = vp.vendor_id
            WHERE v.is_active = true AND vp.is_active = true
            AND LOWER($1) LIKE '%' || LOWER(vp.product_keyword) || '%'
            ORDER BY vp.priority ASC, v.created_at ASC
            LIMIT 1
        `;
        
        const matchResult = await pool.query(matchQuery, [productName]);
        
        if (matchResult.rows.length === 0) {
            console.log('자동 매칭되는 수배업체가 없습니다:', productName);
            return null;
        }
        
        const vendor = matchResult.rows[0];
        
        // 고유 토큰 생성
        const crypto = require('crypto');
        const assignment_token = crypto.randomBytes(16).toString('hex');
        
        // 자동 수배서 생성 (대기중 상태로 시작)
        const insertQuery = `
            INSERT INTO assignments (
                reservation_id, vendor_id, vendor_name, vendor_contact,
                assignment_token, status, notes, assigned_by, assigned_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
            RETURNING *
        `;
        
        const vendor_contact = {
            email: vendor.email,
            phone: vendor.phone,
            contact_person: vendor.contact_person
        };
        
        const insertParams = [
            reservationId,
            vendor.id,
            vendor.vendor_name,
            JSON.stringify(vendor_contact),
            assignment_token,
            'pending', // 대기중 상태로 생성
            `자동 매칭된 수배서 (${productName})`,
            'system'
        ];
        
        const result = await pool.query(insertQuery, insertParams);
        
        console.log('✅ 자동 수배서 생성 완료:', {
            reservationId,
            vendor: vendor.vendor_name,
            keyword: vendor.product_keyword
        });
        
        return {
            assignment: result.rows[0],
            vendor: vendor,
            assignment_link: `/assignment/${assignment_token}`
        };
        
    } catch (error) {
        console.error('자동 수배서 생성 오류:', error);
        return null;
    }
}

// 바로 확정 상품 체크 함수
function isAutoConfirmProduct(productName) {
    if (!productName) return false;
    
    const autoConfirmKeywords = [
        '롱혼스테이크', '롱혼', 'longhorn',
        '레스토랑', '식당', '맛집', '카페',
        '렌터카', '렌트카', 'rental',
        '쇼핑', 'shopping', '면세점'
    ];
    
    const lowerProductName = productName.toLowerCase();
    return autoConfirmKeywords.some(keyword => 
        lowerProductName.includes(keyword.toLowerCase())
    );
}

// 임시: assignments 테이블 필드 추가 (Railway 실행용)
app.get('/admin/setup-assignments', requireAuth, async (req, res) => {
    try {
        console.log('🔧 assignments 테이블에 필요한 필드들을 추가합니다...');

        // 1. assignment_token 필드 추가
        await pool.query(`
            DO $$ 
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'assignments' AND column_name = 'assignment_token'
                ) THEN
                    ALTER TABLE assignments ADD COLUMN assignment_token VARCHAR(100) UNIQUE;
                    CREATE INDEX IF NOT EXISTS idx_assignments_token ON assignments(assignment_token);
                END IF;
            END $$;
        `);

        // 2. viewed_at 필드 추가
        await pool.query(`
            DO $$ 
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'assignments' AND column_name = 'viewed_at'
                ) THEN
                    ALTER TABLE assignments ADD COLUMN viewed_at TIMESTAMP;
                END IF;
            END $$;
        `);

        // 3. response_at 필드 추가
        await pool.query(`
            DO $$ 
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'assignments' AND column_name = 'response_at'
                ) THEN
                    ALTER TABLE assignments ADD COLUMN response_at TIMESTAMP;
                END IF;
            END $$;
        `);

        // 4. confirmation_number 필드 추가
        await pool.query(`
            DO $$ 
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'assignments' AND column_name = 'confirmation_number'
                ) THEN
                    ALTER TABLE assignments ADD COLUMN confirmation_number VARCHAR(100);
                END IF;
            END $$;
        `);

        // 5. voucher_token 필드 추가
        await pool.query(`
            DO $$ 
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'assignments' AND column_name = 'voucher_token'
                ) THEN
                    ALTER TABLE assignments ADD COLUMN voucher_token VARCHAR(100) UNIQUE;
                    CREATE INDEX IF NOT EXISTS idx_assignments_voucher_token ON assignments(voucher_token);
                END IF;
            END $$;
        `);

        // 6. sent_at 필드 추가
        await pool.query(`
            DO $$ 
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'assignments' AND column_name = 'sent_at'
                ) THEN
                    ALTER TABLE assignments ADD COLUMN sent_at TIMESTAMP;
                END IF;
            END $$;
        `);

        // 7. rejection_reason 필드 추가
        await pool.query(`
            DO $$ 
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'assignments' AND column_name = 'rejection_reason'
                ) THEN
                    ALTER TABLE assignments ADD COLUMN rejection_reason TEXT;
                END IF;
            END $$;
        `);

        // 현재 테이블 구조 확인
        const result = await pool.query(`
            SELECT column_name, data_type, is_nullable, column_default
            FROM information_schema.columns 
            WHERE table_name = 'assignments'
            ORDER BY ordinal_position
        `);

        res.json({
            success: true,
            message: 'assignments 테이블 필드 추가 완료!',
            columns: result.rows
        });

    } catch (error) {
        console.error('❌ assignments 테이블 필드 추가 중 오류:', error);
        res.status(500).json({
            success: false,
            message: 'assignments 테이블 필드 추가 실패: ' + error.message
        });
    }
});

// ==================== 수배업체 API ====================

// 수배업체 목록 조회 API
app.get('/api/vendors', requireAuth, async (req, res) => {
    try {
        const query = `
            SELECT v.*, 
                   COUNT(vp.id) as product_count
            FROM vendors v
            LEFT JOIN vendor_products vp ON v.id = vp.vendor_id
            GROUP BY v.id
            ORDER BY v.vendor_name ASC
        `;
        
        const result = await pool.query(query);
        
        res.json({
            success: true,
            vendors: result.rows
        });
    } catch (error) {
        console.error('❌ 수배업체 목록 조회 실패:', error);
        res.status(500).json({
            success: false,
            message: '수배업체 목록 조회 중 오류가 발생했습니다: ' + error.message
        });
    }
});

// 플랫폼 목록 조회 API
app.get('/api/platforms', requireAuth, async (req, res) => {
    try {
        const query = `
            SELECT id, platform_name, platform_code, commission_rate, is_active
            FROM platforms
            WHERE is_active = true
            ORDER BY platform_name ASC
        `;
        
        const result = await pool.query(query);
        
        res.json({
            success: true,
            platforms: result.rows
        });
    } catch (error) {
        console.error('❌ 플랫폼 목록 조회 실패:', error);
        res.status(500).json({
            success: false,
            message: '플랫폼 목록 조회 중 오류가 발생했습니다: ' + error.message
        });
    }
});

// 상품명으로 수배업체 자동 매칭 API (인박스용)
app.post('/api/vendors/match', requireAuth, async (req, res) => {
    try {
        const { product_name } = req.body;
        
        console.log('🔍 수배업체 매칭 API 호출:', product_name);
        
        if (!product_name || product_name.trim() === '') {
            return res.json({
                success: false,
                message: '상품명이 필요합니다.'
            });
        }
        
        const matchQuery = `
            SELECT v.*, vp.product_keyword, vp.priority
            FROM vendors v
            JOIN vendor_products vp ON v.id = vp.vendor_id
            WHERE v.is_active = true AND vp.is_active = true
            AND LOWER($1) LIKE '%' || LOWER(vp.product_keyword) || '%'
            ORDER BY vp.priority ASC, v.created_at ASC
            LIMIT 1
        `;
        
        const result = await pool.query(matchQuery, [product_name]);
        
        console.log('📊 매칭 시도:', {
            상품명: product_name,
            결과: result.rows.length > 0 ? result.rows[0].vendor_name : '매칭 없음',
            매칭키워드: result.rows.length > 0 ? result.rows[0].product_keyword : 'N/A'
        });
        
        if (result.rows.length > 0) {
            res.json({
                success: true,
                vendor: result.rows[0],
                matched_keyword: result.rows[0].product_keyword
            });
        } else {
            res.json({
                success: false,
                message: '매칭되는 수배업체가 없습니다.'
            });
        }
    } catch (error) {
        console.error('❌ 수배업체 매칭 실패:', error);
        res.status(500).json({
            success: false,
            message: '수배업체 매칭 중 오류가 발생했습니다: ' + error.message
        });
    }
});

// ==================== 관리자 직원 계정 관리 API ====================

// 직원 목록 조회
app.get('/api/admin-users', requireAuth, async (req, res) => {
    try {
        const result = await pool.query(`
            SELECT id, username, full_name, email, phone, role, is_active, last_login, created_at
            FROM admin_users
            ORDER BY created_at DESC
        `);
        
        res.json({
            success: true,
            users: result.rows
        });
    } catch (error) {
        console.error('❌ 직원 목록 조회 실패:', error);
        res.status(500).json({
            success: false,
            message: '직원 목록 조회 중 오류가 발생했습니다: ' + error.message
        });
    }
});

// 직원 등록
app.post('/api/admin-users', requireAuth, async (req, res) => {
    try {
        const { username, password, full_name, email, phone, role } = req.body;
        
        // 필수 필드 검증
        if (!username || !password || !full_name) {
            return res.status(400).json({
                success: false,
                message: '아이디, 비밀번호, 이름은 필수입니다.'
            });
        }
        
        // 중복 아이디 체크
        const checkUser = await pool.query(
            'SELECT * FROM admin_users WHERE username = $1',
            [username]
        );
        
        if (checkUser.rows.length > 0) {
            return res.status(400).json({
                success: false,
                message: '이미 사용 중인 아이디입니다.'
            });
        }
        
        // 비밀번호 해시
        const bcrypt = require('bcryptjs');
        const password_hash = await bcrypt.hash(password, 10);
        
        // 직원 등록
        const result = await pool.query(`
            INSERT INTO admin_users (username, password_hash, full_name, email, phone, role)
            VALUES ($1, $2, $3, $4, $5, $6)
            RETURNING id, username, full_name, email, phone, role, is_active, created_at
        `, [username, password_hash, full_name, email || null, phone || null, role || 'staff']);
        
        console.log('✅ 직원 등록 완료:', username);
        
        res.json({
            success: true,
            message: '직원이 등록되었습니다.',
            user: result.rows[0]
        });
    } catch (error) {
        console.error('❌ 직원 등록 실패:', error);
        res.status(500).json({
            success: false,
            message: '직원 등록 중 오류가 발생했습니다: ' + error.message
        });
    }
});

// 직원 수정
app.put('/api/admin-users/:id', requireAuth, async (req, res) => {
    try {
        const userId = req.params.id;
        const { full_name, email, phone, role, is_active, password } = req.body;
        
        // 업데이트할 필드 동적 생성
        const updates = [];
        const values = [];
        let paramIndex = 1;
        
        if (full_name !== undefined) {
            updates.push(`full_name = $${paramIndex++}`);
            values.push(full_name);
        }
        if (email !== undefined) {
            updates.push(`email = $${paramIndex++}`);
            values.push(email || null);
        }
        if (phone !== undefined) {
            updates.push(`phone = $${paramIndex++}`);
            values.push(phone || null);
        }
        if (role !== undefined) {
            updates.push(`role = $${paramIndex++}`);
            values.push(role);
        }
        if (is_active !== undefined) {
            updates.push(`is_active = $${paramIndex++}`);
            values.push(is_active);
        }
        
        // 비밀번호 변경 (선택사항)
        if (password && password.trim() !== '') {
            const bcrypt = require('bcryptjs');
            const password_hash = await bcrypt.hash(password, 10);
            updates.push(`password_hash = $${paramIndex++}`);
            values.push(password_hash);
        }
        
        if (updates.length === 0) {
            return res.status(400).json({
                success: false,
                message: '수정할 내용이 없습니다.'
            });
        }
        
        updates.push(`updated_at = NOW()`);
        values.push(userId);
        
        const query = `
            UPDATE admin_users 
            SET ${updates.join(', ')}
            WHERE id = $${paramIndex}
            RETURNING id, username, full_name, email, phone, role, is_active, updated_at
        `;
        
        const result = await pool.query(query, values);
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '직원을 찾을 수 없습니다.'
            });
        }
        
        console.log('✅ 직원 정보 수정 완료:', result.rows[0].username);
        
        res.json({
            success: true,
            message: '직원 정보가 수정되었습니다.',
            user: result.rows[0]
        });
    } catch (error) {
        console.error('❌ 직원 수정 실패:', error);
        res.status(500).json({
            success: false,
            message: '직원 수정 중 오류가 발생했습니다: ' + error.message
        });
    }
});

// 직원 삭제
app.delete('/api/admin-users/:id', requireAuth, async (req, res) => {
    try {
        const userId = req.params.id;
        
        // admin 계정은 삭제 불가
        const checkAdmin = await pool.query(
            'SELECT username FROM admin_users WHERE id = $1',
            [userId]
        );
        
        if (checkAdmin.rows.length > 0 && checkAdmin.rows[0].username === 'admin') {
            return res.status(400).json({
                success: false,
                message: '기본 관리자 계정은 삭제할 수 없습니다.'
            });
        }
        
        const result = await pool.query(
            'DELETE FROM admin_users WHERE id = $1 RETURNING username',
            [userId]
        );
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '직원을 찾을 수 없습니다.'
            });
        }
        
        console.log('✅ 직원 삭제 완료:', result.rows[0].username);
        
        res.json({
            success: true,
            message: '직원이 삭제되었습니다.'
        });
    } catch (error) {
        console.error('❌ 직원 삭제 실패:', error);
        res.status(500).json({
            success: false,
            message: '직원 삭제 중 오류가 발생했습니다: ' + error.message
        });
    }
});

// ==================== 수배업체 관리 ====================

// 샘플 수배업체 데이터 추가 (Railway 실행용)
app.get('/admin/setup-vendors', requireAuth, async (req, res) => {
    try {
        console.log('🏢 샘플 수배업체 데이터 추가 시작...');
        
        const client = await pool.connect();
        
        try {
            await client.query('BEGIN');
            
            // 샘플 수배업체 데이터
            const vendors = [
                {
                    vendor_name: '괌 돌핀크루즈',
                    vendor_id: 'dolphin_cruise',
                    password: 'dolphin123',
                    email: 'dolphin@guam.com',
                    phone: '+1-671-555-0001',
                    contact_person: '김철수',
                    business_type: '투어/액티비티',
                    description: '돌핀 워칭 전문 업체',
                    notification_email: 'dolphin@guam.com',
                    products: [
                        { keyword: '돌핀', priority: 1 },
                        { keyword: 'dolphin', priority: 1 },
                        { keyword: '크루즈', priority: 2 }
                    ]
                },
                {
                    vendor_name: '괌 공연장',
                    vendor_id: 'guam_theater',
                    password: 'theater123',
                    email: 'theater@guam.com',
                    phone: '+1-671-555-0002',
                    contact_person: '이영희',
                    business_type: '공연/엔터테인먼트',
                    description: '각종 공연 및 쇼 운영',
                    notification_email: 'theater@guam.com',
                    products: [
                        { keyword: '공연', priority: 1 },
                        { keyword: '쇼', priority: 1 },
                        { keyword: 'show', priority: 2 }
                    ]
                },
                {
                    vendor_name: '정글리버크루즈',
                    vendor_id: 'jungle_river',
                    password: 'jungle123',
                    email: 'jungle@guam.com',
                    phone: '+1-671-555-0003',
                    contact_person: '박민수',
                    business_type: '투어/액티비티',
                    description: '정글 리버 크루즈 전문',
                    notification_email: 'jungle@guam.com',
                    products: [
                        { keyword: '정글', priority: 1 },
                        { keyword: 'jungle', priority: 1 },
                        { keyword: '리버', priority: 2 }
                    ]
                }
            ];
            
            let addedCount = 0;
            let existingCount = 0;
            
            for (const vendor of vendors) {
                // 패스워드 해시화
                const password_hash = await bcrypt.hash(vendor.password, 10);
                
                // 수배업체 등록 (중복 시 무시)
                const vendorResult = await client.query(`
                    INSERT INTO vendors (
                        vendor_name, vendor_id, password_hash, email, phone, 
                        contact_person, business_type, description, notification_email
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                    ON CONFLICT (vendor_name) DO NOTHING
                    RETURNING id, vendor_name
                `, [
                    vendor.vendor_name, vendor.vendor_id, password_hash, vendor.email, vendor.phone,
                    vendor.contact_person, vendor.business_type, vendor.description, vendor.notification_email
                ]);
                
                if (vendorResult.rows.length > 0) {
                    const vendorId = vendorResult.rows[0].id;
                    console.log(`✅ ${vendor.vendor_name} 등록 완료 (ID: ${vendorId})`);
                    addedCount++;
                    
                    // 담당 상품 등록
                    for (const product of vendor.products) {
                        await client.query(`
                            INSERT INTO vendor_products (vendor_id, product_keyword, priority)
                            VALUES ($1, $2, $3)
                            ON CONFLICT (vendor_id, product_keyword) DO NOTHING
                        `, [vendorId, product.keyword, product.priority]);
                    }
                    console.log(`   📦 담당 상품 ${vendor.products.length}개 등록 완료`);
                } else {
                    console.log(`⚠️ ${vendor.vendor_name} 이미 존재함 (건너뜀)`);
                    existingCount++;
                }
            }
            
            await client.query('COMMIT');
            
            // 등록된 수배업체 확인
            const result = await pool.query(`
                SELECT v.vendor_name, v.business_type, COUNT(vp.id) as product_count
                FROM vendors v
                LEFT JOIN vendor_products vp ON v.id = vp.vendor_id AND vp.is_active = true
                WHERE v.is_active = true
                GROUP BY v.id, v.vendor_name, v.business_type
                ORDER BY v.vendor_name
            `);
            
            res.json({
                success: true,
                message: `샘플 수배업체 데이터 추가 완료! (신규: ${addedCount}개, 기존: ${existingCount}개)`,
                vendors: result.rows
            });
            
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
        
    } catch (error) {
        console.error('❌ 샘플 수배업체 추가 오류:', error);
        res.status(500).json({
            success: false,
            message: '샘플 수배업체 추가 실패: ' + error.message
        });
    }
});

// 수배관리 목록 조회 API (수배중 + 확정 상태의 예약들)
app.get('/api/assignments', requireAuth, async (req, res) => {
    try {
        console.log('🔍 수배관리 API 호출 시작');
        
        // 먼저 테이블 존재 여부 확인
        const tableCheck = await pool.query(`
            SELECT table_name 
            FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name IN ('reservations', 'assignments')
        `);
        console.log('📋 존재하는 테이블:', tableCheck.rows.map(r => r.table_name));
        
        const { page = 1, status = '', search = '' } = req.query;
        const limit = 100;  // 페이지당 100개로 증가
        const offset = (page - 1) * limit;
        
        // ✅ 수배관리 페이지: assignment_token이 있는 예약만 표시 (수배서 생성됨)
        let whereClause = `WHERE a.assignment_token IS NOT NULL`;
        const queryParams = [];
        let paramIndex = 0;
        
        console.log('🔍 수배관리 필터: 수배서 생성된 예약만 표시 (assignment_token 존재)');
        
        // 예약 상태 필터 (선택 사항)
        if (status) {
            paramIndex++;
            whereClause += ` AND r.payment_status = $${paramIndex}`;
            queryParams.push(status);
        } else {
            // 상태 필터가 없으면 예약취소와 정산이관완료는 기본적으로 제외
            if (search) {
                // 검색 시에는 정산이관완료 포함 (예약취소만 제외)
                whereClause += ` AND r.payment_status != 'cancelled'`;
                console.log('✅ 검색 모드: 예약취소만 제외, 정산이관완료 포함');
            } else {
                // 일반 목록에서는 정산이관완료와 예약취소 모두 제외
                whereClause += ` AND r.payment_status NOT IN ('cancelled', 'settlement_completed')`;
                console.log('✅ 일반 목록: 예약취소 및 정산이관완료 제외');
            }
        }
        
        // 검색 필터 (예약번호, 상품명, 고객명)
        if (search) {
            paramIndex++;
            whereClause += ` AND (
                r.reservation_number ILIKE $${paramIndex} OR 
                r.product_name ILIKE $${paramIndex} OR 
                r.korean_name ILIKE $${paramIndex}
            )`;
            queryParams.push(`%${search}%`);
        }
        
        // 총 개수 조회
        const countQuery = `
            SELECT COUNT(*) as total 
            FROM reservations r
            LEFT JOIN assignments a ON r.id = a.reservation_id
            ${whereClause}
        `;
        const countResult = await pool.query(countQuery, queryParams);
        const totalCount = parseInt(countResult.rows[0].total);
        
        // assignments 테이블 존재 여부에 따라 쿼리 분기
        const hasAssignmentsTable = tableCheck.rows.some(r => r.table_name === 'assignments');
        
        let assignmentsQuery;
        if (hasAssignmentsTable) {
            // assignments 테이블이 있는 경우
            assignmentsQuery = `
                SELECT 
                    r.*,
                    CONCAT(r.english_last_name, ' ', r.english_first_name) as english_name,
                    r.voucher_token,
                    r.qr_code_data,
                    r.qr_image_path,
                    r.vendor_voucher_path,
                    r.adult_unit_price as adult_price,
                    r.child_unit_price as child_price,
                    r.infant_unit_price as infant_price,
                    r.adult_cost,
                    r.child_cost,
                    r.infant_cost,
                    r.adult_currency,
                    r.child_currency,
                    r.infant_currency,
                    r.adult_cost_currency,
                    r.child_cost_currency,
                    r.infant_cost_currency,
                    r.commission_rate,
                    r.exchange_rate,
                    a.id as assignment_id,
                    a.vendor_id,
                    a.vendor_name,
                    a.vendor_contact,
                    a.assignment_token,
                    a.status as assignment_status,
                    a.notes as assignment_notes,
                    a.assigned_at,
                    a.sent_at,
                    a.viewed_at,
                    a.response_at,
                    a.confirmation_number,
                    a.rejection_reason,
                    v.email as vendor_email,
                    v.phone as vendor_phone,
                    (SELECT MAX(viewed_at) FROM voucher_views WHERE reservation_id = r.id) as voucher_viewed_at,
                    COUNT(*) OVER() as total_count
                FROM reservations r
                LEFT JOIN assignments a ON r.id = a.reservation_id
                LEFT JOIN vendors v ON a.vendor_id = v.id
                ${whereClause}
                ORDER BY 
                    CASE r.payment_status
                        WHEN 'in_revision' THEN 0  -- 수정중(예약변경) - 최상단
                        WHEN 'pending' THEN 1      -- 신규예약
                        WHEN 'in_progress' THEN 2  -- 수배중
                        WHEN 'confirmed' THEN 3    -- 확정
                        WHEN 'voucher_sent' THEN 5 -- 바우처전송
                        ELSE 4
                    END,
                    CASE 
                        WHEN r.usage_date < CURRENT_DATE THEN 0
                        ELSE 1
                    END DESC,
                    r.usage_date ASC,
                    r.created_at DESC
                LIMIT $${paramIndex + 1} OFFSET $${paramIndex + 2}
            `;
        } else {
            // assignments 테이블이 없는 경우 (예약만 조회)
            assignmentsQuery = `
                SELECT 
                    r.*,
                    CONCAT(r.english_last_name, ' ', r.english_first_name) as english_name,
                    r.voucher_token,
                    r.qr_code_data,
                    r.qr_image_path,
                    r.vendor_voucher_path,
                    NULL as assignment_id,
                    NULL as vendor_name,
                    NULL as vendor_contact,
                    NULL as assignment_token,
                    NULL as assignment_status,
                    NULL as assignment_notes,
                    NULL as assigned_at,
                    NULL as sent_at,
                    NULL as viewed_at,
                    NULL as response_at,
                    NULL as confirmation_number,
                    NULL as rejection_reason,
                    COUNT(*) OVER() as total_count
                FROM reservations r
                ${whereClause}
                ORDER BY r.updated_at DESC, r.created_at DESC
                LIMIT $${paramIndex + 1} OFFSET $${paramIndex + 2}
            `;
        }
        
        queryParams.push(limit, offset);
        const result = await pool.query(assignmentsQuery, queryParams);
        
        console.log(`📊 수배관리 쿼리 결과: ${result.rows.length}개 (총 ${totalCount}개)`);
        if (result.rows.length > 0) {
            console.log('📋 첫 번째 항목:', {
                id: result.rows[0].id,
                reservation_number: result.rows[0].reservation_number,
                payment_status: result.rows[0].payment_status,
                platform_name: result.rows[0].platform_name,
                vendor_name: result.rows[0].vendor_name
            });
        }
        
        const totalPages = Math.ceil(totalCount / limit);
        
        res.json({
            success: true,
            data: {
                assignments: result.rows,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: totalPages,
                    totalCount: totalCount,
                    limit: limit
                }
            }
        });
        
    } catch (error) {
        console.error('❌ 수배관리 목록 조회 오류:', error);
        res.status(500).json({
            success: false,
            message: '수배관리 목록을 불러오는데 실패했습니다: ' + error.message
        });
    }
});

// 예약 상세 조회 API (수배관리 모달용)
app.get('/api/reservations/:id', requireAuth, async (req, res) => {
    try {
        const reservationId = req.params.id;
        
        console.log('🔍 예약 상세 조회 API 호출:', reservationId);
        
        // reservations 테이블에서 기본 정보만 조회
        const query = `
            SELECT 
                r.*,
                v.vendor_name,
                a.assignment_token,
                a.confirmation_number as assignment_confirmation_number,
                a.voucher_token
            FROM reservations r
            LEFT JOIN vendors v ON r.vendor_id = v.id
            LEFT JOIN assignments a ON r.id = a.reservation_id
            WHERE r.id = $1
        `;
        
        const result = await pool.query(query, [reservationId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '예약을 찾을 수 없습니다.'
            });
        }
        
        const reservation = result.rows[0];
        
        console.log('📋 예약 상세 조회 성공:', {
            id: reservation.id,
            reservation_number: reservation.reservation_number,
            payment_status: reservation.payment_status,
            vendor_name: reservation.vendor_name
        });
        
        res.json({
            success: true,
            reservation: reservation
        });
        
    } catch (error) {
        console.error('❌ 예약 상세 조회 오류:', error);
        res.status(500).json({
            success: false,
            message: '예약 조회 중 오류가 발생했습니다: ' + error.message
        });
    }
});

// 예약 정보 수정 API (수배관리 모달용 - 확장된 필드 지원)
app.put('/api/reservations/:id', requireAuth, async (req, res) => {
    try {
        const reservationId = req.params.id;
        const formData = req.body;
        
        console.log('🔧 예약 정보 수정 API 호출:', reservationId, formData);
        
        // 변경 전 데이터 조회 (히스토리 저장용)
        const oldDataResult = await pool.query(
            'SELECT * FROM reservations WHERE id = $1',
            [reservationId]
        );
        
        if (oldDataResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '예약을 찾을 수 없습니다.'
            });
        }
        
        const oldData = oldDataResult.rows[0];
        
        // 동적 쿼리 생성
        const updateFields = [];
        const values = [];
        let paramIndex = 1;
        
        // 예약 정보
        if (formData.platform_name !== undefined) {
            updateFields.push(`platform_name = $${paramIndex++}`);
            values.push(formData.platform_name);
        }
        if (formData.payment_status !== undefined) {
            updateFields.push(`payment_status = $${paramIndex++}`);
            values.push(formData.payment_status);
        }
        
        // 상품 정보
        if (formData.product_name !== undefined) {
            updateFields.push(`product_name = $${paramIndex++}`);
            values.push(formData.product_name);
        }
        if (formData.package_type !== undefined) {
            updateFields.push(`package_type = $${paramIndex++}`);
            values.push(formData.package_type);
        }
        
        // 일정 정보
        if (formData.usage_date !== undefined) {
            updateFields.push(`usage_date = $${paramIndex++}`);
            values.push(formData.usage_date || null);
        }
        if (formData.usage_time !== undefined) {
            updateFields.push(`usage_time = $${paramIndex++}`);
            // 빈 문자열을 NULL로 변환 (PostgreSQL TIME 타입 오류 방지)
            values.push(formData.usage_time === '' ? null : formData.usage_time);
        }
        
        // 예약자 정보
        if (formData.korean_name !== undefined) {
            updateFields.push(`korean_name = $${paramIndex++}`);
            values.push(formData.korean_name || null);
        }
        
        // 영문명 처리 (english_name을 first_name과 last_name으로 분리)
        if (formData.english_name !== undefined) {
            const nameParts = (formData.english_name || '').split(' ');
            const firstName = nameParts.slice(1).join(' ') || null;
            const lastName = nameParts[0] || null;
            
            updateFields.push(`english_first_name = $${paramIndex++}`);
            values.push(firstName);
            updateFields.push(`english_last_name = $${paramIndex++}`);
            values.push(lastName);
        }
        
        if (formData.phone !== undefined) {
            updateFields.push(`phone = $${paramIndex++}`);
            values.push(formData.phone || null);
        }
        if (formData.email !== undefined) {
            updateFields.push(`email = $${paramIndex++}`);
            values.push(formData.email || null);
        }
        if (formData.kakao_id !== undefined) {
            updateFields.push(`kakao_id = $${paramIndex++}`);
            values.push(formData.kakao_id || null);
        }
        
        // 인원 및 금액 정보
        if (formData.people_adult !== undefined) {
            updateFields.push(`people_adult = $${paramIndex++}`);
            values.push(formData.people_adult);
        }
        if (formData.people_child !== undefined) {
            updateFields.push(`people_child = $${paramIndex++}`);
            values.push(formData.people_child);
        }
        if (formData.people_infant !== undefined) {
            updateFields.push(`people_infant = $${paramIndex++}`);
            values.push(formData.people_infant);
        }
        if (formData.adult_price !== undefined) {
            updateFields.push(`adult_unit_price = $${paramIndex++}`);
            values.push(formData.adult_price);
        }
        if (formData.child_price !== undefined) {
            updateFields.push(`child_unit_price = $${paramIndex++}`);
            values.push(formData.child_price);
        }
        // infant_unit_price 컬럼이 없으므로 제외
        // if (formData.infant_price !== undefined) {
        //     updateFields.push(`infant_unit_price = $${paramIndex++}`);
        //     values.push(formData.infant_price);
        // }

        // 원가 정보 추가
        if (formData.adult_cost !== undefined) {
            updateFields.push(`adult_cost = $${paramIndex++}`);
            values.push(formData.adult_cost);
        }
        if (formData.child_cost !== undefined) {
            updateFields.push(`child_cost = $${paramIndex++}`);
            values.push(formData.child_cost);
        }
        if (formData.infant_cost !== undefined) {
            updateFields.push(`infant_cost = $${paramIndex++}`);
            values.push(formData.infant_cost);
        }

        // 통화 정보 추가
        if (formData.adult_currency !== undefined) {
            updateFields.push(`adult_currency = $${paramIndex++}`);
            values.push(formData.adult_currency);
        }
        if (formData.child_currency !== undefined) {
            updateFields.push(`child_currency = $${paramIndex++}`);
            values.push(formData.child_currency);
        }
        if (formData.infant_currency !== undefined) {
            updateFields.push(`infant_currency = $${paramIndex++}`);
            values.push(formData.infant_currency);
        }
        if (formData.adult_cost_currency !== undefined) {
            updateFields.push(`adult_cost_currency = $${paramIndex++}`);
            values.push(formData.adult_cost_currency);
        }
        if (formData.child_cost_currency !== undefined) {
            updateFields.push(`child_cost_currency = $${paramIndex++}`);
            values.push(formData.child_cost_currency);
        }
        if (formData.infant_cost_currency !== undefined) {
            updateFields.push(`infant_cost_currency = $${paramIndex++}`);
            values.push(formData.infant_cost_currency);
        }

        // 수수료율과 환율 추가
        if (formData.commission_rate !== undefined) {
            updateFields.push(`commission_rate = $${paramIndex++}`);
            values.push(formData.commission_rate);
        }
        if (formData.exchange_rate !== undefined) {
            updateFields.push(`exchange_rate = $${paramIndex++}`);
            values.push(formData.exchange_rate);
        }

        // 특별 요청사항
        if (formData.memo !== undefined) {
            updateFields.push(`memo = $${paramIndex++}`);
            values.push(formData.memo || null);
        }

        
        if (updateFields.length === 0) {
            return res.status(400).json({
                success: false,
                message: '수정할 필드가 없습니다.'
            });
        }
        
        // updated_at 추가
        updateFields.push(`updated_at = NOW()`);
        values.push(reservationId);
        
        const query = `
            UPDATE reservations 
            SET ${updateFields.join(', ')}
            WHERE id = $${paramIndex}
            RETURNING *
        `;
        
        const result = await pool.query(query, values);
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '예약을 찾을 수 없습니다.'
            });
        }
        
        console.log('✅ 예약 정보 수정 완료:', result.rows[0].reservation_number);
        
        // 변경 이력을 reservation_logs에 저장
        try {
            const changesObj = {};
            
            // 각 필드별로 변경 전/후 비교 (null과 빈 문자열 정규화)
            if (formData.korean_name !== undefined) {
                const oldValue = oldData.korean_name || null;
                const newValue = formData.korean_name || null;
                if (oldValue !== newValue) {
                    changesObj.korean_name = { from: oldData.korean_name || '(없음)', to: formData.korean_name || '(없음)' };
                }
            }
            
            if (formData.english_name !== undefined) {
                const oldEnglishName = `${oldData.english_last_name || ''} ${oldData.english_first_name || ''}`.trim();
                const newEnglishName = (formData.english_name || '').trim();
                if (oldEnglishName !== newEnglishName) {
                    changesObj.english_name = { from: oldEnglishName || '(없음)', to: newEnglishName || '(없음)' };
                }
            }
            
            if (formData.phone !== undefined) {
                const oldValue = oldData.phone || null;
                const newValue = formData.phone || null;
                if (oldValue !== newValue) {
                    changesObj.phone = { from: oldData.phone || '(없음)', to: formData.phone || '(없음)' };
                }
            }
            
            if (formData.email !== undefined) {
                const oldValue = oldData.email || null;
                const newValue = formData.email || null;
                if (oldValue !== newValue) {
                    changesObj.email = { from: oldData.email || '(없음)', to: formData.email || '(없음)' };
                }
            }
            
            if (formData.product_name !== undefined) {
                const oldValue = oldData.product_name || null;
                const newValue = formData.product_name || null;
                if (oldValue !== newValue) {
                    changesObj.product_name = { from: oldData.product_name || '(없음)', to: formData.product_name || '(없음)' };
                }
            }
            
            if (formData.usage_date !== undefined) {
                // 날짜를 문자열 형식(YYYY-MM-DD)으로 정규화해서 비교
                const oldDateStr = oldData.usage_date ? new Date(oldData.usage_date).toISOString().split('T')[0] : null;
                const newDateStr = formData.usage_date ? new Date(formData.usage_date).toISOString().split('T')[0] : null;
                
                if (oldDateStr !== newDateStr) {
                    changesObj.usage_date = { 
                        from: oldData.usage_date ? new Date(oldData.usage_date).toLocaleDateString('ko-KR') : '(없음)', 
                        to: formData.usage_date ? new Date(formData.usage_date).toLocaleDateString('ko-KR') : '(없음)' 
                    };
                }
            }
            
            if (formData.usage_time !== undefined) {
                // 시간 문자열 정규화 (빈 문자열과 null 통일)
                const oldTimeStr = oldData.usage_time || null;
                const newTimeStr = formData.usage_time === '' ? null : (formData.usage_time || null);
                
                if (oldTimeStr !== newTimeStr) {
                    changesObj.usage_time = { from: oldData.usage_time || '(없음)', to: formData.usage_time || '(없음)' };
                }
            }
            
            if (formData.people_adult !== undefined) {
                // 숫자로 정규화해서 비교
                const oldAdult = parseInt(oldData.people_adult) || 0;
                const newAdult = parseInt(formData.people_adult) || 0;
                
                if (oldAdult !== newAdult) {
                    changesObj.people_adult = { from: oldAdult, to: newAdult };
                }
            }
            
            if (formData.people_child !== undefined) {
                // 숫자로 정규화해서 비교
                const oldChild = parseInt(oldData.people_child) || 0;
                const newChild = parseInt(formData.people_child) || 0;
                
                if (oldChild !== newChild) {
                    changesObj.people_child = { from: oldChild, to: newChild };
                }
            }
            
            if (Object.keys(changesObj).length > 0) {
                // 변경 항목 서술형 문장 생성
                const changeDescriptions = Object.entries(changesObj).map(([key, value]) => {
                    const fieldNames = {
                        korean_name: '고객명',
                        english_name: '영문명',
                        phone: '연락처',
                        email: '이메일',
                        product_name: '상품명',
                        usage_date: '이용일',
                        usage_time: '이용시간',
                        people_adult: '성인 인원',
                        people_child: '아동 인원',
                        package_type: '패키지 옵션',
                        memo: '특별요청'
                    };
                    const fieldName = fieldNames[key] || key;
                    return `${fieldName}: "${value.from}" → "${value.to}"`;
                }).join(', ');
                
                await logHistory(
                    reservationId,
                    '예약',
                    '정보수정',
                    req.session?.username || '관리자',
                    `예약 정보가 수정되었습니다. 변경된 항목: ${changeDescriptions}`,
                    changesObj,
                    {
                        total_changes: Object.keys(changesObj).length,
                        reservation_number: result.rows[0].reservation_number
                    }
                );
                console.log('✅ 변경 이력 저장 완료:', Object.keys(changesObj));
            } else {
                console.log('ℹ️ 변경된 항목이 없습니다.');
            }
        } catch (logError) {
            console.error('⚠️ 변경 이력 저장 실패:', logError);
            // 이력 저장 실패해도 예약 수정은 성공으로 처리
        }
        
        // ✅ settlements 테이블 자동 UPSERT (정산이관 데이터 동기화)
        try {
            const updatedReservation = result.rows[0];
            
            // 판매가 계산
            const adultCount = updatedReservation.people_adult || 0;
            const childCount = updatedReservation.people_child || 0;
            const infantCount = updatedReservation.people_infant || 0;
            
            const adultPrice = updatedReservation.adult_unit_price || 0;
            const childPrice = updatedReservation.child_unit_price || 0;
            const infantPrice = updatedReservation.infant_unit_price || 0;
            
            const adultCost = updatedReservation.adult_cost || 0;
            const childCost = updatedReservation.child_cost || 0;
            const infantCost = updatedReservation.infant_cost || 0;
            
            const adultCurrency = updatedReservation.adult_currency || 'USD';
            const childCurrency = updatedReservation.child_currency || 'USD';
            const infantCurrency = updatedReservation.infant_currency || 'USD';
            
            const adultCostCurrency = updatedReservation.adult_cost_currency || 'USD';
            const childCostCurrency = updatedReservation.child_cost_currency || 'USD';
            const infantCostCurrency = updatedReservation.infant_cost_currency || 'USD';
            
            const commissionRate = updatedReservation.commission_rate || 10;
            const exchangeRate = updatedReservation.exchange_rate || 1300;
            
            // 총 판매가 (원화 기준)
            const convertToKRW = (amount, currency) => {
                if (currency === 'USD') return amount * exchangeRate;
                return amount;
            };
            
            const adultTotalKRW = adultCount * convertToKRW(adultPrice, adultCurrency);
            const childTotalKRW = childCount * convertToKRW(childPrice, childCurrency);
            const infantTotalKRW = infantCount * convertToKRW(infantPrice, infantCurrency);
            const totalSaleKRW = adultTotalKRW + childTotalKRW + infantTotalKRW;
            
            // 수수료 계산
            const commissionAmount = totalSaleKRW * (commissionRate / 100);
            const netRevenue = totalSaleKRW - commissionAmount;
            
            // 총 원가 (원화 기준)
            const adultCostKRW = adultCount * convertToKRW(adultCost, adultCostCurrency);
            const childCostKRW = childCount * convertToKRW(childCost, childCostCurrency);
            const infantCostKRW = infantCount * convertToKRW(infantCost, infantCostCurrency);
            const totalCostKRW = adultCostKRW + childCostKRW + infantCostKRW;
            
            // 마진 계산
            const marginKRW = totalSaleKRW - totalCostKRW - commissionAmount;
            
            console.log('💰 정산 데이터 계산:', {
                totalSaleKRW,
                commissionRate: commissionRate + '%',
                commissionAmount,
                netRevenue,
                totalCostKRW,
                marginKRW,
                exchangeRate
            });
            
            // settlements UPSERT
            await pool.query(`
                INSERT INTO settlements (
                    reservation_id,
                    sale_currency,
                    sale_adult_price,
                    sale_child_price,
                    sale_infant_price,
                    total_sale,
                    commission_rate,
                    commission_amount,
                    net_revenue,
                    cost_currency,
                    cost_adult_price,
                    cost_child_price,
                    cost_infant_price,
                    total_cost,
                    exchange_rate,
                    cost_krw,
                    margin_krw,
                    settlement_status,
                    created_at,
                    updated_at
                ) VALUES (
                    $1, 'KRW', $2, $3, $4, $5, $6, $7, $8,
                    'KRW', $9, $10, $11, $12, $13, $14, $15,
                    'pending', NOW(), NOW()
                )
                ON CONFLICT (reservation_id) 
                DO UPDATE SET
                    sale_adult_price = EXCLUDED.sale_adult_price,
                    sale_child_price = EXCLUDED.sale_child_price,
                    sale_infant_price = EXCLUDED.sale_infant_price,
                    total_sale = EXCLUDED.total_sale,
                    commission_rate = EXCLUDED.commission_rate,
                    commission_amount = EXCLUDED.commission_amount,
                    net_revenue = EXCLUDED.net_revenue,
                    cost_adult_price = EXCLUDED.cost_adult_price,
                    cost_child_price = EXCLUDED.cost_child_price,
                    cost_infant_price = EXCLUDED.cost_infant_price,
                    total_cost = EXCLUDED.total_cost,
                    exchange_rate = EXCLUDED.exchange_rate,
                    cost_krw = EXCLUDED.cost_krw,
                    margin_krw = EXCLUDED.margin_krw,
                    updated_at = NOW()
            `, [
                reservationId,
                Math.round(adultTotalKRW),
                Math.round(childTotalKRW),
                Math.round(infantTotalKRW),
                Math.round(totalSaleKRW),
                commissionRate,
                Math.round(commissionAmount),
                Math.round(netRevenue),
                Math.round(adultCostKRW),
                Math.round(childCostKRW),
                Math.round(infantCostKRW),
                Math.round(totalCostKRW),
                exchangeRate,
                Math.round(totalCostKRW),
                Math.round(marginKRW)
            ]);
            
            console.log('✅ settlements 테이블 동기화 완료 (reservation_id:', reservationId, ')');
        } catch (settlementError) {
            console.error('⚠️ settlements 동기화 실패:', settlementError);
            // settlements 동기화 실패해도 예약 수정은 성공으로 처리
        }
        
        res.json({
            success: true,
            message: '예약 정보가 수정되었습니다.',
            reservation: result.rows[0]
        });
        
    } catch (error) {
        console.error('❌ 예약 정보 수정 오류:', error);
        res.status(500).json({
            success: false,
            message: '예약 정보 수정 중 오류가 발생했습니다: ' + error.message
        });
    }
});

// 예약 확정 API (4가지 방식)
app.post('/api/reservations/:id/confirm', requireAuth, async (req, res) => {
    // uploads 폴더 확인 및 생성
    const uploadDir = path.join(__dirname, 'uploads');
    if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
        console.log('📁 uploads 폴더 생성:', uploadDir);
    }
    
    // 파일명을 예약 ID + 타임스탬프로 고유하게 생성
    const storage = multer.diskStorage({
        destination: function (req, file, cb) {
            cb(null, uploadDir);
        },
        filename: function (req, file, cb) {
            const uniqueName = `reservation_${req.params.id}_${Date.now()}${path.extname(file.originalname)}`;
            console.log('📝 파일명 생성:', uniqueName);
            cb(null, uniqueName);
        }
    });
    
    const upload = multer({ 
        storage: storage,
        limits: {
            fileSize: 10 * 1024 * 1024 // 10MB 제한
        },
        fileFilter: function (req, file, cb) {
            console.log('📎 파일 업로드 시도:', {
                fieldname: file.fieldname,
                originalname: file.originalname,
                mimetype: file.mimetype
            });
            cb(null, true);
        }
    });
    
    upload.fields([
        { name: 'qr_image', maxCount: 1 },
        { name: 'vendor_voucher', maxCount: 1 }
    ])(req, res, async (err) => {
        if (err) {
            console.error('❌ 파일 업로드 오류:', err);
            return res.status(500).json({ 
                success: false, 
                message: '파일 업로드 오류: ' + (err.message || '알 수 없는 오류')
            });
        }
        
        try {
            const reservationId = req.params.id;
            const { method, confirmation_number, qr_code_data, memo } = req.body;
            
            console.log('✅ 예약 확정 요청:', {
                reservationId,
                method,
                confirmation_number,
                qr_code_data,
                memo
            });
            
            // 예약 정보 조회
            const reservationResult = await pool.query(
                'SELECT * FROM reservations WHERE id = $1',
                [reservationId]
            );
            
            if (reservationResult.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: '예약을 찾을 수 없습니다.'
                });
            }
            
            const reservation = reservationResult.rows[0];
            const adminName = req.session.adminName || req.session.adminUsername || '시스템';
            
            console.log('🔄 확정 방식:', parseInt(method), '| 기존 데이터 초기화 시작');
            
            // 🔑 중요: 새로운 방식으로 확정 시 다른 방식의 데이터를 모두 초기화
            await pool.query(`
                UPDATE reservations 
                SET qr_code_data = NULL,
                    qr_image_path = NULL,
                    vendor_voucher_path = NULL
                WHERE id = $1
            `, [reservationId]);
            
            await pool.query(`
                UPDATE assignments 
                SET confirmation_number = NULL
                WHERE reservation_id = $1
            `, [reservationId]);
            
            console.log('✅ 이전 확정 데이터 초기화 완료');
            
            // 확정 방식별 처리
            let confirmationData = {
                method: parseInt(method),
                memo: memo || null
            };
            
            switch(parseInt(method)) {
                case 1: // 컨펌번호
                    if (!confirmation_number) {
                        return res.status(400).json({
                            success: false,
                            message: '컨펌번호를 입력해주세요.'
                        });
                    }
                    confirmationData.confirmation_number = confirmation_number;
                    
                    // assignments 테이블 업데이트
                    await pool.query(`
                        UPDATE assignments 
                        SET confirmation_number = $1, 
                            response_at = NOW(),
                            updated_at = NOW()
                        WHERE reservation_id = $2
                    `, [confirmation_number, reservationId]);
                    
                    break;
                    
                case 2: // QR코드
                    if (!qr_code_data) {
                        return res.status(400).json({
                            success: false,
                            message: 'QR코드 정보를 입력해주세요.'
                        });
                    }
                    confirmationData.qr_code_data = qr_code_data;
                    
                    // QR 이미지 파일 경로 (업로드된 경우)
                    if (req.files && req.files['qr_image']) {
                        const qrImageFilename = req.files['qr_image'][0].filename;
                        // 상대 경로로 저장 (웹에서 접근 가능하도록)
                        confirmationData.qr_image_path = `uploads/${qrImageFilename}`;
                        
                        console.log('📸 QR 이미지 업로드:', {
                            filename: qrImageFilename,
                            relativePath: confirmationData.qr_image_path,
                            originalname: req.files['qr_image'][0].originalname
                        });
                    }
                    
                    // QR 정보 저장
                    await pool.query(`
                        UPDATE reservations 
                        SET qr_code_data = $1,
                            qr_image_path = $2,
                            updated_at = NOW()
                        WHERE id = $3
                    `, [qr_code_data, confirmationData.qr_image_path || null, reservationId]);
                    
                    console.log('✅ QR 정보 저장 완료:', { 
                        qr_code_data, 
                        qr_image_path: confirmationData.qr_image_path 
                    });
                    
                    break;
                    
                case 3: // 바우처 업로드
                    if (!req.files || !req.files['vendor_voucher']) {
                        return res.status(400).json({
                            success: false,
                            message: '바우처 파일을 업로드해주세요.'
                        });
                    }
                    
                    const voucherFilename = req.files['vendor_voucher'][0].filename;
                    // 상대 경로로 저장 (웹에서 접근 가능하도록)
                    const voucherRelativePath = `uploads/${voucherFilename}`;
                    confirmationData.vendor_voucher_path = voucherRelativePath;
                    confirmationData.vendor_voucher_filename = voucherFilename;
                    
                    console.log('📄 바우처 파일 업로드:', {
                        filename: voucherFilename,
                        relativePath: voucherRelativePath,
                        originalname: req.files['vendor_voucher'][0].originalname
                    });
                    
                    // 수배업체 바우처 경로 저장
                    await pool.query(`
                        UPDATE reservations 
                        SET vendor_voucher_path = $1,
                            updated_at = NOW()
                        WHERE id = $2
                    `, [voucherRelativePath, reservationId]);
                    
                    console.log('✅ 바우처 파일 저장 완료:', { path: voucherRelativePath });
                    
                    break;
                    
                case 4: // 즉시 확정
                    // 추가 데이터 불필요
                    console.log('💫 즉시 확정 - 회신 불필요');
                    break;
                    
                default:
                    return res.status(400).json({
                        success: false,
                        message: '유효하지 않은 확정 방식입니다.'
                    });
            }
            
            // 바우처 토큰 생성 (없으면)
            let voucherToken = reservation.voucher_token;
            if (!voucherToken) {
                voucherToken = crypto.randomBytes(12).toString('hex');
                console.log('🎫 바우처 토큰 생성 (24자):', voucherToken);
            }
            
            // 예약 상태를 '확정완료'로 변경 + 바우처 토큰 저장
            await pool.query(`
                UPDATE reservations 
                SET payment_status = 'confirmed',
                    voucher_token = $2,
                    updated_at = NOW()
                WHERE id = $1
            `, [reservationId, voucherToken]);
            
            // 히스토리 기록
            const methodNames = {
                1: '컨펌번호 등록',
                2: 'QR코드 등록',
                3: '바우처 업로드',
                4: '즉시 확정'
            };
            
            await logHistory(
                reservationId,
                '상태변경',
                '확정완료',
                adminName,
                `예약이 확정되었습니다. (방식: ${methodNames[parseInt(method)]})${memo ? ' - ' + memo : ''}`,
                { payment_status: { from: reservation.payment_status, to: 'confirmed' } },
                { 
                    confirmation_method: parseInt(method),
                    voucher_token: voucherToken,
                    ...confirmationData
                }
            );
            
            console.log('✅ 예약 확정 완료:', reservationId, '| 바우처 토큰:', voucherToken);
            
            res.json({
                success: true,
                message: '예약이 확정되었습니다.',
                reservation_id: reservationId,
                method: parseInt(method),
                voucher_token: voucherToken,
                voucher_url: `${req.protocol}://${req.get('host')}/voucher/${voucherToken}`
            });
            
        } catch (error) {
            console.error('❌ 예약 확정 오류:', error);
            res.status(500).json({
                success: false,
                message: '예약 확정 중 오류가 발생했습니다: ' + error.message
            });
        }
    });
});

// 바우처 자동 생성 API
app.post('/api/vouchers/auto-generate/:reservationId', requireAuth, async (req, res) => {
    try {
        const reservationId = req.params.reservationId;
        
        console.log('🎫 바우처 자동 생성 요청:', reservationId);
        
        // 예약 정보 조회
        const reservationResult = await pool.query(`
            SELECT r.*, a.confirmation_number, a.vendor_name,
                   r.qr_code_data, r.vendor_voucher_path
            FROM reservations r
            LEFT JOIN assignments a ON r.id = a.reservation_id
            WHERE r.id = $1
        `, [reservationId]);
        
        if (reservationResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '예약을 찾을 수 없습니다.'
            });
        }
        
        const reservation = reservationResult.rows[0];
        
        // 바우처 토큰 생성 (없으면)
        let voucherToken = reservation.voucher_token;
        if (!voucherToken) {
            voucherToken = crypto.randomBytes(12).toString('hex');
            
            await pool.query(`
                UPDATE reservations 
                SET voucher_token = $1, updated_at = NOW()
                WHERE id = $2
            `, [voucherToken, reservationId]);
        }
        
        // 바우처 정보 구성 (AI 생성 대신 기본 정보 사용)
        const voucherData = {
            voucher_token: voucherToken,
            reservation_number: reservation.reservation_number,
            confirmation_number: reservation.confirmation_number || '-',
            product_name: reservation.product_name,
            package_type: reservation.package_type,
            usage_date: reservation.usage_date,
            usage_time: reservation.usage_time,
            customer_name: reservation.korean_name,
            people_adult: reservation.people_adult || 0,
            people_child: reservation.people_child || 0,
            people_infant: reservation.people_infant || 0,
            vendor_name: reservation.vendor_name || '-',
            qr_code_data: reservation.qr_code_data,
            vendor_voucher_path: reservation.vendor_voucher_path,
            created_at: new Date()
        };
        
        // 바우처 생성 완료 상태 업데이트
        await pool.query(`
            UPDATE reservations 
            SET voucher_sent_at = NOW(),
                updated_at = NOW()
            WHERE id = $1
        `, [reservationId]);
        
        // 히스토리 기록
        const adminName = req.session.adminName || req.session.adminUsername || '시스템';
        await logHistory(
            reservationId,
            '바우처',
            '생성',
            adminName,
            `바우처가 자동 생성되었습니다.`,
            null,
            { voucher_token: voucherToken }
        );
        
        console.log('✅ 바우처 자동 생성 완료:', voucherToken);
        
        res.json({
            success: true,
            message: '바우처가 생성되었습니다.',
            voucher_token: voucherToken,
            voucher_url: `${req.protocol}://${req.get('host')}/voucher/${voucherToken}`,
            voucher_data: voucherData
        });
        
    } catch (error) {
        console.error('❌ 바우처 자동 생성 오류:', error);
        res.status(500).json({
            success: false,
            message: '바우처 생성 중 오류가 발생했습니다: ' + error.message
        });
    }
});

// 바우처 미리보기 API
app.get('/api/vouchers/:voucherToken/preview', async (req, res) => {
    try {
        const { voucherToken } = req.params;
        
        console.log('🎫 바우처 미리보기 요청:', voucherToken);
        
        // 바우처 정보 조회
        const result = await pool.query(`
            SELECT 
                r.*, 
                a.confirmation_number, 
                a.vendor_name, 
                a.vendor_contact,
                v.email as vendor_email,
                v.phone as vendor_phone,
                v.contact_person as vendor_contact_person,
                v.notification_email as vendor_notification_email
            FROM reservations r
            LEFT JOIN assignments a ON r.id = a.reservation_id
            LEFT JOIN vendors v ON a.vendor_id = v.id
            WHERE r.voucher_token = $1
        `, [voucherToken]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '바우처를 찾을 수 없습니다.'
            });
        }
        
        const reservation = result.rows[0];
        
        // 예약 취소 여부 확인
        if (reservation.payment_status === 'cancelled') {
            return res.status(410).json({
                success: false,
                message: '이 예약은 취소되어 바우처가 무효화되었습니다.',
                cancelled: true
            });
        }
        
        // RAG 기반 이용방법 생성 (에러 발생 시 기본 값 사용)
        let usage_instructions = null;
        try {
            const { generateVoucherInstructions } = require('./utils/rag-voucher');
            usage_instructions = await generateVoucherInstructions(
                reservation.product_name,
                {
                    people_adult: reservation.people_adult,
                    people_child: reservation.people_child,
                    usage_date: reservation.usage_date,
                    usage_time: reservation.usage_time,
                    package_type: reservation.package_type
                }
            );
            console.log(`✅ RAG 가이드 로드 성공: ${reservation.product_name}`);
        } catch (ragError) {
            console.error('⚠️ RAG 이용방법 생성 실패, 기본 템플릿 사용:', ragError.message);
            usage_instructions = null; // 템플릿에서 null 체크
        }
        
        // 템플릿 렌더링 (새로운 공식 문서 스타일)
        const html = await new Promise((resolve, reject) => {
            res.app.render('voucher-official', {
                reservation,
                confirmation_number: reservation.confirmation_number || null,
                qr_code_data: reservation.qr_code_data || null,
                qr_image_path: reservation.qr_image_path || null,
                vendor_voucher_path: reservation.vendor_voucher_path || null,
                vendor_name: reservation.vendor_name || null,
                vendor_contact: reservation.vendor_contact || null,
                usage_instructions,
                voucher_token: voucherToken,
                formatDate: (date) => {
                    if (!date) return '-';
                    return new Date(date).toLocaleDateString('ko-KR', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                        weekday: 'short'
                    });
                }
            }, (err, html) => {
                if (err) {
                    console.error('❌ 템플릿 렌더링 오류:', err);
                    reject(err);
                } else {
                    resolve(html);
                }
            });
        });
        
        res.json({ success: true, html });
        
    } catch (error) {
        console.error('❌ 바우처 미리보기 오류:', error);
        res.status(500).json({
            success: false,
            message: '바우처 미리보기 생성 중 오류가 발생했습니다: ' + error.message
        });
    }
});

// AI로 이메일 내용 생성 API
app.post('/api/vouchers/generate-email-ai', requireAuth, async (req, res) => {
    try {
        const { 
            customer_name, 
            product_name, 
            usage_date, 
            usage_time,
            platform_name,
            people_adult,
            people_child,
            voucher_url
        } = req.body;
        
        console.log('🤖 AI 이메일 생성 요청:', customer_name, product_name);
        
        // OpenAI API 호출
        const OpenAI = require('openai');
        const openai = new OpenAI({
            apiKey: process.env.OPENAI_API_KEY
        });
        
        // 날짜 포맷팅
        const formattedDate = usage_date ? new Date(usage_date).toLocaleDateString('ko-KR', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            weekday: 'long'
        }) : '';
        
        // 인원 정보
        const peopleInfo = `성인 ${people_adult || 0}명${people_child > 0 ? `, 아동 ${people_child}명` : ''}`;
        
        // AI 프롬프트
        const prompt = `당신은 괌 여행 예약 전문가이자 전문적인 고객 서비스 담당자입니다.

다음 예약 정보를 바탕으로 고객에게 보낼 예약 바우처 이메일을 작성해주세요:

**예약 정보:**
- 고객명: ${customer_name}
- 예약 플랫폼: ${platform_name || '온라인'}
- 상품명: ${product_name}
- 이용일: ${formattedDate}
- 이용시간: ${usage_time || '예약 시 확인'}
- 인원: ${peopleInfo}
- 바우처 링크: ${voucher_url}

**작성 가이드:**
1. 제목: 간결하고 명확하게 (예: [괌세이브] ${product_name} 예약 확정 - ${formattedDate})
2. 본문 구성:
   - 친절한 인사말
   - 예약 확정 안내
   - 주요 예약 정보 요약 (상품명, 이용일시, 인원)
   - 바우처 링크 안내 (이용 시 반드시 제시)
   - 유의사항 (현지 날씨, 준비물, 도착 시간 등)
   - 문의 안내
   - 마무리 인사

**톤앤매너:**
- 전문적이면서도 따뜻한 톤
- 과도한 이모지 사용 금지 (최소한으로)
- 명확하고 읽기 쉬운 문장
- 중요한 정보는 굵게 또는 구분하여 표시

**최신 상황 반영:**
- 괌의 현재 계절과 날씨 고려
- 코로나 이후 여행 트렌드 반영
- 최근 괌 여행 주의사항 포함

JSON 형식으로 응답해주세요:
{
  "subject": "이메일 제목",
  "message": "이메일 본문 (줄바꿈은 \\n으로)"
}`;

        const completion = await openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
                {
                    role: 'system',
                    content: '당신은 괌 여행 예약 전문가이자 고객 서비스 담당자입니다. 전문적이고 따뜻한 톤으로 정확한 정보를 제공합니다.'
                },
                {
                    role: 'user',
                    content: prompt
                }
            ],
            response_format: { type: 'json_object' },
            temperature: 0.7
        });
        
        const aiResponse = JSON.parse(completion.choices[0].message.content);
        
        console.log('✅ AI 이메일 생성 완료');
        
        res.json({
            success: true,
            subject: aiResponse.subject,
            message: aiResponse.message
        });
        
    } catch (error) {
        console.error('❌ AI 이메일 생성 오류:', error);
        res.status(500).json({
            success: false,
            message: 'AI 이메일 생성 중 오류가 발생했습니다: ' + error.message
        });
    }
});

// 바우처 이메일 전송 API (SMTP 실제 전송)
app.post('/api/vouchers/send-email/:reservationId', requireAuth, async (req, res) => {
    try {
        const { reservationId } = req.params;
        const { recipient, subject, message, voucher_token } = req.body;
        
        console.log('📧 바우처 이메일 전송:', reservationId, recipient);
        
        // 예약 정보 조회
        const reservationResult = await pool.query(
            'SELECT * FROM reservations WHERE id = $1',
            [reservationId]
        );
        
        if (reservationResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '예약을 찾을 수 없습니다.'
            });
        }
        
        const reservation = reservationResult.rows[0];
        const voucherUrl = `${req.protocol}://${req.get('host')}/voucher/${voucher_token}`;
        
        // SMTP 설정 확인
        if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
            console.error('❌ SMTP 설정이 없습니다:', {
                SMTP_HOST: process.env.SMTP_HOST,
                SMTP_USER: process.env.SMTP_USER,
                SMTP_PASS: process.env.SMTP_PASS ? '설정됨' : '없음'
            });
            return res.status(500).json({
                success: false,
                message: 'SMTP 이메일 설정이 완료되지 않았습니다. 관리자에게 문의하세요.'
            });
        }
        
        // SMTP 이메일 전송
        console.log('📧 이메일 전송 시작:', {
            to: recipient,
            from: process.env.SMTP_FROM,
            smtp_host: process.env.SMTP_HOST,
            smtp_user: process.env.SMTP_USER
        });
        
        const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST,
            port: process.env.SMTP_PORT || 587,
            secure: false,
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            }
        });
        
        const mailOptions = {
                from: process.env.SMTP_FROM || 'noreply@guamsavecard.com',
                to: recipient,
                subject: subject || `[괌세이브] 예약 바우처 - ${reservation.product_name}`,
                html: `
                    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                        <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); padding: 30px; text-align: center; color: white;">
                            <h1 style="margin: 0;">🎫 예약 바우처</h1>
                        </div>
                        
                        <div style="padding: 30px; background: #f9f9f9;">
                            ${message ? `<div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px; white-space: pre-wrap;">${message}</div>` : ''}
                            
                            <div style="background: white; padding: 20px; border-radius: 8px; margin-bottom: 20px;">
                                <h2 style="color: #667eea; margin-top: 0;">📋 예약 정보</h2>
                                <table style="width: 100%; border-collapse: collapse;">
                                    <tr>
                                        <td style="padding: 8px 0; color: #666;">예약번호:</td>
                                        <td style="padding: 8px 0; font-weight: bold;">${reservation.reservation_number}</td>
                                    </tr>
                                    ${reservation.platform_name ? `
                                    <tr>
                                        <td style="padding: 8px 0; color: #666;">예약 플랫폼:</td>
                                        <td style="padding: 8px 0;"><span style="background: #f0f4ff; color: #667eea; padding: 4px 10px; border-radius: 4px; font-size: 12px;">${reservation.platform_name}</span></td>
                                    </tr>
                                    ` : ''}
                                    <tr>
                                        <td style="padding: 8px 0; color: #666;">예약자명:</td>
                                        <td style="padding: 8px 0; font-weight: bold;">${reservation.korean_name}</td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 8px 0; color: #666;">상품명:</td>
                                        <td style="padding: 8px 0; font-weight: bold;">${reservation.product_name}</td>
                                    </tr>
                                    <tr>
                                        <td style="padding: 8px 0; color: #666;">이용일:</td>
                                        <td style="padding: 8px 0; font-weight: bold; color: #667eea;">${reservation.usage_date}</td>
                                    </tr>
                                    ${reservation.usage_time ? `
                                    <tr>
                                        <td style="padding: 8px 0; color: #666;">이용시간:</td>
                                        <td style="padding: 8px 0;">${reservation.usage_time}</td>
                                    </tr>
                                    ` : ''}
                                    <tr>
                                        <td style="padding: 8px 0; color: #666;">인원:</td>
                                        <td style="padding: 8px 0;">성인 ${reservation.people_adult || 0}명${reservation.people_child > 0 ? `, 아동 ${reservation.people_child}명` : ''}</td>
                                    </tr>
                                </table>
                            </div>
                            
                            <div style="text-align: center; margin: 30px 0;">
                                <a href="${voucherUrl}" style="display: inline-block; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 15px 40px; text-decoration: none; border-radius: 8px; font-weight: bold; font-size: 16px;">
                                    🎫 바우처 확인하기
                                </a>
                            </div>
                            
                            <div style="background: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0;">
                                <strong>⚠️ 유의사항:</strong><br>
                                - 이용 시 반드시 바우처를 제시해주세요<br>
                                - 예약 시간 15-20분 전 도착을 권장합니다<br>
                                - 문의사항은 언제든 연락주세요
                            </div>
                        </div>
                        
                        <div style="background: #333; color: #999; padding: 20px; text-align: center; font-size: 12px;">
                            <p style="margin: 5px 0;">괌세이브카드 예약관리시스템</p>
                            <p style="margin: 5px 0;">즐거운 괌 여행 되세요! 🌴</p>
                        </div>
                    </div>
                `
        };
        
        const sendResult = await transporter.sendMail(mailOptions);
        console.log('✅ 이메일 SMTP 전송 완료:', {
            recipient: recipient,
            messageId: sendResult.messageId,
            response: sendResult.response
        });
        
        // 전송 기록 저장 (테이블 존재 확인 후)
        try {
            const tableExists = await pool.query(`
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_schema = 'public' 
                    AND table_name = 'voucher_sends'
                );
            `);
            
            if (tableExists.rows[0].exists) {
                await pool.query(`
                    INSERT INTO voucher_sends (
                        reservation_id, voucher_token, send_method, recipient, subject, message,
                        sent_by, status
                    ) VALUES ($1, $2, 'email', $3, $4, $5, $6, 'sent')
                `, [
                    reservationId,
                    voucher_token,
                    recipient,
                    subject || '[괌세이브] 예약 바우처',
                    message,
                    req.session.adminName || req.session.adminUsername
                ]);
                console.log('✅ 전송 기록 저장 완료');
            } else {
                console.warn('⚠️ voucher_sends 테이블이 없습니다. 전송은 성공했지만 기록은 저장되지 않습니다.');
            }
        } catch (historyError) {
            console.error('⚠️ 전송 기록 저장 실패 (이메일은 전송됨):', historyError.message);
        }
        
        res.json({
            success: true,
            message: '이메일이 전송되었습니다.'
        });
        
    } catch (error) {
        console.error('❌ 이메일 전송 오류 상세:', {
            message: error.message,
            code: error.code,
            command: error.command,
            stack: error.stack
        });
        res.status(500).json({
            success: false,
            message: '이메일 전송 중 오류가 발생했습니다: ' + error.message
        });
    }
});

// 바우처 카카오 알림톡 전송 API
app.post('/api/vouchers/send-kakao/:reservationId', requireAuth, async (req, res) => {
    try {
        const { reservationId } = req.params;
        
        console.log('💬 바우처 카카오 알림톡 전송:', reservationId);
        
        // 예약 정보 조회
        const result = await pool.query(`
            SELECT 
                r.*,
                TO_CHAR(r.usage_date, 'YYYY-MM-DD') as formatted_usage_date
            FROM reservations r
            WHERE r.id = $1
        `, [reservationId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '예약을 찾을 수 없습니다.'
            });
        }
        
        const reservation = result.rows[0];
        
        // 바우처 토큰 확인
        if (!reservation.voucher_token) {
            return res.status(400).json({
                success: false,
                message: '바우처가 아직 생성되지 않았습니다.'
            });
        }
        
        // 전화번호 확인
        if (!reservation.phone) {
            return res.status(400).json({
                success: false,
                message: '예약자 전화번호가 없습니다.'
            });
        }
        
        // 비즈온 서비스로 알림톡 전송
        if (bizonService) {
            const alimtalkResult = await bizonService.sendVoucherAlimtalk({
                to: reservation.phone,
                name: reservation.korean_name || '고객',
                platformName: reservation.platform_name || '예약업체',
                productName: reservation.product_name || '상품',
                usageDate: reservation.formatted_usage_date || reservation.usage_date,
                voucherToken: reservation.voucher_token
            });
            
            if (alimtalkResult.success) {
                console.log('✅ 바우처 알림톡 전송 성공:', reservation.korean_name, reservation.phone);
                
                // 전송 기록 저장
                try {
                    const tableExists = await pool.query(`
                        SELECT EXISTS (
                            SELECT FROM information_schema.tables 
                            WHERE table_schema = 'public' 
                            AND table_name = 'voucher_sends'
                        );
                    `);
                    
                    if (tableExists.rows[0].exists) {
                        await pool.query(`
                            INSERT INTO voucher_sends (
                                reservation_id, voucher_token, send_method, recipient,
                                sent_by, status
                            ) VALUES ($1, $2, 'kakao', $3, $4, 'sent')
                        `, [
                            reservationId,
                            reservation.voucher_token,
                            reservation.phone,
                            req.session.adminName || req.session.adminUsername
                        ]);
                        console.log('✅ 카카오 전송 기록 저장 완료');
                    }
                } catch (historyError) {
                    console.error('⚠️ 전송 기록 저장 실패:', historyError.message);
                }
                
                res.json({
                    success: true,
                    message: '바우처 알림톡이 전송되었습니다.',
                    result: alimtalkResult
                });
            } else {
                res.status(500).json({
                    success: false,
                    message: alimtalkResult.message || '알림톡 전송에 실패했습니다.'
                });
            }
        } else {
            // 비즈온 SDK가 없는 경우
            console.log('⚠️ 비즈온 SDK 미설치 - 알림톡 전송 불가');
            res.json({
                success: false,
                message: '알림톡 기능이 비활성화되어 있습니다. 비즈온 SDK 설치가 필요합니다.',
                devMode: true
            });
        }
        
    } catch (error) {
        console.error('❌ 바우처 알림톡 전송 오류:', error);
        res.status(500).json({
            success: false,
            message: '알림톡 전송 중 오류가 발생했습니다: ' + error.message
        });
    }
});

// 바우처 SMS 전송 API
app.post('/api/vouchers/send-sms/:reservationId', requireAuth, async (req, res) => {
    try {
        const { reservationId } = req.params;
        const { voucher_token } = req.body;
        
        console.log('📱 SMS 전송:', reservationId);
        
        // 예약 정보 조회
        const result = await pool.query(`
            SELECT * FROM reservations WHERE id = $1
        `, [reservationId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '예약을 찾을 수 없습니다.'
            });
        }
        
        const reservation = result.rows[0];
        
        // TODO: SMS API 연동 (Twilio 등)
        // const smsSent = await sendSMS({...});
        
        // 전송 기록 저장
        await pool.query(`
            INSERT INTO voucher_sends (
                reservation_id, voucher_token, send_method, recipient,
                sent_by, status
            ) VALUES ($1, $2, 'sms', $3, $4, 'sent')
        `, [
            reservationId,
            voucher_token,
            reservation.phone,
            req.session.adminName || req.session.adminUsername
        ]);
        
        res.json({
            success: true,
            message: 'SMS가 전송되었습니다.'
        });
        
    } catch (error) {
        console.error('❌ SMS 전송 오류:', error);
        res.status(500).json({
            success: false,
            message: 'SMS API 연동이 필요합니다.'
        });
    }
});

// 세이브카드 발급 코드 생성 및 알림톡 전송 API
app.post('/api/vouchers/send-savecard/:reservationId', requireAuth, async (req, res) => {
    try {
        const { reservationId } = req.params;
        
        console.log('💳 세이브카드 발급 코드 생성 및 알림톡 전송:', reservationId);
        
        // 예약 정보 조회
        const result = await pool.query(`
            SELECT * FROM reservations WHERE id = $1
        `, [reservationId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '예약을 찾을 수 없습니다.'
            });
        }
        
        const reservation = result.rows[0];
        
        // 전화번호 확인
        if (!reservation.phone) {
            return res.status(400).json({
                success: false,
                message: '예약자 전화번호가 없습니다.'
            });
        }
        
        // 발급 코드 생성 (a1234b 형식, 6자리)
        let issueCode;
        let isUnique = false;
        let attempts = 0;
        
        while (!isUnique && attempts < 10) {
            const letters = 'abcdefghijklmnopqrstuvwxyz';
            const numbers = '0123456789';
            
            const firstLetter = letters[Math.floor(Math.random() * letters.length)];
            const lastLetter = letters[Math.floor(Math.random() * letters.length)];
            const middleNumbers = Array.from({length: 4}, () => 
                numbers[Math.floor(Math.random() * numbers.length)]
            ).join('');
            
            issueCode = firstLetter + middleNumbers + lastLetter;
            
            // 중복 확인
            const duplicateCheck = await pool.query(
                'SELECT id FROM issue_codes WHERE code = $1',
                [issueCode]
            );
            
            if (duplicateCheck.rows.length === 0) {
                isUnique = true;
            }
            attempts++;
        }
        
        if (!isUnique) {
            return res.status(500).json({
                success: false,
                message: '고유한 코드 생성에 실패했습니다. 다시 시도해주세요.'
            });
        }
        
        console.log('✅ 발급 코드 생성:', issueCode);
        
        // issue_codes 테이블에 저장 (user_name, user_phone 컬럼이 없을 수 있으므로 notes에 저장)
        const notes = `예약 ID: ${reservationId} | ${reservation.korean_name} | ${reservation.phone}`;
        
        // 컬럼 존재 여부 확인
        const columnCheck = await pool.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'issue_codes' 
            AND column_name IN ('user_name', 'user_phone')
        `);
        
        const hasUserColumns = columnCheck.rows.length === 2;
        
        let codeResult;
        if (hasUserColumns) {
            // user_name, user_phone 컬럼이 있는 경우
            codeResult = await pool.query(
                'INSERT INTO issue_codes (code, user_name, user_phone, notes) VALUES ($1, $2, $3, $4) RETURNING *',
                [issueCode, reservation.korean_name, reservation.phone, notes]
            );
        } else {
            // 컬럼이 없는 경우 notes에만 저장
            codeResult = await pool.query(
                'INSERT INTO issue_codes (code, notes) VALUES ($1, $2) RETURNING *',
                [issueCode, notes]
            );
        }
        
        console.log('✅ 발급 코드 DB 저장 완료');
        
        // 비즈온 서비스로 알림톡 전송
        if (bizonService) {
            const alimtalkResult = await bizonService.sendIssueCodeAlimtalk({
                to: reservation.phone,
                name: reservation.korean_name || '고객',
                code: issueCode,
                expireDate: '' // 템플릿에서 사용하지 않음
            });
            
            if (alimtalkResult.success) {
                console.log('✅ 세이브카드 알림톡 전송 성공:', reservation.korean_name, reservation.phone, issueCode);
                
                // issue_codes 테이블에 전달 완료 표시
                await pool.query(
                    'UPDATE issue_codes SET is_delivered = TRUE, delivered_at = NOW() WHERE code = $1',
                    [issueCode]
                );
                
                // 전송 기록 저장
                try {
                    const tableExists = await pool.query(`
                        SELECT EXISTS (
                            SELECT FROM information_schema.tables 
                            WHERE table_schema = 'public' 
                            AND table_name = 'voucher_sends'
                        );
                    `);
                    
                    if (tableExists.rows[0].exists) {
                        // notes 컬럼 존재 여부 확인
                        const notesColumnCheck = await pool.query(`
                            SELECT column_name 
                            FROM information_schema.columns 
                            WHERE table_name = 'voucher_sends' 
                            AND column_name = 'notes'
                        `);
                        
                        const hasNotesColumn = notesColumnCheck.rows.length > 0;
                        
                        if (hasNotesColumn) {
                            await pool.query(`
                                INSERT INTO voucher_sends (
                                    reservation_id, voucher_token, send_method, recipient,
                                    sent_by, status, notes
                                ) VALUES ($1, $2, 'savecard', $3, $4, 'sent', $5)
                            `, [
                                reservationId,
                                reservation.voucher_token || '',
                                reservation.phone,
                                req.session.adminName || req.session.adminUsername,
                                `발급코드: ${issueCode}`
                            ]);
                        } else {
                            await pool.query(`
                                INSERT INTO voucher_sends (
                                    reservation_id, voucher_token, send_method, recipient,
                                    sent_by, status
                                ) VALUES ($1, $2, 'savecard', $3, $4, 'sent')
                            `, [
                                reservationId,
                                reservation.voucher_token || '',
                                reservation.phone,
                                req.session.adminName || req.session.adminUsername
                            ]);
                        }
                        console.log('✅ 세이브카드 전송 기록 저장 완료');
                    }
                } catch (historyError) {
                    console.error('⚠️ 전송 기록 저장 실패:', historyError.message);
                }
                
                res.json({
                    success: true,
                    message: '세이브카드 발급 코드가 생성되어 알림톡으로 전송되었습니다.',
                    issueCode: issueCode,
                    result: alimtalkResult
                });
            } else {
                // 알림톡 전송 실패 시에도 코드는 생성되었으므로 삭제
                await pool.query('DELETE FROM issue_codes WHERE code = $1', [issueCode]);
                
                res.status(500).json({
                    success: false,
                    message: alimtalkResult.message || '알림톡 전송에 실패했습니다.'
                });
            }
        } else {
            // 비즈온 SDK가 없는 경우 - 코드는 생성하지만 알림톡 미전송
            console.log('⚠️ 비즈온 SDK 미설치 - 알림톡 전송 불가');
            
            res.json({
                success: true,
                message: `발급 코드가 생성되었습니다: ${issueCode}\n(알림톡 기능이 비활성화되어 있습니다)`,
                issueCode: issueCode,
                devMode: true
            });
        }
        
    } catch (error) {
        console.error('❌ 세이브카드 알림톡 전송 오류:', error);
        res.status(500).json({
            success: false,
            message: '세이브카드 알림톡 전송 중 오류가 발생했습니다: ' + error.message
        });
    }
});

// 바우처 전송 기록 조회 API
app.get('/api/vouchers/send-history/:reservationId', requireAuth, async (req, res) => {
    try {
        const { reservationId } = req.params;
        
        // 컬럼 존재 여부 확인
        const columnCheck = await pool.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'voucher_sends' 
            AND column_name IN ('viewed_at', 'notes')
        `);
        
        const hasViewedAt = columnCheck.rows.some(row => row.column_name === 'viewed_at');
        const hasNotes = columnCheck.rows.some(row => row.column_name === 'notes');
        
        // 동적으로 SELECT 쿼리 생성
        let selectQuery = `
            SELECT 
                id,
                send_method as method,
                CASE send_method
                    WHEN 'email' THEN '이메일'
                    WHEN 'kakao' THEN '카카오 알림톡'
                    WHEN 'savecard' THEN '세이브카드알림톡'
                    WHEN 'sms' THEN 'SMS'
                    WHEN 'link' THEN '링크 복사'
                END as method_name,
                recipient,
                status,
                sent_at,
                ${hasViewedAt ? 'viewed_at' : 'NULL as viewed_at'},
                ${hasNotes ? 'notes' : 'NULL as notes'}
            FROM voucher_sends
            WHERE reservation_id = $1
            ORDER BY sent_at DESC
        `;
        
        const result = await pool.query(selectQuery, [reservationId]);
        
        res.json({
            success: true,
            history: result.rows
        });
        
    } catch (error) {
        console.error('❌ 전송 기록 조회 오류:', error);
        res.status(500).json({
            success: false,
            message: '전송 기록 조회 중 오류가 발생했습니다.'
        });
    }
});

// 바우처 재생성 API
app.post('/api/vouchers/regenerate/:reservationId', requireAuth, async (req, res) => {
    try {
        const { reservationId } = req.params;
        
        // 새 토큰 생성 (12바이트 = 24자)
        const newToken = crypto.randomBytes(12).toString('hex');
        
        await pool.query(`
            UPDATE reservations 
            SET voucher_token = $1, updated_at = NOW()
            WHERE id = $2
        `, [newToken, reservationId]);
        
        // 히스토리 기록
        const adminName = req.session.adminName || req.session.adminUsername || '시스템';
        await logHistory(
            reservationId,
            '바우처',
            '재생성',
            adminName,
            '바우처가 재생성되었습니다. (보안상 이유로 기존 링크 무효화)',
            null,
            { new_voucher_token: newToken }
        );
        
        res.json({
            success: true,
            voucher_token: newToken,
            message: '바우처가 재생성되었습니다.'
        });
        
    } catch (error) {
        console.error('❌ 바우처 재생성 오류:', error);
        res.status(500).json({
            success: false,
            message: '바우처 재생성 중 오류가 발생했습니다.'
        });
    }
});

// 바우처 열람 추적 (고객용) - 중복 라우트 제거됨 (12926번 줄의 더 완전한 버전 사용)

// 예약 상태 변경 API
app.patch('/api/reservations/:id/status', requireAuth, async (req, res) => {
    try {
        const reservationId = req.params.id;
        const { status, reason } = req.body;
        
        console.log('🔄 예약 상태 변경 요청:', reservationId, status, reason);
        
        if (!status) {
            return res.status(400).json({
                success: false,
                message: '상태 값이 필요합니다.'
            });
        }
        
        // 상태값 변환 (하이픈 제거)
        const normalizedStatus = status.replace(/-/g, '_');
        
        // 기존 상태 조회
        const oldReservation = await pool.query(
            'SELECT payment_status FROM reservations WHERE id = $1',
            [reservationId]
        );
        
        if (oldReservation.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '예약을 찾을 수 없습니다.'
            });
        }
        
        const oldStatus = oldReservation.rows[0].payment_status;
        
        // 상태 업데이트
        const result = await pool.query(
            'UPDATE reservations SET payment_status = $1, updated_at = NOW() WHERE id = $2 RETURNING *',
            [normalizedStatus, reservationId]
        );
        
        console.log('✅ 예약 상태 변경 완료:', oldStatus, '→', normalizedStatus);
        
        // 상태 변경 이력 저장
        const statusNames = {
            'pending': '대기중',
            'in_progress': '수배중',
            'confirmed': '확정',
            'voucher_sent': '바우처전송완료',
            'settlement_completed': '정산완료',
            'cancelled': '취소'
        };
        
        await logHistory(
            reservationId,
            '예약',
            '상태변경',
            req.session?.username || '관리자',
            `예약 상태가 변경되었습니다. ${statusNames[oldStatus] || oldStatus} → ${statusNames[normalizedStatus] || normalizedStatus}. ${reason ? `사유: ${reason}` : ''}`,
            { payment_status: { from: oldStatus, to: normalizedStatus } },
            { 
                reason: reason || null,
                old_status_kr: statusNames[oldStatus] || oldStatus,
                new_status_kr: statusNames[normalizedStatus] || normalizedStatus
            }
        );
        
        res.json({
            success: true,
            message: '예약 상태가 변경되었습니다.',
            reservation: result.rows[0]
        });
        
    } catch (error) {
        console.error('❌ 예약 상태 변경 오류:', error);
        res.status(500).json({
            success: false,
            message: '예약 상태 변경 중 오류가 발생했습니다: ' + error.message
        });
    }
});

// 컨펌번호 저장 API (구버전 - 사용 안함, 새로운 4가지 방식 확정 API로 대체됨)
/*
app.post('/api/reservations/:id/confirm', requireAuth, async (req, res) => {
    try {
        const reservationId = req.params.id;
        const { confirmation_number, vendor_id } = req.body;
        
        console.log('🔐 컨펌번호 저장 요청:', reservationId, confirmation_number, vendor_id);
        
        if (!confirmation_number) {
            return res.status(400).json({
                success: false,
                message: '컨펌번호가 필요합니다.'
            });
        }
        
        // 기존 컨펌번호 및 상태 조회
        const oldReservation = await pool.query(
            'SELECT confirmation_number, payment_status FROM reservations WHERE id = $1',
            [reservationId]
        );
        
        if (oldReservation.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '예약을 찾을 수 없습니다.'
            });
        }
        
        const oldConfirmationNumber = oldReservation.rows[0].confirmation_number;
        const oldStatus = oldReservation.rows[0].payment_status;
        
        // 컨펌번호 업데이트 (컨펌번호 컬럼이 없을 수 있으므로 동적 추가)
        await pool.query(`
            DO $$ 
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM information_schema.columns 
                    WHERE table_name = 'reservations' AND column_name = 'confirmation_number'
                ) THEN
                    ALTER TABLE reservations ADD COLUMN confirmation_number VARCHAR(100);
                END IF;
            END $$;
        `);
        
        // 컨펌번호 저장 + 상태를 confirmed로 변경
        const result = await pool.query(
            'UPDATE reservations SET confirmation_number = $1, payment_status = $2, updated_at = NOW() WHERE id = $3 RETURNING *',
            [confirmation_number, 'confirmed', reservationId]
        );
        
        console.log('✅ 컨펌번호 저장 및 상태 변경 완료:', confirmation_number, '→ confirmed');
        
        // assignments 테이블도 업데이트
        try {
            await pool.query(`
                UPDATE assignments 
                SET confirmation_number = $1, status = 'confirmed', response_at = NOW(), updated_at = NOW()
                WHERE reservation_id = $2
            `, [confirmation_number, reservationId]);
            console.log('✅ assignments 테이블도 업데이트 완료');
        } catch (assignmentError) {
            console.error('⚠️ assignments 테이블 업데이트 실패:', assignmentError);
        }
        
        // 변경 이력 저장
        const statusNames = {
            'pending': '대기중',
            'in_progress': '수배중',
            'confirmed': '확정',
            'voucher_sent': '바우처전송완료',
            'settlement_completed': '정산완료',
            'cancelled': '취소'
        };
        
        await logHistory(
            reservationId,
            '수배',
            '확정',
            req.session?.username || '관리자',
            `예약이 확정되었습니다. 컨펌번호 "${confirmation_number}"가 발급되었으며, 예약 상태가 ${statusNames[oldStatus] || oldStatus}에서 확정으로 변경되었습니다.`,
            { 
                confirmation_number: { from: oldConfirmationNumber || '(없음)', to: confirmation_number },
                payment_status: { from: oldStatus, to: 'confirmed' }
            },
            {
                confirmation_number: confirmation_number,
                vendor_id: vendor_id || null,
                old_status: oldStatus,
                new_status: 'confirmed'
            }
        );
        
        res.json({
            success: true,
            message: '컨펌번호가 저장되었습니다.',
            reservation: result.rows[0]
        });
        
    } catch (error) {
        console.error('❌ 컨펌번호 저장 오류:', error);
        res.status(500).json({
            success: false,
            message: '컨펌번호 저장 중 오류가 발생했습니다: ' + error.message
        });
    }
});
*/

// 예약 히스토리 조회 API (실제 데이터베이스 조회)
app.get('/api/reservations/:id/history', requireAuth, async (req, res) => {
    try {
        const reservationId = req.params.id;
        
        console.log('📜 예약 히스토리 조회:', reservationId);
        
        // reservation_logs 테이블에서 히스토리 조회 (개선된 스키마)
        const result = await pool.query(`
            SELECT 
                id,
                category,
                action,
                changed_by,
                description,
                changes,
                metadata,
                created_at
            FROM reservation_logs
            WHERE reservation_id = $1
            ORDER BY created_at DESC
        `, [reservationId]);
        
        console.log('✅ 히스토리 조회 완료:', result.rows.length, '건');
        
        res.json({
            success: true,
            history: result.rows
        });
        
    } catch (error) {
        console.error('❌ 예약 히스토리 조회 오류:', error);
        // 테이블이 없는 경우 빈 배열 반환
        res.json({
            success: true,
            history: []
        });
    }
});

// 수배서 전송 API
app.post('/api/assignments/:reservationId/send', requireAuth, async (req, res) => {
    try {
        const reservationId = req.params.reservationId;
        
        console.log('📤 수배서 전송 요청:', reservationId);
        
        // 예약 정보 조회
        const reservationResult = await pool.query(
            'SELECT * FROM reservations WHERE id = $1',
            [reservationId]
        );
        
        if (reservationResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '예약을 찾을 수 없습니다.'
            });
        }
        
        const reservation = reservationResult.rows[0];
        
        // assignments 확인 및 업데이트
        const assignmentResult = await pool.query(
            'SELECT * FROM assignments WHERE reservation_id = $1',
            [reservationId]
        );
        
        if (assignmentResult.rows.length > 0) {
            // 기존 assignment가 있으면 업데이트
            await pool.query(`
                UPDATE assignments 
                SET status = 'sent', sent_at = NOW(), updated_at = NOW()
                WHERE reservation_id = $1
            `, [reservationId]);
            console.log('✅ 기존 수배서 상태 업데이트: sent');
        }
        
        // 예약 상태를 in_progress로 변경
        const oldStatus = reservation.payment_status;
        if (oldStatus !== 'confirmed' && oldStatus !== 'voucher_sent') {
            await pool.query(
                'UPDATE reservations SET payment_status = $1, updated_at = NOW() WHERE id = $2',
                ['in_progress', reservationId]
            );
            console.log(`✅ 예약 상태 변경: ${oldStatus} → in_progress`);
        }
        
        // 히스토리 저장
        const statusNames = {
            'pending': '대기중',
            'in_progress': '수배중',
            'confirmed': '확정',
            'voucher_sent': '바우처전송완료',
            'settlement_completed': '정산완료'
        };
        
        const vendorInfo = assignmentResult.rows.length > 0 ? assignmentResult.rows[0].vendor_name || '현지업체' : '현지업체';
        
        await logHistory(
            reservationId,
            '수배',
            '전송',
            req.session?.username || '관리자',
            `수배서가 ${vendorInfo}에 전송되었습니다. ${oldStatus !== 'confirmed' && oldStatus !== 'voucher_sent' ? `예약 상태가 ${statusNames[oldStatus] || oldStatus}에서 수배중으로 변경되었습니다.` : '현지업체의 확인을 기다리고 있습니다.'}`,
            { 
                payment_status: oldStatus !== 'confirmed' && oldStatus !== 'voucher_sent' ? { from: oldStatus, to: 'in_progress' } : null,
                assignment_status: { from: 'pending', to: 'sent' }
            },
            {
                vendor_name: vendorInfo,
                assignment_id: assignmentResult.rows.length > 0 ? assignmentResult.rows[0].id : null,
                sent_at: new Date().toISOString()
            }
        );
        
        res.json({
            success: true,
            message: '수배서가 성공적으로 전송되었습니다.'
        });
        
    } catch (error) {
        console.error('❌ 수배서 전송 오류:', error);
        res.status(500).json({
            success: false,
            message: '수배서 전송 중 오류가 발생했습니다: ' + error.message
        });
    }
});

// 예약 메모 저장 API
app.post('/api/reservations/:id/memo', requireAuth, async (req, res) => {
    try {
        const reservationId = req.params.id;
        const { memo } = req.body;
        
        console.log('📝 예약 메모 저장 API 호출:', reservationId);
        
        const query = `
            UPDATE reservations 
            SET memo = $1, updated_at = NOW()
            WHERE id = $2
            RETURNING *
        `;
        
        const result = await pool.query(query, [memo, reservationId]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '예약을 찾을 수 없습니다.'
            });
        }
        
        console.log('✅ 예약 메모 저장 완료');
        
        // 메모 저장 히스토리 기록
        await logHistory(
            reservationId,
            '예약',
            '메모저장',
            req.session?.username || '관리자',
            `특별 요청사항이 ${memo ? '추가/수정' : '삭제'}되었습니다.${memo ? ` 내용: "${memo.length > 50 ? memo.substring(0, 50) + '...' : memo}"` : ''}`,
            null,
            {
                memo_length: memo ? memo.length : 0,
                has_memo: memo ? true : false
            }
        );
        
        res.json({
            success: true,
            message: '메모가 저장되었습니다.'
        });
        
    } catch (error) {
        console.error('❌ 예약 메모 저장 오류:', error);
        res.status(500).json({
            success: false,
            message: '메모 저장 중 오류가 발생했습니다: ' + error.message
        });
    }
});

// 수배서 생성 API
app.post('/api/assignments', requireAuth, async (req, res) => {
    try {
        console.log('🔧 수배서 생성 요청:', req.body);
        const { reservation_id, vendor_id, notes } = req.body;

        if (!reservation_id) {
            console.log('❌ 필수 필드 누락: reservation_id');
            return res.status(400).json({
                success: false,
                message: '예약 ID는 필수입니다.'
            });
        }
        
        // 예약 정보 확인
        const reservationQuery = 'SELECT * FROM reservations WHERE id = $1';
        const reservationResult = await pool.query(reservationQuery, [reservation_id]);
        
        if (reservationResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '예약을 찾을 수 없습니다.'
            });
        }
        
        // 고유 토큰 생성
        const crypto = require('crypto');
        const assignment_token = crypto.randomBytes(16).toString('hex');
        
        let vendor = null;
        let vendor_contact = {};
        
        // vendor_id가 제공된 경우에만 수배업체 정보 확인
        if (vendor_id) {
            const vendorQuery = 'SELECT * FROM vendors WHERE id = $1 AND is_active = true';
            const vendorResult = await pool.query(vendorQuery, [vendor_id]);
            
            if (vendorResult.rows.length > 0) {
                vendor = vendorResult.rows[0];
                vendor_contact = {
                    email: vendor.email,
                    phone: vendor.phone,
                    contact_person: vendor.contact_person
                };
            }
        }
        
        // 수배서 생성 (vendor_id 없어도 가능 - 미리보기용)
        const insertQuery = `
            INSERT INTO assignments (
                reservation_id, vendor_id, vendor_name, vendor_contact,
                assignment_token, status, notes, assigned_by, assigned_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
            RETURNING *
        `;
        
        const insertParams = [
            reservation_id,
            vendor_id || null,
            vendor ? vendor.vendor_name : null,
            JSON.stringify(vendor_contact),
            assignment_token,
            'pending',
            notes || '미리보기용 수배서',
            req.session.adminUsername || 'admin'
        ];
        
        const result = await pool.query(insertQuery, insertParams);
        const assignment = result.rows[0];

        // vendor_id가 있을 때만 상태 변경 및 자동 전송
        if (vendor_id && vendor) {
            // 예약 상태를 "수배중(현지수배)"으로 업데이트
            await pool.query(
                'UPDATE reservations SET payment_status = $1, updated_at = NOW() WHERE id = $2',
                ['in_progress', reservation_id]
            );

            // 수배서 자동 전송 (상태를 'sent'로 업데이트)
            await pool.query(
                'UPDATE assignments SET status = $1, sent_at = NOW(), updated_at = NOW() WHERE id = $2',
                ['sent', assignment.id]
            );

            console.log(`✅ 수배서 자동 생성 및 전송: ${vendor.vendor_name}`);
            console.log(`🔗 수배서 링크: ${req.protocol}://${req.get('host')}/assignment/${assignment_token}`);

            res.json({
                success: true,
                message: '수배서가 생성되고 수배처에 전송되었습니다.',
                data: assignment,
                assignment_token: assignment_token,
                assignment_link: `/assignment/${assignment_token}`,
                auto_sent: true
            });
        } else {
            // 미리보기용 수배서 생성 (상태 변경 없음)
            console.log(`✅ 미리보기용 수배서 생성 완료`);
            console.log(`🔗 수배서 링크: ${req.protocol}://${req.get('host')}/assignment/${assignment_token}`);

            res.json({
                success: true,
                message: '미리보기용 수배서가 생성되었습니다.',
                data: assignment,
                assignment_token: assignment_token,
                assignment_link: `/assignment/${assignment_token}`,
                auto_sent: false
            });
        }
        
    } catch (error) {
        console.error('❌ 수배서 생성 오류:', error);
        console.error('❌ 스택 트레이스:', error.stack);
        res.status(500).json({
            success: false,
            message: '수배서 생성 중 오류가 발생했습니다: ' + error.message
        });
    }
});

// 예약을 수배중으로 전환하는 API (예약관리 → 수배관리)
app.post('/api/reservations/:id/assign', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { vendor_name, notes } = req.body;
        
        console.log(`🔄 예약 수배 전환: ${id} → 수배중 상태로 변경`);
        
        // 예약 상태를 in_progress(수배중)로 변경
        const updateQuery = `
            UPDATE reservations 
            SET payment_status = 'in_progress',
                updated_at = NOW()
            WHERE id = $1 AND payment_status = 'pending'
            RETURNING *
        `;
        
        const result = await pool.query(updateQuery, [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '대기중 상태의 예약을 찾을 수 없습니다.'
            });
        }
        
        console.log(`✅ 예약 수배 전환 완료: ${id} (pending → in_progress)`);
        
        res.json({
            success: true,
            message: '예약이 수배중 상태로 전환되었습니다.',
            reservation: result.rows[0],
            workflow: {
                from: 'pending',
                to: 'in_progress',
                page_transfer: '예약관리 → 수배관리'
            }
        });
        
    } catch (error) {
        console.error('예약 수배 전환 오류:', error);
        res.status(500).json({
            success: false,
            message: '예약 수배 전환 실패',
            error: error.message
        });
    }
});

// 예약 확정 API (컨펌번호 입력)
app.post('/api/reservations/:id/confirm', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { confirmation_number } = req.body;

        if (!confirmation_number) {
            return res.status(400).json({
                success: false,
                message: '확정번호를 입력해주세요.'
            });
        }

        console.log(`🎯 예약 확정 처리: ID ${id}, 확정번호: ${confirmation_number}`);

        // 예약 상태를 '확정(수배완료)'로 변경
        await pool.query(
            'UPDATE reservations SET payment_status = $1, updated_at = NOW() WHERE id = $2',
            ['confirmed', id]
        );

        // assignments 테이블에 확정번호 저장
        await pool.query(
            `UPDATE assignments 
             SET confirmation_number = $1, status = 'confirmed', response_at = NOW(), updated_at = NOW() 
             WHERE reservation_id = $2`,
            [confirmation_number, id]
        );

        console.log(`✅ 예약 확정 완료: ${confirmation_number}`);

        res.json({
            success: true,
            message: '예약이 확정되었습니다.',
            confirmation_number: confirmation_number
        });

    } catch (error) {
        console.error('❌ 예약 확정 오류:', error);
        res.status(500).json({
            success: false,
            message: '예약 확정 중 오류가 발생했습니다: ' + error.message
        });
    }
});

// 바우처 생성/전송 API (새로운 시스템)
app.post('/api/reservations/:id/voucher', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { auto_generate, savecard_code } = req.body;

        console.log(`🎫 바우처 생성 시작: 예약 ID ${id}`, { auto_generate, savecard_code });

        // 예약 정보 조회
        const reservationResult = await pool.query(
            'SELECT * FROM reservations WHERE id = $1',
            [id]
        );

        if (reservationResult.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '예약을 찾을 수 없습니다.'
            });
        }

        const reservation = reservationResult.rows[0];

        // 이미 바우처가 생성되었는지 확인
        const existingVoucher = await pool.query(
            'SELECT voucher_token FROM assignments WHERE reservation_id = $1 AND voucher_token IS NOT NULL',
            [id]
        );

        let voucher_token;
        let generated_savecard_code = savecard_code;

        if (existingVoucher.rows.length > 0) {
            voucher_token = existingVoucher.rows[0].voucher_token;
            console.log(`📋 기존 바우처 토큰 사용: ${voucher_token}`);
        } else {
            // 새 바우처 토큰 생성
            voucher_token = 'VCH' + Date.now() + Math.random().toString(36).substr(2, 9);
            
            // 세이브카드 코드가 없으면 자동 생성
            if (!generated_savecard_code) {
                const letters = 'abcdefghijklmnopqrstuvwxyz';
                const numbers = '0123456789';
                generated_savecard_code = 
                    letters.charAt(Math.floor(Math.random() * letters.length)) +
                    Array.from({length: 4}, () => numbers.charAt(Math.floor(Math.random() * numbers.length))).join('') +
                    letters.charAt(Math.floor(Math.random() * letters.length));
            }

            // assignments 테이블 업데이트 또는 생성
            const assignmentExists = await pool.query(
                'SELECT id FROM assignments WHERE reservation_id = $1',
                [id]
            );

            if (assignmentExists.rows.length > 0) {
                // 기존 assignment 업데이트
                await pool.query(
                    `UPDATE assignments 
                     SET voucher_token = $1, savecard_code = $2, sent_at = NOW(), updated_at = NOW() 
                     WHERE reservation_id = $3`,
                    [voucher_token, generated_savecard_code, id]
                );
            } else {
                // 새 assignment 생성
                await pool.query(
                    `INSERT INTO assignments (reservation_id, voucher_token, savecard_code, sent_at, created_at, updated_at)
                     VALUES ($1, $2, $3, NOW(), NOW(), NOW())`,
                    [id, voucher_token, generated_savecard_code]
                );
            }

            console.log(`✅ 새 바우처 생성: ${voucher_token}, 세이브카드: ${generated_savecard_code}`);
            
            // 바우처 생성 히스토리 저장
            await logHistory(
                id,
                '바우처',
                '생성',
                req.session?.username || '관리자',
                `바우처가 생성되었습니다. 바우처 토큰: ${voucher_token}, 세이브카드 코드: ${generated_savecard_code}. 고객이 이 바우처로 현지에서 서비스를 이용할 수 있습니다.`,
                null,
                {
                    voucher_token: voucher_token,
                    savecard_code: generated_savecard_code,
                    auto_generate: auto_generate || false,
                    voucher_link: `/voucher/${voucher_token}`
                }
            );
        }

        // 예약 상태를 '바우처전송완료'로 변경 (자동 생성이 아닌 경우)
        if (!auto_generate) {
            await pool.query(
                'UPDATE reservations SET payment_status = $1, updated_at = NOW() WHERE id = $2',
                ['voucher_sent', id]
            );
            
            // 바우처 전송 히스토리 저장
            await logHistory(
                id,
                '바우처',
                '전송',
                req.session?.username || '관리자',
                `바우처가 고객에게 전송되었습니다. 예약 상태가 "바우처전송완료"로 변경되었으며, 고객이 바우처 링크를 통해 예약 정보를 확인할 수 있습니다.`,
                { payment_status: { from: 'confirmed', to: 'voucher_sent' } },
                {
                    voucher_token: voucher_token,
                    sent_method: '시스템',
                    voucher_link: `/voucher/${voucher_token}`
                }
            );
        }

        console.log(`🎫 바우처 링크: ${req.protocol}://${req.get('host')}/voucher/${voucher_token}`);

        res.json({
            success: true,
            message: auto_generate ? '바우처가 자동 생성되었습니다.' : '바우처가 전송되었습니다.',
            voucher_token: voucher_token,
            savecard_code: generated_savecard_code,
            voucher_link: `/voucher/${voucher_token}`,
            voucher: {
                voucher_token: voucher_token,
                savecard_code: generated_savecard_code,
                created_at: new Date(),
                status: 'created'
            }
        });

    } catch (error) {
        console.error('❌ 바우처 생성 오류:', error);
        res.status(500).json({
            success: false,
            message: '바우처 생성 중 오류가 발생했습니다: ' + error.message
        });
    }
});

// 바우처 재전송 API
app.post('/api/reservations/:id/voucher/resend', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;

        console.log(`🔄 바우처 재전송: 예약 ID ${id}`);

        // 예약 정보 및 바우처 토큰 조회
        const result = await pool.query(`
            SELECT r.*, a.voucher_token 
            FROM reservations r
            LEFT JOIN assignments a ON r.id = a.reservation_id
            WHERE r.id = $1
        `, [id]);

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '예약을 찾을 수 없습니다.'
            });
        }

        const reservation = result.rows[0];

        if (!reservation.voucher_token) {
            return res.status(400).json({
                success: false,
                message: '바우처가 아직 생성되지 않았습니다.'
            });
        }

        // TODO: 실제 바우처 재전송 로직 추가
        console.log(`📧 바우처 재전송 완료: ${reservation.korean_name}`);

        res.json({
            success: true,
            message: '바우처가 재전송되었습니다.',
            voucher_token: reservation.voucher_token
        });

    } catch (error) {
        console.error('❌ 바우처 재전송 오류:', error);
        res.status(500).json({
            success: false,
            message: '바우처 재전송 중 오류가 발생했습니다: ' + error.message
        });
    }
});

// 정산 이관 API
app.post('/api/reservations/:id/settlement', requireAuth, async (req, res) => {
    const client = await pool.connect();
    try {
        const { id } = req.params;
        const settlementData = req.body;

        console.log(`💰 정산 이관: 예약 ID ${id}`, settlementData);

        await client.query('BEGIN');

        // 기존 상태 조회
        const oldReservation = await client.query(
            'SELECT payment_status, korean_name, product_name FROM reservations WHERE id = $1',
            [id]
        );
        
        if (oldReservation.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({
                success: false,
                message: '예약을 찾을 수 없습니다.'
            });
        }
        
        const oldStatus = oldReservation.rows[0].payment_status;
        const customerName = oldReservation.rows[0].korean_name;
        const productName = oldReservation.rows[0].product_name;

        // 정산 기간 생성 (YYYY-MM 형식)
        const now = new Date();
        const settlementPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

        // settlements 테이블에 데이터 저장 (UPSERT)
        await client.query(`
            INSERT INTO settlements (
                reservation_id,
                settlement_period,
                sale_currency, sale_adult_price, sale_child_price, sale_infant_price, 
                total_sale, commission_rate, commission_amount, net_revenue,
                cost_currency, cost_adult_price, cost_child_price, cost_infant_price, 
                total_cost,
                exchange_rate, cost_krw, margin_krw, margin_rate,
                memo, settlement_status, created_by
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22
            )
            ON CONFLICT (reservation_id) 
            DO UPDATE SET
                settlement_period = $2,
                sale_currency = $3,
                sale_adult_price = $4,
                sale_child_price = $5,
                sale_infant_price = $6,
                total_sale = $7,
                commission_rate = $8,
                commission_amount = $9,
                net_revenue = $10,
                cost_currency = $11,
                cost_adult_price = $12,
                cost_child_price = $13,
                cost_infant_price = $14,
                total_cost = $15,
                exchange_rate = $16,
                cost_krw = $17,
                margin_krw = $18,
                margin_rate = $19,
                memo = $20,
                updated_at = NOW()
        `, [
            id,
            settlementPeriod,
            settlementData.sale_currency || 'KRW',
            settlementData.sale_adult_price || 0,
            settlementData.sale_child_price || 0,
            settlementData.sale_infant_price || 0,
            settlementData.total_sale || 0,
            settlementData.commission_rate || 0,
            settlementData.commission_amount || 0,
            settlementData.net_revenue || 0,
            settlementData.cost_currency || 'USD',
            settlementData.cost_adult_price || 0,
            settlementData.cost_child_price || 0,
            settlementData.cost_infant_price || 0,
            settlementData.total_cost || 0,
            settlementData.exchange_rate || 1330,
            settlementData.cost_krw || 0,
            settlementData.margin_krw || 0,
            settlementData.margin_rate || 0,
            settlementData.memo || null,
            'pending',
            req.session?.user?.username || 'admin'
        ]);

        // 예약 상태를 '정산완료'로 변경 (수배관리에서 제외)
        await client.query(
            'UPDATE reservations SET payment_status = $1, updated_at = NOW() WHERE id = $2',
            ['settlement_completed', id]
        );

        // 정산 이관 히스토리 저장
        const statusNames = {
            'pending': '대기중',
            'in_progress': '수배중',
            'confirmed': '확정',
            'voucher_sent': '바우처전송완료',
            'settlement_completed': '정산완료'
        };
        
        await logHistory(
            id,
            '정산',
            '이관',
            req.session?.user?.username || '관리자',
            `정산이관 완료. 매출: ${settlementData.total_sale || 0} ${settlementData.sale_currency}, 매입: ${settlementData.total_cost || 0} ${settlementData.cost_currency}, 마진: ${settlementData.margin_krw || 0}원 (${settlementData.margin_rate || 0}%)`,
            { payment_status: { from: oldStatus, to: 'settlement_completed' } },
            {
                customer_name: customerName,
                product_name: productName,
                total_sale: settlementData.total_sale,
                total_cost: settlementData.total_cost,
                margin_krw: settlementData.margin_krw,
                transferred_at: new Date().toISOString()
            }
        );

        await client.query('COMMIT');

        console.log(`✅ 정산 이관 완료: 예약 ID ${id}`);

        res.json({
            success: true,
            message: '정산관리로 이관되었습니다.'
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error('❌ 정산 이관 오류:', error);
        res.status(500).json({
            success: false,
            message: '정산 이관 중 오류가 발생했습니다: ' + error.message
        });
    } finally {
        client.release();
    }
});

// 수배서 재전송 API
app.post('/api/assignments/:id/resend', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;

        console.log(`🔄 수배서 재전송: Assignment ID ${id}`);

        // 수배서 정보 조회
        const result = await pool.query(
            'SELECT * FROM assignments WHERE id = $1',
            [id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '수배서를 찾을 수 없습니다.'
            });
        }

        const assignment = result.rows[0];

        // 재전송 시간 업데이트
        await pool.query(
            'UPDATE assignments SET sent_at = NOW(), updated_at = NOW() WHERE id = $1',
            [id]
        );

        // TODO: 실제 수배서 재전송 로직 추가
        console.log(`📧 수배서 재전송 완료: ${assignment.vendor_name}`);

        res.json({
            success: true,
            message: '수배서가 재전송되었습니다.',
            assignment_link: `/assignment/${assignment.assignment_token}`
        });

    } catch (error) {
        console.error('❌ 수배서 재전송 오류:', error);
        res.status(500).json({
            success: false,
            message: '수배서 재전송 중 오류가 발생했습니다: ' + error.message
        });
    }
});

// 정산관리 목록 조회 API
app.get('/api/settlements', requireAuth, async (req, res) => {
    try {
        const { page = 1, status = '', search = '' } = req.query;
        const limit = 20;
        const offset = (page - 1) * limit;
        
        let whereClause = `WHERE r.payment_status IN ('settlement_completed', 'payment_completed')`;
        const queryParams = [];
        let paramIndex = 0;
        
        if (status) {
            paramIndex++;
            whereClause += ` AND r.payment_status = $${paramIndex}`;
            queryParams.push(status);
        }
        
        if (search) {
            paramIndex++;
            whereClause += ` AND (
                r.reservation_number ILIKE $${paramIndex} OR 
                r.product_name ILIKE $${paramIndex} OR 
                r.korean_name ILIKE $${paramIndex}
            )`;
            queryParams.push(`%${search}%`);
        }
        
        const countQuery = `
            SELECT COUNT(*) as total 
            FROM reservations r
            ${whereClause}
        `;
        const countResult = await pool.query(countQuery, queryParams);
        const totalCount = parseInt(countResult.rows[0].total);
        
        const settlementsQuery = `
            SELECT 
                r.*,
                a.id as assignment_id,
                a.vendor_name,
                a.confirmation_number,
                a.voucher_token
            FROM reservations r
            LEFT JOIN assignments a ON r.id = a.reservation_id
            ${whereClause}
            ORDER BY r.updated_at DESC, r.created_at DESC
            LIMIT $${paramIndex + 1} OFFSET $${paramIndex + 2}
        `;
        
        queryParams.push(limit, offset);
        const result = await pool.query(settlementsQuery, queryParams);
        
        const totalPages = Math.ceil(totalCount / limit);
        
        res.json({
            success: true,
            data: {
                settlements: result.rows,
                pagination: {
                    currentPage: parseInt(page),
                    totalPages: totalPages,
                    totalCount: totalCount,
                    limit: limit
                }
            }
        });
        
    } catch (error) {
        console.error('❌ 정산관리 목록 조회 오류:', error);
        res.status(500).json({
            success: false,
            message: '정산관리 목록을 불러오는데 실패했습니다: ' + error.message
        });
    }
});

// 정산 통계 API
app.get('/api/settlements/statistics', requireAuth, async (req, res) => {
    try {
        const statsQuery = `
            SELECT 
                COUNT(*) as total,
                COUNT(CASE WHEN payment_status = 'settlement_completed' THEN 1 END) as pending,
                COUNT(CASE WHEN payment_status = 'payment_completed' THEN 1 END) as completed,
                COALESCE(SUM(total_amount), 0) as total_amount
            FROM reservations 
            WHERE payment_status IN ('settlement_completed', 'payment_completed')
        `;
        
        const result = await pool.query(statsQuery);
        const stats = result.rows[0];
        
        res.json({
            success: true,
            data: {
                total: parseInt(stats.total),
                pending: parseInt(stats.pending),
                completed: parseInt(stats.completed),
                totalAmount: parseFloat(stats.total_amount)
            }
        });
        
    } catch (error) {
        console.error('❌ 정산 통계 조회 오류:', error);
        res.status(500).json({
            success: false,
            message: '정산 통계를 불러오는데 실패했습니다: ' + error.message
        });
    }
});

// 정산 완료 API
app.post('/api/settlements/:id/complete', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        
        await pool.query(
            'UPDATE reservations SET payment_status = $1, updated_at = NOW() WHERE id = $2',
            ['payment_completed', id]
        );
        
        console.log(`✅ 정산 완료: 예약 ID ${id}`);
        
        res.json({
            success: true,
            message: '정산이 완료되었습니다.'
        });
        
    } catch (error) {
        console.error('❌ 정산 완료 오류:', error);
        res.status(500).json({
            success: false,
            message: '정산 완료 중 오류가 발생했습니다: ' + error.message
        });
    }
});

// 정산관리 페이지 라우트
app.get('/admin/settlement', requireAuth, (req, res) => {
    res.render('admin/settlement');
});


// 수배서 열람 상태 업데이트 API
app.post('/api/assignment/:token/view', async (req, res) => {
    try {
        const { token } = req.params;
        
        const updateQuery = `
            UPDATE assignments 
            SET viewed_at = COALESCE(viewed_at, NOW()),
                status = CASE 
                    WHEN status = 'sent' THEN 'viewed'
                    ELSE status 
                END,
                updated_at = NOW()
            WHERE assignment_token = $1
            RETURNING *
        `;
        
        const result = await pool.query(updateQuery, [token]);
        
        res.json({
            success: true,
            message: '열람 상태가 업데이트되었습니다.'
        });
        
    } catch (error) {
        console.error('열람 상태 업데이트 오류:', error);
        res.status(500).json({
            success: false,
            message: '열람 상태 업데이트 중 오류가 발생했습니다.'
        });
    }
});

// 수배서 확정 API
app.post('/api/assignment/:token/confirm', async (req, res) => {
    try {
        const { token } = req.params;
        const { confirmation_number, cost_price, cost_currency } = req.body;
        
        // 바우처 토큰 생성 (확정번호가 있는 경우)
        let voucher_token = null;
        if (confirmation_number) {
            voucher_token = crypto.randomBytes(16).toString('hex');
        }
        
        const updateQuery = `
            UPDATE assignments 
            SET status = 'confirmed',
                confirmation_number = $2,
                cost_price = $3,
                cost_currency = $4,
                voucher_token = $5,
                response_at = NOW(),
                updated_at = NOW()
            WHERE assignment_token = $1
            RETURNING *
        `;
        
        const result = await pool.query(updateQuery, [
            token, 
            confirmation_number || null,
            cost_price || null,
            cost_currency || 'USD',
            voucher_token
        ]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '수배서를 찾을 수 없습니다.'
            });
        }
        
        const assignment = result.rows[0];
        
        // 예약 상태도 확정으로 업데이트
        await pool.query(
            'UPDATE reservations SET payment_status = $1 WHERE id = $2',
            ['confirmed', assignment.reservation_id]
        );
        
        res.json({
            success: true,
            message: '수배가 확정되었습니다.',
            voucher_link: voucher_token ? `/voucher/${voucher_token}` : null
        });
        
    } catch (error) {
        console.error('수배 확정 오류:', error);
        res.status(500).json({
            success: false,
            message: '수배 확정 중 오류가 발생했습니다.'
        });
    }
});

// 수배서 거절 API
app.post('/api/assignment/:token/reject', async (req, res) => {
    try {
        const { token } = req.params;
        const { rejection_reason } = req.body;
        
        if (!rejection_reason || !rejection_reason.trim()) {
            return res.status(400).json({
                success: false,
                message: '거절 사유는 필수입니다.'
            });
        }
        
        const updateQuery = `
            UPDATE assignments 
            SET status = 'rejected',
                rejection_reason = $2,
                response_at = NOW(),
                updated_at = NOW()
            WHERE assignment_token = $1
            RETURNING *
        `;
        
        const result = await pool.query(updateQuery, [token, rejection_reason]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '수배서를 찾을 수 없습니다.'
            });
        }
        
        res.json({
            success: true,
            message: '수배가 거절되었습니다.'
        });
        
    } catch (error) {
        console.error('수배 거절 오류:', error);
        res.status(500).json({
            success: false,
            message: '수배 거절 중 오류가 발생했습니다.'
        });
    }
});

// 수배서 전송 API
app.post('/api/assignments/:id/send', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        
        // 수배서 정보 조회
        const assignmentQuery = 'SELECT * FROM assignments WHERE id = $1';
        const result = await pool.query(assignmentQuery, [id]);
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '수배서를 찾을 수 없습니다.'
            });
        }
        
        const assignment = result.rows[0];
        
        // 이미 전송된 수배서인지 확인
        if (assignment.status !== 'requested') {
            return res.status(400).json({
                success: false,
                message: '이미 전송된 수배서입니다.'
            });
        }
        
        // 수배서 상태를 전송됨으로 업데이트
        const updateQuery = `
            UPDATE assignments 
            SET status = 'sent', 
                sent_at = NOW(),
                updated_at = NOW()
            WHERE id = $1
            RETURNING *
        `;
        
        const updateResult = await pool.query(updateQuery, [id]);
        
        // 실제로는 여기서 이메일이나 SMS 전송 로직이 들어갈 수 있습니다
        // 현재는 상태만 업데이트하고 링크를 제공합니다
        
        const assignmentLink = `${req.protocol}://${req.get('host')}/assignment/${assignment.assignment_token}`;
        
        res.json({
            success: true,
            message: '수배서가 전송되었습니다.',
            assignment_link: assignmentLink,
            data: updateResult.rows[0]
        });
        
    } catch (error) {
        console.error('수배서 전송 오류:', error);
        res.status(500).json({
            success: false,
            message: '수배서 전송 중 오류가 발생했습니다.'
        });
    }
});

// 업체 바우처 파일 다운로드 API
app.get('/api/vouchers/download/:filename', async (req, res) => {
    try {
        const { filename } = req.params;
        const filePath = path.join(__dirname, 'uploads', filename);
        
        console.log('📥 업체 바우처 다운로드 요청:', filename);
        
        // 파일 존재 확인
        if (!fs.existsSync(filePath)) {
            console.error('❌ 파일을 찾을 수 없습니다:', filePath);
            return res.status(404).json({
                success: false,
                message: '파일을 찾을 수 없습니다.'
            });
        }
        
        // 파일 다운로드
        res.download(filePath, filename, (err) => {
            if (err) {
                console.error('❌ 파일 다운로드 오류:', err);
                if (!res.headersSent) {
                    res.status(500).json({
                        success: false,
                        message: '파일 다운로드 중 오류가 발생했습니다.'
                    });
                }
            } else {
                console.log('✅ 파일 다운로드 완료:', filename);
            }
        });
        
    } catch (error) {
        console.error('❌ 다운로드 API 오류:', error);
        res.status(500).json({
            success: false,
            message: '파일 다운로드 중 오류가 발생했습니다: ' + error.message
        });
    }
});

// 바우처 전송 기록 추가 API
app.post('/api/vouchers/send-history', requireAuth, async (req, res) => {
    try {
        const { 
            reservation_id, 
            voucher_token, 
            send_method, 
            recipient, 
            subject, 
            message 
        } = req.body;
        
        console.log('📤 바우처 전송 기록 추가:', {
            reservation_id,
            send_method,
            recipient
        });
        
        // voucher_sends 테이블 존재 확인
        const tableCheck = await pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'voucher_sends'
            );
        `);
        
        if (!tableCheck.rows[0].exists) {
            console.log('⚠️ voucher_sends 테이블이 없습니다.');
            return res.json({
                success: true,
                message: '전송 기록 테이블이 없습니다. (기능 비활성화)',
                id: null
            });
        }
        
        // 전송 기록 저장
        const insertQuery = `
            INSERT INTO voucher_sends (
                reservation_id,
                voucher_token,
                send_method,
                recipient,
                subject,
                message,
                status,
                sent_by,
                sent_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
            RETURNING id, sent_at
        `;
        
        const adminName = req.session.adminName || req.session.adminUsername || '관리자';
        
        const result = await pool.query(insertQuery, [
            reservation_id,
            voucher_token,
            send_method,
            recipient,
            subject || null,
            message || null,
            'sent',
            adminName
        ]);
        
        console.log('✅ 바우처 전송 기록 저장 완료:', result.rows[0]);
        
        res.json({
            success: true,
            message: '전송 기록이 저장되었습니다.',
            id: result.rows[0].id,
            sent_at: result.rows[0].sent_at
        });
        
    } catch (error) {
        console.error('❌ 바우처 전송 기록 추가 오류:', error);
        res.status(500).json({
            success: false,
            message: '전송 기록 추가 중 오류가 발생했습니다: ' + error.message
        });
    }
});

// 바우처 전송 기록 조회 API
app.get('/api/vouchers/send-history/:reservationId', requireAuth, async (req, res) => {
    try {
        const { reservationId } = req.params;
        
        console.log('📋 바우처 전송 기록 조회:', reservationId);
        
        // voucher_sends 테이블 존재 확인
        const tableCheck = await pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'voucher_sends'
            );
        `);
        
        if (!tableCheck.rows[0].exists) {
            console.log('⚠️ voucher_sends 테이블이 없습니다. 빈 배열 반환');
            return res.json({
                success: true,
                history: [],
                stats: {
                    total_sends: 0,
                    total_views: 0,
                    view_rate: 0
                }
            });
        }
        
        // viewed_at, notes 컬럼 존재 확인
        const columnCheck = await pool.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'voucher_sends' 
            AND column_name IN ('viewed_at', 'notes')
        `);
        
        const hasViewedAt = columnCheck.rows.some(row => row.column_name === 'viewed_at');
        const hasNotes = columnCheck.rows.some(row => row.column_name === 'notes');
        
        // 전송 기록 조회 (viewed_at, notes 컬럼 조건부 포함)
        const historyQuery = `
            SELECT 
                id,
                send_method,
                recipient,
                subject,
                status,
                sent_at,
                ${hasViewedAt ? 'viewed_at' : 'NULL as viewed_at'},
                sent_by,
                error_message,
                ${hasNotes ? 'notes' : 'NULL as notes'}
            FROM voucher_sends
            WHERE reservation_id = $1
            ORDER BY sent_at DESC
        `;
        
        const historyResult = await pool.query(historyQuery, [reservationId]);
        
        // 통계 계산
        const stats = {
            total_sends: historyResult.rows.length,
            total_views: historyResult.rows.filter(r => r.viewed_at).length,
            view_rate: historyResult.rows.length > 0 
                ? Math.round((historyResult.rows.filter(r => r.viewed_at).length / historyResult.rows.length) * 100)
                : 0
        };
        
        res.json({
            success: true,
            history: historyResult.rows,
            stats
        });
        
    } catch (error) {
        console.error('❌ 바우처 전송 기록 조회 오류:', error);
        res.status(500).json({
            success: false,
            message: '전송 기록 조회 중 오류가 발생했습니다: ' + error.message
        });
    }
});

// 바우처 열람 통계 API
app.get('/api/vouchers/view-stats/:reservationId', requireAuth, async (req, res) => {
    try {
        const { reservationId } = req.params;
        
        console.log('📊 바우처 열람 통계 조회:', reservationId);
        
        // voucher_views 테이블 존재 확인
        const tableCheck = await pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'voucher_views'
            );
        `);
        
        if (!tableCheck.rows[0].exists) {
            console.log('⚠️ voucher_views 테이블이 없습니다. 빈 결과 반환');
            return res.json({
                success: true,
                views: [],
                total_views: 0,
                first_viewed: null,
                last_viewed: null
            });
        }
        
        // 바우처 토큰 가져오기
        const tokenResult = await pool.query(`
            SELECT voucher_token FROM reservations WHERE id = $1
        `, [reservationId]);
        
        if (tokenResult.rows.length === 0 || !tokenResult.rows[0].voucher_token) {
            return res.json({
                success: true,
                views: [],
                total_views: 0,
                first_viewed: null,
                last_viewed: null
            });
        }
        
        const voucherToken = tokenResult.rows[0].voucher_token;
        
        // browser, os 컬럼 존재 여부 확인
        const columnsCheck = await pool.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'voucher_views' 
            AND column_name IN ('browser', 'os')
        `);
        
        const hasBrowser = columnsCheck.rows.some(r => r.column_name === 'browser');
        const hasOs = columnsCheck.rows.some(r => r.column_name === 'os');
        
        // 동적 쿼리 생성
        const selectFields = [
            'viewed_at',
            'ip_address',
            'user_agent',
            'device_type',
            hasBrowser ? 'browser' : 'NULL as browser',
            hasOs ? 'os' : 'NULL as os'
        ].join(', ');
        
        // 열람 기록 조회
        const viewsResult = await pool.query(`
            SELECT ${selectFields}
            FROM voucher_views
            WHERE voucher_token = $1
            ORDER BY viewed_at DESC
        `, [voucherToken]);
        
        const views = viewsResult.rows;
        const total_views = views.length;
        const first_viewed = total_views > 0 ? views[views.length - 1].viewed_at : null;
        const last_viewed = total_views > 0 ? views[0].viewed_at : null;
        
        res.json({
            success: true,
            views,
            total_views,
            first_viewed,
            last_viewed
        });
        
    } catch (error) {
        console.error('❌ 바우처 열람 통계 조회 오류:', error);
        res.status(500).json({
            success: false,
            message: '열람 통계 조회 중 오류가 발생했습니다: ' + error.message
        });
    }
});

// 수배서 열람 통계 API
app.get('/api/assignments/view-stats/:reservationId', requireAuth, async (req, res) => {
    try {
        const { reservationId } = req.params;
        
        console.log('📊 수배서 열람 통계 조회:', reservationId);
        
        // assignment_views 테이블 존재 확인
        const tableCheck = await pool.query(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' 
                AND table_name = 'assignment_views'
            );
        `);
        
        if (!tableCheck.rows[0].exists) {
            console.log('⚠️ assignment_views 테이블이 없습니다. 빈 결과 반환');
            return res.json({
                success: true,
                views: [],
                total_views: 0,
                first_viewed: null,
                last_viewed: null
            });
        }
        
        // assignment_token 가져오기 (assignments 테이블에서)
        const tokenResult = await pool.query(`
            SELECT a.assignment_token 
            FROM assignments a
            WHERE a.reservation_id = $1
        `, [reservationId]);
        
        if (tokenResult.rows.length === 0 || !tokenResult.rows[0].assignment_token) {
            return res.json({
                success: true,
                views: [],
                total_views: 0,
                first_viewed: null,
                last_viewed: null
            });
        }
        
        const assignmentToken = tokenResult.rows[0].assignment_token;
        console.log(`📊 예약 ID ${reservationId}의 assignment_token: ${assignmentToken ? assignmentToken.substring(0, 20) + '...' : 'NULL'}`);
        
        // browser, os 컬럼 존재 여부 확인
        const columnsCheck = await pool.query(`
            SELECT column_name 
            FROM information_schema.columns 
            WHERE table_name = 'assignment_views' 
            AND column_name IN ('browser', 'os')
        `);
        
        const hasBrowser = columnsCheck.rows.some(r => r.column_name === 'browser');
        const hasOs = columnsCheck.rows.some(r => r.column_name === 'os');
        
        // 동적 쿼리 생성
        const selectFields = [
            'viewed_at',
            'ip_address',
            'user_agent',
            'device_type',
            hasBrowser ? 'browser' : 'NULL as browser',
            hasOs ? 'os' : 'NULL as os'
        ].join(', ');
        
        // 열람 기록 조회
        const viewsResult = await pool.query(`
            SELECT ${selectFields}
            FROM assignment_views
            WHERE assignment_token = $1
            ORDER BY viewed_at DESC
        `, [assignmentToken]);
        
        const views = viewsResult.rows;
        const total_views = views.length;
        const first_viewed = total_views > 0 ? views[views.length - 1].viewed_at : null;
        const last_viewed = total_views > 0 ? views[0].viewed_at : null;
        
        console.log(`📊 예약 ID ${reservationId}의 열람 통계: 총 ${total_views}개`);
        if (views.length > 0) {
            console.log(`   - 첫 열람: ${first_viewed}`);
            console.log(`   - 최근 열람: ${last_viewed}`);
            console.log(`   - 샘플 IP: ${views[0].ip_address}`);
        }
        
        res.json({
            success: true,
            views,
            total_views,
            first_viewed,
            last_viewed
        });
        
    } catch (error) {
        console.error('❌ 수배서 열람 통계 조회 오류:', error);
        res.status(500).json({
            success: false,
            message: '열람 통계 조회 중 오류가 발생했습니다: ' + error.message
        });
    }
});

// 🔍 진단 API: assignment_views 데이터 분석
app.get('/api/debug/assignment-views', requireAuth, async (req, res) => {
    try {
        // 1. assignment_views 테이블의 token 분포
        const tokenDistribution = await pool.query(`
            SELECT 
                COALESCE(LEFT(assignment_token, 30), 'NULL') as token_prefix,
                COUNT(*) as view_count
            FROM assignment_views
            GROUP BY assignment_token
            ORDER BY view_count DESC
            LIMIT 20
        `);
        
        // 2. NULL token 개수
        const nullCount = await pool.query(`
            SELECT COUNT(*) as count FROM assignment_views WHERE assignment_token IS NULL
        `);
        
        // 3. assignments 테이블의 최근 토큰들
        const recentAssignments = await pool.query(`
            SELECT 
                id,
                reservation_id,
                LEFT(assignment_token, 30) as token_prefix,
                vendor_name,
                created_at
            FROM assignments
            ORDER BY created_at DESC
            LIMIT 10
        `);
        
        // 4. 특정 예약들의 토큰과 뷰 개수
        const sampleData = await pool.query(`
            SELECT 
                a.reservation_id,
                LEFT(a.assignment_token, 30) as token_prefix,
                a.vendor_name,
                COUNT(av.id) as view_count
            FROM assignments a
            LEFT JOIN assignment_views av ON av.assignment_token = a.assignment_token
            GROUP BY a.reservation_id, a.assignment_token, a.vendor_name
            ORDER BY a.reservation_id DESC
            LIMIT 10
        `);
        
        res.json({
            success: true,
            analysis: {
                token_distribution: tokenDistribution.rows,
                null_token_count: nullCount.rows[0].count,
                recent_assignments: recentAssignments.rows,
                sample_data: sampleData.rows
            }
        });
        
    } catch (error) {
        console.error('❌ 진단 API 오류:', error);
        res.status(500).json({
            success: false,
            message: error.message
        });
    }
});

// 바우처 페이지 라우트
app.get('/voucher/:token', async (req, res) => {
    const startTime = Date.now();
    try {
        const { token } = req.params;
        
        console.log(`🎫 바우처 페이지 요청: ${token.substring(0, 20)}...`);
        console.log(`📊 요청 시간: ${new Date().toISOString()}`);
        
        // 바우처 정보 조회 (reservations.voucher_token 기준)
        const voucherQuery = `
            SELECT 
                r.*,
                r.created_by,
                r.created_by_email,
                a.confirmation_number,
                a.vendor_name,
                a.vendor_contact,
                a.cost_price,
                a.cost_currency,
                a.response_at,
                a.created_at as voucher_created_at,
                a.sent_at as voucher_sent_at,
                a.viewed_at as voucher_viewed_at,
                v.email as vendor_email,
                v.phone as vendor_phone,
                v.contact_person as vendor_contact_person,
                v.notification_email as vendor_notification_email
            FROM reservations r
            LEFT JOIN assignments a ON r.id = a.reservation_id
            LEFT JOIN vendors v ON a.vendor_id = v.id
            WHERE r.voucher_token = $1
        `;
        
        console.log(`🔍 바우처 쿼리 실행: ${token}`);
        const result = await pool.query(voucherQuery, [token]);
        console.log(`📊 쿼리 결과: ${result.rows.length}개 행 반환`);
        
        if (result.rows.length === 0) {
            console.log(`❌ 바우처 토큰 ${token}을 찾을 수 없음`);
            
            // 디버깅: 최근 바우처 토큰들 조회
            try {
                const debugQuery = `
                    SELECT voucher_token, id as reservation_id, created_at 
                    FROM reservations 
                    WHERE voucher_token IS NOT NULL 
                    ORDER BY created_at DESC 
                    LIMIT 5
                `;
                const debugResult = await pool.query(debugQuery);
                console.log('🔍 최근 바우처 토큰들 (reservations):', debugResult.rows);
            } catch (debugError) {
                console.error('디버그 쿼리 오류:', debugError);
            }
            
            return res.status(404).render('error', {
                title: '바우처를 찾을 수 없습니다',
                message: `바우처 토큰 "${token}"을 찾을 수 없습니다. 링크를 다시 확인해주세요.`,
                error: { status: 404 }
            });
        }
        
        const data = result.rows[0];
        
        console.log(`📋 예약 정보:`, {
            id: data.id,
            reservation_number: data.reservation_number,
            korean_name: data.korean_name,
            payment_status: data.payment_status
        });
        
        // 예약 취소 여부 확인
        if (data.payment_status === 'cancelled') {
            console.log(`❌ 취소된 예약의 바우처 접근 시도: ${data.id} (${data.reservation_number})`);
            return res.status(410).render('error', {
                title: '바우처가 무효화되었습니다',
                message: `이 예약은 취소되었습니다.<br><br>
                    <strong>예약번호:</strong> ${data.reservation_number}<br>
                    <strong>예약자명:</strong> ${data.korean_name}<br><br>
                    문의사항이 있으시면 고객센터로 연락해주세요.`,
                error: { status: 410 }
            });
        }
        
        console.log(`✅ 정상 예약 - 바우처 페이지 렌더링 진행`);
        
        // 바우처 조회 기록 남기기 (비동기 - 페이지 로딩 블로킹 방지)
        // await 없이 실행만 시키고 결과를 기다리지 않음
        (async () => {
            try {
                // User-Agent 파싱
                const userAgent = req.headers['user-agent'] || '';
                const deviceType = /mobile/i.test(userAgent) ? 'mobile' : 
                                 /tablet/i.test(userAgent) ? 'tablet' : 'desktop';
                const browser = userAgent.includes('Chrome') ? 'Chrome' :
                              userAgent.includes('Firefox') ? 'Firefox' :
                              userAgent.includes('Safari') ? 'Safari' : 'Other';
                const os = userAgent.includes('Windows') ? 'Windows' :
                         userAgent.includes('Mac') ? 'macOS' :
                         userAgent.includes('Android') ? 'Android' :
                         userAgent.includes('iOS') ? 'iOS' : 'Other';
                
                // IP 주소 가져오기
                const ipAddress = req.headers['x-forwarded-for']?.split(',')[0].trim() || 
                                req.headers['x-real-ip'] || 
                                req.connection.remoteAddress || 
                                req.socket.remoteAddress;
                
                // voucher_views 테이블 존재 확인 후 기록
                const tableExists = await pool.query(`
                    SELECT EXISTS (
                        SELECT FROM information_schema.tables 
                        WHERE table_schema = 'public' 
                        AND table_name = 'voucher_views'
                    );
                `);
                
                if (tableExists.rows[0].exists) {
                    // browser, os 컬럼 존재 여부 확인
                    const columnsCheck = await pool.query(`
                        SELECT column_name 
                        FROM information_schema.columns 
                        WHERE table_name = 'voucher_views' 
                        AND column_name IN ('browser', 'os')
                    `);
                    
                    const hasBrowser = columnsCheck.rows.some(r => r.column_name === 'browser');
                    const hasOs = columnsCheck.rows.some(r => r.column_name === 'os');
                    
                    // 동적 INSERT 쿼리 생성
                    const columns = ['voucher_token', 'reservation_id', 'ip_address', 'user_agent', 'device_type'];
                    const values = [token, data.id, ipAddress, userAgent, deviceType];
                    let paramIndex = 6;
                    
                    if (hasBrowser) {
                        columns.push('browser');
                        values.push(browser);
                        paramIndex++;
                    }
                    if (hasOs) {
                        columns.push('os');
                        values.push(os);
                        paramIndex++;
                    }
                    
                    const placeholders = values.map((_, i) => `$${i + 1}`).join(', ');
                    
                    await pool.query(`
                        INSERT INTO voucher_views (${columns.join(', ')})
                        VALUES (${placeholders})
                    `, values);
                    
                    console.log('✅ 바우처 열람 기록 저장:', {
                        token: token.substring(0, 10) + '...',
                        device: deviceType,
                        browser: hasBrowser ? browser : 'N/A',
                        os: hasOs ? os : 'N/A'
                    });
                }
                
                // assignments 테이블 viewed_at 업데이트
                await pool.query(
                    'UPDATE assignments SET viewed_at = NOW() WHERE reservation_id = $1 AND viewed_at IS NULL',
                    [data.id]
                );
            } catch (viewError) {
                console.error('❌ 바우처 조회 기록 오류:', viewError);
            }
        })();
        
        console.log(`📄 템플릿 렌더링 시작 - 예약ID: ${data.id}, 고객: ${data.korean_name}`);
        
        // RAG 상품 가이드 자동 로드
        let usageInstructions = null;
        if (data.product_name) {
            try {
                const { generateVoucherInstructions } = require('./utils/rag-voucher');
                usageInstructions = await generateVoucherInstructions(
                    data.product_name,
                    {
                        people_adult: data.people_adult,
                        people_child: data.people_child,
                        usage_date: data.usage_date,
                        usage_time: data.usage_time,
                        package_type: data.package_type
                    }
                );
                console.log(`✅ RAG 가이드 로드 성공: ${data.product_name}`);
            } catch (ragError) {
                console.error('⚠️ RAG 가이드 로드 실패:', ragError.message);
            }
        }
        
        // voucher-official.ejs 렌더링 (새로운 공식 문서 스타일)
        res.render('voucher-official', {
            reservation: data,  // 전체 data 객체 전달
            confirmation_number: data.confirmation_number || null,
            qr_code_data: data.qr_code_data || null,
            qr_image_path: data.qr_image_path || null,
            vendor_voucher_path: data.vendor_voucher_path || null,
            vendor_name: data.vendor_name || null,
            vendor_contact: data.vendor_contact || null,
            usage_instructions: usageInstructions,  // RAG 자동 로드된 이용방법
            voucher_token: token,
            formatDate: (date) => {
                if (!date) return '-';
                return new Date(date).toLocaleDateString('ko-KR', {
                    year: 'numeric',
                    month: 'long',
                    day: 'numeric',
                    weekday: 'short'
                });
            }
        });
        
        const elapsed = Date.now() - startTime;
        console.log(`✅ 바우처 페이지 렌더링 완료 (${elapsed}ms)`);
        
    } catch (err) {
        const elapsed = Date.now() - startTime;
        console.error(`❌ 바우처 페이지 오류 (${elapsed}ms):`, err);
        console.error('스택 트레이스:', err.stack);
        
        if (!res.headersSent) {
            res.status(500).render('error', {
                title: '서버 오류',
                message: '바우처를 불러오는 중 오류가 발생했습니다: ' + err.message,
                error: { status: 500, stack: err.stack }
            });
        }
    }
});

// 수배 상태 업데이트 API
app.patch('/api/assignments/:id/status', requireAuth, async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        
        const validStatuses = ['requested', 'assigned', 'in_progress', 'completed', 'cancelled'];
        if (!validStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                message: '유효하지 않은 상태입니다.'
            });
        }
        
        const updateQuery = `
            UPDATE assignments 
            SET status = $1, 
                updated_at = NOW(),
                ${status === 'completed' ? 'completed_at = NOW(),' : ''}
                ${status === 'assigned' ? 'assigned_at = NOW(), assigned_by = $3,' : ''}
            WHERE id = $2
            RETURNING *
        `;
        
        const params = [status, id];
        if (status === 'assigned') {
            params.push(req.session.adminUsername || 'admin');
        }
        
        const result = await pool.query(updateQuery, params);
        
        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: '수배를 찾을 수 없습니다.'
            });
        }
        
        res.json({
            success: true,
            message: '수배 상태가 업데이트되었습니다.',
            data: result.rows[0]
        });
        
    } catch (error) {
        console.error('수배 상태 업데이트 오류:', error);
        res.status(500).json({
            success: false,
            message: '수배 상태 업데이트 중 오류가 발생했습니다.'
        });
    }
});

// ==================== 서버 시작 ====================

async function startServer() {
    try {
        // 픽업 테이블 마이그레이션 (컬럼 추가)
        console.log('🔧 픽업 테이블 마이그레이션 확인 중...');
        try {
            const columns = ['record_type', 'display_date', 'display_time', 'departure_date', 'departure_time', 
                           'departure_airport', 'arrival_date', 'arrival_time', 'arrival_airport', 'linked_id', 'flight_number'];
            
            for (const col of columns) {
                await pool.query(`
                    DO $$ 
                    BEGIN 
                        IF NOT EXISTS (
                            SELECT FROM information_schema.columns 
                            WHERE table_name = 'airport_pickups' AND column_name = '${col}'
                        ) THEN
                            ALTER TABLE airport_pickups ADD COLUMN ${col} ${
                                col === 'record_type' ? "VARCHAR(20) DEFAULT 'arrival'" :
                                col === 'display_date' || col === 'departure_date' || col === 'arrival_date' ? 'DATE' :
                                col === 'display_time' || col === 'departure_time' || col === 'arrival_time' ? 'TIME' :
                                col === 'linked_id' ? 'INTEGER' :
                                'VARCHAR(20)'
                            };
                        END IF;
                    END $$;
                `);
            }
            console.log('✅ 픽업 테이블 마이그레이션 완료');
        } catch (migrateErr) {
            console.warn('⚠️  마이그레이션 경고:', migrateErr.message);
        }
        
        // 서버 먼저 시작
        const httpServer = app.listen(PORT, () => {
            console.log('✅ 서버 초기화 및 시작 완료');
            console.log(`서버가 포트 ${PORT}에서 실행 중입니다.`);
            console.log(`관리자 페이지: http://localhost:${PORT}/admin`);
            console.log(`카드 페이지: http://localhost:${PORT}/card`);
            
            // SMTP 설정 확인
            console.log('\n📧 SMTP 이메일 설정 상태:');
            console.log('  - SMTP_HOST:', process.env.SMTP_HOST || '❌ 설정 안됨');
            console.log('  - SMTP_PORT:', process.env.SMTP_PORT || '587 (기본값)');
            console.log('  - SMTP_USER:', process.env.SMTP_USER || '❌ 설정 안됨');
            console.log('  - SMTP_PASS:', process.env.SMTP_PASS ? '✅ 설정됨' : '❌ 설정 안됨');
            console.log('  - SMTP_FROM:', process.env.SMTP_FROM || 'noreply@guamsavecard.com (기본값)');
            
            if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS) {
                console.log('\n⚠️  경고: SMTP 설정이 완료되지 않아 이메일 전송이 불가능합니다!');
                console.log('   Railway 환경변수에 다음을 설정하세요:');
                console.log('   - SMTP_HOST=smtp.gmail.com');
                console.log('   - SMTP_PORT=587');
                console.log('   - SMTP_USER=your-email@gmail.com');
                console.log('   - SMTP_PASS=your-app-password');
                console.log('   - SMTP_FROM=noreply@guamsavecard.com\n');
            } else {
                console.log('✅ SMTP 설정 완료! 이메일 전송 가능합니다.\n');
            }
            
            // 이메일 마스킹 스케줄러 시작 (매일 새벽 3시 실행)
            console.log('⏰ 이메일 마스킹 스케줄러 시작...');
            cron.schedule('0 3 * * *', async () => {
                console.log('\n🕐 [스케줄] 이메일 마스킹 작업 시작:', new Date().toLocaleString('ko-KR'));
                const result = await maskExpiredEmails();
                console.log('🕐 [스케줄] 이메일 마스킹 작업 완료:', result.message);
            }, {
                timezone: "Asia/Seoul"
            });
            console.log('✅ 스케줄러 등록 완료: 매일 새벽 3시에 2개월 지난 이메일 마스킹 실행\n');
            
            // 서버 시작 시 즉시 한 번 실행
            (async () => {
                console.log('🔄 서버 시작 시 이메일 마스킹 체크 실행...');
                const result = await maskExpiredEmails();
                console.log(`✅ 초기 마스킹 완료: ${result.message}\n`);
            })();
        });
        
        // 서버 시작 후 데이터베이스 초기화 (비동기)
        setTimeout(async () => {
            try {
                await initializeDatabase();
                console.log('✅ 데이터베이스 초기화 완료');
                
                // 정산관리 마이그레이션 실행
                await runSettlementsMigration();
                console.log('✅ 정산관리 마이그레이션 완료');
                
                // 호텔 ERP 테이블 생성
                try {
                    await createHotelTables();
                    console.log('✅ 호텔 ERP 테이블 생성 완료');
                } catch (hotelErr) {
                    console.warn('⚠️ 호텔 테이블 생성 경고:', hotelErr.message);
                }
                
                // 공항픽업 마감날짜 테이블 생성
                try {
                    await pool.query(`
                        CREATE TABLE IF NOT EXISTS pickup_closed_dates (
                            id SERIAL PRIMARY KEY,
                            closed_date DATE NOT NULL UNIQUE,
                            reason TEXT,
                            created_by VARCHAR(255),
                            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                        )
                    `);
                    
                    await pool.query(`
                        CREATE INDEX IF NOT EXISTS idx_closed_date 
                        ON pickup_closed_dates(closed_date)
                    `);
                    
                    console.log('✅ 공항픽업 마감날짜 테이블 생성 완료');
                } catch (closedErr) {
                    console.warn('⚠️ 마감날짜 테이블 생성 경고:', closedErr.message);
                }
            } catch (error) {
                console.error('⚠️ 데이터베이스 초기화 실패 (서버는 계속 실행):', error.message);
            }
        }, 2000);
        
        // 정산관리 마이그레이션 함수
        async function runSettlementsMigration() {
            try {
                console.log('🔧 정산관리 테이블 마이그레이션 시작...');
                
                // settlements 테이블 확장 컬럼들
                const columnsToAdd = [
                    { name: 'platform_id', type: 'INTEGER' },
                    { name: 'supplier_id', type: 'INTEGER' },
                    { name: 'usage_date', type: 'DATE' },
                    { name: 'gross_amount_krw', type: 'DECIMAL(15,2) DEFAULT 0.00' },
                    { name: 'commission_percent', type: 'DECIMAL(5,2)' },
                    { name: 'commission_flat_krw', type: 'DECIMAL(15,2)' },
                    { name: 'commission_amount_krw', type: 'DECIMAL(15,2) DEFAULT 0.00' },
                    { name: 'net_from_platform_krw', type: 'DECIMAL(15,2) DEFAULT 0.00' },
                    { name: 'supplier_cost_currency', type: 'VARCHAR(3) DEFAULT \'USD\'' },
                    { name: 'supplier_cost_amount', type: 'DECIMAL(15,2) DEFAULT 0.00' },
                    { name: 'fx_rate', type: 'DECIMAL(10,4)' },
                    { name: 'fx_rate_date', type: 'DATE' },
                    { name: 'supplier_cost_krw', type: 'DECIMAL(15,2) DEFAULT 0.00' },
                    { name: 'margin_krw', type: 'DECIMAL(15,2) DEFAULT 0.00' },
                    { name: 'rag_document_ids', type: 'TEXT[]' },
                    { name: 'rag_evidence', type: 'JSONB' },
                    { name: 'payment_received', type: 'BOOLEAN DEFAULT FALSE' },
                    { name: 'payment_received_at', type: 'TIMESTAMP' },
                    { name: 'payment_received_amount', type: 'DECIMAL(15,2)' },
                    { name: 'payment_received_note', type: 'TEXT' },
                    { name: 'payment_sent', type: 'BOOLEAN DEFAULT FALSE' },
                    { name: 'payment_sent_at', type: 'TIMESTAMP' },
                    { name: 'payment_sent_amount', type: 'DECIMAL(15,2)' },
                    { name: 'payment_sent_currency', type: 'VARCHAR(3)' },
                    { name: 'payment_sent_note', type: 'TEXT' },
                    { name: 'auto_migrated', type: 'BOOLEAN DEFAULT FALSE' },
                    { name: 'migrated_at', type: 'TIMESTAMP' }
                ];
                
                for (const col of columnsToAdd) {
                    try {
                        await pool.query(`
                            ALTER TABLE settlements 
                            ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}
                        `);
                        console.log(`  ✅ settlements.${col.name} 추가 완료`);
                    } catch (error) {
                        if (!error.message.includes('already exists')) {
                            console.error(`  ⚠️ settlements.${col.name} 추가 실패:`, error.message);
                        }
                    }
                }
                
                // exchange_rates 테이블 생성
                await pool.query(`
                    CREATE TABLE IF NOT EXISTS exchange_rates (
                        id SERIAL PRIMARY KEY,
                        currency_code VARCHAR(3) NOT NULL,
                        rate_date DATE NOT NULL,
                        rate_time TIME DEFAULT '16:00:00',
                        base_currency VARCHAR(3) DEFAULT 'KRW',
                        rate DECIMAL(10,4) NOT NULL,
                        source VARCHAR(50) DEFAULT 'manual',
                        created_at TIMESTAMP DEFAULT NOW(),
                        UNIQUE(currency_code, rate_date, rate_time)
                    )
                `);
                console.log('  ✅ exchange_rates 테이블 생성 완료');
                
                await pool.query(`
                    CREATE INDEX IF NOT EXISTS idx_exchange_rates_currency_date 
                    ON exchange_rates(currency_code, rate_date DESC)
                `);
                
                // rag_documents 테이블 생성
                await pool.query(`
                    CREATE TABLE IF NOT EXISTS rag_documents (
                        id SERIAL PRIMARY KEY,
                        document_name VARCHAR(255) NOT NULL,
                        document_type VARCHAR(50) NOT NULL,
                        platform_id INTEGER,
                        supplier_id INTEGER,
                        effective_from DATE,
                        effective_to DATE,
                        file_path TEXT,
                        content_text TEXT,
                        vector_embedding TEXT,
                        metadata JSONB,
                        uploaded_by VARCHAR(100),
                        uploaded_at TIMESTAMP DEFAULT NOW(),
                        updated_at TIMESTAMP DEFAULT NOW()
                    )
                `);
                console.log('  ✅ rag_documents 테이블 생성 완료');
                
                await pool.query(`
                    CREATE INDEX IF NOT EXISTS idx_rag_documents_type 
                    ON rag_documents(document_type)
                `);
                await pool.query(`
                    CREATE INDEX IF NOT EXISTS idx_rag_documents_platform 
                    ON rag_documents(platform_id)
                `);
                await pool.query(`
                    CREATE INDEX IF NOT EXISTS idx_rag_documents_supplier 
                    ON rag_documents(supplier_id)
                `);
                
                // settlement_batch_logs 테이블 생성
                await pool.query(`
                    CREATE TABLE IF NOT EXISTS settlement_batch_logs (
                        id SERIAL PRIMARY KEY,
                        batch_date DATE NOT NULL,
                        batch_type VARCHAR(50) NOT NULL,
                        total_count INTEGER DEFAULT 0,
                        success_count INTEGER DEFAULT 0,
                        fail_count INTEGER DEFAULT 0,
                        error_details JSONB,
                        executed_by VARCHAR(100),
                        executed_at TIMESTAMP DEFAULT NOW()
                    )
                `);
                console.log('  ✅ settlement_batch_logs 테이블 생성 완료');
                
                await pool.query(`
                    CREATE INDEX IF NOT EXISTS idx_settlement_batch_logs_date 
                    ON settlement_batch_logs(batch_date DESC)
                `);
                
                console.log('🎉 정산관리 마이그레이션 완료!');
            } catch (error) {
                console.error('❌ 정산관리 마이그레이션 오류:', error);
                throw error;
            }
        }
        
        // ==================== 자동 정산 이관 배치 작업 ====================
        
        // 매일 자정에 실행되는 자동 이관 배치 (고객이용일이 지난 예약 자동 이관)
        async function autoMigrateToSettlement() {
            const client = await pool.connect();
            try {
                console.log('🤖 [자동 정산 이관] 배치 작업 시작:', new Date().toISOString());
                
                await client.query('BEGIN');
                
                // 이관 대상: 고객이용일(usage_date)이 오늘 이전이고, 
                // payment_status가 'voucher_sent'이며, 취소가 아닌 예약
                const targetQuery = `
                    SELECT 
                        r.id,
                        r.reservation_number,
                        r.usage_date,
                        r.payment_status,
                        r.platform_name,
                        r.product_name
                    FROM reservations r
                    WHERE r.usage_date < CURRENT_DATE
                    AND r.payment_status = 'voucher_sent'
                    AND r.payment_status NOT IN ('cancelled', 'refunded')
                    AND NOT EXISTS (
                        SELECT 1 FROM settlements s 
                        WHERE s.reservation_id = r.id
                    )
                    ORDER BY r.usage_date DESC
                `;
                
                const targets = await client.query(targetQuery);
                console.log(`📊 이관 대상 예약: ${targets.rows.length}건`);
                
                let successCount = 0;
                let failCount = 0;
                const errors = [];
                
                for (const reservation of targets.rows) {
                    try {
                        // settlements 테이블에 삽입
                        await client.query(`
                            INSERT INTO settlements (
                                reservation_id,
                                settlement_period,
                                usage_date,
                                status,
                                auto_migrated,
                                migrated_at,
                                created_at
                            ) VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
                        `, [
                            reservation.id,
                            reservation.usage_date.toISOString().substring(0, 7), // YYYY-MM
                            reservation.usage_date,
                            'pending',
                            true
                        ]);
                        
                        // 예약 상태 업데이트 (settlement_pending)
                        await client.query(`
                            UPDATE reservations 
                            SET payment_status = 'settlement_pending',
                                updated_at = NOW()
                            WHERE id = $1
                        `, [reservation.id]);
                        
                        successCount++;
                        console.log(`  ✅ ${reservation.reservation_number} (이용일: ${reservation.usage_date})`);
                        
                    } catch (error) {
                        failCount++;
                        errors.push({
                            reservation_id: reservation.id,
                            reservation_number: reservation.reservation_number,
                            error: error.message
                        });
                        console.error(`  ❌ ${reservation.reservation_number} 이관 실패:`, error.message);
                    }
                }
                
                // 배치 로그 기록
                await client.query(`
                    INSERT INTO settlement_batch_logs (
                        batch_date,
                        batch_type,
                        total_count,
                        success_count,
                        fail_count,
                        error_details,
                        executed_by,
                        executed_at
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
                `, [
                    new Date(),
                    'auto_migration',
                    targets.rows.length,
                    successCount,
                    failCount,
                    JSON.stringify(errors),
                    'system'
                ]);
                
                await client.query('COMMIT');
                
                console.log(`🎉 [자동 정산 이관] 완료 - 성공: ${successCount}, 실패: ${failCount}`);
                
                return {
                    success: true,
                    total: targets.rows.length,
                    successCount,
                    failCount,
                    errors
                };
                
            } catch (error) {
                await client.query('ROLLBACK');
                console.error('❌ [자동 정산 이관] 오류:', error);
                return {
                    success: false,
                    error: error.message
                };
            } finally {
                client.release();
            }
        }
        
        // 매일 자정 1시에 자동 실행 (node-cron 사용 시)
        // const cron = require('node-cron');
        // cron.schedule('0 1 * * *', autoMigrateToSettlement);
        
        // 수동 실행 API (테스트용)
        app.post('/api/settlements/auto-migrate', requireAuth, async (req, res) => {
            try {
                console.log('🔧 수동 정산 이관 실행');
                const result = await autoMigrateToSettlement();
                res.json(result);
            } catch (error) {
                console.error('수동 정산 이관 오류:', error);
                res.status(500).json({
                    success: false,
                    message: '자동 이관 실행 중 오류가 발생했습니다',
                    error: error.message
                });
            }
        });

        // ==================== 정산관리 API ====================

        // 정산관리 페이지 라우트
        app.get('/admin/settlements', requireAuth, (req, res) => {
            try {
                console.log('정산관리 페이지 렌더링 시작');
                res.render('admin/settlements', { 
                    title: '정산관리',
                    currentPage: 'settlements',
                    adminUsername: req.session.adminUsername || 'Admin'
                });
                console.log('정산관리 페이지 렌더링 완료');
            } catch (error) {
                console.error('정산관리 페이지 렌더링 오류:', error);
                res.status(500).send(`
                    <h1>정산관리 페이지 오류</h1>
                    <p>페이지를 불러오는 중 오류가 발생했습니다.</p>
                    <p>오류: ${error.message}</p>
                    <a href="/admin">관리자 대시보드로 돌아가기</a>
                `);
            }
        });

        // 요금 RAG 관리 페이지 라우트
        app.get('/admin/pricing', requireAuth, (req, res) => {
            try {
                console.log('요금 RAG 관리 페이지 렌더링 시작');
                res.render('admin/pricing', { 
                    title: '요금 RAG 관리',
                    currentPage: 'pricing',
                    adminUsername: req.session.adminUsername || 'Admin'
                });
                console.log('요금 RAG 관리 페이지 렌더링 완료');
            } catch (error) {
                console.error('요금 RAG 관리 페이지 렌더링 오류:', error);
                res.status(500).send(`
                    <h1>요금 RAG 관리 페이지 오류</h1>
                    <p>페이지를 불러오는 중 오류가 발생했습니다.</p>
                    <p>오류: ${error.message}</p>
                    <a href="/admin">관리자 대시보드로 돌아가기</a>
                `);
            }
        });

        // 정산 통계 API
        app.get('/api/settlements/stats', requireAuth, async (req, res) => {
            try {
                console.log('🔍 정산 통계 API 호출 시작');
                
                // 1. 미입금 거래액 (payment_received_date가 NULL인 항목) - 원화 환산
                const unpaidRevenueQuery = await pool.query(`
                    SELECT 
                        COALESCE(SUM(
                            CASE 
                                WHEN s.sale_currency = 'KRW' THEN s.total_sale
                                WHEN s.sale_currency = 'USD' THEN s.total_sale * s.exchange_rate
                                ELSE s.total_sale * s.exchange_rate
                            END
                        ), 0) as total_unpaid_revenue
                    FROM settlements s
                    WHERE s.payment_received_date IS NULL
                `);
                
                // 1-1. 예약업체별 미입금 거래액 - 원화 환산
                const unpaidByPlatformQuery = await pool.query(`
                    SELECT 
                        r.platform_name,
                        COALESCE(SUM(
                            CASE 
                                WHEN s.sale_currency = 'KRW' THEN s.total_sale
                                WHEN s.sale_currency = 'USD' THEN s.total_sale * s.exchange_rate
                                ELSE s.total_sale * s.exchange_rate
                            END
                        ), 0) as unpaid_amount
                    FROM settlements s
                    INNER JOIN reservations r ON s.reservation_id = r.id
                    WHERE s.payment_received_date IS NULL
                    GROUP BY r.platform_name
                    ORDER BY unpaid_amount DESC
                `);
                
                // 2. 미송금 매입액 (payment_sent_date가 NULL인 항목)
                const unpaidCostQuery = await pool.query(`
                    SELECT 
                        COALESCE(SUM(s.cost_krw), 0) as total_unpaid_cost
                    FROM settlements s
                    WHERE s.payment_sent_date IS NULL
                `);
                
                // 2-1. 수배업체별 미송금 매입액
                const unpaidByVendorQuery = await pool.query(`
                    SELECT 
                        v.vendor_name,
                        COALESCE(SUM(s.cost_krw), 0) as unpaid_amount
                    FROM settlements s
                    INNER JOIN reservations r ON s.reservation_id = r.id
                    LEFT JOIN assignments a ON r.id = a.reservation_id
                    LEFT JOIN vendors v ON a.vendor_id = v.id
                    WHERE s.payment_sent_date IS NULL
                    GROUP BY v.vendor_name
                    ORDER BY unpaid_amount DESC
                `);
                
                // 3. 이번 달 월간 통계 (usage_date 기준)
                const monthlyStatsQuery = await pool.query(`
                    SELECT 
                        COALESCE(SUM(s.net_revenue), 0) as monthly_revenue,
                        COALESCE(SUM(s.cost_krw), 0) as monthly_cost,
                        COALESCE(SUM(s.margin_krw), 0) as monthly_profit
                    FROM settlements s
                    INNER JOIN reservations r ON s.reservation_id = r.id
                    WHERE DATE_TRUNC('month', r.usage_date) = DATE_TRUNC('month', CURRENT_DATE)
                `);
                
                const unpaidRevenue = parseFloat(unpaidRevenueQuery.rows[0].total_unpaid_revenue) || 0;
                const unpaidCost = parseFloat(unpaidCostQuery.rows[0].total_unpaid_cost) || 0;
                const monthlyStats = monthlyStatsQuery.rows[0];
                
                res.json({
                    success: true,
                    data: {
                        // 미입금/미송금
                        unpaidRevenue: unpaidRevenue,
                        unpaidByPlatform: unpaidByPlatformQuery.rows.map(row => ({
                            name: row.platform_name || '미지정',
                            amount: parseFloat(row.unpaid_amount) || 0
                        })),
                        unpaidCost: unpaidCost,
                        unpaidByVendor: unpaidByVendorQuery.rows.map(row => ({
                            name: row.vendor_name || '미지정',
                            amount: parseFloat(row.unpaid_amount) || 0
                        })),
                        
                        // 월간 통계
                        monthlyRevenue: parseFloat(monthlyStats.monthly_revenue) || 0,
                        monthlyCost: parseFloat(monthlyStats.monthly_cost) || 0,
                        monthlyProfit: parseFloat(monthlyStats.monthly_profit) || 0
                    }
                });
                
            } catch (error) {
                console.error('정산 통계 조회 실패:', error);
                res.status(500).json({
                    success: false,
                    message: '정산 통계를 불러올 수 없습니다.'
                });
            }
        });

        // 정산 목록 조회 API
        app.get('/api/settlements', requireAuth, async (req, res) => {
            try {
                console.log('🔍 정산관리 API 호출 시작');
                
                // 먼저 settlement_status 컬럼 존재 여부 확인
                const columnCheck = await pool.query(`
                    SELECT column_name 
                    FROM information_schema.columns 
                    WHERE table_name = 'reservations' AND column_name = 'settlement_status'
                `);
                
                const hasSettlementStatus = columnCheck.rows.length > 0;
                console.log('📋 settlement_status 컬럼 존재:', hasSettlementStatus);
                
                const { page = 1, status = '', month = '', search = '' } = req.query;
                const limit = 20;
                const offset = (page - 1) * limit;
                
                let whereClause = `WHERE r.payment_status = 'voucher_sent'`;
                const queryParams = [];
                let paramIndex = 0;
                
                // 정산 상태 필터 (컬럼이 존재할 때만)
                if (status && hasSettlementStatus) {
                    paramIndex++;
                    if (status === 'pending') {
                        whereClause += ` AND (r.settlement_status IS NULL OR r.settlement_status = 'pending')`;
                    } else {
                        whereClause += ` AND r.settlement_status = $${paramIndex}`;
                        queryParams.push(status);
                    }
                }
                
                // 월별 필터
                if (month) {
                    paramIndex++;
                    whereClause += ` AND DATE_TRUNC('month', r.created_at) = DATE_TRUNC('month', $${paramIndex}::date)`;
                    queryParams.push(month + '-01');
                }
                
                // 검색 필터
                if (search) {
                    paramIndex++;
                    whereClause += ` AND (
                        r.reservation_number ILIKE $${paramIndex} OR 
                        r.product_name ILIKE $${paramIndex} OR 
                        r.korean_name ILIKE $${paramIndex}
                    )`;
                    queryParams.push(`%${search}%`);
                }
                
                // 총 개수 조회
                const countQuery = `
                    SELECT COUNT(*) as total
                    FROM reservations r
                    ${whereClause}
                `;
                
                const countResult = await pool.query(countQuery, queryParams);
                const totalCount = parseInt(countResult.rows[0].total);
                
                // 정산 목록 조회 (인박스와 동일한 실제 컬럼명 사용)
                let listQuery;
                if (hasSettlementStatus) {
                    listQuery = `
                        SELECT 
                            r.*,
                            r.korean_name,
                            r.usage_date as departure_date,
                            COALESCE(r.sale_amount, r.total_amount) as sale_amount,
                            COALESCE(r.cost_amount, 0) as cost_amount,
                            COALESCE(r.profit_amount, COALESCE(r.sale_amount, r.total_amount) - COALESCE(r.cost_amount, 0)) as profit_amount,
                            COALESCE(r.settlement_status, 'pending') as settlement_status
                        FROM reservations r
                        ${whereClause}
                        ORDER BY 
                            CASE WHEN COALESCE(r.settlement_status, 'pending') = 'pending' THEN 0 ELSE 1 END,
                            r.created_at DESC
                        LIMIT $${paramIndex + 1} OFFSET $${paramIndex + 2}
                    `;
                } else {
                    // settlement_status 컬럼이 없을 때 기본 쿼리
                    listQuery = `
                        SELECT 
                            r.*,
                            r.korean_name,
                            r.usage_date as departure_date,
                            r.total_amount as sale_amount,
                            0 as cost_amount,
                            r.total_amount as profit_amount,
                            'pending' as settlement_status,
                            NULL as settlement_notes,
                            NULL as settled_at,
                            NULL as settled_by
                        FROM reservations r
                        ${whereClause}
                        ORDER BY r.created_at DESC
                        LIMIT $${paramIndex + 1} OFFSET $${paramIndex + 2}
                    `;
                }
                
                queryParams.push(limit, offset);
                const listResult = await pool.query(listQuery, queryParams);
                
                res.json({
                    success: true,
                    data: {
                        settlements: listResult.rows,
                        pagination: {
                            currentPage: parseInt(page),
                            totalPages: Math.ceil(totalCount / limit),
                            total: totalCount,
                            limit: limit
                        }
                    }
                });
                
            } catch (error) {
                console.error('정산 목록 조회 실패:', error);
                res.status(500).json({
                    success: false,
                    message: '정산 목록을 불러올 수 없습니다.'
                });
            }
        });

        // 정산 처리 API
        app.post('/api/settlements/:id/process', requireAuth, async (req, res) => {
            try {
                const { id } = req.params;
                const { sale_amount, cost_amount, settlement_notes } = req.body;
                
                if (!sale_amount || !cost_amount) {
                    return res.status(400).json({
                        success: false,
                        message: '매출 금액과 매입 금액을 입력해주세요.'
                    });
                }
                
                const profit_amount = sale_amount - cost_amount;
                
                const updateQuery = `
                    UPDATE reservations 
                    SET 
                        sale_amount = $1,
                        cost_amount = $2,
                        profit_amount = $3,
                        settlement_status = 'settled',
                        settlement_notes = $4,
                        settled_at = NOW(),
                        updated_at = NOW()
                    WHERE id = $5 AND payment_status = 'voucher_sent'
                    RETURNING *
                `;
                
                const result = await pool.query(updateQuery, [
                    sale_amount, cost_amount, profit_amount, settlement_notes, id
                ]);
                
                if (result.rows.length === 0) {
                    return res.status(404).json({
                        success: false,
                        message: '정산 가능한 예약을 찾을 수 없습니다.'
                    });
                }
                
                res.json({
                    success: true,
                    message: '정산이 완료되었습니다.',
                    data: result.rows[0]
                });
                
            } catch (error) {
                console.error('정산 처리 실패:', error);
                res.status(500).json({
                    success: false,
                    message: '정산 처리 중 오류가 발생했습니다.'
                });
            }
        });

        // ==================== 환율 관리 API ====================
        
        // 환율 조회 API (특정 날짜의 환율)
        app.get('/api/exchange-rates/:currency/:date', requireAuth, async (req, res) => {
            try {
                const { currency, date } = req.params;
                
                // 해당 날짜의 환율 조회 (없으면 최근 환율)
                const result = await pool.query(`
                    SELECT * FROM exchange_rates
                    WHERE currency_code = $1
                    AND rate_date <= $2
                    ORDER BY rate_date DESC, rate_time DESC
                    LIMIT 1
                `, [currency, date]);
                
                if (result.rows.length === 0) {
                    return res.json({
                        success: false,
                        message: `${currency} 환율 정보가 없습니다.`
                    });
                }
                
                res.json({
                    success: true,
                    data: result.rows[0]
                });
                
            } catch (error) {
                console.error('환율 조회 실패:', error);
                res.status(500).json({
                    success: false,
                    message: '환율 조회 중 오류가 발생했습니다.'
                });
            }
        });
        
        // 환율 등록/수정 API
        app.post('/api/exchange-rates', requireAuth, async (req, res) => {
            try {
                const { currency_code, rate_date, rate_time, rate, source } = req.body;
                
                if (!currency_code || !rate_date || !rate) {
                    return res.status(400).json({
                        success: false,
                        message: '통화코드, 날짜, 환율은 필수입니다.'
                    });
                }
                
                // UPSERT (중복 시 업데이트)
                const result = await pool.query(`
                    INSERT INTO exchange_rates (currency_code, rate_date, rate_time, rate, source)
                    VALUES ($1, $2, $3, $4, $5)
                    ON CONFLICT (currency_code, rate_date, rate_time)
                    DO UPDATE SET rate = $4, source = $5, created_at = NOW()
                    RETURNING *
                `, [currency_code, rate_date, rate_time || '16:00:00', rate, source || 'manual']);
                
                res.json({
                    success: true,
                    message: '환율이 등록되었습니다.',
                    data: result.rows[0]
                });
                
            } catch (error) {
                console.error('환율 등록 실패:', error);
                res.status(500).json({
                    success: false,
                    message: '환율 등록 중 오류가 발생했습니다.'
                });
            }
        });
        
        // 환율 목록 조회 API
        app.get('/api/exchange-rates', requireAuth, async (req, res) => {
            try {
                const { currency, from_date, to_date } = req.query;
                
                let whereClause = '';
                const queryParams = [];
                
                if (currency) {
                    queryParams.push(currency);
                    whereClause += ` WHERE currency_code = $${queryParams.length}`;
                }
                
                if (from_date) {
                    queryParams.push(from_date);
                    whereClause += whereClause ? ' AND' : ' WHERE';
                    whereClause += ` rate_date >= $${queryParams.length}`;
                }
                
                if (to_date) {
                    queryParams.push(to_date);
                    whereClause += whereClause ? ' AND' : ' WHERE';
                    whereClause += ` rate_date <= $${queryParams.length}`;
                }
                
                const result = await pool.query(`
                    SELECT * FROM exchange_rates
                    ${whereClause}
                    ORDER BY rate_date DESC, currency_code ASC
                    LIMIT 100
                `, queryParams);
                
                res.json({
                    success: true,
                    data: result.rows
                });
                
            } catch (error) {
                console.error('환율 목록 조회 실패:', error);
                res.status(500).json({
                    success: false,
                    message: '환율 목록 조회 중 오류가 발생했습니다.'
                });
            }
        });

        // ==================== 환율 자동 등록 기능 ====================
        
        // 환율 자동 가져오기 함수
        async function fetchAndSaveExchangeRate() {
            try {
                console.log('💱 환율 자동 가져오기 시작...');
                
                // ExchangeRate-API 사용 (무료, API 키 불필요)
                // 또는 한국수출입은행 API 사용 가능
                const response = await axios.get('https://open.er-api.com/v6/latest/USD');
                
                if (response.data && response.data.rates && response.data.rates.KRW) {
                    const usdToKrw = response.data.rates.KRW;
                    const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
                    const currentTime = new Date().toTimeString().split(' ')[0]; // HH:MM:SS
                    
                    // DB에 저장 (UPSERT)
                    await pool.query(`
                        INSERT INTO exchange_rates (currency_code, rate_date, rate_time, rate, source)
                        VALUES ($1, $2, $3, $4, $5)
                        ON CONFLICT (currency_code, rate_date, rate_time)
                        DO UPDATE SET rate = $4, source = $5, created_at = NOW()
                        RETURNING *
                    `, ['USD', today, currentTime, usdToKrw, 'auto_api']);
                    
                    console.log(`✅ 환율 자동 등록 완료: 1 USD = ${usdToKrw.toFixed(2)} KRW (${today} ${currentTime})`);
                    
                    return {
                        success: true,
                        rate: usdToKrw,
                        date: today,
                        time: currentTime
                    };
                } else {
                    console.error('❌ 환율 API 응답 형식 오류');
                    return { success: false, message: 'API 응답 형식 오류' };
                }
                
            } catch (error) {
                console.error('❌ 환율 자동 가져오기 실패:', error.message);
                
                // 실패 시 대체 API 시도 (한국수출입은행)
                try {
                    console.log('💱 대체 API로 재시도 중...');
                    
                    // 한국수출입은행 API (API 키 필요 - 환경변수에서 가져오기)
                    const koreaEximbankApiKey = process.env.KOREA_EXIMBANK_API_KEY;
                    
                    if (koreaEximbankApiKey) {
                        const today = new Date().toISOString().split('T')[0].replace(/-/g, ''); // YYYYMMDD
                        const url = `https://www.koreaexim.go.kr/site/program/financial/exchangeJSON?authkey=${koreaEximbankApiKey}&searchdate=${today}&data=AP01`;
                        
                        const response = await axios.get(url);
                        
                        if (response.data && Array.isArray(response.data)) {
                            const usdData = response.data.find(item => item.cur_unit === 'USD');
                            
                            if (usdData) {
                                const usdToKrw = parseFloat(usdData.deal_bas_r.replace(/,/g, ''));
                                const dateStr = new Date().toISOString().split('T')[0];
                                const timeStr = new Date().toTimeString().split(' ')[0];
                                
                                await pool.query(`
                                    INSERT INTO exchange_rates (currency_code, rate_date, rate_time, rate, source)
                                    VALUES ($1, $2, $3, $4, $5)
                                    ON CONFLICT (currency_code, rate_date, rate_time)
                                    DO UPDATE SET rate = $4, source = $5, created_at = NOW()
                                    RETURNING *
                                `, ['USD', dateStr, timeStr, usdToKrw, 'korea_eximbank_api']);
                                
                                console.log(`✅ 대체 API로 환율 등록 완료: 1 USD = ${usdToKrw.toFixed(2)} KRW`);
                                
                                return {
                                    success: true,
                                    rate: usdToKrw,
                                    date: dateStr,
                                    time: timeStr
                                };
                            }
                        }
                    }
                    
                    console.error('❌ 대체 API도 실패');
                    return { success: false, message: '모든 환율 API 실패' };
                    
                } catch (fallbackError) {
                    console.error('❌ 대체 API 오류:', fallbackError.message);
                    return { success: false, message: '환율 가져오기 실패' };
                }
            }
        }
        
        // 환율 자동 가져오기 수동 실행 API
        app.post('/api/exchange-rates/fetch', requireAuth, async (req, res) => {
            try {
                const result = await fetchAndSaveExchangeRate();
                
                if (result.success) {
                    res.json({
                        success: true,
                        message: '환율이 자동으로 등록되었습니다.',
                        data: result
                    });
                } else {
                    res.status(500).json({
                        success: false,
                        message: result.message || '환율 가져오기 실패'
                    });
                }
                
            } catch (error) {
                console.error('환율 자동 가져오기 API 오류:', error);
                res.status(500).json({
                    success: false,
                    message: '환율 자동 가져오기 중 오류가 발생했습니다.'
                });
            }
        });
        
        // 매일 아침 9시에 자동 실행 (한국 시간 기준)
        cron.schedule('0 9 * * *', async () => {
            console.log('🕐 스케줄 실행: 매일 아침 9시 환율 자동 업데이트');
            await fetchAndSaveExchangeRate();
        }, {
            timezone: "Asia/Seoul"
        });
        
        console.log('📅 환율 자동 업데이트 스케줄러 시작됨 (매일 09:00 KST)');
        
        // 서버 시작 시 오늘 환율 확인 및 자동 등록
        async function checkAndFetchTodayRate() {
            try {
                const today = new Date().toISOString().split('T')[0];
                
                // 오늘 USD 환율이 이미 등록되어 있는지 확인
                const existingRate = await pool.query(`
                    SELECT * FROM exchange_rates 
                    WHERE currency_code = 'USD' 
                    AND rate_date = $1
                    ORDER BY created_at DESC
                    LIMIT 1
                `, [today]);
                
                if (existingRate.rows.length === 0) {
                    console.log('💱 오늘 환율이 없습니다. 자동으로 가져옵니다...');
                    await fetchAndSaveExchangeRate();
                } else {
                    console.log(`✅ 오늘 환율이 이미 등록되어 있습니다: 1 USD = ₩${parseFloat(existingRate.rows[0].rate).toFixed(2)} (${existingRate.rows[0].rate_time})`);
                }
            } catch (error) {
                console.error('❌ 환율 확인 중 오류:', error.message);
            }
        }
        
        // 서버 시작 시 환율 체크 (5초 후 - DB 연결 안정화 대기)
        setTimeout(async () => {
            await checkAndFetchTodayRate();
        }, 5000);

        // ==================== 대량 정산 계산 API ====================
        
        // 대량 정산 계산 API (AI 기반 자동 계산)
        app.post('/api/settlements/bulk-calculate', requireAuth, async (req, res) => {
            const client = await pool.connect();
            try {
                const { reservation_ids, platform_id, supplier_id } = req.body;
                
                if (!reservation_ids || reservation_ids.length === 0) {
                    return res.status(400).json({
                        success: false,
                        message: '정산할 예약을 선택해주세요.'
                    });
                }
                
                console.log(`🧮 대량 정산 계산 시작: ${reservation_ids.length}건`);
                
                await client.query('BEGIN');
                
                const results = [];
                const errors = [];
                
                for (const reservationId of reservation_ids) {
                    try {
                        // 1. 예약 정보 조회
                        const reservationResult = await client.query(`
                            SELECT r.*, a.cost_amount as assignment_cost, a.cost_currency as assignment_currency
                            FROM reservations r
                            LEFT JOIN assignments a ON a.reservation_id = r.id
                            WHERE r.id = $1
                        `, [reservationId]);
                        
                        if (reservationResult.rows.length === 0) {
                            throw new Error('예약을 찾을 수 없습니다');
                        }
                        
                        const reservation = reservationResult.rows[0];
                        
                        // 2. 플랫폼 정산금 계산 (KRW)
                        const grossAmountKrw = reservation.total_amount || 0;
                        let commissionAmountKrw = 0;
                        let commissionPercent = null;
                        
                        // RAG에서 플랫폼 수수료 정책 검색 (임시로 10% 가정)
                        commissionPercent = 10;
                        commissionAmountKrw = grossAmountKrw * (commissionPercent / 100);
                        
                        const netFromPlatformKrw = grossAmountKrw - commissionAmountKrw;
                        
                        // 3. 공급사 원가 계산 (현지통화 → KRW)
                        const supplierCostCurrency = reservation.assignment_currency || 'USD';
                        const supplierCostAmount = reservation.assignment_cost || 0;
                        
                        // 환율 조회 (체크인 전일 16:00 기준)
                        const usageDate = new Date(reservation.usage_date);
                        const dayBefore = new Date(usageDate);
                        dayBefore.setDate(dayBefore.getDate() - 1);
                        const fxRateDate = dayBefore.toISOString().split('T')[0];
                        
                        let fxRate = 1;
                        let supplierCostKrw = supplierCostAmount;
                        
                        if (supplierCostCurrency !== 'KRW') {
                            const fxResult = await client.query(`
                                SELECT rate FROM exchange_rates
                                WHERE currency_code = $1
                                AND rate_date <= $2
                                ORDER BY rate_date DESC, rate_time DESC
                                LIMIT 1
                            `, [supplierCostCurrency, fxRateDate]);
                            
                            if (fxResult.rows.length > 0) {
                                fxRate = parseFloat(fxResult.rows[0].rate);
                                supplierCostKrw = supplierCostAmount / fxRate; // 외화 → KRW
                            } else {
                                // 환율 없으면 기본값 사용 (USD: 1330, VND: 0.055)
                                const defaultRates = { USD: 1330, VND: 0.055 };
                                fxRate = defaultRates[supplierCostCurrency] || 1;
                                supplierCostKrw = supplierCostAmount * fxRate;
                            }
                        }
                        
                        // 4. 마진 계산
                        const marginKrw = netFromPlatformKrw - supplierCostKrw;
                        const marginRate = netFromPlatformKrw > 0 ? (marginKrw / netFromPlatformKrw * 100) : 0;
                        
                        // 5. settlements 테이블에 저장/업데이트
                        const settlementResult = await client.query(`
                            INSERT INTO settlements (
                                reservation_id,
                                settlement_period,
                                usage_date,
                                platform_id,
                                supplier_id,
                                gross_amount_krw,
                                commission_percent,
                                commission_amount_krw,
                                net_from_platform_krw,
                                supplier_cost_currency,
                                supplier_cost_amount,
                                fx_rate,
                                fx_rate_date,
                                supplier_cost_krw,
                                margin_krw,
                                margin_rate,
                                status,
                                created_at
                            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, NOW())
                            ON CONFLICT (reservation_id) 
                            DO UPDATE SET
                                gross_amount_krw = $6,
                                commission_percent = $7,
                                commission_amount_krw = $8,
                                net_from_platform_krw = $9,
                                supplier_cost_currency = $10,
                                supplier_cost_amount = $11,
                                fx_rate = $12,
                                fx_rate_date = $13,
                                supplier_cost_krw = $14,
                                margin_krw = $15,
                                margin_rate = $16,
                                updated_at = NOW()
                            RETURNING id
                        `, [
                            reservationId,
                            usageDate.toISOString().substring(0, 7), // YYYY-MM
                            reservation.usage_date,
                            platform_id || null,
                            supplier_id || null,
                            grossAmountKrw,
                            commissionPercent,
                            commissionAmountKrw,
                            netFromPlatformKrw,
                            supplierCostCurrency,
                            supplierCostAmount,
                            fxRate,
                            fxRateDate,
                            supplierCostKrw,
                            marginKrw,
                            marginRate.toFixed(2),
                            'calculated'
                        ]);
                        
                        results.push({
                            reservation_id: reservationId,
                            reservation_number: reservation.reservation_number,
                            gross_amount_krw: grossAmountKrw,
                            net_from_platform_krw: netFromPlatformKrw,
                            supplier_cost_krw: supplierCostKrw,
                            margin_krw: marginKrw,
                            margin_rate: marginRate.toFixed(2)
                        });
                        
                        console.log(`  ✅ ${reservation.reservation_number} 정산 완료: 마진 ${marginKrw.toFixed(0)}원 (${marginRate.toFixed(1)}%)`);
                        
                    } catch (error) {
                        errors.push({
                            reservation_id: reservationId,
                            error: error.message
                        });
                        console.error(`  ❌ 예약 ${reservationId} 정산 실패:`, error.message);
                    }
                }
                
                await client.query('COMMIT');
                
                console.log(`🎉 대량 정산 완료 - 성공: ${results.length}, 실패: ${errors.length}`);
                
                res.json({
                    success: true,
                    message: `${results.length}건 정산 계산 완료`,
                    data: {
                        success_count: results.length,
                        fail_count: errors.length,
                        results,
                        errors
                    }
                });
                
            } catch (error) {
                await client.query('ROLLBACK');
                console.error('❌ 대량 정산 계산 오류:', error);
                res.status(500).json({
                    success: false,
                    message: '대량 정산 계산 중 오류가 발생했습니다.',
                    error: error.message
                });
            } finally {
                client.release();
            }
        });

        // ==================== 요금 RAG 문서 관리 API ====================
        
        // 요금 RAG 문서 목록 조회
        app.get('/api/price-rag/documents', requireAuth, async (req, res) => {
            try {
                const { search = '' } = req.query;
                console.log('💰 요금 RAG 문서 조회:', { search });
                
                let query = 'SELECT * FROM price_rag_documents WHERE 1=1';
                const params = [];
                
                if (search) {
                    params.push(`%${search}%`);
                    query += ` AND (product_name ILIKE $${params.length} OR package_name ILIKE $${params.length} OR supplier_name ILIKE $${params.length})`;
                }
                
                query += ' ORDER BY created_at DESC';
                
                const result = await pool.query(query, params);
                
                res.json({
                    success: true,
                    data: result.rows
                });
            } catch (error) {
                console.error('❌ 요금 RAG 문서 조회 실패:', error);
                res.status(500).json({
                    success: false,
                    message: '요금 문서 조회 중 오류가 발생했습니다.'
                });
            }
        });
        
        // 요금 RAG 문서 단건 조회
        app.get('/api/price-rag/documents/:id', requireAuth, async (req, res) => {
            try {
                const { id } = req.params;
                console.log('🔍 요금 RAG 문서 상세 조회:', id);
                
                const result = await pool.query(
                    'SELECT * FROM price_rag_documents WHERE id = $1',
                    [id]
                );
                
                if (result.rows.length === 0) {
                    return res.status(404).json({
                        success: false,
                        message: '요금 문서를 찾을 수 없습니다.'
                    });
                }
                
                res.json({
                    success: true,
                    data: result.rows[0]
                });
            } catch (error) {
                console.error('❌ 요금 RAG 문서 상세 조회 실패:', error);
                res.status(500).json({
                    success: false,
                    message: '요금 문서 조회 중 오류가 발생했습니다.'
                });
            }
        });
        
        // 요금 RAG 문서 등록
        app.post('/api/price-rag/documents', requireAuth, async (req, res) => {
            try {
                const {
                    product_name,
                    package_name,
                    supplier_name,
                    sale_currency,
                    sale_adult_price,
                    sale_child_price,
                    sale_infant_price,
                    commission_rate,
                    cost_currency,
                    cost_adult_price,
                    cost_child_price,
                    cost_infant_price
                } = req.body;
                
                console.log('💾 요금 RAG 문서 등록:', { product_name, package_name });
                
                if (!product_name) {
                    return res.status(400).json({
                        success: false,
                        message: '상품명은 필수입니다.'
                    });
                }
                
                const result = await pool.query(`
                    INSERT INTO price_rag_documents (
                        product_name, package_name, supplier_name,
                        sale_currency, sale_adult_price, sale_child_price, sale_infant_price, commission_rate,
                        cost_currency, cost_adult_price, cost_child_price, cost_infant_price,
                        created_by
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
                    RETURNING *
                `, [
                    product_name,
                    package_name || null,
                    supplier_name || null,
                    sale_currency || 'KRW',
                    sale_adult_price || 0,
                    sale_child_price || 0,
                    sale_infant_price || 0,
                    commission_rate || 0,
                    cost_currency || 'USD',
                    cost_adult_price || 0,
                    cost_child_price || 0,
                    cost_infant_price || 0,
                    req.session.user?.username || 'admin'
                ]);
                
                console.log('✅ 요금 RAG 문서 등록 완료:', result.rows[0].id);
                
                res.json({
                    success: true,
                    message: '요금 정보가 등록되었습니다.',
                    data: result.rows[0]
                });
            } catch (error) {
                console.error('❌ 요금 RAG 문서 등록 실패:', error);
                res.status(500).json({
                    success: false,
                    message: '요금 정보 등록 중 오류가 발생했습니다.'
                });
            }
        });
        
        // 요금 RAG 문서 수정
        app.put('/api/price-rag/documents/:id', requireAuth, async (req, res) => {
            try {
                const { id } = req.params;
                const {
                    product_name,
                    package_name,
                    supplier_name,
                    sale_currency,
                    sale_adult_price,
                    sale_child_price,
                    sale_infant_price,
                    commission_rate,
                    cost_currency,
                    cost_adult_price,
                    cost_child_price,
                    cost_infant_price
                } = req.body;
                
                console.log('✏️ 요금 RAG 문서 수정:', id);
                
                const result = await pool.query(`
                    UPDATE price_rag_documents SET
                        product_name = $1,
                        package_name = $2,
                        supplier_name = $3,
                        sale_currency = $4,
                        sale_adult_price = $5,
                        sale_child_price = $6,
                        sale_infant_price = $7,
                        commission_rate = $8,
                        cost_currency = $9,
                        cost_adult_price = $10,
                        cost_child_price = $11,
                        cost_infant_price = $12,
                        updated_at = CURRENT_TIMESTAMP
                    WHERE id = $13
                    RETURNING *
                `, [
                    product_name,
                    package_name || null,
                    supplier_name || null,
                    sale_currency || 'KRW',
                    sale_adult_price || 0,
                    sale_child_price || 0,
                    sale_infant_price || 0,
                    commission_rate || 0,
                    cost_currency || 'USD',
                    cost_adult_price || 0,
                    cost_child_price || 0,
                    cost_infant_price || 0,
                    id
                ]);
                
                if (result.rows.length === 0) {
                    return res.status(404).json({
                        success: false,
                        message: '요금 문서를 찾을 수 없습니다.'
                    });
                }
                
                console.log('✅ 요금 RAG 문서 수정 완료:', id);
                
                res.json({
                    success: true,
                    message: '요금 정보가 수정되었습니다.',
                    data: result.rows[0]
                });
            } catch (error) {
                console.error('❌ 요금 RAG 문서 수정 실패:', error);
                res.status(500).json({
                    success: false,
                    message: '요금 정보 수정 중 오류가 발생했습니다.'
                });
            }
        });
        
        // 요금 RAG 문서 삭제
        app.delete('/api/price-rag/documents/:id', requireAuth, async (req, res) => {
            try {
                const { id } = req.params;
                console.log('🗑️ 요금 RAG 문서 삭제:', id);
                
                const result = await pool.query(
                    'DELETE FROM price_rag_documents WHERE id = $1 RETURNING id',
                    [id]
                );
                
                if (result.rows.length === 0) {
                    return res.status(404).json({
                        success: false,
                        message: '요금 문서를 찾을 수 없습니다.'
                    });
                }
                
                console.log('✅ 요금 RAG 문서 삭제 완료:', id);
                
                res.json({
                    success: true,
                    message: '요금 정보가 삭제되었습니다.'
                });
            } catch (error) {
                console.error('❌ 요금 RAG 문서 삭제 실패:', error);
                res.status(500).json({
                    success: false,
                    message: '요금 정보 삭제 중 오류가 발생했습니다.'
                });
            }
        });
        
        // ==================== 정산관리 목록 및 처리 API ====================
        
        // 정산 목록 조회 (상태별)
        app.get('/api/settlements/list', requireAuth, async (req, res) => {
            try {
                const { status, start_date, end_date, search, platform, vendor, payment_received, payment_sent, assigned_to } = req.query;
                console.log('💰 정산 목록 조회:', { status, start_date, end_date, search, platform, vendor, payment_received, payment_sent, assigned_to });
                
                // settlements 테이블과 reservations, assignments, vendors, admin_users 테이블 조인
                let query = `
                    SELECT 
                        s.*,
                        r.reservation_number,
                        r.korean_name,
                        r.product_name,
                        r.platform_name,
                        r.usage_date,
                        r.assigned_to,
                        v.vendor_name,
                        r.assigned_to as staff_name
                    FROM settlements s
                    INNER JOIN reservations r ON s.reservation_id = r.id
                    LEFT JOIN assignments a ON a.reservation_id = r.id
                    LEFT JOIN vendors v ON a.vendor_id = v.id
                    WHERE 1=1
                `;
                
                const params = [];
                
                // 상태 필터 (incomplete: 입금 또는 송금 미완료, completed: 둘 다 완료)
                if (status === 'incomplete') {
                    query += ' AND (s.payment_received_date IS NULL OR s.payment_sent_date IS NULL)';
                } else if (status === 'completed') {
                    query += ' AND s.payment_received_date IS NOT NULL AND s.payment_sent_date IS NOT NULL';
                }
                
                // 기간 필터 (이용일 기준)
                if (start_date) {
                    params.push(start_date);
                    query += ` AND r.usage_date >= $${params.length}`;
                }
                if (end_date) {
                    params.push(end_date);
                    query += ` AND r.usage_date <= $${params.length}`;
                }
                
                // 예약업체 필터
                if (platform) {
                    params.push(platform);
                    query += ` AND r.platform_name = $${params.length}`;
                }
                
                // 수배업체 필터
                if (vendor) {
                    params.push(vendor);
                    query += ` AND v.vendor_name = $${params.length}`;
                }
                
                // 입금상태 필터
                if (payment_received === 'completed') {
                    query += ' AND s.payment_received_date IS NOT NULL';
                } else if (payment_received === 'pending') {
                    query += ' AND s.payment_received_date IS NULL';
                }
                
                // 송금상태 필터
                if (payment_sent === 'completed') {
                    query += ' AND s.payment_sent_date IS NOT NULL';
                } else if (payment_sent === 'pending') {
                    query += ' AND s.payment_sent_date IS NULL';
                }
                
                // 담당직원 필터
                if (assigned_to) {
                    params.push(assigned_to);
                    query += ` AND r.assigned_to = $${params.length}`;
                }
                
                // 검색 필터 (손님이름 또는 상품명)
                if (search) {
                    params.push(`%${search}%`);
                    const searchIdx = params.length;
                    query += ` AND (r.korean_name ILIKE $${searchIdx} OR r.product_name ILIKE $${searchIdx})`;
                }
                
                query += ' ORDER BY r.usage_date DESC, s.created_at DESC';
                
                console.log('🔍 실행 쿼리:', query);
                console.log('🔍 쿼리 파라미터:', params);
                
                const result = await pool.query(query, params);
                
                console.log(`✅ 조회 결과: ${result.rows.length}개`);
                
                // 카운트 계산
                const countQuery = `
                    SELECT 
                        COUNT(*) FILTER (WHERE payment_received_date IS NULL OR payment_sent_date IS NULL) as incomplete,
                        COUNT(*) FILTER (WHERE payment_received_date IS NOT NULL AND payment_sent_date IS NOT NULL) as completed
                    FROM settlements
                `;
                const countResult = await pool.query(countQuery);
                
                res.json({
                    success: true,
                    data: result.rows,
                    counts: {
                        incomplete: parseInt(countResult.rows[0].incomplete),
                        completed: parseInt(countResult.rows[0].completed)
                    }
                });
            } catch (error) {
                console.error('❌ 정산 목록 조회 실패:', error);
                res.status(500).json({
                    success: false,
                    message: '정산 목록 조회 중 오류가 발생했습니다.'
                });
            }
        });
        
        // [디버깅] 정산 데이터의 실제 assigned_to 값 확인
        app.get('/api/settlements/debug/assigned-to', requireAuth, async (req, res) => {
            try {
                const result = await pool.query(`
                    SELECT DISTINCT 
                        r.assigned_to,
                        COUNT(*) as count
                    FROM settlements s
                    INNER JOIN reservations r ON s.reservation_id = r.id
                    WHERE s.payment_received_date IS NOT NULL 
                      AND s.payment_sent_date IS NOT NULL
                      AND r.assigned_to IS NOT NULL
                      AND r.assigned_to != ''
                    GROUP BY r.assigned_to
                    ORDER BY count DESC
                `);
                
                res.json({
                    success: true,
                    data: result.rows
                });
            } catch (error) {
                console.error('❌ 디버깅 조회 실패:', error);
                res.status(500).json({ success: false, message: error.message });
            }
        });

        // 직원 목록 조회 API (정산 데이터의 실제 담당직원 목록)
        app.get('/api/admin/users', requireAuth, async (req, res) => {
            try {
                const result = await pool.query(`
                    SELECT DISTINCT r.assigned_to as full_name
                    FROM settlements s
                    INNER JOIN reservations r ON s.reservation_id = r.id
                    WHERE r.assigned_to IS NOT NULL AND r.assigned_to != ''
                    ORDER BY r.assigned_to
                `);
                
                res.json({
                    success: true,
                    users: result.rows.map(row => ({
                        username: row.full_name,  // 한글 이름을 username으로 사용
                        full_name: row.full_name
                    }))
                });
            } catch (error) {
                console.error('❌ 직원 목록 조회 실패:', error);
                res.status(500).json({
                    success: false,
                    message: '직원 목록 조회 중 오류가 발생했습니다.'
                });
            }
        });

        // 예약업체 목록 조회 API
        app.get('/api/settlements/platforms', requireAuth, async (req, res) => {
            try {
                const result = await pool.query(`
                    SELECT DISTINCT r.platform_name
                    FROM settlements s
                    INNER JOIN reservations r ON s.reservation_id = r.id
                    WHERE r.platform_name IS NOT NULL
                    ORDER BY r.platform_name
                `);
                
                res.json({
                    success: true,
                    platforms: result.rows.map(row => row.platform_name)
                });
            } catch (error) {
                console.error('❌ 예약업체 목록 조회 실패:', error);
                res.status(500).json({
                    success: false,
                    message: '예약업체 목록 조회 중 오류가 발생했습니다.'
                });
            }
        });

        // 수배업체 목록 조회 API
        app.get('/api/settlements/vendors', requireAuth, async (req, res) => {
            try {
                const result = await pool.query(`
                    SELECT DISTINCT v.vendor_name
                    FROM settlements s
                    INNER JOIN assignments a ON a.reservation_id = s.reservation_id
                    INNER JOIN vendors v ON a.vendor_id = v.id
                    WHERE v.vendor_name IS NOT NULL
                    ORDER BY v.vendor_name
                `);
                
                res.json({
                    success: true,
                    vendors: result.rows.map(row => row.vendor_name)
                });
            } catch (error) {
                console.error('❌ 수배업체 목록 조회 실패:', error);
                res.status(500).json({
                    success: false,
                    message: '수배업체 목록 조회 중 오류가 발생했습니다.'
                });
            }
        });

        // 입금/송금 처리 API
        app.post('/api/settlements/:id/payment', requireAuth, async (req, res) => {
            try {
                const { id } = req.params;
                const { type, date, exchange_rate } = req.body; // type: 'received' or 'sent'
                
                console.log('💰 입금/송금 처리:', { id, type, date, exchange_rate });
                
                const field = type === 'received' ? 'payment_received_date' : 'payment_sent_date';
                
                // 송금 시 환율도 함께 저장
                if (type === 'sent' && exchange_rate) {
                    // 정산 정보 조회 (달러 비용 계산)
                    const settlementInfo = await pool.query(`
                        SELECT total_cost, cost_currency
                        FROM settlements
                        WHERE id = $1
                    `, [id]);
                    
                    if (settlementInfo.rows.length > 0) {
                        const { total_cost, cost_currency } = settlementInfo.rows[0];
                        const costKRW = cost_currency === 'USD' ? total_cost * exchange_rate : total_cost;
                        
                        await pool.query(`
                            UPDATE settlements 
                            SET ${field} = $1, 
                                payment_sent_exchange_rate = $2,
                                payment_sent_cost_krw = $3,
                                updated_at = NOW()
                            WHERE id = $4
                        `, [date, exchange_rate, costKRW, id]);
                    } else {
                        return res.status(404).json({
                            success: false,
                            message: '정산 정보를 찾을 수 없습니다.'
                        });
                    }
                } else {
                    // 입금 시에는 날짜만 업데이트
                    await pool.query(`
                        UPDATE settlements 
                        SET ${field} = $1, updated_at = NOW()
                        WHERE id = $2
                    `, [date, id]);
                }
                
                // 둘 다 완료되었는지 확인
                const checkResult = await pool.query(`
                    SELECT payment_received_date, payment_sent_date
                    FROM settlements
                    WHERE id = $1
                `, [id]);
                
                const settlement = checkResult.rows[0];
                const allCompleted = settlement.payment_received_date && settlement.payment_sent_date;
                
                // 둘 다 완료되면 settlement_status 업데이트
                if (allCompleted) {
                    await pool.query(`
                        UPDATE settlements
                        SET settlement_status = 'completed', updated_at = NOW()
                        WHERE id = $1
                    `, [id]);
                }
                
                console.log('✅ 입금/송금 처리 완료:', { id, type, allCompleted });
                
                res.json({
                    success: true,
                    message: `${type === 'received' ? '입금' : '송금'} 처리가 완료되었습니다.`,
                    all_completed: allCompleted
                });
            } catch (error) {
                console.error('❌ 입금/송금 처리 실패:', error);
                res.status(500).json({
                    success: false,
                    message: '입금/송금 처리 중 오류가 발생했습니다.'
                });
            }
        });
        
        // 정산 내보내기 API (엑셀)
        app.get('/api/settlements/export', requireAuth, async (req, res) => {
            try {
                const { status, start_date, end_date, search, platform, vendor, payment_received, payment_sent, assigned_to } = req.query;
                console.log('📊 정산 엑셀 내보내기:', { status, start_date, end_date, search, platform, vendor, payment_received, payment_sent, assigned_to });
                
                // 정산 목록 조회 (필터 적용)
                let query = `
                    SELECT 
                        s.*,
                        r.reservation_number,
                        r.korean_name,
                        r.product_name,
                        r.platform_name,
                        r.usage_date,
                        r.assigned_to,
                        v.vendor_name,
                        r.assigned_to as staff_name
                    FROM settlements s
                    INNER JOIN reservations r ON s.reservation_id = r.id
                    LEFT JOIN assignments a ON a.reservation_id = r.id
                    LEFT JOIN vendors v ON a.vendor_id = v.id
                    WHERE 1=1
                `;
                
                const params = [];
                
                // 필터 적용 (정산 목록 조회와 동일한 로직)
                if (status === 'incomplete') {
                    query += ' AND (s.payment_received_date IS NULL OR s.payment_sent_date IS NULL)';
                } else if (status === 'completed') {
                    query += ' AND s.payment_received_date IS NOT NULL AND s.payment_sent_date IS NOT NULL';
                }
                
                if (start_date) {
                    params.push(start_date);
                    query += ` AND r.usage_date >= $${params.length}`;
                }
                if (end_date) {
                    params.push(end_date);
                    query += ` AND r.usage_date <= $${params.length}`;
                }
                if (platform) {
                    params.push(platform);
                    query += ` AND r.platform_name = $${params.length}`;
                }
                if (vendor) {
                    params.push(vendor);
                    query += ` AND v.vendor_name = $${params.length}`;
                }
                if (payment_received === 'completed') {
                    query += ' AND s.payment_received_date IS NOT NULL';
                } else if (payment_received === 'pending') {
                    query += ' AND s.payment_received_date IS NULL';
                }
                if (payment_sent === 'completed') {
                    query += ' AND s.payment_sent_date IS NOT NULL';
                } else if (payment_sent === 'pending') {
                    query += ' AND s.payment_sent_date IS NULL';
                }
                if (assigned_to) {
                    params.push(assigned_to);
                    query += ` AND r.assigned_to = $${params.length}`;
                }
                if (search) {
                    params.push(`%${search}%`);
                    const searchIdx = params.length;
                    query += ` AND (r.korean_name ILIKE $${searchIdx} OR r.product_name ILIKE $${searchIdx})`;
                }
                
                query += ' ORDER BY r.usage_date DESC, s.created_at DESC';
                
                const result = await pool.query(query, params);
                
                // 엑셀 데이터 생성
                const excelData = result.rows.map(s => {
                    const revenueKRW = s.sale_currency === 'KRW' ? (s.net_revenue || 0) : (s.net_revenue || 0) * (s.exchange_rate || 1330);
                    const costKRW = s.cost_krw || 0;
                    const marginKRW = s.margin_krw || 0;
                    const marginTax = Math.round(marginKRW * 0.1);
                    const commissionTax = Math.round((s.commission_amount || 0) * 0.1);
                    const tax = marginTax - commissionTax;
                    
                    return {
                        '이용일': s.usage_date ? new Date(s.usage_date).toISOString().split('T')[0] : '-',
                        '손님이름': s.korean_name || '-',
                        '상품명': s.product_name || '-',
                        '예약업체': s.platform_name || '-',
                        '수배업체': s.vendor_name || '-',
                        '담당직원': s.staff_name || s.assigned_to || '-',
                        '거래액(KRW)': Math.round(revenueKRW),
                        '매입액(KRW)': Math.round(costKRW),
                        '마진(KRW)': Math.round(marginKRW),
                        '마진부가세': marginTax,
                        '수수료부가세': commissionTax,
                        '실제부가세': tax,
                        '입금일': s.payment_received_date ? new Date(s.payment_received_date).toISOString().split('T')[0] : '-',
                        '송금일': s.payment_sent_date ? new Date(s.payment_sent_date).toISOString().split('T')[0] : '-',
                        '예약번호': s.reservation_number || '-',
                        '환율': s.exchange_rate || '-'
                    };
                });
                
                // 엑셀 워크북 생성
                const wb = XLSX.utils.book_new();
                const ws = XLSX.utils.json_to_sheet(excelData);
                
                // 컬럼 너비 설정
                ws['!cols'] = [
                    { wch: 12 }, // 이용일
                    { wch: 10 }, // 손님이름
                    { wch: 25 }, // 상품명
                    { wch: 12 }, // 예약업체
                    { wch: 12 }, // 수배업체
                    { wch: 10 }, // 담당직원
                    { wch: 15 }, // 거래액
                    { wch: 15 }, // 매입액
                    { wch: 15 }, // 마진
                    { wch: 12 }, // 마진부가세
                    { wch: 12 }, // 수수료부가세
                    { wch: 12 }, // 실제부가세
                    { wch: 12 }, // 입금일
                    { wch: 12 }, // 송금일
                    { wch: 20 }, // 예약번호
                    { wch: 10 }  // 환율
                ];
                
                XLSX.utils.book_append_sheet(wb, ws, '정산내역');
                
                // 파일명 생성 (날짜 포함)
                const today = new Date().toISOString().split('T')[0];
                const filename = `정산내역_${today}.xlsx`;
                
                // 엑셀 파일 생성 및 전송
                const excelBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
                
                res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
                res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(filename)}"`);
                res.send(excelBuffer);
                
                console.log(`✅ 엑셀 내보내기 완료: ${result.rows.length}개 항목`);
                
            } catch (error) {
                console.error('❌ 엑셀 내보내기 실패:', error);
                res.status(500).json({
                    success: false,
                    message: '엑셀 내보내기 중 오류가 발생했습니다.'
                });
            }
        });

        // 일괄 입금/송금 처리 API
        app.post('/api/settlements/bulk-payment', requireAuth, async (req, res) => {
            try {
                const { settlement_ids, type, date, exchange_rate } = req.body;
                
                if (!settlement_ids || !Array.isArray(settlement_ids) || settlement_ids.length === 0) {
                    return res.status(400).json({
                        success: false,
                        message: '처리할 정산 항목을 선택해주세요.'
                    });
                }
                
                console.log('💰 일괄 입금/송금 처리:', { count: settlement_ids.length, type, date, exchange_rate });
                
                const field = type === 'received' ? 'payment_received_date' : 'payment_sent_date';
                
                // 트랜잭션 시작
                const client = await pool.connect();
                try {
                    await client.query('BEGIN');
                    
                    // 각 정산에 대해 처리
                    for (const id of settlement_ids) {
                        if (type === 'sent' && exchange_rate) {
                            // 송금 시 환율도 저장
                            const settlementInfo = await client.query(`
                                SELECT total_cost, cost_currency
                                FROM settlements
                                WHERE id = $1
                            `, [id]);
                            
                            if (settlementInfo.rows.length > 0) {
                                const { total_cost, cost_currency } = settlementInfo.rows[0];
                                const costKRW = cost_currency === 'USD' ? total_cost * exchange_rate : total_cost;
                                
                                await client.query(`
                                    UPDATE settlements 
                                    SET ${field} = $1, 
                                        payment_sent_exchange_rate = $2,
                                        payment_sent_cost_krw = $3,
                                        updated_at = NOW()
                                    WHERE id = $4
                                `, [date, exchange_rate, costKRW, id]);
                            }
                        } else {
                            // 입금 시에는 날짜만 업데이트
                            await client.query(`
                                UPDATE settlements 
                                SET ${field} = $1, updated_at = NOW()
                                WHERE id = $2
                            `, [date, id]);
                        }
                        
                        // 둘 다 완료되었는지 확인하고 상태 업데이트
                        const checkResult = await client.query(`
                            SELECT payment_received_date, payment_sent_date
                            FROM settlements
                            WHERE id = $1
                        `, [id]);
                        
                        if (checkResult.rows.length > 0) {
                            const settlement = checkResult.rows[0];
                            if (settlement.payment_received_date && settlement.payment_sent_date) {
                                await client.query(`
                                    UPDATE settlements
                                    SET settlement_status = 'completed', updated_at = NOW()
                                    WHERE id = $1
                                `, [id]);
                            }
                        }
                    }
                    
                    await client.query('COMMIT');
                    
                    console.log(`✅ 일괄 ${type === 'received' ? '입금' : '송금'} 처리 완료: ${settlement_ids.length}개`);
                    
                    res.json({
                        success: true,
                        message: `${settlement_ids.length}개 항목의 ${type === 'received' ? '입금' : '송금'} 처리가 완료되었습니다.`,
                        processed_count: settlement_ids.length
                    });
                } catch (error) {
                    await client.query('ROLLBACK');
                    throw error;
                } finally {
                    client.release();
                }
            } catch (error) {
                console.error('❌ 일괄 입금/송금 처리 실패:', error);
                res.status(500).json({
                    success: false,
                    message: '일괄 입금/송금 처리 중 오류가 발생했습니다.'
                });
            }
        });
        
        // 정산 상세 조회 API
        app.get('/api/settlements/:id', requireAuth, async (req, res) => {
            try {
                const { id } = req.params;
                
                console.log('💰 정산 상세 조회:', id);
                
                const result = await pool.query(`
                    SELECT 
                        s.*,
                        r.reservation_number,
                        r.korean_name,
                        r.product_name,
                        r.package_type,
                        r.usage_date,
                        r.platform_name,
                        r.people_adult,
                        r.people_child,
                        r.people_infant,
                        v.vendor_name
                    FROM settlements s
                    INNER JOIN reservations r ON s.reservation_id = r.id
                    LEFT JOIN assignments a ON r.id = a.reservation_id
                    LEFT JOIN vendors v ON a.vendor_id = v.id
                    WHERE s.id = $1
                `, [id]);
                
                if (result.rows.length === 0) {
                    return res.status(404).json({
                        success: false,
                        message: '정산 정보를 찾을 수 없습니다.'
                    });
                }
                
                res.json({
                    success: true,
                    data: result.rows[0]
                });
            } catch (error) {
                console.error('❌ 정산 상세 조회 실패:', error);
                res.status(500).json({
                    success: false,
                    message: '정산 상세 조회 중 오류가 발생했습니다.'
                });
            }
        });
        
        // 정산 수정 API
        app.put('/api/settlements/:id', requireAuth, async (req, res) => {
            try {
                const { id } = req.params;
                const updateData = req.body;
                
                console.log('💾 정산 수정:', id, updateData);
                
                await pool.query(`
                    UPDATE settlements SET
                        sale_currency = $1,
                        sale_adult_price = $2,
                        sale_child_price = $3,
                        sale_infant_price = $4,
                        total_sale = $5,
                        commission_rate = $6,
                        commission_amount = $7,
                        net_revenue = $8,
                        cost_currency = $9,
                        cost_adult_price = $10,
                        cost_child_price = $11,
                        cost_infant_price = $12,
                        total_cost = $13,
                        exchange_rate = $14,
                        cost_krw = $15,
                        margin_krw = $16,
                        memo = $17,
                        updated_at = NOW()
                    WHERE id = $18
                `, [
                    updateData.sale_currency,
                    updateData.sale_adult_price,
                    updateData.sale_child_price,
                    updateData.sale_infant_price,
                    updateData.total_sale,
                    updateData.commission_rate,
                    updateData.commission_amount,
                    updateData.net_revenue,
                    updateData.cost_currency,
                    updateData.cost_adult_price,
                    updateData.cost_child_price,
                    updateData.cost_infant_price,
                    updateData.total_cost,
                    updateData.exchange_rate,
                    updateData.cost_krw,
                    updateData.margin_krw,
                    updateData.memo,
                    id
                ]);
                
                console.log('✅ 정산 수정 완료:', id);
                
                res.json({
                    success: true,
                    message: '정산 정보가 수정되었습니다.'
                });
            } catch (error) {
                console.error('❌ 정산 수정 실패:', error);
                res.status(500).json({
                    success: false,
                    message: '정산 수정 중 오류가 발생했습니다.'
                });
            }
        });
        
        // 정산 삭제 API
        app.delete('/api/settlements/:id', requireAuth, async (req, res) => {
            try {
                const { id } = req.params;
                
                console.log('🗑️ 정산 삭제:', id);
                
                await pool.query('DELETE FROM settlements WHERE id = $1', [id]);
                
                console.log('✅ 정산 삭제 완료:', id);
                
                res.json({
                    success: true,
                    message: '정산이 삭제되었습니다.'
                });
            } catch (error) {
                console.error('❌ 정산 삭제 실패:', error);
                res.status(500).json({
                    success: false,
                    message: '정산 삭제 중 오류가 발생했습니다.'
                });
            }
        });
        
        // 예약업체 목록 조회
        app.get('/api/settlements/platforms', requireAuth, async (req, res) => {
            try {
                const result = await pool.query(`
                    SELECT DISTINCT r.platform_name
                    FROM settlements s
                    INNER JOIN reservations r ON s.reservation_id = r.id
                    WHERE r.platform_name IS NOT NULL AND r.platform_name != ''
                    ORDER BY r.platform_name
                `);
                
                res.json({
                    success: true,
                    data: result.rows.map(row => row.platform_name)
                });
            } catch (error) {
                console.error('❌ 예약업체 목록 조회 실패:', error);
                res.status(500).json({
                    success: false,
                    message: '예약업체 목록 조회 중 오류가 발생했습니다.'
                });
            }
        });
        
        // 수배업체 목록 조회
        app.get('/api/settlements/vendors', requireAuth, async (req, res) => {
            try {
                const result = await pool.query(`
                    SELECT DISTINCT v.vendor_name
                    FROM settlements s
                    INNER JOIN reservations r ON s.reservation_id = r.id
                    LEFT JOIN assignments a ON a.reservation_id = r.id
                    LEFT JOIN vendors v ON a.vendor_id = v.id
                    WHERE v.vendor_name IS NOT NULL
                    ORDER BY v.vendor_name
                `);
                
                res.json({
                    success: true,
                    data: result.rows.map(row => row.vendor_name)
                });
            } catch (error) {
                console.error('❌ 수배업체 목록 조회 실패:', error);
                res.status(500).json({
                    success: false,
                    message: '수배업체 목록 조회 중 오류가 발생했습니다.'
                });
            }
        });
        
        // ERP 확장 마이그레이션 함수
        async function runERPMigration() {
            try {
                console.log('🔍 ERP 마이그레이션 상태 확인...');
                
                // migration_log 테이블 생성 (없으면)
                await pool.query(`
                    CREATE TABLE IF NOT EXISTS migration_log (
                        id SERIAL PRIMARY KEY,
                        version VARCHAR(10) UNIQUE NOT NULL,
                        description TEXT,
                        executed_at TIMESTAMP DEFAULT NOW()
                    )
                `);
                
                // 마이그레이션 003 실행 여부 확인 (버전 업데이트)
                const migrationCheck = await pool.query(
                    'SELECT * FROM migration_log WHERE version = $1',
                    ['003']
                ).catch(() => ({ rows: [] }));
                
                if (migrationCheck.rows.length > 0) {
                    console.log('✅ ERP 마이그레이션 003은 이미 완료되었습니다.');
                    
                    // 테이블 존재 확인
                    const tableCheck = await pool.query(`
                        SELECT table_name 
                        FROM information_schema.tables 
                        WHERE table_schema = 'public' 
                        AND table_name IN ('field_defs', 'reservation_audits', 'assignments', 'settlements')
                    `);
                    
                    if (tableCheck.rows.length < 4) {
                        console.log('⚠️ 일부 테이블이 누락됨. 마이그레이션 재실행...');
                        // 마이그레이션 로그 삭제하고 재실행
                        await pool.query('DELETE FROM migration_log WHERE version = $1', ['003']);
                    } else {
                        console.log('📊 모든 ERP 테이블 확인됨:', tableCheck.rows.map(r => r.table_name));
                        
                        // 마이그레이션 004 (정산 필드) 확인 및 실행
                        await runSettlementMigration();
                        return;
                    }
                }
                
                console.log('🚀 ERP 마이그레이션 003 실행 중... (reservation_id 호환성 개선)');
                
                await pool.query('BEGIN');
                
                // 1. extras JSONB 컬럼 추가
                await pool.query(`
                    DO $$ 
                    BEGIN
                        IF NOT EXISTS (
                            SELECT 1 FROM information_schema.columns 
                            WHERE table_name = 'reservations' AND column_name = 'extras'
                        ) THEN
                            ALTER TABLE reservations ADD COLUMN extras JSONB DEFAULT '{}';
                            CREATE INDEX IF NOT EXISTS idx_reservations_extras_gin ON reservations USING GIN (extras);
                        END IF;
                    END $$;
                `);
                
                // 2. field_defs 테이블 생성
                await pool.query(`
                    CREATE TABLE IF NOT EXISTS field_defs (
                        id SERIAL PRIMARY KEY,
                        field_key VARCHAR(100) NOT NULL UNIQUE,
                        field_name VARCHAR(200) NOT NULL,
                        field_type VARCHAR(50) NOT NULL DEFAULT 'text',
                        field_group VARCHAR(100) DEFAULT 'general',
                        validation_rules JSONB DEFAULT '{}',
                        ui_config JSONB DEFAULT '{}',
                        is_required BOOLEAN DEFAULT false,
                        is_active BOOLEAN DEFAULT true,
                        sort_order INTEGER DEFAULT 0,
                        created_at TIMESTAMP DEFAULT NOW(),
                        updated_at TIMESTAMP DEFAULT NOW()
                    );
                `);
                
                // 3. reservation_audits 테이블 생성
                await pool.query(`
                    CREATE TABLE IF NOT EXISTS reservation_audits (
                        id SERIAL PRIMARY KEY,
                        reservation_id INTEGER NOT NULL,
                        action VARCHAR(50) NOT NULL,
                        changed_by VARCHAR(100) NOT NULL,
                        changed_at TIMESTAMP DEFAULT NOW(),
                        old_values JSONB,
                        new_values JSONB,
                        diff JSONB,
                        ip_address INET,
                        user_agent TEXT,
                        notes TEXT
                    );
                `);
                
                // 인덱스는 별도로 생성 (reservation_audits 테이블과 컬럼 존재 확인 후)
                await pool.query(`
                    DO $$ 
                    BEGIN
                        -- reservation_audits 테이블과 reservation_id 컬럼 존재 확인
                        IF EXISTS (
                            SELECT 1 FROM information_schema.columns 
                            WHERE table_name = 'reservation_audits' AND column_name = 'reservation_id'
                        ) THEN
                            -- reservation_id 컬럼이 존재하면 인덱스 생성
                            CREATE INDEX IF NOT EXISTS idx_reservation_audits_reservation_id ON reservation_audits(reservation_id);
                        END IF;
                        
                        -- changed_at 컬럼 존재 확인 후 인덱스 생성
                        IF EXISTS (
                            SELECT 1 FROM information_schema.columns 
                            WHERE table_name = 'reservation_audits' AND column_name = 'changed_at'
                        ) THEN
                            CREATE INDEX IF NOT EXISTS idx_reservation_audits_changed_at ON reservation_audits(changed_at);
                        END IF;
                    END $$;
                `);
                
                // 4. assignments 테이블 생성
                await pool.query(`
                    CREATE TABLE IF NOT EXISTS assignments (
                        id SERIAL PRIMARY KEY,
                        reservation_id INTEGER NOT NULL,
                        vendor_id INTEGER,
                        vendor_name VARCHAR(200),
                        vendor_contact JSONB,
                        assignment_type VARCHAR(100) DEFAULT 'general',
                        status VARCHAR(50) DEFAULT 'requested',
                        cost_price DECIMAL(10,2),
                        cost_currency VARCHAR(3) DEFAULT 'USD',
                        voucher_number VARCHAR(100),
                        voucher_url TEXT,
                        voucher_issued_at TIMESTAMP,
                        notes TEXT,
                        assigned_by VARCHAR(100),
                        assigned_at TIMESTAMP,
                        completed_at TIMESTAMP,
                        created_at TIMESTAMP DEFAULT NOW(),
                        updated_at TIMESTAMP DEFAULT NOW()
                    );
                `);
                
                // assignments 테이블에 vendor_id 컬럼 추가 (기존 테이블에 없는 경우)
                await pool.query(`
                    DO $$ 
                    BEGIN
                        IF NOT EXISTS (
                            SELECT 1 FROM information_schema.columns 
                            WHERE table_name = 'assignments' AND column_name = 'vendor_id'
                        ) THEN
                            ALTER TABLE assignments ADD COLUMN vendor_id INTEGER;
                        END IF;
                    END $$;
                `);
                
                // assignments 인덱스 별도 생성
                await pool.query(`
                    DO $$ 
                    BEGIN
                        -- assignments 테이블과 reservation_id 컬럼 존재 확인
                        IF EXISTS (
                            SELECT 1 FROM information_schema.columns 
                            WHERE table_name = 'assignments' AND column_name = 'reservation_id'
                        ) THEN
                            CREATE INDEX IF NOT EXISTS idx_assignments_reservation_id ON assignments(reservation_id);
                        END IF;
                        
                        -- status 컬럼 존재 확인 후 인덱스 생성
                        IF EXISTS (
                            SELECT 1 FROM information_schema.columns 
                            WHERE table_name = 'assignments' AND column_name = 'status'
                        ) THEN
                            CREATE INDEX IF NOT EXISTS idx_assignments_status ON assignments(status);
                        END IF;
                    END $$;
                `);
                
                // 5. vendors 테이블 생성 (수배업체 관리)
                await pool.query(`
                    CREATE TABLE IF NOT EXISTS vendors (
                        id SERIAL PRIMARY KEY,
                        vendor_name VARCHAR(100) NOT NULL UNIQUE,
                        vendor_id VARCHAR(50) NOT NULL UNIQUE,
                        password_hash VARCHAR(255) NOT NULL,
                        email VARCHAR(100) NOT NULL,
                        phone VARCHAR(20),
                        contact_person VARCHAR(50),
                        business_type VARCHAR(50),
                        description TEXT,
                        notification_email VARCHAR(100),
                        is_active BOOLEAN DEFAULT true,
                        created_at TIMESTAMP DEFAULT NOW(),
                        updated_at TIMESTAMP DEFAULT NOW()
                    );
                `);
                
                // 6. vendor_products 테이블 생성 (업체별 담당 상품 매핑)
                await pool.query(`
                    CREATE TABLE IF NOT EXISTS vendor_products (
                        id SERIAL PRIMARY KEY,
                        vendor_id INTEGER REFERENCES vendors(id) ON DELETE CASCADE,
                        product_keyword VARCHAR(100) NOT NULL,
                        priority INTEGER DEFAULT 1,
                        is_active BOOLEAN DEFAULT true,
                        created_at TIMESTAMP DEFAULT NOW(),
                        updated_at TIMESTAMP DEFAULT NOW(),
                        UNIQUE(vendor_id, product_keyword)
                    );
                `);
                
                // 7. settlements 테이블 생성 및 컬럼 추가
                await pool.query(`
                    CREATE TABLE IF NOT EXISTS settlements (
                        id SERIAL PRIMARY KEY,
                        reservation_id INTEGER NOT NULL,
                        settlement_period VARCHAR(20),
                        total_sales DECIMAL(12,2) DEFAULT 0.00,
                        total_purchases DECIMAL(12,2) DEFAULT 0.00,
                        gross_margin DECIMAL(12,2) DEFAULT 0.00,
                        margin_rate DECIMAL(5,2) DEFAULT 0.00,
                        currency VARCHAR(3) DEFAULT 'USD',
                        status VARCHAR(50) DEFAULT 'draft',
                        settlement_date DATE,
                        payment_date DATE,
                        notes TEXT,
                        created_by VARCHAR(100),
                        created_at TIMESTAMP DEFAULT NOW(),
                        updated_at TIMESTAMP DEFAULT NOW()
                    );
                `);
                
                // 기본 인덱스 생성 (추가 컬럼은 마이그레이션 005에서 처리)
                await pool.query(`
                    CREATE INDEX IF NOT EXISTS idx_settlements_settlement_period ON settlements(settlement_period);
                    CREATE INDEX IF NOT EXISTS idx_settlements_reservation_id ON settlements(reservation_id);
                `);
                
                // 6. 기본 field_defs 데이터 삽입 (테이블 존재 확인 후)
                const fieldDefsCheck = await pool.query(`
                    SELECT column_name 
                    FROM information_schema.columns 
                    WHERE table_name = 'field_defs' AND column_name = 'field_key'
                `);
                
                if (fieldDefsCheck.rows.length > 0) {
                    await pool.query(`
                        INSERT INTO field_defs (field_key, field_name, field_type, field_group, validation_rules, ui_config, is_required, sort_order)
                        VALUES 
                            ('special_requests', '특별 요청사항', 'textarea', 'booking', '{"maxLength": 1000}', '{"placeholder": "특별한 요청사항이 있으시면 입력해주세요", "rows": 3}', false, 10),
                            ('dietary_restrictions', '식이 제한사항', 'text', 'traveler', '{"maxLength": 200}', '{"placeholder": "알레르기, 채식주의 등"}', false, 20),
                            ('emergency_contact', '비상 연락처', 'text', 'traveler', '{"pattern": "^[0-9+\\\\-\\\\s()]+$"}', '{"placeholder": "+82-10-1234-5678"}', false, 30),
                            ('tour_guide_language', '가이드 언어', 'select', 'service', '{}', '{"options": ["한국어", "영어", "일본어", "중국어"]}', false, 40),
                            ('pickup_location_detail', '픽업 위치 상세', 'text', 'service', '{"maxLength": 300}', '{"placeholder": "호텔 로비, 특정 위치 등"}', false, 50),
                            ('internal_notes', '내부 메모', 'textarea', 'internal', '{"maxLength": 2000}', '{"placeholder": "내부 직원용 메모", "rows": 4}', false, 100)
                        ON CONFLICT (field_key) DO NOTHING;
                    `);
                    console.log('✅ field_defs 기본 데이터 삽입 완료');
                } else {
                    console.log('⚠️ field_defs 테이블의 field_key 컬럼이 존재하지 않음 - 데이터 삽입 건너뜀');
                }
                
                // 마이그레이션 로그 기록
                await pool.query(
                    'INSERT INTO migration_log (version, description) VALUES ($1, $2)',
                    ['003', 'ERP 확장 v2: reservation_id 호환성 개선, 안전한 인덱스 생성']
                );
                
                await pool.query('COMMIT');
                
                console.log('✅ ERP 마이그레이션 003 완료! (reservation_id 호환성 개선)');
                
                // 생성된 테이블 확인
                const tables = await pool.query(`
                    SELECT table_name 
                    FROM information_schema.tables 
                    WHERE table_schema = 'public' 
                    AND table_name IN ('field_defs', 'reservation_audits', 'assignments', 'settlements')
                    ORDER BY table_name
                `);
                
                console.log('📊 ERP 테이블들:');
                tables.rows.forEach(row => {
                    console.log(`   ✓ ${row.table_name}`);
                });
                
                // 마이그레이션 003 완료 후 정산 마이그레이션 004 실행
                await runSettlementMigration();
                
            } catch (error) {
                await pool.query('ROLLBACK');
                console.error('❌ ERP 마이그레이션 실패:', error);
                // 마이그레이션 실패해도 서버는 계속 실행
            }
        }

        // 정산 필드 마이그레이션 함수 (마이그레이션 004)
        async function runSettlementMigration() {
            try {
                console.log('🔍 정산 필드 마이그레이션 004 상태 확인...');
                
                // 마이그레이션 004 실행 여부 확인
                const migration004Check = await pool.query(
                    'SELECT * FROM migration_log WHERE version = $1',
                    ['004']
                ).catch(() => ({ rows: [] }));
                
                // 환경변수로 마이그레이션 강제 실행 가능
                const forceMigration = process.env.FORCE_MIGRATION === 'true';
                
                if (migration004Check.rows.length > 0 && !forceMigration) {
                    console.log('✅ 정산 필드 마이그레이션 004는 이미 완료되었습니다.');
                    return;
                }
                
                if (forceMigration) {
                    console.log('🔄 FORCE_MIGRATION=true 감지 - 마이그레이션 004 강제 재실행');
                    // 기존 마이그레이션 로그 삭제
                    await pool.query('DELETE FROM migration_log WHERE version = $1', ['004']);
                }
                
                console.log('🚀 정산 필드 마이그레이션 004 실행 중...');
                
                await pool.query('BEGIN');
                
                // 정산 관련 컬럼들 추가
                await pool.query(`
                    DO $$ 
                    BEGIN
                        -- 매출 금액 (고객이 지불한 금액)
                        IF NOT EXISTS (
                            SELECT 1 FROM information_schema.columns 
                            WHERE table_name = 'reservations' AND column_name = 'sale_amount'
                        ) THEN
                            ALTER TABLE reservations ADD COLUMN sale_amount DECIMAL(10,2);
                        END IF;
                        
                        -- 매입 금액 (수배업체에 지불할 금액)
                        IF NOT EXISTS (
                            SELECT 1 FROM information_schema.columns 
                            WHERE table_name = 'reservations' AND column_name = 'cost_amount'
                        ) THEN
                            ALTER TABLE reservations ADD COLUMN cost_amount DECIMAL(10,2);
                        END IF;
                        
                        -- 마진 (매출 - 매입)
                        IF NOT EXISTS (
                            SELECT 1 FROM information_schema.columns 
                            WHERE table_name = 'reservations' AND column_name = 'profit_amount'
                        ) THEN
                            ALTER TABLE reservations ADD COLUMN profit_amount DECIMAL(10,2);
                        END IF;
                        
                        -- 정산 상태 (pending, settled, overdue)
                        IF NOT EXISTS (
                            SELECT 1 FROM information_schema.columns 
                            WHERE table_name = 'reservations' AND column_name = 'settlement_status'
                        ) THEN
                            ALTER TABLE reservations ADD COLUMN settlement_status VARCHAR(20) DEFAULT 'pending';
                        END IF;
                        
                        -- 정산 메모
                        IF NOT EXISTS (
                            SELECT 1 FROM information_schema.columns 
                            WHERE table_name = 'reservations' AND column_name = 'settlement_notes'
                        ) THEN
                            ALTER TABLE reservations ADD COLUMN settlement_notes TEXT;
                        END IF;
                        
                        -- 정산 완료 일시
                        IF NOT EXISTS (
                            SELECT 1 FROM information_schema.columns 
                            WHERE table_name = 'reservations' AND column_name = 'settled_at'
                        ) THEN
                            ALTER TABLE reservations ADD COLUMN settled_at TIMESTAMP;
                        END IF;
                        
                        -- 정산 담당자
                        IF NOT EXISTS (
                            SELECT 1 FROM information_schema.columns 
                            WHERE table_name = 'reservations' AND column_name = 'settled_by'
                        ) THEN
                            ALTER TABLE reservations ADD COLUMN settled_by VARCHAR(100);
                        END IF;
                    END $$;
                `);
                
                // 인덱스 추가 (성능 최적화)
                await pool.query(`
                    CREATE INDEX IF NOT EXISTS idx_reservations_settlement_status ON reservations(settlement_status);
                    CREATE INDEX IF NOT EXISTS idx_reservations_settled_at ON reservations(settled_at);
                    CREATE INDEX IF NOT EXISTS idx_reservations_payment_settlement ON reservations(payment_status, settlement_status);
                `);
                
                // 기존 바우처 전송 완료 예약들의 정산 상태 초기화
                const updateQuery = `
                    UPDATE reservations 
                    SET settlement_status = 'pending',
                        sale_amount = COALESCE(total_amount, 0)
                    WHERE payment_status = 'voucher_sent' 
                    AND settlement_status IS NULL
                `;
                
                const result = await pool.query(updateQuery);
                console.log(`✅ 기존 예약 ${result.rowCount}건의 정산 상태 초기화 완료`);
                
                // 마이그레이션 로그 기록
                await pool.query(
                    'INSERT INTO migration_log (version, description) VALUES ($1, $2)',
                    ['004', '정산관리 필드 추가: sale_amount, cost_amount, profit_amount, settlement_status 등']
                );
                
                await pool.query('COMMIT');
                
                console.log('✅ 정산 필드 마이그레이션 004 완료!');
                
                // 현재 정산 대상 예약 수 확인
                const countQuery = `
                    SELECT 
                        COUNT(*) as total_voucher_sent,
                        COUNT(CASE WHEN settlement_status = 'pending' THEN 1 END) as pending_settlement,
                        COUNT(CASE WHEN settlement_status = 'settled' THEN 1 END) as settled
                    FROM reservations 
                    WHERE payment_status = 'voucher_sent'
                `;
                
                const countResult = await pool.query(countQuery);
                const stats = countResult.rows[0];
                
                console.log('📊 정산 현황:');
                console.log(`   - 바우처 전송 완료: ${stats.total_voucher_sent}건`);
                console.log(`   - 정산 대기: ${stats.pending_settlement}건`);
                console.log(`   - 정산 완료: ${stats.settled}건`);
                
            } catch (error) {
                await pool.query('ROLLBACK');
                console.error('❌ 정산 필드 마이그레이션 실패:', error);
                throw error;
            }
        }
        
        // ==================== 마이그레이션 005: settlements 테이블 정산이관 컬럼 추가 ====================
        async function runMigration005() {
            try {
                console.log('🔍 마이그레이션 005 확인 중...');
                
                // 마이그레이션 005 실행 여부 확인
                const migration005Check = await pool.query(
                    'SELECT * FROM migration_log WHERE version = $1',
                    ['005']
                ).catch(() => ({ rows: [] }));
                
                if (migration005Check.rows.length > 0) {
                    console.log('✅ 마이그레이션 005 이미 실행됨 - 건너뜀');
                    return;
                }
                
                console.log('🚀 마이그레이션 005 실행 중: settlements 테이블 정산이관 컬럼 추가...');
                
                await pool.query('BEGIN');
                
                // 정산이관 기능을 위한 컬럼 추가
                const settlementColumns = [
                    { name: 'sale_currency', type: 'VARCHAR(10)', default: "'KRW'" },
                    { name: 'sale_adult_price', type: 'DECIMAL(10, 2)', default: '0' },
                    { name: 'sale_child_price', type: 'DECIMAL(10, 2)', default: '0' },
                    { name: 'sale_infant_price', type: 'DECIMAL(10, 2)', default: '0' },
                    { name: 'total_sale', type: 'DECIMAL(10, 2)', default: '0' },
                    { name: 'commission_rate', type: 'DECIMAL(5, 2)', default: '0' },
                    { name: 'commission_amount', type: 'DECIMAL(10, 2)', default: '0' },
                    { name: 'net_revenue', type: 'DECIMAL(10, 2)', default: '0' },
                    { name: 'cost_currency', type: 'VARCHAR(10)', default: "'USD'" },
                    { name: 'cost_adult_price', type: 'DECIMAL(10, 2)', default: '0' },
                    { name: 'cost_child_price', type: 'DECIMAL(10, 2)', default: '0' },
                    { name: 'cost_infant_price', type: 'DECIMAL(10, 2)', default: '0' },
                    { name: 'total_cost', type: 'DECIMAL(10, 2)', default: '0' },
                    { name: 'exchange_rate', type: 'DECIMAL(10, 4)', default: '1330' },
                    { name: 'cost_krw', type: 'DECIMAL(10, 2)', default: '0' },
                    { name: 'margin_krw', type: 'DECIMAL(10, 2)', default: '0' },
                    { name: 'payment_received_date', type: 'DATE', default: 'NULL' },
                    { name: 'payment_sent_date', type: 'DATE', default: 'NULL' },
                    { name: 'settlement_status', type: 'VARCHAR(50)', default: "'pending'" },
                    { name: 'memo', type: 'TEXT', default: 'NULL' }
                ];
                
                console.log(`📝 ${settlementColumns.length}개 컬럼 추가 중...`);
                
                for (const col of settlementColumns) {
                    try {
                        // 컬럼 존재 여부 확인
                        const checkColumn = await pool.query(`
                            SELECT column_name 
                            FROM information_schema.columns 
                            WHERE table_name = 'settlements' AND column_name = $1
                        `, [col.name]);
                        
                        if (checkColumn.rows.length === 0) {
                            await pool.query(`
                                ALTER TABLE settlements 
                                ADD COLUMN ${col.name} ${col.type} DEFAULT ${col.default}
                            `);
                            console.log(`   ✅ ${col.name} 추가 완료`);
                        } else {
                            console.log(`   ⏭️  ${col.name} 이미 존재 - 건너뜀`);
                        }
                    } catch (e) {
                        console.log(`   ⚠️  ${col.name} 추가 중 오류:`, e.message);
                    }
                }
                
                // 인덱스 생성
                console.log('📊 인덱스 생성 중...');
                await pool.query(`
                    CREATE INDEX IF NOT EXISTS idx_settlements_reservation_id ON settlements(reservation_id);
                    CREATE INDEX IF NOT EXISTS idx_settlements_settlement_status ON settlements(settlement_status);
                    CREATE INDEX IF NOT EXISTS idx_settlements_payment_received ON settlements(payment_received_date);
                    CREATE INDEX IF NOT EXISTS idx_settlements_payment_sent ON settlements(payment_sent_date);
                `);
                
                // UNIQUE 제약 추가 (reservation_id는 한 번만 정산 이관)
                try {
                    const constraintCheck = await pool.query(`
                        SELECT constraint_name 
                        FROM information_schema.table_constraints 
                        WHERE table_name = 'settlements' AND constraint_name = 'unique_reservation_settlement'
                    `);
                    
                    if (constraintCheck.rows.length === 0) {
                        await pool.query(`
                            ALTER TABLE settlements 
                            ADD CONSTRAINT unique_reservation_settlement 
                            UNIQUE (reservation_id)
                        `);
                        console.log('   ✅ UNIQUE 제약 조건 추가 완료');
                    }
                } catch (e) {
                    console.log('   ⚠️  UNIQUE 제약 추가 중 오류:', e.message);
                }
                
                // 마이그레이션 로그 기록
                await pool.query(
                    'INSERT INTO migration_log (version, description) VALUES ($1, $2)',
                    ['005', 'settlements 테이블 정산이관 컬럼 추가: 매출/매입/환율/마진/입금/송금 필드']
                );
                
                await pool.query('COMMIT');
                
                console.log('✅ 마이그레이션 005 완료!');
                
                // 추가된 컬럼 확인
                const columnCheck = await pool.query(`
                    SELECT column_name, data_type 
                    FROM information_schema.columns 
                    WHERE table_name = 'settlements' 
                    AND column_name IN ('sale_currency', 'sale_adult_price', 'net_revenue', 'cost_currency', 'margin_krw')
                    ORDER BY column_name
                `);
                
                console.log('📋 추가된 주요 컬럼:', columnCheck.rows.map(r => r.column_name).join(', '));
                
            } catch (error) {
                await pool.query('ROLLBACK');
                console.error('❌ 마이그레이션 005 실패:', error);
                throw error;
            }
        }
        
        // ==================== 마이그레이션 006: 송금 시 환율 저장 컬럼 추가 ====================
        async function runMigration006() {
            try {
                console.log('🔍 마이그레이션 006 확인 중...');
                
                // 마이그레이션 006 실행 여부 확인
                const migration006Check = await pool.query(
                    'SELECT * FROM migration_log WHERE version = $1',
                    ['006']
                ).catch(() => ({ rows: [] }));
                
                if (migration006Check.rows.length > 0) {
                    console.log('✅ 마이그레이션 006 이미 실행됨 - 건너뜀');
                    return;
                }
                
                console.log('🚀 마이그레이션 006 실행 중: 송금 시 환율 컬럼 추가...');
                
                await pool.query('BEGIN');
                
                // 송금 시 환율 저장 컬럼 추가
                const additionalColumns = [
                    { name: 'payment_sent_exchange_rate', type: 'DECIMAL(10, 4)', default: 'NULL' },
                    { name: 'payment_sent_cost_krw', type: 'DECIMAL(10, 2)', default: 'NULL' }
                ];
                
                console.log(`📝 ${additionalColumns.length}개 컬럼 추가 중...`);
                
                for (const col of additionalColumns) {
                    try {
                        // 컬럼 존재 여부 확인
                        const checkColumn = await pool.query(`
                            SELECT column_name 
                            FROM information_schema.columns 
                            WHERE table_name = 'settlements' AND column_name = $1
                        `, [col.name]);
                        
                        if (checkColumn.rows.length === 0) {
                            await pool.query(`
                                ALTER TABLE settlements 
                                ADD COLUMN ${col.name} ${col.type} DEFAULT ${col.default}
                            `);
                            console.log(`   ✅ ${col.name} 추가 완료`);
                        } else {
                            console.log(`   ⏭️  ${col.name} 이미 존재 - 건너뜀`);
                        }
                    } catch (e) {
                        console.log(`   ⚠️  ${col.name} 추가 중 오류:`, e.message);
                    }
                }
                
                // 마이그레이션 로그 기록
                await pool.query(
                    'INSERT INTO migration_log (version, description) VALUES ($1, $2)',
                    ['006', '송금 시 환율 저장을 위한 컬럼 추가: payment_sent_exchange_rate, payment_sent_cost_krw']
                );
                
                await pool.query('COMMIT');
                
                console.log('✅ 마이그레이션 006 완료!');
                
            } catch (error) {
                await pool.query('ROLLBACK');
                console.error('❌ 마이그레이션 006 실패:', error);
                throw error;
            }
        }

        // ==================== 마이그레이션 007: 요금 RAG 테이블 생성 ====================
        async function runMigration007() {
            try {
                console.log('🔍 마이그레이션 007 확인 중...');
                
                // 마이그레이션 007 실행 여부 확인
                const migration007Check = await pool.query(
                    'SELECT * FROM migration_log WHERE version = $1',
                    ['007']
                ).catch(() => ({ rows: [] }));
                
                if (migration007Check.rows.length > 0) {
                    console.log('✅ 마이그레이션 007 이미 실행됨 - 건너뜀');
                    return;
                }
                
                console.log('🚀 마이그레이션 007 실행 중: 요금 RAG 테이블 생성...');
                
                await pool.query('BEGIN');
                
                // 1. product_pricing 테이블 생성
                await pool.query(`
                    CREATE TABLE IF NOT EXISTS product_pricing (
                        id SERIAL PRIMARY KEY,
                        platform_name VARCHAR(100) NOT NULL,
                        vendor_id INTEGER REFERENCES vendors(id),
                        product_name VARCHAR(255) NOT NULL,
                        package_options JSONB NOT NULL DEFAULT '[]',
                        notes TEXT,
                        is_active BOOLEAN DEFAULT true,
                        version INTEGER DEFAULT 1,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        CONSTRAINT unique_platform_product UNIQUE(platform_name, product_name)
                    )
                `);
                console.log('   ✅ product_pricing 테이블 생성 완료');
                
                // 2. 인덱스 생성
                await pool.query(`
                    CREATE INDEX IF NOT EXISTS idx_pricing_platform ON product_pricing(platform_name);
                    CREATE INDEX IF NOT EXISTS idx_pricing_product ON product_pricing(product_name);
                    CREATE INDEX IF NOT EXISTS idx_pricing_vendor ON product_pricing(vendor_id);
                    CREATE INDEX IF NOT EXISTS idx_pricing_active ON product_pricing(is_active);
                    CREATE INDEX IF NOT EXISTS idx_pricing_options ON product_pricing USING GIN (package_options);
                `);
                console.log('   ✅ 인덱스 생성 완료');
                
                // 3. pricing_history 테이블 생성
                await pool.query(`
                    CREATE TABLE IF NOT EXISTS pricing_history (
                        id SERIAL PRIMARY KEY,
                        pricing_id INTEGER REFERENCES product_pricing(id) ON DELETE CASCADE,
                        old_package_options JSONB,
                        new_package_options JSONB,
                        changed_by VARCHAR(100),
                        change_reason TEXT,
                        version INTEGER,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                `);
                console.log('   ✅ pricing_history 테이블 생성 완료');
                
                // 4. 샘플 데이터 삽입
                await pool.query(`
                    INSERT INTO product_pricing (platform_name, product_name, package_options, notes)
                    VALUES 
                        ('NOL', '괌 돌핀크루즈 투어', 
                         '[
                           {"option_name": "성인", "selling_price": 120, "commission_rate": 15, "cost_price": 85},
                           {"option_name": "아동", "selling_price": 80, "commission_rate": 15, "cost_price": 60},
                           {"option_name": "유아", "selling_price": 0, "commission_rate": 0, "cost_price": 0}
                         ]'::jsonb,
                         '인기 투어 상품'),
                        ('KLOOK', '괌 정글리버크루즈', 
                         '[
                           {"option_name": "성인", "selling_price": 95, "commission_rate": 12, "cost_price": 70},
                           {"option_name": "아동", "selling_price": 65, "commission_rate": 12, "cost_price": 50}
                         ]'::jsonb,
                         '강 투어 상품')
                    ON CONFLICT (platform_name, product_name) DO NOTHING
                `);
                console.log('   ✅ 샘플 데이터 삽입 완료');
                
                // 마이그레이션 로그 기록
                await pool.query(
                    'INSERT INTO migration_log (version, description) VALUES ($1, $2)',
                    ['007', '요금 RAG 시스템: product_pricing, pricing_history 테이블 생성']
                );
                
                await pool.query('COMMIT');
                
                console.log('✅ 마이그레이션 007 완료!');
                
            } catch (error) {
                await pool.query('ROLLBACK');
                console.error('❌ 마이그레이션 007 실패:', error);
                throw error;
            }
        }

        // ==================== 마이그레이션 008: commission_rate 컬럼 추가 ====================
        async function runMigration008() {
            console.log('🔄 마이그레이션 008 실행 확인 중...');
            
            // 이미 실행되었는지 확인
            const checkResult = await pool.query(
                "SELECT * FROM migration_log WHERE version = '008'"
            );
            
            if (checkResult.rows.length > 0) {
                console.log('✅ 마이그레이션 008은 이미 실행되었습니다.');
                return;
            }
            
            console.log('🔄 마이그레이션 008 실행 중...');
            
            try {
                await pool.query('BEGIN');
                
                // commission_rate 컬럼 추가
                await pool.query(`
                    ALTER TABLE product_pricing 
                    ADD COLUMN IF NOT EXISTS commission_rate DECIMAL(5,2) DEFAULT 15.00;
                `);
                console.log('   ✅ commission_rate 컬럼 추가 완료');
                
                // 마이그레이션 로그 기록
                await pool.query(
                    'INSERT INTO migration_log (version, description) VALUES ($1, $2)',
                    ['008', 'product_pricing 테이블에 commission_rate 컬럼 추가']
                );
                
                await pool.query('COMMIT');
                
                console.log('✅ 마이그레이션 008 완료!');
                
            } catch (error) {
                await pool.query('ROLLBACK');
                console.error('❌ 마이그레이션 008 실패:', error);
                throw error;
            }
        }

        // ❌ 중복 API - 7901번 라인에 정의됨
        // app.get('/api/assignments/by-reservation/:reservationId', requireAuth, async (req, res) => {
        //     try {
        //         const { reservationId } = req.params;
        //         console.log('📋 수배서 정보 조회 요청:', reservationId);
        //         
        //         const result = await pool.query(`
        //             SELECT a.*, v.vendor_name, v.email as vendor_email
        //             FROM assignments a
        //             LEFT JOIN vendors v ON a.vendor_id = v.id
        //             WHERE a.reservation_id = $1
        //             ORDER BY a.assigned_at DESC
        //             LIMIT 1
        //         `, [reservationId]);
        //         
        //         if (result.rows.length > 0) {
        //             res.json({
        //                 success: true,
        //                 assignment: result.rows[0],
        //                 assignment_token: result.rows[0].assignment_token
        //             });
        //         } else {
        //             res.json({
        //                 success: false,
        //                 message: '수배서를 찾을 수 없습니다',
        //                 assignment: null
        //             });
        //         }
        //         
        //     } catch (error) {
        //         console.error('❌ 수배서 정보 조회 오류:', error);
        //         res.status(500).json({
        //             success: false,
        //             message: '수배서 정보 조회 중 오류가 발생했습니다: ' + error.message
        //         });
        //     }
        // });

        // 수배서 워드파일 다운로드 API
        app.get('/api/assignments/:reservationId/download/word', requireAuth, async (req, res) => {
            try {
                const { reservationId } = req.params;
                console.log('📄 워드파일 다운로드 요청:', reservationId);
                
                // 예약 정보 조회
                const reservation = await pool.query(`
                    SELECT * FROM reservations WHERE id = $1
                `, [reservationId]);
                
                if (reservation.rows.length === 0) {
                    return res.status(404).json({
                        success: false,
                        message: '예약 정보를 찾을 수 없습니다'
                    });
                }
                
                const reservationData = reservation.rows[0];
                
                // 워드 문서 생성 (간단한 HTML 형태로)
                const wordContent = generateWordContent(reservationData);
                
                res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
                res.setHeader('Content-Disposition', `attachment; filename="수배서_${reservationId}.docx"`);
                
                // 실제로는 docx 라이브러리를 사용해야 하지만, 여기서는 HTML을 반환
                res.send(wordContent);
                
            } catch (error) {
                console.error('❌ 워드파일 다운로드 오류:', error);
                res.status(500).json({
                    success: false,
                    message: '워드파일 생성 중 오류가 발생했습니다: ' + error.message
                });
            }
        });
        
        // 수배서 PDF 다운로드 API
        app.get('/api/assignments/:reservationId/download/pdf', requireAuth, async (req, res) => {
            try {
                const { reservationId } = req.params;
                console.log('📄 PDF 다운로드 요청:', reservationId);
                
                // 예약 정보 조회
                const reservation = await pool.query(`
                    SELECT * FROM reservations WHERE id = $1
                `, [reservationId]);
                
                if (reservation.rows.length === 0) {
                    return res.status(404).json({
                        success: false,
                        message: '예약 정보를 찾을 수 없습니다'
                    });
                }
                
                const reservationData = reservation.rows[0];
                
                // PDF 생성 (puppeteer 등을 사용해야 하지만 여기서는 간단히)
                const pdfContent = generatePdfContent(reservationData);
                
                res.setHeader('Content-Type', 'application/pdf');
                res.setHeader('Content-Disposition', `attachment; filename="수배서_${reservationId}.pdf"`);
                
                res.send(pdfContent);
                
            } catch (error) {
                console.error('❌ PDF 다운로드 오류:', error);
                res.status(500).json({
                    success: false,
                    message: 'PDF 생성 중 오류가 발생했습니다: ' + error.message
                });
            }
        });
        
        // 수배업체 메일 전송 API
        app.post('/api/assignments/:reservationId/send-email', requireAuth, async (req, res) => {
            try {
                const { reservationId } = req.params;
                const { assignment_url, message } = req.body;
                
                console.log('📧 수배업체 메일 전송 요청:', reservationId);
                
                // 예약 정보 및 수배업체 정보 조회
                const result = await pool.query(`
                    SELECT r.*, v.email as vendor_email, v.vendor_name
                    FROM reservations r
                    LEFT JOIN assignments a ON r.id = a.reservation_id
                    LEFT JOIN vendors v ON a.vendor_id = v.id
                    WHERE r.id = $1
                `, [reservationId]);
                
                if (result.rows.length === 0) {
                    return res.status(404).json({
                        success: false,
                        message: '예약 정보를 찾을 수 없습니다'
                    });
                }
                
                const reservation = result.rows[0];
                
                // 메일 전송 (nodemailer 설정이 있다면)
                if (process.env.SMTP_HOST) {
                    const transporter = nodemailer.createTransport({
                        host: process.env.SMTP_HOST,
                        port: process.env.SMTP_PORT || 587,
                        secure: false,
                        auth: {
                            user: process.env.SMTP_USER,
                            pass: process.env.SMTP_PASS
                        }
                    });
                    
                    const mailOptions = {
                        from: process.env.SMTP_FROM || 'noreply@guamsavecard.com',
                        to: reservation.vendor_email || 'vendor@example.com',
                        subject: `[괌세이브카드] 수배서 - ${reservation.reservation_number}`,
                        html: `
                            <h2>수배서 확인 요청</h2>
                            <p>안녕하세요, ${reservation.vendor_name || '수배업체'} 담당자님</p>
                            <p>새로운 수배서가 도착했습니다.</p>
                            
                            <div style="border: 1px solid #ddd; padding: 15px; margin: 10px 0;">
                                <h3>예약 정보</h3>
                                <p><strong>예약번호:</strong> ${reservation.reservation_number}</p>
                                <p><strong>예약자명:</strong> ${reservation.korean_name}</p>
                                <p><strong>상품명:</strong> ${reservation.product_name}</p>
                                <p><strong>사용일자:</strong> ${reservation.usage_date}</p>
                                <p><strong>인원:</strong> 성인 ${reservation.people_adult || 0}명, 아동 ${reservation.people_child || 0}명</p>
                            </div>
                            
                            <p><a href="${assignment_url}" style="background: #007bff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">수배서 확인하기</a></p>
                            
                            <p>${message}</p>
                            
                            <hr>
                            <p><small>괌세이브카드 수배관리시스템</small></p>
                        `
                    };
                    
                    await transporter.sendMail(mailOptions);
                    
                    console.log('✅ 이메일 전송 완료:', reservation.vendor_email);
                }
                
                // assignments 테이블의 sent_at 업데이트
                await pool.query(`
                    UPDATE assignments 
                    SET sent_at = NOW(), 
                        updated_at = NOW()
                    WHERE reservation_id = $1
                `, [reservationId]);
                
                console.log('✅ assignments.sent_at 업데이트 완료');
                
                // 전송 로그 기록
                await pool.query(`
                    INSERT INTO assignment_logs (reservation_id, action_type, details, created_at)
                    VALUES ($1, $2, $3, NOW())
                `, [reservationId, 'email_sent', '수배업체 메일 전송']);
                
                res.json({
                    success: true,
                    message: '수배업체로 메일이 전송되었습니다'
                });
                
            } catch (error) {
                console.error('❌ 메일 전송 오류:', error);
                res.status(500).json({
                    success: false,
                    message: '메일 전송 중 오류가 발생했습니다: ' + error.message
                });
            }
        });
        
        // 워드 문서 내용 생성 함수
        function generateWordContent(reservation) {
            return `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="UTF-8">
                    <title>수배서</title>
                    <style>
                        body { font-family: 'Malgun Gothic', sans-serif; }
                        .header { text-align: center; margin-bottom: 30px; }
                        .info-table { width: 100%; border-collapse: collapse; }
                        .info-table th, .info-table td { 
                            border: 1px solid #ddd; 
                            padding: 8px; 
                            text-align: left; 
                        }
                        .info-table th { background-color: #f5f5f5; }
                    </style>
                </head>
                <body>
                    <div class="header">
                        <h1>수 배 서</h1>
                        <p>괌세이브카드</p>
                    </div>
                    
                    <table class="info-table">
                        <tr><th>예약번호</th><td>${reservation.reservation_number || '-'}</td></tr>
                        <tr><th>예약자명</th><td>${reservation.korean_name || '-'}</td></tr>
                        <tr><th>고객연락처</th><td>${reservation.phone || '-'}</td></tr>
                        <tr><th>업체명</th><td>${reservation.platform_name || '-'}</td></tr>
                        <tr><th>상품명</th><td>${reservation.product_name || '-'}</td></tr>
                        <tr><th>패키지(옵션명)</th><td>${reservation.package_type || '-'}</td></tr>
                        <tr><th>사용일자</th><td>${reservation.usage_date || '-'}</td></tr>
                        <tr><th>인원</th><td>성인 ${reservation.people_adult || 0}명, 아동 ${reservation.people_child || 0}명</td></tr>
                        <tr><th>메모</th><td>${reservation.memo || '-'}</td></tr>
                    </table>
                    
                    <div style="margin-top: 30px;">
                        <p>위 내용으로 수배를 요청드립니다.</p>
                        <p>확인 후 회신 부탁드립니다.</p>
                    </div>
                </body>
                </html>
            `;
        }
        
        // PDF 내용 생성 함수 (실제로는 puppeteer 등 필요)
        function generatePdfContent(reservation) {
            // 실제 구현에서는 puppeteer나 다른 PDF 생성 라이브러리 사용
            return Buffer.from('PDF 생성 기능은 추후 구현 예정입니다.');
        }

        // ERP 마이그레이션도 비동기로 실행
        setTimeout(async () => {
            try {
                await runERPMigration();
                console.log('✅ ERP 마이그레이션 완료');
                
                // 마이그레이션 005 실행 (settlements 테이블 정산이관 컬럼 추가)
                await runMigration005();
                console.log('✅ 정산이관 마이그레이션 완료');
                
                // 마이그레이션 006 실행 (송금 시 환율 저장 컬럼 추가)
                await runMigration006();
                console.log('✅ 송금 환율 마이그레이션 완료');
                
                // 마이그레이션 007 실행 (요금 RAG 테이블 생성)
                await runMigration007();
                console.log('✅ 요금 RAG 마이그레이션 완료');
                
                // 마이그레이션 008 실행 (commission_rate 컬럼 추가)
                await runMigration008();
                console.log('✅ commission_rate 컬럼 추가 완료');
            } catch (error) {
                console.error('⚠️ 마이그레이션 실패 (서버는 계속 실행):', error.message);
            }
        }, 5000);
        
        return httpServer;
    } catch (error) {
        console.error('❌ 서버 시작 실패:', error);
        process.exit(1);
    }
}

// 서버 시작 및 에러 핸들링
startServer().then(serverInstance => {
    console.log('✅ 서버 초기화 및 시작 완료');
    
    serverInstance.on('error', (error) => {
        console.error('❌ 서버 오류:', error);
        if (error.code === 'EADDRINUSE') {
            console.error(`포트 ${PORT}가 이미 사용 중입니다.`);
        }
        process.exit(1);
    });
    
    // 프로세스 종료 시 정리
    process.on('SIGTERM', () => {
        console.log('🔄 SIGTERM 신호 수신, 서버 종료 중...');
        serverInstance.close(() => {
            console.log('✅ 서버가 정상적으로 종료되었습니다.');
            process.exit(0);
        });
    });
    
    process.on('SIGINT', () => {
        console.log('🔄 SIGINT 신호 수신, 서버 종료 중...');
        serverInstance.close(() => {
            console.log('✅ 서버가 정상적으로 종료되었습니다.');
            process.exit(0);
        });
    });
    
}).catch(error => {
    console.error('❌ 서버 초기화 실패:', error);
    process.exit(1);
});
