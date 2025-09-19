const express = require('express');
const session = require('express-session');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const { testConnection } = require('./config/database');

const app = express();
const PORT = process.env.PORT || 3000;

// 보안 미들웨어
app.use(helmet({
    contentSecurityPolicy: false // QR 이미지 표시를 위해 비활성화
}));

// Rate limiting
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15분
    max: 100 // 최대 100개 요청
});
app.use(limiter);

// CORS 설정
app.use(cors());

// 미들웨어 설정
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static('public'));

// 세션 설정
app.use(session({
    secret: process.env.SESSION_SECRET || 'guam-savecard-secret-key',
    resave: false,
    saveUninitialized: false,
    cookie: {
        secure: false, // HTTPS에서는 true로 설정
        maxAge: 24 * 60 * 60 * 1000 // 24시간
    }
}));

// EJS 템플릿 엔진 설정
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// QR 코드 이미지 정적 파일 제공
app.use('/qrcodes', express.static(path.join(__dirname, 'qrcodes')));

// 라우트 설정
const indexRouter = require('./routes/index');
const adminRouter = require('./routes/admin');

app.use('/', indexRouter);
app.use('/admin', adminRouter);

// 임시 마이그레이션 엔드포인트 (배포 후 삭제 예정)
app.get('/run-migrations', async (req, res) => {
    try {
        const { Pool } = require('pg');
        const fs = require('fs');
        const path = require('path');
        
        const pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
        });

        // 마이그레이션 추적 테이블 생성
        await pool.query(`
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version VARCHAR(255) PRIMARY KEY,
                applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        const migrationsDir = path.join(__dirname, 'migrations');
        const migrationFiles = fs.readdirSync(migrationsDir)
            .filter(file => file.endsWith('.sql'))
            .sort();

        let results = [];
        
        for (const file of migrationFiles) {
            const version = file.replace('.sql', '');
            
            // 이미 적용된 마이그레이션인지 확인
            const { rows } = await pool.query(
                'SELECT version FROM schema_migrations WHERE version = $1',
                [version]
            );
            
            if (rows.length > 0) {
                results.push(`✅ ${file} - 이미 적용됨`);
                continue;
            }
            
            // 마이그레이션 실행
            const migrationSQL = fs.readFileSync(path.join(migrationsDir, file), { encoding: 'utf8' });
            
            await pool.query('BEGIN');
            try {
                await pool.query(migrationSQL);
                await pool.query(
                    'INSERT INTO schema_migrations (version) VALUES ($1)',
                    [version]
                );
                await pool.query('COMMIT');
                results.push(`✅ ${file} - 성공적으로 적용됨`);
            } catch (error) {
                await pool.query('ROLLBACK');
                results.push(`❌ ${file} - 실패: ${error.message}`);
            }
        }
        
        await pool.end();
        
        res.json({
            success: true,
            message: '마이그레이션 완료',
            results: results
        });
        
    } catch (error) {
        console.error('마이그레이션 실행 오류:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

// 404 에러 핸들링
app.use((req, res) => {
    res.status(404).render('error', {
        title: '페이지를 찾을 수 없습니다',
        message: '요청하신 페이지가 존재하지 않습니다.',
        error: { status: 404 }
    });
});

// 에러 핸들링
app.use((err, req, res, next) => {
    console.error('서버 에러:', err);
    res.status(err.status || 500).render('error', {
        title: '서버 오류',
        message: '서버에서 오류가 발생했습니다.',
        error: process.env.NODE_ENV === 'development' ? err : {}
    });
});

// 서버 시작
async function startServer() {
    try {
        // 데이터베이스 연결 테스트
        const dbConnected = await testConnection();
        if (!dbConnected) {
            console.error('데이터베이스 연결에 실패했습니다. 서버를 시작할 수 없습니다.');
            process.exit(1);
        }

        app.listen(PORT, () => {
            console.log(`🚀 괌세이브카드 서버가 포트 ${PORT}에서 실행 중입니다.`);
            console.log(`📱 웹사이트: http://localhost:${PORT}`);
            console.log(`🔧 관리자: http://localhost:${PORT}/admin`);
        });
    } catch (error) {
        console.error('서버 시작 실패:', error);
        process.exit(1);
    }
}

startServer();
